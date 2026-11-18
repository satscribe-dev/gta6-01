// PUERTO MIRA — missions (W5). Story missions, 6 chapters from config MISSIONS.
// Markers, enemy crews, the traitor chase, timers, fail/retry, rewards.
// Player shooting at mission enemies is handled by player.js: this module
// exposes the live enemy figures as game.enemies ({ group, health, alive })
// and player.js raycasts + damages them; a kill there (alive=false) is picked
// up by updateEnemies below, which counts it and removes the corpse.
import * as THREE from 'three';
import { MISSIONS, CHARACTERS } from './config.js';
import { setWanted as policeSetWanted } from './police.js';
import { spawnCar } from './vehicles.js';

const MARKER_RADIUS = 6;
const ENEMY_HEALTH = 50;
const ENEMY_SHOOT_RANGE = 25;
const ENEMY_SHOOT_INTERVAL = 1.2;
const ENEMY_HIT_CHANCE = 0.55;
const ENEMY_DAMAGE = 5;
const ENEMY_WALK_SPEED = 2.2;
const CHASE_CATCH_DIST = 10;
const CHASE_SPEED = 14;
const CHASE_LOOP = [[150, 120], [210, 120], [210, 180], [150, 180]];
const ENEMY_OFFSETS = [[12, 4], [-10, 8], [6, -12], [-12, -6], [16, -4], [-4, 14]];

// Who briefs each mission (chapter order).
const BRIEFING_SPEAKER = ['mira', 'lena', 'theo', 'lena', 'mira', 'lena'];
// Lines spoken when a later stage begins ("mission:stage" -> speaker + line).
const STAGE_LINES = {
  '0:1': { who: 'mira', text: "That's my Zephyr. Bring her to the garage in Palm Court — in one piece." },
  '1:1': { who: 'lena', text: "Clock's running, Kai. Three minutes to the Docks — don't stop for anyone." },
  '2:1': { who: 'theo', text: 'One star left. Stay out of sight a little longer and the heat dies.' },
  '3:1': { who: 'lena', text: "Six of Voss's crew inside. Make it count." },
  '3:2': { who: 'theo', text: 'SBPD heard the noise. Go dark until it blows over.' },
  '4:1': { who: 'mira', text: 'Cash is yours. But the heli is up — lose them before the window closes.' },
  '4:2': { who: 'mira', text: "Clean. Bring the money home to Palm Court." },
  '5:1': { who: 'lena', text: "It's a trap — Voss crew, everywhere! Survive it, Kai!" },
  '5:2': { who: 'voss', text: 'So the wheelman finally shows. My crew will bury you, Mercer.' },
  '5:3': { who: 'theo', text: 'The whole compound is coming at you — hold the line, Kai!' },
  '5:4': { who: 'lena', text: 'The siege is broken — now run. The pier at Marina Verde. Go!' },
};
const COMPLETE_LINES = [
  "She's perfect. Welcome to Puerto Mira, Kai.",
  "Package delivered, no heat. You're a professional after all.",
  "Heat's gone. You're a ghost, Kai. A fast ghost.",
  'The club is quiet. Voss will feel that one.',
  "Money's home. That heli never stood a chance.",
  'It is over, Kai. Puerto Mira is yours.',
];

let game = null;
let elapsed = 0;
let marker = null; // { group, pillar, ring }
let enemies = []; // { group, health, alive, shootT, flashT, dead, removeAt }
let chaseCar = null;
let chaseWp = 0;
let timerLeft = null;
let killTotal = 0;
let killCount = 0;
let ePrev = false;

function say(whoKey, text) {
  const c = CHARACTERS[whoKey] || CHARACTERS.kai;
  game.events.emit('dialogue', { who: c.name, role: c.role, text });
}

function playerPos() {
  if (game.currentCar && game.currentCar.pos) return game.currentCar.pos;
  return game.player.pos;
}

function distTo(x, z) {
  const p = playerPos();
  const dx = p.x - x;
  const dz = p.z - z;
  return Math.sqrt(dx * dx + dz * dz);
}

// --- marker (gold light pillar + ground ring) ---
function makeMarker(color) {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  pillar.position.y = 13;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;
  group.add(pillar, ring, disc);
  group.visible = false;
  game.scene.add(group);
  return { group, pillar, ring };
}

function showMarker(x, z) {
  marker.group.position.set(x, 0, z);
  marker.group.visible = true;
}

function hideMarker() {
  marker.group.visible = false;
}

// --- enemy figures ---
function makeEnemyFigure(shirt) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 4, 10), bodyMat);
  body.position.y = 1.05;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9a077, roughness: 0.7 }),
  );
  head.position.y = 1.85;
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }),
  );
  gun.position.set(0.3, 1.25, 0.25);
  // Red downward triangle above the head: this one is hostile.
  const tri = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.55, 4),
    new THREE.MeshBasicMaterial({ color: 0xff2e2e }),
  );
  tri.rotation.x = Math.PI;
  tri.position.y = 2.45;
  group.add(body, head, gun, tri);
  group.userData.bodyMat = bodyMat;
  return group;
}

function spawnEnemies(n, cx, cz) {
  const shirts = [0x222222, 0x3a3a3a, 0x4a2a2a, 0x2a2a4a, 0x333333, 0x442222];
  for (let i = 0; i < n; i++) {
    const off = ENEMY_OFFSETS[i % ENEMY_OFFSETS.length];
    const group = makeEnemyFigure(shirts[i % shirts.length]);
    group.position.set(cx + off[0], 0, cz + off[1]);
    game.scene.add(group);
    const enemy = { group, health: ENEMY_HEALTH, alive: true, shootT: 0.6 + i * 0.25, flashT: 0, dead: false, removeAt: 0 };
    group.userData.enemy = enemy;
    enemies.push(enemy);
  }
}

function clearEnemies() {
  for (const e of enemies) game.scene.remove(e.group);
  enemies.length = 0; // keep the array identity: game.enemies points at it
}

function clearChaseCar() {
  if (!chaseCar) return;
  if (chaseCar.group) game.scene.remove(chaseCar.group);
  const i = game.cars.indexOf(chaseCar);
  if (i >= 0) game.cars.splice(i, 1);
  chaseCar = null;
}

function clearStageActors() {
  clearEnemies();
  clearChaseCar();
  timerLeft = null;
  killTotal = 0;
  killCount = 0;
}

// --- stage helpers ---
function stageKind(def) {
  const o = def.objective.toLowerCase();
  if (/take out|survive the siege/.test(o)) return 'combat';
  if (/lose|stay hidden/.test(o)) return 'loseCops';
  if (/chase/.test(o)) return 'chase';
  return 'reach';
}

function parseKillTotal(objective) {
  let m = objective.match(/take out\s+(\d+)/i);
  if (m) return Number(m[1]);
  m = objective.match(/\/\s*(\d+)\s*down/i);
  if (m) return Number(m[1]);
  return 6;
}

function combatText(def) {
  const total = killTotal || parseKillTotal(def.objective);
  const base = def.objective.replace(/\d+\s*\/\s*\d+\s*down/i, '').replace(/—\s*$/, '').trim();
  return `${base} — ${killCount} / ${total} down`;
}

function emitObjective() {
  const m = MISSIONS[game.missions.current];
  const def = m && m.stages ? m.stages[game.missions.stage] : null;
  // While idle/done the objective is a status line set by fail/complete
  // ("failed — press E at the marker", "Next: ... press E ..."); only an
  // active mission shows its live stage objective (with kill count / timer).
  let text = game.missions.objective;
  if (game.missions.state === 'active' && def) {
    text = stageKind(def) === 'combat' ? combatText(def) : def.objective;
  }
  game.events.emit('objective', {
    text,
    stage: game.missions.stage,
    total: m ? m.stages.length : 0,
    timer: timerLeft != null ? Math.max(0, Math.ceil(timerLeft)) : null,
  });
}

function setupStage() {
  clearStageActors();
  const m = MISSIONS[game.missions.current];
  const def = m.stages[game.missions.stage];
  const kind = stageKind(def);
  timerLeft = def.timer != null ? def.timer : null;
  if (kind === 'combat') {
    killTotal = parseKillTotal(def.objective);
    killCount = 0;
    spawnEnemies(killTotal, def.target[0], def.target[1]);
  }
  if (kind === 'chase') spawnChaseCar();
  if (def.target) {
    showMarker(def.target[0], def.target[1]);
    game.missions.target = [def.target[0], def.target[1]];
  } else if (kind !== 'chase') {
    hideMarker();
    game.missions.target = null;
  }
  // Heat scripted by the story: M2 opens at 2 stars, the M3 club job draws
  // 2 stars once the shooting starts, the M4 grab puts the heli up (3 stars).
  // Via police.setWanted so the hide/busted clocks reset (a raw
  // `game.wanted = n` would leave a half-spent hiddenTime behind).
  if (game.missions.current === 2 && game.missions.stage === 0) policeSetWanted(2);
  if (game.missions.current === 3 && game.missions.stage === 2) policeSetWanted(2);
  if (game.missions.current === 4 && game.missions.stage === 1) policeSetWanted(3);
  game.missions.objective = kind === 'combat' ? combatText(def) : def.objective;
  emitObjective();
}

// --- public mission flow ---
export function startMission(i) {
  // Clamp, never reject: an old save (8-mission era) can hold current 6 or 7,
  // and continueGame passes it straight in. Clamping to the finale keeps the
  // player near the end instead of crashing or silently doing nothing; a
  // finished old save (7, state 'done') replays the finale, which is safe.
  if (typeof i !== 'number' || !Number.isFinite(i)) i = 0;
  i = Math.max(0, Math.min(Math.floor(i), MISSIONS.length - 1));
  if (game.missions.state === 'active' && game.missions.current === i) return;
  clearStageActors();
  game.missions.current = i;
  game.missions.stage = 0;
  game.missions.state = 'active';
  say(BRIEFING_SPEAKER[i], MISSIONS[i].briefing);
  setupStage();
}

export function advanceStage() {
  if (game.missions.state !== 'active') return;
  game.missions.stage += 1;
  const m = MISSIONS[game.missions.current];
  if (game.missions.stage >= m.stages.length) {
    completeMission();
    return;
  }
  setupStage();
  const line = STAGE_LINES[`${game.missions.current}:${game.missions.stage}`];
  if (line) say(line.who, line.text);
}

export function failMission(reason) {
  if (game.missions.state !== 'active') return;
  clearStageActors();
  hideMarker();
  const m = MISSIONS[game.missions.current];
  game.missions.stage = 0;
  game.missions.state = 'idle';
  game.missions.objective = `${m.title} — failed (${reason}). Press E ${game.missions.target ? 'at the gold marker ' : ''}to retry.`;
  game.missions.target = m.stages[0].target ? [m.stages[0].target[0], m.stages[0].target[1]] : null;
  if (game.missions.target) showMarker(game.missions.target[0], game.missions.target[1]);
  say('lena', `That went sideways, Kai. ${m.title} is still open — get back to the marker and press E to run it again.`);
  game.events.emit('mission', { result: 'failed', mission: game.missions.current, reason });
  emitObjective();
}

export function completeMission() {
  if (game.missions.state !== 'active') return;
  clearStageActors();
  hideMarker();
  const m = MISSIONS[game.missions.current];
  // game.addMoney emits the 'money' event itself; no second emit here.
  game.addMoney(m.reward, `Mission complete: ${m.title}`);
  game.addRespect(m.respect);
  say(BRIEFING_SPEAKER[game.missions.current], COMPLETE_LINES[game.missions.current]);
  game.events.emit('mission', { result: 'complete', mission: game.missions.current, reward: m.reward });
  if (game.missions.current >= MISSIONS.length - 1) {
    game.missions.state = 'done';
    game.missions.stage = 0;
    game.missions.objective = `${m.title} complete — Puerto Mira is yours, Kai.`;
    game.missions.target = null;
  } else {
    game.missions.current += 1;
    game.missions.stage = 0;
    game.missions.state = 'idle';
    const next = MISSIONS[game.missions.current];
    game.missions.target = next.stages[0].target ? [next.stages[0].target[0], next.stages[0].target[1]] : null;
    if (game.missions.target) {
      game.missions.objective = `Next: ${next.title} — press E at the gold marker to start.`;
      showMarker(game.missions.target[0], game.missions.target[1]);
    } else {
      // No marker to walk to (Heat Wave: the heat comes to you) — E anywhere
      // starts it; see the idle branch in update().
      game.missions.objective = `Next: ${next.title} — press E to start.`;
    }
  }
  // Save LAST: the save must record the NEXT mission (progress), not the one
  // just completed — saving before the increment above made Continue replay
  // the finished mission (v2 bug).
  if (game.save && typeof game.save.saveGame === 'function') game.save.saveGame();
  emitObjective();
}

// --- chase stage ---
function spawnChaseCar() {
  clearChaseCar();
  chaseCar = spawnCar('vela', 180, 150, Math.PI / 2, { isTraffic: false });
  chaseWp = 0;
  if (chaseCar) {
    chaseCar.heading = Math.atan2(CHASE_LOOP[0][0] - 180, CHASE_LOOP[0][1] - 150);
    showMarker(180, 150);
    game.missions.target = [180, 150];
  }
}

function updateChase(dt) {
  if (!chaseCar) return;
  const wp = CHASE_LOOP[chaseWp];
  const dx = wp[0] - chaseCar.pos.x;
  const dz = wp[1] - chaseCar.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 10) {
    chaseWp = (chaseWp + 1) % CHASE_LOOP.length;
    return;
  }
  const desired = Math.atan2(dx, dz);
  let diff = desired - chaseCar.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  chaseCar.heading += Math.max(-1.8 * dt, Math.min(1.8 * dt, diff));
  chaseCar.pos.x += Math.sin(chaseCar.heading) * CHASE_SPEED * dt;
  chaseCar.pos.z += Math.cos(chaseCar.heading) * CHASE_SPEED * dt;
  chaseCar.speed = CHASE_SPEED;
  if (chaseCar.group) {
    chaseCar.group.position.set(chaseCar.pos.x, 0, chaseCar.pos.z);
    chaseCar.group.rotation.y = chaseCar.heading;
  }
  // The gold marker rides with the traitor so the player can track him.
  marker.group.position.set(chaseCar.pos.x, 0, chaseCar.pos.z);
  game.missions.target = [Math.round(chaseCar.pos.x), Math.round(chaseCar.pos.z)];
}

// --- combat ---
function updateEnemies(dt) {
  const p = playerPos();
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // Killed by the player's own shooting (player.js sets alive=false):
    // count the kill and schedule the corpse removal like a local kill.
    if (e.alive === false && !e.dead) {
      e.dead = true;
      e.removeAt = elapsed + 3;
      e.group.rotation.x = -Math.PI / 2;
      e.group.position.y = 0.35;
      killCount += 1;
      emitObjective();
    }
    if (e.dead) {
      if (elapsed >= e.removeAt) {
        game.scene.remove(e.group);
        enemies.splice(i, 1);
      }
      continue;
    }
    const dx = p.x - e.group.position.x;
    const dz = p.z - e.group.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    e.group.lookAt(p.x, 0, p.z);
    if (d > 8 && d < 40) {
      const step = ENEMY_WALK_SPEED * dt;
      e.group.position.x += (dx / d) * step;
      e.group.position.z += (dz / d) * step;
    }
    if (e.flashT > 0) {
      e.flashT -= dt;
      if (e.flashT <= 0) e.group.userData.bodyMat.emissive.setHex(0x000000);
    }
    e.shootT -= dt;
    if (e.shootT <= 0) {
      e.shootT = ENEMY_SHOOT_INTERVAL;
      if (d < ENEMY_SHOOT_RANGE && Math.random() < ENEMY_HIT_CHANCE) {
        game.player.health = Math.max(0, game.player.health - ENEMY_DAMAGE);
        game.events.emit('damage', { amount: ENEMY_DAMAGE });
      }
    }
  }
}

  // (Shooting is owned by player.js via game.enemies; see the header note.)

// --- lifecycle ---
function init(g) {
  game = g;
  // player.js shoots mission enemies through this shared array (identity is
  // kept stable: clearEnemies() empties it in place, never reassigns).
  game.enemies = enemies;
  marker = makeMarker(0xffc93c);
  const first = MISSIONS[0].stages[0].target;
  game.missions.current = 0;
  game.missions.stage = 0;
  game.missions.state = 'idle';
  game.missions.objective = `Next: ${MISSIONS[0].title} — press E at the gold marker to start.`;
  game.missions.target = first ? [first[0], first[1]] : null;
  if (first) showMarker(first[0], first[1]);
  // Busted / wasted arrive as mode changes (main.js only calls update() while
  // playing, so the mode event is the only way to catch a fail mid-mission).
  if (game.events && typeof game.events.on === 'function') {
    game.events.on('mode', (data) => {
      if (data && (data.mode === 'busted' || data.mode === 'wasted') && game.missions.state === 'active') {
        failMission(data.mode === 'busted' ? 'Busted by the SBPD' : 'Wasted');
      }
    });
  }
  emitObjective();
}

function update(dt) {
  elapsed += dt;
  const eDown = game.input.keys.has('KeyE');
  const ePressed = eDown && !ePrev;
  ePrev = eDown;

  if (marker.group.visible) {
    marker.ring.rotation.z += dt * 0.8;
    marker.pillar.material.opacity = 0.2 + 0.08 * Math.sin(elapsed * 3);
  }

  // Idle: a mission ONLY starts when the player presses E within 12 m of
  // the gold marker. Walking/driving through the marker never starts it —
  // a fresh player needs a moment to get ready before a timed run
  // (e.g. The Drop, 3:00 on the clock). Missions whose first stage has no
  // target (Heat Wave: the heat comes to you) start on E anywhere.
  if (game.missions.state === 'idle') {
    const t = game.missions.target;
    if (ePressed && (!t || distTo(t[0], t[1]) <= 12)) startMission(game.missions.current);
  }

  if (game.missions.state !== 'active') return;

  if (timerLeft != null) {
    const prevWhole = Math.ceil(timerLeft);
    timerLeft -= dt;
    if (Math.ceil(timerLeft) !== prevWhole) emitObjective();
    if (timerLeft <= 0) {
      failMission('Out of time');
      return;
    }
  }

  const m = MISSIONS[game.missions.current];
  const def = m.stages[game.missions.stage];
  if (!def) return;
  const kind = stageKind(def);
  if (kind === 'reach') {
    if (def.target && distTo(def.target[0], def.target[1]) <= MARKER_RADIUS) advanceStage();
  } else if (kind === 'combat') {
    updateEnemies(dt);
    if (killCount >= killTotal) advanceStage();
  } else if (kind === 'loseCops') {
    // "Break line of sight" clears once a star is lost; the other lose-heat
    // stages clear only when wanted hits 0.
    if (def.objective.toLowerCase().includes('break line of sight')) {
      if (game.wanted <= 1) advanceStage();
    } else if (game.wanted === 0) {
      advanceStage();
    }
  } else if (kind === 'chase') {
    updateChase(dt);
    if (chaseCar && distTo(chaseCar.pos.x, chaseCar.pos.z) <= CHASE_CATCH_DIST) advanceStage();
  }
}

export default { init, update, startMission, advanceStage, failMission, completeMission };
