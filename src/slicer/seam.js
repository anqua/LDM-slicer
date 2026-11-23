// Where a closed loop starts and ends (the seam).
import { startAt, nearestIndex } from './polygon.js';

/**
 * Pick the seam vertex of a closed loop and return it as an open polyline that returns to its start.
 * @param seam  'rear' (the vertex with the largest Y), 'nearest' (to `pos`, the current head position) or 'random'
 * @param rng   () -> [0, 1): a seeded generator, so a slice is repeatable
 */
export function seamLoop(loop, seam, pos, rng) {
  let i;
  if (seam === 'nearest' && pos) i = nearestIndex(loop, pos[0], pos[1]);
  else if (seam === 'random') i = Math.floor(rng() * loop.length);
  else { i = 0; for (let k = 1; k < loop.length; k++) if (loop[k][1] > loop[i][1]) i = k; }   // rear = max Y
  const l = startAt(loop, i);
  return [...l, l[0]];
}
