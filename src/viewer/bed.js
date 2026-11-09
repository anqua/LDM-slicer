// Build plate, grid and build-volume outline, sized from printer settings.
import * as THREE from 'three';
import { S } from '../core/settings.js';
import { cssVar } from '../core/theme.js';

/** Bed extents in printer coordinates. */
export function bedRect(s = S) {
  return s.origin === 'center'
    ? { x0: -s.bedX / 2, y0: -s.bedY / 2, x1: s.bedX / 2, y1: s.bedY / 2 }
    : { x0: 0, y0: 0, x1: s.bedX, y1: s.bedY };
}

export function bedCenter(s = S) {
  const b = bedRect(s);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

const lineSegments = (arr, color) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
};

function disposeTree(obj) {
  obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

export function createBed(scene) {
  const group = new THREE.Group();
  scene.add(group);

  function rebuild() {
    for (const c of [...group.children]) { disposeTree(c); group.remove(c); }

    const b = bedRect(), { cx, cy } = bedCenter();
    const round = S.bedShape === 'round', R = S.bedX / 2;

    const plateMat = new THREE.MeshBasicMaterial({ color: cssVar('bed') });   // unlit: exact token color
    const plate = new THREE.Mesh(round ? new THREE.CircleGeometry(R, 96) : new THREE.PlaneGeometry(S.bedX, S.bedY), plateMat);
    plate.position.set(cx, cy, -0.05);
    group.add(plate);

    // Grid every 10 mm, bolder every 50 mm; clipped to the circle on round beds.
    const minor = [], major = [];
    for (let x = Math.ceil(b.x0 / 10) * 10; x <= b.x1; x += 10) {
      let ya = b.y0, yb = b.y1;
      if (round) { const d = Math.sqrt(Math.max(0, R ** 2 - (x - cx) ** 2)); ya = cy - d; yb = cy + d; }
      (x % 50 === 0 ? major : minor).push(x, ya, 0, x, yb, 0);
    }
    for (let y = Math.ceil(b.y0 / 10) * 10; y <= b.y1; y += 10) {
      let xa = b.x0, xb = b.x1;
      if (round) { const d = Math.sqrt(Math.max(0, R ** 2 - (y - cy) ** 2)); xa = cx - d; xb = cx + d; }
      (y % 50 === 0 ? major : minor).push(xa, y, 0, xb, y, 0);
    }
    group.add(lineSegments(minor, cssVar('grid')), lineSegments(major, cssVar('grid2')));

    const volGeom = round
      ? new THREE.CylinderGeometry(R, R, S.bedZ, 64, 1, true).rotateX(Math.PI / 2)
      : new THREE.BoxGeometry(S.bedX, S.bedY, S.bedZ);
    const vol = new THREE.LineSegments(new THREE.EdgesGeometry(volGeom, 30),
      new THREE.LineBasicMaterial({ color: cssVar('vol') }));
    volGeom.dispose();
    vol.position.set(cx, cy, S.bedZ / 2);
    group.add(vol);

    const axes = new THREE.AxesHelper(30);
    axes.position.set(0, 0, 0.1);
    group.add(axes);
  }

  return { rebuild };
}
