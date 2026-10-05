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
  if (user && user.warning && !warningShown && !warningAckPending) showWarning(user.warning);
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
      <div class="panel note">★ ${user.stars || 0} stars · ${user.creatorPoints || 0} creator points · Games ${st.gamesPlayed || 0} · Completed ${st.gamesCompleted || 0} · Best score ${st.bestScore || 0}</div>
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
  // Only levels played from Browse > Levels count - not the endless modes, loaded files or your own levels
  // (the server also refuses your own published levels).
  const a = lastStartArgs;
  const lvl = a && a[5] ? a[6] : null;
  if (!lvl || !lvl.id) return;
  statsGameFinalized = true;
  const before = getAuthUser();
  try {
    const data = await apiRequest('/api/stats/game', { method: 'POST', auth: true, body: { levelId: lvl.id, started: true, completed: !!completed, score: Math.floor(score), notesHit: notesHitThisGame } });
    if (data.user) {
      saveAuthSession(getAuthToken(), data.user);
      const gained = Number(data.user.stars || 0) - Number((before && before.stars) || 0);
      if (completed && gained > 0) toast('+' + gained + ' ★ star' + (gained === 1 ? '' : 's') + ' earned!', 'good');
    }
  } catch (e) { console.warn('Could not save game statistics.', e); }
}

function formatBattleWinRate(s) {
  const w = Number(s.battleWins || 0), l = Number(s.battleLosses || 0);
  return w + l ? Math.round((w / (w + l)) * 100) + '%' : '—';
}

function difficultyBeatenHtml(u) {
  const counts = (u && u.difficultyCounts) || {};
  return '<div class="panel"><div class="section-title">DIFFICULTY BEATEN</div><div class="diff-chips">' +
    ['Easy', 'Normal', 'Hard', 'Insane', 'Extreme'].map(d => '<div class="diff-chip ' + (counts[d] ? 'on' : '') + '"><span class="diff-badge ' + difficultyBadgeClass(d) + '">' + d + '</span><b>' + Number(counts[d] || 0) + '</b></div>').join('') +
    '</div><div class="note center">Beat rated levels to earn stars and climb the difficulty ladder.</div></div>';
}

function statsGridHtml(st, u) {
  st = st || {}; u = u || {};
  const n = v => Number(v || 0).toLocaleString();
  const hardest = u.hardestDifficulty ? '<span class="diff-badge ' + difficultyBadgeClass(u.hardestDifficulty) + '">' + u.hardestDifficulty + '</span>' : '—';
  return `<div class="stats-grid">
    <div class="stat-card gold"><span>STARS</span><b>★ ${n(u.stars)}</b></div>
    <div class="stat-card"><span>CREATOR POINTS</span><b>${n(u.creatorPoints)}</b></div>
    <div class="stat-card"><span>HARDEST BEATEN</span><b>${hardest}</b></div>
    <div class="stat-card"><span>GAMES PLAYED</span><b>${n(st.gamesPlayed)}</b></div>
    <div class="stat-card"><span>COMPLETED</span><b>${n(st.gamesCompleted)}</b></div>
    <div class="stat-card"><span>BEST SCORE</span><b>${n(st.bestScore)}</b></div>
    <div class="stat-card"><span>TOTAL SCORE</span><b>${n(st.totalScore)}</b></div>
    <div class="stat-card"><span>NOTES HIT</span><b>${n(st.totalNotesHit)}</b></div>
    <div class="stat-card"><span>BATTLE WIN RATE</span><b>${formatBattleWinRate(st)}</b></div></div>` + difficultyBeatenHtml(u) +
    '<div class="note center">Games, score and notes only count levels played from Browse (not your own levels).</div>';
}

async function openStatsModal() {
  const modal = document.getElementById('stats-modal');
  const user = getAuthUser();
  if (!user) {
    modal.innerHTML = screenHtml('PLAYER STATS', null, '<div class="panel note">Log in to track your online statistics.</div><button class="btn btn-play" onclick="openProfileModal()">LOG IN / CREATE ACCOUNT</button>');
    toggleMenu('stats-modal');
    return;
  }
  const draw = u => screenHtml('PLAYER STATS', null, `<div class="panel profile-hero"><div class="avatar big">${u.profileIcon ? '<img src="' + escapeHtml(u.profileIcon) + '" alt="">' : escapeHtml(u.username.slice(0, 1).toUpperCase())}</div><div><div class="hero-name">${escapeHtml(u.username)}</div><div class="hero-sub">Online account</div></div></div>` + statsGridHtml(u.statistics || {}, u));
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
// For admins it also shows how many new alerts (e.g. 5-star ratings) are waiting.
async function updateAdminButton(user) {
  const button = document.getElementById('admin-btn');
  if (!button) return;
  const isAdmin = !!(user && user.isAdmin);
  button.classList.toggle('hidden', !isAdmin);
  if (!isAdmin || !getAuthToken() || !API_BASE_URL) { button.textContent = '🛡 ADMIN PANEL'; button.classList.remove('alert'); return; }
  try {
    const o = await apiRequest('/api/admin/overview', { auth: true });
    button.textContent = '🛡 ADMIN PANEL' + (o.unreadNotifications ? ' (' + o.unreadNotifications + ' new)' : '');
    button.classList.toggle('alert', !!o.unreadNotifications);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Warnings + bans (sent by an admin)
// ---------------------------------------------------------------------------
let warningShown = false, warningAckPending = false, banShown = false;

function showWarning(text) {
  const el = document.getElementById('warning-screen');
  if (!el || !text) return;
  if (gameActive && !isBattleMode && !isDead && typeof pauseGame === 'function') { try { pauseGame(); } catch (e) {} }
  warningShown = true;
  el.innerHTML = '<div class="warning-card"><div class="warning-icon">⚠</div><h2>WARNING</h2><p id="warning-text"></p><button class="btn btn-play" id="warning-ok">I UNDERSTAND</button></div>';
  el.querySelector('#warning-text').textContent = text;
  el.classList.remove('hidden');
  el.querySelector('#warning-ok').onclick = async () => {
    el.classList.add('hidden');
    warningAckPending = true;
    try {
      await apiRequest('/api/auth/warning/ack', { method: 'POST', auth: true, body: {} });
      const u = getAuthUser();
      if (u) { u.warning = null; localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u)); }
    } catch (e) {}
    warningAckPending = false; warningShown = false;
  };
}

function handleBanned(data) {
  if (banShown) return;
  banShown = true;
  clearAuthSession();
  if (typeof disconnectBattle === 'function') disconnectBattle();
  if (gameActive || inEditor) { try { quitPlaytestOrGame(); } catch (e) {} }
  const el = document.getElementById('warning-screen');
  if (!el) { banShown = false; return; }
  el.innerHTML = '<div class="warning-card ban"><div class="warning-icon">🚫</div><h2>YOU\'RE BANNED</h2><p id="warning-text"></p><button class="btn btn-ghost" id="warning-ok">OK</button></div>';
  el.querySelector('#warning-text').textContent = (data && data.message ? data.message : 'Your account has been banned.') + (data && data.reason ? '\n\nReason: ' + data.reason : '');
  el.classList.remove('hidden');
  el.querySelector('#warning-ok').onclick = () => { el.classList.add('hidden'); banShown = false; toggleMenu('main-menu'); };
}

// Pick up new warnings / bans / star changes while the game is open.
setInterval(() => {
  if (document.hidden || !getAuthToken() || !API_BASE_URL) return;
  apiRequest('/api/auth/me', { auth: true })
    .then(d => { if (d && d.user) saveAuthSession(getAuthToken(), d.user); })
    .catch(e => { if (e && e.status === 401) clearAuthSession(); });
}, 30000);
