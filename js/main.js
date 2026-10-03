// ============================================================================
// main.js — boot sequence. Loaded last, after every other module exists.
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  refreshProfileButton();
  restoreAuthSession();
  wireSpeedSliders();
  setEditorGrid(2);
  initArenaChannel();

  const brightness = document.getElementById('game-brightness');
  if (brightness) {
    brightness.value = gameBrightness;
    updateGameBrightness(gameBrightness);
  }
  ['setting-show-hitboxes','setting-show-lane-text','setting-hide-death','setting-auto-retry'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = id === 'setting-show-hitboxes' ? showHitboxes : id === 'setting-show-lane-text' ? showLaneText : id === 'setting-hide-death' ? hideDeathScreen : autoRetry;
    if (el) el.addEventListener('change', saveExtraSettings);
  });
  document.querySelectorAll('[id^="keybind-"]').forEach((el, i) => { if (keyMap[i]) el.value = keyMap[i]; });
  const levelBg = document.getElementById('edit-bg-color');
  if (levelBg) levelBg.addEventListener('input', e => { currentLevelBackground = e.target.value; });
  const extraSettings = document.getElementById('extra-settings-panel');
  if (extraSettings) extraSettings.classList.add('hidden');
});


function updateGameBrightness(value) {
  gameBrightness = Math.max(70, Math.min(140, Number(value) || 100));
  localStorage.setItem('et_gameBrightness', String(gameBrightness));
  const el = document.getElementById('game-brightness-value');
  if (el) el.textContent = gameBrightness + '%';
  if (!inEditor && !gameActive) {
    canvas.style.filter = 'brightness(' + (gameBrightness / 100) + ')';
  }
}

function toggleExtraSettings() {
  const panel = document.getElementById('extra-settings-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
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
  const inputs = [0,1,2,3].map(i => document.getElementById('keybind-' + i));
  const proposed = inputs.map(input => (input?.value || '').trim().toLowerCase()).map(value => value.length ? value[0] : '');
  if (proposed.some(value => !/^[a-z0-9]$/.test(value))) {
    alert('Each lane key must be one letter or number.');
    return;
  }
  if (new Set(proposed).size !== 4) {
    alert('Each lane must use a different key.');
    return;
  }
  keyMap = proposed;
  Object.keys(keys).forEach(key => { keys[key] = false; });
  proposed.forEach(key => { keys[key] = false; });
  localStorage.setItem('et_keyMap', JSON.stringify(keyMap));
  alert('Keybinds updated: ' + keyMap.map((key, i) => 'Lane ' + (i + 1) + ' = ' + key.toUpperCase()).join(' · '));
}

function loadSavedKeybinds() {
  try {
    const saved = JSON.parse(localStorage.getItem('et_keyMap') || 'null');
    if (Array.isArray(saved) && saved.length === 4 && new Set(saved).size === 4 && saved.every(v => /^[a-z0-9]$/.test(v))) keyMap = saved;
  } catch {}
}

loadSavedKeybinds();


// Admin shortcut: pressing 0 opens the admin panel for the wCrazyNess account.
document.addEventListener('keydown', event => {
  if (event.key !== '0' || event.repeat) return;
  const user = typeof getAuthUser === 'function' ? getAuthUser() : null;
  const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
  if (!user || String(user.username || '').trim().toLowerCase() !== 'wcrazyness' || !token) return;
  if (typeof loadAdminPanel === 'function') loadAdminPanel();
});
