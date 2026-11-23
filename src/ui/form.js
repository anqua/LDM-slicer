// Renders SCHEMA fields as form rows and keeps them two-way bound to the settings store.
import { S, update, onChange } from '../core/settings.js';

const inputs = new Map();        // setting key -> input element

function fieldHTML(f) {
  if (f.h) return `<h3>${f.h}</h3>`;
  const id = 'f_' + f.k;
  const help = f.help ? `<small>${f.help}</small>` : '';
  if (f.type === 'area')
    return `<div class="field-area"><label for="${id}">${f.label}</label><textarea id="${id}" spellcheck="false"></textarea></div>`;
  let input;
  if (f.type === 'select')
    input = `<select id="${id}">${f.opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
  else if (f.type === 'text')
    input = `<input id="${id}" type="text">`;
  else {
    // Room on the right for the unit label; longer units (e.g. "× nozzle") need more than the default.
    const pad = f.unit && f.unit.length > 4 ? ` style="padding-right:${12 + f.unit.length * 7}px"` : '';
    input = `<div class="unit"><input id="${id}" type="number" step="${f.step ?? 'any'}"${pad}`
      + `${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}>`
      + `${f.unit ? `<span>${f.unit}</span>` : ''}</div>`;
  }
  const dep = f.dep ? ` data-dep="${f.dep[0]}" data-vals="${f.dep[1].join(',')}"` : '';
  return `<div class="row"${dep}><label for="${id}">${f.label}</label>${input}${help}</div>`;
}

/** Show a row only while the setting it depends on has one of its values. */
function applyDeps() {
  for (const row of document.querySelectorAll('[data-dep]'))
    row.hidden = !row.dataset.vals.split(',').includes(String(S[row.dataset.dep]));
}

// Sections: every heading in a pane opens and closes its own group of settings. The first group of a pane starts
// open, the others closed; what the user opens is remembered (this browser only).
const SECTION_KEY = 'ldm.sections.v1';
const readSections = () => { try { return JSON.parse(localStorage.getItem(SECTION_KEY) || '{}'); } catch { return {}; } };
const writeSections = s => { try { localStorage.setItem(SECTION_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

function groupedHTML(paneId, fields) {
  const state = readSections();
  let html = '', open = false;
  const end = () => { if (open) html += '</div></div>'; open = false; };
  fields.forEach((f, i) => {
    if (!f.h) { html += fieldHTML(f); return; }
    end();
    const id = paneId + ':' + f.h, isOpen = state[id] ?? i === 0;
    html += `<div class="grp${isOpen ? ' open' : ''}" data-grp="${id}"><button type="button" class="grp-h" aria-expanded="${isOpen}">${f.h}</button><div class="grp-body">`;
    open = true;
  });
  end();
  return html;
}

function wireGroups(container) {
  container.querySelectorAll('.grp-h').forEach(btn => btn.addEventListener('click', () => {
    const g = btn.parentElement, on = !g.classList.contains('open');
    g.classList.toggle('open', on);
    btn.setAttribute('aria-expanded', String(on));
    const s = readSections(); s[g.dataset.grp] = on; writeSections(s);
  }));
}

const isNumeric = f => !f.type || f.type === 'num';

/** Render fields into a container, with optional extra HTML before/after. */
export function renderFields(container, fields, { before = '', after = '' } = {}) {
  container.innerHTML = before + groupedHTML(container.id, fields) + after;
  for (const f of fields) {
    if (!f.k) continue;
    const el = container.querySelector('#f_' + f.k);
    el.value = S[f.k];
    inputs.set(f.k, el);
    const live = f.type === 'area' || f.type === 'text';
    el.addEventListener(live ? 'input' : 'change', () => {
      let v = isNumeric(f) ? parseFloat(el.value) : el.value;
      if (isNumeric(f)) {
        if (!Number.isFinite(v)) { el.value = S[f.k]; return; }
        if (f.min != null) v = Math.max(f.min, v);       // clamp to the field's range
        if (f.max != null) v = Math.min(f.max, v);
        el.value = v;
      }
      update({ [f.k]: v });
    });
  }
  applyDeps();
  wireGroups(container);
}

// Reflect programmatic changes (e.g. "Scale to fit bed") back into the inputs.
onChange(keys => {
  applyDeps();
  for (const k of keys) {
    const el = inputs.get(k);
    if (el && document.activeElement !== el) el.value = S[k];
  }
});
