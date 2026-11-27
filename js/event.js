// event.js - THANKSGIVING EVENT (client side): autumn theme, falling leaves, main-menu banner. Pure CSS/canvas, no downloads.
// The server decides the real dates (settings.event); if it can't be reached the same dates are used here so the look still switches on.
let EVENT_INFO = null;
const TG_FALLBACK = { active: Date.now() >= Date.UTC(2026, 10, 20, 8) && Date.now() < Date.UTC(2026, 11, 5, 8), endsAt: Date.UTC(2026, 11, 5, 8), doubleRp: Date.now() >= Date.UTC(2026, 10, 27, 8) && Date.now() < Date.UTC(2026, 10, 30, 8), doubleEndsAt: Date.UTC(2026, 10, 30, 8) };
const leavesOn = () => { try { return localStorage.getItem('et_leaves') !== '0'; } catch (e) { return true; } };
function setLeaves(on) { try { localStorage.setItem('et_leaves', on ? '1' : '0'); } catch (e) {} renderEventBanner(); leavesTick(true); }

function applyEvent(ev) {
  EVENT_INFO = ev || TG_FALLBACK;
  document.body.classList.toggle('tg-theme', !!EVENT_INFO.active);
  renderEventBanner(); leavesStart();
}
function eventLeft(ts) { const m = Math.max(0, Math.round((ts - Date.now()) / 60000)); return m >= 1440 ? Math.ceil(m / 1440) + ' days' : m >= 60 ? Math.round(m / 60) + ' hours' : m + ' min'; }
function renderEventBanner() {
  const col = document.querySelector('#main-menu .home-col'); if (!col) return;
  let el = document.getElementById('event-banner');
  if (!EVENT_INFO || !EVENT_INFO.active) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'event-banner'; const logo = col.querySelector('.logo'); logo ? logo.after(el) : col.prepend(el); }
  el.innerHTML = `<div class="tg-title">🦃 THANKSGIVING EVENT <small>ends in ${eventLeft(EVENT_INFO.endsAt)}</small></div>
    ${EVENT_INFO.doubleRp ? `<div class="tg-hot">🔥 DOUBLE RP on ranked wins - ${eventLeft(EVENT_INFO.doubleEndsAt)} left</div>` : ''}
    <ul><li>🥧 Beat the <b>Thanksgiving levels</b> for the Feast badges</li><li>🍂 Play on <b>3 different days</b> to unlock the Harvest profile frame</li><li>💛 Beat any level without losing a heart for the Gratitude badge</li></ul>
    <button class="tg-leaf-btn" onclick="setLeaves(${leavesOn() ? 'false' : 'true'})">🍂 Falling leaves: ${leavesOn() ? 'on' : 'off'}</button>`;
}
// small emoji shown next to Thanksgiving-tagged levels (picked from the level id so it stays the same)
function tgIcon(level) {
  if (!level || !Array.isArray(level.tags) || !level.tags.includes('thanksgiving')) return '';
  const set = ['🦃', '🎃', '🥧']; let h = 0; const id = String(level.id || level.name || ''); for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return '<span class="tg-ico" title="Thanksgiving level">' + set[h % 3] + '</span> ';
}

// ---- falling leaves: one small canvas, ~30 fps, paused when hidden / reduced-motion / switched off ----
let leaves = [], leafCv = null, leafCx = null, leafLast = 0, leafRaf = 0;
const LEAF_COLORS = ['#e8742a', '#d4492b', '#f0a830', '#b5532a', '#c98a2b', '#8f3b1b'];
function leavesStart() {
  if (!EVENT_INFO || !EVENT_INFO.active) { if (leafCv) { leafCv.remove(); leafCv = null; } cancelAnimationFrame(leafRaf); leafRaf = 0; return; }
  if (!leafCv) { leafCv = document.createElement('canvas'); leafCv.id = 'leaf-canvas'; document.body.appendChild(leafCv); leafCx = leafCv.getContext('2d'); window.addEventListener('resize', leafSize); leafSize(); }
  if (!leafRaf) leafRaf = requestAnimationFrame(leafLoop);
}
function leafSize() { if (leafCv) { leafCv.width = innerWidth; leafCv.height = innerHeight; } }
function leafNew(top) { return { x: Math.random() * innerWidth, y: top ? -20 : Math.random() * innerHeight, s: 7 + Math.random() * 9, vy: 25 + Math.random() * 35, vx: -10 + Math.random() * 20, a: Math.random() * 6.28, va: -1.5 + Math.random() * 3, sw: Math.random() * 6.28, c: LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0] }; }
function leavesTick(clear) { if (clear && leafCx) leafCx.clearRect(0, 0, leafCv.width, leafCv.height); }
function leafLoop(t) {
  leafRaf = requestAnimationFrame(leafLoop);
  if (!leafCv) return;
  if (t - leafLast < 33) return;
  const dt = Math.min(0.1, (t - leafLast) / 1000); leafLast = t;
  const inPlay = (typeof gameActive !== 'undefined' && gameActive) || (typeof inEditor !== 'undefined' && inEditor);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.hidden || !leavesOn() || calm) { if (leaves.length) { leaves = []; leafCx.clearRect(0, 0, leafCv.width, leafCv.height); } return; }
  leafCv.style.zIndex = inPlay ? 7 : 90;                 // behind the game canvas while playing, over the menu background otherwise
  const want = inPlay ? 10 : 28;
  while (leaves.length < want) leaves.push(leafNew(leaves.length > 0));
  if (leaves.length > want) leaves.length = want;
  leafCx.clearRect(0, 0, leafCv.width, leafCv.height);
  leafCx.globalAlpha = inPlay ? 0.35 : 0.6;
  for (const l of leaves) {
    l.y += l.vy * dt; l.sw += dt * 1.6; l.x += (l.vx + Math.sin(l.sw) * 22) * dt; l.a += l.va * dt;
    if (l.y > innerHeight + 20 || l.x < -30 || l.x > innerWidth + 30) Object.assign(l, leafNew(true));
    leafCx.save(); leafCx.translate(l.x, l.y); leafCx.rotate(l.a); leafCx.fillStyle = l.c;
    leafCx.beginPath(); leafCx.moveTo(0, -l.s); leafCx.quadraticCurveTo(l.s * 0.9, -l.s * 0.2, 0, l.s); leafCx.quadraticCurveTo(-l.s * 0.9, -l.s * 0.2, 0, -l.s); leafCx.fill();
    leafCx.strokeStyle = 'rgba(60,20,5,.55)'; leafCx.lineWidth = 1; leafCx.beginPath(); leafCx.moveTo(0, -l.s * 0.8); leafCx.lineTo(0, l.s); leafCx.stroke();
    leafCx.restore();
  }
}
document.addEventListener('DOMContentLoaded', () => { applyEvent(TG_FALLBACK); setInterval(renderEventBanner, 60000); });
