// ============================================================================
// game.js — the actual rhythm-game engine: entities, the render/update loop,
// level playback (built-in + custom JSON levels), effect firing, and the
// death/retry/quit flow. Also owns starting and stopping an editor session,
// since "start editing" and "stop playing" are two sides of the same state
// machine.
// ============================================================================

class Tile {
  constructor(lane, overrideY = -TILE_H, isHold = false, holdDuration = 0) {
    this.lane = lane;
    this.y = overrideY;
    this.isHold = isHold;
    this.holdDuration = holdDuration;
    this.interacted = false;
    this.failed = false;
  }
}

class Particle {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 15;
    this.vy = (Math.random() - 0.5) * 15;
    this.life = 1.0;
  }
  update() { this.x += this.vx; this.y += this.vy; this.life -= 0.05; }
}

function resetState() {
  score = 0; tiles = []; particles = []; isDead = false; patternStep = 0; scoreEl.innerText = "0";
  distanceTraveled = 0; nextSpawnDistance = 0; currentLives = maxLives;
  document.getElementById('lives-count').innerText = currentLives;
  document.getElementById('fps-display').innerText = "60 FPS";
  document.getElementById('progress-display').innerText = "0%";
  frameCount = 0;
  lastFpsTime = performance.now();
  levelEndTime = 0;
  document.body.style.background = document.getElementById('bg-color-picker').value || 'var(--bg-void)';
  document.getElementById('bg-image-container').style.opacity = 0;
  document.getElementById('fg-image-container').style.opacity = 0;
  document.getElementById('bg-flash').style.opacity = 0;
  document.getElementById('fg-flash').style.opacity = 0;
  document.getElementById('extra-images-bg').innerHTML = "";
  document.getElementById('extra-images-fg').innerHTML = "";
  currentTileStyle = { c1: "#000000", c2: "#000000", alpha: 1.0 };
  targetSpeed = speed; speedTransitionTime = 0; speedTransitionDuration = 0;
  bgAudio.pause(); bgAudio.currentTime = 0;
  if (customGameInterval) clearInterval(customGameInterval);
  lastTime = performance.now();
}

function triggerRedFlash() {
  const flash = document.getElementById('red-flash'); flash.style.opacity = 0.8;
  setTimeout(() => { flash.style.opacity = 0; }, 150);
}

function handleHit() {
  const noclip = document.getElementById('edit-noclip');
  if (noclip && noclip.checked && (inEditor || isPlaytesting || isVerifying)) return true;
  if (currentLives > 1) { currentLives--; document.getElementById('lives-count').innerText = currentLives; triggerRedFlash(); return true; }
  return false;
}

function startGame(mode, isCustom = false, customIndex = -1, testTiles = null, testEffects = null, isCommunity = false, loadedLevelObj = null) {
  lastStartArgs = [mode, isCustom, customIndex, testTiles, testEffects, isCommunity, loadedLevelObj];
  currentMode = mode; isCustomGame = isCustom; gameActive = true;
  resetState();
  overlays.forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('editor-ui').classList.add('hidden');
  document.getElementById('lives-display').classList.remove('hidden');
  document.getElementById('game-hud').classList.remove('hidden');
  document.getElementById('score-container').classList.remove('hidden');

  if (!isCustom) {
    const customSpeed = document.getElementById('speed-' + mode);
    speed = customSpeed ? parseInt(customSpeed.value) : EDITOR_BASE_SPEED; targetSpeed = speed;
    windowLevelFPS = 60;
    document.getElementById('progress-display').classList.add('hidden');
    spawnTile();
  } else {
    document.getElementById('progress-display').classList.remove('hidden');
    speed = EDITOR_BASE_SPEED; targetSpeed = EDITOR_BASE_SPEED; customPlayTime = 0;
    let sourceArray = isCommunity ? getCommunityLevels() : getCustomLevels();
    let pendingTiles = testTiles ? JSON.parse(JSON.stringify(testTiles)) : JSON.parse(JSON.stringify(sourceArray[customIndex].data));
    let pendingEffects = testEffects ? JSON.parse(JSON.stringify(testEffects)) : (sourceArray[customIndex] && sourceArray[customIndex].effects ? JSON.parse(JSON.stringify(sourceArray[customIndex].effects)) : []);

    let allTimes = [0];
    pendingTiles.forEach(t => allTimes.push(t.time + (t.holdDuration || 0)));
    pendingEffects.forEach(e => allTimes.push(e.time));
    levelEndTime = Math.max(...allTimes) + 4.0;
    verifyEndTime = levelEndTime;

    if (loadedLevelObj) {
      maxLives = loadedLevelObj.lives !== undefined ? loadedLevelObj.lives : 3;
      currentLives = maxLives;
      windowLevelFPS = loadedLevelObj.fps || 60;
    } else if (customIndex !== -1 && sourceArray[customIndex] && sourceArray[customIndex].lives) {
      maxLives = sourceArray[customIndex].lives; currentLives = maxLives;
      windowLevelFPS = sourceArray[customIndex].fps || 60;
    } else {
      windowLevelFPS = testTiles ? parseInt(document.getElementById('edit-fps').value) : 60;
    }
    document.getElementById('lives-count').innerText = currentLives;
    if (!windowLevelFPS || windowLevelFPS < 10) windowLevelFPS = 60;

    let currentAudioOffset = loadedLevelObj && loadedLevelObj.audioOffset !== undefined ? loadedLevelObj.audioOffset
      : (customIndex !== -1 && sourceArray[customIndex] && sourceArray[customIndex].audioOffset !== undefined ? sourceArray[customIndex].audioOffset
        : (testTiles ? parseInt(document.getElementById('edit-audio-offset').value) : 0));
    let currentDisableHolds = loadedLevelObj && loadedLevelObj.disableHolds !== undefined ? loadedLevelObj.disableHolds
      : (customIndex !== -1 && sourceArray[customIndex] && sourceArray[customIndex].disableHolds !== undefined ? sourceArray[customIndex].disableHolds
        : (testTiles ? document.getElementById('edit-disable-holds').checked : false));

    let offsetMs = parseInt(currentAudioOffset) || 0;
    if (bgAudio.src) {
      bgAudio.currentTime = 0;
      if (offsetMs < 0) {
        bgAudio.currentTime = Math.abs(offsetMs) / 1000;
        bgAudio.play().catch(e => console.warn(e));
      } else if (offsetMs > 0) {
        setTimeout(() => { if (gameActive && !isDead) bgAudio.play().catch(e => console.warn(e)); }, offsetMs);
      } else {
        bgAudio.play().catch(e => console.warn(e));
      }
    }

    if (customIndex !== -1 && sourceArray[customIndex] && sourceArray[customIndex].id) {
      registerPlay(sourceArray[customIndex].id, isCommunity);
    }

    customGameInterval = setInterval(() => {
      if (isDead || !gameActive) { clearInterval(customGameInterval); bgAudio.pause(); return; }
      customPlayTime += 0.016;
      let spawnOffset = 690 / (speed * 60);
      for (let i = pendingTiles.length - 1; i >= 0; i--) {
        if (customPlayTime >= pendingTiles[i].time - spawnOffset) {
          let isHold = pendingTiles[i].isHold;
          if (currentDisableHolds) isHold = false;
          tiles.push(new Tile(pendingTiles[i].lane, -TILE_H, isHold, pendingTiles[i].holdDuration));
          pendingTiles.splice(i, 1);
        }
      }
      for (let i = pendingEffects.length - 1; i >= 0; i--) {
        if (customPlayTime >= pendingEffects[i].time) {
          let fx = pendingEffects[i];
          if (fx.type === 'pulse') fireAdvancedPulse(fx);
          if (fx.type === 'image') fireAdvancedImage(fx);
          if (fx.type === 'extra_image') fireExtraImage(fx);
          if (fx.type === 'tile_style') fireTileStyle(fx);
          if (fx.type === 'speed') fireSpeedChange(fx);
          if (fx.type === 'sfx') fireSFX(fx);
          pendingEffects.splice(i, 1);
        }
      }

      let pct = 0;
      if (levelEndTime > 0) {
        pct = Math.min(100, Math.floor((customPlayTime / levelEndTime) * 100));
        document.getElementById('progress-display').innerText = pct + '%';
      }

      if (isBattleMode && typeof updateBattleProgress === 'function') {
        updateBattleProgress(pct, Math.floor(score));
      }

      if (isVerifying && customPlayTime >= verifyEndTime && tiles.length === 0 && !isDead) {
        clearInterval(customGameInterval);
        gameActive = false;
        alert("Verification Complete! Level will now download.");
        downloadLevelData();
        quitPlaytestOrGame();
      }

      if (isBattleMode && !isVerifying && customPlayTime >= levelEndTime && tiles.length === 0 && !isDead && gameActive) {
        clearInterval(customGameInterval);
        gameActive = false;
        bgAudio.pause();
        if (typeof handleBattleFinish === 'function') handleBattleFinish(true, 'FINISHED');
      }

      if (speedTransitionDuration > 0) {
        speedTransitionTime += 0.016;
        let progress = Math.min(speedTransitionTime / speedTransitionDuration, 1.0);
        speed = initialSpeed + (targetSpeed - initialSpeed) * progress;
        if (progress >= 1.0) speedTransitionDuration = 0;
      }
    }, 16);
  }

  requestAnimationFrame(gameLoop);
}

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
  setTimeout(() => { target.style.transition = `opacity ${fx.outTrans}s ease-in`; target.style.opacity = 0; }, (fx.duration - fx.outTrans) * 1000);
}
function fireAdvancedImage(fx) {
  const target = (fx.layer == 1) ? document.getElementById('fg-image-container') : document.getElementById('bg-image-container');
  target.style.backgroundImage = `url(${fx.src})`; target.style.transition = `opacity ${fx.inTrans}s ease-out`; target.style.opacity = fx.alpha;
  setTimeout(() => { target.style.transition = `opacity ${fx.outTrans}s ease-in`; target.style.opacity = 0; }, (fx.duration - fx.outTrans) * 1000);
}
function fireExtraImage(fx) {
  let img = document.createElement('img');
  img.src = fx.src;
  img.style.position = 'absolute';
  img.style.left = fx.x + 'px';
  img.style.top = fx.y + 'px';
  img.style.width = fx.w + 'px';
  img.style.height = fx.h + 'px';
  img.style.opacity = fx.alpha;
  img.style.transform = 'translate(-50%, -50%)';
  let container = fx.layer == 1 ? document.getElementById('extra-images-fg') : document.getElementById('extra-images-bg');
  container.appendChild(img);
  setTimeout(() => { if (img.parentNode) img.parentNode.removeChild(img); }, fx.duration * 1000);
}
function fireTileStyle(fx) { currentTileStyle.c1 = fx.c1; currentTileStyle.c2 = fx.c2; currentTileStyle.alpha = fx.alpha; }
function fireSpeedChange(fx) { initialSpeed = speed; targetSpeed = fx.target; speedTransitionDuration = fx.transDuration; speedTransitionTime = 0; }
function fireSFX(fx) { let audio = new Audio(fx.src); audio.play().catch(() => {}); }

// --- input: gameplay hit detection + hand-off to editor recording ---
// (canvas pointer handling for tile placement lives in editor.js, since it's
// purely an editor concern — keeping it here would mean this file has to
// load after editor.js just for one listener, which defeats the point of
// splitting them up)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q' && !inEditor && !gameActive && typeof isBattleMenuOpenish === 'function' && isBattleMenuOpenish()) {
    startQuickMatch();
    return;
  }
  if (keys[k] === false) {
    keys[k] = true;
    const laneIndex = keyMap.indexOf(k);

    if (inEditor && isRecording && laneIndex !== -1 && !deleteMode) {
      recordTileFromKeydown(laneIndex, e);
      return;
    }

    if (laneIndex !== -1 && gameActive && !isDead && !inEditor) {
      const activeTiles = tiles.filter(t => !t.interacted);
      if (activeTiles.length > 0) {
        const target = activeTiles.find(t => t.lane === laneIndex);
        let targetY = target ? target.y : 0;
        let firstTileY = activeTiles[0] ? activeTiles[0].y : 0;
        const cbfToggle = document.getElementById('setting-cbf');
        if (cbfToggle && cbfToggle.checked) {
          const timeSinceLastFrame = performance.now() - lastTime;
          const subFrameDt = timeSinceLastFrame / 16.666;
          if (target) targetY += speed * subFrameDt;
          if (activeTiles[0]) firstTileY += speed * subFrameDt;
        }
        if (target && (target === activeTiles[0] || targetY > firstTileY - TILE_H)) {
          target.interacted = true; score += 10;
          for (let i = 0; i < 8; i++) particles.push(new Particle(laneIndex * laneW + laneW / 2, lineY));
        } else if (firstTileY + TILE_H > 0) {
          if (!handleHit()) die("WRONG ORDER!");
        }
      }
    }
  }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  const laneIndex = keyMap.indexOf(k);
  if (inEditor && isRecording && laneIndex !== -1 && editorKeyTimes[laneIndex] !== null) {
    recordTileFromKeyup(laneIndex);
  }
});

// --- main loop ---
function gameLoop(timestamp) {
  if (isDead || (!gameActive && !inEditor)) return;
  let fpsInterval = 1000 / (windowLevelFPS || 60);
  let elapsed = timestamp - lastTime;
  if (elapsed < fpsInterval - 0.1) { requestAnimationFrame(gameLoop); return; }
  const dt = elapsed / 16.666;
  lastTime = timestamp;

  if (gameActive) {
    frameCount++;
    if (timestamp - lastFpsTime >= 1000) {
      document.getElementById('fps-display').innerText = frameCount + ' FPS';
      frameCount = 0;
      lastFpsTime = timestamp;
    }
    scoreEl.innerText = Math.floor(score);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(i * laneW, 0); ctx.lineTo(i * laneW, canvas.height); ctx.stroke(); }
  ctx.strokeStyle = "#00ffff"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(canvas.width, lineY); ctx.stroke();

  if (!isCustomGame && !inEditor && gameActive) {
    distanceTraveled += speed * dt;
    if (distanceTraveled >= nextSpawnDistance) spawnTile();
  }

  if (restEl) {
    restEl.style.opacity = (gameActive && !isCustomGame && !inEditor && tiles.length === 0) ? '1' : '0';
  }

  if (inEditor) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#78bfff";
    ctx.lineWidth = 1;
    const gridStep = getEditorGridStep();
    const pixelsPerSecond = EDITOR_PPS;
    const firstGridIndex = Math.floor((editorTimer - lineY / pixelsPerSecond) / gridStep) - 2;
    const lastGridIndex = Math.ceil((editorTimer + (canvas.height - lineY) / pixelsPerSecond) / gridStep) + 2;
    for (let gi = firstGridIndex; gi <= lastGridIndex; gi++) {
      const gt = gi * gridStep;
      const gy = lineY + (editorTimer - gt) * pixelsPerSecond;
      if (gy < 0 || gy > canvas.height) continue;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
    }
    ctx.restore();

    recordedTiles.forEach(t => {
      let yOffset = (editorTimer - t.time) * EDITOR_PPS;
      let y = lineY + yOffset;
      let holdLen = t.isHold ? (t.holdDuration * EDITOR_PPS) : 0;
      let h = TILE_H + holdLen;
      let drawY = y - holdLen;
      if (drawY < canvas.height + TILE_H && drawY + h > -TILE_H) {
        const isSelected = selectedEffect === t;
        ctx.globalAlpha = isSelected ? 0.9 : 0.6;
        ctx.fillStyle = t.isHold ? "rgba(255, 100, 0, 0.5)" : "rgba(0, 255, 255, 0.5)";
        ctx.fillRect(t.lane * laneW + 4, drawY, laneW - 8, h);
        if (isSelected) {
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
          ctx.strokeRect(t.lane * laneW + 4, drawY, laneW - 8, h);
        }
        ctx.globalAlpha = 1.0;
      }
    });
  }

  for (let i = tiles.length - 1; i >= 0; i--) {
    let t = tiles[i]; t.y += speed * dt;
    let holdLength = t.isHold ? (t.holdDuration * speed * 60) : 0;
    let h = TILE_H + holdLength;
    let headTop = t.y - TILE_H;
    let tailTop = t.y - TILE_H - holdLength;

    if (tailTop > canvas.height) {
      if (!t.interacted) {
        if (handleHit()) { tiles.splice(i, 1); continue; }
        else { die("MISSED!"); return; }
      }
      tiles.splice(i, 1); continue;
    }

    if (t.isHold && t.interacted && !t.failed) {
      if (tailTop < lineY - holdLength) {
        if (keys[keyMap[t.lane]] === false) {
          t.failed = true;
          if (!handleHit()) { die("RELEASED EARLY!"); return; }
        } else {
          score += 0.5;
          if (Math.random() > 0.7) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY));
        }
      }
    }

    // Plain flat tiles — classic Magic Tiles look, no gradient/glow/border.
    // (Hold tiles are disabled in the editor for now — this block only still
    // runs for old level files that already have some.)
    if (t.isHold) {
      ctx.fillStyle = t.interacted ? "#333" : "#000";
      ctx.fillRect(t.lane * laneW + 12, tailTop, laneW - 24, holdLength);
    }

    ctx.globalAlpha = t.interacted ? 0.25 : currentTileStyle.alpha;
    ctx.fillStyle = t.interacted ? "#222" : currentTileStyle.c1;
    ctx.fillRect(t.lane * laneW + 2, headTop, laneW - 4, TILE_H);
    ctx.globalAlpha = 1.0;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = "#00ffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  requestAnimationFrame(gameLoop);
}

// --- death / retry / quit ---
function die(reason) {
  if (isDead) return;
  isDead = true;
  gameActive = false;
  if (customGameInterval) clearInterval(customGameInterval);
  bgAudio.pause();

  if (isBattleMode) {
    if (typeof handleBattleFinish === 'function') handleBattleFinish(false, reason);
    return;
  }

  document.getElementById('lives-display').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('score-container').classList.add('hidden');
  document.getElementById('death-title').innerText = reason || 'FAILED';
  document.getElementById('final-score').innerText = 'Score: ' + Math.floor(score);
  document.getElementById('death-retry-btn').classList.toggle('hidden', isPlaytesting);
  document.getElementById('death-quit-btn').classList.toggle('hidden', isPlaytesting);
  document.getElementById('death-stop-playtest-btn').classList.toggle('hidden', !isPlaytesting);
  toggleMenu('death-screen');
}

function restartGame() {
  document.getElementById('death-screen').classList.add('hidden');
  if (isPlaytesting || isVerifying) { startPlaytest(); return; }
  if (lastStartArgs) startGame.apply(null, lastStartArgs);
}

function quitPlaytestOrGame() {
  gameActive = false; isDead = true; score = 0; scoreEl.innerText = "0";
  if (customGameInterval) clearInterval(customGameInterval);
  bgAudio.pause();
  if (isPlaytesting || isVerifying) { stopPlaytest(); return; }
  document.getElementById('lives-display').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('score-container').classList.add('hidden');
  document.getElementById('battle-race-hud').classList.add('hidden');
  isBattleMode = false;
  toggleMenu('main-menu');
}

// --- editor session lifecycle ---
function startEditor(existingLevel) {
  toggleMenu(null);
  document.getElementById('editor-ui').classList.remove('hidden');
  inEditor = true; gameActive = false; isDead = false; isPlaytesting = false; isVerifying = false; isBattleMode = false;
  recordedTiles = existingLevel ? JSON.parse(JSON.stringify(existingLevel.data)) : [];
  recordedEffects = existingLevel ? JSON.parse(JSON.stringify(existingLevel.effects || [])) : [];
  currentEditingName = existingLevel ? existingLevel.name : "";
  editorTimer = 0; isRecording = false; deleteMode = false; selectedEffect = null;
  document.getElementById('edit-lives').value = existingLevel ? (existingLevel.lives || 3) : 3;
  document.getElementById('edit-fps').value = existingLevel ? (existingLevel.fps || 60) : 60;
  document.getElementById('edit-audio-offset').value = existingLevel ? (existingLevel.audioOffset || 0) : 0;
  document.getElementById('edit-disable-holds').checked = existingLevel ? !!existingLevel.disableHolds : false;
  document.getElementById('edit-difficulty').value = existingLevel ? (existingLevel.difficulty || 'Normal') : 'Normal';
  closeAllDrawers();
  refreshEditorTimeline();
  updateEditorView();
  renderSelectedEffectPanels();
  requestAnimationFrame(gameLoop);
}

function toggleRecording() {
  // "Record" is one button that does the whole job: start the song playing
  // and the playhead advancing at the same time you arm key recording, so
  // there's no separate step to forget. (Previously you had to also find
  // and press a transport play button, which is what made this confusing.)
  isRecording = !isRecording;
  const btn = document.getElementById('btn-create-tiles');
  if (btn) btn.classList.toggle('active', isRecording);
  if (isRecording && !editorPlaying) toggleEditorTransport();
  else if (!isRecording && editorPlaying) toggleEditorTransport();
}

function toggleSongTester() {
  isSongTesting = !isSongTesting;
  const btn = document.getElementById('btn-song-test');
  if (!bgAudio.src) { alert('Load a song first!'); isSongTesting = false; if (btn) btn.classList.remove('active'); return; }
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
}

function openCreatorMenu() { document.getElementById('creator-menu').classList.remove('hidden'); }
function closeCreatorMenu() { document.getElementById('creator-menu').classList.add('hidden'); }

function exitEditorWithoutSaving() {
  if (!confirm('Quit without saving? Unsaved changes will be lost.')) return;
  closeCreatorMenu();
  document.getElementById('editor-ui').classList.add('hidden');
  inEditor = false; isRecording = false; isSongTesting = false;
  bgAudio.pause();
  if (editorInterval) clearInterval(editorInterval);
  toggleMenu('main-menu');
}

function openEditorSettingsMenu() { document.getElementById('editor-level-settings').classList.remove('hidden'); }
function closeEditorSettingsMenu() { document.getElementById('editor-level-settings').classList.add('hidden'); }

function startPlaytest() {
  if (recordedTiles.length === 0) { alert("Place some tiles first!"); return; }
  maxLives = parseInt(document.getElementById('edit-lives').value) || 1;
  isPlaytesting = true; inEditor = false; deleteMode = false;
  ['btn-delete-mode', 'btn-delete-mode-2'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById('editor-ui').classList.add('hidden');
  document.getElementById('stop-playtest-btn').classList.remove('hidden');
  startGame('playtest', true, -1, recordedTiles, recordedEffects);
}

function stopPlaytest() {
  isPlaytesting = false; isVerifying = false; gameActive = false; isDead = true; resetState();
  document.getElementById('stop-playtest-btn').classList.add('hidden');
  document.getElementById('lives-display').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('score-container').classList.add('hidden');
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('editor-ui').classList.remove('hidden');
  inEditor = true;
  requestAnimationFrame(gameLoop);
}

function stopPlaytestFromDeath() { stopPlaytest(); }

function verifyAndDownloadLevel() {
  if (recordedTiles.length === 0) { alert("Place some tiles first!"); return; }
  closeCreatorMenu();
  isVerifying = true;
  startPlaytest();
}
