// The fill inside the walls of one layer (layer-by-layer mode): the solid base of the bottom layers, and the infill above.
// Both get the same context `c` from layer-paths.js:
//   c = { bounds: [outer loop, ...hole loops] of one part, o: settings, wEff: walls printed inside the outline,
//         inset: distance from the outline where the fill region starts, z, layerIdx, sink, rng }
//   sink.add(type, lines) adds paths at the layer's height and moves the head; sink.pos is where the head is.
import { area, contains, offset, startAt, nearestIndex, simplifyLine } from './polygon.js';
import { fillLines, orderLines, zigzag, tpmsLines, TPMS } from './infill.js';
import { seamLoop } from './seam.js';

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

/** The loops of a part moved inward by d (those that vanish are dropped). */
const clipOf = (bounds, d) => bounds.map(b => offset(b, d)).filter(Boolean);
const usable = clip => clip.length && clip.some(p => area(p) > 0);

/** The solid base of a bottom layer: its own pattern, angle and spacing (Bottom layers settings). */
export function bottomFill(c) {
  const { bounds, o, wEff, inset, layerIdx, sink } = c;
  const gap = Math.max(o.lineW * 0.5, (o.bottomSpacingX ?? 1) * o.nozzle);   // spacing = factor × nozzle
  const joinDist = Math.max(o.lineW * 2.5, gap * 1.2);
  if (o.bottomPattern === 'concentric') {
    // Rings parallel to the outline (and around holes), from the innermost wall inward. Offsets of concave shapes start
    // to cross themselves near the middle: stop there and fill the rest with lines.
    const rings = [], pos = sink.pos, outer = bounds[0];
    let d = o.lineW * Math.max(0.5, wEff - 0.5) + gap, lastOk = o.lineW * Math.max(0.5, wEff - 0.5);
    for (let k = 0; k < 500; k++, d += gap) {
      const ol = offset(outer, d);
      const loops = bounds.map(b => offset(b, d)).filter(l => l && Math.abs(area(l)) > gap * gap);
      // Rings around holes grow as the outer ring shrinks: stop when one reaches the outer ring.
      const holesOut = ol && bounds.slice(1).some(b => { const h = offset(b, d); return h && h.some(v => !contains(ol, v)); });
      if (!loops.length || !ol || holesOut || loops.some(selfIntersects)) break;
      for (const l of loops) {
        const r = pos ? startAt(l, nearestIndex(l, pos[0], pos[1])) : l;
        rings.push([...r, r[0]]);
      }
      lastOk = d;
    }
    sink.add('bottom', orderLines(rings, sink.pos, o.lineW * 1.5));
    const core = clipOf(bounds, lastOk + gap * 0.85);
    if (usable(core)) sink.add('bottom', orderLines(fillLines(core, o.bottomAngle, gap), sink.pos, joinDist));
  } else {
    const clip = clipOf(bounds, inset);
    if (usable(clip)) {
      const a = o.bottomAngle + (o.bottomPattern === 'lines' && layerIdx % 2 ? 90 : 0);
      const segs = fillLines(clip, a, gap);
      if (o.bottomPattern === 'grid') segs.push(...fillLines(clip, a + 90, gap));
      sink.add('bottom', orderLines(segs, sink.pos, joinDist));
    }
  }
}

/** The infill of a layer above the base, by pattern: zig-zag between the walls, lines, grid, or a minimal surface. */
export function infillFill(c) {
  const { bounds, o, wEff, inset, z, layerIdx, sink, rng } = c;
  const sp = Math.max(o.lineW * 2, o.infillSpacing);
  switch (o.infill) {
    case 'zigzag': {
      // Extra inner wall `zigzagWidth` in from the walls; a wave bridges the gap.
      for (const b of bounds) {
        // Narrow parts (the arms of a star) cannot hold the full width: try narrower waves before giving up.
        let res = { wall: null }, width = Math.max(o.lineW * 2, o.zigzagWidth);
        for (; width >= o.lineW * 2 && !res.wall; width *= 0.75) res = zigzag(b, o.lineW * Math.max(0.5, wEff - 0.5), width, sp);
        const { wall, zig } = res;
        if (!wall) continue;
        sink.add('inner', [seamLoop(wall, 'nearest', sink.pos, rng)]);
        const pos = sink.pos, wave = zig.slice(0, -1), r = startAt(wave, pos ? nearestIndex(wave, pos[0], pos[1]) : 0);
        sink.add('infill', [[...r, r[0]]]);
      }
      break;
    }
    case 'lines':
    case 'grid': {
      const clip = clipOf(bounds, inset);
      if (!usable(clip)) break;
      const a = o.infillAngle + (o.infill === 'lines' && layerIdx % 2 ? 90 : 0);
      const segs = fillLines(clip, a, sp);
      if (o.infill === 'grid') segs.push(...fillLines(clip, a + 90, sp));
      sink.add('infill', orderLines(segs, sink.pos, o.lineW * 2.5));
      break;
    }
    default: {                                  // minimal surfaces (infill.js TPMS); 'none' falls through
      if (!TPMS[o.infill]) break;
      const clip = clipOf(bounds, inset);
      if (!usable(clip)) break;
      const res = Math.min(o.lineW, sp / 10);
      const lines = tpmsLines(clip, z, o.infill, sp, res).map(l => simplifyLine(l, 0.05));
      sink.add('infill', orderLines(lines, sink.pos, o.lineW * 2));
      break;
    }
  }
}
