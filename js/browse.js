let currentBrowseTab = 'levels';
let levelDetailReturnTo = 'my-levels-menu';

function openMyLevels() {
  toggleMenu('my-levels-menu');
  renderMyLevels();
}

function renderMyLevels() {
  const container = document.getElementById('custom-levels-container');
  const levels = getCustomLevels();
  container.innerHTML = '';
  if (levels.length === 0) {
    container.innerHTML = '<div class="browse-empty">No levels yet — tap CREATE LEVEL to make one.</div>';
    return;
  }
  levels.slice().reverse().forEach(level => container.appendChild(renderLevelCard(level, false)));
}

function openBrowseLevels(tab = 'levels') {
  currentBrowseTab = tab;
  toggleMenu('browse-levels-menu');
  renderBrowseSection();
}

function renderBrowseContent() {
  if (currentBrowseTab === 'levels') renderBrowseLevels();
  else if (currentBrowseTab === 'players') renderPlayers();
  else renderLeaderboards();
}

function renderBrowseSection() {
  const menu = document.getElementById('browse-levels-menu');
  if (!menu) return;
  const content = menu.querySelector('.menu-content');
  if (!content) return;
  content.innerHTML = `
    <div class="browse-search-row">
      <span class="search-icon">🔎</span>
      <input type="text" id="browse-search-input" placeholder="${currentBrowseTab === 'players' ? 'Search players...' : currentBrowseTab === 'leaderboards' ? 'Search players...' : 'Search levels...'}" oninput="renderBrowseContent()">
    </div>
    <div class="pill-tabs browse-main-tabs">
      <button class="pill-tab ${currentBrowseTab === 'levels' ? 'active' : ''}" onclick="openBrowseLevels('levels')">Levels</button>
      <button class="pill-tab ${currentBrowseTab === 'leaderboards' ? 'active' : ''}" onclick="openBrowseLevels('leaderboards')">Leaderboards</button>
      <button class="pill-tab ${currentBrowseTab === 'players' ? 'active' : ''}" onclick="openBrowseLevels('players')">Players</button>
    </div>
    <div id="browse-sub-tabs"></div>
    <div id="browse-content" class="grid-levels" style="max-height:58vh; overflow-y:auto; padding-right:4px;"></div>
    <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')" style="margin-top:15px;">BACK TO MENU</button>`;
  if (currentBrowseTab === 'levels') renderBrowseLevels();
  if (currentBrowseTab === 'leaderboards') renderLeaderboards();
  if (currentBrowseTab === 'players') renderPlayers();
}

async function renderBrowseLevels() {
  const container = document.getElementById('browse-content');
  const sub = document.getElementById('browse-sub-tabs');
  if (!container) return;
  if (sub) sub.innerHTML = `
    <div class="pill-tabs">
      <button class="pill-tab active">Recent</button>
      <button class="pill-tab" onclick="loadBrowseLevelTab('trending')">Trending</button>
      <button class="pill-tab" onclick="loadBrowseLevelTab('rated')">Top Rated</button>
      <button class="pill-tab" onclick="loadBrowseLevelTab('featured')">Featured</button>
    </div>`;
  container.innerHTML = '<div class="browse-empty">Loading levels…</div>';
  const search = document.getElementById('browse-search-input')?.value || '';
  let levels = await getCommunityLevels(search, 'recent');
  if (!Array.isArray(levels)) levels = [];
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    levels = levels.filter(l => String(l.name || '').toLowerCase().includes(q) || String(l.author || '').toLowerCase().includes(q));
  }
  container.innerHTML = '';
  if (!levels.length) {
    container.innerHTML = '<div class="browse-empty">No published levels found.</div>';
    return;
  }
  levels.forEach(level => container.appendChild(renderLevelCard(level, true)));
}

async function loadBrowseLevelTab(tab) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  container.innerHTML = '<div class="browse-empty">Loading levels…</div>';
  const search = document.getElementById('browse-search-input')?.value || '';
  let levels = await getCommunityLevels(search, tab);
  if (!Array.isArray(levels)) levels = [];
  if (tab === 'featured') levels = levels.filter(l => !!l.featured);
  container.innerHTML = '';
  if (!levels.length) {
    container.innerHTML = '<div class="browse-empty">No levels found.</div>';
    return;
  }
  levels.forEach(level => container.appendChild(renderLevelCard(level, true)));
}

async function renderPlayers() {
  const container = document.getElementById('browse-content');
  if (!container) return;
  container.innerHTML = '<div class="browse-empty">Searching players…</div>';
  const search = (document.getElementById('browse-search-input')?.value || '').trim();
  try {
    const response = await fetch(API_BASE_URL + '/api/players?search=' + encodeURIComponent(search), {
      cache: 'no-store'
    });
    let data = [];
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      container.innerHTML = '<div class="browse-empty">' + escapeHtml(data?.message || 'Could not load players.') + '</div>';
      return;
    }
    const players = Array.isArray(data) ? data : [];
    container.innerHTML = '';
    if (!players.length) {
      container.innerHTML = '<div class="browse-empty">' + (search ? 'No players matched “' + escapeHtml(search) + '”.' : 'No players found.') + '</div>';
      return;
    }
    players.forEach(player => {
      const card = document.createElement('div');
      card.className = 'level-card player-browser-card';
      const st = player.statistics || {};
      const username = String(player.username || 'Unknown');
      card.innerHTML = `
        <div class="level-card-thumb">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(username.slice(0,1).toUpperCase())}</div>
        <div class="level-card-body">
          <div class="level-card-title-row"><span class="level-card-title">${escapeHtml(username)}</span></div>
          <div class="level-card-author">Online player</div>
          <div class="level-card-stats"><span>Games ${Number(st.gamesPlayed || 0).toLocaleString()}</span><span>Best ${Number(st.bestScore || 0).toLocaleString()}</span></div>
        </div>`;
      card.onclick = () => openPlayerProfile(player);
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Player search error:', error);
    container.innerHTML = '<div class="browse-empty">Could not connect to the online player list.</div>';
  }
}

function openPlayerProfile(player) {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  const st = player.statistics || {};
  const wins = Number(st.battleWins || 0);
  const losses = Number(st.battleLosses || 0);
  const total = wins + losses;
  const winRate = total ? Math.round((wins / total) * 100) + '%' : '—';
  const username = String(player.username || 'Unknown');
  modal.innerHTML = `
    <h2>PLAYER PROFILE</h2>
    <div class="menu-content">
      <div class="stats-profile">
        <div class="stats-avatar">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : escapeHtml(username.slice(0,1).toUpperCase())}</div>
        <div>
          <div class="stats-username">${escapeHtml(username)}</div>
          <div class="stats-online">ONLINE PLAYER</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><span>GAMES PLAYED</span><b>${Number(st.gamesPlayed || 0).toLocaleString()}</b></div>
        <div class="stat-card"><span>COMPLETED</span><b>${Number(st.gamesCompleted || 0).toLocaleString()}</b></div>
        <div class="stat-card"><span>BEST SCORE</span><b>${Number(st.bestScore || 0).toLocaleString()}</b></div>
        <div class="stat-card"><span>TOTAL SCORE</span><b>${Number(st.totalScore || 0).toLocaleString()}</b></div>
        <div class="stat-card"><span>NOTES HIT</span><b>${Number(st.totalNotesHit || 0).toLocaleString()}</b></div>
        <div class="stat-card"><span>WIN RATE</span><b>${winRate}</b></div>
      </div>
      <button class="nav-btn secondary-btn" onclick="toggleMenu('browse-levels-menu')">BACK TO PLAYERS</button>
    </div>`;
  toggleMenu('stats-modal');
}

async function renderLeaderboards() {
  const container = document.getElementById('browse-content');
  const sub = document.getElementById('browse-sub-tabs');
  if (!container) return;
  if (sub) sub.innerHTML = `
    <div class="pill-tabs">
      <button class="pill-tab active" onclick="loadLeaderboard('bestScore')">Best Score</button>
      <button class="pill-tab" onclick="loadLeaderboard('totalScore')">Total Score</button>
      <button class="pill-tab" onclick="loadLeaderboard('notesHit')">Notes Hit</button>
      <button class="pill-tab" onclick="loadLeaderboard('gamesPlayed')">Games Played</button>
    </div>`;
  await loadLeaderboard('bestScore');
}

async function loadLeaderboard(sort) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  container.innerHTML = '<div class="browse-empty">Loading leaderboard…</div>';
  try {
    const response = await fetch(API_BASE_URL + '/api/leaderboards?sort=' + encodeURIComponent(sort));
    const players = response.ok ? await response.json() : [];
    container.innerHTML = '';
    players.forEach((player, index) => {
      const st = player.statistics || {};
      const value = sort === 'totalScore' ? st.totalScore : sort === 'notesHit' ? st.totalNotesHit : sort === 'gamesPlayed' ? st.gamesPlayed : st.bestScore;
      const card = document.createElement('div');
      card.className = 'level-card leaderboard-card';
      card.innerHTML = `
        <div class="leaderboard-rank">#${index + 1}</div>
        <div class="level-card-thumb">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(player.username.slice(0,1).toUpperCase())}</div>
        <div class="level-card-body">
          <div class="level-card-title-row"><span class="level-card-title">${escapeHtml(player.username)}</span></div>
          <div class="level-card-author">${sort === 'bestScore' ? 'Best score' : sort === 'totalScore' ? 'Total score' : sort === 'notesHit' ? 'Notes hit' : 'Games played'}</div>
          <div class="level-card-stats"><span>★ ${Number(value || 0).toLocaleString()}</span></div>
        </div>`;
      container.appendChild(card);
    });
    if (!players.length) container.innerHTML = '<div class="browse-empty">No players have stats yet.</div>';
  } catch (error) {
    container.innerHTML = '<div class="browse-empty">Could not load the leaderboard.</div>';
  }
}

function renderLevelCard(level, fromCommunity) {
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  const card = document.createElement('div');
  card.className = 'level-card song-card';
  card.style.borderLeftColor = `var(--diff-${diff.toLowerCase()})`;
  card.innerHTML = `
    <div class="song-card-icon">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : (fromCommunity ? '🎵' : '📁')}</div>
    <div class="song-card-main">
      <div class="song-card-title">${escapeHtml(level.name)}</div>
      <div class="song-card-artist">${escapeHtml(level.author || 'You')}</div>
      <div class="song-card-meta">
        <span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span>
        <span>★ ${avg ? avg.toFixed(1) : '—'}</span>
        <span>▶ ${level.plays || 0}</span>
      </div>
    </div>
    <button class="song-card-play" aria-label="Play ${escapeHtml(level.name)}">▶</button>`;
  card.onclick = () => openLevelDetail(level, fromCommunity);
  return card;
}

function openLevelDetail(level, fromCommunity) {
  levelDetailReturnTo = fromCommunity ? 'browse-levels-menu' : 'my-levels-menu';
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  document.getElementById('level-detail-title').innerText = level.name;
  const body = document.getElementById('level-detail-body');
  body.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'level-detail-header';
  header.innerHTML = `
    <div class="level-card-thumb">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : (fromCommunity ? '🌐' : '📁')}</div>
    <div>
      <div class="level-card-title-row"><b style="font-size:16px;">${escapeHtml(level.name)}</b> <span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span></div>
      <div class="level-card-author">by ${escapeHtml(level.author || 'You')} · ${(level.data || []).length} tiles</div>
    </div>`;
  body.appendChild(header);

  const statsRow = document.createElement('div');
  statsRow.className = 'level-card-stats';
  statsRow.style.justifyContent = 'center';
  statsRow.innerHTML = `<span class="star">★ ${avg ? avg.toFixed(1) : 'No ratings'}</span><span>▶ ${level.plays || 0} plays</span><span>❤️ ${level.lives || 3} lives</span>`;
  body.appendChild(statsRow);

  if (fromCommunity) {
    const rateWrap = document.createElement('div');
    rateWrap.className = 'level-detail-rate';
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('span');
      star.className = 'rate-star';
      star.textContent = '★';
      star.onclick = async () => {
        await rateLevel(level.id, i, true);
        const updated = (await getCommunityLevels('', 'recent')).find(l => l.id === level.id);
        if (updated) openLevelDetail(updated, true);
      };
      rateWrap.appendChild(star);
    }
    body.appendChild(rateWrap);
  }

  const playBtn = document.createElement('button');
  playBtn.className = 'nav-btn';
  playBtn.style.cssText = 'background:var(--play-blue); color:#fff;';
  playBtn.textContent = '▶ PLAY';
  playBtn.onclick = () => {
    registerPlay(level.id, fromCommunity);
    startGame(level.name, true, -1, level.data, level.effects || [], fromCommunity, level);
  };
  body.appendChild(playBtn);

  if (!fromCommunity) {
    const editBtn = document.createElement('button');
    editBtn.className = 'nav-btn secondary-btn';
    editBtn.textContent = '✎ EDIT';
    editBtn.onclick = () => startEditor(level);
    body.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'nav-btn';
    delBtn.style.cssText = 'background:var(--accent-danger); color:#fff;';
    delBtn.textContent = 'DELETE';
    delBtn.onclick = async () => {
      if (await deleteCustomLevel(level.id)) closeLevelDetail();
    };
    body.appendChild(delBtn);
  }

  toggleMenu('level-detail-menu');
}

function closeLevelDetail() {
  toggleMenu(levelDetailReturnTo);
  if (levelDetailReturnTo === 'my-levels-menu') renderMyLevels();
  else renderBrowseSection();
}

async function loadAdminPanel() {
  const modal = document.getElementById('admin-panel');
  if (!modal) return;
  if (!getAuthToken()) {
    modal.innerHTML = '<h2>ADMIN PANEL</h2><div class="menu-content"><div class="browse-empty">Please log in as wCrazyNess first.</div><button class="nav-btn secondary-btn" onclick="toggleMenu(\'main-menu\')">BACK TO MENU</button></div>';
    toggleMenu('admin-panel');
    return;
  }
  try {
    const response = await authFetch(API_BASE_URL + '/api/admin/levels', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || ('Admin levels request failed (' + response.status + ').'));
    }

    const levels = Array.isArray(data.levels) ? data.levels : [];
    modal.innerHTML = `
      <h2>ADMIN PANEL</h2>
      <div class="menu-content">
        <div class="profile-note">Signed in as wCrazyNess · Admin controls</div>
        <div class="admin-level-list">
          ${levels.length ? levels.map(level => `
            <div class="admin-level-row">
              <div class="level-card-thumb">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : '📁'}</div>
              <div class="admin-level-info">
                <b>${escapeHtml(level.name)}</b>
                <span>by ${escapeHtml(level.author || 'Unknown')} · ★ ${Number(level.ratingAverage || 0).toFixed(1)}</span>
              </div>
              <div class="admin-level-actions">
                <button class="nav-btn ${level.featured ? 'admin-unfeature' : ''}" onclick="toggleFeaturedLevel('${level.id}', ${!level.featured})">${level.featured ? 'UNFEATURE' : 'FEATURE'}</button>
                <button class="nav-btn admin-delete-btn" onclick="deleteAdminLevel('${level.id}')">DELETE</button>
              </div>
            </div>
          `).join('') : '<div class="browse-empty">No published levels.</div>'}
        </div>
        <button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')">BACK TO MENU</button>
      </div>`;
    toggleMenu('admin-panel');
  } catch (error) {
    console.error('Admin panel error:', error);
    modal.innerHTML = `<h2>ADMIN PANEL</h2><div class="menu-content"><div class="browse-empty">Could not load the admin panel.<br><small>${escapeHtml(error.message || 'Unknown server error.')}</small></div><button class="nav-btn secondary-btn" onclick="toggleMenu('main-menu')">BACK TO MENU</button></div>`;
    toggleMenu('admin-panel');
  }
}

async function deleteAdminLevel(levelId) {
  try {
    const response = await authFetch(API_BASE_URL + '/api/admin/levels/' + encodeURIComponent(levelId), { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      alert(data.message || 'Could not delete level.');
      return;
    }
    await loadAdminPanel();
  } catch (error) {
    alert('Could not connect to the 06-Tiles server.');
  }
}

async function toggleFeaturedLevel(levelId, featured) {
  try {
    const response = await authFetch(API_BASE_URL + '/api/admin/levels/' + encodeURIComponent(levelId) + '/feature', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featured })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      alert(data.message || 'Could not update featured status.');
      return;
    }
    loadAdminPanel();
  } catch (error) {
    alert('Could not connect to the 06-Tiles server.');
  }
}
