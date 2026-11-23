// Stress test: many shapes x many settings through sliceModel(), with the G-code checked by a parser.
// Open tests/stress.html through the local server. Each row: what was sliced, problems found in the G-code.
import { DEFAULTS } from '../src/core/settings.js';
import { SCHEMA } from '../src/core/schema.js';
import { demoVaseGeometry } from '../src/model/demo.js';
import { sliceModel } from '../src/pipeline.js';
import { beadArea } from '../src/slicer/gcode.js';

// ---- shapes (triangle soups, z up, sitting on z = 0, centred on the bed) ----
function gridSoup(nu, nv, f) {                           // f(i,j) -> [x,y,z]; surface as triangles
  const P = [], at = (i, j) => f(i % nu, j);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    P.push(...a, ...b, ...d, ...a, ...d, ...c);
  }
  return P;
}
function cylinder(cx, cy, r, h, n = 64) {
  const P = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n * 2 * Math.PI, t1 = (i + 1) / n * 2 * Math.PI;
    const a = [cx + r * Math.cos(t0), cy + r * Math.sin(t0)], b = [cx + r * Math.cos(t1), cy + r * Math.sin(t1)];
    P.push(...a, 0, ...b, 0, ...b, h, ...a, 0, ...b, h, ...a, h);
    P.push(cx, cy, 0, ...b, 0, ...a, 0);
    P.push(cx, cy, h, ...a, h, ...b, h);
  }
  return P;
}
function box(sx, sy, h) {
  const x = sx / 2, y = sy / 2, v = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [-x, -y, h], [x, -y, h], [x, y, h], [-x, y, h]];
  const q = (a, b, c, d) => [...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]];
  return [...q(0, 3, 2, 1), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4), ...q(1, 2, 6, 5), ...q(2, 3, 7, 6), ...q(3, 0, 4, 7)];
}
function torus(R, r, n = 64, m = 24) {                     // a ring with a hole, sitting on z = 0
  return gridSoup(n, m, (i, j) => {
    const u = i / n * 2 * Math.PI, v = j / m * 2 * Math.PI;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r + r * Math.sin(v)];
  });
}
function star(h, n = 10) {                                  // concave prism
  const P = [], pt = i => { const t = i / (2 * n) * 2 * Math.PI, r = i % 2 ? 22 : 50; return [r * Math.cos(t), r * Math.sin(t)]; };
  for (let i = 0; i < 2 * n; i++) {
    const a = pt(i), b = pt(i + 1);
    P.push(...a, 0, ...b, 0, ...b, h, ...a, 0, ...b, h, ...a, h, 0, 0, 0, ...b, 0, ...a, 0, 0, 0, h, ...a, h, ...b, h);
  }
  return P;
}
function tube(Ro, Ri, h, n = 64) {                           // a hollow tube with real wall thickness
  const P = [], c = t => [Math.cos(t), Math.sin(t)];
  for (let i = 0; i < n; i++) {
    const [c0x, c0y] = c(i / n * 2 * Math.PI), [c1x, c1y] = c((i + 1) / n * 2 * Math.PI);
    const o0 = [Ro * c0x, Ro * c0y], o1 = [Ro * c1x, Ro * c1y], i0 = [Ri * c0x, Ri * c0y], i1 = [Ri * c1x, Ri * c1y];
    P.push(...o0, 0, ...o1, 0, ...o1, h, ...o0, 0, ...o1, h, ...o0, h);
    P.push(...i1, 0, ...i0, 0, ...i0, h, ...i1, 0, ...i0, h, ...i1, h);
    P.push(...o0, h, ...o1, h, ...i1, h, ...o0, h, ...i1, h, ...i0, h);
    P.push(...o1, 0, ...o0, 0, ...i0, 0, ...o1, 0, ...i0, 0, ...i1, 0);
  }
  return P;
}
const vase = () => { const g = demoVaseGeometry(); return Array.from((g.index ? g.toNonIndexed() : g).getAttribute('position').array); };
export const SHAPES = {
  vase: { pos: vase, top: 180 },
  cylinder: { pos: () => cylinder(0, 0, 40, 60), top: 60 },
  box: { pos: () => box(70, 50, 40), top: 40 },
  star: { pos: () => star(50), top: 50 },
  torus: { pos: () => torus(40, 12), top: 24 },
  twoIslands: { pos: () => [...cylinder(-35, 0, 22, 50), ...cylinder(35, 0, 22, 50)], top: 50 },
  tube: { pos: () => tube(40, 34, 80), top: 80 },
};

// ---- G-code checks ----
const num = (l, ax) => { const m = l.match(new RegExp('(?:^| )' + ax + '(-?[0-9.]+)')); return m ? +m[1] : null; };

/** Reads G-code back and returns { problems: [text], info }. */
export function checkGcode(text, S, ctx) {
  const probs = [], seen = new Set();
  const bad = (k, msg) => { if (seen.has(k)) return; seen.add(k); probs.push(msg); };
  if (/NaN|undefined|Infinity/.test(text)) bad('nan', 'NaN / undefined / Infinity in the file');
  const filArea = Math.PI * (S.filDia / 2) ** 2, eVol = e => (S.eMode === 'volumetric' ? e : e * filArea);
  const R = S.bedX / 2 + 1;
  let x = null, y = null, z = null, F = 0, maxZ = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  let ext = 0, extLen = 0, volume = 0, ratioMin = 1e9, ratioMax = 0, relE = false, outsideBed = 0, below = 0;
  const layers = [], typeSeen = {};
  for (const raw of text.split('\n')) {
    const l = raw.split(';')[0].trim();
    if (raw.startsWith(';LAYER:')) { const m = raw.match(/Z([0-9.-]+) H([0-9.]+)/); layers.push({ z: +m[1], h: +m[2] }); }
    if (raw.startsWith(';TYPE:')) typeSeen[raw.slice(6)] = 1;
    if (/^M83\b/.test(l)) relE = true;
    if (!/^G[01]\b/.test(l)) continue;
    const nx = num(l, 'X'), ny = num(l, 'Y'), nz = num(l, 'Z'), e = num(l, 'E'), f = num(l, 'F');
    if (f != null) { F = f; if (f <= 0) bad('F0', `feed rate ${f}`); }
    const px = x, py = y, pz = z;
    if (nx != null) x = nx;
    if (ny != null) y = ny;
    if (nz != null) z = nz;
    if (x != null && y != null && Math.hypot(x, y) > R) outsideBed++;
    if (z != null && z < -1e-6) below++;
    if (z != null && z > S.bedZ + 1e-6) bad('hi', `Z ${z} above the max height ${S.bedZ}`);
    if (e != null && (nx != null || ny != null)) {            // extruding move
      if (!relE) bad('rel', 'extrusion before M83');
      if (e <= 0) { bad('eneg', `extruding move with E=${e}`); continue; }
      if (px == null) { bad('nostart', 'extrusion without a known start position'); continue; }
      const dxy = Math.hypot(x - px, y - py), d3 = Math.hypot(dxy, (z ?? 0) - (pz ?? 0));
      ext++; extLen += d3; volume += eVol(e); maxZ = Math.max(maxZ, z);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (d3 > 0.05) {
        const lay = layers.at(-1) ?? { h: S.layerH };
        const r = eVol(e) / d3 / beadArea(S.lineW, lay.h || S.layerH);
        ratioMin = Math.min(ratioMin, r); ratioMax = Math.max(ratioMax, r);
      }
      if (F === 0) bad('nofeed', 'extruding before any feed rate');
    }
  }
  if (outsideBed) bad('bed', `${outsideBed} moves outside the bed radius ${R - 1}`);
  if (below) bad('z0', `${below} moves below Z 0`);
  if (!ext) bad('empty', 'no extruding moves at all');
  if (ext && ratioMax > 3) bad('hot', `extrusion up to ${ratioMax.toFixed(2)}x the bead area per mm`);
  if (ext && ratioMin < 0.3) bad('cold', `extrusion as low as ${ratioMin.toFixed(2)}x the bead area per mm`);
  if (ctx.top && ext && !ctx.expectLowTop && maxZ < ctx.top * 0.9) bad('short', `print stops at Z ${maxZ.toFixed(1)} but the model is ${ctx.top} mm tall`);
  if (ctx.top && maxZ > ctx.top + (ctx.zSlack ?? 1.5)) bad('tall', `print reaches Z ${maxZ.toFixed(1)} but the model is ${ctx.top} mm tall`);
  return { problems: probs, info: { ext, extLen, volume, maxZ, ratioMin, ratioMax, layers: layers.length, bbox: [minX, minY, maxX, maxY], types: Object.keys(typeSeen) } };
}


/** Seam checks on the toolpaths: helix turns start at the chosen angle and join end to start without a jump. */
export function checkSeams(tp, S, shape) {
  const probs = [];
  const want = (((S.seamAngle ?? 90) % 360) + 360) % 360;
  const spirals = tp.layers.flatMap(l => l.paths).filter(p => p.type === 'spiral' || (S.seam === 'angle' && p.type === 'outer' && S.mode !== 'spiral' && !S.npMode));
  let off = 0, jump = 0, prevEnd = null, n = 0;
  for (const p of spirals) {
    const a = p.pts[0], r = Math.hypot(a[0], a[1]);
    if (r > 5) { n++; const ang = ((Math.atan2(a[1], a[0]) * 180 / Math.PI) % 360 + 360) % 360, d = Math.min(Math.abs(ang - want), 360 - Math.abs(ang - want)); if (d > 4) off++; }
    if (p.join && prevEnd && Math.hypot(a[0] - prevEnd[0], a[1] - prevEnd[1], a[2] - prevEnd[2]) > 0.01) jump++;
    prevEnd = p.pts.at(-1);
  }
  if (off) probs.push(`${off} of ${n} turns do not start at the seam angle ${want}°`);
  if (jump) probs.push(`${jump} joined turns do not continue from where the last one ended`);
  return probs;
}
// ---- cases ----
function opts(k) {
  for (const g of Object.values(SCHEMA)) for (const f of (g.fields ?? g)) if (f && f.k === k && f.opts) return f.opts.map(o => o[0]);
  return [];
}
const ZONES = [
  { from: 0, to: 50, style: 'curved', p: { npAmp: 3 } },
  { from: 50, to: 100, style: 'standard', p: {} },
  { from: 100, to: 140, style: 'ruffle', p: { rfAmp: 3, rfLen: 40 } },
  { from: 140, to: 170, style: 'loops', p: {} },
  { from: 170, to: 180, style: 'standard', p: {} },
];
export function buildCases() {
  const cases = [];
  const add = (shape, label, over, nonStandard = false, ctx = {}) => cases.push({ shape, label, over, nonStandard, ctx });
  const infills = opts('infill');
  for (const sh of Object.keys(SHAPES)) {
    add(sh, 'layered default', { mode: 'layered' });
    add(sh, 'spiral', { mode: 'spiral' });
    for (const inf of infills) add(sh, `layered infill=${inf}`, { mode: 'layered', infill: inf, infillSpacing: 18 });
    add(sh, 'walls 3 inner-first grid', { walls: 3, wallOrder: 'inner', infill: 'grid' });
    add(sh, 'infill only lines', { printParts: 'infill', infill: 'lines' });
    add(sh, 'infill only zigzag', { printParts: 'infill', infill: 'zigzag' });
    add(sh, 'infill only none', { printParts: 'infill', infill: 'none' });
    add(sh, 'infill only + spiral', { printParts: 'infill', mode: 'spiral', infill: 'grid' });
    for (const bp of opts('bottomPattern')) add(sh, `bottom ${bp}, 5 layers`, { bottomPattern: bp, bottomLayers: 5, infill: 'lines' });
    for (const sm of opts('seam')) add(sh, `seam ${sm}, 2 walls`, { seam: sm, walls: 2 });
    add(sh, 'retract+zhop, no skirt', { retract: 2, zhop: 2, skirtLoops: 0, infill: 'lines' });
    add(sh, 'volumetric E, klipper', { eMode: 'volumetric', flavor: 'klipper', infill: 'grid' });
    add(sh, 'thin: layer .6 line 1.2 nozzle 1', { nozzle: 1, layerH: 0.6, lineW: 1.2, infill: 'lines', infillSpacing: 8 });
    add(sh, 'thick: layer 2 line 4 nozzle 3', { nozzle: 3, layerH: 2, lineW: 4, infill: 'lines' });
    add(sh, 'first layer 2.4, bottom 0', { firstLayerH: 2.4, bottomLayers: 0, infill: 'grid' });
    add(sh, 'min layer time 20', { minLayerTime: 20, infill: 'lines' });
    add(sh, 'zero safe start/end, no prefill', { safeStartLen: 0, safeEndLen: 0, preFill: 0 });
  }
  for (const sh of Object.keys(SHAPES)) {
    const vaselike = ['vase', 'cylinder', 'tube'].includes(sh);
    for (const npMode of opts('npMode')) add(sh, `non-standard ${npMode}`, { npMode, zones: ZONES }, true, { vaselike });
  }
  for (const sh of ['vase', 'cylinder', 'tube']) for (const a of [0, 135, 270]) {
    add(sh, `spiral seam ${a}°`, { mode: 'spiral', seamAngle: a }, false, { seams: true });
    add(sh, `layered seam at angle ${a}°`, { seam: 'angle', seamAngle: a, walls: 2 }, false, { seams: true });
    for (const npMode of ['curved', 'ruffle', 'loops']) add(sh, `non-standard ${npMode} seam ${a}°`, { npMode, seamAngle: a }, true, { seams: true, vaselike: true });
  }
  add('vase', 'curved wave amp 10 len 80', { npMode: 'curved', npType: 'wave', npAmp: 10, npLen: 80 }, true);
  add('vase', 'curved ripple', { npMode: 'curved', npType: 'ripple', npAmp: 5, npLen: 40 }, true);
  add('vase', 'curved cone', { npMode: 'curved', npType: 'cone', npAmp: 8 }, true);
  add('vase', 'curved wave 45 deg', { npMode: 'curved', npType: 'wave', npAngle: 45 }, true);
  add('vase', 'curved huge amp 30', { npMode: 'curved', npAmp: 30, npLen: 400 }, true);
  add('vase', 'ruffle extreme', { npMode: 'ruffle', rfAmp: 30, rfLen: 4, rfRadial: 20 }, true);
  add('vase', 'ruffle negative radial', { npMode: 'ruffle', rfRadial: -20 }, true);
  add('vase', 'ruffle + volumetric + retract/zhop', { npMode: 'ruffle', eMode: 'volumetric', retract: 2, zhop: 2 }, true);
  add('vase', 'loops thin line', { npMode: 'loops', nozzle: 1, layerH: 0.6, lineW: 1.2 }, true);
  return cases;
}

/** @returns [{ shape, label, ms, warnings, problems, info, error }] */
export function runStress(onRow) {
  const geo = {}, results = [];
  for (const c of buildCases()) {
    const sh = SHAPES[c.shape];
    geo[c.shape] ??= sh.pos();
    const S = { ...structuredClone(DEFAULTS), ...c.over };
    const row = { shape: c.shape, label: c.label, nonStandard: c.nonStandard };
    const t0 = performance.now();
    try {
      const { tp, gcode } = sliceModel(geo[c.shape], S, { top: sh.top, modelName: c.shape + '.stl', nonStandard: c.nonStandard });
      row.ms = Math.round(performance.now() - t0);
      row.warnings = tp.warnings;
      const ck = checkGcode(gcode.text, S, { top: sh.top, zSlack: c.nonStandard ? 40 : 1.5, expectLowTop: c.nonStandard && !c.ctx.vaselike });
      row.problems = [...ck.problems, ...(c.ctx.seams ? checkSeams(tp, S) : [])]; row.info = ck.info;
    } catch (e) { row.error = String(e.stack || e).split('\n').slice(0, 3).join(' | '); row.problems = ['EXCEPTION ' + e.message]; }
    results.push(row); onRow?.(row);
  }
  return results;
}
