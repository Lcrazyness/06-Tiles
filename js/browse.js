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
    if (!levels.length) { list.innerHTML = '<div class="empty">No levels yet.<br>Tap <b>＋ New</b> to make one.' + (getAuthToken() ? '<br><br><button class="btn btn-ghost small" onclick="restoreLostLevels(true)">♻ Bring back my saved levels</button>' : '<br><br>Log in to bring back levels saved on your account.') + '</div>'; return; }
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
    ${online ? '<button class="btn btn-ghost" id="detail-practice">🎯 Practice (checkpoints)</button><button class="btn btn-ghost" id="detail-board">🏆 Level leaderboard</button><button class="btn btn-ghost" id="detail-comments">💬 Comments</button><button class="btn btn-ghost" id="detail-addpack">＋ Playlist / pack</button><button class="btn btn-ghost" id="detail-report">⚑ Report</button>' : ''}
    ${(source === 'mine-online' || (isAdminUser() && source !== 'local')) && level.id ? '<button class="btn btn-ghost" id="detail-stats">📊 Stats + death heatmap</button>' : ''}
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
  if (q('detail-addpack')) q('detail-addpack').onclick = () => addToPackDialog(level);
  if (q('detail-report')) q('detail-report').onclick = () => reportDialog('level', level);
  if (q('detail-versions')) q('detail-versions').onclick = () => openVersions(level);
  if (q('detail-stats')) q('detail-stats').onclick = () => openLevelStats(level);
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
    modal.innerHTML = screenHtml('ADMIN', null, `<div class="tabs admin-tabs wrap">${tb('alerts', 'Alerts' + (unread ? ' (' + unread + ')' : ''))}${tb('reports', 'Reports' + (overview && overview.pendingReports ? ' (' + overview.pendingReports + ')' : ''))}${tb('levels', 'Levels')}${tb('unpub', 'Unpublished')}${tb('device', 'Device')}${tb('backup', 'Backup')}${tb('players', 'Players')}${tb('log', 'Log')}${tb('settings', 'Settings')}</div>` + inner, '<button class="btn small" onclick="loadAdminPanel()">↻</button>');
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
    else if (adminTab === 'device') draw(await adminDeviceHtml(), overview);
    else if (adminTab === 'backup') draw(await adminBackupHtml(), overview);
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
    screen('<div class="hero-name">' + escapeHtml(level.name) + '</div>' + (d.entries.length ? '<div class="song-list">' + d.entries.map((e, i) => `<div class="song-row player-row"><div class="song-art ${frameClass(e)}" style="${e.profileIcon ? '' : 'background:' + artGradient(e.username)}">${e.profileIcon ? '<img src="' + escapeHtml(e.profileIcon) + '" alt="">' : escapeHtml(e.username.slice(0, 1).toUpperCase())}</div><div class="song-info"><div class="song-title"><span class="rank">#${i + 1}</span> ${escapeHtml(e.username)}</div><div class="song-sub">Score ${Number(e.score).toLocaleString()}</div></div><div class="player-value">${e.completed ? '✔ 100%' : e.pct + '%'}</div>${e.hasReplay ? '<div class="admin-actions"><button class="btn small" data-rp="watch" data-u="' + escapeHtml(e.username) + '" title="Watch their replay">▶</button><button class="btn small btn-play" data-rp="race" data-u="' + escapeHtml(e.username) + '" title="Race their ghost">👻</button></div>' : ''}</div>`).join('') + '</div>' : '<div class="empty">Nobody has played this yet.</div>'));
    document.querySelectorAll('#level-detail-menu [data-rp]').forEach(b => b.onclick = async () => {
      try {
        const g = (await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/ghost?who=' + encodeURIComponent(b.dataset.u))).ghost;
        if (b.dataset.rp === 'watch') { const full = level.data ? level : await getCommunityLevel(level.id); levelDetailReturnTo = 'browse-levels-menu'; startReplayWatch(full, g); }
        else { ghostPick = { id: level.id, ghost: g }; toast('Racing ' + g.username + '\'s ghost. Press Play!', 'good'); }
      } catch (e) { toast(e.message, 'bad'); }
    });
  } catch (e) { screen(errorBox(e.message, 'void 0')); }
}

let commentSort = 'top';
async function openComments(level) {
  let replyTo = null, draft = '';
  const lvId = encodeURIComponent(level.id);
  const render = async (keepScroll) => {
    const me = getAuthUser();
    const el = document.getElementById('level-detail-menu');
    const oldBody = el.querySelector('.screen-body'), scrollTop = oldBody && keepScroll ? oldBody.scrollTop : 0;
    const prev = document.getElementById('comment-input'); if (prev) draft = prev.value;
    let list = [], authorId = null;
    try { const d = await apiRequest('/api/levels/' + lvId + '/comments', { auth: !!me }); list = d.comments || []; authorId = d.levelAuthorId; } catch (e) {}
    const canManage = !!me && (me.isAdmin || (authorId && me.id === authorId));
    const tops = list.filter(c => !c.parentId);
    const kids = {}; list.filter(c => c.parentId).forEach(c => (kids[c.parentId] = kids[c.parentId] || []).push(c));
    Object.values(kids).forEach(a => a.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt)));
    tops.sort((x, y) => (y.pinned - x.pinned) || (commentSort === 'top' ? (y.likes - x.likes) || (new Date(y.createdAt) - new Date(x.createdAt)) : new Date(y.createdAt) - new Date(x.createdAt)));
    const row = (c, isReply) => {
      const badges = (c.isAuthor ? '<span class="cbadge creator">CREATOR</span>' : '') + (c.isAdmin ? '<span class="cbadge admin">ADMIN</span>' : '') + (c.pinned ? '<span class="cbadge pin">📌 PINNED</span>' : '');
      const mine = me && (me.isAdmin || me.id === c.userId || (authorId && me.id === authorId));
      return `<div class="comment${isReply ? ' reply' : ''}${c.pinned ? ' pinned' : ''}">
        <div class="c-avatar" style="background:${artGradient(c.username)}">${escapeHtml(c.username.slice(0, 1).toUpperCase())}</div>
        <div class="c-main">
          <div class="c-head"><b>${escapeHtml(c.username)}</b>${badges}<small>${timeAgo(c.createdAt)}</small></div>
          <div class="c-text">${escapeHtml(c.text)}</div>
          <div class="c-actions">
            <button class="c-btn${c.liked ? ' on' : ''}" data-like="${c.id}">${c.liked ? '❤️' : '🤍'} ${c.likes || ''}</button>
            ${me && !isReply ? '<button class="c-btn" data-reply="' + c.id + '">↩ Reply</button>' : ''}
            ${canManage && !isReply ? '<button class="c-btn" data-pin="' + c.id + '">' + (c.pinned ? 'Unpin' : '📌 Pin') + '</button>' : ''}
            ${mine ? '<button class="c-btn del" data-del="' + c.id + '">🗑</button>' : ''}
          </div>
        </div></div>`;
    };
    const replyBanner = replyTo ? `<div class="reply-banner">Replying to <b>${escapeHtml(replyTo.username)}</b> <button class="c-btn" id="reply-cancel">✕</button></div>` : '';
    el.innerHTML = screenHtml('COMMENTS', null, `<div class="hero-name">${escapeHtml(level.name)}</div>
      <div class="comment-bar"><span class="note">${list.length} comment${list.length === 1 ? '' : 's'}</span>
        <div class="seg"><button class="${commentSort === 'top' ? 'on' : ''}" data-sort="top">Top</button><button class="${commentSort === 'new' ? 'on' : ''}" data-sort="new">Newest</button></div></div>
      ${me ? replyBanner + '<div class="comment-compose"><div class="c-avatar" style="background:' + artGradient(me.username) + '">' + escapeHtml(me.username.slice(0, 1).toUpperCase()) + '</div><div class="compose-main"><textarea id="comment-input" maxlength="300" rows="2" placeholder="' + (replyTo ? 'Write a reply…' : 'Say something about this level…') + '"></textarea><div class="compose-foot"><span id="comment-count" class="note">0/300</span><button class="btn small btn-play" id="comment-post">Post</button></div></div></div>' : '<div class="note center">Log in to comment.</div>'}
      <div class="comment-list">${tops.length ? tops.map(c => row(c, false) + (kids[c.id] || []).map(k => row(k, true)).join('')).join('') : '<div class="empty">No comments yet. Be the first!</div>'}</div>`);
    const ni = document.getElementById('comment-input');
    const upd = () => { const cc = document.getElementById('comment-count'); if (cc) cc.textContent = ni.value.length + '/300'; };
    if (ni) { ni.value = draft; upd(); ni.oninput = () => { draft = ni.value; upd(); }; ni.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('comment-post').click(); } }; if (replyTo) ni.focus(); }
    const body = el.querySelector('.screen-body'); if (body && keepScroll) body.scrollTop = scrollTop;
    el.querySelector('.back-btn').onclick = () => openLevelDetail(level, 'community', levelDetailReturnTo === 'admin-panel');
    const act = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'bad'); } };
    const post = document.getElementById('comment-post');
    if (post) post.onclick = () => act(async () => {
      const t = (ni.value || '').trim(); if (!t) return;
      post.disabled = true;
      await apiRequest('/api/levels/' + lvId + '/comments', { method: 'POST', auth: true, body: { text: t, parentId: replyTo ? replyTo.id : undefined } });
      draft = ''; replyTo = null; await render(true);
    }).then(() => { const p = document.getElementById('comment-post'); if (p) p.disabled = false; });
    const rc = document.getElementById('reply-cancel'); if (rc) rc.onclick = () => { replyTo = null; render(true); };
    el.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { commentSort = b.dataset.sort; render(); });
    el.querySelectorAll('[data-like]').forEach(b => b.onclick = () => act(async () => { if (!me) { toast('Log in to like.', 'bad'); return; } await apiRequest('/api/comments/' + b.dataset.like + '/like', { method: 'POST', auth: true, body: {} }); render(true); }));
    el.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => { replyTo = list.find(c => String(c.id) === b.dataset.reply) || null; render(true); });
    el.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => act(async () => { await apiRequest('/api/comments/' + b.dataset.pin + '/pin', { method: 'POST', auth: true, body: {} }); render(true); }));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => act(async () => { if (!(await uiConfirm('Delete this comment?', 'Delete', true))) return; await apiRequest('/api/comments/' + b.dataset.del, { method: 'DELETE', auth: true }); render(true); }));
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
// ---- admin: every player's device levels + every saved version ----
let adminDev = { owner: null, ownerName: '', local: null, localName: '', q: '' }, adminDevVers = {};
async function adminDeviceHtml() {
  try { return await adminDeviceInner(); }
  catch (e) {
    return '<div class="note">Could not load device levels: <b>' + escapeHtml(e.message || 'unknown error') + '</b><br>If this says "not found" or "failed", the backend on Render has not been updated to the newest server.js yet (check the Render dashboard for a finished deploy, then press ↻).</div>' +
      '<button class="btn small" onclick="adminDev={owner:null,ownerName:\'\',local:null,localName:\'\',q:\'\'};loadAdminPanel(\'device\')">Back to start</button>';
  }
}
async function adminDeviceInner() {
  const back = (step, label) => `<button class="btn small" data-dev="${step}">← ${label}</button>`;
  const wire = html => html;
  if (!adminDev.owner) {
    const d = await apiRequest('/api/admin/device-players', { auth: true }), q = adminDev.q.toLowerCase();
    const list = (d.players || []).filter(p => !q || p.owner.toLowerCase().includes(q));
    return '<div class="note">Levels saved from each player\'s device, with every version. Tap a player to open them. Copies stay here even if the player deletes the level.</div>' +
      '<input class="search" id="dev-search" placeholder="Search players…" value="' + escapeHtml(adminDev.q) + '" oninput="adminDev.q=this.value;clearTimeout(window._dvT);window._dvT=setTimeout(()=>loadAdminPanel(),350)"><div class="song-list">' +
      (list.length ? list.map(p => `<div class="song-row admin-row" data-dev="player" data-id="${escapeHtml(p.ownerId)}" data-name="${escapeHtml(p.owner)}"><div class="song-art" style="background:${artGradient(p.owner)}">${escapeHtml(p.owner.slice(0, 1).toUpperCase())}</div>
        <div class="song-info"><div class="song-title">${escapeHtml(p.owner)}</div><div class="song-sub">${p.levels} levels · ${p.versions} versions · ${timeAgo(p.lastSaved)}</div></div></div>`).join('')
        : '<div class="empty">Nothing saved yet. A player\'s levels appear here after they open the game while logged in (it saves a few seconds after loading).<br><button class="btn small btn-play" onclick="adminDevSyncMine()">Save my own levels now</button></div>') + '</div>';
  }
  if (!adminDev.local) {
    const d = await apiRequest('/api/admin/device-levels?owner=' + encodeURIComponent(adminDev.owner), { auth: true });
    return back('root', 'All players') + ' <b>' + escapeHtml(adminDev.ownerName) + '</b><div class="song-list">' + ((d.levels || []).length ? d.levels.map(l => `<div class="song-row admin-row" data-dev="level" data-id="${escapeHtml(l.localId)}" data-name="${escapeHtml(l.name)}"><div class="song-art" style="background:${artGradient(l.name)}">♪</div>
      <div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">${l.tiles} tiles · ${l.versions} version${l.versions === 1 ? '' : 's'} · ${timeAgo(l.lastSaved)}${l.published ? ' · published' : ''}${l.onDevice ? '' : ' · deleted by player'}</div></div></div>`).join('') : '<div class="empty">Nothing saved.</div>') + '</div>';
  }
  const d = await apiRequest('/api/admin/device-versions?owner=' + encodeURIComponent(adminDev.owner) + '&local=' + encodeURIComponent(adminDev.local), { auth: true });
  adminDevVers = {}; (d.versions || []).forEach(v => { adminDevVers[v.id] = v; });
  return back('player', escapeHtml(adminDev.ownerName)) + ' <b>' + escapeHtml(adminDev.localName) + '</b><div class="song-list">' + (d.versions || []).map((v, i) => `<div class="song-row admin-row">
    <div class="song-info"><div class="song-title">${i === 0 ? 'Latest' : 'Version ' + (d.versions.length - i)} · ${escapeHtml(v.name)}</div><div class="song-sub">${v.tiles} tiles · ${v.audio ? '🎵 music · ' : ''}${new Date(v.savedAt).toLocaleString()}</div></div>
    <div class="admin-actions"><button class="btn small" onclick="adminDevPlay(${v.id})">▶ Play</button><button class="btn small btn-play" onclick="adminDevDownload(${v.id})">⬇ .json</button><button class="btn small btn-pink" onclick="adminDevPublish(${v.id})">Publish</button></div></div>`).join('') + '</div>';
}
// one delegated click handler for the Device tab (names with quotes can't break it)
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-dev]'); if (!t || e.target.closest('button[onclick]')) return;
  const step = t.dataset.dev;
  if (step === 'root') adminDev = { owner: null, ownerName: '', local: null, localName: '', q: adminDev.q };
  else if (step === 'player') { if (t.dataset.id) { adminDev.owner = t.dataset.id; adminDev.ownerName = t.dataset.name; } adminDev.local = null; }
  else if (step === 'level') { adminDev.local = t.dataset.id; adminDev.localName = t.dataset.name; }
  loadAdminPanel('device');
});
async function adminDevSyncMine() { syncHashes.clear(); toast('Saving your levels…'); await cloudSyncAll(); setTimeout(() => loadAdminPanel('device'), 1500); }
async function adminAttachMusic(lvl) {
  if (!lvl || !lvl.audioSha) return null;
  try {
    const r = await fetch(API_BASE_URL + '/api/admin/audio/' + lvl.audioSha, { headers: { Authorization: 'Bearer ' + getAuthToken() } });
    if (!r.ok) return null;
    const b = await r.blob();
    Object.defineProperty(lvl, '_audioUrl', { value: URL.createObjectURL(b), enumerable: false, writable: true, configurable: true });
    return b;
  } catch (e) { return null; }
}
async function adminDevPlay(id) {
  try { const d = await apiRequest('/api/admin/device-versions/' + id, { auth: true }); const lvl = Object.assign({}, d.level, { id: 'dev-' + id, author: d.owner }); if (lvl.audioSha) toast('Loading music…'); await adminAttachMusic(lvl); startGame(lvl.name, true, -1, lvl.data, lvl.effects || [], true, lvl); }
  catch (e) { toast(e.message, 'bad'); }
}
async function adminDevPublish(id) {
  const v = adminDevVers[id]; if (!v) return;
  if (!(await uiConfirm('Publish "' + v.name + '" (' + v.tiles + ' tiles) as ' + adminDev.ownerName + '? It goes live under their name' + (v.audio ? ', with its music' : '') + '. If it was already published this makes a second copy.', 'Publish'))) return;
  try { const d = await apiRequest('/api/admin/device-versions/' + id + '/publish', { method: 'POST', auth: true, body: {}, timeout: 60000 }); toast('Published' + (v.audio && !d.music ? ' (music was too large, so it has none)' : '') + '.', 'good'); loadAdminPanel('device'); }
  catch (e) { toast(e.message, 'bad'); }
}
async function adminDevDownload(id) {
  try {
    const d = await apiRequest('/api/admin/device-versions/' + id, { auth: true });
    const mb = await adminAttachMusic(d.level); if (mb) d.level.audio = await blobToDataUrl(mb);
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(d.level)], { type: 'application/json' }));
    a.href = url; a.download = ((d.level.name || 'level') + '-' + d.owner + '-v' + id).replace(/[^\w\- ]+/g, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(e.message, 'bad'); }
}
async function adminUnpubPlay(id) {
  try {
    const d = await apiRequest('/api/admin/unpublished/' + id, { auth: true });
    const lvl = Object.assign({}, d.level, { id: 'unpub-' + id, author: d.owner }); await adminAttachMusic(lvl);
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


// ============================================================================
// extras.js — announcements, song library, cloud copies of My Levels (so admins can
// publish unpublished levels), "log in as player" (impersonation) bar.
// Loaded last. Injects the DOM it needs.
// ============================================================================
function ensureOverlay(id) {
  let e = document.getElementById(id);
  if (!e) { e = document.createElement('div'); e.id = id; e.className = 'overlay hidden'; document.body.appendChild(e); }
  return e;
}
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
const fileToDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
// shrink any image to a JPEG/PNG data url (keeps transparency for png)
async function shrinkImageFile(file, maxSize, quality) {
  const keep = /png|gif|webp/.test(file.type);
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
  const r = Math.min(1, maxSize / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  let out = c.toDataURL(keep ? 'image/png' : 'image/jpeg', quality || 0.8);
  if (out.length > 1400000) out = c.toDataURL('image/jpeg', 0.6);
  return out;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
let newsCache = [];
const newsSeen = () => Number(localStorage.getItem('et_news_seen') || 0);
let newsError = '';
async function fetchNews() {
  try { const d = await apiRequest('/api/news'); newsCache = d.news || []; newsError = ''; } catch (e) { newsError = e.message || 'Could not load.'; }
  updateNewsBadge();
  return newsCache;
}
// live: an admin just posted something
function onNewsPosted(d) {
  fetchNews().then(() => { if (!document.getElementById('news-menu').classList.contains('hidden')) renderNews(); });
  showAnnouncement('New: ' + (d && d.title ? d.title : 'announcement'), true);
}
function updateNewsBadge() {
  const b = document.getElementById('news-badge'); if (!b) return;
  const unread = newsCache.filter(n => n.id > newsSeen()).length;
  b.textContent = unread > 9 ? '9+' : String(unread); b.classList.toggle('hidden', !unread);
}
function injectNewsButton() {
  if (document.getElementById('news-btn')) return;
  const col = document.querySelector('#main-menu'); if (!col) return;
  let rail = document.getElementById('menu-rail');
  if (!rail) { rail = document.createElement('div'); rail.id = 'menu-rail'; col.appendChild(rail); }
  const b = document.createElement('button');
  b.id = 'news-btn'; b.className = 'icon-btn rail-btn'; b.setAttribute('aria-label', 'Announcements');
  b.innerHTML = '📣<span id="news-badge" class="news-badge hidden">0</span>';
  b.onclick = openNews; rail.appendChild(b);
}
async function openNews() {
  const host = ensureOverlay('news-menu');
  toggleMenu('news-menu');
  host.innerHTML = screenHtml('ANNOUNCEMENTS', "toggleMenu('main-menu')", '<div class="empty">Loading…</div>');
  await fetchNews();
  renderNews();
  if (newsCache.length) { localStorage.setItem('et_news_seen', String(Math.max(...newsCache.map(n => n.id)))); updateNewsBadge(); }
}
const newsOpen = new Set();
// "Browse/(Level name)" (or Browse/(level-id)) in a post becomes a link that opens that level
function newsBodyHtml(text) {
  return escapeHtml(text).replace(/Browse\/\(([^)\n]{1,80})\)/g, (m, n) => '<a class="level-link" data-lvl="' + n + '">🌐 ' + n + '</a>').replace(/\n/g, '<br>');
}
async function openLevelLink(name) {
  name = String(name).trim();
  try {
    let level = null;
    if (/^[0-9a-f-]{36}$/i.test(name)) level = await apiRequest('/api/levels/' + name);
    else {
      const list = await apiRequest('/api/levels?search=' + encodeURIComponent(name));
      level = (list || []).find(l => String(l.name).toLowerCase() === name.toLowerCase()) || (list || [])[0];
    }
    if (!level || !level.id) { toast('Level not found.', 'bad'); return; }
    openLevelDetail(level, 'community');
  } catch (e) { toast(e.message || 'Level not found.', 'bad'); }
}
function renderNews() {
  const host = ensureOverlay('news-menu'), admin = isAdminUser(), me = getAuthUser();
  const posts = newsCache.map(n => `<div class="panel news-post" data-nid="${n.id}">
      <div class="news-title">${escapeHtml(n.title)}</div><div class="news-meta">${fmtDate(n.createdAt)} · ${escapeHtml(n.author)}</div>
      ${n.image ? '<img class="news-img" src="' + escapeHtml(n.image) + '" alt="">' : ''}
      <div class="news-body">${newsBodyHtml(n.body)}</div>
      <div class="news-actions"><button class="c-btn${n.liked ? ' on' : ''}" data-nlike="${n.id}">${n.liked ? '❤️' : '🤍'} ${n.likes || ''}</button>
        <button class="c-btn" data-nthread="${n.id}">💬 ${n.comments || 'Reply'}</button>
        ${admin ? '<button class="c-btn" onclick="editNews(' + n.id + ')">✎ Edit</button><button class="c-btn del" onclick="deleteNews(' + n.id + ')">🗑 Delete</button>' : ''}</div>
      <div class="news-thread hidden" id="nthread-${n.id}"></div>
    </div>`).join('');
  host.innerHTML = screenHtml('ANNOUNCEMENTS', "toggleMenu('main-menu')",
    (admin ? '<button class="btn btn-play" onclick="editNews(0)">＋ New post</button>' : '') + (posts || (newsError ? errorBox(newsError, 'openNews()') : '<div class="empty">No announcements yet.</div>')));
  host.querySelectorAll('.news-img').forEach(i => { i.onclick = () => viewNewsImage(i.src); });
  host.querySelectorAll('.level-link').forEach(a => { a.onclick = () => openLevelLink(a.dataset.lvl); });
  host.querySelectorAll('[data-nlike]').forEach(b => b.onclick = async () => {
    if (!me) { toast('Log in to like.', 'bad'); return; }
    try { const d = await apiRequest('/api/news/' + b.dataset.nlike + '/like', { method: 'POST', auth: true, body: {} }); const n = newsCache.find(x => String(x.id) === b.dataset.nlike); if (n) { n.liked = d.liked; n.likes = d.likes; } b.className = 'c-btn' + (d.liked ? ' on' : ''); b.textContent = (d.liked ? '❤️ ' : '🤍 ') + (d.likes || ''); } catch (e) { toast(e.message, 'bad'); }
  });
  host.querySelectorAll('[data-nthread]').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.nthread), box = document.getElementById('nthread-' + id);
    if (newsOpen.has(id)) { newsOpen.delete(id); box.classList.add('hidden'); } else { newsOpen.add(id); box.classList.remove('hidden'); loadNewsThread(id); }
  });
  newsOpen.forEach(id => { const box = document.getElementById('nthread-' + id); if (box) { box.classList.remove('hidden'); loadNewsThread(id); } });
}
async function loadNewsThread(id, replyTo) {
  const box = document.getElementById('nthread-' + id); if (!box) return;
  const me = getAuthUser(), admin = isAdminUser();
  const prev = box.querySelector('textarea'); const draft = prev ? prev.value : '';
  let list = []; try { list = (await apiRequest('/api/news/' + id + '/comments')).comments || []; } catch (e) { box.innerHTML = '<div class="note">Could not load replies.</div>'; return; }
  const tops = list.filter(c => !c.parentId), kids = {};
  list.filter(c => c.parentId).forEach(c => (kids[c.parentId] = kids[c.parentId] || []).push(c));
  const row = (c, isReply) => `<div class="comment${isReply ? ' reply' : ''}"><div class="c-avatar" style="background:${artGradient(c.username)}">${escapeHtml(c.username.slice(0, 1).toUpperCase())}</div>
    <div class="c-main"><div class="c-head"><b>${escapeHtml(c.username)}</b>${c.isAdmin ? '<span class="cbadge admin">ADMIN</span>' : ''}<small>${timeAgo(c.createdAt)}</small></div><div class="c-text">${escapeHtml(c.text)}</div>
    <div class="c-actions">${me && !isReply ? '<button class="c-btn" data-nr="' + c.id + '">↩ Reply</button>' : ''}${me && (admin || me.id === c.userId) ? '<button class="c-btn del" data-nd="' + c.id + '">🗑</button>' : ''}</div></div></div>`;
  box.innerHTML = (tops.length ? tops.map(c => row(c, false) + (kids[c.id] || []).map(k => row(k, true)).join('')).join('') : '<div class="note">No replies yet.</div>') +
    (me ? (replyTo ? '<div class="reply-banner">Replying to <b>' + escapeHtml(replyTo.username) + '</b> <button class="c-btn" data-ncancel>✕</button></div>' : '') +
      '<div class="stream-compose"><input id="nin-' + id + '" maxlength="300" placeholder="' + (replyTo ? 'Write a reply…' : 'Reply to this post…') + '"><button class="btn small btn-play" data-nsend>Send</button></div>' : '<div class="note">Log in to reply.</div>');
  const inp = document.getElementById('nin-' + id); if (inp) { inp.value = draft; if (replyTo) inp.focus(); }
  const send = async () => { const t = inp.value.trim(); if (!t) return; try { await apiRequest('/api/news/' + id + '/comments', { method: 'POST', auth: true, body: { text: t, parentId: replyTo ? replyTo.id : undefined } }); const n = newsCache.find(x => x.id === id); if (n) n.comments = (n.comments || 0) + 1; inp.value = ''; loadNewsThread(id); } catch (e) { toast(e.message, 'bad'); } };
  if (inp) { inp.onkeydown = e => { if (e.key === 'Enter') send(); }; box.querySelector('[data-nsend]').onclick = send; }
  const cancel = box.querySelector('[data-ncancel]'); if (cancel) cancel.onclick = () => loadNewsThread(id);
  box.querySelectorAll('[data-nr]').forEach(b => b.onclick = () => loadNewsThread(id, list.find(c => String(c.id) === b.dataset.nr)));
  box.querySelectorAll('[data-nd]').forEach(b => b.onclick = async () => { if (!(await uiConfirm('Delete this reply?', 'Delete', true))) return; try { await apiRequest('/api/news/comments/' + b.dataset.nd, { method: 'DELETE', auth: true }); loadNewsThread(id); } catch (e) { toast(e.message, 'bad'); } });
}
function viewNewsImage(src) {
  const d = document.createElement('div'); d.className = 'img-lightbox'; d.innerHTML = '<img alt="">'; d.firstChild.src = src;
  d.onclick = () => d.remove(); document.body.appendChild(d);
}
async function editNews(id) {
  const old = newsCache.find(n => n.id === id) || { title: '', body: '' };
  const r = await openFormDialog({ title: id ? 'Edit post' : 'New announcement', fields: [{ id: 'title', label: 'Title', value: old.title, maxlength: 120 }, { id: 'body', label: 'Text (link a level with Browse/(Level name))', type: 'textarea', value: old.body, rows: 7, maxlength: 5000 }, { id: 'image', label: 'Image (optional)', type: 'file' }].concat(id ? (old.image ? [{ id: 'dropImg', label: 'Remove current image', type: 'checkbox' }] : []) : [{ id: 'banner', label: 'Also show a banner to everyone', type: 'checkbox' }]), okText: id ? 'Save' : 'Post' });
  if (!r) return;
  if (!String(r.title || '').trim()) { toast('Add a title.', 'bad'); return; }
  let image = null, keepImage = !!id && !r.dropImg;
  const fi = r.imageFile;
  if (fi) { try { image = await shrinkImageFile(fi, 900, 0.78); keepImage = false; } catch (e) { toast(e.message, 'bad'); return; } }
  try {
    if (id) await apiRequest('/api/admin/news/' + id, { method: 'PUT', auth: true, body: { title: r.title, body: r.body, image, keepImage } });
    else await apiRequest('/api/admin/news', { method: 'POST', auth: true, body: { title: r.title, body: r.body, image } });
    if (!id && r.banner) { try { await apiRequest('/api/admin/settings', { method: 'PUT', auth: true, body: { announcement: String(r.title).trim().slice(0, 300) } }); } catch (e) {} }
    toast(id ? 'Saved.' : 'Posted!', 'good');
    await fetchNews(); renderNews();
  } catch (e) { toast(e.message, 'bad'); }
}
async function deleteNews(id) {
  if (!(await uiConfirm('Delete this post?', 'Delete', true))) return;
  try { await apiRequest('/api/admin/news/' + id, { method: 'DELETE', auth: true }); await fetchNews(); renderNews(); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Song library
// ---------------------------------------------------------------------------
let songPickResolve = null, songPreview = null, songList = [];
function openSongPicker() {
  ensureOverlay('songs-menu');
  return new Promise(resolve => { songPickResolve = resolve; toggleMenu('songs-menu'); document.body.classList.add('songs-over-editor'); loadSongs(); });
}
function closeSongPicker(song) {
  stopSongPreview();
  document.body.classList.remove('songs-over-editor');
  const r = songPickResolve; songPickResolve = null;
  document.getElementById('songs-menu').classList.add('hidden');
  if (inEditor) { document.getElementById('editor-ui').classList.remove('hidden'); document.body.classList.remove('menus-open'); }
  else toggleMenu('main-menu');
  if (r) r(song || null);
}
function stopSongPreview() { if (songPreview) { songPreview.pause(); songPreview = null; } }
async function loadSongs() {
  const host = document.getElementById('songs-menu');
  host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()', '<div class="empty">Loading…</div>');
  try { songList = (await apiRequest('/api/songs')).songs || []; } catch (e) { host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()', errorBox(e.message, 'loadSongs()')); return; }
  renderSongs();
}
function renderSongs(filter) {
  const host = document.getElementById('songs-menu'), admin = isAdminUser(), q = String(filter || '').toLowerCase();
  const rows = songList.filter(s => !q || (s.name + ' ' + s.artist).toLowerCase().includes(q)).map(s => `<div class="song-row admin-row">
      <div class="song-art" style="background:${artGradient(s.name)}">♪</div>
      <div class="song-info"><div class="song-title">${escapeHtml(s.name)}</div><div class="song-sub">${escapeHtml(s.artist || 'Unknown')} · ${(s.size / 1.37 / 1048576).toFixed(1)} MB${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}</div></div>
      <div class="song-actions"><button class="mini-btn" onclick="previewSong(${s.id})">▶</button><button class="mini-btn" onclick="useSong(${s.id})">Use</button>${admin ? '<button class="mini-btn danger" onclick="deleteSong(' + s.id + ')">🗑</button>' : ''}</div></div>`).join('');
  host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()',
    `<input type="text" id="song-search" class="form-input" placeholder="Search songs…" value="${escapeHtml(filter || '')}" oninput="renderSongs(this.value);document.getElementById('song-search').focus()">
     ${admin ? '<button class="btn btn-play" onclick="uploadSong()">＋ Upload a song (admin)</button>' : ''}
     <div class="song-list">${rows || '<div class="empty">No songs yet.' + (admin ? '' : ' Admins can add free songs here.') + '</div>'}</div>`);
}
function previewSong(id) {
  stopSongPreview(); bgAudio.pause();
  songPreview = new Audio(API_BASE_URL + '/api/songs/' + id + '/audio'); songPreview.volume = 0.8; songPreview.play().catch(() => toast('Could not play the preview.', 'bad'));
  setTimeout(() => { if (songPreview) songPreview.pause(); }, 20000);
}
function useSong(id) { const s = songList.find(x => x.id === id); closeSongPicker(s ? { id: s.id, name: s.name, artist: s.artist, bpm: s.bpm } : null); }
async function uploadSong() {
  const r = await openFormDialog({ title: 'Upload a free song', message: 'Audio file up to ~8 MB.', fields: [{ id: 'name', label: 'Song name', maxlength: 80 }, { id: 'artist', label: 'Artist', maxlength: 80 }, { id: 'bpm', label: 'BPM (optional)', type: 'number' }, { id: 'file', label: 'Audio file', type: 'file', accept: 'audio/*' }], okText: 'Upload' });
  if (!r) return;
  const f = r.fileFile;
  if (!f || !r.name.trim()) { toast('Pick a file and give it a name.', 'bad'); return; }
  if (f.size > 8 * 1048576) { toast('That file is over 8 MB.', 'bad'); return; }
  try {
    toast('Uploading…');
    await apiRequest('/api/admin/songs', { method: 'POST', auth: true, timeout: 120000, body: { name: r.name.trim(), artist: r.artist.trim(), bpm: Number(r.bpm) || null, data: await fileToDataUrl(f) } });
    toast('Song added.', 'good'); loadSongs();
  } catch (e) { toast(e.message, 'bad'); }
}
async function deleteSong(id) {
  if (!(await uiConfirm('Remove this song from the library? Levels using it will play without music.', 'Delete', true))) return;
  try { await apiRequest('/api/admin/songs/' + id, { method: 'DELETE', auth: true }); loadSongs(); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Cloud copies of My Levels (lets admins see + publish unpublished levels)
// ---------------------------------------------------------------------------
const syncHashes = new Map(), syncTimers = new Map();
function levelForSync(level) { const c = Object.assign({}, level); delete c.audio; delete c.verifiedHash; return c; }
const sha256Hex = async buf => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('');
function cloudSyncLevel(level) {
  if (!level || !level.id || !getAuthToken() || !API_BASE_URL) return;
  clearTimeout(syncTimers.get(level.id));
  syncTimers.set(level.id, setTimeout(async () => {
    try {
      const body = levelForSync(level);
      let blob = null;                                          // the level's own music (library songs are referenced by id, so nothing to send)
      if (!level.songId) { try { blob = await LevelAudio.get(level.id); } catch (e) {} }
      if (blob && blob.size > 0 && blob.size <= 8 * 1024 * 1024 && window.crypto && crypto.subtle) { body.audioSha = await sha256Hex(await blob.arrayBuffer()); body.audioMime = blob.type || 'audio/mpeg'; } else blob = null;
      const json = JSON.stringify(body);
      if (json.length > 3500000) return;
      const h = hashString(json);
      if (syncHashes.get(level.id) === h) return;
      const d = await apiRequest('/api/sync/levels/' + encodeURIComponent(level.id), { method: 'PUT', auth: true, body, timeout: 60000 });
      if (d && d.needAudio && blob) {
        const r = await fetch(API_BASE_URL + '/api/sync/audio/' + body.audioSha, { method: 'PUT', headers: { Authorization: 'Bearer ' + getAuthToken(), 'Content-Type': 'application/octet-stream', 'x-mime': blob.type || 'audio/mpeg' }, body: blob });
        if (!r.ok) return;                                      // try again next time
      }
      syncHashes.set(level.id, h);
      if (typeof uploadLevelVideos === 'function' && level.decor && (level.decor.objects || []).some(o => o.kind === 'video')) uploadLevelVideos(level.decor, true).catch(() => {});   // so an admin can publish it with its videos
    } catch (e) { /* silent */ }
  }, 2500));
}
function cloudUnsyncLevel(localId) { if (getAuthToken()) apiRequest('/api/sync/levels/' + encodeURIComponent(localId), { method: 'DELETE', auth: true }).catch(() => {}); syncHashes.delete(localId); }
async function cloudSyncAll() {
  if (!getAuthToken() || !API_BASE_URL || getAuthUser() && localStorage.getItem('et_imp_backup')) return;
  for (const l of myLevels.slice()) { if (!syncHashes.has(l.id)) { cloudSyncLevel(l); await new Promise(r => setTimeout(r, 700)); } }
}

// Levels saved on the account but missing on this device (browser data cleared, new device...) can be brought back.
let restoreChecked = '';
async function restoreLostLevels(force) {
  const u = getAuthUser();
  if (!u || !getAuthToken() || !API_BASE_URL || localStorage.getItem('et_imp_backup')) return;
  if (!force && restoreChecked === u.id) return;
  restoreChecked = u.id;
  try {
    const list = (await apiRequest('/api/sync/levels', { auth: true, timeout: 30000 })).levels || [];
    let declined = []; try { declined = JSON.parse(lsGet('et_restore_declined') || '[]'); } catch (e) {}
    const have = new Set(myLevels.map(l => l.id));
    const missing = list.filter(c => !have.has(c.localId) && (force || !declined.includes(c.localId)));
    if (!missing.length) { if (force) toast('Nothing missing - all your saved levels are on this device.'); return; }
    const names = missing.slice(0, 6).map(c => '"' + c.name + '"').join(', ') + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more' : '');
    if (!(await uiConfirm('Found ' + missing.length + ' level' + (missing.length > 1 ? 's' : '') + ' saved on your account that ' + (missing.length > 1 ? 'are' : 'is') + ' not on this device: ' + names + '. Bring ' + (missing.length > 1 ? 'them' : 'it') + ' back?', 'Bring back'))) {
      try { localStorage.setItem('et_restore_declined', JSON.stringify(declined.concat(missing.map(c => c.localId)).slice(-300))); } catch (e) {}
      return;
    }
    let ok = 0;
    for (const c of missing) {
      try {
        const lv = (await apiRequest('/api/sync/levels/' + encodeURIComponent(c.localId), { auth: true, timeout: 60000 })).level;
        if (!lv || !Array.isArray(lv.data)) continue;
        lv.id = c.localId;
        if (c.audioSha) {
          try { const r = await fetch(API_BASE_URL + '/api/sync/audio/' + c.audioSha, { headers: { Authorization: 'Bearer ' + getAuthToken() } }); if (r.ok) await LevelAudio.put(c.localId, await r.blob()); } catch (e) {}
        }
        myLevels.push(lv); ok++;
      } catch (e) {}
    }
    persistMyLevels();
    if (typeof renderMyLevels === 'function' && !document.getElementById('my-levels-menu').classList.contains('hidden')) renderMyLevels();
    toast(ok ? 'Brought back ' + ok + ' level' + (ok > 1 ? 's' : '') + '.' : 'Could not bring the levels back - try again later.', ok ? 'good' : 'bad');
  } catch (e) { restoreChecked = ''; }
}
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // ask the browser not to clear levels when space runs low

// ---------------------------------------------------------------------------
// Impersonation ("Log in as")
// ---------------------------------------------------------------------------
async function startImpersonation(userId, username) {
  if (localStorage.getItem('et_imp_backup')) { toast('Return to your own account first.', 'bad'); return; }
  if (!(await uiConfirm('Log in as ' + username + '? You will see the game exactly as they do. A bar at the top lets you return.', 'Log in as'))) return;
  try {
    const d = await apiRequest('/api/admin/players/' + encodeURIComponent(userId) + '/impersonate', { method: 'POST', auth: true, body: {} });
    localStorage.setItem('et_imp_backup', JSON.stringify({ token: getAuthToken(), user: getAuthUser() }));
    if (typeof disconnectBattle === 'function') disconnectBattle();
    saveAuthSession(d.token, d.user);
    renderImpBar();
    toggleMenu('main-menu');
    toast('Now viewing as ' + username + '.', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}
function returnFromImpersonation() {
  let b = null; try { b = JSON.parse(localStorage.getItem('et_imp_backup') || 'null'); } catch (e) {}
  localStorage.removeItem('et_imp_backup');
  if (typeof disconnectBattle === 'function') disconnectBattle();
  if (b && b.token) saveAuthSession(b.token, b.user); else clearAuthSession();
  renderImpBar(); toggleMenu('main-menu');
  if (b && b.token) restoreAuthSession();
  toast('Back to your own account.', 'good');
}
function renderImpBar() {
  let bar = document.getElementById('imp-bar');
  const active = !!localStorage.getItem('et_imp_backup');
  document.body.classList.toggle('imp-bar', active);
  if (!active) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'imp-bar'; document.body.appendChild(bar); }
  const u = getAuthUser();
  bar.innerHTML = '👁 Viewing as <b>' + escapeHtml(u ? u.username : '?') + '</b> <button onclick="returnFromImpersonation()">Return to admin</button>';
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
function extrasBoot() {
  ensureOverlay('news-menu'); ensureOverlay('songs-menu');
  injectNewsButton(); if (typeof injectLiveButton === 'function') injectLiveButton(); if (typeof refreshLive === 'function') refreshLive(); renderImpBar();
  fetchNews();
  setInterval(() => { if (!document.getElementById('main-menu').classList.contains('hidden')) fetchNews(); }, 120000);
  setTimeout(cloudSyncAll, 6000);
  setTimeout(() => restoreLostLevels(false), 3500);
  setTimeout(() => { if (API_BASE_URL && typeof connectBattle === 'function') connectBattle().catch(() => {}); }, 2500);   // stay connected for live announcements + streams
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', extrasBoot); else extrasBoot();
function onMyLevelsReloaded() { setTimeout(cloudSyncAll, 4000); }


// ---- admin: backup vault. The game keeps a full copy of everything on the admin's own device and refreshes it by itself. ----
const BkDB = (() => {
  let db = null;
  const open = () => new Promise((res, rej) => { if (db) return res(db); if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open('et_vault', 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onsuccess = () => { db = r.result; res(db); }; r.onerror = () => rej(r.error); });
  const run = (mode, fn) => open().then(d => new Promise((res, rej) => { const tx = d.transaction('v', mode); const rq = fn(tx.objectStore('v')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }));
  return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)) };
})();
function bkStatus(t) { const e = document.getElementById('bk-status'); if (e) e.textContent = t; }
async function bkCollect(progress) {
  const parts = [];
  const list = (await apiRequest('/api/admin/backup/tables', { auth: true, timeout: 60000 })).tables;
  parts.push(JSON.stringify({ v: 1, at: new Date().toISOString(), tables: list.map(t => ({ name: t.name, count: t.count })) }) + '\n');
  for (const t of list) {
    const step = t.blob ? 3 : 400;
    for (let off = 0; off < t.count; off += step) {
      if (progress) progress('Saving ' + t.name + ' (' + off + '/' + t.count + ')…');
      const d = await apiRequest('/api/admin/backup/table/' + encodeURIComponent(t.name) + '?limit=' + step + '&offset=' + off, { auth: true, timeout: 120000 });
      if (!d.rows.length) break;
      parts.push(JSON.stringify({ t: t.name, rows: d.rows }) + '\n');
    }
  }
  return new Blob(parts, { type: 'application/x-ndjson' });
}
let bkRunning = false;
async function bkRunSave(progress) {
  if (bkRunning) return null;
  bkRunning = true;
  try {
    const blob = await bkCollect(progress);
    await BkDB.set('latest', { blob, at: Date.now(), size: blob.size });
    try { localStorage.setItem('et_bk_last', String(Date.now())); } catch (e) {}
    return blob;
  } finally { bkRunning = false; }
}
// runs quietly when an admin opens the game (at most about once a day)
async function bkAutoMaybe() {
  try {
    const last = Number(lsGet('et_bk_last') || 0);
    if (Date.now() - last < 20 * 3600 * 1000) return;
    await bkRunSave(null);
  } catch (e) {}
}
async function adminBackupHtml() {
  let saved = null; try { saved = await BkDB.get('latest'); } catch (e) {}
  return `<div class="hub-note"><b>💾 Backup</b><br>While you are logged in as an admin, the game saves a full copy of everything (accounts, levels, scores, replays, comments, music…) on THIS device about once a day. If the server ever loses its data, press <b>Restore</b> and it all comes back.<br><br>
    <span id="bk-saved">${saved ? 'Saved copy: ' + new Date(saved.at).toLocaleString() + ' · ' + Math.round(saved.size / 1024) + ' KB' : 'No saved copy yet - press "Save now".'}</span></div>
    <div class="row-btns"><button class="btn primary" id="bk-save">💾 Save now</button>
    <button class="btn" id="bk-restore" ${saved ? '' : 'disabled'}>♻ Restore saved copy</button></div>
    <div class="row-btns" style="margin-top:8px"><button class="btn ghost" id="bk-download">⬇ Download a file</button>
    <label class="btn ghost" style="cursor:pointer">⬆ Restore from file<input type="file" id="bk-file" accept=".jsonl,.json,.txt" style="display:none"></label></div>
    <label class="check-row"><input type="checkbox" id="bk-replace" checked> If a brand-new account has the same name as a saved one, let the saved one win (only when the new one has no levels)</label>
    <div id="bk-status" class="hub-note" style="margin-top:8px">Ready.</div>`;
}
async function adminBackupSave() {
  try { bkStatus('Saving…'); await bkRunSave(bkStatus); const sv = await BkDB.get('latest'); bkStatus('Done. Saved copy on this device: ' + Math.round(sv.size / 1024) + ' KB.'); loadAdminPanel('backup'); }
  catch (e) { bkStatus('Save failed: ' + (e.message || e)); }
}
async function adminBackupDownload() {
  try {
    let sv = await BkDB.get('latest'); let blob = sv && sv.blob;
    if (!blob) { bkStatus('Saving…'); blob = await bkRunSave(bkStatus); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = '06tiles-backup-' + new Date().toISOString().slice(0, 10) + '.jsonl'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    bkStatus('Downloaded. Keep that file private - it contains password hashes.');
  } catch (e) { bkStatus('Failed: ' + (e.message || e)); }
}
async function adminBackupRestore(fileOrBlob, label) {
  if (!fileOrBlob) return;
  if (!await uiConfirm('Restore ' + (label || 'this backup') + ' into the server? Anything already there is kept; anything missing is added back.', 'Restore')) return;
  const replaceUsers = !!(document.getElementById('bk-replace') || {}).checked;
  let ins = 0, skip = 0;
  try {
    const lines = (await fileOrBlob.text()).split('\n').filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const o = JSON.parse(lines[i]);
      if (!o.t) continue;
      const rows = o.rows, step = 20;
      for (let k = 0; k < rows.length; k += step) {
        bkStatus('Restoring ' + o.t + ' (' + (i + 1) + '/' + lines.length + ')…');
        const r = await apiRequest('/api/admin/backup/import', { method: 'POST', auth: true, timeout: 120000, body: { table: o.t, rows: rows.slice(k, k + step), replaceUsers } });
        ins += r.inserted; skip += r.skipped;
      }
    }
    bkStatus('Finishing up…');
    await apiRequest('/api/admin/backup/finish', { method: 'POST', auth: true, body: {}, timeout: 120000 });
    bkStatus('Restore complete: ' + ins + ' rows added back, ' + skip + ' were already there or skipped.');
  } catch (e) { bkStatus('Restore failed: ' + (e.message || e) + ' (' + ins + ' rows were added first; running it again is safe)'); }
}
document.addEventListener('click', async e => {
  const id = e.target && e.target.id;
  if (id === 'bk-save') adminBackupSave();
  else if (id === 'bk-download') adminBackupDownload();
  else if (id === 'bk-restore') { const sv = await BkDB.get('latest'); if (sv) adminBackupRestore(sv.blob, 'the copy saved on this device'); }
});
document.addEventListener('change', e => { if (e.target && e.target.id === 'bk-file') { const f = e.target.files[0]; adminBackupRestore(f, '"' + (f && f.name) + '"'); e.target.value = ''; } });


// ---- creator stats + death heatmap ----
async function openLevelStats(level) {
  const menu = ensureOverlay('level-stats-menu');
  menu.innerHTML = screenHtml('LEVEL STATS', "toggleMenu('level-detail-menu')", '<div class="empty">Loading…</div>');
  toggleMenu('level-stats-menu');
  try {
    const st = (await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/stats', { auth: true })).stats;
    const max = Math.max(1, ...st.deaths), total = st.deaths.reduce((a, b) => a + b, 0);
    let worst = 0; st.deaths.forEach((v, i) => { if (v > st.deaths[worst]) worst = i; });
    const bars = st.deaths.map((v, i) => '<i title="' + (i * 2) + '-' + (i * 2 + 2) + '%: ' + v + ' deaths" style="height:' + Math.max(2, Math.round(v / max * 100)) + '%;background:hsl(' + Math.round(120 - 120 * (v / max)) + ',80%,55%)"></i>').join('');
    const pct = v => Math.round(v * 100) + '%';
    menu.innerHTML = screenHtml('LEVEL STATS', "toggleMenu('level-detail-menu')", `
      <div class="panel"><div class="hero-name">${escapeHtml(level.name)}</div><div class="hero-sub">${st.since ? 'counting since ' + new Date(st.since).toLocaleDateString() : 'no attempts yet'}</div></div>
      <div class="stats-grid three"><div class="stat-card"><span>PLAYERS</span><b>${st.players}</b></div><div class="stat-card"><span>ATTEMPTS</span><b>${st.attempts}</b></div><div class="stat-card"><span>CLEARS</span><b>${st.completions}</b></div></div>
      <div class="stats-grid three"><div class="stat-card"><span>PASS RATE</span><b>${st.players ? pct(st.passRate) : '—'}</b></div><div class="stat-card"><span>ATTEMPTS TO CLEAR</span><b>${st.avgAttemptsToClear === null ? '—' : st.avgAttemptsToClear.toFixed(1)}</b></div><div class="stat-card"><span>CLEARED BY</span><b>${st.clearers}</b></div></div>
      <div class="section-title">WHERE PLAYERS DIE</div>
      <div class="heat-bars">${bars}</div>
      <div class="heat-labels"><span>start</span><span>25%</span><span>50%</span><span>75%</span><span>end</span></div>
      <div class="note center">${total ? 'Most deaths at about ' + (worst * 2) + '-' + (worst * 2 + 2) + '% of the level (' + st.deaths[worst] + ' of ' + total + ').' : 'Deaths will show up here once players have tried the level.'}</div>
      <button class="btn btn-ghost" id="stats-reset">Reset these stats</button>`);
    document.getElementById('stats-reset').onclick = async () => {
      if (!(await uiConfirm('Reset all attempts, clears and the death heatmap for this level? Do this after you change the level.', 'Reset'))) return;
      try { await apiRequest('/api/levels/' + encodeURIComponent(level.id) + '/stats', { method: 'DELETE', auth: true }); toast('Stats reset.', 'good'); openLevelStats(level); } catch (e) { toast(e.message, 'bad'); }
    };
  } catch (e) { menu.innerHTML = screenHtml('LEVEL STATS', "toggleMenu('level-detail-menu')", '<div class="empty">' + escapeHtml(e.message || 'Could not load stats.') + '</div>'); }
}
