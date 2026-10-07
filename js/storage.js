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
    strictMode: !!(document.getElementById('edit-strict') && document.getElementById('edit-strict').checked),
    lockCosmetics: !!(document.getElementById('edit-lock-cos') && document.getElementById('edit-lock-cos').checked),
    tags: String((document.getElementById('edit-tags') || {}).value || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 5),
    difficulty: document.getElementById('edit-difficulty').value || 'Normal',
    backgroundColor: document.getElementById('edit-bg-color')?.value || '#202738',
    backgroundBrightness: Number(document.getElementById('edit-bg-brightness')?.value || 100),
    bpm: Math.round(editorBpm),
    gridOffset: editorGridOffset,
    hasAudio: !!currentAudioBlob,
    audioName: currentAudioName || null,
    audioType: currentAudioType || null,
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
  if (persistMyLevels()) {
    try {
      if (currentAudioBlob) await saveLevelAudio(level.id);
      else if (!level.hasAudio) await deleteLevelAudio(level.id);
      closeCreatorMenu();
      toast(idx !== -1 ? 'Level updated.' : 'Saved to My Levels.', 'good');
    } catch (e) {
      closeCreatorMenu();
      toast('Level saved, but the song could not be stored.', 'bad');
    }
  }
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
  if (currentDraft && currentDraft.role === 'owner' && currentDraft.verifier) { closeCreatorMenu(); await draftPublishFlow(); return; }
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
let currentAudioBlob = null;
let currentAudioName = '';
let currentAudioType = '';

const LEVEL_AUDIO_DB = 'et_level_audio_db';
const LEVEL_AUDIO_STORE = 'audio';

function openLevelAudioDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB is not available.')); return; }
    const req = indexedDB.open(LEVEL_AUDIO_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEVEL_AUDIO_STORE)) db.createObjectStore(LEVEL_AUDIO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open level audio storage.'));
  });
}

async function saveLevelAudio(levelId) {
  if (!levelId || !currentAudioBlob) return;
  const db = await openLevelAudioDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(LEVEL_AUDIO_STORE, 'readwrite');
    tx.objectStore(LEVEL_AUDIO_STORE).put({
      blob: currentAudioBlob,
      name: currentAudioName,
      type: currentAudioType
    }, String(levelId));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save the level song.'));
  });
  db.close();
}

async function deleteLevelAudio(levelId) {
  if (!levelId || !window.indexedDB) return;
  try {
    const db = await openLevelAudioDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LEVEL_AUDIO_STORE, 'readwrite');
      tx.objectStore(LEVEL_AUDIO_STORE).delete(String(levelId));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {}
}

async function loadLevelAudio(levelId) {
  if (!levelId || !window.indexedDB) return false;
  try {
    const db = await openLevelAudioDb();
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction(LEVEL_AUDIO_STORE, 'readonly');
      const req = tx.objectStore(LEVEL_AUDIO_STORE).get(String(levelId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!entry || !entry.blob) return false;
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioBlob = entry.blob;
    currentAudioName = entry.name || '';
    currentAudioType = entry.type || entry.blob.type || '';
    currentAudioUrl = URL.createObjectURL(entry.blob);
    bgAudio.src = currentAudioUrl;
    bgAudio.load();
    return true;
  } catch (e) {
    return false;
  }
}

async function loadLevelAudioForEditor(level) {
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = null;
  currentAudioBlob = null;
  currentAudioName = '';
  currentAudioType = '';
  bgAudio.pause();
  bgAudio.removeAttribute('src');
  bgAudio.load();
  if (level && level.hasAudio && level.id) await loadLevelAudio(level.id);
  if (typeof refreshEditorTimeline === 'function') refreshEditorTimeline();
}

function loadAudioFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast("That song is too large - pick one under 10MB.", 'bad');
    event.target.value = "";
    return;
  }
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioBlob = file;
  currentAudioName = file.name;
  currentAudioType = file.type || 'audio/*';
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
  await deleteLevelAudio(level.id);
  return true;
}


// ---------------------------------------------------------------------------
// Auto-save (used when you leave a verification run for the main menu)
// ---------------------------------------------------------------------------
function autosaveEditorLevel() {
  if (!recordedTiles.length) return;
  const level = buildLevelObject(currentEditingName || 'Untitled level');
  if (currentEditingOnlineId) { level.onlineId = currentEditingOnlineId; level.published = true; }
  const idx = myLevels.findIndex(l => l.id === level.id);
  if (idx !== -1) { level.plays = myLevels[idx].plays || 0; level.createdAt = myLevels[idx].createdAt || level.createdAt; myLevels[idx] = level; }
  else myLevels.push(level);
  currentEditingId = level.id;
  persistMyLevels();
  if (currentAudioBlob) saveLevelAudio(level.id).catch(() => {});
  toast('Level auto-saved to My Levels.', 'good');
  if (currentDraft && currentDraft.role !== 'verifier') draftSave(true);
}

// ---------------------------------------------------------------------------
// Shared levels: collaborate on a level, give someone verification access
// ---------------------------------------------------------------------------
async function ensureDraft() {
  if (currentDraft) return currentDraft;
  if (!getAuthToken()) { toast('Log in to share a level.', 'bad'); return null; }
  if (!recordedTiles.length) { toast('Place some tiles first!'); return null; }
  const name = currentEditingName || (await uiPrompt('Name this shared level:', 'My Level', 'Share'));
  if (!name || !name.trim()) return null;
  currentEditingName = name.trim().slice(0, 80);
  const data = await apiRequest('/api/drafts', { method: 'POST', auth: true, body: buildLevelObject(currentEditingName) });
  currentDraft = { id: data.draft.id, rev: data.draft.rev, role: 'owner', verifier: null, verified: false };
  return currentDraft;
}

async function openShareLevel() {
  try {
    closeCreatorMenu();
    const d = await ensureDraft(); if (!d) return;
    if (d.role !== 'owner') { toast('Only the owner can change who has access.', 'bad'); return; }
    await draftSave(true);
    const r = await openFormDialog({
      title: 'Share "' + currentEditingName + '"', message: 'Editors can change the level. A verifier is the one who has to beat it before you can publish. Choose Remove to take someone off.',
      fields: [
        { id: 'username', label: 'Their username', type: 'text', value: '', maxlength: 20 },
        { id: 'role', label: 'Their role', type: 'select', value: 'editor', options: [{ value: 'editor', label: 'Editor (collaborator)' }, { value: 'verifier', label: 'Verifier' }, { value: 'remove', label: 'Remove access' }] }
      ], okText: 'Share'
    });
    if (!r || !r.username.trim()) return;
    await apiRequest('/api/drafts/' + d.id + '/share', { method: 'POST', auth: true, body: { username: r.username.trim(), role: r.role } });
    if (r.role === 'verifier') { d.verifier = r.username.trim(); d.verified = false; }
    toast(r.role === 'remove' ? 'Access removed.' : r.username.trim() + ' is now ' + (r.role === 'verifier' ? 'the verifier.' : 'an editor.') + ' Find it under Shared in My Levels.', 'good');
  } catch (e) { toast(e.message || 'Could not share the level.', 'bad'); }
}

async function draftSave(silent) {
  if (!currentDraft || currentDraft.role === 'verifier') { if (!silent) toast('Not a shared level (or you are only the verifier).'); return; }
  try {
    const data = await apiRequest('/api/drafts/' + currentDraft.id, { method: 'PUT', auth: true, body: { rev: currentDraft.rev, level: buildLevelObject(currentEditingName || 'My Level') } });
    currentDraft.rev = data.draft.rev; currentDraft.verified = false;
    if (!silent) { closeCreatorMenu(); toast('Shared level saved.', 'good'); }
  } catch (e) {
    if (e.status === 409) await uiAlert(e.message, 'Not saved');
    else if (!silent) toast(e.message || 'Could not save.', 'bad');
  }
}

async function draftMarkVerified() {
  if (!currentDraft) return;
  try {
    await apiRequest('/api/drafts/' + currentDraft.id + '/verified', { method: 'POST', auth: true, body: { rev: currentDraft.rev } });
    currentDraft.verified = true;
    toast(currentDraft.role === 'verifier' ? 'Verified! The owner can publish it now.' : 'Verified! Ready to publish.', 'good');
  } catch (e) { toast(e.message || 'Could not record the verification.', 'bad'); }
}

async function draftPublishFlow() {
  try {
    await draftSave(true);
    const list = await apiRequest('/api/drafts', { auth: true });
    const me = (list.drafts || []).find(x => x.id === currentDraft.id);
    if (!me || !me.verified) { await uiAlert('Waiting for ' + (currentDraft.verifier || 'your verifier') + ' to verify the latest save. They can open it from Shared in My Levels and play it through.', 'Not verified yet'); return; }
    if (!(await uiConfirm('Publish "' + currentEditingName + '" for everyone?', 'Publish'))) return;
    const data = await apiRequest('/api/drafts/' + currentDraft.id + '/publish', { method: 'POST', auth: true, body: {} });
    currentEditingOnlineId = data.level.id;
    await uiAlert('"' + currentEditingName + '" is live!', 'Published');
  } catch (e) { await uiAlert(e.message || 'Could not publish.', 'Publish failed'); }
}
