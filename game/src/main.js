// SOLARA BAY — boot, game object, input, camera, main loop. Coordinator's spine.
// ?shot=chase|title|foot|roam&seed=1 stages a screenshot scene (see shots.js).
import * as THREE from 'three';
import { CHARACTERS } from './config.js';
import world from './world.js';
import player from './player.js';
import vehicles from './vehicles.js';
import police from './police.js';
import missions from './missions.js';
import activities from './activities.js';
import hud from './hud.js';
import audio from './audio.js';
import save from './save.js';
import { stageShot } from './shots.js';

const MAX_DT = 0.05;
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');

// --- tiny event bus: systems emit, hud listens ---
const listeners = new Map();
function onEvent(name, fn) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}
function emitEvent(name, data) {
  const fns = listeners.get(name);
  if (fns) for (const fn of fns) fn(data);
}

// --- the game object (exact shape from DESIGN.md) ---
const game = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000),
  renderer: null,
  time: { day: 1, minutes: 18 * 60 + 52, rate: 1 },
  money: 0,
  respect: 0,
  respectLevel: 1,
  wanted: 0,
  mode: 'title',
  shot: shotName,
  player: {
    mesh: null, group: null,
    pos: new THREE.Vector3(0, 0, 60),
    heading: 0, speed: 0, onFoot: true,
    health: 100, armour: 0, weapon: 1,
    ammo: { pistol: 48, smg: 120, shotgun: 18 },
  },
  currentCar: null,
  cars: [],
  police: { units: [], helicopter: null },
  missions: { current: 0, stage: 0, state: 'idle', objective: '', target: null },
  input: { keys: new Set(), mouseDX: 0, mouseDY: 0, clicked: false },
  hud: null, audio: null, save: null, world: null,
  events: { on: onEvent, emit: emitEvent },
  setMode,
  addMoney,
  addRespect,
  startNewGame,
  continueGame,
  togglePause,
  quitToTitle,
  respawn,
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
game.renderer = renderer;

window.addEventListener('resize', () => {
  game.camera.aspect = window.innerWidth / window.innerHeight;
  game.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- modes ---
function setMode(mode) {
  game.mode = mode;
  emitEvent('mode', { mode });
  if (mode === 'playing') statusEl.textContent = 'Playing Solara Bay.';
  if (mode === 'paused') statusEl.textContent = 'Paused.';
  if (mode === 'busted') statusEl.textContent = 'Busted by the SBPD.';
  if (mode === 'wasted') statusEl.textContent = 'Wasted.';
}

function addMoney(amount, reason) {
  game.money = Math.max(0, game.money + amount);
  emitEvent('money', { amount, reason, total: game.money });
}

function addRespect(amount) {
  game.respect += amount;
  const level = Math.min(5, 1 + Math.floor(game.respect / 500));
  if (level !== game.respectLevel) {
    game.respectLevel = level;
    emitEvent('respect', { level, respect: game.respect });
  }
}

function startNewGame() {
  game.money = 0;
  game.respect = 0;
  game.respectLevel = 1;
  game.time.day = 1;
  game.time.minutes = 18 * 60 + 52;
  game.player.health = 100;
  game.player.armour = 0;
  game.player.pos.set(0, 0, 60);
  game.player.heading = 0;
  game.player.onFoot = true;
  police.clearWanted();
  missions.startMission(0);
  setMode('playing');
  canvas.requestPointerLock?.();
}

function continueGame() {
  const data = save.loadGame();
  if (!data) { startNewGame(); return; }
  game.money = data.money ?? 0;
  game.respect = data.respect ?? 0;
  game.respectLevel = data.respectLevel ?? 1;
  game.time.day = data.day ?? 1;
  game.time.minutes = data.minutes ?? 18 * 60 + 52;
  game.player.pos.set(data.x ?? 0, 0, data.z ?? 60);
  game.player.health = 100;
  game.player.armour = data.armour ?? 0;
  missions.startMission(data.mission ?? 0);
  setMode('playing');
  canvas.requestPointerLock?.();
}

function togglePause() {
  if (game.mode === 'playing') setMode('paused');
  else if (game.mode === 'paused') setMode('playing');
}

function quitToTitle() {
  if (game.currentCar) player.exitCar();
  setMode('title');
  document.exitPointerLock?.();
}

function respawn() {
  // After busted/wasted: lose cash, wake at the hospital, heat gone.
  addMoney(-Math.min(300, game.money), 'Hospital bill');
  game.player.health = 100;
  game.player.armour = 0;
  game.player.pos.set(-60, 0, -60);
  game.player.heading = 0;
  game.player.onFoot = true;
  if (game.currentCar) player.exitCar();
  police.clearWanted();
  setMode('playing');
}

// --- input ---
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  game.input.keys.add(e.code);
  if (e.code === 'Escape') {
    if (game.mode === 'playing' || game.mode === 'paused') togglePause();
  }
  if (e.code === 'KeyM' && game.mode === 'playing') emitEvent('map', {});
  if (e.code === 'KeyV' && game.mode === 'playing') {
    cameraMode = cameraMode === 'chase' ? 'classic' : 'chase';
  }
});
window.addEventListener('keyup', (e) => game.input.keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  if (game.mode === 'playing') {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    game.input.clicked = true;
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    game.input.mouseDX += e.movementX;
    game.input.mouseDY += e.movementY;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing') setMode('paused');
});

// --- camera ---
let cameraMode = 'chase';
let camYaw = 0;
let camPitch = 0.32;
let camDistance = 9;

function updateCamera(dt) {
  const cam = game.camera;
  if (game.mode === 'title') {
    const t = performance.now() / 1000;
    const r = 180;
    cam.position.set(Math.sin(t * 0.02) * r, 55, Math.cos(t * 0.02) * r);
    cam.lookAt(0, 10, 0);
    cam.fov = 55;
    cam.updateProjectionMatrix();
    return;
  }
  camYaw -= game.input.mouseDX * 0.0028;
  camPitch = Math.max(0.08, Math.min(1.1, camPitch + game.input.mouseDY * 0.0022));
  game.input.mouseDX = 0;
  game.input.mouseDY = 0;

  const focus = game.currentCar ? game.currentCar.group.position : game.player.pos;
  const heading = game.currentCar ? game.currentCar.heading : game.player.heading;
  if (game.currentCar) camYaw = heading + Math.PI;
  const dist = cameraMode === 'classic' ? 13 : camDistance;
  const height = cameraMode === 'classic' ? 7 : 4.2;
  const target = new THREE.Vector3(
    focus.x + Math.sin(camYaw) * dist,
    focus.y + height + Math.sin(camPitch) * 4,
    focus.z + Math.cos(camYaw) * dist,
  );
  const speed = game.currentCar ? Math.abs(game.currentCar.speed) : Math.abs(game.player.speed);
  // Snap instead of lerping when far off (mode switch, first frame, or any
  // clock glitch): a slow lerp from the title orbit would leave the camera
  // mid-flight when a screenshot is taken.
  if (cam.position.distanceTo(target) > 60) cam.position.copy(target);
  else cam.position.lerp(target, 1 - Math.pow(0.0001, dt));
  cam.lookAt(focus.x, focus.y + 2, focus.z);
  const wantFov = 62 + Math.min(14, speed * 0.35);
  cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 3);
  cam.updateProjectionMatrix();
}

// --- boot systems ---
world.init(game);
player.init(game);
vehicles.init(game);
police.init(game);
missions.init(game);
activities.init(game);
hud.init(game);
audio.init(game);
save.init(game);
game.hud = hud;
game.audio = audio;
game.save = save;

// Bridge: player.js / vehicles.js report crimes as 'heat' events (they cannot call the
// police module directly); the police system consumes them here.
game.events.on('heat', (e) => police.addHeat(e && e.amount ? e.amount : 1));

// Debug/automation handle (used by the headless play-test; harmless in play).
window.__game = game;

if (shotName) {
  stageShot(game, shotName, seed);
  if (shotName === 'title') setMode('title');
  else setMode('playing');
} else {
  setMode('title');
}

// --- main loop ---
let last = performance.now();
let firstFrame = true;

function frame(now) {
  requestAnimationFrame(frame);
  // Clamp dt to [0, MAX_DT]: in headless Chromium the rAF timestamp can run
  // backwards vs performance.now(), and a negative dt turns the camera lerp
  // factor (1 - 0.0001^dt) hugely negative, flinging the camera billions of
  // metres out (seen 18 Nov: camPos ~2e10, black screen, 1 render call).
  const dt = Math.min(Math.max((now - last) / 1000, 0), MAX_DT);
  last = now;

  if (game.mode === 'playing') {
    player.update(dt);
    vehicles.update(dt);
    police.update(dt);
    missions.update(dt);
    activities.update(dt);
    world.update(dt);
  } else if (game.mode === 'title') {
    world.update(dt);
    vehicles.update(dt);
  }
  hud.update(dt);
  audio.update(dt);
  updateCamera(dt);

  renderer.render(game.scene, game.camera);

  if (firstFrame) {
    firstFrame = false;
    window.__gameReady = true;
  }
}

statusEl.textContent = 'SOLARA BAY. Click to start.';
requestAnimationFrame(frame);
