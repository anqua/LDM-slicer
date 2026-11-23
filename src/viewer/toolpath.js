// Toolpath preview: extrusion lines colored by type, optional travel moves, and a print
// simulation that grows the paths move by move along a time line.
// Two sources: the slicer's paths (set), or the exported G-code replayed move by move (setFromGcode).
import * as THREE from 'three';
import { cssVar } from '../core/theme.js';
import { parseGcodeMoves } from './gcode-moves.js';
import { buildBeadMesh } from './bead-mesh.js';
import { beadArea } from '../slicer/gcode.js';

const TYPE_TOKEN = { skirt: 'path-skirt', outer: 'path-outer', inner: 'path-inner', bottom: 'path-bottom', infill: 'path-infill', spiral: 'path-outer' };

export function createToolpathView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let lines = null, travels = null, current = null, tip = null;
  // Material view: the beads as solid tubes (built when first needed), and the nozzle at the tip.
  let solid = null, solidK = 8, nozzleMesh = null, movesRef = null, ctx = null, mode = "lines", lastT = 0, machineShown = false;
  let showTravel = false;

  // Time line. One entry per move, in print order (typed arrays: there can be 100k+ moves).
  //   t1:   time (s) at the end of the move;  kind: 1 = extrude, 0 = travel
  //   segs: extrusion segments finished BEFORE this move;  travs: travel segments before it
  //   ax..bz: start and end points;  layer: layer index
  let mv = null, nMoves = 0, duration = 0;
  let layerStart = [], layerEndTime = [];

  function clear() {
    for (const o of [lines, travels, current, tip, solid, nozzleMesh]) if (o) { o.geometry.dispose(); o.material.dispose(); group.remove(o); }
    lines = travels = current = tip = solid = nozzleMesh = movesRef = null;
    mv = null; nMoves = 0; duration = 0; layerStart = []; layerEndTime = [];
    group.visible = false;
  }

  /**
   * Build the preview from a move list in print order: { a, b, extrude, type, layer, dt }.
   * @param nLayers number of layers (the slider's range): layers without moves are kept, empty
   */
  function build(moves, nLayers, c) {
    clear();
    ctx = c; movesRef = moves;
    const pos = [], col = [], tpos = [];
    const colors = Object.fromEntries(Object.entries(TYPE_TOKEN).map(([k, t]) => [k, new THREE.Color(cssVar(t))]));
    const count = moves.length;
    const t1 = new Float64Array(count), kind = new Uint8Array(count), segs = new Uint32Array(count),
      travs = new Uint32Array(count), layer = new Uint32Array(count), P = new Float32Array(count * 6);
    let t = 0, li = 0;
    const closeLayersUpTo = target => {                  // layers up to `target - 1` are finished
      while (li < target && li < nLayers) { layerEndTime.push(t); li++; layerStart.push(pos.length / 3); }
    };
    layerStart.push(0);

    moves.forEach((m, n) => {
      closeLayersUpTo(Math.min(m.layer, nLayers - 1));
      t += m.dt;
      t1[n] = t; kind[n] = m.extrude ? 1 : 0; segs[n] = pos.length / 6; travs[n] = tpos.length / 6; layer[n] = li;
      const A = m.a, B = m.b;                           // points may carry extra values after x, y, z (layer spacing)
      P[n * 6] = A[0]; P[n * 6 + 1] = A[1]; P[n * 6 + 2] = A[2]; P[n * 6 + 3] = B[0]; P[n * 6 + 4] = B[1]; P[n * 6 + 5] = B[2];
      if (m.extrude) {
        const c = colors[m.type] ?? colors.outer;
        pos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      } else tpos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
    });
    while (layerEndTime.length < nLayers) layerEndTime.push(t);
    while (layerStart.length < nLayers) layerStart.push(pos.length / 3);
    mv = { t1, kind, segs, travs, layer, P };
    nMoves = count; duration = t;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
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
    simulate(duration);
  }

  /** Build the solid beads and the nozzle once (the first time the material view is shown for this slice). */
  function ensureSolid() {
    if (solid || !movesRef) return;
    const b = buildBeadMesh(movesRef, ctx.lineW);
    solidK = b.K;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
    g.setIndex(new THREE.BufferAttribute(b.index, 1));
    solid = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: cssVar('clay'), roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
    solid.frustumCulled = false;
    // The nozzle: a cone of the nozzle's real size (outlet diameter), tip at the end of the move.
    const r = ctx.nozzle / 2, ng = new THREE.CylinderGeometry(r * 2.2, r, ctx.nozzle * 3, 24);
    ng.rotateX(Math.PI / 2);                            // axis along z
    ng.translate(0, 0, ctx.nozzle * 1.5);
    nozzleMesh = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: '#9a9a9a', roughness: 0.5, metalness: 0.6 }));
    group.add(solid, nozzleMesh);
  }

  function applyMode() {
    const isSolid = mode === 'solid';
    if (isSolid) ensureSolid();
    if (lines) lines.visible = !isSolid;
    if (current) current.visible = !isSolid;
    if (solid) solid.visible = isSolid;
    if (nozzleMesh) nozzleMesh.visible = isSolid && !machineShown;
  }

  /**
   * Build the preview from buildToolpaths() output: the slicer's own paths, with the travel between them
   * implied (straight, at the travel speed).
   * @param o settings: travelSpeed (mm/s)
   */
  function set(tp, o) {
    const moves = [];
    let last = null;
    tp.layers.forEach((l, li) => {
      for (const p of l.paths) {
        if (last && !p.join) {
          const d = Math.hypot(p.pts[0][0] - last[0], p.pts[0][1] - last[1], p.pts[0][2] - last[2]);
          if (d > 1e-6) moves.push({ a: last, b: p.pts[0], extrude: false, layer: li, dt: d / o.travelSpeed });
        }
        for (let i = 1; i < p.pts.length; i++) {
          const a = p.pts[i - 1], b = p.pts[i];
          moves.push({ a, b, extrude: true, type: p.type, layer: li, dt: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / p.speed,
            area: beadArea(o.lineW, p.h * (b[3] ?? 1)) * (p.flow ?? 1) });      // clay per mm: the same as the G-code writes
        }
        last = p.pts.at(-1);
      }
    });
    build(moves, tp.layers.length, { lineW: o.lineW, nozzle: o.nozzle });
  }

  /**
   * Build the preview from the exported G-code text itself: every move as written (rounded coordinates, the
   * lifts and the approach, the lift at the end), timed with the feed rates in the file.
   * @param home position G28 moves the nozzle to (a delta homes at the top, in the middle)
   */
  function setFromGcode(text, nLayers, home, o) {
    const moves = parseGcodeMoves(text, home);
    // Bead cross-section from the clay the file extrudes: E (filament length or volume) per mm of the move.
    const filArea = Math.PI * (o.filDia / 2) ** 2;
    for (const m of moves) if (m.extrude) m.area = (o.eMode === "volumetric" ? m.e : m.e * filArea) / m.len;
    build(moves, nLayers, { lineW: o.lineW, nozzle: o.nozzle });
  }

  /**
   * Show the print as it is at time t (s): finished moves in full, the current move up to the nozzle.
   * @returns { pos: [x, y, z] nozzle position, layer: 0-based layer index, t }
   */
  function simulate(t) {
    if (!mv || !nMoves) return null;
    t = Math.max(0, Math.min(t, duration));
    lastT = t;
    let lo = 0, hi = nMoves - 1;                       // first move ending at or after t
    while (lo < hi) { const m = (lo + hi) >> 1; if (mv.t1[m] >= t) hi = m; else lo = m + 1; }
    const i = lo, t0 = i ? mv.t1[i - 1] : 0;
    const f = mv.t1[i] > t0 ? (t - t0) / (mv.t1[i] - t0) : 1;
    const o = i * 6, P = mv.P;
    const a = [P[o], P[o + 1], P[o + 2]], b = [P[o + 3], P[o + 4], P[o + 5]];
    const p = a.map((v, k) => v + (b[k] - v) * f);
    const done = f >= 1;                                // move i itself finished?

    const segsDone = mv.segs[i] + (done && mv.kind[i] ? 1 : 0);
    const travsDone = mv.travs[i] + (done && !mv.kind[i] ? 1 : 0);
    const li = mv.layer[i];
    lines.geometry.setDrawRange(0, segsDone * 2);
    travels.geometry.setDrawRange(0, travsDone * 2);
    current.geometry.setDrawRange(layerStart[li], Math.max(0, segsDone * 2 - layerStart[li]));

    const tipPos = tip.geometry.attributes.position;
    tipPos.array.set([...a, ...p]);
    tipPos.needsUpdate = true;
    tip.visible = !done && mv.kind[i] === 1;
    if (solid) {
      solid.geometry.setDrawRange(0, segsDone * solidK * 6);
      nozzleMesh.position.set(p[0], p[1], p[2]);
      // The printer model has its own nozzle, and after the last move the head parks: the marker would hang in the air.
      nozzleMesh.visible = mode === "solid" && !machineShown && t < duration - 1e-6;
    }
    return { pos: p, layer: li, t };
  }

  /** Static view of layers 1..n (1-based): the print as it is when layer n is finished. */
  function setLayer(n) {
    const i = Math.max(1, Math.min(n, layerEndTime.length)) - 1;
    return simulate(layerEndTime[i] ?? 0);
  }

  function setShowTravel(v) { showTravel = v; if (travels) travels.visible = v; }

  /** The printer model is shown: it carries the nozzle, so the marker (a nozzle of the real size) is hidden. */
  function setMachineShown(v) { machineShown = v; if (nozzleMesh) { applyMode(); simulate(lastT); } }

  /** "lines": the toolpath only. "solid": the beads with their real width and height, and the nozzle. */
  function setMode(m) {
    mode = m === "solid" ? "solid" : "lines";
    if (lines) { applyMode(); simulate(lastT); }
  }

  return {
    set, setFromGcode, clear, simulate, setLayer, setShowTravel, setMode, setMachineShown,
    get mode() { return mode; },
    get active() { return !!lines; },
    get duration() { return duration; },
    /** Time (s) at which layer n (1-based) is finished. */
    layerEnd: n => layerEndTime[Math.max(1, Math.min(n, layerEndTime.length)) - 1] ?? 0,
  };
}
