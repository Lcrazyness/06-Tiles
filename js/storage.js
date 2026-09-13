// ============================================================================
// storage.js — everything backed by localStorage: profiles, "My Levels",
// and the local community library.
//
// Honesty note (this replaced the old system on purpose): the previous
// version had a LOGIN / SIGN UP flow that stored usernames and *plaintext
// passwords* in localStorage — there's no server here, so that password was
// never actually protecting anything, just giving a false sense of security.
// This version uses named local profiles instead: no password, because
// there's nothing a password could meaningfully guard on a static site.
// Same goes for "PUBLISH TO CLOUD" — there is no cloud. It's relabelled
// "library" and the Browse screen says so up front.
// ============================================================================

const PROFILES_KEY = 'et_profiles';
const CURRENT_PROFILE_KEY = 'et_currentProfile';
const COMMUNITY_KEY = 'et_communityLevels';

function loadProfiles() {
  let profiles;
  try { profiles = JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; }
  catch (e) { profiles = {}; }
  if (!profiles['Guest']) profiles['Guest'] = { customLevels: [] };
  return profiles;
}
function saveProfilesObject(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

let profiles = loadProfiles();
let currentProfile = localStorage.getItem(CURRENT_PROFILE_KEY) || 'Guest';
if (!profiles[currentProfile]) currentProfile = 'Guest';

function getCustomLevels() {
  if (!profiles[currentProfile]) profiles[currentProfile] = { customLevels: [] };
  return profiles[currentProfile].customLevels;
}
function persistProfiles() { saveProfilesObject(profiles); }

function switchProfile(name) {
  if (!profiles[name]) return;
  currentProfile = name;
  localStorage.setItem(CURRENT_PROFILE_KEY, name);
  refreshProfileButton();
  if (typeof onProfileSwitched === 'function') onProfileSwitched();
}

function createProfile() {
  const input = document.getElementById('new-profile-name');
  const name = (input.value || '').trim().slice(0, 16);
  if (!name) return;
  if (profiles[name]) { alert('That name is already taken in this browser.'); return; }
  profiles[name] = { customLevels: [] };
  persistProfiles();
  input.value = '';
  switchProfile(name);
  renderProfileModal();
}

function refreshProfileButton() {
  const btn = document.getElementById('profile-btn');
  if (btn) btn.innerText = '👤 ' + currentProfile;
}

function renderProfileModal() {
  const list = document.getElementById('profile-modal-list');
  list.innerHTML = '';
  Object.keys(profiles).forEach(name => {
    const row = document.createElement('div');
    row.className = 'profile-row' + (name === currentProfile ? ' current' : '');
    row.onclick = () => { switchProfile(name); renderProfileModal(); };
    const levelCount = (profiles[name].customLevels || []).length;
    row.innerHTML = `
      <div class="profile-avatar">${name.slice(0, 1).toUpperCase()}</div>
      <div style="flex:1;">
        <div class="profile-row-name">${escapeHtml(name)}</div>
        <div class="profile-row-tag">${levelCount} level${levelCount === 1 ? '' : 's'}${name === currentProfile ? ' · active' : ''}</div>
      </div>`;
    list.appendChild(row);
  });
}

function openProfileModal() {
  renderProfileModal();
  toggleMenu('profile-modal');
}

// --- community library: real backend when API_BASE_URL is set, otherwise
// the same localStorage-backed fallback as before. Every function here is
// async now so callers work identically either way. ---

function getLocalCommunityLevels() {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_KEY)) || []; }
  catch (e) { return []; }
}
function setLocalCommunityLevels(levels) {
  localStorage.setItem(COMMUNITY_KEY, JSON.stringify(levels));
}

async function getCommunityLevels(search = '', tab = 'recent') {
  if (API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/levels?search=${encodeURIComponent(search)}&tab=${encodeURIComponent(tab)}`);
      if (!res.ok) throw new Error('bad response: ' + res.status);
      return await res.json();
    } catch (e) {
      console.warn('Backend unreachable, showing the local-only library instead.', e);
    }
  }
  return getLocalCommunityLevels();
}

function getAvgRating(level) {
  if (!level.ratings || level.ratings.length === 0) return 0;
  return level.ratings.reduce((a, b) => a + b, 0) / level.ratings.length;
}

async function rateLevel(levelId, stars, fromCommunity) {
  if (fromCommunity && API_BASE_URL) {
    try {
      await fetch(`${API_BASE_URL}/api/levels/${levelId}/rate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars })
      });
      return;
    } catch (e) { console.warn('Could not reach backend to rate this level.', e); return; }
  }
  const levels = fromCommunity ? getLocalCommunityLevels() : getCustomLevels();
  const lvl = levels.find(l => l.id === levelId);
  if (!lvl) return;
  lvl.ratings = lvl.ratings || [];
  lvl.ratings.push(stars);
  if (fromCommunity) setLocalCommunityLevels(levels); else persistProfiles();
}

async function registerPlay(levelId, fromCommunity) {
  if (fromCommunity && API_BASE_URL) {
    try { await fetch(`${API_BASE_URL}/api/levels/${levelId}/play`, { method: 'POST' }); return; }
    catch (e) { console.warn('Could not reach backend to register this play.', e); return; }
  }
  const levels = fromCommunity ? getLocalCommunityLevels() : getCustomLevels();
  const lvl = levels.find(l => l.id === levelId);
  if (!lvl) return;
  lvl.plays = (lvl.plays || 0) + 1;
  if (fromCommunity) setLocalCommunityLevels(levels); else persistProfiles();
}

function estimateDifficulty(level) {
  if (level.difficulty) return level.difficulty;
  const tileCount = (level.data || []).length;
  const duration = Math.max(1, (level.data || []).reduce((m, t) => Math.max(m, t.time), 1));
  const density = tileCount / duration; // tiles/sec, rough proxy for how demanding it is
  if (density < 1.2) return 'Easy';
  if (density < 2) return 'Normal';
  if (density < 3) return 'Hard';
  if (density < 4.2) return 'Insane';
  return 'Extreme';
}

function difficultyBadgeClass(diff) {
  return {
    Easy: 'diff-badge--easy', Normal: 'diff-badge--normal', Hard: 'diff-badge--hard',
    Insane: 'diff-badge--insane', Extreme: 'diff-badge--extreme'
  }[diff] || 'diff-badge--normal';
}

function makeLevelId() {
  return 'lvl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function buildLevelObject(name) {
  return {
    id: makeLevelId(),
    name: name,
    author: currentProfile,
    data: JSON.parse(JSON.stringify(recordedTiles)),
    effects: JSON.parse(JSON.stringify(recordedEffects)),
    lives: parseInt(document.getElementById('edit-lives').value) || 3,
    fps: parseInt(document.getElementById('edit-fps').value) || 60,
    audioOffset: parseInt(document.getElementById('edit-audio-offset').value) || 0,
    disableHolds: document.getElementById('edit-disable-holds').checked,
    difficulty: document.getElementById('edit-difficulty').value || 'Normal',
    ratings: [],
    plays: 0,
    createdAt: Date.now()
  };
}

function saveCustomLevel() {
  if (recordedTiles.length === 0) { alert('Place some tiles first!'); return; }
  const name = prompt('Save as:', currentEditingName || 'My Level');
  if (!name) return;
  currentEditingName = name;
  const level = buildLevelObject(name);
  getCustomLevels().push(level);
  persistProfiles();
  closeCreatorMenu();
  alert('Saved to My Levels.');
}

async function publishLevel() {
  if (recordedTiles.length === 0) { alert('Place some tiles first!'); return; }
  const name = prompt('Publish as:', currentEditingName || 'My Level');
  if (!name) return;
  currentEditingName = name;
  const level = buildLevelObject(name);
  closeCreatorMenu();

  if (API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/levels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(level)
      });
      if (!res.ok) throw new Error('bad response: ' + res.status);
      alert('Published! Anyone with the game can now find "' + name + '" in Browse Levels.');
      return;
    } catch (e) {
      console.warn('Backend publish failed, saving to the local library instead.', e);
      alert("Couldn't reach the backend, so this was saved to your local library instead (only visible in this browser). Check the server is deployed and API_BASE_URL in js/config.js is correct.");
    }
  } else {
    alert('Published to the local library. This is stored only in this browser — set API_BASE_URL in js/config.js once your backend is deployed to make this real.');
  }
  const community = getLocalCommunityLevels();
  community.unshift(level);
  setLocalCommunityLevels(community);
}

function downloadLevelData() {
  const name = currentEditingName || "My_Level";
  const lvlData = {
    name: name,
    data: [...recordedTiles],
    effects: [...recordedEffects],
    lives: parseInt(document.getElementById('edit-lives').value) || 3,
    fps: parseInt(document.getElementById('edit-fps').value) || 60,
    audioOffset: parseInt(document.getElementById('edit-audio-offset').value) || 0,
    disableHolds: document.getElementById('edit-disable-holds').checked,
    difficulty: document.getElementById('edit-difficulty').value || 'Normal'
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(lvlData, null, 2));
  const a = document.createElement('a');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", name + ".json");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function loadCustomLevelFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const levelData = JSON.parse(e.target.result);
      tempLoadedLevel = levelData;
      startGame(levelData.name || 'Loaded Level', true, -1, levelData.data, levelData.effects || [], false, levelData);
      event.target.value = "";
    } catch (err) {
      alert("Error parsing level file. Make sure it's a valid JSON format.");
    }
  };
  reader.readAsText(file);
}

function loadAudioFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    alert("File is too large! Please select a song under 10MB.");
    event.target.value = "";
    return;
  }
  const url = URL.createObjectURL(file);
  bgAudio.src = url; bgAudio.load();
  bgAudio.onloadedmetadata = () => {
    const slider = document.getElementById('timeline-slider');
    if (slider) slider.max = bgAudio.duration;
    if (typeof refreshEditorTimeline === 'function') refreshEditorTimeline();
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updatePrimaryColor(val) {
  document.documentElement.style.setProperty('--primary-theme', val);
  document.documentElement.style.setProperty('--play-blue', val);
}
