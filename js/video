// ============================================================================
// Video decor objects: an MP4 (max 150 MB, max 3 minutes) that plays like a square.
// The file lives in this browser (IndexedDB) while you edit, and is uploaded in small pieces when you publish.
// Videos are always muted - the level's own music keeps playing.
// ============================================================================
const VIDEO_MAX_BYTES = 150 * 1024 * 1024, VIDEO_MAX_SECONDS = 180, VIDEO_CHUNK = 2 * 1024 * 1024;

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
  if (!/mp4/i.test(file.type) && !/\.mp4$/i.test(file.name)) throw new Error('Please choose an MP4 video.');
  if (file.size > VIDEO_MAX_BYTES) throw new Error('That video is over 150 MB.');
  const url = URL.createObjectURL(file);
  try {
    const meta = await new Promise((res, rej) => {
      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => res({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => rej(new Error('Your browser could not read that video. Try an H.264 MP4.'));
      v.src = url;
    });
    if (!isFinite(meta.dur) || meta.dur <= 0) throw new Error('Could not read the video length.');
    if (meta.dur > VIDEO_MAX_SECONDS + 0.4) throw new Error('Videos can be at most 3 minutes long (this one is ' + Math.round(meta.dur) + 's).');
    toast('Reading video…');
    const sha = await sha256Hex(await file.arrayBuffer());
    await VidDB.put(sha, file);
    return { sha, dur: Math.round(meta.dur * 100) / 100, w: meta.w || 16, h: meta.h || 9 };
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
async function uploadLevelVideos(decor) {
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
      toast('Uploading video' + tag + '… ' + Math.round(i / n * 100) + '%');
      let ok = false, err = '';
      for (let tryNo = 0; tryNo < 3 && !ok; tryNo++) {
        try {
          const r = await fetch(API_BASE_URL + '/api/videos/' + sha + '/' + i, { method: 'PUT', headers: { Authorization: 'Bearer ' + getAuthToken(), 'Content-Type': 'application/octet-stream' }, body: blob.slice(i * VIDEO_CHUNK, (i + 1) * VIDEO_CHUNK) });
          if (r.ok) ok = true; else { let j = null; try { j = await r.json(); } catch (e) {} err = (j && j.message) || 'Upload failed'; if (r.status < 500) break; }
        } catch (e) { err = 'Lost connection while uploading.'; }
      }
      if (!ok) throw new Error(err);
    }
    await apiRequest('/api/videos/' + sha + '/finish', { method: 'POST', auth: true, body: { dur: meta.vdur, w: meta.vw, h: meta.vh }, timeout: 120000 });
  }
}
