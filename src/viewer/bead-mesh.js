// Material view of a print: every extruded move becomes a piece of bead, a tube with the cross-section the
// clay really has (width = line width, height from the extruded volume), so the object looks as it will
// print, and thin, thick or missing clay shows.
//
// The bead cross-section is a rounded rectangle in the slicer's model (area = (w - h)·h + π·h²/4); here an
// ellipse with the same width and height (K points) stands in for it. Consecutive moves of one path share
// their rings, so the tube is smooth.

const C = 1 - Math.PI / 4;

/**
 * Width and height of a bead of cross-section `area` (mm²) when the line is `w` wide.
 * A bigger bead than a round one of width w cannot be flat: it gets round and wider.
 */
export function beadSize(area, w) {
  if (area >= Math.PI * w * w / 4) { const d = Math.sqrt(4 * area / Math.PI); return [d, d]; }
  return [w, (w - Math.sqrt(w * w - 4 * C * area)) / (2 * C)];
}

/**
 * @param moves  print-order moves { a, b, extrude, area } (a, b: [x, y, z] = top centre of the bead, as the nozzle
 *               tip travels; area in mm², for extruding moves)
 * @param w      line width (mm)
 * @returns { position, normal, index, K }: the extruding moves in order, 6·K indices each
 */
export function buildBeadMesh(moves, w) {
  let nExtr = 0;
  for (const m of moves) if (m.extrude) nExtr++;
  const K = nExtr > 200000 ? 6 : 8;

  // Chains: runs of extruding moves where each starts where the one before ended.
  const chains = [];                                   // [first move, last move]
  let cur = null, prev = null;
  moves.forEach((m, i) => {
    if (!m.extrude) { cur = null; prev = null; return; }
    const joined = prev && Math.abs(m.a[0] - prev.b[0]) + Math.abs(m.a[1] - prev.b[1]) + Math.abs(m.a[2] - prev.b[2]) < 1e-6;
    if (!joined || !cur) { cur = [i, i]; chains.push(cur); } else cur[1] = i;
    prev = m;
  });
  let nVert = 0;
  for (const [f, l] of chains) { let c = 0; for (let i = f; i <= l; i++) if (moves[i].extrude) c++; nVert += (c + 1) * K; }

  const position = new Float32Array(nVert * 3), normal = new Float32Array(nVert * 3), index = new Uint32Array(nExtr * K * 6);
  const cs = Array.from({ length: K }, (_, k) => [Math.cos(2 * Math.PI * k / K), Math.sin(2 * Math.PI * k / K)]);
  let v = 0, ix = 0;
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  for (const [f, l] of chains) {
    const P = [moves[f].a], D = [];                    // points, segment dimensions
    for (let i = f; i <= l; i++) if (moves[i].extrude) { P.push(moves[i].b); D.push(beadSize(Math.max(0.05, moves[i].area ?? 1), w)); }
    const n = P.length;
    const dir = [];                                    // segment directions
    for (let i = 0; i < n - 1; i++) dir.push(unit([P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1], P[i + 1][2] - P[i][2]]) ?? (dir[i - 1] ?? [1, 0, 0]));
    let lastU = [0, 0, 1];
    const base = v;                                    // index of this chain's first vertex
    for (let i = 0; i < n; i++) {
      const t = unit(i === 0 ? dir[0] : i === n - 1 ? dir[n - 2] : [dir[i - 1][0] + dir[i][0], dir[i - 1][1] + dir[i][1], dir[i - 1][2] + dir[i][2]]) ?? dir[Math.min(i, n - 2)];
      // "up" = the vertical, made perpendicular to the direction of travel; where the path goes straight up, keep the last one
      let u = [-t[0] * t[2], -t[1] * t[2], 1 - t[2] * t[2]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      u = ul > 0.25 ? [u[0] / ul, u[1] / ul, u[2] / ul] : lastU;
      u = unit([u[0] - t[0] * dot(u, t), u[1] - t[1] * dot(u, t), u[2] - t[2] * dot(u, t)]) ?? lastU;
      lastU = u;
      const s = cross(t, u);
      const [bw, bh] = D[Math.min(i, n - 2)], hw = bw / 2, hh = bh / 2, p = P[i];
      const cx = p[0] - u[0] * hh, cy = p[1] - u[1] * hh, cz = p[2] - u[2] * hh;   // the nozzle tip is at the top of the bead
      for (let k = 0; k < K; k++, v++) {
        const [c, sn] = cs[k];
        position[v * 3] = cx + s[0] * hw * c + u[0] * hh * sn;
        position[v * 3 + 1] = cy + s[1] * hw * c + u[1] * hh * sn;
        position[v * 3 + 2] = cz + s[2] * hw * c + u[2] * hh * sn;
        const nx = s[0] * c / hw + u[0] * sn / hh, ny = s[1] * c / hw + u[1] * sn / hh, nz = s[2] * c / hw + u[2] * sn / hh, nl = Math.hypot(nx, ny, nz) || 1;
        normal[v * 3] = nx / nl; normal[v * 3 + 1] = ny / nl; normal[v * 3 + 2] = nz / nl;
      }
    }
    for (let i = 0; i < n - 1; i++) {                  // one block of 6·K indices per move, in move order
      const r0 = base + i * K, r1 = r0 + K;
      for (let k = 0; k < K; k++) {
        const k1 = (k + 1) % K;
        index[ix++] = r0 + k; index[ix++] = r0 + k1; index[ix++] = r1 + k1;
        index[ix++] = r0 + k; index[ix++] = r1 + k1; index[ix++] = r1 + k;
      }
    }
  }
  return { position, normal, index, K };
}
