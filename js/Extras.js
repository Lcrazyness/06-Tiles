// ============================================================================
// extras.js — announcements, song library, cloud copies of My Levels (so admins can
// publish unpublished levels), "log in as player" (impersonation) bar.
// Loaded last. Injects the DOM it needs.
// ============================================================================
const isAdminUser = () => { const u = getAuthUser(); return !!(u && u.isAdmin && getAuthToken()); };
function ensureOverlay(id) {
  let e = document.getElementById(id);
  if (!e) { e = document.createElement('div'); e.id = id; e.className = 'overlay hidden'; document.body.appendChild(e); }
  return e;
}
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
const fileToDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
// shrink any image to a JPEG/PNG data url (keeps transparency for png)
async function shrinkImageFile(file, maxSize, quality) {
  const keep = /png|gif|webp/.test(file.type);
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
  const r = Math.min(1, maxSize / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  let out = c.toDataURL(keep ? 'image/png' : 'image/jpeg', quality || 0.8);
  if (out.length > 1400000) out = c.toDataURL('image/jpeg', 0.6);
  return out;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
let newsCache = [];
const newsSeen = () => Number(localStorage.getItem('et_news_seen') || 0);
async function fetchNews() {
  try { const d = await apiRequest('/api/news'); newsCache = d.news || []; } catch (e) { /* offline is fine */ }
  updateNewsBadge();
  return newsCache;
}
function updateNewsBadge() {
  const b = document.getElementById('news-badge'); if (!b) return;
  const unread = newsCache.filter(n => n.id > newsSeen()).length;
  b.textContent = unread > 9 ? '9+' : String(unread); b.classList.toggle('hidden', !unread);
}
function injectNewsButton() {
  if (document.getElementById('news-btn')) return;
  const col = document.querySelector('#main-menu .home-col'); if (!col) return;
  const b = document.createElement('button');
  b.id = 'news-btn'; b.className = 'btn btn-ghost news-btn';
  b.innerHTML = '📣 Announcements <span id="news-badge" class="news-badge hidden">0</span>';
  b.onclick = openNews;
  const admin = document.getElementById('admin-btn');
  col.insertBefore(b, admin || null);
}
async function openNews() {
  const host = ensureOverlay('news-menu');
  toggleMenu('news-menu');
  host.innerHTML = screenHtml('ANNOUNCEMENTS', "toggleMenu('main-menu')", '<div class="empty">Loading…</div>');
  await fetchNews();
  renderNews();
  if (newsCache.length) { localStorage.setItem('et_news_seen', String(Math.max(...newsCache.map(n => n.id)))); updateNewsBadge(); }
}
function renderNews() {
  const host = ensureOverlay('news-menu'), admin = isAdminUser();
  const posts = newsCache.map(n => `<div class="panel news-post">
      <div class="news-title">${escapeHtml(n.title)}</div><div class="news-meta">${fmtDate(n.createdAt)} · ${escapeHtml(n.author)}</div>
      ${n.image ? '<img class="news-img" src="' + escapeHtml(n.image) + '" alt="">' : ''}
      <div class="news-body">${escapeHtml(n.body).replace(/\n/g, '<br>')}</div>
      ${admin ? '<div class="btn-row"><button class="btn small btn-ghost" onclick="editNews(' + n.id + ')">✎ Edit</button><button class="btn small btn-danger" onclick="deleteNews(' + n.id + ')">🗑 Delete</button></div>' : ''}
    </div>`).join('');
  host.innerHTML = screenHtml('ANNOUNCEMENTS', "toggleMenu('main-menu')",
    (admin ? '<button class="btn btn-play" onclick="editNews(0)">＋ New post</button>' : '') + (posts || '<div class="empty">No announcements yet.</div>'));
}
async function editNews(id) {
  const old = newsCache.find(n => n.id === id) || { title: '', body: '' };
  const r = await openFormDialog({ title: id ? 'Edit post' : 'New announcement', fields: [{ id: 'title', label: 'Title', value: old.title, maxlength: 120 }, { id: 'body', label: 'Text', type: 'textarea', value: old.body, rows: 7, maxlength: 5000 }, { id: 'image', label: 'Image (optional)', type: 'file' }], okText: id ? 'Save' : 'Post' });
  if (!r) return;
  let image = null, keepImage = !!id;
  const fi = r.imageFile;
  if (fi) { try { image = await shrinkImageFile(fi, 900, 0.78); keepImage = false; } catch (e) { toast(e.message, 'bad'); return; } }
  try {
    if (id) await apiRequest('/api/admin/news/' + id, { method: 'PUT', auth: true, body: { title: r.title, body: r.body, image, keepImage } });
    else await apiRequest('/api/admin/news', { method: 'POST', auth: true, body: { title: r.title, body: r.body, image } });
    toast(id ? 'Saved.' : 'Posted!', 'good');
    await fetchNews(); renderNews();
  } catch (e) { toast(e.message, 'bad'); }
}
async function deleteNews(id) {
  if (!(await uiConfirm('Delete this post?', 'Delete', true))) return;
  try { await apiRequest('/api/admin/news/' + id, { method: 'DELETE', auth: true }); await fetchNews(); renderNews(); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Song library
// ---------------------------------------------------------------------------
let songPickResolve = null, songPreview = null, songList = [];
function openSongPicker() {
  ensureOverlay('songs-menu');
  return new Promise(resolve => { songPickResolve = resolve; toggleMenu('songs-menu'); document.body.classList.add('songs-over-editor'); loadSongs(); });
}
function closeSongPicker(song) {
  stopSongPreview();
  document.body.classList.remove('songs-over-editor');
  const r = songPickResolve; songPickResolve = null;
  document.getElementById('songs-menu').classList.add('hidden');
  if (inEditor) { document.getElementById('editor-ui').classList.remove('hidden'); document.body.classList.remove('menus-open'); }
  else toggleMenu('main-menu');
  if (r) r(song || null);
}
function stopSongPreview() { if (songPreview) { songPreview.pause(); songPreview = null; } }
async function loadSongs() {
  const host = document.getElementById('songs-menu');
  host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()', '<div class="empty">Loading…</div>');
  try { songList = (await apiRequest('/api/songs')).songs || []; } catch (e) { host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()', errorBox(e.message, 'loadSongs()')); return; }
  renderSongs();
}
function renderSongs(filter) {
  const host = document.getElementById('songs-menu'), admin = isAdminUser(), q = String(filter || '').toLowerCase();
  const rows = songList.filter(s => !q || (s.name + ' ' + s.artist).toLowerCase().includes(q)).map(s => `<div class="song-row admin-row">
      <div class="song-art" style="background:${artGradient(s.name)}">♪</div>
      <div class="song-info"><div class="song-title">${escapeHtml(s.name)}</div><div class="song-sub">${escapeHtml(s.artist || 'Unknown')} · ${(s.size / 1.37 / 1048576).toFixed(1)} MB${s.bpm ? ' · ' + s.bpm + ' BPM' : ''}</div></div>
      <div class="song-actions"><button class="mini-btn" onclick="previewSong(${s.id})">▶</button><button class="mini-btn" onclick="useSong(${s.id})">Use</button>${admin ? '<button class="mini-btn danger" onclick="deleteSong(' + s.id + ')">🗑</button>' : ''}</div></div>`).join('');
  host.innerHTML = screenHtml('SONG LIBRARY', 'closeSongPicker()',
    `<input type="text" id="song-search" class="form-input" placeholder="Search songs…" value="${escapeHtml(filter || '')}" oninput="renderSongs(this.value);document.getElementById('song-search').focus()">
     ${admin ? '<button class="btn btn-play" onclick="uploadSong()">＋ Upload a song (admin)</button>' : ''}
     <div class="song-list">${rows || '<div class="empty">No songs yet.' + (admin ? '' : ' Admins can add free songs here.') + '</div>'}</div>`);
}
function previewSong(id) {
  stopSongPreview(); bgAudio.pause();
  songPreview = new Audio(API_BASE_URL + '/api/songs/' + id + '/audio'); songPreview.volume = 0.8; songPreview.play().catch(() => toast('Could not play the preview.', 'bad'));
  setTimeout(() => { if (songPreview) songPreview.pause(); }, 20000);
}
function useSong(id) { const s = songList.find(x => x.id === id); closeSongPicker(s ? { id: s.id, name: s.name, artist: s.artist, bpm: s.bpm } : null); }
async function uploadSong() {
  const r = await openFormDialog({ title: 'Upload a free song', message: 'Audio file up to ~8 MB.', fields: [{ id: 'name', label: 'Song name', maxlength: 80 }, { id: 'artist', label: 'Artist', maxlength: 80 }, { id: 'bpm', label: 'BPM (optional)', type: 'number' }, { id: 'file', label: 'Audio file', type: 'file', accept: 'audio/*' }], okText: 'Upload' });
  if (!r) return;
  const f = r.fileFile;
  if (!f || !r.name.trim()) { toast('Pick a file and give it a name.', 'bad'); return; }
  if (f.size > 8 * 1048576) { toast('That file is over 8 MB.', 'bad'); return; }
  try {
    toast('Uploading…');
    await apiRequest('/api/admin/songs', { method: 'POST', auth: true, timeout: 120000, body: { name: r.name.trim(), artist: r.artist.trim(), bpm: Number(r.bpm) || null, data: await fileToDataUrl(f) } });
    toast('Song added.', 'good'); loadSongs();
  } catch (e) { toast(e.message, 'bad'); }
}
async function deleteSong(id) {
  if (!(await uiConfirm('Remove this song from the library? Levels using it will play without music.', 'Delete', true))) return;
  try { await apiRequest('/api/admin/songs/' + id, { method: 'DELETE', auth: true }); loadSongs(); } catch (e) { toast(e.message, 'bad'); }
}

// ---------------------------------------------------------------------------
// Cloud copies of My Levels (lets admins see + publish unpublished levels)
// ---------------------------------------------------------------------------
const syncHashes = new Map(), syncTimers = new Map();
function levelForSync(level) { const c = Object.assign({}, level); delete c.audio; delete c.verifiedHash; return c; }
function cloudSyncLevel(level) {
  if (!level || !level.id || !getAuthToken() || !API_BASE_URL) return;
  clearTimeout(syncTimers.get(level.id));
  syncTimers.set(level.id, setTimeout(async () => {
    try {
      const body = levelForSync(level), json = JSON.stringify(body);
      if (json.length > 3500000) return;
      const h = hashString(json);
      if (syncHashes.get(level.id) === h) return;
      await apiRequest('/api/sync/levels/' + encodeURIComponent(level.id), { method: 'PUT', auth: true, body, timeout: 60000 });
      syncHashes.set(level.id, h);
    } catch (e) { /* silent */ }
  }, 2500));
}
function cloudUnsyncLevel(localId) { if (getAuthToken()) apiRequest('/api/sync/levels/' + encodeURIComponent(localId), { method: 'DELETE', auth: true }).catch(() => {}); syncHashes.delete(localId); }
async function cloudSyncAll() {
  if (!getAuthToken() || !API_BASE_URL || getAuthUser() && localStorage.getItem('et_imp_backup')) return;
  for (const l of myLevels.slice()) { if (!syncHashes.has(l.id)) { cloudSyncLevel(l); await new Promise(r => setTimeout(r, 700)); } }
}

// ---------------------------------------------------------------------------
// Impersonation ("Log in as")
// ---------------------------------------------------------------------------
async function startImpersonation(userId, username) {
  if (localStorage.getItem('et_imp_backup')) { toast('Return to your own account first.', 'bad'); return; }
  if (!(await uiConfirm('Log in as ' + username + '? You will see the game exactly as they do. A bar at the top lets you return.', 'Log in as'))) return;
  try {
    const d = await apiRequest('/api/admin/players/' + encodeURIComponent(userId) + '/impersonate', { method: 'POST', auth: true, body: {} });
    localStorage.setItem('et_imp_backup', JSON.stringify({ token: getAuthToken(), user: getAuthUser() }));
    if (typeof disconnectBattle === 'function') disconnectBattle();
    saveAuthSession(d.token, d.user);
    renderImpBar();
    toggleMenu('main-menu');
    toast('Now viewing as ' + username + '.', 'good');
  } catch (e) { toast(e.message, 'bad'); }
}
function returnFromImpersonation() {
  let b = null; try { b = JSON.parse(localStorage.getItem('et_imp_backup') || 'null'); } catch (e) {}
  localStorage.removeItem('et_imp_backup');
  if (typeof disconnectBattle === 'function') disconnectBattle();
  if (b && b.token) saveAuthSession(b.token, b.user); else clearAuthSession();
  renderImpBar(); toggleMenu('main-menu');
  if (b && b.token) restoreAuthSession();
  toast('Back to your own account.', 'good');
}
function renderImpBar() {
  let bar = document.getElementById('imp-bar');
  const active = !!localStorage.getItem('et_imp_backup');
  document.body.classList.toggle('imp-bar', active);
  if (!active) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'imp-bar'; document.body.appendChild(bar); }
  const u = getAuthUser();
  bar.innerHTML = '👁 Viewing as <b>' + escapeHtml(u ? u.username : '?') + '</b> <button onclick="returnFromImpersonation()">Return to admin</button>';
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
function extrasBoot() {
  ensureOverlay('news-menu'); ensureOverlay('songs-menu');
  injectNewsButton(); renderImpBar();
  fetchNews();
  setInterval(() => { if (!document.getElementById('main-menu').classList.contains('hidden')) fetchNews(); }, 120000);
  setTimeout(cloudSyncAll, 6000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', extrasBoot); else extrasBoot();
function onMyLevelsReloaded() { setTimeout(cloudSyncAll, 4000); }
