// ============================================================================
// Video decor objects: an MP4 (max 150 MB, max 3 minutes) that plays like a square.
// The file lives in this browser (IndexedDB) while you edit, and is uploaded in small pieces when you publish.
// Videos are always muted - the level's own music keeps playing.
// ============================================================================
const VIDEO_MAX_BYTES = 300 * 1024 * 1024, VIDEO_CHUNK = 2 * 1024 * 1024;   // any video format your browser can play, any length

const VidDB = {
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res, rej) => {
      const q = indexedDB.open('et_videos', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('v');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    return this.db;
  },
  async put(sha, blob) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction('v', 'readwrite'); t.objectStore('v').put(blob, sha); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(sha) { try { const d = await this.open(); return await new Promise(res => { const q = d.transaction('v').objectStore('v').get(sha); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
};


// checks a chosen file and stores it locally; returns { sha, dur, w, h }
async function videoFromFile(file) {
  if (!/^video\//i.test(file.type) && !/\.(mp4|m4v|mov|webm|mkv|ogv|avi|3gp)$/i.test(file.name)) throw new Error('Please choose a video file.');
  if (file.size > VIDEO_MAX_BYTES) throw new Error('That video is over 300 MB.');
  const url = URL.createObjectURL(file);
  try {
    const meta = await new Promise((res, rej) => {
      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => res({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => rej(new Error('Your browser could not play that video. Try an MP4 (H.264).'));
      v.src = url;
    });
    if (!isFinite(meta.dur) || meta.dur <= 0) throw new Error('Could not read the video length.');
    toast('Reading video…');
    const sha = await sha256Hex(await file.arrayBuffer());
    const blob = file.type ? file : new Blob([file], { type: /\.webm$/i.test(file.name) ? 'video/webm' : /\.(mov)$/i.test(file.name) ? 'video/quicktime' : 'video/mp4' });
    await VidDB.put(sha, blob);
    return { sha, dur: Math.round(meta.dur * 100) / 100, w: meta.w || 16, h: meta.h || 9, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) };
  } finally { URL.revokeObjectURL(url); }
}

// ---- playback ----
const decorVideos = {};
function decorVideoEl(sha) {
  let e = decorVideos[sha];
  if (e) return e;
  e = decorVideos[sha] = document.createElement('video');
  e.muted = true; e.playsInline = true; e.preload = 'auto'; e.crossOrigin = 'anonymous'; e.loop = true; e._ok = false;
  e.onerror = () => { e._bad = true; };
  VidDB.get(sha).then(b => { e.src = b ? URL.createObjectURL(b) : (API_BASE_URL ? API_BASE_URL + '/api/videos/' + sha : ''); e._ok = true; });
  return e;
}
function videoRunning() {
  return (typeof gameActive !== 'undefined' && gameActive && !isPaused && !isDead) || (typeof editorPlaying !== 'undefined' && editorPlaying && typeof inEditor !== 'undefined' && inEditor);
}
// draws the right frame of the video for time t (in seconds on the level clock)
function drawDecorVideo(c, o, t, w, h) {
  const e = o.vid ? decorVideoEl(o.vid) : null;
  if (!e || e._bad || !e._ok || e.readyState < 2) {
    c.strokeStyle = '#888'; c.lineWidth = 2; c.strokeRect(-w / 2, -h / 2, w, h);
    c.fillStyle = '#888'; c.font = '28px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(e && e._bad ? '⚠' : '🎬', 0, 0);
    if (e) e._seen = performance.now();
    return;
  }
  const d = e.duration || o.vdur || 1, sp = o.vspeed || 1;
  let v = Math.max(0, t - o.time) * sp + (o.vstart || 0);
  if (o.vloop !== false) v = ((v % d) + d) % d; else v = Math.min(v, d - 0.05);
  e.loop = o.vloop !== false; e.playbackRate = sp;
  const run = videoRunning() && (o.vloop !== false || v < d - 0.06);
  const drift = Math.abs(e.currentTime - v);
  if (run) { if (drift > 0.3 && !e.seeking) e.currentTime = v; if (e.paused) e.play().catch(() => {}); }
  else { if (!e.paused) e.pause(); if (drift > 0.03 && !e.seeking) e.currentTime = v; }
  e._seen = performance.now();
  try { c.drawImage(e, -w / 2, -h / 2, w, h); } catch (err) {}
}
// anything not drawn for a moment (hidden, not live yet, menu open) stops playing
setInterval(() => { const n = performance.now(); for (const k in decorVideos) { const e = decorVideos[k]; if (!e.paused && (!e._seen || n - e._seen > 300)) e.pause(); } }, 250);

// ---- upload (called when publishing) ----
async function uploadLevelVideos(decor, silent, library) {
  const objs = ((decor && decor.objects) || []).filter(o => o.kind === 'video' && o.vid);
  const shas = [...new Set(objs.map(o => o.vid))];
  for (let k = 0; k < shas.length; k++) {
    const sha = shas[k], tag = shas.length > 1 ? ' ' + (k + 1) + '/' + shas.length : '';
    const st = await apiRequest('/api/videos/' + sha + '/status', { auth: true });
    if (st.complete) continue;
    const blob = await VidDB.get(sha);
    if (!blob) throw new Error('A video in this level is not saved on this device any more. Add it again in the editor.');
    const meta = objs.find(o => o.vid === sha), n = Math.ceil(blob.size / VIDEO_CHUNK);
    for (let i = 0; i < n; i++) {
      if (!silent) toast('Uploading video' + tag + '… ' + Math.round(i / n * 100) + '%');
      let ok = false, err = '';
      for (let tryNo = 0; tryNo < 3 && !ok; tryNo++) {
        try {
          const r = await fetch(API_BASE_URL + '/api/videos/' + sha + '/' + i, { method: 'PUT', headers: { Authorization: 'Bearer ' + getAuthToken(), 'Content-Type': 'application/octet-stream' }, body: blob.slice(i * VIDEO_CHUNK, (i + 1) * VIDEO_CHUNK) });
          if (r.ok) ok = true; else { let j = null; try { j = await r.json(); } catch (e) {} err = (j && j.message) || 'Upload failed'; if (r.status < 500) break; }
        } catch (e) { err = 'Lost connection while uploading.'; }
      }
      if (!ok) throw new Error(err);
    }
    await apiRequest('/api/videos/' + sha + '/finish', { method: 'POST', auth: true, body: { dur: meta.vdur, w: meta.vw, h: meta.vh, mime: blob.type || 'video/mp4', name: meta.vname || '', library: !!library }, timeout: 300000 });
  }
}

// ---- shared video library (admins add videos once, every editor can use them without uploading anything) ----
async function pickVideoDialog() {
  let list = [];
  if (getAuthToken() && API_BASE_URL) { try { list = (await apiRequest('/api/videos', { auth: true })).videos || []; } catch (e) {} }
  return new Promise(resolve => {
    const admin = typeof getAuthUser === 'function' && getAuthUser() && getAuthUser().isAdmin;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px';
    const fmt = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
    const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    wrap.innerHTML = '<div style="background:#16161d;color:#fff;border-radius:14px;padding:16px;max-width:420px;width:100%;max-height:80vh;overflow:auto"><div style="font-weight:700;margin-bottom:8px">🎬 Add a video</div>' +
      '<button class="btn" id="vp-file" style="width:100%;margin-bottom:10px">Choose a file from this device</button>' +
      (list.length ? '<div style="font-size:12px;opacity:.7;margin:6px 0">SHARED LIBRARY (no upload needed)</div>' + list.map((v, i) => '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #333"><div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(v.name || 'Video') + '</div><div style="font-size:12px;opacity:.65">' + fmtT(v.dur) + ' · ' + fmt(v.size) + '</div></div><button class="btn small" data-use="' + i + '">Use</button>' + (admin ? '<button class="btn small btn-ghost" data-del="' + i + '">🗑</button>' : '') + '</div>').join('') : '<div style="font-size:12px;opacity:.6">The shared library is empty.' + (admin ? ' Add a video from your device and choose to share it.' : '') + '</div>') +
      '<button class="btn btn-ghost" id="vp-cancel" style="width:100%;margin-top:10px">Cancel</button></div>';
    const done = r => { wrap.remove(); resolve(r); };
    document.body.appendChild(wrap);
    wrap.querySelector('#vp-file').onclick = () => done({ file: true });
    wrap.querySelector('#vp-cancel').onclick = () => done(null);
    wrap.querySelectorAll('[data-use]').forEach(b => b.onclick = () => done({ lib: list[Number(b.dataset.use)] }));
    wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const v = list[Number(b.dataset.del)];
      if (!(await uiConfirm('Delete "' + (v.name || 'this video') + '" from the library? Levels using it will show an empty box.', 'Delete'))) return;
      try { await apiRequest('/api/videos/' + v.sha, { method: 'DELETE', auth: true }); toast('Deleted.', 'good'); done(null); } catch (e) { toast(e.message, 'bad'); }
    });
  });
}
