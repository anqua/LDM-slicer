// The time line of a print: a list of moves turned into typed arrays, so the preview can show the print at any time t
// (there can be 100k+ moves). Pure data, no 3D objects: viewer/toolpath.js draws what it reports.

/**
 * @param moves    print-order moves { a, b, extrude, type, layer, dt } (see move-list.js)
 * @param nLayers  number of layers (the slider's range): layers without moves are kept, empty
 * @param colorOf  type -> [r, g, b] of an extruded line
 * @returns {
 *   duration, count,
 *   lineVertices, lineColors   2 vertices per extruded move, in order (for the line view)
 *   travelVertices             2 vertices per travel move
 *   layerStart[i]              index of the first line vertex of layer i;  layerEndTime[i]  time (s) layer i is finished
 *   at(t)                      the state at time t, see below
 * }
 */
export function buildTimeline(moves, nLayers, colorOf) {
  const lineVertices = [], lineColors = [], travelVertices = [], layerStart = [0], layerEndTime = [];
  const count = moves.length;
  const t1 = new Float64Array(count),                  // time (s) at the end of each move
    kind = new Uint8Array(count),                      // 1 = extrude, 0 = travel
    segs = new Uint32Array(count),                     // extruded moves finished BEFORE this move
    travs = new Uint32Array(count),                    // travel moves finished before it
    layer = new Uint32Array(count),                    // layer index
    P = new Float32Array(count * 6);                   // start and end points
  let t = 0, li = 0;
  const closeLayersUpTo = target => {                  // layers up to `target - 1` are finished
    while (li < target && li < nLayers) { layerEndTime.push(t); li++; layerStart.push(lineVertices.length / 3); }
  };

  moves.forEach((m, n) => {
    closeLayersUpTo(Math.min(m.layer, nLayers - 1));
    t += m.dt;
    t1[n] = t; kind[n] = m.extrude ? 1 : 0; segs[n] = lineVertices.length / 6; travs[n] = travelVertices.length / 6; layer[n] = li;
    const A = m.a, B = m.b;                            // points may carry extra values after x, y, z (layer spacing)
    P[n * 6] = A[0]; P[n * 6 + 1] = A[1]; P[n * 6 + 2] = A[2]; P[n * 6 + 3] = B[0]; P[n * 6 + 4] = B[1]; P[n * 6 + 5] = B[2];
    if (m.extrude) {
      const c = colorOf(m.type, m);
      lineVertices.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      lineColors.push(...c, ...c);
    } else travelVertices.push(A[0], A[1], A[2], B[0], B[1], B[2]);
  });
  while (layerEndTime.length < nLayers) layerEndTime.push(t);
  while (layerStart.length < nLayers) layerStart.push(lineVertices.length / 3);

  /**
   * The print at time t (s): the move in progress (index i, from a to b, nozzle at p), whether it is finished, how many
   * extruded and travel moves are finished (segsDone, travsDone), and the layer being printed.
   */
  function at(tt) {
    tt = Math.max(0, Math.min(tt, t));
    let lo = 0, hi = count - 1;                        // first move ending at or after tt
    while (lo < hi) { const m = (lo + hi) >> 1; if (t1[m] >= tt) hi = m; else lo = m + 1; }
    const i = lo, t0 = i ? t1[i - 1] : 0;
    const f = t1[i] > t0 ? (tt - t0) / (t1[i] - t0) : 1;
    const o = i * 6;
    const a = [P[o], P[o + 1], P[o + 2]], b = [P[o + 3], P[o + 4], P[o + 5]];
    const done = f >= 1;                               // move i itself finished?
    return {
      t: tt, i, a, b, p: a.map((v, k) => v + (b[k] - v) * f), done, extruding: kind[i] === 1,
      segsDone: segs[i] + (done && kind[i] ? 1 : 0),
      travsDone: travs[i] + (done && !kind[i] ? 1 : 0),
      layer: layer[i],
    };
  }

  return { duration: t, count, lineVertices, lineColors, travelVertices, layerStart, layerEndTime, at };
}
