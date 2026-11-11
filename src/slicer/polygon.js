// 2D polygon helpers for the slicer. A polygon is an array of [x, y] points, closed implicitly.
// Orientation convention: outer boundaries counter-clockwise, holes clockwise, so the
// material is always on the LEFT of the direction of travel.

/** Signed area: positive for counter-clockwise. */
export function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Even-odd point-in-polygon test. */
export function contains(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function length(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  return L;
}

/** Douglas–Peucker on a closed polygon; also drops points closer than `tol` to the previous one. */
export function simplify(poly, tol) {
  if (poly.length < 4) return poly;
  const out = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const p = poly[i], q = out.at(-1);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= tol) out.push(p);
  }
  if (out.length < 4) return out;
  // Split the ring at its farthest point from the start and simplify both halves as open chains.
  let far = 0, fd = -1;
  for (let i = 1; i < out.length; i++) {
    const d = (out[i][0] - out[0][0]) ** 2 + (out[i][1] - out[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(out.slice(0, far + 1), tol), b = dp([...out.slice(far), out[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Douglas–Peucker on an open polyline. */
export const simplifyLine = (pts, tol) => dp(pts, tol);

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [pts[0], pts.at(-1)];
  const l = dp(pts.slice(0, idx + 1), tol), r = dp(pts.slice(idx), tol);
  return [...l.slice(0, -1), ...r];
}

/**
 * Offset a polygon to its left (into the material) by d, with mitered corners (limited).
 * Edges that flip direction after offsetting (sharp concave corners) are collapsed.
 * Returns null when the polygon vanishes.
 */
export function offset(poly, d) {
  const n = poly.length;
  if (n < 3) return null;
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-12;
    nrm.push([-(y2 - y1) / L, (x2 - x1) / L]);            // left normal of edge i
  }
  let out = [];
  for (let i = 0; i < n; i++) {
    const a = nrm[(i - 1 + n) % n], b = nrm[i];
    let mx = a[0] + b[0], my = a[1] + b[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) { mx = b[0]; my = b[1]; } else { mx /= ml; my /= ml; }
    const cos = mx * b[0] + my * b[1];
    const k = Math.min(d / Math.max(cos, 1e-3), d * 3);   // d > 0: miter, limited to 3·d
    out.push([poly[i][0] + mx * k, poly[i][1] + my * k]);
  }
  // Collapse edges that reversed direction (the offset overshot a concave notch).
  for (let pass = 0; pass < 8 && out.length >= 3; pass++) {
    const src = out.length === poly.length ? poly : null;
    let changed = false;
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i], q = out[(i + 1) % out.length];
      const ox = q[0] - p[0], oy = q[1] - p[1];
      let flipped = false;
      if (src) {
        const s = src[i], t = src[(i + 1) % src.length];
        flipped = ox * (t[0] - s[0]) + oy * (t[1] - s[1]) < 0;
      }
      if (flipped) { keep.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); i++; changed = true; if (i === out.length) keep.shift(); }
      else keep.push(p);
    }
    out = keep;
    if (!changed) break;
  }
  if (out.length < 3) return null;
  const a0 = area(poly), a1 = area(out);
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < 1e-6) return null;
  if (d > 0 && Math.abs(a1) >= Math.abs(a0) && a0 > 0) return null;   // outer shrank into nothing / inverted
  return out;
}

/** Rotate a closed polygon so it starts at index i. */
export const startAt = (poly, i) => [...poly.slice(i), ...poly.slice(0, i)];

/** Index of the vertex closest to (x, y). */
export function nearestIndex(poly, x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = (poly[i][0] - x) ** 2 + (poly[i][1] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Points of a circle-ish outward offset of a convex CCW polygon by d (rounded corners). */
export function grow(convex, d, step = 10) {
  const out = [], n = convex.length;
  for (let i = 0; i < n; i++) {
    const p = convex[i], prev = convex[(i - 1 + n) % n], next = convex[(i + 1) % n];
    const a0 = Math.atan2(p[1] - prev[1], p[0] - prev[0]) - Math.PI / 2;
    let a1 = Math.atan2(next[1] - p[1], next[0] - p[0]) - Math.PI / 2;
    while (a1 < a0) a1 += Math.PI * 2;
    const segs = Math.max(1, Math.ceil((a1 - a0) / (step * Math.PI / 180)));
    for (let s = 0; s <= segs; s++) {
      const a = a0 + (a1 - a0) * s / segs;
      out.push([p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)]);
    }
  }
  return out;
}
