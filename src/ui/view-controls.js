// Viewport buttons (3D / Top / Front, projection toggle) and keyboard shortcuts.
const typing = e => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);

/**
 * @param rig    camera rig from viewer/camera-rig.js
 * @param frame  (view) => void, frames the scene for 'iso' | 'top' | 'front'
 */
export function initViewControls(rig, frame) {
  document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => frame(b.dataset.cam)));

  const projBtn = document.getElementById('proj');
  const label = kind => { projBtn.textContent = kind === 'ortho' ? 'Orthographic' : 'Perspective'; };
  projBtn.addEventListener('click', rig.toggleProjection);
  rig.onProjectionChange(label);
  label(rig.projection());

  addEventListener('keydown', e => {
    if (typing(e)) return;
    if (e.key.toLowerCase() === 'o') rig.toggleProjection();
  });
}
