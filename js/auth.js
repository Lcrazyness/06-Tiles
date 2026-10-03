const AUTH_TOKEN_KEY = 'et_authToken';
const AUTH_USER_KEY = 'et_authUser';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  currentProfile = user.username;
  localStorage.setItem(CURRENT_PROFILE_KEY, currentProfile);
  refreshProfileButton();
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  currentProfile = 'Guest';
  localStorage.setItem(CURRENT_PROFILE_KEY, 'Guest');
  refreshProfileButton();
}

function setAccountStatus(message) {
  const el = document.getElementById('account-status');
  if (el) el.textContent = message || '';
}

function renderAccountModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const user = getAuthUser();

  modal.innerHTML = user ? `
    <h2>ACCOUNT</h2>
    <div class="menu-content">
      <div class="profile-modal-list">
        <div class="profile-row current">
          <div class="profile-avatar">${user.username.slice(0, 1).toUpperCase()}</div>
          <div style="flex:1;">
            <div class="profile-row-name">${escapeHtml(user.username)}</div>
            <div class="profile-row-tag">Online account</div>
          </div>
        </div>
      </div>
      <div class="profile-note">Games played: ${(user.statistics || {}).gamesPlayed || 0} · Completed: ${(user.statistics || {}).gamesCompleted || 0} · Best score: ${(user.statistics || {}).bestScore || 0}</div>
      <button class="nav-btn secondary-btn" onclick="logoutAccount()">LOG OUT</button>
      <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')" style="margin-top:6px;">BACK TO MENU</button>
    </div>` : `
    <h2>ACCOUNT</h2>
    <div class="menu-content">
      <div class="profile-note">Create an account to save your 06-Tiles profile online. Your password is securely hashed on the server.</div>
      <div class="profile-create-row" style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="account-username" placeholder="Username" maxlength="20" autocomplete="username">
        <input type="email" id="account-email" placeholder="Email" maxlength="254" autocomplete="email">
        <input type="password" id="account-password" placeholder="Password (8+ characters)" maxlength="128" autocomplete="current-password">
        <button class="play-btn" onclick="loginAccount()">LOG IN</button>
        <button class="nav-btn" onclick="registerAccount()">CREATE ACCOUNT</button>
        <div id="account-status" class="profile-note" style="min-height:18px;"></div>
      </div>
      <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')" style="margin-top:6px;">BACK TO MENU</button>
    </div>`;
}

function openProfileModal() {
  renderAccountModal();
  toggleMenu('profile-modal');
}

async function registerAccount() {
  if (!API_BASE_URL) {
    setAccountStatus('Backend URL is not configured yet.');
    return;
  }

  const username = (document.getElementById('account-username')?.value || '').trim();
  const email = (document.getElementById('account-email')?.value || '').trim();
  const password = document.getElementById('account-password')?.value || '';

  if (!username || !email || !password) {
    setAccountStatus('Enter a username, email, and password.');
    return;
  }

  setAccountStatus('Creating account...');

  try {
    const response = await fetch(API_BASE_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      setAccountStatus(data.message || 'Could not create account.');
      return;
    }

    saveAuthSession(data.token, data.user);
    renderAccountModal();
  } catch (error) {
    console.error(error);
    setAccountStatus('Could not connect to the 06-Tiles server.');
  }
}

async function loginAccount() {
  if (!API_BASE_URL) {
    setAccountStatus('Backend URL is not configured yet.');
    return;
  }

  const usernameOrEmail = (document.getElementById('account-username')?.value || '').trim();
  const password = document.getElementById('account-password')?.value || '';

  if (!usernameOrEmail || !password) {
    setAccountStatus('Enter your username/email and password.');
    return;
  }

  setAccountStatus('Logging in...');

  try {
    const response = await fetch(API_BASE_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail, password })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      setAccountStatus(data.message || 'Could not log in.');
      return;
    }

    saveAuthSession(data.token, data.user);
    renderAccountModal();
  } catch (error) {
    console.error(error);
    setAccountStatus('Could not connect to the 06-Tiles server.');
  }
}

function logoutAccount() {
  clearAuthSession();
  renderAccountModal();
}

async function restoreAuthSession() {
  const token = getAuthToken();
  if (!token || !API_BASE_URL) {
    refreshProfileButton();
    return;
  }

  try {
    const response = await fetch(API_BASE_URL + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      clearAuthSession();
      return;
    }
    const data = await response.json();
    if (data.success && data.user) saveAuthSession(token, data.user);
    else clearAuthSession();
  } catch (error) {
    console.warn('Could not restore online account session.', error);
    refreshProfileButton();
  }
}

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(url, { ...options, headers });
}
async function beginStatsGame() {
  if (!getAuthToken() || !API_BASE_URL || isPlaytesting || isVerifying || isBattleMode) return;
  statsGameFinalized = false;
  try {
    await authFetch(API_BASE_URL + '/api/stats/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ started: true, completed: false, score: 0, notesHit: 0 })
    });
  } catch (error) {
    console.warn('Could not record game start.', error);
  }
}

async function finishStatsGame(completed) {
  if (statsGameFinalized || !getAuthToken() || !API_BASE_URL || isPlaytesting || isVerifying || isBattleMode) return;
  statsGameFinalized = true;
  try {
    const response = await authFetch(API_BASE_URL + '/api/stats/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completed: !!completed,
        score: Math.floor(score),
        notesHit: notesHitThisGame
      })
    });
    const data = await response.json();
    if (response.ok && data.success && data.user) {
      saveAuthSession(getAuthToken(), data.user);
    }
  } catch (error) {
    console.warn('Could not save game statistics.', error);
  }
}

async function refreshOnlineStats() {
  if (!getAuthToken() || !API_BASE_URL) return null;
  try {
    const response = await authFetch(API_BASE_URL + '/api/auth/me');
    const data = await response.json();
    if (response.ok && data.success && data.user) {
      saveAuthSession(getAuthToken(), data.user);
      return data.user;
    }
  } catch (error) {
    console.warn('Could not refresh online statistics.', error);
  }
  return null;
}

function formatBattleWinRate(statistics) {
  const wins = Number(statistics.battleWins || 0);
  const losses = Number(statistics.battleLosses || 0);
  const total = wins + losses;
  return total ? Math.round((wins / total) * 100) + '%' : '—';
}

async function openStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  const user = getAuthUser();
  if (!user) {
    modal.innerHTML = `
      <h2>PLAYER STATS</h2>
      <div class="menu-content">
        <div class="stats-login-card">Log in to view your online player statistics.</div>
        <button class="nav-btn" onclick="openProfileModal()">ACCOUNT</button>
        <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')">BACK TO MENU</button>
      </div>`;
    toggleMenu('stats-modal');
    return;
  }

  modal.innerHTML = `
    <h2>PLAYER STATS</h2>
    <div class="menu-content">
      <div class="stats-profile">
        <div class="stats-avatar">${escapeHtml(user.username.slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="stats-username">${escapeHtml(user.username)}</div>
          <div class="stats-online">ONLINE ACCOUNT</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><span>GAMES PLAYED</span><b id="stat-games-played">${(user.statistics || {}).gamesPlayed || 0}</b></div>
        <div class="stat-card"><span>COMPLETED</span><b id="stat-games-completed">${(user.statistics || {}).gamesCompleted || 0}</b></div>
        <div class="stat-card"><span>BEST SCORE</span><b id="stat-best-score">${(user.statistics || {}).bestScore || 0}</b></div>
        <div class="stat-card"><span>TOTAL SCORE</span><b id="stat-total-score">${(user.statistics || {}).totalScore || 0}</b></div>
        <div class="stat-card"><span>NOTES HIT</span><b id="stat-notes-hit">${(user.statistics || {}).totalNotesHit || 0}</b></div>
        <div class="stat-card"><span>WIN RATE</span><b id="stat-win-rate">${formatBattleWinRate(user.statistics || {})}</b></div>
      </div>
      <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')">BACK TO MENU</button>
    </div>`;
  toggleMenu('stats-modal');

  const freshUser = await refreshOnlineStats();
  if (freshUser) {
    const st = freshUser.statistics || {};
    const values = {
      'stat-games-played': st.gamesPlayed || 0,
      'stat-games-completed': st.gamesCompleted || 0,
      'stat-best-score': st.bestScore || 0,
      'stat-total-score': st.totalScore || 0,
      'stat-notes-hit': st.totalNotesHit || 0,
      'stat-win-rate': formatBattleWinRate(st)
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }
}
