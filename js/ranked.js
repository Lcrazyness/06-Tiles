// ============================================================================
// ranked.js — RANKED (1v1) and 2v2 battles. Server side: "RANKED + 2v2" in 06-Tiles-Backend/server.js.
//
// One run each, no rounds. Everybody plays the same RATED level with 5 hearts and your score is the % you reach (100% = finished).
//  - Ranked: the higher % wins and moves your ranked points (RP). Ranks: Easy, Normal, Hard, Harder, Insane, Extreme.
//  - 2v2: your team's two % add up; the bigger total wins.
// A random wheel of rated levels in the players' rank range picks the level. When you die while somebody is still alive you
// spectate them until everybody is done. Only tiny messages cross the network (percentages and taps) - never video.
// ============================================================================
const RANK_NAMES = ['Easy', 'Normal', 'Hard', 'Harder', 'Insane', 'Extreme'];
const RANK_FROM = [0, 100, 250, 450, 700, 1000];
const RANK_COLORS = ['#3ddc71', '#37b6ff', '#ff9d3d', '#ff6a3d', '#b34dff', '#ff2d55'];
const rankIdxOfRp = rp => { let i = 0; RANK_FROM.forEach((t, k) => { if ((Number(rp) || 0) >= t) i = k; }); return i; };
const RM = { active: false, over: false, matchId: null, kind: null, you: 0, players: [], level: null, lives: 5, finished: false, watch: null,
  sentH: 0, sentW: 0, lastSend: 0, prog: {}, wheelTimer: 0, party: { members: [], queued: false }, queuedAs: null, lastMode: null };
const rmActive = () => RM.active;

function rmMyRp() { const u = getAuthUser(); return (u && u.rankedRp) || 0; }
function rmRankBadge(name) { const i = Math.max(0, RANK_NAMES.indexOf(name)); return '<span class="rm-rank" style="background:' + RANK_COLORS[i] + '">' + escapeHtml(RANK_NAMES[i]) + '</span>'; }

// ---------------------------------------------------------------- lobby block (rank card + the two buttons + team)
function rmInjectLobby() {
  const host = document.querySelector('#battle-menu .screen-col'); if (!host) return;
  let box = document.getElementById('rm-lobby');
  if (!box) { box = document.createElement('div'); box.id = 'rm-lobby'; host.insertBefore(box, host.firstChild); }
  renderRmLobby();
  if (getAuthToken() && API_BASE_URL) apiRequest('/api/auth/me', { auth: true }).then(d => { if (d && d.user) { saveAuthSession(getAuthToken(), d.user); renderRmLobby(); } }).catch(() => {});
}
function renderRmLobby() {
  const box = document.getElementById('rm-lobby'); if (!box) return;
  const u = getAuthUser(), rp = rmMyRp(), i = rankIdxOfRp(rp), next = RANK_FROM[i + 1];
  const pct = next ? Math.round((rp - RANK_FROM[i]) / (next - RANK_FROM[i]) * 100) : 100;
  const party = RM.party.members.length ? '<div class="rm-party">👥 Team: <b>' + RM.party.members.map(escapeHtml).join(' + ') + '</b> <button class="btn small btn-ghost" onclick="rmLeaveParty()">Leave team</button></div>'
    : '<div class="note center">Tap <b>+ TEAM</b> next to a player below to pick a teammate, or hit 2v2 and the game finds you a random one.</div>';
  box.innerHTML = '<div class="panel rm-card"><div class="rm-card-top"><div>' + rmRankBadge(RANK_NAMES[i]) + ' <b>' + rp + ' RP</b></div><div class="note">' + (u ? (u.rankedWins || 0) + ' W / ' + (u.rankedLosses || 0) + ' L' : 'Log in to play ranked') + '</div></div>' +
    '<div class="xp-bar"><i style="width:' + pct + '%"></i></div><div class="note">' + (next ? (next - rp) + ' RP to ' + RANK_NAMES[i + 1] : 'Top rank!') + '</div></div>' +
    '<div class="row-btns"><button class="btn btn-play" onclick="rankedStart()">🏆 RANKED</button><button class="btn btn-pink" onclick="teamStart()">👥 2v2</button></div>' + party;
}
function partyInviteBtn(p) {
  const b = document.createElement('button'); b.className = 'play-btn ghost'; b.textContent = '+ TEAM'; b.disabled = p.status !== 'lobby' || RM.party.members.length >= 2;
  b.onclick = e => { e.stopPropagation(); emitBattle('party_invite', { toId: p.id }); };
  return b;
}
function rmLeaveParty() { emitBattle('party_leave'); }

function rankedStart() {
  if (!getAuthToken()) { toast('Log in to play ranked.', 'bad'); return; }
  if (battleConnState !== 'online') { toast('Not connected to the battle server yet.'); connectBattle(); return; }
  RM.lastMode = 'ranked'; RM.queuedAs = 'ranked';
  emitBattle('ranked_join');
  setWaiting('Finding a ranked match…', 'You are ' + RANK_NAMES[rankIdxOfRp(rmMyRp())] + ' · ' + rmMyRp() + ' RP. You\'ll be paired with a random player and a wheel picks a rated level in your range. Best % wins.');
}
function teamStart() {
  if (battleConnState !== 'online') { toast('Not connected to the battle server yet.'); connectBattle(); return; }
  RM.lastMode = 'team'; RM.queuedAs = 'team';
  emitBattle('team_join');
  setWaiting('Finding a 2v2 match…', RM.party.members.length === 2 ? 'Your team is searching for another team.' : 'Searching for a teammate and two opponents. The two % on each team add up.');
}

// ---------------------------------------------------------------- the wheel
const WHEEL_COLORS = { Easy: '#3ddc71', Normal: '#37b6ff', Hard: '#ff9d3d', Harder: '#ff6a3d', Insane: '#b34dff', Extreme: '#ff2d55' };
function drawWheel(slices, rotDeg) {
  const c = document.getElementById('rm-wheel'); if (!c) return; const g = c.getContext('2d'), R = c.width / 2, n = slices.length, s = Math.PI * 2 / n;
  g.clearRect(0, 0, c.width, c.height); g.save(); g.translate(R, R); g.rotate(rotDeg * Math.PI / 180);
  slices.forEach((sl, i) => {
    const a0 = -Math.PI / 2 + i * s, a1 = a0 + s;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R - 4, a0, a1); g.closePath();
    g.fillStyle = WHEEL_COLORS[sl.difficulty] || '#37b6ff'; g.globalAlpha = i % 2 ? 0.82 : 1; g.fill(); g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
    g.save(); g.rotate(a0 + s / 2); g.fillStyle = '#fff'; g.font = '800 13px system-ui,sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4;
    g.fillText((sl.name.length > 15 ? sl.name.slice(0, 14) + '…' : sl.name), R - 18, 0); g.restore();
  });
  g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fillStyle = '#12122a'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); g.restore();
}
function rmSpinWheel(d, done) {
  const slices = d.wheel.slices, n = slices.length, s = 360 / n, jitter = (Math.random() - 0.5) * s * 0.6;
  const end = 360 * 6 + ((360 - ((d.wheel.pick + 0.5) * s) % 360) % 360) + jitter, ms = 5200, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 4);
  const step = now => {
    const t = Math.min(1, (now - t0) / ms); drawWheel(slices, end * ease(t));
    if (t < 1 && RM.matchId === d.matchId && !RM.over) RM.wheelTimer = requestAnimationFrame(step); else { drawWheel(slices, end); done(); }
  };
  RM.wheelTimer = requestAnimationFrame(step);
}
function rmShowWheel(d) {
  const me = d.players[d.you];
  document.getElementById('rm-wheel-title').textContent = d.kind === 'ranked' ? '🏆 RANKED MATCH' : '👥 2v2 MATCH';
  const vs = d.kind === 'ranked' ? d.players.map(p => '<span class="rm-vs-p">' + escapeHtml(p.name) + '<br>' + rmRankBadge(p.rank) + '</span>').join('<span class="rm-vs-x">VS</span>')
    : [0, 1].map(t => '<span class="rm-vs-p">' + d.players.filter(p => p.team === t).map(p => escapeHtml(p.name)).join(' + ') + '</span>').join('<span class="rm-vs-x">VS</span>');
  document.getElementById('rm-vs').innerHTML = vs;
  const res = document.getElementById('rm-wheel-result'); res.innerHTML = 'Spinning the wheel…'; res.className = 'rm-wheel-result';
  toggleMenu('rm-wheel-menu'); drawWheel(d.wheel.slices, 0);
  rmSpinWheel(d, () => {
    const sl = d.wheel.slices[d.wheel.pick];
    res.className = 'rm-wheel-result landed'; res.innerHTML = '🎯 <b>' + escapeHtml(sl.name) + '</b><br><span class="diff-badge ' + difficultyBadgeClass(sl.difficulty) + '">' + escapeHtml(sl.difficulty) + '</span> · ' + d.lives + ' hearts · best % wins';
    setTimeout(() => { if (RM.matchId === d.matchId && !RM.over) { emitBattle('rm_ready', { matchId: d.matchId }); res.insertAdjacentHTML('beforeend', '<div class="note">Waiting for everyone to load…</div>'); } }, 1300);
  });
}

// ---------------------------------------------------------------- HUD (everyone's % and hearts)
function rmBuildHud() {
  let hud = document.getElementById('rm-hud'); if (!hud) { hud = document.createElement('div'); hud.id = 'rm-hud'; document.body.appendChild(hud); }
  const myTeam = RM.players[RM.you].team, rank = i => i === RM.you ? 0 : RM.players[i].team === myTeam ? 1 : 2, order = RM.players.map((p, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);   // me, then my teammate, then the opponents
  hud.innerHTML = order.map(i => { const p = RM.players[i], cls = i === RM.you ? 'me' : p.team === myTeam ? 'mate' : 'opp';
    return '<div class="rm-row ' + cls + '" id="rm-row-' + i + '"><span class="rm-n">' + escapeHtml(p.name) + '</span><div class="race-bar-track"><div class="race-bar-fill rm-' + cls + '" style="width:0%"></div></div><span class="rm-p">0%</span><span class="rm-h">♥' + RM.lives + '</span></div>'; }).join('');
  hud.classList.remove('hidden');
}
function rmHudSet(i, pct, lives, out) {
  const row = document.getElementById('rm-row-' + i); if (!row) return;
  row.querySelector('.race-bar-fill').style.width = Math.max(0, Math.min(100, pct)) + '%'; row.querySelector('.rm-p').textContent = pct + '%';
  if (lives !== undefined && lives !== null) row.querySelector('.rm-h').textContent = '♥' + lives;
  if (out) row.classList.add('out');
}
function rmSetBar(text) {
  let b = document.getElementById('rm-watch-bar'); if (!b) { b = document.createElement('div'); b.id = 'rm-watch-bar'; document.body.appendChild(b); }
  if (!text) { b.classList.add('hidden'); return; }
  b.innerHTML = text; b.classList.remove('hidden');
}

// ---------------------------------------------------------------- the match
function rmAttach(s) {
  s.on('ranked_queue', d => { if (!d.queued) RM.queuedAs = null; });
  s.on('team_queue', d => { if (!d.queued) RM.queuedAs = null; RM.party.queued = !!d.queued; });
  s.on('party_update', d => { RM.party = { members: d.members || [], queued: !!d.queued }; renderRmLobby(); });
  s.on('party_msg', d => toast(d.message));
  s.on('party_invited', async d => {
    if (gameActive || inEditor) return;
    if (await uiConfirm(d.from + ' wants to team up with you for 2v2. Accept?', 'Team up')) emitBattle('party_respond', { inviteId: d.inviteId, accept: true });
    else emitBattle('party_respond', { inviteId: d.inviteId, accept: false });
  });
  s.on('rm_error', d => { toast(d.message, 'bad'); RM.queuedAs = null; if (!RM.active) toggleMenu('battle-menu'); });
  s.on('rm_found', d => {
    rmCleanup(); RM.over = false; RM.active = false; RM.matchId = d.matchId; RM.kind = d.kind; RM.you = d.you; RM.players = d.players; RM.level = d.level; RM.lives = d.lives || 5; RM.finished = false; RM.queuedAs = null;
    activeMatch = null; myBattleResult = null;
    prefetchMatchAudio(RM.level);
    rmShowWheel(d);
  });
  s.on('rm_go', d => { if (d.matchId === RM.matchId) rmBegin(d.countdown || 3); });
  s.on('rm_prog', d => { RM.prog[d.i] = d; rmHudSet(d.i, d.pct, d.lives); });
  s.on('rm_state', d => { rmHudSet(d.i, d.pct, undefined, true); if (RM.watch && RM.watch.i === d.i) rmSetBar('👁 ' + escapeHtml(RM.watch.name) + ' is out' + (d.completed ? ' - finished!' : ' at ' + d.pct + '%') + ' · waiting…'); });
  s.on('rm_spectate', d => rmStartWatch(d));
  s.on('rm_feed', d => { if (RM.watch && RM.watch.i === d.i && replayPlay && replayPlay.rm) { replayPlay.data.h.push(...(d.h || [])); replayPlay.data.w.push(...(d.w || [])); } });
  s.on('rm_result', d => rmShowResult(d));
  s.on('rm_cancel', d => { toast(d.message || 'Match cancelled.', 'bad'); rmAbort(); });
}
function rmBegin(countdown) {
  RM.active = true; RM.over = false; RM.finished = false; RM.watch = null; RM.sentH = 0; RM.sentW = 0; RM.lastSend = 0; RM.prog = {};
  rmBuildHud(); rmSetBar(null);
  toggleMenu(null); document.getElementById('countdown').classList.remove('hidden');
  runCountdown(countdown, () => {
    if (!RM.active) return;
    isBattleMode = true; replayPlay = null;
    startGame(RM.level.name, true, -1, RM.level.data, RM.level.effects || [], false, RM.level);
    document.getElementById('battle-race-hud').classList.add('hidden');
    document.getElementById('rm-hud').classList.remove('hidden');
  });
}
// called every frame by the game while a ranked/2v2 run is on: my own bar now, a tiny message to the server ~2.5x per second
function rmProgress(pct, scoreNow) {
  if (!RM.active || RM.finished) return;
  rmHudSet(RM.you, pct, currentLives);
  const now = performance.now(); if (now - RM.lastSend < 400) return; RM.lastSend = now;
  emitBattle('rm_progress', { matchId: RM.matchId, pct, score: scoreNow, lives: currentLives });
  rmFlushTaps(false);
}
// my taps go to the server so a player who dies can watch me; it only relays them to people who are actually watching
function rmFlushTaps(all) {
  if (!rec) return;
  for (let k = 0; k < 20; k++) {
    const h = rec.h.slice(RM.sentH, RM.sentH + 80), w = rec.w.slice(RM.sentW, RM.sentW + 40);
    if (!h.length && !w.length) { if (k === 0 && !all) emitBattle('rm_batch', { matchId: RM.matchId, h: [], w: [], t: customPlayTime }); return; }
    RM.sentH += h.length; RM.sentW += w.length; emitBattle('rm_batch', { matchId: RM.matchId, h, w, t: customPlayTime });
    if (!all) return;
  }
}
function rmFinish(completed, reason) {
  if (!RM.active || RM.finished) return;
  RM.finished = true;
  const pct = completed ? 100 : livePct();
  rmFlushTaps(true);
  emitBattle('rm_finish', { matchId: RM.matchId, completed: !!completed, pct, score: Math.floor(score), reason: String(reason || '').slice(0, 30) });
  rmHudSet(RM.you, pct, currentLives, true);
  showGameHud(false); document.getElementById('rm-hud').classList.remove('hidden');
  rmSetBar(completed ? '✔ You finished! Waiting for the others…' : '💥 Knocked out at <b>' + pct + '%</b> (' + escapeHtml(reason || 'FAILED') + ') · waiting…');
}
// somebody I'm racing is still alive: replay their taps live on the same level (the level plays itself from THEIR inputs)
function rmStartWatch(d) {
  if (!RM.active || RM.over) return;
  if (d.i < 0) { RM.watch = null; if (replayPlay && replayPlay.rm) { stopLoop(); gameActive = false; replayPlay = null; setReplayBanner(null); } rmSetBar('Everyone is done - getting the result…'); return; }
  if (!RM.finished) return;
  RM.watch = { i: d.i, name: d.name };
  stopLoop(); isBattleMode = false;
  replayPlay = { levelId: null, username: d.name, pct: 0, completed: false, live: true, rm: true, i: 0, wi: 0, startAt: Math.max(0, (d.t || 0) - 1.5), data: { h: (d.h || []).slice(), w: (d.w || []).slice(), end: 0, died: null, salt: 0 } };
  startGame(RM.level.name, true, -1, RM.level.data, RM.level.effects || [], false, RM.level);
  document.getElementById('pause-btn').classList.add('hidden'); document.getElementById('rm-hud').classList.remove('hidden');
  const ah = document.getElementById('attempt-hud'); if (ah) ah.classList.add('hidden');
  const mate = RM.kind === 'team' && RM.players[d.i] && RM.players[d.i].team === RM.players[RM.you].team;
  setReplayBanner(null);
  rmSetBar('👁 Watching <b>' + escapeHtml(d.name) + '</b>' + (mate ? ' (your teammate)' : '') + (RM.kind === 'team' ? ' · <button class="btn small btn-ghost" onclick="rmCycleWatch()">Switch</button>' : ''));
}
function rmCycleWatch() { if (!RM.watch) return; const alive = RM.players.map((p, i) => i).filter(i => i !== RM.you && i !== RM.watch.i && !document.getElementById('rm-row-' + i).classList.contains('out')); if (alive.length) emitBattle('rm_watch', { matchId: RM.matchId, i: alive[0] }); }
// the spectated run ended (they died or finished): the server moves me to someone else, or sends the result
function rmWatchEnded(reason) { if (RM.watch) rmSetBar('👁 ' + escapeHtml(RM.watch.name) + ' is out (' + escapeHtml(reason || 'done') + ') · waiting…'); }

function rmCleanup() {
  cancelAnimationFrame(RM.wheelTimer);
  const hud = document.getElementById('rm-hud'); if (hud) hud.classList.add('hidden'); rmSetBar(null);
  RM.over = true; RM.active = false; RM.watch = null;
  if (replayPlay && replayPlay.rm) { replayPlay = null; setReplayBanner(null); }
  document.getElementById('countdown').classList.add('hidden');
}
function rmAbort() { const was = RM.active || RM.matchId; rmCleanup(); stopLoop(); gameActive = false; isBattleMode = false; releaseAllKeys(); bgAudio.pause(); showGameHud(false); if (was) toggleMenu('battle-menu'); }
async function rmLeavePrompt() {
  if (await uiConfirm(RM.kind === 'ranked' ? 'Leave the ranked match? You will lose it and drop ranked points.' : 'Leave the 2v2? Your % so far still counts for your team.', 'Leave', true)) rmLeave();
}
function rmLeave() { if (!RM.matchId) return; emitBattle('rm_leave', { matchId: RM.matchId }); RM.matchId = null; rmAbort(); }

// ---------------------------------------------------------------- result screen
function rmShowResult(d) {
  if (d.matchId !== RM.matchId) return;
  rmCleanup(); stopLoop(); gameActive = false; isBattleMode = false; isDead = true; releaseAllKeys(); bgAudio.pause(); showGameHud(false);
  const me = d.you, myTeam = d.team, team = t => d.players.map((p, i) => ({ p, i })).filter(x => x.p.team === t);
  const row = ({ p, i }) => '<div class="rm-res-row' + (i === me ? ' me' : '') + '"><span>' + escapeHtml(p.name) + '</span><b>' + p.pct + '%' + (p.completed ? ' ✔' : '') + '</b></div>';
  const body = d.kind === 'ranked' ? team(0).concat(team(1)).map(row).join('') :
    [myTeam, 1 - myTeam].map(t => '<div class="rm-res-team ' + (t === myTeam ? 'mine' : '') + '"><div class="note">' + (t === myTeam ? 'YOUR TEAM' : 'OPPONENTS') + ' · ' + d.teams[t].pct + '% total</div>' + team(t).map(row).join('') + '</div>').join('');
  let rp = '';
  if (d.rp) {
    const r = d.rp, up = r.rank.idx > r.oldRank.idx, down = r.rank.idx < r.oldRank.idx, pct = r.rank.next ? Math.round((r.after - r.rank.from) / (r.rank.next - r.rank.from) * 100) : 100;
    rp = '<div class="panel rm-rp"><div class="rm-rp-top">' + rmRankBadge(r.rank.name) + ' <b>' + r.after + ' RP</b> ' + (r.delta === 0 ? '<span class="note">no change</span>' : '<span class="' + (r.delta > 0 ? 'rm-up' : 'rm-down') + '">' + (r.delta > 0 ? '+' : '') + r.delta + '</span>') + '</div><div class="xp-bar"><i style="width:' + pct + '%"></i></div>' +
      (up ? '<div class="rm-rankup">⬆ RANK UP! You are now ' + escapeHtml(r.rank.name) + '</div>' : down ? '<div class="rm-rankdown">⬇ Dropped to ' + escapeHtml(r.rank.name) + '</div>' : '') + '</div>';
    const u = getAuthUser(); if (u) { u.rankedRp = r.after; u.rank = r.rank; if (d.outcome === 'win') u.rankedWins = (u.rankedWins || 0) + 1; else if (d.outcome === 'lose') u.rankedLosses = (u.rankedLosses || 0) + 1; try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u)); } catch (e) {} }
  }
  const panel = document.querySelector('#rm-result-menu .center-panel');
  panel.innerHTML = '<div class="battle-result-banner ' + d.outcome + '">' + (d.outcome === 'win' ? 'VICTORY' : d.outcome === 'lose' ? 'DEFEAT' : 'DRAW') + '</div><div class="note">' + escapeHtml(d.level || '') + (d.forfeit ? ' · they left' : '') + '</div><div class="rm-res">' + body + '</div>' + rp +
    '<button class="btn btn-play" onclick="' + (d.kind === 'ranked' ? 'rankedStart()' : 'teamStart()') + '">PLAY AGAIN</button><button class="btn btn-ghost" onclick="rmBackToLobby()">BACK TO LOBBY</button>';
  RM.matchId = null; toggleMenu('rm-result-menu');
}
function rmBackToLobby() { toggleMenu('battle-menu'); rmInjectLobby(); }

// warm the browser cache with the level's music while the wheel spins (the endpoint is cacheable, so repeat levels cost nothing)
function prefetchMatchAudio(l) {
  try { const u = l && (l.audioUrl ? API_BASE_URL + l.audioUrl : l.songId ? API_BASE_URL + '/api/songs/' + l.songId + '/audio' : null); if (u) fetch(u).catch(() => {}); } catch (e) {}
}
