// "Open STL" button and drag-and-drop anywhere on the page.
export function initFileInput(onFile) {
  const input = document.getElementById('file');
  input.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) onFile(f);
    e.target.value = '';          // allow re-opening the same file
  });

  const overlay = document.getElementById('drop');
  addEventListener('dragover', e => { e.preventDefault(); overlay.style.display = 'flex'; });
  addEventListener('dragleave', e => { if (!e.relatedTarget) overlay.style.display = 'none'; });
  addEventListener('drop', e => {
    e.preventDefault();
    overlay.style.display = 'none';
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}
