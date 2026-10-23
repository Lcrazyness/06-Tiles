// ============================================================================
// decor.js — level objects (squares, triangles, glow, images, text), tile
// presets (custom tile looks) and the trigger engine (move / rotate / scale /
// alpha / colour / toggle / shake / zoom / lane flip).
//
// Everything here is deterministic from the level clock, so the same code draws
// the editor preview, the game and practice-mode respawns.
//
// Group ids:  tile #N (in time order) always has group id N automatically;
//             anything can also be given extra groups (use ids >= 1001 so they never clash
//             with a tile id). A trigger with target 0 hits everything.
// ============================================================================

const DECOR_FONTS = ['Poppins', 'Bebas Neue', 'Orbitron', 'Press Start 2P', 'Pacifico', 'Permanent Marker', 'Righteous', 'Fredoka', 'Lobster', 'Audiowide', 'Caveat', 'Monoton'];
const DECOR_KINDS = [
  { kind: 'square', icon: '■', label: 'Square' }, { kind: 'triangle', icon: '▲', label: 'Triangle' }, { kind: 'circle', icon: '●', label: 'Circle' },
  { kind: 'glow', icon: '✺', label: 'Glow' }, { kind: 'image', icon: '🖼', label: 'Image' }, { kind: 'video', icon: '🎬', label: 'Video' }, { kind: 'text', icon: 'T', label: 'Text' }
];
const TILE_PRESET_TEMPLATES = {
  Classic: { style: 'flat', color: '#111111', color2: '#333333', radius: 0, border: 0, borderColor: '#ffffff', glow: 0, alpha: 1, holdColor: '', wide: 1, tall: 1 },
  Neon: { style: 'neon', color: '#06121f', color2: '#0b2a44', radius: 10, border: 3, borderColor: '#00f0ff', glow: 18, alpha: 1, holdColor: '#00f0ff', wide: 1, tall: 1 },
  Glass: { style: 'glass', color: '#9fd8ff', color2: '#ffffff', radius: 14, border: 2, borderColor: '#ffffff', glow: 0, alpha: 0.55, holdColor: '#9fd8ff', wide: 1, tall: 1 },
  Candy: { style: 'gradient', color: '#ff5fa2', color2: '#ffb36b', radius: 22, border: 3, borderColor: '#ffffff', glow: 8, alpha: 1, holdColor: '#ff5fa2', wide: 1, tall: 1 },
  Outline: { style: 'outline', color: '#000000', color2: '#000000', radius: 6, border: 4, borderColor: '#ffffff', glow: 0, alpha: 1, holdColor: '#ffffff', wide: 1, tall: 1 },
  Pixel: { style: 'pixel', color: '#39ff88', color2: '#0c6b3a', radius: 0, border: 0, borderColor: '#ffffff', glow: 0, alpha: 1, holdColor: '#39ff88', wide: 1, tall: 1 }
};

let decorData = { objects: [], images: {}, presets: [] };    // the level being played / edited
const decorImgCache = {};
let dGS = {};                                                // group states { dx,dy,rot,sc,a,vis,col }
let dTween = [];
let dCam = { shakeT0: 0, shakeDur: 0, shakeStr: 0, zoom: 1 };
let dBg = null;                                              // { from,to,t0,dur,cur } background colour tween
let dFlips = [], dFlipsV = [];                                             // [{time,on}]
let dFlipOnStart = false, dVFlip = false;

function newDecorData() { return { objects: [], images: {}, presets: [] }; }
function normalizeDecor(d) {
  d = d && typeof d === 'object' ? d : {};
  return { objects: Array.isArray(d.objects) ? d.objects : [], images: d.images && typeof d.images === 'object' ? d.images : {}, presets: Array.isArray(d.presets) ? d.presets : [] };
}
function decorImage(id) {
  const src = decorData.images[id];
  if (!src) return null;
  let e = decorImgCache[src];
  if (!e) { e = decorImgCache[src] = new Image(); e.src = src; }
  return e.complete && e.naturalWidth ? e : null;
}

// ---- trigger engine ----
const easeFns = { linear: p => p, in: p => p * p, out: p => 1 - (1 - p) * (1 - p), inout: p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2 };
const ease = (name, p) => (easeFns[name] || easeFns.linear)(Math.max(0, Math.min(1, p)));
let dSalt = (Math.random() * 4294967296) >>> 0;   // rolled again for every attempt: this is what makes a Randomize trigger different each time
let dLane = {};   // tile index -> lane chosen by a gameplay Randomize trigger
function gs(g) { return dGS[g] || (dGS[g] = { dx: 0, dy: 0, rot: 0, sc: 1, a: 1, vis: 1, col: null, colFrom: null, cp: 1 }); }

function decorReset(effects) {
  dLane = {}; dGS = {}; dTween = []; dCam = { shakeT0: 0, shakeDur: 0, shakeStr: 0, zoom: 1 }; dBg = null;
  const fl = (effects || []).filter(e => e.type === 'laneflip').map(e => ({ time: Number(e.time) || 0, on: Number(e.on) !== 0, v: e.axis === 'v' })).sort((a, b) => a.time - b.time);
  dFlips = fl.filter(f => !f.v); dFlipsV = fl.filter(f => f.v);
}
// is a tile with chart time `t` mirrored (lane flip)?
function vFlipAt(t) { let on = false; for (const f of dFlipsV) { if (f.time <= t + 1e-6) on = f.on; else break; } return on; }
function laneFlipAt(t) { let on = false; for (const f of dFlips) { if (f.time <= t + 1e-6) on = f.on; else break; } return on; }

function addTween(obj, prop, to, t0, dur, easing) {
  if (!(dur > 0)) { obj[prop] = to; return; }
  dTween = dTween.filter(x => !(x.obj === obj && x.prop === prop));
  dTween.push({ obj, prop, from: obj[prop], to, t0, dur, easing });
}
function targetIds(fx) { const t = Number(fx.target); return Number.isFinite(t) ? [t] : [0]; }

// fire one trigger (instant=true while fast-forwarding to a checkpoint)
function decorFire(fx, t, instant) {
  const dur = instant ? 0 : Math.max(0, Number(fx.dur) || 0), ez = fx.ease || 'out';
  switch (fx.type) {
    case 'move': targetIds(fx).forEach(g => { const s = gs(g); addTween(s, 'dx', s.dx + (Number(fx.dx) || 0), t, dur, ez); addTween(s, 'dy', s.dy + (Number(fx.dy) || 0), t, dur, ez); }); break;
    case 'rotate': targetIds(fx).forEach(g => { const s = gs(g); addTween(s, 'rot', s.rot + (Number(fx.deg) || 0), t, dur, ez); }); break;
    case 'scale': targetIds(fx).forEach(g => addTween(gs(g), 'sc', Number(fx.sc) || 1, t, dur, ez)); break;
    case 'alpha': targetIds(fx).forEach(g => addTween(gs(g), 'a', Math.max(0, Math.min(1, Number(fx.a))), t, dur, ez)); break;
    case 'toggle': targetIds(fx).forEach(g => { gs(g).vis = Number(fx.on) === 0 ? 0 : 1; }); break;
    case 'color':
      if (fx.what === 'bg') { dBg = { from: dBg ? dBg.cur : currentLevelBackground, to: fx.color, t0: t, dur, cur: instant || !(dur > 0) ? fx.color : null }; if (!dBg.cur) dBg.cur = dBg.from; if (!(dur > 0)) dBg.cur = fx.color; }
      else targetIds(fx).forEach(g => { const s = gs(g); s.colFrom = s.col || null; s.colTo = fx.color; s.cp = 0; addTween(s, 'cp', 1, t, dur, ez); if (!(dur > 0)) s.col = fx.color; });
      break;
    case 'shake': if (!instant && !a11yCalm) { dCam.shakeT0 = t; dCam.shakeDur = Math.max(0.05, Number(fx.dur) || 0.4); dCam.shakeStr = Number(fx.strength) || 8; } break;
    case 'zoom': addTween(dCam, 'zoom', Math.max(0.3, Math.min(3, Number(fx.zoom) || 1)), t, dur, ez); break;
    case 'random': fireRandom(fx, t, dur, ez); break;
  }
}

// ---- Randomize trigger: random move / spin / size / fade / colour / hide for the members of a group ----
// Seeded, so the same trigger gives the same result every run (verification, replays and ghosts stay in sync).
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hslHex(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
// every individual thing that belongs to group g: tiles (group = its number in time order, or any custom group) and objects (10000 + id)
function randomMembers(g) {
  const out = new Set();
  const tl = (typeof inEditor !== 'undefined' && inEditor) ? recordedTiles : pendingTiles;
  (tl || []).forEach((n, i) => { if (i + 1 === g || (n.groups || []).includes(g)) out.add(i + 1); });
  (decorData.objects || []).forEach(o => { if (10000 + o.id === g || (o.groups || []).includes(g)) out.add(10000 + o.id); });
  return [...out].slice(0, 600);
}
// Gameplay randomize: move tile `m` (1-based, in time order) to a random lane that is free at its time.
// Seeded like everything else, so verification, replays and ghosts get exactly the same lanes.
function randomizeLane(m, roll) {
  if (m >= 10000 || m < 1 || m > pendingTiles.length) return;
  const i = m - 1, n = pendingTiles[i], dur = a => (levelDisableHolds ? 0 : (a.isHold ? (a.holdDuration || 0) : 0));
  const laneOf = k => dLane[k] !== undefined ? dLane[k] : pendingTiles[k].lane;
  const busy = new Array(4).fill(false);
  for (let k = 0; k < pendingTiles.length; k++) {
    if (k === i) continue; const o = pendingTiles[k];
    if (o.time <= n.time + dur(n) + 0.09 && o.time + dur(o) >= n.time - 0.09) busy[laneOf(k)] = true;
  }
  const free = [0, 1, 2, 3].filter(l => !busy[l]);
  if (free.length) dLane[i] = free[Math.floor(roll * free.length) % free.length];
}
let tileFreezeUntil = 0, tileLag = 0;   // "Freeze tiles" trigger: tiles hover, and tiles that haven't appeared yet wait too
// Shell-game shuffle: the tiles of a group swap lanes with each other (a seeded permutation, new every attempt unless fixed).
function fireShuffle(fx, t, dur, ez, instant) {
  if (typeof inEditor !== 'undefined' && inEditor) return;
  const target = Number(fx.target) || 0; if (!target) return;
  const mem = randomMembers(target).filter(m => m >= 1 && m < 10000 && m <= pendingTiles.length);
  if (mem.length < 2) return;
  const seed = Number(fx.seed) || 1, base = (((seed | 0) * 7919 + Math.round(t * 1000) * 31) ^ (Number(fx.fixed) === 1 ? 0 : dSalt)) | 0, r = rngFrom(base ^ 0x5bd1e995);
  const baseLane = m => dLane[m - 1] !== undefined ? dLane[m - 1] : pendingTiles[m - 1].lane, vis = (m, l) => laneFlipAt(pendingTiles[m - 1].time) ? 3 - l : l;
  const old = mem.map(baseLane), perm = old.slice();
  for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const x = perm[i]; perm[i] = perm[j]; perm[j] = x; }
  mem.forEach((m, i) => {
    dLane[m - 1] = perm[i];
    const tl = tiles.find(x => x.noteIdx === m - 1);
    if (tl) {
      tl.lane = vis(m, perm[i]);
      if (!instant && old[i] !== perm[i]) { const s = gs(m); s.dx = (vis(m, old[i]) - vis(m, perm[i])) * laneW; addTween(s, 'dx', 0, t, dur, ez); }
    }
  });
}
function fireRandom(fx, t, dur, ez) {
  if (fx.mode === 'shuffle') { fireShuffle(fx, t, dur, ez, !(dur > 0)); return; }
  const target = Number(fx.target) || 0, each = Number(fx.each) !== 0 && target !== 0;
  const members = each ? randomMembers(target) : [target];
  const num = (k, d) => { const v = Number(fx[k]); return Number.isFinite(v) ? v : d; };
  const mode = fx.mode === 'add' || fx.mode === 'reset' ? fx.mode : 'set', chance = num('chance', 100), base = (((num('seed', 1) | 0) * 7919 + Math.round(t * 1000) * 31) ^ (num('fixed', 0) === 1 ? 0 : dSalt)) | 0;
  const gameplay = num('gp', 0) === 1 && mode !== 'reset' && !(typeof inEditor !== 'undefined' && inEditor);   // gameplay randomizing only happens in a real run
  const picks = [fx.c1, fx.c2, fx.c3].filter(c => /^#[0-9a-f]{6}$/i.test(String(c || '')));
  for (const m of members) {
    const r = rngFrom(base ^ Math.imul(m + 1, 2654435761)), v = []; for (let i = 0; i < 10; i++) v.push(r());   // fixed draw order: changing one setting never reshuffles the others
    if (v[0] * 100 >= chance) continue;
    if (gameplay) { randomizeLane(m, v[9]); if (num('gponly', 0) === 1) continue; }
    const s = gs(m);
    if (mode === 'reset') {
      addTween(s, 'dx', 0, t, dur, ez); addTween(s, 'dy', 0, t, dur, ez); addTween(s, 'rot', 0, t, dur, ez); addTween(s, 'sc', 1, t, dur, ez); addTween(s, 'a', 1, t, dur, ez);
      s.vis = 1; s.colTo = null; s.col = null; s.cp = 1; continue;
    }
    const add = mode === 'add';
    if (num('mv', 0) === 1) { const dx = (v[1] * 2 - 1) * num('mx', 60), dy = (v[2] * 2 - 1) * num('my', 60); addTween(s, 'dx', add ? s.dx + dx : dx, t, dur, ez); addTween(s, 'dy', add ? s.dy + dy : dy, t, dur, ez); }
    if (num('rt', 0) === 1) { const d = (v[3] * 2 - 1) * num('rd', 45); addTween(s, 'rot', add ? s.rot + d : d, t, dur, ez); }
    if (num('sz', 0) === 1) { const lo = num('smin', 0.7), hi = num('smax', 1.4), k = Math.max(0.05, Math.min(10, lo + v[4] * (hi - lo))); addTween(s, 'sc', add ? s.sc * k : k, t, dur, ez); }
    if (num('al', 0) === 1) { const lo = num('amin', 0.3), hi = num('amax', 1), a = Math.max(0, Math.min(1, lo + v[5] * (hi - lo))); addTween(s, 'a', add ? s.a * a : a, t, dur, ez); }
    const cm = num('col', 0);
    if (cm === 1 || (cm === 2 && picks.length)) {
      const hex = cm === 1 ? hslHex(Math.floor(v[6] * 360), 85, 60) : picks[Math.floor(v[7] * picks.length) % picks.length];
      s.colFrom = s.col || null; s.colTo = hex; s.cp = 0; addTween(s, 'cp', 1, t, dur, ez); if (!(dur > 0)) s.col = hex;
    }
    if (num('vis', 0) === 1) s.vis = v[8] * 100 < num('hide', 30) ? 0 : 1;
  }
}
function lerpColor(a, b, p) {
  const pa = hexRgb(a || '#ffffff'), pb = hexRgb(b || '#ffffff');
  return 'rgb(' + Math.round(pa[0] + (pb[0] - pa[0]) * p) + ',' + Math.round(pa[1] + (pb[1] - pa[1]) * p) + ',' + Math.round(pa[2] + (pb[2] - pa[2]) * p) + ')';
}
function hexRgb(h) {
  h = String(h || '#000000');
  if (h[0] === 'r') { const m = h.match(/\d+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]]; }
  return [parseInt(h.slice(1, 3), 16) || 0, parseInt(h.slice(3, 5), 16) || 0, parseInt(h.slice(5, 7), 16) || 0];
}
function decorUpdate(t) {
  for (let i = dTween.length - 1; i >= 0; i--) {
    const w = dTween[i], p = (t - w.t0) / w.dur;
    w.obj[w.prop] = w.from + (w.to - w.from) * ease(w.easing, p);
    if (p >= 1) { w.obj[w.prop] = w.to; dTween.splice(i, 1); }
  }
  for (const k in dGS) { const s = dGS[k]; if (s.colTo) s.col = s.cp >= 1 ? s.colTo : lerpColor(s.colFrom, s.colTo, s.cp); }
  if (dBg && dBg.dur > 0) { const p = Math.min(1, (t - dBg.t0) / dBg.dur); dBg.cur = lerpColor(dBg.from, dBg.to, ease('linear', p)); }
}
function decorBackground() { return dBg ? dBg.cur : null; }
// combined state for a thing that belongs to `groups`
function decorCombined(groups) {
  const out = { dx: 0, dy: 0, rot: 0, sc: 1, a: 1, vis: 1, col: null };
  const add = s => { out.dx += s.dx; out.dy += s.dy; out.rot += s.rot; out.sc *= s.sc; out.a *= s.a; if (!s.vis) out.vis = 0; if (s.col) out.col = s.col; };
  if (dGS[0]) add(dGS[0]);
  for (let i = 0; i < groups.length; i++) if (dGS[groups[i]]) add(dGS[groups[i]]);
  return out;
}
// camera: shake + zoom around the board centre
function decorCameraBegin(c, t) {
  let sx = 0, sy = 0;
  if (dCam.shakeDur > 0 && t >= dCam.shakeT0 && t < dCam.shakeT0 + dCam.shakeDur) {
    const k = 1 - (t - dCam.shakeT0) / dCam.shakeDur;
    sx = (Math.sin(t * 91) + Math.sin(t * 57)) * 0.5 * dCam.shakeStr * k; sy = (Math.cos(t * 83) + Math.sin(t * 61)) * 0.5 * dCam.shakeStr * k;
  }
  const z = dCam.zoom;
  if (sx || sy || z !== 1) c.setTransform(renderScale * z, 0, 0, renderScale * z, renderScale * (GW / 2 + sx - z * GW / 2), renderScale * (GH / 2 + sy - z * GH / 2));
}
function decorCameraEnd(c) { c.setTransform(renderScale, 0, 0, renderScale, 0, 0); }

// ---- objects ----
function objGroups(o) { return [10000 + o.id].concat(o.groups || []); }
function drawDecorObject(c, o, t, opts) {
  opts = opts || {};
  const st = decorCombined(objGroups(o));
  let alpha = (o.alpha === undefined ? 1 : o.alpha) * st.a;
  const live = t >= o.time - 1e-6 && (!o.dur || t < o.time + o.dur) && st.vis;
  if (!live) { if (!opts.ghost) return false; alpha *= 0.22; }
  if (alpha <= 0.002 && !opts.ghost) return true;
  c.save();
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (o.add) c.globalCompositeOperation = 'lighter';
  c.translate(o.x + st.dx, o.y + st.dy);
  c.rotate(((o.rot || 0) + st.rot) * Math.PI / 180);
  c.scale(st.sc, st.sc);
  const w = o.w, h = o.h, col = st.col || o.color || '#ffffff';
  let fill = col;
  if (o.color2 && (o.kind === 'square' || o.kind === 'triangle' || o.kind === 'circle')) { const g = c.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, col); g.addColorStop(1, o.color2); fill = g; }
  c.fillStyle = fill; c.strokeStyle = col; c.lineWidth = 3;
  switch (o.kind) {
    case 'square': if (o.outline) c.strokeRect(-w / 2, -h / 2, w, h); else c.fillRect(-w / 2, -h / 2, w, h); break;
    case 'triangle': c.beginPath(); c.moveTo(0, -h / 2); c.lineTo(w / 2, h / 2); c.lineTo(-w / 2, h / 2); c.closePath(); o.outline ? c.stroke() : c.fill(); break;
    case 'circle': c.beginPath(); c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); o.outline ? c.stroke() : c.fill(); break;
    case 'glow': { c.scale(1, h / w); const r = w / 2, g = c.createRadialGradient(0, 0, 0, 0, 0, r); const rgb = hexRgb(col); g.addColorStop(0, 'rgba(' + rgb.join(',') + ',1)'); g.addColorStop(1, 'rgba(' + rgb.join(',') + ',0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); break; }
    case 'image': { const im = decorImage(o.img); if (im) c.drawImage(im, -w / 2, -h / 2, w, h); else { c.strokeStyle = '#888'; c.strokeRect(-w / 2, -h / 2, w, h); } break; }
    case 'video': drawDecorVideo(c, o, t, w, h); break;
    case 'text': {
      c.font = (o.bold ? '700 ' : '400 ') + (o.size || 40) + 'px "' + (o.font || 'Poppins') + '", system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (o.outline) { c.lineWidth = Math.max(2, (o.size || 40) / 14); c.strokeStyle = o.color2 || '#000000'; c.strokeText(o.text || 'Text', 0, 0); }
      c.fillStyle = col; c.fillText(o.text || 'Text', 0, 0); break;
    }
  }
  c.restore();
  return true;
}
function decorObjectBounds(o) {
  if (o.kind === 'text') { ctx.save(); ctx.font = (o.bold ? '700 ' : '400 ') + (o.size || 40) + 'px "' + (o.font || 'Poppins') + '", sans-serif'; const w = ctx.measureText(o.text || 'Text').width; ctx.restore(); return { w: Math.max(20, w), h: (o.size || 40) * 1.2 }; }
  return { w: o.w, h: o.h };
}
function drawDecorLayer(c, layer, t, opts) {
  const list = decorData.objects;
  if (!list.length) return;
  const sorted = list.filter(o => (o.layer === 'fg' ? 'fg' : 'bg') === layer && !o.hidden).sort((a, b) => (a.z || 0) - (b.z || 0) || a.id - b.id);
  for (const o of sorted) drawDecorObject(c, o, t, opts);
}

// ---- tile presets ----
function rrect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
// draws one tile body in its lane box; `p` = preset (or null for the classic look)
function drawPresetBox(c, x, y, w, h, p, alpha, tint) {
  const sw = w * (p.wide || 1), sh = h * (p.tall || 1);
  const bx = x + (w - sw) / 2, by = y + (h - sh);
  const col = tint || p.color;
  c.save();
  c.globalAlpha *= alpha * (p.alpha === undefined ? 1 : p.alpha);
  if (p.glow) { c.shadowColor = p.borderColor || col; c.shadowBlur = p.glow; }
  let fill = col;
  if (p.style === 'gradient' || p.style === 'glass') { const g = c.createLinearGradient(0, by, 0, by + sh); g.addColorStop(0, tint || p.color2 || col); g.addColorStop(1, col); fill = g; }
  c.fillStyle = fill;
  if (p.style === 'outline') { /* border only */ }
  else { rrect(c, bx, by, sw, sh, p.style === 'pixel' ? 0 : p.radius); c.fill(); }
  c.shadowBlur = 0;
  if (p.style === 'glass') { c.globalAlpha *= 0.5; c.fillStyle = '#ffffff'; rrect(c, bx + 4, by + 4, sw - 8, Math.min(sh * 0.35, 30), Math.max(2, p.radius - 4)); c.fill(); c.globalAlpha = 1; }
  if (p.style === 'pixel') { c.fillStyle = p.color2 || '#000'; const s = Math.max(4, Math.round(sw / 10)); c.fillRect(bx, by + sh - s, sw, s); c.fillRect(bx + sw - s, by, s, sh); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(bx, by, sw, s); c.fillRect(bx, by, s, sh); }
  if (p.border > 0 || p.style === 'outline') {
    c.strokeStyle = p.borderColor || '#fff'; c.lineWidth = p.border || 3;
    if (p.glow) { c.shadowColor = p.borderColor || col; c.shadowBlur = p.glow; }
    rrect(c, bx + (p.border || 3) / 2, by + (p.border || 3) / 2, sw - (p.border || 3), sh - (p.border || 3), p.radius); c.stroke();
  }
  c.restore();
}
function presetOf(idx) { return Number.isInteger(idx) && decorData.presets[idx] ? decorData.presets[idx] : null; }

// ---- thumbnail (small JPEG shown on level cards) ----
function makeLevelThumb(tilesIn, bg, brightness) {
  try {
    const W = 113, H = 200, k = H / GH, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = bg || '#202738'; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save(); c.scale(k, k);
    const tl = (tilesIn || []).slice().sort((a, b) => a.time - b.time);
    const t0 = tl.length ? tl[Math.floor(tl.length * 0.3)].time : 0, pps = EDITOR_BASE_SPEED * 60;
    decorReset([]);
    const t = t0 + 2;
    drawDecorLayer(c, 'bg', t, {});
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(i * laneW, 0); c.lineTo(i * laneW, GH); c.stroke(); }
    tl.forEach(n => {
      const bottom = lineY + (t0 - n.time) * pps, hold = n.isHold ? n.holdDuration * pps : 0, top = bottom - TILE_H - hold;
      if (top > GH || bottom < 0) return;
      const p = presetOf(n.preset);
      if (p) drawPresetBox(c, n.lane * laneW + 2, top, laneW - 4, TILE_H + hold, p, 1);
      else { c.fillStyle = '#0d0d0d'; c.fillRect(n.lane * laneW + 2, top, laneW - 4, TILE_H + hold); }
    });
    drawDecorLayer(c, 'fg', t, {});
    c.restore();
    c.strokeStyle = '#00ffff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, lineY * k); c.lineTo(W, lineY * k); c.stroke();
    return cv.toDataURL('image/jpeg', 0.6);
  } catch (e) { return null; }
}

// editor preview: replay every trigger up to time t (so the board shows the state at the playhead)
function decorEditorSync(effects, t) {
  decorReset(effects);
  const list = (effects || []).filter(e => e.time <= t).sort((a, b) => a.time - b.time);
  for (const fx of list) { decorUpdate(fx.time); decorFire(fx, fx.time, false); }
  decorUpdate(t);
}


// ============================================================================
// game.js — gameplay, practice, editor session lifecycle
// ============================================================================
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

// ---- hold tiles: a stem with a ring on the end; when you press it a bar rises up to the top of the tile as you hold ----
function holdCfg(n) {
  const col = s => /^#[0-9a-f]{6}$/i.test(String(s || '')) ? s : null, num = (v, d, lo, hi) => { if (v === '' || v === null || v === undefined) return d; v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  return { maxHold: !!n.maxHold, style: n.hstyle === 'block' ? 'block' : 'stem', bar: col(n.barColor) || '#4f8fbf', stem: col(n.stemColor) || '#ffffff', ring: col(n.ringColor) || '#ffffff', ringFill: col(n.ringFill) || '#000000',
    barA: num(n.barAlpha, 1, 0.1, 1), stemW: num(n.stemW, 5, 2, 24), ringR: num(n.ringR, 24, 8, 40), barR: num(n.barRadius, 26, 0, 45) };
}
// p < 0: not pressed yet; p 0..1: how far the bar has risen
function drawStemHold(c, lx, lw, headTop, tailTop, holdLen, p, alpha, tint, cfg, failed) {
  const cx = lx + lw / 2, ringY = headTop + TILE_H / 2, R = Math.min(cfg.ringR, lw / 2 - 3);
  c.save();
  if (p >= 0) {
    const h = TILE_H + p * holdLen, top = headTop + TILE_H - h, w = lw - 4, x = lx + 2, r = Math.max(0, Math.min(cfg.barR, w / 2, h / 2));
    c.globalAlpha = Math.max(0, Math.min(1, alpha * cfg.barA)); c.fillStyle = failed ? '#c0392b' : (tint || cfg.bar);
    c.beginPath(); c.moveTo(x, top + h); c.lineTo(x, top + r); c.arcTo(x, top, x + r, top, r); c.lineTo(x + w - r, top); c.arcTo(x + w, top, x + w, top + r, r); c.lineTo(x + w, top + h); c.closePath(); c.fill();
  }
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.fillStyle = tint || cfg.stem; c.fillRect(cx - cfg.stemW / 2, tailTop, cfg.stemW, Math.max(0, ringY - tailTop));
  c.beginPath(); c.arc(cx, ringY, R, 0, Math.PI * 2); c.fillStyle = cfg.ringFill; c.fill();
  c.lineWidth = Math.max(3, R / 6); c.strokeStyle = tint || cfg.ring; c.stroke();
  c.restore();
}
// player setting: hold a key for a while and a hold bar grows in that lane (looks only - no score, no penalty)
let lpOn = lsGet('et_lp') === '1', lpSec = Math.max(0.1, Number(lsGet('et_lpSec')) || 1), lpLen = Math.max(0.2, Number(lsGet('et_lpLen')) || 2);
function setLongPress(on, sec, len) { lpOn = !!on; lpSec = Math.max(0.1, Math.min(10, Number(sec) || 1)); lpLen = Math.max(0.2, Math.min(30, Number(len) || 2)); }
const lpDown = [0, 0, 0, 0], lpStart = [0, 0, 0, 0];
function drawLongPress() {
  if (!lpOn || !gameActive || isPaused || inEditor || isDead) { lpDown.fill(0); lpStart.fill(0); return; }
  const now = performance.now(), cfg = holdCfg({});
  for (let l = 0; l < 4; l++) {
    if (keys[keyMap[l]]) { if (!lpDown[l]) lpDown[l] = now; if (!lpStart[l] && now - lpDown[l] >= lpSec * 1000) lpStart[l] = now; }
    else { lpDown[l] = 0; lpStart[l] = 0; }
    if (lpStart[l]) {
      const p = Math.min(1, (now - lpStart[l]) / (lpLen * 1000)), len = Math.min(lineY - TILE_H, lpLen * speed * 60), headTop = lineY - TILE_H / 2;
      drawStemHold(ctx, l * laneW, laneW, headTop, headTop - len, len, p, 0.9, null, cfg, false);
    }
  }
}
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
  bar.classList.toggle('hidden', !showProgressBar || !isCustomGame || isBattleMode || !gameActive || isPlaytesting && false);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-best').style.left = getBestPct(currentLevelKey) + '%';
}

function resetState() {
  hitErrs = []; score = 0; notesHitThisGame = 0; tiles = []; particles = []; isDead = false; isPaused = false; patternStep = 0;
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

// ============================================================================
// REPLAYS + GHOSTS
// A run is recorded as the list of tiles you hit (when, which tile, which lane) plus wrong taps and how it ended - tiny, and enough to
// play it back exactly. A "ghost" is a recording drawn as translucent taps beside your own run; "Watch" plays it back on its own.
// ============================================================================
const ghostOn = () => lsGet('et_ghost') !== '0';
const ghostSrcPref = () => lsGet('et_ghostSrc') === 'top' ? 'top' : 'mine';
let rec = null, ghost = null, replayPlay = null, ghostPick = null;
const isUuidStr = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
function replayLevelId() { const a = lastStartArgs; const l = a && a[5] ? a[6] : null; return l && isUuidStr(l.id) ? l.id : null; }
function setReplayBanner(text) {
  let b = document.getElementById('replay-banner');
  if (!text) { if (b) b.classList.add('hidden'); return; }
  if (!b) { b = document.createElement('div'); b.id = 'replay-banner'; document.body.appendChild(b); }
  b.textContent = text; b.classList.remove('hidden');
}
function replayBegin() {
  rec = null; ghost = null;
  const id = replayLevelId();
  if (replayPlay && replayPlay.levelId !== id) replayPlay = null;
  if (replayPlay && replayPlay.live) {   // spectating a friend: skip everything before the moment we joined
    const from = (replayPlay.startAt || 0) * 1000, d = replayPlay.data, hi = d.h.findIndex(e => e[0] >= from), wi = d.w.findIndex(x => x >= from);
    replayPlay.i = hi < 0 ? d.h.length : hi; replayPlay.wi = wi < 0 ? d.w.length : wi;
    setReplayBanner('👁 LIVE · ' + replayPlay.username); return;
  }
  if (replayPlay) { replayPlay.i = 0; replayPlay.wi = 0; setReplayBanner('▶ REPLAY · ' + replayPlay.username + (replayPlay.completed ? ' · ✔ 100%' : ' · ' + replayPlay.pct + '%')); return; }
  setReplayBanner(null);
  if (!id || isPlaytesting || isVerifying || isBattleMode || practiceMode) return;
  rec = { h: [], w: [], end: 0, died: null, salt: dSalt };
  if (typeof liveStart === 'function') liveStart();
  if (ghostOn()) ghostLoad(id, customPlayTime);
}
async function ghostLoad(id, startedAt) {
  let g = null;
  try {
    if (ghostPick && ghostPick.id === id) g = ghostPick.ghost;
    else if (ghostSrcPref() === 'mine') { const o = JSON.parse(localStorage.getItem('et_rp_' + id) || 'null'); if (o && o.data) g = { username: 'You', pct: o.pct, completed: o.completed, data: o.data }; }
    else g = (await apiRequest('/api/levels/' + encodeURIComponent(id) + '/ghost?who=top')).ghost;
  } catch (e) { return; }
  if (!g || !g.data || !Array.isArray(g.data.h) || replayLevelId() !== id || !rec) return;
  ghost = { name: g.username, pct: g.pct, completed: !!g.completed, h: g.data.h, end: g.data.end || 0, i: 0, score: 0, flashes: [] };
  const now = customPlayTime * 1000;
  while (ghost.i < ghost.h.length && ghost.h[ghost.i][0] <= now) { ghost.i++; ghost.score += 10; }
}
function ghostTick() {
  if (!ghost) return;
  const now = customPlayTime * 1000;
  while (ghost.i < ghost.h.length && ghost.h[ghost.i][0] <= now) { ghost.flashes.push({ lane: ghost.h[ghost.i][2], t0: customPlayTime }); ghost.i++; ghost.score += 10; }
  ghost.flashes = ghost.flashes.filter(f => customPlayTime - f.t0 < 0.4);
}
function drawGhost() {
  if (!ghost || !gameActive) return;
  ctx.save();
  for (const f of ghost.flashes) {
    const k = 1 - (customPlayTime - f.t0) / 0.4;
    ctx.globalAlpha = Math.max(0, k) * 0.5; ctx.fillStyle = '#8be9ff'; ctx.fillRect(f.lane * laneW + 4, lineY - TILE_H + (1 - k) * 18, laneW - 8, TILE_H);
    ctx.globalAlpha = Math.max(0, k) * 0.9; ctx.strokeStyle = '#d6f6ff'; ctx.lineWidth = 2; ctx.strokeRect(f.lane * laneW + 4, lineY - TILE_H + (1 - k) * 18, laneW - 8, TILE_H);
  }
  const gp = ghost.completed && customPlayTime * 1000 >= ghost.end ? 100 : Math.min(ghost.pct, levelLastNoteTime > 0 ? Math.floor(Math.min(customPlayTime, ghost.end / 1000) / levelLastNoteTime * 100) : 0);
  if (dVFlip) ctx.transform(1, 0, 0, -1, 0, GH);       // keep the label the right way up on a flipped board
  ctx.globalAlpha = 0.85; ctx.fillStyle = '#8be9ff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('👻 ' + ghost.name + ' · ' + gp + '% · ' + ghost.score, GW / 2, 8);
  ctx.restore();
}
function replayInject() {
  const d = replayPlay && replayPlay.data; if (!d) return;
  const now = customPlayTime * 1000;
  while (replayPlay.i < d.h.length && d.h[replayPlay.i][0] <= now) {
    const e = d.h[replayPlay.i++], t = tiles.find(x => x.noteIdx === e[1] && !x.interacted);
    if (!t) continue;
    if (t.tapsLeft > 1) { t.tapsLeft--; score += 10; for (let k = 0; k < 5; k++) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY)); if (typeof playLaneSound === 'function') playLaneSound(t.lane); continue; }
    t.interacted = true; score += 10; notesHitThisGame++;
    for (let k = 0; k < 8; k++) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY));
    if (typeof playLaneSound === 'function') playLaneSound(t.lane);
  }
  while (replayPlay.wi < d.w.length && d.w[replayPlay.wi] <= now) { replayPlay.wi++; if (!handleHit()) { die('WRONG ORDER!'); return; } }
  if (d.died && d.end && now >= d.end && !isDead) die(d.died);
}
function replaySave(completed) {
  const r = rec; rec = null;
  if (typeof liveFinish === 'function') liveFinish(r, completed);
  if (!r || replayPlay || !r.h.length) return;
  const id = replayLevelId(); if (!id) return;
  const pct = completed ? 100 : Math.max(0, Math.min(99, Math.floor(customPlayTime / Math.max(1, levelLastNoteTime) * 100))), sc = Math.floor(score);
  if (!r.end) r.end = Math.round(customPlayTime * 1000);
  const body = { pct, score: sc, completed: !!completed, data: r };
  try {
    const k = 'et_rp_' + id, old = JSON.parse(localStorage.getItem(k) || 'null');
    const better = !old || (completed && !old.completed) || (!!completed === !!old.completed && (pct > old.pct || (pct === old.pct && sc > old.score)));
    if (!better) return;
    localStorage.setItem(k, JSON.stringify(body));
    const idx = JSON.parse(localStorage.getItem('et_rp_index') || '[]').filter(x => x !== id); idx.push(id);
    while (idx.length > 40) localStorage.removeItem('et_rp_' + idx.shift());
    localStorage.setItem('et_rp_index', JSON.stringify(idx));
  } catch (e) { return; }
  if (getAuthToken() && API_BASE_URL && !localStorage.getItem('et_imp_backup')) apiRequest('/api/levels/' + encodeURIComponent(id) + '/replay', { method: 'POST', auth: true, body }).catch(() => {});
}
// watch someone's replay: plays the level by itself from their recording
function startReplayWatch(level, g) {
  replayPlay = { levelId: level.id, username: g.username, pct: g.pct, completed: !!g.completed, data: g.data, i: 0, wi: 0 };
  startGame(level.name, true, -1, level.data, level.effects || [], true, level);
}

function triggerRedFlash() {
  if (a11yCalm) return;
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
  { const pbar = document.getElementById('progress-bar'); if (pbar && !show) pbar.classList.add('hidden'); }
}

function editorLevelConfig() {
  return {
    strictMode: !!(document.getElementById('edit-strict') && document.getElementById('edit-strict').checked),
    lockCosmetics: !!(document.getElementById('edit-lock-cos') && document.getElementById('edit-lock-cos').checked),
    hideHitboxes: !!(document.getElementById('edit-hide-hb') && document.getElementById('edit-hide-hb').checked),
    showLetters: !!(document.getElementById('edit-show-letters') && document.getElementById('edit-show-letters').checked),
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
    dSalt = (replayPlay && replayPlay.data && Number.isFinite(replayPlay.data.salt)) ? replayPlay.data.salt >>> 0 : isBattleMode ? 0 : (Math.random() * 4294967296) >>> 0;   // replays reuse the recorded roll; battles share one fixed roll

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
    metro = { bpm: Math.max(30, Number(sourceLevel ? sourceLevel.bpm : editorBpm) || 120), off: Number(sourceLevel ? sourceLevel.gridOffset : editorGridOffset) || 0, n: -1 };
    strictMode = sourceLevel ? !!sourceLevel.strictMode : !!(document.getElementById('edit-strict') && document.getElementById('edit-strict').checked);
    hitZone = defaultHitZone(); tileHb = { scale: 1, offset: 0 }; tileMoveFx = null; tileHideFx = null; tileFreezeUntil = 0; tileLag = 0;
    levelHideHitboxes = sourceLevel ? !!sourceLevel.hideHitboxes : !!(document.getElementById('edit-hide-hb') && document.getElementById('edit-hide-hb').checked);
    levelShowLetters = sourceLevel ? !!sourceLevel.showLetters : !!(document.getElementById('edit-show-letters') && document.getElementById('edit-show-letters').checked);
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
    else if (startPosArmed && (isPlaytesting || isVerifying) && editorStartPos !== null) fastForwardTo(editorStartPos);
    else if (replayPlay && replayPlay.live && replayPlay.startAt > 0) fastForwardTo(replayPlay.startAt);
    startPosArmed = false;
    practiceNextAuto = (practiceMode ? Math.max(customPlayTime, practiceStartSec) : 0) + autoCheckpointSec;
    replayBegin();
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
  if (a11yCalm) return;
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
    default: return hitLineColor();
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
    else if (!['pulse', 'image', 'extra_image', 'sfx', 'video', 'tilemove', 'tilehide', 'tilefreeze'].includes(fx.type)) { decorUpdate(fx.time); decorFire(fx, fx.time, true); }
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
  if (customPlayTime < tileFreezeUntil) tileLag += dtSec;

  if (levelUsesAudio && !levelAudioStarted && customPlayTime * 1000 + levelAudioOffsetMs >= 0) {
    levelAudioStarted = true;
    try { bgAudio.currentTime = Math.max(0, customPlayTime + levelAudioOffsetMs / 1000); } catch (e) {}
    bgAudio.play().catch(() => {});
  }

  const pxPerSec = speed * 60;
  while (pendingTileIdx < pendingTiles.length) {
    const n = pendingTiles[pendingTileIdx];
    const spawnAt = n.time - 690 / pxPerSec, ctl = customPlayTime - tileLag;
    if (ctl < spawnAt) break;
    // If a frame ran long, start the tile where it *should* be so arrival time stays exact.
    const y = -TILE_H + pxPerSec * (ctl - spawnAt);
    const bl = dLane[pendingTileIdx] !== undefined ? dLane[pendingTileIdx] : n.lane;
    const nt = new Tile(laneFlipAt(n.time) ? 3 - bl : bl, y, levelDisableHolds ? false : n.isHold, n.holdDuration);
    nt.noteIdx = pendingTileIdx; nt.time = n.time; nt.preset = n.preset;
    if (nt.isHold) nt.hold = holdCfg(n);
    if (!nt.isHold && n.taps > 1) { nt.taps = Math.min(8, n.taps | 0); nt.tapsLeft = nt.taps; }
    if (!nt.isHold && (n.fake === 1 || n.fake === 2)) { nt.fake = n.fake; nt.fakeA = Number.isFinite(Number(n.fakeAlpha)) && n.fakeAlpha !== '' ? Math.max(0.05, Math.min(1, Number(n.fakeAlpha))) : (n.fake === 1 ? 0.35 : 1); }
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
    else if (fx.type === 'tilefreeze') tileFreezeUntil = Math.max(tileFreezeUntil, fx.time + Math.max(0.1, Math.min(30, Number(fx.duration) || 2)));
    else if (fx.type === 'video') fireVideo(fx);
    else decorFire(fx, fx.time, false);
  }
  if (replayPlay) replayInject();
  metroTick();
  if (ghost) ghostTick();
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

  if (isVerifying && verifyPartial) {
    isVerifying = false; verifyPartial = false; levelVerified = false; pendingPublishAfterVerification = false;
    showGameHud(false); enterEditorView();
    toast('Finished from the start position. That does NOT count as verified. Verify from the beginning to publish.', 'bad');
  } else if (isVerifying) {
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
    if (rec) { rec.end = Math.round(customPlayTime * 1000); rec.died = null; }
    if (!replayPlay) markVerifiedByPlay();
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
  renderTimingBar();
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
  if (!gameActive || isDead || inEditor || isPaused || replayPlay) return;
  let decoy = null, realHere = null;             // a decoy tile in this lane: tapping it kills you (unless the real tile in the lane is nearer)
  for (const t of tiles) { if (t.interacted || t.lane !== laneIndex || !inInputZone(t)) continue; if (t.fake === 2) { if (!decoy || t.y > decoy.y) decoy = t; } else if (!t.fake && (!realHere || t.y > realHere.y)) realHere = t; }
  if (decoy && (!realHere || decoy.y > realHere.y + 8)) { die('FAKE TILE!'); return; }
  let nearestAll = null;                         // the next tile in order, whatever the zone says
  for (const t of tiles) if (!t.interacted && t.fake !== 1 && t.fake !== 2 && (!nearestAll || t.y > nearestAll.y)) nearestAll = t;
  if (!nearestAll) return;
  let nearest = null, target = null;             // among tiles inside the input zone
  for (const t of tiles) {
    if (t.interacted || t.fake || !inInputZone(t)) continue;
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
  if (ok && target.tapsLeft > 1) {              // multi-tap tile: every tap counts, the last one clears it
    target.tapsLeft--; score += 10;
    if (rec) rec.h.push([Math.round(customPlayTime * 1000), target.noteIdx === undefined ? -1 : target.noteIdx, laneIndex]);
    for (let i = 0; i < 5; i++) particles.push(new Particle(laneIndex * laneW + laneW / 2, lineY));
    if (typeof playLaneSound === 'function') playLaneSound(laneIndex);
    return;
  }
  if (ok && !replayPlay && target.time !== undefined && isCustomGame) hitErrs.push(Math.round((customPlayTime + Math.max(0, Math.min(0.05, (performance.now() - lastTime) / 1000)) - target.time) * 1000));
  if (ok) {
    target.interacted = true; score += 10; notesHitThisGame++;
    if (rec) rec.h.push([Math.round(customPlayTime * 1000), target.noteIdx === undefined ? -1 : target.noteIdx, laneIndex]);
    for (let i = 0; i < 8; i++) particles.push(new Particle(laneIndex * laneW + laneW / 2, lineY));
    if (typeof playLaneSound === 'function') playLaneSound(laneIndex);
    if (globeOn && typeof globeTap === 'function') globeTap(target.noteIdx, laneIndex);
  } else if (nearestY - TILE_H < GH && nearestY + TILE_H > 0) {
    if (rec) rec.w.push(Math.round(customPlayTime * 1000));
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
// ---- PC mouse: a cursor that snaps to the lane you move into (setting: middle of the lane, or down by the hit line) ----
// ---- accessibility ----
let a11yCb = lsGet('et_cb') === '1', a11yOutline = Math.max(0, Math.min(2, Number(lsGet('et_outline')) || 0)), a11yCalm = lsGet('et_calm') === '1';
const hitLineColor = () => a11yCb ? '#ffb000' : '#00ffff';
function setA11y(key, v) {
  if (key === 'cb') { a11yCb = !!v; const f = document.getElementById('red-flash'); if (f) f.style.background = a11yCb ? '#ffb000' : ''; }
  else if (key === 'outline') a11yOutline = Math.max(0, Math.min(2, Number(v) || 0));
  else if (key === 'calm') a11yCalm = !!v;
}
// ---- rhythm feel: metronome + hit-timing bar ----
let metroOn = lsGet('et_metro') === '1', timingBarOn = lsGet('et_tbar') !== '0', metro = null, hitErrs = [], metroCtx = null;
function setRhythm(key, v) { if (key === 'metro') metroOn = !!v; else if (key === 'tbar') timingBarOn = !!v; }
function metroClick(strong) {
  try {
    metroCtx = metroCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = metroCtx.createOscillator(), g = metroCtx.createGain(), t0 = metroCtx.currentTime;
    o.frequency.value = strong ? 1500 : 1000; g.gain.setValueAtTime(0.18, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    o.connect(g); g.connect(metroCtx.destination); o.start(t0); o.stop(t0 + 0.06);
  } catch (e) {}
}
function metroTick() {
  if (!metroOn || !metro || isDead || replayPlay) return;
  const spb = 60 / metro.bpm, k = Math.floor((customPlayTime - metro.off) / spb);
  if (metro.n === -1) { metro.n = k; return; }
  if (k > metro.n) { if (customPlayTime - metro.off - k * spb < 0.12) metroClick(((k % 4) + 4) % 4 === 0); metro.n = k; }
}
function renderTimingBar() {
  const host = document.getElementById('timing-bar'); if (!host) return;
  const e = hitErrs.filter(x => Math.abs(x) <= 300);
  if (!timingBarOn || e.length < 3) { host.innerHTML = ''; return; }
  const avg = Math.round(e.reduce((a, b) => a + b, 0) / e.length), sd = Math.round(Math.sqrt(e.reduce((a, b) => a + (b - avg) * (b - avg), 0) / e.length));
  const pos = v => (50 + Math.max(-150, Math.min(150, v)) / 150 * 50).toFixed(1);
  const dots = e.slice(-120).map(v => '<i style="left:' + pos(v) + '%"></i>').join('');
  host.innerHTML = '<div class="tb-track"><span class="tb-zone"></span>' + dots + '<b class="tb-avg" style="left:' + pos(avg) + '%"></b></div>' +
    '<div class="tb-labels"><span>◀ early</span><span>perfect</span><span>late ▶</span></div>' +
    '<div class="tb-text">Average ' + (avg > 0 ? '+' : '') + avg + ' ms ' + (Math.abs(avg) < 8 ? '(right on time)' : avg > 0 ? '(a little late)' : '(a little early)') + ' · spread ±' + sd + ' ms</div>';
}
let mouseSnapOn = lsGet('et_mouseSnap') !== '0', mouseSnapPos = lsGet('et_mouseSnapPos') === 'bottom' ? 'bottom' : 'mid';
const mouseSnap = { x: 0, y: 0, in: false };
function setMouseSnap(on, pos) { mouseSnapOn = !!on; mouseSnapPos = pos === 'bottom' ? 'bottom' : 'mid'; if (!mouseSnapOn) canvas.style.cursor = ''; }
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const rect = canvas.getBoundingClientRect();
  mouseSnap.x = (e.clientX - rect.left) / rect.width * GW; mouseSnap.y = (e.clientY - rect.top) / rect.height * GH; mouseSnap.in = true;
  canvas.style.cursor = (mouseSnapOn && gameActive && !inEditor && !isPaused && !isDead) ? 'none' : '';
});
canvas.addEventListener('pointerleave', () => { mouseSnap.in = false; canvas.style.cursor = ''; });
function drawMouseSnap() {
  if (!mouseSnapOn || !mouseSnap.in || !gameActive || inEditor || isPaused || isDead) return;
  const lane = Math.max(0, Math.min(3, Math.floor(mouseSnap.x / laneW)));
  const cx = lane * laneW + laneW / 2, cy = mouseSnapPos === 'bottom' ? Math.min(GH - 28, lineY + 62) : Math.max(20, Math.min(GH - 20, mouseSnap.y));
  ctx.save(); ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.fillStyle = 'rgba(0,255,255,0.08)'; ctx.fillRect(lane * laneW, 0, laneW, GH);          // the lane you are in
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#00ffff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
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
    const open = document.getElementById('drawer-left').classList.contains('open') && !document.getElementById('editor-ui').classList.contains('docked');
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
  ctx.strokeStyle = hitLineColor(); ctx.lineWidth = 4;
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
    if (!inEditor || edShow.decor) drawDecorLayer(ctx, 'bg', ct, inEditor ? { ghost: true } : {});
    dVFlip = vFlipAt(ct); }
  if (dVFlip) ctx.transform(1, 0, 0, -1, 0, GH);   // upside-down board: tiles rise from the bottom
  drawBoard();

  if (!isCustomGame && !inEditor && gameActive) {
    distanceTraveled += speed * dt;
    if (distanceTraveled >= nextSpawnDistance) spawnTile();
  }
  if (restEl) restEl.style.opacity = (gameActive && !isCustomGame && !inEditor && tiles.length === 0) ? '1' : '0';

  if (inEditor) drawEditorLayer();

  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i]; if (!(customPlayTime < tileFreezeUntil)) t.y += speed * dt;
    const holdLength = t.isHold ? (t.holdDuration * speed * 60) : 0;
    const headTop = t.y - TILE_H;
    const tailTop = t.y - TILE_H - holdLength;

    if ((t.interacted || t.fake ? tailTop : headTop) > GH) {
      if (!t.interacted && !t.fake) {
        if (handleHit()) { tiles.splice(i, 1); continue; }
        else { die("MISSED!"); return; }
      }
      tiles.splice(i, 1); continue;
    }

    let holdP = -1;
    if (t.isHold && t.interacted) {
      if (t.holdY0 === undefined) t.holdY0 = t.y;
      const hl = Math.max(1, holdLength);
      const p = t.released ? t.relP : Math.max(0, Math.min(1, (t.y - t.holdY0) / hl));
      if (!t.released && !t.holdDone) {
        if (p >= 1) { t.holdDone = true; for (let k = 0; k < 10; k++) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY)); }
        else if (!replayPlay && !keys[keyMap[t.lane]]) {
          t.released = true; t.relP = p;
          if (t.hold && t.hold.maxHold) {                 // "Max Hold" tile: you can't let go before the bar is full
            t.failed = true;
            if (rec) rec.w.push(Math.round(customPlayTime * 1000));
            if (!handleHit()) { die("RELEASED EARLY!"); return; }
          }
        } else if (Math.random() > 0.8) particles.push(new Particle(t.lane * laneW + laneW / 2, lineY));
      }
      holdP = t.holdDone ? 1 : p;
    }

    const ox = tileOffsetX(t);
    const hideMul = tileAlphaMul(headTop) * (t.fake ? t.fakeA : 1);
    const ds = t.groups ? decorCombined(t.groups) : null;
    if (ds && !ds.vis) { ctx.globalAlpha = 1; continue; }
    const xform = ds && (ds.dx || ds.dy || ds.rot || ds.sc !== 1);
    if (xform) { const cx = t.lane * laneW + laneW / 2 + ox, cy = headTop + TILE_H / 2; ctx.save(); ctx.translate(cx + ds.dx, cy + ds.dy); ctx.rotate(ds.rot * Math.PI / 180); ctx.scale(ds.sc, ds.sc); ctx.translate(-cx, -cy); }
    const dA = ds ? ds.a : 1, pr = presetOf(t.preset), tint = ds && ds.col;
    const stemStyle = t.isHold && t.hold && t.hold.style === 'stem';
    if (stemStyle) drawStemHold(ctx, t.lane * laneW + ox, laneW, headTop, tailTop, holdLength, holdP, hideMul * dA, tint, t.hold, t.failed);
    if (t.isHold && !stemStyle) {
      if (pr) { ctx.globalAlpha = 1; drawPresetBox(ctx, t.lane * laneW + 12 + ox, tailTop, laneW - 24, holdLength, Object.assign({}, pr, { style: pr.style === 'outline' ? 'outline' : 'flat', color: pr.holdColor || pr.color, wide: 1, tall: 1, radius: Math.min(pr.radius, 10) }), (t.interacted ? 0.3 : 1) * hideMul * dA, tint); }
      else { ctx.globalAlpha = hideMul * dA; ctx.fillStyle = t.interacted ? "#333" : (tint || "#000"); ctx.fillRect(t.lane * laneW + 12 + ox, tailTop, laneW - 24, holdLength); }
    }
    if (stemStyle) { /* drawn above */ }
    else if (pr) { ctx.globalAlpha = 1; drawPresetBox(ctx, t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H, pr, (t.interacted ? 0.25 : currentTileStyle.alpha) * hideMul * dA, tint); }
    else {
      ctx.globalAlpha = (t.interacted ? 0.25 : currentTileStyle.alpha) * hideMul * dA;
      ctx.fillStyle = t.interacted ? "#222" : (tint || tileFill());
      ctx.fillRect(t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H);
    }
    if (a11yCb && t.isHold && !stemStyle) { ctx.globalAlpha = 0.8 * hideMul * dA; ctx.fillStyle = '#fff'; ctx.fillRect(t.lane * laneW + laneW / 2 - 3 + ox, tailTop, 6, holdLength + TILE_H * 0.5); }   // hold tiles get a white spine (not just a different colour)
    if (a11yOutline && !t.interacted) { ctx.globalAlpha = Math.max(0.5, hideMul * dA); ctx.strokeStyle = '#fff'; ctx.lineWidth = a11yOutline === 2 ? 5 : 2.5; ctx.strokeRect(t.lane * laneW + 3 + ox, headTop + 1, laneW - 6, TILE_H - 2); }
    if (t.tapsLeft > 0 && !t.interacted) {
      ctx.globalAlpha = Math.max(0.35, hideMul * dA); ctx.fillStyle = '#fff'; ctx.font = '800 44px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 5; const tx = t.lane * laneW + laneW / 2 + ox, ty = headTop + TILE_H / 2;
      ctx.strokeText('×' + t.tapsLeft, tx, ty); ctx.fillText('×' + t.tapsLeft, tx, ty); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
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
    if (showHitboxes && !levelHideHitboxes) {
      ctx.globalAlpha = 1; ctx.strokeStyle = "#ff3b81"; ctx.lineWidth = 2;
      ctx.strokeRect(t.lane * laneW + 2 + ox, headTop, laneW - 4, TILE_H);
    }
    if (showLaneText || levelShowLetters) {
      ctx.globalAlpha = 1; ctx.fillStyle = "#ffffff"; ctx.font = "700 28px Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(keyMap[t.lane].toUpperCase(), t.lane * laneW + laneW / 2 + ox, headTop + TILE_H / 2);
    }
    ctx.globalAlpha = 1.0;
  }
  if (showHitboxes && !levelHideHitboxes && gameActive && isCustomGame) drawHitboxOverlay();
  if (dVFlip) ctx.transform(1, 0, 0, -1, 0, GH);
  if (!inEditor || edShow.decor) drawDecorLayer(ctx, 'fg', inEditor ? editorTimer : customPlayTime, inEditor ? { ghost: true } : {});
  if (dVFlip) { decorCameraEnd(ctx); }
  decorCameraEnd(ctx);
  if (globeOn && typeof globeLevelId !== 'undefined' && globeLevelId && gameActive) drawGlobeHud();

  if (dVFlip) ctx.transform(1, 0, 0, -1, 0, GH);
  drawGhost();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update(dt);
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color || "#00ffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1.0;
  if (dVFlip) ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  drawLongPress();
  drawMouseSnap();
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
  if (rec) { rec.end = Math.round(customPlayTime * 1000); rec.died = String(reason || 'FAILED').slice(0, 30); }
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
    renderTimingBar();
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
  const hh = document.getElementById('edit-hide-hb'); if (hh) hh.checked = existingLevel ? !!existingLevel.hideHitboxes : false;
  const sl = document.getElementById('edit-show-letters'); if (sl) sl.checked = existingLevel ? !!existingLevel.showLetters : false;
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
