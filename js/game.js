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

    const allTimes = [0];
    pendingTiles.forEach(t => allTimes.push(t.time + (t.holdDuration || 0)));
    pendingEffects.forEach(e => allTimes.push(e.time));
    levelEndTime = Math.max(...allTimes) + 4.0;
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
    practiceMode = practiceArmed && !!loadedLevelObj; practiceArmed = false;
    if (!practiceMode) { practiceStartSec = 0; practiceCheckpoint = 0; }
    practiceNextAuto = practiceStartSec + levelLastNoteTime * 0.1;
    if (practiceMode && practiceStartSec > 0) fastForwardTo(practiceStartSec);
    else if (startPosArmed && isPlaytesting && editorStartPos !== null) { fastForwardTo(editorStartPos); if (levelUsesAudio) { levelAudioStarted = true; try { bgAudio.currentTime = Math.max(0, editorStartPos + Math.abs(levelAudioOffsetMs) / 1000 * (levelAudioOffsetMs < 0 ? 1 : -1)); } catch (e) {} bgAudio.play().catch(() => {}); } }
    startPosArmed = false;
    globeGhosts.clear();
    if (typeof globeSync === 'function') globeSync(loadedLevelObj && loadedLevelObj.id);
    levelAudioOffsetMs = parseInt(cfg.audioOffset) || 0;
    document.getElementById('lives-count').innerText = currentLives;

    // The song only belongs to the level being edited. Levels opened from My Levels / Browse / battles
    // don't carry audio, so they must not play whatever song happened to be loaded last.
    levelUsesAudio = !loadedLevelObj && !!bgAudio.src;
    if (levelUsesAudio) {
      if (levelAudioOffsetMs <= 0) {
        try { bgAudio.currentTime = Math.abs(levelAudioOffsetMs) / 1000; } catch (e) {}
        bgAudio.play().catch(() => {});
        levelAudioStarted = true;
      }
    }
  }
  startLoop();
}
let levelUsesAudio = false;

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
function fireSpeedChange(fx) { initialSpeed = speed; targetSpeed = fx.target; speedTransitionDuration = fx.transDuration; speedTransitionTime = 0; }
function fireSFX(fx) { const audio = new Audio(fx.src); audio.play().catch(() => {}); }
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
  }
}
function maybeAutoCheckpoint() {
  if (!practiceMode || !levelLastNoteTime || customPlayTime < practiceNextAuto) return;
  practiceCheckpoint = customPlayTime; practiceNextAuto = customPlayTime + levelLastNoteTime * 0.1;
  toast('Checkpoint ' + Math.min(99, Math.round(customPlayTime / levelLastNoteTime * 100)) + '%');
}
function practiceRespawn() {
  practiceStartSec = practiceCheckpoint; practiceArmed = true;
  if (lastStartArgs) startGame.apply(null, lastStartArgs);
}
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'c' || e.repeat || !practiceMode || !gameActive || isTypingTarget(e)) return;
  practiceCheckpoint = customPlayTime; toast('Checkpoint set at ' + Math.round(customPlayTime / Math.max(1, levelLastNoteTime) * 100) + '%', 'good');
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

  if (levelUsesAudio && !levelAudioStarted && customPlayTime * 1000 >= levelAudioOffsetMs) {
    levelAudioStarted = true;
    try { bgAudio.currentTime = 0; } catch (e) {}
    bgAudio.play().catch(() => {});
  }

  const pxPerSec = speed * 60;
  while (pendingTileIdx < pendingTiles.length) {
    const n = pendingTiles[pendingTileIdx];
    const spawnAt = n.time - 690 / pxPerSec;
    if (customPlayTime < spawnAt) break;
    // If a frame ran long, start the tile where it *should* be so arrival time stays exact.
    const y = -TILE_H + pxPerSec * (customPlayTime - spawnAt);
    const nt = new Tile(n.lane, y, levelDisableHolds ? false : n.isHold, n.holdDuration);
    nt.noteIdx = pendingTileIdx; nt.time = n.time;
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
    if (practiceMode) maybeAutoCheckpoint();
  }
  if (practiceMode) maybeAutoCheckpoint();

  if (speedTransitionDuration > 0) {
    speedTransitionTime += dtSec;
    const progress = Math.min(speedTransitionTime / speedTransitionDuration, 1.0);
    speed = initialSpeed + (targetSpeed - initialSpeed) * progress;
    if (progress >= 1.0) speedTransitionDuration = 0;
  }

  let pct = 0;
  if (levelEndTime > 0) {
    pct = Math.min(100, Math.floor((customPlayTime / levelEndTime) * 100));
    if (pct !== lastPctShown) { lastPctShown = pct; document.getElementById('progress-display').innerText = pct + '%'; }
  }
  if (isBattleMode && typeof updateBattleProgress === 'function') updateBattleProgress(pct, Math.floor(score));

  const reachedEnd = customPlayTime >= levelEndTime && pendingTileIdx >= pendingTiles.length && tiles.length === 0 && !isDead && gameActive;
  if (!reachedEnd) return;
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

function drawEditorLayer() {
  const pps = getEditorPPS();
  const step = getEditorGridStep();
  const tMin = editorTimer - (GH - lineY) / pps;
  const tMax = editorTimer + lineY / pps;
  const first = Math.ceil((tMin - editorGridOffset) / step);
  const last = Math.floor((tMax - editorGridOffset) / step);
  ctx.save();
  ctx.font = "600 9px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  for (let gi = first; gi <= last; gi++) {
    const gt = editorGridOffset + gi * step;
    if (gt < -1e-6) continue;
    const gy = lineY + (editorTimer - gt) * pps;
    const isBeat = ((gi % editorGridDivision) + editorGridDivision) % editorGridDivision === 0;
    ctx.globalAlpha = isBeat ? 0.42 : 0.16;
    ctx.strokeStyle = isBeat ? "#9ad0ff" : "#78bfff";
    ctx.lineWidth = isBeat ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(GW, gy); ctx.stroke();
    if (isBeat) { ctx.globalAlpha = 0.6; ctx.fillStyle = "#cfe6ff"; ctx.fillText(gt.toFixed(2) + 's', 4, gy - 2); }
  }
  ctx.restore();

  const tileH = TILE_H * editorZoom;
  recordedTiles.forEach(t => {
    const bottom = lineY + (editorTimer - t.time) * pps;          // tile's bottom edge sits on the hit line at its time — same as gameplay
    const holdLen = t.isHold ? t.holdDuration * pps : 0;
    const top = bottom - tileH - holdLen;
    const h = tileH + holdLen;
    if (top > GH + 4 || top + h < -4) return;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = t.isHold ? "rgba(255, 100, 0, 0.6)" : "rgba(0, 235, 255, 0.55)";
    ctx.fillRect(t.lane * laneW + 3, top, laneW - 6, h);
    ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
    ctx.strokeRect(t.lane * laneW + 3.5, top + 0.5, laneW - 7, h - 1);
    if (showHitboxes) { ctx.strokeStyle = "#ff3b81"; ctx.lineWidth = 2; ctx.strokeRect(t.lane * laneW + 3, top, laneW - 6, h); }
    if (showLaneText) {
      ctx.fillStyle = "#ffffff"; ctx.font = "700 20px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(keyMap[t.lane].toUpperCase(), t.lane * laneW + laneW / 2, top + h / 2);
    }
  });
  // hitbox editor: one box per lane. The selected hitbox change shows drag handles; otherwise the one active at the playhead is shown faintly.
  let hb = selectedEffect && selectedEffect.type === 'hitbox' ? selectedEffect : null;
  const editing = !!hb;
  if (!hb) recordedEffects.forEach(f => { if (f.type === 'hitbox' && f.time <= editorTimer) hb = f; });
  if (hb && Number(hb.zoneOn) === 1) {
    ctx.save();
    for (let l = 0; l < 4; l++) {
      const top = hbVal(hb, l, 't', 400), h = Math.max(20, hbVal(hb, l, 'h', 140));
      ctx.globalAlpha = editing ? 0.28 : 0.12; ctx.fillStyle = '#00f0ff'; ctx.fillRect(l * laneW + 2, top, laneW - 4, h);
      ctx.globalAlpha = 1; ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.setLineDash(editing ? [] : [6, 4]); ctx.strokeRect(l * laneW + 2, top, laneW - 4, h);
      if (editing) {
        ctx.setLineDash([]); ctx.fillStyle = '#00f0ff'; ctx.fillRect(l * laneW + laneW / 2 - 16, top + h - 6, 32, 6);      // resize handle
        ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('LANE ' + (l + 1), l * laneW + laneW / 2, top + 4);
      }
    }
    if (editing) {   // real-size tile ruler so you can judge box sizes against an actual tile
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.5; ctx.strokeRect(laneW * 1.5 - 20, lineY - TILE_H, 40, TILE_H);
      ctx.setLineDash([]); ctx.globalAlpha = 0.8; ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('tile size', laneW * 1.5, lineY - TILE_H - 11);
    }
    ctx.restore();
  }
  // flashes for tiles you just recorded with the keyboard
  for (let i = editorVisualTiles.length - 1; i >= 0; i--) {
    const v = editorVisualTiles[i];
    v.alpha -= 0.06;
    if (v.alpha <= 0) { editorVisualTiles.splice(i, 1); continue; }
    ctx.globalAlpha = v.alpha * 0.5; ctx.fillStyle = "#00ffff";
    ctx.fillRect(v.lane * laneW, lineY - 6, laneW, 12);
  }
  ctx.globalAlpha = 1;
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
    if (t.isHold) {
      ctx.globalAlpha = hideMul;
      ctx.fillStyle = t.interacted ? "#333" : "#000";
      ctx.fillRect(t.lane * laneW + 12 + ox, tailTop, laneW - 24, holdLength);
    }
    ctx.globalAlpha = (t.interacted ? 0.25 : currentTileStyle.alpha) * hideMul;
    ctx.fillStyle = t.interacted ? "#222" : tileFill();
    ctx.fillRect(t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H);
    if (globeOn && globeGhosts.size && !t.interacted) {
      let row = 0; const now = performance.now();
      globeGhosts.forEach((g, name) => {
        if (now - g.ts > 7000) { globeGhosts.delete(name); return; }
        if (g.idx !== t.noteIdx) return;
        ctx.globalAlpha = 1; ctx.strokeStyle = globeColor(name); ctx.lineWidth = 3;
        ctx.strokeRect(t.lane * laneW + 4 + ox, headTop + 2, laneW - 8, TILE_H - 4);
        ctx.fillStyle = globeColor(name); ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText('● ' + name, t.lane * laneW + laneW / 2 + ox, headTop + 6 + row * 13); row++;
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
  currentEditingName = existingLevel ? existingLevel.name : "";
  if (!existingLevel) { currentEditingId = null; currentEditingOnlineId = null; }
  else currentEditingOnlineId = existingLevel.onlineId || null;
  currentLevelIcon = existingLevel ? (existingLevel.icon || null) : null;
  editorTimer = 0; isRecording = false; deleteMode = false; selectedEffect = null; editorPlaying = false; levelVerified = false;
  editorStartPos = null; { const b = document.getElementById('btn-start-pos'); if (b) { b.textContent = '🚩'; b.classList.remove('active'); } }
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
  document.getElementById('btn-create-tiles').classList.remove('active');
  document.getElementById('btn-delete-mode').classList.remove('active');
  document.getElementById('btn-delete-mode-2').classList.remove('active');
  renderLevelIconPreview();
  closeAllDrawers();
  setEditorGrid(editorGridDivision);
  renderSelectedEffectPanels();
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
  if (isSongTesting) { bgAudio.currentTime = editorTimer; bgAudio.play().catch(() => {}); }
  else { bgAudio.pause(); }
}

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  ['btn-delete-mode', 'btn-delete-mode-2'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', deleteMode);
  });
  canvas.classList.toggle('delete-cursor', deleteMode);
}

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

function startPlaytest() {
  if (recordedTiles.length === 0) { toast("Place some tiles first!"); return; }
  maxLives = Math.max(1, Math.min(10, parseInt(document.getElementById('edit-lives').value) || 3));
  isPlaytesting = true; inEditor = false; deleteMode = false;
  canvas.classList.remove('delete-cursor');
  ['btn-delete-mode', 'btn-delete-mode-2'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  closeAllDrawers();
  startPosArmed = editorStartPos !== null;
  startGame('playtest', true, -1, recordedTiles, recordedEffects);
}

function stopPlaytest() {
  isPlaytesting = false; isVerifying = false; stopLoop(); gameActive = false; isDead = true; resetState();
  enterEditorView();
}
function stopPlaytestFromDeath() { stopPlaytest(); }
function backToEditorFromDeath() { isVerifying = false; levelVerified = false; stopPlaytest(); }

// Start position: put a flag at the playhead; playtests start from it (with speed/hitbox/style state applied). Tap again at the same spot to remove it.
function toggleStartPos() {
  const btn = document.getElementById('btn-start-pos');
  if (editorStartPos !== null && Math.abs(editorStartPos - editorTimer) < 0.05) { editorStartPos = null; toast('Start position removed.'); }
  else { editorStartPos = Math.round(editorTimer * 1000) / 1000; toast('Start position set at ' + editorStartPos.toFixed(2) + 's - playtest starts here.', 'good'); }
  if (btn) { btn.textContent = editorStartPos === null ? '🚩' : '🚩 ' + editorStartPos.toFixed(1) + 's'; btn.classList.toggle('active', editorStartPos !== null); }
}
