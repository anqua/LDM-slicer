// Spiral vase engine: ONE continuous helix, not a stack of rings.
//
// The layer-by-layer slicer (paths.js) prints each layer's outline as its own closed loop. A spiral cannot be
// built that way: it has no layers, the nozzle rises all the time, and the outline it follows has to change
// smoothly with the height. This engine therefore works differently:
//
//   1. For every layer take the outline of the largest part, offset inward by half a line width (the wall's
//      centre line), and re-base it to start where a fixed ray from its centre leaves it (the seam).
//   2. Resample two neighbouring outlines with the same number of points, evenly by arc length.
//   3. One turn is the walk from the lower outline to the upper one: at fraction f of the turn the point is
//      (1 - f) · lower + f · upper, at height z0 + f · h. The turn ends on the upper outline's seam point,
//      which is exactly where the next turn starts, so the path never jumps or has a step.
//
// Output: one path per layer, { type: 'spiral', pts, h, join }, where each path's first point equals the
// previous path's last point.
import { area, islands, offset } from './polygon.js';

const SEAM_ANGLE = Math.PI / 2;            // +Y: the rear of the bed, the same side as the layer-by-layer seam

function centroid(loop) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % n], w = x1 * y2 - x2 * y1;
    a += w; cx += (x1 + x2) * w; cy += (y1 + y2) * w;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : loop[0];
}

/**
 * Re-base a closed loop to start at the point where the ray from its centroid at `ang` leaves it
 * (the farthest crossing). A ray crossing moves smoothly when the outline changes smoothly, unlike
 * "the vertex with the largest Y" or "the vertex nearest the nozzle", which jump between lobes.
 */
export function rebaseAtRay(loop, ang = SEAM_ANGLE) {
  const [cx, cy] = centroid(loop), dx = Math.cos(ang), dy = Math.sin(ang), n = loop.length;
  let best = -1, bs = 0, bt = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const rx = a[0] - cx, ry = a[1] - cy;
    const t = (rx * ey - ry * ex) / den, s = (rx * dy - ry * dx) / den;     // ray: c + t·d, edge: a + s·e
    if (t > 0 && s >= 0 && s < 1 && t > bt) { bt = t; best = i; bs = s; }
  }
  if (best < 0) return loop;
  const a = loop[best], b = loop[(best + 1) % n];
  const p = [a[0] + (b[0] - a[0]) * bs, a[1] + (b[1] - a[1]) * bs];
  return [p, ...loop.slice(best + 1), ...loop.slice(0, best + 1)];
}

/** n points at equal arc length along a closed loop, starting at loop[0] (the closing point is not repeated). */
export function resampleClosed(loop, n) {
  const m = loop.length, cum = [0];
  for (let i = 0; i < m; i++) {
    const a = loop[i], b = loop[(i + 1) % m];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum[m], out = [];
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const d = L * j / n;
    while (seg < m - 1 && cum[seg + 1] < d) seg++;
    const a = loop[seg], b = loop[(seg + 1) % m], len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? (d - cum[seg]) / len : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

const perimeter = loop => { let L = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };

/** Wall centre line of a layer: largest part, offset inward by half a line width, seam-aligned. */
function wallOutline(sl, lineW) {
  const isl = islands(sl.loops);
  if (!isl.length) return { loop: null, parts: 0 };
  const outer = isl.reduce((m, it) => (area(it.outer) > area(m.outer) ? it : m), isl[0]).outer;
  const inner = offset(outer, lineW / 2);
  return { loop: inner ? rebaseAtRay(inner) : null, parts: isl.length };
}

/**
 * Build the spiral for layers `first` .. end of `sliced`.
 * @param sliced  result of sliceMesh() (outlines are cut at the middle of each layer)
 * @param o       settings (S)
 * @param first   index of the first spiral layer; layer first - 1 (if any) supplies the starting outline
 * @returns       { paths: Map(layerIndex -> path), multiPart: boolean }
 */
export function buildSpiral(sliced, o, first) {
  const paths = new Map();
  let multiPart = false;
  if (first >= sliced.length) return { paths, multiPart };       // the solid base covers the whole model
  // Points per turn: about one per `seg` mm, but never fewer than 48.
  const seg = Math.min(2, Math.max(0.6, o.lineW * 0.7));

  let prev = null;                                              // wall outline of the layer below
  if (first > 0) { const w = wallOutline(sliced[first - 1], o.lineW); prev = w.loop; }
  let started = false;                                          // true once a turn has been emitted

  for (let i = first; i < sliced.length; i++) {
    const sl = sliced[i], w = wallOutline(sl, o.lineW);
    if (w.parts > 1) multiPart = true;
    if (!w.loop) continue;                                      // nothing here (e.g. above the top): keep the last outline
    const cur = w.loop;

    // Nothing below (the model starts with the spiral): the first turn stays flat on the bed.
    const flat = !prev;
    const lower = prev ?? cur;
    const n = Math.max(48, Math.ceil(Math.max(perimeter(lower), perimeter(cur)) / seg));
    const A = resampleClosed(lower, n), B = resampleClosed(cur, n);
    const z0 = flat ? sl.z : sl.z - sl.h;

    const pts = [];
    for (let j = 0; j <= n; j++) {
      const f = j / n, k = j % n;                               // k wraps: the last point is the seam point again
      pts.push([A[k][0] + (B[k][0] - A[k][0]) * f, A[k][1] + (B[k][1] - A[k][1]) * f, z0 + (sl.z - z0) * f]);
    }
    paths.set(i, { type: 'spiral', pts, h: sl.h, join: started });
    started = true;
    prev = cur;
  }
  return { paths, multiPart };
}
