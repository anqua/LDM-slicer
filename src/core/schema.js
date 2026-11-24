import { TPMS } from '../slicer/infill.js';
import { STYLES, styleSchemaFields } from '../nonstandard/styles.js';

// Settings definition. Drives the sidebar forms and supplies defaults.
// Printer `def` values are generic fallbacks; the default preset (core/printers.js) overrides them.
// Field: { k, label, def, type?: 'num'|'select'|'text'|'area', unit?, step?, min?, max?, opts?, help? }
// min/max: numeric bounds, enforced by the form (clamp) and on load (out-of-range saved values reset to default).
// off: [key, values], or a list of such pairs: the row is greyed out and disabled while any of those settings has one of its values (it has no effect then).
// Heading: { h }
const NOT_LINES = ['none', 'zigzag', ...Object.keys(TPMS)];            // infill patterns that ignore the infill angle
const NOT_ZIGZAG = ['none', 'lines', 'grid', ...Object.keys(TPMS)];   // patterns without the zig-zag width
export const SCHEMA = {
  printer: [
    { h: 'Machine' },
    { k: 'printerName', label: 'Printer name', type: 'text', def: 'My clay printer' },
    // Round delta bed only (WASP 2040), origin at the bed center. `bedX` is the diameter.
    { k: 'bedX', min: 50, max: 1000, label: 'Bed diameter', unit: 'mm', def: 200 },
    { k: 'bedZ', min: 20, max: 2000, label: 'Max height (Z)', unit: 'mm', def: 400 },
    { h: 'Extruder' },
    { k: 'nozzle', label: 'Nozzle diameter', unit: 'mm', def: 2, step: 0.1, min: 1.5, max: 3,
      help: 'Supported range 1.5–3 mm.' },
    { k: 'extruderType', label: 'Extruder type', type: 'select', def: 'piston',
      opts: [['piston', 'Piston / ram'], ['auger', 'Auger / screw'], ['pneumatic', 'Pneumatic']] },
    { k: 'eMode', label: 'E value meaning', type: 'select', def: 'filament',
      opts: [['filament', 'Virtual filament length'], ['volumetric', 'Volume (mm³)']],
      help: 'How your firmware interprets the E axis.' },
    { k: 'filDia', min: 0.5, max: 10, label: 'Virtual filament Ø', unit: 'mm', def: 1.75, step: 0.01,
      help: 'Only for "virtual filament". Calibrate with flow %.' },
    { k: 'reservoir', min: 1, max: 100000, label: 'Clay capacity', unit: 'ml', def: 1000,
      help: 'Used later to warn if a print needs more clay.' },
    { k: 'clayDensity', min: 0.5, max: 4, label: 'Clay density', unit: 'g/cm³', def: 1.9, step: 0.05,
      help: 'Weight of the wet clay per ml, to turn the clay volume of a slice into grams. Wet stoneware / porcelain is about 1.7–2.1: to calibrate, weigh a known volume of your own clay.' },
    { h: 'Speeds limits' },
    { k: 'maxSpeed', min: 1, max: 500, label: 'Max print speed', unit: 'mm/s', def: 60 },
    { k: 'travelSpeed', min: 1, max: 1000, label: 'Travel speed', unit: 'mm/s', def: 80 },
    { h: 'G-code' },
    { k: 'flavor', label: 'Firmware', type: 'select', def: 'marlin',
      opts: [['marlin', 'Marlin'], ['klipper', 'Klipper'], ['reprap', 'RepRapFirmware'], ['grbl', 'GRBL']] },
    { k: 'startG', label: 'Start G-code', type: 'area',
      def: 'G21 ; millimeters\nG90 ; absolute XYZ\nM83 ; relative E\nG28 ; home all\nG92 E0' },
    { k: 'endG', label: 'End G-code', type: 'area',
      def: 'M84 ; motors off',
      help: 'Runs after the head has been sent to the max height (Z), which the slicer always does at the end of the print.' },
  ],
  paths: [
    { h: 'Layers' },
    { k: 'layerH', min: 0.05, max: 6, label: 'Layer height', unit: 'mm', def: 1.2, step: 0.1,     // 60 % of the 2 mm WASP nozzle
      help: 'Typically 50–70 % of nozzle diameter for clay.' },
    { k: 'lineW', min: 0.2, max: 12, label: 'Line width', unit: 'mm', def: 2.4, step: 0.1,        // 120 % of the 2 mm WASP nozzle
      help: 'Width of the bead on the print, across the line. Typically 110–130 % of the nozzle diameter, about twice the layer height.' },
    { k: 'mode', label: 'Path mode', type: 'select', def: 'layered', off: ['printParts', ['infill']],
      opts: [['layered', 'Layer by layer'], ['spiral', 'Spiral vase']] },
    { k: 'printParts', label: 'Print', type: 'select', def: 'all',
      opts: [['all', 'Walls and infill'], ['infill', 'Infill only']],
      help: 'Infill only prints the infill and the bottom layers, without the outer walls; the infill then reaches the outline. Layer by layer only, and it needs an infill pattern.' },
    { h: 'Walls' },
    { k: 'walls', min: 1, max: 20, label: 'Wall count', def: 1, step: 1, off: [['printParts', ['infill']], ['mode', ['spiral']]], help: 'The spiral always prints 1 wall. Not used with Infill only.' },
    { k: 'wallOrder', label: 'Wall order', type: 'select', def: 'outer', off: [['printParts', ['infill']], ['mode', ['spiral']]],
      opts: [['outer', 'Outer first'], ['inner', 'Inner first']] },
    // Bottom layers: the infill inside the walls of the first N layers, controlled independently of
    // the infill above. Walls on these layers keep the wall settings.
    { h: 'Top and bottom layers' },
    { k: 'bottomLayers', label: 'Bottom layers', def: 3, step: 1, min: 0, max: 50,
      help: 'Number of layers at the base with their own infill. 0 = no base (open bottom).' },
    { k: 'capTop', label: 'Top', type: 'select', def: 'closed', off: ['mode', ['spiral']],
      opts: [['closed', 'Closed (cap the top)'], ['open', 'Open (no cap)']],
      help: 'Closed prints solid layers under every open surface of the model (its lid, the top of each step). Open leaves the top as the walls and infill leave it. Layer by layer only.' },
    { k: 'topLayers', label: 'Top layers', def: 3, step: 1, min: 0, max: 50, off: [['mode', ['spiral']], ['capTop', ['open']]],
      help: 'Solid layers that close the top of the model, wherever nothing is printed above (a lid, or the top of each step). They use the pattern, spacing, flow and speed below. 0 = open top. Layer by layer only.' },
    { k: 'bottomPattern', label: 'Infill pattern', type: 'select', def: 'lines',
      opts: [['lines', 'Lines'], ['grid', 'Grid'], ['concentric', 'Concentric']],
      help: 'Lines turn 90° every layer. Grid prints both directions on every layer. Concentric follows the outline; its middle is filled with lines.' },
    { k: 'bottomAngle', min: -360, max: 360, label: 'Angle', unit: '°', def: 45,
      help: 'Direction of the bottom lines (lines, grid, and the middle of concentric).' },
    { k: 'bottomSpacingX', label: 'Line spacing', unit: '× nozzle', def: 2.4, step: 0.05, min: 0.25, max: 20,
      help: 'Distance between bottom lines as a multiple of the nozzle diameter (1 × a 2 mm nozzle = 2 mm). Default 2.4 (4.8 mm for a 2 mm nozzle). About 1.2 × nozzle makes the lines touch; below that they overlap for a denser base, above it leaves gaps.' },
    { k: 'bottomFlow', label: 'Flow multiplier', unit: '%', def: 70, step: 5, min: 10, max: 300,
      help: 'Material for the bottom infill, relative to the flow of the rest of the model (walls and infill above). Default 70 %.' },
    { k: 'bottomSpeed', label: 'Print speed', unit: 'mm/s', def: 20, min: 1, max: 300,
      help: 'Speed of the bottom infill. The first layer uses "First layer speed".' },
    { h: 'Infill' },
    { k: 'infill', label: 'Infill pattern', type: 'select', def: 'none',
      opts: [['none', 'None (hollow)'], ['zigzag', 'Zig-zag between walls'], ['lines', 'Lines'], ['grid', 'Grid'],
        ...Object.entries(TPMS).map(([id, d]) => [id, d.name])],        // minimal surfaces, from slicer/infill.js
      off: ['mode', ['spiral']], help: 'Layer-by-layer mode only (greyed out for the continuous helix). The base uses the Top and bottom layers settings.' },
    { k: 'infillAngle', min: -360, max: 360, label: 'Infill angle', unit: '°', def: 45, off: [['mode', ['spiral']], ['infill', NOT_LINES]],
      help: 'Direction of lines / grid infill.' },
    { k: 'infillSpacing', min: 1, max: 200, label: 'Infill spacing', unit: 'mm', def: 20, off: ['mode', ['spiral']],
      help: 'Line distance for lines / grid, wave length for zig-zag, cell size (one repeat of the pattern) for the minimal surfaces.' },
    { k: 'zigzagWidth', min: 1, max: 100, label: 'Zig-zag width', unit: 'mm', def: 15, off: [['mode', ['spiral']], ['infill', NOT_ZIGZAG]],
      help: 'Zig-zag only: distance from the walls to an extra inner wall, with the zig-zag in between.' },
    { k: 'seam', label: 'Seam position', type: 'select', def: 'rear', off: ['printParts', ['infill']],
      opts: [['rear', 'Aligned at rear'], ['angle', 'At the seam angle'], ['nearest', 'Nearest point'], ['random', 'Random']],
      help: 'Layer by layer only. "At the seam angle" starts every wall where the ray at the Seam angle leaves the part.' },
    { k: 'seamAngle', label: 'Seam angle', unit: '°', def: 90, step: 5, min: 0, max: 360,
      help: 'Where the seam is: the direction, seen from above, in which each turn of the wall starts and ends. 0° = right, 90° = rear (default), 180° = left, 270° = front. Used by the spiral, by every non-standard slice, and by layer by layer with "At the seam angle".' },
    { h: 'Extrusion' },
    { k: 'flow', min: 10, max: 300, label: 'Flow', unit: '%', def: 100 },
    { k: 'retract', min: 0, max: 20, label: 'Retraction', unit: 'mm', def: 0, step: 0.1, help: 'Often 0 for clay.' },
    { k: 'zhop', min: 0, max: 50, label: 'Z-hop on travel', unit: 'mm', def: 0, step: 0.5 },
    { h: 'Speed' },
    { k: 'speed', min: 1, max: 300, label: 'Print speed', unit: 'mm/s', def: 25 },
    { k: 'firstSpeed', min: 1, max: 300, label: 'First layer speed', unit: 'mm/s', def: 15 },
    { k: 'minLayerTime', min: 0, max: 600, label: 'Min layer time', unit: 's', def: 0,
      help: 'Slows small layers so clay can firm up.' },
    // Start and end of print / paths. Modeled on Termite (Jauk, TU Graz): priming paths,
    // first layer height, pre-fill, safe start and safe end.
    { h: 'Start of print' },
    { k: 'skirtLoops', min: 0, max: 20, label: 'Priming loops (skirt)', def: 0, step: 1,
      help: 'Loops around the part before it starts, so clay is flowing evenly. 0 = none.' },
    { k: 'skirtDist', min: 0, max: 100, label: 'Priming loop distance', unit: 'mm', def: 10 },
    { k: 'firstLayerH', label: 'First layer height', unit: 'mm', def: 0, step: 0.1, min: 0, max: 10,
      help: '0 = same as the layer height (recommended). A first layer much thinner than the others squashes the clay under the nozzle and over-fills it: a 3 mm nozzle at 0.7 mm squeezes a 3.6 mm line out sideways.' },
    { k: 'preFill', min: 0, max: 50, label: 'Pre-fill', unit: 'mm', def: 2, step: 0.5,
      help: 'Clay pushed out in place before the first move, as mm of bead. Builds pressure; useful for big nozzles. 0 = off.' },
    { k: 'safeStartLen', min: 0, max: 100, label: 'Safe start length', unit: 'mm', def: 6,
      help: 'The first mm of every path are printed slowly so starts are not thin. 0 = off.' },
    { k: 'safeStartSpeed', min: 1, max: 300, label: 'Safe start speed', unit: 'mm/s', def: 12 },
    { h: 'End of paths' },
    { k: 'safeEndLen', min: 0, max: 100, label: 'Safe end length', unit: 'mm', def: 6,
      help: 'The last mm of every path slow down and ease off the flow so ends do not lift. 0 = off.' },
    { k: 'safeEndSpeed', min: 1, max: 300, label: 'Safe end speed', unit: 'mm/s', def: 12 },
    { k: 'safeEndFlow', min: 10, max: 100, label: 'Safe end final flow', unit: '%', def: 60,
      help: 'Flow at the very end of a path; it ramps down to this from full flow.' },
    // Used by the Slice button's non-standard styles (src/nonstandard/). `dep`: [key, values]: the row
    // is only shown while that setting has one of these values.
    { h: 'Non-standard slice' },
    { k: 'npMode', label: 'Style', type: 'select', def: 'curved',
      opts: [...Object.entries(STYLES).map(([id, s]) => [id, s.label]), ['zones', 'Zones']],
      help: 'Also chosen from the Slice button. Curved: the layers themselves follow a wave, ripple or cone. Ruffled wall: a plain wall with extra flow at intervals, which swells the bead into a texture. Loop texture: the wall path curls into small loops between two heights.' },
    ...styleSchemaFields(),                // the settings of each style, from nonstandard/styles.js
  ],
  model: [
    { h: 'Transform' },
    { k: 'scale', min: 1, max: 1000, label: 'Scale', unit: '%', def: 100 },
    { k: 'offX', min: -1000, max: 1000, label: 'Offset X', unit: 'mm', def: 0 },
    { k: 'offY', min: -1000, max: 1000, label: 'Offset Y', unit: 'mm', def: 0 },
  ],
};

// Settings that change the build volume / bed, and those that change the model placement.
export const BED_KEYS = new Set(['bedX', 'bedZ']);
export const TRANSFORM_KEYS = new Set(['scale', 'offX', 'offY']);
