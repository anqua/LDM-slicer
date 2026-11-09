// Settings store: one plain object `S`, persisted to localStorage, with change notifications.
// All writes that should reach the UI/scene go through update(patch).
import { SCHEMA } from './schema.js';

// Key kept from the first version so existing saved settings survive renames.
export const STORE_KEY = 'claySlicer.settings.v1';

const defaults = {};
for (const group of Object.values(SCHEMA)) for (const f of group) if (f.k) defaults[f.k] = f.def;

export const S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { /* storage unavailable */ }
delete S.palette; delete S.font;   // keys left over from removed UI experiments

const listeners = new Set();

export function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ }
}

/** Apply a patch, persist, and notify listeners with the list of keys in the patch. */
export function update(patch) {
  Object.assign(S, patch);
  save();
  const keys = Object.keys(patch);
  for (const fn of listeners) fn(keys);
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportSettings() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  a.download = (S.printerName || 'clay-printer').replace(/[^\w-]+/g, '_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Merge settings from a JSON file. Throws on invalid JSON. */
export async function importSettings(file) {
  const data = JSON.parse(await file.text());
  if (typeof data !== 'object' || data === null) throw new Error('not an object');
  Object.assign(S, data);
  save();
}

export function resetSettings() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
}
