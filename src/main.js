// Entry point: creates the 3D scene and the controllers, builds the UI and wires them together.
// What lives where:  core/ settings   viewer/ 3D scene   model/ the loaded model   slicer/ + nonstandard/ the slicing
// engines (pipeline.js runs them)   app/ controllers (slicing, playback)   ui/ the panels and menus.
import { S, save, update, onChange } from './core/settings.js';
import { BED_KEYS, TRANSFORM_KEYS } from './core/schema.js';
import { createViewer } from './viewer/viewer.js';
import { createBed, bedCenter } from './viewer/bed.js';
import { createPrinterModel } from './viewer/printer-model.js';
import { createToolpathView } from './viewer/toolpath.js';
import { createModel } from './model/model.js';
import { readSTL, isSTL } from './model/loader.js';
import { demoVaseGeometry } from './model/demo.js';
import { createPlayback } from './app/playback.js';
import { createSlicing } from './app/slicing.js';
import { modelProfile } from './app/model-profile.js';
import { initPanels } from './ui/panels.js';
import { renderModelStatus } from './ui/status.js';
import { initViewControls } from './ui/view-controls.js';
import { initFileInput } from './ui/file-input.js';
import { initSlicePanel } from './ui/slice-panel.js';
import { initSliceMenu } from './ui/slice-menu.js';
import { initZones } from './ui/zones.js';
import { initSidebarResize } from './ui/sidebar-resize.js';
import { initVersionStamp } from './ui/version-stamp.js';

const isTyping = e => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);

// ---- The scene ------------------------------------------------------------
const { scene, rig, onFrame } = createViewer(document.getElementById('view'));
const bed = createBed(scene);
const model = createModel(scene);
const printer = createPrinterModel(scene);
const toolpath = createToolpathView(scene);

/** Frame the bed, or the model if one is loaded, or the whole printer when it is shown. */
function frameView(view = 'iso') {
  const { cx, cy } = bedCenter();
  let tz = 0, r = S.bedX * 0.6;
  const bb = model.bounds();
  if (bb) { tz = bb.max.z / 2; r = Math.max(r, bb.max.z * 0.9); }
  const ext = printer.extent();
  if (ext) { tz = (ext.zMin + ext.zMax) / 2; r = Math.max(r, (ext.zMax - ext.zMin) * 0.8, ext.r * 1.3); }
  rig.frame(view, { cx, cy, tz, r });
}

const printerBtn = document.getElementById('printerBtn');
function setPrinterVisible(v, persist = true) {
  printer.setVisible(v);
  toolpath.setMachineShown(v);                          // the machine carries its own nozzle
  printerBtn.classList.toggle('on', v);
  printerBtn.setAttribute('aria-checked', String(v));
  if (persist) { S.printerVisible = v; save(); }
}
function togglePrinter() {
  setPrinterVisible(!printer.visible);
  if (printer.visible) frameView('iso');                // zoom out to show the whole machine
}
printerBtn.addEventListener('click', togglePrinter);

// ---- Controllers and panels -----------------------------------------------
let playback = null, slicing = null, zonesUi = null;    // created below; the panel's actions reach them late

const panel = initSlicePanel({
  exportGcode: () => slicing.download(),
  setShowModel: v => model.setVisible(v),
  setShowTravel: v => toolpath.setShowTravel(v),
  viewMode: S.viewMode, setViewMode: v => slicing.setViewMode(v),
  exact: S.gcodeExact, setExact: v => slicing.setExact(v),
  scrubLayer: n => playback.scrub(n),
  togglePlay: () => playback.toggle(),
  setSpeed: x => playback.setSpeed(x),
});
playback = createPlayback({ toolpath, printer, panel, setPrinterVisible });
slicing = createSlicing({ model, toolpath, panel, playback });
onFrame(dt => playback.tick(dt));

// ---- Opening a model ------------------------------------------------------
function openModel(geometry, name) {
  slicing.invalidate();
  model.load(geometry, name);
  zonesUi?.refresh();
  panel.setCanSlice(true);
  document.getElementById('empty').style.display = 'none';
  update({ offX: 0, offY: 0 });                         // triggers rebuild + status via onChange
  frameView('iso');
}

async function openFile(file) {
  if (!isSTL(file)) { alert('Please choose an .stl file.'); return; }
  try { openModel(await readSTL(file), file.name); }
  catch (e) { alert('Could not read this STL: ' + e.message); }
}

// ---- Settings -> scene. Every update() lands here -------------------------
onChange(keys => {
  const bedChanged = keys.some(k => BED_KEYS.has(k));
  if (bedChanged) bed.rebuild();
  if (bedChanged || keys.includes('printerPreset')) printer.rebuild();
  if (bedChanged || keys.some(k => TRANSFORM_KEYS.has(k))) model.rebuild();
  renderModelStatus(model.info());
  if (!keys.every(k => k === 'zones')) zonesUi?.refresh();   // the zones themselves are edited in the zone editor
  slicing.invalidate('Settings changed — slice again.');
});

initPanels({
  rotate(axis) {
    if (!model.loaded) return;
    model.rotate(axis);
    model.rebuild();
    zonesUi?.refresh();
    slicing.invalidate('Model rotated — slice again.');
    renderModelStatus(model.info());
    frameView('iso');
  },
  resetTransform() {
    model.resetRotation();
    model.rebuild();
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
initSidebarResize();
const sliceMenu = initSliceMenu(slicing.run);           // the Slice button: a chooser with pictures; picking one slices
zonesUi = initZones(sliceMenu.zonesBox, {
  profile: () => modelProfile(model),
  slice() { sliceMenu.close(); update({ npMode: 'zones' }); slicing.run(true); },
});
initVersionStamp();                                     // async; does not block anything
initFileInput(openFile);
document.getElementById('demo').addEventListener('click', () => openModel(demoVaseGeometry(), 'demo-vase.stl'));
rig.onProjectionChange(kind => { S.projection = kind; save(); });

addEventListener('keydown', e => {                      // S slices (standard), P shows or hides the printer
  if (e.ctrlKey || e.metaKey || isTyping(e)) return;
  const key = e.key.toLowerCase();
  if (key === 's' && model.loaded) slicing.run();
  else if (key === 'p') togglePrinter();
});

// ---- Initial state --------------------------------------------------------
bed.rebuild();
printer.rebuild();
setPrinterVisible(S.printerVisible !== false, false);   // shown by default; only a click is saved
frameView('iso');
if (S.projection === 'ortho') rig.setProjection('ortho');
if (new URLSearchParams(location.search).has('demo')) openModel(demoVaseGeometry(), 'demo-vase.stl');
