// Renderer, scene, lights, camera rig and render loop.
import * as THREE from 'three';
import { cssVar } from '../core/theme.js';
import { createCameraRig } from './camera-rig.js';

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cssVar('scene-bg'));

  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2c22, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-300, -500, 800);
  const fill = new THREE.DirectionalLight(0xffd9c0, 0.5);
  fill.position.set(400, 300, 200);
  scene.add(sun, fill);

  const rig = createCameraRig(renderer.domElement);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // Per-frame callbacks get the elapsed time in seconds (capped, so a background tab doesn't jump).
  const frameFns = new Set();
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const fn of frameFns) fn(dt);
    rig.controls.update();
    renderer.render(scene, rig.camera);
  });

  return { renderer, scene, rig, onFrame: fn => frameFns.add(fn) };
}
