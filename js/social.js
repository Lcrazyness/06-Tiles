// ============================================================================
// social.js — the Hub: daily/weekly challenges, packs & playlists, friends' activity feed, alerts.
// Also: ghost settings + stream-thumbnail helpers. Loaded after battle.js.
// ============================================================================
const HUB = { tab: 'challenges', unread: 0, packKind: 'pack', packId: null, pickerQ: '', pickerList: null, boardOpen: null };

function injectHubButton() { if (typeof railButton === 'function') railButton('hub-btn', '✨', 'Hub', () => openHub(), 'hub-badge', 'live'); setHubBadge(HUB.unread); }
function setHubBadge(n) { HUB.unread = n || 0; const b = document.getElementById('hub-badge'); if (b) { b.textContent = String(HUB.unread); b.classList.toggle('hidden', !HUB.unread); } }
async function refreshHubCount() {
  if (!getAuthToken() || !API_BASE_URL) { setHubBadge(0); return; }
  try { setHubBadge((await apiRequest('/api/notifications/count', { auth: true })).unread || 0); } catch (e) {}
}
function onNotifyPush(d) { toast('🔔 ' + (d && d.text || 'New alert')); setHubBadge(HUB.unread + 1); const m = document.getElementById('hub-menu'); if (m && !m.classList.contains('hidden') && HUB.tab === 'alerts') openHub('alerts'); }

const HUB_TABS = [['challenges', '🏆 Challenges'], ['packs', '📦 Packs'], ['feed', '👥 Friends'], ['alerts', '🔔 Alerts']];
async function openHub(tab) {
  if (tab) { HUB.tab = tab; if (tab !== 'packs') HUB.packId = null; }
  const host = ensureOverlay('hub-menu'); toggleMenu('hub-menu');
  const draw = body => {
    host.innerHTML = screenHtml('HUB', "toggleMenu('main-menu')", '<div class="seg live-tabs">' + HUB_TABS.map(([k, n]) => '<button class="' + (HUB.tab === k ? 'on' : '') + '" data-htab="' + k + '">' + n + (k === 'alerts' && HUB.unread ? ' (' + HUB.unread + ')' : '') + '</button>').join('') + '</div>' + body);
    host.querySelectorAll('[data-htab]').forEach(b => b.onclick = () => openHub(b.dataset.htab));
  };
  draw('<div class="empty">Loading…</div>');
  try {
    if (HUB.tab === 'challenges') await hubChallenges(draw, host);
    else if (HUB.tab === 'packs') await (HUB.packId ? hubPackView(draw, host) : hubPackList(draw, host));
    else if (HUB.tab === 'feed') await hubFeed(draw, host);
    else await hubAlerts(draw, host);
  } catch (e) { draw(errorBox(e.message, "openHub('" + HUB.tab + "')")); }
}
const needLogin = what => '<div class="note center">Log in to ' + what + '.</div>';
function countdown(ms) { const s = Math.max(0, Math.floor((ms - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm'; }

// ---------------------------------------------------------------- challenges
async function hubChallenges(draw, host) {
  const d = await apiRequest('/api/challenges', { auth: !!getAuthToken() }), admin = isAdminUser();
  const card = (kind, c) => {
    const l = c.level;
    if (!l) return `<div class="panel"><div class="section-title">${kind === 'daily' ? 'DAILY' : 'WEEKLY'} CHALLENGE</div><div class="empty">No featured level to pick from yet.</div>${admin ? '<button class="btn small" data-hset="' + kind + '">Admin: choose level</button>' : ''}</div>`;
    return `<div class="panel challenge"><div class="section-title">${kind === 'daily' ? 'DAILY' : 'WEEKLY'} CHALLENGE <small>· ends in ${countdown(c.endsAt)}</small></div>
      <div class="song-row"><div class="song-art" style="background:${artGradient(l.name)}">♪</div><div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.author)} · ${l.tileCount || (l.data || []).length || '?'} tiles · ${escapeHtml(l.difficulty || '')}</div>
      <div class="song-meta"><span>${c.claimed ? '✔ bonus claimed' : '+' + c.bonusStars + ' ★ bonus for finishing'}</span></div></div></div>
      <div class="btn-row"><button class="btn btn-play" data-hplay="${escapeHtml(l.id)}">▶ Play</button><button class="btn btn-ghost" data-hboard="${kind}">🏆 Leaderboard</button>${admin ? '<button class="btn small btn-ghost" data-hset="' + kind + '">Admin: change</button>' : ''}</div>
      <div id="board-${kind}"></div></div>`;
  };
  draw((getAuthToken() ? '' : needLogin('earn bonus stars and appear on the boards')) + card('daily', d.daily) + card('weekly', d.weekly));
  host.querySelectorAll('[data-hplay]').forEach(b => b.onclick = () => playLevelEntry({ id: b.dataset.hplay }, 'community'));
  host.querySelectorAll('[data-hboard]').forEach(b => b.onclick = () => hubBoard(b.dataset.hboard));
  host.querySelectorAll('[data-hset]').forEach(b => b.onclick = () => hubSetChallenge(b.dataset.hset));
  if (HUB.boardOpen) hubBoard(HUB.boardOpen, true);
}
async function hubBoard(kind, keepOpen) {
  const box = document.getElementById('board-' + kind); if (!box) return;
  if (!keepOpen && HUB.boardOpen === kind && box.innerHTML) { box.innerHTML = ''; HUB.boardOpen = null; return; }
  HUB.boardOpen = kind; box.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const d = await apiRequest('/api/challenges/' + kind + '/leaderboard', { auth: !!getAuthToken() });
    box.innerHTML = (d.entries.length ? '<div class="song-list">' + d.entries.map(e => `<div class="song-row player-row${e.me ? ' me' : ''}"><div class="song-art ${frameClass(e)}" style="${e.profileIcon ? '' : 'background:' + artGradient(e.username)}">${e.profileIcon ? '<img src="' + escapeHtml(e.profileIcon) + '" alt="">' : escapeHtml(e.username.slice(0, 1).toUpperCase())}</div>
      <div class="song-info"><div class="song-title"><span class="rank">#${e.rank}</span> ${escapeHtml(e.username)}</div><div class="song-sub">Score ${Number(e.score).toLocaleString()}</div></div><div class="player-value">${e.completed ? '✔ 100%' : e.pct + '%'}</div></div>`).join('') + '</div>' : '<div class="empty">Nobody has played it yet. Be first!</div>') +
      (d.mine && !d.entries.some(e => e.me) ? '<div class="note center">You are #' + d.mine.rank + ' · ' + (d.mine.completed ? '✔' : d.mine.pct + '%') + '</div>' : '');
  } catch (e) { box.innerHTML = errorBox(e.message, "hubBoard('" + kind + "', true)"); }
}
async function hubSetChallenge(kind) {
  let list = []; try { list = (await getCommunityLevels('', 'featured')).levels || []; } catch (e) {}
  if (!list.length) { toast('No featured levels to pick from.', 'bad'); return; }
  const r = await openFormDialog({ title: kind === 'daily' ? "Today's daily level" : "This week's level", fields: [{ id: 'id', label: 'Level', type: 'select', value: list[0].id, options: [{ value: '', label: '↺ Automatic (random featured level)' }].concat(list.slice(0, 60).map(l => ({ value: l.id, label: l.name + ' · ' + l.author }))) }], okText: 'Set' });
  if (!r) return;
  try { await apiRequest('/api/admin/' + kind, { method: 'POST', auth: true, body: { levelId: r.id || null } }); toast('Updated.', 'good'); openHub('challenges'); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------- packs & playlists
async function hubPackList(draw, host) {
  const me = getAuthUser(), kinds = [['pack', 'Official packs'], ['playlist', 'Playlists'], ['mine', 'Mine']];
  const d = await apiRequest('/api/packs?kind=' + HUB.packKind, { auth: !!getAuthToken() });
  const canNew = me && (HUB.packKind === 'pack' ? me.isAdmin : true);
  draw('<div class="seg">' + kinds.map(([k, n]) => '<button class="' + (HUB.packKind === k ? 'on' : '') + '" data-pk="' + k + '">' + n + '</button>').join('') + '</div>' +
    (canNew ? '<button class="btn btn-pink" id="pack-new">＋ New ' + (HUB.packKind === 'pack' ? 'pack' : 'playlist') + '</button>' : '') +
    (d.packs.length ? '<div class="song-list">' + d.packs.map(p => `<div class="song-row" data-pack="${p.id}"><div class="song-art" style="background:${artGradient(p.name)}">${p.kind === 'pack' ? '📦' : '▤'}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(p.name)}</div><div class="song-sub">${escapeHtml(p.description || ('by ' + p.owner))}</div>
      <div class="song-meta"><span>${p.levels} levels</span>${p.levels ? '<span>' + p.done + '/' + p.levels + ' beaten</span>' : ''}</div>${p.levels ? '<div class="prog-track"><div class="prog-fill" style="width:' + Math.round(p.done / p.levels * 100) + '%"></div></div>' : ''}</div><button class="play-btn">OPEN</button></div>`).join('') + '</div>' : '<div class="empty">Nothing here yet.</div>'));
  host.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { HUB.packKind = b.dataset.pk; openHub('packs'); });
  host.querySelectorAll('[data-pack]').forEach(r => r.onclick = () => { HUB.packId = Number(r.dataset.pack); HUB.pickerList = null; openHub('packs'); });
  const nb = document.getElementById('pack-new'); if (nb) nb.onclick = async () => {
    const kind = HUB.packKind === 'pack' ? 'pack' : 'playlist';
    const r = await openFormDialog({ title: 'New ' + kind, fields: [{ id: 'name', label: 'Name', value: '', maxlength: 60 }, { id: 'description', label: 'Description (optional)', value: '', maxlength: 200 }], okText: 'Create' });
    if (!r || !r.name) return;
    try { const c = await apiRequest('/api/packs', { method: 'POST', auth: true, body: { kind, name: r.name, description: r.description } }); HUB.packId = c.id; openHub('packs'); } catch (e) { toast(e.message, 'bad'); }
  };
}
async function hubPackView(draw, host) {
  const me = getAuthUser(), d = await apiRequest('/api/packs/' + HUB.packId, { auth: !!getAuthToken() }), p = d.pack, can = !!me && (p.mine || me.isAdmin);
  const done = p.levels.filter(l => l.myDone).length;
  draw(`<button class="btn small" id="pack-back">← All</button> <b>${escapeHtml(p.name)}</b> <small>${p.kind === 'pack' ? '📦 official pack' : 'playlist by ' + escapeHtml(p.owner)}</small>
    ${p.description ? '<div class="note">' + escapeHtml(p.description) + '</div>' : ''}
    ${p.levels.length ? '<div class="note">' + done + '/' + p.levels.length + ' beaten</div><div class="prog-track"><div class="prog-fill" style="width:' + Math.round(done / p.levels.length * 100) + '%"></div></div>' : ''}
    ${can ? '<div class="btn-row"><button class="btn small" id="pack-add">＋ Add levels</button><button class="btn small btn-ghost" id="pack-rename">✎ Rename</button><button class="btn small btn-danger" id="pack-del">🗑 Delete</button></div>' : ''}
    <div id="pack-picker"></div>
    ${p.levels.length ? '<div class="song-list">' + p.levels.map((l, i) => `<div class="song-row" data-lv="${escapeHtml(l.id)}"><div class="song-art" style="background:${artGradient(l.name)}">${l.myDone ? '✔' : i + 1}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.author)} · ${escapeHtml(l.difficulty || '')}${l.myPct && !l.myDone ? ' · best ' + l.myPct + '%' : ''}</div></div>
      ${can ? '<div class="admin-actions"><button class="btn small" data-mv="-1" data-id="' + escapeHtml(l.id) + '">↑</button><button class="btn small" data-mv="1" data-id="' + escapeHtml(l.id) + '">↓</button><button class="btn small btn-danger" data-rm="' + escapeHtml(l.id) + '">✕</button></div>' : '<button class="play-btn">PLAY</button>'}</div>`).join('') + '</div>' : '<div class="empty">No levels yet.</div>'}`);
  document.getElementById('pack-back').onclick = () => { HUB.packId = null; openHub('packs'); };
  host.querySelectorAll('[data-lv]').forEach(r => r.onclick = e => { if (e.target.closest('[data-mv],[data-rm]')) return; playLevelEntry({ id: r.dataset.lv }, 'community'); });
  host.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { try { await apiRequest('/api/packs/' + p.id + '/levels/' + b.dataset.rm, { method: 'DELETE', auth: true }); openHub('packs'); } catch (e) { toast(e.message, 'bad'); } });
  host.querySelectorAll('[data-mv]').forEach(b => b.onclick = async () => {
    const ids = p.levels.map(l => l.id), i = ids.indexOf(b.dataset.id), j = i + Number(b.dataset.mv); if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await apiRequest('/api/packs/' + p.id + '/order', { method: 'PUT', auth: true, body: { levelIds: ids } }); openHub('packs'); } catch (e) { toast(e.message, 'bad'); }
  });
  const ren = document.getElementById('pack-rename'); if (ren) ren.onclick = async () => {
    const r = await openFormDialog({ title: 'Rename', fields: [{ id: 'name', label: 'Name', value: p.name, maxlength: 60 }, { id: 'description', label: 'Description', value: p.description, maxlength: 200 }], okText: 'Save' });
    if (!r || !r.name) return; try { await apiRequest('/api/packs/' + p.id, { method: 'PUT', auth: true, body: r }); openHub('packs'); } catch (e) { toast(e.message, 'bad'); }
  };
  const del = document.getElementById('pack-del'); if (del) del.onclick = async () => {
    if (!(await uiConfirm('Delete "' + p.name + '"? The levels themselves stay.', 'Delete', true))) return;
    try { await apiRequest('/api/packs/' + p.id, { method: 'DELETE', auth: true }); HUB.packId = null; openHub('packs'); } catch (e) { toast(e.message, 'bad'); }
  };
  const add = document.getElementById('pack-add'); if (add) add.onclick = () => hubPicker(p);
}
async function hubPicker(p) {
  const box = document.getElementById('pack-picker'); if (!box) return;
  const inPack = new Set(p.levels.map(l => l.id));
  const show = list => {
    box.innerHTML = '<div class="searchbar"><span>🔎</span><input type="text" id="picker-q" placeholder="Search levels or authors…" value="' + escapeHtml(HUB.pickerQ) + '"><button class="btn small" id="picker-go">Search</button></div><div class="song-list">' +
      (list.length ? list.slice(0, 30).map(l => `<div class="song-row"><div class="song-art" style="background:${artGradient(l.name)}">♪</div><div class="song-info"><div class="song-title">${escapeHtml(l.name)}</div><div class="song-sub">by ${escapeHtml(l.author)}</div></div>
        <button class="btn small ${inPack.has(l.id) ? '' : 'btn-play'}" data-padd="${escapeHtml(l.id)}" ${inPack.has(l.id) ? 'disabled' : ''}>${inPack.has(l.id) ? 'Added' : '＋ Add'}</button></div>`).join('') : '<div class="empty">No levels found.</div>') + '</div>';
    const go = async () => { HUB.pickerQ = document.getElementById('picker-q').value.trim(); try { show((await getCommunityLevels(HUB.pickerQ, HUB.pickerQ ? 'recent' : 'featured')).levels || []); } catch (e) { toast(e.message, 'bad'); } };
    document.getElementById('picker-go').onclick = go; document.getElementById('picker-q').onkeydown = e => { if (e.key === 'Enter') go(); };
    box.querySelectorAll('[data-padd]').forEach(b => b.onclick = async () => {
      try { await apiRequest('/api/packs/' + p.id + '/levels', { method: 'POST', auth: true, body: { levelId: b.dataset.padd } }); inPack.add(b.dataset.padd); b.textContent = 'Added'; b.disabled = true; b.classList.remove('btn-play'); }
      catch (e) { toast(e.message, 'bad'); }
    });
  };
  box.innerHTML = '<div class="empty">Loading…</div>';
  try { show((await getCommunityLevels(HUB.pickerQ, HUB.pickerQ ? 'recent' : 'featured')).levels || []); } catch (e) { box.innerHTML = errorBox(e.message, 'void 0'); }
}
// "＋ Playlist" on a level's detail screen
async function addToPackDialog(level) {
  if (!getAuthToken()) { toast('Log in first.', 'bad'); return; }
  let mine = []; try { mine = (await apiRequest('/api/packs?kind=mine', { auth: true })).packs || []; } catch (e) {}
  if (getAuthUser().isAdmin) { try { const official = (await apiRequest('/api/packs?kind=pack', { auth: true })).packs || []; official.forEach(o => { if (!mine.some(m => m.id === o.id)) mine.push(o); }); } catch (e) {} }
  const opts = mine.map(p => ({ value: String(p.id), label: (p.kind === 'pack' ? '📦 ' : '▤ ') + p.name })).concat([{ value: 'new', label: '＋ New playlist…' }]);
  const r = await openFormDialog({ title: 'Add "' + level.name + '" to…', fields: [{ id: 'pack', label: 'Set', type: 'select', value: opts[0].value, options: opts }], okText: 'Add' });
  if (!r) return;
  try {
    let id = r.pack;
    if (id === 'new') { const n = await openFormDialog({ title: 'New playlist', fields: [{ id: 'name', label: 'Name', value: '', maxlength: 60 }], okText: 'Create' }); if (!n || !n.name) return; id = (await apiRequest('/api/packs', { method: 'POST', auth: true, body: { kind: 'playlist', name: n.name } })).id; }
    const d = await apiRequest('/api/packs/' + id + '/levels', { method: 'POST', auth: true, body: { levelId: level.id } });
    toast(d.added ? 'Added!' : 'Already in that set.', d.added ? 'good' : '');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------- friends' activity
async function hubFeed(draw, host) {
  if (!getAuthToken()) { draw(needLogin("see what your friends are playing")); return; }
  const d = await apiRequest('/api/activity', { auth: true });
  const playing = await liveListFriends();
  const verb = a => a.type === 'beat' ? 'beat' : a.type === 'publish' ? 'published' : 'played';
  const extra = a => a.type === 'beat' && a.data && a.data.score ? ' · ' + Number(a.data.score).toLocaleString() + ' pts' : a.type === 'played' && a.data && a.data.pct ? ' · reached ' + a.data.pct + '%' : '';
  draw((playing.length ? '<div class="section-title">PLAYING NOW</div><div class="song-list">' + playing.map(r => `<div class="song-row"><div class="song-art" style="background:${artGradient(r.username)}">▶</div><div class="song-info"><div class="song-title"><b>${escapeHtml(r.username)}</b> is playing ${escapeHtml(r.levelName || 'a level')}</div><div class="song-sub">${Math.floor(r.t)}s in</div></div><button class="btn small" data-watch="${escapeHtml(r.userId)}">👁 Watch</button></div>`).join('') + '</div>' : '') +
    '<div class="settings-row"><span>Hide my activity from friends</span><input type="checkbox" id="feed-hide"' + (d.hidden ? ' checked' : '') + '></div>' +
    (d.items.length ? '<div class="song-list">' + d.items.map(a => `<div class="song-row" ${a.levelId ? 'data-lv="' + escapeHtml(a.levelId) + '"' : ''}><div class="song-art" style="background:${artGradient(a.username)}">${a.type === 'beat' ? '🏁' : a.type === 'publish' ? '🚀' : '🎮'}</div>
      <div class="song-info"><div class="song-title"><b>${escapeHtml(a.username)}</b> ${verb(a)} ${escapeHtml(a.levelName)}</div><div class="song-sub">${timeAgo(a.at)}${extra(a)}</div></div></div>`).join('') + '</div>' : '<div class="empty">Nothing yet. Add friends from the Friends screen and their plays show up here.</div>'));
  document.getElementById('feed-hide').onchange = async e => { try { await apiRequest('/api/activity/privacy', { method: 'PUT', auth: true, body: { hidden: e.target.checked } }); toast(e.target.checked ? 'Your activity is hidden.' : 'Friends can see your activity.'); } catch (er) { toast(er.message, 'bad'); } };
  host.querySelectorAll('[data-lv]').forEach(r => r.onclick = () => hubOpenLevel(r.dataset.lv));
  host.querySelectorAll('[data-watch]').forEach(b => b.onclick = e => { e.stopPropagation(); liveWatchFriend(b.dataset.watch); });
}
async function hubOpenLevel(id) { try { const full = await getCommunityLevel(id); openLevelDetail(full, 'community'); } catch (e) { toast('That level is gone.', 'bad'); } }

// ---------------------------------------------------------------- alerts
async function hubAlerts(draw, host) {
  if (!getAuthToken()) { draw(needLogin('get alerts')); return; }
  const d = await apiRequest('/api/notifications', { auth: true });
  setHubBadge(d.unread);
  const icon = t => ({ reply: '↩', like: '❤', rate: '★', featured: '🏅', comment: '💬', friend: '👥' }[t] || '🔔');
  draw((d.unread ? '<button class="btn small" id="alerts-read">Mark all read</button>' : '') +
    (d.items.length ? '<div class="song-list">' + d.items.map(n => `<div class="song-row alert-row${n.read ? '' : ' unread'}" data-nid="${n.id}" ${n.levelId ? 'data-lv="' + escapeHtml(n.levelId) + '"' : ''}><div class="song-art">${icon(n.type)}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(n.text)}</div><div class="song-sub">${timeAgo(n.at)}</div></div></div>`).join('') + '</div>' : '<div class="empty">No alerts yet. You will hear about replies, likes, ratings and featured levels here.</div>'));
  const mr = document.getElementById('alerts-read'); if (mr) mr.onclick = async () => { try { await apiRequest('/api/notifications/read', { method: 'POST', auth: true, body: {} }); openHub('alerts'); } catch (e) {} };
  host.querySelectorAll('[data-nid]').forEach(r => r.onclick = async () => {
    try { await apiRequest('/api/notifications/read', { method: 'POST', auth: true, body: { id: r.dataset.nid } }); } catch (e) {}
    if (r.dataset.lv) hubOpenLevel(r.dataset.lv); else openHub('alerts');
  });
}

// ---------------------------------------------------------------- settings: ghosts
function initGhostSettings() {
  const on = document.getElementById('setting-ghost'), src = document.getElementById('setting-ghost-src');
  if (on) { on.checked = lsGet('et_ghost') !== '0'; on.addEventListener('change', () => { try { localStorage.setItem('et_ghost', on.checked ? '1' : '0'); } catch (e) {} }); }
  const cb = document.getElementById('setting-cb'), ol = document.getElementById('setting-outline'), calm = document.getElementById('setting-calm');
  if (cb) { cb.checked = a11yCb; cb.addEventListener('change', () => { try { localStorage.setItem('et_cb', cb.checked ? '1' : '0'); } catch (e) {} setA11y('cb', cb.checked); }); setA11y('cb', a11yCb); }
  if (ol) { ol.value = String(a11yOutline); ol.addEventListener('change', () => { try { localStorage.setItem('et_outline', ol.value); } catch (e) {} setA11y('outline', ol.value); }); }
  if (calm) { calm.checked = a11yCalm; calm.addEventListener('change', () => { try { localStorage.setItem('et_calm', calm.checked ? '1' : '0'); } catch (e) {} setA11y('calm', calm.checked); }); }
  const me = document.getElementById('setting-metronome'), tb = document.getElementById('setting-tbar');
  if (me) { me.checked = metroOn; me.addEventListener('change', () => { try { localStorage.setItem('et_metro', me.checked ? '1' : '0'); } catch (e) {} setRhythm('metro', me.checked); }); }
  if (tb) { tb.checked = timingBarOn; tb.addEventListener('change', () => { try { localStorage.setItem('et_tbar', tb.checked ? '1' : '0'); } catch (e) {} setRhythm('tbar', tb.checked); }); }
  const ls = document.getElementById('setting-liveshare');
  if (ls) { ls.checked = liveShareOn(); ls.addEventListener('change', () => { try { localStorage.setItem('et_liveShare', ls.checked ? '1' : '0'); } catch (e) {} }); }
  const ms = document.getElementById('setting-mousesnap'), mp = document.getElementById('setting-mousesnap-pos');
  if (ms) { ms.checked = mouseSnapOn; ms.addEventListener('change', () => { try { localStorage.setItem('et_mouseSnap', ms.checked ? '1' : '0'); } catch (e) {} setMouseSnap(ms.checked, mp && mp.value); }); }
  if (mp) { mp.value = mouseSnapPos; mp.addEventListener('change', () => { try { localStorage.setItem('et_mouseSnapPos', mp.value); } catch (e) {} setMouseSnap(ms ? ms.checked : true, mp.value); }); }
  if (src) { src.value = lsGet('et_ghostSrc') === 'top' ? 'top' : 'mine'; src.addEventListener('change', () => { try { localStorage.setItem('et_ghostSrc', src.value); } catch (e) {} }); }
}
// ---------------------------------------------------------------- stream thumbnails
function makeStreamThumb(srcCanvas, fmt) {
  try {
    const wide = fmt === 'wide', c = document.createElement('canvas'); c.width = wide ? 320 : 180; c.height = wide ? 180 : 320;
    c.getContext('2d').drawImage(srcCanvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } catch (e) { return null; }
}
function dataUrlToJpegBlob(u) { try { const b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: 'image/jpeg' }); } catch (e) { return null; } }

function socialBoot() {
  initGhostSettings(); injectHubButton(); refreshHubCount();
  setInterval(refreshHubCount, 90000);
  [1500, 4000].forEach(t => setTimeout(injectHubButton, t));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', socialBoot); else socialBoot();


// ---------------------------------------------------------------- collab: live cursors + notes pinned to a moment
const COLLAB = { id: null, peers: new Map(), notes: [], lastSend: 0, cur: { lane: -1, time: 0 }, lastPh: -1 };
const peerColor = name => 'hsl(' + (hashString(String(name || '?')) % 360) + ',85%,60%)';
function collabAttach(s) {
  liveAttach(s);
  s.on('connect', () => { if (COLLAB.id) s.emit('draft_join', { id: COLLAB.id }); });
  s.on('draft_peers', d => { if (!d || d.draftId !== COLLAB.id) return; COLLAB.peers.clear(); (d.peers || []).forEach(p => COLLAB.peers.set(p.id, { name: p.name, lane: -1, time: 0, playhead: 0, seen: performance.now() })); collabBtnUpdate(); });
  s.on('draft_peer_join', p => { if (!COLLAB.id || !p) return; COLLAB.peers.set(p.id, { name: p.name, lane: -1, time: 0, playhead: 0, seen: performance.now() }); toast(p.name + ' joined this level.'); collabBtnUpdate(); });
  s.on('draft_peer_leave', p => { if (p) { const o = COLLAB.peers.get(p.id); COLLAB.peers.delete(p.id); if (o) toast(o.name + ' left.'); collabBtnUpdate(); } });
  s.on('draft_cursor', c => { if (!COLLAB.id || !c) return; const p = COLLAB.peers.get(c.id) || { name: c.name }; Object.assign(p, { name: c.name, lane: c.lane, time: c.time, playhead: c.playhead, seen: performance.now() }); COLLAB.peers.set(c.id, p); });
  s.on('draft_note', d => { if (d && d.draftId === COLLAB.id && d.note && !COLLAB.notes.some(n => n.id === d.note.id)) { COLLAB.notes.push(d.note); collabBtnUpdate(); if (d.note.user !== (getAuthUser() || {}).username) toast('📌 ' + d.note.user + ': ' + d.note.text.slice(0, 60)); collabNotesRefresh(); } });
  s.on('draft_note_update', d => {
    if (!d || d.draftId !== COLLAB.id || !d.note) return;
    if (d.note.deleted) COLLAB.notes = COLLAB.notes.filter(n => n.id !== d.note.id);
    else { const i = COLLAB.notes.findIndex(n => n.id === d.note.id); if (i >= 0) COLLAB.notes[i] = d.note; }
    collabBtnUpdate(); collabNotesRefresh();
  });
}
function collabBtnUpdate() {
  let b = document.getElementById('collab-btn');
  if (!COLLAB.id) { if (b) b.classList.add('hidden'); return; }
  if (!b) { b = document.createElement('button'); b.id = 'collab-btn'; b.className = 'btn small'; b.onclick = openDraftNotes; document.body.appendChild(b); }
  b.classList.remove('hidden');
  const open = COLLAB.notes.filter(n => !n.resolved).length, who = [...COLLAB.peers.values()].map(p => p.name);
  b.innerHTML = '📌 Notes' + (open ? ' (' + open + ')' : '') + (who.length ? '<span class="collab-who"> · ' + escapeHtml(who.slice(0, 3).join(', ')) + (who.length > 3 ? '…' : '') + '</span>' : '');
}
async function collabLoadNotes() {
  try { COLLAB.notes = (await apiRequest('/api/drafts/' + encodeURIComponent(COLLAB.id) + '/notes', { auth: true })).notes || []; collabBtnUpdate(); } catch (e) {}
}
function collabTick() {
  const want = (typeof inEditor !== 'undefined' && inEditor && currentDraft && currentDraft.id) ? currentDraft.id : null;
  if (want !== COLLAB.id) {
    if (COLLAB.id) emitBattle('draft_leave', {});
    COLLAB.id = want; COLLAB.peers.clear(); COLLAB.notes = []; COLLAB.lastPh = -1;
    collabBtnUpdate();
    if (want && getAuthToken() && API_BASE_URL) {
      if (!battleSocket || !battleSocket.connected) { try { connectBattle().catch(() => {}); } catch (e) {} }
      setTimeout(() => emitBattle('draft_join', { id: want }), 900);
      collabLoadNotes();
    }
    return;
  }
  if (COLLAB.id && Math.abs(editorTimer - COLLAB.lastPh) > 0.05) { COLLAB.lastPh = editorTimer; emitBattle('draft_cursor', { lane: COLLAB.cur.lane, time: COLLAB.cur.time, playhead: editorTimer }); }
}
setInterval(collabTick, 400);
canvas.addEventListener('pointermove', e => {
  if (!COLLAB.id || !inEditor) return;
  const now = performance.now(); if (now - COLLAB.lastSend < 80) return; COLLAB.lastSend = now;
  const p = boardPoint(e), lane = Math.floor(p.x / laneW);
  COLLAB.cur = { lane: lane >= 0 && lane < 4 ? lane : -1, time: Math.max(0, editorTimer - (p.y - lineY) / getEditorPPS()) };
  COLLAB.lastPh = editorTimer; emitBattle('draft_cursor', { lane: COLLAB.cur.lane, time: COLLAB.cur.time, playhead: editorTimer });
});
function drawCollab() {
  if (!COLLAB.id) return;
  const pps = getEditorPPS(), now = performance.now();
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '700 11px system-ui, sans-serif';
  COLLAB.peers.forEach(p => {
    if (now - p.seen > 8000) return;
    const col = peerColor(p.name), tag = (x, y, text) => { const w = ctx.measureText(text).width + 10; ctx.fillStyle = col; ctx.fillRect(x, y - 8, w, 16); ctx.fillStyle = '#000'; ctx.fillText(text, x + 5, y); };
    const py = lineY + (editorTimer - p.playhead) * pps;
    if (py > -10 && py < GH + 10 && Math.abs(p.playhead - editorTimer) > 0.02) { ctx.globalAlpha = 0.7; ctx.strokeStyle = col; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(GW, py); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; tag(GW - ctx.measureText(p.name).width - 14, py, p.name); }
    if (p.lane >= 0 && now - p.seen < 3500) {
      const x = p.lane * laneW + laneW / 2, y = lineY + (editorTimer - p.time) * pps;
      if (y > -20 && y < GH + 20) { ctx.globalAlpha = Math.max(0.35, 1 - (now - p.seen) / 3500); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 13, y + 6); ctx.lineTo(x + 5, y + 8); ctx.lineTo(x + 2, y + 15); ctx.closePath(); ctx.fill(); tag(x + 12, y + 14, p.name); ctx.globalAlpha = 1; }
    }
  });
  COLLAB.notes.forEach(n => {
    if (n.resolved) return; const y = lineY + (editorTimer - n.time) * pps; if (y < -16 || y > GH + 16) return;
    ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, y - 9, Math.min(150, ctx.measureText('📌 ' + n.text).width + 10), 18);
    ctx.fillStyle = '#000'; ctx.fillText('📌 ' + n.text.slice(0, 22), 4, y); ctx.globalAlpha = 1;
  });
  ctx.restore();
}
const fmtNoteTime = t => { t = Math.max(0, Number(t) || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
function collabNotesRefresh() { const m = document.getElementById('draft-notes-menu'); if (m && !m.classList.contains('hidden')) openDraftNotes(true); }
function openDraftNotes(refresh) {
  if (!COLLAB.id) return;
  const host = ensureOverlay('draft-notes-menu'); if (refresh !== true) toggleMenu('draft-notes-menu');
  const me = (getAuthUser() || {}).username, isOwner = currentDraft && currentDraft.role === 'owner';
  const rows = COLLAB.notes.slice().sort((a, b) => a.time - b.time).map(n => `<div class="song-row note-row ${n.resolved ? 'done' : ''}" data-n="${n.id}">
    <div class="song-info"><div class="song-title">${escapeHtml(n.text)}</div><div class="song-meta"><span>${fmtNoteTime(n.time)}</span><span>${escapeHtml(n.user)}</span>${n.resolved ? '<span>resolved</span>' : ''}</div></div>
    <button class="btn small" data-act="go">Go</button><button class="btn small btn-ghost" data-act="res">${n.resolved ? '↺' : '✓'}</button>${n.user === me || isOwner ? '<button class="btn small btn-danger" data-act="del">🗑</button>' : ''}</div>`).join('');
  host.innerHTML = screenHtml('NOTES', 'toggleMenu(null)', (rows ? '<div class="song-list">' + rows + '</div>' : '<div class="empty">No notes yet.<br>Add one at the playhead - everyone on this level sees it, pinned to that moment.</div>') + '<button class="btn btn-play" id="note-add">📌 Add a note at ' + fmtNoteTime(editorTimer) + '</button>');
  host.querySelector('#note-add').onclick = async () => {
    const text = await uiPrompt('Note for ' + fmtNoteTime(editorTimer) + ':', '', 'Add');
    if (!text || !text.trim()) return;
    try { await apiRequest('/api/drafts/' + encodeURIComponent(COLLAB.id) + '/notes', { method: 'POST', auth: true, body: { time: editorTimer, text: text.trim() } }); }
    catch (e) { toast(e.message, 'bad'); }
  };
  host.querySelectorAll('.note-row button').forEach(b => b.onclick = async () => {
    const id = Number(b.closest('.note-row').dataset.n), n = COLLAB.notes.find(x => x.id === id); if (!n) return;
    try {
      if (b.dataset.act === 'go') { toggleMenu(null); setEditorTime(Math.max(0, n.time - 1)); }
      else if (b.dataset.act === 'res') await apiRequest('/api/drafts/' + COLLAB.id + '/notes/' + id, { method: 'PATCH', auth: true, body: { resolved: !n.resolved } });
      else if (b.dataset.act === 'del') await apiRequest('/api/drafts/' + COLLAB.id + '/notes/' + id, { method: 'DELETE', auth: true });
    } catch (e) { toast(e.message, 'bad'); }
  });
}


// ---------------------------------------------------------------- spectate friends (live)
const liveShareOn = () => lsGet('et_liveShare') !== '0';
const SPEC = { on: false, sentH: 0, sentW: 0, lastSend: 0, listCb: null, spec: null };
function liveStart() {
  SPEC.on = false;
  if (!liveShareOn() || !getAuthToken() || !API_BASE_URL || !battleSocket || !battleSocket.connected || localStorage.getItem('et_imp_backup')) return;
  const id = replayLevelId(); if (!id) return;
  SPEC.on = true; SPEC.sentH = 0; SPEC.sentW = 0; SPEC.lastSend = 0;
  emitBattle('run_start', { levelId: id, levelName: (lastStartArgs && lastStartArgs[0]) || '', salt: dSalt });
}
function liveFlush(force) {
  if (!SPEC.on || !rec) return;
  const now = performance.now(); if (!force && now - SPEC.lastSend < 150) return;
  const h = rec.h.slice(SPEC.sentH, SPEC.sentH + 60), w = rec.w.slice(SPEC.sentW, SPEC.sentW + 30);
  if (!h.length && !w.length && now - SPEC.lastSend < 1500) return;
  SPEC.sentH += h.length; SPEC.sentW += w.length; SPEC.lastSend = now;
  emitBattle('run_batch', { h, w, t: customPlayTime });
}
function liveFinish(r, completed) {
  if (!SPEC.on) return;
  if (r) { const rr = rec; rec = r; liveFlush(true); rec = rr; }
  SPEC.on = false;
  emitBattle('run_end', { died: r && r.died ? String(r.died) : null, end: r ? (r.end || Math.round(customPlayTime * 1000)) : 0, completed: !!completed });
}
setInterval(() => {
  if (SPEC.on && rec) liveFlush(false);
  else if (SPEC.on && !gameActive) { SPEC.on = false; emitBattle('run_end', { quit: true }); }   // left the level without finishing
}, 120);
function liveListFriends() {
  return new Promise(res => {
    if (!battleSocket || !battleSocket.connected) { res([]); return; }
    const t = setTimeout(() => { SPEC.listCb = null; res([]); }, 2000);
    SPEC.listCb = runs => { clearTimeout(t); SPEC.listCb = null; res(runs || []); };
    emitBattle('run_list', {});
  });
}
function liveWatchFriend(userId) { if (!battleSocket || !battleSocket.connected) { toast('Connecting… try again in a moment.', 'bad'); return; } toast('Joining…'); emitBattle('run_watch', { userId }); }
function liveUnwatch() { SPEC.spec = null; emitBattle('run_unwatch', {}); }
async function liveBeginWatch(info) {
  try {
    const full = await getCommunityLevel(info.levelId);
    SPEC.spec = { userId: info.userId };
    replayPlay = { levelId: full.id, username: info.username, pct: 0, completed: false, live: true, userId: info.userId, i: 0, wi: 0, startAt: Math.max(0, (info.t || 0) - 1.5),
      data: { h: (info.h || []).slice(), w: (info.w || []).slice(), end: 0, died: null, salt: info.salt } };
    startGame(full.name, true, -1, full.data, full.effects || [], true, full);
  } catch (e) { toast('Could not load that level.', 'bad'); emitBattle('run_unwatch', {}); }
}
function liveAttach(s) {
  s.on('run_list', d => { if (SPEC.listCb) SPEC.listCb(d && d.runs); });
  s.on('run_watching', d => { if (!d || d.error) { toast((d && d.error) || 'Could not watch.', 'bad'); return; } liveBeginWatch(d); });
  s.on('run_batch', d => {
    if (!d || !SPEC.spec || d.userId !== SPEC.spec.userId || !replayPlay || !replayPlay.live) return;
    replayPlay.data.h.push(...(d.h || [])); replayPlay.data.w.push(...(d.w || []));
    if (Math.abs(customPlayTime - (d.t - 1.5)) > 4 && !isDead) emitBattle('run_watch', { userId: d.userId });   // drifted too far: rejoin at their current spot
  });
  s.on('run_end', d => {
    if (!d || !SPEC.spec || d.userId !== SPEC.spec.userId || !replayPlay || !replayPlay.live) return;
    if (d.quit) { toast(replayPlay.username + ' left the level.'); return; }
    if (d.died) { replayPlay.data.died = d.died; replayPlay.data.end = d.end || Math.round(customPlayTime * 1000) + 1500; }
    else if (d.completed) toast(replayPlay.username + ' finished the level!', 'good');
  });
  s.on('run_start', d => { if (d && SPEC.spec && d.userId === SPEC.spec.userId) setTimeout(() => emitBattle('run_watch', { userId: d.userId }), 400); });
}
