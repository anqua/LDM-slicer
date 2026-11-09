// Sidebar: tabs plus the Model, Printer and Print-paths panes.
import { SCHEMA } from '../core/schema.js';
import { S, update, exportSettings, importSettings, resetSettings } from '../core/settings.js';
import { renderFields } from './form.js';

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
    before: `<h3>Model</h3><div class="info" id="modelInfo">No model loaded.</div>`,
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
    after: `
      <h3>Presets</h3>
      <div class="btns">
        <button class="btn" id="exportP">Export settings</button>
        <label class="btn">Import settings<input id="importP" type="file" accept=".json" hidden></label>
        <button class="btn" id="resetP">Reset to defaults</button>
      </div>`,
  });
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
    after: `<h3>Note</h3><div class="info">These settings are saved now and will drive the slicer in step 2.</div>`,
  });
  $('autoFromNozzle').addEventListener('click', () =>
    update({ layerH: +(S.nozzle * 0.6).toFixed(2), lineW: +(S.nozzle * 1.2).toFixed(2) }));

  initTabs();
}
