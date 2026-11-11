// Layer contours -> printable toolpaths: priming loops (skirt), walls, solid bottom, spiral vase.
//
// Output: { layers: [{ z, h, paths: [Path] }], warnings: [string] }
// Path:   { type: 'skirt'|'outer'|'inner'|'bottom'|'spiral', pts: [[x, y, z], ...], h, speed, join? }
// `join: true` means the path continues straight on from the previous one (spiral vase):
// no travel, no safe end / safe start in between.
import { area, contains, offset, startAt, nearestIndex, convexHull, grow, length } from './polygon.js';

/** Group a layer's loops into islands: one outer (CCW) loop plus the holes directly inside it. */
function islands(loops) {
  const outers = loops.filter(l => area(l) > 0).sort((a, b) => area(a) - area(b));   // smallest first
  const holes = loops.filter(l => area(l) < 0);
  const out = outers.map(o => ({ outer: o, holes: [] }));
  for (const h of holes) {
    const owner = out.find(i => contains(i.outer, h[0]));     // smallest enclosing outer
    if (owner) owner.holes.push(h);
  }
  return out;
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Pick the seam vertex of a closed loop and return it as an open polyline that returns to its start. */
function seamLoop(loop, seam, pos, rng) {
  let i;
  if (seam === 'nearest' && pos) i = nearestIndex(loop, pos[0], pos[1]);
  else if (seam === 'random') i = Math.floor(rng() * loop.length);
  else { i = 0; for (let k = 1; k < loop.length; k++) if (loop[k][1] > loop[i][1]) i = k; }   // rear = max Y
  const l = startAt(loop, i);
  return [...l, l[0]];
}

/** Scanline fill of the region bounded by `polys` (even-odd), lines at `angle` degrees, spaced `gap`. */
function fillLines(polys, angle, gap) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = ([x, y]) => [x * c + y * s, -x * s + y * c];        // world -> scan frame
  const back = ([x, y]) => [x * c - y * s, x * s + y * c];
  const rp = polys.map(p => p.map(rot));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of rp) for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const segs = [];
  for (let y = y0 + gap / 2; y < y1; y += gap) {
    const xs = [];
    for (const p of rp) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > gap * 0.3) segs.push([back([xs[k], y]), back([xs[k + 1], y])]);
  }
  return segs;
}

/** Order fill segments greedily from `pos`, joining near neighbours into zig-zag polylines. */
function orderFill(segs, pos, joinDist) {
  const left = [...segs], out = [];
  let cur = pos ?? segs[0]?.[0], line = null;
  while (left.length) {
    let best = 0, bd = Infinity, flip = false;
    for (let i = 0; i < left.length; i++) {
      const d0 = dist2(cur, left[i][0]), d1 = dist2(cur, left[i][1]);
      if (d0 < bd) { bd = d0; best = i; flip = false; }
      if (d1 < bd) { bd = d1; best = i; flip = true; }
    }
    const [sg] = left.splice(best, 1);
    const [p, q] = flip ? [sg[1], sg[0]] : sg;
    if (line && Math.sqrt(bd) <= joinDist) line.push(p, q);
    else { line = [p, q]; out.push(line); }
    cur = q;
  }
  return out;
}

/** Walls and (optionally) solid fill for one layer in layer-by-layer mode. */
function layerPaths(loops, z, h, o, solid, layerIdx, pos, rng) {
  const paths = [];
  const isl = islands(loops);
  const walls = Math.max(1, Math.round(o.walls));
  // Visit islands nearest-first.
  const todo = [...isl];
  while (todo.length) {
    let bi = 0;
    if (pos) { let bd = Infinity; todo.forEach((it, i) => { const d = dist2(pos, it.outer[nearestIndex(it.outer, pos[0], pos[1])]); if (d < bd) { bd = d; bi = i; } }); }
    const it = todo.splice(bi, 1)[0];
    const bounds = [it.outer, ...it.holes];

    const ring = [];                                         // ring[k] = offset loops of wall k
    for (let k = 0; k < walls; k++) ring.push(bounds.map(b => offset(b, o.lineW * (k + 0.5))).filter(Boolean));
    const order = o.wallOrder === 'inner' ? [...ring.keys()].reverse() : [...ring.keys()];
    for (const k of order) for (const loop of ring[k]) {
      const pts = seamLoop(loop, o.seam, pos, rng).map(([x, y]) => [x, y, z]);
      paths.push({ type: k === 0 ? 'outer' : 'inner', pts, h });
      pos = pts.at(-1);
    }

    if (solid) {
      const clip = bounds.map(b => offset(b, o.lineW * (walls + 0.5 - 0.15))).filter(Boolean);
      if (clip.length && clip.some(c => area(c) > 0)) {
        const angle = o.infillAngle + (layerIdx % 2 ? 90 : 0);
        for (const line of orderFill(fillLines(clip, angle, o.lineW), pos, o.lineW * 2.5)) {
          paths.push({ type: 'bottom', pts: line.map(([x, y]) => [x, y, z]), h });
          pos = paths.at(-1).pts.at(-1);
        }
      }
    }
  }
  return { paths, pos };
}

/**
 * @param sliced  result of sliceMesh()
 * @param o       settings (S)
 */
export function buildToolpaths(sliced, o) {
  const warnings = [];
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spiral = o.mode === 'spiral';
  const bottomN = Math.max(0, Math.round(o.bottomLayers));
  const layers = [];
  let pos = null, spiralStarted = false, multiIsland = false;

  sliced.forEach((sl, i) => {
    const out = { z: sl.z, h: sl.h, paths: [] };
    layers.push(out);
    if (!sl.loops.length) return;

    // Priming loops around the first layer: outermost first, moving in toward the part.
    if (i === 0 && o.skirtLoops > 0) {
      const hull = convexHull(sl.loops.flat());
      for (let k = Math.round(o.skirtLoops) - 1; k >= 0; k--) {
        const loop = grow(hull, o.skirtDist + o.lineW * (k + 0.5));
        const pts = seamLoop(loop, 'nearest', pos ?? loop[0], rng).map(([x, y]) => [x, y, sl.z]);
        out.paths.push({ type: 'skirt', pts, h: sl.h });
        pos = pts.at(-1);
      }
    }

    if (!spiral || i < bottomN) {
      const opts = spiral ? { ...o, walls: 1 } : o;
      const r = layerPaths(sl.loops, sl.z, sl.h, opts, i < bottomN, i, pos, rng);
      out.paths.push(...r.paths);
      pos = r.pos ?? pos;
      return;
    }

    // Spiral vase: largest outline only, rising continuously from the previous layer's height.
    const isl = islands(sl.loops);
    if (isl.length > 1) multiIsland = true;
    const outer = isl.reduce((m, it) => (area(it.outer) > area(m.outer) ? it : m), isl[0]).outer;
    const loop = offset(outer, o.lineW / 2);
    if (!loop) return;
    const start = pos ? nearestIndex(loop, pos[0], pos[1]) : 0;
    const ring = startAt(loop, start);
    ring.push(ring[0]);
    const L = length(ring, false);
    const flat = !spiralStarted && i === 0;                    // nothing below: first loop stays flat
    const z0 = flat ? sl.z : sl.z - sl.h;
    let s = 0;
    const pts = ring.map((p, k) => {
      if (k) s += Math.hypot(p[0] - ring[k - 1][0], p[1] - ring[k - 1][1]);
      return [p[0], p[1], z0 + (sl.z - z0) * (L ? s / L : 1)];
    });
    out.paths.push({ type: 'spiral', pts, h: sl.h, join: spiralStarted });
    spiralStarted = true;
    pos = pts.at(-1);
  });

  if (multiIsland) warnings.push('Spiral mode prints one outline per layer; some layers have several parts and only the largest is printed.');
  if (spiral && o.walls > 1) warnings.push('Spiral mode always prints a single wall.');

  // Speeds: first layer, then normal, capped by the machine; stretched to meet the min layer time.
  layers.forEach((l, i) => {
    const base = Math.min(i === 0 ? o.firstSpeed : o.speed, o.maxSpeed);
    for (const p of l.paths) p.speed = base;
    if (o.minLayerTime > 0) {
      const t = l.paths.reduce((a, p) => a + pathLen(p.pts) / p.speed, 0);
      if (t > 0 && t < o.minLayerTime) for (const p of l.paths) p.speed = Math.max(2, p.speed * t / o.minLayerTime);
    }
  });

  return { layers, warnings };
}

export function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return L;
}
