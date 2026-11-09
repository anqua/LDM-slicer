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
  else
    input = `<div class="unit"><input id="${id}" type="number" step="${f.step ?? 'any'}">${f.unit ? `<span>${f.unit}</span>` : ''}</div>`;
  return `<div class="row"><label for="${id}">${f.label}</label>${input}${help}</div>`;
}

const isNumeric = f => !f.type || f.type === 'num';

/** Render fields into a container, with optional extra HTML before/after. */
export function renderFields(container, fields, { before = '', after = '' } = {}) {
  container.innerHTML = before + fields.map(fieldHTML).join('') + after;
  for (const f of fields) {
    if (!f.k) continue;
    const el = container.querySelector('#f_' + f.k);
    el.value = S[f.k];
    inputs.set(f.k, el);
    const live = f.type === 'area' || f.type === 'text';
    el.addEventListener(live ? 'input' : 'change', () => {
      const v = isNumeric(f) ? parseFloat(el.value) : el.value;
      if (isNumeric(f) && !Number.isFinite(v)) { el.value = S[f.k]; return; }
      update({ [f.k]: v });
    });
  }
}

// Reflect programmatic changes (e.g. "Scale to fit bed") back into the inputs.
onChange(keys => {
  for (const k of keys) {
    const el = inputs.get(k);
    if (el && document.activeElement !== el) el.value = S[k];
  }
});
