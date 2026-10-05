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

// The PLAY button on the home screen: straight to the rated (featured) levels.
function openPlay() { currentLevelSort = 'featured'; openBrowseLevels('levels'); }

// ---------------- My Levels ----------------
function openMyLevels() { toggleMenu('my-levels-menu'); renderMyLevels(); }

async function renderMyLevels() {
  const menu = document.getElementById('my-levels-menu');
  menu.innerHTML = screenHtml('MY LEVELS', null, `
    <div class="tabs"><button class="tab ${currentMyTab === 'device' ? 'active' : ''}" onclick="currentMyTab='device';renderMyLevels()">On this device</button>
    <button class="tab ${currentMyTab === 'online' ? 'active' : ''}" onclick="currentMyTab='online';renderMyLevels()">Published</button></div>
    <div id="my-levels-list" class="song-list"></div>`, '<button class="btn small" onclick="document.getElementById(\'level-upload\').click()">📂</button> <button class="btn small" onclick="startEditor()">＋ New</button>');
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
  currentBrowseTab = ['levels', 'list', 'leaderboards', 'players'].includes(tab) ? tab : 'levels';
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
    <div class="tabs">${tabBtn('levels', 'Levels')}${tabBtn('list', 'List')}${tabBtn('leaderboards', 'Ranks')}${tabBtn('players', 'Players')}</div>
    ${currentBrowseTab === 'leaderboards' || currentBrowseTab === 'list' ? '' : `<div class="searchbar"><span>🔎</span><input type="text" id="browse-search-input" placeholder="${currentBrowseTab === 'players' ? 'Search players…' : 'Search levels or authors…'}" onkeydown="if(event.key==='Enter')renderBrowseContent()"><button class="btn small" onclick="renderBrowseContent()">Search</button></div>`}
    <div id="browse-sub-tabs"></div>
    <div id="browse-content" class="song-list"></div>`);
  if (currentBrowseTab === 'levels') renderBrowseLevels();
  if (currentBrowseTab === 'list') renderLevelList();
  if (currentBrowseTab === 'leaderboards') renderLeaderboards();
  if (currentBrowseTab === 'players') renderPlayers();
}

async function renderBrowseLevels() {
  const container = document.getElementById('browse-content');
  const sub = document.getElementById('browse-sub-tabs');
  if (!container) return;
  const sorts = [['recent', 'Recent'], ['trending', 'Trending'], ['rated', 'Top Rated'], ['featured', 'Rated']];
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

async function renderLevelList() {
  const container = document.getElementById('browse-content');
  document.getElementById('browse-sub-tabs').innerHTML = '<div class="note center">The hardest levels, ranked by the admins. Beating a level earns <b>Extreme Points</b> - the higher it sits, the more it is worth.</div>';
  container.innerHTML = '<div class="empty">Loading the list…</div>';
  try {
    const levels = await apiRequest('/api/list');
    container.innerHTML = '';
    if (!levels.length) { container.innerHTML = '<div class="empty">The list is empty for now.</div>'; return; }
    levels.forEach(l => container.appendChild(renderLevelCard(l, 'community')));
  } catch (e) { container.innerHTML = errorBox(e.message, 'renderLevelList()'); }
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
    players.forEach(p => container.appendChild(playerRow(p, '', 'Games ' + Number(p.statistics.gamesPlayed || 0).toLocaleString() + ' · ' + Number(p.extremePoints || 0) + ' EP', '★ ' + Number(p.stars || 0).toLocaleString())));
  } catch (e) { container.innerHTML = errorBox(e.message, 'renderPlayers()'); }
}

function openPlayerProfile(player) {
  const username = String(player.username || 'Unknown');
  document.getElementById('stats-modal').innerHTML = screenHtml('PLAYER', "toggleMenu('browse-levels-menu')", `<div class="panel profile-hero"><div class="avatar big">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(username.slice(0, 1).toUpperCase())}</div><div><div class="hero-name">${escapeHtml(username)}</div><div class="hero-sub">Online player</div></div></div>` + statsGridHtml(player.statistics || {}, player));
  toggleMenu('stats-modal');
}

const LB_TABS = [['points', 'Extreme Pts'], ['stars', 'Stars'], ['difficulty', 'Difficulty Beaten'], ['creator', 'Creator'], ['bestScore', 'Best Score'], ['totalScore', 'Total Score'], ['notesHit', 'Notes'], ['battleWins', 'Battle Wins']];

async function renderLeaderboards() {
  document.getElementById('browse-sub-tabs').innerHTML = '<div class="tabs small wrap">' +
    LB_TABS.map(([id, l]) => `<button class="tab" data-sort="${id}" onclick="loadLeaderboard('${id}')">${l}</button>`).join('') + '</div>';
  await loadLeaderboard(currentLbSort);
}
let currentLbSort = 'points';

async function loadLeaderboard(sort) {
  currentLbSort = sort;
  const container = document.getElementById('browse-content');
  document.querySelectorAll('#browse-sub-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  container.innerHTML = '<div class="empty">Loading leaderboard…</div>';
  try {
    const players = await apiRequest('/api/leaderboards?sort=' + encodeURIComponent(sort));
    container.innerHTML = '';
    if (!players.length) { container.innerHTML = '<div class="empty">No players yet.</div>'; return; }
    const n = v => Number(v || 0).toLocaleString();
    players.forEach((p, i) => {
      const st = p.statistics || {};
      let value, sub;
      if (sort === 'points') { value = n(p.extremePoints) + ' EP'; sub = (p.listBeaten || 0) + ' list levels beaten'; }
      else if (sort === 'stars') { value = '★ ' + n(p.stars); sub = 'Hardest: ' + (p.hardestDifficulty || '—'); }
      else if (sort === 'difficulty') { value = p.hardestDifficulty || '—'; sub = '★ ' + n(p.stars) + ' stars'; }
      else if (sort === 'creator') { value = n(p.creatorPoints) + ' CP'; sub = 'Rated levels made'; }
      else if (sort === 'totalScore') { value = n(st.totalScore); sub = 'Games ' + n(st.gamesPlayed); }
      else if (sort === 'notesHit') { value = n(st.totalNotesHit); sub = 'Games ' + n(st.gamesPlayed); }
      else if (sort === 'battleWins') { value = n(st.battleWins) + ' W'; sub = formatBattleWinRate(st) + ' win rate'; }
      else { value = n(st.bestScore); sub = 'Games ' + n(st.gamesPlayed); }
      container.appendChild(playerRow(p, '<span class="rank">#' + (i + 1) + '</span> ', sub, value));
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
      <div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span><span>★ ${avg ? avg.toFixed(1) : '—'}</span><span>▶ ${level.plays || 0}</span>${level.featured ? '<span class="feat">★ ' + (level.ratedStars || 0) + ' RATED</span>' : ''}${level.listPosition ? '<span class="feat list">#' + level.listPosition + ' · ' + level.listPoints + ' EP</span>' : ''}</div>
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

function openLevelDetail(level, source, fromAdmin = false) {
  const online = source !== 'local';
  levelDetailReturnTo = fromAdmin ? 'admin-panel' : source === 'community' ? 'browse-levels-menu' : 'my-levels-menu';
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  const tiles = level.tileCount || (level.data || []).length;
  const body = `
    <div class="panel detail-head"><div class="song-art" style="${level.icon ? '' : 'background:' + artGradient(level.name)}">${level.icon ? '<img src="' + escapeHtml(level.icon) + '" alt="">' : '♪'}</div>
      <div><div class="hero-name">${escapeHtml(level.name)}</div><div class="hero-sub">by ${escapeHtml(level.author || 'You')}</div><div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span>${level.featured ? '<span class="feat">★ ' + (level.ratedStars || 0) + ' stars</span>' : ''}${level.listPosition ? '<span class="feat list">#' + level.listPosition + ' · ' + level.listPoints + ' EP</span>' : ''}</div></div></div>
    <div class="stats-grid three"><div class="stat-card"><span>TILES</span><b>${tiles}</b></div><div class="stat-card"><span>RATING</span><b>${avg ? avg.toFixed(1) : '—'}</b></div><div class="stat-card"><span>PLAYS</span><b>${level.plays || 0}</b></div></div>
    ${source === 'community' ? '<div class="rate-row" id="rate-row">' + [1, 2, 3, 4, 5].map(i => '<span class="rate-star" data-v="' + i + '">★</span>').join('') + '</div><div class="note center">Tap a star to rate</div>' : ''}
    <button class="btn btn-play" id="detail-play">▶ PLAY</button>
    ${source === 'local' ? '<button class="btn btn-ghost" id="detail-edit">✎ Edit</button><button class="btn btn-danger" id="detail-del">Delete from device</button>' : ''}
    ${source === 'mine-online' ? '<button class="btn btn-ghost" id="detail-edit-online">✎ Edit (updates it publicly)</button><button class="btn btn-danger" id="detail-unpub">Remove from Browse</button>' : ''}
    ${isAdminUser() && source !== 'local' ? '<div class="section-title">ADMIN</div><button class="btn btn-ghost" id="detail-admin-rate">★ Rate / edit rating</button><button class="btn btn-ghost" id="detail-admin-list">🏆 Set list position</button>' : ''}`;
  document.getElementById('level-detail-menu').innerHTML = screenHtml('LEVEL', 'closeLevelDetail()', body);
  toggleMenu('level-detail-menu');
  document.getElementById('detail-play').onclick = () => playLevelEntry(level, source);
  const q = id => document.getElementById(id);
  if (q('detail-edit')) q('detail-edit').onclick = () => { currentEditingId = level.id; startEditor(level); };
  if (q('detail-edit-online')) q('detail-edit-online').onclick = async () => {
    try {
      toast('Loading level…');
      const full = level.data ? level : await getCommunityLevel(level.id);
      const local = myLevels.find(l => l.onlineId === full.id);
      currentEditingId = local ? local.id : null;
      startEditor({ ...full, onlineId: full.id });
    } catch (e) { toast(e.message, 'bad'); }
  };
  if (q('detail-admin-rate')) q('detail-admin-rate').onclick = () => adminRateLevel(level, () => { toggleMenu('browse-levels-menu'); renderBrowseSection(); });
  if (q('detail-admin-list')) q('detail-admin-list').onclick = () => adminSetListPosition(level, () => { toggleMenu('browse-levels-menu'); renderBrowseSection(); });
  if (q('detail-del')) q('detail-del').onclick = async () => { if (await deleteCustomLevel(level.id)) closeLevelDetail(); };
  if (q('detail-unpub')) q('detail-unpub').onclick = async () => {
    if (!(await uiConfirm('Remove "' + level.name + '" from Browse for everyone?', 'Remove', true))) return;
    try { await apiRequest('/api/levels/' + encodeURIComponent(level.id), { method: 'DELETE', auth: true }); toast('Removed.', 'good'); closeLevelDetail(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('#rate-row .rate-star').forEach(star => {
    star.onmouseenter = () => document.querySelectorAll('#rate-row .rate-star').forEach(s => s.classList.toggle('filled', Number(s.dataset.v) <= Number(star.dataset.v)));
    star.onclick = async () => {
      try { const r = await rateLevel(level.id, Number(star.dataset.v)); toast('Thanks! Average is now ★ ' + Number(r.ratingAverage).toFixed(1), 'good'); level.ratingAverage = r.ratingAverage; openLevelDetail(level, source, levelDetailReturnTo === 'admin-panel'); }
      catch (e) { toast(e.message, 'bad'); }
    };
  });
}

function closeLevelDetail() {
  if (levelDetailReturnTo === 'admin-panel') { loadAdminPanel(); return; }
  if (levelDetailReturnTo === 'my-levels-menu') { toggleMenu('my-levels-menu'); renderMyLevels(); }
  else { toggleMenu('browse-levels-menu'); renderBrowseSection(); }
}

// ---------------- Admin panel ----------------
let adminSearch = '', adminTab = 'alerts', adminPlayerSearch = '';
const isAdminUser = () => { const u = getAuthUser(); return !!(u && u.isAdmin && getAuthToken()); };

async function loadAdminPanel(tab) {
  if (typeof tab === 'string') adminTab = tab;
  const modal = document.getElementById('admin-panel');
  const draw = (inner, overview) => {
    const unread = overview ? overview.unreadNotifications : 0;
    const tb = (id, label) => `<button class="tab ${adminTab === id ? 'active' : ''}" onclick="loadAdminPanel('${id}')">${label}</button>`;
    modal.innerHTML = screenHtml('ADMIN', null, `<div class="tabs">${tb('alerts', 'Alerts' + (unread ? ' (' + unread + ')' : ''))}${tb('levels', 'Levels')}${tb('players', 'Players')}</div>` + inner, '<button class="btn small" onclick="loadAdminPanel()">↻</button>');
  };
  toggleMenu('admin-panel');
  if (!getAuthToken()) { draw('<div class="empty">Log in as an admin first.</div>'); return; }
  draw('<div class="empty">Loading…</div>');
  try {
    const overview = await apiRequest('/api/admin/overview', { auth: true });
    const stats = `<div class="stats-grid three"><div class="stat-card"><span>PLAYERS</span><b>${overview.users}</b></div><div class="stat-card"><span>LEVELS</span><b>${overview.levels}</b></div><div class="stat-card"><span>ONLINE NOW</span><b>${overview.onlineNow}</b></div></div>`;
    if (adminTab === 'alerts') draw(stats + await adminAlertsHtml(), overview);
    else if (adminTab === 'players') draw(stats + await adminPlayersHtml(), overview);
    else draw(stats + await adminLevelsHtml(), overview);
    updateAdminButton(getAuthUser());
  } catch (e) { draw(errorBox(e.message, 'loadAdminPanel()')); }
}

async function adminAlertsHtml() {
  const data = await apiRequest('/api/admin/notifications', { auth: true });
  const list = data.notifications || [];
  if (!list.length) return '<div class="empty">No alerts. 5-star ratings show up here.</div>';
  return '<div class="row-btns"><button class="btn small btn-ghost" onclick="adminReadAll()">Mark all read</button></div><div class="song-list">' + list.map(n => `
    <div class="song-row admin-row ${n.read ? 'read' : 'unread'}"><div class="song-art" style="background:${artGradient(n.levelName || 'x')}">${n.type === 'five_star' ? '⭐' : '✎'}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(n.message)}</div><div class="song-sub">${timeAgo(n.createdAt)}${n.levelRated ? ' · already rated' : ''}</div></div>
      <div class="admin-actions">${n.levelId ? `<button class="btn small" onclick="adminViewLevel('${n.levelId}', ${n.id})">View level</button>` : ''}<button class="btn small btn-ghost" onclick="adminReadAlert(${n.id})">Dismiss</button></div></div>`).join('') + '</div>';
}
async function adminReadAll() { try { await apiRequest('/api/admin/notifications/read', { method: 'POST', auth: true, body: {} }); loadAdminPanel(); } catch (e) { toast(e.message, 'bad'); } }
async function adminReadAlert(id) { try { await apiRequest('/api/admin/notifications/read', { method: 'POST', auth: true, body: { id } }); loadAdminPanel(); } catch (e) { toast(e.message, 'bad'); } }
async function adminViewLevel(levelId, notificationId) {
  try {
    const full = await getCommunityLevel(levelId);
    if (notificationId) apiRequest('/api/admin/notifications/read', { method: 'POST', auth: true, body: { id: notificationId } }).catch(() => {});
    openLevelDetail(full, 'community', true);
  } catch (e) { toast(e.message, 'bad'); }
}

async function adminLevelsHtml() {
  const data = await apiRequest('/api/admin/levels?search=' + encodeURIComponent(adminSearch), { auth: true });
  const levels = data.levels || [];
  adminLevelCache = {}; levels.forEach(l => { adminLevelCache[l.id] = l; });
  return `<div class="searchbar"><span>🔎</span><input id="admin-search" placeholder="Search levels or authors…" value="${escapeHtml(adminSearch)}" onkeydown="if(event.key==='Enter'){adminSearch=this.value;loadAdminPanel('levels')}"></div>
    <div class="song-list">${levels.length ? levels.map(l => `
      <div class="song-row admin-row"><div class="song-art" style="${l.icon ? '' : 'background:' + artGradient(l.name)}">${l.icon ? '<img src="' + escapeHtml(l.icon) + '" alt="">' : '♪'}</div>
        <div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.author)} · ★ ${Number(l.ratingAverage || 0).toFixed(1)} · ▶ ${l.plays}</div>
          <div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(l.difficulty)}">${l.difficulty}</span>${l.featured ? '<span class="feat">★ ' + l.ratedStars + ' RATED</span>' : ''}${l.listPosition ? '<span class="feat list">#' + l.listPosition + ' · ' + l.listPoints + ' EP</span>' : ''}</div></div>
        <div class="admin-actions"><button class="btn small" onclick="adminRateById('${l.id}')">${l.featured ? 'Edit rating' : 'Rate'}</button><button class="btn small btn-ghost" onclick="adminListById('${l.id}')">List</button><button class="btn small btn-danger" onclick="deleteAdminLevel('${l.id}')">Delete</button></div></div>`).join('') : '<div class="empty">No levels.</div>'}</div>`;
}

let adminLevelCache = {};
async function adminRateById(id) { const full = adminLevelCache[id] || await getCommunityLevel(id); adminRateLevel(full, () => loadAdminPanel('levels')); }
async function adminListById(id) { const full = adminLevelCache[id] || await getCommunityLevel(id); adminSetListPosition(full, () => loadAdminPanel('levels')); }

async function adminRateLevel(level, done) {
  const r = await openFormDialog({
    title: 'Rate "' + level.name + '"', message: 'Rated levels give players stars, appear under Rated, count for creator points, and can be used in battles.',
    fields: [
      { id: 'rated', label: 'Rated?', type: 'select', value: level.featured ? 'yes' : 'yes', options: [{ value: 'yes', label: 'Yes - rated level' }, { value: 'no', label: 'No - remove rating' }] },
      { id: 'difficulty', label: 'Difficulty', type: 'select', value: level.difficulty || 'Normal', options: ['Easy', 'Normal', 'Hard', 'Insane', 'Extreme'].map(d => ({ value: d, label: d })) },
      { id: 'stars', label: 'Stars awarded for beating it (1-10)', type: 'number', value: String(level.ratedStars || ''), maxlength: 2 }
    ], okText: 'Save'
  });
  if (!r) return;
  try {
    await apiRequest('/api/admin/levels/' + encodeURIComponent(level.id) + '/rate', { method: 'PATCH', auth: true, body: { rated: r.rated === 'yes', difficulty: r.difficulty, stars: Number(r.stars) || 0 } });
    toast(r.rated === 'yes' ? 'Level rated.' : 'Rating removed.', 'good');
    if (done) done();
  } catch (e) { toast(e.message, 'bad'); }
}

async function adminSetListPosition(level, done) {
  const r = await openFormDialog({
    title: 'List position for "' + level.name + '"',
    message: '1 = the top of the list. Beating a level earns Extreme Points: #1 is worth 250, each rank down is worth 6% less. Leave empty to take it off the list.',
    fields: [{ id: 'position', label: 'Position', type: 'number', value: level.listPosition ? String(level.listPosition) : '', maxlength: 4 }], okText: 'Save'
  });
  if (!r) return;
  try {
    const pos = String(r.position).trim();
    await apiRequest('/api/admin/levels/' + encodeURIComponent(level.id) + '/list', { method: 'PATCH', auth: true, body: { position: pos === '' ? null : Number(pos) } });
    toast(pos === '' ? 'Removed from the list.' : 'Placed at #' + pos + '.', 'good');
    if (done) done();
  } catch (e) { toast(e.message, 'bad'); }
}

async function deleteAdminLevel(levelId) {
  if (!(await uiConfirm('Delete this level for everyone?', 'Delete', true))) return;
  try { await apiRequest('/api/admin/levels/' + encodeURIComponent(levelId), { method: 'DELETE', auth: true }); toast('Deleted.', 'good'); loadAdminPanel('levels'); }
  catch (e) { toast(e.message, 'bad'); }
}

// ---- players ----
let adminPlayersCache = {};
async function adminPlayersHtml() {
  const data = await apiRequest('/api/admin/players?search=' + encodeURIComponent(adminPlayerSearch), { auth: true });
  const players = data.players || [];
  adminPlayersCache = {}; players.forEach(p => { adminPlayersCache[p.id] = p; });
  return `<div class="searchbar"><span>🔎</span><input id="admin-psearch" placeholder="Search players…" value="${escapeHtml(adminPlayerSearch)}" onkeydown="if(event.key==='Enter'){adminPlayerSearch=this.value;loadAdminPanel('players')}"></div>
    <div class="song-list">${players.length ? players.map(p => `
      <div class="song-row admin-row"><div class="song-art" style="${p.profileIcon ? '' : 'background:' + artGradient(p.username)}">${p.profileIcon ? '<img src="' + escapeHtml(p.profileIcon) + '" alt="">' : escapeHtml(p.username.slice(0, 1).toUpperCase())}</div>
        <div class="song-info"><div class="song-title">${escapeHtml(p.username)}${p.isAdmin ? ' 🛡' : ''}</div>
          <div class="song-sub">★ ${p.stars} · ${p.extremePoints} EP · ${p.creatorPoints} CP · ${p.statistics.gamesPlayed} games · ${p.levelCount} levels</div>
          ${p.banned ? '<div class="song-meta"><span class="feat bad">' + (p.permanent ? 'BANNED (permanent)' : 'BANNED until ' + new Date(p.bannedUntil).toLocaleString()) + '</span></div>' : ''}${p.pendingWarning ? '<div class="song-meta"><span class="feat">⚠ warning not yet read</span></div>' : ''}</div>
        <div class="admin-actions"><button class="btn small" onclick="adminPlayerMenu('${p.id}')">Manage</button></div></div>`).join('') : '<div class="empty">No players found.</div>'}</div>`;
}

async function adminPlayerMenu(id) {
  const p = adminPlayersCache[id]; if (!p) return;
  const r = await openFormDialog({
    title: p.username, message: p.email + ' · joined ' + new Date(p.createdAt).toLocaleDateString() + '\n★ ' + p.stars + ' stars · ' + p.extremePoints + ' EP · hardest: ' + (p.hardestDifficulty || '—'),
    fields: [{ id: 'action', label: 'What do you want to do?', type: 'select', value: 'warn', options: [
      { value: 'warn', label: '⚠ Send a warning' }, { value: 'ban', label: '🚫 Ban for a while' },
      ...(p.banned ? [{ value: 'unban', label: '✔ Lift the ban' }] : []),
      ...(p.owner ? [] : p.isAdmin ? [{ value: 'demote', label: '🛡 Remove admin (owners only)' }] : [{ value: 'promote', label: '🛡 Make admin' }]),
      { value: 'reset', label: '🗑 Remove all their stats' }] }], okText: 'Next'
  });
  if (!r) return;
  try {
    if (r.action === 'warn') await adminWarn(p);
    else if (r.action === 'ban') await adminBan(p);
    else if (r.action === 'promote' || r.action === 'demote') {
      const make = r.action === 'promote';
      if (!(await uiConfirm(make ? 'Make ' + p.username + ' an admin? They will be able to rate and delete levels, ban players and give admin to others.' : 'Remove ' + p.username + '\'s admin access?', make ? 'Make admin' : 'Remove admin', !make))) return;
      await apiRequest('/api/admin/players/' + id + '/admin', { method: 'POST', auth: true, body: { admin: make } });
      toast(p.username + (make ? ' is now an admin.' : ' is no longer an admin.'), 'good'); loadAdminPanel('players');
    }
    else if (r.action === 'unban') { await apiRequest('/api/admin/players/' + id + '/unban', { method: 'POST', auth: true, body: {} }); toast('Ban lifted.', 'good'); loadAdminPanel('players'); }
    else if (r.action === 'reset') {
      if (!(await uiConfirm('Remove ALL of ' + p.username + '\'s stats (games, scores, notes, battles, stars, difficulty beaten, extreme points)? This can\'t be undone.', 'Remove stats', true))) return;
      await apiRequest('/api/admin/players/' + id + '/reset-stats', { method: 'POST', auth: true, body: {} }); toast('Stats removed.', 'good'); loadAdminPanel('players');
    }
  } catch (e) { toast(e.message, 'bad'); }
}

const WARN_TEXT_KEY = 'et_lastWarningText';
async function adminWarn(p) {
  const r = await openFormDialog({
    title: 'Warn ' + p.username, message: 'This pops up as a full-screen warning on their screen until they dismiss it. Edit the text however you like.',
    fields: [{ id: 'message', label: 'Warning text', type: 'textarea', rows: 5, value: localStorage.getItem(WARN_TEXT_KEY) || 'Please follow the rules. Further violations may result in a ban.' }], okText: 'Send warning'
  });
  if (!r || !r.message.trim()) return;
  localStorage.setItem(WARN_TEXT_KEY, r.message.trim());
  await apiRequest('/api/admin/players/' + p.id + '/warn', { method: 'POST', auth: true, body: { message: r.message.trim() } });
  toast('Warning sent to ' + p.username + '.', 'good'); loadAdminPanel('players');
}
async function adminBan(p) {
  const r = await openFormDialog({
    title: 'Ban ' + p.username, message: 'Pick any length you like.', fields: [
      { id: 'amount', label: 'Length', type: 'number', value: '1', maxlength: 6 },
      { id: 'unit', label: 'Unit', type: 'select', value: 'days', options: [
        { value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' },
        { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months (30 days)' }, { value: 'perm', label: 'Permanent (ignores length)' }] },
      { id: 'reason', label: 'Reason (shown to them)', type: 'text', value: '', maxlength: 200 }], okText: 'Ban', danger: true
  });
  if (!r) return;
  const per = { minutes: 1, hours: 60, days: 1440, weeks: 10080, months: 43200 };
  let body;
  if (r.unit === 'perm') body = { permanent: true, reason: r.reason };
  else {
    const minutes = Math.round(Number(r.amount) * per[r.unit]);
    if (!(minutes >= 1)) { toast('Enter a ban length of at least 1 minute.', 'bad'); return; }
    if (minutes > 5256000) { toast('That is over 10 years - use Permanent instead.', 'bad'); return; }
    body = { minutes, reason: r.reason };
  }
  await apiRequest('/api/admin/players/' + p.id + '/ban', { method: 'POST', auth: true, body });
  toast(p.username + ' banned.', 'good'); loadAdminPanel('players');
}
