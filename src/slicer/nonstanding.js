// "Non-standing slice": printing that does not stack flat layers. Three styles:
//   curved  curved layers following a height field (nonplanar.js)
//   ruffle  the wall waves up and down (and in and out) as it goes round, every layer repeating the one below:
//           a ruffled, scalloped wall
//   loops   the wall path makes small looping curls (a prolate trochoid in the plane of the tangent and the
//           vertical) between two heights: a coiled, woven surface
// ruffle and loops work on the walls of an ordinary planar slice and move the path points afterwards.
import { layerHeights, sliceMesh } from './slice.js';
import { buildToolpaths } from './paths.js';
import { buildNonPlanar } from './nonplanar.js';

const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const WALLS = new Set(['outer', 'inner', 'spiral']);

/** Arc-length sampler for a polyline: at(u) -> [x, y, z] (u clamped to [0, L]). */
function sampler(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum.at(-1);
  const at = u => {
    u = Math.min(L, Math.max(0, u));
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
    const a = pts[lo - 1], b = pts[lo], d = cum[lo] - cum[lo - 1], t = d > 0 ? (u - cum[lo - 1]) / d : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  return { L, at };
}

/**
 * Re-draw the wall paths of every layer. `shape(u, L, layerIdx, p0)` -> { u, dz, dn } gives, for a point at
 * arc length u of a path of length L: the arc length to sample the original path at, the extra height, and the
 * offset along the outward normal (away from the material).
 */
function reshapeWalls(tp, stepOf, shape) {
  let zMax = 0;
  tp.layers.forEach((layer, li) => {
    for (const p of layer.paths) {
      if (!WALLS.has(p.type) || p.pts.length < 2) continue;
      const { L, at } = sampler(p.pts);
      if (L < 1) continue;
      const first = p.pts[0], last = p.pts.at(-1);
      const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
      const m = Math.max(4, Math.ceil(L / stepOf(L)));
      const out = [];
      for (let k = 0; k <= m; k++) {
        const u = L * k / m;
        const s = shape(u, L, li, p);
        const su = closed ? ((s.u % L) + L) % L : s.u;
        const q = at(su);
        let x = q[0], y = q[1];
        if (s.dn) {                                    // outward normal = right of the direction of travel
          const a = at(su - 0.25), b = at(su + 0.25), tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
          x += s.dn * ty / tl; y -= s.dn * tx / tl;
        }
        const z = q[2] + (s.dz || 0);
        if (z > zMax) zMax = z;
        out.push([x, y, z]);
      }
      out[0] = [...first.slice(0, 2), first[2] + (shape(0, L, li, p).dz || 0)];    // exact ends keep joined turns joined
      out[m] = [...last.slice(0, 2), last[2] + (shape(L, L, li, p).dz || 0)];
      p.pts = out;
    }
  });
  return zMax;
}

/** Style 'ruffle'. */
function ruffle(tp, o) {
  const a = o.rfAmp, b = o.rfRadial, lam = Math.max(4, o.rfLen), shift = (o.rfShift || 0) * Math.PI / 180;
  const z0 = Math.max(0, o.npBase), ramp = Math.max(3 * a, 3 * Math.abs(b), 1e-6);   // thickness stays within 50-150 %
  return reshapeWalls(tp, L => Math.min(2, Math.max(0.5, lam / 16)), (u, L, li, p) => {
    const n = Math.max(1, Math.round(L / lam));
    const w = smooth(((p.pts[0][2]) - z0) / ramp);
    const ph = 2 * Math.PI * n * u / L + (p.type === 'spiral' ? 0 : li * shift);    // spiral turns must join, so no shift
    const s = Math.sin(ph);
    return { u, dz: a * w * s, dn: b * w * s };
  });
}

/** Style 'loops'. */
function loops(tp, o, top) {
  const r = Math.max(0.3, o.lpSize / 2), zr = Math.min(r, o.layerH * 1.2);   // loops stay flat enough for the next layer to clear
  const pitch = Math.min(Math.max(1, o.lpSpacing), 5.5 * r);                 // pitch < 2π·r, or no loop forms
  const from = top * o.lpFrom / 100, to = top * o.lpTo / 100;
  return reshapeWalls(tp, () => Math.min(0.5, pitch / 20), (u, L, li, p) => {
    const z = p.pts[0][2];
    if (z < from || z > to) return { u };
    const n = Math.max(1, Math.round(L / pitch)), ph = 2 * Math.PI * n * u / L;
    return { u: u - r * Math.sin(ph), dz: zr * (1 - Math.cos(ph)) };
  });
}

/**
 * @param pos  triangle soup (world, z up)
 * @param o    settings (S)
 * @param top  model height
 * @returns { tp, zMax, hop, note }  hop = z-hop that clears the surface texture on travel moves
 */
export function buildNonStanding(pos, o, top) {
  if (o.npMode === 'curved') {
    const r = buildNonPlanar(pos, o);
    return { tp: r.tp, zMax: r.info.zMax, hop: 2 * o.npAmp + 1,
      note: `Non-standing slice, curved layers: ${o.npType}, amplitude ${o.npAmp} mm, wavelength ${o.npLen} mm, direction ${o.npAngle}°, flat base ${o.npBase} mm` };
  }
  const sliced = sliceMesh(pos, layerHeights(top, o.firstLayerH || o.layerH, o.layerH), Math.max(0.02, o.lineW * 0.03));
  const tp = buildToolpaths(sliced, o);
  if (o.npMode === 'ruffle') {
    const zMax = ruffle(tp, o);
    if (o.infill !== 'none' && o.mode !== 'spiral') tp.warnings.push('Ruffled walls: the infill stays flat.');
    return { tp, zMax: Math.max(zMax, top), hop: 2 * (o.rfAmp + Math.abs(o.rfRadial)) + 1,
      note: `Non-standing slice, ruffled wall: amplitude ${o.rfAmp} mm, wavelength ${o.rfLen} mm, in/out ${o.rfRadial} mm, shift ${o.rfShift}°/layer, flat base ${o.npBase} mm` };
  }
  const zMax = loops(tp, o, top);
  const r = Math.max(0.3, o.lpSize / 2);
  if (o.lpSpacing > 5.5 * r) tp.warnings.push(`Loop spacing reduced to ${(5.5 * r).toFixed(1)} mm so the path forms loops at this size.`);
  return { tp, zMax: Math.max(zMax, top), hop: 2 * Math.min(r, o.layerH * 1.2) + 1,
    note: `Non-standing slice, loop texture: loop Ø ${o.lpSize} mm, spacing ${o.lpSpacing} mm, from ${o.lpFrom} % to ${o.lpTo} % of the height` };
}
