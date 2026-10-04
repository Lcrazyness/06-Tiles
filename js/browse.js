// ============================================================================
// browse.js — My Levels, Browse (levels / leaderboards / players), level
// detail sheet, and the admin panel. Cards use the Magic-Tiles song-row look.
// ============================================================================
let currentBrowseTab = 'levels';
let currentLevelSort = 'recent';
let currentMyTab = 'device';
let levelDetailReturnTo = 'my-levels-menu';
let browseRequestId = 0;

function errorBox(msg, retry) {
  return '<div class="empty">' + escapeHtml(msg) + (retry ? '<br><button class="btn btn-ghost small" onclick="' + retry + '">Try again</button>' : '') + '</div>';
}

// ---------------- My Levels ----------------
function openMyLevels() { toggleMenu('my-levels-menu'); renderMyLevels(); }

async function renderMyLevels() {
  const menu = document.getElementById('my-levels-menu');
  menu.innerHTML = screenHtml('MY LEVELS', null, `
    <div class="tabs"><button class="tab ${currentMyTab === 'device' ? 'active' : ''}" onclick="currentMyTab='device';renderMyLevels()">On this device</button>
    <button class="tab ${currentMyTab === 'online' ? 'active' : ''}" onclick="currentMyTab='online';renderMyLevels()">Published</button></div>
    <div id="my-levels-list" class="song-list"></div>`, '<button class="btn small" onclick="startEditor()">＋ New</button>');
  const list = document.getElementById('my-levels-list');
  if (currentMyTab === 'device') {
    const levels = getCustomLevels();
    if (!levels.length) { list.innerHTML = '<div class="empty">No levels yet.<br>Tap <b>＋ New</b> to make one.</div>'; return; }
    levels.slice().reverse().forEach(l => list.appendChild(renderLevelCard(l, 'local')));
    return;
  }
  if (!getAuthToken()) { list.innerHTML = '<div class="empty">Log in to see levels you published.<br><button class="btn btn-ghost small" onclick="openProfileModal()">Log in</button></div>'; return; }
  list.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const levels = await getMyPublishedLevels();
    list.innerHTML = '';
    if (!levels.length) { list.innerHTML = '<div class="empty">You haven\'t published anything yet.</div>'; return; }
    levels.forEach(l => list.appendChild(renderLevelCard(l, 'mine-online')));
  } catch (e) { list.innerHTML = errorBox(e.message, 'renderMyLevels()'); }
}

// ---------------- Browse ----------------
function openBrowseLevels(tab = 'levels') {
  currentBrowseTab = ['levels', 'leaderboards', 'players'].includes(tab) ? tab : 'levels';
  toggleMenu('browse-levels-menu');
  renderBrowseSection();
}

function renderBrowseContent() {
  if (currentBrowseTab === 'levels') renderBrowseLevels();
  else if (currentBrowseTab === 'players') renderPlayers();
}

function renderBrowseSection() {
  const menu = document.getElementById('browse-levels-menu');
  const tabBtn = (id, label) => `<button class="tab ${currentBrowseTab === id ? 'active' : ''}" onclick="openBrowseLevels('${id}')">${label}</button>`;
  menu.innerHTML = screenHtml('BROWSE', null, `
    <div class="tabs">${tabBtn('levels', 'Levels')}${tabBtn('leaderboards', 'Leaderboards')}${tabBtn('players', 'Players')}</div>
    ${currentBrowseTab === 'leaderboards' ? '' : `<div class="searchbar"><span>🔎</span><input type="text" id="browse-search-input" placeholder="${currentBrowseTab === 'players' ? 'Search players…' : 'Search levels or authors…'}" onkeydown="if(event.key==='Enter')renderBrowseContent()"><button class="btn small" onclick="renderBrowseContent()">Search</button></div>`}
    <div id="browse-sub-tabs"></div>
    <div id="browse-content" class="song-list"></div>`);
  if (currentBrowseTab === 'levels') renderBrowseLevels();
  if (currentBrowseTab === 'leaderboards') renderLeaderboards();
  if (currentBrowseTab === 'players') renderPlayers();
}

async function renderBrowseLevels() {
  const container = document.getElementById('browse-content');
  const sub = document.getElementById('browse-sub-tabs');
  if (!container) return;
  const sorts = [['recent', 'Recent'], ['trending', 'Trending'], ['rated', 'Top Rated'], ['featured', 'Featured']];
  sub.innerHTML = '<div class="tabs small">' + sorts.map(([id, l]) => `<button class="tab ${currentLevelSort === id ? 'active' : ''}" onclick="currentLevelSort='${id}';renderBrowseLevels()">${l}</button>`).join('') + '</div>';
  container.innerHTML = '<div class="empty">Loading levels…</div>';
  const reqId = ++browseRequestId;
  const search = document.getElementById('browse-search-input')?.value || '';
  try {
    const levels = await getCommunityLevels(search, currentLevelSort);
    if (reqId !== browseRequestId) return;
    container.innerHTML = '';
    if (!levels.length) { container.innerHTML = '<div class="empty">No levels found.</div>'; return; }
    levels.forEach(level => container.appendChild(renderLevelCard(level, 'community')));
  } catch (e) { if (reqId === browseRequestId) container.innerHTML = errorBox(e.message, 'renderBrowseLevels()'); }
}

function playerRow(player, rankText, subText, valueText) {
  const username = String(player.username || 'Unknown');
  const row = document.createElement('div');
  row.className = 'song-row player-row';
  row.innerHTML = `<div class="song-art" style="${player.profileIcon ? '' : 'background:' + artGradient(username)}">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(username.slice(0, 1).toUpperCase())}</div>
    <div class="song-info"><div class="song-title">${rankText}${escapeHtml(username)}</div><div class="song-sub">${subText}</div></div><div class="player-value">${valueText}</div>`;
  row.onclick = () => openPlayerProfile(player);
  return row;
}

async function renderPlayers() {
  const container = document.getElementById('browse-content');
  document.getElementById('browse-sub-tabs').innerHTML = '';
  container.innerHTML = '<div class="empty">Searching players…</div>';
  const search = (document.getElementById('browse-search-input')?.value || '').trim();
  try {
    const players = await apiRequest('/api/players?search=' + encodeURIComponent(search));
    container.innerHTML = '';
    if (!players.length) { container.innerHTML = '<div class="empty">No players found.</div>'; return; }
    players.forEach(p => container.appendChild(playerRow(p, '', 'Games ' + Number(p.statistics.gamesPlayed || 0).toLocaleString(), '★ ' + Number(p.statistics.bestScore || 0).toLocaleString())));
  } catch (e) { container.innerHTML = errorBox(e.message, 'renderPlayers()'); }
}

function openPlayerProfile(player) {
  const username = String(player.username || 'Unknown');
  document.getElementById('stats-modal').innerHTML = screenHtml('PLAYER', "toggleMenu('browse-levels-menu')", `<div class="panel profile-hero"><div class="avatar big">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(username.slice(0, 1).toUpperCase())}</div><div><div class="hero-name">${escapeHtml(username)}</div><div class="hero-sub">Online player</div></div></div>` + statsGridHtml(player.statistics || {}));
  toggleMenu('stats-modal');
}

async function renderLeaderboards() {
  document.getElementById('browse-sub-tabs').innerHTML = '<div class="tabs small">' +
    [['bestScore', 'Best Score'], ['totalScore', 'Total'], ['notesHit', 'Notes'], ['battleWins', 'Battle Wins']].map(([id, l]) => `<button class="tab" data-sort="${id}" onclick="loadLeaderboard('${id}')">${l}</button>`).join('') + '</div>';
  await loadLeaderboard('bestScore');
}

async function loadLeaderboard(sort) {
  const container = document.getElementById('browse-content');
  document.querySelectorAll('#browse-sub-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  container.innerHTML = '<div class="empty">Loading leaderboard…</div>';
  try {
    const players = await apiRequest('/api/leaderboards?sort=' + encodeURIComponent(sort));
    container.innerHTML = '';
    if (!players.length) { container.innerHTML = '<div class="empty">No players have stats yet.</div>'; return; }
    players.forEach((p, i) => {
      const st = p.statistics || {};
      const value = sort === 'totalScore' ? st.totalScore : sort === 'notesHit' ? st.totalNotesHit : sort === 'battleWins' ? st.battleWins : st.bestScore;
      container.appendChild(playerRow(p, '<span class="rank">#' + (i + 1) + '</span> ', 'Games ' + Number(st.gamesPlayed || 0).toLocaleString(), '★ ' + Number(value || 0).toLocaleString()));
    });
  } catch (e) { container.innerHTML = errorBox(e.message, "loadLeaderboard('" + sort + "')"); }
}

// ---------------- Level cards (Magic Tiles song rows) ----------------
function renderLevelCard(level, source) {
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `
    <div class="song-art" style="${level.icon ? '' : 'background:' + artGradient(level.name)}">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : '♪'}<span class="speaker">🔊</span></div>
    <div class="song-info">
      <div class="song-title">${escapeHtml(level.name)}</div>
      <div class="song-sub">${escapeHtml(level.author || 'You')}</div>
      <div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span><span>★ ${avg ? avg.toFixed(1) : '—'}</span><span>▶ ${level.plays || 0}</span>${level.featured ? '<span class="feat">FEATURED</span>' : ''}</div>
    </div>
    <button class="play-btn">PLAY</button>`;
  row.onclick = () => openLevelDetail(level, source);
  row.querySelector('.play-btn').onclick = (e) => { e.stopPropagation(); playLevelEntry(level, source); };
  return row;
}

async function playLevelEntry(level, source) {
  levelDetailReturnTo = source === 'local' ? 'my-levels-menu' : 'browse-levels-menu';
  if (source === 'local') {
    registerPlay(level.id, false);
    currentEditingId = null;
    startGame(level.name, true, -1, level.data, level.effects || [], false, level);
    return;
  }
  try {
    toast('Loading level…');
    const full = level.data ? level : await getCommunityLevel(level.id);
    registerPlay(level.id, true);
    startGame(full.name, true, -1, full.data, full.effects || [], true, full);
  } catch (e) { toast(e.message, 'bad'); }
}

function openLevelDetail(level, source) {
  const online = source !== 'local';
  levelDetailReturnTo = source === 'community' ? 'browse-levels-menu' : 'my-levels-menu';
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  const tiles = level.tileCount || (level.data || []).length;
  const body = `
    <div class="panel detail-head"><div class="song-art" style="${level.icon ? '' : 'background:' + artGradient(level.name)}">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : '♪'}</div>
      <div><div class="hero-name">${escapeHtml(level.name)}</div><div class="hero-sub">by ${escapeHtml(level.author || 'You')}</div><div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span></div></div></div>
    <div class="stats-grid three"><div class="stat-card"><span>TILES</span><b>${tiles}</b></div><div class="stat-card"><span>RATING</span><b>${avg ? avg.toFixed(1) : '—'}</b></div><div class="stat-card"><span>PLAYS</span><b>${level.plays || 0}</b></div></div>
    ${source === 'community' ? '<div class="rate-row" id="rate-row">' + [1, 2, 3, 4, 5].map(i => '<span class="rate-star" data-v="' + i + '">★</span>').join('') + '</div><div class="note center">Tap a star to rate</div>' : ''}
    <button class="btn btn-play" id="detail-play">▶ PLAY</button>
    ${source === 'local' ? '<button class="btn btn-ghost" id="detail-edit">✎ Edit</button><button class="btn btn-danger" id="detail-del">Delete from device</button>' : ''}
    ${source === 'mine-online' ? '<button class="btn btn-danger" id="detail-unpub">Remove from Browse</button>' : ''}`;
  document.getElementById('level-detail-menu').innerHTML = screenHtml('LEVEL', 'closeLevelDetail()', body);
  toggleMenu('level-detail-menu');
  document.getElementById('detail-play').onclick = () => playLevelEntry(level, source);
  const q = id => document.getElementById(id);
  if (q('detail-edit')) q('detail-edit').onclick = () => { currentEditingId = level.id; startEditor(level); };
  if (q('detail-del')) q('detail-del').onclick = async () => { if (await deleteCustomLevel(level.id)) closeLevelDetail(); };
  if (q('detail-unpub')) q('detail-unpub').onclick = async () => {
    if (!(await uiConfirm('Remove "' + level.name + '" from Browse for everyone?', 'Remove', true))) return;
    try { await apiRequest('/api/levels/' + encodeURIComponent(level.id), { method: 'DELETE', auth: true }); toast('Removed.', 'good'); closeLevelDetail(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('#rate-row .rate-star').forEach(star => {
    star.onmouseenter = () => document.querySelectorAll('#rate-row .rate-star').forEach(s => s.classList.toggle('filled', Number(s.dataset.v) <= Number(star.dataset.v)));
    star.onclick = async () => {
      try { const r = await rateLevel(level.id, Number(star.dataset.v)); toast('Thanks! Average is now ★ ' + Number(r.ratingAverage).toFixed(1), 'good'); level.ratingAverage = r.ratingAverage; openLevelDetail(level, source); }
      catch (e) { toast(e.message, 'bad'); }
    };
  });
}

function closeLevelDetail() {
  if (levelDetailReturnTo === 'my-levels-menu') { toggleMenu('my-levels-menu'); renderMyLevels(); }
  else { toggleMenu('browse-levels-menu'); renderBrowseSection(); }
}

// ---------------- Admin panel ----------------
let adminSearch = '';
async function loadAdminPanel() {
  const modal = document.getElementById('admin-panel');
  const draw = (inner) => { modal.innerHTML = screenHtml('ADMIN', null, inner, '<button class="btn small" onclick="loadAdminPanel()">↻</button>'); };
  toggleMenu('admin-panel');
  if (!getAuthToken()) { draw('<div class="empty">Log in as an admin first.</div>'); return; }
  draw('<div class="empty">Loading…</div>');
  try {
    const [overview, data] = await Promise.all([
      apiRequest('/api/admin/overview', { auth: true }),
      apiRequest('/api/admin/levels?search=' + encodeURIComponent(adminSearch), { auth: true })
    ]);
    const levels = data.levels || [];
    draw(`<div class="stats-grid three"><div class="stat-card"><span>PLAYERS</span><b>${overview.users}</b></div><div class="stat-card"><span>LEVELS</span><b>${overview.levels}</b></div><div class="stat-card"><span>ONLINE NOW</span><b>${overview.onlineNow}</b></div></div>
      <div class="searchbar"><span>🔎</span><input id="admin-search" placeholder="Search levels or authors…" value="${escapeHtml(adminSearch)}" onkeydown="if(event.key==='Enter'){adminSearch=this.value;loadAdminPanel()}"></div>
      <div class="song-list">${levels.length ? levels.map(l => `
        <div class="song-row admin-row"><div class="song-art" style="${l.icon ? '' : 'background:' + artGradient(l.name)}">${l.icon ? '<img src="' + escapeHtml(l.icon) + '" alt="">' : '♪'}</div>
          <div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.author)} · ★ ${Number(l.ratingAverage || 0).toFixed(1)} · ▶ ${l.plays}</div></div>
          <div class="admin-actions"><button class="btn small ${l.featured ? 'btn-ghost' : ''}" onclick="toggleFeaturedLevel('${l.id}', ${!l.featured})">${l.featured ? 'Unfeature' : 'Feature'}</button><button class="btn small btn-danger" onclick="deleteAdminLevel('${l.id}', this)">Delete</button></div></div>`).join('') : '<div class="empty">No levels.</div>'}</div>`);
  } catch (e) { draw(errorBox(e.message, 'loadAdminPanel()')); }
}

async function deleteAdminLevel(levelId) {
  if (!(await uiConfirm('Delete this level for everyone?', 'Delete', true))) return;
  try { await apiRequest('/api/admin/levels/' + encodeURIComponent(levelId), { method: 'DELETE', auth: true }); toast('Deleted.', 'good'); loadAdminPanel(); }
  catch (e) { toast(e.message, 'bad'); }
}
async function toggleFeaturedLevel(levelId, featured) {
  try { await apiRequest('/api/admin/levels/' + encodeURIComponent(levelId) + '/feature', { method: 'PATCH', auth: true, body: { featured } }); loadAdminPanel(); }
  catch (e) { toast(e.message, 'bad'); }
}
