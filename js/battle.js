// ============================================================================
// battle.js — REAL online 1v1 battles over Socket.IO (server: 06-Tiles-Backend).
//
// Before this, "online" meant other tabs in the same browser (BroadcastChannel)
// and the server had no socket support at all. Now the server owns presence,
// matchmaking, challenges, the synchronized start, and the final result; this
// file is just the client for it. Guests get a random "Guest-XXXX" name.
// ============================================================================
let battleSocket = null;
let battleConnState = 'offline';      // offline | connecting | online | error
let battleMe = { id: null, name: currentProfile };
let onlinePlayers = [];
let activeMatch = null;               // { matchId, opponent, level }
let myBattleResult = null;
let pendingChallengeId = null;
let incomingChallengeId = null;
let lastProgressBroadcast = 0;
let battlePickTarget = null;

function getGuestId() {
  let id = localStorage.getItem('et_guestId');
  if (!id) { id = Math.random().toString(36).slice(2, 6); localStorage.setItem('et_guestId', id); }
  return id;
}

function loadSocketClient() {
  return new Promise((resolve, reject) => {
    if (typeof io !== 'undefined') return resolve();
    const s = document.createElement('script');
    s.src = API_BASE_URL.replace(/\/$/, '') + '/socket.io/socket.io.js';
    s.onload = () => (typeof io !== 'undefined' ? resolve() : reject(new Error('socket client missing')));
    s.onerror = () => reject(new Error('Could not load the battle client from the server.'));
    document.head.appendChild(s);
  });
}

function setBattleConn(state, text) {
  battleConnState = state;
  const el = document.getElementById('battle-conn');
  if (el) { el.textContent = text; el.className = 'conn-pill ' + state; }
}

async function connectBattle() {
  if (battleSocket && (battleSocket.connected || battleConnState === 'connecting')) return;
  if (!API_BASE_URL) { setBattleConn('error', 'No server configured'); return; }
  setBattleConn('connecting', 'Connecting… (the server can take ~30s to wake up)');
  try { await loadSocketClient(); }
  catch (e) { setBattleConn('error', 'Server offline - tap to retry'); return; }
  if (battleSocket) { battleSocket.removeAllListeners(); battleSocket.disconnect(); }
  battleSocket = io(API_BASE_URL, { auth: { token: getAuthToken() || undefined, guestId: getGuestId() }, transports: ['websocket', 'polling'], reconnectionAttempts: 6 });
  const s = battleSocket;
  if (typeof registerLiveHandlers === 'function') registerLiveHandlers(s);

  s.on('connect', () => { setBattleConn('online', 'Online'); if (globeLevelId) s.emit('globe_join', { levelId: globeLevelId }); });
  s.on('connect_error', err => {
    if (err && err.message === 'banned') { setBattleConn('error', 'Account banned'); toast('Your account is banned.', 'bad'); return; }
    setBattleConn('error', 'Server unreachable - tap to retry');
  });
  s.on('globe_tap', d => { if (globeOn) globeGhosts.set(d.name, { idx: d.idx, lane: d.lane, ts: performance.now(), pct: d.idx / Math.max(1, pendingTiles.length) }); });
  s.on('globe_presence', d => { globePresence.count = d.count; });
  s.on('announcement', d => uiAlert(d.message, '📢 Announcement'));
  s.on('news_posted', d => { if (typeof onNewsPosted === 'function') onNewsPosted(d); });
  s.on('settings_changed', d => { if (d.maxBpm) maxBpm = d.maxBpm; showAnnouncement(d.announcement); });
  s.on('elo_change', d => toast('Battle rating ' + (d.delta >= 0 ? '+' : '') + d.delta, d.delta >= 0 ? 'good' : 'bad'));
  s.on('friend_request', d => toast(d.from + ' sent you a friend request.'));
  s.on('spectate_matches', list => renderSpectateList(list));
  s.on('spectate_failed', d => { toast(d.message, 'bad'); emitBattle('spectate_list'); });
  s.on('spec_state', d => updateSpectateView(d));
  s.on('spec_progress', d => updateSpectateProgress(d));
  s.on('banned', d => { if (typeof handleBanned === 'function') handleBanned(d); });
  s.on('warning', d => { if (typeof showWarning === 'function') showWarning(d.message); });
  s.on('disconnect', () => {
    setBattleConn('offline', 'Disconnected');
    if (typeof liveOnDisconnect === 'function') liveOnDisconnect();
    onlinePlayers = []; renderOnlinePlayers();
    if (activeMatch && !myBattleResult) { toast('Lost connection to the server.', 'bad'); abortMatchLocally(); }
  });
  s.on('welcome', d => { battleMe = d; const el = document.getElementById('battle-me'); if (el) el.textContent = 'Playing as ' + d.name; });
  s.on('presence', list => { onlinePlayers = list; renderOnlinePlayers(); });

  s.on('queue_error', d => { toast(d.message, 'bad'); toggleMenu('battle-menu'); });
  s.on('challenge_failed', d => { toast(d.message, 'bad'); if (!activeMatch) toggleMenu('battle-menu'); });
  s.on('challenge_sent', d => { pendingChallengeId = d.challengeId; setWaiting('Waiting for ' + d.to + '…', 'They have 30 seconds to accept.'); });
  s.on('challenge_declined', d => { toast(d.name + ' declined.', 'bad'); pendingChallengeId = null; toggleMenu('battle-menu'); });
  s.on('challenge_expired', () => { toast('Challenge expired.'); pendingChallengeId = null; incomingChallengeId = null; if (!activeMatch) toggleMenu('battle-menu'); });
  s.on('challenge_cancelled', () => { incomingChallengeId = null; if (!activeMatch) { toast('The challenge was cancelled.'); toggleMenu('battle-menu'); } });
  s.on('challenge_received', d => {
    if (gameActive || inEditor) return;
    incomingChallengeId = d.challengeId;
    document.getElementById('battle-incoming-avatar').textContent = d.from.name.slice(0, 1).toUpperCase();
    document.getElementById('battle-incoming-name').textContent = d.from.name;
    document.getElementById('battle-incoming-level').textContent = 'wants to race you on "' + d.level.name + '" (★ ' + (d.level.ratedStars || 0) + ' · ' + d.level.difficulty + ') - first to ' + (d.target || 3) + ' rounds wins';
    toggleMenu('battle-incoming-menu');
  });

  s.on('match_found', d => {
    pendingChallengeId = null; incomingChallengeId = null;
    activeMatch = { matchId: d.matchId, opponent: d.opponent.name, level: d.level, target: d.target || 3 };
    myBattleResult = null;
    battleScore = { you: 0, opp: 0, target: activeMatch.target, round: 1 };
    setWaiting('Match found vs ' + d.opponent.name, 'Rated level: ' + d.level.name + ' · first to ' + activeMatch.target + ' round wins');
    s.emit('match_ready', { matchId: d.matchId });
  });
  s.on('match_go', d => {
    if (!activeMatch || d.matchId !== activeMatch.matchId) return;
    battleScore = { you: d.you || 0, opp: d.opp || 0, target: d.target || activeMatch.target || 3, round: d.round || 1 };
    myBattleResult = null;
    beginMatch(d.countdown || 3);
  });
  s.on('round_end', d => { if (activeMatch && d.matchId === activeMatch.matchId) showRoundResult(d); });
  s.on('match_cancelled', d => { toast(d.message || 'Match cancelled.', 'bad'); abortMatchLocally(); });
  s.on('opp_progress', d => updateOpponentBar(d.pct));
  s.on('opp_finish', d => { if (d.finished) updateOpponentBar(100); else toast(activeMatch ? activeMatch.opponent + ' got knocked out!' : 'Opponent knocked out!'); });
  s.on('opp_left', d => toast(d.name + ' left the match.'));
  s.on('match_result', d => showBattleResult(d));
  s.on('rematch_requested', d => toast(d.name + ' wants a rematch!'));
}

function disconnectBattle() {
  if (battleSocket) { battleSocket.removeAllListeners(); battleSocket.disconnect(); battleSocket = null; }
  onlinePlayers = []; setBattleConn('offline', 'Offline');
}
function emitBattle(event, payload) { if (battleSocket && battleSocket.connected) battleSocket.emit(event, payload); }

// --- lobby ---
function openBattleMenu() {
  toggleMenu('battle-menu'); connectBattle(); renderOnlinePlayers();
  const host = document.querySelector('#battle-menu .screen-col') || document.querySelector('#battle-menu .screen-body') || document.getElementById('battle-menu');
  if (host && !host.querySelector('.battle-extras')) host.insertAdjacentHTML('afterbegin', '<div class="row-btns battle-extras"><button class="btn small btn-ghost" onclick="openFriends()">👥 Friends</button><button class="btn small btn-ghost" onclick="openSpectate()">👁 Spectate</button></div>');
}
function leaveBattleMenu() { if (!activeMatch) disconnectBattle(); toggleMenu('main-menu'); }
function isBattleMenuOpenish() { return !document.getElementById('battle-menu').classList.contains('hidden'); }
function setWaiting(title, sub) {
  document.getElementById('battle-waiting-title').innerText = title;
  document.getElementById('battle-waiting-sub').innerText = sub;
  toggleMenu('battle-waiting-menu');
}

function renderOnlinePlayers() {
  const list = document.getElementById('battle-online-list');
  if (!list) return;
  const q = (document.getElementById('battle-search-input')?.value || '').trim().toLowerCase();
  const others = onlinePlayers.filter(p => p.id !== battleMe.id && (!q || p.name.toLowerCase().includes(q)));
  list.innerHTML = '';
  if (battleConnState !== 'online') { list.innerHTML = '<div class="empty">' + (battleConnState === 'connecting' ? 'Connecting to the battle server…' : 'Not connected.<br><button class="btn btn-ghost small" onclick="connectBattle()">Retry</button>') + '</div>'; return; }
  if (!others.length) { list.innerHTML = '<div class="empty">Nobody else is in the lobby right now.<br>Hit <b>Quick Match</b> and you\'ll be paired as soon as someone joins.</div>'; return; }
  others.forEach(p => {
    const row = document.createElement('div');
    row.className = 'song-row player-row';
    row.innerHTML = `<div class="song-art" style="background:${artGradient(p.name)}">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(p.name)}</div><div class="song-sub"><span class="presence-dot ${p.status !== 'lobby' ? 'busy' : ''}"></span>${p.status === 'lobby' ? 'In lobby' : p.status === 'queue' ? 'Searching…' : 'In a match'}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'play-btn'; btn.textContent = 'CHALLENGE'; btn.disabled = p.status !== 'lobby';
    btn.onclick = () => { battlePickTarget = p; openBattleLevelPicker(); };
    row.appendChild(btn);
    list.appendChild(row);
  });
}

// --- quick match + challenges ---
function startQuickMatch() {
  if (battleConnState !== 'online') { toast('Not connected to the battle server yet.'); connectBattle(); return; }
  emitBattle('queue_join');
  setWaiting('Finding an opponent…', 'You\'ll be paired with the next player who hits Quick Match, on a random RATED level. First to 3 round wins.');
}

async function openBattleLevelPicker() {
  const list = document.getElementById('battle-level-picker-list');
  list.innerHTML = '<div class="empty">Loading rated levels…</div>';
  toggleMenu('battle-level-picker');
  let rated = [];
  try { rated = await getCommunityLevels('', 'featured'); }
  catch (e) { list.innerHTML = errorBox(e.message, 'openBattleLevelPicker()'); return; }
  list.innerHTML = '<div class="note center">Pick a rated level. You race it - the last one standing wins the round, first to 3 rounds wins the battle.</div>';
  if (!rated.length) { list.innerHTML += '<div class="empty">No rated levels yet. An admin needs to rate some first.</div>'; return; }
  rated.forEach(level => {
    const card = renderLevelCard(level, 'community');
    const btn = card.querySelector('.play-btn'); btn.textContent = 'PICK';
    card.onclick = null;
    btn.onclick = card.onclick = e => {
      if (e) e.stopPropagation();
      emitBattle('challenge_send', { toId: battlePickTarget.id, levelId: level.id });
    };
    list.appendChild(card);
  });
}

function acceptChallenge() { if (incomingChallengeId) emitBattle('challenge_respond', { challengeId: incomingChallengeId, accept: true }); incomingChallengeId = null; setWaiting('Starting…', 'Setting up your battle.'); }
function declineChallenge() { if (incomingChallengeId) emitBattle('challenge_respond', { challengeId: incomingChallengeId, accept: false }); incomingChallengeId = null; toggleMenu('battle-menu'); }
function cancelBattleFlow() {
  emitBattle('queue_leave');
  if (pendingChallengeId) emitBattle('challenge_cancel', { challengeId: pendingChallengeId });
  pendingChallengeId = null;
  if (activeMatch && !myBattleResult) leaveActiveMatch();
  toggleMenu('battle-menu');
}

// --- the race ---
function beginMatch(countdown) {
  const level = activeMatch.level;
  document.getElementById('race-name-me').textContent = battleMe.name || 'You';
  document.getElementById('race-name-opp').textContent = activeMatch.opponent;
  document.getElementById('race-bar-me').style.width = '0%';
  document.getElementById('race-bar-opp').style.width = '0%';
  updateRaceScore();
  toggleMenu(null);
  document.getElementById('countdown').classList.remove('hidden');
  runCountdown(countdown, () => {
    if (!activeMatch) return;
    isBattleMode = true;
    document.getElementById('battle-race-hud').classList.remove('hidden');
    startGame(level.name, true, -1, level.data, level.effects || [], false, level);
    document.getElementById('battle-race-hud').classList.remove('hidden');
  });
}

function updateRaceScore() {
  const el = document.getElementById('race-score');
  if (el) el.textContent = 'ROUND ' + battleScore.round + '   ·   ' + battleScore.you + ' – ' + battleScore.opp + '   ·   FIRST TO ' + battleScore.target;
}

// A round ended (somebody was knocked out, or both finished). Stop playing and show the score until the next round.
function showRoundResult(d) {
  stopLoop(); gameActive = false; isDead = true; isBattleMode = false; releaseAllKeys();
  bgAudio.pause(); showGameHud(false);
  document.getElementById('countdown').classList.add('hidden');
  battleScore = { you: d.you, opp: d.opp, target: d.target, round: d.round + 1 };
  const title = d.outcome === 'win' ? 'ROUND ' + d.round + ' WON!' : d.outcome === 'lose' ? 'ROUND ' + d.round + ' LOST' : 'ROUND ' + d.round + ' - DRAW (replay)';
  setWaiting(title + '  ' + d.you + ' – ' + d.opp, 'First to ' + d.target + '. Next round starts in a moment…');
}

function updateOpponentBar(pct) {
  const bar = document.getElementById('race-bar-opp');
  if (bar && pct !== undefined) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function updateBattleProgress(pct, scoreNow) {
  const bar = document.getElementById('race-bar-me');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const now = Date.now();
  if (now - lastProgressBroadcast < 250 || !activeMatch) return;
  lastProgressBroadcast = now;
  emitBattle('match_progress', { matchId: activeMatch.matchId, pct, score: scoreNow });
}

function handleBattleFinish(finished, reason) {
  if (myBattleResult || !activeMatch) return;
  myBattleResult = { finished, score: Math.floor(score), reason };
  showGameHud(false);
  emitBattle('match_finish', { matchId: activeMatch.matchId, finished, score: myBattleResult.score, reason });
  setWaiting(finished ? 'Finished! Waiting for your opponent…' : 'Knocked out (' + (reason || 'FAILED') + ')', finished ? 'If they get knocked out you win the round; if they finish too, the higher score wins.' : 'Your opponent wins this round.');
}

function showBattleResult(d) {
  isBattleMode = false; gameActive = false; stopLoop(); releaseAllKeys(); bgAudio.pause();
  showGameHud(false);
  document.getElementById('countdown').classList.add('hidden');
  const banner = document.getElementById('battle-result-banner');
  banner.className = 'battle-result-banner ' + d.outcome;
  banner.textContent = d.outcome === 'win' ? 'VICTORY' : d.outcome === 'lose' ? 'DEFEAT' : 'DRAW';
  document.getElementById('battle-result-sub').textContent = 'First to ' + (d.target || 3) + ' · vs ' + d.opp.name + (d.forfeit ? ' (they left)' : '');
  document.getElementById('battle-result-my-score').textContent = d.you.rounds;
  document.getElementById('battle-result-opp-score').textContent = d.opp.rounds;
  document.getElementById('battle-result-opp-label').textContent = d.opp.name;
  toggleMenu('battle-result-menu');
}

function rematchBattle() {
  if (!activeMatch) { toggleMenu('battle-menu'); return; }
  myBattleResult = null; battleScore = { you: 0, opp: 0, target: 3, round: 1 };
  emitBattle('rematch_request', { matchId: activeMatch.matchId });
  setWaiting('Waiting for a rematch…', 'Your opponent needs to accept too.');
}

function leaveActiveMatch() {
  if (activeMatch) emitBattle('match_leave', { matchId: activeMatch.matchId });
  activeMatch = null; myBattleResult = null; isBattleMode = false;
  document.getElementById('battle-race-hud').classList.add('hidden');
}
function abortMatchLocally() {
  stopLoop(); gameActive = false; isBattleMode = false; activeMatch = null; myBattleResult = null;
  document.getElementById('countdown').classList.add('hidden');
  bgAudio.pause(); showGameHud(false);
  toggleMenu('battle-menu');
}
function leaveBattleFromResult() { leaveActiveMatch(); toggleMenu('battle-menu'); }

async function forfeitBattlePrompt() {
  if (await uiConfirm('Leave the battle? That counts as a loss.', 'Leave', true)) {
    leaveActiveMatch(); stopLoop(); gameActive = false; bgAudio.pause(); showGameHud(false);
    toggleMenu('battle-menu');
  }
}


// ---------------------------------------------------------------------------
// Globe: see where other players on the same level are
// ---------------------------------------------------------------------------
let globeLevelId = null;
async function globeSync(levelId) {
  if (levelId === undefined) levelId = globeLevelId;
  const want = globeOn && levelId && /^[0-9a-f-]{36}$/i.test(String(levelId)) && API_BASE_URL ? String(levelId) : null;
  if (!want) { if (globeLevelId) emitBattle('globe_leave'); globeLevelId = null; globeGhosts.clear(); return; }
  globeLevelId = want;
  await connectBattle();
  emitBattle('globe_join', { levelId: want });
}
function globeTap(idx, lane) { if (globeLevelId) emitBattle('globe_tap', { levelId: globeLevelId, idx, lane }); }

// ---------------------------------------------------------------------------
// Spectating: a live scoreboard + progress bars for a battle
// ---------------------------------------------------------------------------
let spectating = null;
async function openSpectate() {
  const el = document.getElementById('spectate-menu');
  el.innerHTML = screenHtml('SPECTATE', "toggleMenu('battle-menu')", '<div class="empty">Looking for live battles…</div>');
  toggleMenu('spectate-menu');
  await connectBattle();
  emitBattle('spectate_list');
}
function renderSpectateList(list) {
  const el = document.getElementById('spectate-menu');
  if (!el || el.classList.contains('hidden') || spectating) return;
  el.innerHTML = screenHtml('SPECTATE', "toggleMenu('battle-menu')", '<div class="row-btns"><button class="btn small" onclick="emitBattle(\'spectate_list\')">↻ Refresh</button></div>' +
    (list.length ? '<div class="song-list">' + list.map(m => `<div class="song-row"><div class="song-info"><div class="song-title">${escapeHtml(m.a)} <small>vs</small> ${escapeHtml(m.b)}</div><div class="song-sub">${escapeHtml(m.level)} · round ${m.round} · ${m.scoreA} – ${m.scoreB}</div></div><button class="btn small btn-play" onclick="watchMatch('${m.matchId}')">WATCH</button></div>`).join('') + '</div>' : '<div class="empty">No live battles right now.</div>'));
}
function watchMatch(matchId) { spectating = { matchId, names: [], bars: {} }; emitBattle('spectate_join', { matchId }); }
function leaveSpectate() { spectating = null; emitBattle('spectate_leave'); openSpectate(); }
function updateSpectateView(d) {
  const el = document.getElementById('spectate-menu');
  if (!el || !spectating || d.matchId !== spectating.matchId) return;
  const [a, b] = d.players;
  spectating.names = [a.name, b.name];
  const note = d.over ? '🏁 ' + escapeHtml(d.winner || '') + ' wins the battle!' : d.roundWinner ? 'Round won by ' + escapeHtml(d.roundWinner) : d.roundStart ? 'Round ' + d.round + ' started' : '';
  el.innerHTML = screenHtml('WATCHING', 'leaveSpectate()', `<div class="hero-name center">${escapeHtml(d.level)}</div><div class="spec-score">${escapeHtml(a.name)} <b>${a.rounds}</b> – <b>${b.rounds}</b> ${escapeHtml(b.name)}</div><div class="note center">First to ${d.target} · round ${d.round}</div>
    <div class="spec-bars"><div class="spec-name">${escapeHtml(a.name)}</div><div class="race-track"><i id="spec-bar-0"></i></div><div class="spec-name">${escapeHtml(b.name)}</div><div class="race-track"><i id="spec-bar-1"></i></div></div><div class="note center" id="spec-note">${note}</div>`);
  spectating.bars = {};
}
function updateSpectateProgress(d) {
  if (!spectating || d.matchId !== spectating.matchId) return;
  const i = spectating.names.indexOf(d.name);
  const bar = document.getElementById('spec-bar-' + i);
  if (bar) bar.style.width = d.pct + '%';
}


// ============================================================================
// LIVE STREAMS
// Streamer: the game canvas (+ HUD) is composited onto a 540x960 canvas, captured with captureStream(), mixed with game
// audio and (optionally) the microphone, sent to each viewer over WebRTC and recorded locally so it can be downloaded.
// Viewers: a frame with the video + live chat. The server only relays the WebRTC handshake and chat.
// ============================================================================
const LIVE = { role: null, id: null, title: '', streams: [], ice: [{ urls: 'stun:stun.l.google.com:19302' }], maxViewers: 8,
  peers: new Map(), pc: null, hostId: null, out: null, comp: null, compTimer: 0, mic: null, micOn: true, recorder: null, chunks: [], recBytes: 0, recMime: '',
  viewers: 0, chat: [], startedAt: 0, ac: null, dest: null, bgSrc: null, pendingIce: [] };

function liveCount() { return LIVE.streams.length; }
function updateLiveBadge() {
  const b = document.getElementById('live-badge'); if (!b) return;
  b.textContent = String(liveCount()); b.classList.toggle('hidden', !liveCount());
}
function injectLiveButton() {
  if (document.getElementById('live-btn')) return;
  let rail = document.getElementById('menu-rail');
  if (!rail) { const m = document.getElementById('main-menu'); if (!m) return; rail = document.createElement('div'); rail.id = 'menu-rail'; m.appendChild(rail); }
  const b = document.createElement('button');
  b.id = 'live-btn'; b.className = 'icon-btn rail-btn'; b.setAttribute('aria-label', 'Live');
  b.innerHTML = '🔴<span id="live-badge" class="news-badge live hidden">0</span>';
  b.onclick = openLive; rail.appendChild(b);
}
async function refreshLive() {
  try { const d = await apiRequest('/api/streams'); LIVE.streams = d.streams || []; } catch (e) {}
  updateLiveBadge();
}
async function loadLiveConfig() {
  try { const d = await apiRequest('/api/streams/config'); if (d.iceServers) LIVE.ice = d.iceServers; if (d.maxViewers) LIVE.maxViewers = d.maxViewers; } catch (e) {}
}

function registerLiveHandlers(s) {
  s.on('streams_changed', list => { LIVE.streams = Array.isArray(list) ? list : LIVE.streams; updateLiveBadge(); const m = document.getElementById('live-menu'); if (m && !m.classList.contains('hidden')) renderLive(); });
  s.on('stream_started', d => liveHostStarted(d));
  s.on('stream_error', d => { toast(d.message || 'Stream problem.', 'bad'); if (LIVE.role === 'host' && !LIVE.id) liveTeardown(); });
  s.on('stream_joined', d => liveViewerJoined(d));
  s.on('stream_viewer', d => liveHostAddViewer(d.viewerId));
  s.on('stream_viewer_left', d => liveHostDropViewer(d.viewerId));
  s.on('stream_viewers', d => { if (d.id === LIVE.id) { LIVE.viewers = d.count; liveUpdateCounts(); } });
  s.on('stream_signal', d => liveOnSignal(d));
  s.on('stream_chat', d => { if (d.id === LIVE.id) { LIVE.chat.push(d); if (LIVE.chat.length > 80) LIVE.chat.shift(); liveAppendChat(d); } });
  s.on('stream_ended', d => { if (d.id === LIVE.id) liveEnded(d.reason); });
}

// ---------------------------------------------------------------- list screen
async function openLive() {
  ensureOverlay('live-menu'); toggleMenu('live-menu');
  renderLive();
  await Promise.all([refreshLive(), loadLiveConfig()]);
  renderLive();
}
function renderLive() {
  const host = ensureOverlay('live-menu'), me = getAuthUser();
  const mine = LIVE.role === 'host';
  const rows = LIVE.streams.map(st => `<div class="song-row live-row" data-watch="${st.id}"><div class="song-art live-art"><span>🔴</span></div>
      <div class="song-info"><div class="song-title">${escapeHtml(st.title)}</div><div class="song-sub">${escapeHtml(st.username)}${st.levelName ? ' · ' + escapeHtml(st.levelName) : ''}</div>
      <div class="song-meta"><span>👁 ${st.viewers}</span><span>${timeAgo(new Date(st.startedAt).toISOString())}</span></div></div>
      <button class="play-btn">${LIVE.id === st.id ? 'OPEN' : 'WATCH'}</button></div>`).join('');
  host.innerHTML = screenHtml('LIVE', "toggleMenu('main-menu')",
    (mine ? '<div class="panel center"><b>You are live</b><div class="note">👁 ' + LIVE.viewers + ' watching</div><button class="btn btn-play" id="live-open-own">Open my stream</button></div>'
      : (me ? '<button class="btn btn-pink" id="live-go">🔴 Go live</button>' : '<div class="note center">Log in to go live or chat. Anyone can watch.</div>')) +
    '<div class="section-title">LIVE NOW</div>' + (rows ? '<div class="song-list">' + rows + '</div>' : '<div class="empty">Nobody is live right now.</div>'));
  const go = document.getElementById('live-go'); if (go) go.onclick = goLiveDialog;
  const own = document.getElementById('live-open-own'); if (own) own.onclick = openWatchScreen;
  host.querySelectorAll('[data-watch]').forEach(r => r.onclick = () => { if (LIVE.id === r.dataset.watch) return openWatchScreen(); watchStream(r.dataset.watch); });
}

// ---------------------------------------------------------------- streamer
function liveLevelLabel() {
  if (typeof inEditor !== 'undefined' && inEditor) return 'Level editor';
  const lvl = lastStartArgs && lastStartArgs[6];
  if (gameActive && lvl && lvl.name) return lvl.name;
  if (gameActive && isPlaytesting) return 'Playtesting a level';
  if (gameActive) return 'Playing';
  return '';
}
async function goLiveDialog() {
  if (!getAuthToken()) { toast('Log in to go live.', 'bad'); return; }
  if (!navigator.mediaDevices || !HTMLCanvasElement.prototype.captureStream) { await uiAlert('Streaming needs a newer browser (Chrome, Edge, Firefox or Safari 15+).', 'Not supported'); return; }
  const me = getAuthUser();
  const r = await openFormDialog({ title: 'Go live', fields: [
    { id: 'title', label: 'Stream title', value: (me ? me.username : 'My') + "'s stream", maxlength: 60 },
    { id: 'mic', label: 'Use my microphone', type: 'checkbox', value: true },
    { id: 'game', label: 'Include game music', type: 'checkbox', value: true }], okText: 'Start' });
  if (!r) return;
  startStreaming(r.title, !!r.mic, !!r.game);
}
async function startStreaming(title, wantMic, wantGame) {
  if (LIVE.role) return;
  if (!battleSocket || !battleSocket.connected) { toast('Connecting to the server… try again in a moment.', 'bad'); connectBattle(); return; }
  LIVE.role = 'host'; LIVE.id = null; LIVE.title = title; LIVE.viewers = 0; LIVE.chat = []; LIVE.chunks = []; LIVE.recBytes = 0; LIVE.startedAt = Date.now();
  await loadLiveConfig();
  // picture: a 540x960 canvas that mirrors the game canvas + a little HUD
  const comp = document.createElement('canvas'); comp.width = 540; comp.height = 960; LIVE.comp = comp;
  const cx = comp.getContext('2d');
  const draw = () => {
    cx.fillStyle = getComputedStyle(document.body).backgroundColor || '#10131c';
    cx.fillRect(0, 0, 540, 960);
    const live = (gameActive || inEditor) && canvas && canvas.width > 0;
    if (live) {
      const k = Math.min(540 / canvas.width, 960 / canvas.height), w = canvas.width * k, h = canvas.height * k;
      cx.drawImage(canvas, (540 - w) / 2, (960 - h) / 2, w, h);
    } else {
      const g = cx.createLinearGradient(0, 0, 0, 960); g.addColorStop(0, '#2b0f6b'); g.addColorStop(1, '#1d0b55'); cx.fillStyle = g; cx.fillRect(0, 0, 540, 960);
      cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.font = '800 44px Rubik, sans-serif'; cx.fillText('06 TILES', 270, 450);
      cx.font = '600 24px Rubik, sans-serif'; cx.fillStyle = '#d7cdf5'; cx.fillText('Picking the next level…', 270, 500);
    }
    cx.textAlign = 'left'; cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(14, 14, 190, 38);
    cx.fillStyle = '#ff3b4d'; cx.beginPath(); cx.arc(34, 33, 7, 0, 7); cx.fill();
    cx.fillStyle = '#fff'; cx.font = '800 20px Rubik, sans-serif'; cx.fillText('LIVE · ' + String((getAuthUser() || {}).username || '').slice(0, 10), 50, 40);
    if (gameActive && live) { cx.textAlign = 'center'; cx.font = '900 40px Rubik, sans-serif'; cx.fillStyle = '#fff'; cx.fillText(String(Math.floor(score)), 270, 96); }
  };
  draw(); LIVE.compTimer = setInterval(draw, 1000 / 30);
  const vstream = comp.captureStream(30);
  // sound: game music + mic mixed into one track
  const tracks = [...vstream.getVideoTracks()];
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!LIVE.ac) LIVE.ac = new C();
    LIVE.ac.resume().catch(() => {});
    LIVE.dest = LIVE.ac.createMediaStreamDestination();
    if (wantGame) {
      if (!LIVE.bgSrc) { LIVE.bgSrc = LIVE.ac.createMediaElementSource(bgAudio); LIVE.bgSrc.connect(LIVE.ac.destination); }
      LIVE.bgSrc.connect(LIVE.dest);
    }
    if (wantMic) {
      try {
        LIVE.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        LIVE.micNode = LIVE.ac.createMediaStreamSource(LIVE.mic); LIVE.micNode.connect(LIVE.dest); LIVE.micOn = true;
      } catch (e) { toast('Microphone blocked, so you are live without voice.', 'bad'); LIVE.mic = null; }
    }
    tracks.push(...LIVE.dest.stream.getAudioTracks());
  } catch (e) { toast('Could not capture sound, going live with video only.', 'bad'); }
  LIVE.out = new MediaStream(tracks);
  startRecorder();
  battleSocket.emit('stream_start', { title, levelName: liveLevelLabel() });
  LIVE.labelTimer = setInterval(() => { if (LIVE.id) emitBattle('stream_update', { levelName: liveLevelLabel() }); }, 8000);
}
function startRecorder() {
  try {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    LIVE.recMime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    if (!LIVE.recMime) return;
    LIVE.recorder = new MediaRecorder(LIVE.out, { mimeType: LIVE.recMime, videoBitsPerSecond: 1500000, audioBitsPerSecond: 96000 });
    LIVE.recorder.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      if (LIVE.recBytes > 400 * 1024 * 1024) { if (!LIVE.recFull) { LIVE.recFull = true; toast('Recording is full (400 MB). The stream keeps going, but the download stops here.', 'bad'); } return; }
      LIVE.chunks.push(e.data); LIVE.recBytes += e.data.size;
    };
    LIVE.recorder.start(2000);
  } catch (e) { LIVE.recorder = null; }
}
function liveHostStarted(d) {
  if (LIVE.role !== 'host') return;
  LIVE.id = d.id; toast('You are live!', 'good');
  renderLiveHud(); openWatchScreen();
}
async function liveHostAddViewer(viewerId) {
  if (LIVE.role !== 'host' || !LIVE.out) return;
  liveHostDropViewer(viewerId);
  const pc = new RTCPeerConnection({ iceServers: LIVE.ice });
  LIVE.peers.set(viewerId, pc);
  LIVE.out.getTracks().forEach(t => pc.addTrack(t, LIVE.out));
  pc.onicecandidate = e => { if (e.candidate) emitBattle('stream_signal', { to: viewerId, data: { cand: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) liveHostDropViewer(viewerId); };
  try {
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    emitBattle('stream_signal', { to: viewerId, data: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    pc.getSenders().forEach(snd => { if (snd.track && snd.track.kind === 'video') { const p = snd.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = 1100000; snd.setParameters(p).catch(() => {}); } });
  } catch (e) { console.warn('stream offer failed', e); liveHostDropViewer(viewerId); }
}
function liveHostDropViewer(viewerId) { const pc = LIVE.peers.get(viewerId); if (pc) { try { pc.close(); } catch (e) {} LIVE.peers.delete(viewerId); } }
function liveToggleMic() {
  if (!LIVE.mic) { toast('No microphone in this stream.', 'bad'); return; }
  LIVE.micOn = !LIVE.micOn; LIVE.mic.getAudioTracks().forEach(t => { t.enabled = LIVE.micOn; });
  const b = document.getElementById('live-mic'); if (b) b.textContent = LIVE.micOn ? '🎙 Mic on' : '🔇 Mic off';
  renderLiveHud();
}
async function stopStreaming(ask) {
  if (LIVE.role !== 'host') return;
  if (ask && !(await uiConfirm('End your stream? You can download the recording afterwards.', 'End stream', true))) return;
  emitBattle('stream_end', {});
  liveEnded('You ended the stream.');
}
async function liveTeardown() {
  clearInterval(LIVE.compTimer); clearInterval(LIVE.labelTimer);
  LIVE.peers.forEach(pc => { try { pc.close(); } catch (e) {} }); LIVE.peers.clear();
  if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} LIVE.pc = null; }
  if (LIVE.mic) LIVE.mic.getTracks().forEach(t => t.stop());
  if (LIVE.bgSrc && LIVE.dest) { try { LIVE.bgSrc.disconnect(LIVE.dest); } catch (e) {} }
  if (LIVE.out) LIVE.out.getVideoTracks().forEach(t => t.stop());
  LIVE.mic = null; LIVE.micNode = null; LIVE.out = null; LIVE.dest = null; LIVE.comp = null; LIVE.hostId = null; LIVE.pendingIce = [];
  LIVE.role = null; LIVE.id = null; LIVE.recFull = false;
  const hud = document.getElementById('live-hud'); if (hud) hud.remove();
}
// the stream is over (ended by host/admin, host disconnected, or we left): finish the recording, tidy up, offer the download
async function liveEnded(reason) {
  const wasHost = LIVE.role === 'host', wasViewer = LIVE.role === 'viewer';
  let blob = null;
  if (wasHost && LIVE.recorder && LIVE.recorder.state !== 'inactive') {
    await new Promise(res => { LIVE.recorder.onstop = res; try { LIVE.recorder.stop(); } catch (e) { res(); } });
  }
  if (wasHost && LIVE.chunks.length) blob = new Blob(LIVE.chunks, { type: LIVE.recMime || 'video/webm' });
  const mins = Math.max(1, Math.round((Date.now() - LIVE.startedAt) / 60000));
  LIVE.recorder = null; LIVE.chunks = [];
  await liveTeardown();
  const w = document.getElementById('watch-menu'); if (w) w.classList.add('hidden');
  if (wasHost) showStreamDone(blob, mins, reason);
  else if (wasViewer) { toast(reason || 'The stream ended.'); openLive(); }
}
function showStreamDone(blob, mins, reason) {
  const host = ensureOverlay('stream-done'); host.className = 'overlay overlay-dim'; host.style.zIndex = 120;
  const ext = blob && /mp4/.test(blob.type) ? 'mp4' : 'webm';
  const url = blob ? URL.createObjectURL(blob) : '';
  host.innerHTML = `<div class="center-panel"><h2>Stream finished</h2><p>${escapeHtml(reason || '')}</p>
    ${blob ? '<p>' + mins + ' min · ' + (blob.size / 1048576).toFixed(1) + ' MB</p><video class="done-video" src="' + url + '" controls playsinline></video><a class="btn btn-play" id="stream-dl" download="06tiles-stream-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext + '">⬇ Download recording</a>' : '<p>No recording was kept.</p>'}
    <button class="btn btn-ghost" id="stream-done-close">Close</button></div>`;
  let saved = false;
  const dl = document.getElementById('stream-dl'); if (dl) { dl.href = url; dl.addEventListener('click', () => { saved = true; }); }
  document.getElementById('stream-done-close').onclick = async () => {
    if (blob && !saved && !(await uiConfirm('Close without downloading? The recording will be deleted.', 'Delete it', true))) return;
    host.classList.add('hidden'); host.innerHTML = ''; if (url) URL.revokeObjectURL(url);
  };
}
// small pill while you play: tap it to open your stream (chat, mic, end)
function renderLiveHud() {
  let hud = document.getElementById('live-hud');
  if (LIVE.role !== 'host') { if (hud) hud.remove(); return; }
  if (!hud) { hud = document.createElement('button'); hud.id = 'live-hud'; hud.onclick = openWatchScreen; document.body.appendChild(hud); }
  hud.innerHTML = '<span class="dot"></span> LIVE · 👁 ' + LIVE.viewers + (LIVE.mic && !LIVE.micOn ? ' · 🔇' : '');
}
function liveUpdateCounts() {
  renderLiveHud();
  const c = document.getElementById('watch-count'); if (c) c.textContent = '👁 ' + LIVE.viewers;
}

// ---------------------------------------------------------------- viewer
async function watchStream(id) {
  if (!battleSocket || !battleSocket.connected) { toast('Connecting… try again in a moment.', 'bad'); connectBattle(); return; }
  if (LIVE.role === 'host') { toast('You are live yourself. End your stream first.', 'bad'); return; }
  if (LIVE.role === 'viewer') liveLeaveViewer(true);
  await loadLiveConfig();
  LIVE.role = 'viewer'; LIVE.id = id; LIVE.chat = []; LIVE.pendingIce = []; LIVE.startedAt = Date.now();
  battleSocket.emit('stream_join', { id });
}
function liveViewerJoined(d) {
  if (LIVE.role !== 'viewer') return;
  LIVE.id = d.id; LIVE.hostId = d.hostId; LIVE.title = d.title; LIVE.viewers = d.viewers; LIVE.chat = d.chat || []; LIVE.streamer = d.username; LIVE.levelName = d.levelName;
  openWatchScreen();
}
function liveLeaveViewer(silent) {
  if (LIVE.role !== 'viewer') return;
  emitBattle('stream_leave', {});
  if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} LIVE.pc = null; }
  LIVE.role = null; LIVE.id = null; LIVE.hostId = null; LIVE.pendingIce = [];
  if (!silent) openLive();
}
async function liveOnSignal(m) {
  const d = m.data || {};
  if (LIVE.role === 'host') {
    const pc = LIVE.peers.get(m.from); if (!pc) return;
    try {
      if (d.sdp) await pc.setRemoteDescription(d.sdp);
      if (d.cand) await pc.addIceCandidate(d.cand);
    } catch (e) {}
    return;
  }
  if (LIVE.role !== 'viewer' || m.from !== LIVE.hostId) return;
  try {
    if (d.sdp) {
      if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} }
      const pc = new RTCPeerConnection({ iceServers: LIVE.ice }); LIVE.pc = pc;
      pc.ontrack = e => { const v = document.getElementById('watch-video'); if (v) { v.srcObject = e.streams[0]; v.play().catch(() => { const t = document.getElementById('watch-tap'); if (t) t.classList.remove('hidden'); }); const ph = document.getElementById('watch-wait'); if (ph) ph.classList.add('hidden'); } LIVE.remote = e.streams[0]; };
      pc.onicecandidate = e => { if (e.candidate) emitBattle('stream_signal', { to: LIVE.hostId, data: { cand: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
      pc.onconnectionstatechange = () => { const ph = document.getElementById('watch-wait'); if (pc.connectionState === 'failed' && ph) { ph.classList.remove('hidden'); ph.textContent = 'Connection failed. Your network may block live video.'; } };
      await pc.setRemoteDescription(d.sdp);
      for (const c of LIVE.pendingIce) { try { await pc.addIceCandidate(c); } catch (e) {} } LIVE.pendingIce = [];
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      emitBattle('stream_signal', { to: LIVE.hostId, data: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    } else if (d.cand) {
      if (LIVE.pc && LIVE.pc.remoteDescription) { try { await LIVE.pc.addIceCandidate(d.cand); } catch (e) {} } else LIVE.pendingIce.push(d.cand);
    }
  } catch (e) { console.warn('stream signal', e); }
}

// ---------------------------------------------------------------- watch frame (viewers + the streamer's own view)
function openWatchScreen() {
  const host = ensureOverlay('watch-menu'), isHost = LIVE.role === 'host', me = getAuthUser();
  toggleMenu('watch-menu');
  const title = isHost ? LIVE.title : (LIVE.title || 'Live');
  host.innerHTML = screenHtml('LIVE', isHost ? "toggleMenu('main-menu')" : 'liveLeaveViewer()',
    `<div class="watch-grid">
      <div class="watch-frame"><video id="watch-video" playsinline autoplay ${isHost ? 'muted' : ''}></video>
        <div id="watch-wait" class="watch-wait ${isHost ? 'hidden' : ''}">Connecting to the stream…</div>
        <button id="watch-tap" class="watch-tap hidden">▶ Tap to play</button></div>
      <div class="watch-side">
        <div class="watch-info"><b>${escapeHtml(title)}</b><span class="note">${isHost ? 'You' : escapeHtml(LIVE.streamer || '')} · <span id="watch-count">👁 ${LIVE.viewers}</span></span></div>
        <div class="btn-row">${isHost ? '<button class="btn small btn-ghost" id="live-mic">' + (LIVE.mic ? (LIVE.micOn ? '🎙 Mic on' : '🔇 Mic off') : '🎙 No mic') + '</button><button class="btn small btn-danger" id="live-end">■ End stream</button>'
          : '<button class="btn small btn-ghost" id="watch-mute">🔊 Sound</button>' + (isAdminUser() ? '<button class="btn small btn-danger" id="watch-admin-end">Admin: end stream</button>' : '')}</div>
        <div class="stream-chat" id="stream-chat"></div>
        ${me ? '<div class="stream-compose"><input id="stream-input" maxlength="200" placeholder="Chat…" autocomplete="off"><button class="btn small btn-play" id="stream-send">Send</button></div>' : '<div class="note center">Log in to chat.</div>'}
      </div></div>`);
  const v = document.getElementById('watch-video');
  if (isHost && LIVE.out) { v.srcObject = new MediaStream(LIVE.out.getVideoTracks()); v.play().catch(() => {}); }
  if (!isHost && LIVE.remote) { v.srcObject = LIVE.remote; v.play().catch(() => {}); document.getElementById('watch-wait').classList.add('hidden'); }
  LIVE.chat.forEach(m => liveAppendChat(m, true));
  const send = () => { const i = document.getElementById('stream-input'); const t = i.value.trim(); if (!t) return; emitBattle('stream_chat', { id: LIVE.id, text: t }); i.value = ''; };
  const si = document.getElementById('stream-input'); if (si) { si.onkeydown = e => { if (e.key === 'Enter') send(); }; document.getElementById('stream-send').onclick = send; }
  const tap = document.getElementById('watch-tap'); tap.onclick = () => { v.play().catch(() => {}); tap.classList.add('hidden'); };
  const mute = document.getElementById('watch-mute'); if (mute) mute.onclick = () => { v.muted = !v.muted; mute.textContent = v.muted ? '🔇 Muted' : '🔊 Sound'; };
  const mic = document.getElementById('live-mic'); if (mic) mic.onclick = liveToggleMic;
  const end = document.getElementById('live-end'); if (end) end.onclick = () => stopStreaming(true);
  const ae = document.getElementById('watch-admin-end'); if (ae) ae.onclick = async () => { if (await uiConfirm('End this stream for everyone?', 'End it', true)) emitBattle('stream_end', { id: LIVE.id }); };
}
function liveAppendChat(m, quiet) {
  const box = document.getElementById('stream-chat');
  if (box) {
    const d = document.createElement('div'); d.className = 'sc-msg' + (m.host ? ' host' : '');
    d.innerHTML = '<b>' + (m.host ? '⭐ ' : '') + escapeHtml(m.user) + '</b> ' + escapeHtml(m.text);
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.appendChild(d); if (stick || quiet) box.scrollTop = box.scrollHeight;
  }
  // streamer playing with the stream open elsewhere: flash the newest message
  if (!quiet && LIVE.role === 'host' && (!box || box.offsetParent === null)) liveFlashChat(m);
}
function liveFlashChat(m) {
  let f = document.getElementById('live-flash');
  if (!f) { f = document.createElement('div'); f.id = 'live-flash'; document.body.appendChild(f); }
  const d = document.createElement('div'); d.innerHTML = '<b>' + escapeHtml(m.user) + '</b> ' + escapeHtml(m.text);
  f.appendChild(d); while (f.children.length > 3) f.firstChild.remove();
  setTimeout(() => d.remove(), 6000);
}

// connection drop: the streamer's recording is kept and offered for download
function liveOnDisconnect() { if (LIVE.role === 'host') liveEnded('Connection to the server was lost.'); else if (LIVE.role === 'viewer') { LIVE.role = null; LIVE.id = null; toast('Disconnected from the stream.', 'bad'); } }
