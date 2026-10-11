// ============================================================================
// ui.js — shared UI plumbing: screen switching, responsive canvas layout,
// non-blocking dialogs/toasts (replacing alert/confirm/prompt, which froze the
// whole game and looked awful), and a few small helpers.
// ============================================================================

// Overlays that sit on top of a live game instead of replacing the whole screen.
const TRANSLUCENT_OVERLAYS = ['death-screen', 'pause-menu'];

function toggleMenu(id) {
  overlays.forEach(o => { const el = document.getElementById(o); if (el) el.classList.add('hidden'); });
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); const body = el.querySelector('.screen-body'); if (body) body.scrollTop = 0; }
  }
  document.body.classList.toggle('menus-open', !!id && !TRANSLUCENT_OVERLAYS.includes(id));
}

function wireSpeedSliders() {
  document.querySelectorAll('.speed-control input[type="range"]').forEach(slider => {
    const label = document.getElementById('val-' + slider.id.replace('speed-', ''));
    slider.addEventListener('input', () => { if (label) label.innerText = slider.value; });
    // don't let dragging a slider start the level underneath it
    slider.addEventListener('click', e => e.stopPropagation());
  });
}

// ---------------------------------------------------------------------------
// Canvas layout: fill the screen (game) or the space between the top bar and
// the timeline (editor). The board stays 360x640 logically; the backing store
// is scaled to the real pixel size so tiles stay crisp on big/hi-dpi screens.
// ---------------------------------------------------------------------------
function layoutCanvas() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = 0, availH = vh;
  if (inEditor) {
    const bar = 98;
    const dock = document.getElementById('timeline-dock');
    const dockH = dock ? (dock.classList.contains('collapsed') ? 34 : dock.offsetHeight) : 0;
    top = bar;
    availH = Math.max(160, vh - bar - dockH - 4);
  }
  const scale = Math.min(vw / GW, availH / GH);
  const cssW = Math.max(120, Math.floor(GW * scale));
  const cssH = Math.max(214, Math.floor(GH * scale));
  const left = Math.floor((vw - cssW) / 2);
  const y = Math.floor(top + (availH - cssH) / 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.left = left + 'px';
  canvas.style.top = y + 'px';

  const dpr = window.devicePixelRatio || 1;
  const S = Math.max(1, Math.min(3, (cssW * dpr) / GW));
  const bw = Math.round(GW * S), bh = Math.round(GH * S);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  renderScale = bw / GW;

  // keep the "extra image" effect layers lined up with the board, not the window
  ['extra-images-bg', 'extra-images-fg'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = left + 'px'; el.style.top = y + 'px';
    el.style.width = cssW + 'px'; el.style.height = cssH + 'px';
  });
  const hud = document.getElementById('hud-frame');
  if (hud) { hud.style.left = left + 'px'; hud.style.top = y + 'px'; hud.style.width = cssW + 'px'; hud.style.height = cssH + 'px'; }
  if (!gameActive && !isPaused) { try { drawIdleFrame(); } catch (e) {} }
}
window.addEventListener('resize', layoutCanvas);
window.addEventListener('orientationchange', () => setTimeout(layoutCanvas, 200));

// ---------------------------------------------------------------------------
// Toasts + dialogs
// ---------------------------------------------------------------------------
function toast(message, kind) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.textContent = message;
  host.appendChild(el);
  while (host.children.length > 3) host.removeChild(host.firstChild);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, 3200);
}

let dialogResolve = null;
function dialogOpen() { const d = document.getElementById('dialog'); return (!!d && !d.classList.contains('hidden')) || !!document.getElementById('form-dialog'); }

function openDialog({ title = '', message = '', input = false, defaultValue = '', okText = 'OK', cancelText = null, danger = false }) {
  return new Promise(resolve => {
    if (dialogResolve) dialogResolve(null);
    const d = document.getElementById('dialog');
    const inp = document.getElementById('dialog-input');
    const ok = document.getElementById('dialog-ok');
    const cancel = document.getElementById('dialog-cancel');
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-msg').textContent = message;
    inp.classList.toggle('hidden', !input);
    inp.value = defaultValue;
    ok.textContent = okText;
    ok.classList.toggle('danger', !!danger);
    cancel.textContent = cancelText || 'Cancel';
    cancel.classList.toggle('hidden', !cancelText);
    const finish = value => {
      d.classList.add('hidden');
      dialogResolve = null;
      ok.onclick = cancel.onclick = null;
      d.onkeydown = null;
      resolve(value);
    };
    dialogResolve = finish;
    ok.onclick = () => finish(input ? inp.value : true);
    cancel.onclick = () => finish(input ? null : false);
    d.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); ok.onclick(); }
      else if (e.key === 'Escape') { e.preventDefault(); (cancelText ? cancel : ok).onclick(); }
    };
    d.classList.remove('hidden');
    setTimeout(() => (input ? inp : ok).focus(), 30);
  });
}
const uiAlert = (message, title = '') => openDialog({ title, message, okText: 'OK' });
const uiConfirm = (message, okText = 'Yes', danger = false) => openDialog({ message, okText, cancelText: 'Cancel', danger });
const uiPrompt = (message, defaultValue = '', okText = 'Save') => openDialog({ message, input: true, defaultValue, okText, cancelText: 'Cancel' });

// A dialog with real form fields (select / textarea / text). Resolves to {fieldId: value} or null.
function openFormDialog({ title = '', message = '', fields = [], okText = 'OK', danger = false }) {
  return new Promise(resolve => {
    const host = document.createElement('div');
    host.id = 'form-dialog';
    const fieldHtml = fields.map(f => {
      const label = '<label class="form-label" for="ff-' + f.id + '">' + escapeHtml(f.label || '') + '</label>';
      if (f.type === 'select') return label + '<select id="ff-' + f.id + '" class="form-input">' + f.options.map(o => '<option value="' + escapeHtml(String(o.value)) + '"' + (String(o.value) === String(f.value) ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>').join('') + '</select>';
      if (f.type === 'textarea') return label + '<textarea id="ff-' + f.id + '" class="form-input" rows="' + (f.rows || 4) + '" maxlength="' + (f.maxlength || 600) + '">' + escapeHtml(f.value || '') + '</textarea>';
      if (f.type === 'file') return label + '<input id="ff-' + f.id + '" class="form-input" type="file" accept="' + escapeHtml(f.accept || 'image/*') + '">';
      if (f.type === 'checkbox') return '<label class="form-check"><input id="ff-' + f.id + '" type="checkbox"' + (f.value ? ' checked' : '') + '> ' + escapeHtml(f.label || '') + '</label>';
      return label + '<input id="ff-' + f.id + '" class="form-input" type="' + (f.type || 'text') + '" maxlength="' + (f.maxlength || 120) + '" value="' + escapeHtml(f.value || '') + '">';
    }).join('');
    host.innerHTML = '<div class="dialog-box"><h3>' + escapeHtml(title) + '</h3>' + (message ? '<p>' + escapeHtml(message) + '</p>' : '') + fieldHtml +
      '<div class="row-btns"><button class="btn btn-ghost" id="ff-cancel">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-play') + '" id="ff-ok">' + escapeHtml(okText) + '</button></div></div>';
    document.body.appendChild(host);
    const close = value => { host.remove(); resolve(value); };
    host.querySelector('#ff-cancel').onclick = () => close(null);
    host.querySelector('#ff-ok').onclick = () => { const out = {}; fields.forEach(f => { const i = host.querySelector('#ff-' + f.id); if (f.type === 'file') { out[f.id] = i.value; out[f.id + 'File'] = i.files && i.files[0]; } else if (f.type === 'checkbox') out[f.id] = i.checked; else out[f.id] = i.value; }); close(out); };
    host.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } });
    setTimeout(() => { const first = host.querySelector('.form-input'); if (first) first.focus(); }, 30);
  });
}

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function isTypingTarget(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  return t.tagName === 'INPUT' && !['checkbox', 'range', 'button', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function artGradient(seed) {
  const h = hashString(String(seed || '?')) % 360;
  return 'linear-gradient(135deg, hsl(' + h + ',78%,58%), hsl(' + ((h + 48) % 360) + ',70%,32%))';
}

// Shrinks an uploaded image to a small JPEG data URL (a 1MB photo becomes ~15KB),
// which keeps Browse and the database fast.
function downscaleImage(file, maxSize = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio)), h = Math.max(1, Math.round(img.height * ratio));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#1a1030'; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Falling-tile backdrop shared by every menu screen.
function initMenuBackdrop() {
  const host = document.getElementById('menu-bg-tiles');
  if (!host || host.childElementCount) return;
  for (let i = 0; i < 12; i++) {
    const t = document.createElement('div');
    t.className = 'bg-tile';
    const lane = i % 4;
    t.style.left = (lane * 25 + 1.2) + '%';
    t.style.width = '22.6%';
    t.style.height = (16 + Math.random() * 14) + 'vh';
    t.style.animationDuration = (9 + Math.random() * 9) + 's';
    t.style.animationDelay = (-Math.random() * 18) + 's';
    t.style.opacity = (0.10 + Math.random() * 0.14).toFixed(2);
    host.appendChild(t);
  }
}

// Builds the standard screen layout (header with back button + scrolling body).
function screenHtml(title, backTarget, bodyHtml, rightHtml = '') {
  return '<div class="screen-header"><button class="back-btn" onclick="' + (backTarget || "toggleMenu('main-menu')") + '">‹</button><h2>' + title + '</h2><div class="header-right">' + rightHtml + '</div></div>' +
    '<div class="screen-body"><div class="screen-col">' + bodyHtml + '</div></div>';
}

document.addEventListener('DOMContentLoaded', () => {
  const g = document.getElementById('setting-globe');
  if (g) { g.checked = globeOn; g.addEventListener('change', () => { globeOn = g.checked; localStorage.setItem('et_globe', String(globeOn)); if (!globeOn) globeGhosts.clear(); if (typeof globeSync === 'function') globeSync(); }); }
});


// ---------------------------------------------------------------------------
// Input sounds: one sound per lane, uploaded from your computer (kept in this browser's IndexedDB).
// Played through WebAudio so there is no delay on tap.
// ---------------------------------------------------------------------------
const LaneSounds = (() => {
  const DB = 'et_sounds', STORE = 'sounds';
  let db = null, ac = null;
  const buffers = [null, null, null, null];
  let vol = Number(localStorage.getItem('et_laneSoundVol'));
  if (!Number.isFinite(vol) || localStorage.getItem('et_laneSoundVol') === null) vol = 0.8;

  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const idb = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const tx = d.transaction(STORE, mode); const req = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
  };
  const audioCtx = () => {
    if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ac = new C(); }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  const decode = async blob => {
    const a = audioCtx(); if (!a) throw new Error('Audio is not supported here.');
    const data = await blob.arrayBuffer();
    return new Promise((res, rej) => a.decodeAudioData(data, res, rej));
  };
  const nameOf = i => localStorage.getItem('et_laneSoundName' + i) || '';

  function refreshUi() {
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById('ls-name-' + i);
      if (el) el.textContent = buffers[i] ? nameOf(i) || 'Custom sound' : 'Default (silent)';
    }
  }
  async function load() {
    try { for (let i = 0; i < 4; i++) { const blob = await idb('readonly', s => s.get('lane' + i)); buffers[i] = blob ? await decode(blob).catch(() => null) : null; } } catch (e) {}
    refreshUi();
  }
  async function set(i, file) {
    if (!file) return;
    if (!/^audio\//.test(file.type)) { toast('Pick an audio file (mp3, wav, ogg).', 'bad'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Keep it under 2 MB - short clips work best.', 'bad'); return; }
    try {
      const buf = await decode(file);
      await idb('readwrite', s => s.put(file, 'lane' + i));
      buffers[i] = buf; localStorage.setItem('et_laneSoundName' + i, file.name.slice(0, 40));
      toast('Lane ' + (i + 1) + ' sound saved.', 'good'); play(i);
    } catch (e) { toast('Could not read that audio file.', 'bad'); }
    refreshUi();
  }
  async function clear(i) { try { await idb('readwrite', s => s.delete('lane' + i)); } catch (e) {} buffers[i] = null; localStorage.removeItem('et_laneSoundName' + i); refreshUi(); }
  function play(i) {
    const b = buffers[i]; if (!b) return;
    const a = audioCtx(); if (!a) return;
    const src = a.createBufferSource(), g = a.createGain();
    src.buffer = b; g.gain.value = vol; src.connect(g); g.connect(a.destination); src.start();
  }
  function setVolume(v) { vol = Math.max(0, Math.min(1, Number(v))); localStorage.setItem('et_laneSoundVol', String(vol)); }

  function buildPanel() {
    const host = document.querySelector('#settings-menu .screen-col') || document.querySelector('#settings-menu .screen-body');
    if (!host || document.getElementById('lane-sounds-panel')) return;
    const rows = [0, 1, 2, 3].map(i => `<div class="settings-row"><span>Lane ${i + 1} sound <small id="ls-name-${i}">Default (silent)</small></span>
      <span class="ls-btns"><button class="btn small" onclick="document.getElementById('ls-file-${i}').click()">Upload</button><button class="btn small btn-ghost" onclick="LaneSounds.play(${i})">▶</button><button class="btn small btn-ghost" onclick="LaneSounds.clear(${i})">✕</button></span>
      <input type="file" id="ls-file-${i}" accept="audio/*" style="display:none" onchange="LaneSounds.set(${i}, this.files[0]); this.value=''"></div>`).join('');
    host.insertAdjacentHTML('beforeend', `<div class="panel" id="lane-sounds-panel"><div class="section-title">INPUT SOUNDS</div>
      <div class="note">Play your own sound every time you hit a tile - one for each lane. Short mp3 / wav / ogg clips (under 2 MB). They stay in this browser.</div>${rows}
      <div class="settings-row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${vol}" oninput="LaneSounds.setVolume(this.value)"></div></div>`);
    refreshUi();
  }
  return { load, set, clear, play, setVolume, buildPanel };
})();
function playLaneSound(lane) { LaneSounds.play(lane); }
document.addEventListener('DOMContentLoaded', () => { LaneSounds.buildPanel(); LaneSounds.load(); });


// ---------------------------------------------------------------------------
// Admin-controlled settings + announcement banner
// ---------------------------------------------------------------------------
async function loadAppSettings() {
  if (typeof API_BASE_URL === 'undefined' || !API_BASE_URL) return;
  try {
    const d = await apiRequest('/api/settings');
    maxBpm = d.maxBpm || 500;
    const bpmIn = document.getElementById('edit-bpm'); if (bpmIn) bpmIn.max = maxBpm;
    showAnnouncement(d.announcement);
  } catch (e) {}
}
function showAnnouncement(text) {
  const bar = document.getElementById('announcement-bar'); if (!bar) return;
  if (!text || localStorage.getItem('et_annSeen') === text) { bar.classList.add('hidden'); return; }
  bar.innerHTML = '<span></span><button onclick="dismissAnnouncement()" aria-label="Dismiss">×</button>';
  bar.firstChild.textContent = '📢 ' + text; bar.dataset.text = text; bar.classList.remove('hidden');
}
function dismissAnnouncement() { const bar = document.getElementById('announcement-bar'); if (bar) { localStorage.setItem('et_annSeen', bar.dataset.text || ''); bar.classList.add('hidden'); } }

// ---------------------------------------------------------------------------
// Shortcuts settings: practice checkpoint keys + start position switcher
// ---------------------------------------------------------------------------
function buildShortcutsPanel() {
  const host = document.querySelector('#settings-menu .screen-col') || document.querySelector('#settings-menu .screen-body');
  if (!host || document.getElementById('shortcuts-panel')) return;
  const row = (id, label) => `<label>${label}<input id="sc-${id}" maxlength="1" value="${escapeHtml(shortcuts[id])}"></label>`;
  host.insertAdjacentHTML('beforeend', `<div class="panel" id="shortcuts-panel"><div class="section-title">PRACTICE & START POSITIONS</div>
    <div class="shortcut-grid">${row('pPlace', 'Place checkpoint')}${row('pRemove', 'Remove checkpoint')}${row('sPrev', 'Previous start pos')}${row('sNext', 'Next start pos')}</div>
    <div class="settings-row"><span>Start position switcher <small>(Q / E in practice mode and editor playtests)</small></span><input type="checkbox" id="sc-switcher" ${shortcuts.switcher ? 'checked' : ''}></div></div>`);
  const save = () => {
    const keys = ['pPlace', 'pRemove', 'sPrev', 'sNext'].map(id => (document.getElementById('sc-' + id).value || '').toLowerCase());
    if (keys.some(k => !/^[a-z0-9]$/.test(k)) || new Set(keys).size !== 4) { toast('Each shortcut needs its own single letter or number.', 'bad'); return; }
    if (keys.some(k => keyMap.includes(k))) { toast('A shortcut can\'t share a key with a lane.', 'bad'); return; }
    shortcuts = { pPlace: keys[0], pRemove: keys[1], sPrev: keys[2], sNext: keys[3], switcher: document.getElementById('sc-switcher').checked };
    localStorage.setItem('et_shortcuts', JSON.stringify(shortcuts)); toast('Shortcuts saved.', 'good');
  };
  host.querySelectorAll('#shortcuts-panel input').forEach(i => i.addEventListener('change', save));
}
document.addEventListener('DOMContentLoaded', () => { buildShortcutsPanel(); loadAppSettings(); setInterval(loadAppSettings, 5 * 60 * 1000); });
