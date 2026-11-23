// Where the preview gets its moves from. A move: { a, b, extrude, type, layer, dt, area? }
//   a, b: start and end [x, y, z];  extrude: deposits clay (else travel);  dt: seconds;  area: bead cross-section, mm²
// Two sources: the slicer's own paths (idealised: straight travel between paths) or the exported G-code replayed as written.
import { beadArea } from '../slicer/gcode.js';
import { parseGcodeMoves } from './gcode-moves.js';

/**
 * The slicer's paths as moves, with the travel between paths implied (straight, at the travel speed).
 * @param tp  buildToolpaths() / buildNonStandard() output
 * @param o   settings: travelSpeed, lineW
 */
export function movesFromToolpaths(tp, o) {
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
  return moves;
}

/**
 * The exported G-code as moves: every move as written (rounded coordinates, the lifts and the approach, the lift at the
 * end), timed with the feed rates in the file. The bead cross-section comes from the clay the file extrudes.
 * @param home  where G28 moves the nozzle to (a delta homes at the top, in the middle)
 * @param o     settings: filDia, eMode
 */
export function movesFromGcode(text, home, o) {
  const moves = parseGcodeMoves(text, home);
  const filArea = Math.PI * (o.filDia / 2) ** 2;
  for (const m of moves) if (m.extrude) m.area = (o.eMode === 'volumetric' ? m.e : m.e * filArea) / m.len;
  return moves;
}
