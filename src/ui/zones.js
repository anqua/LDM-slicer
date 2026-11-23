// Zones (opened from the Slice menu): split the height of the model into zones and give each its own non-standard style.
//
// S.zones is a list that covers the whole height without gaps: [{ from, to, style, p }] (mm). style is
// standard / curved / ruffle / loops; p holds the settings this zone overrides (wave height, loop size, ...).
// The model is drawn as a silhouette with draggable boundaries between the zones.
import { S, update } from '../core/settings.js';

const STYLES = [['standard', 'Standard'], ['curved', 'Curved layers'], ['ruffle', 'Ruffled wall'], ['loops', 'Loop texture']];
const BAND = { standard: '#000000', curved: '#0b2a3d', ruffle: '#0b3d17', loops: '#3d340b' };
// Per style: the settings a zone can override: [key, label, unit, step, min, max]
const PARAMS = {
  curved: [['npType', 'Layer shape', '', null], ['npAmp', 'Amplitude', 'mm', 0.5, 0.5, 30], ['npLen', 'Wavelength', 'mm', 5, 10, 400], ['npAngle', 'Wave direction', '°', 5, -360, 360]],
  ruffle: [['rfAmp', 'Wave height', 'mm', 0.5, 0.5, 30], ['rfLen', 'Wavelength', 'mm', 1, 4, 200], ['rfRadial', 'In / out', 'mm', 0.5, -20, 20]],
  loops: [['lpSize', 'Loop diameter', 'mm', 0.5, 1, 12], ['lpSpacing', 'Loop spacing', 'mm', 0.5, 1, 40]],
  standard: [],
};
const TYPE_OPTS = [['wave', 'Wave'], ['ripple', 'Ripple'], ['cone', 'Cone']];
const $ = id => document.getElementById(id);
const W = 300, H = 300, X0 = 50, X1 = 250, Y0 = 14, Y1 = 286;

/**
* @param pane the element the editor draws into (the Slice menu)
 * @param api { profile(): { top, r: [radius per height bin, bottom to top] } | null, slice(): slices with the zones }
 * @returns { refresh() }  call when the model changes
 */
export function initZones(pane, api) {
  let zones = [], top = 0, sel = 0, drag = null;

  /** The saved zones, fitted to the model height; [] or a stale list becomes one standard zone. */
  function load() {
    const p = api.profile();
    top = p ? p.top : 0;
    if (!top) { zones = []; return; }
    let z = (S.zones || []).filter(q => q && q.to > q.from).map(q => ({ ...q, p: { ...(q.p || {}) } }));
    z.sort((a, b) => a.from - b.from);
    if (!z.length) z = [{ from: 0, to: top, style: 'standard', p: {} }];
    // Cover 0..top without gaps or overlaps.
    z = z.filter(q => q.from < top);
    z[0].from = 0;
    for (let i = 0; i < z.length; i++) { if (i) z[i].from = z[i - 1].to; if (i === z.length - 1) z[i].to = top; z[i].to = Math.min(z[i].to, top); }
    zones = z.filter((q, i) => q.to - q.from > 0.01 || i === 0);
    sel = Math.min(sel, zones.length - 1);
  }
  const commit = () => update({ zones: zones.map(q => ({ ...q, p: { ...q.p } })) });
  const y = mm => Y1 - (Y1 - Y0) * mm / top;
  const mmAt = py => Math.max(0, Math.min(top, (Y1 - py) / (Y1 - Y0) * top));
  const val = (zn, k) => zn.p[k] ?? S[k];

  function silhouette(prof) {
    const r = prof.r, n = r.length, rmax = Math.max(...r, 1), sx = 90 / rmax, cx = 150;
    const left = [], right = [];
    r.forEach((v, i) => { const yy = Y1 - (Y1 - Y0) * (i + 0.5) / n; left.push(`${(cx - v * sx).toFixed(1)},${yy.toFixed(1)}`); right.push(`${(cx + v * sx).toFixed(1)},${yy.toFixed(1)}`); });
    return [`${left[0].split(',')[0]},${Y1}`, ...left, ...right.reverse(), `${right[right.length - 1] ? right[right.length - 1].split(',')[0] : cx},${Y1}`].join(' ');
  }

  function draw() {
    const prof = api.profile();
    if (!prof || !top) {
      pane.innerHTML = '<div class="info">Load a model to split its height into zones.</div>';
      return;
    }
    const poly = silhouette(prof);
    const bands = zones.map((zn, i) => `<rect x="${X0}" y="${y(zn.to).toFixed(1)}" width="${X1 - X0}" height="${(y(zn.from) - y(zn.to)).toFixed(1)}" fill="${BAND[zn.style]}"${i === sel ? ' stroke="var(--accent)" stroke-width="1"' : ''}/>`).join('');
    const handles = zones.slice(1).map((zn, i) => {
      const yy = y(zn.from).toFixed(1);
      return `<g data-h="${i + 1}" style="cursor:ns-resize"><line x1="${X0 - 8}" y1="${yy}" x2="${X1 + 8}" y2="${yy}" stroke="var(--accent)" stroke-dasharray="4 4"/>`
        + `<rect x="${X0 - 14}" y="${(+yy - 6)}" width="12" height="12" rx="2" fill="var(--accent)"/><rect x="${X1 + 2}" y="${(+yy - 6)}" width="12" height="12" rx="2" fill="var(--accent)"/>`
        + `<text x="${X1 + 18}" y="${(+yy + 4)}" font-size="11" fill="var(--accent)" font-family="var(--font-mono)">${zn.from.toFixed(0)}</text></g>`;
    }).join('');
    const labels = zones.map((zn, i) => `<text x="${X0 + 6}" y="${((y(zn.from) + y(zn.to)) / 2 + 4).toFixed(1)}" font-size="11" fill="${i === sel ? 'var(--accent)' : 'var(--muted)'}" font-family="var(--font-mono)">${i + 1} ${STYLES.find(s => s[0] === zn.style)[1].toLowerCase()}</text>`).join('');

    const zn = zones[sel];
    const fields = PARAMS[zn.style].map(([k, label, unit, step, min, max]) => k === 'npType'
      ? `<div class="row"><label for="z_${k}">${label}</label><select id="z_${k}" data-k="${k}">${TYPE_OPTS.map(([v, t]) => `<option value="${v}"${val(zn, k) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`
      : `<div class="row"><label for="z_${k}">${label}</label><div class="unit"><input id="z_${k}" data-k="${k}" type="number" step="${step}" min="${min}" max="${max}" value="${val(zn, k)}"><span>${unit}</span></div></div>`).join('');

    pane.innerHTML = `
      <div class="zones-grid"><div>
      <svg id="zsvg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;background:#000;border:1px solid var(--line);border-radius:8px;touch-action:none" role="img" aria-label="Model silhouette with zone boundaries">
        <defs><clipPath id="zclip"><polygon points="${poly}"/></clipPath></defs>
        <g clip-path="url(#zclip)">${bands}</g>
        <polygon points="${poly}" fill="none" stroke="#6b6b6b"/>
        ${labels}${handles}
        <text x="6" y="${Y0 + 4}" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${top.toFixed(0)}</text><text x="6" y="${Y1 + 2}" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">0</text>
      </svg>
      <div class="btns" style="margin-top:10px">
        <button class="btn" id="zSplit" title="Cut the selected zone in two">Split zone</button>
        <button class="btn" id="zMerge" title="Merge the selected zone into the one above"${zones.length < 2 ? ' disabled' : ''}>Remove zone</button>
      </div>
      </div><div>
      <h3>Zone ${sel + 1} · ${zn.from.toFixed(0)}–${zn.to.toFixed(0)} mm</h3>
      <div class="row"><label for="z_style">Style</label><select id="z_style">${STYLES.map(([v, t]) => `<option value="${v}"${zn.style === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      ${fields}
      <div class="row"><small>${zn.style === 'standard' ? 'Plain wall, layer by layer height as in Print paths.' : 'The effect rises and falls over about three times its amplitude at the zone edges, so zones blend into their neighbours. The bottom layers stay flat and standard.'}</small></div>
      <div class="btns" style="margin-top:10px"><button class="btn primary" id="zSlice">Slice with zones</button></div>
      <div class="info" style="margin-top:10px">Drag the green handles to move a boundary. Curved zones share the wave of the first curved zone, only the amplitude differs.</div></div></div>`;
    wire();
  }

  function wire() {
    const svg = $('zsvg');
    svg.querySelectorAll('rect[x="' + X0 + '"],text').forEach(() => {});
    const zoneAtY = py => zones.findIndex(q => mmAt(py) >= q.from && mmAt(py) <= q.to);
    svg.addEventListener('pointerdown', e => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const hg = e.target.closest('[data-h]');
      if (hg) { drag = +hg.dataset.h; svg.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      const i = zoneAtY(loc.y);
      if (i >= 0 && i !== sel) { sel = i; draw(); }
    });
    svg.addEventListener('pointermove', e => {
      if (drag == null) return;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const lo = zones[drag - 1].from + 1, hi = zones[drag].to - 1;
      const v = Math.min(hi, Math.max(lo, Math.round(mmAt(loc.y))));
      zones[drag - 1].to = v; zones[drag].from = v;
      draw();
    });
    const end = () => { if (drag != null) { drag = null; commit(); draw(); } };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    $('z_style').addEventListener('change', e => { zones[sel].style = e.target.value; commit(); draw(); });
    pane.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.k;
      let v = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) { el.value = val(zones[sel], k); return; }
        if (el.min !== '') v = Math.max(+el.min, v);
        if (el.max !== '') v = Math.min(+el.max, v);
      }
      zones[sel].p[k] = v; commit(); draw();
    }));
    $('zSplit').addEventListener('click', () => {
      const zn = zones[sel], mid = Math.round((zn.from + zn.to) / 2);
      if (zn.to - zn.from < 3) return;
      zones.splice(sel + 1, 0, { from: mid, to: zn.to, style: 'standard', p: {} });
      zn.to = mid; sel += 1; commit(); draw();
    });
    $('zMerge').addEventListener('click', () => {
      if (zones.length < 2) return;
      const i = sel === 0 ? 1 : sel;
      zones[i - 1].to = zones[i].to; zones.splice(i, 1);
      sel = Math.max(0, i - 1); commit(); draw();
    });
    $('zSlice').addEventListener('click', () => api.slice());
  }

  function refresh() { load(); draw(); }
  refresh();
  return { refresh };
}
