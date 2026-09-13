// ============================================================================
// main.js — boot sequence. Loaded last, after every other module exists.
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  refreshProfileButton();
  wireSpeedSliders();
  setEditorGrid(2);
  initArenaChannel();

  const bgPicker = document.getElementById('bg-color-picker');
  if (bgPicker) bgPicker.addEventListener('input', (e) => { document.body.style.background = e.target.value; });
});
