// Regression test for the slicing pipeline: slices the demo vase with a set of settings and fingerprints the G-code.
// Open tests/index.html (through the local server) to run it. A change in a fingerprint means the output of the
// slicer changed: expected after a deliberate change (then run "Copy new baseline" and save it as baseline.json),
// a bug after a refactor.
import { DEFAULTS } from '../src/core/settings.js';
import { demoVaseGeometry } from '../src/model/demo.js';
import { sliceModel } from '../src/pipeline.js';

const ZONES = [
  { from: 0, to: 50, style: 'curved', p: { npAmp: 3 } },
  { from: 50, to: 100, style: 'standard', p: {} },
  { from: 100, to: 140, style: 'ruffle', p: { rfAmp: 3, rfLen: 40 } },
  { from: 140, to: 170, style: 'loops', p: {} },
  { from: 170, to: 180, style: 'standard', p: {} },
];

/** name -> [settings overrides, use the non-standard engine] */
export const CASES = {
  'standard layered':            [{ mode: 'layered', infill: 'none' }, false],
  'standard 2 walls gyroid':     [{ mode: 'layered', walls: 2, infill: 'gyroid', infillSpacing: 20 }, false],
  'standard zigzag':             [{ mode: 'layered', infill: 'zigzag' }, false],
  'standard concentric base':    [{ mode: 'layered', bottomPattern: 'concentric', infill: 'grid', infillSpacing: 30 }, false],
  'standard spiral':             [{ mode: 'spiral' }, false],
  'standard infill only':        [{ mode: 'layered', printParts: 'infill', infill: 'schwarzD', infillSpacing: 40 }, false],
  'non-standard curved':         [{ npMode: 'curved' }, true],
  'non-standard ruffle':         [{ npMode: 'ruffle' }, true],
  'non-standard loops':          [{ npMode: 'loops' }, true],
  'non-standard zones':          [{ npMode: 'zones', zones: ZONES }, true],
};

/** FNV-1a, 32 bit. Enough to tell two G-code files apart. */
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** @returns { [case name]: { hash, lines, warnings } } */
export function runCases() {
  const g = demoVaseGeometry();
  const pos = (g.index ? g.toNonIndexed() : g).getAttribute('position').array;
  const out = {};
  for (const [name, [over, nonStandard]] of Object.entries(CASES)) {
    const S = { ...structuredClone(DEFAULTS), ...over };
    const { tp, gcode } = sliceModel(pos, S, { top: 180, modelName: 'demo-vase.stl', nonStandard });
    const text = gcode.text.split('\n').filter(l => !l.startsWith('; Date:')).join('\n');   // the date changes every run
    out[name] = { hash: fnv(text), lines: text.split('\n').length, warnings: tp.warnings.length };
  }
  return out;
}
