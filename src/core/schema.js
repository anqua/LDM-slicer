// Settings definition. Drives the sidebar forms and supplies defaults.
// Printer `def` values are generic fallbacks; the default preset (core/printers.js) overrides them.
// Field: { k, label, def, type?: 'num'|'select'|'text'|'area', unit?, step?, opts?, help? }
// Heading: { h }
export const SCHEMA = {
  printer: [
    { h: 'Machine' },
    { k: 'printerName', label: 'Printer name', type: 'text', def: 'My clay printer' },
    { k: 'bedX', label: 'Bed width (X)', unit: 'mm', def: 300 },
    { k: 'bedY', label: 'Bed depth (Y)', unit: 'mm', def: 300 },
    { k: 'bedZ', label: 'Max height (Z)', unit: 'mm', def: 400 },
    { k: 'origin', label: 'Origin (0,0)', type: 'select', def: 'corner',
      opts: [['corner', 'Front-left corner'], ['center', 'Bed center']] },
    { k: 'bedShape', label: 'Bed shape', type: 'select', def: 'rect',
      opts: [['rect', 'Rectangular'], ['round', 'Round (delta)']] },
    { h: 'Extruder' },
    { k: 'nozzle', label: 'Nozzle diameter', unit: 'mm', def: 3, step: 0.1 },
    { k: 'extruderType', label: 'Extruder type', type: 'select', def: 'piston',
      opts: [['piston', 'Piston / ram'], ['auger', 'Auger / screw'], ['pneumatic', 'Pneumatic']] },
    { k: 'eMode', label: 'E value meaning', type: 'select', def: 'filament',
      opts: [['filament', 'Virtual filament length'], ['volumetric', 'Volume (mm³)']],
      help: 'How your firmware interprets the E axis.' },
    { k: 'filDia', label: 'Virtual filament Ø', unit: 'mm', def: 1.75, step: 0.01,
      help: 'Only for "virtual filament". Calibrate with flow %.' },
    { k: 'reservoir', label: 'Clay capacity', unit: 'ml', def: 1000,
      help: 'Used later to warn if a print needs more clay.' },
    { h: 'Speeds limits' },
    { k: 'maxSpeed', label: 'Max print speed', unit: 'mm/s', def: 60 },
    { k: 'travelSpeed', label: 'Travel speed', unit: 'mm/s', def: 80 },
    { h: 'G-code' },
    { k: 'flavor', label: 'Firmware', type: 'select', def: 'marlin',
      opts: [['marlin', 'Marlin'], ['klipper', 'Klipper'], ['reprap', 'RepRapFirmware'], ['grbl', 'GRBL']] },
    { k: 'startG', label: 'Start G-code', type: 'area',
      def: 'G21 ; millimeters\nG90 ; absolute XYZ\nM83 ; relative E\nG28 ; home all\nG92 E0' },
    { k: 'endG', label: 'End G-code', type: 'area',
      def: 'G91\nG1 Z20 F600 ; lift nozzle\nG90\nM84 ; motors off' },
  ],
  paths: [
    { h: 'Layers' },
    { k: 'layerH', label: 'Layer height', unit: 'mm', def: 0.7, step: 0.1,     // ≈60 % of the 1.2 mm WASP nozzle
      help: 'Typically 50–70 % of nozzle diameter for clay.' },
    { k: 'lineW', label: 'Line width', unit: 'mm', def: 1.4, step: 0.1,        // ≈120 % of the 1.2 mm WASP nozzle
      help: 'Typically 110–130 % of nozzle diameter.' },
    { k: 'mode', label: 'Path mode', type: 'select', def: 'spiral',
      opts: [['spiral', 'Spiral vase (continuous)'], ['layered', 'Layer by layer']] },
    { h: 'Walls & bottom' },
    { k: 'walls', label: 'Wall count', def: 1, step: 1, help: 'Spiral mode always uses 1 wall.' },
    { k: 'wallOrder', label: 'Wall order', type: 'select', def: 'outer',
      opts: [['outer', 'Outer first'], ['inner', 'Inner first']] },
    { k: 'bottomLayers', label: 'Solid bottom layers', def: 3, step: 1 },
    { k: 'infillAngle', label: 'Bottom fill angle', unit: '°', def: 45 },
    { k: 'seam', label: 'Seam position', type: 'select', def: 'rear',
      opts: [['rear', 'Aligned at rear'], ['nearest', 'Nearest point'], ['random', 'Random']] },
    { h: 'Extrusion' },
    { k: 'flow', label: 'Flow', unit: '%', def: 100 },
    { k: 'retract', label: 'Retraction', unit: 'mm', def: 0, step: 0.1, help: 'Often 0 for clay.' },
    { k: 'zhop', label: 'Z-hop on travel', unit: 'mm', def: 0, step: 0.5 },
    { h: 'Speed' },
    { k: 'speed', label: 'Print speed', unit: 'mm/s', def: 25 },
    { k: 'firstSpeed', label: 'First layer speed', unit: 'mm/s', def: 15 },
    { k: 'minLayerTime', label: 'Min layer time', unit: 's', def: 0,
      help: 'Slows small layers so clay can firm up.' },
    { h: 'Priming' },
    { k: 'skirtLoops', label: 'Skirt loops', def: 1, step: 1 },
    { k: 'skirtDist', label: 'Skirt distance', unit: 'mm', def: 10 },
  ],
  model: [
    { h: 'Transform' },
    { k: 'scale', label: 'Scale', unit: '%', def: 100 },
    { k: 'offX', label: 'Offset X', unit: 'mm', def: 0 },
    { k: 'offY', label: 'Offset Y', unit: 'mm', def: 0 },
  ],
};

// Settings that change the build volume / bed, and those that change the model placement.
export const BED_KEYS = new Set(['bedX', 'bedY', 'bedZ', 'origin', 'bedShape']);
export const TRANSFORM_KEYS = new Set(['scale', 'offX', 'offY']);
