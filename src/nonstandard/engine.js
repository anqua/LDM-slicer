// Non-standard slicing engine. Independent of the standard slicer (src/slicer/): it has its own way of
// finding the outline of a layer and its own toolpath builder.
//
//  1. Outline: instead of cutting the mesh into closed contours and chaining them, the engine measures the
//     part in polar form around its vertical axis: for every layer surface and every angle, the outermost
//     radius where the mesh crosses it. The result is one radius per angle per layer. Holes in the mesh just
//     leave an angle unmeasured and are bridged. This assumes the cross-sections are star-shaped around the
//     axis (vases, pots, cups, bowls, lamp shades); handles, inner cavities and separate parts are ignored.
//  2. Toolpath: one continuous helix. Turn i leaves the outline of layer i-1 at its seam and reaches the
//     outline of layer i one turn later, rising by one layer. All layers share the angular parametrisation, so
//     the blend between two layers is a plain interpolation, and joined turns meet exactly.
//  3. Style: applied to the wall as it is generated, as a function of the position along the turn:
//       curved  layers follow a height field (field.js): the mesh is measured in layer space, the path is
//               mapped back to real heights
//       ruffle  the wall waves up and down and in and out, a whole number of waves per turn
//       loops   the wall path curls into small loops (a prolate trochoid in the tangent/vertical plane)
//  The base (priming loops and bottom layers) is not part of this engine: it is the standard slicer's, flat and
//  identical to a standard slice. The style starts above it.
import { makeWarp, warpMesh } from './field.js';
import { sliceMesh } from '../slicer/slice.js';        // the base only: the standard slicer's contours and bottom layers
import { buildToolpaths } from '../slicer/paths.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** First layer, then regular layers up to `top`: [{ z, h }], z = top of the layer. */
function layerList(top, firstH, h) {
  const out = [];
  let z = Math.min(firstH, top);
  out.push({ z, h: z });
  while (z + h * 0.5 < top) { const nz = Math.min(z + h, top); out.push({ z: nz, h: nz - z }); z = nz; }
  return out;
}

/** Angle index of a point: s = 0 at the +Y direction, increasing counter-clockwise, in [0, 1). */
const fraction = (x, y) => { const s = (Math.atan2(y, x) - Math.PI / 2) / TAU; return s - Math.floor(s); };

/**
 * Outermost radius per angle (N bins) for each layer surface (cut at mid layer). null = nothing measured.
 * Every triangle crossing a layer plane gives a short segment; its points are binned by angle.
 */
function radialProfiles(mesh, layers, cx, cy, N) {
  const cuts = layers.map(l => l.z - l.h / 2 + 1e-5);
  const prof = layers.map(() => new Float32Array(N).fill(-1));
  const firstAbove = z => { let lo = 0, hi = cuts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m] > z) hi = m; else lo = m + 1; } return lo; };
  const mark = (P, x0, y0, x1, y1) => {
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25));
    for (let i = 0; i <= m; i++) {
      const x = x0 + (x1 - x0) * i / m - cx, y = y0 + (y1 - y0) * i / m - cy, r = Math.hypot(x, y);
      if (r < 1e-6) continue;
      const j = Math.min(N - 1, Math.floor(fraction(x, y) * N));
      if (r > P[j]) P[j] = r;
    }
  };
  for (let t = 0; t < mesh.length; t += 9) {
    const z0 = mesh[t + 2], z1 = mesh[t + 5], z2 = mesh[t + 8];
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    if (hi - lo < 1e-9) continue;
    for (let k = firstAbove(lo); k < cuts.length && cuts[k] < hi; k++) {
      const zc = cuts[k], pts = [];
      for (let e = 0; e < 3; e++) {
        const a = t + e * 3, b = t + ((e + 1) % 3) * 3, za = mesh[a + 2], zb = mesh[b + 2];
        if ((za < zc) === (zb < zc)) continue;
        const s = (zc - za) / (zb - za);
        pts.push(mesh[a] + (mesh[b] - mesh[a]) * s, mesh[a + 1] + (mesh[b + 1] - mesh[a + 1]) * s);
      }
      if (pts.length === 4) mark(prof[k], pts[0], pts[1], pts[2], pts[3]);
    }
  }
  return prof.map(P => {
    const have = []; for (let j = 0; j < N; j++) if (P[j] >= 0) have.push(j);
    if (!have.length) return null;
    for (let h = 0; h < have.length; h++) {            // bridge unmeasured angles (holes in the mesh) linearly
      const a = have[h], b = have[(h + 1) % have.length];
      const gap = (b - a + N) % N || N;
      for (let g = 1; g < gap; g++) P[(a + g) % N] = P[a] + (P[b] - P[a]) * g / gap;
    }
    const Q = new Float32Array(N);                      // light smoothing: removes the bin staircase
    for (let j = 0; j < N; j++) Q[j] = 0.25 * P[(j + N - 1) % N] + 0.5 * P[j] + 0.25 * P[(j + 1) % N];
    return Q;
  });
}

/** Closed outline (N points, counter-clockwise, seam at +Y) of a radius profile. */
function ringOf(P, cx, cy) {
  const N = P.length;
  return Array.from({ length: N }, (_, j) => { const a = Math.PI / 2 + TAU * j / N; return [cx + P[j] * Math.cos(a), cy + P[j] * Math.sin(a)]; });
}

/** Move every point `d` mm along the inward normal (d < 0: outward). */
function offsetRing(R, d) {
  const N = R.length;
  return R.map((p, j) => {
    const a = R[(j + N - 1) % N], b = R[(j + 1) % N], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [p[0] - d * ty / l, p[1] + d * tx / l];          // outward normal of a counter-clockwise ring = (ty, -tx)/l
  });
}

const ringLength = R => { let L = 0; for (let j = 0; j < R.length; j++) { const a = R[j], b = R[(j + 1) % R.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };

/** Point at fraction s (any real; wraps) of a ring, linearly interpolated. */
function sample(R, s) {
  const N = R.length, f = (s - Math.floor(s)) * N, j = Math.floor(f), t = f - j;
  const a = R[j % N], b = R[(j + 1) % N];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Cut a polyline into steps of at most `step` mm in xy. */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 1; k <= n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n, p[2] + (q[2] - p[2]) * k / n]);
  }
  return out;
}

/**
 * @param pos  triangle soup (world, z up, model on z = 0)
 * @param o    settings (S)
 * @param top  model height
 * @returns { tp, zMax, hop, note }; tp = { layers: [{ z, h, paths }], warnings } like the standard slicer's result;
 *          hop = z-hop that clears the surface texture on travel moves
 */
export function buildNonStandard(pos, o, top) {
  const style = o.npMode;
  // The bottom layers are planar (and the standard slicer's): every style starts above them.
  const first = layerList(top, o.firstLayerH || o.layerH, o.layerH);
  const nBase = clamp(Math.round(o.bottomLayers), 0, first.length);
  const baseTop = nBase ? first[nBase - 1].z : 0;
  o = { ...o, npBase: Math.max(o.npBase, baseTop), lpFrom: Math.max(o.lpFrom, baseTop / top * 100) };
  // Axis: the middle of the footprint of the part.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rmax = 1;
  for (let i = 0; i < pos.length; i += 3) rmax = Math.max(rmax, Math.hypot(pos[i] - cx, pos[i + 1] - cy));

  // Curved layers: measure the part in layer space.
  let mesh = pos, warp = null, topL = top;
  if (style === 'curved') {
    warp = makeWarp(o, rmax);
    ({ mesh, top: topL } = warpMesh(pos, warp, o.npType === 'cone' ? 80 : o.npLen));
  }

  const layers = layerList(topL, o.firstLayerH || o.layerH, o.layerH);
  const N = clamp(Math.ceil(TAU * rmax / 0.5), 256, 4096);
  const prof = radialProfiles(mesh, layers, cx, cy, N);
  let nL = prof.length;
  while (nL > 0 && !prof[nL - 1]) nL--;                // nothing measured above the top
  if (!nL) throw new Error('Nothing to print: the model has no outline at the first layer.');
  for (let i = 1; i < nL; i++) if (!prof[i]) prof[i] = prof[i - 1];   // a layer with no crossing at all repeats the one below
  const rings = prof.slice(0, nL).map(P => ringOf(P, cx, cy));
  const walls = rings.map(R => offsetRing(R, o.lineW / 2));            // path centre = half a line inside the surface
  const perim = walls.map(ringLength);

  const bottomN = clamp(Math.round(o.bottomLayers), 0, nL);
  const out = layers.slice(0, nL).map(l => ({ z: l.z, h: l.h, paths: [] }));
  const toWorld = warp ? (x, y, zl) => [x, y, warp.toWorld(x, y, zl)] : (x, y, zl) => [x, y, zl];
  const flat = (type, loops2d, zl, closed) => {                         // flat (single-height) path in layer space
    let pts = loops2d.map(([x, y]) => [x, y, zl]);
    if (closed) pts.push(pts[0]);
    if (warp) pts = densify(pts, 1);
    return { type, pts: pts.map(([x, y, z]) => toWorld(x, y, z)) };
  };

  const warnings = [];
  if (bottomN) {
    // The base (priming loops + bottom layers) is the standard slicer's, unchanged and flat: the same
    // walls, patterns, spacing, flow and speeds as a standard slice. The style starts above it.
    const base = sliceMesh(pos, layers.slice(0, bottomN).map(({ z, h }) => ({ z, h })), Math.max(0.02, o.lineW * 0.03));
    const std = buildToolpaths(base, { ...o, mode: 'layered', infill: 'none' });
    std.layers.forEach((l, i) => out[i].paths.push(...l.paths));
    warnings.push(...std.warnings);
  } else {
    // No base: only the priming loops.
    for (let k = Math.round(o.skirtLoops) - 1; k >= 0; k--)
      out[0].paths.push({ ...flat('skirt', offsetRing(rings[0], -(o.skirtDist + o.lineW * (k + 0.5))), layers[0].z, true), h: layers[0].h });
  }

  // The wall: one helix, a style-shaped point at every step.
  const lam = Math.max(4, o.rfLen), a = o.rfAmp, b = o.rfRadial;
  const z0 = Math.max(0, o.npBase), ramp = Math.max(3 * a, 3 * Math.abs(b), 1e-6);   // thickness stays within 50-150 %
  const loopR = Math.max(0.3, o.lpSize / 2), loopZ = Math.min(loopR, o.layerH * 1.2);
  const pitch = Math.min(Math.max(1, o.lpSpacing), 5.5 * loopR);                      // pitch < 2π·r, or no loop forms
  const band = [top * o.lpFrom / 100, top * o.lpTo / 100];
  const step = style === 'ruffle' ? clamp(lam / 16, 0.5, 2) : style === 'loops' ? Math.min(0.5, pitch / 20) : 1;

  let zMax = 0, continues = false;                    // continues: the previous wall path ended where this turn starts
  for (let i = bottomN; i < nL; i++) {
    const prev = walls[i > 0 ? i - 1 : 0], cur = walls[i], zPrev = i > 0 ? layers[i - 1].z : 0, rise = layers[i].z - zPrev;
    const L = perim[i], M = Math.max(8, Math.ceil(L / step));
    const base = s => {                                                // point on the blended outline at turn fraction s
      const sc = s - Math.floor(s), t = clamp(s, 0, 1), A = sample(prev, sc), B = sample(cur, sc);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, zPrev + rise * t];
    };
    const inBand = style === 'loops' && zPrev >= band[0] && zPrev <= band[1];
    const nWaves = Math.max(1, Math.round(L / lam)), nLoops = Math.max(1, Math.round(L / pitch));
    const pts = [];
    for (let k = 0; k <= M; k++) {
      const s = k / M;
      let u = s, dz = 0, dn = 0;
      if (style === 'ruffle') {
        const sn = Math.sin(TAU * nWaves * s), w = smooth((base(s)[2] - z0) / ramp);
        dz = a * w * sn; dn = b * w * sn;
      } else if (inBand) {
        const ph = TAU * nLoops * s;
        u = s - loopR / L * Math.sin(ph);
        dz = loopZ * (1 - Math.cos(ph));
      }
      let [x, y, zl] = base(u);
      if (dn) {                                                         // outward = right of the direction of travel
        const p = base(s - 0.25 / L), q = base(s + 0.25 / L), tx = q[0] - p[0], ty = q[1] - p[1], tl = Math.hypot(tx, ty) || 1;
        x += dn * ty / tl; y -= dn * tx / tl;
      }
      const P = toWorld(x, y, zl + dz);
      if (P[2] > zMax) zMax = P[2];
      pts.push(P);
    }
    if (!warp) { out[i].paths.push({ type: 'spiral', pts, h: o.layerH, join: i > bottomN }); continue; }
    // Curved layers: the part ends at its real top. Where a layer surface rises above it, the path stops and
    // restarts when the surface comes back down (the rim is cut by the layers).
    let run = [], startsAtTurnStart = true;
    const flush = ended => {
      if (run.length > 1) out[i].paths.push({ type: 'spiral', pts: run, h: o.layerH, join: i > bottomN && startsAtTurnStart && continues });
      if (run.length > 1) continues = ended;
      run = [];
    };
    for (let k = 0; k < pts.length; k++) {
      if (pts[k][2] <= top + 0.05) { if (!run.length) startsAtTurnStart = k === 0; run.push(pts[k]); }
      else { flush(false); }
    }
    flush(true);
    if (!out[i].paths.length) continues = false;
  }

  // Speeds (first layer, bottom, normal; capped by the machine) and the bottom flow multiplier.
  const bottomFlow = (o.bottomFlow ?? 75) / 100;
  out.forEach((l, i) => {
    for (const p of l.paths) {
      if (p.speed != null) continue;                  // the standard base already has its speeds
      const sp = i === 0 ? o.firstSpeed : p.type === 'bottom' ? (o.bottomSpeed ?? o.speed) : o.speed;
      p.speed = Math.min(sp, o.maxSpeed);
      if (p.type === 'bottom') p.flow = bottomFlow;
    }
  });

  if (warp) zMax = Math.min(zMax, top + 0.05);
  if (warp) {
    const slope = Math.atan(warp.maxSlope) * 180 / Math.PI;
    if (slope > 30) warnings.push(`Steepest layer slope is ${slope.toFixed(0)}°. Above about 30° the nozzle body may touch the print. Lower the amplitude or lengthen the wavelength.`);
  }
  if (zMax > o.bedZ) warnings.push(`The print reaches Z ${zMax.toFixed(0)} mm, above the ${o.bedZ} mm build height.`);
  if (style === 'loops' && o.lpSpacing > 5.5 * loopR) warnings.push(`Loop spacing reduced to ${(5.5 * loopR).toFixed(1)} mm so the path forms loops at this size.`);
  if (style === 'loops' && o.lpFrom >= o.lpTo) warnings.push('Loop texture: "from" must be below "to".');

  const notes = {
    curved: `curved layers: ${o.npType}, amplitude ${o.npAmp} mm, wavelength ${o.npLen} mm, direction ${o.npAngle}°, flat base ${o.npBase} mm`,
    ruffle: `ruffled wall: amplitude ${o.rfAmp} mm, wavelength ${o.rfLen} mm, in/out ${o.rfRadial} mm, flat base ${o.npBase} mm`,
    loops: `loop texture: loop Ø ${o.lpSize} mm, spacing ${o.lpSpacing} mm, from ${o.lpFrom} % to ${o.lpTo} % of the height`,
  };
  const hop = style === 'curved' ? 2 * o.npAmp + 1 : style === 'ruffle' ? 2 * (a + Math.abs(b)) + 1 : 2 * loopZ + 1;
  return { tp: { layers: out, warnings }, zMax, hop, note: `Non-standard slice, ${notes[style]}` };
}
