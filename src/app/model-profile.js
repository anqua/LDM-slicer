// A coarse silhouette of the loaded model for the zone editor: the largest distance from the axis in 60 height bins.

/** @returns { top, r: [radius per bin, bottom to top] } or null without a model */
export function modelProfile(model) {
  const pos = model.positions(), bb = model.bounds();
  if (!pos || !bb) return null;
  const top = bb.max.z, n = 60, r = new Float32Array(n), cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  for (let i = 0; i < pos.length; i += 3) {
    const b = Math.min(n - 1, Math.max(0, Math.floor(pos[i + 2] / top * n))), d = Math.hypot(pos[i] - cx, pos[i + 1] - cy);
    if (d > r[b]) r[b] = d;
  }
  for (let i = 1; i < n; i++) if (!r[i]) r[i] = r[i - 1];            // bins without a vertex take their neighbour
  for (let i = n - 2; i >= 0; i--) if (!r[i]) r[i] = r[i + 1];
  return { top, r: Array.from(r) };
}
