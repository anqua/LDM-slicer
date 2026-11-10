// Schematic printer around the bed: a delta frame for round beds, a box frame for rectangular ones.
// Sized from settings, or from the active preset's `frame` when one is selected. Not a product replica.
import * as THREE from 'three';
import { S } from '../core/settings.js';
import { cssVar } from '../core/theme.js';
import { PRINTERS } from '../core/printers.js';
import { bedRect, bedCenter } from './bed.js';

const UP = new THREE.Vector3(0, 1, 0);
const TOWER_ANGLES = [90, 210, 330].map(d => THREE.MathUtils.degToRad(d));   // one tower at the back

/** Cylinder between two points. */
function rod(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

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

    // Effector: triangular plate whose edges face the towers (vertices point away from them),
    // parked just above the build volume. Each arm pair attaches along one edge.
    const park = S.bedZ + 30, effApothem = 34, effT = 14, pair = 22;
    group.add(triSlab(cx, cy, park - effT / 2, effApothem * 2, effT, M.frame, 0, Math.PI));
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(9, 34, 16), M.tip);
    nozzle.rotation.x = -Math.PI / 2;                                // point down
    nozzle.position.set(cx, cy, park - effT / 2 - 17);
    group.add(nozzle);

    // Carriages sit on the inner face of each tower; arms join their inner face.
    const carD = 22, carR = towerR - TOWER_W / 2 - carD / 2, jointR = carR - carD / 2;
    const armL = towerR * 1.15, reach = jointR - effApothem;
    const carZ = Math.min(park + Math.sqrt(Math.max(armL ** 2 - reach ** 2, 400)), z1 - 40);
    for (const a of TOWER_ANGLES) {
      const c = at(a, carR, carZ);
      const car = box(pair * 2 + 14, carD, 44, c.x, c.y, c.z, M.dark);
      car.rotation.z = a + Math.PI / 2;
      group.add(car);
      const side = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(pair);   // parallel arm pair
      for (const s of [1, -1]) {
        const e = at(a, effApothem, park).addScaledVector(side, s);     // on the effector edge
        const k = at(a, jointR, carZ).addScaledVector(side, s);         // on the carriage face
        group.add(rod(e, k, 3.5, M.frame));
      }
    }

    return { zMin: -below, zMax: top, r: towerR * 1.22 };
  }

  function buildBox(M) {
    const b = bedRect(), { cx, cy } = bedCenter(), m = 45;
    const x0 = b.x0 - m, x1 = b.x1 + m, y0 = b.y0 - m, y1 = b.y1 + m;
    const below = 60, top = S.bedZ + 140;
    group.add(box(x1 - x0 + 30, y1 - y0 + 30, 30, cx, cy, -below + 15, M.dark));
    // Posts run between the top of the base and the underside of the top bars.
    const p0 = -below + 30, p1 = top - 15;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
      group.add(box(30, 30, p1 - p0, x, y, (p0 + p1) / 2, M.frame));
    group.add(box(x1 - x0 + 30, 30, 30, cx, y0, top, M.frame), box(x1 - x0 + 30, 30, 30, cx, y1, top, M.frame));
    group.add(box(30, y1 - y0, 30, x0, cy, top, M.frame), box(30, y1 - y0, 30, x1, cy, top, M.frame));
    // Gantry with the print head parked over the bed center.
    const gz = S.bedZ + 60;
    group.add(box(x1 - x0, 24, 24, cx, cy, gz, M.frame));
    group.add(box(50, 50, 60, cx, cy, gz - 20, M.dark));
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(9, 34, 16), M.tip);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.set(cx, cy, gz - 65);
    group.add(nozzle);
    return { zMin: -below, zMax: top + 15, r: Math.hypot(x1 - x0, y1 - y0) / 2 };
  }

  function rebuild() {
    for (const c of [...group.children]) {
      c.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      group.remove(c);
    }
    const frame = PRINTERS[S.printerPreset]?.frame ?? null;
    const kind = frame?.kind ?? (S.bedShape === 'round' ? 'delta' : 'box');
    const M = materials();
    extent = kind === 'delta' ? buildDelta(frame, M) : buildBox(M);
  }

  return {
    rebuild,
    setVisible(v) { group.visible = v; },
    get visible() { return group.visible; },
    /** Vertical extent and radius when visible, for camera framing; null when hidden. */
    extent: () => (group.visible ? extent : null),
  };
}
