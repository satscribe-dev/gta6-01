// SOLARA BAY — save system (localStorage). W5.
// Stores money, respect, mission progress, clock and player position so a run
// can be continued from the title screen. All storage access is guarded:
// private mode / disabled storage must never throw into the game loop.
const KEY = 'solara-bay-save-v1';

let gameRef = null;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch (err) {
    return null;
  }
}

export function hasSave() {
  const raw = readRaw();
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    return data !== null && typeof data === 'object';
  } catch (err) {
    return false;
  }
}

export function saveGame() {
  if (!gameRef) return false;
  const g = gameRef;
  const data = {
    money: g.money ?? 0,
    respect: g.respect ?? 0,
    respectLevel: g.respectLevel ?? 1,
    mission: g.missions ? g.missions.current ?? 0 : 0,
    day: g.time ? g.time.day ?? 1 : 1,
    minutes: g.time ? g.time.minutes ?? 0 : 0,
    x: g.player && g.player.pos ? g.player.pos.x ?? 0 : 0,
    z: g.player && g.player.pos ? g.player.pos.z ?? 0 : 0,
    armour: g.player ? g.player.armour ?? 0 : 0,
    carType: g.currentCar ? g.currentCar.type ?? null : null,
    savedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGame() {
  const raw = readRaw();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data !== null && typeof data === 'object' ? data : null;
  } catch (err) {
    return null;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(KEY);
  } catch (err) {
    // Storage unavailable — nothing to clear, and never throw.
  }
  return true;
}

export default {
  init(game) {
    gameRef = game;
  },
  saveGame,
  loadGame,
  hasSave,
  clearSave,
};
