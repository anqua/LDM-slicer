// Procedural demo: a wavy, slightly twisted vase. Closed, watertight, indexed mesh.
import * as THREE from 'three';

export function demoVaseGeometry({ height = 180, segments = 120, rings = 90 } = {}) {
  const H = height, N = segments, R = rings, pos = [], idx = [];
  const radius = (z, t) => 45 + 18 * Math.sin(z / H * Math.PI * 1.15 + 0.3) + 3.5 * Math.sin(8 * t + z * 0.035);

  for (let j = 0; j <= R; j++) {
    const z = j / R * H;
    for (let i = 0; i < N; i++) {
      const t = i / N * Math.PI * 2, r = radius(z, t);
      pos.push(r * Math.cos(t), r * Math.sin(t), z);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, b = j * N + (i + 1) % N, c = a + N, d = b + N;
    idx.push(a, b, d, a, d, c);
  }
  // Caps: center vertex + triangle fan at bottom and top.
  const bot = pos.length / 3; pos.push(0, 0, 0);
  const top = bot + 1;        pos.push(0, 0, H);
  for (let i = 0; i < N; i++) {
    idx.push(bot, (i + 1) % N, i);
    idx.push(top, R * N + i, R * N + (i + 1) % N);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
