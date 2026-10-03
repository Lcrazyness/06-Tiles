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

function renderBrowseSection() {
  const menu = document.getElementById('browse-levels-menu');
  if (!menu) return;
  const content = menu.querySelector('.menu-content');
  if (!content) return;
  content.innerHTML = `
    <div class="browse-search-row">
      <span class="search-icon">🔎</span>
      <input type="text" id="browse-search-input" placeholder="Search levels or players..." oninput="renderBrowseSection()">
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
  if (tab === 'featured') levels = levels.filter(l => Number(l.ratingAverage || 0) >= 4 || Number(l.plays || 0) >= 5);
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
  container.innerHTML = '<div class="browse-empty">Loading players…</div>';
  const search = document.getElementById('browse-search-input')?.value || '';
  try {
    const response = await fetch(API_BASE_URL + '/api/players?search=' + encodeURIComponent(search));
    const players = response.ok ? await response.json() : [];
    container.innerHTML = '';
    if (!Array.isArray(players) || !players.length) {
      container.innerHTML = '<div class="browse-empty">No players found.</div>';
      return;
    }
    players.forEach(player => {
      const card = document.createElement('div');
      card.className = 'level-card player-browser-card';
      const st = player.statistics || {};
      card.innerHTML = `
        <div class="level-card-thumb">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(player.username.slice(0,1).toUpperCase())}</div>
        <div class="level-card-body">
          <div class="level-card-title-row"><span class="level-card-title">${escapeHtml(player.username)}</span></div>
          <div class="level-card-author">Online player</div>
          <div class="level-card-stats"><span>Games ${st.gamesPlayed || 0}</span><span>Best ${st.bestScore || 0}</span></div>
        </div>`;
      container.appendChild(card);
    });
  } catch (error) {
    container.innerHTML = '<div class="browse-empty">Could not connect to the online player list.</div>';
  }
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
  card.className = 'level-card';
  card.style.borderLeftColor = `var(--diff-${diff.toLowerCase()})`;
  card.innerHTML = `
    <div class="level-card-thumb">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : (fromCommunity ? '🌐' : '📁')}</div>
    <div class="level-card-body">
      <div class="level-card-title-row">
        <span class="level-card-title">${escapeHtml(level.name)}</span>
        <span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span>
      </div>
      <div class="level-card-author">by ${escapeHtml(level.author || 'You')}</div>
      <div class="level-card-stats">
        <span class="star">★ ${avg ? avg.toFixed(1) : '—'}</span>
        <span>▶ ${level.plays || 0}</span>
      </div>
    </div>`;
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