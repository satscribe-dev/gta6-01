// SOLARA BAY — activities (W4). Taxi fares, street racing, sun-disc collectibles.
// Markers are blue (taxi) and orange (race) so they never clash with the gold
// mission marker. Payouts go through game.addMoney, which emits the 'money'
// event itself, so no payout is emitted twice.
import * as THREE from 'three';
import { CHARACTERS } from './config.js';
import { spawnCar } from './vehicles.js';

const TAXI_PICKUPS = [[-60, 120], [120, -60], [-180, 0], [60, 180]];
const TAXI_DESTS = [[180, -180], [-210, 210], [0, 0], [210, 30], [-120, -180], [90, -120]];
const TAXI_BASE_FARE = 80;
const TAXI_TIP_FAST = 40;
const TAXI_TIP_OK = 20;

const RACE_START = [-120, -120];
const RACE_CPS = [
  [-120, -120], [0, -120], [120, -120], [180, -120],
  [180, 0], [180, 120], [60, 120], [-120, 120],
];
const RACE_ENTRY = 200;
const RACE_PRIZE = 1000;
const RACE_AI = [
  { type: 'corsair', name: 'Corsair', off: [-12, -10] },
  { type: 'vela', name: 'Vela S', off: [10, -12] },
  { type: 'zephyr', name: 'Zephyr R', off: [0, 14] },
];
const RACE_AI_SPEED = 20;
const RACE_CP_RADIUS = 12;

const DISC_POSITIONS = [
  [-210, -210], [-150, -150], [-90, -210], [-30, -150],
  [30, -210], [90, -150], [150, -210], [210, -150],
  [-210, -90], [-90, -90], [30, -90], [150, -90],
  [210, -30], [-210, 30], [-150, 90], [-30, 30],
  [90, 90], [210, 90], [-150, 180], [150, 180],
];
const DISC_REWARD = 100;
const DISC_BONUS = 2000;
const DISC_BONUS_RESPECT = 200;

let game = null;
let elapsed = 0;
let ePrev = false;

let taxi = { active: false, waiting: false, pickup: null, pickupIdx: -1, dest: null, startedAt: 0, parTime: 0, nextAt: 0 };
let passenger = null; // { group, diamond, marker }
let destMarker = null;
let race = { active: false, cp: 0, ai: [] };
let raceStartMarker = null;
let raceCpMarker = null;
let raceCpRings = [];
let discs = []; // { mesh, x, z, taken }
let collected = 0;

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

// --- shared marker builder (light pillar + ground ring) ---
function makeMarker(color) {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 13;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(pillar, ring);
  group.visible = false;
  game.scene.add(group);
  return { group, pillar, ring };
}

// --- taxi ---
function makePassenger() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.75, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x2ec4ff, roughness: 0.8 }),
  );
  body.position.y = 1.05;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.7 }),
  );
  head.position.y = 1.85;
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.35),
    new THREE.MeshBasicMaterial({ color: 0x2ec4ff }),
  );
  diamond.position.y = 2.45;
  group.add(body, head, diamond);
  group.visible = false;
  game.scene.add(group);
  return { group, diamond };
}

function placePassenger(idx) {
  taxi.pickupIdx = idx;
  taxi.pickup = TAXI_PICKUPS[idx];
  passenger.group.position.set(taxi.pickup[0], 0, taxi.pickup[1]);
  passenger.group.visible = true;
  passenger.marker.group.position.set(taxi.pickup[0], 0, taxi.pickup[1]);
  passenger.marker.group.visible = true;
  taxi.waiting = true;
}

export function startTaxi() {
  if (taxi.active || !taxi.waiting) return;
  if (!game.currentCar) {
    say('lena', 'You need wheels to run fares, Kai. Grab a car first.');
    return;
  }
  if (distTo(taxi.pickup[0], taxi.pickup[1]) > 8) {
    say('lena', 'Pull up to the passenger first — blue marker.');
    return;
  }
  let dest = TAXI_DESTS[Math.floor(Math.random() * TAXI_DESTS.length)];
  let guard = 0;
  while (dest[0] === taxi.pickup[0] && dest[1] === taxi.pickup[1] && guard < 10) {
    dest = TAXI_DESTS[Math.floor(Math.random() * TAXI_DESTS.length)];
    guard++;
  }
  taxi.dest = dest;
  taxi.active = true;
  taxi.waiting = false;
  taxi.startedAt = elapsed;
  taxi.parTime = Math.hypot(dest[0] - taxi.pickup[0], dest[1] - taxi.pickup[1]) / 22;
  passenger.group.visible = false;
  passenger.marker.group.visible = false;
  destMarker.group.position.set(dest[0], 0, dest[1]);
  destMarker.group.visible = true;
  say('lena', 'Fare is up. Get them to the blue pin — fast and smooth earns a tip.');
}

function updateTaxi() {
  if (taxi.active) {
    if (distTo(taxi.dest[0], taxi.dest[1]) <= 8) {
      const took = elapsed - taxi.startedAt;
      const tip = took <= taxi.parTime ? TAXI_TIP_FAST : took <= taxi.parTime * 1.5 ? TAXI_TIP_OK : 0;
      const fare = TAXI_BASE_FARE + tip;
      game.addMoney(fare, 'Taxi fare');
      say('lena', tip > 0 ? `Clean run — $${fare} with tip. Nice driving.` : `Fare paid — $${fare}.`);
      destMarker.group.visible = false;
      taxi.active = false;
      taxi.nextAt = elapsed + 5;
    }
    return;
  }
  if (!taxi.waiting && elapsed >= taxi.nextAt) {
    let idx = Math.floor(Math.random() * TAXI_PICKUPS.length);
    if (TAXI_PICKUPS.length > 1) {
      let guard = 0;
      while (idx === taxi.pickupIdx && guard < 10) {
        idx = Math.floor(Math.random() * TAXI_PICKUPS.length);
        guard++;
      }
    }
    placePassenger(idx);
  }
}

// --- street race ---
function clearRaceCars() {
  for (const ai of race.ai) {
    if (ai.car) {
      if (ai.car.group) game.scene.remove(ai.car.group);
      const i = game.cars.indexOf(ai.car);
      if (i >= 0) game.cars.splice(i, 1);
    }
  }
  race.ai = [];
}

export function startRace() {
  if (race.active) return;
  if (!game.currentCar) {
    say('mira', 'You need a car for the street race, Kai.');
    return;
  }
  if (game.money < RACE_ENTRY) {
    say('mira', "Entry is $200 — you're short. Run a fare first.");
    return;
  }
  game.addMoney(-RACE_ENTRY, 'Street race entry');
  race.active = true;
  race.cp = 0;
  race.ai = [];
  for (const spec of RACE_AI) {
    const car = spawnCar(spec.type, RACE_START[0] + spec.off[0], RACE_START[1] + spec.off[1], 0, { isTraffic: false });
    race.ai.push({ car, cp: 1, name: spec.name });
  }
  raceStartMarker.group.visible = false;
  for (const ring of raceCpRings) ring.visible = true;
  raceCpMarker.group.position.set(RACE_CPS[0][0], 0, RACE_CPS[0][1]);
  raceCpMarker.group.visible = true;
  say('mira', 'Eight checkpoints, three rivals, one grand on the line. Go!');
}

function endRace(won, winnerName) {
  clearRaceCars();
  race.active = false;
  race.cp = 0;
  raceCpMarker.group.visible = false;
  for (const ring of raceCpRings) ring.visible = false;
  raceStartMarker.group.visible = true;
  if (won) {
    game.addMoney(RACE_PRIZE, 'Street race win');
    say('mira', 'Clean sweep! A grand in your pocket, Kai.');
  } else {
    say('theo', `The ${winnerName} took it. Entry's gone — run it back.`);
  }
}

function cancelRace() {
  if (!race.active) return;
  clearRaceCars();
  race.active = false;
  race.cp = 0;
  raceCpMarker.group.visible = false;
  for (const ring of raceCpRings) ring.visible = false;
  raceStartMarker.group.visible = true;
  say('mira', 'Race called off. Entry stays with the house.');
}

function updateRace(dt) {
  if (!race.active) return;
  // Player progress.
  const cp = RACE_CPS[race.cp];
  if (cp && distTo(cp[0], cp[1]) <= RACE_CP_RADIUS) {
    race.cp += 1;
    if (race.cp >= RACE_CPS.length) {
      endRace(true, null);
      return;
    }
    raceCpMarker.group.position.set(RACE_CPS[race.cp][0], 0, RACE_CPS[race.cp][1]);
  }
  // AI rivals follow the same checkpoints at a middling pace.
  for (const ai of race.ai) {
    if (!ai.car || ai.cp >= RACE_CPS.length) continue;
    const t = RACE_CPS[ai.cp];
    const dx = t[0] - ai.car.pos.x;
    const dz = t[1] - ai.car.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= RACE_CP_RADIUS) {
      ai.cp += 1;
      if (ai.cp >= RACE_CPS.length) {
        endRace(false, ai.name);
        return;
      }
      continue;
    }
    const desired = Math.atan2(dx, dz);
    let diff = desired - ai.car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ai.car.heading += Math.max(-2.0 * dt, Math.min(2.0 * dt, diff));
    ai.car.pos.x += Math.sin(ai.car.heading) * RACE_AI_SPEED * dt;
    ai.car.pos.z += Math.cos(ai.car.heading) * RACE_AI_SPEED * dt;
    ai.car.speed = RACE_AI_SPEED;
    if (ai.car.group) {
      ai.car.group.position.set(ai.car.pos.x, 0, ai.car.pos.z);
      ai.car.group.rotation.y = ai.car.heading;
    }
  }
}

// --- collectibles ---
function buildDiscs() {
  const geo = new THREE.TorusGeometry(0.85, 0.16, 10, 24);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd76a, emissive: 0xffb52e, emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.3,
  });
  for (const [x, z] of DISC_POSITIONS) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.2, z);
    game.scene.add(mesh);
    discs.push({ mesh, x, z, taken: false });
  }
}

function updateDiscs(dt) {
  const p = playerPos();
  for (const d of discs) {
    if (d.taken) continue;
    d.mesh.rotation.y += dt * 1.5;
    d.mesh.position.y = 1.2 + Math.sin(elapsed * 2 + d.x) * 0.15;
    const dx = p.x - d.x;
    const dz = p.z - d.z;
    if (dx * dx + dz * dz <= 9) {
      d.taken = true;
      d.mesh.visible = false;
      collected += 1;
      game.addMoney(DISC_REWARD, 'Sun disc');
      if (collected >= DISC_POSITIONS.length) {
        game.addMoney(DISC_BONUS, 'All sun discs');
        game.addRespect(DISC_BONUS_RESPECT);
        say('theo', 'All twenty sun discs. The bay just paid you two grand for sightseeing.');
      }
    }
  }
}

// --- lifecycle ---
function init(g) {
  game = g;
  passenger = makePassenger();
  passenger.marker = makeMarker(0x2ec4ff);
  destMarker = makeMarker(0x2ec4ff);
  raceStartMarker = makeMarker(0xff7a2e);
  raceStartMarker.group.position.set(RACE_START[0], 0, RACE_START[1]);
  raceStartMarker.group.visible = true;
  raceCpMarker = makeMarker(0xff7a2e);
  for (const [x, z] of RACE_CPS) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 3.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    ring.visible = false;
    game.scene.add(ring);
    raceCpRings.push(ring);
  }
  buildDiscs();
  placePassenger(0);
  taxi.nextAt = 0;
}

function update(dt) {
  elapsed += dt;
  const eDown = game.input.keys.has('KeyE');
  const ePressed = eDown && !ePrev;
  ePrev = eDown;

  // E near the passenger starts a fare; E at the race start starts/quits a race.
  if (ePressed) {
    const p = playerPos();
    if (taxi.waiting && !taxi.active && Math.hypot(p.x - taxi.pickup[0], p.z - taxi.pickup[1]) <= 6) {
      startTaxi();
    } else if (Math.hypot(p.x - RACE_START[0], p.z - RACE_START[1]) <= 6) {
      if (race.active) cancelRace();
      else startRace();
    }
  }

  if (passenger.group.visible) {
    passenger.diamond.rotation.y += dt * 2;
    passenger.diamond.position.y = 2.45 + Math.sin(elapsed * 3) * 0.1;
  }
  if (raceCpMarker.group.visible) {
    raceCpMarker.ring.rotation.z += dt * 0.8;
    raceCpMarker.pillar.material.opacity = 0.2 + 0.08 * Math.sin(elapsed * 3);
  }

  updateTaxi();
  updateRace(dt);
  updateDiscs(dt);
}

export default { init, update };
