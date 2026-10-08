// ============================================================================
// state.js — DOM references, constants, and shared mutable state.
// Loaded first; every other module reads/writes these plain globals.
// (No bundler on purpose — this ships as static files on GitHub Pages.)
// ============================================================================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const restEl = document.getElementById("rest-msg");
const bgAudio = document.getElementById("bg-audio");

// Every full-screen overlay `toggleMenu()` knows how to show/hide.
// (admin-panel used to be missing from this list, which is why it could get
// stuck on screen after you left it.)
const overlays = [
  'main-menu', 'settings-menu', 'death-screen', 'pause-menu', 'my-levels-menu',
  'creator-menu', 'effects-menu', 'browse-levels-menu', 'editor-level-settings',
  'profile-modal', 'stats-modal', 'admin-panel', 'level-detail-menu', 'battle-menu', 'battle-level-picker',
  'battle-waiting-menu', 'battle-incoming-menu', 'battle-result-menu', 'shared-menu', 'spectate-menu', 'friends-menu'
];

// Battle match state (first to 3 round wins)
let battleScore = { you: 0, opp: 0, target: 3, round: 1 };

// --- gameplay constants ---
// The game is laid out on a fixed LOGICAL 360x640 board. The <canvas> backing
// store is scaled up/down to the screen (see layoutCanvas in ui.js), so every
// gameplay number below stays exactly as it always was.
const GW = 360, GH = 640;
const laneW = GW / 4;
let keyMap = ['r', 't', 'y', 'u'];
const keys = { r: false, t: false, y: false, u: false };
const lineY = 540;
const TILE_H = 150;
const GAP = 35;
const EDITOR_BASE_SPEED = 18;
let renderScale = 1;

const patterns = {};   // (the built-in Scale / Bam Bam endless modes were removed)

// --- core game state ---
let score = 0, speed = EDITOR_BASE_SPEED, lastTime = 0, nextFrameAt = 0, rafId = null;
let notesHitThisGame = 0;
let statsGameFinalized = false;
let tiles = [], particles = [], isDead = false, gameActive = false, isPaused = false;
let currentMode = 'practice', patternStep = 0;
let distanceTraveled = 0, nextSpawnDistance = 0;
let maxLives = 3, currentLives = 3;
let windowLevelFPS = 60;
let frameCount = 0, lastFpsTime = 0;
let levelEndTime = 0;
let currentTileStyle = { c1: "#000000", c2: "#000000", alpha: 1.0 };
let targetSpeed = EDITOR_BASE_SPEED, speedTransitionTime = 0, speedTransitionDuration = 0, initialSpeed = EDITOR_BASE_SPEED;
let tempLoadedLevel = null;
let lastStartArgs = null;

let isCustomGame = false, customPlayTime = 0, isPlaytesting = false, isVerifying = false;
let pendingTiles = [], pendingTileIdx = 0, pendingEffects = [], pendingEffectIdx = 0;
let levelAudioOffsetMs = 0, levelAudioStarted = false, levelDisableHolds = false;
let fxTimeouts = [];
let gameBrightness = Number(localStorage.getItem('et_gameBrightness') || 100);
let showHitboxes = localStorage.getItem('et_showHitboxes') === 'true';
let showLaneText = localStorage.getItem('et_showLaneText') === 'true';
let hideDeathScreen = localStorage.getItem('et_hideDeathScreen') === 'true';
let autoRetry = localStorage.getItem('et_autoRetry') === 'true';
let currentLevelBackground = '#202738';
let currentLevelBrightness = 100;
let currentLevelIcon = null;
let autoRetryTimer = null;
let levelVerified = false;
let pendingPublishAfterVerification = false;
let verifyEndTime = 0;

// --- editor state ---
let inEditor = false, isRecording = false, isSongTesting = false, deleteMode = false;
let editorTimer = 0, editorLastTick = 0, editorPlaying = false, editorRaf = null;
let recordedTiles = [], recordedEffects = [], editorVisualTiles = [];
let loadedImageDataUrl = null, loadedSfxDataUrl = null, loadedExtraImageDataUrl = null, currentEditingName = "";
let editorKeyTimes = [null, null, null, null];
let selectedEffect = null;
let pendingExtraX = 180, pendingExtraY = 320;
let currentEffectCategory = 'visual';

// Editor grid. `editorGridDivision` = subdivisions per beat (1 = every beat,
// 2 = half beats, 4 = quarter beats...). BPM + offset are now real, saved
// level settings instead of a hard-coded 120 BPM.
let editorGridDivision = 2;
let editorSnapEnabled = true;
let editorBpm = 120;
let editorGridOffset = 0;
let editorZoom = 0.6; // editor-only vertical zoom; 1 = exactly what gameplay looks like at base speed

// --- battle mode state (driven by battle.js) ---
let isBattleMode = false;

function getEditorBeat() { return 60 / Math.max(30, editorBpm); }
function getEditorGridStep() { return getEditorBeat() / editorGridDivision; }
function getEditorPPS() { return EDITOR_BASE_SPEED * 60 * editorZoom; }

// --- v4: strict mode, hitbox zones, effects, practice, globe, cosmetics ---
let strictMode = false;
const defaultHitZone = () => ({ on: false, lanes: [0, 1, 2, 3].map(() => ({ top: 400, h: 140 })) });
let hitZone = defaultHitZone();                     // one input hitbox PER LANE (board coords); off = classic "tap anywhere"
let lockCosmetics = false;                          // level setting: ignore the player's custom tile colours / effects
let tileHb = { scale: 1, offset: 0 };               // tile hitbox scale / vertical offset (used with the input zone)
let tileMoveFx = null, tileHideFx = null;
let practiceMode = false, practiceArmed = false, practiceStartSec = 0, practiceCheckpoint = 0, practiceNextAuto = 0;
let levelLastNoteTime = 0, runStartedAt = 0;
let globeOn = localStorage.getItem('et_globe') === 'true';
const globeGhosts = new Map();                      // player name -> { idx, lane, ts }
let cosmeticTile = 'default', cosmeticFx = 'default';
let currentDraft = null;                            // { id, rev, role } while editing a shared level

let editorStartPos = null, startPosArmed = false;   // Geometry-Dash-style start position (editor playtests begin here)

// --- v5 ---
let maxBpm = 500;                                   // admins can change this (server setting)
let practiceCheckpoints = [], practiceBaseSec = 0;  // GD-style practice: P places a checkpoint, O removes the last
let editorStartPositions = [], activeStartIdx = -1, levelStartPositions = [];
let currentAudioBlob = null, currentAttempt = 0;
const globePresence = { count: 0 };
const SHORTCUT_DEFAULTS = { pPlace: 'p', pRemove: 'o', sPrev: 'q', sNext: 'e', switcher: true };
let shortcuts = Object.assign({}, SHORTCUT_DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('et_shortcuts') || '{}'); } catch (e) { return {}; } })());
function bumpAttempts(id) { let m = {}; try { m = JSON.parse(localStorage.getItem('et_attempts') || '{}'); } catch (e) {} m[id] = (m[id] || 0) + 1; try { localStorage.setItem('et_attempts', JSON.stringify(m)); } catch (e) {} return m[id]; }
function getAttempts(id) { try { return (JSON.parse(localStorage.getItem('et_attempts') || '{}'))[id] || 0; } catch (e) { return 0; } }
