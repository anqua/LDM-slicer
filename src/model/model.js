// The loaded model: source geometry, user rotation, placement on the bed and build-volume check.
// Scale and XY offset come from settings (S.scale, S.offX, S.offY); rotation lives here.
import * as THREE from 'three';
import { S } from '../core/settings.js';
import { cssVar } from '../core/theme.js';
import { bedCenter } from '../viewer/bed.js';

const EPS = 1e-3;

export function createModel(scene) {
  const okMat = new THREE.MeshStandardMaterial({ color: cssVar('model'), roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const outMat = new THREE.MeshStandardMaterial({ color: cssVar('model-out'), roughness: 0.85, side: THREE.DoubleSide });

  let base = null;               // geometry as loaded, centered on the origin
  let name = '';
  const rotation = new THREE.Matrix4();
  let mesh = null;
  let visible = true;

  /** Set new source geometry. Call rebuild() (or change a transform setting) to place it. */
  function load(geometry, fileName) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.computeBoundingBox();
    const c = new THREE.Vector3();
    g.boundingBox.getCenter(c);
    g.translate(-c.x, -c.y, -c.z);
    base?.dispose();
    base = g;
    name = fileName;
    rotation.identity();
  }

  /** Re-apply rotation, scale and placement: centered on bed + offset, resting on z = 0. */
  function rebuild() {
    if (!base) return;
    const g = base.clone();
    g.applyMatrix4(rotation);
    const s = S.scale / 100;
    g.scale(s, s, s);
    g.computeBoundingBox();
    const bb = g.boundingBox, { cx, cy } = bedCenter();
    g.translate(cx + S.offX - (bb.min.x + bb.max.x) / 2, cy + S.offY - (bb.min.y + bb.max.y) / 2, -bb.min.z);
    g.computeVertexNormals();
    g.computeBoundingBox();

    if (mesh) { mesh.geometry.dispose(); scene.remove(mesh); }
    mesh = new THREE.Mesh(g, okMat);
    mesh.material = fits() ? okMat : outMat;
    mesh.visible = visible;
    scene.add(mesh);
  }

  function fits() {
    if (!mesh) return true;
    const bb = mesh.geometry.boundingBox;
    if (bb.max.z > S.bedZ + EPS) return false;
    const { cx, cy } = bedCenter(), p = mesh.geometry.attributes.position.array;
    let r = 0;
    for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 1] - cy));
    return r <= S.bedX / 2 + EPS;
  }

  /** Rotate 90° about a world axis ('x' | 'y' | 'z'). */
  function rotate(axis) {
    const m = new THREE.Matrix4();
    if (axis === 'x') m.makeRotationX(Math.PI / 2);
    else if (axis === 'y') m.makeRotationY(Math.PI / 2);
    else m.makeRotationZ(Math.PI / 2);
    rotation.premultiply(m);
  }

  function resetRotation() { rotation.identity(); }

  /** Scale (%) that fits the current model into the build volume with 5 % XY margin, or null. */
  function fitScale() {
    if (!mesh) return null;
    const sz = new THREE.Vector3();
    mesh.geometry.boundingBox.getSize(sz);
    const lim = Math.min(S.bedX * 0.95 / Math.hypot(sz.x, sz.y), S.bedZ / sz.z);
    return Math.floor(S.scale / 100 * lim * 1000) / 10;
  }

  /** Summary for the UI, or null when nothing is loaded. */
  function info() {
    if (!mesh) return null;
    const size = new THREE.Vector3();
    mesh.geometry.boundingBox.getSize(size);
    return {
      name,
      size,
      triangles: mesh.geometry.attributes.position.count / 3,
      fits: fits(),
    };
  }

  return {
    load, rebuild, rotate, resetRotation, fitScale, info,
    get loaded() { return !!base; },
    /** Placed triangles (non-indexed, printer coordinates) for slicing, or null. */
    positions: () => mesh?.geometry.attributes.position.array ?? null,
    name: () => name,
    fits: () => fits(),
    setVisible(v) { if (mesh) mesh.visible = v; visible = v; },
    bounds: () => mesh?.geometry.boundingBox ?? null,
  };
}
