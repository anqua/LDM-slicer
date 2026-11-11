// Mesh -> layer contours. Cuts the triangle soup with horizontal planes and chains the
// resulting segments into closed loops, oriented outer = CCW, holes = CW.
import { area, contains, simplify } from './polygon.js';

/** Layer heights: first layer, then regular layers, until the top of the model. */
export function layerHeights(top, firstH, layerH) {
  const out = [];
  let z = Math.min(firstH, top);
  out.push({ z, h: z });
  while (z + layerH * 0.5 < top) {
    const nz = Math.min(z + layerH, top);
    out.push({ z: nz, h: nz - z });
    z = nz;
  }
  return out;
}

/**
 * @param pos     Float32Array of non-indexed triangle positions (world coords, z up, model on z = 0)
 * @param layers  [{ z, h }] from layerHeights()
 * @param tol     simplification tolerance in mm
 * @returns       [{ z, h, loops: [[ [x,y], ... ], ...] }]
 */
export function sliceMesh(pos, layers, tol = 0.05) {
  const nTri = pos.length / 9;
  // Cut at the middle of each layer. Bucket triangles by the layers they span.
  const cuts = layers.map(l => l.z - l.h / 2);
  const buckets = layers.map(() => []);
  const firstAbove = z => {                              // first cut index with cuts[i] > z
    let lo = 0, hi = cuts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m] > z) hi = m; else lo = m + 1; }
    return lo;
  };
  for (let t = 0; t < nTri; t++) {
    const o = t * 9, z0 = pos[o + 2], z1 = pos[o + 5], z2 = pos[o + 8];
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    if (hi - lo < 1e-9) continue;                        // flat triangle, never cut
    for (let i = firstAbove(lo); i < cuts.length && cuts[i] < hi; i++) buckets[i].push(t);
  }

  return layers.map((l, i) => {
    const zc = cuts[i] + 1e-5;                           // nudge off exact vertex heights
    const segs = [];
    for (const t of buckets[i]) {
      const o = t * 9, pts = [];
      for (let e = 0; e < 3; e++) {
        let a = o + e * 3, b = o + ((e + 1) % 3) * 3;
        // Order the edge's vertices canonically so neighbours compute the exact same point.
        if (pos[a] > pos[b] || (pos[a] === pos[b] && (pos[a + 1] > pos[b + 1] || (pos[a + 1] === pos[b + 1] && pos[a + 2] > pos[b + 2])))) [a, b] = [b, a];
        const za = pos[a + 2], zb = pos[b + 2];
        if ((za < zc) === (zb < zc)) continue;
        const s = (zc - za) / (zb - za);
        pts.push([pos[a] + (pos[b] - pos[a]) * s, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * s]);
      }
      if (pts.length === 2) segs.push(pts);
    }
    return { z: l.z, h: l.h, loops: chain(segs, tol) };
  });
}

const key = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;

/** Join segments that share endpoints into closed loops and orient them. */
function chain(segs, tol) {
  const at = new Map();                                  // point key -> segment indices
  const add = (k, i) => { const l = at.get(k); l ? l.push(i) : at.set(k, [i]); };
  segs.forEach((s, i) => { add(key(s[0]), i); add(key(s[1]), i); });
  const used = new Uint8Array(segs.length);
  const loops = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0]];
    let cur = segs[i][1];
    const startKey = key(segs[i][0]);
    for (let guard = 0; guard < segs.length; guard++) {
      const k = key(cur);
      if (k === startKey) break;
      loop.push(cur);
      const next = (at.get(k) || []).find(j => !used[j]);
      if (next === undefined) break;                     // open chain (non-manifold mesh): keep what we have
      used[next] = 1;
      const s = segs[next];
      cur = key(s[0]) === k ? s[1] : s[0];
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // Simplify, drop slivers, then orient by nesting depth: even = outer (CCW), odd = hole (CW).
  const clean = loops.map(l => simplify(l, tol)).filter(l => l.length >= 3 && Math.abs(area(l)) > tol * tol * 4);
  return clean.map(l => {
    const depth = clean.reduce((d, o) => d + (o !== l && contains(o, l[0]) ? 1 : 0), 0);
    const ccw = area(l) > 0, wantCCW = depth % 2 === 0;
    return ccw === wantCCW ? l : l.reverse();
  });
}
