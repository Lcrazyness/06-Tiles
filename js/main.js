// ============================================================================
// main.js — boot sequence + settings. Loaded last.
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedKeybinds();
  refreshProfileButton();
  restoreAuthSession();
  wireSpeedSliders();
  setEditorGrid(2);
  initMenuBackdrop();
  layoutCanvas();
  toggleMenu('main-menu');

  const savedColor = localStorage.getItem('et_primaryColor');
  if (savedColor) { updatePrimaryColor(savedColor); const p = document.getElementById('primary-color-picker'); if (p) p.value = savedColor; }
  const brightness = document.getElementById('game-brightness');
  if (brightness) { brightness.value = gameBrightness; updateGameBrightness(gameBrightness); }
  ['setting-show-hitboxes', 'setting-show-lane-text', 'setting-hide-death', 'setting-auto-retry'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = id === 'setting-show-hitboxes' ? showHitboxes : id === 'setting-show-lane-text' ? showLaneText : id === 'setting-hide-death' ? hideDeathScreen : autoRetry;
    el.addEventListener('change', saveExtraSettings);
  });
  const cbf = document.getElementById('setting-cbf');
  if (cbf) { cbf.checked = localStorage.getItem('et_cbf') !== 'false'; cbf.addEventListener('change', () => localStorage.setItem('et_cbf', String(cbf.checked))); }
  { // progress bar / practice / editor settings
    const pb = document.getElementById('setting-progress-bar'), ac = document.getElementById('setting-auto-cp'), acs = document.getElementById('setting-auto-cp-sec'), ns = document.getElementById('setting-no-snap');
    if (pb) { pb.checked = showProgressBar; pb.addEventListener('change', () => { showProgressBar = pb.checked; localStorage.setItem('et_progBar', String(pb.checked)); }); }
    if (ac) { ac.checked = autoCheckpoints; ac.addEventListener('change', () => { autoCheckpoints = ac.checked; localStorage.setItem('et_autoCP', String(ac.checked)); }); }
    if (acs) { acs.value = autoCheckpointSec; acs.addEventListener('change', () => { autoCheckpointSec = Math.max(1, Math.min(30, Number(acs.value) || 3)); acs.value = autoCheckpointSec; localStorage.setItem('et_autoCPSec', String(autoCheckpointSec)); }); }
    if (ns) { ns.checked = localStorage.getItem('et_noSnap') === 'true'; ns.addEventListener('change', () => localStorage.setItem('et_noSnap', String(ns.checked))); }
  }
  document.querySelectorAll('[id^="keybind-"]').forEach((el, i) => { if (keyMap[i]) el.value = keyMap[i]; });
  const levelBg = document.getElementById('edit-bg-color');
  if (levelBg) levelBg.addEventListener('input', e => { currentLevelBackground = e.target.value; if (inEditor) applyEditorBackground(); });
});

function updateGameBrightness(value) {
  gameBrightness = Math.max(70, Math.min(140, Number(value) || 100));
  localStorage.setItem('et_gameBrightness', String(gameBrightness));
  const el = document.getElementById('game-brightness-value');
  if (el) el.textContent = gameBrightness + '%';
}

function toggleExtraSettings() {
  const panel = document.getElementById('extra-settings-panel');
  if (panel) panel.classList.toggle('hidden');
}

function saveExtraSettings() {
  showHitboxes = !!document.getElementById('setting-show-hitboxes')?.checked;
  showLaneText = !!document.getElementById('setting-show-lane-text')?.checked;
  hideDeathScreen = !!document.getElementById('setting-hide-death')?.checked;
  autoRetry = !!document.getElementById('setting-auto-retry')?.checked;
  localStorage.setItem('et_showHitboxes', String(showHitboxes));
  localStorage.setItem('et_showLaneText', String(showLaneText));
  localStorage.setItem('et_hideDeathScreen', String(hideDeathScreen));
  localStorage.setItem('et_autoRetry', String(autoRetry));
}

function applyKeybindSettings() {
  const proposed = [0, 1, 2, 3].map(i => (document.getElementById('keybind-' + i)?.value || '').trim().toLowerCase()).map(v => v.length ? v[0] : '');
  if (proposed.some(v => !/^[a-z0-9]$/.test(v))) { toast('Each lane key must be one letter or number.', 'bad'); return; }
  if (new Set(proposed).size !== 4) { toast('Each lane must use a different key.', 'bad'); return; }
  keyMap = proposed;
  Object.keys(keys).forEach(k => { keys[k] = false; });
  proposed.forEach(k => { keys[k] = false; });
  localStorage.setItem('et_keyMap', JSON.stringify(keyMap));
  toast('Keybinds: ' + keyMap.map(k => k.toUpperCase()).join(' · '), 'good');
}

function loadSavedKeybinds() {
  try {
    const saved = JSON.parse(localStorage.getItem('et_keyMap') || 'null');
    if (Array.isArray(saved) && saved.length === 4 && new Set(saved).size === 4 && saved.every(v => /^[a-z0-9]$/.test(v))) {
      keyMap = saved; saved.forEach(k => { keys[k] = false; });
    }
  } catch {}
}

// Admin shortcut: "0" opens the admin panel — but never while you're typing (e.g. a password containing 0).
document.addEventListener('keydown', event => {
  if (event.key !== '0' || event.repeat || isTypingTarget(event) || dialogOpen() || gameActive || inEditor) return;
  const user = getAuthUser();
  if (user && user.isAdmin && getAuthToken()) loadAdminPanel();
});
