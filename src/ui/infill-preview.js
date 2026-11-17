// Infill pattern picker: one tile per pattern, each a top view of a round sample sliced with the
// real infill code (slicer/infill.js) and the current settings, so the preview is what will print.
// Lines are drawn at bead width; a darker colour shows how the pattern changes on the next layer.
import { S, update, onChange } from '../core/settings.js';
import { offset } from '../slicer/polygon.js';
import { fillLines, zigzag, tpmsLines } from '../slicer/infill.js';

const PATTERNS = [
  { id: 'none', name: 'None', desc: 'Hollow: walls only. Lightest and fastest; the usual choice for vessels.' },
  { id: 'zigzag', name: 'Zig-zag', desc: 'An extra inner wall, joined to the walls by a continuous wave. A stiff double wall, common in clay printing.' },
  { id: 'lines', name: 'Lines', desc: 'Parallel lines, turning 90° every layer, so each layer crosses the one below.' },
  { id: 'grid', name: 'Grid', desc: 'Lines in both directions on every layer. Strong, but material doubles up at every crossing.' },
  { id: 'gyroid', name: 'Gyroid', desc: 'Curved 3D lattice that shifts from layer to layer. Strong in all directions, no crossings within a layer.' },
  { id: 'schwarzD', name: 'Schwarz D', desc: 'Diamond-shaped 3D lattice that shifts from layer to layer. Similar strength to gyroid, more angular.' },
];

// Settings that change how the tiles look.
const KEYS = new Set(['infill', 'infillSpacing', 'infillAngle', 'zigzagWidth', 'lineW', 'walls', 'layerH']);

function circle(r, n = 96) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; p.push([r * Math.cos(a), r * Math.sin(a)]); }
  return p;                                                    // counter-clockwise: material inside (left)
}

const svgPath = (lines, closed) => lines.map(l =>
  'M' + l.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + (closed ? 'Z' : '')).join('');

/** Wall loops and infill (this layer + next layer) for one pattern on a round sample of radius R. */
function sample(id, R) {
  const lw = S.lineW, walls = Math.max(1, Math.round(S.walls || 1));
  const sp = Math.max(lw * 2, S.infillSpacing), ang = S.infillAngle;
  const b = circle(R);
  const wallLoops = [];
  for (let k = 0; k < walls; k++) { const l = offset(b, lw * (k + 0.5)); if (l) wallLoops.push(l); }
  const clip = [offset(b, lw * (walls + 0.5 - 0.15))].filter(Boolean);
  let now = [], next = [], extraWall = null;
  if (clip.length) switch (id) {
    case 'zigzag': {
      const { wall, zig } = zigzag(b, lw * (walls - 0.5), Math.max(lw * 2, S.zigzagWidth), sp);
      if (wall) { extraWall = wall; now = [zig]; }
      break;
    }
    case 'lines': now = fillLines(clip, ang, sp); next = fillLines(clip, ang + 90, sp); break;
    case 'grid': now = [...fillLines(clip, ang, sp), ...fillLines(clip, ang + 90, sp)]; break;
    case 'gyroid':
    case 'schwarzD': {
      const res = Math.min(lw, sp / 10), z = sp * 0.1;
      now = tpmsLines(clip, z, id, sp, res);
      next = tpmsLines(clip, z + sp / 4, id, sp, res);       // a quarter cell higher: shows how it shifts
      break;
    }
  }
  return { wallLoops, extraWall, now, next, lw };
}

function tileSVG(id, R) {
  const { wallLoops, extraWall, now, next, lw } = sample(id, R);
  const m = R + lw;                                           // view box margin includes bead width
  const stroke = (color, w) => `fill="none" stroke="var(${color})" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  return `<svg viewBox="${-m} ${-m} ${2 * m} ${2 * m}" aria-hidden="true">
    ${next.length ? `<path d="${svgPath(next)}" ${stroke('--path-infill-next', lw)}/>` : ''}
    ${now.length ? `<path d="${svgPath(now)}" ${stroke('--path-infill', lw)}/>` : ''}
    <path d="${svgPath(extraWall ? [...wallLoops, extraWall] : wallLoops, true)}" ${stroke('--path-outer', lw)}/>
  </svg>`;
}

/** Insert the tiles under the "Infill pattern" row and keep them in sync with settings. */
export function initInfillPreview() {
  const sel = document.getElementById('f_infill');
  if (!sel) return;
  const box = document.createElement('div');
  box.className = 'infill-preview';
  sel.closest('.row').after(box);

  let timer = 0;
  const render = () => {
    const sp = Math.max(S.lineW * 2, S.infillSpacing);
    const R = Math.min(150, Math.max(40, sp * 3));            // a few cells across, whatever the spacing
    const cur = PATTERNS.find(p => p.id === S.infill) ?? PATTERNS[0];
    box.innerHTML = `
      <div class="infill-tiles" role="radiogroup" aria-label="Infill pattern">
        ${PATTERNS.map(p => `
          <button type="button" class="infill-tile${p.id === cur.id ? ' on' : ''}" role="radio"
                  aria-checked="${p.id === cur.id}" data-id="${p.id}" title="${p.desc}">
            ${tileSVG(p.id, R)}<span>${p.name}</span>
          </button>`).join('')}
      </div>
      <div class="infill-legend">
        <span><i style="background:var(--path-outer)"></i>Walls</span>
        <span><i style="background:var(--path-infill)"></i>This layer</span>
        <span><i style="background:var(--path-infill-next)"></i>Next layer</span>
        <span class="muted">Sample Ø${Math.round(2 * R)} mm, top view</span>
      </div>
      <small class="infill-desc"><b>${cur.name}:</b> ${cur.desc}</small>`;
    box.querySelectorAll('.infill-tile').forEach(t =>
      t.addEventListener('click', () => update({ infill: t.dataset.id })));
  };

  onChange(keys => {
    if (!keys.some(k => KEYS.has(k))) return;
    clearTimeout(timer);
    timer = setTimeout(render, 60);                           // coalesce quick edits (e.g. typing a number)
  });
  render();
}
