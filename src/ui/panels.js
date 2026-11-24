// Sidebar: tabs plus the Model, Printer and Print-paths panes.
import { SCHEMA } from '../core/schema.js';
import { S, update, onChange, exportSettings, importSettings, resetSettings } from '../core/settings.js';
import { PRINTERS } from '../core/printers.js';
import { renderFields } from './form.js';
import { initInfillPreview } from './infill-preview.js';

/** Preset dropdown. With a preset selected nothing else is shown; "Custom" gets a one-line hint. */
function initPresetPicker() {
  const sel = $('printerPreset'), info = $('presetInfo');
  sel.innerHTML = `<option value="">Custom</option>`
    + Object.entries(PRINTERS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');

  const render = () => {
    const id = PRINTERS[S.printerPreset] ? S.printerPreset : '';
    sel.value = id;
    info.hidden = !!id;
    if (!id) info.textContent = 'Enter your printer\'s specifications below, or pick a preset.';
  };

  sel.addEventListener('change', () => {
    const p = PRINTERS[sel.value];
    update(p ? { ...p.values, printerPreset: sel.value } : { printerPreset: '' });
  });
  onChange(render);
  render();
}

const $ = id => document.getElementById(id);

function initTabs() {
  const tabs = document.querySelectorAll('.tabs button');
  tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab));
  }));
}

/**
 * @param {object} actions model actions wired by main.js:
 *   rotate(axis), resetTransform(), fitToBed(), center()
 */
export function initPanels(actions) {
  renderFields($('pane-model'), SCHEMA.model, {
    before: `<h3>Model</h3><div class="info" id="modelInfo">No model loaded.</div>
      <div id="gcodeBox" hidden>
        <h3>G-code file</h3><div class="info" id="gcodeInfo"></div>
        <div class="row wide"><label for="gcodeOrigin" title="Where the printer's X0 Y0 is: a delta printer has it in the middle of the bed, most others in a corner">Origin</label><select id="gcodeOrigin"><option value="center">Bed center</option><option value="corner">Bed corner</option></select></div>
        <h3>File header</h3><pre class="info" id="gcodeHeader" style="max-height:200px;overflow:auto;white-space:pre-wrap;margin:0"></pre>
      </div>`,
    after: `
      <h3>Rotate 90°</h3>
      <div class="btns">
        <button class="btn" data-rot="x">↻ X</button>
        <button class="btn" data-rot="y">↻ Y</button>
        <button class="btn" data-rot="z">↻ Z</button>
        <button class="btn" id="resetT">Reset</button>
      </div>
      <h3>Fit</h3>
      <div class="btns">
        <button class="btn" id="fitBed">Scale to fit bed</button>
        <button class="btn" id="centerM">Center</button>
      </div>`,
  });
  document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => actions.rotate(b.dataset.rot)));
  $('resetT').addEventListener('click', actions.resetTransform);
  $('fitBed').addEventListener('click', actions.fitToBed);
  $('centerM').addEventListener('click', actions.center);

  renderFields($('pane-printer'), SCHEMA.printer, {
    before: `
      <h3>Printer model</h3>
      <div class="row wide"><label for="printerPreset">Preset</label><select id="printerPreset"></select></div>
      <div class="info" id="presetInfo"></div>`,
    after: `
      <h3>Presets</h3>
      <div class="btns">
        <button class="btn" id="exportP">Export settings</button>
        <label class="btn">Import settings<input id="importP" type="file" accept=".json" hidden></label>
        <button class="btn" id="resetP">Reset to defaults</button>
      </div>`,
  });
  initPresetPicker();
  $('exportP').addEventListener('click', exportSettings);
  $('importP').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { await importSettings(f); location.reload(); }
    catch { alert('Could not read that settings file.'); }
  });
  $('resetP').addEventListener('click', () => {
    if (!confirm('Reset all printer and path settings to defaults?')) return;
    resetSettings();
    location.reload();
  });

  renderFields($('pane-paths'), SCHEMA.paths, {
    before: `<h3>Suggestions</h3><div class="btns"><button class="btn" id="autoFromNozzle">Set layer & width from nozzle</button></div>`,
    after: `<h3>Note</h3><div class="info">Changing a setting clears the preview; press <b>Slice</b> again to update the paths and G-code.</div>`,
  });
  initInfillPreview();
  $('autoFromNozzle').addEventListener('click', () =>
    update({ layerH: +(S.nozzle * 0.6).toFixed(2), lineW: +(S.nozzle * 1.2).toFixed(2), firstLayerH: 0 }));

  initTabs();
}
