// Fill patterns: straight scanlines (bottom, lines, grid), zig-zag between walls, and
// triply periodic minimal surfaces (gyroid, Schwarz D) cut at the layer height.
import { offset, length } from './polygon.js';

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Scanline segments inside `polys` (even-odd), lines at `angle` degrees, spaced `gap`. */
export function fillLines(polys, angle, gap) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rot = ([x, y]) => [x * c + y * s, -x * s + y * c];        // world -> scan frame
  const back = ([x, y]) => [x * c - y * s, x * s + y * c];
  const rp = polys.map(p => p.map(rot));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of rp) for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const segs = [];
  for (let y = y0 + gap / 2; y < y1; y += gap) {
    const xs = [];
    for (const p of rp) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > gap * 0.3) segs.push([back([xs[k], y]), back([xs[k + 1], y])]);
  }
  return segs;
}

/**
 * Order open polylines greedily from `pos` (each may be reversed), joining an end to the next
 * start with a printed connector when they are closer than `joinDist`.
 */
export function orderLines(lines, pos, joinDist) {
  const left = [...lines], out = [];
  let cur = pos ?? lines[0]?.[0], line = null;
  while (left.length) {
    let best = 0, bd = Infinity, flip = false;
    for (let i = 0; i < left.length; i++) {
      const d0 = dist2(cur, left[i][0]), d1 = dist2(cur, left[i].at(-1));
      if (d0 < bd) { bd = d0; best = i; flip = false; }
      if (d1 < bd) { bd = d1; best = i; flip = true; }
    }
    let [l] = left.splice(best, 1);
    if (flip) l = [...l].reverse();
    if (line && Math.sqrt(bd) <= joinDist) line.push(...l);
    else { line = [...l]; out.push(line); }
    cur = line.at(-1);
  }
  return out;
}

/**
 * Zig-zag between the walls and an extra inner wall `width` further in.
 * @param b      boundary loop (material on its left)
 * @param inset  distance from the boundary to the centre of the innermost normal wall
 * @returns      { wall: loop | null, zig: closed polyline | null }
 */
export function zigzag(b, inset, width, pitch) {
  const h = width / 2;
  const mid = offset(b, inset + h), wall = offset(b, inset + width);
  if (!mid || !wall) return { wall: null, zig: null };
  // Resample the middle line at half-pitch steps (an even count keeps the wave closed).
  const ring = [...mid, mid[0]], L = length(ring, false);
  let n = Math.max(4, Math.round(L / (pitch / 2)));
  if (n % 2) n++;
  const step = L / n, pts = [];
  let seg = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const d = i * step;
    while (seg < ring.length - 2 && acc + Math.hypot(ring[seg + 1][0] - ring[seg][0], ring[seg + 1][1] - ring[seg][1]) < d) {
      acc += Math.hypot(ring[seg + 1][0] - ring[seg][0], ring[seg + 1][1] - ring[seg][1]);
      seg++;
    }
    const p = ring[seg], q = ring[seg + 1], sl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const t = Math.min(1, (d - acc) / sl);
    const nx = -(q[1] - p[1]) / sl, ny = (q[0] - p[0]) / sl;          // left normal: further into the material
    const s = i % 2 ? h : -h;                                         // alternate: inner wall, outer walls
    pts.push([p[0] + (q[0] - p[0]) * t + nx * s, p[1] + (q[1] - p[1]) * t + ny * s]);
  }
  pts.push(pts[0]);
  return { wall, zig: pts };
}

// ---- Triply periodic minimal surfaces -----------------------------------------------------

const TPMS = {
  gyroid: (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x),
  schwarzD: (x, y, z) => Math.sin(x) * Math.sin(y) * Math.sin(z) + Math.sin(x) * Math.cos(y) * Math.cos(z)
    + Math.cos(x) * Math.sin(y) * Math.cos(z) + Math.cos(x) * Math.cos(y) * Math.sin(z),
};

/**
 * Cut a minimal surface with the plane at height z, inside `polys` (even-odd), by marching squares.
 * @param kind  'gyroid' | 'schwarzD'
 * @param cell  period of the pattern in mm
 * @param res   grid step in mm
 * @returns     open polylines [[x, y], ...]
 */
export function tpmsLines(polys, z, kind, cell, res) {
  const f = TPMS[kind], k = 2 * Math.PI / cell, kz = k * z;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (!isFinite(x0)) return [];
  const nx = Math.ceil((x1 - x0) / res) + 1, ny = Math.ceil((y1 - y0) / res) + 1;
  const X = i => x0 + i * res, Y = j => y0 + j * res;

  // Inside mask on grid nodes, one scanline per row.
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = Y(j), xs = [];
    for (const p of polys) for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
      const [xa, ya] = p[a], [xb, yb] = p[b];
      if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) / (yb - ya) * (xb - xa));
    }
    xs.sort((m, n) => m - n);
    for (let q = 0; q + 1 < xs.length; q += 2)
      for (let i = Math.max(0, Math.ceil((xs[q] - x0) / res)); i < nx && X(i) <= xs[q + 1]; i++) inside[j * nx + i] = 1;
  }

  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(k * X(i), k * Y(j), kz);

  // Edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i), vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1.
  const pt = new Map();
  const edgePoint = id => {
    let p = pt.get(id);
    if (p) return p;
    const n = id >> 1, i = n % nx, j = (n - i) / nx, vert = id & 1;
    const a = v[n], b = vert ? v[n + nx] : v[n + 1], t = a / (a - b);
    p = vert ? [X(i), Y(j) + t * res] : [X(i) + t * res, Y(j)];
    pt.set(id, p);
    return p;
  };
  const segs = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const n = j * nx + i;
    if (!(inside[n] && inside[n + 1] && inside[n + nx] && inside[n + nx + 1])) continue;
    const a = v[n], b = v[n + 1], c = v[n + nx + 1], d = v[n + nx];        // corners counter-clockwise
    const bottom = 2 * n, right = 2 * (n + 1) + 1, top = 2 * (n + nx), left = 2 * n + 1;
    const cross = [];
    if ((a > 0) !== (b > 0)) cross.push(bottom);
    if ((b > 0) !== (c > 0)) cross.push(right);
    if ((c > 0) !== (d > 0)) cross.push(top);
    if ((d > 0) !== (a > 0)) cross.push(left);
    if (cross.length === 2) segs.push(cross);
    else if (cross.length === 4) {                                         // saddle: decide by the centre value
      const m = (a + b + c + d) / 4;
      if ((m > 0) === (a > 0)) segs.push([bottom, right], [top, left]);
      else segs.push([bottom, left], [top, right]);
    }
  }

  // Chain segments sharing edge ids into polylines.
  const at = new Map();
  segs.forEach((s, i) => { for (const e of s) { const l = at.get(e); l ? l.push(i) : at.set(e, [i]); } });
  const used = new Uint8Array(segs.length), lines = [];
  const walk = (start, e) => {                                             // follow from edge e away from segment `start`
    const out = [];
    let si = start;
    for (;;) {
      const next = (at.get(e) || []).find(j => j !== si && !used[j]);
      if (next === undefined) return out;
      used[next] = 1;
      e = segs[next][0] === e ? segs[next][1] : segs[next][0];
      out.push(e);
      si = next;
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd = walk(i, segs[i][1]), bwd = walk(i, segs[i][0]);
    const ids = [...bwd.reverse(), segs[i][0], segs[i][1], ...fwd];
    if (ids.length >= 3 || length(ids.map(edgePoint), false) > res * 2) lines.push(ids.map(edgePoint));
  }
  return lines;
}
