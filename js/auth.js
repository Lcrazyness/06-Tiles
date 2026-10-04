// ============================================================================
// auth.js — online account, stats, profile icon, admin button.
// ============================================================================
const AUTH_TOKEN_KEY = 'et_authToken';
const AUTH_USER_KEY = 'et_authUser';

function getAuthToken() { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; }
function getAuthUser() { try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null'); } catch { return null; } }

function saveAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  currentProfile = user.username;
  localStorage.setItem(CURRENT_PROFILE_KEY, currentProfile);
  refreshProfileButton();
  updateAdminButton(user);
}
function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  currentProfile = 'Guest';
  localStorage.setItem(CURRENT_PROFILE_KEY, 'Guest');
  refreshProfileButton();
  updateAdminButton(null);
}

function setAccountStatus(message, bad) {
  const el = document.getElementById('account-status');
  if (el) { el.textContent = message || ''; el.classList.toggle('bad', !!bad); }
}

function renderAccountModal() {
  const modal = document.getElementById('profile-modal');
  const user = getAuthUser();
  const st = (user && user.statistics) || {};
  modal.innerHTML = user ? screenHtml('ACCOUNT', 'closeAccountModal()', `
      <div class="panel profile-hero">
        <div class="avatar big">${user.profileIcon ? '<img src="' + escapeHtml(user.profileIcon) + '" alt="">' : escapeHtml(user.username.slice(0, 1).toUpperCase())}</div>
        <div><div class="hero-name">${escapeHtml(user.username)}</div><div class="hero-sub">Online account${user.isAdmin ? ' · Admin' : ''}</div></div>
      </div>
      <label class="btn btn-ghost" for="profile-icon-upload">Change profile icon</label>
      <input type="file" id="profile-icon-upload" accept="image/*" style="display:none" onchange="uploadProfileIcon(event)">
      <div class="panel note">Games played ${st.gamesPlayed || 0} · Completed ${st.gamesCompleted || 0} · Best score ${st.bestScore || 0}</div>
      <button class="btn btn-ghost" onclick="logoutAccount()">Log out</button>`)
  : screenHtml('ACCOUNT', 'closeAccountModal()', `
      <div class="panel note">Log in to publish levels, rate them, show up on leaderboards and battle under your own name.</div>
      <input type="text" id="account-username" placeholder="Username or email" maxlength="254" autocomplete="username">
      <input type="email" id="account-email" placeholder="Email (only needed to create an account)" maxlength="254" autocomplete="email">
      <input type="password" id="account-password" placeholder="Password (8+ characters)" maxlength="128" autocomplete="current-password" onkeydown="if(event.key==='Enter')loginAccount()">
      <button class="btn btn-play" onclick="loginAccount()">LOG IN</button>
      <button class="btn btn-ghost" onclick="registerAccount()">CREATE ACCOUNT</button>
      <div id="account-status" class="status-line"></div>`);
}

function closeAccountModal() {
  if (returnToEditorAfterAccount) { returnToEditorAfterAccount = false; toggleMenu(null); enterEditorView(); return; }
  toggleMenu('main-menu');
}
function openProfileModal() { renderAccountModal(); toggleMenu('profile-modal'); }

async function authSubmit(path, body, busy) {
  setAccountStatus(busy);
  try {
    const data = await apiRequest(path, { method: 'POST', body });
    saveAuthSession(data.token, data.user);
    if (typeof disconnectBattle === 'function') disconnectBattle();
    if (returnToEditorAfterAccount) { toast('Logged in - hit Publish again.', 'good'); closeAccountModal(); return; }
    renderAccountModal();
  } catch (e) { setAccountStatus(e.message, true); }
}
function registerAccount() {
  const username = (document.getElementById('account-username')?.value || '').trim();
  const email = (document.getElementById('account-email')?.value || '').trim();
  const password = document.getElementById('account-password')?.value || '';
  if (!username || !email || !password) { setAccountStatus('Enter a username, email, and password.', true); return; }
  authSubmit('/api/auth/register', { username, email, password }, 'Creating account…');
}
function loginAccount() {
  const usernameOrEmail = (document.getElementById('account-username')?.value || '').trim();
  const password = document.getElementById('account-password')?.value || '';
  if (!usernameOrEmail || !password) { setAccountStatus('Enter your username/email and password.', true); return; }
  authSubmit('/api/auth/login', { usernameOrEmail, password }, 'Logging in… (the server may need a moment to wake up)');
}
function logoutAccount() { clearAuthSession(); if (typeof disconnectBattle === 'function') disconnectBattle(); renderAccountModal(); }

async function restoreAuthSession() {
  const token = getAuthToken();
  if (!token || !API_BASE_URL) { refreshProfileButton(); return; }
  try {
    const data = await apiRequest('/api/auth/me', { auth: true });
    if (data.success && data.user) saveAuthSession(token, data.user);
  } catch (e) {
    if (e.status === 401 || e.status === 404) clearAuthSession();   // only drop the session if the server actually rejected it
    else { refreshProfileButton(); updateAdminButton(getAuthUser()); }
  }
}

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}

function beginStatsGame() { statsGameFinalized = false; }
async function finishStatsGame(completed) {
  if (statsGameFinalized || !getAuthToken() || !API_BASE_URL || isPlaytesting || isVerifying || isBattleMode) return;
  statsGameFinalized = true;
  try {
    const data = await apiRequest('/api/stats/game', { method: 'POST', auth: true, body: { started: true, completed: !!completed, score: Math.floor(score), notesHit: notesHitThisGame } });
    if (data.user) saveAuthSession(getAuthToken(), data.user);
  } catch (e) { console.warn('Could not save game statistics.', e); }
}

function formatBattleWinRate(s) {
  const w = Number(s.battleWins || 0), l = Number(s.battleLosses || 0);
  return w + l ? Math.round((w / (w + l)) * 100) + '%' : '—';
}

function statsGridHtml(st) {
  const n = v => Number(v || 0).toLocaleString();
  return `<div class="stats-grid">
    <div class="stat-card"><span>GAMES PLAYED</span><b>${n(st.gamesPlayed)}</b></div>
    <div class="stat-card"><span>COMPLETED</span><b>${n(st.gamesCompleted)}</b></div>
    <div class="stat-card"><span>BEST SCORE</span><b>${n(st.bestScore)}</b></div>
    <div class="stat-card"><span>TOTAL SCORE</span><b>${n(st.totalScore)}</b></div>
    <div class="stat-card"><span>NOTES HIT</span><b>${n(st.totalNotesHit)}</b></div>
    <div class="stat-card"><span>BATTLE WIN RATE</span><b>${formatBattleWinRate(st)}</b></div></div>`;
}

async function openStatsModal() {
  const modal = document.getElementById('stats-modal');
  const user = getAuthUser();
  if (!user) {
    modal.innerHTML = screenHtml('PLAYER STATS', null, '<div class="panel note">Log in to track your online statistics.</div><button class="btn btn-play" onclick="openProfileModal()">LOG IN / CREATE ACCOUNT</button>');
    toggleMenu('stats-modal');
    return;
  }
  const draw = u => screenHtml('PLAYER STATS', null, `<div class="panel profile-hero"><div class="avatar big">${u.profileIcon ? '<img src="' + escapeHtml(u.profileIcon) + '" alt="">' : escapeHtml(u.username.slice(0, 1).toUpperCase())}</div><div><div class="hero-name">${escapeHtml(u.username)}</div><div class="hero-sub">Online account</div></div></div>` + statsGridHtml(u.statistics || {}));
  modal.innerHTML = draw(user);
  toggleMenu('stats-modal');
  try {
    const data = await apiRequest('/api/auth/me', { auth: true });
    if (data.user) { saveAuthSession(getAuthToken(), data.user); if (!modal.classList.contains('hidden')) modal.innerHTML = draw(data.user); }
  } catch (e) {}
}

async function uploadProfileIcon(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image.'); return; }
  try {
    const icon = await downscaleImage(file, 192);
    const data = await apiRequest('/api/profile', { method: 'PATCH', auth: true, body: { profileIcon: icon } });
    saveAuthSession(getAuthToken(), data.user);
    renderAccountModal();
    toast('Profile icon updated.', 'good');
  } catch (e) { toast(e.message || 'Could not update the icon.', 'bad'); }
}

// The admin button is driven by what the SERVER says, not by a hard-coded name in the browser.
async function updateAdminButton(user) {
  const button = document.getElementById('admin-btn');
  if (!button) return;
  button.classList.toggle('hidden', !(user && user.isAdmin));
}
