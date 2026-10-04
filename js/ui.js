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
    const bar = 60;
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
function dialogOpen() { const d = document.getElementById('dialog'); return !!d && !d.classList.contains('hidden'); }

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
