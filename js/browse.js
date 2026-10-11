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
    <div id="my-levels-list" class="song-list"></div>`, '<button class="btn small" onclick="document.getElementById(\'level-upload\').click()">📂</button> <button class="btn small" onclick="openShared()">👥</button> <button class="btn small" onclick="startEditor()">＋ New</button>');
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
  if (currentBrowseTab === 'levels') { renderDailyBanner(); renderBrowseLevels(); }
  else if (currentBrowseTab === 'players') renderPlayers();
}

function renderBrowseSection() {
  const menu = document.getElementById('browse-levels-menu');
  const tabBtn = (id, label) => `<button class="tab ${currentBrowseTab === id ? 'active' : ''}" onclick="openBrowseLevels('${id}')">${label}</button>`;
  menu.innerHTML = screenHtml('BROWSE', null, `
    <div class="tabs">${tabBtn('levels', 'Levels')}${tabBtn('list', 'List')}${tabBtn('leaderboards', 'Ranks')}${tabBtn('players', 'Players')}</div>
    ${currentBrowseTab === 'leaderboards' || currentBrowseTab === 'list' ? '' : `<div class="searchbar"><span>🔎</span><input type="text" id="browse-search-input" placeholder="${currentBrowseTab === 'players' ? 'Search players…' : 'Search levels or authors…'}" onkeydown="if(event.key==='Enter')renderBrowseContent()"><button class="btn small" onclick="renderBrowseContent()">Search</button></div>`}
    <div id="daily-banner"></div>
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
    if (!sub.querySelector('.level-filters')) sub.insertAdjacentHTML('beforeend', levelFilterHtml());
    const levels = await getFilteredLevels(search, currentLevelSort);
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
  row.innerHTML = `<div class="song-art ${frameClass(player)}" style="${player.profileIcon ? '' : 'background:' + artGradient(username)}">${player.profileIcon ? '<img src="' + escapeHtml(player.profileIcon) + '" alt="">' : escapeHtml(username.slice(0, 1).toUpperCase())}</div>
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

async function openPlayerProfile(player) {
  const username = String(player.username || 'Unknown');
  const draw = (p, levels) => {
    const own = getAuthUser();
    document.getElementById('stats-modal').innerHTML = screenHtml('PLAYER', "toggleMenu('browse-levels-menu')",
      `<div class="panel profile-hero"><div class="avatar big ${frameClass(p)}">${p.profileIcon ? '<img src="' + escapeHtml(p.profileIcon) + '" alt="">' : escapeHtml(username.slice(0, 1).toUpperCase())}</div><div><div class="hero-name">${escapeHtml(username)}</div><div class="hero-sub">${escapeHtml(p.title || 'Online player')} · ${p.creatorPoints || 0} creator points</div></div></div>` +
      (own && own.username.toLowerCase() !== username.toLowerCase() ? '<div class="row-btns"><button class="btn small" id="pf-friend">＋ Friend</button><button class="btn small btn-ghost" id="pf-report">⚑ Report</button></div>' : '') +
      statsGridHtml(p.statistics || {}, p) + (levels ? '<div class="section-title">LEVELS BY ' + escapeHtml(username).toUpperCase() + '</div><div class="song-list" id="creator-levels"></div>' : ''));
    toggleMenu('stats-modal');
    const f = document.getElementById('pf-friend'); if (f) f.onclick = () => sendFriendRequest(username);
    const r = document.getElementById('pf-report'); if (r) r.onclick = () => reportDialog('player', { username });
    const host = document.getElementById('creator-levels');
    if (host) { if (!levels.length) host.innerHTML = '<div class="empty">No published levels.</div>'; levels.forEach(l => host.appendChild(renderLevelCard(l, 'community'))); }
  };
  draw(player, null);
  try { const d = await apiRequest('/api/creators/' + encodeURIComponent(username)); draw(d.user, d.levels); } catch (e) {}
}

const LB_TABS = [['elo', 'Battle Rating'], ['points', 'Extreme Pts'], ['stars', 'Stars'], ['difficulty', 'Difficulty Beaten'], ['creator', 'Creator'], ['bestScore', 'Best Score'], ['totalScore', 'Total Score'], ['notesHit', 'Notes'], ['battleWins', 'Battle Wins']];

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
      if (sort === 'elo') { value = n(p.elo); sub = n(st.battleWins) + ' W / ' + n(st.battleLosses) + ' L'; }
      else if (sort === 'points') { value = n(p.extremePoints) + ' EP'; sub = (p.listBeaten || 0) + ' list levels beaten'; }
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
function renderLevelCardBase(level, source) {
  const diff = estimateDifficulty(level);
  const avg = Number(level.ratingAverage || getAvgRating(level) || 0);
  const row = document.createElement('div');
  row.className = 'song-row';
  row.innerHTML = `
    <div class="song-art" style="${level.icon || level.thumb ? '' : 'background:' + artGradient(level.name)}">${level.icon || level.thumb ? '<img src="' + escapeHtml(level.icon || level.thumb) + '" alt="">' : '♪'}<span class="speaker">🔊</span></div>
    <div class="song-info">
      <div class="song-title">${escapeHtml(level.name)}</div>
      <div class="song-sub">${escapeHtml(level.author || 'You')}</div>
      ${level.description ? '<div class="level-desc">' + escapeHtml(level.description) + '</div>' : ''}
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
    await attachLocalAudio(level);
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
    <div class="panel detail-head"><div class="song-art" style="${level.icon || level.thumb ? '' : 'background:' + artGradient(level.name)}">${level.icon || level.thumb ? '<img src="' + escapeHtml(level.icon || level.thumb) + '" alt="">' : '♪'}</div>
      <div><div class="hero-name">${escapeHtml(level.name)}</div><div class="hero-sub">by ${escapeHtml(level.author || 'You')}</div><div class="song-meta"><span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span>${level.featured ? '<span class="feat">★ ' + (level.ratedStars || 0) + ' stars</span>' : ''}${level.listPosition ? '<span class="feat list">#' + level.listPosition + ' · ' + level.listPoints + ' EP</span>' : ''}</div></div></div>
    ${level.description ? '<div class="panel note">' + escapeHtml(level.description).replace(/\n/g, '<br>') + '</div>' : ''}
    <div class="stats-grid three"><div class="stat-card"><span>TILES</span><b>${tiles}</b></div><div class="stat-card"><span>RATING</span><b>${avg ? avg.toFixed(1) : '—'}</b></div><div class="stat-card"><span>PLAYS</span><b>${level.plays || 0}</b></div></div>
    ${source === 'community' ? '<div class="rate-row" id="rate-row">' + [1, 2, 3, 4, 5].map(i => '<span class="rate-star" data-v="' + i + '">★</span>').join('') + '</div><div class="note center">Tap a star to rate</div>' : ''}
    <div class="note center" id="detail-best"></div>
    <button class="btn btn-play" id="detail-play">▶ PLAY</button>
    ${online ? '<button class="btn btn-ghost" id="detail-practice">🎯 Practice (checkpoints)</button><button class="btn btn-ghost" id="detail-board">🏆 Level leaderboard</button><button class="btn btn-ghost" id="detail-comments">💬 Comments</button><button class="btn btn-ghost" id="detail-report">⚑ Report</button>' : ''}
    ${source === 'mine-online' ? '<button class="btn btn-ghost" id="detail-versions">⏪ Versions / roll back</button>' : ''}
    ${source === 'local' && level.verifiedHash ? '<button class="btn btn-ghost" id="detail-unverify">✔ Verified - clear verification</button>' : ''}
    ${source === 'local' ? '<button class="btn btn-ghost" id="detail-edit">✎ Edit</button><button class="btn btn-danger" id="detail-del">Delete from device</button>' : ''}
    ${source === 'mine-online' ? '<button class="btn btn-ghost" id="detail-edit-online">✎ Edit (updates it publicly)</button><button class="btn btn-danger" id="detail-unpub">Remove from Browse</button>' : ''}
    ${isAdminUser() && source !== 'local' ? '<div class="section-title">ADMIN</div><button class="btn btn-ghost" id="detail-admin-rate">★ Rate / edit rating</button><button class="btn btn-ghost" id="detail-admin-list">🏆 Set list position</button>' : ''}`;
  document.getElementById('level-detail-menu').innerHTML = screenHtml('LEVEL', 'closeLevelDetail()', body);
  toggleMenu('level-detail-menu');
  document.getElementById('detail-play').onclick = () => playLevelEntry(level, source);
  const q = id => document.getElementById(id);
  const pr = online && level.id && myProgress[level.id];
  { const bits = []; if (pr) bits.push('Your best: ' + (pr.completed ? 'completed ✔' : pr.bestPct + '%') + ' · score ' + Number(pr.bestScore).toLocaleString());
    const at = getAttempts(level.id); if (at) bits.push('Attempts: ' + at);
    if (source === 'local' && level.verifiedHash && level.verifiedHash === levelHashOf(level.data, level.effects)) bits.push('Verified ✔');
    if (q('detail-best')) q('detail-best').textContent = bits.join(' · ');
    if (q('detail-unverify')) q('detail-unverify').onclick = () => { delete level.verifiedHash; persistMyLevels(); toast('Verification cleared.'); openLevelDetail(level, source); }; }
  if (q('detail-practice')) q('detail-practice').onclick = () => practiceLevel(level);
  if (q('detail-board')) q('detail-board').onclick = () => openLevelBoard(level);
  if (q('detail-comments')) q('detail-comments').onclick = () => openComments(level);
  if (q('detail-report')) q('detail-report').onclick = () => reportDialog('level', level);
  if (q('detail-versions')) q('detail-versions').onclick = () => openVersions(level);
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
    modal.innerHTML = screenHtml('ADMIN', null, `<div class="tabs admin-tabs wrap">${tb('alerts', 'Alerts' + (unread ? ' (' + unread + ')' : ''))}${tb('reports', 'Reports' + (overview && overview.pendingReports ? ' (' + overview.pendingReports + ')' : ''))}${tb('levels', 'Levels')}${tb('unpub', 'Unpublished')}${tb('players', 'Players')}${tb('log', 'Log')}${tb('settings', 'Settings')}</div>` + inner, '<button class="btn small" onclick="loadAdminPanel()">↻</button>');
  };
  toggleMenu('admin-panel');
  if (!getAuthToken()) { draw('<div class="empty">Log in as an admin first.</div>'); return; }
  draw('<div class="empty">Loading…</div>');
  try {
    const overview = await apiRequest('/api/admin/overview', { auth: true });
    const stats = `<div class="stats-grid three"><div class="stat-card"><span>PLAYERS</span><b>${overview.users}</b></div><div class="stat-card"><span>LEVELS</span><b>${overview.levels}</b></div><div class="stat-card"><span>ONLINE NOW</span><b>${overview.onlineNow}</b></div><div class="stat-card"><span>NEW USERS 24H</span><b>${overview.newUsers24h}</b></div><div class="stat-card"><span>NEW LEVELS 24H</span><b>${overview.newLevels24h}</b></div><div class="stat-card"><span>BANNED / MUTED</span><b>${overview.banned} / ${overview.muted}</b></div></div>`;
    if (adminTab === 'alerts') draw(stats + await adminAlertsHtml(), overview);
    else if (adminTab === 'players') draw(stats + await adminPlayersHtml(), overview);
    else if (adminTab === 'reports') draw(stats + await adminReportsHtml(), overview);
    else if (adminTab === 'unpub') draw(await adminUnpubHtml(), overview);
    else if (adminTab === 'log') draw(await adminLogHtml(), overview);
    else if (adminTab === 'settings') draw(await adminSettingsHtml(), overview);
    else draw(stats + await adminLevelsHtml(), overview);
    updateAdminButton(getAuthUser());
  } catch (e) { draw(errorBox(e.message, 'loadAdminPanel()')); }
}

async function adminAlertsHtml() {
  const data = await apiRequest('/api/admin/notifications', { auth: true });
  const list = data.notifications || [];
  if (!list.length) return '<div class="empty">No alerts. 5-star ratings show up here.</div>';
  return '<div class="row-btns"><button class="btn small btn-ghost" onclick="adminReadAll()">Mark all read</button></div><div class="song-list">' + list.map(n => `
    <div class="song-row admin-row ${n.read ? 'read' : 'unread'}"><div class="song-art" style="background:${artGradient(n.levelName || 'x')}">${ALERT_ICONS[n.type] || '•'}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(n.message)}</div><div class="song-sub">${timeAgo(n.createdAt)}${n.levelRated ? ' · already rated' : ''}</div></div>
      <div class="admin-actions">${n.levelId ? `<button class="btn small" onclick="adminViewLevel('${n.levelId}', ${n.id})">View level</button>` : ''}${n.targetUsername ? `<button class="btn small" onclick="adminOpenPlayer('${escapeHtml(n.targetUsername)}')">Player</button>` : ''}<button class="btn small btn-ghost" onclick="adminReadAlert(${n.id})">Dismiss</button></div></div>`).join('') + '</div>';
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
        <div class="admin-actions"><button class="btn small" onclick="adminRateById('${l.id}')">${l.featured ? 'Edit rating' : 'Rate'}</button><button class="btn small btn-ghost" onclick="adminListById('${l.id}')">List</button><button class="btn small btn-ghost" onclick="adminEditLevel('${l.id}')">Edit</button>${l.hasAudio ? `<button class="btn small btn-ghost" onclick="adminRemoveAudio('${l.id}')">🎵✕</button>` : ''}<button class="btn small btn-ghost" onclick="adminMakeDaily('${l.id}')">Daily</button><button class="btn small btn-danger" onclick="deleteAdminLevel('${l.id}')">Delete</button></div></div>`).join('') : '<div class="empty">No levels.</div>'}</div>`;
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
    fields: [{ id: 'position', label: 'Position', type: 'number', value: level.listPosition ? String(level.listPosition) : '', maxlength: 4 }, { id: 'points', label: 'Custom Extreme Points (empty = automatic from position)', type: 'number', value: level.listPosition ? String(level.listPoints || '') : '', maxlength: 6 }], okText: 'Save'
  });
  if (!r) return;
  try {
    const pos = String(r.position).trim();
    await apiRequest('/api/admin/levels/' + encodeURIComponent(level.id) + '/list', { method: 'PATCH', auth: true, body: { position: pos === '' ? null : Number(pos), points: pos === '' || String(r.points).trim() === String(level.listPoints || '') ? undefined : (String(r.points).trim() === '' ? null : Number(r.points)) } });
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
      { value: 'history', label: '📜 View history' }, { value: 'warn', label: '⚠ Send a warning' }, { value: 'ban', label: '🚫 Ban for a while' },
      ...(p.banned ? [{ value: 'unban', label: '✔ Lift the ban' }] : []),
      ...(p.owner ? [] : p.isAdmin ? [{ value: 'demote', label: '🛡 Remove admin (owners only)' }] : [{ value: 'promote', label: '🛡 Make admin' }]),
      { value: 'reset', label: '🗑 Remove all their stats' }, ...adminExtraOptions(p)] }], okText: 'Next'
  });
  if (!r) return;
  try {
    if (await adminExtraAction(r.action, p)) return;
    if (r.action === 'history') await adminShowHistory(p);
    else if (r.action === 'warn') await adminWarn(p);
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


// ---------------------------------------------------------------------------
// v4 browse features: progress, daily level, filters, per-level leaderboard, comments, reports, versions, practice
// ---------------------------------------------------------------------------
let myProgress = {}, browseTag = '', browseDiff = '';
async function loadMyProgress() {
  if (!getAuthToken() || !API_BASE_URL) { myProgress = {}; return; }
  try { const d = await apiRequest('/api/my/progress', { auth: true }); myProgress = {}; (d.progress || []).forEach(p => { myProgress[p.levelId] = p; }); } catch (e) {}
}
loadMyProgress();

function renderLevelCard(level, source) {
  const card = renderLevelCardBase(level, source);
  const info = card.querySelector('.song-info');
  const pr = level.id && myProgress[level.id];
  if (info) {
    const extra = [];
    if (level.strictMode) extra.push('<span class="feat strict">STRICT</span>');
    if (level.hasAudio) extra.push('<span class="tag">🎵 music</span>');
    (level.tags || []).forEach(t => extra.push('<span class="tag">' + escapeHtml(t) + '</span>'));
    if (pr) extra.push('<span class="best-pct' + (pr.completed ? ' done' : '') + '">' + (pr.completed ? '✔ 100%' : 'Best ' + pr.bestPct + '%') + '</span>');
    if (extra.length) info.insertAdjacentHTML('beforeend', '<div class="song-meta">' + extra.join('') + '</div>');
  }
  return card;
}

function levelFilterHtml() {
  const tags = ['speed', 'chords', 'holds', 'memory', 'tech', 'long', 'short', 'jumps', 'streams', 'strict', 'beginner'];
  return '<div class="level-filters"><select onchange="browseDiff=this.value;renderBrowseLevels()"><option value="">All difficulties</option>' +
    ['Easy', 'Normal', 'Hard', 'Insane', 'Extreme'].map(d => '<option' + (browseDiff === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
    '<select onchange="browseTag=this.value;renderBrowseLevels()"><option value="">All tags</option>' + tags.map(t => '<option' + (browseTag === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
}
async function getFilteredLevels(search, tab) {
  const qs = '?search=' + encodeURIComponent(search || '') + '&tab=' + encodeURIComponent(tab) + (browseTag ? '&tag=' + encodeURIComponent(browseTag) : '') + (browseDiff ? '&difficulty=' + encodeURIComponent(browseDiff) : '');
  return apiRequest('/api/levels' + qs);
}

async function renderDailyBanner() {
  const host = document.getElementById('daily-banner'); if (!host || !API_BASE_URL) return;
  try {
    const d = await apiRequest('/api/daily', { auth: !!getAuthToken() });
    if (!d.level) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="panel daily"><div><div class="section-title">DAILY LEVEL</div><div class="hero-name">${escapeHtml(d.level.name)}</div><div class="hero-sub">${d.claimed ? '✔ Bonus claimed today' : 'Beat it today for +' + d.bonusStars + ' ★ bonus stars'}</div></div><button class="btn btn-play" id="daily-play">PLAY</button></div>`;
    document.getElementById('daily-play').onclick = () => openLevelDetail(d.level, 'community');
  } catch (e) { host.innerHTML = ''; }
}

async function practiceLevel(level) {
  try {
    const full = level.data ? level : await getCommunityLevel(level.id);
    const last = (full.data || []).reduce((m, n) => Math.max(m, n.time), 0);
    const v = await uiPrompt('Start from what percent of the level? (0-95). Checkpoints are set every 10%, or press C. Practice runs don\'t count for stats.', '0', 'Start');
    if (v === null) return;
    const pct = Math.max(0, Math.min(95, Number(v) || 0));
    practiceArmed = true; practiceStartSec = last * pct / 100; practiceBaseSec = practiceStartSec; practiceCheckpoints = [];
    levelDetailReturnTo = 'browse-levels-menu';
    startGame(full.name, true, -1, full.data, full.effects || [], true, full);
  } catch (e) { toast(e.message, 'bad'); }
}

async function openLevelBoard(level) {
  const screen = body => { document.getElementById('level-detail-menu').innerHTML = screenHtml('LEADERBOARD', null, body); document.getElementById('level-detail-menu').querySelector('.back-btn').onclick = () => openLevelDetail(level, 'community', levelDetailReturnTo === 'admin-panel'); toggleMenu('level-detail-menu'); };
  screen('<div class="empty">Loading…</div>');
  try {
    const d = await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/leaderboard');
    screen('<div class="hero-name">' + escapeHtml(level.name) + '</div>' + (d.entries.length ? '<div class="song-list">' + d.entries.map((e, i) => `<div class="song-row player-row"><div class="song-art ${frameClass(e)}" style="${e.profileIcon ? '' : 'background:' + artGradient(e.username)}">${e.profileIcon ? '<img src="' + escapeHtml(e.profileIcon) + '" alt="">' : escapeHtml(e.username.slice(0, 1).toUpperCase())}</div><div class="song-info"><div class="song-title"><span class="rank">#${i + 1}</span> ${escapeHtml(e.username)}</div><div class="song-sub">Score ${Number(e.score).toLocaleString()}</div></div><div class="player-value">${e.completed ? '✔ 100%' : e.pct + '%'}</div></div>`).join('') + '</div>' : '<div class="empty">Nobody has played this yet.</div>'));
  } catch (e) { screen(errorBox(e.message, 'void 0')); }
}

async function openComments(level) {
  const render = async () => {
    const me = getAuthUser();
    const el = document.getElementById('level-detail-menu');
    let list = [];
    try { list = (await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/comments')).comments; } catch (e) {}
    el.innerHTML = screenHtml('COMMENTS', null, `<div class="hero-name">${escapeHtml(level.name)}</div>
      ${me ? '<div class="searchbar"><input id="comment-input" maxlength="300" placeholder="Write a comment…" onkeydown="if(event.key===\'Enter\')document.getElementById(\'comment-post\').click()"><button class="btn small btn-play" id="comment-post">Post</button></div>' : '<div class="note center">Log in to comment.</div>'}
      <div class="comment-list">${list.length ? list.map(c => `<div class="comment"><div><b>${escapeHtml(c.username)}</b> <small>${timeAgo(c.createdAt)}</small></div><div>${escapeHtml(c.text)}</div>${me && (me.isAdmin || me.id === c.userId) ? '<button class="btn small btn-danger" data-del="' + c.id + '">Delete</button>' : ''}</div>`).join('') : '<div class="empty">No comments yet.</div>'}</div>`);
    el.querySelector('.back-btn').onclick = () => openLevelDetail(level, 'community', levelDetailReturnTo === 'admin-panel');
    const post = document.getElementById('comment-post');
    if (post) post.onclick = async () => { const t = document.getElementById('comment-input').value.trim(); if (!t) return; try { await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/comments', { method: 'POST', auth: true, body: { text: t } }); render(); } catch (e) { toast(e.message, 'bad'); } };
    el.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => { try { await apiRequest('/api/comments/' + b.dataset.del, { method: 'DELETE', auth: true }); render(); } catch (e) { toast(e.message, 'bad'); } }; });
  };
  toggleMenu('level-detail-menu'); render();
}

async function reportDialog(kind, target) {
  if (!getAuthToken()) { toast('Log in to report.', 'bad'); return; }
  const r = await openFormDialog({ title: kind === 'level' ? 'Report "' + target.name + '"' : 'Report ' + target.username, message: 'The admins will take a look.', fields: [{ id: 'reason', label: 'What\'s wrong?', type: 'textarea', rows: 3, maxlength: 300, value: '' }], okText: 'Send report', danger: true });
  if (!r || !r.reason.trim()) return;
  try { await apiRequest('/api/reports', { method: 'POST', auth: true, body: kind === 'level' ? { kind, levelId: target.id, reason: r.reason } : { kind, username: target.username, reason: r.reason } }); toast('Report sent. Thanks!', 'good'); }
  catch (e) { toast(e.message, 'bad'); }
}

async function openVersions(level) {
  try {
    const d = await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/versions', { auth: true });
    const el = document.getElementById('level-detail-menu');
    el.innerHTML = screenHtml('VERSIONS', null, `<div class="hero-name">${escapeHtml(level.name)}</div><div class="note center">Every update keeps the previous version (last 10). Roll back to undo a bad update.</div>` +
      (d.versions.length ? '<div class="song-list">' + d.versions.map(v => `<div class="song-row"><div class="song-info"><div class="song-title">${escapeHtml(v.name)}</div><div class="song-sub">${new Date(v.savedAt).toLocaleString()} · ${v.tiles} tiles</div></div><button class="btn small" data-v="${v.id}">Roll back</button><button class="btn small btn-danger" data-dv="${v.id}">✕</button></div>`).join('') + '</div>' : '<div class="empty">No older versions yet.</div>'));
    el.querySelector('.back-btn').onclick = () => openLevelDetail(level, 'mine-online');
    el.querySelectorAll('[data-dv]').forEach(b => { b.onclick = async () => { try { await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/versions/' + b.dataset.dv, { method: 'DELETE', auth: true }); openVersions(level); } catch (e) { toast(e.message, 'bad'); } }; });
    el.querySelectorAll('[data-v]').forEach(b => { b.onclick = async () => {
      if (!(await uiConfirm('Roll the public level back to this version? The current one is kept as a version too.', 'Roll back', true))) return;
      try { await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/rollback', { method: 'POST', auth: true, body: { versionId: Number(b.dataset.v) } }); toast('Rolled back.', 'good'); openVersions(level); } catch (e) { toast(e.message, 'bad'); } }; });
    toggleMenu('level-detail-menu');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
async function sendFriendRequest(username) {
  try { const d = await apiRequest('/api/friends/request', { method: 'POST', auth: true, body: { username } }); toast(d.accepted ? 'You are now friends!' : 'Friend request sent.', 'good'); if (!document.getElementById('friends-menu').classList.contains('hidden')) openFriends(); }
  catch (e) { toast(e.message, 'bad'); }
}
async function openFriends() {
  if (!getAuthToken()) { toast('Log in to use friends.', 'bad'); return; }
  const el = document.getElementById('friends-menu');
  el.innerHTML = screenHtml('FRIENDS', "toggleMenu('main-menu')", '<div class="empty">Loading…</div>');
  toggleMenu('friends-menu');
  try {
    const d = await apiRequest('/api/friends', { auth: true });
    const incoming = d.friends.filter(f => f.state === 'incoming'), friends = d.friends.filter(f => f.state === 'friend').sort((a, b) => b.online - a.online), outgoing = d.friends.filter(f => f.state === 'outgoing');
    const row = (f, actions) => `<div class="song-row"><div class="song-art ${frameClass(f)}" style="${f.profileIcon ? '' : 'background:' + artGradient(f.username)}">${f.profileIcon ? '<img src="' + escapeHtml(f.profileIcon) + '" alt="">' : escapeHtml(f.username.slice(0, 1).toUpperCase())}</div><div class="song-info"><div class="song-title">${escapeHtml(f.username)}</div><div class="song-sub">${f.state === 'friend' ? '<span class="presence-dot ' + (f.online ? (f.status === 'lobby' ? '' : 'busy') : 'off') + '"></span>' + (f.online ? (f.status === 'lobby' ? 'Online' : 'In a match') : 'Offline') : f.state === 'outgoing' ? 'Request sent' : 'Wants to be friends'}</div></div><div class="admin-actions">${actions}</div></div>`;
    el.innerHTML = screenHtml('FRIENDS', "toggleMenu('main-menu')", `<div class="searchbar"><input id="friend-input" maxlength="20" placeholder="Add a friend by username…" onkeydown="if(event.key==='Enter')sendFriendRequest(this.value.trim())"><button class="btn small btn-play" onclick="sendFriendRequest(document.getElementById('friend-input').value.trim())">Add</button></div>` +
      (incoming.length ? '<div class="section-title">REQUESTS</div><div class="song-list">' + incoming.map(f => row(f, `<button class="btn small" onclick="respondFriend('${f.userId}',true)">Accept</button><button class="btn small btn-ghost" onclick="respondFriend('${f.userId}',false)">Decline</button>`)).join('') + '</div>' : '') +
      '<div class="section-title">FRIENDS</div><div class="song-list">' + (friends.length ? friends.map(f => row(f, (f.online && f.status === 'lobby' ? `<button class="btn small btn-play" onclick="challengeFriend('${f.socketId}','${escapeHtml(f.username)}')">Challenge</button>` : '') + `<button class="btn small btn-ghost" onclick="removeFriend('${f.userId}')">✕</button>`)).join('') : '<div class="empty">No friends yet. Add someone by username.</div>') + '</div>' +
      (outgoing.length ? '<div class="section-title">SENT</div><div class="song-list">' + outgoing.map(f => row(f, `<button class="btn small btn-ghost" onclick="removeFriend('${f.userId}')">Cancel</button>`)).join('') + '</div>' : ''));
  } catch (e) { el.innerHTML = screenHtml('FRIENDS', "toggleMenu('main-menu')", errorBox(e.message, 'openFriends()')); }
}
async function respondFriend(userId, accept) { try { await apiRequest('/api/friends/respond', { method: 'POST', auth: true, body: { userId, accept } }); openFriends(); } catch (e) { toast(e.message, 'bad'); } }
async function removeFriend(userId) { try { await apiRequest('/api/friends/' + userId, { method: 'DELETE', auth: true }); openFriends(); } catch (e) { toast(e.message, 'bad'); } }
async function challengeFriend(socketId, name) {
  await connectBattle();
  battlePickTarget = { id: socketId, name };
  openBattleLevelPicker();
}

// ---------------------------------------------------------------------------
// Shared levels (collab + verifier)
// ---------------------------------------------------------------------------
async function openShared() {
  if (!getAuthToken()) { toast('Log in to use shared levels.', 'bad'); return; }
  const el = document.getElementById('shared-menu');
  el.innerHTML = screenHtml('SHARED LEVELS', "toggleMenu('my-levels-menu')", '<div class="empty">Loading…</div>');
  toggleMenu('shared-menu');
  try {
    const d = await apiRequest('/api/drafts', { auth: true });
    el.innerHTML = screenHtml('SHARED LEVELS', "openMyLevels()", '<div class="note center">Levels you share (from the editor menu: 👥 Collab) or that others shared with you. A set verifier has to beat the level before the owner can publish it.</div>' +
      (d.drafts.length ? '<div class="song-list">' + d.drafts.map(x => `<div class="song-row"><div class="song-art" style="background:${artGradient(x.name)}">♪</div><div class="song-info"><div class="song-title">${escapeHtml(x.name)}</div><div class="song-sub">by ${escapeHtml(x.owner)} · you are ${x.role} · ${x.tileCount} tiles · v${x.rev}</div><div class="song-meta">${x.verifier ? '<span class="tag">verifier: ' + escapeHtml(x.verifier) + '</span>' : ''}${x.verified ? '<span class="feat">✔ VERIFIED' + (x.verifiedBy ? ' by ' + escapeHtml(x.verifiedBy) : '') + '</span>' : '<span class="tag">not verified</span>'}${x.published ? '<span class="tag">published</span>' : ''}</div></div><div class="admin-actions">${x.verified && x.role !== 'editor' ? `<button class="btn small btn-ghost" onclick="unverifyDraft('${x.id}')">Unverify</button>` : ''}<button class="btn small btn-play" onclick="openDraft('${x.id}')">${x.role === 'verifier' ? 'Verify' : 'Open'}</button>${x.role === 'owner' ? `<button class="btn small btn-danger" onclick="deleteDraft('${x.id}')">✕</button>` : ''}</div></div>`).join('') + '</div>' : '<div class="empty">Nothing shared yet.</div>'));
  } catch (e) { el.innerHTML = screenHtml('SHARED LEVELS', "openMyLevels()", errorBox(e.message, 'openShared()')); }
}
async function openDraft(id) {
  try {
    toast('Opening…');
    const d = await apiRequest('/api/drafts/' + id, { auth: true });
    currentDraft = { id: d.draft.id, rev: d.draft.rev, role: d.draft.role, verifier: d.draft.verifier, verified: d.draft.verified };
    currentEditingId = null; currentEditingOnlineId = null;
    startEditor(Object.assign({}, d.level, { _draft: true }));
    currentEditingName = d.draft.name;
    if (d.draft.role === 'verifier') { toast('Play it through to verify it.'); setTimeout(() => startLevelVerification(), 150); }
  } catch (e) { toast(e.message, 'bad'); }
}
async function deleteDraft(id) {
  if (!(await uiConfirm('Delete this shared level for everyone on it?', 'Delete', true))) return;
  try { await apiRequest('/api/drafts/' + id, { method: 'DELETE', auth: true }); openShared(); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Admin extras: alert types, player history
// ---------------------------------------------------------------------------
const ALERT_ICONS = { five_star: '⭐', level_updated: '✎', report: '⚑', report_player: '⚑', suspicious: '🕵', auto_flag: '🚩' };
function adminOpenPlayer(name) { adminPlayerSearch = name; loadAdminPanel('players'); }
async function adminShowHistory(p) {
  try {
    const d = await apiRequest('/api/admin/players/' + p.id + '/history', { auth: true });
    const lines = d.history.map(h => new Date(h.at).toLocaleString() + ' · ' + h.admin + ' · ' + h.action + (h.detail ? ' - ' + h.detail : ''));
    await uiAlert(p.username + ': ' + d.reports + ' reports against them, ' + d.flags + ' suspicious-result flags.\n\n' + (lines.length ? lines.join('\n') : 'No moderation history.'), 'History');
  } catch (e) { toast(e.message, 'bad'); }
}

async function unverifyDraft(id) { try { await apiRequest('/api/drafts/' + id + '/unverify', { method: 'POST', auth: true, body: {} }); toast('Verification cleared.'); openShared(); } catch (e) { toast(e.message, 'bad'); } }

// ---------------------------------------------------------------------------
// MORE ADMIN: reports, audit log, settings, broadcast, player + level tools
// ---------------------------------------------------------------------------
async function adminReportsHtml() {
  const d = await apiRequest('/api/admin/reports', { auth: true });
  if (!d.reports.length) return '<div class="empty">No reports.</div>';
  return '<div class="song-list">' + d.reports.map(r => `<div class="song-row admin-row ${r.handled ? 'read' : 'unread'}"><div class="song-art" style="background:${artGradient(r.reason)}">⚑</div>
    <div class="song-info"><div class="song-title">${escapeHtml(r.reporter || '?')} → ${r.kind === 'level' ? 'level "' + escapeHtml(r.levelName || '?') + '"' : escapeHtml(r.target || '?')}</div><div class="song-sub">${escapeHtml(r.reason)} · ${timeAgo(r.createdAt)}</div></div>
    <div class="admin-actions">${r.levelId ? `<button class="btn small" onclick="adminViewLevel('${r.levelId}')">View</button>` : ''}${r.target ? `<button class="btn small" onclick="adminOpenPlayer('${escapeHtml(r.target)}')">Player</button>` : ''}${r.handled ? '' : `<button class="btn small btn-ghost" onclick="adminHandleReport(${r.id})">Handled</button>`}</div></div>`).join('') + '</div>';
}
async function adminHandleReport(id) { try { await apiRequest('/api/admin/reports/' + id + '/handle', { method: 'POST', auth: true, body: {} }); loadAdminPanel('reports'); } catch (e) { toast(e.message, 'bad'); } }
async function adminLogHtml() {
  const d = await apiRequest('/api/admin/log', { auth: true });
  if (!d.log.length) return '<div class="empty">Nothing logged yet.</div>';
  return '<div class="song-list">' + d.log.map(l => `<div class="song-row"><div class="song-info"><div class="song-title">${escapeHtml(l.admin)} · ${escapeHtml(l.action)}</div><div class="song-sub">${escapeHtml(l.target)}${l.detail ? ' - ' + escapeHtml(l.detail) : ''} · ${timeAgo(l.at)}</div></div></div>`).join('') + '</div>';
}
async function adminSettingsHtml() {
  const s = (await apiRequest('/api/admin/settings', { auth: true })).settings;
  return `<div class="panel"><div class="section-title">GAME SETTINGS</div>
    <label class="form-label">Max BPM in the editor</label><input id="as-maxbpm" class="form-input" type="number" min="60" max="2000" value="${s.maxBpm}">
    <label class="form-label">List: Extreme Points for #1 (default 250)</label><input id="as-listmax" class="form-input" type="number" min="5" max="5000" value="${s.listMaxPoints || 250}">
    <label class="form-label">Daily level bonus stars</label><input id="as-daily" class="form-input" type="number" min="0" max="50" value="${s.dailyBonusStars}">
    <label class="form-label">Announcement banner (shown to everyone, empty = none)</label><textarea id="as-ann" class="form-input" rows="2" maxlength="300">${escapeHtml(s.announcement || '')}</textarea>
    <div class="settings-row"><span>Comments open</span><input type="checkbox" id="as-comments" ${s.commentsOpen ? 'checked' : ''}></div>
    <div class="settings-row"><span>New registrations open</span><input type="checkbox" id="as-reg" ${s.registrationOpen ? 'checked' : ''}></div>
    <button class="btn btn-play" onclick="adminSaveSettings()">Save settings</button></div>
    <div class="panel"><div class="section-title">TOOLS</div><button class="btn btn-ghost" onclick="adminBroadcast()">📢 Popup message to everyone online</button><button class="btn btn-ghost" onclick="adminClearDaily()">↺ Back to the automatic daily level</button></div>`;
}
async function adminSaveSettings() {
  try {
    await apiRequest('/api/admin/settings', { method: 'PUT', auth: true, body: { listMaxPoints: Number(document.getElementById('as-listmax').value), maxBpm: Number(document.getElementById('as-maxbpm').value), dailyBonusStars: Number(document.getElementById('as-daily').value), announcement: document.getElementById('as-ann').value, commentsOpen: document.getElementById('as-comments').checked, registrationOpen: document.getElementById('as-reg').checked } });
    toast('Settings saved.', 'good'); loadAppSettings();
  } catch (e) { toast(e.message, 'bad'); }
}
async function adminBroadcast() {
  const r = await openFormDialog({ title: 'Broadcast', message: 'Pops up on the screen of everyone who is online right now.', fields: [{ id: 'message', label: 'Message', type: 'textarea', rows: 3, maxlength: 300, value: '' }], okText: 'Send' });
  if (!r || !r.message.trim()) return;
  try { const d = await apiRequest('/api/admin/broadcast', { method: 'POST', auth: true, body: { message: r.message.trim() } }); toast('Sent to ' + d.recipients + ' online.', 'good'); } catch (e) { toast(e.message, 'bad'); }
}
async function adminClearDaily() { try { await apiRequest('/api/admin/daily', { method: 'POST', auth: true, body: { levelId: null } }); toast('Daily level is automatic again.', 'good'); } catch (e) { toast(e.message, 'bad'); } }
async function adminMakeDaily(id) { try { await apiRequest('/api/admin/daily', { method: 'POST', auth: true, body: { levelId: id } }); toast('That level is today\'s daily level.', 'good'); } catch (e) { toast(e.message, 'bad'); } }
async function adminRemoveAudio(id) {
  if (!(await uiConfirm('Remove the music from this level?', 'Remove music', true))) return;
  try { await apiRequest('/api/admin/levels/' + id + '/audio', { method: 'PATCH', auth: true, body: {} }); toast('Music removed.', 'good'); loadAdminPanel('levels'); } catch (e) { toast(e.message, 'bad'); }
}
async function adminEditLevel(id) {
  const l = adminLevelCache[id]; if (!l) return;
  const r = await openFormDialog({ title: 'Edit "' + l.name + '"', fields: [{ id: 'name', label: 'Name', type: 'text', value: l.name, maxlength: 80 }, { id: 'tags', label: 'Tags (comma separated)', type: 'text', value: (l.tags || []).join(', '), maxlength: 100 }], okText: 'Save' });
  if (!r) return;
  try { await apiRequest('/api/admin/levels/' + id + '/edit', { method: 'PATCH', auth: true, body: { name: r.name, tags: r.tags.split(',').map(t => t.trim()).filter(Boolean) } }); toast('Saved.', 'good'); loadAdminPanel('levels'); } catch (e) { toast(e.message, 'bad'); }
}
function adminExtraOptions(p) {
  return [{ value: 'impersonate', label: '👤 Log in as this player' }, { value: 'removestats', label: '🧹 Remove specific stats…' }, { value: 'rename', label: '✎ Rename player' }, p.muted ? { value: 'unmute', label: '🔊 Unmute' } : { value: 'mute', label: '🔇 Mute (no comments/publishing)' },
    { value: 'stars', label: '★ Give / take bonus stars' }, ...(p.owner ? [] : [{ value: 'password', label: '🔑 Set a new password' }]),
    { value: 'dellevels', label: '🗑 Delete all their levels' }, ...(p.isAdmin ? [] : [{ value: 'delaccount', label: '☠ Delete account' }])];
}
async function adminExtraAction(action, p) {
  const post = (path, body, ok) => apiRequest('/api/admin/players/' + p.id + path, { method: 'POST', auth: true, body }).then(() => { toast(ok, 'good'); loadAdminPanel('players'); });
  if (action === 'impersonate') { startImpersonation(p.id, p.username); return true; }
  if (action === 'removestats') { await adminRemoveStats(p); return true; }
  if (action === 'rename') { const r = await openFormDialog({ title: 'Rename ' + p.username, fields: [{ id: 'u', label: 'New username', type: 'text', value: p.username, maxlength: 20 }], okText: 'Rename' }); if (r) await post('/username', { username: r.u.trim() }, 'Renamed.'); return true; }
  if (action === 'unmute') { await post('/mute', { unmute: true }, 'Unmuted.'); return true; }
  if (action === 'mute') {
    const r = await openFormDialog({ title: 'Mute ' + p.username, message: 'Muted players can\'t comment or publish levels.', fields: [{ id: 'amount', label: 'Length', type: 'number', value: '1', maxlength: 6 }, { id: 'unit', label: 'Unit', type: 'select', value: 'days', options: [{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'perm', label: 'Permanent' }] }], okText: 'Mute', danger: true });
    if (r) { const per = { minutes: 1, hours: 60, days: 1440 }; await post('/mute', r.unit === 'perm' ? { permanent: true } : { minutes: Math.round(Number(r.amount) * per[r.unit]) }, 'Muted.'); }
    return true;
  }
  if (action === 'stars') { const r = await openFormDialog({ title: 'Bonus stars for ' + p.username, message: 'Positive adds stars, negative removes them.', fields: [{ id: 'd', label: 'Amount', type: 'number', value: '5', maxlength: 5 }], okText: 'Apply' }); if (r) await post('/stars', { delta: Number(r.d) }, 'Stars updated.'); return true; }
  if (action === 'password') { const r = await openFormDialog({ title: 'New password for ' + p.username, message: 'They can log in with it right away. Tell them to change it.', fields: [{ id: 'pw', label: 'New password (8+ characters)', type: 'text', value: '', maxlength: 128 }], okText: 'Set password' }); if (r) await post('/password', { password: r.pw }, 'Password set.'); return true; }
  if (action === 'dellevels') { if (await uiConfirm('Delete ALL of ' + p.username + '\'s levels? This can\'t be undone.', 'Delete levels', true)) await post('/delete-levels', {}, 'Levels deleted.'); return true; }
  if (action === 'delaccount') { if (await uiConfirm('Permanently delete ' + p.username + '\'s account and everything on it?', 'Delete account', true)) { await apiRequest('/api/admin/players/' + p.id, { method: 'DELETE', auth: true }); toast('Account deleted.', 'good'); loadAdminPanel('players'); } return true; }
  return false;
}


// ---- admin: unpublished (cloud-synced) levels, remove specific stats ----
let adminUnpubCache = {};
async function adminUnpubHtml() {
  const d = await apiRequest('/api/admin/unpublished', { auth: true });
  adminUnpubCache = {}; (d.levels || []).forEach(l => { adminUnpubCache[l.id] = l; });
  return '<div class="note">Levels players have saved but not published. Play one to check it, then publish it for them (it goes live under their name).</div><div class="song-list">' + ((d.levels || []).length ? d.levels.map(l => `
    <div class="song-row admin-row"><div class="song-art" style="background:${artGradient(l.name)}">♪</div>
      <div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.owner)} · ${l.tileCount} tiles · ${timeAgo(l.updatedAt)}</div></div>
      <div class="admin-actions"><button class="btn small" onclick="adminUnpubPlay(${l.id})">▶ Play</button><button class="btn small btn-play" onclick="adminUnpubPublish(${l.id})">Publish</button><button class="btn small btn-danger" onclick="adminUnpubDelete(${l.id})">🗑</button></div></div>`).join('') : '<div class="empty">Nothing waiting.</div>') + '</div>';
}
async function adminUnpubPlay(id) {
  try {
    const d = await apiRequest('/api/admin/unpublished/' + id, { auth: true });
    const lvl = Object.assign({}, d.level, { id: 'unpub-' + id, author: d.owner });
    startGame(lvl.name, true, -1, lvl.data, lvl.effects || [], true, lvl);
  } catch (e) { toast(e.message, 'bad'); }
}
async function adminUnpubPublish(id) {
  const l = adminUnpubCache[id]; if (!l) return;
  if (!(await uiConfirm('Publish "' + l.name + '" as ' + l.owner + '? (Music files stay on their device; library songs carry over.)', 'Publish'))) return;
  try { await apiRequest('/api/admin/unpublished/' + id + '/publish', { method: 'POST', auth: true, body: {} }); toast('Published.', 'good'); loadAdminPanel('unpub'); } catch (e) { toast(e.message, 'bad'); }
}
async function adminUnpubDelete(id) {
  if (!(await uiConfirm('Remove this saved copy? (The player still has it on their device.)', 'Remove', true))) return;
  try { await apiRequest('/api/admin/unpublished/' + id, { method: 'DELETE', auth: true }); loadAdminPanel('unpub'); } catch (e) { toast(e.message, 'bad'); }
}
async function adminRemoveStats(p) {
  let lv = [];
  try { lv = (await apiRequest('/api/admin/players/' + p.id + '/completions', { auth: true })).levels || []; } catch (e) {}
  const fields = [
    ['games_played', 'Games played'], ['games_completed', 'Games completed'], ['total_score', 'Total score'], ['best_score', 'Best score'], ['total_notes_hit', 'Notes hit'],
    ['battle', 'Battle wins / losses'], ['bonus_stars', 'Bonus stars'], ['elo', 'Elo'], ['flags', 'Flags'], ['completions', 'ALL level completions (stars, difficulty, extreme points)'], ['records', 'Level records'], ['daily', 'Daily claims']
  ].map(([id, label]) => ({ id, label, type: 'checkbox', value: false }));
  if (lv.length) fields.push({ id: 'levelId', label: 'Or remove just one beaten level', type: 'select', value: '', options: [{ value: '', label: '— none —' }].concat(lv.map(l => ({ value: l.id, label: l.name + ' (' + l.author + ')' }))) });
  const r = await openFormDialog({ title: 'Remove stats: ' + p.username, message: 'Tick what to wipe. This can\'t be undone.', fields, okText: 'Remove', danger: true });
  if (!r) return;
  const picked = fields.filter(f => f.type === 'checkbox' && r[f.id]).map(f => f.id);
  if (!picked.length && !r.levelId) { toast('Nothing ticked.'); return; }
  try { await apiRequest('/api/admin/players/' + p.id + '/remove-stats', { method: 'POST', auth: true, body: { fields: picked, levelId: r.levelId || undefined } }); toast('Removed.', 'good'); loadAdminPanel('players'); } catch (e) { toast(e.message, 'bad'); }
}
