// ============================================================================
// battle.js — 1v1 battles.
//
// Honesty note: there is no game server here, so "online" means "other tabs
// open in this same browser" — synced via BroadcastChannel (with a
// localStorage relay as a fallback/backup). That's genuinely real-time and
// works great for testing with a friend on the same computer, but it will
// NOT find an opponent on a different device. A real cross-device version
// needs a small backend (e.g. a WebSocket relay) — this module is written
// so that swapping broadcastArena()/handleArenaMessage() for real network
// calls is the only thing that would need to change.
// ============================================================================

let arenaChannel = null;
let onlineUsers = {};
let presenceHeartbeatInterval = null;
let quickMatchWaiting = false;
let activeMatch = null;          // { matchId, opponent, level }
let myBattleResult = null;       // { finished, score, reason }
let oppBattleResult = null;      // { finished, score }
let oppLastPct = 0, oppLastScore = 0;
let lastProgressBroadcast = 0;

function initArenaChannel() {
  try {
    arenaChannel = new BroadcastChannel('et_arena_v1');
    arenaChannel.onmessage = (ev) => handleArenaMessage(ev.data);
  } catch (e) {
    console.warn('BroadcastChannel unavailable — battle mode will rely on the localStorage relay only.', e);
  }
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'et_arena_relay' && ev.newValue) {
      try { handleArenaMessage(JSON.parse(ev.newValue)); } catch (e) {}
    }
  });
  window.addEventListener('beforeunload', () => {
    try { broadcastArena({ type: 'presence_bye', name: currentProfile }); } catch (e) {}
  });
}

function broadcastArena(msg) {
  msg._sender = currentProfile; msg._ts = Date.now();
  if (arenaChannel) { try { arenaChannel.postMessage(msg); } catch (e) {} }
  try { localStorage.setItem('et_arena_relay', JSON.stringify(msg)); } catch (e) {}
}

function handleArenaMessage(msg) {
  if (!msg || msg._sender === currentProfile) return;
  switch (msg.type) {
    case 'presence':
      onlineUsers[msg.name] = { ts: msg.ts || Date.now() };
      if (isBattleMenuOpenish()) renderOnlinePlayers();
      break;
    case 'presence_bye':
      delete onlineUsers[msg.name];
      if (isBattleMenuOpenish()) renderOnlinePlayers();
      break;
    case 'quick_match_seek':
      handleIncomingQuickMatchSeek(msg.name);
      break;
    case 'challenge':
      if (msg.to === currentProfile) {
        showIncomingChallenge(msg);
        if (msg.quickMatch) acceptChallenge();
      }
      break;
    case 'challenge_accept':
      if (activeMatch && msg.matchId === activeMatch.matchId) beginMatch();
      break;
    case 'challenge_decline':
      if (activeMatch && msg.matchId === activeMatch.matchId) {
        alert(msg.name + ' declined the battle.');
        cancelBattleFlow();
      }
      break;
    case 'progress':
      if (activeMatch && msg.matchId === activeMatch.matchId && msg.name === activeMatch.opponent) {
        updateOpponentBar(msg.pct, msg.score);
      }
      break;
    case 'finish':
      if (activeMatch && msg.matchId === activeMatch.matchId && msg.name === activeMatch.opponent) {
        oppBattleResult = { finished: msg.finished, score: msg.score };
        updateOpponentBar(msg.finished ? 100 : oppLastPct, msg.score);
        if (myBattleResult) showBattleResult();
      }
      break;
  }
}

// --- presence / lobby ---
function openBattleMenu() {
  toggleMenu('battle-menu');
  announcePresence();
  if (!presenceHeartbeatInterval) presenceHeartbeatInterval = setInterval(announcePresence, 2500);
  renderOnlinePlayers();
}
function leaveBattleMenu() {
  broadcastArena({ type: 'presence_bye', name: currentProfile });
  if (presenceHeartbeatInterval) { clearInterval(presenceHeartbeatInterval); presenceHeartbeatInterval = null; }
  toggleMenu('main-menu');
}
function announcePresence() { broadcastArena({ type: 'presence', name: currentProfile, ts: Date.now() }); }
function isBattleMenuOpenish() { return !document.getElementById('battle-menu').classList.contains('hidden'); }

function renderOnlinePlayers() {
  const list = document.getElementById('battle-online-list');
  const searchInput = document.getElementById('battle-search-input');
  const query = (searchInput && searchInput.value || '').trim().toLowerCase();
  const now = Date.now();
  const names = Object.keys(onlineUsers).filter(n => n !== currentProfile && now - onlineUsers[n].ts < 8000);
  const filtered = query ? names.filter(n => n.toLowerCase().includes(query)) : names;
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div class="battle-empty">No one else is online in this browser right now. Open the game in another tab to test a battle, or hit Quick Match and wait for a partner tab.</div>';
    return;
  }
  filtered.forEach(name => {
    const row = document.createElement('div');
    row.className = 'online-user-row';
    row.innerHTML = `<span class="presence-dot"></span><span class="online-user-name">${escapeHtml(name)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'challenge-btn'; btn.textContent = 'Challenge';
    btn.onclick = () => challengePlayer(name);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

// --- challenge flow ---
let pendingChallengeTarget = null;
function challengePlayer(name) { pendingChallengeTarget = name; openBattleLevelPicker(); }

function openBattleLevelPicker() {
  const list = document.getElementById('battle-level-picker-list');
  list.innerHTML = '';
  const communityIds = new Set(getCommunityLevels().map(l => l.id));
  const levels = [...getCustomLevels(), ...getCommunityLevels()];
  if (levels.length === 0) {
    list.innerHTML = '<div class="battle-empty">You need at least one saved or published level to challenge someone with. Make one in the editor first.</div>';
  } else {
    levels.forEach(level => {
      const card = renderLevelCard(level, communityIds.has(level.id));
      card.onclick = () => sendChallenge(pendingChallengeTarget, level, false);
      list.appendChild(card);
    });
  }
  toggleMenu('battle-level-picker');
}

function sendChallenge(toName, level, quickMatch) {
  const matchId = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  activeMatch = { matchId, opponent: toName, level };
  myBattleResult = null; oppBattleResult = null; oppLastPct = 0; oppLastScore = 0;
  broadcastArena({
    type: 'challenge', to: toName, name: currentProfile, matchId, quickMatch: !!quickMatch,
    level: { id: level.id, name: level.name, data: level.data, effects: level.effects || [], lives: level.lives, fps: level.fps, audioOffset: level.audioOffset, disableHolds: level.disableHolds }
  });
  document.getElementById('battle-waiting-title').innerText = 'Waiting for ' + toName + '...';
  document.getElementById('battle-waiting-sub').innerText = 'They need to accept your challenge.';
  toggleMenu('battle-waiting-menu');
}

function showIncomingChallenge(msg) {
  activeMatch = { matchId: msg.matchId, opponent: msg.name, level: msg.level };
  myBattleResult = null; oppBattleResult = null; oppLastPct = 0; oppLastScore = 0;
  document.getElementById('battle-incoming-avatar').textContent = msg.name.slice(0, 1).toUpperCase();
  document.getElementById('battle-incoming-name').textContent = msg.name;
  document.getElementById('battle-incoming-level').textContent = 'wants to battle on "' + msg.level.name + '"';
  if (!msg.quickMatch) toggleMenu('battle-incoming-menu');
}

function acceptChallenge() {
  if (!activeMatch) return;
  broadcastArena({ type: 'challenge_accept', matchId: activeMatch.matchId, name: currentProfile });
  beginMatch();
}
function declineChallenge() {
  if (!activeMatch) return;
  broadcastArena({ type: 'challenge_decline', matchId: activeMatch.matchId, name: currentProfile });
  activeMatch = null;
  toggleMenu('battle-menu');
}
function cancelBattleFlow() {
  if (activeMatch && !myBattleResult) {
    broadcastArena({ type: 'challenge_decline', matchId: activeMatch.matchId, name: currentProfile });
  }
  quickMatchWaiting = false; activeMatch = null; isBattleMode = false;
  toggleMenu('battle-menu');
}

// --- quick match ---
function startQuickMatch() {
  quickMatchWaiting = true;
  broadcastArena({ type: 'quick_match_seek', name: currentProfile });
  document.getElementById('battle-waiting-title').innerText = 'Finding an opponent...';
  document.getElementById('battle-waiting-sub').innerText = 'Keep this open — another tab hitting Quick Match will pair with you.';
  toggleMenu('battle-waiting-menu');
}
function handleIncomingQuickMatchSeek(name) {
  if (!quickMatchWaiting || name === currentProfile) return;
  quickMatchWaiting = false;
  const iHost = currentProfile < name; // deterministic tie-break so only one side proposes
  if (iHost) {
    const pool = getCommunityLevels().length ? getCommunityLevels() : getCustomLevels();
    if (pool.length === 0) { alert('No levels available yet to quick match with — publish or save one first.'); toggleMenu('battle-menu'); return; }
    const level = pool[Math.floor(Math.random() * pool.length)];
    sendChallenge(name, level, true);
  } else {
    document.getElementById('battle-waiting-title').innerText = 'Match found!';
    document.getElementById('battle-waiting-sub').innerText = 'Setting up your battle...';
  }
}

// --- the race itself ---
function beginMatch() {
  if (!activeMatch) return;
  document.getElementById('race-name-me').textContent = currentProfile;
  document.getElementById('race-name-opp').textContent = activeMatch.opponent;
  document.getElementById('race-bar-me').style.width = '0%';
  document.getElementById('race-bar-opp').style.width = '0%';
  document.getElementById('battle-race-hud').classList.remove('hidden');
  isBattleMode = true;
  const level = activeMatch.level;
  toggleMenu(null);
  document.getElementById('editor-ui').classList.add('hidden');
  startGame(level.name, true, -1, level.data, level.effects || [], false, level);
}

function updateOpponentBar(pct, score) {
  oppLastPct = pct; oppLastScore = score;
  const bar = document.getElementById('race-bar-opp');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function updateBattleProgress(pct, score) {
  const bar = document.getElementById('race-bar-me');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const now = Date.now();
  if (now - lastProgressBroadcast < 200 || !activeMatch) return;
  lastProgressBroadcast = now;
  broadcastArena({ type: 'progress', matchId: activeMatch.matchId, name: currentProfile, pct, score });
}

function handleBattleFinish(finished, reason) {
  if (myBattleResult) return;
  myBattleResult = { finished, score: Math.floor(score), reason };
  document.getElementById('battle-race-hud').classList.add('hidden');
  document.getElementById('lives-display').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  if (activeMatch) broadcastArena({ type: 'finish', matchId: activeMatch.matchId, name: currentProfile, finished, score: myBattleResult.score });

  if (oppBattleResult) {
    showBattleResult();
  } else {
    document.getElementById('battle-waiting-title').innerText = finished ? 'Waiting for opponent to finish...' : 'Knocked out — waiting on your opponent...';
    document.getElementById('battle-waiting-sub').innerText = 'The result appears as soon as they finish.';
    toggleMenu('battle-waiting-menu');
  }
}

function showBattleResult() {
  const my = myBattleResult, opp = oppBattleResult;
  let outcome;
  if (my.finished && !opp.finished) outcome = 'win';
  else if (!my.finished && opp.finished) outcome = 'lose';
  else if (my.score > opp.score) outcome = 'win';
  else if (my.score < opp.score) outcome = 'lose';
  else outcome = 'draw';

  const banner = document.getElementById('battle-result-banner');
  banner.className = 'battle-result-banner ' + outcome;
  banner.textContent = outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'DRAW';
  document.getElementById('battle-result-sub').textContent = activeMatch ? ('vs ' + activeMatch.opponent) : '';
  document.getElementById('battle-result-my-score').textContent = my.score;
  document.getElementById('battle-result-opp-score').textContent = opp.score;
  document.getElementById('battle-result-opp-label').textContent = activeMatch ? activeMatch.opponent : 'Opponent';
  isBattleMode = false;
  toggleMenu('battle-result-menu');
}

function rematchBattle() {
  if (!activeMatch) { toggleMenu('battle-menu'); return; }
  const opponent = activeMatch.opponent, level = activeMatch.level;
  myBattleResult = null; oppBattleResult = null;
  sendChallenge(opponent, level, false);
}
