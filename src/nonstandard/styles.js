// The non-standard styles, one entry each. To add a style: add an entry here (its settings, how it shapes the wall,
// its warnings); the settings form, the zone editor and the engine pick it up from this registry.
//
// A style entry:
//   label      name in the UI
//   params     settings a zone can override, as schema fields { k, label, unit, def, step, min, max, type?, opts?, help }
//   extra      settings of the style that apply to the whole model (not per zone), same shape
//   legacyZone(o, top, baseTop)   the zone a single-style slice (no zones) covers: { from, to }
//   turn(c)    called once per turn of the helix, returns how to shape it:
//                { step, perHorizontalMm, shape(s, zb) -> { u, dz, dn, kap } }
//              step: mm between points; perHorizontalMm: clay counted per mm of horizontal advance (inclined walls);
//              shape: for the fraction s of the turn (zb = height of the wall there): the fraction u of the turn to
//              sample the outline at, the extra height dz, the shift dn along the outward normal, and the local layer
//              spacing kap relative to the layer height.
//              c = { zn (zone), Z (settings of the zone), o (all settings), L (turn length), rise, top, zonesMode }
//   hop(Z, o, warp)     extra lift (mm) for travel moves to and from this style's wall
//   climbDeg(Z)         steepest climb of the wall in degrees, if it can be worked out from the settings (optional)
//   warnings(Z)         list of texts for settings that do not work as given (optional)
//   describe(Z)         one line for the G-code header
// The curved style is special: it warps the mesh (field.js), so its turn() only reports step and flags.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const loopSize = Z => Math.max(0.3, Z.lpSize / 2);                   // loop radius

export const STYLES = {
  curved: {
    label: 'Curved layers',
    params: [
      { k: 'npType', label: 'Layer shape', type: 'select', def: 'wave',
        opts: [['wave', 'Wave (sine across the part)'], ['ripple', 'Ripple (rings from the center)'], ['cone', 'Cone (center higher)']],
        help: 'Shape of the layers. Wave: straight ridges across the part. Ripple: concentric rings. Cone: layers rise toward the center by the amplitude.' },
      { k: 'npAmp', label: 'Amplitude', unit: 'mm', def: 4, step: 0.5, min: 0.5, max: 30,
        help: 'How far the layers rise and fall (wave, ripple: ± this value; cone: total rise). The ramp from flat to wavy is 3 × amplitude tall, which keeps the layer thickness within 50–150 % of the layer height.' },
      { k: 'npLen', label: 'Wavelength', unit: 'mm', def: 60, step: 5, min: 10, max: 400,
        help: 'Distance between two crests (wave, ripple). Not used by the cone. Steepest slope = atan(2π × amplitude / wavelength); keep it under about 30° so the nozzle clears the print.' },
      { k: 'npAngle', label: 'Wave direction', unit: '°', def: 0, step: 5, min: -360, max: 360,
        help: 'Direction in which the wave travels (0° = along X). Wave shape only.' },
    ],
    extra: [],
    legacyZone: (o, top, baseTop) => ({ from: Math.max(o.npBase, baseTop), to: Infinity }),
    turn: () => ({ step: 1, perHorizontalMm: true, shape: s => ({ u: s, dz: 0, dn: 0, kap: 1 }) }),
    hop: (Z, o, warp) => 2 * warp.A + 1,
    describe: Z => `curved layers (${Z.npType}, amplitude ${Z.npAmp} mm, wavelength ${Z.npLen} mm, direction ${Z.npAngle}°)`,
  },

  ruffle: {
    label: 'Ruffled wall',
    params: [
      { k: 'rfAmp', label: 'Wave height', unit: 'mm', def: 6, step: 0.5, min: 0.5, max: 30,
        help: 'How far the wall rises and falls (± this value). Every layer repeats the one below, so the layers stay evenly spaced.' },
      { k: 'rfLen', label: 'Wavelength', unit: 'mm', def: 30, step: 1, min: 4, max: 200,
        help: 'Length of one wave along the wall. Adjusted slightly per loop so the waves close up at the seam.' },
      { k: 'rfRadial', label: 'In / out', unit: 'mm', def: 3, step: 0.5, min: -20, max: 20,
        help: 'How far the wall moves outward at a crest and inward at a trough (negative = reversed). 0 = waves in height only.' },
    ],
    extra: [],
    legacyZone: (o, top, baseTop) => ({ from: Math.max(o.npBase, baseTop), to: Infinity }),
    turn({ zn, Z, L, rise, top, zonesMode }) {
      const a = Z.rfAmp, b = Z.rfRadial, lam = Math.max(4, Z.rfLen), n = Math.max(1, Math.round(L / lam));
      // Envelope: in over 3 × the larger of height and in/out (the layer thickness stays within 50-150 %), and out
      // again at the top of a zone, unless the zone runs to the top of the model or is a single-style slice.
      const bl = Math.max(1e-6, Math.min(Math.max(3 * a, 3 * Math.abs(b)), zonesMode ? (zn.to - zn.from) / 2 : Infinity));
      const w = z => smooth((z - zn.from) / bl) * (zn.to >= top - 0.01 || zn.legacy ? 1 : 1 - smooth((z - (zn.to - bl)) / bl));
      return {
        step: clamp(lam / 16, 0.5, 2), perHorizontalMm: true,
        shape(s, zb) {
          const sn = Math.sin(TAU * n * s), wv = w(zb);
          return { u: s, dz: a * wv * sn, dn: b * wv * sn, kap: 1 + a * sn * (wv - w(zb - rise)) / rise };
        },
      };
    },
    hop: Z => 2 * (Z.rfAmp + Math.abs(Z.rfRadial)) + 1,
    climbDeg: Z => Math.atan(Z.rfAmp * TAU / Math.max(4, Z.rfLen)) * 180 / Math.PI,
    describe: Z => `ruffled wall (amplitude ${Z.rfAmp} mm, wavelength ${Z.rfLen} mm, in/out ${Z.rfRadial} mm)`,
  },

  loops: {
    label: 'Loop texture',
    params: [
      { k: 'lpSize', label: 'Loop diameter', unit: 'mm', def: 3, step: 0.5, min: 1, max: 12,
        help: 'Size of each loop along the wall. The loop is as tall as at most 1.2 × the layer height, so the next layer clears it.' },
      { k: 'lpSpacing', label: 'Loop spacing', unit: 'mm', def: 5, step: 0.5, min: 1, max: 40,
        help: 'Distance between loops along the wall. Capped at 5.5 × the radius, otherwise the path does not close into loops.' },
    ],
    extra: [
      { k: 'lpFrom', label: 'Texture from', unit: '% height', def: 20, step: 5, min: 0, max: 100,
        help: 'Loops start at this share of the model height; below it the wall is plain.' },
      { k: 'lpTo', label: 'Texture to', unit: '% height', def: 80, step: 5, min: 0, max: 100,
        help: 'Loops stop here; above it the wall is plain again.' },
    ],
    legacyZone: (o, top, baseTop) => ({ from: Math.max(baseTop, top * o.lpFrom / 100), to: top * o.lpTo / 100 }),
    turn({ Z, o, L }) {
      const r = loopSize(Z), pitch = Math.min(Math.max(1, Z.lpSpacing), 5.5 * r);   // pitch < 2π·r, or no loop forms
      const zr = Math.min(r, o.layerH * 1.2), n = Math.max(1, Math.round(L / pitch));   // loops stay flat enough for the next layer
      return {
        step: Math.min(0.5, pitch / 20), perHorizontalMm: false,
        shape(s) { const ph = TAU * n * s; return { u: s - r / L * Math.sin(ph), dz: zr * (1 - Math.cos(ph)), dn: 0, kap: 1 }; },
      };
    },
    hop: (Z, o) => 2 * Math.min(loopSize(Z), o.layerH * 1.2) + 1,
    warnings: Z => Z.lpSpacing > 5.5 * loopSize(Z) ? [`Loop spacing reduced to ${(5.5 * loopSize(Z)).toFixed(1)} mm so the path forms loops at this size.`] : [],
    describe: Z => `loop texture (loop Ø ${Z.lpSize} mm, spacing ${Z.lpSpacing} mm)`,
  },
};

/** Settings of the whole model that two styles share (so they are listed once). */
const SHARED = [
  { styles: ['curved', 'ruffle'], field: { k: 'npBase', label: 'Flat base height', unit: 'mm', def: 5, step: 1, min: 0, max: 200,
    help: 'Layers up to this height are flat, so the print sits on the bed; the effect grows above it.' } },
];

/** The schema rows (core/schema.js) of all styles: each shown only while its style is selected. */
export function styleSchemaFields() {
  const rows = [];
  for (const [id, st] of Object.entries(STYLES)) {
    for (const f of st.params) rows.push({ ...f, dep: ['npMode', [id]] });
    for (const f of st.extra) rows.push({ ...f, dep: ['npMode', [id]] });
    for (const sh of SHARED) if (sh.styles.at(-1) === id) rows.push({ ...sh.field, dep: ['npMode', sh.styles] });   // after its last style
  }
  return rows;
}
