// Toolpath preview: extrusion lines colored by type, optional travel moves, and a print
// simulation that grows the paths move by move along a time line.
import * as THREE from 'three';
import { cssVar } from '../core/theme.js';

const TYPE_TOKEN = { skirt: 'path-skirt', outer: 'path-outer', inner: 'path-inner', bottom: 'path-bottom', infill: 'path-infill', spiral: 'path-outer' };

export function createToolpathView(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let lines = null, travels = null, current = null, tip = null, marker = null;
  let showTravel = false;

  // Time line. One entry per move, in print order (typed arrays: there can be 100k+ moves).
  //   t1:   time (s) at the end of the move;  kind: 1 = extrude, 0 = travel
  //   segs: extrusion segments finished BEFORE this move;  travs: travel segments before it
  //   ax..bz: start and end points;  layer: layer index
  let mv = null, nMoves = 0, duration = 0;
  let layerStart = [], layerEndTime = [];

  function clear() {
    for (const o of [lines, travels, current, tip, marker]) if (o) { o.geometry.dispose(); o.material.dispose(); group.remove(o); }
    lines = travels = current = tip = marker = null;
    mv = null; nMoves = 0; duration = 0; layerStart = []; layerEndTime = [];
    group.visible = false;
  }

  /**
   * Build the preview from buildToolpaths() output.
   * @param o settings: lineW (marker size) and travelSpeed (mm/s)
   */
  function set(tp, o) {
    clear();
    const pos = [], col = [], tpos = [];
    const colors = Object.fromEntries(Object.entries(TYPE_TOKEN).map(([k, t]) => [k, new THREE.Color(cssVar(t))]));

    let count = 0;
    for (const l of tp.layers) for (const p of l.paths) count += p.pts.length;   // upper bound on moves
    const t1 = new Float64Array(count), kind = new Uint8Array(count), segs = new Uint32Array(count),
      travs = new Uint32Array(count), layer = new Uint32Array(count), P = new Float32Array(count * 6);
    let n = 0, t = 0, last = null;
    const push = (a, b, k, dt, li) => {
      t += dt;
      t1[n] = t; kind[n] = k; segs[n] = pos.length / 6; travs[n] = tpos.length / 6; layer[n] = li;
      P.set(a, n * 6); P.set(b, n * 6 + 3);
      n++;
    };

    tp.layers.forEach((l, li) => {
      layerStart.push(pos.length / 3);
      for (const p of l.paths) {
        const c = colors[p.type] ?? colors.outer;
        if (last && !p.join) {
          const d = Math.hypot(p.pts[0][0] - last[0], p.pts[0][1] - last[1], p.pts[0][2] - last[2]);
          if (d > 1e-6) { push(last, p.pts[0], 0, d / o.travelSpeed, li); tpos.push(...last, ...p.pts[0]); }
        }
        for (let i = 1; i < p.pts.length; i++) {
          const a = p.pts[i - 1], b = p.pts[i];
          push(a, b, 1, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / p.speed, li);
          pos.push(...a, ...b);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
        last = p.pts.at(-1);
      }
      layerEndTime.push(t);
    });
    mv = { t1, kind, segs, travs, layer, P };
    nMoves = n; duration = t;

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
    marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1, o.lineW * 0.8), 12, 8),
      new THREE.MeshBasicMaterial({ color: cssVar('accent') }));

    group.add(lines, travels, current, tip, marker);
    group.visible = true;
    simulate(duration);
  }

  /**
   * Show the print as it is at time t (s): finished moves in full, the current move up to the nozzle.
   * @returns { pos: [x, y, z] nozzle position, layer: 0-based layer index, t }
   */
  function simulate(t) {
    if (!mv || !nMoves) return null;
    t = Math.max(0, Math.min(t, duration));
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
    marker.position.set(p[0], p[1], p[2]);
    marker.visible = t < duration;
    return { pos: p, layer: li, t };
  }

  /** Static view of layers 1..n (1-based): the print as it is when layer n is finished. */
  function setLayer(n) {
    const i = Math.max(1, Math.min(n, layerEndTime.length)) - 1;
    return simulate(layerEndTime[i] ?? 0);
  }

  function setShowTravel(v) { showTravel = v; if (travels) travels.visible = v; }

  return {
    set, clear, simulate, setLayer, setShowTravel,
    get active() { return !!lines; },
    get duration() { return duration; },
    /** Time (s) at which layer n (1-based) is finished. */
    layerEnd: n => layerEndTime[Math.max(1, Math.min(n, layerEndTime.length)) - 1] ?? 0,
  };
}
