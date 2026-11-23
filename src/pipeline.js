// The whole slicing pipeline in one place: mesh -> toolpaths -> G-code.
// The app (main.js) and the regression tests (tests/) both call this, so what is tested is what runs.
import { layerHeights, sliceMesh } from './slicer/slice.js';
import { buildToolpaths } from './slicer/paths.js';
import { toGcode } from './slicer/gcode.js';
import { buildNonStandard } from './nonstandard/engine.js';


/** Warn when the priming loops (skirt) or the print leave the round bed, which the model's own fit check does not see. */
function bedWarnings(tp, S) {
  const R = S.bedX / 2 + 0.05;
  let skirt = 0, other = 0;
  for (const l of tp.layers) for (const p of l.paths) {
    let r = 0;
    for (const q of p.pts) r = Math.max(r, Math.hypot(q[0], q[1]));
    if (p.type === 'skirt') skirt = Math.max(skirt, r); else other = Math.max(other, r);
  }
  const out = [];
  if (skirt > R && other <= R) out.push(`The priming loops reach ${skirt.toFixed(0)} mm from the bed center, past the bed edge (${(S.bedX / 2).toFixed(0)} mm). Lower the priming loop distance or count (Start of print), or scale the model down.`);
  else if (other > R) out.push(`The print reaches ${other.toFixed(0)} mm from the bed center, past the bed edge (${(S.bedX / 2).toFixed(0)} mm).`);
  return out;
}
/**
 * @param pos  triangle soup (world coordinates, z up, model on z = 0)
 * @param S    settings
 * @param opts { top: model height, modelName, nonStandard: use the non-standard engine (curved / ruffle / loops / zones) }
 * @returns { tp: { layers, warnings }, gcode: { text, stats } }
 */
export function sliceModel(pos, S, { top, modelName = '', nonStandard = false }) {
  let tp, note = '';
  if (nonStandard) {
    const r = buildNonStandard(pos, S, top);
    tp = r.tp;
    note = `${r.note} · Z up to ${r.zMax.toFixed(1)} mm`;
  } else {
    const sliced = sliceMesh(pos, layerHeights(top, S.firstLayerH || S.layerH, S.layerH), Math.max(0.02, S.lineW * 0.03));
    tp = buildToolpaths(sliced, S);
  }
  tp.warnings = [...tp.warnings, ...bedWarnings(tp, S)];
  return { tp, gcode: toGcode(tp, S, { modelName, note }) };
}
