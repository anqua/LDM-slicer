// Printer presets. `values` are settings applied when the preset is chosen;
// `frame` sizes the schematic printer model in viewer/printer-model.js.
// No imports from settings.js: settings.js uses this file for its defaults.

/** Preset used for first-time visitors and "Reset to defaults". */
export const DEFAULT_PRINTER = 'wasp2040';

export const PRINTERS = {
  // Sources (retailer / lab listings; no WASP datasheet found):
  //   https://daemon3dprint.com/main/delta-wasp-20-40-clay.html
  //   https://burg-halle.de/en/university/facilities/burglabs/biolab/infrastructure-biolab/3d-printer
  wasp2040: {
    name: 'Delta WASP 2040 Clay',
    notes: 'Ø200 × 400 mm build volume · 1.2 mm LDM nozzle (2 mm included) · 3 L tank · '
      + '150 mm/s print and travel · 500 mm/s² · min layer 0.5 mm. Firmware is WASP\'s own '
      + '(Marlin-based, unverified).',
    values: {
      printerName: 'Delta WASP 2040 Clay',
      bedShape: 'round', origin: 'center',
      bedX: 200, bedY: 200, bedZ: 400,
      nozzle: 1.2, extruderType: 'auger',     // LDM: pressurized tank feeding a screw extruder
      reservoir: 3000,
      maxSpeed: 150, travelSpeed: 150,
      flavor: 'marlin',
    },
    // Machine 490 × 440 × 870 mm. `below`: frame base below the bed surface (estimate).
    frame: { kind: 'delta', footprint: 490, height: 870, below: 120, tankLiters: 3 },
  },
};

/** Keys whose current value differs from the preset. */
export function presetDiff(id, s) {
  const p = PRINTERS[id];
  if (!p) return [];
  return Object.entries(p.values).filter(([k, v]) => s[k] !== v).map(([k]) => k);
}
