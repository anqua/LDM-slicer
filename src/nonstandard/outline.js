// The outline of the part, measured in polar form around its vertical axis (step 1 of the non-standard engine).
//
// Instead of cutting the mesh into closed contours and chaining them (as the standard slicer does), the engine measures,
// for every layer surface and every angle, the outermost radius where the mesh crosses it: one radius per angle per layer.
// Holes in the mesh just leave an angle unmeasured and are bridged. This assumes cross-sections that are star-shaped
// around the axis (vases, pots, cups, bowls, lamp shades): handles, inner cavities and separate parts are ignored.
// All layers share the angular parametrisation (s = 0 at the seam angle, S.seamAngle, counter-clockwise), so blending two layers is an interpolation.
import { TAU } from './styles.js';

/** First layer, then regular layers up to `top`: [{ z, h }], z = top of the layer. */
export function layerList(top, firstH, h) {
  const out = [];
  let z = Math.min(firstH, top);
  out.push({ z, h: z });
  while (z + h * 0.5 < top) { const nz = Math.min(z + h, top); out.push({ z: nz, h: nz - z }); z = nz; }
  return out;
}

/** Fraction of a turn at which a point lies around the axis: 0 at the seam direction a0 (radians, 0 = +X, pi/2 = +Y), counter-clockwise, in [0, 1). */
const fraction = (x, y, a0) => { const s = (Math.atan2(y, x) - a0) / TAU; return s - Math.floor(s); };

/**
 * Outermost radius per angle (N bins) for each layer surface (cut at mid layer). null = nothing measured.
 * Every triangle crossing a layer plane gives a short segment; its points are binned by angle.
 */
export function radialProfiles(mesh, layers, cx, cy, N, a0 = Math.PI / 2) {
  const cuts = layers.map(l => l.z - l.h / 2 + 1e-5);
  const prof = layers.map(() => new Float32Array(N).fill(-1));
  const firstAbove = z => { let lo = 0, hi = cuts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m] > z) hi = m; else lo = m + 1; } return lo; };
  const mark = (P, x0, y0, x1, y1) => {
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25));
    for (let i = 0; i <= m; i++) {
      const x = x0 + (x1 - x0) * i / m - cx, y = y0 + (y1 - y0) * i / m - cy, r = Math.hypot(x, y);
      if (r < 1e-6) continue;
      const j = Math.min(N - 1, Math.floor(fraction(x, y, a0) * N));
      if (r > P[j]) P[j] = r;
    }
  };
  for (let t = 0; t < mesh.length; t += 9) {
    const z0 = mesh[t + 2], z1 = mesh[t + 5], z2 = mesh[t + 8];
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    if (hi - lo < 1e-9) continue;
    for (let k = firstAbove(lo); k < cuts.length && cuts[k] < hi; k++) {
      const zc = cuts[k], pts = [];
      for (let e = 0; e < 3; e++) {
        const a = t + e * 3, b = t + ((e + 1) % 3) * 3, za = mesh[a + 2], zb = mesh[b + 2];
        if ((za < zc) === (zb < zc)) continue;
        const s = (zc - za) / (zb - za);
        pts.push(mesh[a] + (mesh[b] - mesh[a]) * s, mesh[a + 1] + (mesh[b + 1] - mesh[a + 1]) * s);
      }
      if (pts.length === 4) mark(prof[k], pts[0], pts[1], pts[2], pts[3]);
    }
  }
  return prof.map(P => {
    const have = []; for (let j = 0; j < N; j++) if (P[j] >= 0) have.push(j);
    if (!have.length) return null;
    for (let h = 0; h < have.length; h++) {            // bridge unmeasured angles (holes in the mesh) linearly
      const a = have[h], b = have[(h + 1) % have.length];
      const gap = (b - a + N) % N || N;
      for (let g = 1; g < gap; g++) P[(a + g) % N] = P[a] + (P[b] - P[a]) * g / gap;
    }
    const Q = new Float32Array(N);                      // light smoothing: removes the bin staircase
    for (let j = 0; j < N; j++) Q[j] = 0.25 * P[(j + N - 1) % N] + 0.5 * P[j] + 0.25 * P[(j + 1) % N];
    return Q;
  });
}

/** Closed outline (N points, counter-clockwise, starting at the seam direction a0) of a radius profile. */
export function ringOf(P, cx, cy, a0 = Math.PI / 2) {
  const N = P.length;
  return Array.from({ length: N }, (_, j) => { const a = a0 + TAU * j / N; return [cx + P[j] * Math.cos(a), cy + P[j] * Math.sin(a)]; });
}

/** Move every point `d` mm along the inward normal (d < 0: outward). */
export function offsetRing(R, d) {
  const N = R.length;
  return R.map((p, j) => {
    const a = R[(j + N - 1) % N], b = R[(j + 1) % N], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [p[0] - d * ty / l, p[1] + d * tx / l];          // outward normal of a counter-clockwise ring = (ty, -tx)/l
  });
}

export const ringLength = R => { let L = 0; for (let j = 0; j < R.length; j++) { const a = R[j], b = R[(j + 1) % R.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };

/** Point at fraction s (any real; wraps) of a ring, linearly interpolated. */
export function sample(R, s) {
  const N = R.length, f = (s - Math.floor(s)) * N, j = Math.floor(f), t = f - j;
  const a = R[j % N], b = R[(j + 1) % N];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Cut a polyline of [x, y, z] into steps of at most `step` mm in xy. */
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 1; k <= n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n, p[2] + (q[2] - p[2]) * k / n]);
  }
  return out;
}
