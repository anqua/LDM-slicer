// The paths of one layer in layer-by-layer mode: for each part of the layer (nearest first) its walls, then the fill
// inside them: the solid base on bottom layers (layer-fill.js bottomFill), the infill above (infillFill).
import { islands, offset, nearestIndex } from './polygon.js';
import { seamLoop } from './seam.js';
import { bottomFill, infillFill } from './layer-fill.js';

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Collects the paths of a layer and keeps track of where the head is (`pos`, the end of the last path). */
function createSink(paths, z, h, pos) {
  return {
    get pos() { return pos; },
    /** Paths through lists of [x, y] points, at the layer's height. Lines with fewer than 2 points are skipped. */
    add(type, lines) {
      for (const line of lines) {
        if (line.length < 2) continue;
        paths.push({ type, pts: line.map(([x, y]) => [x, y, z]), h });
        pos = paths.at(-1).pts.at(-1);
      }
    },
    /** One wall: a closed loop starting at its seam. */
    wall(type, loop, o, rng) {
      const pts = seamLoop(loop, o.seam, pos, rng, (o.seamAngle ?? 90) * Math.PI / 180).map(([x, y]) => [x, y, z]);
      paths.push({ type, pts, h });
      pos = pts.at(-1);
    },
  };
}

/** The walls of one part: `count` loops offset by whole lines from the outline, outer or inner first. */
function addWalls(bounds, count, o, sink, rng) {
  const ring = [];                                         // ring[k] = offset loops of wall k
  for (let k = 0; k < count; k++) ring.push(bounds.map(b => offset(b, o.lineW * (k + 0.5))).filter(Boolean));
  const order = o.wallOrder === 'inner' ? [...ring.keys()].reverse() : [...ring.keys()];
  for (const k of order) for (const loop of ring[k]) sink.wall(k === 0 ? 'outer' : 'inner', loop, o, rng);
}

/**
 * @param loops     the layer's contours (slice.js): outer CCW, holes CW
 * @param solid     a bottom layer: solid base fill instead of infill
 * @param layerIdx  0-based layer index (lines alternate direction on odd layers)
 * @param pos       where the head is when the layer starts, or null
 * @returns { paths, pos }  pos: where the head is at the end
 */
export function layerPaths(loops, z, h, o, solid, layerIdx, pos, rng) {
  const paths = [], sink = createSink(paths, z, h, pos);
  const walls = Math.max(1, Math.round(o.walls));
  // "Infill only": no wall is printed; the infill then reaches the outline (wEff = 0 walls inside it).
  const wallsOn = o.printParts !== 'infill', wEff = wallsOn ? walls : 0;
  const todo = [...islands(loops)];
  while (todo.length) {                                    // parts nearest first
    let bi = 0;
    const pos0 = sink.pos;
    if (pos0) { let bd = Infinity; todo.forEach((it, i) => { const d = dist2(pos0, it.outer[nearestIndex(it.outer, pos0[0], pos0[1])]); if (d < bd) { bd = d; bi = i; } }); }
    const it = todo.splice(bi, 1)[0], bounds = [it.outer, ...it.holes];

    if (wallsOn) addWalls(bounds, walls, o, sink, rng);
    // The fill region starts inside the walls, overlapping the innermost wall by 15 % of a line.
    const fill = { bounds, o, wEff, inset: o.lineW * (wEff + 0.5 - 0.15), z, layerIdx, sink, rng };
    if (solid) bottomFill(fill); else infillFill(fill);
  }
  return { paths, pos: sink.pos };
}
