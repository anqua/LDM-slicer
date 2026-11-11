// Settings store: one plain object `S`, persisted to localStorage, with change notifications.
// All writes that should reach the UI/scene go through update(patch).
import { SCHEMA } from './schema.js';
import { PRINTERS, DEFAULT_PRINTER } from './printers.js';

// Key kept from the first version so existing saved settings survive renames.
export const STORE_KEY = 'claySlicer.settings.v1';

// Defaults: schema values, overridden by the default printer preset.
const defaults = {};
for (const group of Object.values(SCHEMA)) for (const f of group) if (f.k) defaults[f.k] = f.def;
Object.assign(defaults, PRINTERS[DEFAULT_PRINTER].values, { printerPreset: DEFAULT_PRINTER });
// View preferences. `printerVisible` replaces `showPrinter`, which was force-saved as false on every load.
Object.assign(defaults, { printerVisible: true });

// Printer defaults before the WASP preset existed. A saved state with no `printerPreset` key
// whose printer values all still equal these was never customized: move it to the new default.
const LEGACY_PRINTER = {
  printerName: 'My clay printer', bedX: 300, bedY: 300, bedZ: 400, origin: 'corner', bedShape: 'rect',
  nozzle: 3, extruderType: 'piston', reservoir: 1000, maxSpeed: 60, travelSpeed: 80, flavor: 'marlin',
};
const LEGACY_PATHS = { layerH: 1.8, lineW: 3.6 };

function migrate(saved) {
  if ('printerPreset' in saved) return saved;
  const untouched = obj => Object.entries(obj).every(([k, v]) => !(k in saved) || saved[k] === v);
  const out = { ...saved };
  if (untouched(LEGACY_PRINTER)) {
    for (const k of Object.keys(LEGACY_PRINTER)) delete out[k];
    if (untouched(LEGACY_PATHS)) for (const k of Object.keys(LEGACY_PATHS)) delete out[k];
  } else {
    out.printerPreset = '';            // customized machine: keep it, shown as "Custom"
  }
  return out;
}

export const S = { ...defaults };
try { Object.assign(S, migrate(JSON.parse(localStorage.getItem(STORE_KEY) || '{}'))); } catch { /* storage unavailable */ }
delete S.palette; delete S.font; delete S.showPrinter;   // obsolete keys
delete S.bedY; delete S.origin; delete S.bedShape;      // rectangular beds removed: WASP 2040 (round, centered) only

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
