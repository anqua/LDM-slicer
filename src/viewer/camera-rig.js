// Perspective + orthographic cameras sharing one OrbitControls. Z is up (printer convention).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createCameraRig(domElement) {
  // near = 5 mm: a larger near/far ratio costs depth precision, and thin features (bed plate, grid) need it.
  const persp = new THREE.PerspectiveCamera(40, 1, 5, 20000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
  persp.up.set(0, 0, 1);
  ortho.up.set(0, 0, 1);

  let camera = persp;
  let aspect = 1;
  let orthoHalfH = 200;            // ortho half-height in mm at zoom 1
  const listeners = new Set();

  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;

  const tanHalfFov = () => Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));

  function updateOrthoFrustum() {
    Object.assign(ortho, { left: -orthoHalfH * aspect, right: orthoHalfH * aspect, top: orthoHalfH, bottom: -orthoHalfH });
    ortho.updateProjectionMatrix();
  }

  function resize(width, height) {
    aspect = width / Math.max(height, 1);
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    updateOrthoFrustum();
  }

  /** Switch projection, keeping the apparent size at the orbit target. kind: 'persp' | 'ortho' */
  function setProjection(kind) {
    const target = controls.target;
    if (kind === 'ortho' && camera !== ortho) {
      orthoHalfH = persp.position.distanceTo(target) * tanHalfFov();
      ortho.position.copy(persp.position);
      ortho.quaternion.copy(persp.quaternion);
      ortho.zoom = 1;
      updateOrthoFrustum();
      camera = ortho;
    } else if (kind === 'persp' && camera !== persp) {
      const halfH = orthoHalfH / ortho.zoom;
      const dir = new THREE.Vector3().subVectors(ortho.position, target).normalize();
      persp.position.copy(target).addScaledVector(dir, halfH / tanHalfFov());
      persp.quaternion.copy(ortho.quaternion);
      camera = persp;
    }
    controls.object = camera;
    controls.update();
    for (const fn of listeners) fn(projection());
  }

  const projection = () => (camera === ortho ? 'ortho' : 'persp');

  /** Frame a target. view: 'iso' | 'top' | 'front'; t: { cx, cy, tz, r } (center and radius in mm). */
  function frame(view, { cx, cy, tz, r }) {
    controls.target.set(cx, cy, tz);
    const d = r * 2.4;
    if (view === 'top') camera.position.set(cx, cy - 0.001, tz + d);
    else if (view === 'front') camera.position.set(cx, cy - d, tz);
    else camera.position.set(cx + d * 0.55, cy - d * 0.8, tz + d * 0.55);
    if (camera === ortho) {        // match the framing the perspective camera would have
      orthoHalfH = camera.position.distanceTo(controls.target) * tanHalfFov();
      ortho.zoom = 1;
      updateOrthoFrustum();
    }
    controls.update();
  }

  /** Zoom extents: center the camera on a box (THREE.Box3) and back off until all of it fits, keeping the viewing direction. */
  function zoomExtents(box) {
    if (!box || box.isEmpty()) return false;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1) * 1.1;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0.55, -0.8, 0.55);
    dir.normalize();
    controls.target.copy(c);
    if (camera === ortho) {
      orthoHalfH = Math.max(r, r / aspect);          // the sphere must fit the narrower side
      ortho.zoom = 1;
      updateOrthoFrustum();
      camera.position.copy(c).addScaledVector(dir, r * 4);
    } else {
      const half = Math.min(THREE.MathUtils.degToRad(persp.fov / 2), Math.atan(tanHalfFov() * aspect));
      camera.position.copy(c).addScaledVector(dir, r / Math.sin(half));
    }
    controls.update();
    return true;
  }

  return {
    get camera() { return camera; },
    controls,
    resize,
    frame,
    zoomExtents,
    projection,
    setProjection,
    toggleProjection: () => setProjection(projection() === 'ortho' ? 'persp' : 'ortho'),
    onProjectionChange: fn => listeners.add(fn),
  };
}
