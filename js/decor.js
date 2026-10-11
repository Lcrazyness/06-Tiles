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
  { kind: 'glow', icon: '✺', label: 'Glow' }, { kind: 'image', icon: '🖼', label: 'Image' }, { kind: 'text', icon: 'T', label: 'Text' }
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
let dFlips = [];                                             // [{time,on}]
let dFlipOnStart = false;

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
function gs(g) { return dGS[g] || (dGS[g] = { dx: 0, dy: 0, rot: 0, sc: 1, a: 1, vis: 1, col: null, colFrom: null, cp: 1 }); }

function decorReset(effects) {
  dGS = {}; dTween = []; dCam = { shakeT0: 0, shakeDur: 0, shakeStr: 0, zoom: 1 }; dBg = null;
  dFlips = (effects || []).filter(e => e.type === 'laneflip').map(e => ({ time: Number(e.time) || 0, on: Number(e.on) !== 0 })).sort((a, b) => a.time - b.time);
}
// is a tile with chart time `t` mirrored (lane flip)?
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
    case 'shake': if (!instant) { dCam.shakeT0 = t; dCam.shakeDur = Math.max(0.05, Number(fx.dur) || 0.4); dCam.shakeStr = Number(fx.strength) || 8; } break;
    case 'zoom': addTween(dCam, 'zoom', Math.max(0.3, Math.min(3, Number(fx.zoom) || 1)), t, dur, ez); break;
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
