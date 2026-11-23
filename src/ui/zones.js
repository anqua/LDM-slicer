// Zones (opened from the Slice menu): split the height of the model into zones and give each its own non-standard style.
//
// S.zones is a list that covers the whole height without gaps: [{ from, to, style, p }] (mm). `style` is standard or one of
// the styles of nonstandard/styles.js; `p` holds the settings this zone overrides (wave height, loop size, ...). The settings
// a zone can override, and their limits, come from that registry. The drawing is ui/zone-silhouette.js.
import { S, update } from '../core/settings.js';
import { STYLES } from '../nonstandard/styles.js';
import { fieldHTML } from './form.js';
import { silhouetteSVG, scale } from './zone-silhouette.js';

const STYLE_OPTS = [['standard', 'Standard'], ...Object.entries(STYLES).map(([id, s]) => [id, s.label])];
const labelOf = id => STYLE_OPTS.find(o => o[0] === id)?.[1] ?? id;
const $ = id => document.getElementById(id);

/** The saved zones fitted to a model `top` mm tall: covering 0..top without gaps or overlaps; none saved = one standard zone. */
function fitZones(saved, top) {
  let z = (saved || []).filter(q => q && q.to > q.from).map(q => ({ ...q, p: { ...(q.p || {}) } })).sort((a, b) => a.from - b.from);
  if (!z.length) z = [{ from: 0, to: top, style: 'standard', p: {} }];
  z = z.filter(q => q.from < top);
  z[0].from = 0;
  for (let i = 0; i < z.length; i++) {
    if (i) z[i].from = z[i - 1].to;
    if (i === z.length - 1) z[i].to = top;
    z[i].to = Math.min(z[i].to, top);
  }
  return z.filter((q, i) => q.to - q.from > 0.01 || i === 0);
}

/**
 * @param pane the element the editor draws into (the Slice menu)
 * @param api { profile(): { top, r: [radius per height bin, bottom to top] } | null, slice(): slices with the zones }
 * @returns { refresh() }  call when the model changes
 */
export function initZones(pane, api) {
  let zones = [], top = 0, sel = 0, drag = null;
  const commit = () => update({ zones: zones.map(q => ({ ...q, p: { ...q.p } })) });
  const val = (zn, k) => zn.p[k] ?? S[k];

  function draw() {
    const prof = api.profile();
    if (!prof || !top) { pane.innerHTML = '<div class="info">Load a model to split its height into zones.</div>'; return; }
    const zn = zones[sel];
    const fields = (STYLES[zn.style]?.params ?? []).map(f => fieldHTML(f, 'z_')).join('');
    pane.innerHTML = `
      <div class="zones-grid"><div>
        ${silhouetteSVG({ radii: prof.r, zones, sel, top, labelOf })}
        <div class="btns" style="margin-top:10px">
          <button class="btn" id="zSplit" title="Cut the selected zone in two">Split zone</button>
          <button class="btn" id="zMerge" title="Merge the selected zone into the one above"${zones.length < 2 ? ' disabled' : ''}>Remove zone</button>
        </div>
      </div><div>
        <h3>Zone ${sel + 1} · ${zn.from.toFixed(0)}–${zn.to.toFixed(0)} mm</h3>
        <div class="row"><label for="z_style">Style</label><select id="z_style">${STYLE_OPTS.map(([v, t]) => `<option value="${v}"${zn.style === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${fields}
        <div class="row"><small>${zn.style === 'standard' ? 'Plain wall, layer by layer height as in Print paths.' : 'The effect rises and falls over about three times its amplitude at the zone edges, so zones blend into their neighbours. The bottom layers stay flat and standard.'}</small></div>
        <div class="btns" style="margin-top:10px"><button class="btn primary" id="zSlice">Slice with zones</button></div>
        <div class="info" style="margin-top:10px">Drag the green handles to move a boundary. Curved zones share the wave of the first curved zone, only the amplitude differs.</div>
      </div></div>`;
    pane.querySelectorAll('[data-k]').forEach(el => { el.value = val(zn, el.dataset.k); });
    wire();
  }

  function wire() {
    const svg = $('zsvg'), { mmAt, y } = scale(top);
    const local = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };

    svg.addEventListener('pointerdown', e => {
      const handle = e.target.closest('[data-h]');
      if (handle) { drag = +handle.dataset.h; svg.setPointerCapture(e.pointerId); e.preventDefault(); return; }
      const mm = mmAt(local(e).y), i = zones.findIndex(q => mm >= q.from && mm <= q.to);
      if (i >= 0 && i !== sel) { sel = i; draw(); }
    });
    svg.addEventListener('pointermove', e => {
      if (drag == null) return;
      const v = Math.min(zones[drag].to - 1, Math.max(zones[drag - 1].from + 1, Math.round(mmAt(local(e).y))));
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

  function refresh() {
    const p = api.profile();
    top = p ? p.top : 0;
    zones = top ? fitZones(S.zones, top) : [];
    sel = Math.min(sel, Math.max(0, zones.length - 1));
    draw();
  }
  refresh();
  return { refresh };
}
