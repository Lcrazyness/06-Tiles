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
  battleSocket = io(API_BASE_URL, { auth: { token: getAuthToken() || undefined, guestId: getGuestId() }, transports: ['polling', 'websocket'], upgrade: true, tryAllTransports: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 6000, timeout: 30000 });
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
// LIVE STREAMS + RECORDINGS + GLOBAL VOICE
// Streamer: the whole 06 screen (browser "share this tab") or just the game board is drawn onto a Short (9:16) or Wide (16:9)
// canvas, captured, mixed with sound + microphone and sent to each viewer over WebRTC. If a viewer's network blocks peer-to-peer
// video (school Wi-Fi), the same picture is relayed through the server instead. A local recording can be downloaded or published.
// ============================================================================
const LIVE = { role: null, id: null, key: '', title: '', fmt: 'short', chatOn: true, streams: [], vods: {}, tab: 'live', ice: [{ urls: 'stun:stun.l.google.com:19302' }], maxViewers: 8,
  peers: new Map(), pc: null, hostId: null, out: null, comp: null, compTimer: 0, mic: null, micOn: true, recorder: null, chunks: [], recBytes: 0, recMime: '',
  viewers: 0, chat: [], startedAt: 0, ac: null, dest: null, bgSrc: null, pendingIce: [], disp: null, sv: null, pcConnected: false, relayOn: false, rq: [] };
const apiUrl = p => API_BASE_URL + p;

function updateLiveBadge() { const b = document.getElementById('live-badge'); if (!b) return; b.textContent = String(LIVE.streams.length); b.classList.toggle('hidden', !LIVE.streams.length); }
function ensureRail() { let rail = document.getElementById('menu-rail'); if (!rail) { const m = document.getElementById('main-menu'); if (!m) return null; rail = document.createElement('div'); rail.id = 'menu-rail'; m.appendChild(rail); } return rail; }
function railButton(id, icon, label, fn, badgeId, badgeCls) {
  if (document.getElementById(id)) return; const rail = ensureRail(); if (!rail) return;
  const b = document.createElement('button'); b.id = id; b.className = 'icon-btn rail-btn'; b.setAttribute('aria-label', label);
  b.innerHTML = icon + '<span id="' + badgeId + '" class="news-badge ' + (badgeCls || '') + ' hidden">0</span>'; b.onclick = fn; rail.appendChild(b);
}
function injectLiveButton() { railButton('live-btn', '🔴', 'Live', () => openLive(), 'live-badge', 'live'); railButton('voice-btn', '🎙', 'Voice chat', openVoice, 'voice-badge', 'live'); }
async function refreshLive() { try { LIVE.streams = (await apiRequest('/api/streams')).streams || []; } catch (e) {} updateLiveBadge(); }
async function loadLiveConfig() { try { const d = await apiRequest('/api/streams/config'); if (d.iceServers) LIVE.ice = d.iceServers; if (d.maxViewers) LIVE.maxViewers = d.maxViewers; } catch (e) {} }

function registerLiveHandlers(s) {
  s.on('connect', () => {
    clearTimeout(LIVE.dropTimer);
    if (LIVE.role === 'host' && LIVE.id && LIVE.key) s.emit('stream_resume', { id: LIVE.id, key: LIVE.key });
    else if (LIVE.role === 'viewer' && LIVE.id) { LIVE.pcConnected = false; s.emit('stream_join', { id: LIVE.id }); }
    if (VOICE.on) s.emit('voice_join');
  });
  s.on('notify', d => { if (typeof onNotifyPush === 'function') onNotifyPush(d); });
  s.on('streams_changed', list => { LIVE.streams = Array.isArray(list) ? list : LIVE.streams; updateLiveBadge(); const m = document.getElementById('live-menu'); if (m && !m.classList.contains('hidden') && LIVE.tab === 'live') renderLive(); });
  s.on('stream_started', d => liveHostStarted(d));
  s.on('stream_error', d => { toast(d.message || 'Stream problem.', 'bad'); if (LIVE.role === 'host' && (!LIVE.id || d.gone)) liveEnded(d.message); else if (LIVE.role === 'viewer' && /over/.test(d.message || '')) liveEnded(d.message); });
  s.on('stream_joined', d => liveViewerJoined(d));
  s.on('stream_viewer', d => liveHostAddViewer(d.viewerId));
  s.on('stream_viewer_left', d => liveHostDropViewer(d.viewerId));
  s.on('stream_viewers', d => { if (d.id === LIVE.id) { LIVE.viewers = d.count; liveUpdateCounts(); if (LIVE.role === 'host' && !d.count) hostRelayStop(); } });
  s.on('stream_signal', d => liveOnSignal(d));
  s.on('stream_chat', d => { if (d.id === LIVE.id) { LIVE.chat.push(d); if (LIVE.chat.length > 80) LIVE.chat.shift(); liveAppendChat(d); } });
  s.on('stream_ended', d => { if (d.id === LIVE.id) liveEnded(d.reason); });
  s.on('stream_chatmode', d => { if (d.id === LIVE.id) { LIVE.chatOn = d.chatOn; applyChatMode(); } });
  s.on('stream_host_wait', () => { const w = document.getElementById('watch-wait'); if (LIVE.role === 'viewer' && w) { w.classList.remove('hidden'); w.textContent = 'The streamer lost connection. Waiting for them to come back…'; } });
  s.on('stream_host_changed', d => { if (LIVE.role === 'viewer' && d.id === LIVE.id) { LIVE.hostId = d.hostId; LIVE.pcConnected = false; armRelayTimer(); } });
  s.on('stream_relay_need', () => hostRelayRestart());
  s.on('stream_chunk', d => relayChunk(d));
  s.on('voice_members', m => { VOICE.members = m; renderVoice(); });
  s.on('voice_count', n => { const b = document.getElementById('voice-badge'); if (b) { b.textContent = String(n); b.classList.toggle('hidden', !n); } });
  s.on('voice_error', d => { toast(d.message, 'bad'); voiceLeave(true); });
  s.on('voice_data', d => voicePlay(d));
}

// ---------------------------------------------------------------- list screen with tabs
const LIVE_TABS = [['live', '🔴 Live'], ['recent', 'Recent'], ['popular', 'Popular'], ['liked', 'Most liked']];
async function openLive(tab) {
  if (tab) LIVE.tab = tab;
  ensureOverlay('live-menu'); toggleMenu('live-menu'); renderLive();
  await Promise.all([refreshLive(), loadLiveConfig()]);
  if (LIVE.tab !== 'live') await loadVods(LIVE.tab);
  renderLive();
}
async function loadVods(sort) { try { LIVE.vods[sort] = (await apiRequest('/api/vods?sort=' + sort, { auth: true })).vods || []; } catch (e) { LIVE.vodsErr = e.message; } }
const fmtDur = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
function renderLive() {
  const host = ensureOverlay('live-menu'), me = getAuthUser(), mine = LIVE.role === 'host';
  const tabs = '<div class="seg live-tabs">' + LIVE_TABS.map(([k, n]) => '<button class="' + (LIVE.tab === k ? 'on' : '') + '" data-ltab="' + k + '">' + n + '</button>').join('') + '</div>';
  let body;
  if (LIVE.tab === 'live') {
    const rows = LIVE.streams.map(st => `<div class="song-row live-row" data-watch="${st.id}"><div class="song-art live-art${st.thumb ? ' thumb' : ''}">${st.thumb ? '<img src="' + st.thumb + '" alt="">' : '<span>🔴</span>'}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(st.title)}</div><div class="song-sub">${escapeHtml(st.username)}${st.levelName ? ' · ' + escapeHtml(st.levelName) : ''}</div>
      <div class="song-meta"><span>👁 ${st.viewers}</span><span>${st.format === 'wide' ? 'Wide' : 'Short'}</span><span>${timeAgo(new Date(st.startedAt).toISOString())}</span></div></div>
      <button class="play-btn">${LIVE.id === st.id ? 'OPEN' : 'WATCH'}</button></div>`).join('');
    body = (mine ? '<div class="panel center"><b>You are live</b><div class="note">👁 ' + LIVE.viewers + ' watching</div><button class="btn btn-play" id="live-open-own">Open my stream</button></div>'
      : (me ? '<button class="btn btn-pink" id="live-go">🔴 Go live</button>' : '<div class="note center">Log in to go live or chat. Anyone can watch.</div>')) +
      (rows ? '<div class="song-list">' + rows + '</div>' : '<div class="empty">Nobody is live right now.</div>');
  } else {
    const list = LIVE.vods[LIVE.tab];
    body = !list ? (LIVE.vodsErr ? errorBox(LIVE.vodsErr, "openLive('" + LIVE.tab + "')") : '<div class="empty">Loading…</div>') : list.length ? '<div class="song-list">' + list.map(v => `<div class="song-row live-row" data-vod="${v.id}"><div class="song-art vod-art${v.thumb ? ' thumb' : ''}">${v.thumb ? '<img src="' + apiUrl(v.thumb) + '" alt="">' : '<span>🎬</span>'}</div>
      <div class="song-info"><div class="song-title">${escapeHtml(v.title)}</div><div class="song-sub">${escapeHtml(v.username)}${v.levelLabel ? ' · ' + escapeHtml(v.levelLabel) : ''}</div>
      <div class="song-meta"><span>👁 ${v.views}</span><span>❤ ${v.likes}</span><span>${fmtDur(v.duration)}</span><span>${v.format === 'wide' ? 'Wide' : 'Short'}</span><span>${timeAgo(v.createdAt)}</span></div></div>
      <button class="play-btn">WATCH</button></div>`).join('') + '</div>' : '<div class="empty">No recordings yet.</div>';
  }
  host.innerHTML = screenHtml('LIVE', "toggleMenu('main-menu')", tabs + body);
  host.querySelectorAll('[data-ltab]').forEach(b => b.onclick = () => openLive(b.dataset.ltab));
  const go = document.getElementById('live-go'); if (go) go.onclick = goLiveDialog;
  const own = document.getElementById('live-open-own'); if (own) own.onclick = openWatchScreen;
  host.querySelectorAll('[data-watch]').forEach(r => r.onclick = () => { if (LIVE.id === r.dataset.watch) return openWatchScreen(); watchStream(r.dataset.watch); });
  host.querySelectorAll('[data-vod]').forEach(r => r.onclick = () => openVodWatch((LIVE.vods[LIVE.tab] || []).find(v => String(v.id) === r.dataset.vod)));
}

// ---------------------------------------------------------------- streamer
function liveScreenLabel() {
  for (const id of overlays) { const e = document.getElementById(id); if (e && !e.classList.contains('hidden')) { const h = e.querySelector('.screen-header h2'); return h ? h.textContent.trim() : (id === 'main-menu' ? 'Main menu' : ''); } }
  return '';
}
function liveLevelLabel() {
  if (typeof inEditor !== 'undefined' && inEditor) return 'Level editor';
  const lvl = lastStartArgs && lastStartArgs[6];
  if (gameActive && lvl && lvl.name) return lvl.name;
  if (gameActive && isPlaytesting) return 'Playtesting a level';
  if (gameActive) return 'Playing';
  return liveScreenLabel();
}
async function goLiveDialog() {
  if (!getAuthToken()) { toast('Log in to go live.', 'bad'); return; }
  if (!navigator.mediaDevices || !HTMLCanvasElement.prototype.captureStream) { await uiAlert('Streaming needs a newer browser (Chrome, Edge, Firefox or Safari 15+).', 'Not supported'); return; }
  const me = getAuthUser(), canScreen = !!navigator.mediaDevices.getDisplayMedia;
  const r = await openFormDialog({ title: 'Go live', fields: [
    { id: 'title', label: 'Stream title', value: (me ? me.username : 'My') + "'s stream", maxlength: 60 },
    { id: 'format', label: 'Size', type: 'select', value: 'short', options: [{ value: 'short', label: 'Short (phone, 9:16)' }, { value: 'wide', label: 'Wide (YouTube, 16:9)' }] },
    { id: 'chat', label: 'Show live chat beside the stream', type: 'checkbox', value: true },
    ...(canScreen ? [{ id: 'screen', label: 'Stream my whole 06 screen (menus too). Pick "This tab".', type: 'checkbox', value: true }] : []),
    { id: 'mic', label: 'Use my microphone', type: 'checkbox', value: true },
    { id: 'game', label: 'Include game music', type: 'checkbox', value: true }], okText: 'Start' });
  if (!r) return;
  startStreaming({ title: r.title, format: r.format === 'wide' ? 'wide' : 'short', chat: !!r.chat, screen: canScreen && !!r.screen, mic: !!r.mic, game: !!r.game });
}
async function startStreaming(o) {
  if (LIVE.role) return;
  if (!battleSocket || !battleSocket.connected) { toast('Connecting to the server… try again in a moment.', 'bad'); connectBattle(); return; }
  LIVE.role = 'host'; LIVE.id = null; LIVE.key = ''; LIVE.title = o.title; LIVE.fmt = o.format; LIVE.chatOn = o.chat; LIVE.viewers = 0; LIVE.chat = []; LIVE.chunks = []; LIVE.recBytes = 0; LIVE.startedAt = Date.now();
  // 1) the picture. Screen capture must be asked for first (it needs the click that started this)
  let disp = null;
  if (o.screen) {
    try { disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude' }); }
    catch (e) { toast('Screen share cancelled. Streaming the game board instead.', 'bad'); }
  }
  await loadLiveConfig();
  const W = o.format === 'wide' ? 960 : 540, H = o.format === 'wide' ? 540 : 960;
  const comp = document.createElement('canvas'); comp.width = W; comp.height = H; LIVE.comp = comp;
  const cx = comp.getContext('2d');
  if (disp) {
    LIVE.disp = disp; LIVE.sv = document.createElement('video'); LIVE.sv.muted = true; LIVE.sv.playsInline = true; LIVE.sv.srcObject = new MediaStream(disp.getVideoTracks());
    try { await LIVE.sv.play(); } catch (e) {}
    disp.getVideoTracks()[0].addEventListener('ended', () => stopStreaming(false));
  }
  const fit = (src, sw, sh) => { const k = Math.min(W / sw, H / sh), w = sw * k, h = sh * k; cx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); };
  const draw = () => {
    cx.fillStyle = '#10131c'; cx.fillRect(0, 0, W, H);
    let showScore = false;
    if (LIVE.sv && LIVE.sv.videoWidth) fit(LIVE.sv, LIVE.sv.videoWidth, LIVE.sv.videoHeight);
    else if ((gameActive || inEditor) && canvas && canvas.width > 0) { fit(canvas, canvas.width, canvas.height); showScore = gameActive; }
    else { const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2b0f6b'); g.addColorStop(1, '#1d0b55'); cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.font = '800 44px Rubik, sans-serif'; cx.fillText('06 TILES', W / 2, H / 2 - 10); cx.font = '600 24px Rubik, sans-serif'; cx.fillStyle = '#d7cdf5'; cx.fillText(liveScreenLabel() || '…', W / 2, H / 2 + 36); }
    cx.textAlign = 'left'; cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(14, 14, 200, 38); cx.fillStyle = '#ff3b4d'; cx.beginPath(); cx.arc(34, 33, 7, 0, 7); cx.fill();
    cx.fillStyle = '#fff'; cx.font = '800 20px Rubik, sans-serif'; cx.fillText('LIVE · ' + String((getAuthUser() || {}).username || '').slice(0, 10), 50, 40);
    if (showScore) { cx.textAlign = 'center'; cx.font = '900 40px Rubik, sans-serif'; cx.fillText(String(Math.floor(score)), W / 2, 96); }
  };
  draw(); LIVE.compTimer = setInterval(draw, 1000 / 30);
  const tracks = [...comp.captureStream(30).getVideoTracks()];
  // 2) the sound: tab audio (screen share) or game music, plus the microphone
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!LIVE.ac) LIVE.ac = new C();
    LIVE.ac.resume().catch(() => {});
    LIVE.dest = LIVE.ac.createMediaStreamDestination();
    const dispAudio = disp ? disp.getAudioTracks() : [];
    if (dispAudio.length) LIVE.ac.createMediaStreamSource(new MediaStream(dispAudio)).connect(LIVE.dest);
    else if (o.game) { if (!LIVE.bgSrc) { LIVE.bgSrc = LIVE.ac.createMediaElementSource(bgAudio); LIVE.bgSrc.connect(LIVE.ac.destination); } LIVE.bgSrc.connect(LIVE.dest); }
    if (o.mic) {
      try { LIVE.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); LIVE.micNode = LIVE.ac.createMediaStreamSource(LIVE.mic); LIVE.micNode.connect(LIVE.dest); LIVE.micOn = true; }
      catch (e) { toast('Microphone blocked, so you are live without voice.', 'bad'); LIVE.mic = null; }
    }
    tracks.push(...LIVE.dest.stream.getAudioTracks());
  } catch (e) { toast('Could not capture sound, going live with video only.', 'bad'); }
  LIVE.out = new MediaStream(tracks);
  startRecorder();
  battleSocket.emit('stream_start', { title: o.title, levelName: liveLevelLabel(), format: o.format, chatOn: o.chat });
  LIVE.lastThumb = null; LIVE.thumbTimer = setInterval(sendStreamThumb, 20000); setTimeout(sendStreamThumb, 3500);
  LIVE.labelTimer = setInterval(() => { if (LIVE.id) emitBattle('stream_update', { levelName: liveLevelLabel() }); }, 8000);
}
function sendStreamThumb(quiet) {
  if (!LIVE.comp) return;
  const u = typeof makeStreamThumb === 'function' ? makeStreamThumb(LIVE.comp, LIVE.fmt) : null;
  if (!u || u.length > 65000) return;
  LIVE.lastThumb = u;
  if (!quiet && LIVE.id) emitBattle('stream_thumb', u);
}
function startRecorder() {
  try {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    LIVE.recMime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    if (!LIVE.recMime) return;
    LIVE.recorder = new MediaRecorder(LIVE.out, { mimeType: LIVE.recMime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 });
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
  LIVE.id = d.id; LIVE.key = d.key || LIVE.key;
  if (d.resumed) { toast('Reconnected. You are still live.', 'good'); return; }
  toast('You are live!', 'good'); renderLiveHud(); openWatchScreen();
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
// compatibility mode: the picture is also sent through the server for viewers whose network blocks direct video
function hostRelayRestart() {
  clearTimeout(LIVE.relayDeb);
  LIVE.relayDeb = setTimeout(() => {
    if (LIVE.role !== 'host' || !LIVE.out || !window.MediaRecorder) return;
    hostRelayStop();
    const mt = ['video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)); if (!mt) return;
    const rec = new MediaRecorder(LIVE.out, { mimeType: mt, videoBitsPerSecond: 700000, audioBitsPerSecond: 64000 });
    let first = true;
    rec.ondataavailable = async e => { if (!e.data || !e.data.size || LIVE.relayRec !== rec) return; const init = first; first = false; emitBattle('stream_chunk', { id: LIVE.id, init, buf: await e.data.arrayBuffer() }); };
    LIVE.relayRec = rec; rec.start(1000);
  }, 800);
}
function hostRelayStop() { const r = LIVE.relayRec; LIVE.relayRec = null; try { if (r && r.state !== 'inactive') r.stop(); } catch (e) {} }
function liveToggleMic() {
  if (!LIVE.mic) { toast('No microphone in this stream.', 'bad'); return; }
  LIVE.micOn = !LIVE.micOn; LIVE.mic.getAudioTracks().forEach(t => { t.enabled = LIVE.micOn; });
  const b = document.getElementById('live-mic'); if (b) b.textContent = LIVE.micOn ? '🎙 Mic on' : '🔇 Mic off';
  renderLiveHud();
}
function liveToggleChat() { LIVE.chatOn = !LIVE.chatOn; emitBattle('stream_update', { chatOn: LIVE.chatOn }); applyChatMode(); }
function applyChatMode() {
  const g = document.querySelector('.watch-grid'); if (g) g.classList.toggle('no-chat', !LIVE.chatOn);
  const b = document.getElementById('live-chat-toggle'); if (b) b.textContent = LIVE.chatOn ? '💬 Chat on' : '💬 Chat off';
}
async function stopStreaming(ask) {
  if (LIVE.role !== 'host') return;
  if (ask && !(await uiConfirm('End your stream? You can download or publish the recording afterwards.', 'End stream', true))) return;
  emitBattle('stream_end', {});
  liveEnded('You ended the stream.');
}
async function liveTeardown() {
  clearInterval(LIVE.compTimer); clearInterval(LIVE.labelTimer); clearInterval(LIVE.thumbTimer); clearTimeout(LIVE.relayTimer); clearTimeout(LIVE.dropTimer); hostRelayStop();
  LIVE.peers.forEach(pc => { try { pc.close(); } catch (e) {} }); LIVE.peers.clear();
  if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} LIVE.pc = null; }
  if (LIVE.mic) LIVE.mic.getTracks().forEach(t => t.stop());
  if (LIVE.disp) LIVE.disp.getTracks().forEach(t => t.stop());
  if (LIVE.bgSrc && LIVE.dest) { try { LIVE.bgSrc.disconnect(LIVE.dest); } catch (e) {} }
  if (LIVE.out) LIVE.out.getVideoTracks().forEach(t => t.stop());
  LIVE.mic = null; LIVE.micNode = null; LIVE.out = null; LIVE.dest = null; LIVE.comp = null; LIVE.hostId = null; LIVE.pendingIce = []; LIVE.disp = null; LIVE.sv = null; LIVE.remote = null; LIVE.relayOn = false; LIVE.rq = []; LIVE.sb = null;
  LIVE.role = null; LIVE.id = null; LIVE.key = ''; LIVE.recFull = false;
  const hud = document.getElementById('live-hud'); if (hud) hud.remove();
}
async function liveEnded(reason) {
  if (!LIVE.role) return;
  const wasHost = LIVE.role === 'host', wasViewer = LIVE.role === 'viewer';
  if (LIVE.role === 'host') sendStreamThumb(true);
  const info = { title: LIVE.title, fmt: LIVE.fmt, level: liveLevelLabel(), thumb: LIVE.role === 'host' ? LIVE.lastThumb : null, secs: Math.max(1, Math.round((Date.now() - LIVE.startedAt) / 1000)) };
  let blob = null;
  if (wasHost && LIVE.recorder && LIVE.recorder.state !== 'inactive') await new Promise(res => { LIVE.recorder.onstop = res; try { LIVE.recorder.stop(); } catch (e) { res(); } });
  if (wasHost && LIVE.chunks.length) blob = new Blob(LIVE.chunks, { type: LIVE.recMime || 'video/webm' });
  LIVE.recorder = null; LIVE.chunks = [];
  await liveTeardown();
  const w = document.getElementById('watch-menu'); if (w) w.classList.add('hidden');
  if (wasHost) showStreamDone(blob, info, reason);
  else if (wasViewer) { toast(reason || 'The stream ended.'); openLive('recent'); }
}
function showStreamDone(blob, info, reason) {
  const host = ensureOverlay('stream-done'); host.className = 'overlay overlay-dim'; host.style.zIndex = 120;
  const ext = blob && /mp4/.test(blob.type) ? 'mp4' : 'webm', url = blob ? URL.createObjectURL(blob) : '';
  const tooBig = blob && blob.size > 60 * 1024 * 1024;
  host.innerHTML = `<div class="center-panel"><h2>Stream finished</h2><p>${escapeHtml(reason || '')}</p>
    ${blob ? '<p>' + fmtDur(info.secs) + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB</p><video class="done-video" src="' + url + '" controls playsinline></video>' +
      '<a class="btn btn-play" id="stream-dl" download="06tiles-stream-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.' + ext + '">⬇ Download recording</a>' +
      (tooBig ? '<p class="note">Too long to publish (max 60 MB). Download it instead.</p>' : '<button class="btn btn-pink" id="stream-pub">🌐 Publish to Recent streams</button><div class="note" id="stream-pub-msg"></div>') : '<p>No recording was kept.</p>'}
    <button class="btn btn-ghost" id="stream-done-close">Close</button></div>`;
  let saved = false;
  const dl = document.getElementById('stream-dl'); if (dl) { dl.href = url; dl.addEventListener('click', () => { saved = true; }); }
  const pub = document.getElementById('stream-pub');
  if (pub) pub.onclick = () => {
    pub.disabled = true; const msg = document.getElementById('stream-pub-msg'), x = new XMLHttpRequest();
    x.open('POST', apiUrl('/api/vods')); x.setRequestHeader('Authorization', 'Bearer ' + getAuthToken()); x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('x-title', encodeURIComponent(info.title || '')); x.setRequestHeader('x-format', info.fmt); x.setRequestHeader('x-duration', String(info.secs)); x.setRequestHeader('x-level', encodeURIComponent(info.level || '')); x.setRequestHeader('x-mime', blob.type || 'video/webm');
    x.upload.onprogress = e => { if (e.lengthComputable) msg.textContent = 'Uploading… ' + Math.round(e.loaded / e.total * 100) + '%'; };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status === 200 && d.success) { saved = true; if (info.thumb && d.id) { const tb = dataUrlToJpegBlob(info.thumb); if (tb) fetch(apiUrl('/api/vods/' + d.id + '/thumb'), { method: 'PUT', headers: { Authorization: 'Bearer ' + getAuthToken(), 'Content-Type': 'image/jpeg' }, body: tb }).catch(() => {}); } toast('Published!', 'good'); host.classList.add('hidden'); host.innerHTML = ''; URL.revokeObjectURL(url); LIVE.vods = {}; openLive('recent'); } else { msg.textContent = d.message || 'Upload failed.'; pub.disabled = false; } };
    x.onerror = () => { msg.textContent = 'Upload failed. Check your connection and try again.'; pub.disabled = false; };
    x.send(blob);
  };
  document.getElementById('stream-done-close').onclick = async () => {
    if (blob && !saved && !(await uiConfirm('Close without downloading or publishing? The recording will be deleted.', 'Delete it', true))) return;
    host.classList.add('hidden'); host.innerHTML = ''; if (url) URL.revokeObjectURL(url);
  };
}
function renderLiveHud() {
  let hud = document.getElementById('live-hud');
  if (LIVE.role !== 'host') { if (hud) hud.remove(); return; }
  if (!hud) { hud = document.createElement('button'); hud.id = 'live-hud'; hud.onclick = openWatchScreen; document.body.appendChild(hud); }
  hud.innerHTML = '<span class="dot"></span> LIVE · 👁 ' + LIVE.viewers + (LIVE.mic && !LIVE.micOn ? ' · 🔇' : '');
}
function liveUpdateCounts() { renderLiveHud(); const c = document.getElementById('watch-count'); if (c) c.textContent = '👁 ' + LIVE.viewers; }

// ---------------------------------------------------------------- viewer
async function watchStream(id) {
  if (!battleSocket || !battleSocket.connected) { toast('Connecting… try again in a moment.', 'bad'); connectBattle(); return; }
  if (LIVE.role === 'host') { toast('You are live yourself. End your stream first.', 'bad'); return; }
  if (LIVE.role === 'viewer') liveLeaveViewer(true);
  await loadLiveConfig();
  LIVE.role = 'viewer'; LIVE.id = id; LIVE.chat = []; LIVE.pendingIce = []; LIVE.startedAt = Date.now(); LIVE.pcConnected = false; LIVE.relayOn = false;
  battleSocket.emit('stream_join', { id });
}
function armRelayTimer() { clearTimeout(LIVE.relayTimer); LIVE.relayTimer = setTimeout(() => { if (LIVE.role === 'viewer' && !LIVE.pcConnected) relayStart(); }, 8000); }
function liveViewerJoined(d) {
  if (LIVE.role !== 'viewer') return;
  LIVE.id = d.id; LIVE.hostId = d.hostId; LIVE.title = d.title; LIVE.viewers = d.viewers; LIVE.chat = d.chat || []; LIVE.streamer = d.username; LIVE.levelName = d.levelName; LIVE.fmt = d.format || 'short'; LIVE.chatOn = d.chatOn !== false;
  armRelayTimer(); openWatchScreen();
}
function liveLeaveViewer(silent) {
  if (LIVE.role !== 'viewer') return;
  emitBattle('stream_leave', {}); clearTimeout(LIVE.relayTimer);
  if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} LIVE.pc = null; }
  LIVE.role = null; LIVE.id = null; LIVE.hostId = null; LIVE.pendingIce = []; LIVE.relayOn = false; LIVE.remote = null;
  if (!silent) openLive();
}
function relayStart() {
  if (LIVE.relayOn || !window.MediaSource || !MediaSource.isTypeSupported('video/webm;codecs="vp8,opus"')) { if (!window.MediaSource) { const w = document.getElementById('watch-wait'); if (w) w.textContent = 'Your network blocks live video and this browser has no fallback.'; } return; }
  LIVE.relayOn = true; emitBattle('stream_relay', { id: LIVE.id, on: true });
  const w = document.getElementById('watch-wait'); if (w) { w.classList.remove('hidden'); w.textContent = 'Using compatibility mode for your network…'; }
}
function relayChunk(d) {
  if (!LIVE.relayOn || d.id !== LIVE.id) return;
  if (d.init) relayReset();
  LIVE.rq.push(new Uint8Array(d.buf)); relayPump();
}
function relayReset() {
  const v = document.getElementById('watch-video'); if (!v) return;
  const ms = new MediaSource(); LIVE.ms = ms; LIVE.sb = null; LIVE.rq = [];
  v.srcObject = null; v.src = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', () => { try { LIVE.sb = ms.addSourceBuffer('video/webm;codecs="vp8,opus"'); LIVE.sb.mode = 'sequence'; LIVE.sb.addEventListener('updateend', relayPump); } catch (e) {} relayPump(); });
  v.play().catch(() => { const t = document.getElementById('watch-tap'); if (t) t.classList.remove('hidden'); });
  const w = document.getElementById('watch-wait'); if (w) w.classList.add('hidden');
}
function relayPump() {
  const sb = LIVE.sb, v = document.getElementById('watch-video'); if (!sb || !v || sb.updating) return;
  try {
    if (sb.buffered.length) { const end = sb.buffered.end(sb.buffered.length - 1); if (end - v.currentTime > 3) v.currentTime = end - 0.4; if (v.currentTime > 20) { sb.remove(0, v.currentTime - 10); return; } }
    if (LIVE.rq.length) sb.appendBuffer(LIVE.rq.shift());
  } catch (e) { if (e.name === 'QuotaExceededError') { try { sb.remove(0, Math.max(0, v.currentTime - 2)); } catch (e2) {} } }
}
async function liveOnSignal(m) {
  const d = m.data || {};
  if (LIVE.role === 'host') {
    const pc = LIVE.peers.get(m.from); if (!pc) return;
    try { if (d.sdp) await pc.setRemoteDescription(d.sdp); if (d.cand) await pc.addIceCandidate(d.cand); } catch (e) {}
    return;
  }
  if (LIVE.role !== 'viewer' || (LIVE.hostId && m.from !== LIVE.hostId)) return;
  try {
    if (d.sdp) {
      if (LIVE.pc) { try { LIVE.pc.close(); } catch (e) {} }
      const pc = new RTCPeerConnection({ iceServers: LIVE.ice }); LIVE.pc = pc; LIVE.hostId = m.from;
      pc.ontrack = e => {
        LIVE.pcConnected = true; LIVE.remote = e.streams[0];
        if (LIVE.relayOn) { LIVE.relayOn = false; emitBattle('stream_relay', { id: LIVE.id, on: false }); }
        const v = document.getElementById('watch-video'); if (v) { v.removeAttribute('src'); v.srcObject = e.streams[0]; v.play().catch(() => { const t = document.getElementById('watch-tap'); if (t) t.classList.remove('hidden'); }); const ph = document.getElementById('watch-wait'); if (ph) ph.classList.add('hidden'); }
      };
      pc.onicecandidate = e => { if (e.candidate) emitBattle('stream_signal', { to: LIVE.hostId, data: { cand: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { LIVE.pcConnected = false; relayStart(); } };
      await pc.setRemoteDescription(d.sdp);
      for (const c of LIVE.pendingIce) { try { await pc.addIceCandidate(c); } catch (e) {} } LIVE.pendingIce = [];
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      emitBattle('stream_signal', { to: LIVE.hostId, data: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    } else if (d.cand) {
      if (LIVE.pc && LIVE.pc.remoteDescription) { try { await LIVE.pc.addIceCandidate(d.cand); } catch (e) {} } else LIVE.pendingIce.push(d.cand);
    }
  } catch (e) { console.warn('stream signal', e); }
}
function liveOnDisconnect() {
  if (!LIVE.role) return;
  toast('Connection lost. Reconnecting…', 'bad');
  clearTimeout(LIVE.dropTimer);
  LIVE.dropTimer = setTimeout(() => { if (LIVE.role) liveEnded('Connection to the server was lost.'); }, 75000);
}

// ---------------------------------------------------------------- watch frame: chat on the left, picture on the right
function openWatchScreen() {
  const host = ensureOverlay('watch-menu'), isHost = LIVE.role === 'host', me = getAuthUser();
  toggleMenu('watch-menu');
  host.innerHTML = screenHtml('LIVE', isHost ? "toggleMenu('main-menu')" : 'liveLeaveViewer()',
    `<div class="watch-grid fmt-${LIVE.fmt}${LIVE.chatOn ? '' : ' no-chat'}">
      <div class="watch-frame fmt-${LIVE.fmt}"><video id="watch-video" playsinline autoplay ${isHost ? 'muted' : ''}></video>
        <div id="watch-wait" class="watch-wait ${isHost || LIVE.pcConnected ? 'hidden' : ''}">Connecting to the stream…</div>
        <button id="watch-tap" class="watch-tap hidden">▶ Tap to play</button></div>
      <div class="watch-side">
        <div class="watch-info"><b>${escapeHtml(LIVE.title || 'Live')}</b><span class="note">${isHost ? 'You' : escapeHtml(LIVE.streamer || '')} · <span id="watch-count">👁 ${LIVE.viewers}</span></span></div>
        <div class="btn-row">${isHost ? '<button class="btn small btn-ghost" id="live-mic">' + (LIVE.mic ? (LIVE.micOn ? '🎙 Mic on' : '🔇 Mic off') : '🎙 No mic') + '</button><button class="btn small btn-ghost" id="live-chat-toggle">' + (LIVE.chatOn ? '💬 Chat on' : '💬 Chat off') + '</button><button class="btn small btn-danger" id="live-end">■ End</button>'
          : '<button class="btn small btn-ghost" id="watch-mute">🔊 Sound</button>' + (isAdminUser() ? '<button class="btn small btn-danger" id="watch-admin-end">Admin: end</button>' : '')}</div>
        <div class="chat-part"><div class="stream-chat" id="stream-chat"></div>
        ${me ? '<div class="stream-compose"><input id="stream-input" maxlength="200" placeholder="Chat…" autocomplete="off"><button class="btn small btn-play" id="stream-send">Send</button></div>' : '<div class="note center">Log in to chat.</div>'}</div>
      </div></div>`);
  const v = document.getElementById('watch-video');
  if (isHost && LIVE.out) { v.srcObject = new MediaStream(LIVE.out.getVideoTracks()); v.play().catch(() => {}); }
  if (!isHost && LIVE.remote) { v.srcObject = LIVE.remote; v.play().catch(() => {}); }
  LIVE.chat.forEach(m => liveAppendChat(m, true));
  const send = () => { const i = document.getElementById('stream-input'); const t = i.value.trim(); if (!t) return; emitBattle('stream_chat', { id: LIVE.id, text: t }); i.value = ''; };
  const si = document.getElementById('stream-input'); if (si) { si.onkeydown = e => { if (e.key === 'Enter') send(); }; document.getElementById('stream-send').onclick = send; }
  const tap = document.getElementById('watch-tap'); tap.onclick = () => { v.play().catch(() => {}); tap.classList.add('hidden'); };
  const mute = document.getElementById('watch-mute'); if (mute) mute.onclick = () => { v.muted = !v.muted; mute.textContent = v.muted ? '🔇 Muted' : '🔊 Sound'; };
  const mic = document.getElementById('live-mic'); if (mic) mic.onclick = liveToggleMic;
  const ct = document.getElementById('live-chat-toggle'); if (ct) ct.onclick = liveToggleChat;
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
  if (!quiet && LIVE.role === 'host' && (!box || box.offsetParent === null)) liveFlashChat(m);
}
function liveFlashChat(m) {
  let f = document.getElementById('live-flash');
  if (!f) { f = document.createElement('div'); f.id = 'live-flash'; document.body.appendChild(f); }
  const d = document.createElement('div'); d.innerHTML = '<b>' + escapeHtml(m.user) + '</b> ' + escapeHtml(m.text);
  f.appendChild(d); while (f.children.length > 3) f.firstChild.remove();
  setTimeout(() => d.remove(), 6000);
}

// ---------------------------------------------------------------- recordings
function openVodWatch(v) {
  if (!v) return;
  const host = ensureOverlay('watch-menu'), me = getAuthUser(); toggleMenu('watch-menu');
  const canDel = me && (me.isAdmin || me.username === v.username);
  host.innerHTML = screenHtml('RECORDING', "openLive(LIVE.tab)", `<div class="watch-grid fmt-${v.format} no-chat"><div class="watch-frame fmt-${v.format}"><video id="watch-video" controls playsinline preload="metadata"></video></div>
    <div class="watch-side"><div class="watch-info"><b>${escapeHtml(v.title)}</b><span class="note">${escapeHtml(v.username)}${v.levelLabel ? ' · ' + escapeHtml(v.levelLabel) : ''} · <span id="vod-views">👁 ${v.views}</span> · ${timeAgo(v.createdAt)}</span></div>
    <div class="btn-row"><button class="btn small btn-ghost" id="vod-like">${v.liked ? '❤️' : '🤍'} ${v.likes}</button>${canDel ? '<button class="btn small btn-danger" id="vod-del">🗑 Delete</button>' : ''}</div></div></div>`);
  const vid = document.getElementById('watch-video'); vid.src = apiUrl('/api/vods/' + v.id + '/video');
  vid.addEventListener('loadedmetadata', () => { if (vid.duration === Infinity) { vid.currentTime = 1e101; vid.addEventListener('timeupdate', function fix() { vid.removeEventListener('timeupdate', fix); vid.currentTime = 0; }); } });   // recordings have no length header
  let counted = false;
  vid.addEventListener('play', async () => { if (counted) return; counted = true; try { const d = await apiRequest('/api/vods/' + v.id + '/view', { method: 'POST', auth: true, body: {} }); v.views = d.views; document.getElementById('vod-views').textContent = '👁 ' + d.views; LIVE.vods = {}; } catch (e) {} });
  document.getElementById('vod-like').onclick = async () => { if (!me) { toast('Log in to like.', 'bad'); return; } try { const d = await apiRequest('/api/vods/' + v.id + '/like', { method: 'POST', auth: true, body: {} }); v.liked = d.liked; v.likes = d.likes; document.getElementById('vod-like').textContent = (d.liked ? '❤️ ' : '🤍 ') + d.likes; LIVE.vods = {}; } catch (e) { toast(e.message, 'bad'); } };
  const del = document.getElementById('vod-del'); if (del) del.onclick = async () => { if (!(await uiConfirm('Delete this recording?', 'Delete', true))) return; try { await apiRequest('/api/vods/' + v.id, { method: 'DELETE', auth: true }); LIVE.vods = {}; openLive(LIVE.tab); } catch (e) { toast(e.message, 'bad'); } };
}

// ---------------------------------------------------------------- global voice chat
const VOICE = { on: false, ctx: null, stream: null, proc: null, muted: false, members: [], next: {}, speaking: {}, vol: 1, gain: null };
async function openVoice() {
  ensureOverlay('voice-menu'); toggleMenu('voice-menu'); renderVoice();
  if (!getAuthToken()) toast('Log in to use voice chat.', 'bad');
}
function renderVoice() {
  const host = document.getElementById('voice-menu'); if (!host || host.classList.contains('hidden')) return;
  const mem = VOICE.members.map(m => `<div class="song-row voice-row" id="vm-${m.id}"><div class="song-art voice-art"><span>${escapeHtml((m.name || '?').slice(0, 1).toUpperCase())}</span></div><div class="song-info"><div class="song-title">${escapeHtml(m.name || '')}${m.id === (battleSocket && battleSocket.id) ? ' (you)' : ''}</div></div><span class="speak-dot" data-sid="${m.id}"></span></div>`).join('');
  host.innerHTML = screenHtml('VOICE CHAT', "toggleMenu('main-menu')", `<div class="note center">Everyone in the room can talk and hear each other. Up to 12 people.</div>
    ${VOICE.on ? '<div class="row-btns"><button class="btn ' + (VOICE.muted ? 'btn-danger' : 'btn-play') + '" id="voice-mute">' + (VOICE.muted ? '🔇 Muted' : '🎙 Mic on') + '</button><button class="btn btn-danger" id="voice-leave">Leave</button></div>' +
      '<div class="settings-row"><span>Volume</span><input type="range" id="voice-vol" min="0" max="2" step="0.1" value="' + VOICE.vol + '"></div>'
      : '<button class="btn btn-pink" id="voice-join">🎙 Join voice chat</button>'}
    <div class="song-list">${mem || '<div class="empty">Nobody in the room.</div>'}</div>`);
  const j = document.getElementById('voice-join'); if (j) j.onclick = voiceJoin;
  const l = document.getElementById('voice-leave'); if (l) l.onclick = () => voiceLeave();
  const mu = document.getElementById('voice-mute'); if (mu) mu.onclick = () => { VOICE.muted = !VOICE.muted; renderVoice(); };
  const vo = document.getElementById('voice-vol'); if (vo) vo.oninput = () => { VOICE.vol = Number(vo.value); if (VOICE.gain) VOICE.gain.gain.value = VOICE.vol; };
}
async function voiceJoin() {
  if (!getAuthToken()) { toast('Log in to use voice chat.', 'bad'); return; }
  if (!battleSocket || !battleSocket.connected) { toast('Connecting… try again in a moment.', 'bad'); connectBattle(); return; }
  try { VOICE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { toast('Microphone blocked. Allow it in your browser to talk.', 'bad'); return; }
  const C = window.AudioContext || window.webkitAudioContext; VOICE.ctx = new C({ sampleRate: 16000 }); VOICE.ctx.resume().catch(() => {});
  VOICE.gain = VOICE.ctx.createGain(); VOICE.gain.gain.value = VOICE.vol; VOICE.gain.connect(VOICE.ctx.destination);
  const src = VOICE.ctx.createMediaStreamSource(VOICE.stream), rate = VOICE.ctx.sampleRate;
  VOICE.proc = VOICE.ctx.createScriptProcessor(rate > 24000 ? 4096 : 1024, 1, 1);
  VOICE.proc.onaudioprocess = e => {
    if (VOICE.muted || !battleSocket || !battleSocket.connected) return;
    const f = e.inputBuffer.getChannelData(0); let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    if (Math.sqrt(sum / f.length) < 0.012) return;                       // silence: send nothing
    const pcm = new Int16Array(f.length); for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
    battleSocket.emit('voice_data', { rate, buf: pcm.buffer });
  };
  src.connect(VOICE.proc); const mute0 = VOICE.ctx.createGain(); mute0.gain.value = 0; VOICE.proc.connect(mute0); mute0.connect(VOICE.ctx.destination);
  VOICE.on = true; battleSocket.emit('voice_join'); renderVoice();
}
function voiceLeave(silent) {
  if (VOICE.on) emitBattle('voice_leave');
  VOICE.on = false; try { VOICE.proc && VOICE.proc.disconnect(); } catch (e) {} if (VOICE.stream) VOICE.stream.getTracks().forEach(t => t.stop());
  try { VOICE.ctx && VOICE.ctx.close(); } catch (e) {} VOICE.ctx = null; VOICE.stream = null; VOICE.proc = null; VOICE.next = {}; VOICE.members = [];
  if (!silent) renderVoice();
}
function voicePlay(d) {
  if (!VOICE.on || !VOICE.ctx || !d.buf) return;
  const pcm = new Int16Array(d.buf.buffer ? d.buf.buffer.slice(d.buf.byteOffset, d.buf.byteOffset + d.buf.byteLength) : d.buf), n = pcm.length; if (!n) return;
  const ab = VOICE.ctx.createBuffer(1, n, d.rate || 16000), ch = ab.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = pcm[i] / 32768;
  const s = VOICE.ctx.createBufferSource(); s.buffer = ab; s.connect(VOICE.gain);
  const t = Math.max(VOICE.next[d.from] || 0, VOICE.ctx.currentTime + 0.15); s.start(t); VOICE.next[d.from] = t + ab.duration;
  const dot = document.querySelector('.speak-dot[data-sid="' + d.from + '"]'); if (dot) { dot.classList.add('on'); clearTimeout(dot._t); dot._t = setTimeout(() => dot.classList.remove('on'), 400); }
}
