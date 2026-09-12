/*

 * 06-Tiles / Extreme Tiles

 * Single-file runtime replacement.

 *

 * The current index.html references js/state.js, js/storage.js, js/game.js,

 * js/editor.js, js/browse.js, js/battle.js, js/ui.js and js/main.js, but those

 * files are not present on the main branch. This file contains the runtime

 * needed by the existing index.html so the page can boot with one script.

 */

(() => {

  'use strict';

 

  const KEYS = Object.freeze({

    profiles: '06tiles_profiles_v2',

    currentProfile: '06tiles_current_profile_v2',

    customLevels: '06tiles_custom_levels_v4',

    browseLevels: '06tiles_browse_levels_v4',

    settings: '06tiles_settings_v3'

  });

 

  const DEFAULT_SETTINGS = {

    primaryColor: '#3c096c',

    bgColor: '#3c096c',

    cbf: true

  };

 

  const state = {

    screen: 'menu',

    currentLevel: null,

    gameRunning: false,

    gameStartedAt: 0,

    gameElapsed: 0,

    gameScore: 0,

    gameCombo: 0,

    gameMisses: 0,

    gameLives: 3,

    gameSpeed: 18,

    gameTiles: [],

    gameRaf: 0,

    lastFrame: 0,

    fps: 0,

    editorOpen: false,

    editorRecording: false,

    editorDeleteMode: false,

    editorTileMode: 'normal',

    editorGrid: 2,

    editorTime: 0,

    editorPlaying: false,

    editorTransportStarted: 0,

    editorTransportBase: 0,

    editorRaf: 0,

    editorLevel: null,

    selectedEffectId: null,

    effectDrag: null,

    effectCategory: 'visual',

    audioUrl: '',

    songTester: false,

    extraImagePosition: 'center',

    battleOpponent: null,

    battleLevel: null,

    battleScore: 0,

    battleOpponentScore: 0,

    currentBrowseTab: 'recent'

  };

 

  const builtInLevels = {

    scale: { id: 'scale', title: 'The Scale', author: 'System', speed: 18, lanes: 4, bpm: 120, duration: 20 },

    bambam: { id: 'bambam', title: 'Bam Bam', author: 'System', speed: 19, lanes: 4, bpm: 124, duration: 24 }

  };

 

  const $ = id => document.getElementById(id);

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const now = () => performance.now();

 

  function safeJSONGet(key, fallback) {

    try {

      const raw = localStorage.getItem(key);

      return raw == null ? fallback : JSON.parse(raw);

    } catch (_) {

      return fallback;

    }

  }

 

  function safeJSONSet(key, value) {

    try {

      localStorage.setItem(key, JSON.stringify(value));

      return true;

    } catch (_) {

      return false;

    }

  }

 

  function uid(prefix = 'id') {

    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  }

 

  function getProfiles() {

    const profiles = safeJSONGet(KEYS.profiles, []);

    return Array.isArray(profiles) ? profiles : [];

  }

 

  function currentProfileName() {

    const name = localStorage.getItem(KEYS.currentProfile);

    return name && name.trim() ? name.trim() : 'Guest';

  }

 

  function getCustomLevels() {

    const levels = safeJSONGet(KEYS.customLevels, []);

    return Array.isArray(levels) ? levels : [];

  }

 

  function saveCustomLevels(levels) {

    safeJSONSet(KEYS.customLevels, levels);

  }

 

  function getBrowseLevels() {

    const levels = safeJSONGet(KEYS.browseLevels, []);

    return Array.isArray(levels) ? levels : [];

  }

 

  function saveBrowseLevels(levels) {

    safeJSONSet(KEYS.browseLevels, levels);

  }

 

  function getSettings() {

    return { ...DEFAULT_SETTINGS, ...safeJSONGet(KEYS.settings, {}) };

  }

 

  function setSettings(settings) {

    safeJSONSet(KEYS.settings, settings);

  }

 

  function showOnly(id) {

    const ids = [

      'main-menu', 'profile-modal', 'settings-menu', 'levels-menu', 'my-levels-menu',

      'browse-levels-menu', 'level-detail-menu', 'battle-menu', 'battle-level-picker',

      'battle-waiting-menu', 'battle-incoming-menu', 'battle-result-menu',

      'editor-level-settings', 'creator-menu', 'effects-menu', 'death-screen'

    ];

    ids.forEach(x => {

      const el = $(x);

      if (el) el.classList.toggle('hidden', x !== id);

    });

  }

 

  function hideMenus() {

    [

      'main-menu', 'profile-modal', 'settings-menu', 'levels-menu', 'my-levels-menu',

      'browse-levels-menu', 'level-detail-menu', 'battle-menu', 'battle-level-picker',

      'battle-waiting-menu', 'battle-incoming-menu', 'battle-result-menu',

      'editor-level-settings', 'creator-menu', 'effects-menu', 'death-screen'

    ].forEach(id => $(id)?.classList.add('hidden'));

  }

 

  function toggleMenu(id) {

    if (!$(id)) return;

    hideMenus();

    $(id).classList.remove('hidden');

    state.screen = id;

  }

 

  function updateThemeUI() {

    const settings = getSettings();

    document.documentElement.style.setProperty('--primary-theme', settings.primaryColor);

    document.documentElement.style.setProperty('--custom-bg', settings.bgColor);

    if ($('primary-color-picker')) $('primary-color-picker').value = settings.primaryColor;

    if ($('bg-color-picker')) $('bg-color-picker').value = settings.bgColor;

    if ($('setting-cbf')) $('setting-cbf').checked = !!settings.cbf;

  }

 

  window.updatePrimaryColor = value => {

    const settings = getSettings();

    settings.primaryColor = value || DEFAULT_SETTINGS.primaryColor;

    setSettings(settings);

    updateThemeUI();

  };

 

  function initProfiles() {

    if (!getProfiles().length) {

      safeJSONSet(KEYS.profiles, [{ name: 'Guest', createdAt: Date.now() }]);

    }

    if (!localStorage.getItem(KEYS.currentProfile)) localStorage.setItem(KEYS.currentProfile, 'Guest');

    updateProfileButton();

  }

 

  function updateProfileButton() {

    const btn = $('profile-btn');

    if (btn) btn.textContent = `👤 ${currentProfileName()}`;

  }

 

  window.openProfileModal = () => {

    renderProfiles();

    toggleMenu('profile-modal');

  };

 

  function renderProfiles() {

    const list = $('profile-modal-list');

    if (!list) return;

    const current = currentProfileName();

    list.innerHTML = '';

    getProfiles().forEach(profile => {

      const row = document.createElement('div');

      row.className = `profile-row${profile.name === current ? ' current' : ''}`;

      row.innerHTML = `<div class="profile-avatar">${escapeHtml(profile.name.slice(0, 1).toUpperCase())}</div><div class="profile-row-name">${escapeHtml(profile.name)}</div><div class="profile-row-tag">${profile.name === current ? 'CURRENT' : 'USE'}</div>`;

      row.onclick = () => switchProfile(profile.name);

      list.appendChild(row);

    });

  }

 

  window.createProfile = () => {

    const input = $('new-profile-name');

    const name = (input?.value || '').trim().replace(/\s+/g, ' ');

    if (!name) return alert('Enter a profile name.');

    const normalized = name.slice(0, 16);

    const profiles = getProfiles();

    if (profiles.some(p => p.name.toLowerCase() === normalized.toLowerCase())) {

      switchProfile(profiles.find(p => p.name.toLowerCase() === normalized.toLowerCase()).name);

      return;

    }

    profiles.push({ name: normalized, createdAt: Date.now() });

    safeJSONSet(KEYS.profiles, profiles);

    localStorage.setItem(KEYS.currentProfile, normalized);

    if (input) input.value = '';

    updateProfileButton();

    renderProfiles();

  };

 

  function switchProfile(name) {

    localStorage.setItem(KEYS.currentProfile, name);

    updateProfileButton();

    renderProfiles();

  }

 

  function escapeHtml(value) {

    return String(value)

      .replaceAll('&', '&amp;')

      .replaceAll('<', '&lt;')

      .replaceAll('>', '&gt;')

      .replaceAll('"', '&quot;')

      .replaceAll("'", '&#039;');

  }

 

  /* -------------------- BROWSE / LEVEL LIBRARY -------------------- */

  function levelCard(level, actions = '') {

    const safeTitle = escapeHtml(level.title || 'Untitled');

    const safeAuthor = escapeHtml(level.author || 'Unknown');

    const diff = escapeHtml(level.difficulty || 'Normal');

    return `<div class="song-card level-card">

      <div class="song-main">

        <div class="song-thumb">${level.icon || '🎵'}</div>

        <div class="song-info"><span class="song-title">${safeTitle}</span><span class="song-author">By: ${safeAuthor}</span></div>

        <button class="play-btn" data-play-level="${escapeHtml(level.id || '')}">PLAY</button>

      </div>

      <div class="speed-control"><span>${diff}</span><span style="margin-left:auto">${Number(level.likes || 0)} likes</span>${actions}</div>

    </div>`;

  }

 

  function bindLevelCardButtons(container, sourceLevels) {

    container?.querySelectorAll('[data-play-level]').forEach(btn => {

      btn.addEventListener('click', event => {

        event.stopPropagation();

        const id = btn.getAttribute('data-play-level');

        const level = sourceLevels.find(l => l.id === id);

        if (level) startGameWithLevel(level);

      });

    });

  }

 

  window.openMyLevels = () => {

    renderMyLevels();

    toggleMenu('my-levels-menu');

  };

 

  function renderMyLevels() {

    const wrap = $('custom-levels-container');

    if (!wrap) return;

    const levels = getCustomLevels().filter(x => x.author === currentProfileName());

    wrap.innerHTML = levels.length

      ? levels.map(level => levelCard(level, `<button class="mini-editor-btn" data-detail-level="${escapeHtml(level.id)}">INFO</button>`)).join('')

      : `<div style="padding:28px;text-align:center;color:var(--text-low);font-size:12px">No saved levels yet.<br>Create a level in the editor.</div>`;

    bindLevelCardButtons(wrap, levels);

    wrap.querySelectorAll('[data-detail-level]').forEach(btn => btn.onclick = () => openLevelDetail(levels.find(x => x.id === btn.dataset.detailLevel)));

  }

 

  window.openBrowseLevels = tab => {

    state.currentBrowseTab = tab || 'recent';

    renderBrowseLevels();

    toggleMenu('browse-levels-menu');

  };

 

  window.renderBrowseLevels = () => {

    const wrap = $('community-levels-container');

    if (!wrap) return;

    const input = $('browse-search-input');

    const query = (input?.value || '').trim().toLowerCase();

    let levels = getBrowseLevels();

    if (query) levels = levels.filter(l => String(l.title).toLowerCase().includes(query) || String(l.author).toLowerCase().includes(query));

 

    if (state.currentBrowseTab === 'trending') levels.sort((a,b) => (b.plays || 0) - (a.plays || 0));

    else if (state.currentBrowseTab === 'rated') levels.sort((a,b) => (b.likes || 0) - (a.likes || 0));

    else if (state.currentBrowseTab === 'featured') levels = levels.filter(l => l.featured);

    else levels.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

 

    ['recent','trending','rated','featured'].forEach(tab => $('tab-' + tab)?.classList.toggle('active', state.currentBrowseTab === tab));

    wrap.innerHTML = levels.length

      ? levels.map(level => levelCard(level)).join('')

      : `<div style="padding:28px;text-align:center;color:var(--text-low);font-size:12px">No levels found.</div>`;

    bindLevelCardButtons(wrap, levels);

  };

 

  function openLevelDetail(level) {

    if (!level) return;

    if ($('level-detail-title')) $('level-detail-title').textContent = level.title || 'LEVEL';

    if ($('level-detail-body')) $('level-detail-body').innerHTML = `

      <div style="display:grid;gap:8px;font-size:12px">

        <div><b>Creator</b><br><span style="color:var(--text-mid)">${escapeHtml(level.author || 'Unknown')}</span></div>

        <div><b>Difficulty</b><br><span style="color:var(--text-mid)">${escapeHtml(level.difficulty || 'Normal')}</span></div>

        <div><b>Duration</b><br><span style="color:var(--text-mid)">${Number(level.duration || 0).toFixed(2)}s</span></div>

        <div><b>Tiles</b><br><span style="color:var(--text-mid)">${Array.isArray(level.tiles) ? level.tiles.length : 0}</span></div>

        <div><b>Description</b><br><span style="color:var(--text-mid)">${escapeHtml(level.description || 'No description.')}</span></div>

      </div>`;

    state.currentLevel = level;

    toggleMenu('level-detail-menu');

  }

 

  window.closeLevelDetail = () => {

    renderBrowseLevels();

    toggleMenu('browse-levels-menu');

  };

 

  /* -------------------- GAME RUNTIME -------------------- */

  function makePattern(level) {

    const out = [];

    const duration = Number(level.duration || 20);

    const step = 0.42;

    let t = 0.6;

    let index = 0;

    while (t < duration) {

      const lane = (index * 7 + 1) % 4;

      out.push({ id: uid('tile'), lane, time: Number(t.toFixed(3)), hold: false, holdDuration: 0 });

      if (index % 11 === 4 && t + step * 0.5 < duration) {

        out.push({ id: uid('tile'), lane: (lane + 2) % 4, time: Number((t + step * 0.5).toFixed(3)), hold: false, holdDuration: 0 });

      }

      if (index % 17 === 9 && t + 0.05 < duration) {

        out.push({ id: uid('tile'), lane: lane, time: Number((t + 0.05).toFixed(3)), hold: true, holdDuration: 0.45 });

      }

      t += step;

      index++;

    }

    return out;

  }

 

  function normalizeLevel(level) {

    const clone = JSON.parse(JSON.stringify(level || {}));

    clone.id ||= uid('level');

    clone.title ||= 'Untitled Level';

    clone.author ||= currentProfileName();

    clone.speed = Number(clone.speed || 18);

    clone.duration = Number(clone.duration || 20);

    clone.lanes = Number(clone.lanes || 4);

    clone.tiles = Array.isArray(clone.tiles) ? clone.tiles : makePattern(clone);

    clone.effects = Array.isArray(clone.effects) ? clone.effects : [];

    clone.settings = { fps: 60, audioOffset: 0, disableHolds: false, difficulty: 'Normal', ...(clone.settings || {}) };

    return clone;

  }

 

  window.startGame = id => {

    const base = builtInLevels[id];

    if (!base) return;

    const level = normalizeLevel(base);

    startGameWithLevel(level);

  };

 

  function startGameWithLevel(level) {

    stopEditorTransport();

    state.currentLevel = normalizeLevel(level);

    state.gameRunning = true;

    state.gameStartedAt = now();

    state.gameElapsed = 0;

    state.gameScore = 0;

    state.gameCombo = 0;

    state.gameMisses = 0;

    state.gameLives = clamp(Number(state.currentLevel.startLives || state.currentLevel.settings?.lives || 3), 1, 10);

    state.gameSpeed = Number(state.currentLevel.speed || 18);

    state.gameTiles = state.currentLevel.tiles.map(t => ({ ...t, judged: false, hit: false }));

    hideMenus();

    $('game-hud')?.classList.remove('hidden');

    $('lives-display')?.classList.remove('hidden');

    $('canvas')?.focus?.();

    updateGameHUD();

    requestGameFrame();

    try { $('bg-audio')?.play?.(); } catch (_) {}

  }

 

  function requestGameFrame() {

    cancelAnimationFrame(state.gameRaf);

    state.lastFrame = now();

    const frame = t => {

      if (!state.gameRunning) return;

      state.gameRaf = requestAnimationFrame(frame);

      const dt = Math.max(0, (t - state.lastFrame) / 1000);

      state.lastFrame = t;

      state.gameElapsed = (t - state.gameStartedAt) / 1000;

      state.fps = dt > 0 ? Math.round(1 / dt) : 60;

      updateGameLogic();

      drawGame();

      updateGameHUD();

    };

    state.gameRaf = requestAnimationFrame(frame);

  }

 

  function updateGameLogic() {

    const hitWindow = 0.22;

    state.gameTiles.forEach(tile => {

      if (tile.judged) return;

      if (state.gameElapsed > tile.time + hitWindow + 0.1) {

        tile.judged = true;

        state.gameCombo = 0;

        state.gameMisses++;

        state.gameLives = Math.max(0, state.gameLives - 1);

        flashMiss();

        if (state.gameLives <= 0) finishGame(false);

      }

    });

 

    const duration = Number(state.currentLevel.duration || 0);

    if (duration && state.gameElapsed >= duration + 0.7) finishGame(true);

  }

 

  function canvasLaneAt(clientX) {

    const canvas = $('gameCanvas');

    if (!canvas) return 0;

    const rect = canvas.getBoundingClientRect();

    const x = clamp(clientX - rect.left, 0, rect.width - 1);

    return clamp(Math.floor((x / rect.width) * 4), 0, 3);

  }

 

  function judgeLane(lane) {

    if (!state.gameRunning) return;

    const target = state.gameTiles

      .filter(t => !t.judged && t.lane === lane)

      .sort((a,b) => Math.abs(a.time - state.gameElapsed) - Math.abs(b.time - state.gameElapsed))[0];

    if (!target) {

      state.gameCombo = 0;

      return;

    }

    const delta = state.gameElapsed - target.time;

    if (Math.abs(delta) <= (getSettings().cbf ? 0.23 : 0.18)) {

      target.judged = true;

      target.hit = true;

      const perfect = Math.abs(delta) < 0.065;

      const great = Math.abs(delta) < 0.13;

      state.gameCombo++;

      state.gameScore += perfect ? 1000 : great ? 750 : 500;

      pulseScore(perfect ? 'PERFECT' : great ? 'GREAT' : 'GOOD');

    } else if (delta < 0) {

      // Early tap: leave tile alive; this feels more like a rhythm game than a hard miss.

      state.gameCombo = Math.max(0, state.gameCombo - 1);

    }

  }

 

  function drawGame() {

    const canvas = $('gameCanvas');

    const ctx = canvas?.getContext('2d');

    if (!canvas || !ctx) return;

    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#07070d';

    ctx.fillRect(0, 0, w, h);

 

    const laneW = w / 4;

    for (let i = 1; i < 4; i++) {

      ctx.strokeStyle = 'rgba(255,255,255,.08)';

      ctx.lineWidth = 1;

      ctx.beginPath(); ctx.moveTo(i * laneW, 0); ctx.lineTo(i * laneW, h); ctx.stroke();

    }

    ctx.strokeStyle = 'rgba(0,240,255,.35)';

    ctx.lineWidth = 2;

    ctx.beginPath(); ctx.moveTo(0, h * 0.82); ctx.lineTo(w, h * 0.82); ctx.stroke();

 

    const pixelsPerSecond = Math.max(260, Number(state.gameSpeed || 18) * 22);

    state.gameTiles.forEach(tile => {

      if (tile.judged && tile.hit) return;

      const y = h * 0.82 - ((tile.time - state.gameElapsed) * pixelsPerSecond);

      const tileH = tile.hold ? 26 + (tile.holdDuration || 0.45) * pixelsPerSecond : 92;

      if (y > h + 30 || y + tileH < -40) return;

      const x = tile.lane * laneW + 3;

      const tw = laneW - 6;

      const grad = ctx.createLinearGradient(x, y, x, y + tileH);

      grad.addColorStop(0, tile.hold ? '#ff8a3d' : '#f5f5f5');

      grad.addColorStop(1, tile.hold ? '#d95313' : '#a8a8b8');

      ctx.fillStyle = grad;

      roundRect(ctx, x, y, tw, tileH, 9);

      ctx.fill();

      ctx.strokeStyle = tile.hold ? 'rgba(255,184,124,.95)' : 'rgba(255,255,255,.38)';

      ctx.stroke();

    });

  }

 

  function roundRect(ctx, x, y, w, h, r) {

    const rr = Math.min(r, w / 2, h / 2);

    ctx.beginPath();

    ctx.moveTo(x + rr, y);

    ctx.arcTo(x + w, y, x + w, y + h, rr);

    ctx.arcTo(x + w, y + h, x, y + h, rr);

    ctx.arcTo(x, y + h, x, y, rr);

    ctx.arcTo(x, y, x + w, y, rr);

    ctx.closePath();

  }

 

  function updateGameHUD() {

    if ($('score')) $('score').textContent = state.gameScore.toLocaleString();

    if ($('fps-display')) $('fps-display').textContent = `${state.fps || 60} FPS`;

    if ($('progress-display')) {

      const d = Number(state.currentLevel?.duration || 1);

      $('progress-display').textContent = `${clamp((state.gameElapsed / d) * 100, 0, 100).toFixed(0)}%`;

    }

    if ($('lives-count')) $('lives-count').textContent = String(state.gameLives);

  }

 

  function pulseScore(text) {

    const el = $('rest-msg');

    if (!el) return;

    el.textContent = text;

    el.style.opacity = '1';

    clearTimeout(pulseScore.timer);

    pulseScore.timer = setTimeout(() => { el.style.opacity = '0'; }, 280);

  }

 

  function flashMiss() {

    const el = $('red-flash');

    if (!el) return;

    el.style.transition = 'opacity 80ms';

    el.style.opacity = '0.25';

    setTimeout(() => { el.style.opacity = '0'; }, 100);

  }

 

  function finishGame(win) {

    if (!state.gameRunning) return;

    state.gameRunning = false;

    cancelAnimationFrame(state.gameRaf);

    try { $('bg-audio')?.pause?.(); } catch (_) {}

    $('game-hud')?.classList.add('hidden');

    $('lives-display')?.classList.add('hidden');

    const title = $('death-title');

    const final = $('final-score');

    if (title) {

      title.textContent = win ? 'LEVEL COMPLETE' : 'FAILED';

      title.style.color = win ? 'var(--accent-success)' : '#ff3333';

    }

    if (final) final.textContent = `Score: ${state.gameScore.toLocaleString()} · Combo: ${state.gameCombo}`;

    toggleMenu('death-screen');

  }

 

  window.restartGame = () => {

    if (state.currentLevel) startGameWithLevel(state.currentLevel);

  };

 

  window.quitPlaytestOrGame = () => {

    state.gameRunning = false;

    cancelAnimationFrame(state.gameRaf);

    $('game-hud')?.classList.add('hidden');

    $('lives-display')?.classList.add('hidden');

    showMainMenu();

  };

 

  window.stopPlaytestFromDeath = () => {

    stopPlaytest();

    showMainMenu();

  };

 

  /* -------------------- FILE AUDIO / LEVEL IMPORT -------------------- */

  window.loadAudioFile = event => {

    const file = event?.target?.files?.[0];

    if (!file) return;

    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);

    state.audioUrl = URL.createObjectURL(file);

    const audio = $('bg-audio');

    if (audio) {

      audio.src = state.audioUrl;

      audio.load();

    }

    if (state.editorLevel) state.editorLevel.audioName = file.name;

  };

 

  window.loadCustomLevelFile = event => {

    const file = event?.target?.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {

      try {

        const data = normalizeLevel(JSON.parse(String(reader.result || '{}')));

        data.author = data.author || currentProfileName();

        startGameWithLevel(data);

      } catch (err) {

        console.error(err);

        alert('That JSON level could not be loaded.');

      }

    };

    reader.readAsText(file);

  };

 

  window.verifyAndDownloadLevel = () => {

    const level = buildEditorLevel(true);

    if (!level.title.trim()) {

      alert('Give the level a title first.');

      return;

    }

    const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = `${slugify(level.title)}.json`;

    a.click();

    URL.revokeObjectURL(url);

  };

 

  /* -------------------- EDITOR -------------------- */

  function newEditorLevel() {

    return {

      id: uid('level'),

      title: '',

      description: '',

      author: currentProfileName(),

      speed: 18,

      duration: 60,

      icon: '🎵',

      difficulty: 'Normal',

      startLives: 3,

      lanes: 4,

      tiles: [],

      effects: [],

      settings: { fps: 60, audioOffset: 0, disableHolds: false, difficulty: 'Normal' }

    };

  }

 

  function ensureEditorLevel() {

    if (!state.editorLevel) state.editorLevel = newEditorLevel();

    return state.editorLevel;

  }

 

  window.startEditor = () => {

    state.gameRunning = false;

    cancelAnimationFrame(state.gameRaf);

    ensureEditorLevel();

    state.editorOpen = true;

    state.screen = 'editor';

    hideMenus();

    $('editor-ui')?.classList.remove('hidden');

    state.screen = 'editor';

    drawEditor();

    renderEffectTimeline();

    updateEditorTimeUI();

  };

 

  window.openCreatorMenu = () => toggleMenu('creator-menu');

  window.closeCreatorMenu = () => {

    hideMenus();

    $('editor-ui')?.classList.remove('hidden');

    state.screen = 'editor';

  };

 

  window.openEditorSettingsMenu = () => {

    $('editor-level-settings')?.classList.remove('hidden');

    state.screen = 'editor-settings';

  };

 

  window.closeEditorSettingsMenu = () => {

    $('editor-level-settings')?.classList.add('hidden');

    state.screen = 'editor';

    $('editor-ui')?.classList.remove('hidden');

  };

 

  function exitEditor() {

    stopEditorTransport();

    state.editorOpen = false;

    state.editorRecording = false;

    state.editorLevel = null;

    state.selectedEffectId = null;

    $('editor-ui')?.classList.add('hidden');

    hideMenus();

    showMainMenu();

  }

 

  window.exitEditorWithoutSaving = () => {

    if (confirm('Quit the editor without saving?')) exitEditor();

  };

 

  window.toggleDrawer = side => {

    const target = $('drawer-' + side);

    const other = side === 'left' ? $('drawer-right') : $('drawer-left');

    target?.classList.toggle('open');

    other?.classList.remove('open');

    $('drawer-backdrop')?.classList.toggle('show', !!target?.classList.contains('open'));

  };

 

  window.closeAllDrawers = () => {

    $('drawer-left')?.classList.remove('open');

    $('drawer-right')?.classList.remove('open');

    $('drawer-backdrop')?.classList.remove('show');

  };

 

  window.toggleTimelineDock = () => $('timeline-dock')?.classList.toggle('collapsed');

 

  window.setEditorTileMode = mode => {

    state.editorTileMode = mode === 'hold' ? 'hold' : 'normal';

    $('editor-tool-normal')?.classList.toggle('active', state.editorTileMode === 'normal');

    $('editor-tool-hold')?.classList.toggle('active', state.editorTileMode === 'hold');

  };

 

  window.toggleDeleteMode = () => {

    state.editorDeleteMode = !state.editorDeleteMode;

    ['btn-delete-mode','btn-delete-mode-2'].forEach(id => $(id)?.classList.toggle('active', state.editorDeleteMode));

    $('gameCanvas')?.classList.toggle('delete-mode', state.editorDeleteMode);

  };

 

  window.toggleRecording = () => {

    state.editorRecording = !state.editorRecording;

    $('btn-create-tiles')?.classList.toggle('active', state.editorRecording);

    if (state.editorRecording && state.editorTime === 0) setEditorTime(0);

  };

 

  window.setEditorGrid = value => {

    state.editorGrid = [2,4,8,12].includes(Number(value)) ? Number(value) : 2;

    document.querySelectorAll('.grid-btn').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.grid) === state.editorGrid));

    updateGridReadout();

  };

 

  function snapEditorTime(value) {

    if (!Number.isFinite(value)) return 0;

    const step = 0.5 / state.editorGrid;

    return Math.round(value / step) * step;

  }

 

  function setEditorTime(value, bypassSnap = false) {

    const level = ensureEditorLevel();

    const max = Math.max(1, Number(level.duration || 60));

    state.editorTime = clamp(bypassSnap ? Number(value) : snapEditorTime(Number(value)), 0, max);

    updateEditorTimeUI();

    renderEditorMarkers();

    updateEffectPlayhead();

  }

 

  function updateEditorTimeUI() {

    const text = `${state.editorTime.toFixed(2)}s`;

    ['editor-timer-panel','editor-timeline-time','effect-time-display'].forEach(id => { if ($(id)) $(id).textContent = text; });

    const slider = $('timeline-slider');

    if (slider) {

      slider.max = String(Math.max(1, Number(ensureEditorLevel().duration || 60)));

      slider.value = String(state.editorTime);

    }

    updateGridReadout();

  }

 

  function updateGridReadout() {

    const step = 0.5 / state.editorGrid;

    if ($('grid-readout')) $('grid-readout').textContent = `${step.toFixed(3)}s`;

  }

 

  window.scrubTimeline = value => setEditorTime(Number(value), false);

  window.nudgeEditorTime = amount => setEditorTime(state.editorTime + Number(amount), false);

  window.jumpEditorEnd = () => setEditorTime(ensureEditorLevel().duration || 60);

 

  window.toggleEditorTransport = () => {

    if (state.editorPlaying) stopEditorTransport();

    else startEditorTransport();

  };

 

  function startEditorTransport() {

    state.editorPlaying = true;

    state.editorTransportStarted = now();

    state.editorTransportBase = state.editorTime;

    $('editor-transport-btn') && ($('editor-transport-btn').textContent = '⏸');

    cancelAnimationFrame(state.editorRaf);

    const loop = t => {

      if (!state.editorPlaying) return;

      const elapsed = (t - state.editorTransportStarted) / 1000;

      const next = state.editorTransportBase + elapsed;

      if (next >= Number(ensureEditorLevel().duration || 60)) {

        setEditorTime(ensureEditorLevel().duration || 60);

        stopEditorTransport();

        return;

      }

      setEditorTime(next, true);

      drawEditor();

      state.editorRaf = requestAnimationFrame(loop);

    };

    state.editorRaf = requestAnimationFrame(loop);

  }

 

  function stopEditorTransport() {

    state.editorPlaying = false;

    cancelAnimationFrame(state.editorRaf);

    if ($('editor-transport-btn')) $('editor-transport-btn').textContent = '▶';

  }

 

  window.startPlaytest = () => {

    const level = buildEditorLevel(false);

    if (!level.tiles.length) {

      if (!confirm('There are no tiles yet. Start playtest anyway?')) return;

    }

    state.currentLevel = level;

    const lives = Number($('edit-lives')?.value || 3);

    state.currentLevel.startLives = clamp(lives, 1, 10);

    state.currentLevel.settings.disableHolds = !!$('edit-disable-holds')?.checked;

    state.currentLevel.settings.fps = Number($('edit-fps')?.value || 60);

    state.currentLevel.settings.audioOffset = Number($('edit-audio-offset')?.value || 0);

    state.currentLevel.settings.difficulty = $('edit-difficulty')?.value || 'Normal';

    state.currentLevel.speed = clamp(Number(state.currentLevel.speed || 18), 5, 50);

    state.gameRunning = true;

    state.editorOpen = true;

    state.gameStartedAt = now();

    state.gameElapsed = 0;

    state.gameScore = 0;

    state.gameCombo = 0;

    state.gameLives = state.currentLevel.startLives;

    state.gameTiles = state.currentLevel.tiles.map(t => ({ ...t, judged: false, hit: false }));

    $('editor-ui')?.classList.add('hidden');

    hideMenus();

    $('stop-playtest-btn')?.classList.remove('hidden');

    $('game-hud')?.classList.remove('hidden');

    $('lives-display')?.classList.remove('hidden');

    requestGameFrame();

  };

 

  window.stopPlaytest = () => {

    state.gameRunning = false;

    cancelAnimationFrame(state.gameRaf);

    $('stop-playtest-btn')?.classList.add('hidden');

    $('game-hud')?.classList.add('hidden');

    $('lives-display')?.classList.add('hidden');

    if (state.editorOpen) {

      $('editor-ui')?.classList.remove('hidden');

      hideMenus();

      state.screen = 'editor';

      drawEditor();

    } else {

      showMainMenu();

    }

  };

 

  function buildEditorLevel(includeDefaults = false) {

    const l = ensureEditorLevel();

    l.title = (l.title || $('edit-level-title')?.value || '').trim();

    l.speed = Number(l.speed || 18);

    l.duration = Math.max(1, Number(l.duration || 60));

    l.author = currentProfileName();

    l.settings = {

      fps: Number($('edit-fps')?.value || l.settings?.fps || 60),

      audioOffset: Number($('edit-audio-offset')?.value || l.settings?.audioOffset || 0),

      disableHolds: !!$('edit-disable-holds')?.checked || !!l.settings?.disableHolds,

      difficulty: $('edit-difficulty')?.value || l.settings?.difficulty || 'Normal'

    };

    l.difficulty = l.settings.difficulty;

    l.startLives = clamp(Number($('edit-lives')?.value || l.startLives || 3), 1, 10);

    l.tiles = Array.isArray(l.tiles) ? l.tiles.slice().sort((a,b) => a.time - b.time || a.lane - b.lane) : [];

    l.effects = Array.isArray(l.effects) ? l.effects : [];

    if (includeDefaults && !l.id) l.id = uid('level');

    return normalizeLevel(l);

  }

 

  window.saveCustomLevel = () => {

    const level = buildEditorLevel(false);

    if (!level.title.trim()) {

      alert('Give your level a title before saving.');

      return;

    }

    const levels = getCustomLevels().filter(x => !(x.id === level.id && x.author === currentProfileName()));

    levels.push(level);

    saveCustomLevels(levels);

    alert('Saved to My Levels.');

    exitEditor();

  };

 

  window.publishLevel = () => {

    const level = buildEditorLevel(false);

    if (!level.title.trim()) {

      alert('A level title is required to publish.');

      return;

    }

    const browse = getBrowseLevels().filter(x => x.id !== level.id);

    browse.push({ ...level, publishedAt: Date.now(), createdAt: level.createdAt || Date.now(), plays: level.plays || 0, likes: level.likes || 0, featured: false });

    saveBrowseLevels(browse);

    alert('Published to the local browser library.');

    exitEditor();

  };

 

  function placeEditorTile(lane, time = state.editorTime, bypassSnap = false) {

    const level = ensureEditorLevel();

    const snapped = clamp(bypassSnap ? time : snapEditorTime(time), 0, Math.max(0.5, level.duration));

    const hold = state.editorTileMode === 'hold';

    const existing = level.tiles.find(t => t.lane === lane && Math.abs(t.time - snapped) < 0.001);

    if (state.editorDeleteMode) {

      if (existing) level.tiles = level.tiles.filter(t => t !== existing);

    } else if (!existing) {

      level.tiles.push({ id: uid('tile'), lane, time: Number(snapped.toFixed(4)), hold, holdDuration: hold ? 0.45 : 0 });

    } else if (hold) {

      existing.hold = true;

      existing.holdDuration = existing.holdDuration || 0.45;

    }

    state.editorLevel = level;

    renderEditorMarkers();

    drawEditor();

  }

 

  function editorLaneFromClientX(clientX) {

    const canvas = $('gameCanvas');

    if (!canvas) return 0;

    const rect = canvas.getBoundingClientRect();

    return clamp(Math.floor(clamp((clientX - rect.left) / rect.width, 0, 0.9999) * 4), 0, 3);

  }

 

  function bindCanvasInput() {

    const canvas = $('gameCanvas');

    if (!canvas || canvas.dataset.runtimeBound) return;

    canvas.dataset.runtimeBound = '1';

 

    canvas.addEventListener('pointerdown', event => {

      if (state.editorOpen && !$('editor-ui')?.classList.contains('hidden')) {

        event.preventDefault();

        if (event.shiftKey) {

          const rect = canvas.getBoundingClientRect();

          const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);

          const duration = Number(ensureEditorLevel().duration || 60);

          setEditorTime(ratio * duration, true);

        }

        placeEditorTile(editorLaneFromClientX(event.clientX), state.editorTime, event.shiftKey);

      } else if (state.gameRunning) {

        judgeLane(canvasLaneAt(event.clientX));

      }

    });

  }

 

  function drawEditor() {

    const canvas = $('gameCanvas');

    const ctx = canvas?.getContext('2d');

    if (!canvas || !ctx) return;

    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#07070d'; ctx.fillRect(0, 0, w, h);

    const laneW = w / 4;

 

    for (let i = 1; i < 4; i++) {

      ctx.strokeStyle = 'rgba(255,255,255,.08)';

      ctx.beginPath(); ctx.moveTo(i * laneW, 0); ctx.lineTo(i * laneW, h); ctx.stroke();

    }

    ctx.strokeStyle = 'rgba(0,240,255,.18)';

    ctx.beginPath(); ctx.moveTo(0, h * 0.82); ctx.lineTo(w, h * 0.82); ctx.stroke();

 

    const level = ensureEditorLevel();

    const scale = Math.max(5, Number(level.speed || 18)) * 8;

    const markerY = h * 0.62;

    level.tiles.forEach(tile => {

      const y = markerY - ((tile.time - state.editorTime) * scale);

      if (y < -80 || y > h + 80) return;

      const x = tile.lane * laneW + 5;

      const tw = laneW - 10;

      ctx.fillStyle = tile.hold ? '#ff8a3d' : '#f0f2f7';

      roundRect(ctx, x, y, tw, tile.hold ? 38 : 72, 9); ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();

    });

 

    ctx.fillStyle = 'rgba(0,240,255,.18)';

    ctx.fillRect(0, markerY - 1, w, 2);

  }

 

  function renderEditorMarkers() {

    const layer = $('editor-marker-layer');

    if (!layer) return;

    const level = ensureEditorLevel();

    const duration = Math.max(1, Number(level.duration || 60));

    layer.innerHTML = '';

    [...level.tiles].sort((a,b) => a.time - b.time).forEach(tile => {

      const marker = document.createElement('div');

      marker.className = `timeline-marker${tile.hold ? ' hold' : ''}`;

      marker.style.left = `${clamp((tile.time / duration) * 100, 0, 100)}%`;

      marker.title = `${tile.hold ? 'Hold' : 'Tap'} · ${tile.time.toFixed(2)}s · lane ${tile.lane + 1}`;

      marker.onclick = e => { e.stopPropagation(); setEditorTime(tile.time, true); };

      layer.appendChild(marker);

    });

    const playhead = $('editor-playhead');

    if (playhead) playhead.style.left = `${clamp((state.editorTime / duration) * 100, 0, 100)}%`;

  }

 

  /* -------------------- EFFECT EDITOR -------------------- */

  function effectDefaults(type) {

    const base = { id: uid('fx'), type, start: state.editorTime, duration: 1, selected: false };

    if (type === 'pulse') return { ...base, duration: 0.5, color: '#00f0ff', strength: 0.75 };

    if (type === 'tile-style') return { ...base, duration: 1, normalColor: '#ffffff', holdColor: '#ff8a3d' };

    if (type === 'speed') return { ...base, duration: 1, targetSpeed: 25, transition: 0.5 };

    if (type === 'image') return { ...base, duration: 2, opacity: 0.5, fadeIn: 0.3, fadeOut: 0.3, dataUrl: '' };

    if (type === 'extra-image') return { ...base, duration: 2, width: 150, height: 150, opacity: 1, position: state.extraImagePosition || 'center', dataUrl: '' };

    if (type === 'sfx') return { ...base, duration: 0.01, dataUrl: '', audioName: '' };

    return base;

  }

 

  window.openEffectsMenu = () => {

    ensureEditorLevel();

    renderEffectTimeline();

    toggleMenu('effects-menu');

    updateEffectPlayhead();

  };

 

  window.closeEffectsMenu = () => {

    $('effects-menu')?.classList.add('hidden');

    $('editor-ui')?.classList.remove('hidden');

    state.screen = 'editor';

    renderEditorMarkers();

    drawEditor();

  };

 

  window.switchEffectCategory = category => {

    state.effectCategory = category;

    ['visual','speed','image','audio'].forEach(x => $('effect-library-' + x)?.classList.toggle('hidden', x !== category));

    document.querySelectorAll('.effect-tab').forEach(tab => tab.classList.toggle('active', tab.textContent.toLowerCase() === category));

  };

 

  function addEffect(effect) {

    const level = ensureEditorLevel();

    level.effects.push(effect);

    state.selectedEffectId = effect.id;

    renderEffectTimeline();

    renderEffectInspector();

    updateEffectSelectionDrawer();

  }

 

  window.addPulseEffect = () => addEffect(effectDefaults('pulse'));

  window.addTileStyleEffect = () => addEffect(effectDefaults('tile-style'));

  window.addSpeedEffect = () => {

    const fx = effectDefaults('speed');

    fx.targetSpeed = clamp(Number($('fx-speed-target')?.value || 25), 5, 50);

    fx.transition = Math.max(0, Number($('fx-speed-trans')?.value || 0.5));

    addEffect(fx);

  };

  window.setSpeedPreset = multiplier => {

    const fx = effectDefaults('speed');

    fx.targetSpeed = clamp(Math.round((Number(ensureEditorLevel().speed || 18) * Number(multiplier)) * 10) / 10, 5, 50);

    fx.duration = 1;

    addEffect(fx);

  };

 

  function readFileAsDataURL(file) {

    return new Promise((resolve, reject) => {

      if (!file) return resolve('');

      const r = new FileReader();

      r.onload = () => resolve(String(r.result || ''));

      r.onerror = reject;

      r.readAsDataURL(file);

    });

  }

 

  window.addImageEffect = async () => {

    const fx = effectDefaults('image');

    fx.opacity = clamp(Number($('fx-img-alpha')?.value || 0.5), 0, 1);

    fx.duration = Math.max(0.1, Number($('fx-img-dur')?.value || 2));

    fx.fadeIn = Math.max(0, Number($('fx-img-in')?.value || 0.3));

    fx.fadeOut = Math.max(0, Number($('fx-img-out')?.value || 0.3));

    fx.dataUrl = await readFileAsDataURL($('fx-img-upload')?.files?.[0]);

    addEffect(fx);

  };

 

  window.setExtraImagePosition = position => { state.extraImagePosition = position; };

 

  window.addExtraImageEffect = async () => {

    const fx = effectDefaults('extra-image');

    fx.width = Math.max(1, Number($('fx-extra-w')?.value || 150));

    fx.height = Math.max(1, Number($('fx-extra-h')?.value || 150));

    fx.opacity = clamp(Number($('fx-extra-alpha')?.value || 1), 0, 1);

    fx.duration = Math.max(0.1, Number($('fx-extra-dur')?.value || 2));

    fx.position = state.extraImagePosition;

    fx.dataUrl = await readFileAsDataURL($('fx-extra-upload')?.files?.[0]);

    addEffect(fx);

  };

 

  window.addSfxEffect = async () => {

    const file = $('fx-sfx-upload')?.files?.[0];

    const fx = effectDefaults('sfx');

    fx.dataUrl = await readFileAsDataURL(file);

    fx.audioName = file?.name || '';

    addEffect(fx);

  };

 

  function renderEffectTimeline() {

    const wrap = $('effect-timeline-wrap');

    const tracks = $('effect-tracks');

    const ruler = $('effect-time-ruler');

    if (!wrap || !tracks || !ruler) return;

    const level = ensureEditorLevel();

    const duration = Math.max(5, Number(level.duration || 60));

    const width = Math.max(wrap.clientWidth - 80, duration * 80);

 

    tracks.style.width = width + 'px';

    ruler.style.width = width + 'px';

    tracks.innerHTML = '';

    ruler.innerHTML = '';

 

    for (let t = 0; t <= duration; t += 1) {

      const tick = document.createElement('span');

      tick.textContent = `${t}s`;

      tick.style.cssText = `position:absolute;left:${(t/duration)*100}%;top:5px;font-size:9px;color:var(--text-low);transform:translateX(-50%)`;

      ruler.appendChild(tick);

    }

 

    const effects = level.effects.slice().sort((a,b) => a.start - b.start);

    const tracksByType = {};

    effects.forEach(fx => {

      const key = effectTrackKey(fx.type);

      tracksByType[key] ||= [];

      tracksByType[key].push(fx);

    });

    const keys = Object.keys(tracksByType);

    if (!keys.length) {

      const empty = document.createElement('div');

      empty.style.cssText = 'padding:30px;color:var(--text-low);font-size:12px;text-align:center';

      empty.textContent = 'No effects yet — add one from the library.';

      tracks.appendChild(empty);

    }

    keys.forEach((key, rowIndex) => {

      const row = document.createElement('div');

      row.className = 'effect-track-row';

      row.style.width = width + 'px';

      row.dataset.track = key;

      tracks.appendChild(row);

      tracksByType[key].forEach(fx => renderEffectBlock(row, fx, duration, width));

    });

    if (state.selectedEffectId) updateEffectSelectionDrawer();

    updateEffectPlayhead();

  }

 

  function effectTrackKey(type) {

    if (type === 'pulse' || type === 'tile-style') return 'VISUAL';

    if (type === 'speed') return 'SPEED';

    if (type === 'image' || type === 'extra-image') return 'IMAGE';

    return 'AUDIO';

  }

 

  function effectTint(type) {

    return type === 'speed' ? '#9d4edd' : type === 'image' || type === 'extra-image' ? '#ff2e88' : type === 'sfx' ? '#ffc93c' : '#0055ff';

  }

 

  function renderEffectBlock(row, fx, duration, width) {

    const block = document.createElement('div');

    block.className = `effect-block${state.selectedEffectId === fx.id ? ' selected' : ''}`;

    block.style.left = `${(fx.start / duration) * width}px`;

    block.style.width = `${Math.max(34, (Math.max(0.05, fx.duration) / duration) * width)}px`;

    block.style.background = effectTint(fx.type);

    block.dataset.effectId = fx.id;

    block.title = `${fx.type} · ${fx.start.toFixed(2)}s · ${fx.duration.toFixed(2)}s`;

    block.innerHTML = `<span class="resize-handle left"></span><span style="pointer-events:none">${fx.type.toUpperCase()}</span><span class="resize-handle right"></span>`;

 

    block.addEventListener('pointerdown', event => {

      event.stopPropagation();

      const rect = block.getBoundingClientRect();

      const x = event.clientX - rect.left;

      if (x <= 8) beginEffectResize(fx, 'left', event);

      else if (rect.width - x <= 8) beginEffectResize(fx, 'right', event);

      else beginEffectDrag(fx, event);

    });

    block.addEventListener('click', event => { event.stopPropagation(); selectEffect(fx.id); });

    row.appendChild(block);

  }

 

  function beginEffectDrag(fx, event) {

    selectEffect(fx.id);

    const wrap = $('effect-timeline-wrap');

    const duration = Math.max(5, Number(ensureEditorLevel().duration || 60));

    const width = Math.max(wrap.clientWidth - 80, duration * 80);

    state.effectDrag = { mode: 'move', fx, startX: event.clientX, originalStart: fx.start, duration, width, shift: event.shiftKey };

    window.addEventListener('pointermove', onEffectPointerMove);

    window.addEventListener('pointerup', endEffectPointer);

  }

 

  function beginEffectResize(fx, side, event) {

    selectEffect(fx.id);

    const wrap = $('effect-timeline-wrap');

    const duration = Math.max(5, Number(ensureEditorLevel().duration || 60));

    const width = Math.max(wrap.clientWidth - 80, duration * 80);

    state.effectDrag = { mode: side, fx, startX: event.clientX, originalStart: fx.start, originalDuration: fx.duration, duration, width, shift: event.shiftKey };

    window.addEventListener('pointermove', onEffectPointerMove);

    window.addEventListener('pointerup', endEffectPointer);

  }

 

  function onEffectPointerMove(event) {

    const d = state.effectDrag;

    if (!d) return;

    const deltaTime = ((event.clientX - d.startX) / d.width) * d.duration;

    const free = event.shiftKey || d.shift;

    if (d.mode === 'move') {

      d.fx.start = clamp(free ? d.originalStart + deltaTime : snapEditorTime(d.originalStart + deltaTime), 0, d.duration);

    } else if (d.mode === 'left') {

      const end = d.originalStart + d.originalDuration;

      const newStart = clamp(free ? d.originalStart + deltaTime : snapEditorTime(d.originalStart + deltaTime), 0, Math.max(0, end - 0.05));

      d.fx.start = newStart;

      d.fx.duration = end - newStart;

    } else if (d.mode === 'right') {

      const newEnd = clamp(free ? d.originalStart + d.originalDuration + deltaTime : snapEditorTime(d.originalStart + d.originalDuration + deltaTime), d.originalStart + 0.05, d.duration);

      d.fx.duration = newEnd - d.fx.start;

    }

    renderEffectTimeline();

    renderEffectInspector();

  }

 

  function endEffectPointer() {

    window.removeEventListener('pointermove', onEffectPointerMove);

    window.removeEventListener('pointerup', endEffectPointer);

    state.effectDrag = null;

  }

 

  function selectEffect(id) {

    state.selectedEffectId = id;

    renderEffectTimeline();

    renderEffectInspector();

    updateEffectSelectionDrawer();

  }

 

  function selectedEffect() {

    return ensureEditorLevel().effects.find(x => x.id === state.selectedEffectId) || null;

  }

 

  function renderEffectInspector() {

    const host = $('effect-inspector-content');

    const subtitle = $('effect-inspector-subtitle');

    if (!host) return;

    const fx = selectedEffect();

    if (!fx) {

      if (subtitle) subtitle.textContent = 'Select an effect';

      host.innerHTML = `<div class="effect-inspector-empty"><div class="inspector-empty-icon">✦</div><b>Select an effect</b><span>Pick a block from the timeline to edit its timing, duration and properties.</span></div>`;

      return;

    }

    if (subtitle) subtitle.textContent = fx.type.toUpperCase();

    host.innerHTML = `

      <div class="inspector-field"><span>Start</span><input data-field="start" type="number" step="0.01" value="${fx.start.toFixed(2)}"></div>

      <div class="inspector-field"><span>Duration</span><input data-field="duration" type="number" min="0.01" step="0.01" value="${fx.duration.toFixed(2)}"></div>

      ${effectInspectorFields(fx)}

      <button class="mini-editor-btn danger-mini" style="width:100%;margin-top:6px" id="inspector-delete">DELETE EFFECT</button>`;

    host.querySelectorAll('[data-field]').forEach(input => {

      input.addEventListener('change', () => {

        const field = input.dataset.field;

        const value = Number(input.value);

        if (field === 'start') fx.start = clamp(value, 0, ensureEditorLevel().duration);

        else if (field === 'duration') fx.duration = clamp(value, 0.01, ensureEditorLevel().duration - fx.start);

        else if (field === 'targetSpeed') fx.targetSpeed = clamp(value, 5, 50);

        else if (field === 'transition') fx.transition = Math.max(0, value);

        else if (field === 'opacity') fx.opacity = clamp(value, 0, 1);

        else if (field === 'width' || field === 'height') fx[field] = Math.max(1, value);

        else if (field === 'fadeIn' || field === 'fadeOut') fx[field] = Math.max(0, value);

        renderEffectTimeline();

        renderEffectInspector();

        updateEffectSelectionDrawer();

      });

    });

    $('inspector-delete')?.addEventListener('click', deleteSelectedEffect);

  }

 

  function effectInspectorFields(fx) {

    if (fx.type === 'speed') return `<div class="inspector-field"><span>Target speed</span><input data-field="targetSpeed" type="number" min="5" max="50" step="1" value="${fx.targetSpeed}"></div><div class="inspector-field"><span>Transition</span><input data-field="transition" type="number" min="0" step="0.05" value="${fx.transition}"></div>`;

    if (fx.type === 'image') return `<div class="inspector-field"><span>Opacity</span><input data-field="opacity" type="number" min="0" max="1" step="0.05" value="${fx.opacity}"></div><div class="inspector-field"><span>Fade in</span><input data-field="fadeIn" type="number" min="0" step="0.05" value="${fx.fadeIn}"></div><div class="inspector-field"><span>Fade out</span><input data-field="fadeOut" type="number" min="0" step="0.05" value="${fx.fadeOut}"></div>`;

    if (fx.type === 'extra-image') return `<div class="inspector-field"><span>Width</span><input data-field="width" type="number" min="1" value="${fx.width}"></div><div class="inspector-field"><span>Height</span><input data-field="height" type="number" min="1" value="${fx.height}"></div><div class="inspector-field"><span>Opacity</span><input data-field="opacity" type="number" min="0" max="1" step="0.05" value="${fx.opacity}"></div>`;

    return '';

  }

 

  window.nudgeSelectedEffect = amount => {

    const fx = selectedEffect();

    if (!fx) return;

    fx.start = clamp(snapEditorTime(fx.start + Number(amount)), 0, ensureEditorLevel().duration);

    renderEffectTimeline();

    renderEffectInspector();

    updateEffectSelectionDrawer();

  };

 

  window.setSelectedEffectToPlayhead = () => {

    const fx = selectedEffect();

    if (!fx) return;

    fx.start = clamp(state.editorTime, 0, ensureEditorLevel().duration - 0.01);

    renderEffectTimeline();

    renderEffectInspector();

    updateEffectSelectionDrawer();

  };

 

  window.deleteSelectedEffect = () => {

    const level = ensureEditorLevel();

    if (!state.selectedEffectId) return;

    level.effects = level.effects.filter(x => x.id !== state.selectedEffectId);

    state.selectedEffectId = null;

    renderEffectTimeline();

    renderEffectInspector();

    updateEffectSelectionDrawer();

  };

 

  function updateEffectPlayhead() {

    const level = ensureEditorLevel();

    const duration = Math.max(5, Number(level.duration || 60));

    const wrap = $('effect-timeline-wrap');

    const ph = $('effect-timeline-playhead');

    if (!ph || !wrap) return;

    ph.style.left = `${(state.editorTime / duration) * Math.max(wrap.clientWidth - 80, duration * 80)}px`;

  }

 

  function updateEffectSelectionDrawer() {

    const fx = selectedEffect();

    $('selected-effect-empty')?.classList.toggle('hidden', !!fx);

    $('selected-effect-editor')?.classList.toggle('hidden', !fx);

    if (!fx) return;

    if ($('selected-effect-kind')) $('selected-effect-kind').textContent = fx.type.toUpperCase();

    if ($('selected-effect-time')) $('selected-effect-time').textContent = `${fx.start.toFixed(2)}s`;

    if ($('selected-effect-fields')) $('selected-effect-fields').innerHTML = `<div style="font-size:11px;color:var(--text-low);line-height:1.5">Duration <b style="color:var(--text-hi)">${fx.duration.toFixed(2)}s</b><br>Drag the block or handles on the Effects timeline to adjust timing.</div>`;

  }

 

  /* -------------------- BATTLE MODE (LOCAL SIMULATION) -------------------- */

  window.openBattleMenu = () => {

    renderOnlinePlayers();

    toggleMenu('battle-menu');

  };

 

  window.leaveBattleMenu = () => showMainMenu();

 

  window.renderOnlinePlayers = () => {

    const wrap = $('battle-online-list');

    if (!wrap) return;

    const query = ($('battle-search-input')?.value || '').trim().toLowerCase();

    const players = getProfiles().filter(p => p.name !== currentProfileName()).map(p => ({ name: p.name, score: Math.floor(Math.random() * 30000) }));

    const filtered = query ? players.filter(p => p.name.toLowerCase().includes(query)) : players;

    wrap.innerHTML = filtered.length ? filtered.map(p => `<div class="profile-row"><div class="profile-avatar">${escapeHtml(p.name[0].toUpperCase())}</div><div class="profile-row-name">${escapeHtml(p.name)}</div><button class="mini-editor-btn" data-battle-player="${escapeHtml(p.name)}">CHALLENGE</button></div>`).join('') : `<div style="padding:18px;text-align:center;color:var(--text-low);font-size:12px">No other profiles are currently available in this browser.</div>`;

    wrap.querySelectorAll('[data-battle-player]').forEach(btn => btn.onclick = () => beginBattleChallenge(btn.dataset.battlePlayer));

  };

 

  function beginBattleChallenge(name) {

    state.battleOpponent = name;

    toggleMenu('battle-level-picker');

    const list = $('battle-level-picker-list');

    const levels = Object.values(builtInLevels).map(normalizeLevel).concat(getCustomLevels().filter(l => l.author === currentProfileName()));

    if (list) {

      list.innerHTML = levels.map(level => levelCard(level)).join('');

      list.querySelectorAll('[data-play-level]').forEach(btn => {

        btn.addEventListener('click', event => {

          event.stopPropagation();

          const level = levels.find(x => x.id === btn.dataset.playLevel);

          beginBattle(level);

        });

      });

    }

  }

 

  function beginBattle(level) {

    state.battleLevel = normalizeLevel(level);

    state.battleScore = 0;

    state.battleOpponentScore = 0;

    toggleMenu('battle-waiting-menu');

    setTimeout(() => {

      if ($('battle-waiting-menu')?.classList.contains('hidden')) return;

      toggleMenu('battle-incoming-menu');

      if ($('battle-incoming-name')) $('battle-incoming-name').textContent = state.battleOpponent || 'Opponent';

      if ($('battle-incoming-level')) $('battle-incoming-level').textContent = `wants to battle on ${state.battleLevel.title}`;

      if ($('battle-incoming-avatar')) $('battle-incoming-avatar').textContent = (state.battleOpponent || '?')[0].toUpperCase();

    }, 450);

  }

 

  window.cancelBattleFlow = () => showMainMenu();

  window.declineChallenge = () => showMainMenu();

  window.acceptChallenge = () => {

    if (!state.battleLevel) return showMainMenu();

    state.currentLevel = state.battleLevel;

    toggleMenu('battle-waiting-menu');

    setTimeout(() => {

      state.battleOpponentScore = Math.floor(Math.random() * 60000 + 15000);

      startGameWithLevel(state.battleLevel);

      $('battle-race-hud')?.classList.remove('hidden');

    }, 350);

  };

  window.startQuickMatch = () => beginBattle(Object.values(builtInLevels)[Math.floor(Math.random() * 2)]);

  window.rematchBattle = () => { if (state.battleLevel) beginBattle(state.battleLevel); };

 

  function updateBattleHud() {

    if ($('race-bar-me')) $('race-bar-me').style.width = `${clamp(state.gameScore / 500, 0, 100)}%`;

    if ($('race-bar-opp')) $('race-bar-opp').style.width = `${clamp(state.battleOpponentScore / 500, 0, 100)}%`;

  }

 

  /* -------------------- MAIN MENU / GLOBAL KEYS -------------------- */

  function showMainMenu() {

    state.screen = 'menu';

    hideMenus();

    $('main-menu')?.classList.remove('hidden');

    $('battle-race-hud')?.classList.add('hidden');

    $('stop-playtest-btn')?.classList.add('hidden');

    $('editor-ui')?.classList.add('hidden');

  }

 

  window.showMainMenu = showMainMenu;

 

  function bindGlobalInput() {

    document.addEventListener('keydown', event => {

      if (event.repeat) return;

      if (state.gameRunning) {

        const key = event.key.toLowerCase();

        const lane = { r:0, t:1, y:2, u:3 }[key];

        if (lane !== undefined) {

          event.preventDefault();

          judgeLane(lane);

          updateBattleHud();

        }

        if (key === 'escape') finishGame(false);

        return;

      }

      if (state.editorOpen) {

        if (event.key === ' ' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); window.toggleEditorTransport(); }

        if (event.key === 'Delete') window.toggleDeleteMode();

        if (event.key === 'Escape') {

          if (!$('effects-menu')?.classList.contains('hidden')) window.closeEffectsMenu();

          else if (!$('creator-menu')?.classList.contains('hidden')) window.closeCreatorMenu();

        }

      }

    });

  }

 

  function bindTimelinePointer() {

    const track = $('editor-marker-track');

    if (!track || track.dataset.bound) return;

    track.dataset.bound = '1';

    track.addEventListener('pointerdown', event => {

      if (event.target.closest('.timeline-marker')) return;

      const rect = track.getBoundingClientRect();

      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);

      setEditorTime(ratio * Number(ensureEditorLevel().duration || 60), event.shiftKey);

    });

  }

 

  function slugify(value) {

    return String(value || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'level';

  }

 

  function syncSettingsInputs() {

    updateThemeUI();

    $('bg-color-picker')?.addEventListener('change', () => {

      const settings = getSettings();

      settings.bgColor = $('bg-color-picker').value;

      setSettings(settings);

      updateThemeUI();

    });

    $('setting-cbf')?.addEventListener('change', () => {

      const settings = getSettings();

      settings.cbf = !!$('setting-cbf').checked;

      setSettings(settings);

    });

  }

 

  function init() {

    initProfiles();

    syncSettingsInputs();

    bindGlobalInput();

    bindCanvasInput();

    bindTimelinePointer();

    renderProfiles();

    renderBrowseLevels();

    setEditorGrid(2);

    showMainMenu();

 

    // Keep the current level visible in the small HUD even before the first frame.

    drawEditor();

 

    // Avoid an automatic browser request for /favicon.ico by providing a data URI icon.

    if (!document.querySelector('link[rel="icon"]')) {

      const icon = document.createElement('link');

      icon.rel = 'icon';

      icon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%2305050a"/><rect x="8" y="8" width="14" height="48" rx="6" fill="%23fff"/><rect x="25" y="8" width="14" height="48" rx="6" fill="%2300f0ff"/><rect x="42" y="8" width="14" height="48" rx="6" fill="%23ff2e88"/></svg>';

      document.head.appendChild(icon);

    }

 

    console.info('[06-Tiles] Runtime loaded successfully. Controls: R/T/Y/U');

  }

 

  // Safety: index.html loads this file at the bottom, but this also works when injected elsewhere.

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });

  else init();

 

  // Expose a lightweight diagnostic for the console.

  window.__SixTilesRuntime = {

    version: '1.0.0-single-runtime',

    state,

    builtInLevels,

    getCustomLevels,

    getBrowseLevels

  };

})();
