// Height-field warp for curved layers (non-planar slicing), used by the non-standard engine.
//
// The printed layers are not flat: layer k is the surface  z = z' + A·g(x,y)·w(z')  with z' = the layer's
// nominal height ("layer space"), g(x,y) a unit shape (wave, ripple, cone), A the amplitude and w(z') a smooth
// 0 → 1 ramp. w = 0 below the flat base, so the first layers sit flat on the bed.
// To slice such layers, the mesh is moved into layer space (every vertex z -> z'), where the layers are flat
// planes again; the paths found there are mapped back with z = z' + A·g·w(z').
//
// Layer thickness at a point is h·(1 + A·g·w'(z')). The ramp is at least 3·A tall so that factor stays
// within 0.5–1.5.

const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The warp for settings `o`; `rmax` = largest distance of the model from the axis (cone only). */
/** @param env  optional envelope zp -> 0..1 replacing the default ramps (zones: one rising and falling ramp per curved zone) */
export function makeWarp(o, rmax = 100, top = Infinity, env = null) {
  const z0 = Math.max(0, o.npBase);
  // The effect ramps in above the flat base and back out below the top, so the rim is flat and the last layers
  // are not cut into short sideways arcs. Both ramps are 3·A tall; on a short model A is reduced to fit.
  const fitA = Number.isFinite(top) ? Math.max(0.1, (top - z0) / 6) : Infinity;
  const A = Math.min(o.npAmp, fitA), lam = Math.max(1, o.npLen);
  const th = (o.npAngle || 0) * Math.PI / 180, cx = Math.cos(th), cy = Math.sin(th);
  const k = 2 * Math.PI / lam;
  const g = o.npType === 'ripple' ? (x, y) => Math.sin(k * Math.hypot(x, y))
    : o.npType === 'cone' ? (x, y) => 1 - Math.min(1, Math.hypot(x, y) / Math.max(1, rmax))
    : (x, y) => Math.sin(k * (x * cx + y * cy));
  const ramp = Math.max(3 * A, 1e-6);
  const w = env ?? (zp => smooth((zp - z0) / ramp) * (1 - smooth((zp - (top - ramp)) / ramp)));   // 0 at the base and at the top
  const maxSlope = o.npType === 'cone' ? A / Math.max(1, rmax) : A * k;      // steepest rise per mm
  return {
    A, z0, ramp, maxSlope, reduced: A < o.npAmp,
    /** actual height of the point (x, y) on the layer surface of nominal height zp */
    toWorld: (x, y, zp) => zp + A * g(x, y) * w(zp),
    /** local layer spacing at (x, y), relative to the nominal layer height `rise` (= dz_world / dz_layer) */
    kappa: (x, y, zp, rise) => 1 + A * g(x, y) * (w(zp) - w(zp - rise)) / rise,
    /** nominal height of the layer surface through (x, y, z): solves zp + A·g·w(zp) = z by bisection */
    toLayer(x, y, z) {
      const a = A * g(x, y);
      if (a === 0 || z <= z0) return z;
      let lo = z - Math.abs(a) - 1e-9, hi = z + Math.abs(a) + 1e-9;
      for (let i = 0; i < 34; i++) {
        const mid = (lo + hi) / 2;
        if (mid + a * w(mid) < z) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    },
  };
}

/** Split every edge longer than `maxEdge` at its midpoint (conforming: the decision depends on the edge alone). */
export function refine(pos, maxEdge, cap) {
  let cur = Array.from(pos);
  const lt = (p, i, q, j) => p[i] < q[j] || (p[i] === q[j] && (p[i + 1] < q[j + 1] || (p[i + 1] === q[j + 1] && p[i + 2] < q[j + 2])));
  const mid = (p, i, j) => {                                  // midpoint from the canonically ordered end points
    let a = i, b = j;
    if (lt(p, b, p, a)) [a, b] = [b, a];
    return [(p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2, (p[a + 2] + p[b + 2]) / 2];
  };
  const long = (p, i, j) => {
    let a = i, b = j;
    if (lt(p, b, p, a)) [a, b] = [b, a];
    return Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]) > maxEdge;
  };
  for (let pass = 0; pass < 12; pass++) {
    const out = [];
    let changed = false;
    const tri = (...v) => { for (const q of v) out.push(q[0], q[1], q[2]); };
    for (let t = 0; t < cur.length; t += 9) {
      const A = [cur[t], cur[t + 1], cur[t + 2]], B = [cur[t + 3], cur[t + 4], cur[t + 5]], C = [cur[t + 6], cur[t + 7], cur[t + 8]];
      const s = [long(cur, t, t + 3), long(cur, t + 3, t + 6), long(cur, t + 6, t)];   // ab, bc, ca
      const n = s[0] + s[1] + s[2];
      if (!n) { out.push(...A, ...B, ...C); continue; }
      changed = true;
      const mab = mid(cur, t, t + 3), mbc = mid(cur, t + 3, t + 6), mca = mid(cur, t + 6, t);
      if (n === 3) { tri(A, mab, mca); tri(mab, B, mbc); tri(mca, mbc, C); tri(mab, mbc, mca); }
      else if (n === 1) {
        if (s[0]) { tri(A, mab, C); tri(mab, B, C); }
        else if (s[1]) { tri(B, mbc, A); tri(mbc, C, A); }
        else { tri(C, mca, B); tri(mca, A, B); }
      } else {                                               // two split edges: rotate so the plain edge is last
        const [P, Q, R, m1, m2] = !s[2] ? [A, B, C, mab, mbc] : !s[0] ? [B, C, A, mbc, mca] : [C, A, B, mca, mab];
        tri(m1, Q, m2);
        const d1 = Math.hypot(P[0] - m2[0], P[1] - m2[1], P[2] - m2[2]), d2 = Math.hypot(m1[0] - R[0], m1[1] - R[1], m1[2] - R[2]);
        if (d1 <= d2) { tri(P, m1, m2); tri(P, m2, R); } else { tri(P, m1, R); tri(m1, m2, R); }
      }
      if (out.length / 9 > cap) return null;
    }
    cur = out;
    if (!changed) break;
  }
  return Float64Array.from(cur);
}

/**
 * Refine `pos` and move its vertices into layer space. Returns { mesh, top } (top = highest layer-space z).
 * Edges of about wavelength / 10 keep the warp error near A/20; the triangle count is capped.
 */
export function warpMesh(pos, warp, wavelength) {
  let edge = Math.min(8, Math.max(1.5, wavelength / 10)), mesh = null;
  for (let tries = 0; tries < 6 && !mesh; tries++, edge *= 1.5) mesh = refine(pos, edge, 900000);
  if (!mesh) throw new Error('The mesh is too large to refine for non-planar slicing.');
  let top = 0;
  for (let i = 0; i < mesh.length; i += 3) {
    const zp = warp.toLayer(mesh[i], mesh[i + 1], mesh[i + 2]);
    mesh[i + 2] = zp;
    if (zp > top) top = zp;
  }
  return { mesh, top };
}
