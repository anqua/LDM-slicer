// Entry point: creates the viewer, bed and model, builds the UI and wires them together.
import { S, save, update, onChange } from './core/settings.js';
import { BED_KEYS, TRANSFORM_KEYS } from './core/schema.js';
import { createViewer } from './viewer/viewer.js';
import { createBed, bedCenter } from './viewer/bed.js';
import { createModel } from './model/model.js';
import { readSTL, isSTL } from './model/loader.js';
import { demoVaseGeometry } from './model/demo.js';
import { initPanels } from './ui/panels.js';
import { renderModelStatus } from './ui/status.js';
import { initViewControls } from './ui/view-controls.js';
import { initFileInput } from './ui/file-input.js';

const { scene, rig } = createViewer(document.getElementById('view'));
const bed = createBed(scene);
const model = createModel(scene);

/** Frame the bed, or the model if one is loaded. */
function frameView(view = 'iso') {
  const { cx, cy } = bedCenter();
  let tz = 0, r = Math.max(S.bedX, S.bedY) * 0.6;
  const bb = model.bounds();
  if (bb) { tz = bb.max.z / 2; r = Math.max(r, bb.max.z * 0.9); }
  rig.frame(view, { cx, cy, tz, r });
}

function openModel(geometry, name) {
  model.load(geometry, name);
  document.getElementById('empty').style.display = 'none';
  update({ offX: 0, offY: 0 });      // triggers rebuild + status via onChange
  frameView('iso');
}

async function openFile(file) {
  if (!isSTL(file)) { alert('Please choose an .stl file.'); return; }
  try { openModel(await readSTL(file), file.name); }
  catch (e) { alert('Could not read this STL: ' + e.message); }
}

// Settings -> scene. Every update() lands here.
onChange(keys => {
  const bedChanged = keys.some(k => BED_KEYS.has(k));
  if (bedChanged) bed.rebuild();
  if (bedChanged || keys.some(k => TRANSFORM_KEYS.has(k))) model.rebuild();
  renderModelStatus(model.info());
});

initPanels({
  rotate(axis) {
    if (!model.loaded) return;
    model.rotate(axis);
    model.rebuild();
    renderModelStatus(model.info());
    frameView('iso');
  },
  resetTransform() {
    model.resetRotation();
    update({ scale: 100, offX: 0, offY: 0 });
    frameView('iso');
  },
  fitToBed() {
    const scale = model.fitScale();
    if (scale == null) return;
    update({ scale, offX: 0, offY: 0 });
    frameView('iso');
  },
  center() { update({ offX: 0, offY: 0 }); },
});

initViewControls(rig, frameView);
initFileInput(openFile);
document.getElementById('demo').addEventListener('click', () => openModel(demoVaseGeometry(), 'demo-vase.stl'));
rig.onProjectionChange(kind => { S.projection = kind; save(); });

// Initial state.
bed.rebuild();
frameView('iso');
if (S.projection === 'ortho') rig.setProjection('ortho');
if (new URLSearchParams(location.search).has('demo')) openModel(demoVaseGeometry(), 'demo-vase.stl');
