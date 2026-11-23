// offline.js - OFFLINE MODE. Downloads levels (+ music, + videos) once into this browser, then plays them with the network switched OFF,
// so playing them never uses the server's data. Online features (battle, ranks, accounts, comments...) are unavailable while it is on.
let OFFLINE_MODE = false;
const OFF = { tab: 'library', q: '', diff: '', sort: 'name', idx: [], busy: false, cancel: false, plan: null, scope: 'rated', music: true, video: false, log: [], prog: null };

// ---- storage (IndexedDB) ---------------------------------------------------
const OffDB = {
  db: null,
  open() {
    if (!this.db) this.db = new Promise((res, rej) => {
      const q = indexedDB.open('et_offline', 1);
      q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('idx', { keyPath: 'id' }); d.createObjectStore('levels', { keyPath: 'id' }); d.createObjectStore('blobs'); d.createObjectStore('meta'); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    return this.db;
  },
  async tx(store, mode, fn) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); },
  put(store, val, key) { return this.tx(store, 'readwrite', s => key === undefined ? s.put(val) : s.put(val, key)); },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); },
  keys(store) { return this.tx(store, 'readonly', s => s.getAllKeys()); }
};
const offAudioKey = r => r.songId ? 's:' + r.songId : 'a:' + r.id;
const offMB = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

// ---- turning it on / off ---------------------------------------------------
// While on, nothing may touch the server: fetch to the API is refused, the battle socket is closed, API calls fail instantly.
const _realFetch = window.fetch.bind(window);
window.fetch = (u, ...a) => (OFFLINE_MODE && typeof API_BASE_URL !== 'undefined' && API_BASE_URL && String(u && u.url ? u.url : u).startsWith(API_BASE_URL))
  ? Promise.reject(new TypeError('Offline mode is on')) : _realFetch(u, ...a);
const _offFetchNet = (u, o) => _realFetch(u, o);   // only the downloader may reach the server (and only while downloading)

async function openOfflineMode() {
  if (typeof inEditor !== 'undefined' && inEditor) return;
  OFFLINE_MODE = true;
  document.body.classList.add('offline-skin');
  try { if (typeof battleSocket !== 'undefined' && battleSocket) battleSocket.disconnect(); } catch (e) {}
  ensureOverlay('offline-menu');
  OFF.idx = await OffDB.all('idx').catch(() => []);
  levelDetailReturnTo = 'offline-menu';
  toggleMenu('offline-menu');
  renderOffline();
}
function exitOfflineMode() {
  if (OFF.busy && !confirm('A download is running. Stop it and leave offline mode?')) return;
  OFF.cancel = true;
  OFFLINE_MODE = false;
  document.body.classList.remove('offline-skin');
  toggleMenu('main-menu');
}

// ---- screen ----------------------------------------------------------------
const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function renderOffline() {
  const host = document.getElementById('offline-menu'); if (!host) return;
  let used = 0, quota = 0;
  try { const e = await navigator.storage.estimate(); used = e.usage || 0; quota = e.quota || 0; } catch (e) {}
  const last = await OffDB.get('meta', 'last').catch(() => null);
  const head = `<div class="off-bar"><div class="off-title"><span class="off-dot"></span>OFFLINE MODE <small>no internet used</small></div>
      <button class="off-btn" onclick="exitOfflineMode()">⏏ Exit</button></div>
    <div class="off-stats"><div><b>${OFF.idx.length}</b> levels saved</div><div><b>${offMB(used)}</b> used${quota ? ' of ' + offMB(quota) : ''}</div><div>Last update: <b>${last ? new Date(last).toLocaleDateString() : 'never'}</b></div></div>
    <div class="off-tabs"><button class="${OFF.tab === 'library' ? 'on' : ''}" onclick="OFF.tab='library';renderOffline()">LIBRARY</button><button class="${OFF.tab === 'download' ? 'on' : ''}" onclick="OFF.tab='download';renderOffline()">DOWNLOAD</button></div>`;
  host.innerHTML = '<div class="off-wrap">' + head + (OFF.tab === 'library' ? offLibraryHtml() : offDownloadHtml()) + '</div>';
  if (OFF.tab === 'library') offFillList();
}
function offLibraryHtml() {
  if (!OFF.idx.length) return `<div class="off-empty">Nothing saved yet.<br>Open <b>DOWNLOAD</b> while you are online to save levels onto this device.<br>After that you can play them with no internet.</div>`;
  const diffs = [...new Set(OFF.idx.map(r => r.difficulty).filter(Boolean))];
  return `<div class="off-tools"><input id="off-q" class="off-input" placeholder="search saved levels…" value="${esc2(OFF.q)}" oninput="OFF.q=this.value;offFillList()">
    <select class="off-input" onchange="OFF.diff=this.value;offFillList()"><option value="">all difficulties</option>${diffs.map(d => `<option ${OFF.diff === d ? 'selected' : ''}>${esc2(d)}</option>`).join('')}</select>
    <select class="off-input" onchange="OFF.sort=this.value;offFillList()">${[['name', 'A-Z'], ['stars', 'most stars'], ['tiles', 'most tiles'], ['new', 'newest saved']].map(([v, l]) => `<option value="${v}" ${OFF.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="off-list" class="off-list"></div>`;
}
function offFillList() {
  const el = document.getElementById('off-list'); if (!el) return;
  const q = OFF.q.trim().toLowerCase();
  let rows = OFF.idx.filter(r => (!q || (r.name + ' ' + r.author).toLowerCase().includes(q)) && (!OFF.diff || r.difficulty === OFF.diff));
  const by = { name: (a, b) => a.name.localeCompare(b.name), stars: (a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name), tiles: (a, b) => b.tiles - a.tiles, new: (a, b) => (b.saved || 0) - (a.saved || 0) }[OFF.sort];
  rows.sort(by);
  el.innerHTML = rows.length ? rows.slice(0, 300).map(r => `<div class="off-row"><div class="off-info"><div class="off-name">${esc2(r.name)}</div>
      <div class="off-sub">${esc2(r.author || '')} · ${esc2(r.difficulty || '')}${r.stars ? ' · ★' + r.stars : ''} · ${r.tiles} tiles${r.audio ? ' · ♪' : ''}${r.vids && r.vids.length ? ' · ▶' + (r.vidsOk ? '' : '(not saved)') : ''}</div></div>
      <button class="off-play" onclick="offPlay('${r.id}')">PLAY</button><button class="off-x" title="Remove from this device" onclick="offRemove('${r.id}')">✕</button></div>`).join('') + (rows.length > 300 ? '<div class="off-sub" style="padding:8px">Showing the first 300 - use search.</div>' : '')
    : '<div class="off-empty">No matches.</div>';
}
function offDownloadHtml() {
  const p = OFF.plan, pr = OFF.prog;
  const est = p ? `<div class="off-plan"><b>${p.levels.length}</b> new or changed levels · about <b>${offMB(p.bytes)}</b> to download${p.skippedVideoBytes ? `<br><small>${offMB(p.skippedVideoBytes)} of videos not included (box is off)</small>` : ''}</div>` : '';
  const prog = pr ? `<div class="off-prog"><div class="off-progbar"><i style="width:${pr.total ? Math.round(pr.done / pr.total * 100) : 0}%"></i></div><div class="off-sub">${esc2(pr.text)}</div></div>` : '';
  return `<div class="off-card"><div class="off-h">What to save</div>
    <label class="off-opt"><input type="radio" name="offscope" ${OFF.scope === 'rated' ? 'checked' : ''} onchange="OFF.scope='rated';OFF.plan=null;renderOffline()"> Rated levels only <small>(the featured ones - smallest)</small></label>
    <label class="off-opt"><input type="radio" name="offscope" ${OFF.scope === 'all' ? 'checked' : ''} onchange="OFF.scope='all';OFF.plan=null;renderOffline()"> Every level <small>(bigger)</small></label>
    <label class="off-opt"><input type="checkbox" ${OFF.music ? 'checked' : ''} onchange="OFF.music=this.checked;OFF.plan=null;renderOffline()"> Music</label>
    <label class="off-opt"><input type="checkbox" ${OFF.video ? 'checked' : ''} onchange="OFF.video=this.checked;OFF.plan=null;renderOffline()"> Videos <small>(big - the server limits how much video it sends per day)</small></label></div>
    ${est}${prog}
    <div class="off-actions">${OFF.busy ? '<button class="off-btn" onclick="OFF.cancel=true">■ Stop</button>' : `<button class="off-btn" onclick="offCheck()">1 · Check what is new</button><button class="off-btn go" ${p && p.levels.length ? '' : 'disabled'} onclick="offDownload()">2 · Download</button>`}</div>
    <div class="off-sub" style="margin-top:10px">Downloading uses the internet once. Playing saved levels afterwards uses none. Already-saved levels are skipped, so updating later is small.</div>
    <div class="off-actions" style="margin-top:14px"><button class="off-btn danger" onclick="offDeleteAll()">🗑 Delete everything saved</button></div>`;
}
function offSetProg(done, total, text) { OFF.prog = { done, total, text }; if (OFFLINE_MODE && OFF.tab === 'download') renderOffline(); }

// ---- check + download (the only code that talks to the server) ---------------
async function offApi(path) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await _offFetchNet(API_BASE_URL + path, { signal: ctrl.signal, cache: 'no-cache' });
    const d = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((d && d.message) || ('Server error ' + r.status)); e.saver = !!(d && d.saver); throw e; }
    return d;
  } finally { clearTimeout(t); }
}
async function offCheck() {
  if (OFF.busy) return;
  if (!navigator.onLine) { toast('You are not online right now.', 'bad'); return; }
  OFF.busy = true; OFF.cancel = false; OFF.plan = null; renderOffline();
  try {
    const remote = []; let after = '';
    for (let i = 0; i < 100 && !OFF.cancel; i++) {
      offSetProg(0, 0, 'Reading the level list… ' + remote.length);
      const d = await offApi('/api/offline/index?scope=' + OFF.scope + (after ? '&after=' + after : ''));
      remote.push(...d.levels); if (!d.next) break; after = d.next;
    }
    const local = new Map(OFF.idx.map(r => [r.id, r]));
    const blobKeys = new Set(await OffDB.keys('blobs'));
    const need = [], counted = new Set(); let bytes = 0, skipV = 0;
    for (const r of remote) {
      const l = local.get(r.id), changed = !l || l.ver !== r.ver;
      const wantA = OFF.music && (r.hasAudio || r.songId) && !blobKeys.has(offAudioKey(r));
      const wantV = OFF.video && r.videoBytes > 0 && !(l && l.vidsOk);
      if (!changed && !wantA && !wantV) continue;
      need.push({ r, changed, wantA, wantV });
      if (changed) bytes += r.dataBytes;
      if (wantA && !counted.has(offAudioKey(r))) { counted.add(offAudioKey(r)); bytes += r.audioBytes; }
      if (wantV) bytes += r.videoBytes; else if (r.videoBytes > 0 && !(l && l.vidsOk)) skipV += r.videoBytes;
    }
    OFF.plan = { levels: need, bytes, skippedVideoBytes: skipV, total: remote.length };
    OFF.prog = null;
    toast(need.length ? need.length + ' levels to save.' : 'Everything is already up to date.', 'good');
  } catch (e) { OFF.prog = null; toast(e.saver ? e.message : (e.message || 'Could not check.'), 'bad'); }
  OFF.busy = false; renderOffline();
}
async function offDownload() {
  const plan = OFF.plan; if (!plan || OFF.busy) return;
  if (!(await uiConfirm('Download about ' + offMB(plan.bytes) + ' now? This is the only time it uses the internet.', 'Download'))) return;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  OFF.busy = true; OFF.cancel = false; let done = 0, failed = 0, got = 0, stopMsg = '';
  const queue = plan.levels.slice(), total = queue.length;
  const fetchBlob = async path => { const r = await _offFetchNet(API_BASE_URL + path); if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch (e) {} const e = new Error(m || ('Server error ' + r.status)); e.saver = r.status === 503; throw e; } return r.blob(); };
  const worker = async () => {
    while (queue.length && !OFF.cancel && !stopMsg) {
      const { r, changed, wantA, wantV } = queue.shift();
      try {
        const old = OFF.idx.find(x => x.id === r.id) || {};
        let level = changed ? null : await OffDB.get('levels', r.id);
        if (!level) { level = await offApi('/api/levels/' + r.id + '?lite=1'); delete level.audio; await OffDB.put('levels', level); got += r.dataBytes; }
        const rec = { id: r.id, name: r.name, author: r.author, difficulty: r.difficulty, stars: r.stars, tiles: r.tiles, songId: r.songId, ver: r.ver, saved: old.saved || Date.now(), audio: !!old.audio, vids: [], vidsOk: true };
        if (wantA || (!changed && old.audio)) {
          const key = offAudioKey(r);
          if (!(await OffDB.get('blobs', key))) { const b = await fetchBlob(r.songId ? '/api/songs/' + r.songId + '/audio' : '/api/levels/' + r.id + '/audio'); await OffDB.put('blobs', b, key); got += b.size; }
          rec.audio = true;
        }
        const vids = [...new Set(((level.decor && level.decor.objects) || []).filter(o => o.kind === 'video' && o.vid).map(o => o.vid))];
        rec.vids = vids;
        for (const sha of vids) {
          if (await VidDB.get(sha)) continue;
          if (!wantV) { rec.vidsOk = false; continue; }
          const b = await fetchBlob('/api/videos/' + sha); await VidDB.put(sha, b); got += b.size;
          const have = (await OffDB.get('meta', 'vids')) || []; if (!have.includes(sha)) { have.push(sha); await OffDB.put('meta', have, 'vids'); }
        }
        await OffDB.put('idx', rec);
        OFF.idx = OFF.idx.filter(x => x.id !== r.id).concat(rec);
      } catch (e) { failed++; if (e.saver) stopMsg = e.message || 'The server is saving data right now - try again later.'; }
      done++; offSetProg(done, total, 'Saved ' + done + ' of ' + total + ' · ' + offMB(got) + ' downloaded' + (failed ? ' · ' + failed + ' failed' : ''));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await OffDB.put('meta', Date.now(), 'last');
  OFF.busy = false; OFF.plan = null;
  OFF.prog = { done: 1, total: 1, text: (OFF.cancel ? 'Stopped. ' : stopMsg ? stopMsg + ' ' : 'Done. ') + 'Saved ' + done + ' levels' + (failed ? ', ' + failed + ' failed (run it again to retry)' : '') + '.' };
  renderOffline();
}

// ---- play / remove / delete ---------------------------------------------------
async function offPlay(id) {
  try {
    const lvl = await OffDB.get('levels', id), rec = OFF.idx.find(r => r.id === id);
    if (!lvl || !rec) { toast('That level is not saved.', 'bad'); return; }
    const full = JSON.parse(JSON.stringify(lvl));
    const ab = await OffDB.get('blobs', offAudioKey(rec));
    delete full.audio; full.audioUrl = null;
    if (ab) Object.defineProperty(full, '_audioUrl', { value: URL.createObjectURL(ab), enumerable: false, writable: true, configurable: true });
    else full.songId = null;       // no music saved -> never ask the server for it
    levelDetailReturnTo = 'offline-menu';
    startGame(full.name, true, -1, full.data, full.effects || [], true, full);
  } catch (e) { toast('Could not open that level.', 'bad'); }
}
async function offRemove(id) {
  if (!(await uiConfirm('Remove this level from this device?', 'Remove', true))) return;
  await OffDB.del('levels', id); await OffDB.del('idx', id);
  OFF.idx = OFF.idx.filter(r => r.id !== id); renderOffline();
}
async function offDeleteAll() {
  if (!(await uiConfirm('Delete every saved level, song and video from this device? You can download them again later.', 'Delete all', true))) return;
  for (const s of ['idx', 'levels', 'blobs']) await OffDB.clear(s);
  const vids = (await OffDB.get('meta', 'vids')) || [];
  for (const sha of vids) { try { const d = await VidDB.open(); await new Promise(r => { const t = d.transaction('v', 'readwrite'); t.objectStore('v').delete(sha); t.oncomplete = r; t.onerror = r; }); } catch (e) {} }
  await OffDB.clear('meta');
  OFF.idx = []; OFF.plan = null; OFF.prog = null; toast('Deleted.', 'good'); renderOffline();
}
