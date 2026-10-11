// ============================================================================
// game.js — the rhythm-game engine: entities, the render/update loop, level
// playback (built-in + custom levels), effect firing, input, pause, and the
// death/retry/quit flow. Also owns starting/stopping an editor session.
//
// What changed in this rewrite (all of it is glitch-fixing — tile rules,
// speeds, hit windows and tile visuals are untouched):
//   * ONE clock. Level time, tile movement and effects now all advance from the
//     same animation-frame delta. Before, a 16ms setInterval drove spawning
//     while requestAnimationFrame drove movement, so they drifted apart and
//     tiles could spawn out of order after a hitch ("WRONG ORDER!").
//   * Exactly one loop can ever run (startLoop/stopLoop). Restarting a level
//     or re-entering the editor used to stack extra loops.
//   * The frame limiter no longer drops random frames on 60Hz screens.
//   * Touch / mouse input (it was keyboard-only), pause (Esc / button / tab
//     switch), and crisp rendering on big / hi-dpi screens.
//   * Hotkeys are ignored while typing in a text box.
// ============================================================================

class Tile {
  constructor(lane, overrideY = -TILE_H, isHold = false, holdDuration = 0) {
    this.lane = lane;
    this.y = overrideY;
    this.isHold = isHold;
    this.holdDuration = holdDuration;
    this.interacted = false;
    this.failed = false;
    this.noteIdx = -1;
    this.time = 0;
  }
}

class Particle {
  constructor(x, y) {
    this.color = particleColor();
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 15;
    this.vy = (Math.random() - 0.5) * 15;
    this.life = 1.0;
  }
  update(dt = 1) { this.x += this.vx * dt; this.y += this.vy * dt; this.life -= 0.05 * dt; }
}

// --- loop control: exactly one requestAnimationFrame chain, ever ---
function startLoop() {
  stopLoop();
  lastTime = performance.now();
  nextFrameAt = 0;
  rafId = requestAnimationFrame(gameLoop);
}
function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function fxLater(fn, ms) {
  const id = setTimeout(() => { fxTimeouts = fxTimeouts.filter(x => x !== id); fn(); }, Math.max(0, ms));
  fxTimeouts.push(id);
}
function clearFxTimeouts() { fxTimeouts.forEach(clearTimeout); fxTimeouts = []; }

let lastScoreShown = -1, lastPctShown = -1;
let showProgressBar = localStorage.getItem('et_progBar') !== 'false';
let autoCheckpoints = localStorage.getItem('et_autoCP') !== 'false';
let autoCheckpointSec = Math.max(1, Number(localStorage.getItem('et_autoCPSec')) || 3);
let currentLevelKey = '';
const bestPctMap = () => { try { return JSON.parse(localStorage.getItem('et_bestPct') || '{}'); } catch (e) { return {}; } };
const getBestPct = k => bestPctMap()[k] || 0;
function noteBestPct(pct) {
  if (!currentLevelKey || practiceMode || isPlaytesting || isVerifying || isBattleMode) return;
  const m = bestPctMap(); if ((m[currentLevelKey] || 0) >= pct) return;
  m[currentLevelKey] = pct; try { localStorage.setItem('et_bestPct', JSON.stringify(m)); } catch (e) {}
}
function livePct() { return levelLastNoteTime > 0 ? Math.min(99, Math.floor(customPlayTime / levelLastNoteTime * 100)) : 0; }
function updateProgressBar(pct) {
  const bar = document.getElementById('progress-bar'); if (!bar) return;
  bar.classList.toggle('hidden', !showProgressBar || !isCustomGame || isBattleMode);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-best').style.left = getBestPct(currentLevelKey) + '%';
}

function resetState() {
  score = 0; notesHitThisGame = 0; tiles = []; particles = []; isDead = false; isPaused = false; patternStep = 0;
  scoreEl.innerText = "0"; lastScoreShown = 0; lastPctShown = -1;
  distanceTraveled = 0; nextSpawnDistance = 0; currentLives = maxLives;
  document.getElementById('lives-count').innerText = currentLives;
  document.getElementById('fps-display').innerText = "60 FPS";
  document.getElementById('progress-display').innerText = "0%";
  frameCount = 0;
  lastFpsTime = performance.now();
  levelEndTime = 0; customPlayTime = 0;
  pendingTiles = []; pendingTileIdx = 0; pendingEffects = []; pendingEffectIdx = 0;
  levelAudioStarted = false;
  clearFxTimeouts();
  document.body.style.background = currentLevelBackground || 'var(--bg-void)';
  canvas.style.filter = 'brightness(' + (Number(currentLevelBrightness || gameBrightness) / 100) + ')';
  ['bg-image-container', 'fg-image-container', 'bg-flash', 'fg-flash'].forEach(id => { document.getElementById(id).style.opacity = 0; });
  document.getElementById('extra-images-bg').innerHTML = "";
  document.getElementById('extra-images-fg').innerHTML = "";
  currentTileStyle = { c1: "#000000", c2: "#000000", alpha: 1.0 };
  targetSpeed = speed; speedTransitionTime = 0; speedTransitionDuration = 0; initialSpeed = speed;
  bgAudio.pause();
  try { bgAudio.currentTime = 0; } catch (e) {}
  lastTime = performance.now();
}

function triggerRedFlash() {
  const flash = document.getElementById('red-flash'); flash.style.opacity = 0.8;
  setTimeout(() => { flash.style.opacity = 0; }, 150);
}

function handleHit() {
  const noclip = document.getElementById('edit-noclip');
  // NoClip is a playtest convenience only — it must never count when verifying a level for publishing.
  if (noclip && noclip.checked && (inEditor || (isPlaytesting && !isVerifying))) return true;
  if (currentLives > 1) { currentLives--; document.getElementById('lives-count').innerText = currentLives; triggerRedFlash(); return true; }
  return false;
}

function showGameHud(show, battle) {
  ['lives-display', 'game-hud', 'score-container'].forEach(id => document.getElementById(id).classList.toggle('hidden', !show));
  document.getElementById('pause-btn').classList.toggle('hidden', !show || !!battle);
  { const ah = document.getElementById('attempt-hud'); if (ah && !show) ah.classList.add('hidden'); }
  if (!show) document.getElementById('battle-race-hud').classList.add('hidden');
}

function editorLevelConfig() {
  return {
    strictMode: !!(document.getElementById('edit-strict') && document.getElementById('edit-strict').checked),
    lockCosmetics: !!(document.getElementById('edit-lock-cos') && document.getElementById('edit-lock-cos').checked),
    lives: Math.max(1, Math.min(10, parseInt(document.getElementById('edit-lives').value) || 3)),
    fps: parseInt(document.getElementById('edit-fps').value) || 60,
    audioOffset: parseInt(document.getElementById('edit-audio-offset').value) || 0,
    disableHolds: document.getElementById('edit-disable-holds').checked
  };
}

function startGame(mode, isCustom = false, customIndex = -1, testTiles = null, testEffects = null, isCommunity = false, loadedLevelObj = null) {
  lastStartArgs = [mode, isCustom, customIndex, testTiles, testEffects, isCommunity, loadedLevelObj];
  stopLoop();
  stopEditorTransport();
  clearTimeout(autoRetryTimer);
  currentMode = mode; isCustomGame = isCustom;
  inEditor = false;   // (verify used to leave this true, which silently disabled all input)

  currentLevelBackground = isCustom && loadedLevelObj ? (loadedLevelObj.backgroundColor || '#202738') : '#202738';
  currentLevelBrightness = isCustom && loadedLevelObj ? Number(loadedLevelObj.backgroundBrightness || 100) : gameBrightness;
  if (isCustom && testTiles && !loadedLevelObj) {
    const editorBg = document.getElementById('edit-bg-color');
    const editorBrightness = document.getElementById('edit-bg-brightness');
    if (editorBg) currentLevelBackground = editorBg.value || '#202738';
    if (editorBrightness) currentLevelBrightness = Number(editorBrightness.value || 100);
  }
  if (!isCustom) maxLives = 3;   // built-in levels used to inherit hearts from whatever level you played last

  gameActive = true;
  resetState();
  releaseAllKeys();
  if (!isPlaytesting && !isVerifying && !isBattleMode) beginStatsGame();
  toggleMenu(null);
  document.getElementById('editor-ui').classList.add('hidden');
  document.getElementById('stop-playtest-btn').classList.toggle('hidden', !isPlaytesting);
  showGameHud(true, isBattleMode);
  layoutCanvas();

  if (!isCustom) {
    const customSpeed = document.getElementById('speed-' + mode);
    speed = customSpeed ? parseInt(customSpeed.value) : EDITOR_BASE_SPEED; targetSpeed = speed; initialSpeed = speed;
    windowLevelFPS = 60;
    document.getElementById('progress-display').classList.add('hidden');
    decorData = newDecorData(); decorReset([]); currentLevelKey = '';
    updateProgressBar(0);
    spawnTile();
  } else {
    document.getElementById('progress-display').classList.remove('hidden');
    speed = EDITOR_BASE_SPEED; targetSpeed = EDITOR_BASE_SPEED; initialSpeed = EDITOR_BASE_SPEED;

    const sourceLevel = loadedLevelObj || (customIndex !== -1 ? getCustomLevels()[customIndex] : null);
    const tilesIn = testTiles || (sourceLevel && sourceLevel.data) || [];
    const effectsIn = testEffects || (sourceLevel && sourceLevel.effects) || [];
    pendingTiles = JSON.parse(JSON.stringify(tilesIn)).sort((a, b) => a.time - b.time || a.lane - b.lane);
    pendingEffects = JSON.parse(JSON.stringify(effectsIn)).sort((a, b) => a.time - b.time);
    pendingTileIdx = 0; pendingEffectIdx = 0;
    if (sourceLevel) decorData = normalizeDecor(sourceLevel.decor); else decorData = normalizeDecor(decorData);
    decorReset(pendingEffects);

    const allTimes = [0];
    pendingTiles.forEach(t => allTimes.push(t.time + (t.holdDuration || 0)));
    pendingEffects.forEach(e => allTimes.push(e.time));
    levelEndTime = Math.max(...allTimes) + 1.6;
    verifyEndTime = levelEndTime;

    const cfg = sourceLevel
      ? { lives: sourceLevel.lives !== undefined ? sourceLevel.lives : 3, fps: sourceLevel.fps || 60, audioOffset: sourceLevel.audioOffset || 0, disableHolds: !!sourceLevel.disableHolds }
      : editorLevelConfig();
    maxLives = Math.max(1, Math.min(10, Math.floor(Number(cfg.lives)) || 3));   // was only applied for saved levels, so editor changes were ignored when verifying
    currentLives = maxLives;
    windowLevelFPS = cfg.fps >= 10 ? cfg.fps : 60;
    levelDisableHolds = cfg.disableHolds;
    strictMode = sourceLevel ? !!sourceLevel.strictMode : !!(document.getElementById('edit-strict') && document.getElementById('edit-strict').checked);
    hitZone = defaultHitZone(); tileHb = { scale: 1, offset: 0 }; tileMoveFx = null; tileHideFx = null;
    lockCosmetics = sourceLevel ? !!sourceLevel.lockCosmetics : !!(document.getElementById('edit-lock-cos') && document.getElementById('edit-lock-cos').checked);
    levelLastNoteTime = pendingTiles.length ? pendingTiles[pendingTiles.length - 1].time : 0;
    runStartedAt = performance.now();
    const wasRespawn = practiceArmed;
    practiceMode = practiceArmed && !!loadedLevelObj; practiceArmed = false;
    if (!practiceMode) { practiceStartSec = 0; practiceBaseSec = 0; practiceCheckpoints = []; }
    const levelKey = loadedLevelObj && loadedLevelObj.id ? loadedLevelObj.id : 'editor-' + (currentEditingId || 'new');
    currentLevelKey = loadedLevelObj && loadedLevelObj.id ? String(loadedLevelObj.id) : '';
    if (!wasRespawn) currentAttempt = bumpAttempts(levelKey);
    { const ah = document.getElementById('attempt-hud'); if (ah) { ah.textContent = 'Attempt ' + currentAttempt + (practiceMode ? ' · PRACTICE' : ''); ah.classList.toggle('hidden', isBattleMode); } }
    if (practiceMode && practiceStartSec > 0) fastForwardTo(practiceStartSec);
    else if (startPosArmed && isPlaytesting && editorStartPos !== null) fastForwardTo(editorStartPos);
    startPosArmed = false;
    practiceNextAuto = (practiceMode ? Math.max(customPlayTime, practiceStartSec) : 0) + autoCheckpointSec;
    decorUpdate(customPlayTime);
    updateProgressBar(0);
    globeGhosts.clear();
    if (typeof globeSync === 'function') globeSync(loadedLevelObj && loadedLevelObj.id);
    levelAudioOffsetMs = parseInt(cfg.audioOffset) || 0;
    document.getElementById('lives-count').innerText = currentLives;

    // Music: levels carry their own song (saved with the level / published with it). Editor playtests use the song loaded in the editor.
    let audioSrc = null;
    if (sourceLevel) audioSrc = sourceLevel._audioUrl || sourceLevel.audio || (sourceLevel.songId && typeof API_BASE_URL !== 'undefined' ? API_BASE_URL + '/api/songs/' + sourceLevel.songId + '/audio' : null);
    else if (currentAudioUrl) audioSrc = currentAudioUrl;
    levelUsesAudio = !!audioSrc && !isBattleMode;
    levelStartPositions = sourceLevel && Array.isArray(sourceLevel.startPositions) ? sourceLevel.startPositions : [];
    if (levelUsesAudio) {
      if (bgAudio.getAttribute('src') !== audioSrc) { bgAudio.src = audioSrc; bgAudio.load(); }
      seekLevelAudio();
    } else bgAudio.pause();
  }
  startLoop();
}
let levelUsesAudio = false;
// Music offset (ms): + = the song plays EARLIER than the level (song is ahead), - = the song plays LATER (starts after the level has begun).
function seekLevelAudio() {
  if (!levelUsesAudio) return;
  const st = customPlayTime + levelAudioOffsetMs / 1000;
  const go = () => {
    if (st >= 0) { try { bgAudio.currentTime = st; } catch (e) {} bgAudio.play().catch(() => {}); levelAudioStarted = true; }
    else { bgAudio.pause(); try { bgAudio.currentTime = 0; } catch (e) {} levelAudioStarted = false; }
  };
  if (bgAudio.readyState >= 1) go(); else bgAudio.addEventListener('loadedmetadata', go, { once: true });
}
const editorOffsetMs = () => parseInt((document.getElementById('edit-audio-offset') || {}).value) || 0;
const songPos = t => t + editorOffsetMs() / 1000;

function spawnTile() {
  let currentSpawn = patterns[currentMode] ? patterns[currentMode][patternStep] : Math.floor(Math.random() * 4);
  if (Array.isArray(currentSpawn)) { currentSpawn.forEach(lane => tiles.push(new Tile(lane))); }
  else { tiles.push(new Tile(currentSpawn)); }
  if (patterns[currentMode]) { patternStep++; if (patternStep >= patterns[currentMode].length) patternStep = 0; }
  nextSpawnDistance = TILE_H + GAP; distanceTraveled = 0;
}

// --- effect firing (level playback) ---
function fireAdvancedPulse(fx) {
  const target = (fx.layer == 1) ? document.getElementById('fg-flash') : document.getElementById('bg-flash');
  target.style.transition = `opacity ${fx.inTrans}s ease-out`; target.style.background = fx.color; target.style.opacity = 1;
  fxLater(() => { target.style.transition = `opacity ${fx.outTrans}s ease-in`; target.style.opacity = 0; }, (fx.duration - fx.outTrans) * 1000);
}
function fireAdvancedImage(fx) {
  const target = (fx.layer == 1) ? document.getElementById('fg-image-container') : document.getElementById('bg-image-container');
  target.style.backgroundImage = `url(${fx.src})`; target.style.transition = `opacity ${fx.inTrans}s ease-out`; target.style.opacity = fx.alpha;
  fxLater(() => { target.style.transition = `opacity ${fx.outTrans}s ease-in`; target.style.opacity = 0; }, (fx.duration - fx.outTrans) * 1000);
}
function fireExtraImage(fx) {
  // Positions are stored in board coordinates (360x640); the layer is sized to the board, so use percentages.
  const img = document.createElement('img');
  img.src = fx.src;
  img.style.position = 'absolute';
  img.style.left = (fx.x / GW * 100) + '%';
  img.style.top = (fx.y / GH * 100) + '%';
  img.style.width = (fx.w / GW * 100) + '%';
  img.style.height = (fx.h / GH * 100) + '%';
  img.style.opacity = fx.alpha;
  img.style.transform = 'translate(-50%, -50%)';
  const container = fx.layer == 1 ? document.getElementById('extra-images-fg') : document.getElementById('extra-images-bg');
  container.appendChild(img);
  fxLater(() => { if (img.parentNode) img.parentNode.removeChild(img); }, fx.duration * 1000);
}
function fireTileStyle(fx) { currentTileStyle.c1 = fx.c1; currentTileStyle.c2 = fx.c2; currentTileStyle.alpha = fx.alpha; }
function fireSpeedChange(fx) { initialSpeed = speed; targetSpeed = fx.target; speedTransitionDuration = Number(fx.transDuration) || 0; speedTransitionTime = 0; if (!(speedTransitionDuration > 0)) speed = initialSpeed = targetSpeed; }
function fireSFX(fx) { if (!fx.src) return; const audio = new Audio(fx.src); audio.volume = Math.max(0, Math.min(1, fx.vol === undefined ? 1 : Number(fx.vol))); audio.playbackRate = Math.max(0.25, Math.min(4, Number(fx.rate) || 1)); audio.play().catch(() => {}); }
function hbVal(fx, lane, k, def) {
  const v = fx['z' + lane + k];
  if (v !== undefined && Number.isFinite(Number(v))) return Number(v);
  const old = k === 't' ? fx.zoneTop : fx.zoneH;               // older levels used one box for every lane
  return Number.isFinite(Number(old)) && old !== undefined ? Number(old) : def;
}
function fireHitbox(fx) {
  hitZone = { on: Number(fx.zoneOn) === 1, lanes: [0, 1, 2, 3].map(l => ({ top: hbVal(fx, l, 't', 400), h: Math.max(20, hbVal(fx, l, 'h', 140)) })) };
  tileHb = { scale: 1, offset: 0 };
}
function fireVideo(fx) {
  if (!fx.url) return;
  const v = document.createElement('video');
  v.src = fx.url; v.muted = true; v.loop = Number(fx.loop) !== 0; v.playsInline = true; v.autoplay = true;
  v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:' + (fx.alpha === undefined ? 0.6 : fx.alpha) + ';';
  const c = fx.layer == 1 ? document.getElementById('extra-images-fg') : document.getElementById('extra-images-bg');
  if (!c) return;
  c.appendChild(v); v.play().catch(() => {});
  fxLater(() => { v.pause(); if (v.parentNode) v.parentNode.removeChild(v); }, (fx.duration || 5) * 1000);
}
function particleColor() {
  switch (lockCosmetics ? 'default' : cosmeticFx) {
    case 'sparkle': return Math.random() < 0.5 ? '#fff2a8' : '#ffffff';
    case 'fire': return ['#ff7a18', '#ffd23f', '#ff3d00'][Math.floor(Math.random() * 3)];
    case 'confetti': return ['#ff4f81', '#4fd1ff', '#ffd23f', '#7cff6b', '#b36bff'][Math.floor(Math.random() * 5)];
    default: return '#00ffff';
  }
}
const TILE_COSMETIC_COLORS = { ice: '#7fdcff', gold: '#ffcf40', neon: '#39ff88', royal: '#9b5cff' };
function tileFill() {
  if (!lockCosmetics && currentTileStyle.c1 === '#000000' && TILE_COSMETIC_COLORS[cosmeticTile]) return TILE_COSMETIC_COLORS[cosmeticTile];
  return currentTileStyle.c1;
}
function tileOffsetX(t) {
  const m = tileMoveFx; if (!m) return 0;
  const el = customPlayTime - m.start; if (el < 0 || el > m.dur) return 0;
  const edge = Math.max(0, Math.min(1, el / 0.3, (m.dur - el) / 0.3));
  return m.mode === 1 ? Math.sin(el * 5 + t.y / 90) * m.amount * edge : m.amount * edge;
}
function tileAlphaMul(headTop) {
  const h = tileHideFx; if (!h) return 1;
  const el = customPlayTime - h.start; if (el < 0 || el > h.dur) return 1;
  if (h.mode === 1) return 0;                                   // invisible: pure memory
  return headTop < h.fadeY ? 1 : Math.max(0, 1 - (headTop - h.fadeY) / 120);   // fades out as it falls
}
function globeColor(name) { return 'hsl(' + (hashString(name) % 360) + ',90%,62%)'; }

// Practice mode: start anywhere, checkpoints every 10% (or press C), dying sends you back to the checkpoint.
function fastForwardTo(sec) {
  customPlayTime = Math.max(0, sec - 1.2);
  while (pendingTileIdx < pendingTiles.length && pendingTiles[pendingTileIdx].time < sec) pendingTileIdx++;
  while (pendingEffectIdx < pendingEffects.length && pendingEffects[pendingEffectIdx].time <= customPlayTime) {
    const fx = pendingEffects[pendingEffectIdx++];
    if (fx.type === 'tile_style') fireTileStyle(fx);
    else if (fx.type === 'speed') { speed = targetSpeed = initialSpeed = fx.target; speedTransitionDuration = 0; }
    else if (fx.type === 'hitbox') fireHitbox(fx);
    else if (!['pulse', 'image', 'extra_image', 'sfx', 'video', 'tilemove', 'tilehide'].includes(fx.type)) { decorUpdate(fx.time); decorFire(fx, fx.time, true); }
  }
  decorUpdate(customPlayTime);
}
// Practice: a checkpoint is dropped automatically every `autoCheckpointSec` seconds (Settings); P / O still place / remove them by hand.
function maybeAutoCheckpoint() {
  if (!practiceMode || !autoCheckpoints || isBattleMode) return;
  if (customPlayTime >= practiceNextAuto) {
    const last = practiceCheckpoints.length ? practiceCheckpoints[practiceCheckpoints.length - 1] : -1;
    if (practiceNextAuto > last + 0.5) practiceCheckpoints.push(Math.round(practiceNextAuto * 100) / 100);
    practiceNextAuto += autoCheckpointSec;
  }
}
function practiceRespawn() {
  practiceStartSec = practiceCheckpoints.length ? practiceCheckpoints[practiceCheckpoints.length - 1] : practiceBaseSec;
  practiceArmed = true;
  if (lastStartArgs) startGame.apply(null, lastStartArgs);
}
function togglePracticeFromPause() {
  if (!lastStartArgs || !lastStartArgs[6] || isBattleMode || isPlaytesting || isVerifying) { toast('Practice works on levels from My Levels and Browse.'); return; }
  if (!practiceMode) {
    practiceMode = true; practiceCheckpoints = []; practiceBaseSec = 0;
    toast('Practice ON - press ' + shortcuts.pPlace.toUpperCase() + ' to place a checkpoint, ' + shortcuts.pRemove.toUpperCase() + ' to remove it. Stats don\'t count.', 'good');
    resumeGame();
  } else {
    practiceMode = false; practiceCheckpoints = []; practiceBaseSec = 0;
    toast('Practice off.'); restartGame();
  }
}
function switchStartPos(dir) {
  if (!shortcuts.switcher || isBattleMode) return;
  const playtest = isPlaytesting;
  if (!playtest && !practiceMode) return;                  // start positions only work in editor playtests and practice
  const list = playtest ? editorStartPositions : levelStartPositions;
  if (!list.length) { toast('This level has no start positions.'); return; }
  activeStartIdx = Math.max(-1, Math.min(list.length - 1, activeStartIdx + dir));
  const t = activeStartIdx >= 0 ? list[activeStartIdx] : 0;
  toast(activeStartIdx >= 0 ? 'Start position ' + (activeStartIdx + 1) + '/' + list.length + ' (' + t.toFixed(1) + 's)' : 'Start of the level');
  document.getElementById('death-screen').classList.add('hidden');
  if (playtest) { startPlaytest(); }
  else { practiceBaseSec = t; practiceCheckpoints = []; practiceStartSec = t; practiceArmed = true; if (lastStartArgs) startGame.apply(null, lastStartArgs); }
}
window.addEventListener('keydown', e => {
  if (e.repeat || isTypingTarget(e) || dialogOpen() || inEditor || (!gameActive && !isDead)) return;
  const k = e.key.toLowerCase();
  if (keyMap.includes(k)) return;
  if (practiceMode && gameActive && !isPaused) {
    if (k === shortcuts.pPlace) { practiceCheckpoints.push(customPlayTime); toast('Checkpoint #' + practiceCheckpoints.length, 'good'); return; }
    if (k === shortcuts.pRemove) { if (practiceCheckpoints.length) { practiceCheckpoints.pop(); toast('Checkpoint removed (' + practiceCheckpoints.length + ' left)'); } return; }
  }
  if (k === shortcuts.sPrev) switchStartPos(-1);
  else if (k === shortcuts.sNext) switchStartPos(1);
});

// Hitbox overlay (Settings > Show hitboxes): the input zone, plus a line between consecutive tiles labelled with the time you get to reach the next one.
function drawHitboxOverlay() {
  ctx.save();
  if (hitZone.on) {
    hitZone.lanes.forEach((z, l) => {
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#00f0ff'; ctx.fillRect(l * laneW + 1, z.top, laneW - 2, z.h);
      ctx.globalAlpha = 1; ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(l * laneW + 2, z.top, laneW - 4, z.h);
    });
    ctx.setLineDash([]);
  }
  const vis = tiles.filter(t => !t.interacted && t.y > 0 && t.y - TILE_H < GH).sort((a, b) => b.y - a.y);
  ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < vis.length - 1; i++) {
    const a = vis[i], b = vis[i + 1];
    if (Math.abs(a.y - b.y) < 3) continue;                       // same row (chord)
    const gapMs = Math.round(Math.abs(a.y - b.y) / Math.max(1, speed * 60) * 1000);
    const ax = a.lane * laneW + laneW / 2 + tileOffsetX(a), ay = a.y - TILE_H / 2;
    const bx = b.lane * laneW + laneW / 2 + tileOffsetX(b), by = b.y - TILE_H / 2;
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
    ctx.strokeStyle = gapMs < 120 ? '#ff3b81' : gapMs < 220 ? '#ffd23f' : '#7cff6b';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const mx = (ax + bx) / 2, my = (ay + by) / 2, label = gapMs + 'ms';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(mx - w / 2, my - 7, w, 14);
    ctx.fillStyle = '#fff'; ctx.fillText(label, mx, my);
  }
  ctx.restore();
}


// --- level clock: runs from the same frame delta as tile movement ---
function updateCustomLevel(dtSec) {
  customPlayTime += dtSec;

  if (levelUsesAudio && !levelAudioStarted && customPlayTime * 1000 + levelAudioOffsetMs >= 0) {
    levelAudioStarted = true;
    try { bgAudio.currentTime = Math.max(0, customPlayTime + levelAudioOffsetMs / 1000); } catch (e) {}
    bgAudio.play().catch(() => {});
  }

  const pxPerSec = speed * 60;
  while (pendingTileIdx < pendingTiles.length) {
    const n = pendingTiles[pendingTileIdx];
    const spawnAt = n.time - 690 / pxPerSec;
    if (customPlayTime < spawnAt) break;
    // If a frame ran long, start the tile where it *should* be so arrival time stays exact.
    const y = -TILE_H + pxPerSec * (customPlayTime - spawnAt);
    const nt = new Tile(laneFlipAt(n.time) ? 3 - n.lane : n.lane, y, levelDisableHolds ? false : n.isHold, n.holdDuration);
    nt.noteIdx = pendingTileIdx; nt.time = n.time; nt.preset = n.preset;
    nt.groups = [pendingTileIdx + 1].concat(n.groups || []);
    tiles.push(nt);
    pendingTileIdx++;
  }
  while (pendingEffectIdx < pendingEffects.length && customPlayTime >= pendingEffects[pendingEffectIdx].time) {
    const fx = pendingEffects[pendingEffectIdx++];
    if (fx.type === 'pulse') fireAdvancedPulse(fx);
    else if (fx.type === 'image') fireAdvancedImage(fx);
    else if (fx.type === 'extra_image') fireExtraImage(fx);
    else if (fx.type === 'tile_style') fireTileStyle(fx);
    else if (fx.type === 'speed') fireSpeedChange(fx);
    else if (fx.type === 'sfx') fireSFX(fx);
    else if (fx.type === 'hitbox') fireHitbox(fx);
    else if (fx.type === 'tilemove') tileMoveFx = { mode: Number(fx.mode) || 0, amount: Number(fx.amount) || 0, dur: Math.max(0.1, Number(fx.duration) || 1), start: customPlayTime };
    else if (fx.type === 'tilehide') tileHideFx = { mode: Number(fx.mode) || 0, fadeY: Number(fx.fadeY) || 200, dur: Math.max(0.1, Number(fx.duration) || 2), start: customPlayTime };
    else if (fx.type === 'video') fireVideo(fx);
    else decorFire(fx, fx.time, false);
  }
  decorUpdate(customPlayTime);
  { const bgc = decorBackground(); if (bgc) document.body.style.background = bgc; }
  if (practiceMode) maybeAutoCheckpoint();

  if (speedTransitionDuration > 0) {
    speedTransitionTime += dtSec;
    const progress = Math.min(speedTransitionTime / speedTransitionDuration, 1.0);
    speed = initialSpeed + (targetSpeed - initialSpeed) * progress;
    if (progress >= 1.0) speedTransitionDuration = 0;
  }

  let pct = 0;
  if (levelEndTime > 0) {
    pct = livePct();
    if (pct !== lastPctShown) { lastPctShown = pct; document.getElementById('progress-display').innerText = pct + '%'; updateProgressBar(pct); }
  }
  if (isBattleMode && typeof updateBattleProgress === 'function') updateBattleProgress(pct, Math.floor(score));

  const reachedEnd = customPlayTime >= levelEndTime && pendingTileIdx >= pendingTiles.length && tiles.length === 0 && !isDead && gameActive;
  if (!reachedEnd) return;
  updateProgressBar(100); document.getElementById('progress-display').innerText = '100%'; noteBestPct(100);
  stopLoop();
  gameActive = false;
  bgAudio.pause();

  if (isVerifying) {
    isVerifying = false; levelVerified = true;
    showGameHud(false);
    if (currentDraft && typeof draftMarkVerified === 'function') draftMarkVerified();
    if (pendingPublishAfterVerification) {
      pendingPublishAfterVerification = false;
      enterEditorView();
      publishVerifiedLevel();
    } else {
      enterEditorView();
      toast('Verified! Your level is ready to publish.', 'good');
    }
  } else if (isBattleMode) {
    if (typeof handleBattleFinish === 'function') handleBattleFinish(true, 'FINISHED');
  } else {
    markVerifiedByPlay();
    finishStatsGame(true);
    showCompletionScreen();
  }
}

function showCompletionScreen() {
  showGameHud(false);
  const lost = maxLives - currentLives;
  const stars = lost === 0 ? 3 : lost <= Math.ceil(maxLives / 2) ? 2 : 1;
  document.getElementById('death-title').innerText = 'COMPLETED';
  document.getElementById('death-title').classList.add('good');
  document.getElementById('death-stars').innerHTML = [1, 2, 3].map(i => '<span class="' + (i <= stars ? 'on' : '') + '">★</span>').join('');
  document.getElementById('final-score').innerText = 'Score: ' + Math.floor(score);
  document.getElementById('death-retry-btn').classList.remove('hidden');
  document.getElementById('death-quit-btn').classList.toggle('hidden', isPlaytesting);
  document.getElementById('death-stop-playtest-btn').classList.toggle('hidden', !isPlaytesting);
  const eb = document.getElementById('death-editor-btn'); if (eb) eb.classList.toggle('hidden', !isVerifying);
  { const di = document.getElementById('death-info'); if (di) di.textContent = '100%  ·  Attempt ' + currentAttempt; }
  toggleMenu('death-screen');
}

// ---------------------------------------------------------------------------
// Input: keyboard + touch/mouse share one hit routine
// ---------------------------------------------------------------------------
// Releases every key/pointer. Without this a key whose keyup was swallowed (alt-tab, a menu, a dialog) stayed
// "held" forever, so later taps in that lane silently did nothing.
function releaseAllKeys() {
  Object.keys(keys).forEach(k => { keys[k] = false; });
  keyMap.forEach(k => { keys[k] = false; });
  activePointers.clear();
}
window.addEventListener('blur', releaseAllKeys);

// Does this tile's hitbox overlap the input hitbox? (No zone set = the classic "tap anywhere" behaviour.)
function inInputZone(t) {
  if (!hitZone.on) return true;
  const z = hitZone.lanes[t.lane];
  return t.y >= z.top && t.y - TILE_H <= z.top + z.h;          // tile spans [y-TILE_H, y]; touching the box at all is enough
}

function pressLane(laneIndex) {
  if (!gameActive || isDead || inEditor || isPaused) return;
  let nearestAll = null;                         // the next tile in order, whatever the zone says
  for (const t of tiles) if (!t.interacted && (!nearestAll || t.y > nearestAll.y)) nearestAll = t;
  if (!nearestAll) return;
  let nearest = null, target = null;             // among tiles inside the input zone
  for (const t of tiles) {
    if (t.interacted || !inInputZone(t)) continue;
    if (!nearest || t.y > nearest.y) nearest = t;
    if (t.lane === laneIndex && (!target || t.y > target.y)) target = t;
  }
  if (!nearest) return;                          // nothing inside the zone: taps do nothing
  let targetY = target ? target.y : 0, nearestY = nearest.y;
  const cbfToggle = document.getElementById('setting-cbf');
  if (cbfToggle && cbfToggle.checked) {
    const subFrameDt = Math.max(0, Math.min(2, (performance.now() - lastTime) / 16.666));
    if (target) targetY += speed * subFrameDt;
    nearestY += speed * subFrameDt;
  }
  let ok;
  if (strictMode) ok = !!target && target.y >= nearestAll.y - 3;      // STRICT: you must hit tile 1 before tile 2, no skipping
  else ok = !!target && (target === nearest || targetY >= nearestY - TILE_H * 0.85);
  if (ok) {
    target.interacted = true; score += 10; notesHitThisGame++;
    for (let i = 0; i < 8; i++) particles.push(new Particle(laneIndex * laneW + laneW / 2, lineY));
    if (typeof playLaneSound === 'function') playLaneSound(laneIndex);
    if (globeOn && typeof globeTap === 'function') globeTap(target.noteIdx, laneIndex);
  } else if (nearestY - TILE_H < GH && nearestY + TILE_H > 0) {
    if (!handleHit()) die("WRONG ORDER!");
  }
}

window.addEventListener("keydown", (e) => {
  if (dialogOpen() || isTypingTarget(e)) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { handleEscape(); return; }
  if (k === 'o' && !gameActive && !inEditor && !document.getElementById('settings-menu').classList.contains('hidden')) {
    toggleExtraSettings();
    return;
  }
  if (k === ' ' && isDead && !gameActive && !inEditor && !isBattleMode && !document.body.classList.contains('menus-open') && (lastStartArgs !== null || isPlaytesting || isVerifying)) {
    e.preventDefault();
    restartGame();
    return;
  }
  if (k === 'q' && !inEditor && !gameActive && typeof isBattleMenuOpenish === 'function' && isBattleMenuOpenish()) {
    startQuickMatch();
    return;
  }
  const laneIndex = keyMap.indexOf(k);
  if (laneIndex !== -1 && keys[k] !== true) {
    keys[k] = true;
    if (inEditor && isRecording && !deleteMode) { recordTileFromKeydown(laneIndex, e); return; }
    pressLane(laneIndex);
  }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  const laneIndex = keyMap.indexOf(k);
  if (inEditor && isRecording && laneIndex !== -1 && editorKeyTimes[laneIndex] !== null) recordTileFromKeyup(laneIndex);
});

// Touch / mouse: tap a lane to hit it. Each pointer remembers its lane so hold-release works.
const activePointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  if (inEditor) { handleEditorPointer(e); return; }
  if (!gameActive || isDead || isPaused) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const lane = Math.max(0, Math.min(3, Math.floor(((e.clientX - rect.left) / rect.width) * 4)));
  activePointers.set(e.pointerId, lane);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  keys[keyMap[lane]] = true;
  pressLane(lane);
});
function releasePointer(e) {
  if (!activePointers.has(e.pointerId)) return;
  const lane = activePointers.get(e.pointerId);
  activePointers.delete(e.pointerId);
  keys[keyMap[lane]] = false;
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function handleEscape() {
  if (isPaused) { resumeGame(); return; }
  if (gameActive && !isDead && !inEditor) {
    if (isBattleMode) { forfeitBattlePrompt(); return; }
    pauseGame();
    return;
  }
  if (inEditor && typeof closeAllDrawers === 'function') {
    const open = ['drawer-left', 'drawer-right'].some(id => document.getElementById(id).classList.contains('open'));
    if (open) closeAllDrawers(); else openCreatorMenu();
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawBoard() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * laneW, 0); ctx.lineTo(i * laneW, GH); ctx.stroke(); }
  ctx.strokeStyle = "#00ffff"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(GW, lineY); ctx.stroke();
}
function drawIdleFrame() {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, GW, GH);
  drawBoard();
}

// --- main loop ---
function gameLoop(ts) {
  rafId = null;
  if (isPaused || isDead || (!gameActive && !inEditor)) return;
  rafId = requestAnimationFrame(gameLoop);

  // Frame limiter (the level's "Target FPS"): schedule-based so a 60fps cap on a 60Hz or 144Hz screen is steady.
  const interval = 1000 / ((gameActive ? windowLevelFPS : 60) || 60);
  if (!nextFrameAt || ts - nextFrameAt > interval * 3) nextFrameAt = ts;
  if (ts < nextFrameAt - 1.5) return;
  nextFrameAt += interval;

  const elapsed = Math.max(0, Math.min(ts - lastTime, 50));   // clamp so a hitch can't teleport tiles
  lastTime = ts;
  const dt = elapsed / 16.666;

  if (gameActive) {
    frameCount++;
    if (ts - lastFpsTime >= 1000) {
      document.getElementById('fps-display').innerText = frameCount + ' FPS';
      frameCount = 0;
      lastFpsTime = ts;
    }
    const s = Math.floor(score);
    if (s !== lastScoreShown) { lastScoreShown = s; scoreEl.innerText = s; }
    if (isCustomGame) updateCustomLevel(elapsed / 1000);
    if (isDead || !gameActive) return;
  }

  if (inEditor) editorTick(elapsed / 1000, ts);

  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, GW, GH);
  { const ct = inEditor ? editorTimer : customPlayTime;
    if (inEditor) editorDecorSync();
    decorCameraBegin(ctx, ct);
    if (!inEditor || edShow.decor) drawDecorLayer(ctx, 'bg', ct, inEditor ? { ghost: true } : {}); }
  drawBoard();

  if (!isCustomGame && !inEditor && gameActive) {
    distanceTraveled += speed * dt;
    if (distanceTraveled >= nextSpawnDistance) spawnTile();
  }
  if (restEl) restEl.style.opacity = (gameActive && !isCustomGame && !inEditor && tiles.length === 0) ? '1' : '0';

  if (inEditor) drawEditorLayer();

  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]; t.y += speed * dt;
    const holdLength = t.isHold ? (t.holdDuration * speed * 60) : 0;
    const headTop = t.y - TILE_H;
    const tailTop = t.y - TILE_H - holdLength;

    if (tailTop > GH) {
      if (!t.interacted) {
        if (handleHit()) { tiles.splice(i, 1); continue; }
        else { die("MISSED!"); return; }
      }
      tiles.splice(i, 1); continue;
    }

    if (t.isHold && t.interacted && !t.failed) {
      if (tailTop < lineY - holdLength) {
        if (!keys[keyMap[t.lane]]) {
          t.failed = true;
          if (!handleHit()) { die("RELEASED EARLY!"); return; }
        } else {
          score += 0.5 * dt;
          if (Math.random() > 0.7) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY));
        }
      }
    }

    const ox = tileOffsetX(t);
    const hideMul = tileAlphaMul(headTop);
    const ds = t.groups ? decorCombined(t.groups) : null;
    if (ds && !ds.vis) { ctx.globalAlpha = 1; continue; }
    const xform = ds && (ds.dx || ds.dy || ds.rot || ds.sc !== 1);
    if (xform) { const cx = t.lane * laneW + laneW / 2 + ox, cy = headTop + TILE_H / 2; ctx.save(); ctx.translate(cx + ds.dx, cy + ds.dy); ctx.rotate(ds.rot * Math.PI / 180); ctx.scale(ds.sc, ds.sc); ctx.translate(-cx, -cy); }
    const dA = ds ? ds.a : 1, pr = presetOf(t.preset), tint = ds && ds.col;
    if (t.isHold) {
      if (pr) { ctx.globalAlpha = 1; drawPresetBox(ctx, t.lane * laneW + 12 + ox, tailTop, laneW - 24, holdLength, Object.assign({}, pr, { style: pr.style === 'outline' ? 'outline' : 'flat', color: pr.holdColor || pr.color, wide: 1, tall: 1, radius: Math.min(pr.radius, 10) }), (t.interacted ? 0.3 : 1) * hideMul * dA, tint); }
      else { ctx.globalAlpha = hideMul * dA; ctx.fillStyle = t.interacted ? "#333" : (tint || "#000"); ctx.fillRect(t.lane * laneW + 12 + ox, tailTop, laneW - 24, holdLength); }
    }
    if (pr) { ctx.globalAlpha = 1; drawPresetBox(ctx, t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H, pr, (t.interacted ? 0.25 : currentTileStyle.alpha) * hideMul * dA, tint); }
    else {
      ctx.globalAlpha = (t.interacted ? 0.25 : currentTileStyle.alpha) * hideMul * dA;
      ctx.fillStyle = t.interacted ? "#222" : (tint || tileFill());
      ctx.fillRect(t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H);
    }
    if (xform) ctx.restore();
    if (globeOn && globeGhosts.size && !t.interacted) {
      let row = 0; const now = performance.now();
      globeGhosts.forEach((g, name) => {
        if (now - g.ts > 7000) { globeGhosts.delete(name); return; }
        if (g.idx !== t.noteIdx) return;
        const col = globeColor(name), cx = t.lane * laneW + laneW / 2 + ox;
        ctx.save(); ctx.globalAlpha = 1; ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.strokeRect(t.lane * laneW + 5 + ox, headTop + 3, laneW - 10, TILE_H - 6); ctx.restore();
        const tag = name.length > 10 ? name.slice(0, 9) + '…' : name;
        ctx.font = "700 11px system-ui, sans-serif"; const tw = ctx.measureText(tag).width + 14;
        ctx.fillStyle = col; ctx.fillRect(cx - tw / 2, headTop + 8 + row * 18, tw, 16);
        ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(tag, cx, headTop + 16 + row * 18); row++;
      });
    }
    if (showHitboxes) {
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ff3b81"; ctx.lineWidth = 2;
      ctx.strokeRect(t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H);
    }
    if (showLaneText) {
      ctx.globalAlpha = 1; ctx.fillStyle = "#ffffff"; ctx.font = "700 28px Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(keyMap[t.lane].toUpperCase(), t.lane * laneW + laneW / 2 + ox, headTop + TILE_H / 2);
    }
    ctx.globalAlpha = 1.0;
  }
  if (showHitboxes && gameActive && isCustomGame) drawHitboxOverlay();
  if (!inEditor || edShow.decor) drawDecorLayer(ctx, 'fg', inEditor ? editorTimer : customPlayTime, inEditor ? { ghost: true } : {});
  decorCameraEnd(ctx);
  if (globeOn && typeof globeLevelId !== 'undefined' && globeLevelId && gameActive) drawGlobeHud();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update(dt);
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color || "#00ffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}

// ---------------------------------------------------------------------------
// Pause / death / retry / quit
// ---------------------------------------------------------------------------
function pauseGame() {
  if (!gameActive || isDead || isPaused || inEditor || isBattleMode) return;
  isPaused = true;
  stopLoop();
  if (!bgAudio.paused) bgAudio.pause();
  document.getElementById('pause-stop-btn').classList.toggle('hidden', !isPlaytesting);
  document.getElementById('pause-quit-btn').classList.toggle('hidden', isPlaytesting);
  { const pb = document.getElementById('pause-practice-btn'); if (pb) { pb.textContent = practiceMode ? '🎯 Practice: ON (tap to turn off)' : '🎯 Practice mode'; pb.classList.toggle('hidden', isPlaytesting || isVerifying || !(lastStartArgs && lastStartArgs[6])); } }
  toggleMenu('pause-menu');
}

function runCountdown(seconds, done) {
  const el = document.getElementById('countdown');
  let n = seconds;
  el.classList.remove('hidden');
  const tick = () => {
    if (n <= 0) { el.classList.add('hidden'); done(); return; }
    el.textContent = n;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    n--;
    setTimeout(tick, 700);
  };
  tick();
}

function resumeGame() {
  if (!isPaused || !document.getElementById('countdown').classList.contains('hidden')) return;
  toggleMenu(null);
  runCountdown(3, () => {
    isPaused = false;
    if (levelUsesAudio && levelAudioStarted) bgAudio.play().catch(() => {});
    startLoop();
  });
}

function die(reason) {
  if (isDead) return;
  if (isVerifying) levelVerified = false;          // stays in verify mode so Retry re-runs the verification
  if (practiceMode && !isBattleMode) { isDead = true; gameActive = false; stopLoop(); practiceRespawn(); return; }
  isDead = true;
  gameActive = false;
  stopLoop();
  bgAudio.pause();
  if (isCustomGame) noteBestPct(livePct());

  if (isBattleMode) {
    if (typeof handleBattleFinish === 'function') handleBattleFinish(false, reason);
    return;
  }

  finishStatsGame(false);
  showGameHud(false);
  document.getElementById('death-title').innerText = reason || 'FAILED';
  document.getElementById('death-title').classList.remove('good');
  document.getElementById('death-stars').innerHTML = '';
  document.getElementById('final-score').innerText = 'Score: ' + Math.floor(score);
  document.getElementById('death-retry-btn').classList.toggle('hidden', isPlaytesting);
  document.getElementById('death-quit-btn').classList.toggle('hidden', isPlaytesting);
  document.getElementById('death-stop-playtest-btn').classList.toggle('hidden', !isPlaytesting);
  if (autoRetry && !isPlaytesting) {
    clearTimeout(autoRetryTimer);
    autoRetryTimer = setTimeout(() => { if (isDead) restartGame(); }, 2000);
  }
  if (hideDeathScreen && !isPlaytesting) {
    toggleMenu(null);
  } else {
    toggleMenu('death-screen');
  }
}

function restartGame() {
  clearTimeout(autoRetryTimer);
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  isPaused = false;
  if (isVerifying) { startLevelVerification(); return; }
  if (lastStartArgs && lastStartArgs[0] === 'verify') { startLevelVerification(); return; }
  if (isPlaytesting) { startPlaytest(); return; }
  if (lastStartArgs) startGame.apply(null, lastStartArgs);
}

function quitPlaytestOrGame() {
  const wasBattle = isBattleMode;
  stopLoop();
  gameActive = false; isDead = true; isPaused = false; score = 0; scoreEl.innerText = "0";
  bgAudio.pause();
  if (wasBattle && typeof leaveActiveMatch === 'function') leaveActiveMatch();
  if (isVerifying) {                       // leaving to the main menu mid-verification: keep the work
    isVerifying = false; levelVerified = false;
    if (typeof autosaveEditorLevel === 'function') autosaveEditorLevel();
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    showGameHud(false); document.getElementById('editor-ui').classList.add('hidden');
    inEditor = false; resetState(); toggleMenu('main-menu');
    return;
  }
  if (isPlaytesting) { stopPlaytest(); return; }
  showGameHud(false);
  isBattleMode = false;
  toggleMenu('main-menu');
}

// ---------------------------------------------------------------------------
// Editor session lifecycle
// ---------------------------------------------------------------------------
function applyEditorBackground() {
  const bg = document.getElementById('edit-bg-color');
  document.body.style.background = (bg && bg.value) || '#202738';
}

function enterEditorView() {
  inEditor = true; gameActive = false; isDead = false; isPaused = false;
  tiles = []; particles = [];   // leftovers from a playtest must not show up in the editor
  showGameHud(false);
  document.getElementById('stop-playtest-btn').classList.add('hidden');
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('editor-ui').classList.remove('hidden');
  canvas.style.filter = '';
  applyEditorBackground();
  layoutCanvas();
  refreshEditorTimeline();
  startLoop();
}

function startEditor(existingLevel) {
  toggleMenu(null);
  stopLoop();
  isPlaytesting = false; isVerifying = false; isBattleMode = false;
  recordedTiles = existingLevel ? JSON.parse(JSON.stringify(existingLevel.data || [])) : [];
  recordedEffects = existingLevel ? JSON.parse(JSON.stringify(existingLevel.effects || [])) : [];
  decorData = normalizeDecor(existingLevel ? JSON.parse(JSON.stringify(existingLevel.decor || {})) : null);
  editorResetSession(existingLevel);
  currentEditingName = existingLevel ? existingLevel.name : "";
  if (!existingLevel) { currentEditingId = null; currentEditingOnlineId = null; }
  else currentEditingOnlineId = existingLevel.onlineId || null;
  currentLevelIcon = existingLevel ? (existingLevel.icon || null) : null;
  editorTimer = 0; isRecording = false; deleteMode = false; selectedEffect = null; editorPlaying = false; levelVerified = false;
  editorStartPositions = existingLevel && Array.isArray(existingLevel.startPositions) ? existingLevel.startPositions.slice() : []; activeStartIdx = -1; editorStartPos = null; updateStartPosButton();
  loadEditorAudioFor(existingLevel);
  setTimeout(() => { if (typeof historyReset === 'function') historyReset(); }, 60);
  editorBpm = existingLevel && existingLevel.bpm ? existingLevel.bpm : 120;
  editorGridOffset = existingLevel && existingLevel.gridOffset ? existingLevel.gridOffset : 0;
  const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  val('edit-lives', existingLevel ? (existingLevel.lives || 3) : 3);
  val('edit-fps', existingLevel ? (existingLevel.fps || 60) : 60);
  val('edit-audio-offset', existingLevel ? (existingLevel.audioOffset || 0) : 0);
  val('edit-bpm', editorBpm);
  val('edit-grid-offset', editorGridOffset);
  val('edit-difficulty', existingLevel ? (existingLevel.difficulty || 'Normal') : 'Normal');
  val('edit-bg-color', existingLevel && existingLevel.backgroundColor ? existingLevel.backgroundColor : '#202738');
  val('edit-bg-brightness', existingLevel && existingLevel.backgroundBrightness ? existingLevel.backgroundBrightness : 100);
  document.getElementById('edit-disable-holds').checked = existingLevel ? !!existingLevel.disableHolds : false;
  const st = document.getElementById('edit-strict'); if (st) st.checked = existingLevel ? !!existingLevel.strictMode : false;
  const lc = document.getElementById('edit-lock-cos'); if (lc) lc.checked = existingLevel ? !!existingLevel.lockCosmetics : false;
  val('edit-tags', existingLevel && existingLevel.tags ? existingLevel.tags.join(', ') : '');
  if (!existingLevel || !existingLevel._draft) currentDraft = null;
  renderLevelIconPreview();
  closeAllDrawers();
  setEditorGrid(editorGridDivision);
  editorAfterStart(existingLevel);
  enterEditorView();
}

function toggleRecording() {
  // One button does the whole job: start the song + playhead and arm key recording together.
  isRecording = !isRecording;
  const btn = document.getElementById('btn-create-tiles');
  if (btn) btn.classList.toggle('active', isRecording);
  if (isRecording && !editorPlaying) toggleEditorTransport();
  else if (!isRecording && editorPlaying) toggleEditorTransport();
}

function toggleSongTester() {
  if (!bgAudio.src) { toast('Load a song first!'); return; }
  isSongTesting = !isSongTesting;
  const btn = document.getElementById('btn-song-test');
  if (btn) btn.classList.toggle('active', isSongTesting);
  if (isSongTesting) { bgAudio.currentTime = Math.max(0, songPos(editorTimer)); bgAudio.play().catch(() => {}); }
  else { bgAudio.pause(); }
}

function toggleDeleteMode() { setEdTool(edTool === 'erase' ? 'place' : 'erase'); }

function openCreatorMenu() { document.getElementById('creator-menu').classList.remove('hidden'); document.body.classList.add('menus-open'); }
function closeCreatorMenu() { document.getElementById('creator-menu').classList.add('hidden'); document.body.classList.remove('menus-open'); }

async function exitEditorWithoutSaving() {
  if (!(await uiConfirm('Quit without saving? Unsaved changes will be lost.', 'Quit', true))) return;
  closeCreatorMenu();
  document.getElementById('editor-ui').classList.add('hidden');
  stopEditorTransport();
  stopLoop();
  inEditor = false; isRecording = false; isSongTesting = false;
  bgAudio.pause();
  canvas.classList.remove('delete-cursor');
  toggleMenu('main-menu');
}

function openEditorSettingsMenu() { toggleMenu('editor-level-settings'); }
function closeEditorSettingsMenu() { toggleMenu(null); }

function startPlaytest(fromTime) {
  if (recordedTiles.length === 0) { toast("Place some tiles first!"); return; }
  maxLives = Math.max(1, Math.min(10, parseInt(document.getElementById('edit-lives').value) || 3));
  isPlaytesting = true; inEditor = false; deleteMode = false;
  canvas.classList.remove('delete-cursor');
  closeAllDrawers();
  editorStartPos = activeStartIdx >= 0 && editorStartPositions[activeStartIdx] !== undefined ? editorStartPositions[activeStartIdx] : null;
  if (typeof fromTime === 'number') editorStartPos = Math.max(0, Math.round(fromTime * 1000) / 1000);   // "Test from playhead"
  startPosArmed = editorStartPos !== null;
  startGame('playtest', true, -1, recordedTiles, recordedEffects);
}

function stopPlaytest() {
  isPlaytesting = false; isVerifying = false; stopLoop(); gameActive = false; isDead = true; resetState();
  enterEditorView();
}
function stopPlaytestFromDeath() { stopPlaytest(); }
function backToEditorFromDeath() { isVerifying = false; levelVerified = false; stopPlaytest(); }

// Start positions (like Geometry Dash start pos): flag the playhead; place as many as you like. Playtests start from the active one;
// Q / E (changeable in Settings) switch between them. They're saved with the level and also work in practice mode for players.
function updateStartPosButton() {
  const btn = document.getElementById('btn-start-pos'); if (!btn) return;
  btn.textContent = editorStartPositions.length ? '🚩 ' + (activeStartIdx >= 0 ? (activeStartIdx + 1) + '/' : '') + editorStartPositions.length : '🚩';
  btn.classList.toggle('active', editorStartPositions.length > 0);
}
function toggleStartPos() {
  const i = editorStartPositions.findIndex(t => Math.abs(t - editorTimer) < 0.05);
  if (i >= 0) { editorStartPositions.splice(i, 1); activeStartIdx = Math.min(activeStartIdx, editorStartPositions.length - 1); toast('Start position removed.'); }
  else {
    const t = Math.round(editorTimer * 1000) / 1000;
    editorStartPositions.push(t); editorStartPositions.sort((a, b) => a - b);
    activeStartIdx = editorStartPositions.indexOf(t);
    toast('Start position set at ' + t.toFixed(2) + 's (' + editorStartPositions.length + ' total). Tap again at the same spot to remove it.', 'good');
  }
  levelVerified = false; updateStartPosButton();
}
// Editor music: keep what you loaded with the level
async function loadEditorAudioFor(level) {
  if (!level) { clearEditorAudio(); return; }
  let blob = null;
  try {
    if (level.audio) blob = dataUrlToBlob(level.audio);
    else {
      const local = myLevels.find(l => l.id === level.id) || myLevels.find(l => l.onlineId && l.onlineId === level.id);
      if (local) blob = await LevelAudio.get(local.id);
    }
  } catch (e) {}
  if (blob) setEditorAudio(blob); else clearEditorAudio();
}


// Playing your own level through (from My Levels or Browse) counts as verifying it.
function markVerifiedByPlay() {
  const a = lastStartArgs, lvl = a && a[6];
  if (!lvl || isBattleMode || practiceMode || isPlaytesting || isVerifying) return;
  const me = getAuthUser();
  let local = null;
  if (!a[5]) local = myLevels.find(l => l.id === lvl.id);
  else if (me && lvl.authorId === me.id) local = myLevels.find(l => l.onlineId === lvl.id);
  if (!local) return;
  local.verifiedHash = levelHashOf(local.data, local.effects); persistMyLevels();
  toast('Level verified by playing it through!', 'good');
}

// Globe HUD: how many players are on this level + a progress rail on the right edge with a coloured dot per player.
function drawGlobeHud() {
  ctx.save();
  const text = globePresence.count > 1 ? '🌐 ' + globePresence.count + ' playing' : '🌐 just you';
  ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(GW - w - 6, 8, w, 20);
  ctx.fillStyle = '#7cf0ff'; ctx.fillText(text, GW - 13, 18);
  const top = 44, bot = GH - 90, railX = GW - 10;
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(railX - 1, top, 2, bot - top);
  ctx.globalAlpha = 1;
  const total = Math.max(1, pendingTiles.length), now = performance.now();
  const dot = (pct, col, label, r) => { const y = bot - (bot - top) * Math.max(0, Math.min(1, pct)); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(railX, y, r, 0, Math.PI * 2); ctx.fill(); if (label) { ctx.fillStyle = '#000'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, railX, y + 0.5); } };
  globeGhosts.forEach((g, name) => { if (now - g.ts < 7000) dot(g.pct !== undefined ? g.pct : g.idx / total, globeColor(name), name.slice(0, 1).toUpperCase(), 6); });
  dot(Math.min(1, customPlayTime / Math.max(0.001, levelLastNoteTime)), '#ffffff', '', 4);   // you
  ctx.restore();
}
