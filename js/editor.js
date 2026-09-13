// ============================================================================
// editor.js — everything about building a level.
//
// Layout notes (this is the part that answers "the timeline is in the way"
// and "make the editor smoother/cleaner"):
//   - The always-on floating panels from the old editor are gone. Tools now
//     live in a slide-out left drawer, and effect inspection in a slide-out
//     right drawer — both closed by default, opened with one tap, and they
//     never sit on top of the canvas.
//   - The timeline is docked to the true bottom edge of the screen (not
//     floating mid-canvas) and can be collapsed to a 34px strip by tapping
//     its grip handle, so it's never in the way of placing tiles.
// ============================================================================

const EFFECT_STUDIO_PPS = 80; // px/sec in the full effects-studio timeline
const TRACK_ROWS = ['visual', 'speed', 'image', 'audio'];
const EFFECT_COLORS = { pulse: '#ff2e88', tile_style: '#00f0ff', speed: '#ffc93c', image: '#9d4edd', extra_image: '#b34dff', sfx: '#37b6ff' };

// ---------------------------------------------------------------------------
// Grid / snapping
// ---------------------------------------------------------------------------

function getSnappedEditorTime(time, bypassSnap = false) {
  const raw = Math.max(0, Number(time) || 0);
  if (bypassSnap) return raw;
  const step = getEditorGridStep();
  return Math.max(0, Math.round(raw / step) * step);
}

function setEditorGrid(division) {
  editorGridDivision = [2, 4, 8, 12].includes(Number(division)) ? Number(division) : 2;
  document.querySelectorAll('.grid-btn').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.grid) === editorGridDivision));
  const readout = document.getElementById('grid-readout');
  if (readout) readout.textContent = getEditorGridStep().toFixed(3) + 's';
  refreshEditorTimeline();
}

function tileAlreadyAt(lane, time) {
  const epsilon = getEditorGridStep() * 0.25;
  return recordedTiles.some(t => t.lane === lane && Math.abs(t.time - time) < epsilon);
}

function placeTileAtPlayhead(lane, bypassSnap = false) {
  // Hold tiles are disabled for now — every placed tile is a plain instant tap.
  const snapped = getSnappedEditorTime(editorTimer, bypassSnap);
  editorTimer = snapped;
  if (tileAlreadyAt(lane, snapped)) return;
  const t = { lane, time: snapped, isHold: false, holdDuration: 0 };
  recordedTiles.push(t);
  recordedTiles.sort((a, b) => a.time - b.time || a.lane - b.lane);
  refreshEditorTimeline();
}

// ---------------------------------------------------------------------------
// Canvas placement / deletion (pointer input owned entirely by the editor)
// ---------------------------------------------------------------------------

function handleCanvasMouseDown(e) {
  if (!inEditor) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;
  const clickedLane = Math.floor(mouseX / laneW);

  if (!deleteMode && mouseY >= 0 && mouseY <= canvas.height) {
    placeTileAtPlayhead(Math.max(0, Math.min(3, clickedLane)), e.shiftKey);
    return;
  }
  if (!deleteMode) return;

  for (let i = recordedTiles.length - 1; i >= 0; i--) {
    let t = recordedTiles[i];
    if (t.lane === clickedLane) {
      let yOffset = (editorTimer - t.time) * EDITOR_PPS;
      let y = lineY + yOffset;
      let holdLen = t.isHold ? (t.holdDuration * EDITOR_PPS) : 0;
      let h = TILE_H + holdLen;
      let drawY = y - holdLen;
      if (mouseY >= drawY && mouseY <= drawY + h) {
        recordedTiles.splice(i, 1);
        editorVisualTiles = editorVisualTiles.filter(vt => vt.ref !== t);
        refreshEditorTimeline();
        break;
      }
    }
  }
}
canvas.addEventListener("mousedown", handleCanvasMouseDown);
canvas.addEventListener("touchstart", (e) => {
  if (!inEditor) return;
  e.preventDefault();
  const t = e.touches[0];
  handleCanvasMouseDown({ clientX: t.clientX, clientY: t.clientY, shiftKey: false });
}, { passive: false });

function recordTileFromKeydown(laneIndex, e) {
  if (editorKeyTimes[laneIndex] !== null) return;
  const snappedTime = getSnappedEditorTime(editorTimer, e.shiftKey);
  editorKeyTimes[laneIndex] = snappedTime;
  let newTile = null;
  if (!tileAlreadyAt(laneIndex, snappedTime)) {
    newTile = { lane: laneIndex, time: snappedTime, isHold: false, holdDuration: 0 };
    recordedTiles.push(newTile);
    recordedTiles.sort((a, b) => a.time - b.time || a.lane - b.lane);
    editorTimer = snappedTime;
    refreshEditorTimeline();
  }
  editorVisualTiles.push({ lane: laneIndex, y: lineY, alpha: 1.0, ref: newTile });
}

function recordTileFromKeyup(laneIndex) {
  // Hold tiles are disabled for now, so key-up doesn't need to do anything —
  // the tile was already placed on key-down as a plain instant tap.
  editorKeyTimes[laneIndex] = null;
}

// ---------------------------------------------------------------------------
// Drawers (left = tools, right = quick inspector)
// ---------------------------------------------------------------------------

function toggleDrawer(side) {
  const other = side === 'left' ? 'right' : 'left';
  const el = document.getElementById('drawer-' + side);
  const otherEl = document.getElementById('drawer-' + other);
  const willOpen = !el.classList.contains('open');
  otherEl.classList.remove('open');
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

function refreshEditorTimeline() {
  const timeEl = document.getElementById('editor-timeline-time');
  const timerPanel = document.getElementById('editor-timer-panel');
  if (timeEl) timeEl.innerText = editorTimer.toFixed(2) + 's';
  if (timerPanel) timerPanel.innerText = editorTimer.toFixed(2) + 's';

  const slider = document.getElementById('timeline-slider');
  let maxT = parseFloat(slider.max) || 60;
  if (bgAudio.duration && bgAudio.duration > maxT) maxT = bgAudio.duration;
  recordedTiles.forEach(t => { if (t.time + 5 > maxT) maxT = t.time + 5; });
  recordedEffects.forEach(e => { if (e.time + 5 > maxT) maxT = e.time + 5; });
  slider.max = maxT;
  slider.value = editorTimer;

  const layer = document.getElementById('editor-marker-layer');
  layer.innerHTML = '';
  recordedTiles.forEach(t => {
    const m = document.createElement('div');
    m.className = 'timeline-marker' + (t.isHold ? ' hold' : '');
    m.style.left = Math.min(100, (t.time / maxT) * 100) + '%';
    layer.appendChild(m);
  });
  recordedEffects.forEach(fx => {
    const m = document.createElement('div');
    m.className = 'timeline-marker fx';
    m.style.left = Math.min(100, (fx.time / maxT) * 100) + '%';
    m.title = effectKindLabel(fx);
    m.onclick = (ev) => { ev.stopPropagation(); selectEffect(fx); toggleDrawer('right'); };
    layer.appendChild(m);
  });

  updateEditorView();
  if (!document.getElementById('effects-menu').classList.contains('hidden')) {
    updateEffectPlayheadDisplays();
    renderEffectTracks();
  }
}

function updateEditorView() {
  const slider = document.getElementById('timeline-slider');
  const maxT = parseFloat(slider.max) || 60;
  const ph = document.getElementById('editor-playhead');
  if (ph) ph.style.left = Math.min(100, (editorTimer / maxT) * 100) + '%';
}

function scrubTimeline(value) {
  editorTimer = parseFloat(value) || 0;
  if (bgAudio.src) bgAudio.currentTime = editorTimer;
  refreshEditorTimeline();
}

function nudgeEditorTime(delta) {
  editorTimer = Math.max(0, editorTimer + delta);
  if (bgAudio.src) bgAudio.currentTime = editorTimer;
  refreshEditorTimeline();
}

function jumpEditorEnd() {
  let maxT = 0;
  recordedTiles.forEach(t => maxT = Math.max(maxT, t.time + (t.holdDuration || 0)));
  recordedEffects.forEach(e => maxT = Math.max(maxT, e.time + (e.duration || 0)));
  if (bgAudio.duration) maxT = Math.max(maxT, bgAudio.duration);
  editorTimer = maxT;
  refreshEditorTimeline();
}

function toggleEditorTransport() {
  editorPlaying = !editorPlaying;
  const btn = document.getElementById('editor-transport-btn');
  if (btn) btn.innerText = editorPlaying ? '⏸' : '▶';
  if (editorPlaying) {
    if (bgAudio.src) { bgAudio.currentTime = editorTimer; bgAudio.play().catch(() => {}); }
    editorInterval = setInterval(() => {
      editorTimer += 0.05;
      refreshEditorTimeline();
    }, 50);
  } else {
    clearInterval(editorInterval);
    bgAudio.pause();
    if (isRecording) {
      isRecording = false;
      document.getElementById('btn-create-tiles')?.classList.remove('active');
    }
  }
}

function toggleTimelineDock() {
  document.getElementById('timeline-dock').classList.toggle('collapsed');
}

// ---------------------------------------------------------------------------
// Effects studio
// ---------------------------------------------------------------------------

function effectKindLabel(fx) {
  return { pulse: 'PULSE', tile_style: 'TILE STYLE', speed: 'SPEED', image: 'IMAGE', extra_image: 'EXTRA IMAGE', sfx: 'SFX' }[fx.type] || fx.type.toUpperCase();
}

function switchEffectCategory(cat) {
  currentEffectCategory = cat;
  ['visual', 'speed', 'image', 'audio'].forEach(c => {
    const el = document.getElementById('effect-library-' + c);
    if (el) el.classList.toggle('hidden', c !== cat);
  });
  document.querySelectorAll('.effect-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick') === `switchEffectCategory('${cat}')`);
  });
}

function openEffectsMenu() {
  document.getElementById('effects-menu').classList.remove('hidden');
  switchEffectCategory(currentEffectCategory);
  renderEffectTimeRuler();
  renderEffectTracks();
  updateEffectPlayheadDisplays();
}
function closeEffectsMenu() {
  document.getElementById('effects-menu').classList.add('hidden');
}

function addPulseEffect() {
  const fx = { type: 'pulse', time: editorTimer, layer: 0, color: '#0055ff', duration: 0.6, inTrans: 0.1, outTrans: 0.3 };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function addTileStyleEffect() {
  const fx = { type: 'tile_style', time: editorTimer, c1: '#00f0ff', c2: '#0055ff', alpha: 1 };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function setSpeedPreset(mult) {
  const presetTargets = { 0.5: 10, 1: 18, 1.5: 26, 2: 34 };
  const target = presetTargets[mult] || Math.round(EDITOR_BASE_SPEED * mult);
  const fx = { type: 'speed', time: editorTimer, target, transDuration: 0.5 };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function addSpeedEffect() {
  const target = parseFloat(document.getElementById('fx-speed-target').value) || 25;
  const trans = parseFloat(document.getElementById('fx-speed-trans').value) || 0.5;
  const fx = { type: 'speed', time: editorTimer, target, transDuration: trans };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function addImageEffect() {
  if (!loadedImageDataUrl) { alert('Choose an image file first.'); return; }
  const fx = {
    type: 'image', time: editorTimer, layer: 0, src: loadedImageDataUrl,
    alpha: parseFloat(document.getElementById('fx-img-alpha').value) || 0.5,
    duration: parseFloat(document.getElementById('fx-img-dur').value) || 2,
    inTrans: parseFloat(document.getElementById('fx-img-in').value) || 0.3,
    outTrans: parseFloat(document.getElementById('fx-img-out').value) || 0.3
  };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function setExtraImagePosition(pos) {
  if (pos === 'center') { pendingExtraX = canvas.width / 2; pendingExtraY = canvas.height / 2; }
  if (pos === 'top') { pendingExtraX = canvas.width / 2; pendingExtraY = 110; }
  if (pos === 'bottom') { pendingExtraX = canvas.width / 2; pendingExtraY = canvas.height - 100; }
}
function addExtraImageEffect() {
  if (!loadedExtraImageDataUrl) { alert('Choose an image file first.'); return; }
  const fx = {
    type: 'extra_image', time: editorTimer, layer: 0, src: loadedExtraImageDataUrl,
    x: pendingExtraX, y: pendingExtraY,
    w: parseFloat(document.getElementById('fx-extra-w').value) || 150,
    h: parseFloat(document.getElementById('fx-extra-h').value) || 150,
    alpha: parseFloat(document.getElementById('fx-extra-alpha').value) || 1,
    duration: parseFloat(document.getElementById('fx-extra-dur').value) || 2
  };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}
function addSfxEffect() {
  if (!loadedSfxDataUrl) { alert('Choose an audio file first.'); return; }
  const fx = { type: 'sfx', time: editorTimer, src: loadedSfxDataUrl };
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx);
}

document.getElementById('fx-img-upload').addEventListener('change', function (e) {
  if (!e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = (ev) => loadedImageDataUrl = ev.target.result;
  reader.readAsDataURL(e.target.files[0]);
});
document.getElementById('fx-extra-upload').addEventListener('change', function (e) {
  if (!e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = (ev) => loadedExtraImageDataUrl = ev.target.result;
  reader.readAsDataURL(e.target.files[0]);
});
document.getElementById('fx-sfx-upload').addEventListener('change', function (e) {
  if (!e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = (ev) => loadedSfxDataUrl = ev.target.result;
  reader.readAsDataURL(e.target.files[0]);
});

// --- selection + shared inspector rendering (drives both the main-editor
// quick drawer and the full effects-studio inspector from one place) ---

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
  renderSelectedEffectPanels();
  renderEffectTracks();
  refreshEditorTimeline();
}
function deleteSelectedEffect() {
  if (!selectedEffect) return;
  recordedEffects = recordedEffects.filter(e => e !== selectedEffect);
  selectedEffect = null;
  renderSelectedEffectPanels();
  renderEffectTracks();
  refreshEditorTimeline();
}
function nudgeSelectedEffect(delta) {
  if (!selectedEffect) return;
  selectedEffect.time = Math.max(0, selectedEffect.time + delta);
  recordedEffects.sort((a, b) => a.time - b.time);
  renderSelectedEffectPanels();
  renderEffectTracks();
  refreshEditorTimeline();
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

function onEffectFieldChanged() {
  renderEffectTracks();
  refreshEditorTimeline();
}

function buildFieldsInto(container, fx) {
  container.innerHTML = '';
  const fields = describeEffectFields(fx);
  if (fields.length === 0) {
    const p = document.createElement('div');
    p.style.cssText = 'font-size:11px;color:var(--text-low);';
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
  if (bgAudio.duration) maxT = Math.max(maxT, bgAudio.duration);
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
    tick.style.cssText = `position:absolute; left:${s * EFFECT_STUDIO_PPS}px; top:0; bottom:0; width:1px; background:var(--border-soft);`;
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
  if (fx.type === 'image' || fx.type === 'extra_image') return 2;
  return 3;
}

function attachBlockDrag(block, fx) {
  block.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    selectEffect(fx);
    const startX = e.clientX; const startTime = fx.time;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      let newTime = startTime + dx / EFFECT_STUDIO_PPS;
      if (!ev.shiftKey) newTime = Math.round(newTime / getEditorGridStep()) * getEditorGridStep();
      fx.time = Math.max(0, newTime);
      block.style.left = (fx.time * EFFECT_STUDIO_PPS) + 'px';
      updateEffectPlayheadDisplays();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      recordedEffects.sort((a, b) => a.time - b.time);
      renderSelectedEffectPanels();
      refreshEditorTimeline();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
function attachBlockResize(handle, fx, block) {
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    selectEffect(fx);
    const startX = e.clientX; const startDur = fx.duration || 0.4;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      let newDur = Math.max(0.1, startDur + dx / EFFECT_STUDIO_PPS);
      fx.duration = newDur;
      block.style.width = Math.max(18, newDur * EFFECT_STUDIO_PPS) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      renderSelectedEffectPanels();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('.effect-block')) return;
      const rect = tracksEl.getBoundingClientRect();
      const x = e.clientX - rect.left + wrap.scrollLeft;
      editorTimer = Math.max(0, x / EFFECT_STUDIO_PPS);
      updateEffectPlayheadDisplays();
      refreshEditorTimeline();
    });
  }
}
