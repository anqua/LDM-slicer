// The wall of a non-standard slice: one continuous helix (step 2 of the engine).
//
// Turn i leaves the outline of layer i-1 at its seam and reaches the outline of layer i one turn later, rising by one
// layer. Every turn takes the style of the zone it is in (styles.js shapes each point); joined turns meet exactly.
// Each point is [x, y, z, layerSpacingFactor, perHorizontalMm]: the last two tell the G-code writer how much clay the
// bead needs there (gcode.js).
import { STYLES, clamp } from './styles.js';
import { sample } from './outline.js';

const PLAIN_TURN = { step: 1, perHorizontalMm: false, shape: s => ({ u: s, dz: 0, dn: 0, kap: 1 }) };

/**
 * Adds the wall paths to `out` (the layers from `bottomN` up) and returns the highest z reached.
 * @param c { out, layers, walls, perim, bottomN, nL, o, top, warp, zoneAt, pOf, zonesMode }
 *   walls[i] / perim[i]: the wall centre line of layer i and its length; zoneAt(z) -> zone | null;
 *   pOf(zone) -> the settings with the zone's overrides; warp: the curved-layer warp or null
 */
export function buildHelix({ out, layers, walls, perim, bottomN, nL, o, top, warp, zoneAt, pOf, zonesMode }) {
  const toWorld = warp ? (x, y, zl) => [x, y, warp.toWorld(x, y, zl)] : (x, y, zl) => [x, y, zl];
  let zMax = 0, continues = false;                    // continues: the previous wall path ended where this turn starts

  for (let i = bottomN; i < nL; i++) {
    const prev = walls[i > 0 ? i - 1 : 0], cur = walls[i], zPrev = i > 0 ? layers[i - 1].z : 0, rise = layers[i].z - zPrev;
    const zn = zoneAt(zPrev + rise / 2), style = zn ? STYLES[zn.style] : null;
    const L = perim[i];
    const turn = style ? style.turn({ zn, Z: pOf(zn), o, L, rise, top, zonesMode }) : PLAIN_TURN;
    const M = Math.max(8, Math.ceil(L / turn.step));
    const base = s => {                                                // point on the blended outline at turn fraction s
      const sc = s - Math.floor(s), t = clamp(s, 0, 1), A = sample(prev, sc), B = sample(cur, sc);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, zPrev + rise * t];
    };

    const pts = [];
    for (let k = 0; k <= M; k++) {
      const s = k / M;
      const sh = turn.shape(s, zPrev + rise * s);
      let [x, y, zl] = base(sh.u);
      if (sh.dn) {                                                      // outward = right of the direction of travel
        const p = base(s - 0.25 / L), q = base(s + 0.25 / L), tx = q[0] - p[0], ty = q[1] - p[1], tl = Math.hypot(tx, ty) || 1;
        x += sh.dn * ty / tl; y -= sh.dn * tx / tl;
      }
      const pt = toWorld(x, y, zl + sh.dz);
      const kap = warp ? warp.kappa(x, y, zl, rise) : sh.kap;
      pt.push(Math.max(0.2, kap), turn.perHorizontalMm ? 1 : 0);
      if (pt[2] > zMax) zMax = pt[2];
      pts.push(pt);
    }

    if (!warp) { out[i].paths.push({ type: 'spiral', pts, h: o.layerH, join: i > bottomN }); continue; }
    // Curved layers: the part ends at its real top. Where a layer surface rises above it, the path stops and restarts
    // when the surface comes back down (the rim is cut by the layers).
    let run = [], startsAtTurnStart = true;
    const flush = ended => {
      if (run.length > 1) out[i].paths.push({ type: 'spiral', pts: run, h: o.layerH, join: i > bottomN && startsAtTurnStart && continues });
      if (run.length > 1) continues = ended;
      run = [];
    };
    for (let k = 0; k < pts.length; k++) {
      if (pts[k][2] <= top + 0.05) { if (!run.length) startsAtTurnStart = k === 0; run.push(pts[k]); }
      else flush(false);
    }
    flush(true);
    if (!out[i].paths.length) continues = false;
  }
  return zMax;
}
