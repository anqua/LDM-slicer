// The whole slicing pipeline in one place: mesh -> toolpaths -> G-code.
// The app (main.js) and the regression tests (tests/) both call this, so what is tested is what runs.
import { layerHeights, sliceMesh } from './slicer/slice.js';
import { buildToolpaths } from './slicer/paths.js';
import { toGcode } from './slicer/gcode.js';
import { buildNonStandard } from './nonstandard/engine.js';

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
  return { tp, gcode: toGcode(tp, S, { modelName, note }) };
}
