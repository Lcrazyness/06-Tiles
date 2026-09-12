// ============================================================================
// ui.js — small shared UI utilities used across menus.
// ============================================================================

function toggleMenu(id) {
  overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
  if (id) document.getElementById(id).classList.remove('hidden');
}

function wireSpeedSliders() {
  document.querySelectorAll('.speed-control input[type="range"]').forEach(slider => {
    const valId = 'val-' + slider.id.replace('speed-', '');
    const label = document.getElementById(valId);
    slider.addEventListener('input', () => { if (label) label.innerText = slider.value; });
  });
}
