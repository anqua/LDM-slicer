// Non-standard slicing engine: a different way to slice from the standard layer-by-layer slicer (src/slicer/).
// It is for vase-like parts and prints the wall as one continuous helix with a style applied to it.
//
//  1. Outline  (outline.js)  the part measured as one radius per angle per layer, not as chained contours
//  2. Zones    (zones.js)    which style the wall has at which height: a whole-model style, or the zones of the editor
//  3. Helix    (helix.js)    one continuous path; every point shaped by the style of its zone (styles.js)
//  4. Report   (report.js)   travel lift, warnings, the header line
//  Curved layers (field.js) warp the mesh first, so that step 1 measures the part in "layer space".
//
// The base (priming loops and bottom layers) is not made here: it is the standard slicer's, flat and identical to a
// standard slice. The styles start above it.
import { makeWarp, warpMesh } from './field.js';
import { sliceMesh } from '../slicer/slice.js';        // the base only: the standard slicer's contours and bottom layers
import { buildToolpaths } from '../slicer/paths.js';
import { TAU, clamp } from './styles.js';
import { layerList, radialProfiles, ringOf, offsetRing, ringLength, densify } from './outline.js';
import { makeZones, zoneFinder, curvedEnvelope } from './zones.js';
import { buildHelix } from './helix.js';
import { wallHop, collectWarnings, describeSlice } from './report.js';

/** The axis of the part: the middle of its footprint, and the largest distance of any vertex from it. */
function findAxis(pos) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rmax = 1;
  for (let i = 0; i < pos.length; i += 3) rmax = Math.max(rmax, Math.hypot(pos[i] - cx, pos[i + 1] - cy));
  return { cx, cy, rmax };
}

/**
 * Curved layers: the warp (all curved zones share the wave of the first one, each with its own rise and fall) and the
 * mesh moved into layer space. Returns { warp: null, mesh: pos, topL: top } when no zone is curved.
 */
function prepareCurved(pos, zones, pOf, zonesMode, rmax, top) {
  const curved = zones.filter(zn => zn.style === 'curved');
  if (!curved.length) return { warp: null, mesh: pos, topL: top };
  const Zc = pOf(curved[0]);
  const warp = zonesMode ? makeWarp(Zc, rmax, Infinity, curvedEnvelope(curved, Zc.npAmp)) : makeWarp(Zc, rmax, top);
  const { mesh, top: topL } = warpMesh(pos, warp, Zc.npType === 'cone' ? 80 : Zc.npLen);
  return { warp, mesh, topL };
}

/** The base: the standard slicer's priming loops and bottom layers (or only priming loops when there are no bottom layers). */
function addBase(out, pos, layers, rings, bottomN, o, flat, warnings) {
  if (bottomN) {
    const base = sliceMesh(pos, layers.slice(0, bottomN).map(({ z, h }) => ({ z, h })), Math.max(0.02, o.lineW * 0.03));
    const std = buildToolpaths(base, { ...o, mode: 'layered', infill: 'none', printParts: 'all' });
    std.layers.forEach((l, i) => out[i].paths.push(...l.paths));
    warnings.push(...std.warnings);
  } else {
    for (let k = Math.round(o.skirtLoops) - 1; k >= 0; k--)
      out[0].paths.push({ ...flat('skirt', offsetRing(rings[0], -(o.skirtDist + o.lineW * (k + 0.5))), layers[0].z, true), h: layers[0].h });
  }
}

/** Speeds of the wall paths (first layer, normal; capped by the machine). The base already has its own. */
function assignSpeeds(out, o) {
  const bottomFlow = (o.bottomFlow ?? 75) / 100;
  out.forEach((l, i) => {
    for (const p of l.paths) {
      if (p.speed != null) continue;
      const sp = i === 0 ? o.firstSpeed : p.type === 'bottom' ? (o.bottomSpeed ?? o.speed) : o.speed;
      p.speed = Math.min(sp, o.maxSpeed);
      if (p.type === 'bottom') p.flow = bottomFlow;
    }
  });
}

/** Marks the wall paths with their travel lift (none for the first: it starts on top of the flat base) and each layer's real height range. */
function annotateWall(out, hop) {
  let firstWall = true;
  for (const l of out) for (const p of l.paths) if (p.type === 'spiral') { p.hop = firstWall ? 0 : hop; firstWall = false; }
  for (const l of out) {                                // a curved layer is not at one Z: the layer slider shows the range
    let lo = Infinity, hi = -Infinity;
    for (const p of l.paths) if (p.type === 'spiral') for (const q of p.pts) { if (q[2] < lo) lo = q[2]; if (q[2] > hi) hi = q[2]; }
    if (hi > lo) { l.zMin = lo; l.zMax = hi; }
  }
}

/**
 * @param pos  triangle soup (world, z up, model on z = 0)
 * @param o    settings (S): o.npMode is curved, ruffle, loops (the whole wall above the base) or zones (o.zones)
 * @param top  model height
 * @returns { tp, zMax, hop, note }; tp = { layers: [{ z, h, paths }], warnings } like the standard slicer's result;
 *          hop = z-hop that clears the surface texture on travel moves
 */
export function buildNonStandard(pos, o, top) {
  // The bottom layers are planar (and the standard slicer's): every style starts above them.
  const first = layerList(top, o.firstLayerH || o.layerH, o.layerH);
  const nBase = clamp(Math.round(o.bottomLayers), 0, first.length);
  const baseTop = nBase ? first[nBase - 1].z : 0;
  o = { ...o, npBase: Math.max(o.npBase, baseTop), lpFrom: Math.max(o.lpFrom, baseTop / top * 100) };
  const zonesMode = o.npMode === 'zones';
  const zones = makeZones(o, top, baseTop), zoneAt = zoneFinder(zones);
  const pOf = zn => ({ ...o, ...zn.p });

  // 1. Outline
  const { cx, cy, rmax } = findAxis(pos);
  const { warp, mesh, topL } = prepareCurved(pos, zones, pOf, zonesMode, rmax, top);
  const layers = layerList(topL, o.firstLayerH || o.layerH, o.layerH);
  const N = clamp(Math.ceil(TAU * rmax / 0.5), 256, 4096);
  const seamA = (o.seamAngle ?? 90) * Math.PI / 180;               // where each turn of the helix starts and ends
  const prof = radialProfiles(mesh, layers, cx, cy, N, seamA);
  let nL = prof.length;
  while (nL > 0 && !prof[nL - 1]) nL--;                // nothing measured above the top
  if (!nL) throw new Error('Nothing to print: the model has no outline at the first layer.');
  for (let i = 1; i < nL; i++) if (!prof[i]) prof[i] = prof[i - 1];   // a layer with no crossing at all repeats the one below
  const rings = prof.slice(0, nL).map(P => ringOf(P, cx, cy, seamA));
  const walls = rings.map(R => offsetRing(R, o.lineW / 2));            // path centre = half a line inside the surface
  const perim = walls.map(ringLength);

  // The base, then the wall
  const bottomN = clamp(Math.round(o.bottomLayers), 0, nL);
  const out = layers.slice(0, nL).map(l => ({ z: l.z, h: l.h, paths: [] }));
  const flat = (type, loop2d, zl, closed) => {          // a flat path (priming loop) in layer space, mapped back to real heights
    let pts = loop2d.map(([x, y]) => [x, y, zl]);
    if (closed) pts.push(pts[0]);
    if (warp) pts = densify(pts, 1);
    return { type, pts: pts.map(([x, y, z]) => warp ? [x, y, warp.toWorld(x, y, z)] : [x, y, z]) };
  };
  const warnings = [];
  addBase(out, pos, layers, rings, bottomN, o, flat, warnings);

  // 3. Helix
  let zMax = buildHelix({ out, layers, walls, perim, bottomN, nL, o, top, warp, zoneAt, pOf, zonesMode });
  const hop = wallHop(zones, pOf, o, warp);
  annotateWall(out, hop);
  assignSpeeds(out, o);

  // 4. Report
  if (warp) zMax = Math.min(zMax, top + 0.05);
  collectWarnings(warnings, { zones, pOf, o, warp, zonesMode, zMax, walls, layers, N, bottomN, nL });
  return { tp: { layers: out, warnings }, zMax, hop, note: describeSlice(zones, pOf, o, top, zonesMode) };
}
