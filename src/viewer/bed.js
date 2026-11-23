// Round build plate (WASP 2040 delta), grid and build-volume outline, sized from printer settings.
// The origin (0, 0) is the bed center, as on the delta.
import * as THREE from 'three';
import { S } from '../core/settings.js';
import { cssVar } from '../core/theme.js';

/** Bed center in printer coordinates. */
export function bedCenter() {
  return { cx: 0, cy: 0 };
}

const lineSegments = (arr, color) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
};

function disposeTree(obj) {
  obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

/** Height of the bed plate: just under z = 0 so the grid lines (z = 0) and the first layer sit clearly above it. */
export const PLATE_Z = -0.3;

export function createBed(scene) {
  const group = new THREE.Group();
  scene.add(group);

  function rebuild() {
    for (const c of [...group.children]) { disposeTree(c); group.remove(c); }

    const R = S.bedX / 2;
    // Unlit: exact token color. polygonOffset pushes the plate back in depth so the grid lines drawn on it
    // can never flicker through (no coplanar or near-coplanar surfaces: the platform's rim meets it edge to edge).
    const plateMat = new THREE.MeshBasicMaterial({ color: cssVar('bed'), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const plate = new THREE.Mesh(new THREE.CircleGeometry(R, 96), plateMat);
    plate.position.z = PLATE_Z;
    group.add(plate);

    // Grid every 10 mm, bolder every 50 mm, clipped to the circle.
    const minor = [], major = [];
    for (let v = Math.ceil(-R / 10) * 10; v <= R; v += 10) {
      const d = Math.sqrt(Math.max(0, R ** 2 - v ** 2));
      (v % 50 === 0 ? major : minor).push(v, -d, 0, v, d, 0, -d, v, 0, d, v, 0);
    }
    group.add(lineSegments(minor, cssVar('grid')), lineSegments(major, cssVar('grid2')));

    const volGeom = new THREE.CylinderGeometry(R, R, S.bedZ, 64, 1, true).rotateX(Math.PI / 2);
    const vol = new THREE.LineSegments(new THREE.EdgesGeometry(volGeom, 30),
      new THREE.LineBasicMaterial({ color: cssVar('vol') }));
    volGeom.dispose();
    vol.position.z = S.bedZ / 2;
    group.add(vol);

    const axes = new THREE.AxesHelper(30);
    axes.position.z = 0.1;
    group.add(axes);
  }

  return { rebuild };
}
