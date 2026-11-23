// The picture in the zone editor: the model's silhouette cut into the bands of its zones, with a draggable boundary
// between zones. Pure drawing: ui/zones.js owns the state and the events.

export const W = 300, H = 300;                         // size of the drawing (viewBox)
const X0 = 50, X1 = 250, Y0 = 14, Y1 = 286, CX = 150; // the band area and the vertical range of the model
const BAND = { standard: '#000000', curved: '#0b2a3d', ruffle: '#0b3d17', loops: '#3d340b' };   // fill of a zone by style

/** Height (mm) <-> y in the drawing, for a model `top` mm tall. */
export function scale(top) {
  return {
    y: mm => Y1 - (Y1 - Y0) * mm / top,
    mmAt: py => Math.max(0, Math.min(top, (Y1 - py) / (Y1 - Y0) * top)),
  };
}

/** The outline polygon of the model from its radius per height bin (bottom to top). */
function outline(radii) {
  const n = radii.length, sx = 90 / Math.max(...radii, 1);
  const left = [], right = [];
  radii.forEach((v, i) => {
    const yy = (Y1 - (Y1 - Y0) * (i + 0.5) / n).toFixed(1);
    left.push([(CX - v * sx).toFixed(1), yy]);
    right.push([(CX + v * sx).toFixed(1), yy]);
  });
  const bottomRight = right[0][0];
  const pts = [[left[0][0], Y1], ...left, ...right.reverse(), [bottomRight, Y1]];    // up the left side, down the right, close on the floor
  return pts.map(p => p.join(',')).join(' ');
}

/**
 * @param c { radii, zones: [{ from, to, style }], sel: selected zone, top, labelOf(style) -> name }
 * @returns the <svg> markup. Boundary handles carry data-h = index of the zone above the boundary.
 */
export function silhouetteSVG({ radii, zones, sel, top, labelOf }) {
  const { y } = scale(top), poly = outline(radii);
  const bands = zones.map((zn, i) => `<rect x="${X0}" y="${y(zn.to).toFixed(1)}" width="${X1 - X0}" height="${(y(zn.from) - y(zn.to)).toFixed(1)}" fill="${BAND[zn.style] ?? '#000'}"${i === sel ? ' stroke="var(--accent)" stroke-width="1"' : ''}/>`).join('');
  const handles = zones.slice(1).map((zn, i) => {
    const yy = y(zn.from);
    return `<g data-h="${i + 1}" style="cursor:ns-resize"><line x1="${X0 - 8}" y1="${yy.toFixed(1)}" x2="${X1 + 8}" y2="${yy.toFixed(1)}" stroke="var(--accent)" stroke-dasharray="4 4"/>`
      + `<rect x="${X0 - 14}" y="${yy - 6}" width="12" height="12" rx="2" fill="var(--accent)"/><rect x="${X1 + 2}" y="${yy - 6}" width="12" height="12" rx="2" fill="var(--accent)"/>`
      + `<text x="${X1 + 18}" y="${yy + 4}" font-size="11" fill="var(--accent)" font-family="var(--font-mono)">${zn.from.toFixed(0)}</text></g>`;
  }).join('');
  const labels = zones.map((zn, i) => `<text x="${X0 + 6}" y="${((y(zn.from) + y(zn.to)) / 2 + 4).toFixed(1)}" font-size="11" fill="${i === sel ? 'var(--accent)' : 'var(--muted)'}" font-family="var(--font-mono)">${i + 1} ${labelOf(zn.style).toLowerCase()}</text>`).join('');
  return `<svg id="zsvg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;background:#000;border:1px solid var(--line);border-radius:8px;touch-action:none" role="img" aria-label="Model silhouette with zone boundaries">
    <defs><clipPath id="zclip"><polygon points="${poly}"/></clipPath></defs>
    <g clip-path="url(#zclip)">${bands}</g>
    <polygon points="${poly}" fill="none" stroke="#6b6b6b"/>
    ${labels}${handles}
    <text x="6" y="${Y0 + 4}" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">${top.toFixed(0)}</text><text x="6" y="${Y1 + 2}" font-size="11" fill="var(--muted)" font-family="var(--font-mono)">0</text>
  </svg>`;
}
