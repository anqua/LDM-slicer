// The Material view of a print: the beads as solid tubes of their real width and height (bead-mesh.js), and a nozzle of the
// real size at the tip of the print. Built once per slice, the first time it is shown.
import * as THREE from 'three';
import { cssVar } from '../core/theme.js';
import { buildBeadMesh } from './bead-mesh.js';

/**
 * @param moves  print-order moves with their bead area (move-list.js)
 * @param ctx    { lineW, nozzle } in mm
 * @returns { objects: [mesh, nozzle] to add to the scene, show(v), update(segsDone, tip, nozzleVisible), dispose() }
 */
export function createSolidView(moves, ctx) {
  const b = buildBeadMesh(moves, ctx.lineW);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  g.setIndex(new THREE.BufferAttribute(b.index, 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: cssVar('clay'), roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;

  // The nozzle: a cone of the real outlet diameter, its tip at the end of the move.
  const r = ctx.nozzle / 2, ng = new THREE.CylinderGeometry(r * 2.2, r, ctx.nozzle * 3, 24);
  ng.rotateX(Math.PI / 2);                              // axis along z
  ng.translate(0, 0, ctx.nozzle * 1.5);
  const nozzle = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: '#9a9a9a', roughness: 0.5, metalness: 0.6 }));

  return {
    objects: [mesh, nozzle],
    show(v, nozzleVisible) { mesh.visible = v; nozzle.visible = v && nozzleVisible; },
    /** Draw the first `segsDone` extruded moves, and put the nozzle at `tip`. */
    update(segsDone, tip, nozzleVisible) {
      g.setDrawRange(0, segsDone * b.K * 6);          // each move is 6·K indices
      nozzle.position.set(tip[0], tip[1], tip[2]);
      nozzle.visible = nozzleVisible;
    },
    dispose() { for (const o of [mesh, nozzle]) { o.geometry.dispose(); o.material.dispose(); } },
  };
}
