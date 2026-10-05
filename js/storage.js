// ============================================================================
// storage.js — "My Levels" (stored on this device), the API helper every
// online feature uses, and level save / publish / download / load.
//
// Changes: My Levels now live in one device-wide list (they used to be tied to
// whichever name you were using, so logging in made them "disappear"); the
// fake "local community library" is gone — Browse is the real server or an
// honest error; publishing needs an account; saving over a level you're
// editing updates it instead of duplicating it; prompt()/alert() are replaced
// by in-game dialogs.
// ============================================================================

const PROFILES_KEY = 'et_profiles';        // legacy (pre-account) storage, only read once for migration
const CURRENT_PROFILE_KEY = 'et_currentProfile';
const MY_LEVELS_KEY = 'et_myLevels';

let currentProfile = localStorage.getItem(CURRENT_PROFILE_KEY) || 'Guest';
let currentEditingId = null;
let currentEditingOnlineId = null;   // set while editing a level that is already published, so Publish UPDATES it

function loadMyLevels() {
  try {
    const stored = JSON.parse(localStorage.getItem(MY_LEVELS_KEY));
    if (Array.isArray(stored)) return stored;
  } catch (e) {}
  // one-time migration from the old per-profile storage
  const merged = [], seen = new Set();
  try {
    const old = JSON.parse(localStorage.getItem(PROFILES_KEY)) || {};
    Object.values(old).forEach(p => (p.customLevels || []).forEach(l => { if (l && !seen.has(l.id)) { seen.add(l.id); merged.push(l); } }));
  } catch (e) {}
  try { localStorage.setItem(MY_LEVELS_KEY, JSON.stringify(merged)); } catch (e) {}
  return merged;
}
let myLevels = loadMyLevels();

function getCustomLevels() { return myLevels; }
function persistMyLevels() {
  try { localStorage.setItem(MY_LEVELS_KEY, JSON.stringify(myLevels)); return true; }
  catch (e) { toast('Your browser storage is full - delete some levels or download them first.', 'bad'); return false; }
}
function persistProfiles() { return persistMyLevels(); } // kept for older call sites

function refreshProfileButton() {
  const label = document.getElementById('profile-name-label');
  if (label) label.textContent = currentProfile;
  const avatar = document.getElementById('profile-chip-avatar');
  if (avatar) {
    const user = typeof getAuthUser === 'function' ? getAuthUser() : null;
    const icon = user ? user.profileIcon : localStorage.getItem('et_guestIcon');
    avatar.innerHTML = icon ? '<img src="' + escapeHtml(icon) + '" alt="">' : escapeHtml(currentProfile.slice(0, 1).toUpperCase());
    avatar.style.background = icon ? '' : artGradient(currentProfile);
  }
}

// ---------------------------------------------------------------------------
// Server access. One helper so every screen reports problems the same way.
// ---------------------------------------------------------------------------
async function apiRequest(path, { method = 'GET', body, auth = false, timeout = 45000 } = {}) {
  if (!API_BASE_URL) throw new Error('The online server is not configured.');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) { const token = getAuthToken(); if (token) headers.Authorization = 'Bearer ' + token; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(API_BASE_URL + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? 'The server took too long to answer. It may be waking up - try again in a moment.'
      : 'Could not reach the 06-Tiles server.');
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (data && data.banned && auth && typeof handleBanned === 'function') handleBanned(data);
    const err = new Error((data && data.message) || ('Server error (' + res.status + ')'));
    err.status = res.status; err.banned = !!(data && data.banned);
    throw err;
  }
  return data;
}

async function getCommunityLevels(search = '', tab = 'recent') {
  const data = await apiRequest('/api/levels?search=' + encodeURIComponent(search) + '&tab=' + encodeURIComponent(tab));
  return Array.isArray(data) ? data : [];
}
async function getCommunityLevel(id) { return apiRequest('/api/levels/' + encodeURIComponent(id)); }
async function getMyPublishedLevels() { return apiRequest('/api/my/levels', { auth: true }); }

async function rateLevel(levelId, stars) {
  if (!getAuthToken()) throw new Error('Log in to rate levels.');
  return apiRequest('/api/levels/' + encodeURIComponent(levelId) + '/rate', { method: 'POST', body: { stars }, auth: true });
}

function registerPlay(levelId, fromCommunity) {
  if (fromCommunity) {
    if (API_BASE_URL) apiRequest('/api/levels/' + encodeURIComponent(levelId) + '/play', { method: 'POST', body: {} }).catch(() => {});
    return;
  }
  const lvl = myLevels.find(l => l.id === levelId);
  if (lvl) { lvl.plays = (lvl.plays || 0) + 1; persistMyLevels(); }
}

function getAvgRating(level) {
  if (!level.ratings || level.ratings.length === 0) return 0;
  return level.ratings.reduce((a, b) => a + b, 0) / level.ratings.length;
}

function estimateDifficulty(level) {
  if (level.difficulty) return level.difficulty;
  const tileCount = level.tileCount || (level.data || []).length;
  const duration = Math.max(1, (level.data || []).reduce((m, t) => Math.max(m, t.time), 1));
  const density = tileCount / duration;
  if (density < 1.2) return 'Easy';
  if (density < 2) return 'Normal';
  if (density < 3) return 'Hard';
  if (density < 4.2) return 'Insane';
  return 'Extreme';
}

function difficultyBadgeClass(diff) {
  return { Easy: 'diff-badge--easy', Normal: 'diff-badge--normal', Hard: 'diff-badge--hard', Insane: 'diff-badge--insane', Extreme: 'diff-badge--extreme' }[diff] || 'diff-badge--normal';
}

function makeLevelId() { return 'lvl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function buildLevelObject(name) {
  return {
    id: currentEditingId || makeLevelId(),
    name,
    author: currentProfile,
    icon: currentLevelIcon || null,
    data: JSON.parse(JSON.stringify(recordedTiles)),
    effects: JSON.parse(JSON.stringify(recordedEffects)),
    lives: parseInt(document.getElementById('edit-lives').value) || 3,
    fps: parseInt(document.getElementById('edit-fps').value) || 60,
    audioOffset: parseInt(document.getElementById('edit-audio-offset').value) || 0,
    disableHolds: document.getElementById('edit-disable-holds').checked,
    difficulty: document.getElementById('edit-difficulty').value || 'Normal',
    backgroundColor: document.getElementById('edit-bg-color')?.value || '#202738',
    backgroundBrightness: Number(document.getElementById('edit-bg-brightness')?.value || 100),
    bpm: Math.round(editorBpm),
    gridOffset: editorGridOffset,
    plays: 0,
    createdAt: Date.now()
  };
}

async function saveCustomLevel() {
  if (recordedTiles.length === 0) { toast('Place some tiles first!'); return; }
  const name = await uiPrompt('Save level as:', currentEditingName || 'My Level');
  if (!name || !name.trim()) return;
  currentEditingName = name.trim().slice(0, 80);
  const level = buildLevelObject(currentEditingName);
  const idx = myLevels.findIndex(l => l.id === level.id);
  if (currentEditingOnlineId) { level.onlineId = currentEditingOnlineId; level.published = true; }
  if (idx !== -1) { level.plays = myLevels[idx].plays || 0; level.createdAt = myLevels[idx].createdAt || level.createdAt; myLevels[idx] = level; }
  else myLevels.push(level);
  currentEditingId = level.id;
  if (persistMyLevels()) { closeCreatorMenu(); toast(idx !== -1 ? 'Level updated.' : 'Saved to My Levels.', 'good'); }
}

function startLevelVerification() {
  if (recordedTiles.length === 0) {
    toast('Place some tiles first!');
    pendingPublishAfterVerification = false;
    return;
  }
  levelVerified = false;
  isVerifying = true;
  closeCreatorMenu();
  startGame('verify', true, -1, recordedTiles, recordedEffects, false, null);
}

async function publishLevel() {
  if (recordedTiles.length === 0) { toast('Place some tiles first!'); return; }
  if (!getAuthToken()) {
    closeCreatorMenu();
    if (await uiConfirm('You need an account to publish levels (so they have an author and you can remove them later). Log in now? Your level stays in the editor.', 'Log in')) {
      stopEditorTransport();
      document.getElementById('editor-ui').classList.add('hidden');
      inEditor = false; stopLoop();
      returnToEditorAfterAccount = true;
      openProfileModal();
    }
    return;
  }
  if (!levelVerified) {
    pendingPublishAfterVerification = true;
    startLevelVerification();
    return;
  }
  await publishVerifiedLevel();
}
let returnToEditorAfterAccount = false;

async function publishVerifiedLevel() {
  const updating = !!currentEditingOnlineId;
  updating_note = false;
  const name = await uiPrompt(updating ? 'Update your published level as:' : 'Publish as:', currentEditingName || 'My Level', updating ? 'Update' : 'Publish');
  if (!name || !name.trim()) return;
  currentEditingName = name.trim().slice(0, 80);
  const level = buildLevelObject(currentEditingName);
  closeCreatorMenu();
  try {
    toast(updating ? 'Updating…' : 'Publishing…');
    let data;
    if (updating) {
      try { data = await apiRequest('/api/levels/' + encodeURIComponent(currentEditingOnlineId), { method: 'PUT', body: level, auth: true }); }
      catch (e) {
        if (e.status !== 404) throw e;
        currentEditingOnlineId = null;   // it was removed online - publish it as a new level instead
        data = await apiRequest('/api/levels', { method: 'POST', body: level, auth: true });
        updating_note = true;
      }
    } else {
      data = await apiRequest('/api/levels', { method: 'POST', body: level, auth: true });
    }
    level.published = true; level.onlineId = data.level && data.level.id;
    currentEditingOnlineId = level.onlineId;
    // remember it locally too, so My Levels shows it as published
    const idx = myLevels.findIndex(l => l.id === level.id);
    if (idx !== -1) { level.plays = myLevels[idx].plays || 0; level.createdAt = myLevels[idx].createdAt || level.createdAt; myLevels[idx] = level; } else myLevels.push(level);
    currentEditingId = level.id;
    persistMyLevels();
    await uiAlert(updating && !updating_note ? '"' + currentEditingName + '" was updated for everyone.' : '"' + currentEditingName + '" is live! Anyone can find it in Browse.', updating ? 'Updated' : 'Published');
  } catch (e) {
    await uiAlert(e.message || 'Could not publish the level.', 'Publish failed');
  }
}
let updating_note = false;

function downloadLevelData() {
  const name = currentEditingName || "My_Level";
  const lvlData = { ...buildLevelObject(name) };
  delete lvlData.id; delete lvlData.plays; delete lvlData.createdAt;
  const blob = new Blob([JSON.stringify(lvlData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[^\w\- ]+/g, '_') + ".json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function loadCustomLevelFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const levelData = JSON.parse(e.target.result);
      if (!levelData || !Array.isArray(levelData.data) || levelData.data.length === 0) throw new Error('no tiles');
      const clean = levelData.data.filter(t => t && Number.isInteger(t.lane) && t.lane >= 0 && t.lane <= 3 && Number.isFinite(Number(t.time)));
      if (!clean.length) throw new Error('no valid tiles');
      levelData.data = clean;
      tempLoadedLevel = levelData;
      startGame(levelData.name || 'Loaded Level', true, -1, levelData.data, levelData.effects || [], false, levelData);
    } catch (err) {
      toast("That doesn't look like a valid level file.", 'bad');
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

let currentAudioUrl = null;
function loadAudioFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast("That song is too large - pick one under 10MB.", 'bad');
    event.target.value = "";
    return;
  }
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(file);
  bgAudio.src = currentAudioUrl; bgAudio.load();
  bgAudio.onloadedmetadata = () => { if (typeof refreshEditorTimeline === 'function') refreshEditorTimeline(); };
  toast('Song loaded: ' + file.name, 'good');
  event.target.value = "";
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updatePrimaryColor(val) {
  document.documentElement.style.setProperty('--blue', val);
  localStorage.setItem('et_primaryColor', val);
}

async function deleteCustomLevel(levelId) {
  const idx = myLevels.findIndex(level => level.id === levelId);
  if (idx === -1) return false;
  const level = myLevels[idx];
  if (!(await uiConfirm('Delete "' + level.name + '" from this device? This cannot be undone.' + (level.published ? ' (The published copy stays online; remove it from My Published.)' : ''), 'Delete', true))) return false;
  myLevels.splice(idx, 1);
  persistMyLevels();
  return true;
}
