// What the non-standard engine tells the user about a slice: the lift for travel moves, the warnings in the slice summary,
// and the line in the G-code header.
import { STYLES } from './styles.js';

/** Extra lift (mm) for travel moves to and from the textured wall: the highest any zone needs. */
export function wallHop(zones, pOf, o, warp) {
  let hop = 1;
  for (const zn of zones) hop = Math.max(hop, STYLES[zn.style].hop(pOf(zn), o, warp));
  return hop;
}

/**
 * Appends the warnings of the wall (not the base: those come from the standard slicer) to `warnings`.
 * @param c { zones, pOf, o, warp, zonesMode, zMax, top, walls, layers, N, bottomN, nL }
 */
export function collectWarnings(warnings, { zones, pOf, o, warp, zonesMode, zMax, walls, layers, N, bottomN, nL }) {
  if (warp) {
    const slope = Math.atan(warp.maxSlope) * 180 / Math.PI;
    if (slope > 30) warnings.push(`Steepest layer slope is ${slope.toFixed(0)}°. Above about 30° the nozzle body may touch the print. Lower the amplitude or lengthen the wavelength.`);
  }
  let worst = 0, worstLabel = '';                        // the steepest climb any zone's style reports
  for (const zn of zones) {
    const d = STYLES[zn.style].climbDeg?.(pOf(zn)) ?? 0;
    if (d > worst) { worst = d; worstLabel = STYLES[zn.style].label.toLowerCase(); }
  }
  if (worst > 40) warnings.push(`The ${worstLabel} climbs at up to ${worst.toFixed(0)}°, which clay may not hold and the nozzle body may touch. Lower the wave height or lengthen the wavelength.`);
  if (warp && warp.reduced) warnings.push(`The model is short for this wave: amplitude reduced to ${warp.A.toFixed(1)} mm (the wave ramps in and out over 3 × amplitude, above the flat base and below the top).`);
  if (warp) {                                            // how far the wall leans out over the one below, in real space
    let n = 0, over = 0, steepest = 0;
    for (let i = Math.max(1, bottomN); i < nL; i++) for (let j = 0; j < N; j += 16) {
      const A = walls[i][j], B = walls[i - 1][j];
      const dz = warp.toWorld(A[0], A[1], layers[i].z) - warp.toWorld(B[0], B[1], layers[i - 1].z);
      const ang = Math.atan2(Math.hypot(A[0] - B[0], A[1] - B[1]), Math.max(dz, 0.01)) * 180 / Math.PI;
      n++; if (ang > 40) over++; if (ang > steepest) steepest = ang;
    }
    if (over / n > 0.05) warnings.push(`${(100 * over / n).toFixed(0)} % of the wall leans more than 40° over the layer below (up to ${steepest.toFixed(0)}°): the clay may sag. Lower the amplitude or lengthen the wavelength.`);
  }
  if (zMax > o.bedZ) warnings.push(`The print reaches Z ${zMax.toFixed(0)} mm, above the ${o.bedZ} mm build height.`);
  const seen = new Set();
  for (const zn of zones) for (const text of STYLES[zn.style].warnings?.(pOf(zn)) ?? []) if (!seen.has(text)) { seen.add(text); warnings.push(text); }
  if (!zonesMode && o.npMode === 'loops' && o.lpFrom >= o.lpTo) warnings.push('Loop texture: "from" must be below "to".');
  if (zonesMode && !zones.length) warnings.push('No zone has a style: nothing differs from a standard spiral. Add a zone with a style.');
}

/** The line that goes into the G-code header. */
export function describeSlice(zones, pOf, o, top, zonesMode) {
  const describe = zn => STYLES[zn.style].describe(pOf(zn));
  if (zonesMode) return `Non-standard slice, zones: ${zones.map(zn => `${zn.from.toFixed(0)}–${Math.min(zn.to, top).toFixed(0)} mm ${describe(zn)}`).join('; ') || 'none'}`;
  return `Non-standard slice, ${zones.length ? describe(zones[0]) : o.npMode}${o.npMode === 'loops' ? `, from ${o.lpFrom} % to ${o.lpTo} % of the height` : `, flat base ${o.npBase} mm`}`;
}
