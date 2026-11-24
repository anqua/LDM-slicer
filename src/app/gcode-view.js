// Opening a G-code file to look at it (from this slicer or another): read it, show it in the same preview as a slice
// (layer bar, play, Toolpath / Material, travel, printer), and describe it in the Model pane. While a file is open the
// Slice button is off; "Close G-code" goes back to the model.
import { S } from '../core/settings.js';
import { readGcode } from '../viewer/gcode-moves.js';

export const isGcode = file => /\.(gcode|gco|gc|g|nc|ngc|tap)$/i.test(file.name);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * @param c { model, toolpath, panel, playback, slicing, framed(): called after a file is shown }
 * @returns { active, open(file) -> Promise<boolean>, close() }
 */
export function createGcodeView({ model, toolpath, panel, playback, slicing, framed }) {
  let file = null, r = null, origin = 'center';

  /** Files made for a printer with its origin in a corner (most cartesian printers) sit in the +X +Y quarter of the bed. */
  function guessOrigin(st) {
    const R = S.bedX / 2;
    return st.min[0] >= -1 && st.min[1] >= -1 && (st.max[0] > R + 1 || st.max[1] > R + 1) && st.max[0] <= S.bedX + 1 && st.max[1] <= S.bedX + 1
      ? 'corner' : 'center';
  }

  /** The moves, moved so the bed center is the origin when the file's origin is a corner. Also fills the bed checks. */
  function placed() {
    const d = origin === 'corner' ? -S.bedX / 2 : 0;
    const moves = d ? r.moves.map(m => ({ ...m, a: [m.a[0] + d, m.a[1] + d, m.a[2]], b: [m.b[0] + d, m.b[1] + d, m.b[2]] })) : r.moves;
    let rad = 0, zMax = 0;
    for (const m of moves) if (m.extrude) { rad = Math.max(rad, Math.hypot(m.b[0], m.b[1])); zMax = Math.max(zMax, m.b[2]); }
    const warnings = [...r.warnings];
    if (rad > S.bedX / 2 + 1) warnings.push(`The file prints up to ${rad.toFixed(0)} mm from the bed center, past the bed edge (${(S.bedX / 2).toFixed(0)} mm).`
      + (origin === 'center' ? ' If the file uses a corner origin, set Origin to "Bed corner" in the Model tab.' : ''));
    if (zMax > S.bedZ + 0.01) warnings.push(`The file prints up to Z ${zMax.toFixed(0)} mm, above the max height (${S.bedZ} mm).`);
    return { moves, warnings };
  }

  function display(t) {
    const { moves, warnings } = placed();
    playback.setPlaying(false);
    toolpath.setMode(S.viewMode);
    toolpath.setMoves(moves, r.layers.length, { lineW: S.lineW, nozzle: S.nozzle }, r.hasTypes ? 'type' : 'speed');
    panel.showGcode(r, { name: file.name, hasModel: model.loaded, bySpeed: !r.hasTypes, warnings, density: S.clayDensity, onClose: close });
    model.setVisible(false);
    playback.show(t == null ? toolpath.duration : t * toolpath.duration);
    renderBox();
  }

  /** The G-code section of the Model pane. */
  function renderBox() {
    const box = $('gcodeBox'), st = r.stats, size = st.max.map((v, k) => v - st.min[k]);
    box.hidden = false;
    $('gcodeInfo').innerHTML = `<b>${esc(file.name)}</b> · ${(file.size / 1024 / 1024).toFixed(file.size > 1e6 ? 1 : 2)} MB<br>`
      + `${r.slicer ? esc(r.slicer) + ' · ' : ''}${st.layers} layers${st.layerH ? ` · ≈${st.layerH.toFixed(2)} mm each` : ''}<br>`
      + `${size.map(v => v.toFixed(1)).join(' × ')} mm<br>`
      + `${st.moves.toLocaleString()} moves · ${st.vMin.toFixed(0)}–${st.vMax.toFixed(0)} mm/s<br>`
      + `${r.hasTypes ? 'Colored by move type' : 'No move types in the file: colored by speed'}`;
    $('gcodeOrigin').value = origin;
    $('gcodeHeader').textContent = r.header.length ? r.header.join('\n') : '(no comments at the start of the file)';
  }

  function close() {
    if (!r) return;
    r = null; file = null;
    toolpath.clear();
    playback.reset();
    panel.reset();
    $('gcodeBox').hidden = true;
    model.setVisible(true);
    panel.setCanSlice(model.loaded);
    if (!model.loaded) $('empty').style.display = '';
  }

  $('gcodeOrigin').addEventListener('change', e => {
    if (!r) return;
    origin = e.target.value;
    display(playback.sim.t / (toolpath.duration || 1));
  });

  return {
    get active() { return !!r; },
    close,
    /** Read and show a G-code file. Returns false when there was nothing to show. */
    async open(f) {
      let res;
      try { res = readGcode(await f.text(), { home: [0, 0, S.bedZ], filDia: S.filDia, eMode: S.eMode }); }
      catch (e) { alert('Could not read this G-code file: ' + e.message); return false; }
      if (!res.moves.length) { alert('No moves found: this does not look like G-code.'); return false; }
      close();
      slicing.invalidate();
      file = f; r = res;
      origin = guessOrigin(r.stats);
      $('empty').style.display = 'none';
      panel.setCanSlice(false, 'A G-code file is open. Close it to slice.');
      display();
      framed?.();
      return true;
    },
  };
}
