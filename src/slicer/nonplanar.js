// Non-planar slicing by height-field warping.
//
// The printed layers are not flat: layer k is the surface  z = z' + A·g(x,y)·w(z')  with z' = the layer's
// nominal height, g(x,y) a unit shape (wave, ripple, cone), A the amplitude and w(z') a smooth 0 → 1 ramp.
// w = 0 below the flat base, so the first layers sit flat on the bed.
//
// Method: (1) refine long mesh edges, (2) move every vertex to its warped height z' (the inverse of the map
// above), (3) slice that warped mesh with the ordinary planar engine, (4) map every toolpath point back,
// z = z' + A·g·w(z'), after cutting the paths into short steps so the z follows the surface.
// Walls, bottom, infill and the spiral engine all run unchanged in warped space.
//
// Layer thickness at a point is h·(1 + A·g·w'(z')). The ramp is at least 3·A tall so that factor stays
// within 0.5–1.5.
import { layerHeights, sliceMesh } from './slice.js';
import { buildToolpaths } from './paths.js';

const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The warp for settings `o`; `rmax` = largest distance of the model from the bed center (cone only). */
export function makeWarp(o, rmax = 100) {
  const A = o.npAmp, lam = Math.max(1, o.npLen);
  const th = (o.npAngle || 0) * Math.PI / 180, cx = Math.cos(th), cy = Math.sin(th);
  const k = 2 * Math.PI / lam;
  const g = o.npType === 'ripple' ? (x, y) => Math.sin(k * Math.hypot(x, y))
    : o.npType === 'cone' ? (x, y) => 1 - Math.min(1, Math.hypot(x, y) / Math.max(1, rmax))
    : (x, y) => Math.sin(k * (x * cx + y * cy));
  const z0 = Math.max(0, o.npBase), ramp = Math.max(3 * A, 1e-6);
  const w = zp => smooth((zp - z0) / ramp);
  const maxSlope = o.npType === 'cone' ? A / Math.max(1, rmax) : A * k;      // |∇ f|, rise per mm
  return {
    A, z0, ramp, maxSlope,
    /** actual height of the point (x, y) on the layer surface of nominal height zp */
    toWorld: (x, y, zp) => zp + A * g(x, y) * w(zp),
    /** nominal height of the layer surface through (x, y, z): solves zp + A·g·w(zp) = z by bisection */
    toLayer(x, y, z) {
      const a = A * g(x, y);
      if (a === 0 || z <= z0 - Math.abs(a)) return z;
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
function refine(pos, maxEdge, cap) {
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

/** Cut a polyline into steps of at most `step` mm in xy (z is carried along linearly). */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k < n; k++) { const t = k / n; out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    out.push(q);
  }
  return out;
}

/**
 * @param pos  triangle soup (world coordinates, z up, model on z = 0)
 * @param o    settings (S)
 * @returns    { tp, info } where tp has the shape of buildToolpaths() with real (curved) z, and
 *             info = { zMax, slopeDeg, ... } for warnings and G-code
 */
export function buildNonPlanar(pos, o) {
  let rmax = 1;
  for (let i = 0; i < pos.length; i += 3) rmax = Math.max(rmax, Math.hypot(pos[i], pos[i + 1]));
  const warp = makeWarp(o, rmax);
  const lam = o.npType === 'cone' ? 8 : o.npLen;

  // 1. Refine (edges ≈ wavelength / 10 keep the warp error near A/20), with a cap on the triangle count.
  let edge = Math.min(8, Math.max(1.5, lam / 10)), mesh = null;
  for (let tries = 0; tries < 6 && !mesh; tries++, edge *= 1.5) mesh = refine(pos, edge, 900000);
  if (!mesh) throw new Error('The mesh is too large to refine for non-planar slicing.');

  // 2. Warp vertices into layer space.
  let top = 0;
  for (let i = 0; i < mesh.length; i += 3) {
    const zp = warp.toLayer(mesh[i], mesh[i + 1], mesh[i + 2]);
    mesh[i + 2] = zp;
    if (zp > top) top = zp;
  }

  // 3. Planar slicing and toolpaths in layer space.
  const sliced = sliceMesh(mesh, layerHeights(top, o.firstLayerH || o.layerH, o.layerH), Math.max(0.02, o.lineW * 0.03));
  const tp = buildToolpaths(sliced, o);

  // 4. Back to real space.
  const step = Math.max(0.5, Math.min(1.5, lam / 25));
  let zMax = 0, zMin = Infinity;
  for (const l of tp.layers) for (const p of l.paths) {
    p.pts = densify(p.pts, step).map(([x, y, zp]) => {
      const z = warp.toWorld(x, y, zp);
      if (z > zMax) zMax = z;
      if (z < zMin) zMin = z;
      return [x, y, z];
    });
  }

  const slopeDeg = Math.atan(warp.maxSlope) * 180 / Math.PI;
  if (slopeDeg > 30) tp.warnings.push(`Steepest layer slope is ${slopeDeg.toFixed(0)}°. Above about 30° the nozzle body may touch the print. Lower the amplitude or lengthen the wavelength.`);
  if (zMax > o.bedZ) tp.warnings.push(`The print reaches Z ${zMax.toFixed(0)} mm, above the ${o.bedZ} mm build height.`);
  return { tp, info: { zMax, zMin, slopeDeg, ramp: warp.ramp, base: warp.z0, triangles: mesh.length / 9 } };
}
