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

  s.on('connect', () => setBattleConn('online', 'Online'));
  s.on('connect_error', () => setBattleConn('error', 'Server unreachable - tap to retry'));
  s.on('disconnect', () => {
    setBattleConn('offline', 'Disconnected');
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
    document.getElementById('battle-incoming-level').textContent = 'wants to battle on "' + d.level.name + '" (' + d.level.tileCount + ' tiles, ' + d.level.difficulty + ')';
    toggleMenu('battle-incoming-menu');
  });

  s.on('match_found', d => {
    pendingChallengeId = null; incomingChallengeId = null;
    activeMatch = { matchId: d.matchId, opponent: d.opponent.name, level: d.level };
    myBattleResult = null;
    setWaiting('Match found vs ' + d.opponent.name, 'Loading the level…');
    s.emit('match_ready', { matchId: d.matchId });
  });
  s.on('match_go', d => { if (activeMatch && d.matchId === activeMatch.matchId) beginMatch(d.countdown || 3); });
  s.on('match_cancelled', d => { toast(d.message || 'Match cancelled.', 'bad'); abortMatchLocally(); });
  s.on('opp_progress', d => updateOpponentBar(d.pct));
  s.on('opp_finish', d => { updateOpponentBar(d.finished ? 100 : undefined); });
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
function openBattleMenu() { toggleMenu('battle-menu'); connectBattle(); renderOnlinePlayers(); }
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
  setWaiting('Finding an opponent…', 'You\'ll be paired with the next player who hits Quick Match, on a random published level.');
}

async function openBattleLevelPicker() {
  const list = document.getElementById('battle-level-picker-list');
  list.innerHTML = '<div class="empty">Loading…</div>';
  toggleMenu('battle-level-picker');
  const local = getCustomLevels();
  let community = [];
  try { community = await getCommunityLevels('', 'trending'); } catch (e) {}
  list.innerHTML = '';
  const all = [...local.map(l => [l, 'local']), ...community.map(l => [l, 'community'])];
  if (!all.length) { list.innerHTML = '<div class="empty">You need a saved or published level to challenge someone. Make one in the editor first.</div>'; return; }
  all.forEach(([level, source]) => {
    const card = renderLevelCard(level, source);
    card.onclick = null;
    const btn = card.querySelector('.play-btn'); btn.textContent = 'PICK';
    btn.onclick = card.onclick = async (e) => {
      if (e) e.stopPropagation();
      try {
        const full = level.data ? level : await getCommunityLevel(level.id);
        emitBattle('challenge_send', { toId: battlePickTarget.id, level: full });
      } catch (err) { toast(err.message, 'bad'); }
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
  setWaiting(finished ? 'Finished! Waiting for your opponent…' : 'Knocked out (' + (reason || 'FAILED') + ') - waiting on your opponent…', 'The result appears as soon as they finish.');
}

function showBattleResult(d) {
  isBattleMode = false; gameActive = false;
  showGameHud(false);
  const banner = document.getElementById('battle-result-banner');
  banner.className = 'battle-result-banner ' + d.outcome;
  banner.textContent = d.outcome === 'win' ? 'VICTORY' : d.outcome === 'lose' ? 'DEFEAT' : 'DRAW';
  document.getElementById('battle-result-sub').textContent = 'vs ' + d.opp.name + (d.forfeit ? ' (they left)' : '');
  document.getElementById('battle-result-my-score').textContent = d.you.score;
  document.getElementById('battle-result-opp-score').textContent = d.opp.score;
  document.getElementById('battle-result-opp-label').textContent = d.opp.name;
  toggleMenu('battle-result-menu');
}

function rematchBattle() {
  if (!activeMatch) { toggleMenu('battle-menu'); return; }
  myBattleResult = null;
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
