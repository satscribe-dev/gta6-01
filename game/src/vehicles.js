// SOLARA BAY — vehicles + traffic + pedestrians (W2).
// Arcade car physics, player driving (incl. nitro + handbrake drift),
// AI traffic on the street grid, parked stealable cars, sidewalk peds.
import * as THREE from 'three';
import { CARS, CITY } from './config.js';

const ROAD_LINES = [-210, -150, -90, -30, 30, 90, 150, 210]; // street centre lines
const CITY_HALF = 238;
const BEACH_Z = 210;
const TRAFFIC_COUNT = 10;
const PARKED_COUNT = 8;
const PED_COUNT = 14;
const PED_COLORS = [0xff7a2e, 0x2ec4ff, 0xffc93c, 0x9a6bff, 0xe85d75, 0x3ddc97, 0xf2f2f2, 0x222831];

let game = null;
let peds = [];
let elapsed = 0;
let playerSpot = null;
let playerSpotCar = null;
let playerSpotTarget = null;

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function nearestRoadLine(v) {
  let best = ROAD_LINES[0];
  for (const line of ROAD_LINES) if (Math.abs(line - v) < Math.abs(best - v)) best = line;
  return best;
}
function isNight() {
  const m = game.time.minutes;
  return m >= 1080 || m < 360; // 18:00–06:00
}

// ---------------------------------------------------------------------------
// car construction
// ---------------------------------------------------------------------------
function buildCarMesh(type, color) {
  const group = new THREE.Group();
  const isPolice = type === 'police';
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1620, roughness: 0.15, metalness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.2), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 2.1),
    isPolice
      ? new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35, metalness: 0.5 })
      : glassMat,
  );
  cabin.position.set(0, 1.05, -0.25);
  cabin.castShadow = true;
  group.add(cabin);

  if (isPolice) {
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.3), darkMat);
    barBase.position.set(0, 1.36, -0.25);
    group.add(barBase);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xcc1122, emissive: 0xff1122, emissiveIntensity: 1.2 }),
    );
    red.position.set(-0.28, 1.36, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x2244cc, emissive: 0x2244ff, emissiveIntensity: 1.2 }),
    );
    blue.position.set(0.28, 1.36, -0.25);
    group.add(blue);
  }

  // headlights (emissive; the real SpotLight is only on the player's car, at night)
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 1.6,
  });
  for (const sx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    lamp.position.set(sx, 0.62, 2.12);
    group.add(lamp);
  }

  // brake lights (emissive intensity driven in update)
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x881111, emissive: 0xff2222, emissiveIntensity: 0.4,
  });
  for (const sx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), brakeMat);
    lamp.position.set(sx, 0.62, -2.12);
    group.add(lamp);
  }

  // wheels: steer group (front) > spin group > cylinder (axle along X)
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
  for (const [wx, wz, front] of [[-0.95, 1.35, true], [0.95, 1.35, true], [-0.95, -1.35, false], [0.95, -1.35, false]]) {
    const steer = new THREE.Group();
    steer.position.set(wx, 0.36, wz);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, darkMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    spin.add(tyre);
    steer.add(spin);
    group.add(steer);
    wheels.push({ steer, spin, front });
  }

  // damage smoke (hidden until condition < 30)
  const smokeMat = new THREE.MeshStandardMaterial({
    color: 0x555555, transparent: true, opacity: 0.4, roughness: 1, depthWrite: false,
  });
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), smokeMat);
  smoke.position.set(0, 1.5, 1.5);
  smoke.visible = false;
  group.add(smoke);

  // nitro flame (hidden unless boosting)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.9 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.45, -2.5);
  flame.visible = false;
  group.add(flame);

  return { group, wheels, brakeMat, smoke, flame };
}

function spawnCar(type, x, z, heading, opts = {}) {
  const spec = CARS[type] || null;
  const color = opts.color ?? (spec ? spec.color : pick(CARS.traffic));
  const built = buildCarMesh(type, color);
  const car = {
    mesh: built.group,
    group: built.group,
    pos: new THREE.Vector3(x, 0, z),
    heading,
    speed: 0,
    type,
    color,
    condition: opts.condition ?? 100,
    isPlayer: false,
    isPolice: type === 'police',
    isTraffic: !!opts.isTraffic,
    isParked: !!opts.isParked,
    accel: spec ? spec.accel : 18,
    topSpeed: spec ? spec.topSpeed : 42,
    brake: spec ? spec.brake : 32,
    steer: spec ? spec.steer : 0.5,
    nitro: !!(spec && spec.nitro),
    nitroFuel: 100,
    wheels: built.wheels,
    brakeMat: built.brakeMat,
    smoke: built.smoke,
    flame: built.flame,
    steerVisual: 0,
    driftPoints: 0,
    drifting: false,
    // traffic AI state
    ai: null,
  };
  if (car.isTraffic) {
    const axisX = Math.random() < 0.5;
    car.ai = {
      axis: axisX ? 'x' : 'z',
      dir: Math.random() < 0.5 ? 1 : -1,
      cruise: rand(8, 12),
      speed: rand(5, 9),
    };
    // snap onto the nearest road line for the chosen axis
    if (axisX) car.pos.z = nearestRoadLine(z);
    else car.pos.x = nearestRoadLine(x);
    car.heading = axisX ? (car.ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.ai.dir > 0 ? 0 : Math.PI);
  }
  car.group.position.copy(car.pos);
  car.group.rotation.y = car.heading;
  game.scene.add(car.group);
  game.cars.push(car);
  return car;
}

function nearestCar(pos, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of game.cars) {
    if (!car || car.isPolice) continue;
    if (car.isTraffic && Math.abs(car.speed) > 5) continue; // no carjacking moving traffic
    const dx = car.pos.x - pos.x;
    const dz = car.pos.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function stealCar(car) {
  if (!car) return null;
  const wasParked = car.isParked;
  const wasTraffic = car.isTraffic;
  car.isParked = false;
  car.isTraffic = false;
  car.ai = null;
  if (wasParked || wasTraffic) {
    game.events.emit('crime', { type: 'steal', carType: car.type });
    game.events.emit('heat', { amount: 1, reason: 'car theft' });
  }
  return car;
}

// ---------------------------------------------------------------------------
// pedestrians
// ---------------------------------------------------------------------------
function buildPedMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.62, 6, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 }),
  );
  head.position.y = 1.66;
  g.add(head);
  const legL = new THREE.Group();
  legL.position.set(-0.14, 0.68, 0);
  const ll = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.66, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.9 }));
  ll.position.y = -0.33;
  legL.add(ll);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  return { group: g, legL, legR };
}

function sidewalkPoint() {
  // on a sidewalk: just off a road line, inside the city
  const line = pick(ROAD_LINES);
  const off = pick([-1, 1]) * (CITY.street / 2 + 2);
  if (Math.random() < 0.5) return new THREE.Vector3(rand(-220, 220), 0, line + off);
  return new THREE.Vector3(line + off, 0, rand(-220, 200));
}

function spawnPed() {
  const built = buildPedMesh(pick(PED_COLORS));
  const pos = sidewalkPoint();
  const ped = {
    group: built.group,
    legL: built.legL,
    legR: built.legR,
    pos,
    heading: rand(0, Math.PI * 2),
    speed: 0,
    wp: sidewalkPoint(),
    state: 'walk', // 'walk' | 'flee' | 'down'
    fleeT: 0,
    downT: 0,
    phase: rand(0, 6),
  };
  ped.group.position.copy(pos);
  game.scene.add(ped.group);
  peds.push(ped);
  return ped;
}

function updatePedestrians(dt) {
  const shot = game.lastShotPos || null;
  for (const ped of peds) {
    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) {
        ped.state = 'walk';
        ped.pos.copy(sidewalkPoint());
        ped.wp.copy(sidewalkPoint());
        ped.group.rotation.x = 0;
        ped.group.visible = true;
      }
      continue;
    }

    // gunfire nearby: run away from the shot
    if (shot && ped.state !== 'flee') {
      const d = Math.hypot(ped.pos.x - shot.x, ped.pos.z - shot.z);
      if (d < 15) {
        ped.state = 'flee';
        ped.fleeT = 3;
        ped.heading = Math.atan2(ped.pos.x - shot.x, ped.pos.z - shot.z);
      }
    }

    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      ped.speed = 4.2;
      if (ped.fleeT <= 0) {
        ped.state = 'walk';
        ped.wp.copy(sidewalkPoint());
      }
    } else {
      _to.copy(ped.wp).sub(ped.pos);
      _to.y = 0;
      const dist = _to.length();
      if (dist < 1.5) {
        ped.wp.copy(sidewalkPoint());
      } else {
        const want = Math.atan2(_to.x, _to.z);
        let diff = want - ped.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ped.heading += THREE.MathUtils.clamp(diff, -2.2 * dt, 2.2 * dt);
        ped.speed = 1.3;
      }
    }

    _fwd.set(Math.sin(ped.heading), 0, Math.cos(ped.heading));
    ped.pos.addScaledVector(_fwd, ped.speed * dt);
    ped.pos.x = THREE.MathUtils.clamp(ped.pos.x, -238, 238);
    ped.pos.z = THREE.MathUtils.clamp(ped.pos.z, -238, 208);
    ped.group.position.copy(ped.pos);
    ped.group.rotation.y = ped.heading;
    ped.phase += ped.speed * dt * 3;
    const swing = Math.sin(ped.phase) * 0.5;
    ped.legL.rotation.x = swing;
    ped.legR.rotation.x = -swing;
  }
}

function knockPedDown(ped) {
  ped.state = 'down';
  ped.downT = 8;
  ped.speed = 0;
  ped.group.rotation.x = Math.PI / 2; // lying flat
  ped.group.position.y = 0.3;
  game.events.emit('crime', { type: 'hitPed' });
  game.events.emit('heat', { amount: 1, reason: 'hit pedestrian' });
}

// ---------------------------------------------------------------------------
// player car physics
// ---------------------------------------------------------------------------
function ensurePlayerSpotlight(car) {
  if (playerSpotCar === car) return;
  if (playerSpot) {
    playerSpot.parent?.remove(playerSpot);
    if (playerSpotTarget) playerSpotTarget.parent?.remove(playerSpotTarget);
    playerSpot = null;
    playerSpotTarget = null;
  }
  if (!car) { playerSpotCar = null; return; }
  playerSpot = new THREE.SpotLight(0xfff2cc, 90, 45, 0.55, 0.5, 1.2);
  playerSpot.position.set(0, 1.0, 2.1);
  playerSpotTarget = new THREE.Object3D();
  playerSpotTarget.position.set(0, 0, 16);
  car.group.add(playerSpotTarget);
  playerSpot.target = playerSpotTarget;
  car.group.add(playerSpot);
  playerSpotCar = car;
}

function updatePlayerCar(dt) {
  const car = game.currentCar;
  if (!car) return;
  const keys = game.input.keys;
  const p = game.player;

  const condFactor = 0.55 + 0.45 * (car.condition / 100);
  const nitroOn = (keys.has('ShiftLeft') || keys.has('ShiftRight'))
    && car.nitro && car.nitroFuel > 0 && car.speed > 5;
  const top = car.topSpeed * condFactor * (nitroOn ? 1.35 : 1);

  if (nitroOn) {
    car.nitroFuel = Math.max(0, car.nitroFuel - 35 * dt);
    car.flame.visible = true;
    car.flame.scale.set(1, 1, rand(0.8, 1.4));
  } else {
    car.nitroFuel = Math.min(100, car.nitroFuel + 8 * dt);
    car.flame.visible = false;
  }

  const throttle = keys.has('KeyW') || keys.has('ArrowUp');
  const braking = keys.has('KeyS') || keys.has('ArrowDown');
  const handbrake = keys.has('Space');

  if (throttle) car.speed += car.accel * (nitroOn ? 1.6 : 1) * dt;
  if (braking) {
    if (car.speed > 0.5) car.speed -= car.brake * dt;
    else car.speed -= car.accel * 0.5 * dt; // reverse
  }
  // drag / rolling resistance
  const drag = handbrake ? 14 : 6;
  if (!throttle && !braking) {
    if (car.speed > 0) car.speed = Math.max(0, car.speed - drag * dt);
    else car.speed = Math.min(0, car.speed + drag * dt);
  }
  if (handbrake && car.speed > 0) car.speed = Math.max(0, car.speed - 6 * dt);
  car.speed = THREE.MathUtils.clamp(car.speed, -12, top);

  // steering: weaker at speed, reversed when reversing, boosted on handbrake
  const steerInput = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
    - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const speedRatio = Math.min(1, Math.abs(car.speed) / Math.max(1, top));
  const steerAuthority = THREE.MathUtils.clamp(Math.abs(car.speed) / 10, 0.25, 1)
    * (1 - 0.45 * speedRatio) * (handbrake ? 1.9 : 1);
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += steerInput * car.steer * steerAuthority * dirSign * dt * 2.2;
  car.steerVisual += ((steerInput * 0.42) - car.steerVisual) * Math.min(1, dt * 8);

  // handbrake drift scoring
  const drifting = handbrake && Math.abs(car.speed) > 12 && steerInput !== 0;
  if (drifting) {
    car.drifting = true;
    car.driftPoints += Math.abs(car.speed) * dt * 2;
  } else if (car.drifting) {
    car.drifting = false;
    const points = Math.round(car.driftPoints);
    car.driftPoints = 0;
    if (points >= 20) game.events.emit('drift', { points });
  }

  // move
  _fwd.set(Math.sin(car.heading), 0, Math.cos(car.heading));
  car.pos.addScaledVector(_fwd, car.speed * dt);

  // city bounds (beach edge, not the ocean)
  if (car.pos.x < -CITY_HALF || car.pos.x > CITY_HALF || car.pos.z < -CITY_HALF || car.pos.z > BEACH_Z) {
    car.pos.x = THREE.MathUtils.clamp(car.pos.x, -CITY_HALF, CITY_HALF);
    car.pos.z = THREE.MathUtils.clamp(car.pos.z, -CITY_HALF, BEACH_Z);
    car.speed *= 0.5;
    if (Math.abs(car.speed) > 8) car.condition = Math.max(0, car.condition - 2);
  }

  // collisions with other cars
  for (const other of game.cars) {
    if (other === car || !other.group) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 4.2 && d > 0.01) {
      const push = (4.2 - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      car.pos.x -= nx * push;
      car.pos.z -= nz * push;
      if (!other.isTraffic) {
        other.pos.x += nx * push;
        other.pos.z += nz * push;
      }
      const impact = Math.abs(car.speed);
      if (impact > 6) {
        car.condition = Math.max(0, car.condition - impact * 0.25);
        other.condition = Math.max(0, other.condition - impact * 0.15);
        game.events.emit('crash', { speed: impact });
      }
      car.speed *= 0.6;
    }
  }

  // collisions with pedestrians
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = Math.hypot(ped.pos.x - car.pos.x, ped.pos.z - car.pos.z);
    if (d < 2.2 && Math.abs(car.speed) > 3) {
      knockPedDown(ped);
      car.condition = Math.max(0, car.condition - 2);
      car.speed *= 0.8;
    }
  }

  // brake lights
  car.brakeMat.emissiveIntensity = braking && car.speed > 0.5 ? 2.6 : 0.4;

  // keep player state glued to the car
  p.pos.copy(car.pos);
  p.pos.y = 0;
  p.heading = car.heading;

  // the one real headlight spotlight: player's car, at night only
  ensurePlayerSpotlight(car);
  if (playerSpot) playerSpot.visible = isNight();
}

// ---------------------------------------------------------------------------
// traffic AI
// ---------------------------------------------------------------------------
function obstacleAhead(car, dist) {
  _fwd.set(Math.sin(car.heading), 0, Math.cos(car.heading));
  for (const other of game.cars) {
    if (other === car) continue;
    _to.copy(other.pos).sub(car.pos);
    const along = _to.dot(_fwd);
    if (along > 0 && along < dist) {
      const lat = Math.abs(_to.x * _fwd.z - _to.z * _fwd.x);
      if (lat < 2.6) return true;
    }
  }
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    _to.copy(ped.pos).sub(car.pos);
    const along = _to.dot(_fwd);
    if (along > 0 && along < dist) {
      const lat = Math.abs(_to.x * _fwd.z - _to.z * _fwd.x);
      if (lat < 2.2) return true;
    }
  }
  if (game.player.onFoot) {
    _to.copy(game.player.pos).sub(car.pos);
    const along = _to.dot(_fwd);
    if (along > 0 && along < dist) {
      const lat = Math.abs(_to.x * _fwd.z - _to.z * _fwd.x);
      if (lat < 2.2) return true;
    }
  }
  return false;
}

function updateTraffic(dt) {
  for (const car of game.cars) {
    if (!car.isTraffic || !car.ai) continue;
    const ai = car.ai;

    // at an intersection, sometimes turn onto the crossing street
    const onXLine = Math.abs(car.pos.z - nearestRoadLine(car.pos.z)) < 1.5;
    const onZLine = Math.abs(car.pos.x - nearestRoadLine(car.pos.x)) < 1.5;
    if (onXLine && onZLine && Math.random() < dt * 0.5) {
      if (Math.random() < 0.4) {
        ai.axis = ai.axis === 'x' ? 'z' : 'x';
        ai.dir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    // keep inside the city: force a turn near the edge
    if (ai.axis === 'x' && (car.pos.x < -215 || car.pos.x > 215)) ai.dir *= -1;
    if (ai.axis === 'z' && (car.pos.z < -215 || car.pos.z > 205)) ai.dir *= -1;

    const wantHeading = ai.axis === 'x'
      ? (ai.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (ai.dir > 0 ? 0 : Math.PI);
    let diff = wantHeading - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.heading += THREE.MathUtils.clamp(diff, -1.4 * dt, 1.4 * dt);
    car.steerVisual = THREE.MathUtils.clamp(diff * 0.4, -0.4, 0.4);

    const blocked = obstacleAhead(car, 8);
    const target = blocked ? 0 : ai.cruise;
    car.speed += (target - car.speed) * Math.min(1, dt * 1.5);
    _fwd.set(Math.sin(car.heading), 0, Math.cos(car.heading));
    car.pos.addScaledVector(_fwd, car.speed * dt);
    car.pos.x = THREE.MathUtils.clamp(car.pos.x, -236, 236);
    car.pos.z = THREE.MathUtils.clamp(car.pos.z, -236, 208);
  }
}

// ---------------------------------------------------------------------------
// shared sync + lifecycle
// ---------------------------------------------------------------------------
function syncCarMeshes(dt) {
  for (const car of game.cars) {
    if (!car.group) continue;
    car.group.position.copy(car.pos);
    car.group.position.y = 0;
    car.group.rotation.y = car.heading;
    // wheel spin + steering
    for (const w of car.wheels) {
      w.spin.rotation.x += (car.speed * dt) / 0.36;
      if (w.front) w.steer.rotation.y = car.steerVisual;
    }
    // damage smoke below 30 condition
    if (car.condition < 30) {
      car.smoke.visible = true;
      car.smoke.material.opacity = 0.3 + 0.18 * Math.sin(elapsed * 6 + car.pos.x);
      const s = 1 + 0.25 * Math.sin(elapsed * 5);
      car.smoke.scale.set(s, s * 1.3, s);
    } else {
      car.smoke.visible = false;
    }
  }
}

function init(g) {
  game = g;
  game.peds = peds;

  // mission car: the Zephyr R parked at Marina Verde (mission 1 target)
  spawnCar('zephyr', -180, 180, Math.PI / 2, { isParked: true });
  // other parked cars (stealable)
  const parkedSpots = [
    ['corsair', -150, 92, 0], ['vela', 92, -150, Math.PI / 2],
    ['corsair', 30, 152, 0], ['vela', -92, -30, Math.PI],
    ['corsair', 152, 30, -Math.PI / 2], ['vela', -30, -152, Math.PI / 2],
    ['corsair', 210, -92, 0],
  ];
  for (const [type, x, z, h] of parkedSpots) spawnCar(type, x, z, h, { isParked: true });
  // AI traffic looping the grid
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const type = pick(['corsair', 'vela', 'traffic']);
    const x = pick(ROAD_LINES) + rand(-4, 4);
    const z = pick(ROAD_LINES) + rand(-4, 4);
    spawnCar(type, x, z, rand(0, Math.PI * 2), { isTraffic: true });
  }
  // pedestrians on the sidewalks
  for (let i = 0; i < PED_COUNT; i += 1) spawnPed();
}

function update(dt) {
  if (!game) return;
  elapsed += dt;
  if (game.mode === 'playing' && game.currentCar) updatePlayerCar(dt);
  updateTraffic(dt);
  updatePedestrians(dt);
  syncCarMeshes(dt);
}

export { spawnCar, nearestCar, stealCar };
export default { init, update, spawnCar, nearestCar, stealCar };
