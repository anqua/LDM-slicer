// Model summary in the floating status card and the Model pane.
import { S } from '../core/settings.js';

/** @param info result of model.info(), or null */
export function renderModelStatus(info) {
  const card = document.getElementById('status');
  const box = document.getElementById('modelInfo');
  if (!info) {
    card.textContent = 'No model loaded';
    if (box) box.textContent = 'No model loaded.';
    return;
  }
  const { name, size, triangles, fits } = info;
  const dims = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
  const layers = Math.round(size.z / S.layerH);

  card.innerHTML = `<b>${name}</b> · ${dims}` + (fits ? '' : ` · <span class="err">doesn't fit</span>`);
  if (box) {
    box.innerHTML = `<b>${name}</b><br>${dims}<br>${triangles.toLocaleString()} triangles · ≈${layers} layers at ${S.layerH} mm`
      + (fits ? '' : `<br><span class="err">Model is outside the build volume.</span>`);
  }
}
