// ============================================================================
// state.js — DOM references, constants, and shared mutable state.
// Loaded first; every other module reads/writes these plain globals.
// (No bundler here on purpose — this ships as static files opened straight
// in a browser or hosted on GitHub Pages, so ES module imports would be
// more friction than they're worth. Each file just owns one concern.)
// ============================================================================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const restEl = document.getElementById("rest-msg");
const bgAudio = document.getElementById("bg-audio");

// Every full-screen overlay `toggleMenu()` knows how to show/hide.
const overlays = [
  'main-menu', 'levels-menu', 'settings-menu', 'death-screen', 'my-levels-menu',
  'creator-menu', 'effects-menu', 'browse-levels-menu', 'editor-level-settings',
  'profile-modal', 'level-detail-menu', 'battle-menu', 'battle-level-picker',
  'battle-waiting-menu', 'battle-incoming-menu', 'battle-result-menu'
];

// --- gameplay constants (single source of truth — used to live as magic
// numbers copy-pasted in half a dozen places) ---
const laneW = canvas.width / 4;
const keyMap = ['r', 't', 'y', 'u'];
const keys = { r: false, t: false, y: false, u: false };
const lineY = 540;
const TILE_H = 150;
const GAP = 35;
const EDITOR_BASE_SPEED = 18;         // reference speed the editor's falling preview is drawn at
const EDITOR_PPS = EDITOR_BASE_SPEED * 60; // pixels/second for that preview + the docked timeline math

// lane 0=r, 1=t, 2=y, 3=u (see keyMap below). "scale" repeatedly cycles
// u -> y -> t -> r, one tile at a time — that's lanes [3,2,1,0].
const patterns = {
  scale: [3, 2, 1, 0],
  bambam: [[0, 2], 1, [0, 2], 1, [0, 2], 1, 0, [1, 3], 2, [1, 3], 2, [1, 3], 2, 3]
};

// --- core game state ---
let score = 0, speed = EDITOR_BASE_SPEED, lastTime = 0;
let tiles = [], particles = [], isDead = false, gameActive = false;
let currentMode = 'practice', patternStep = 0;
let distanceTraveled = 0, nextSpawnDistance = 0;
let maxLives = 3, currentLives = 3;
let windowLevelFPS = 60;
let frameCount = 0, lastFpsTime = 0;
let levelEndTime = 0;
let currentTileStyle = { c1: "#000000", c2: "#000000", alpha: 1.0 };
let targetSpeed = EDITOR_BASE_SPEED, speedTransitionTime = 0, speedTransitionDuration = 0, initialSpeed = EDITOR_BASE_SPEED;
let tempLoadedLevel = null;
let lastStartArgs = null; // remembers how the current level was launched, so Retry can replay it

let isCustomGame = false, customPlayTime = 0, customGameInterval = null, isPlaytesting = false, isVerifying = false;
let verifyEndTime = 0;

// --- editor state ---
let inEditor = false, isRecording = false, isSongTesting = false, deleteMode = false;
let editorTimer = 0, editorInterval = null, editorPlaying = false;
let recordedTiles = [], recordedEffects = [], editorVisualTiles = [];
let loadedImageDataUrl = null, loadedSfxDataUrl = null, loadedExtraImageDataUrl = null, currentEditingName = "";
let editorKeyTimes = [null, null, null, null];
let editorTileMode = 'normal';
let editorGridDivision = 2;
const EDITOR_GRID_BEAT_SECONDS = 0.5; // 120 BPM reference beat; only used for editor snapping.
let selectedEffect = null;
let pendingExtraX = 180, pendingExtraY = 320;
let currentEffectCategory = 'visual';

// --- battle mode state (declared here, driven by battle.js) ---
let isBattleMode = false;

function getEditorGridStep() {
  return EDITOR_GRID_BEAT_SECONDS / editorGridDivision;
}
