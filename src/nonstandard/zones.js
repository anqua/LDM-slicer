// Zones for the engine: which style the wall has at which height.
//
// Zone: { style, from, to (mm of height), p: overrides of the settings for this zone, legacy?: true }
// The editor (ui/zones.js) stores them in S.zones; a single-style slice (npMode curved / ruffle / loops) is turned into
// one zone covering what that style's settings say, so the engine has one code path for both.
import { STYLES, smooth } from './styles.js';

/**
 * The zones of a slice, in order of height, clipped to the printable wall. Zones without a style are plain wall and
 * are left out. `legacy` zones (single-style slices) keep the original ramps of their style.
 */
export function makeZones(o, top, baseTop) {
  if (o.npMode !== 'zones') {
    const st = STYLES[o.npMode];
    return st ? [{ style: o.npMode, p: {}, legacy: true, ...st.legacyZone(o, top, baseTop) }] : [];
  }
  return (o.zones || []).filter(z => z && STYLES[z.style])
    .map(z => ({ style: z.style, from: Math.max(baseTop, +z.from), to: Math.min(top, +z.to), p: z.p || {} }))
    .filter(z => z.to > z.from + 0.01).sort((a, b) => a.from - b.from);
}

/** A function height -> zone (or null where the wall is plain). */
export const zoneFinder = zones => z => zones.find(zn => z >= zn.from && z <= zn.to) ?? null;

/**
 * How strongly the curved layers act at a height (0..1) when there are curved zones: each rises and falls over 3 × the
 * amplitude (less in a short zone), flat outside. Used as the envelope of the warp (field.js).
 */
export function curvedEnvelope(curvedZones, amplitude) {
  const A = Math.max(0.1, amplitude);
  return zp => {
    let m = 0;
    for (const zn of curvedZones) {
      const bl = Math.max(1e-6, Math.min(3 * A, (zn.to - zn.from) / 2));
      m = Math.max(m, smooth((zp - zn.from) / bl) * (1 - smooth((zp - (zn.to - bl)) / bl)));
    }
    return m;
  };
}
