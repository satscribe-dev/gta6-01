// SOLARA BAY — police system (W3). Wanted stars, SBPD pursuit AI, helicopter.
// Contract (DESIGN.md): default { init(game), update(dt) } + named
// setWanted(n), addHeat(n), clearWanted(). Units live in game.police.units as
// { car, name, behavior, dist }; the helicopter in game.police.helicopter.
// Police cars are created via spawnCar('police', x, z, heading) from vehicles.js.
import * as THREE from 'three';
import { CITY, CARS, POLICE_UNITS, HELI_NAME } from './config.js';
import { spawnCar } from './vehicles.js';

const MAX_WANTED = 5;
const MAX_UNITS = 7;
const HELI_MIN_WANTED = 3;
const SIGHT_RANGE = 120; // m — beyond this a ground unit cannot see the player
const SEARCH_RADIUS = 50; // m — radius around the last-seen spot the cops keep searching
const HIDE_PER_STAR = 20; // s hidden per star shed
const HELI_BLIND_SECONDS = 15; // s with no ground-unit sighting before the heli loses the player
const BUSTED_TOUCH = 2.5; // m — a unit touching the player on foot = busted
const BUSTED_NEAR = 3; // m — unit this close to a stopped player car starts the clock
const BUSTED_HOLD = 3; // s — stopped with a unit that close = busted
const SPAWN_MIN = 60; // m — units spawn this far from the player, at minimum
const SPAWN_MAX = 90; // m — ...and at most this far
const BEHAVIOR_TICK = 1; // s — how often behaviours are reassigned
const FLASH_PERIOD = 0.28; // s — light-bar flash half-period

let G = null; // the game object, set by init()
let hiddenTime = 0; // seconds the player has been continuously hidden
let heliBlindTime = 0; // seconds the helicopter has gone without a ground unit seeing the player
let behaviorTimer = 0; // counts down to the next behaviour reassignment
let bustedTimer = 0; // seconds a stopped player car has had a unit within BUSTED_NEAR
let nameCursor = 0; // cycles through POLICE_UNITS so unit names rotate
const lastSeen = new THREE.Vector3(0, 0, 60); // player pos at the last sighting
let everSeen = false;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Forward vector for a heading, matching main.js (forward = sin/cos in x/z).
function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function dist2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

// --- line of sight ---------------------------------------------------------
// Cheap 2D check: a unit sees the player when in range and no building sits
// between them. Buildings come from game.world.buildings when W1 exposes them
// (entries as {x,z,hx,hz}, {x,z,w,d}, {minX,maxX,minZ,maxZ}, or meshes with
// position + userData half-extents); with no building data yet the range check
// alone applies, exactly the approximation the brief allows.
function buildingBounds(b) {
  if (b == null) return null;
  if (typeof b.minX === 'number' && typeof b.maxX === 'number') {
    return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  }
  if (b.position && typeof b.position.x === 'number') {
    const hx = b.userData?.hx ?? b.userData?.halfX ?? (b.scale?.x ?? 1) * 5;
    const hz = b.userData?.hz ?? b.userData?.halfZ ?? (b.scale?.z ?? 1) * 5;
    return {
      minX: b.position.x - hx, maxX: b.position.x + hx,
      minZ: b.position.z - hz, maxZ: b.position.z + hz,
    };
  }
  if (typeof b.x === 'number' && typeof b.z === 'number') {
    const hx = b.hx ?? (b.w ?? 20) / 2;
    const hz = b.hz ?? (b.d ?? 20) / 2;
    return { minX: b.x - hx, maxX: b.x + hx, minZ: b.z - hz, maxZ: b.z + hz };
  }
  return null;
}

// Does the segment (ax,az)-(bx,bz) cross the AABB? Slab test, t in [0,1].
function segmentHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.minX || ax > box.maxX) return false;
  } else {
    let t1 = (box.minX - ax) / dx;
    let t2 = (box.maxX - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < box.minZ || az > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - az) / dz;
    let t2 = (box.maxZ - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

function hasLineOfSight(unitPos, playerPos) {
  const d = dist2D(unitPos.x, unitPos.z, playerPos.x, playerPos.z);
  if (d > SIGHT_RANGE) return false;
  const buildings = G.world?.buildings;
  if (!Array.isArray(buildings) || buildings.length === 0) return true;
  for (const b of buildings) {
    const box = buildingBounds(b);
    if (box && segmentHitsBox(unitPos.x, unitPos.z, playerPos.x, playerPos.z, box)) {
      return false;
    }
  }
  return true;
}

// --- light bar -------------------------------------------------------------
// Black-and-white body comes from spawnCar('police') (CARS.police color is
// near-black); the flashing red/blue bar is added here on the roof.
function addLightBar(car) {
  const bar = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.1, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.6 }),
  );
  base.position.y = 0;
  bar.add(base);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x2050ff });
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), redMat);
  red.position.set(-0.33, 0.12, 0);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), blueMat);
  blue.position.set(0.33, 0.12, 0);
  bar.add(red);
  bar.add(blue);
  bar.position.y = 1.12; // roof height of a spawnCar car
  car.group.add(bar);
  return { red, blue };
}

// --- spawning / despawning ---------------------------------------------------
function spawnPointNearPlayer() {
  const p = G.player.pos;
  for (let tries = 0; tries < 12; tries += 1) {
    const angle = Math.random() * Math.PI * 2;
    const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = clamp(p.x + Math.sin(angle) * r, -CITY.half + 5, CITY.half - 5);
    const z = clamp(p.z + Math.cos(angle) * r, -CITY.half + 5, CITY.half - 5);
    if (dist2D(x, z, p.x, p.z) >= SPAWN_MIN * 0.8) return { x, z };
  }
  return { x: clamp(p.x + SPAWN_MIN, -CITY.half + 5, CITY.half - 5), z: p.z };
}

function spawnUnit() {
  const spot = spawnPointNearPlayer();
  const p = G.player.pos;
  const heading = Math.atan2(p.x - spot.x, p.z - spot.z); // face the player
  const car = spawnCar('police', spot.x, spot.z, heading);
  car.isPolice = true;
  car.isTraffic = false;
  const lights = car.group ? addLightBar(car) : null;
  const name = POLICE_UNITS[nameCursor % POLICE_UNITS.length];
  nameCursor += 1;
  const unit = {
    car,
    name,
    behavior: 'PURSUIT',
    dist: dist2D(spot.x, spot.z, p.x, p.z),
    _lightRed: lights?.red ?? null,
    _lightBlue: lights?.blue ?? null,
    _flash: Math.random() * FLASH_PERIOD,
    _targetX: p.x,
    _targetZ: p.z,
    _stuck: 0,
    _reversing: 0,
  };
  G.police.units.push(unit);
  return unit;
}

function removeUnit(unit) {
  const i = G.police.units.indexOf(unit);
  if (i >= 0) G.police.units.splice(i, 1);
  const car = unit.car;
  if (car) {
    const ci = G.cars.indexOf(car);
    if (ci >= 0) G.cars.splice(ci, 1);
    if (car.group) G.scene.remove(car.group);
  }
}

function buildHelicopter() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.5, metalness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 4.6), dark);
  body.position.y = 0;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.2), white);
  nose.position.set(0, -0.1, 2.6);
  group.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.4), dark);
  tail.position.set(0, 0.3, -4.2);
  group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.0), white);
  fin.position.set(0, 0.9, -6.2);
  group.add(fin);
  const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.6 });
  for (const sx of [-0.9, 0.9]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4.0), skidMat);
    skid.position.set(sx, -1.0, 0);
    group.add(skid);
  }
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.7 }),
  );
  rotor.position.y = 1.0;
  group.add(rotor);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), skidMat);
  mast.position.y = 0.8;
  group.add(mast);
  // Searchlight cone (visual only — no real SpotLight; the scene budget is 2 lights).
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(7, 46, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.09,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  cone.rotation.x = Math.PI; // apex up at the heli, opening down
  cone.position.y = -23;
  group.add(cone);
  // Pool of light on the ground under the player.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(6, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06;
  G.scene.add(pool);
  group.position.set(G.player.pos.x, 42, G.player.pos.z - 26);
  G.scene.add(group);
  return {
    group,
    name: HELI_NAME,
    behavior: 'SEARCHLIGHT',
    dist: 0,
    _rotor: rotor,
    _cone: cone,
    _pool: pool,
    _angle: Math.random() * Math.PI * 2,
  };
}

function removeHelicopter() {
  const heli = G.police.helicopter;
  if (!heli) return;
  if (heli.group) G.scene.remove(heli.group);
  if (heli._pool) G.scene.remove(heli._pool);
  G.police.helicopter = null;
}

// --- wanted level ------------------------------------------------------------
export function setWanted(n) {
  if (!G) return;
  const stars = clamp(Math.round(n), 0, MAX_WANTED);
  // The hide/busted clocks reset even when the level is re-asserted
  // unchanged: story heat (missions.js) sets a level the player may already
  // be at, and a half-spent hiddenTime would otherwise shed a star almost
  // immediately. Only the assignment + HUD emit are skipped when unchanged.
  hiddenTime = 0;
  heliBlindTime = 0;
  bustedTimer = 0;
  if (stars === G.wanted) return;
  G.wanted = stars;
  G.events.emit('wanted', { stars });
}

export function addHeat(n) {
  if (!G) return;
  setWanted(G.wanted + n);
}

export function clearWanted() {
  if (!G) return;
  while (G.police.units.length > 0) removeUnit(G.police.units[0]);
  removeHelicopter();
  nameCursor = 0;
  hiddenTime = 0;
  heliBlindTime = 0;
  bustedTimer = 0;
  everSeen = false;
  setWanted(0);
}

// --- behaviour -----------------------------------------------------------------
function setBehavior(unit, behavior) {
  if (unit.behavior === behavior) return;
  unit.behavior = behavior;
  G.events.emit('scanner', {
    unit: unit.name,
    behavior,
    dist: Math.round(unit.dist),
  });
}

function assignBehaviors() {
  const units = G.police.units;
  if (units.length === 0) return;
  const inCar = !!G.currentCar;
  const sorted = [...units].sort((a, b) => a.dist - b.dist);
  for (const unit of units) setBehavior(unit, 'PURSUIT');
  if (inCar && sorted.length >= 1) setBehavior(sorted[0], 'RAMMING');
  if (inCar && G.wanted >= 2 && sorted.length >= 2) setBehavior(sorted[1], 'ROADBLOCK');
}

function playerVelocity() {
  if (G.currentCar) {
    const f = forwardOf(G.currentCar.heading);
    return { x: f.x * G.currentCar.speed, z: f.z * G.currentCar.speed };
  }
  const f = forwardOf(G.player.heading);
  return { x: f.x * G.player.speed, z: f.z * G.player.speed };
}

function updateUnitTarget(unit) {
  const p = G.player.pos;
  if (unit.behavior === 'ROADBLOCK') {
    // Park ahead on the player's route, 45 m in front of where they are going.
    const v = playerVelocity();
    const len = Math.hypot(v.x, v.z);
    const fx = len > 0.5 ? v.x / len : Math.sin(G.player.heading);
    const fz = len > 0.5 ? v.z / len : Math.cos(G.player.heading);
    unit._targetX = clamp(p.x + fx * 45, -CITY.half, CITY.half);
    unit._targetZ = clamp(p.z + fz * 45, -CITY.half, CITY.half);
  } else if (unit.behavior === 'RAMMING') {
    // Aim at where the player will be, not where they are.
    const v = playerVelocity();
    unit._targetX = p.x + v.x * 0.6;
    unit._targetZ = p.z + v.z * 0.6;
  } else {
    unit._targetX = p.x;
    unit._targetZ = p.z;
  }
}

function driveUnit(unit, dt) {
  const car = unit.car;
  if (!car || !car.pos) return;
  updateUnitTarget(unit);
  const dx = unit._targetX - car.pos.x;
  const dz = unit._targetZ - car.pos.z;
  const targetDist = Math.hypot(dx, dz);
  const topSpeed = CARS.police.topSpeed;
  let wantSpeed = topSpeed;
  if (unit.behavior === 'ROADBLOCK' && targetDist < 6) wantSpeed = 0;
  else if (unit.behavior === 'ROADBLOCK') wantSpeed = topSpeed * 0.6;
  if (targetDist < 3) wantSpeed = Math.min(wantSpeed, 8);

  // Unstuck: if we have barely moved toward a far target, reverse briefly.
  if (unit._reversing > 0) {
    unit._reversing -= dt;
    car.speed = -8;
  } else {
    if (targetDist > 10 && Math.abs(car.speed) < 0.5) {
      unit._stuck += dt;
      if (unit._stuck > 2.5) {
        unit._stuck = 0;
        unit._reversing = 1.0;
        car.speed = -8;
      }
    } else {
      unit._stuck = 0;
    }
    if (unit._reversing <= 0) {
      const accel = CARS.police.accel;
      if (car.speed < wantSpeed) car.speed = Math.min(wantSpeed, car.speed + accel * dt);
      else car.speed = Math.max(wantSpeed, car.speed - CARS.police.brake * dt);
    }
  }

  // Steer toward the target (reverse flips the steering sense).
  const desired = Math.atan2(dx, dz);
  let diff = wrapAngle(desired - car.heading);
  const reversing = car.speed < 0;
  if (reversing) diff = wrapAngle(diff + Math.PI);
  const turnRate = 2.1;
  const turn = clamp(diff, -turnRate * dt, turnRate * dt);
  car.heading = wrapAngle(car.heading + (reversing ? -turn : turn));

  // ROADBLOCK in position: sit still, facing the player.
  if (unit.behavior === 'ROADBLOCK' && targetDist < 6) {
    car.speed = 0;
    car.heading = Math.atan2(G.player.pos.x - car.pos.x, G.player.pos.z - car.pos.z);
  }

  const f = forwardOf(car.heading);
  car.pos.x = clamp(car.pos.x + f.x * car.speed * dt, -CITY.half, CITY.half);
  car.pos.z = clamp(car.pos.z + f.z * car.speed * dt, -CITY.half, CITY.half);
  if (car.group) {
    car.group.position.set(car.pos.x, 0, car.pos.z);
    car.group.rotation.y = car.heading;
  }
}

function flashLightBar(unit, dt) {
  if (!unit._lightRed || !unit._lightBlue) return;
  unit._flash += dt;
  if (unit._flash >= FLASH_PERIOD) {
    unit._flash = 0;
    const redOn = unit._lightRed.visible;
    unit._lightRed.visible = !redOn;
    unit._lightBlue.visible = redOn;
  }
}

function updateHelicopter(dt) {
  const heli = G.police.helicopter;
  if (!heli) return;
  const p = G.player.pos;
  // Once the heli has gone HELI_BLIND_SECONDS without a ground unit seeing
  // the player, it stops tracking the player and sweeps the last-seen spot
  // instead — otherwise wanted could never decay at 3+ stars.
  const blind = heliBlindTime >= HELI_BLIND_SECONDS && everSeen;
  const fx = blind ? lastSeen.x : p.x;
  const fz = blind ? lastSeen.z : p.z;
  heli._angle += 0.45 * dt; // slow circle above the focus point
  const hx = fx + Math.cos(heli._angle) * 26;
  const hz = fz + Math.sin(heli._angle) * 26;
  heli.group.position.set(hx, 42, hz);
  heli.group.lookAt(fx, 0, fz);
  heli._rotor.rotation.y += 22 * dt;
  heli._pool.position.set(fx, 0.06, fz);
  heli.dist = dist2D(hx, hz, p.x, p.z);
}

// --- main loop -------------------------------------------------------------------
function update(dt) {
  if (!G) return;
  const wanted = G.wanted;
  if (wanted <= 0) {
    if (G.police.units.length > 0 || G.police.helicopter) clearWanted();
    return;
  }

  // Sync unit count: min(wanted + 1, 7) ground units.
  const wantUnits = Math.min(wanted + 1, MAX_UNITS);
  while (G.police.units.length < wantUnits) spawnUnit();
  while (G.police.units.length > wantUnits) {
    removeUnit(G.police.units[G.police.units.length - 1]);
  }

  // Helicopter at wanted >= 3.
  if (wanted >= HELI_MIN_WANTED && !G.police.helicopter) {
    G.police.helicopter = buildHelicopter();
  } else if (wanted < HELI_MIN_WANTED && G.police.helicopter) {
    removeHelicopter();
  }

  // Behaviour reassignment on a slow tick, not every frame.
  behaviorTimer -= dt;
  if (behaviorTimer <= 0) {
    behaviorTimer = BEHAVIOR_TICK;
    assignBehaviors();
  }

  // Per-unit: distance, AI driving, flashing light bar.
  const p = G.player.pos;
  for (const unit of G.police.units) {
    unit.dist = unit.car?.pos ? dist2D(unit.car.pos.x, unit.car.pos.z, p.x, p.z) : 999;
    driveUnit(unit, dt);
    unit.dist = unit.car?.pos ? dist2D(unit.car.pos.x, unit.car.pos.z, p.x, p.z) : 999;
    flashLightBar(unit, dt);
  }
  // Ground line of sight, computed once: the helicopter's searchlight only
  // keeps the player seen while a ground unit has ALSO seen them recently.
  const groundSeen = G.police.units.some((u) => u.car?.pos && hasLineOfSight(u.car.pos, p));
  if (G.police.helicopter) {
    if (groundSeen) heliBlindTime = 0;
    else heliBlindTime += dt;
  } else {
    heliBlindTime = 0;
  }
  updateHelicopter(dt);

  // --- line of sight / decay ---
  // The helicopter's searchlight keeps the player IN SIGHT only while it is
  // up AND has not gone blind (no ground-unit sighting for HELI_BLIND_SECONDS).
  const seen = groundSeen || (!!G.police.helicopter && heliBlindTime < HELI_BLIND_SECONDS);
  if (seen) {
    lastSeen.set(p.x, 0, p.z);
    everSeen = true;
    hiddenTime = 0;
  } else {
    // Hidden only once the player is also outside the searched area around
    // the last place they were seen (before any sighting, any unseen spot counts).
    const outsideSearch = !everSeen || dist2D(p.x, p.z, lastSeen.x, lastSeen.z) > SEARCH_RADIUS;
    if (outsideSearch) {
      hiddenTime += dt;
      if (hiddenTime >= HIDE_PER_STAR) {
        hiddenTime = 0;
        setWanted(wanted - 1);
      }
    } else {
      hiddenTime = 0;
    }
  }

  // --- busted ---
  if (G.mode === 'playing') {
    if (G.player.onFoot) {
      for (const unit of G.police.units) {
        if (unit.dist <= BUSTED_TOUCH) {
          gameSetModeBusted();
          return;
        }
      }
    } else if (G.currentCar) {
      const stopped = Math.abs(G.currentCar.speed) < 2;
      let close = false;
      for (const unit of G.police.units) {
        if (unit.dist <= BUSTED_NEAR) { close = true; break; }
      }
      if (stopped && close) {
        bustedTimer += dt;
        if (bustedTimer >= BUSTED_HOLD) {
          bustedTimer = 0;
          gameSetModeBusted();
          return;
        }
      } else {
        bustedTimer = 0;
      }
    }
  }
}

function gameSetModeBusted() {
  // main.js handles the fine + respawn; police only flips the mode.
  G.setMode('busted');
}

function init(game) {
  G = game;
  if (!G.police) G.police = { units: [], helicopter: null };
  G.police.units.length = 0;
  G.police.helicopter = null;
  hiddenTime = 0;
  heliBlindTime = 0;
  behaviorTimer = 0;
  bustedTimer = 0;
  nameCursor = 0;
  everSeen = false;
  lastSeen.set(G.player.pos.x, 0, G.player.pos.z);
}

export default { init, update, setWanted, addHeat, clearWanted };
