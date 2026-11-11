// Toolpaths -> G-code, with Termite-style start handling (pre-fill, safe start, safe end).
// Extrusion is always relative (M83). E is virtual filament length or volume, per the printer setting.

const f3 = v => (Math.round(v * 1000) / 1000).toString();
const f5 = v => (Math.round(v * 1e5) / 1e5).toString();

/** Cross-section of a bead (Slic3r's rounded-rectangle model), mm². */
export function beadArea(w, h) {
  return w >= h ? (w - h) * h + Math.PI * (h / 2) ** 2 : Math.PI * w * h / 4;
}

function hms(sec) {
  const s = Math.round(sec);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
}

/** Merge joined paths (spiral vase) into chains: each chain is printed without stopping. */
function chains(layers) {
  const out = [];
  layers.forEach((l, li) => {
    for (const p of l.paths) {
      const pts = p.pts.map(q => ({ x: q[0], y: q[1], z: q[2], h: p.h, speed: p.speed }));
      const last = out.at(-1);
      if (p.join && last) last.pts.push(...pts.slice(1));
      else out.push({ type: p.type, layer: li, pts });
    }
  });
  return out;
}

/**
 * Split a chain into short moves carrying their own speed and flow factor:
 * slow for the first safeStartLen mm, slow and fading flow for the last safeEndLen mm.
 */
function shape(pts, o) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  const L = cum.at(-1);
  let a = Math.max(0, o.safeStartLen), b = Math.max(0, o.safeEndLen);
  if (a + b > L) { const k = L / (a + b); a *= k; b *= k; }
  const endAt = L - b;

  // Break points along the path: vertices, the two boundaries, and ~1 mm steps in the end ramp.
  const marks = new Set(cum);
  if (a > 0) marks.add(a);
  if (b > 0) { const n = Math.min(20, Math.max(2, Math.ceil(b))); for (let k = 0; k <= n; k++) marks.add(endAt + b * k / n); }
  const s = [...marks].filter(v => v >= 0 && v <= L).sort((m, n) => m - n);

  let i = 1;                                     // s is ascending, so the segment pointer only moves forward
  const at = d => {
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = cum[i] === cum[i - 1] ? 0 : (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const p = pts[i - 1], q = pts[i];
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, h: q.h, speed: q.speed };
  };

  const moves = [];
  for (let k = 1; k < s.length; k++) {
    const len = s[k] - s[k - 1];
    if (len < 1e-4) continue;
    const mid = (s[k] + s[k - 1]) / 2, to = at(s[k]);
    let speed = to.speed, flow = 1;
    if (mid < a) speed = Math.min(speed, o.safeStartSpeed);
    if (b > 0 && mid > endAt) {
      speed = Math.min(speed, o.safeEndSpeed);
      flow = 1 - (1 - o.safeEndFlow / 100) * ((mid - endAt) / b);
    }
    moves.push({ ...to, len, speed: Math.max(0.5, speed), flow });
  }
  return moves;
}

/**
 * @param tp  result of buildToolpaths()
 * @param o   settings (S)
 * @param meta { modelName }
 * @returns { text, stats: { time, volume, extrudeLen, travelLen, layers } }
 */
export function toGcode(tp, o, meta = {}) {
  const filArea = Math.PI * (o.filDia / 2) ** 2;
  const eFor = mm3 => (o.eMode === 'volumetric' ? mm3 : mm3 / filArea);
  const flow = o.flow / 100;
  const travelF = Math.round(o.travelSpeed * 60);
  const body = [];
  const st = { time: 0, volume: 0, extrudeLen: 0, travelLen: 0, layers: tp.layers.filter(l => l.paths.length).length };

  let pos = null, lastF = null, lastLayer = -1, primed = false;
  const g1 = (parts, F) => {
    if (F !== lastF) { parts.push('F' + F); lastF = F; }
    body.push('G1 ' + parts.join(' '));
  };
  const travel = (x, y, z) => {
    const d = pos ? Math.hypot(x - pos.x, y - pos.y) : 0;
    if (!pos) {
      body.push(`G0 Z${f3(z + Math.max(5, o.zhop))} F${travelF}`, `G0 X${f3(x)} Y${f3(y)}`, `G0 Z${f3(z)}`);
      lastF = travelF;
    } else if (d > 1e-3 || Math.abs(z - pos.z) > 1e-4) {
      const far = d > o.lineW * 2;
      if (far && o.retract > 0) body.push(`G1 E-${f5(o.retract)} F1200 ; retract`);
      if (far && o.zhop > 0) body.push(`G0 Z${f3(Math.max(z, pos.z) + o.zhop)} F${travelF}`);
      body.push(`G0 X${f3(x)} Y${f3(y)}` + (far && o.zhop > 0 ? '' : ` Z${f3(z)}`) + ` F${travelF}`);
      if (far && o.zhop > 0) body.push(`G0 Z${f3(z)}`);
      if (far && o.retract > 0) body.push(`G1 E${f5(o.retract)} F1200 ; unretract`);
      lastF = null;
      st.travelLen += d;
      st.time += d / o.travelSpeed;
    }
    pos = { x, y, z };
  };

  for (const c of chains(tp.layers)) {
    if (c.pts.length < 2) continue;
    if (c.layer !== lastLayer) {
      const l = tp.layers[c.layer];
      body.push(`;LAYER:${c.layer} Z${f3(l.z)} H${f3(l.h)}`);
      lastLayer = c.layer;
    }
    body.push(`;TYPE:${c.type}`);
    const p0 = c.pts[0];
    travel(p0.x, p0.y, p0.z);

    // Pre-fill: push clay in place once, before the very first path, to build pressure.
    if (!primed && o.preFill > 0) {
      const v = o.preFill * beadArea(o.lineW, p0.h) * flow;
      const t = o.preFill / Math.max(0.5, o.safeStartSpeed);
      body.push(`G1 E${f5(eFor(v))} F${Math.max(1, Math.round(eFor(v) / t * 60))} ; pre-fill`);
      lastF = null;
      st.volume += v; st.time += t;
    }
    primed = true;

    for (const m of shape(c.pts, o)) {
      const v = m.len * beadArea(o.lineW, m.h) * flow * m.flow;
      const parts = [`X${f3(m.x)}`, `Y${f3(m.y)}`];
      if (Math.abs(m.z - pos.z) > 1e-4) parts.push(`Z${f3(m.z)}`);
      parts.push(`E${f5(eFor(v))}`);
      g1(parts, Math.round(m.speed * 60));
      pos = { x: m.x, y: m.y, z: m.z };
      st.volume += v; st.extrudeLen += m.len; st.time += m.len / m.speed;
    }
  }

  const head = [
    `; Generated by LDM Slicer — @A | Art, Technology, Architecture`,
    `; Date: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    meta.modelName ? `; Model: ${meta.modelName}` : null,
    `; Printer: ${o.printerName} (${o.flavor})`,
    `; Nozzle: ${o.nozzle} mm · line width ${o.lineW} mm · layer ${o.layerH} mm · first layer ${o.firstLayerH} mm`,
    `; Mode: ${o.mode === 'spiral' ? 'spiral vase' : `layer by layer, ${o.walls} wall(s)`} · bottom layers ${o.bottomLayers}`,
    `; E: ${o.eMode === 'volumetric' ? 'volume (mm³)' : `virtual filament Ø${o.filDia} mm`} · flow ${o.flow} %`,
    `; Priming loops: ${o.skirtLoops} at ${o.skirtDist} mm · pre-fill ${o.preFill} mm`,
    `; Safe start: ${o.safeStartLen} mm at ${o.safeStartSpeed} mm/s · safe end: ${o.safeEndLen} mm at ${o.safeEndSpeed} mm/s to ${o.safeEndFlow} % flow`,
    `; Estimated print time: ${hms(st.time)} (no acceleration)`,
    `; Estimated clay: ${(st.volume / 1000).toFixed(1)} ml`,
    `; Printing path length: ${(st.extrudeLen / 1000).toFixed(2)} m · travel ${(st.travelLen / 1000).toFixed(2)} m`,
    `; Layers: ${st.layers}`,
    '',
    '; --- start G-code ---',
    o.startG,
    /^\s*M83\b/im.test(o.startG) ? null : 'M83 ; relative extrusion (this slicer writes relative E)',
    '; --- print ---',
  ].filter(l => l !== null);

  const tail = ['; --- end G-code ---', o.endG, ''];
  return { text: [...head, ...body, ...tail].join('\n'), stats: st };
}
