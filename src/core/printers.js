// Printer presets. `values` are settings applied when the preset is chosen;
// `frame` sizes the schematic printer model in viewer/printer-model.js.
// No imports from settings.js: settings.js uses this file for its defaults.

/** Preset used for first-time visitors and "Reset to defaults". */
export const DEFAULT_PRINTER = 'wasp2040';

export const PRINTERS = {
  // Delta WASP 2040 Clay: Ø200 × 400 mm build volume, 2 mm LDM nozzle (1.2 mm also shipped), 3 L tank,
  // 150 mm/s print and travel, 500 mm/s², min layer 0.5 mm; firmware is WASP's own (Marlin-based, unverified).
  // Sources (retailer / lab listings; no WASP datasheet found):
  //   https://daemon3dprint.com/main/delta-wasp-20-40-clay.html
  //   https://burg-halle.de/en/university/facilities/burglabs/biolab/infrastructure-biolab/3d-printer
  wasp2040: {
    name: 'Delta WASP 2040 Clay',
    values: {
      printerName: 'Delta WASP 2040 Clay',
      bedX: 200, bedZ: 400,
      nozzle: 2, extruderType: 'auger',       // LDM: pressurized tank feeding a screw extruder
      reservoir: 3000,
      maxSpeed: 150, travelSpeed: 150,
      flavor: 'marlin',
    },
    // Machine 490 × 440 × 870 mm overall (the base and the thin build platform sit under the bed surface).
    frame: { footprint: 490, height: 870 },
  },
};
