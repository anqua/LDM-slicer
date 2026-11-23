// Mesh -> layer contours. Cuts the triangle soup with horizontal planes and chains the
// resulting segments into closed loops, oriented outer = CCW, holes = CW.
import { area, contains, simplify } from './polygon.js';

/** Layer heights: first layer, then regular layers, until the top of the model. */
export function layerHeights(top, firstH, layerH) {
  layerH = Math.max(0.05, layerH || 0);                 // a zero or negative height would never reach the top
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
    const stats = {};
    const loops = chain(segs, tol, stats);
    return { z: l.z, h: l.h, loops, gaps: stats.gaps ?? 0, open: stats.open ?? 0 };
  });
}

const key = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;

/** Largest gap (mm) between two open ends that is still treated as a hole in the mesh and closed. */
const MAX_GAP = 8;

/**
 * Join segments that share endpoints into closed loops and orient them.
 * A watertight mesh gives only closed loops. A mesh with missing triangles gives open chains: they are
 * walked in both directions (so a chain is never torn in two at the segment we happened to start from),
 * then open ends closer than MAX_GAP are joined to each other, nearest first, which closes the hole.
 * `stats.gaps` counts the gaps closed that way and `stats.open` the chains that stayed open.
 */
function chain(segs, tol, stats = {}) {
  const at = new Map();                                  // point key -> segment indices
  const add = (k, i) => { const l = at.get(k); l ? l.push(i) : at.set(k, [i]); };
  segs.forEach((s, i) => { add(key(s[0]), i); add(key(s[1]), i); });
  const used = new Uint8Array(segs.length);
  const take = k => { const j = (at.get(k) || []).find(x => !used[x]); if (j === undefined) return null; used[j] = 1; return j; };
  const other = (j, k) => (key(segs[j][0]) === k ? segs[j][1] : segs[j][0]);
  const closedLoops = [], openChains = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const startKey = key(segs[i][0]);
    const fwd = [];
    let head = segs[i][1], closed = false;
    for (let guard = 0; guard <= segs.length; guard++) {          // forward from the segment's end
      const k = key(head);
      if (k === startKey) { closed = true; break; }
      const j = take(k);
      if (j === null) break;
      fwd.push(head);
      head = other(j, k);
    }
    if (closed) { closedLoops.push([segs[i][0], ...fwd]); continue; }
    fwd.push(head);
    const bwd = [];
    let tail = segs[i][0];
    for (let guard = 0; guard <= segs.length; guard++) {          // and backward from its start
      const k = key(tail);
      const j = take(k);
      if (j === null) break;
      tail = other(j, k);
      bwd.push(tail);
    }
    openChains.push([...bwd.reverse(), segs[i][0], ...fwd]);
  }

  // Close holes: repeatedly join the two nearest open ends (any orientation) that are within MAX_GAP.
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let chains = openChains;
  const tooBroken = chains.length > 150;                          // the search below is quadratic: skip it for hopeless meshes
  for (let guard = 0; guard < 10000 && chains.length && !tooBroken; guard++) {
    let best = null;
    for (let a = 0; a < chains.length; a++) {
      const A = chains[a];
      const selfGap = d(A[0], A.at(-1));                          // a chain whose own ends nearly meet closes on itself
      if (A.length >= 3 && selfGap <= MAX_GAP && (!best || selfGap < best.gap)) best = { a, b: a, gap: selfGap, flipA: false, flipB: false };
      for (let b = a + 1; b < chains.length; b++) {
        const B = chains[b];
        for (const flipA of [false, true]) for (const flipB of [false, true]) {
          const gap = d(flipA ? A[0] : A.at(-1), flipB ? B.at(-1) : B[0]);   // A's (possibly reversed) end to B's (possibly reversed) start
          if (gap <= MAX_GAP && (!best || gap < best.gap)) best = { a, b, gap, flipA, flipB };
        }
      }
    }
    if (!best) break;
    stats.gaps = (stats.gaps ?? 0) + 1;
    if (best.a === best.b) { closedLoops.push(chains[best.a]); chains = chains.filter((_, i) => i !== best.a); continue; }
    const A = best.flipA ? [...chains[best.a]].reverse() : chains[best.a];
    const B = best.flipB ? [...chains[best.b]].reverse() : chains[best.b];
    chains = [...chains.filter((_, i) => i !== best.a && i !== best.b), [...A, ...B]];
  }
  stats.open = (stats.open ?? 0) + chains.filter(c => c.length >= 3 && Math.abs(area(c)) > tol * tol * 4).length;
  const loops = [...closedLoops, ...chains].filter(l => l.length >= 3);   // what is still open is closed by its chord

  // Simplify, drop slivers, then orient by nesting depth: even = outer (CCW), odd = hole (CW).
  const clean = loops.map(l => simplify(l, tol)).filter(l => l.length >= 3 && Math.abs(area(l)) > tol * tol * 4);
  return clean.map(l => {
    const depth = clean.reduce((d, o) => d + (o !== l && contains(o, l[0]) ? 1 : 0), 0);
    const ccw = area(l) > 0, wantCCW = depth % 2 === 0;
    return ccw === wantCCW ? l : l.reverse();
  });
}
