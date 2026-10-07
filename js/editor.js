// ============================================================================
// editor.js — everything about building a level.
//
// Fixes in this version:
//   * Tapping the board now places a tile WHERE YOU TAPPED (snapped to the
//     grid) instead of always at the playhead.
//   * Snapping is real: BPM + grid offset are level settings, beat lines are
//     drawn brighter than sub-beat lines, and there's a visible Snap toggle.
//   * Tiles in the editor are drawn exactly where they will appear in the game
//     (they used to be a full tile-height too low).
//   * Playback runs off a real clock / the song's own time instead of a 50ms
//     setInterval that drifted away from the music.
//   * The timeline no longer covers the board — the board is laid out above it.
// ============================================================================

const EFFECT_STUDIO_PPS = 80;
const TRACK_ROWS = ['visual', 'speed', 'image', 'audio'];
const EFFECT_COLORS = { pulse: '#ff2e88', tile_style: '#00f0ff', speed: '#ffc93c', image: '#9d4edd', extra_image: '#b34dff', sfx: '#37b6ff' };

// ---------------------------------------------------------------------------
// Grid / snapping
// ---------------------------------------------------------------------------
function snapTime(time, bypass = false) {
  const raw = Math.max(0, Number(time) || 0);
  if (bypass || !editorSnapEnabled) return Math.round(raw * 1000) / 1000;
  const step = getEditorGridStep();
  const snapped = Math.round((raw - editorGridOffset) / step) * step + editorGridOffset;
  return Math.max(0, Math.round(snapped * 1000) / 1000);
}

function setEditorGrid(division) {
  editorGridDivision = [1, 2, 3, 4, 8].includes(Number(division)) ? Number(division) : 2;
  document.querySelectorAll('.grid-btn[data-grid]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.grid) === editorGridDivision));
  updateGridReadout();
}

function updateGridReadout() {
  const readout = document.getElementById('grid-readout');
  if (readout) readout.textContent = getEditorGridStep().toFixed(3) + 's';
  const bpm = document.getElementById('bpm-readout');
  if (bpm) bpm.textContent = Math.round(editorBpm) + ' BPM';
}

function toggleEditorSnap() {
  editorSnapEnabled = !editorSnapEnabled;
  const btn = document.getElementById('btn-snap');
  if (btn) { btn.classList.toggle('active', editorSnapEnabled); btn.textContent = editorSnapEnabled ? '🧲 Snap ON' : '🧲 Snap OFF'; }
}

function onBpmChanged(value) {
  const bpm = Number(value);
  if (!Number.isFinite(bpm)) return;
  editorBpm = Math.max(30, Math.min(300, bpm));
  updateGridReadout();
}
function onGridOffsetChanged(value) {
  const off = Number(value);
  editorGridOffset = Number.isFinite(off) ? Math.max(-5, Math.min(5, off)) : 0;
}

function setEditorZoom(delta) {
  editorZoom = Math.max(0.25, Math.min(1.5, Math.round((editorZoom + delta) * 100) / 100));
  const el = document.getElementById('zoom-readout');
  if (el) el.textContent = Math.round(editorZoom * 100) + '%';
}

function snapAllTiles() {
  if (!recordedTiles.length) return;
  let moved = 0;
  recordedTiles.forEach(t => { const s = snapTime(t.time, false); if (Math.abs(s - t.time) > 0.0005) moved++; t.time = s; });
  // two tiles may now share a lane+time; drop the duplicates
  const seen = new Set();
  recordedTiles = recordedTiles.filter(t => { const k = t.lane + '@' + t.time; if (seen.has(k)) return false; seen.add(k); return true; });
  recordedTiles.sort((a, b) => a.time - b.time || a.lane - b.lane);
  refreshEditorTimeline();
  toast(moved ? 'Snapped ' + moved + ' tile' + (moved === 1 ? '' : 's') + ' to the grid.' : 'Everything was already on the grid.');
}

function tileAlreadyAt(lane, time) {
  const epsilon = Math.min(0.02, getEditorGridStep() * 0.25);
  return recordedTiles.some(t => t.lane === lane && Math.abs(t.time - time) < epsilon);
}

function addTile(lane, time) {
  if (tileAlreadyAt(lane, time)) return null;
  const t = { lane, time, isHold: false, holdDuration: 0 };
  recordedTiles.push(t);
  recordedTiles.sort((a, b) => a.time - b.time || a.lane - b.lane);
  levelVerified = false;
  refreshEditorTimeline();
  return t;
}

// ---------------------------------------------------------------------------
// Board pointer input (called from game.js when inEditor)
// ---------------------------------------------------------------------------
function boardPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) / rect.width) * GW, y: ((e.clientY - rect.top) / rect.height) * GH };
}

function handleEditorPointer(e) {
  if (!inEditor) return;
  e.preventDefault();
  if (handleHitboxPointer(e)) return;
  const { x, y } = boardPoint(e);
  if (x < 0 || x > GW || y < 0 || y > GH) return;
  const lane = Math.max(0, Math.min(3, Math.floor(x / laneW)));
  // A tile's BOTTOM edge sits on the hit line at its time (same as gameplay). The player taps where they want the
  // tile's middle to be, so shift by half a tile height to get that tile's time.
  const pps = getEditorPPS();
  const halfTile = (TILE_H * editorZoom * 0.5) / pps;
  const tapTime = editorTimer - (y - lineY) / pps - halfTile;

  if (deleteMode) {
    let best = -1, bestDist = Infinity;
    recordedTiles.forEach((t, i) => {
      if (t.lane !== lane) return;
      const dist = Math.max(0, Math.abs(t.time - tapTime) - halfTile);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best !== -1 && bestDist <= 0.12) {
      recordedTiles.splice(best, 1);
      levelVerified = false;
      refreshEditorTimeline();
    }
    return;
  }
  addTile(lane, snapTime(tapTime, e.shiftKey));
}

function recordTileFromKeydown(laneIndex, e) {
  if (editorKeyTimes[laneIndex] !== null) return;
  const t = snapTime(editorTimer, e.shiftKey);
  editorKeyTimes[laneIndex] = t;
  addTile(laneIndex, t);
  editorVisualTiles.push({ lane: laneIndex, alpha: 1.0 });
}
function recordTileFromKeyup(laneIndex) { editorKeyTimes[laneIndex] = null; }

// Mouse wheel / arrow keys scrub the playhead by one grid step.
canvas.addEventListener('wheel', (e) => {
  if (!inEditor) return;
  e.preventDefault();
  stepEditorTime(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!inEditor || isTypingTarget(e) || dialogOpen()) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); stepEditorTime(1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); stepEditorTime(-1); }
  else if (e.key === 'Enter' && !isRecording) { e.preventDefault(); toggleEditorTransport(); }
});

function stepEditorTime(dir) {
  const step = getEditorGridStep();
  const idx = Math.round((editorTimer - editorGridOffset) / step) + dir;
  setEditorTime(Math.max(0, idx * step + editorGridOffset));
}

// ---------------------------------------------------------------------------
// Drawers (left = tools, right = quick inspector)
// ---------------------------------------------------------------------------
function toggleDrawer(side) {
  const other = side === 'left' ? 'right' : 'left';
  const el = document.getElementById('drawer-' + side);
  const willOpen = !el.classList.contains('open');
  document.getElementById('drawer-' + other).classList.remove('open');
  el.classList.toggle('open', willOpen);
  updateDrawerBackdrop();
}
function closeAllDrawers() {
  document.getElementById('drawer-left').classList.remove('open');
  document.getElementById('drawer-right').classList.remove('open');
  updateDrawerBackdrop();
}
function updateDrawerBackdrop() {
  const anyOpen = document.getElementById('drawer-left').classList.contains('open') || document.getElementById('drawer-right').classList.contains('open');
  document.getElementById('drawer-backdrop').classList.toggle('show', anyOpen);
}

// ---------------------------------------------------------------------------
// Docked bottom timeline
// ---------------------------------------------------------------------------
function timelineMax() {
  let maxT = 30;
  if (bgAudio.duration && isFinite(bgAudio.duration)) maxT = Math.max(maxT, bgAudio.duration);
  recordedTiles.forEach(t => { if (t.time + 5 > maxT) maxT = t.time + 5; });
  recordedEffects.forEach(e => { if (e.time + 5 > maxT) maxT = e.time + 5; });
  return maxT;
}

// Rebuilds markers — only when tiles/effects change, never every frame.
function refreshEditorTimeline() {
  const maxT = timelineMax();
  const slider = document.getElementById('timeline-slider');
  slider.max = maxT;

  const layer = document.getElementById('editor-marker-layer');
  layer.innerHTML = '';
  const frag = document.createDocumentFragment();
  recordedTiles.forEach(t => {
    const m = document.createElement('div');
    m.className = 'timeline-marker' + (t.isHold ? ' hold' : '');
    m.style.left = Math.min(100, (t.time / maxT) * 100) + '%';
    frag.appendChild(m);
  });
  recordedEffects.forEach(fx => {
    const m = document.createElement('div');
    m.className = 'timeline-marker fx';
    m.style.left = Math.min(100, (fx.time / maxT) * 100) + '%';
    m.title = effectKindLabel(fx);
    m.onclick = (ev) => { ev.stopPropagation(); selectEffect(fx); toggleDrawer('right'); };
    frag.appendChild(m);
  });
  layer.appendChild(frag);
  const count = document.getElementById('editor-tile-count');
  if (count) count.textContent = recordedTiles.length + ' tiles';

  updateEditorPlayhead();
  if (!document.getElementById('effects-menu').classList.contains('hidden')) {
    updateEffectPlayheadDisplays();
    renderEffectTracks();
  }
}

// Cheap per-frame update: just the playhead + readouts.
function updateEditorPlayhead() {
  const slider = document.getElementById('timeline-slider');
  const maxT = parseFloat(slider.max) || 30;
  const text = editorTimer.toFixed(2) + 's';
  const timeEl = document.getElementById('editor-timeline-time');
  const pill = document.getElementById('editor-timer-panel');
  if (timeEl) timeEl.textContent = text;
  if (pill) pill.textContent = text;
  slider.value = editorTimer;
  const ph = document.getElementById('editor-playhead');
  if (ph) ph.style.left = Math.min(100, (editorTimer / maxT) * 100) + '%';
}

function setEditorTime(t) {
  editorTimer = Math.max(0, t);
  if (bgAudio.src && !editorPlaying) { try { bgAudio.currentTime = editorTimer; } catch (e) {} }
  updateEditorPlayhead();
  if (!document.getElementById('effects-menu').classList.contains('hidden')) updateEffectPlayheadDisplays();
}

function scrubTimeline(value) {
  const wasPlaying = editorPlaying;
  setEditorTime(parseFloat(value) || 0);
  if (wasPlaying && bgAudio.src) { try { bgAudio.currentTime = editorTimer; } catch (e) {} }
}
function nudgeEditorTime(delta) { setEditorTime(editorTimer + delta); }

function jumpEditorEnd() {
  let maxT = 0;
  recordedTiles.forEach(t => maxT = Math.max(maxT, t.time + (t.holdDuration || 0)));
  recordedEffects.forEach(e => maxT = Math.max(maxT, e.time + (e.duration || 0)));
  setEditorTime(maxT);
}

// Called every frame by the game loop while the editor is showing.
let editorUiAccum = 0;
function editorTick(dtSec) {
  if (!editorPlaying) return;
  const audioPlaying = bgAudio.src && !bgAudio.paused && !bgAudio.ended;
  if (audioPlaying) editorTimer = bgAudio.currentTime;   // the song is the master clock when there is one
  else editorTimer += dtSec;
  editorUiAccum += dtSec;
  if (editorUiAccum >= 0.05) { editorUiAccum = 0; updateEditorPlayhead(); }
}

function toggleEditorTransport() {
  editorPlaying = !editorPlaying;
  const btn = document.getElementById('editor-transport-btn');
  if (btn) btn.innerText = editorPlaying ? '⏸' : '▶';
  if (editorPlaying) {
    if (bgAudio.src) { try { bgAudio.currentTime = editorTimer; } catch (e) {} bgAudio.play().catch(() => {}); }
  } else {
    bgAudio.pause();
    if (isRecording) {
      isRecording = false;
      document.getElementById('btn-create-tiles')?.classList.remove('active');
    }
  }
}
function stopEditorTransport() {
  if (!editorPlaying) return;
  editorPlaying = false;
  const btn = document.getElementById('editor-transport-btn');
  if (btn) btn.innerText = '▶';
  if (isRecording) { isRecording = false; document.getElementById('btn-create-tiles')?.classList.remove('active'); }
}

function toggleTimelineDock() {
  document.getElementById('timeline-dock').classList.toggle('collapsed');
  setTimeout(layoutCanvas, 20);
  setTimeout(layoutCanvas, 300);
}

// ---------------------------------------------------------------------------
// Effects studio
// ---------------------------------------------------------------------------
function effectKindLabel(fx) {
  return { pulse: 'PULSE', tile_style: 'TILE STYLE', speed: 'SPEED', image: 'IMAGE', extra_image: 'EXTRA IMAGE', sfx: 'SFX', hitbox: 'HITBOX', tilemove: 'TILE MOVE', tilehide: 'TILE HIDE', video: 'VIDEO' }[fx.type] || String(fx.type).toUpperCase();
}

function switchEffectCategory(cat) {
  currentEffectCategory = cat;
  ['visual', 'speed', 'image', 'audio', 'advanced'].forEach(c => {
    const el = document.getElementById('effect-library-' + c);
    if (el) el.classList.toggle('hidden', c !== cat);
  });
  document.querySelectorAll('.effect-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.cat === cat));
}

function openEffectsMenu() {
  toggleMenu('effects-menu');
  switchEffectCategory(currentEffectCategory);
  renderEffectTimeRuler();
  renderEffectTracks();
  updateEffectPlayheadDisplays();
}
function closeEffectsMenu() { toggleMenu(null); }

function pushEffect(fx) {
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  levelVerified = false;
  selectEffect(fx);
}
function addPulseEffect() { pushEffect({ type: 'pulse', time: editorTimer, layer: 0, color: '#0055ff', duration: 0.6, inTrans: 0.1, outTrans: 0.3 }); }
function addTileStyleEffect() { pushEffect({ type: 'tile_style', time: editorTimer, c1: '#00f0ff', c2: '#0055ff', alpha: 1 }); }
function setSpeedPreset(mult) {
  const presetTargets = { 0.5: 10, 1: 18, 1.5: 26, 2: 34 };
  pushEffect({ type: 'speed', time: editorTimer, target: presetTargets[mult] || Math.round(EDITOR_BASE_SPEED * mult), transDuration: 0.5 });
}
function addSpeedEffect() {
  pushEffect({
    type: 'speed', time: editorTimer,
    target: parseFloat(document.getElementById('fx-speed-target').value) || 25,
    transDuration: parseFloat(document.getElementById('fx-speed-trans').value) || 0.5
  });
}
function addImageEffect() {
  if (!loadedImageDataUrl) { toast('Choose an image file first.'); return; }
  pushEffect({
    type: 'image', time: editorTimer, layer: 0, src: loadedImageDataUrl,
    alpha: parseFloat(document.getElementById('fx-img-alpha').value) || 0.5,
    duration: parseFloat(document.getElementById('fx-img-dur').value) || 2,
    inTrans: parseFloat(document.getElementById('fx-img-in').value) || 0.3,
    outTrans: parseFloat(document.getElementById('fx-img-out').value) || 0.3
  });
}
function setExtraImagePosition(pos) {
  if (pos === 'center') { pendingExtraX = GW / 2; pendingExtraY = GH / 2; }
  if (pos === 'top') { pendingExtraX = GW / 2; pendingExtraY = 110; }
  if (pos === 'bottom') { pendingExtraX = GW / 2; pendingExtraY = GH - 100; }
  toast('Extra image position: ' + pos);
}
function addExtraImageEffect() {
  if (!loadedExtraImageDataUrl) { toast('Choose an image file first.'); return; }
  pushEffect({
    type: 'extra_image', time: editorTimer, layer: 0, src: loadedExtraImageDataUrl,
    x: pendingExtraX, y: pendingExtraY,
    w: parseFloat(document.getElementById('fx-extra-w').value) || 150,
    h: parseFloat(document.getElementById('fx-extra-h').value) || 150,
    alpha: parseFloat(document.getElementById('fx-extra-alpha').value) || 1,
    duration: parseFloat(document.getElementById('fx-extra-dur').value) || 2
  });
}
function addHitboxEffect() {
  pushEffect({ type: 'hitbox', time: editorTimer, zoneOn: 1, z0t: 400, z0h: 140, z1t: 400, z1h: 140, z2t: 400, z2h: 140, z3t: 400, z3h: 140 });
  toast('Drag the cyan boxes on the board. Drag a box to move it, drag its bottom bar to resize it.');
}
function addTileMoveEffect() { pushEffect({ type: 'tilemove', time: editorTimer, mode: 0, amount: 60, duration: 2 }); }
function addTileHideEffect() { pushEffect({ type: 'tilehide', time: editorTimer, mode: 0, fadeY: 200, duration: 3 }); }
function addVideoEffect() {
  const url = (document.getElementById('fx-video-url').value || '').trim();
  if (!/^https:\/\/[^\s"'<>]{4,490}$/i.test(url)) { toast('Paste a direct https link to a video file (.mp4 / .webm).', 'bad'); return; }
  pushEffect({ type: 'video', time: editorTimer, url, layer: 0, alpha: 0.6, duration: 5, loop: 1 });
}
function addSfxEffect() {
  if (!loadedSfxDataUrl) { toast('Choose an audio file first.'); return; }
  pushEffect({ type: 'sfx', time: editorTimer, src: loadedSfxDataUrl });
}

function bindFileToVar(inputId, setter, maxMb) {
  document.getElementById(inputId).addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) { toast('That file is too big (max ' + maxMb + 'MB).'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (ev) => setter(ev.target.result);
    reader.readAsDataURL(file);
  });
}
bindFileToVar('fx-img-upload', v => loadedImageDataUrl = v, 1.5);
bindFileToVar('fx-extra-upload', v => loadedExtraImageDataUrl = v, 1.5);
bindFileToVar('fx-sfx-upload', v => loadedSfxDataUrl = v, 1.5);

// --- selection + shared inspector rendering ---
function selectEffect(fx) {
  selectedEffect = fx;
  renderSelectedEffectPanels();
  renderEffectTracks();
  refreshEditorTimeline();
}
function setSelectedEffectToPlayhead() {
  if (!selectedEffect) return;
  selectedEffect.time = editorTimer;
  recordedEffects.sort((a, b) => a.time - b.time);
  renderSelectedEffectPanels(); renderEffectTracks(); refreshEditorTimeline();
}
function deleteSelectedEffect() {
  if (!selectedEffect) return;
  recordedEffects = recordedEffects.filter(e => e !== selectedEffect);
  selectedEffect = null;
  renderSelectedEffectPanels(); renderEffectTracks(); refreshEditorTimeline();
}
function nudgeSelectedEffect(delta) {
  if (!selectedEffect) return;
  selectedEffect.time = Math.max(0, selectedEffect.time + delta);
  recordedEffects.sort((a, b) => a.time - b.time);
  renderSelectedEffectPanels(); renderEffectTracks(); refreshEditorTimeline();
}

function describeEffectFields(fx) {
  const fields = [];
  const num = (label, key, opts) => fields.push(Object.assign({ label, key, kind: 'number' }, opts || {}));
  const col = (label, key) => fields.push({ label, key, kind: 'color' });
  const sel = (label, key, options) => fields.push({ label, key, kind: 'select', options });
  switch (fx.type) {
    case 'pulse':
      sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]);
      col('Color', 'color');
      num('Duration', 'duration', { step: 0.05, min: 0.05 });
      num('Fade in', 'inTrans', { step: 0.05, min: 0 });
      num('Fade out', 'outTrans', { step: 0.05, min: 0 });
      break;
    case 'tile_style':
      col('Color 1', 'c1'); col('Color 2', 'c2');
      num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 });
      break;
    case 'speed':
      num('Target speed', 'target', { step: 1, min: 5, max: 60 });
      num('Transition', 'transDuration', { step: 0.05, min: 0 });
      break;
    case 'image':
      sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]);
      num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 });
      num('Duration', 'duration', { step: 0.1, min: 0.1 });
      num('Fade in', 'inTrans', { step: 0.05, min: 0 });
      num('Fade out', 'outTrans', { step: 0.05, min: 0 });
      break;
    case 'hitbox':
      sel('Hitboxes', 'zoneOn', [{ v: 1, l: 'On (drag the boxes)' }, { v: 0, l: 'Off (tap anywhere)' }]);
      fields.push({ label: 'Drag the cyan boxes on the board - one per lane. Tiles count as hit-able as soon as they touch their lane\'s box.', kind: 'note' });
      fields.push({ label: '', kind: 'button', text: 'Make every lane match lane 1', onClick: fx => { for (let l = 1; l < 4; l++) { fx['z' + l + 't'] = fx.z0t; fx['z' + l + 'h'] = fx.z0h; } } });
      fields.push({ label: '', kind: 'button', text: 'Reset boxes', onClick: fx => { for (let l = 0; l < 4; l++) { fx['z' + l + 't'] = 400; fx['z' + l + 'h'] = 140; } } });
      break;
    case 'tilemove':
      sel('Mode', 'mode', [{ v: 0, l: 'Shift sideways' }, { v: 1, l: 'Sway' }]);
      num('Amount (px)', 'amount', { step: 5, min: -180, max: 180 });
      num('Duration', 'duration', { step: 0.1, min: 0.2 });
      break;
    case 'tilehide':
      sel('Mode', 'mode', [{ v: 0, l: 'Fade out as they fall' }, { v: 1, l: 'Invisible' }]);
      num('Fade starts at Y', 'fadeY', { step: 10, min: 0, max: 600 });
      num('Duration', 'duration', { step: 0.1, min: 0.2 });
      break;
    case 'video':
      fields.push({ label: 'Video URL (https)', key: 'url', kind: 'text' });
      sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]);
      num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 });
      num('Duration', 'duration', { step: 0.5, min: 0.5 });
      sel('Loop', 'loop', [{ v: 1, l: 'Yes' }, { v: 0, l: 'No' }]);
      break;
    case 'extra_image':
      sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]);
      num('X', 'x', { step: 5 }); num('Y', 'y', { step: 5 });
      num('Width', 'w', { step: 5, min: 5 }); num('Height', 'h', { step: 5, min: 5 });
      num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 });
      num('Duration', 'duration', { step: 0.1, min: 0.1 });
      break;
  }
  return fields;
}

function onEffectFieldChanged() { levelVerified = false; renderEffectTracks(); refreshEditorTimeline(); }

function buildFieldsInto(container, fx) {
  container.innerHTML = '';
  const fields = describeEffectFields(fx);
  if (fields.length === 0) {
    const p = document.createElement('div');
    p.className = 'muted-note';
    p.textContent = fx.type === 'sfx' ? 'Plays once when the playhead reaches it.' : 'No extra properties.';
    container.appendChild(p);
    return;
  }
  fields.forEach(f => {
    const row = document.createElement('div');
    row.className = 'inspector-field';
    const label = document.createElement('label');
    label.textContent = f.label;
    let input;
    if (f.kind === 'color') {
      input = document.createElement('input'); input.type = 'color'; input.value = fx[f.key] || '#000000';
      input.oninput = () => { fx[f.key] = input.value; onEffectFieldChanged(); };
    } else if (f.kind === 'note') {
      row.className = 'muted-note'; row.textContent = f.label; container.appendChild(row); return;
    } else if (f.kind === 'button') {
      input = document.createElement('button'); input.className = 'btn small btn-ghost'; input.textContent = f.text;
      input.onclick = () => { f.onClick(fx); onEffectFieldChanged(); buildFieldsInto(container, fx); };
    } else if (f.kind === 'text') {
      input = document.createElement('input'); input.type = 'text'; input.value = fx[f.key] || '';
      input.oninput = () => { fx[f.key] = input.value.trim(); onEffectFieldChanged(); };
    } else if (f.kind === 'select') {
      input = document.createElement('select');
      f.options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.v; opt.textContent = o.l;
        if (Number(fx[f.key]) === o.v) opt.selected = true;
        input.appendChild(opt);
      });
      input.onchange = () => { fx[f.key] = parseInt(input.value); onEffectFieldChanged(); };
    } else {
      input = document.createElement('input'); input.type = 'number';
      if (f.step !== undefined) input.step = f.step;
      if (f.min !== undefined) input.min = f.min;
      if (f.max !== undefined) input.max = f.max;
      input.value = fx[f.key];
      input.oninput = () => { fx[f.key] = parseFloat(input.value) || 0; onEffectFieldChanged(); };
    }
    row.appendChild(label); row.appendChild(input);
    container.appendChild(row);
  });
}

function renderSelectedEffectPanels() {
  const empty = document.getElementById('selected-effect-empty');
  const editorPanel = document.getElementById('selected-effect-editor');
  if (!selectedEffect) {
    empty.classList.remove('hidden');
    editorPanel.classList.add('hidden');
  } else {
    empty.classList.add('hidden');
    editorPanel.classList.remove('hidden');
    document.getElementById('selected-effect-kind').textContent = effectKindLabel(selectedEffect);
    document.getElementById('selected-effect-time').textContent = selectedEffect.time.toFixed(2) + 's';
    buildFieldsInto(document.getElementById('selected-effect-fields'), selectedEffect);
  }
  renderStudioInspector();
}

function renderStudioInspector() {
  const content = document.getElementById('effect-inspector-content');
  const subtitle = document.getElementById('effect-inspector-subtitle');
  if (!content) return;
  content.innerHTML = '';
  if (!selectedEffect) {
    subtitle.textContent = 'Select an effect';
    const empty = document.createElement('div');
    empty.className = 'effect-inspector-empty';
    empty.innerHTML = '<div class="inspector-empty-icon">✦</div><b>Select an effect</b><span>Pick a block from the timeline to edit its timing, duration and properties.</span>';
    content.appendChild(empty);
    return;
  }
  subtitle.textContent = effectKindLabel(selectedEffect) + ' · ' + selectedEffect.time.toFixed(2) + 's';
  const timeRow = document.createElement('div');
  timeRow.className = 'inspector-field';
  const timeLabel = document.createElement('label'); timeLabel.textContent = 'Time (s)';
  const timeInput = document.createElement('input');
  timeInput.type = 'number'; timeInput.step = 0.01; timeInput.min = 0; timeInput.value = selectedEffect.time.toFixed(2);
  timeInput.oninput = () => {
    selectedEffect.time = Math.max(0, parseFloat(timeInput.value) || 0);
    recordedEffects.sort((a, b) => a.time - b.time);
    onEffectFieldChanged();
    subtitle.textContent = effectKindLabel(selectedEffect) + ' · ' + selectedEffect.time.toFixed(2) + 's';
  };
  timeRow.appendChild(timeLabel); timeRow.appendChild(timeInput);
  content.appendChild(timeRow);
  const fieldsWrap = document.createElement('div');
  content.appendChild(fieldsWrap);
  buildFieldsInto(fieldsWrap, selectedEffect);
}

function updateEffectPlayheadDisplays() {
  const disp = document.getElementById('effect-time-display');
  if (disp) disp.textContent = editorTimer.toFixed(2) + 's';
  const ph = document.getElementById('effect-timeline-playhead');
  if (ph) ph.style.left = (editorTimer * EFFECT_STUDIO_PPS) + 'px';
  const summary = document.getElementById('effect-selection-summary');
  if (summary) summary.textContent = selectedEffect ? (effectKindLabel(selectedEffect) + ' selected · ' + selectedEffect.time.toFixed(2) + 's') : 'Nothing selected';
}

function getEffectTimelineDuration() {
  let maxT = 20;
  recordedTiles.forEach(t => maxT = Math.max(maxT, t.time + (t.holdDuration || 0) + 3));
  recordedEffects.forEach(e => maxT = Math.max(maxT, e.time + (e.duration || 0.5) + 3));
  if (bgAudio.duration && isFinite(bgAudio.duration)) maxT = Math.max(maxT, bgAudio.duration);
  return maxT;
}

function renderEffectTimeRuler() {
  const ruler = document.getElementById('effect-time-ruler');
  if (!ruler) return;
  const duration = getEffectTimelineDuration();
  const width = duration * EFFECT_STUDIO_PPS;
  ruler.style.width = width + 'px';
  ruler.innerHTML = '';
  for (let s = 0; s <= duration; s++) {
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute; left:${s * EFFECT_STUDIO_PPS}px; top:0; bottom:0; width:1px; background:var(--line);`;
    ruler.appendChild(tick);
    if (s % 5 === 0) {
      const label = document.createElement('span');
      label.textContent = s + 's';
      label.style.cssText = `position:absolute; left:${s * EFFECT_STUDIO_PPS + 4}px; top:3px; font-size:9px; color:var(--text-low);`;
      ruler.appendChild(label);
    }
  }
  const tracksEl = document.getElementById('effect-tracks');
  if (tracksEl) tracksEl.style.width = width + 'px';
}

function trackRowForEffect(fx) {
  if (fx.type === 'pulse' || fx.type === 'tile_style') return 0;
  if (fx.type === 'speed') return 1;
  if (fx.type === 'image' || fx.type === 'extra_image' || fx.type === 'video') return 2;
  return 3;
}

// Block drag/resize use pointer events so they work with touch as well as mouse.
function attachBlockDrag(block, fx) {
  block.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.stopPropagation();
    selectEffect(fx);
    const startX = e.clientX, startTime = fx.time;
    function onMove(ev) {
      let newTime = startTime + (ev.clientX - startX) / EFFECT_STUDIO_PPS;
      if (!ev.shiftKey && editorSnapEnabled) newTime = Math.round((newTime - editorGridOffset) / getEditorGridStep()) * getEditorGridStep() + editorGridOffset;
      fx.time = Math.max(0, newTime);
      block.style.left = (fx.time * EFFECT_STUDIO_PPS) + 'px';
      updateEffectPlayheadDisplays();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      recordedEffects.sort((a, b) => a.time - b.time);
      levelVerified = false;
      renderSelectedEffectPanels();
      refreshEditorTimeline();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}
function attachBlockResize(handle, fx, block) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    selectEffect(fx);
    const startX = e.clientX, startDur = fx.duration || 0.4;
    function onMove(ev) {
      fx.duration = Math.max(0.1, startDur + (ev.clientX - startX) / EFFECT_STUDIO_PPS);
      block.style.width = Math.max(18, fx.duration * EFFECT_STUDIO_PPS) + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      renderSelectedEffectPanels();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function renderEffectTracks() {
  const tracksEl = document.getElementById('effect-tracks');
  if (!tracksEl) return;
  tracksEl.innerHTML = '';
  const rows = TRACK_ROWS.map(() => { const r = document.createElement('div'); r.className = 'effect-track-row'; tracksEl.appendChild(r); return r; });
  recordedEffects.forEach(fx => {
    const row = rows[trackRowForEffect(fx)];
    const block = document.createElement('div');
    block.className = 'effect-block' + (selectedEffect === fx ? ' selected' : '');
    const dur = fx.duration || 0.4;
    block.style.left = (fx.time * EFFECT_STUDIO_PPS) + 'px';
    block.style.width = Math.max(18, dur * EFFECT_STUDIO_PPS) + 'px';
    block.style.background = EFFECT_COLORS[fx.type] || '#555';
    block.textContent = effectKindLabel(fx);
    attachBlockDrag(block, fx);
    if (fx.duration !== undefined) {
      const rh = document.createElement('div'); rh.className = 'resize-handle right';
      attachBlockResize(rh, fx, block);
      block.appendChild(rh);
    }
    row.appendChild(block);
  });
  const wrap = document.getElementById('effect-timeline-wrap');
  if (wrap && !wrap._clickBound) {
    wrap._clickBound = true;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.effect-block')) return;
      const rect = document.getElementById('effect-tracks').getBoundingClientRect();
      setEditorTime(Math.max(0, (e.clientX - rect.left) / EFFECT_STUDIO_PPS));
    });
  }
}

// ---------------------------------------------------------------------------
// Level appearance
// ---------------------------------------------------------------------------
function updateEditorBackgroundBrightness(value) {
  currentLevelBrightness = Math.max(70, Math.min(140, Number(value) || 100));
  const output = document.getElementById('edit-bg-brightness-value');
  if (output) output.textContent = currentLevelBrightness + '%';
}

function renderLevelIconPreview() {
  const preview = document.getElementById('edit-level-icon-preview');
  if (!preview) return;
  preview.innerHTML = currentLevelIcon ? '<img src="' + escapeHtml(currentLevelIcon) + '" alt="Level icon">' : '<span>No icon</span>';
}

const levelIconUpload = document.getElementById('edit-level-icon-upload');
if (levelIconUpload) {
  levelIconUpload.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image.'); return; }
    try {
      currentLevelIcon = await downscaleImage(file, 256);
      renderLevelIconPreview();
    } catch (e) { toast(e.message || 'Could not read that image.'); }
    event.target.value = '';
  });
}


// ---------------------------------------------------------------------------
// Undo / redo / delete all.  History works by comparing the level data after every
// click/key/field change, so it covers every way of editing (recording, dragging, inspector fields...).
// ---------------------------------------------------------------------------
let undoStack = [], redoStack = [], lastSnap = null;
const snapState = () => JSON.stringify([recordedTiles, recordedEffects]);
function historyReset() { undoStack = []; redoStack = []; lastSnap = snapState(); }
function historyCheck() {
  if (!inEditor) return;
  const now = snapState();
  if (lastSnap === null) { lastSnap = now; return; }
  if (now === lastSnap) return;
  undoStack.push(lastSnap); if (undoStack.length > 100) undoStack.shift();
  redoStack = []; lastSnap = now;
}
function applySnap(str) {
  const [t, e] = JSON.parse(str);
  recordedTiles = t; recordedEffects = e; lastSnap = str;
  selectedEffect = null; levelVerified = false;
  refreshEditorTimeline(); renderEffectTracks(); renderSelectedEffectPanels();
}
function editorUndo() {
  historyCheck();
  if (!undoStack.length) { toast('Nothing to undo.'); return; }
  redoStack.push(lastSnap); applySnap(undoStack.pop());
}
function editorRedo() {
  historyCheck();
  if (!redoStack.length) { toast('Nothing to redo.'); return; }
  undoStack.push(lastSnap); applySnap(redoStack.pop());
}
async function deleteAllEditor() {
  if (!recordedTiles.length && !recordedEffects.length) { toast('Nothing to delete.'); return; }
  if (!(await uiConfirm('Delete ALL tiles and effects? You can undo this with ↶.', 'Delete all', true))) return;
  historyCheck();
  recordedTiles = []; recordedEffects = []; selectedEffect = null; levelVerified = false;
  refreshEditorTimeline(); renderEffectTracks(); renderSelectedEffectPanels();
  historyCheck(); toast('Everything deleted. ↶ brings it back.');
}
['pointerup', 'keyup', 'change'].forEach(ev => document.addEventListener(ev, () => setTimeout(historyCheck, 0)));
setInterval(historyCheck, 500);
document.addEventListener('keydown', e => {
  if (!inEditor || isTypingTarget(e) || dialogOpen() || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); editorUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); editorRedo(); }
});


// ---------------------------------------------------------------------------
// Hitbox editor: drag the per-lane boxes on the board
// ---------------------------------------------------------------------------
let hbDrag = null;
function handleHitboxPointer(e) {
  const fx = selectedEffect;
  if (!fx || fx.type !== 'hitbox' || Number(fx.zoneOn) !== 1) return false;
  const { x, y } = boardPoint(e);
  if (x < 0 || x > GW) return false;
  const lane = Math.max(0, Math.min(3, Math.floor(x / laneW)));
  const top = hbVal(fx, lane, 't', 400), h = Math.max(20, hbVal(fx, lane, 'h', 140));
  if (y < top - 8 || y > top + h + 8) return false;
  hbDrag = { lane, mode: y >= top + h - 20 ? 'resize' : 'move', startY: y, top0: top, h0: h };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  return true;
}
canvas.addEventListener('pointermove', e => {
  if (!hbDrag || !selectedEffect) return;
  const { y } = boardPoint(e), dy = y - hbDrag.startY, l = hbDrag.lane;
  const snap = v => Math.round(v / 5) * 5;
  if (hbDrag.mode === 'move') selectedEffect['z' + l + 't'] = Math.max(0, Math.min(GH - hbDrag.h0, snap(hbDrag.top0 + dy)));
  else selectedEffect['z' + l + 'h'] = Math.max(20, Math.min(GH - hbDrag.top0, snap(hbDrag.h0 + dy)));
});
const endHbDrag = () => { if (!hbDrag) return; hbDrag = null; onEffectFieldChanged(); };
canvas.addEventListener('pointerup', endHbDrag);
canvas.addEventListener('pointercancel', endHbDrag);
