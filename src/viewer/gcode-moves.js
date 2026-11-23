// Reads G-code text back into a list of moves, for the "exact G-code" preview: what the printer will do,
// move by move, from the file itself (not from the slicer's internal paths).
//
// Understands what this slicer writes (and the usual subset): G0/G1 with X Y Z E F (modal F, mm/min),
// G90/G91 (absolute / relative XYZ), G28 (home), M82/M83 and G92 are ignored (E only decides whether a move
// deposits clay), ";LAYER:n ..." and ";TYPE:name" comments, ";" comments after a command.
//
// Move: { a: [x,y,z], b: [x,y,z], extrude: bool, type, layer, dt }   dt = seconds at the commanded feed.
// A G1 with E > 0 and some motion deposits clay; every other motion is a travel. Retract / unretract / pre-fill
// (E only, no motion) deposit nothing visible and take no path time.

/** @param home  [x, y, z] the nozzle is moved to by G28 (a delta homes at the top, in the middle) */
export function parseGcodeMoves(text, home = [0, 0, 0]) {
  const moves = [];
  let pos = null, absolute = true, feed = 3000, layer = 0, type = 'outer';
  const num = (line, axis) => { const m = new RegExp('(?:^|\\s)' + axis + '(-?\\d*\\.?\\d+)').exec(line); return m ? parseFloat(m[1]) : null; };

  for (const raw of text.split('\n')) {
    const semi = raw.indexOf(';');
    if (semi === 0) {
      const L = /^;LAYER:(\d+)/.exec(raw), T = /^;TYPE:(\w+)/.exec(raw);
      if (L) layer = +L[1]; else if (T) type = T[1];
      continue;
    }
    const line = (semi > 0 ? raw.slice(0, semi) : raw).trim();
    if (!line) continue;
    const cmd = line.split(/\s+/)[0].toUpperCase();
    if (cmd === 'G90') { absolute = true; continue; }
    if (cmd === 'G91') { absolute = false; continue; }
    if (cmd === 'G28') { pos = [...home]; continue; }
    if (cmd !== 'G0' && cmd !== 'G1') continue;

    const x = num(line, 'X'), y = num(line, 'Y'), z = num(line, 'Z'), e = num(line, 'E'), f = num(line, 'F');
    if (f != null && f > 0) feed = f;
    if (x == null && y == null && z == null) continue;         // E-only or F-only: no motion
    const a = pos ? pos : [x ?? 0, y ?? 0, z ?? 0];
    const b = absolute ? [x ?? a[0], y ?? a[1], z ?? a[2]] : [a[0] + (x ?? 0), a[1] + (y ?? 0), a[2] + (z ?? 0)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (pos && d > 1e-9) moves.push({ a, b, extrude: cmd === "G1" && e != null && e > 0, type, layer, dt: d / (feed / 60), e: e ?? 0, len: d });
    pos = b;
  }
  return moves;
}
