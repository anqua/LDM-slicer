// The Slice menu: a chooser with a small picture of each way to slice.
// Picking one sets the style (npMode) and slices right away. The pictures are side views of the printed
// lines, drawn as SVG from the same formulas the slicer uses (stacked flat lines, curved lines, waves, loops).
import { S, update, onChange } from '../core/settings.js';

const W = 120, H = 72;

const path = (n, f) => 'M' + Array.from({ length: n + 1 }, (_, i) => f(i / n).map(v => v.toFixed(1)).join(' ')).join(' L');
const line = d => `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

const PICTURES = {
  // flat layers, one on top of the other (the Z cut)
  layered: () => Array.from({ length: 9 }, (_, i) => line(`M14 ${60 - i * 6} L106 ${60 - i * 6}`)).join(''),
  // one continuous helix: a single line that climbs, no steps
  helix: () => line('M14 62' + Array.from({ length: 9 }, (_, i) => ` L106 ${62 - i * 6 - 3} L14 ${62 - i * 6 - 6}`).join('')),
  // layers that curve more and more: waves growing from flat at the bottom
  curved: () => Array.from({ length: 9 }, (_, i) => {
    const a = Math.max(0, i - 1) * 0.95, y = 60 - i * 6;
    return line(path(48, t => [14 + 92 * t, y - a * Math.sin(t * Math.PI * 2.5)]));
  }).join(''),
  // a wall whose layers all repeat the same wave (scalloped)
  ruffle: () => Array.from({ length: 11 }, (_, i) => {
    const y = 62 - i * 4.6;
    return line(path(60, t => [14 + 92 * t, y - 5 * Math.sin(t * Math.PI * 4)]));
  }).join(''),
  // a different style in each band of height
  zones: () => Array.from({ length: 9 }, (_, i) => { const y = 60 - i * 6, a = i >= 3 && i <= 5 ? 4 : 0; return line(path(48, t => [14 + 92 * t, y - a * Math.sin(t * Math.PI * 4)])); }).join(''),
  // rows of small loops along the wall
  loops: () => Array.from({ length: 5 }, (_, i) => {
    const y = 58 - i * 11, r = 3.2, p = 9;
    return line(path(120, t => { const u = t * 88, ph = 2 * Math.PI * u / p; return [16 + u - r * Math.sin(ph) * 1.0, y - r * (1 - Math.cos(ph))]; }));
  }).join(''),
};

const OPTIONS = [
  { id: 'layered', title: 'Standard: layer by layer', text: 'The model is cut into flat layers (Z cuts), printed one on top of the other. Walls, infill, any shape.' },
  { id: 'helix', title: 'Standard: continuous helix', text: 'One single wall that climbs without stopping (spiral vase). No infill.' },
  { id: 'curved', title: 'Non-planar', text: 'The layers themselves curve: wave, ripple or cone.' },
  { id: 'ruffle', title: 'Ruffled wall', text: 'The wall waves up and down and in and out.' },
  { id: 'loops', title: 'Loop texture', text: 'The wall curls into small loops between two heights.' },
  { id: 'zones', title: 'Zones', text: 'Different styles at different heights. Opens the zone editor.' },
];

/**
 * @param run(nonplanar)  slices; `nonplanar` true uses the style in S.npMode
 * @returns { zonesBox }  the element the zone editor (ui/zones.js) draws into: the Zones card opens it inside this menu
 */
export function initSliceMenu(run) {
  const btn = document.getElementById('sliceNP'), menu = document.getElementById('sliceMenu');
  menu.innerHTML = `<div id="menuGrid"><div class="menu-title">How to slice</div><div class="menu-grid">` + OPTIONS.map(o => `
    <button class="opt" data-id="${o.id}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.title}">${PICTURES[o.id]()}</svg>
      <b>${o.title}</b><small>${o.text}</small>
    </button>`).join('') + `</div></div>
    <div id="menuZones" hidden><div class="menu-title"><button class="btn" id="menuBack">← How to slice</button> Zones: a style for each height</div><div id="zonesBox"></div></div>`;
  const grid = menu.querySelector('#menuGrid'), zonesView = menu.querySelector('#menuZones');
  const showView = v => { grid.hidden = v !== 'grid'; zonesView.hidden = v !== 'zones'; };

  // Marked: the standard way in use (layer by layer, or the helix) until a non-standard style is used.
  const chosen = () => S.sliceKind === 'np' ? S.npMode : S.mode === 'spiral' ? 'helix' : 'layered';
  const mark = () => menu.querySelectorAll('.opt').forEach(b => b.classList.toggle('on', b.dataset.id === chosen()));
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const place = () => menu.style.setProperty("--menu-top", (btn.getBoundingClientRect().bottom + 8) + "px");   // under the button, wherever the header wrapped to
  const open = () => { mark(); showView("grid"); place(); menu.hidden = false; btn.setAttribute("aria-expanded", "true"); };
  addEventListener("resize", () => { if (!menu.hidden) place(); });

  // The zone editor redraws itself while you drag; a click whose target was replaced meanwhile must not close the menu.
  let lastInside = 0;
  menu.addEventListener('pointerdown', () => { lastInside = Date.now(); }, true);
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  menu.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if (Date.now() - lastInside > 400) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  onChange(keys => { if (keys.includes('npMode') || keys.includes('mode')) mark(); });
  menu.querySelector('#menuBack').addEventListener('click', () => showView('grid'));

  menu.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.id === 'zones') { showView('zones'); return; }       // edit the zones first; the editor has its own Slice button
    close();
    if (b.dataset.id === 'layered' || b.dataset.id === 'helix') { update({ mode: b.dataset.id === 'helix' ? 'spiral' : 'layered' }); run(false); }
    else { update({ npMode: b.dataset.id }); run(true); }
  }));
  mark();
  return { zonesBox: menu.querySelector('#zonesBox'), close };
}
