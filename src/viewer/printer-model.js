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

function triangle(R, path = new THREE.Shape()) {
  TOWER_ANGLES.forEach((a, i) => path[i ? 'lineTo' : 'moveTo'](R * Math.cos(a), R * Math.sin(a)));
  path.closePath();
  return path;
}

/** Flat triangular slab (optionally a ring) lying in XY, from z0 up by `depth`. */
function triSlab(cx, cy, z0, R, depth, mat, innerR = 0) {
  const shape = triangle(R);
  if (innerR) shape.holes.push(triangle(innerR, new THREE.Path()));
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
      tank: new THREE.MeshStandardMaterial({ color: cssVar('printer'), roughness: 0.3, metalness: 0.6 }),
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

    // Base slab, bed support, towers, top ring.
    group.add(triSlab(cx, cy, -below, towerR * 1.22, 30, M.dark));
    const support = new THREE.Mesh(new THREE.CylinderGeometry(bedR * 1.04, bedR * 1.04, below - 30, 64), M.dark);
    support.rotation.x = Math.PI / 2;
    support.position.set(cx, cy, -(below - 30) / 2 - 0.2);
    group.add(support);
    for (const a of TOWER_ANGLES) {
      const p = at(a, towerR, (top - below) / 2);
      const t = box(30, 30, top + below, p.x, p.y, p.z, M.frame);
      t.rotation.z = a;
      group.add(t);
    }
    group.add(triSlab(cx, cy, top - 25, towerR * 1.22, 25, M.dark, towerR * 0.72));

    // Effector parked just above the build volume, arms to carriages on the towers.
    const park = S.bedZ + 30, effR = 38, armL = towerR * 1.15;
    const eff = new THREE.Mesh(new THREE.CylinderGeometry(effR, effR, 16, 6), M.frame);
    eff.rotation.x = Math.PI / 2;
    eff.position.set(cx, cy, park);
    group.add(eff);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(9, 34, 16), M.tip);
    nozzle.rotation.x = -Math.PI / 2;                                // point down
    nozzle.position.set(cx, cy, park - 25);
    group.add(nozzle);

    const reach = towerR - 24 - effR;
    const carZ = park + Math.sqrt(Math.max(armL ** 2 - reach ** 2, 400));
    for (const a of TOWER_ANGLES) {
      const c = at(a, towerR - 24, carZ);
      const car = box(56, 22, 44, c.x, c.y, c.z, M.dark);
      car.rotation.z = a + Math.PI / 2;
      group.add(car);
      const side = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(22);   // parallel arm pair
      for (const s of [1, -1]) {
        const e = at(a, effR, park).addScaledVector(side, s);
        const k = c.clone().addScaledVector(side, s);
        group.add(rod(e, k, 3.5, M.frame));
      }
    }

    // Clay tank on top and the feed hose down to the effector.
    const liters = frame?.tankLiters ?? S.reservoir / 1000;
    const tankR = 65, tankH = (liters * 1e6) / (Math.PI * tankR ** 2);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(tankR * 1.4, tankR * 1.4, 12, 48), M.dark);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(cx, cy, top - 6);
    group.add(hub);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(tankR, tankR, tankH, 48), M.tank);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(cx, cy, top + tankH / 2);
    group.add(tank);
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx + tankR * 0.5, cy, top - 10),
      new THREE.Vector3(cx + towerR * 0.45, cy - towerR * 0.15, (top + park) / 2 + 60),
      new THREE.Vector3(cx + effR * 0.5, cy, park + 10),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 40, 5, 8), M.dark));

    return { zMin: -below, zMax: top + tankH, r: towerR * 1.22 };
  }

  function buildBox(M) {
    const b = bedRect(), { cx, cy } = bedCenter(), m = 45;
    const x0 = b.x0 - m, x1 = b.x1 + m, y0 = b.y0 - m, y1 = b.y1 + m;
    const below = 60, top = S.bedZ + 140;
    group.add(box(x1 - x0 + 30, y1 - y0 + 30, 30, cx, cy, -below + 15, M.dark));
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
      group.add(box(30, 30, top + below, x, y, (top - below) / 2, M.frame));
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
