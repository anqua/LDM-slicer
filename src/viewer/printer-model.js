// Schematic WASP 2040 delta printer around the bed, with a head that follows the nozzle.
// Sized from the WASP preset's `frame` and the bed settings. Not a product replica.
import * as THREE from 'three';
import { S } from '../core/settings.js';
import { cssVar } from '../core/theme.js';
import { PRINTERS, DEFAULT_PRINTER } from '../core/printers.js';
import { bedCenter } from './bed.js';

const UP = new THREE.Vector3(0, 1, 0);
const TOWER_ANGLES = [90, 210, 330].map(d => THREE.MathUtils.degToRad(d));   // one tower at the back

/** Unit-length cylinder; place it between two points with setRod(). */
function rod(r, mat) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), mat);
}

const _dir = new THREE.Vector3();
function setRod(m, a, b) {
  _dir.subVectors(b, a);
  const L = _dir.length();
  m.position.copy(a).addScaledVector(_dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, _dir.divideScalar(L || 1));
  m.scale.set(1, L, 1);
}

const NOZZLE_H = 34;          // cone height; the nozzle tip is the cone's point

/** Triangle with vertices at radius R in the tower directions, rotated by `rot`. */
function triangle(R, path = new THREE.Shape(), rot = 0) {
  TOWER_ANGLES.forEach((a, i) => path[i ? 'lineTo' : 'moveTo'](R * Math.cos(a + rot), R * Math.sin(a + rot)));
  path.closePath();
  return path;
}

/** Flat triangular slab (optionally a ring) lying in XY, from z0 up by `depth`. */
function triSlab(cx, cy, z0, R, depth, mat, innerR = 0, rot = 0) {
  const shape = triangle(R, new THREE.Shape(), rot);
  if (innerR) shape.holes.push(triangle(innerR, new THREE.Path(), rot));
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), mat);
  m.position.set(cx, cy, z0);
  return m;
}

function box(w, d, h, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  return m;
}

export function createPrinterModel(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let extent = null;               // { zMin, zMax, r } for camera framing

  function materials() {
    return {
      frame: new THREE.MeshStandardMaterial({ color: cssVar('printer'), roughness: 0.55, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: cssVar('printer-dark'), roughness: 0.8, metalness: 0.1 }),
      tip: new THREE.MeshBasicMaterial({ color: cssVar('accent') }),
    };
  }

  function buildDelta(frame, M) {
    const { cx, cy } = bedCenter(), bedR = S.bedX / 2;
    const footprint = frame?.footprint ?? bedR * 4.9;              // WASP 2040: 490 mm for a Ø200 bed
    const towerR = footprint / Math.sqrt(3) * 0.85;
    const below = frame?.below ?? S.bedZ * 0.3;
    const top = frame ? frame.height - below : S.bedZ * 1.9;
    const at = (a, r, z) => new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), z);

    const BASE_T = 30, TOP_T = 25, TOWER_W = 30;

    // Base slab and bed support.
    group.add(triSlab(cx, cy, -below, towerR * 1.22, BASE_T, M.dark));
    const support = new THREE.Mesh(new THREE.CylinderGeometry(bedR * 1.04, bedR * 1.04, below - BASE_T, 64), M.dark);
    support.rotation.x = Math.PI / 2;
    support.position.set(cx, cy, -(below - BASE_T) / 2 - 0.2);
    group.add(support);

    // Towers run between the top of the base slab and the underside of the top ring.
    const z0 = -below + BASE_T, z1 = top - TOP_T;
    for (const a of TOWER_ANGLES) {
      const p = at(a, towerR, (z0 + z1) / 2);
      const t = box(TOWER_W, TOWER_W, z1 - z0, p.x, p.y, p.z, M.frame);
      t.rotation.z = a;
      group.add(t);
    }
    group.add(triSlab(cx, cy, z1, towerR * 1.22, TOP_T, M.dark, towerR * 0.72));

    // Effector (head): triangular plate whose edges face the towers (vertices point away from
    // them), with the nozzle below. Each arm pair attaches along one edge.
    const effApothem = 34, effT = 14, pair = 22;
    const head = new THREE.Group();                                  // origin = effector center
    head.add(triSlab(0, 0, -effT / 2, effApothem * 2, effT, M.frame, 0, Math.PI));
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(9, NOZZLE_H, 16), M.tip);
    nozzle.rotation.x = -Math.PI / 2;                                // point down
    nozzle.position.set(0, 0, -effT / 2 - NOZZLE_H / 2);
    head.add(nozzle);
    group.add(head);

    // Carriages sit on the inner face of each tower; arms join their inner face.
    const carD = 22, carH = 44, carR = towerR - TOWER_W / 2 - carD / 2, jointR = carR - carD / 2;
    const armL = towerR * 1.15;
    const towers = TOWER_ANGLES.map(a => {
      const car = box(pair * 2 + 14, carD, carH, 0, 0, 0, M.dark);
      car.rotation.z = a + Math.PI / 2;
      const arms = [rod(3.5, M.frame), rod(3.5, M.frame)];
      group.add(car, ...arms);
      return { a, car, arms, side: new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(pair) };
    });

    // Delta kinematics: each carriage sits where its fixed-length arms reach the effector.
    const e = new THREE.Vector3(), k = new THREE.Vector3();
    const pose = (x, y, tipZ) => {
      const ez = tipZ + effT / 2 + NOZZLE_H;
      head.position.set(x, y, ez);
      for (const t of towers) {
        const ex = x + effApothem * Math.cos(t.a), ey = y + effApothem * Math.sin(t.a);
        const kx = cx + jointR * Math.cos(t.a), ky = cy + jointR * Math.sin(t.a);
        const d = Math.hypot(kx - ex, ky - ey);
        const carZ = Math.min(ez + Math.sqrt(Math.max(armL ** 2 - d ** 2, 400)), z1 - carH / 2);
        t.car.position.set(cx + carR * Math.cos(t.a), cy + carR * Math.sin(t.a), carZ);
        t.arms.forEach((arm, i) => {
          const s = i ? -1 : 1;
          e.set(ex, ey, ez).addScaledVector(t.side, s);
          k.set(kx, ky, carZ).addScaledVector(t.side, s);
          setRod(arm, e, k);
        });
      }
    };
    // Parked just above the build volume.
    return { extent: { zMin: -below, zMax: top, r: towerR * 1.22 }, pose, park: [cx, cy, S.bedZ + 30 - effT / 2 - NOZZLE_H] };
  }

  function rebuild() {
    for (const c of [...group.children]) {
      c.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      group.remove(c);
    }
    const frame = PRINTERS[S.printerPreset]?.frame ?? PRINTERS[DEFAULT_PRINTER].frame;
    rig = buildDelta(frame, materials());
    extent = rig.extent;
    rig.pose(...(head ?? rig.park));
  }

  let rig = null, head = null;     // head: [x, y, z] nozzle tip while simulating, null when parked

  return {
    rebuild,
    /** Move the nozzle tip to (x, y, z) in printer coordinates. */
    setHead(x, y, z) { head = [x, y, z]; rig?.pose(x, y, z); },
    /** Return the head to its rest position above the build volume. */
    park() { head = null; if (rig) rig.pose(...rig.park); },
    setVisible(v) { group.visible = v; },
    get visible() { return group.visible; },
    /** Vertical extent and radius when visible, for camera framing; null when hidden. */
    extent: () => (group.visible ? extent : null),
  };
}
