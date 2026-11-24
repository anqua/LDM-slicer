// Layer contours -> printable toolpaths for the standard slicer: priming loops (skirt), walls, solid bottom, infill
// (layer by layer, layer-paths.js), and, in spiral mode, the spiral vase (a separate engine, spiral.js).
//
// Output: { layers: [{ z, h, paths: [Path] }], warnings: [string] }
// Path:   { type: 'skirt'|'outer'|'inner'|'bottom'|'infill'|'spiral', pts: [[x, y, z], ...], h, speed, join? }
// `join: true` means the path continues straight on from the previous one (spiral vase):
// no travel, no safe end / safe start in between.
import { convexHull, grow, contains } from './polygon.js';
import { seamLoop } from './seam.js';
import { layerPaths } from './layer-paths.js';
import { buildSpiral } from './spiral.js';

/** Priming loops around the first layer: outermost first, moving in toward the part. Returns the head position after them. */
function addSkirt(out, loops, o, pos, rng) {
  const hull = convexHull(loops.flat());
  for (let k = Math.round(o.skirtLoops) - 1; k >= 0; k--) {
    const loop = grow(hull, o.skirtDist + o.lineW * (k + 0.5));
    const pts = seamLoop(loop, 'nearest', pos ?? loop[0], rng).map(([x, y]) => [x, y, out.z]);
    out.paths.push({ type: 'skirt', pts, h: out.h });
    pos = pts.at(-1);
  }
  return pos;
}

/** Warnings for the slice summary. */
function collectWarnings(sliced, o, { spiral, multiIsland }) {
  const warnings = [];
  // The slicer closes small holes in the mesh so the outlines stay whole; tell the user the model is damaged.
  const repaired = sliced.filter(s => s.gaps > 0).length, stillOpen = sliced.filter(s => s.open > 0).length;
  if (repaired) warnings.push(`The model's mesh has holes: ${repaired} layer${repaired > 1 ? 's' : ''} had gaps in the outline, closed automatically. Repair the mesh in your CAD program for a reliable print.`);
  if (stillOpen) warnings.push(`${stillOpen} layer${stillOpen > 1 ? 's have' : ' has'} an outline that could not be closed (a hole larger than 8 mm). Those layers may print wrongly.`);
  if (multiIsland) warnings.push('Spiral mode prints one outline per layer; some layers have several parts and only the largest is printed.');
  if (spiral && o.walls > 1) warnings.push('Spiral mode always prints a single wall.');
  if (o.printParts === 'infill' && o.mode === 'spiral') warnings.push('Infill only prints layer by layer, so the spiral mode is ignored.');
  if (o.printParts === 'infill' && o.infill === 'none') warnings.push('Infill only, but the infill pattern is None: only the bottom layers are printed. Choose an infill pattern.');
  if (spiral && o.infill !== 'none') warnings.push('Infill is only printed in layer-by-layer mode.');
  return warnings;
}

/**
 * Speeds: first layer, then bottom infill / normal, capped by the machine; stretched to meet the min layer time.
 * Bottom infill also carries its own flow multiplier (applied in gcode.js).
 */
function assignSpeeds(layers, o) {
  const bottomFlow = (o.bottomFlow ?? 75) / 100;
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
}

/**
 * @param sliced  result of sliceMesh()
 * @param o       settings (S)
 */
export function buildToolpaths(sliced, o) {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);    // seeded: a slice is repeatable
  const spiral = o.mode === 'spiral' && o.printParts !== 'infill';          // infill only needs layers: no spiral
  const bottomN = Math.max(0, Math.round(o.bottomLayers));
  // Top skin: a point is covered when each of the next topN layers has material there (even-odd over the layer's loops).
  const topN = spiral ? 0 : Math.max(0, Math.round(o.topLayers ?? 0));
  const solidAt = (loops, x, y) => loops.reduce((n, l) => n + (contains(l, [x, y]) ? 1 : 0), 0) % 2 === 1;
  const coveredBy = i => (x, y) => { for (let k = 1; k <= topN; k++) { const up = sliced[i + k]; if (!up || !solidAt(up.loops, x, y)) return false; } return true; };
  const layers = [];
  let pos = null, multiIsland = false;

  sliced.forEach((sl, i) => {
    const out = { z: sl.z, h: sl.h, paths: [] };
    layers.push(out);
    if (!sl.loops.length) return;
    if (i === 0 && o.skirtLoops > 0) pos = addSkirt(out, sl.loops, o, pos, rng);

    // Layer-by-layer engine: every layer in layered mode, and the solid base in spiral mode.
    // Everything above the base in spiral mode is a separate engine (spiral.js), run after this loop.
    if (spiral && i >= bottomN) return;
    const r = layerPaths(sl.loops, sl.z, sl.h, spiral ? { ...o, walls: 1 } : o, i < bottomN, i, pos, rng, topN && i >= bottomN ? coveredBy(i) : null);
    out.paths.push(...r.paths);
    pos = r.pos ?? pos;
  });

  // Spiral engine: one continuous helix from the top of the base to the top of the model.
  if (spiral) {
    const sp = buildSpiral(sliced, o, bottomN);
    for (const [i, p] of sp.paths) layers[i].paths.push(p);
    multiIsland = sp.multiPart;
  }

  const warnings = collectWarnings(sliced, o, { spiral, multiIsland });
  assignSpeeds(layers, o);
  return { layers, warnings };
}

export function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return L;
}
