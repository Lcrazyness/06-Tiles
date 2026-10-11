// ============================================================================
// editor.js — the level creator.
//
//   TILES    place / select / drag tiles, give them a style (preset) and groups
//   DECOR    click an object in the palette -> it appears in the middle of the screen
//            (squares, triangles, circles, glow, images, text) -> move / scale / rotate it
//   TRIGGERS move / rotate / scale / alpha / colour / toggle / pulse / shake / zoom /
//            lane flip / speed / hitbox / sound — each fires at its time
//
// Group ids: tile #N (time order) is group N automatically, objects are group 10000+id,
// your own groups should use 20001+ (the "New group" button picks one).
// ============================================================================

const TRIG_DEFS = {
  move: { icon: '⇄', label: 'Move', tip: 'Slide a group by X / Y', def: { target: 0, dx: 60, dy: 0, dur: 1, ease: 'out' } },
  rotate: { icon: '⟳', label: 'Rotate', tip: 'Spin a group', def: { target: 0, deg: 90, dur: 1, ease: 'out' } },
  scale: { icon: '⤢', label: 'Scale', tip: 'Grow / shrink a group', def: { target: 0, sc: 1.5, dur: 0.5, ease: 'out' } },
  alpha: { icon: '◐', label: 'Transparent', tip: 'Fade a group in / out', def: { target: 0, a: 0.3, dur: 0.5, ease: 'linear' } },
  color: { icon: '🎨', label: 'Color', tip: 'Tint a group or the background', def: { what: 'group', target: 0, color: '#ff2e88', dur: 0.5, ease: 'linear' } },
  toggle: { icon: '👁', label: 'Toggle', tip: 'Show / hide a group', def: { target: 0, on: 0 } },
  pulse: { icon: '✦', label: 'Pulse', tip: 'Flash the screen', def: { layer: 0, color: '#0055ff', duration: 0.6, inTrans: 0.1, outTrans: 0.3 } },
  shake: { icon: '≋', label: 'Shake', tip: 'Shake the camera', def: { strength: 10, dur: 0.5 } },
  zoom: { icon: '🔍', label: 'Camera zoom', tip: 'Zoom the whole board', def: { zoom: 1.25, dur: 0.6, ease: 'inout' } },
  laneflip: { icon: '↔', label: 'Lane flip', tip: 'Mirror the lanes from here', def: { on: 1 } },
  speed: { icon: '⏩', label: 'Speed', tip: 'Change tile speed', def: { target: 25, transDuration: 0.5 } },
  hitbox: { icon: '▭', label: 'Hitbox', tip: 'Per-lane input boxes', def: { zoneOn: 1, z0t: 400, z0h: 140, z1t: 400, z1h: 140, z2t: 400, z2h: 140, z3t: 400, z3h: 140 } },
  sfx: { icon: '🔊', label: 'Audio', tip: 'Play a sound', def: { src: '', vol: 1, rate: 1 } },
  // older levels: still play, still editable
  tile_style: { icon: '▦', label: 'Tile colors (old)', def: { c1: '#00f0ff', c2: '#0055ff', alpha: 1 }, hidden: true },
  tilemove: { icon: '⇆', label: 'Tile sway (old)', def: {}, hidden: true }, tilehide: { icon: '◌', label: 'Tile hide (old)', def: {}, hidden: true },
  image: { icon: '🖼', label: 'Image (old)', def: {}, hidden: true }, extra_image: { icon: '🖼', label: 'Image (old)', def: {}, hidden: true }, video: { icon: '🎬', label: 'Video', def: { url: '', layer: 0, alpha: 0.6, duration: 5, loop: 1 }, hidden: true }
};
const TRIG_COLORS = { move: '#37b6ff', rotate: '#9d4edd', scale: '#7cff6b', alpha: '#aaaaaa', color: '#ff2e88', toggle: '#ffc93c', pulse: '#ff2e88', shake: '#ff8a3d', zoom: '#00f0ff', laneflip: '#ff5f5f', speed: '#ffc93c', hitbox: '#00f0ff', sfx: '#37b6ff' };

let edMode = 'tiles', edTool = 'place';
let edSelTiles = new Set(), edSelObjs = new Set();
let edClip = null, edPreset = -1, edNextObjId = 1, edVersion = 0, edDrag = null, edBox = null;
let edHoldNew = false, currentSongId = null, currentDescription = '';
const edShow = { tiles: true, decor: true, fx: true };
let edSyncKey = '';

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
function updateSnapButton() {
  const btn = document.getElementById('btn-snap');
  if (btn) { btn.classList.toggle('active', editorSnapEnabled); btn.textContent = editorSnapEnabled ? '🧲 Snap: beat' : '🧲 Snap: free'; }
}
function toggleEditorSnap() { editorSnapEnabled = !editorSnapEnabled; updateSnapButton(); }
function onBpmChanged(value) {
  const bpm = Number(value);
  if (!Number.isFinite(bpm)) return;
  editorBpm = Math.max(30, Math.min(maxBpm, bpm));
  updateGridReadout();
}
function onGridOffsetChanged(value) { const off = Number(value); editorGridOffset = Number.isFinite(off) ? Math.max(-5, Math.min(5, off)) : 0; }
function setEditorZoom(delta) {
  editorZoom = Math.max(0.25, Math.min(1.5, Math.round((editorZoom + delta) * 100) / 100));
  const el = document.getElementById('zoom-readout');
  if (el) el.textContent = Math.round(editorZoom * 100) + '%';
}
function edSortTiles() { recordedTiles.sort((a, b) => a.time - b.time || a.lane - b.lane); }
function edDedupeTiles() {
  const seen = new Set();
  recordedTiles = recordedTiles.filter(t => { const k = t.lane + '@' + Math.round(t.time * 1000); if (seen.has(k)) { edSelTiles.delete(t); return false; } seen.add(k); return true; });
  edSortTiles();
}
function snapAllTiles() {
  if (!recordedTiles.length) return;
  const targets = edSelTiles.size ? [...edSelTiles] : recordedTiles;
  let moved = 0;
  targets.forEach(t => { const s = snapTime(t.time, false); if (Math.abs(s - t.time) > 0.0005) moved++; t.time = s; });
  edDedupeTiles(); edChanged();
  toast(moved ? 'Snapped ' + moved + ' tile' + (moved === 1 ? '' : 's') + ' to the grid.' : 'Everything was already on the grid.');
}
function tileAlreadyAt(lane, time) {
  const epsilon = Math.min(0.02, getEditorGridStep() * 0.25);
  return recordedTiles.some(t => t.lane === lane && Math.abs(t.time - time) < epsilon);
}
function addTile(lane, time) {
  if (tileAlreadyAt(lane, time)) return null;
  const t = { lane, time, isHold: edHoldNew, holdDuration: edHoldNew ? Math.max(getEditorGridStep(), 0.5) : 0 };
  if (edPreset >= 0) t.preset = edPreset;
  recordedTiles.push(t); edSortTiles();
  edChanged();
  return t;
}
// any edit: invalidate verification, redraw timeline + inspector bits
function edChanged(skipInspector) {
  levelVerified = false; edVersion++;
  refreshEditorTimeline();
  const c = document.getElementById('ed-count'); if (c) c.textContent = recordedTiles.length + ' tiles';
  if (!skipInspector) renderInspector();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function boardPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) / rect.width) * GW, y: ((e.clientY - rect.top) / rect.height) * GH };
}
const edTileH = () => TILE_H * editorZoom;
function tileRect(t) {
  const pps = getEditorPPS(), bottom = lineY + (editorTimer - t.time) * pps, hold = t.isHold ? t.holdDuration * pps : 0;
  return { x: t.lane * laneW + 3, w: laneW - 6, top: bottom - edTileH() - hold, h: edTileH() + hold, bottom };
}
function hitTile(x, y) {
  let best = null;
  for (let i = recordedTiles.length - 1; i >= 0; i--) {
    const t = recordedTiles[i], r = tileRect(t);
    if (x >= r.x && x <= r.x + r.w && y >= r.top && y <= r.top + r.h) { best = t; break; }
  }
  return best;
}
function tileTimeAt(y) { return editorTimer - (y - lineY) / getEditorPPS() - (edTileH() * 0.5) / getEditorPPS(); }
function objState(o) { return decorCombined(objGroups(o)); }
function objLocal(o, x, y) {   // board point -> object-local coordinates
  const st = objState(o), b = decorObjectBounds(o);
  let px = x - (o.x + st.dx), py = y - (o.y + st.dy);
  const a = -((o.rot || 0) + st.rot) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = (px * c - py * s) / st.sc, ly = (px * s + py * c) / st.sc;
  return { x: lx, y: ly, w: b.w, h: b.h };
}
function hitObject(x, y) {
  const list = decorData.objects.filter(o => !o.hidden && !o.locked).sort((a, b) => ((b.layer === 'fg') - (a.layer === 'fg')) || (b.z || 0) - (a.z || 0) || b.id - a.id);
  for (const o of list) { const l = objLocal(o, x, y); if (Math.abs(l.x) <= l.w / 2 + 4 && Math.abs(l.y) <= l.h / 2 + 4) return o; }
  return null;
}
function objHandles(o) {   // screen positions of scale handle + rotate knob
  const st = objState(o), b = decorObjectBounds(o), a = ((o.rot || 0) + st.rot) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const tr = (lx, ly) => ({ x: o.x + st.dx + (lx * st.sc) * c - (ly * st.sc) * s, y: o.y + st.dy + (lx * st.sc) * s + (ly * st.sc) * c });
  return { scale: tr(b.w / 2, b.h / 2), rotate: tr(0, -b.h / 2 - 26), center: tr(0, 0) };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function edClearSel() { edSelTiles.clear(); edSelObjs.clear(); selectedEffect = null; }
function edSelCount() { return edSelTiles.size + edSelObjs.size + (selectedEffect ? 1 : 0); }
function edSelectionChanged(open) { renderInspector(); renderPalette(true); refreshEditorTimeline(); if (open && window.innerWidth < 1000) openDrawer('right'); }
function edSelectTile(t, add) { if (!add) { edClearSel(); } if (edSelTiles.has(t) && add) edSelTiles.delete(t); else edSelTiles.add(t); edSelectionChanged(); }
function edSelectObj(o, add, open) { if (!add) edClearSel(); if (edSelObjs.has(o) && add) edSelObjs.delete(o); else edSelObjs.add(o); edSelectionChanged(open); }
function selectEffect(fx, open) { edClearSel(); selectedEffect = fx; if (fx) setEdMode('trig', true); edSelectionChanged(open); }
function edSelectAll() {
  edClearSel();
  if (edMode === 'tiles') recordedTiles.forEach(t => edSelTiles.add(t));
  else if (edMode === 'decor') decorData.objects.forEach(o => { if (!o.locked) edSelObjs.add(o); });
  edSelectionChanged();
}
function edSelectFrom() {
  edClearSel();
  if (edMode === 'decor') decorData.objects.forEach(o => { if (o.time >= editorTimer - 1e-6) edSelObjs.add(o); });
  else recordedTiles.forEach(t => { if (t.time >= editorTimer - 1e-6) edSelTiles.add(t); });
  edSelectionChanged();
}

// ---------------------------------------------------------------------------
// Board pointer input (called from game.js when inEditor)
// ---------------------------------------------------------------------------
function handleEditorPointer(e) {
  if (!inEditor) return;
  e.preventDefault();
  if (handleHitboxPointer(e)) return;
  const { x, y } = boardPoint(e);
  if (x < -40 || x > GW + 40 || y < -40 || y > GH + 40) return;
  const shift = e.shiftKey || e.ctrlKey || e.metaKey;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}

  // handles of the single selected object
  if (edSelObjs.size === 1 && edShow.decor) {
    const o = [...edSelObjs][0], h = objHandles(o);
    if (Math.hypot(x - h.rotate.x, y - h.rotate.y) < 14) { edDrag = { type: 'rotate', o, r0: o.rot || 0 }; return; }
    if (Math.hypot(x - h.scale.x, y - h.scale.y) < 14) { const b = decorObjectBounds(o); edDrag = { type: 'scale', o, w0: o.w, h0: o.h, size0: o.size, d0: Math.hypot(x - h.center.x, y - h.center.y) || 1, ratio: b.w / Math.max(1, b.h) }; return; }
  }
  if (edTool === 'erase') {
    const o = edMode !== 'tiles' && edShow.decor ? hitObject(x, y) : null;
    if (o) { decorData.objects = decorData.objects.filter(q => q !== o); edSelObjs.delete(o); edChanged(); return; }
    const t = edShow.tiles ? hitTile(x, y) : null;
    if (t) { recordedTiles = recordedTiles.filter(q => q !== t); edSelTiles.delete(t); edChanged(); }
    return;
  }
  if (edMode === 'decor' || (edTool === 'select' && edMode !== 'tiles')) {
    const o = edShow.decor ? hitObject(x, y) : null;
    if (o) {
      if (!edSelObjs.has(o)) edSelectObj(o, shift);
      edDrag = { type: 'moveObjs', sx: x, sy: y, orig: [...edSelObjs].map(q => [q, q.x, q.y]) };
      return;
    }
  }
  if (edMode === 'tiles' || edTool === 'select') {
    const t = edShow.tiles && edMode !== 'trig' ? hitTile(x, y) : null;
    if (t) {
      if (!edSelTiles.has(t)) edSelectTile(t, shift);
      edDrag = { type: 'moveTiles', sx: x, sy: y, anchor: t, t0: t.time, orig: [...edSelTiles].map(q => [q, q.lane, q.time]) };
      return;
    }
  }
  // empty space
  if (edTool === 'select' || edMode !== 'tiles') { if (!shift) { edClearSel(); edSelectionChanged(); } edBox = { x0: x, y0: y, x1: x, y1: y, add: shift }; edDrag = { type: 'box' }; return; }
  // tiles + place tool: drop a tile where tapped
  const lane = Math.max(0, Math.min(3, Math.floor(x / laneW)));
  if (edSelCount()) { edClearSel(); edSelectionChanged(); }
  addTile(lane, snapTime(tileTimeAt(y), e.shiftKey));
}
canvas.addEventListener('pointermove', e => {
  if (!edDrag || !inEditor) return;
  const { x, y } = boardPoint(e);
  if (edDrag.type === 'box') { edBox.x1 = x; edBox.y1 = y; return; }
  if (edDrag.type === 'moveObjs') {
    const dx = x - edDrag.sx, dy = y - edDrag.sy;
    edDrag.orig.forEach(([o, ox, oy]) => { o.x = Math.round((ox + dx) * 2) / 2; o.y = Math.round((oy + dy) * 2) / 2; });
    edDrag.moved = true; return;
  }
  if (edDrag.type === 'moveTiles') {
    const free = e.shiftKey;
    const anchorLane = edDrag.orig.find(a => a[0] === edDrag.anchor)[1];
    let dl = Math.floor(x / laneW) - anchorLane;
    const minL = Math.min(...edDrag.orig.map(a => a[1])), maxL = Math.max(...edDrag.orig.map(a => a[1]));
    dl = Math.max(-minL, Math.min(3 - maxL, dl));
    const want = edDrag.t0 + ((edDrag.sy - y) / getEditorPPS());
    let dt = snapTime(Math.max(0, want), free) - edDrag.t0;
    const minT = Math.min(...edDrag.orig.map(a => a[2]));
    if (minT + dt < 0) dt = -minT;
    edDrag.orig.forEach(([t, l, tm]) => { t.lane = l + dl; t.time = Math.round((tm + dt) * 1000) / 1000; });
    edDrag.moved = true; return;
  }
  if (edDrag.type === 'rotate') {
    const h = objHandles(edDrag.o).center; let a = Math.atan2(y - h.y, x - h.x) * 180 / Math.PI + 90;
    if (!e.shiftKey) a = Math.round(a / 5) * 5;
    edDrag.o.rot = Math.round(a * 10) / 10; return;
  }
  if (edDrag.type === 'scale') {
    const o = edDrag.o, c = objHandles(o).center, f = Math.max(0.05, (Math.hypot(x - c.x, y - c.y)) / edDrag.d0);
    if (o.kind === 'text') o.size = Math.max(6, Math.min(400, Math.round(edDrag.size0 * f)));
    else { o.w = Math.max(2, Math.round(edDrag.w0 * f)); o.h = e.shiftKey ? o.h : Math.max(2, Math.round(edDrag.h0 * f)); }
  }
});
function endEdDrag() {
  if (!edDrag) return;
  const d = edDrag; edDrag = null;
  if (d.type === 'box' && edBox) {
    const b = edBox; edBox = null;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    if (!b.add) { edSelTiles.clear(); edSelObjs.clear(); }
    if (edMode === 'tiles' || (edMode !== 'decor' && edTool === 'select')) recordedTiles.forEach(t => { const r = tileRect(t); if (r.x < x1 && r.x + r.w > x0 && r.top < y1 && r.top + r.h > y0) edSelTiles.add(t); });
    if (edMode === 'decor') decorData.objects.forEach(o => { if (!o.hidden && !o.locked && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) edSelObjs.add(o); });
    edSelectionChanged(); return;
  }
  if (d.type === 'moveTiles') { if (d.moved) { edDedupeTiles(); edChanged(); } return; }
  edChanged();
}
canvas.addEventListener('pointerup', endEdDrag);
canvas.addEventListener('pointercancel', endEdDrag);

function recordTileFromKeydown(laneIndex, e) {
  if (editorKeyTimes[laneIndex] !== null) return;
  const t = snapTime(editorTimer, e.shiftKey);
  editorKeyTimes[laneIndex] = t;
  addTile(laneIndex, t);
  editorVisualTiles.push({ lane: laneIndex, alpha: 1.0 });
}
function recordTileFromKeyup(laneIndex) { editorKeyTimes[laneIndex] = null; }

canvas.addEventListener('wheel', (e) => { if (!inEditor) return; e.preventDefault(); stepEditorTime(e.deltaY < 0 ? 1 : -1); }, { passive: false });
function stepEditorTime(dir) {
  const step = getEditorGridStep();
  const idx = Math.round((editorTimer - editorGridOffset) / step) + dir;
  setEditorTime(Math.max(0, idx * step + editorGridOffset));
}

// ---------------------------------------------------------------------------
// Keyboard: arrows move the selection (or the playhead), Delete, copy / paste / duplicate / select all
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (!inEditor || isTypingTarget(e) || dialogOpen()) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key;
  if (ctrl) {
    const l = k.toLowerCase();
    if (l === 'c') { e.preventDefault(); edCopy(); } else if (l === 'x') { e.preventDefault(); edCopy(); edDeleteSelection(); }
    else if (l === 'v') { e.preventDefault(); edPaste(1); } else if (l === 'd') { e.preventDefault(); edDuplicate(); }
    else if (l === 'a') { e.preventDefault(); edSelectAll(); }
    return;
  }
  if (k === 'Delete' || k === 'Backspace') { if (edSelCount()) { e.preventDefault(); edDeleteSelection(); } return; }
  if (k === 'Escape') { if (edSelCount()) { edClearSel(); edSelectionChanged(); } return; }
  if (k === 'Enter' && !isRecording) { e.preventDefault(); toggleEditorTransport(); return; }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  if (edSelCount()) {
    const gridStep = getEditorGridStep();
    if (edSelTiles.size) {
      if (k === 'ArrowLeft' || k === 'ArrowRight') { const d = k === 'ArrowLeft' ? -1 : 1; if ([...edSelTiles].every(t => t.lane + d >= 0 && t.lane + d <= 3)) edSelTiles.forEach(t => t.lane += d); }
      else { const d = (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.01 : gridStep); const mn = Math.min(...[...edSelTiles].map(t => t.time)); edSelTiles.forEach(t => t.time = Math.max(0, Math.round((t.time + Math.max(d, -mn)) * 1000) / 1000)); }
      edDedupeTiles();
    }
    if (edSelObjs.size) edSelObjs.forEach(o => { if (k === 'ArrowLeft') o.x -= step; else if (k === 'ArrowRight') o.x += step; else if (k === 'ArrowUp') o.y -= step; else o.y += step; });
    if (selectedEffect) { const d = (k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.01 : gridStep); selectedEffect.time = Math.max(0, Math.round((selectedEffect.time + d) * 1000) / 1000); recordedEffects.sort((a, b) => a.time - b.time); }
    edChanged();
  } else if (k === 'ArrowUp') stepEditorTime(1); else if (k === 'ArrowDown') stepEditorTime(-1);
});

function edDeleteSelection() {
  if (edSelTiles.size) recordedTiles = recordedTiles.filter(t => !edSelTiles.has(t));
  if (edSelObjs.size) decorData.objects = decorData.objects.filter(o => !edSelObjs.has(o));
  if (selectedEffect) recordedEffects = recordedEffects.filter(f => f !== selectedEffect);
  edClearSel(); edChanged(); edSelectionChanged();
}
const clone = o => JSON.parse(JSON.stringify(o));
function edCopy() {
  if (!edSelCount()) { toast('Select something first (Select tool: drag a box).'); return; }
  const tiles = [...edSelTiles].map(clone), objs = [...edSelObjs].map(clone), fx = selectedEffect ? [clone(selectedEffect)] : [];
  const times = [...tiles.map(t => t.time), ...objs.map(o => o.time), ...fx.map(f => f.time)];
  const t0 = Math.min(...times), t1 = Math.max(...tiles.map(t => t.time + (t.isHold ? t.holdDuration : 0)), ...objs.map(o => o.time), ...fx.map(f => f.time));
  edClip = { tiles, objs, fx, t0, len: Math.max(0, t1 - t0) };
  toast('Copied ' + (tiles.length + objs.length + fx.length) + ' item(s). Paste puts them at the playhead — paste again to chain.', 'good');
}
function edPaste(count) {
  if (!edClip) { toast('Nothing copied yet.'); return; }
  const step = getEditorGridStep(), spacing = Math.max(step, Math.ceil((edClip.len + 1e-6) / step) * step);
  let base = snapTime(editorTimer, false);
  edClearSel();
  for (let i = 0; i < count; i++) {
    const off = base - edClip.t0;
    edClip.tiles.forEach(t => { const n = clone(t); n.time = Math.round((t.time + off) * 1000) / 1000; recordedTiles.push(n); edSelTiles.add(n); });
    edClip.objs.forEach(o => { const n = clone(o); n.id = edNextObjId++; n.time = Math.round((o.time + off) * 1000) / 1000; decorData.objects.push(n); edSelObjs.add(n); });
    edClip.fx.forEach(f => { const n = clone(f); n.time = Math.round((f.time + off) * 1000) / 1000; recordedEffects.push(n); });
    base += spacing;
  }
  recordedEffects.sort((a, b) => a.time - b.time);
  edDedupeTiles();
  setEditorTime(base);   // next paste lands right after this one
  edChanged(); edSelectionChanged();
}
async function edPasteMany() {
  if (!edClip) { toast('Copy something first.'); return; }
  const r = await openFormDialog({ title: 'Paste several times', message: 'Each copy is placed right after the previous one.', fields: [{ id: 'n', label: 'How many copies', type: 'number', value: '4' }], okText: 'Paste' });
  if (r) edPaste(Math.max(1, Math.min(200, parseInt(r.n) || 1)));
}
function edDuplicate() { if (!edSelCount()) return; edCopy(); edPaste(1); }

// ---------------------------------------------------------------------------
// Mode / tool switching + eye toggles
// ---------------------------------------------------------------------------
function setEdMode(m, quiet) {
  edMode = m;
  document.querySelectorAll('.ed-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m !== 'tiles' && edTool === 'place') { /* place tool means "add where tapped" only in tiles mode */ }
  renderPalette();
  if (!quiet) { if (window.innerWidth < 1000) openDrawer('left'); }
  updateToolButtons();
}
function setEdTool(t) { edTool = t; deleteMode = t === 'erase'; canvas.classList.toggle('delete-cursor', deleteMode); updateToolButtons(); }
function updateToolButtons() {
  ['place', 'select', 'erase'].forEach(t => { const b = document.getElementById('tool-' + t); if (b) b.classList.toggle('active', edTool === t); });
  const p = document.getElementById('tool-place'); if (p) p.textContent = edMode === 'tiles' ? '✚ Place' : '☝ Move';
  ['tiles', 'decor', 'fx'].forEach(k => { const b = document.getElementById('eye-' + k); if (b) { b.classList.toggle('active', edShow[k]); b.classList.toggle('off', !edShow[k]); } });
}
function toggleEye(k) { edShow[k] = !edShow[k]; updateToolButtons(); refreshEditorTimeline(); }

// ---------------------------------------------------------------------------
// Drawers
// ---------------------------------------------------------------------------
function openDrawer(side) { const other = side === 'left' ? 'right' : 'left'; document.getElementById('drawer-' + other).classList.remove('open'); document.getElementById('drawer-' + side).classList.add('open'); updateDrawerBackdrop(); }
function toggleDrawer(side) {
  const el = document.getElementById('drawer-' + side);
  if (el.classList.contains('open')) { el.classList.remove('open'); updateDrawerBackdrop(); } else openDrawer(side);
}
function closeAllDrawers() { document.getElementById('drawer-left').classList.remove('open'); document.getElementById('drawer-right').classList.remove('open'); updateDrawerBackdrop(); }
function updateDrawerBackdrop() {
  const anyOpen = document.getElementById('drawer-left').classList.contains('open') || document.getElementById('drawer-right').classList.contains('open');
  document.getElementById('drawer-backdrop').classList.toggle('show', anyOpen);
}

// ---------------------------------------------------------------------------
// Small DOM helpers for panels
// ---------------------------------------------------------------------------
function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; }
function sectionTitle(parent, text) { parent.appendChild(el('div', 'tool-drawer-label', escapeHtml(text))); }
function btn(parent, text, fn, cls) { const b = el('button', 'btn small ' + (cls || 'btn-ghost'), text); b.onclick = fn; parent.appendChild(b); return b; }
// generic property row: def = {label,key,kind,min,max,step,options,hint}; holder = the object being edited
function propRow(parent, def, holder, onChange) {
  const row = el('div', 'inspector-field');
  row.appendChild(el('label', '', escapeHtml(def.label)));
  const set = v => { holder[def.key] = v; (onChange || (() => edChanged(true)))(); };
  let input;
  if (def.kind === 'color') { input = el('input'); input.type = 'color'; input.value = holder[def.key] || def.empty || '#ffffff'; input.oninput = () => set(input.value); }
  else if (def.kind === 'text') { input = el('input'); input.type = 'text'; input.maxLength = def.max || 80; input.value = holder[def.key] || ''; input.oninput = () => set(input.value); }
  else if (def.kind === 'check') { input = el('input'); input.type = 'checkbox'; input.checked = !!holder[def.key]; input.onchange = () => set(input.checked); }
  else if (def.kind === 'select') {
    input = el('select');
    def.options.forEach(o => { const op = el('option', '', escapeHtml(o.l)); op.value = o.v; if (String(holder[def.key]) === String(o.v)) op.selected = true; input.appendChild(op); });
    input.onchange = () => { const raw = input.value; set(def.str ? raw : (isNaN(Number(raw)) ? raw : Number(raw))); if (def.rebuild) renderInspector(); };
  } else {
    input = el('input'); input.type = 'number';
    if (def.step !== undefined) input.step = def.step; if (def.min !== undefined) input.min = def.min; if (def.max !== undefined) input.max = def.max;
    input.value = holder[def.key] === undefined ? '' : Math.round(holder[def.key] * 1000) / 1000;
    input.oninput = () => { let v = parseFloat(input.value); if (!Number.isFinite(v)) v = def.def !== undefined ? def.def : 0; if (def.min !== undefined) v = Math.max(def.min, v); if (def.max !== undefined) v = Math.min(def.max, v); set(v); };
  }
  row.appendChild(input);
  parent.appendChild(row);
  if (def.hint) parent.appendChild(el('div', 'muted-note', escapeHtml(def.hint)));
  return input;
}

// ---------------------------------------------------------------------------
// Palette (left drawer)
// ---------------------------------------------------------------------------
function renderPalette(light) {
  const host = document.getElementById('ed-palette'); if (!host) return;
  host.innerHTML = '';
  const title = document.getElementById('ed-palette-title');
  if (title) title.textContent = edMode === 'tiles' ? 'TILES' : edMode === 'decor' ? 'DECOR' : 'TRIGGERS';
  if (edMode === 'tiles') {
    sectionTitle(host, 'TILE STYLE  (applied to new tiles)');
    const list = el('div', 'preset-list');
    const mk = (idx, name, p) => {
      const b = el('button', 'preset-item' + (edPreset === idx ? ' active' : ''));
      const sw = el('span', 'preset-swatch'); if (p) { sw.style.background = p.style === 'gradient' || p.style === 'glass' ? 'linear-gradient(' + p.color2 + ',' + p.color + ')' : p.color; sw.style.border = '2px solid ' + (p.borderColor || '#fff'); sw.style.borderRadius = Math.min(10, p.radius / 2) + 'px'; if (p.glow) sw.style.boxShadow = '0 0 8px ' + p.borderColor; } else sw.style.background = '#111';
      b.appendChild(sw); b.appendChild(el('span', 'preset-name', escapeHtml(name)));
      b.onclick = () => { edPreset = idx; renderPalette(); };
      list.appendChild(b);
    };
    mk(-1, 'Classic (default)', null);
    decorData.presets.forEach((p, i) => mk(i, p.name || 'Style ' + (i + 1), p));
    host.appendChild(list);
    const row = el('div', 'btn-row'); host.appendChild(row);
    btn(row, '＋ New style', () => editPreset(-1), 'btn-play');
    if (edPreset >= 0) { btn(row, '✎ Edit', () => editPreset(edPreset)); btn(row, '🗑', async () => { if (await uiConfirm('Delete this tile style? Tiles using it go back to the classic look.', 'Delete', true)) deletePreset(edPreset); }, 'btn-danger'); }
    if (edSelTiles.size) {
      const r2 = el('div', 'btn-row'); host.appendChild(r2);
      btn(r2, 'Apply style to ' + edSelTiles.size + ' selected', () => { edSelTiles.forEach(t => { if (edPreset >= 0) t.preset = edPreset; else delete t.preset; }); edChanged(); });
    }
    sectionTitle(host, 'PLACEMENT');
    const hold = el('label', 'switch-container', '<span>New tiles are holds</span>'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = edHoldNew; ck.onchange = () => { edHoldNew = ck.checked; }; hold.appendChild(ck); host.appendChild(hold);
    const g = el('div', 'tool-grid'); host.appendChild(g);
    const tb = (icon, text, fn, id) => { const b = el('button', 'tool-btn', '<span class="tool-icon">' + icon + '</span>' + text); if (id) b.id = id; b.onclick = fn; g.appendChild(b); };
    tb('⏺', 'Record', toggleRecording, 'btn-create-tiles'); tb('🧲', 'Snap all', snapAllTiles); tb('⏭', 'To end', jumpEditorEnd); tb('☑', 'Select from playhead', edSelectFrom);
    host.appendChild(el('div', 'note', 'Tap the board to place a tile where you tap. Tap a tile to select it, drag to move it. <b>Select</b> tool = drag a box. Tile #N always has group id N (shown on selected tiles).'));
    sectionTitle(host, 'GROUPS');
    const gr = el('div', 'btn-row'); host.appendChild(gr);
    btn(gr, '＋ New group from selection', edNewGroupFromSelection);
  } else if (edMode === 'decor') {
    sectionTitle(host, 'CLICK TO ADD (appears in the middle of the screen)');
    const g = el('div', 'tool-grid'); host.appendChild(g);
    DECOR_KINDS.forEach(k => { const b = el('button', 'tool-btn', '<span class="tool-icon">' + k.icon + '</span>' + k.label); b.onclick = () => addDecorObject(k.kind); g.appendChild(b); });
    sectionTitle(host, 'LAYERS (top = in front)');
    const lay = el('div', 'layer-list'); host.appendChild(lay);
    const sorted = decorData.objects.slice().sort((a, b) => ((b.layer === 'fg') - (a.layer === 'fg')) || (b.z || 0) - (a.z || 0) || b.id - a.id);
    if (!sorted.length) lay.appendChild(el('div', 'muted-note', 'No objects yet.'));
    sorted.forEach(o => {
      const r = el('div', 'layer-item' + (edSelObjs.has(o) ? ' sel' : ''));
      r.appendChild(el('span', 'layer-name', (DECOR_KINDS.find(k => k.kind === o.kind) || {}).icon + ' ' + escapeHtml(o.name || o.kind + ' ' + o.id) + ' <small>' + (o.layer === 'fg' ? 'FG' : 'BG') + '</small>'));
      const eye = el('button', 'mini-btn', o.hidden ? '🚫' : '👁'); eye.onclick = ev => { ev.stopPropagation(); o.hidden = !o.hidden; edChanged(true); renderPalette(); }; r.appendChild(eye);
      const lock = el('button', 'mini-btn', o.locked ? '🔒' : '🔓'); lock.onclick = ev => { ev.stopPropagation(); o.locked = !o.locked; edChanged(true); renderPalette(); }; r.appendChild(lock);
      const up = el('button', 'mini-btn', '▲'); up.onclick = ev => { ev.stopPropagation(); o.z = (o.z || 0) + 1; edChanged(true); renderPalette(); }; r.appendChild(up);
      const dn = el('button', 'mini-btn', '▼'); dn.onclick = ev => { ev.stopPropagation(); o.z = (o.z || 0) - 1; edChanged(true); renderPalette(); }; r.appendChild(dn);
      r.onclick = () => { edSelectObj(o, false, true); setEditorTime(Math.max(editorTimer, o.time)); };
      lay.appendChild(r);
    });
    host.appendChild(el('div', 'note', 'Drag an object to move it · corner dot = scale (Shift = stretch) · top knob = rotate · arrows nudge (Shift = ×10). Tiles draw above BG objects and below FG ones.'));
  } else {
    sectionTitle(host, 'CLICK TO ADD AT THE PLAYHEAD');
    const g = el('div', 'tool-grid'); host.appendChild(g);
    Object.keys(TRIG_DEFS).filter(k => !TRIG_DEFS[k].hidden).forEach(k => { const d = TRIG_DEFS[k]; const b = el('button', 'tool-btn', '<span class="tool-icon">' + d.icon + '</span>' + d.label); b.title = d.tip || ''; b.onclick = () => addTrigger(k); g.appendChild(b); });
    host.appendChild(el('div', 'note', 'Targets: <b>0</b> = everything · <b>tile #N</b> = N · objects are 10000 + their id · or make your own group. Pick a marker on the timeline to edit it.'));
    sectionTitle(host, 'ALL TRIGGERS');
    const lst = el('div', 'layer-list'); host.appendChild(lst);
    if (!recordedEffects.length) lst.appendChild(el('div', 'muted-note', 'None yet.'));
    recordedEffects.forEach(fx => { const d = TRIG_DEFS[fx.type] || { icon: '?', label: fx.type }; const r = el('div', 'layer-item' + (selectedEffect === fx ? ' sel' : ''), '<span class="layer-name">' + d.icon + ' ' + escapeHtml(d.label) + ' <small>' + fx.time.toFixed(2) + 's</small></span>'); r.onclick = () => { selectEffect(fx, true); setEditorTime(fx.time); }; lst.appendChild(r); });
  }
  const tail = el('div', 'tool-drawer-section'); host.appendChild(tail);
  sectionTitle(tail, 'SONG');
  const sg = el('div', 'tool-grid'); tail.appendChild(sg);
  const sb = (icon, text, fn, id) => { const b = el('button', 'tool-btn', '<span class="tool-icon">' + icon + '</span>' + text); if (id) b.id = id; b.onclick = fn; sg.appendChild(b); };
  sb('🎵', 'Load song', () => document.getElementById('audio-upload').click()); sb('📚', 'Song library', pickLibrarySong); sb('🎧', 'Tester', toggleSongTester, 'btn-song-test');
  sb('▶', 'Test from playhead', () => startPlaytest(editorTimer));
  const pt = el('div', 'tool-drawer-section'); host.appendChild(pt);
  sectionTitle(pt, 'PLAYTEST');
  const f1 = el('div', 'field-row', '<label>Starting hearts</label>'); const hearts = el('input'); hearts.type = 'number'; hearts.min = 1; hearts.max = 10; hearts.value = document.getElementById('edit-lives').value; hearts.oninput = () => { document.getElementById('edit-lives').value = hearts.value; }; f1.appendChild(hearts); pt.appendChild(f1);
  const f2 = el('label', 'switch-container', '<span>NoClip</span>'); const nc = el('input'); nc.type = 'checkbox'; nc.checked = document.getElementById('edit-noclip').checked; nc.onchange = () => { document.getElementById('edit-noclip').checked = nc.checked; }; f2.appendChild(nc); pt.appendChild(f2);
}
function edNewGroupFromSelection() {
  if (!edSelTiles.size && !edSelObjs.size) { toast('Select some tiles or objects first.'); return; }
  const used = new Set(); recordedTiles.forEach(t => (t.groups || []).forEach(g => used.add(g))); decorData.objects.forEach(o => (o.groups || []).forEach(g => used.add(g)));
  let id = 20001; while (used.has(id)) id++;
  edSelTiles.forEach(t => { t.groups = (t.groups || []).concat([id]); }); edSelObjs.forEach(o => { o.groups = (o.groups || []).concat([id]); });
  edChanged(); toast('Created group ' + id + ' — target it from a trigger.', 'good');
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------
function addDecorObject(kind) {
  if (decorData.objects.length >= 1500) { toast('Object limit reached (1500).', 'bad'); return; }
  if (kind === 'image') { document.getElementById('decor-image-upload').click(); return; }
  const size = { square: [90, 90], triangle: [90, 90], circle: [90, 90], glow: [200, 200], text: [200, 60] }[kind] || [90, 90];
  const o = { id: edNextObjId++, kind, time: snapTime(editorTimer), x: GW / 2, y: GH / 2, w: size[0], h: size[1], rot: 0, alpha: 1, color: kind === 'glow' ? '#37b6ff' : '#ffffff', color2: '', layer: 'bg', z: 0, add: kind === 'glow', groups: [], img: '', text: 'Text', font: 'Poppins', size: 56, bold: true, hidden: false, locked: false, name: '', outline: false };
  decorData.objects.push(o);
  setEdTool('place');
  edSelectObj(o, false, true); edChanged(); renderPalette();
}
async function fileToDecorImage(file, maxSize) {
  const png = /png|gif|webp/.test(file.type);
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
  const r = Math.min(1, maxSize / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * r)), h = Math.max(1, Math.round(img.height * r));
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
  let out = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
  if (out.length > 560000) out = c.toDataURL('image/jpeg', 0.7);
  if (out.length > 560000) throw new Error('That image is too detailed — try a smaller one.');
  return { url: out, w, h };
}
document.getElementById('decor-image-upload')?.addEventListener('change', async ev => {
  const file = ev.target.files && ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image.', 'bad'); return; }
  try {
    const { url, w, h } = await fileToDecorImage(file, 512);
    let id = Object.keys(decorData.images).find(k => decorData.images[k] === url);
    if (!id) { if (Object.keys(decorData.images).length >= 12) { toast('A level can hold 12 different images.', 'bad'); return; } id = 'i' + Date.now().toString(36); decorData.images[id] = url; }
    const sc = Math.min(1, 220 / Math.max(w, h));
    const target = [...edSelObjs][0];
    if (target && target.kind === 'image' && edReplaceImage) { target.img = id; edReplaceImage = false; edChanged(); return; }
    const o = { id: edNextObjId++, kind: 'image', time: snapTime(editorTimer), x: GW / 2, y: GH / 2, w: Math.round(w * sc), h: Math.round(h * sc), rot: 0, alpha: 1, color: '#ffffff', color2: '', layer: 'bg', z: 0, add: false, groups: [], img: id, text: '', font: '', size: 40, bold: false, hidden: false, locked: false, name: '', outline: false };
    decorData.objects.push(o); setEdTool('place'); edSelectObj(o, false, true); edChanged(); renderPalette();
  } catch (e) { toast(e.message || 'Could not add that image.', 'bad'); }
});
let edReplaceImage = false;

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
function addTrigger(type) {
  if (recordedEffects.length >= 1500) { toast('Trigger limit reached.', 'bad'); return; }
  const def = TRIG_DEFS[type]; if (!def) return;
  const fx = Object.assign({ type, time: snapTime(editorTimer) }, clone(def.def));
  if (edSelTiles.size === 1 && 'target' in fx) fx.target = recordedTiles.indexOf([...edSelTiles][0]) + 1;
  else if (edSelObjs.size === 1 && 'target' in fx) fx.target = 10000 + [...edSelObjs][0].id;
  recordedEffects.push(fx); recordedEffects.sort((a, b) => a.time - b.time);
  selectEffect(fx, true); edChanged(); renderPalette();
}
const EASES = [{ v: 'linear', l: 'Linear' }, { v: 'in', l: 'Ease in' }, { v: 'out', l: 'Ease out' }, { v: 'inout', l: 'Ease in-out' }];
function trigFields(fx) {
  const f = [], num = (label, key, o) => f.push(Object.assign({ label, key, kind: 'number' }, o || {})), col = (label, key) => f.push({ label, key, kind: 'color' });
  const sel = (label, key, options, extra) => f.push(Object.assign({ label, key, kind: 'select', options }, extra || {}));
  const target = () => num('Target group', 'target', { step: 1, min: 0, def: 0, hint: '0 = everything · tile #N = N · object = 10000 + id' });
  switch (fx.type) {
    case 'move': target(); num('Move X (px)', 'dx', { step: 5 }); num('Move Y (px)', 'dy', { step: 5 }); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); sel('Easing', 'ease', EASES, { str: true }); break;
    case 'rotate': target(); num('Rotate (deg)', 'deg', { step: 15 }); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); sel('Easing', 'ease', EASES, { str: true }); break;
    case 'scale': target(); num('Scale (×)', 'sc', { step: 0.1, min: 0.05, max: 10 }); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); sel('Easing', 'ease', EASES, { str: true }); break;
    case 'alpha': target(); num('Opacity (0-1)', 'a', { step: 0.05, min: 0, max: 1 }); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); sel('Easing', 'ease', EASES, { str: true }); break;
    case 'color': sel('Affects', 'what', [{ v: 'group', l: 'A group' }, { v: 'bg', l: 'Background' }], { str: true, rebuild: true }); if (fx.what !== 'bg') target(); col('Color', 'color'); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); break;
    case 'toggle': target(); sel('Set to', 'on', [{ v: 0, l: 'Hidden' }, { v: 1, l: 'Visible' }]); break;
    case 'pulse': sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]); col('Color', 'color'); num('Duration', 'duration', { step: 0.05, min: 0.05 }); num('Fade in', 'inTrans', { step: 0.05, min: 0 }); num('Fade out', 'outTrans', { step: 0.05, min: 0 }); break;
    case 'shake': num('Strength (px)', 'strength', { step: 1, min: 1, max: 60 }); num('Duration (s)', 'dur', { step: 0.1, min: 0.1 }); break;
    case 'zoom': num('Zoom (×)', 'zoom', { step: 0.05, min: 0.3, max: 3 }); num('Duration (s)', 'dur', { step: 0.1, min: 0 }); sel('Easing', 'ease', EASES, { str: true }); break;
    case 'laneflip': sel('Lanes', 'on', [{ v: 1, l: 'Mirrored' }, { v: 0, l: 'Normal' }]); break;
    case 'speed': num('Target speed', 'target', { step: 1, min: 5, max: 60, hint: 'Normal = 18. 0.5× = 10 · 1.5× = 26 · 2× = 34' }); num('Transition (s, 0 = instant)', 'transDuration', { step: 0.05, min: 0 }); break;
    case 'hitbox': sel('Hitboxes', 'zoneOn', [{ v: 1, l: 'On (drag the boxes)' }, { v: 0, l: 'Off (tap anywhere)' }]); break;
    case 'sfx': num('Volume (0-1)', 'vol', { step: 0.05, min: 0, max: 1, def: 1 }); num('Pitch / speed (×)', 'rate', { step: 0.05, min: 0.25, max: 4, def: 1 }); break;
    case 'tile_style': col('Color 1', 'c1'); col('Color 2', 'c2'); num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 }); break;
    case 'tilemove': sel('Mode', 'mode', [{ v: 0, l: 'Shift sideways' }, { v: 1, l: 'Sway' }]); num('Amount (px)', 'amount', { step: 5 }); num('Duration', 'duration', { step: 0.1, min: 0.2 }); break;
    case 'tilehide': sel('Mode', 'mode', [{ v: 0, l: 'Fade out as they fall' }, { v: 1, l: 'Invisible' }]); num('Fade starts at Y', 'fadeY', { step: 10 }); num('Duration', 'duration', { step: 0.1, min: 0.2 }); break;
    case 'image': case 'extra_image': sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]); num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 }); num('Duration', 'duration', { step: 0.1, min: 0.1 }); break;
    case 'video': f.push({ label: 'Video URL (https)', key: 'url', kind: 'text', max: 480 }); sel('Layer', 'layer', [{ v: 0, l: 'Background' }, { v: 1, l: 'Foreground' }]); num('Alpha', 'alpha', { step: 0.05, min: 0, max: 1 }); num('Duration', 'duration', { step: 0.5, min: 0.5 }); break;
  }
  return f;
}

// ---------------------------------------------------------------------------
// Inspector (right drawer)
// ---------------------------------------------------------------------------
function renderInspector() {
  const host = document.getElementById('ed-inspector'); if (!host) return;
  const keepScroll = host.parentElement ? host.parentElement.scrollTop : 0;
  host.innerHTML = '';
  const nT = edSelTiles.size, nO = edSelObjs.size, fx = selectedEffect;
  const total = nT + nO + (fx ? 1 : 0);
  if (!total) {
    host.appendChild(el('div', 'selected-empty', '<span class="selected-icon">✦</span><div><b>Nothing selected</b><br><small>Tap a tile, object or trigger marker.<br>Select tool: drag a box to select many.</small></div>'));
    const r = el('div', 'btn-row'); host.appendChild(r);
    btn(r, 'Select all', edSelectAll); btn(r, 'Select from playhead', edSelectFrom);
    const paste = el('div', 'btn-row'); host.appendChild(paste);
    btn(paste, '📋 Paste at playhead', () => edPaste(1)); btn(paste, 'Paste ×N…', edPasteMany);
    return;
  }
  const common = el('div', 'btn-row');
  if (total > 1) host.appendChild(el('div', 'selected-effect-title', '<span>SELECTION</span><b>' + total + ' items</b>'));
  if (nT) {
    const ts = [...edSelTiles];
    if (nT === 1) {
      const t = ts[0], gid = recordedTiles.indexOf(t) + 1;
      host.appendChild(el('div', 'selected-effect-title', '<span>TILE</span><b>#' + gid + '  <small>group id ' + gid + '</small></b>'));
      propRow(host, { label: 'Lane', key: 'lane', kind: 'select', options: [0, 1, 2, 3].map(i => ({ v: i, l: 'Lane ' + (i + 1) })) }, t, () => { edDedupeTiles(); edChanged(true); });
      propRow(host, { label: 'Time (s)', key: 'time', kind: 'number', step: 0.01, min: 0 }, t, () => { edSortTiles(); edChanged(true); });
      propRow(host, { label: 'Hold tile', key: 'isHold', kind: 'check' }, t, () => { if (t.isHold && !t.holdDuration) t.holdDuration = 0.5; edChanged(); });
      if (t.isHold) propRow(host, { label: 'Hold length (s)', key: 'holdDuration', kind: 'number', step: 0.05, min: 0.05, max: 30 }, t);
    }
    const pr = el('div', 'inspector-field'); pr.appendChild(el('label', '', 'Style'));
    const ps = el('select'); const o0 = el('option', '', 'Classic'); o0.value = -1; ps.appendChild(o0);
    decorData.presets.forEach((p, i) => { const o = el('option', '', escapeHtml(p.name || 'Style ' + (i + 1))); o.value = i; ps.appendChild(o); });
    ps.value = nT === 1 && Number.isInteger(ts[0].preset) ? ts[0].preset : (ts.every(t => t.preset === ts[0].preset) && Number.isInteger(ts[0].preset) ? ts[0].preset : -1);
    ps.onchange = () => { const v = Number(ps.value); ts.forEach(t => { if (v >= 0) t.preset = v; else delete t.preset; }); edChanged(true); };
    pr.appendChild(ps); host.appendChild(pr);
    groupsRow(host, ts);
  }
  if (nO === 1) objectInspector(host, [...edSelObjs][0]);
  else if (nO > 1) {
    host.appendChild(el('div', 'selected-effect-title', '<span>OBJECTS</span><b>' + nO + '</b>'));
    const os = [...edSelObjs];
    const lay = el('div', 'inspector-field'); lay.appendChild(el('label', '', 'Layer')); const ls = el('select', '', '<option value="bg">Background</option><option value="fg">Foreground</option>'); ls.value = os[0].layer; ls.onchange = () => { os.forEach(o => o.layer = ls.value); edChanged(true); }; lay.appendChild(ls); host.appendChild(lay);
    groupsRow(host, os);
  }
  if (fx) {
    const d = TRIG_DEFS[fx.type] || { label: fx.type, icon: '?' };
    host.appendChild(el('div', 'selected-effect-title', '<span>TRIGGER</span><b>' + d.icon + ' ' + escapeHtml(d.label) + '</b>'));
    propRow(host, { label: 'Time (s)', key: 'time', kind: 'number', step: 0.01, min: 0 }, fx, () => { recordedEffects.sort((a, b) => a.time - b.time); edChanged(true); });
    trigFields(fx).forEach(def => propRow(host, def, fx, () => { edChanged(true); if (def.rebuild) renderInspector(); }));
    if (fx.type === 'hitbox') {
      host.appendChild(el('div', 'muted-note', 'Drag the cyan boxes on the board — one per lane. Drag a box to move it, drag its bottom bar to resize.'));
      const r = el('div', 'btn-row'); host.appendChild(r);
      btn(r, 'All lanes = lane 1', () => { for (let l = 1; l < 4; l++) { fx['z' + l + 't'] = fx.z0t; fx['z' + l + 'h'] = fx.z0h; } edChanged(true); });
      btn(r, 'Reset', () => { for (let l = 0; l < 4; l++) { fx['z' + l + 't'] = 400; fx['z' + l + 'h'] = 140; } edChanged(true); });
    }
    if (fx.type === 'sfx') {
      const r = el('div', 'btn-row'); host.appendChild(r);
      btn(r, fx.src ? '🔊 Replace sound' : '🔊 Choose sound', () => document.getElementById('fx-sfx-upload').click());
      host.appendChild(el('div', 'muted-note', fx.src ? 'Sound loaded.' : 'No sound chosen yet.'));
    }
    if (target1(fx) && 'target' in fx) {
      const r = el('div', 'btn-row'); host.appendChild(r);
      if (edSelTiles.size === 1 || edSelObjs.size === 1) btn(r, 'Target the selected item', () => { fx.target = edSelTiles.size ? recordedTiles.indexOf([...edSelTiles][0]) + 1 : 10000 + [...edSelObjs][0].id; edChanged(); });
    }
    const r = el('div', 'btn-row'); host.appendChild(r);
    btn(r, 'Move to playhead', () => { fx.time = snapTime(editorTimer); recordedEffects.sort((a, b) => a.time - b.time); edChanged(); });
  }
  const acts = el('div', 'btn-row'); host.appendChild(acts);
  btn(acts, '⧉ Copy', edCopy); btn(acts, '＋ Duplicate', edDuplicate); btn(acts, '🗑 Delete', edDeleteSelection, 'btn-danger');
  if (host.parentElement) host.parentElement.scrollTop = keepScroll;
}
const target1 = fx => fx.type !== 'color' || fx.what !== 'bg';
function groupsRow(host, items) {
  const cur = items.length === 1 ? (items[0].groups || []).join(', ') : '';
  const row = el('div', 'inspector-field'); row.appendChild(el('label', '', items.length === 1 ? 'Extra groups' : 'Set groups'));
  const inp = el('input'); inp.type = 'text'; inp.placeholder = '20001, 20002'; inp.value = cur;
  inp.onchange = () => { const g = inp.value.split(/[ ,]+/).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 99999).slice(0, 6); items.forEach(i => { i.groups = g.slice(); }); edChanged(true); };
  row.appendChild(inp); host.appendChild(row);
}
function objectInspector(host, o) {
  host.appendChild(el('div', 'selected-effect-title', '<span>' + escapeHtml(o.kind.toUpperCase()) + '</span><b>' + escapeHtml(o.name || ('Object ' + o.id)) + ' <small>group id ' + (10000 + o.id) + '</small></b>'));
  const ch = () => edChanged(true);
  propRow(host, { label: 'Name', key: 'name', kind: 'text', max: 30 }, o, ch);
  propRow(host, { label: 'Appears at (s)', key: 'time', kind: 'number', step: 0.05, min: 0, hint: 'Visible from this time until a Toggle trigger hides it.' }, o, ch);
  propRow(host, { label: 'Visible for (s, 0 = always)', key: 'dur', kind: 'number', step: 0.1, min: 0 }, o, ch);
  if (o.kind === 'text') {
    propRow(host, { label: 'Text', key: 'text', kind: 'text', max: 80 }, o, ch);
    propRow(host, { label: 'Font', key: 'font', kind: 'select', str: true, options: DECOR_FONTS.map(f => ({ v: f, l: f })) }, o, ch);
    propRow(host, { label: 'Size', key: 'size', kind: 'number', step: 2, min: 6, max: 400 }, o, ch);
    propRow(host, { label: 'Bold', key: 'bold', kind: 'check' }, o, ch);
    propRow(host, { label: 'Outline', key: 'outline', kind: 'check' }, o, ch);
  } else {
    propRow(host, { label: 'Width', key: 'w', kind: 'number', step: 5, min: 1, max: 4000 }, o, ch);
    propRow(host, { label: 'Height', key: 'h', kind: 'number', step: 5, min: 1, max: 4000 }, o, ch);
  }
  propRow(host, { label: 'X', key: 'x', kind: 'number', step: 5 }, o, ch);
  propRow(host, { label: 'Y', key: 'y', kind: 'number', step: 5 }, o, ch);
  propRow(host, { label: 'Rotation (deg)', key: 'rot', kind: 'number', step: 5 }, o, ch);
  propRow(host, { label: 'Opacity', key: 'alpha', kind: 'number', step: 0.05, min: 0, max: 1, def: 1 }, o, ch);
  if (o.kind !== 'image') propRow(host, { label: o.kind === 'text' ? 'Color' : 'Color 1', key: 'color', kind: 'color' }, o, ch);
  if (['square', 'triangle', 'circle'].includes(o.kind)) {
    propRow(host, { label: 'Gradient to', key: 'color2', kind: 'color', empty: '#000000' }, o, ch);
    propRow(host, { label: 'Outline only', key: 'outline', kind: 'check' }, o, ch);
    btn(host, 'Clear gradient', () => { o.color2 = ''; edChanged(); }, 'btn-ghost');
  }
  if (o.kind === 'text' && o.outline) propRow(host, { label: 'Outline color', key: 'color2', kind: 'color', empty: '#000000' }, o, ch);
  propRow(host, { label: 'Layer', key: 'layer', kind: 'select', str: true, options: [{ v: 'bg', l: 'Background (behind tiles)' }, { v: 'fg', l: 'Foreground (in front)' }] }, o, () => { edChanged(); renderPalette(); });
  propRow(host, { label: 'Order (z)', key: 'z', kind: 'number', step: 1, min: -50, max: 50, def: 0 }, o, () => { edChanged(true); renderPalette(); });
  propRow(host, { label: 'Glow blend', key: 'add', kind: 'check' }, o, ch);
  groupsRow(host, [o]);
  if (o.kind === 'image') btn(host, '🖼 Replace image', () => { edReplaceImage = true; document.getElementById('decor-image-upload').click(); });
  const r = el('div', 'btn-row'); host.appendChild(r);
  btn(r, 'Appear at playhead', () => { o.time = snapTime(editorTimer); edChanged(); });
  btn(r, 'Center', () => { o.x = GW / 2; o.y = GH / 2; edChanged(); });
}
document.getElementById('fx-sfx-upload')?.addEventListener('change', ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file || !selectedEffect || selectedEffect.type !== 'sfx') return;
  if (file.size > 1.5 * 1024 * 1024) { toast('That sound is too big (max 1.5MB).', 'bad'); return; }
  const rd = new FileReader(); rd.onload = e2 => { selectedEffect.src = e2.target.result; edChanged(); }; rd.readAsDataURL(file);
});

// ---------------------------------------------------------------------------
// Tile style editor
// ---------------------------------------------------------------------------
async function editPreset(idx) {
  const isNew = idx < 0;
  const base = isNew ? Object.assign({ name: 'Style ' + (decorData.presets.length + 1) }, TILE_PRESET_TEMPLATES.Neon) : Object.assign({}, decorData.presets[idx]);
  const host = document.getElementById('preset-editor');
  host.classList.remove('hidden');
  const body = document.getElementById('preset-body'); body.innerHTML = '';
  const p = base;
  const prev = el('canvas', 'preset-preview'); prev.width = 300; prev.height = 190; body.appendChild(prev);
  const redraw = () => { const c = prev.getContext('2d'); c.clearRect(0, 0, 300, 190); c.fillStyle = currentLevelBackground || '#202738'; c.fillRect(0, 0, 300, 190); c.strokeStyle = 'rgba(255,255,255,.1)'; for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(i * 75, 0); c.lineTo(i * 75, 190); c.stroke(); }
    drawPresetBox(c, 6, 20, 63, 100, p, 1); drawPresetBox(c, 81, 20, 63, 100, p, 0.25); c.save(); c.translate(0, 0); drawPresetBox(c, 156, 20, 63, 100, Object.assign({}, p), 1, '#ffffff'); c.restore();
    drawPresetBox(c, 231, 70, 63, 100, p, 1); c.fillStyle = '#fff'; c.font = '10px sans-serif'; c.fillText('normal', 18, 140); c.fillText('hit', 108, 140); c.fillText('tinted', 170, 140); };
  const rows = el('div', ''); body.appendChild(rows);
  const R = (def) => propRow(rows, def, p, redraw);
  R({ label: 'Name', key: 'name', kind: 'text', max: 24 });
  R({ label: 'Look', key: 'style', kind: 'select', str: true, options: [{ v: 'flat', l: 'Flat' }, { v: 'gradient', l: 'Gradient' }, { v: 'glass', l: 'Glass' }, { v: 'neon', l: 'Neon' }, { v: 'outline', l: 'Outline' }, { v: 'pixel', l: 'Pixel' }] });
  R({ label: 'Color', key: 'color', kind: 'color' }); R({ label: 'Color 2', key: 'color2', kind: 'color' });
  R({ label: 'Corner radius', key: 'radius', kind: 'number', min: 0, max: 60, step: 1 }); R({ label: 'Border width', key: 'border', kind: 'number', min: 0, max: 12, step: 1 });
  R({ label: 'Border color', key: 'borderColor', kind: 'color' }); R({ label: 'Glow', key: 'glow', kind: 'number', min: 0, max: 60, step: 2 });
  R({ label: 'Opacity', key: 'alpha', kind: 'number', min: 0.05, max: 1, step: 0.05, def: 1 }); R({ label: 'Hold color', key: 'holdColor', kind: 'color' });
  R({ label: 'Width (×lane)', key: 'wide', kind: 'number', min: 0.3, max: 1, step: 0.05, def: 1 }); R({ label: 'Height (×tile)', key: 'tall', kind: 'number', min: 0.3, max: 1.4, step: 0.05, def: 1 });
  const tpl = el('div', 'inspector-field'); tpl.appendChild(el('label', '', 'Start from'));
  const ts = el('select'); ts.appendChild(Object.assign(el('option', '', 'Template…'), { value: '' })); Object.keys(TILE_PRESET_TEMPLATES).forEach(k => ts.appendChild(Object.assign(el('option', '', k), { value: k })));
  ts.onchange = () => { if (!ts.value) return; const keepName = p.name; Object.assign(p, TILE_PRESET_TEMPLATES[ts.value], { name: keepName }); body.innerHTML = ''; host.classList.add('hidden'); decorData.presets = decorData.presets; applyPresetEditor(idx, p, true); };
  tpl.appendChild(ts); rows.appendChild(tpl);
  redraw();
  document.getElementById('preset-save').onclick = () => { host.classList.add('hidden'); applyPresetEditor(idx, p, false); };
  document.getElementById('preset-cancel').onclick = () => host.classList.add('hidden');
}
function applyPresetEditor(idx, p, reopen) {
  if (idx < 0) { if (decorData.presets.length >= 40) { toast('Limit: 40 styles.', 'bad'); return; } decorData.presets.push(p); idx = decorData.presets.length - 1; }
  else decorData.presets[idx] = p;
  edPreset = idx; edChanged(true); renderPalette();
  if (reopen) editPreset(idx);
}
function deletePreset(idx) {
  decorData.presets.splice(idx, 1);
  recordedTiles.forEach(t => { if (Number.isInteger(t.preset)) { if (t.preset === idx) delete t.preset; else if (t.preset > idx) t.preset--; } });
  edPreset = -1; edChanged(); renderPalette();
}

// ---------------------------------------------------------------------------
// Docked bottom timeline
// ---------------------------------------------------------------------------
function timelineMax() {
  let maxT = 30;
  if (bgAudio.duration && isFinite(bgAudio.duration)) maxT = Math.max(maxT, bgAudio.duration - editorOffsetMs() / 1000);
  recordedTiles.forEach(t => { if (t.time + 5 > maxT) maxT = t.time + 5; });
  recordedEffects.forEach(e => { if (e.time + 5 > maxT) maxT = e.time + 5; });
  decorData.objects.forEach(o => { if (o.time + 5 > maxT) maxT = o.time + 5; });
  return maxT;
}
function refreshEditorTimeline() {
  const maxT = timelineMax();
  const slider = document.getElementById('timeline-slider');
  slider.max = maxT;
  const layer = document.getElementById('editor-marker-layer');
  layer.innerHTML = '';
  const frag = document.createDocumentFragment();
  if (edShow.tiles) recordedTiles.forEach(t => {
    const m = document.createElement('div');
    m.className = 'timeline-marker' + (t.isHold ? ' hold' : '') + (edSelTiles.has(t) ? ' sel' : '');
    m.style.left = Math.min(100, (t.time / maxT) * 100) + '%';
    frag.appendChild(m);
  });
  if (edShow.decor) decorData.objects.forEach(o => {
    const m = document.createElement('div');
    m.className = 'timeline-marker obj' + (edSelObjs.has(o) ? ' sel' : '');
    m.style.left = Math.min(100, (o.time / maxT) * 100) + '%';
    m.title = o.name || o.kind;
    m.onclick = ev => { ev.stopPropagation(); setEdMode('decor', true); edSelectObj(o, false, true); setEditorTime(o.time); };
    frag.appendChild(m);
  });
  if (edShow.fx) recordedEffects.forEach(fx => {
    const m = document.createElement('div');
    m.className = 'timeline-marker fx' + (selectedEffect === fx ? ' sel' : '');
    m.style.left = Math.min(100, (fx.time / maxT) * 100) + '%';
    m.style.background = TRIG_COLORS[fx.type] || 'var(--pink)';
    m.title = (TRIG_DEFS[fx.type] || { label: fx.type }).label;
    m.onclick = ev => { ev.stopPropagation(); selectEffect(fx, true); setEditorTime(fx.time); };
    frag.appendChild(m);
  });
  layer.appendChild(frag);
  const count = document.getElementById('ed-count');
  if (count) count.textContent = recordedTiles.length + ' tiles';
  updateEditorPlayhead();
}
function updateEditorPlayhead() {
  const slider = document.getElementById('timeline-slider');
  const maxT = parseFloat(slider.max) || 30;
  const text = editorTimer.toFixed(2) + 's';
  const timeEl = document.getElementById('editor-timeline-time'); if (timeEl) timeEl.textContent = text;
  const pill = document.getElementById('editor-timer-panel'); if (pill) pill.textContent = text;
  slider.value = editorTimer;
  const ph = document.getElementById('editor-playhead'); if (ph) ph.style.left = Math.min(100, (editorTimer / maxT) * 100) + '%';
}
function setEditorTime(t) {
  editorTimer = Math.max(0, t);
  if (bgAudio.src && !editorPlaying) { try { bgAudio.currentTime = Math.max(0, songPos(editorTimer)); } catch (e) {} }
  updateEditorPlayhead();
}
function scrubTimeline(value) {
  const wasPlaying = editorPlaying;
  setEditorTime(parseFloat(value) || 0);
  if (wasPlaying && bgAudio.src) { try { bgAudio.currentTime = Math.max(0, songPos(editorTimer)); } catch (e) {} }
}
function nudgeEditorTime(delta) { setEditorTime(editorTimer + delta); }
function jumpEditorEnd() {
  let maxT = 0;
  recordedTiles.forEach(t => maxT = Math.max(maxT, t.time + (t.holdDuration || 0)));
  recordedEffects.forEach(e => maxT = Math.max(maxT, e.time));
  setEditorTime(maxT);
}
let editorUiAccum = 0, editorSongWaiting = false;
function editorTick(dtSec) {
  if (!editorPlaying) return;
  const audioPlaying = bgAudio.src && !bgAudio.paused && !bgAudio.ended;
  if (editorSongWaiting && songPos(editorTimer) >= 0) { editorSongWaiting = false; try { bgAudio.currentTime = songPos(editorTimer); } catch (e) {} bgAudio.play().catch(() => {}); }
  if (audioPlaying) editorTimer = bgAudio.currentTime - editorOffsetMs() / 1000;
  else editorTimer += dtSec;
  editorUiAccum += dtSec;
  if (editorUiAccum >= 0.05) { editorUiAccum = 0; updateEditorPlayhead(); }
}
function toggleEditorTransport() {
  editorPlaying = !editorPlaying;
  const btn2 = document.getElementById('editor-transport-btn');
  if (btn2) btn2.innerText = editorPlaying ? '⏸' : '▶';
  if (editorPlaying) {
    if (bgAudio.src) {
      if (songPos(editorTimer) >= 0) { try { bgAudio.currentTime = songPos(editorTimer); } catch (e) {} bgAudio.play().catch(() => {}); editorSongWaiting = false; }
      else { bgAudio.pause(); editorSongWaiting = true; }
    }
  } else {
    bgAudio.pause();
    if (isRecording) { isRecording = false; document.getElementById('btn-create-tiles')?.classList.remove('active'); }
  }
}
function stopEditorTransport() {
  if (!editorPlaying) return;
  editorPlaying = false;
  const btn2 = document.getElementById('editor-transport-btn'); if (btn2) btn2.innerText = '▶';
  if (isRecording) { isRecording = false; document.getElementById('btn-create-tiles')?.classList.remove('active'); }
}
function toggleTimelineDock() { document.getElementById('timeline-dock').classList.toggle('collapsed'); setTimeout(layoutCanvas, 20); setTimeout(layoutCanvas, 300); }

// ---------------------------------------------------------------------------
// Drawing the editor board (called from the game loop)
// ---------------------------------------------------------------------------
function editorDecorSync() {
  const key = editorTimer.toFixed(3) + '|' + edVersion;
  if (key === edSyncKey) return;
  edSyncKey = key;
  decorEditorSync(recordedEffects, editorTimer);
  const bg = decorBackground();
  document.body.style.background = bg || (document.getElementById('edit-bg-color') || {}).value || '#202738';
}
function drawEditorLayer() {
  const pps = getEditorPPS(), step = getEditorGridStep();
  const tMin = editorTimer - (GH - lineY) / pps, tMax = editorTimer + lineY / pps;
  const first = Math.ceil((tMin - editorGridOffset) / step), last = Math.floor((tMax - editorGridOffset) / step);
  ctx.save();
  ctx.font = "600 9px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  if (last - first < 400) for (let gi = first; gi <= last; gi++) {
    const gt = editorGridOffset + gi * step;
    if (gt < -1e-6) continue;
    const gy = lineY + (editorTimer - gt) * pps;
    const isBeat = ((gi % editorGridDivision) + editorGridDivision) % editorGridDivision === 0;
    ctx.globalAlpha = isBeat ? 0.42 : 0.16; ctx.strokeStyle = isBeat ? "#9ad0ff" : "#78bfff"; ctx.lineWidth = isBeat ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(GW, gy); ctx.stroke();
    if (isBeat) { ctx.globalAlpha = 0.6; ctx.fillStyle = "#cfe6ff"; ctx.fillText(gt.toFixed(2) + 's', 4, gy - 2); }
  }
  ctx.restore();

  if (edShow.tiles) {
    const tileH = edTileH();
    recordedTiles.forEach((t, i) => {
      const r = tileRect(t);
      if (r.top > GH + 4 || r.top + r.h < -4) return;
      const sel = edSelTiles.has(t), pr = presetOf(t.preset), flipped = laneFlipAt(t.time);
      ctx.save();
      if (pr) { ctx.globalAlpha = 1; drawPresetBox(ctx, r.x - 1, r.top, r.w + 2, r.h, Object.assign({}, pr, { wide: 1, tall: 1 }), 0.92); }
      else { ctx.globalAlpha = 0.85; ctx.fillStyle = t.isHold ? "rgba(255, 100, 0, 0.6)" : "rgba(0, 235, 255, 0.55)"; ctx.fillRect(r.x, r.top, r.w, r.h); }
      if (t.isHold) { ctx.globalAlpha = 0.55; ctx.fillStyle = '#ff8a3d'; ctx.fillRect(r.x + r.w * 0.3, r.top, r.w * 0.4, r.h - tileH); }
      ctx.globalAlpha = 1; ctx.strokeStyle = sel ? '#ffffff' : "rgba(255,255,255,0.55)"; ctx.lineWidth = sel ? 2.5 : 1; if (sel) ctx.setLineDash([5, 3]);
      ctx.strokeRect(r.x + 0.5, r.top + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
      if (showHitboxes) { ctx.strokeStyle = "#ff3b81"; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.top, r.w, r.h); }
      if (sel || edMode === 'trig' || flipped || showLaneText) {
        ctx.font = "700 10px system-ui"; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const label = (sel || edMode === 'trig' ? '#' + (i + 1) : '') + (flipped ? ' ⇄' : '');
        if (label.trim()) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(r.x + 2, r.top + r.h - tileH + 2, ctx.measureText(label).width + 6, 13); ctx.fillStyle = '#fff'; ctx.fillText(label, r.x + 5, r.top + r.h - tileH + 4); }
        if (showLaneText) { ctx.fillStyle = "#fff"; ctx.font = "700 20px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(keyMap[t.lane].toUpperCase(), t.lane * laneW + laneW / 2, r.top + r.h - tileH / 2); }
      }
      ctx.restore();
    });
  }
  // hitbox editor
  if (edShow.fx) {
    let hb = selectedEffect && selectedEffect.type === 'hitbox' ? selectedEffect : null;
    const editing = !!hb;
    if (!hb) recordedEffects.forEach(f => { if (f.type === 'hitbox' && f.time <= editorTimer) hb = f; });
    if (hb && Number(hb.zoneOn) === 1) {
      ctx.save();
      for (let l = 0; l < 4; l++) {
        const top = hbVal(hb, l, 't', 400), h = Math.max(20, hbVal(hb, l, 'h', 140));
        ctx.globalAlpha = editing ? 0.28 : 0.12; ctx.fillStyle = '#00f0ff'; ctx.fillRect(l * laneW + 2, top, laneW - 4, h);
        ctx.globalAlpha = 1; ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.setLineDash(editing ? [] : [6, 4]); ctx.strokeRect(l * laneW + 2, top, laneW - 4, h);
        if (editing) { ctx.setLineDash([]); ctx.fillStyle = '#00f0ff'; ctx.fillRect(l * laneW + laneW / 2 - 16, top + h - 6, 32, 6); ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('LANE ' + (l + 1), l * laneW + laneW / 2, top + 4); }
      }
      if (editing) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.5; ctx.strokeRect(laneW * 1.5 - 20, lineY - TILE_H, 40, TILE_H); ctx.setLineDash([]); ctx.globalAlpha = 0.8; ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('tile size', laneW * 1.5, lineY - TILE_H - 11); }
      ctx.restore();
    }
  }
  // object selection boxes + handles
  if (edShow.decor) {
    ctx.save();
    decorData.objects.forEach(o => {
      if (o.hidden) return;
      const sel = edSelObjs.has(o);
      if (!sel && edMode !== 'decor') return;
      const st = objState(o), b = decorObjectBounds(o);
      ctx.save(); ctx.translate(o.x + st.dx, o.y + st.dy); ctx.rotate(((o.rot || 0) + st.rot) * Math.PI / 180); ctx.scale(st.sc, st.sc);
      ctx.strokeStyle = sel ? '#ffd23f' : 'rgba(255,255,255,.35)'; ctx.lineWidth = sel ? 2 : 1; ctx.setLineDash(sel ? [] : [4, 3]);
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    });
    if (edSelObjs.size === 1) {
      const o = [...edSelObjs][0], h = objHandles(o);
      ctx.setLineDash([]); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(h.center.x, h.center.y); ctx.lineTo(h.rotate.x, h.rotate.y); ctx.stroke();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(h.rotate.x, h.rotate.y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(h.scale.x, h.scale.y, 7, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  if (edBox) { ctx.save(); ctx.strokeStyle = '#37b6ff'; ctx.fillStyle = 'rgba(55,182,255,.15)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); const x = Math.min(edBox.x0, edBox.x1), y = Math.min(edBox.y0, edBox.y1), w = Math.abs(edBox.x1 - edBox.x0), h = Math.abs(edBox.y1 - edBox.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore(); }
  for (let i = editorVisualTiles.length - 1; i >= 0; i--) {
    const v = editorVisualTiles[i]; v.alpha -= 0.06;
    if (v.alpha <= 0) { editorVisualTiles.splice(i, 1); continue; }
    ctx.globalAlpha = v.alpha * 0.5; ctx.fillStyle = "#00ffff"; ctx.fillRect(v.lane * laneW, lineY - 6, laneW, 12);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Session lifecycle hooks (called by startEditor in game.js)
// ---------------------------------------------------------------------------
function editorResetSession(level) {
  edClearSel(); edClip = edClip; edPreset = -1; edDrag = null; edBox = null; edVersion++; edSyncKey = '';
  edNextObjId = decorData.objects.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1;
  edSortTiles();
  currentSongId = level && level.songId ? level.songId : null;
  currentDescription = level && level.description ? level.description : '';
  edMode = 'tiles'; edTool = 'place'; deleteMode = false; edHoldNew = false;
  edShow.tiles = edShow.decor = edShow.fx = true;
  editorSnapEnabled = localStorage.getItem('et_noSnap') !== 'true';   // Settings > "Turn off snapping" starts every editor session in free mode
}
function editorAfterStart(level) {
  const d = document.getElementById('edit-description'); if (d) d.value = currentDescription;
  updateSongLabel(); updateSnapButton(); setEdMode('tiles', true); setEdTool('place'); renderInspector();
  if (level && level.songId && !bgAudio.getAttribute('src')) loadLibrarySongAudio(level.songId);
  document.querySelectorAll('.ed-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === 'tiles'));
}
function updateSongLabel() {
  const l = document.getElementById('edit-song-label'); if (!l) return;
  l.textContent = currentSongId ? 'Library song #' + currentSongId : (currentAudioBlob ? 'Your own file' : 'No song');
}
async function loadLibrarySongAudio(id) {
  try {
    const res = await fetch(API_BASE_URL + '/api/songs/' + id + '/audio');
    if (!res.ok) throw new Error('missing');
    setEditorAudio(await res.blob());
  } catch (e) { toast('Could not load the library song.', 'bad'); }
}
async function pickLibrarySong() {
  if (typeof openSongPicker !== 'function') { toast('Song library is not available.', 'bad'); return; }
  const s = await openSongPicker();
  if (!s) return;
  currentSongId = s.id; currentAudioBlob = null;
  await loadLibrarySongAudio(s.id);
  currentSongId = s.id; updateSongLabel(); levelVerified = false;
  if (s.bpm && await uiConfirm('Set the level BPM to ' + s.bpm + '?', 'Yes')) { editorBpm = Math.min(maxBpm, s.bpm); document.getElementById('edit-bpm').value = editorBpm; updateGridReadout(); }
  toast('Using "' + s.name + '".', 'good');
}

// ---------------------------------------------------------------------------
// Level appearance (settings screen)
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
    try { currentLevelIcon = await downscaleImage(file, 256); renderLevelIconPreview(); } catch (e) { toast(e.message || 'Could not read that image.'); }
    event.target.value = '';
  });
}

// ---------------------------------------------------------------------------
// Undo / redo / delete all (history compares snapshots after every edit)
// ---------------------------------------------------------------------------
let undoStack = [], redoStack = [], lastSnap = null;
const snapState = () => JSON.stringify([recordedTiles, recordedEffects, decorData.objects, decorData.presets, Object.keys(decorData.images)]);
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
  const [t, e, o, p] = JSON.parse(str);
  recordedTiles = t; recordedEffects = e; decorData.objects = o; decorData.presets = p; lastSnap = str;
  edClearSel(); edPreset = Math.min(edPreset, p.length - 1);
  edChanged(); renderPalette(); renderInspector();
}
function editorUndo() { historyCheck(); if (!undoStack.length) { toast('Nothing to undo.'); return; } redoStack.push(lastSnap); applySnap(undoStack.pop()); }
function editorRedo() { historyCheck(); if (!redoStack.length) { toast('Nothing to redo.'); return; } undoStack.push(lastSnap); applySnap(redoStack.pop()); }
async function deleteAllEditor() {
  if (!recordedTiles.length && !recordedEffects.length && !decorData.objects.length) { toast('Nothing to delete.'); return; }
  if (!(await uiConfirm('Delete ALL tiles, objects and triggers? You can undo this with ↶.', 'Delete all', true))) return;
  historyCheck();
  recordedTiles = []; recordedEffects = []; decorData.objects = []; edClearSel();
  edChanged(); renderPalette(); historyCheck(); toast('Everything deleted. ↶ brings it back.');
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
const endHbDrag = () => { if (!hbDrag) return; hbDrag = null; edChanged(true); };
canvas.addEventListener('pointerup', endHbDrag);
canvas.addEventListener('pointercancel', endHbDrag);
