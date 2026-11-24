// Reads G-code text into a list of moves: for the "Exact G-code" preview of a slice (what the printer will do, move by
// move, from the file itself) and for opening any G-code file (this slicer's, Cura's, PrusaSlicer's, Simplify3D's ...).
//
// Understood: G0/G1 with X Y Z E F (modal F, mm/min), G2/G3 arcs (I J or R, XY plane), G90/G91 (absolute / relative
// XYZ), M82/M83 (absolute / relative E), G92 (E reset), G20/G21 (inches / mm), G28 (home), comments after ";".
// Layers: ";LAYER:n" (this slicer, Cura), ";LAYER_CHANGE" (PrusaSlicer, Bambu), "; layer n" (Simplify3D); without any of
// them the layers are found from the Z heights. Types: ";TYPE:name" (names of all of these, see normalizeType()).
//
// Move: { a: [x,y,z], b: [x,y,z], extrude: bool, type, layer, dt, e, len, v }
//   dt: seconds at the commanded feed;  e: clay pushed (E units; relative to the move);  len: mm;  v: speed, mm/s.
// A move with E > 0 and some motion deposits clay; every other motion is a travel. Retract / unretract / pre-fill
// (E only, no motion) deposit nothing visible and take no path time.

/** A G-code type name -> one of the preview's colors: skirt | outer | inner | bottom | infill | spiral. */
export function normalizeType(raw) {
  const t = raw.toLowerCase();
  if (/skirt|brim/.test(t)) return 'skirt';
  if (/spiral/.test(t)) return 'spiral';
  if (/outer|external/.test(t)) return 'outer';
  if (/inner|perimeter|wall/.test(t)) return 'inner';
  if (/bottom|skin|solid|top|bridge|iron/.test(t)) return 'bottom';
  if (/fill|support/.test(t)) return 'infill';
  return 'outer';
}

const WORD = /([XYZEFIJRP])\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;

/**
 * @param text  the G-code
 * @param opts  { home: [x, y, z] the nozzle is moved to by G28 (a delta homes at the top, in the middle),
 *               filDia, eMode: how E is read ('filament' = virtual filament length, 'volumetric' = mm³) }
 * @returns { moves, layers: [{ z, zMin, zMax }], stats, header: [comment lines], slicer, warnings, hasTypes, hasLayerMarks }
 */
export function readGcode(text, { home = [0, 0, 0], filDia = 1.75, eMode = 'filament' } = {}) {
  const moves = [], header = [], warnings = [];
  let pos = null, absXYZ = true, absE = true, scale = 1, feed = 3000, layer = 0, type = 'outer';
  let eLast = 0, hasLayerMarks = false, hasTypes = false, started = false, prusaLayers = 0, slicer = '';
  const filArea = Math.PI * (filDia / 2) ** 2;

  let i = 0;
  const n = text.length;
  while (i < n) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = n;
    const raw = text.slice(i, j).trim();
    i = j + 1;
    if (!raw) continue;

    if (raw[0] === ';') {
      let m;
      if ((m = /^;\s*LAYER:\s*(-?\d+)/i.exec(raw))) { layer = Math.max(0, +m[1]); hasLayerMarks = true; }
      else if (/^;\s*LAYER_CHANGE/i.test(raw)) { layer = prusaLayers++; hasLayerMarks = true; }
      else if ((m = /^;\s*layer\s+(\d+)\b/i.exec(raw))) { layer = Math.max(0, +m[1] - 1); hasLayerMarks = true; }
      else if ((m = /^;\s*TYPE:\s*(.+)$/i.exec(raw))) { type = normalizeType(m[1]); hasTypes = true; }
      if (!started && header.length < 60) header.push(raw.replace(/^;\s?/, ''));
      if (!slicer) { const s = /(LDM Slicer|Cura|PrusaSlicer|SuperSlicer|OrcaSlicer|BambuStudio|Simplify3D|ideaMaker|Slic3r|KISSlicer|MatterControl)/i.exec(raw); if (s) slicer = s[1]; }
      continue;
    }
    const semi = raw.indexOf(';');
    const line = (semi > 0 ? raw.slice(0, semi) : raw).trim();
    const head = /^[GM]\d+(?:\.\d+)?/i.exec(line);
    if (!head) continue;
    const cmd = head[0].toUpperCase();
    if (cmd === 'G90') { absXYZ = true; continue; }
    if (cmd === 'G91') { absXYZ = false; continue; }
    if (cmd === 'M82') { absE = true; continue; }
    if (cmd === 'M83') { absE = false; continue; }
    if (cmd === 'G20') { scale = 25.4; continue; }
    if (cmd === 'G21') { scale = 1; continue; }
    if (cmd === 'G28') { pos = [...home]; continue; }
    const isMove = cmd === 'G0' || cmd === 'G00' || cmd === 'G1' || cmd === 'G01', isArc = cmd === 'G2' || cmd === 'G3' || cmd === 'G02' || cmd === 'G03';
    if (cmd === 'G92') {
      WORD.lastIndex = 0;
      let w; while ((w = WORD.exec(line))) if (w[1].toUpperCase() === 'E') eLast = parseFloat(w[2]);
      continue;
    }
    if (!isMove && !isArc) continue;
    started = true;

    const w = {};
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(line))) w[m[1].toUpperCase()] = parseFloat(m[2]);
    if (w.F != null && w.F > 0) feed = w.F * scale;
    // Clay pushed by this command: the change in E (absolute E counts from the last value; a retract is negative).
    let dE = 0;
    if (w.E != null) { dE = absE ? w.E - eLast : w.E; eLast = absE ? w.E : eLast; }
    const hasXYZ = w.X != null || w.Y != null || w.Z != null;
    if (!hasXYZ) continue;                                   // E-only or F-only: no motion

    // Before the first positioning the start is unknown: relative moves count from the origin, absolute ones start at their target.
    const a = pos ?? (absXYZ ? [(w.X ?? 0) * scale, (w.Y ?? 0) * scale, (w.Z ?? 0) * scale] : [0, 0, 0]);
    const b = absXYZ
      ? [w.X != null ? w.X * scale : a[0], w.Y != null ? w.Y * scale : a[1], w.Z != null ? w.Z * scale : a[2]]
      : [a[0] + (w.X ?? 0) * scale, a[1] + (w.Y ?? 0) * scale, a[2] + (w.Z ?? 0) * scale];
    const extrude = !(cmd === 'G0' || cmd === 'G00') && dE > 1e-9;       // G0 is a rapid move: no clay
    const v = Math.max(0.01, feed / 60);

    if (pos) {
      if (isMove) {
        const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (d > 1e-9) moves.push({ a, b, extrude, type, layer, dt: d / v, e: extrude ? dE : 0, len: d, v });
      } else {
        for (const s of arcPoints(a, b, w, scale, cmd === 'G2' || cmd === 'G02')) {
          const d = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
          if (d > 1e-9) moves.push({ a: s.a, b: s.b, extrude, type, layer, dt: d / v, e: extrude ? dE * s.share : 0, len: d, v });
        }
      }
    }
    pos = b;
  }

  // Without layer comments, the layers come from the heights of the printed moves.
  if (!hasLayerMarks) deriveLayers(moves);
  else { let last = 0; for (const mv of moves) { mv.layer = Math.max(last, mv.layer); last = mv.layer; } }

  const layers = layerTable(moves);
  const stats = measure(moves, layers, filArea, eMode);
  collectWarnings(warnings, stats, hasLayerMarks, moves.length);
  return { moves, layers, stats, header, slicer, warnings, hasTypes, hasLayerMarks };
}

/** An arc from a to b (center from I J, or from the radius R) cut into short straight pieces; `share` = its part of the arc. */
function arcPoints(a, b, w, scale, clockwise) {
  let cx, cy;
  if (w.I != null || w.J != null) { cx = a[0] + (w.I ?? 0) * scale; cy = a[1] + (w.J ?? 0) * scale; }
  else if (w.R != null) {
    const r = Math.abs(w.R) * scale, dx = b[0] - a[0], dy = b[1] - a[1], q = Math.hypot(dx, dy);
    if (q < 1e-9 || q > 2 * r) return [{ a, b, share: 1 }];
    const h = Math.sqrt(Math.max(0, r * r - q * q / 4)), sgn = (clockwise ? 1 : -1) * (w.R < 0 ? -1 : 1);
    cx = a[0] + dx / 2 + sgn * h * dy / q; cy = a[1] + dy / 2 - sgn * h * dx / q;
  } else return [{ a, b, share: 1 }];
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  if (r < 1e-6) return [{ a, b, share: 1 }];
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  let a1 = Math.atan2(b[1] - cy, b[0] - cx), sweep = a1 - a0;
  if (clockwise) { if (sweep >= -1e-9) sweep -= 2 * Math.PI; } else if (sweep <= 1e-9) sweep += 2 * Math.PI;
  const steps = Math.min(720, Math.max(2, Math.ceil(Math.abs(sweep) * r / 0.8)));
  const out = [];
  let prev = a;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps, ang = a0 + sweep * t;
    const p = k === steps ? b : [cx + r * Math.cos(ang), cy + r * Math.sin(ang), a[2] + (b[2] - a[2]) * t];
    out.push({ a: prev, b: p, share: 1 / steps });
    prev = p;
  }
  return out;
}

/** Layers from Z when the file has no layer comments: one per distinct height of printed moves (binned if there are very many). */
function deriveLayers(moves) {
  const zs = [];
  for (const m of moves) if (m.extrude) zs.push(Math.round(m.b[2] * 100) / 100);
  if (!zs.length) return;
  const levels = [...new Set(zs)].sort((p, q) => p - q);
  let bin;
  if (levels.length <= 3000) { const idx = new Map(levels.map((z, k) => [z, k])); bin = z => idx.get(Math.round(z * 100) / 100); }
  else { const lo = levels[0], hi = levels.at(-1), N = 500; bin = z => Math.min(N - 1, Math.floor((z - lo) / (hi - lo) * N)); }
  let last = 0;
  for (const m of moves) {
    // Travel to the next layer happens before its first print move: assign by the highest of the two ends.
    const l = bin(Math.max(m.a[2], m.b[2]));
    last = Math.max(last, l ?? last);
    m.layer = last;
  }
}

/** One entry per layer index: the lowest and highest Z of its printed moves (empty layers repeat the one below). */
function layerTable(moves) {
  let nL = 0;
  for (const m of moves) if (m.layer + 1 > nL) nL = m.layer + 1;
  const lo = new Array(nL).fill(Infinity), hi = new Array(nL).fill(-Infinity);
  for (const m of moves) if (m.extrude) {
    const z0 = Math.min(m.a[2], m.b[2]), z1 = Math.max(m.a[2], m.b[2]);
    if (z0 < lo[m.layer]) lo[m.layer] = z0;
    if (z1 > hi[m.layer]) hi[m.layer] = z1;
  }
  const out = [];
  for (let k = 0; k < nL; k++) {
    if (hi[k] === -Infinity) { const p = out[k - 1]; out.push(p ? { ...p } : { z: 0, zMin: 0, zMax: 0 }); }
    else out.push({ z: hi[k], zMin: lo[k], zMax: hi[k] });
  }
  return out;
}

/** Totals of the printed moves: time (no acceleration), path and travel length, clay, bounds, speeds. */
function measure(moves, layers, filArea, eMode) {
  const st = { time: 0, extrudeLen: 0, travelLen: 0, volume: 0, layers: layers.length, moves: moves.length, extrudeMoves: 0,
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], vMin: Infinity, vMax: 0, maxRadius: 0, layerH: 0 };
  for (const m of moves) {
    st.time += m.dt;
    if (!m.extrude) { st.travelLen += m.len; continue; }
    st.extrudeLen += m.len; st.extrudeMoves++;
    st.volume += eMode === 'volumetric' ? m.e : m.e * filArea;
    st.vMin = Math.min(st.vMin, m.v); st.vMax = Math.max(st.vMax, m.v);
    for (const p of [m.a, m.b]) for (let k = 0; k < 3; k++) { if (p[k] < st.min[k]) st.min[k] = p[k]; if (p[k] > st.max[k]) st.max[k] = p[k]; }
  }
  if (!st.extrudeMoves) { st.min = [0, 0, 0]; st.max = [0, 0, 0]; st.vMin = 0; }
  if (layers.length > 2) st.layerH = (layers.at(-1).z - layers[0].z) / (layers.length - 1);   // average layer height
  return st;
}

function collectWarnings(out, st, hasLayerMarks, count) {
  if (!st.extrudeMoves) out.push('This file has no extruding moves (no G1 with X, Y or Z and a positive E). Nothing to show but travel.');
  if (st.extrudeMoves && !hasLayerMarks) out.push('No layer comments in the file: the layers are found from the Z heights.');
  if (count > 2_000_000) out.push(`Large file: ${count.toLocaleString()} moves. The preview may be slow.`);
}

/** For the Exact G-code view of a slice: just the moves. */
export function parseGcodeMoves(text, home = [0, 0, 0]) {
  return readGcode(text, { home }).moves;
}
