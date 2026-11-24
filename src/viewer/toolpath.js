// The print preview in the 3D scene: extrusion lines colored by type, optional travel moves, the Material view (solid
// beads and the nozzle), and a simulation that shows the print at any time. The data comes from move-list.js, the time
// line from timeline.js, the solid beads from solid-view.js; this file owns the scene objects and the display mode.
import * as THREE from 'three';
import { cssVar } from '../core/theme.js';
import { buildTimeline } from './timeline.js';
import { movesFromToolpaths, movesFromGcode } from './move-list.js';
import { createSolidView } from './solid-view.js';

const TYPE_TOKEN = { skirt: 'path-skirt', outer: 'path-outer', inner: 'path-inner', bottom: 'path-bottom', infill: 'path-infill', spiral: 'path-outer' };

export function createToolpathView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  let lines = null, travels = null, current = null, tip = null;   // the line view: extrusion, travel, current layer, move in progress
  let solid = null;                                              // the Material view, built when first needed
  let tl = null, moves = null, ctx = null;                       // the time line, the moves, { lineW, nozzle } of this slice
  let mode = 'lines', showTravel = false, machineShown = false, lastT = 0;

  function clear() {
    for (const o of [lines, travels, current, tip]) if (o) { o.geometry.dispose(); o.material.dispose(); group.remove(o); }
    if (solid) { solid.objects.forEach(o => group.remove(o)); solid.dispose(); }
    lines = travels = current = tip = solid = tl = moves = null;
    group.visible = false;
  }

  /** Build the preview from print-order moves (move-list.js). `nLayers` is the slider's range. */
  function build(newMoves, nLayers, newCtx, colorBy = "type") {
    clear();
    moves = newMoves; ctx = newCtx;
    const colors = Object.fromEntries(Object.entries(TYPE_TOKEN).map(([k, t]) => { const c = new THREE.Color(cssVar(t)); return [k, [c.r, c.g, c.b]]; }));
    let colorOf = type => colors[type] ?? colors.outer;
    if (colorBy === "speed") {                                  // files without ;TYPE comments: slow (blue) to fast (orange)
      let lo = Infinity, hi = 0;
      for (const m of moves) if (m.extrude) { lo = Math.min(lo, m.v); hi = Math.max(hi, m.v); }
      const cool = [0.29, 0.64, 1], warm = [1, 0.55, 0.26];
      colorOf = (_, m) => { const t = hi > lo ? (m.v - lo) / (hi - lo) : 0.5; return cool.map((c, k) => c + (warm[k] - c) * t); };
    }
    tl = buildTimeline(moves, nLayers, colorOf);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tl.lineVertices, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(tl.lineColors, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tl.travelVertices, 3));
    travels = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: cssVar('path-travel') }));
    travels.visible = showTravel;

    // The layer being printed, drawn again in the accent color. Shares buffers with `lines`.
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', g.getAttribute('position'));
    current = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: cssVar('accent') }));

    // The move in progress, from its start to the nozzle.
    const tipG = new THREE.BufferGeometry();
    tipG.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    tip = new THREE.LineSegments(tipG, new THREE.LineBasicMaterial({ color: cssVar('accent') }));

    group.add(lines, travels, current, tip);
    group.visible = true;
    applyMode();
    simulate(tl.duration);
  }

  /** The nozzle marker shows in the Material view; not when the printer model is shown (it has a nozzle) or after the last move (the head parks). */
  const nozzleVisible = t => mode === 'solid' && !machineShown && t < tl.duration - 1e-6;

  function applyMode() {
    const isSolid = mode === 'solid';
    if (isSolid && !solid && moves) { solid = createSolidView(moves, ctx); solid.objects.forEach(o => group.add(o)); }
    if (lines) lines.visible = !isSolid;
    if (current) current.visible = !isSolid;
    if (solid) solid.show(isSolid, nozzleVisible(lastT));
  }

  /**
   * Show the print as it is at time t (s): finished moves in full, the current move up to the nozzle.
   * @returns { pos: [x, y, z] nozzle position, layer: 0-based layer index, t } or null without a slice
   */
  function simulate(t) {
    if (!tl || !tl.count) return null;
    const s = tl.at(t);
    lastT = s.t;
    lines.geometry.setDrawRange(0, s.segsDone * 2);
    travels.geometry.setDrawRange(0, s.travsDone * 2);
    const first = tl.layerStart[s.layer];
    current.geometry.setDrawRange(first, Math.max(0, s.segsDone * 2 - first));

    const tipPos = tip.geometry.attributes.position;
    tipPos.array.set([...s.a, ...s.p]);
    tipPos.needsUpdate = true;
    tip.visible = !s.done && s.extruding;
    if (solid) solid.update(s.segsDone, s.p, nozzleVisible(s.t));
    return { pos: s.p, layer: s.layer, t: s.t };
  }

  return {
    clear, simulate,
    /** The preview from the slicer's own paths. */
    set(tp, o) { build(movesFromToolpaths(tp, o), tp.layers.length, { lineW: o.lineW, nozzle: o.nozzle }); },
    /** The preview from moves read from any G-code file (gcode-moves.js). colorBy: 'type' or 'speed'. */
    setMoves(list, nLayers, ctx, colorBy) { build(list, nLayers, ctx, colorBy); },
    /** The preview from the exported G-code text itself (exact). */
    setFromGcode(text, nLayers, home, o) { build(movesFromGcode(text, home, o), nLayers, { lineW: o.lineW, nozzle: o.nozzle }); },
    /** "lines": the toolpath only. "solid": the beads with their real width and height, and the nozzle. */
    setMode(m) { mode = m === 'solid' ? 'solid' : 'lines'; if (lines) { applyMode(); simulate(lastT); } },
    setShowTravel(v) { showTravel = v; if (travels) travels.visible = v; },
    /** The printer model is shown: it carries the nozzle, so the marker is hidden. */
    setMachineShown(v) { machineShown = v; if (solid) { applyMode(); simulate(lastT); } },
    /** Box (THREE.Box3) around the printed path, or null when there is none. */
    bounds() { return lines ? new THREE.Box3().setFromObject(lines) : null; },
    get mode() { return mode; },
    get active() { return !!lines; },
    get duration() { return tl ? tl.duration : 0; },
    /** Time (s) at which layer n (1-based) is finished. */
    layerEnd: n => tl ? tl.layerEndTime[Math.max(1, Math.min(n, tl.layerEndTime.length)) - 1] ?? 0 : 0,
  };
}
