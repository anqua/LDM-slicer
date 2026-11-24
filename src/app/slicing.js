// Slicing in the app: runs the pipeline for the loaded model, keeps the result, shows it, drops it when it goes stale.
import { S, save } from '../core/settings.js';
import { sliceModel } from '../pipeline.js';
import { applyDeps } from '../ui/form.js';

/**
 * @param c { model, toolpath, panel, playback }
 * @returns { run(nonStandard), invalidate(message), setExact(v), download(), result }
 */
export function createSlicing({ model, toolpath, panel, playback }) {
  let result = null;                                    // { tp, gcode } of the current slice

  /** Draw the current slice: from the exported G-code itself (exact) or from the slicer paths. */
  function showPaths() {
    toolpath.setMode(S.viewMode);
    if (S.gcodeExact) toolpath.setFromGcode(result.gcode.text, result.tp.layers.length, [0, 0, S.bedZ], S);
    else toolpath.set(result.tp, S);
  }

  /** Slice the loaded model. `nonStandard`: use the non-standard engine (S.npMode); otherwise the standard slicer. */
  function run(nonStandard = false) {
    nonStandard = nonStandard === true;                 // also called from the S key and click events
    S.sliceKind = nonStandard ? "np" : "standard"; save(); applyDeps();   // the Slice menu marks the way last used
    const pos = model.positions();
    if (!pos) return;
    if (!model.fits() && !confirm('The model is outside the build volume. Slice anyway?')) return;
    panel.busy(true, nonStandard);
    setTimeout(() => {                                  // let the button repaint before the (synchronous) work
      try {
        result = sliceModel(pos, S, { top: model.bounds().max.z, modelName: model.name(), nonStandard });
        playback.setPlaying(false);
        showPaths();
        model.setVisible(false);
        panel.show(result.tp, result.gcode.stats, S, toolpath.duration);
        playback.show(toolpath.duration);
      } catch (e) {
        console.error(e);
        alert('Slicing failed: ' + e.message);
      } finally {
        panel.busy(false);
      }
    }, 30);
  }

  /** Forget the slice (model or settings changed). */
  function invalidate(message) {
    if (!result && !toolpath.active) return;
    result = null;
    playback.reset();
    toolpath.clear();
    model.setVisible(true);
    panel.reset(message);
  }

  return {
    run, invalidate,
    get result() { return result; },
    /** Exact G-code view on or off: a view preference, the slice stays and the time on the clock is kept in proportion. */
    setExact(v) {
      S.gcodeExact = v; save();
      if (!result) return;
      const frac = toolpath.duration ? playback.sim.t / toolpath.duration : 1;
      playback.setPlaying(false);
      showPaths();
      panel.setTotal(toolpath.duration);
      playback.show(frac * toolpath.duration);
    },
    setViewMode(v) { S.viewMode = v; save(); toolpath.setMode(v); },
    /** Save the G-code as a file. */
    download() {
      if (!result) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([result.gcode.text], { type: 'text/plain' }));
      a.download = (model.name() || 'model').replace(/\.stl$/i, '').replace(/[^\w-]+/g, '_') + '.gcode';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };
}
