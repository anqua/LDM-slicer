// Layer contours -> printable toolpaths: priming loops (skirt), walls, solid bottom, infill, spiral vase.
//
// Output: { layers: [{ z, h, paths: [Path] }], warnings: [string] }
// Path:   { type: 'skirt'|'outer'|'inner'|'bottom'|'infill'|'spiral', pts: [[x, y, z], ...], h, speed, join? }
// `join: true` means the path continues straight on from the previous one (spiral vase):
// no travel, no safe end / safe start in between.
import { area, contains, offset, startAt, nearestIndex, convexHull, grow, length, simplifyLine } from './polygon.js';
import { fillLines, orderLines, zigzag, tpmsLines } from './infill.js';

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


/** True when a closed polygon's edges cross each other (non-adjacent edges only). */
function selfIntersects(p) {
  const n = p.length;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;                     // edges sharing the closing vertex
      const c = p[j], d = p[(j + 1) % n];
      if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1 || Math.max(c[1], d[1]) < y0 || Math.min(c[1], d[1]) > y1) continue;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
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

    const add = (type, lines) => {
      for (const line of lines) {
        if (line.length < 2) continue;
        paths.push({ type, pts: line.map(([x, y]) => [x, y, z]), h });
        pos = paths.at(-1).pts.at(-1);
      }
    };
    // Region inside the walls, overlapping the innermost wall by 15 % of a line.
    const inset = o.lineW * (walls + 0.5 - 0.15);
    const clipOf = d => bounds.map(b => offset(b, d)).filter(Boolean);
    const usable = c => c.length && c.some(p => area(p) > 0);

    if (solid) {
      // Bottom layers: own pattern, angle and spacing (Bottom layers settings).
      const gap = Math.max(o.lineW * 0.5, (o.bottomSpacingX ?? 1) * o.nozzle);   // spacing = factor × nozzle
      const joinDist = Math.max(o.lineW * 2.5, gap * 1.2);
      if (o.bottomPattern === 'concentric') {
        // Rings parallel to the outline (and around holes), from the innermost wall inward. Offsets of
        // concave shapes start to cross themselves near the middle: stop there and fill the rest with lines.
        const rings = [];
        let d = o.lineW * (walls - 0.5) + gap, lastOk = o.lineW * (walls - 0.5);
        for (let k = 0; k < 500; k++, d += gap) {
          const loops = bounds.map(b => offset(b, d)).filter(l => l && Math.abs(area(l)) > gap * gap);
          if (!loops.length || !offset(it.outer, d) || loops.some(selfIntersects)) break;
          for (const l of loops) {
            const r = pos ? startAt(l, nearestIndex(l, pos[0], pos[1])) : l;
            rings.push([...r, r[0]]);
          }
          lastOk = d;
        }
        add('bottom', orderLines(rings, pos, o.lineW * 1.5));
        const core = clipOf(lastOk + gap * 0.85);
        if (usable(core)) add('bottom', orderLines(fillLines(core, o.bottomAngle, gap), pos, joinDist));
      } else {
        const clip = clipOf(inset);
        if (usable(clip)) {
          const a = o.bottomAngle + (o.bottomPattern === 'lines' && layerIdx % 2 ? 90 : 0);
          const segs = fillLines(clip, a, gap);
          if (o.bottomPattern === 'grid') segs.push(...fillLines(clip, a + 90, gap));
          add('bottom', orderLines(segs, pos, joinDist));
        }
      }
      continue;
    }

    const sp = Math.max(o.lineW * 2, o.infillSpacing);
    switch (o.infill) {
      case 'zigzag': {
        // Extra inner wall `zigzagWidth` in from the walls; a wave bridges the gap.
        for (const b of bounds) {
          const { wall, zig } = zigzag(b, o.lineW * (walls - 0.5), Math.max(o.lineW * 2, o.zigzagWidth), sp);
          if (!wall) continue;
          add('inner', [seamLoop(wall, 'nearest', pos, rng)]);
          const wave = zig.slice(0, -1), r = startAt(wave, pos ? nearestIndex(wave, pos[0], pos[1]) : 0);
          add('infill', [[...r, r[0]]]);
        }
        break;
      }
      case 'lines':
      case 'grid': {
        const clip = clipOf(inset);
        if (!usable(clip)) break;
        const a = o.infillAngle + (o.infill === 'lines' && layerIdx % 2 ? 90 : 0);
        const segs = fillLines(clip, a, sp);
        if (o.infill === 'grid') segs.push(...fillLines(clip, a + 90, sp));
        add('infill', orderLines(segs, pos, o.lineW * 2.5));
        break;
      }
      case 'gyroid':
      case 'schwarzD': {
        const clip = clipOf(inset);
        if (!usable(clip)) break;
        const res = Math.min(o.lineW, sp / 10);
        const lines = tpmsLines(clip, z, o.infill, sp, res).map(l => simplifyLine(l, 0.05));
        add('infill', orderLines(lines, pos, o.lineW * 2));
        break;
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
  if (spiral && o.infill !== 'none') warnings.push('Infill is only printed in layer-by-layer mode.');

  // Speeds: first layer, then bottom infill / normal, capped by the machine; stretched to meet the
  // min layer time. Bottom infill also carries its own flow multiplier (applied in gcode.js).
  const bottomFlow = (o.bottomFlow ?? 100) / 100;
  layers.forEach((l, i) => {
    for (const p of l.paths) {
      const s = i === 0 ? o.firstSpeed : p.type === 'bottom' ? (o.bottomSpeed ?? o.speed) : o.speed;
      p.speed = Math.min(s, o.maxSpeed);
      if (p.type === 'bottom') p.flow = bottomFlow;
    }
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
