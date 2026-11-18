// SOLARA BAY — vehicles + traffic + pedestrians (W2).
// Arcade car physics, player driving (incl. nitro + handbrake drift),
// AI traffic on the street grid, parked stealable cars, sidewalk peds.
import * as THREE from 'three';
import { CARS, CITY } from './config.js';

const ROAD_LINES = [-222, -148, -74, 0, 74, 148, 222]; // street centre lines (world.js STREETS)
const CITY_HALF = 238;
const BEACH_Z = 210;
const TRAFFIC_COUNT = 16;
const PARKED_COUNT = 10;
const PED_COUNT = 26;
const PED_SHIRTS = [0xff7a2e, 0x2ec4ff, 0xffc93c, 0x9a6bff, 0xe85d75, 0x3ddc97, 0xf2f2f2, 0xff5a5a, 0x2ee6a8, 0xff9ff3, 0x54a0ff, 0xfd9644];
const PED_PANTS = [0x2b3242, 0x3a5a8c, 0x8a7a5a, 0x222222, 0x5a3a2a, 0xdddddd, 0x7a4a6b];
const PED_SKINS = [0xd9a066, 0x8d5524, 0xf1c27d, 0xc68642, 0xffdbac, 0x6b4226];
const PED_HATS = [0xff2e63, 0x2ec4ff, 0xffc93c, 0xf2f2f2, 0x222831, 0xe8d5a3];

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
// Low-poly stacked-box bodies + one extruded supercar wedge (v3.2, user spec
// 17:32): the sports cars are a sloped ExtrudeGeometry profile, never a box.
function bx(group, w, h, d, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.castShadow = true;
  group.add(m);
  return m;
}

// Side-profile extrusion: points are [length, height] in the car's side view
// (front = +X in shape space); the result is rotated so length lies along +Z
// (car forward) and the extrusion depth becomes the car width, centred.
function extrudeProfile(points, depth, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// The Zephyr's own identity: bright teal metallic — not HALCYON's pink.
const ZEPHYR_COLOR = 0x00d9c0;
const TRAFFIC_COLORS = [0xe8e8e8, 0xd94f30, 0x3f7fbf, 0x4caf7d, 0xff8c1a, 0x8e44ad, 0x9aa5b1, 0x2b2b2b, 0xc0c0c0, 0x2288aa];
const TAXI_YELLOW = 0xffc93c;

function buildCarMesh(type, color) {
  const group = new THREE.Group();
  const isPolice = type === 'police';
  // Body kind: sports / sedan / taxi / suv / muscle / police — clearly
  // different silhouettes.
  let kind;
  if (type === 'zephyr' || type === 'vela') kind = 'sports';
  else if (type === 'corsair') kind = 'sedan';
  else if (isPolice) kind = 'police';
  else kind = pick(['sedan', 'taxi', 'suv', 'muscle']); // generic traffic

  const bodyColor = kind === 'taxi' ? TAXI_YELLOW : color;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: kind === 'sports' ? 0.3 : 0.35, metalness: kind === 'sports' ? 0.45 : 0.6,
  });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1620, roughness: 0.15, metalness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35, metalness: 0.5 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.2, metalness: 0.95 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.5, metalness: 0.1 });

  // headlights (emissive; the real SpotLight is only on the player's car, at night)
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 1.6,
  });
  // brake lights (emissive intensity driven in update)
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x881111, emissive: 0xff2222, emissiveIntensity: 0.4,
  });

  if (kind === 'sports') {
    // EXOTIC WIDE-BODY SUPERCAR (user spec 17:32): extruded wedge profile +
    // sloped glass canopy, clearcoat paint — NOT a box stack.
    const paintMat = new THREE.MeshPhysicalMaterial({
      color: bodyColor, metalness: 0.78, roughness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1620, metalness: 0.2, roughness: 0.08, clearcoat: 1.0, clearcoatRoughness: 0.05,
    });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.35, metalness: 0.4 });
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3.2,
    });
    // low wedge body (ground clearance ceper) + sloped glass cockpit
    group.add(extrudeProfile([
      [-2.15, 0.30], [-2.15, 0.72], [-0.90, 0.78], [0.55, 0.80],
      [1.55, 0.62], [2.15, 0.42], [2.15, 0.26], [-2.00, 0.25],
    ], 1.86, paintMat));
    group.add(extrudeProfile([
      [-1.30, 0.78], [-0.95, 1.06], [0.30, 1.04], [0.80, 0.78],
    ], 1.45, canopyMat));
    // widebody overfenders on all 4 wheels
    for (const [fx, fz] of [[-1.00, 1.35], [1.00, 1.35], [-1.00, -1.35], [1.00, -1.35]]) {
      bx(group, 0.30, 0.16, 1.05, paintMat, fx, 0.86, fz);
    }
    // side skirts between the arches
    bx(group, 0.06, 0.12, 1.70, darkMat, -0.98, 0.26, 0);
    bx(group, 0.06, 0.12, 1.70, darkMat, 0.98, 0.26, 0);
    // front splitter + slim white LED headlights on the nose face
    bx(group, 1.86, 0.12, 0.18, darkMat, 0, 0.22, 2.10);
    for (const sx of [-0.55, 0.55]) {
      bx(group, 0.50, 0.07, 0.06, ledMat, sx, 0.34, 2.17);
    }
    // rear diffuser with fins (the rear bumper)
    bx(group, 1.70, 0.16, 0.28, darkMat, 0, 0.30, -2.14);
    for (const fx of [-0.6, -0.2, 0.2, 0.6]) {
      bx(group, 0.04, 0.18, 0.26, darkMat, fx, 0.30, -2.20);
    }
    // tall carbon spoiler
    bx(group, 0.08, 0.35, 0.08, carbonMat, -0.75, 1.02, -2.00);
    bx(group, 0.08, 0.35, 0.08, carbonMat, 0.75, 1.02, -2.00);
    bx(group, 2.30, 0.07, 0.45, carbonMat, 0, 1.26, -2.02);
    bx(group, 0.05, 0.24, 0.45, carbonMat, -1.13, 1.26, -2.02);
    bx(group, 0.05, 0.24, 0.45, carbonMat, 1.13, 1.26, -2.02);
    // full-width red LED tail bar + plate + twin exhausts
    bx(group, 1.80, 0.12, 0.06, brakeMat, 0, 0.64, -2.16);
    bx(group, 0.55, 0.20, 0.04, plateMat, 0, 0.46, -2.17);
    for (const sx of [-0.45, 0.45]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10), chromeMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx, 0.32, -2.20);
      group.add(ex);
    }
  } else if (kind === 'suv') {
    // tall 4x4 stance: high body, big glasshouse, roof rails, big wheels
    bx(group, 2.05, 0.80, 4.40, bodyMat, 0, 0.78, 0);
    bx(group, 1.95, 0.12, 1.00, bodyMat, 0, 1.20, 1.50);
    bx(group, 1.75, 0.62, 2.40, glassMat, 0, 1.48, -0.20);
    bx(group, 1.65, 0.06, 2.00, bodyMat, 0, 1.80, -0.20);
    bx(group, 0.08, 0.07, 2.10, darkMat, -0.62, 1.86, -0.20);
    bx(group, 0.08, 0.07, 2.10, darkMat, 0.62, 1.86, -0.20);
    bx(group, 0.10, 0.10, 3.40, darkMat, -1.02, 0.42, 0); // side steps
    bx(group, 0.10, 0.10, 3.40, darkMat, 1.02, 0.42, 0);
    bx(group, 2.05, 0.20, 0.22, darkMat, 0, 0.40, 2.20);
    bx(group, 2.05, 0.20, 0.22, darkMat, 0, 0.40, -2.20);
    for (const sx of [-0.65, 0.65]) {
      bx(group, 0.46, 0.16, 0.06, headMat, sx, 0.85, 2.22);
      bx(group, 0.46, 0.16, 0.06, brakeMat, sx, 0.85, -2.22);
    }
    bx(group, 0.55, 0.20, 0.04, plateMat, 0, 0.55, -2.24);
    for (const sx of [-0.5, 0.5]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), darkMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx, 0.35, -2.28);
      group.add(ex);
    }
  } else if (kind === 'muscle') {
    // long hood, set-back cabin, hood scoop, round lamps, lip spoiler
    bx(group, 2.00, 0.55, 4.50, bodyMat, 0, 0.62, 0);
    bx(group, 1.90, 0.14, 1.70, bodyMat, 0, 0.86, 1.15, 0.10);
    bx(group, 0.70, 0.12, 0.90, bodyMat, 0, 0.97, 1.05); // hood scoop
    bx(group, 1.60, 0.50, 1.70, glassMat, 0, 1.12, -0.65);
    bx(group, 1.50, 0.06, 1.20, bodyMat, 0, 1.39, -0.65);
    bx(group, 1.90, 0.12, 0.80, bodyMat, 0, 0.88, -1.70);
    bx(group, 1.90, 0.06, 0.25, darkMat, 0, 0.96, -2.15); // lip spoiler
    bx(group, 2.00, 0.18, 0.20, chromeMat, 0, 0.35, 2.24); // chrome bumpers
    bx(group, 2.00, 0.18, 0.20, chromeMat, 0, 0.35, -2.24);
    bx(group, 1.20, 0.10, 0.05, darkMat, 0, 0.62, 2.26); // grille
    for (const sx of [-0.62, 0.62]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16), headMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, 0.68, 2.27);
      group.add(lamp);
      bx(group, 0.50, 0.16, 0.06, brakeMat, sx, 0.68, -2.27);
    }
    bx(group, 0.55, 0.20, 0.04, plateMat, 0, 0.55, -2.28);
    for (const sx of [-0.55, 0.55]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 10), chromeMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx, 0.30, -2.30);
      group.add(ex);
    }
  } else {
    // sedan shell shared by sedan / taxi / police: taller body + tall cabin
    const cabinMat = isPolice ? whiteMat : glassMat;
    const roofMat = isPolice ? whiteMat : bodyMat;
    bx(group, 2.00, 0.58, 4.30, bodyMat, 0, 0.60, 0);
    bx(group, 1.90, 0.12, 1.10, bodyMat, 0, 0.90, 1.40);
    bx(group, 1.90, 0.14, 0.90, bodyMat, 0, 0.90, -1.55);
    bx(group, 1.68, 0.55, 2.00, cabinMat, 0, 1.16, -0.20);
    bx(group, 1.60, 0.06, 1.50, roofMat, 0, 1.45, -0.20);
    bx(group, 2.00, 0.20, 0.22, darkMat, 0, 0.30, 2.12);
    bx(group, 2.00, 0.20, 0.22, darkMat, 0, 0.30, -2.12);
    bx(group, 1.20, 0.10, 0.05, darkMat, 0, 0.58, 2.16);
    for (const sx of [-0.65, 0.65]) {
      bx(group, 0.50, 0.16, 0.06, headMat, sx, 0.66, 2.17);
      bx(group, 0.50, 0.16, 0.06, brakeMat, sx, 0.66, -2.17);
    }
    bx(group, 0.55, 0.20, 0.04, plateMat, 0, 0.52, -2.18);
    for (const sx of [-0.55, 0.55]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), darkMat);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(sx, 0.28, -2.20);
      group.add(ex);
    }
    if (kind === 'taxi') {
      // checker band down both flanks + glowing roof sign
      for (let i = 0; i < 7; i += 1) {
        const z = -1.5 + i * 0.5;
        const m = i % 2 === 0 ? darkMat : whiteMat;
        bx(group, 0.04, 0.16, 0.46, m, -1.01, 0.78, z);
        bx(group, 0.04, 0.16, 0.46, m, 1.01, 0.78, z);
      }
      const signMat = new THREE.MeshStandardMaterial({
        color: 0xfff2b0, emissive: 0xffdf5e, emissiveIntensity: 1.4,
      });
      bx(group, 0.70, 0.16, 0.30, signMat, 0, 1.56, -0.20);
    }
    if (isPolice) {
      // black-and-white doors + big red/blue light bar on the roof
      bx(group, 2.02, 0.32, 2.30, whiteMat, 0, 0.62, -0.10);
      bx(group, 1.30, 0.10, 0.40, darkMat, 0, 1.52, -0.20);
      const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, emissive: 0xff1122, emissiveIntensity: 2.2 });
      const blueMat = new THREE.MeshStandardMaterial({ color: 0x2244cc, emissive: 0x2244ff, emissiveIntensity: 2.2 });
      bx(group, 0.55, 0.18, 0.42, redMat, -0.33, 1.60, -0.20);
      bx(group, 0.55, 0.18, 0.42, blueMat, 0.33, 1.60, -0.20);
    }
  }

  // wheels: steer group (front) > spin group > tyre + rim + spokes + brakes
  const wheels = [];
  const wheelR = kind === 'sports' ? 0.46 : kind === 'suv' ? 0.46 : kind === 'muscle' ? 0.42 : 0.38;
  const trackX = kind === 'sports' ? 1.02 : kind === 'suv' || kind === 'muscle' ? 1.00 : 0.95;
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1122, roughness: 0.4, metalness: 0.6 });
  for (const [wx, wz, front] of [[-trackX, 1.35, true], [trackX, 1.35, true], [-trackX, -1.35, false], [trackX, -1.35, false]]) {
    const steer = new THREE.Group();
    steer.position.set(wx, wheelR, wz);
    const spin = new THREE.Group();
    if (kind === 'sports') {
      // wide torus tyre + chrome rim ring + 5 multi-spokes + red brake disc
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.14, 10, 20), darkMat);
      tyre.rotation.y = Math.PI / 2;
      tyre.castShadow = true;
      spin.add(tyre);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.04, 8, 20), chromeMat);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = 0.05;
      spin.add(rim);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 20), redMat);
      disc.rotation.z = Math.PI / 2;
      spin.add(disc);
      for (let k = 0; k < 5; k += 1) {
        const pivot = new THREE.Group();
        pivot.rotation.x = (k / 5) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.09), chromeMat);
        spoke.position.set(0.05, 0.14, 0);
        pivot.add(spoke);
        spin.add(pivot);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), darkMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.x = 0.05;
      spin.add(hub);
      // red brake caliper, fixed to the steer group so it never spins
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.20, 0.12), redMat);
      caliper.position.set(0, 0.10, -0.14);
      steer.add(caliper);
    } else {
      const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 16);
      const tyre = new THREE.Mesh(wheelGeo, darkMat);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      spin.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, 0.30, 16), chromeMat);
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.22, wheelR * 0.22, 0.32, 10), darkMat);
      cap.rotation.z = Math.PI / 2;
      spin.add(cap);
    }
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

  // nitro flame (hidden unless boosting) — orange cone + blue core, so a
  // nitro burst reads orange-blue. The core is a child: it inherits the
  // flame's visibility + scale.
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.75 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.45, -2.5);
  flame.visible = false;
  group.add(flame);
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 1.0, 8),
    new THREE.MeshBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.95 }),
  );
  flameCore.position.y = 0.30;
  flame.add(flameCore);

  // blue backfire flames at the twin exhausts (hidden unless braking at
  // speed; driven from updatePlayerCar via the group's name — no new state)
  const blueFlame = new THREE.Group();
  blueFlame.name = 'blueFlame';
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.9 });
  for (const sx of [-0.5, 0.5]) {
    const bf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 8), blueMat);
    bf.rotation.x = -Math.PI / 2;
    bf.position.set(sx, 0.30, -2.45);
    blueFlame.add(bf);
  }
  blueFlame.visible = false;
  group.add(blueFlame);

  // thick white tyre smoke while drifting (hidden unless drifting; driven
  // from updatePlayerCar via the group's name — no new state)
  const driftSmoke = new THREE.Group();
  driftSmoke.name = 'driftSmoke';
  const driftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false,
  });
  for (const sx of [-trackX, trackX]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), driftMat);
    puff.position.set(sx, 0.40, -1.60);
    driftSmoke.add(puff);
  }
  driftSmoke.visible = false;
  group.add(driftSmoke);

  return { group, wheels, brakeMat, smoke, flame };
}

function spawnCar(type, x, z, heading, opts = {}) {
  const spec = CARS[type] || null;
  // Zephyr: own teal-metallic identity (not HALCYON pink). Traffic: real
  // palette — the old fallback read spec.color off the CARS.traffic array,
  // which is undefined, so every traffic car rendered white.
  let color = opts.color;
  if (color === undefined) {
    if (type === 'zephyr') color = ZEPHYR_COLOR;
    else if (type === 'traffic') color = pick(TRAFFIC_COLORS);
    else color = spec ? spec.color : pick(TRAFFIC_COLORS);
  }
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
function buildPedMesh(shirt, pants, skin, height, hat, hatColor) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.62, 6, 10),
    shirtMat,
  );
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 14, 10),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }),
  );
  head.position.y = 1.66;
  g.add(head);
  // arms, angled slightly out from the body
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.52, 0.09), shirtMat);
    arm.position.set(sx * 0.36, 1.12, 0);
    arm.rotation.z = -sx * 0.12;
    g.add(arm);
  }
  // hat: baseball cap or wide beach hat
  if (hat === 'cap' || hat === 'beach') {
    const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.9 });
    if (hat === 'cap') {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.10, 12), hatMat);
      cap.position.y = 1.83;
      g.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.03, 0.18), hatMat);
      brim.position.set(0, 1.79, 0.20);
      g.add(brim);
    } else {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), hatMat);
      brim.position.y = 1.84;
      g.add(brim);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 8), hatMat);
      dome.scale.y = 0.6;
      dome.position.y = 1.86;
      g.add(dome);
    }
  }
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const legL = new THREE.Group();
  legL.position.set(-0.14, 0.68, 0);
  const ll = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.66, 0.14), pantsMat);
  ll.position.y = -0.33;
  legL.add(ll);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  g.scale.setScalar(height);
  return { group: g, legL, legR };
}

function sidewalkPoint() {
  // on a sidewalk: just off a road line, inside the city. Busy areas
  // (Coral Row / Palm Court, the central grid) get most of the foot traffic.
  const busy = Math.random() < 0.55;
  const lines = busy ? [-90, -30, 30, 90] : ROAD_LINES;
  const line = pick(lines);
  const off = pick([-1, 1]) * (CITY.street / 2 + 2);
  const range = busy ? [-180, 180] : [-220, 220];
  if (Math.random() < 0.5) return new THREE.Vector3(rand(range[0], range[1]), 0, line + off);
  return new THREE.Vector3(line + off, 0, rand(range[0], range[1]));
}

function spawnPed() {
  const hatRoll = Math.random();
  const hat = hatRoll < 0.18 ? 'cap' : hatRoll < 0.30 ? 'beach' : null;
  const built = buildPedMesh(
    pick(PED_SHIRTS), pick(PED_PANTS), pick(PED_SKINS), rand(0.88, 1.12), hat, pick(PED_HATS),
  );
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

  // blue backfire flames at the twin exhausts (braking at speed) + thick
  // white tyre smoke while drifting — both driven by existing state only
  // (braking keys, speed, the drifting flag above). No new game state.
  const backfire = car.group.getObjectByName('blueFlame');
  if (backfire) {
    backfire.visible = braking && car.speed > 8;
    if (backfire.visible) backfire.scale.set(1, 1, rand(0.7, 1.3));
  }
  const driftSmoke = car.group.getObjectByName('driftSmoke');
  if (driftSmoke) {
    driftSmoke.visible = drifting;
    if (drifting) {
      const s = 1.15 + 0.25 * Math.sin(elapsed * 9);
      driftSmoke.scale.set(s, s, s);
    }
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
    ['vela', 210, 92, Math.PI], ['corsair', -210, -30, 0], ['vela', 92, 210, -Math.PI / 2],
  ];
  for (const [type, x, z, h] of parkedSpots) spawnCar(type, x, z, h, { isParked: true });
  // AI traffic looping the grid
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const type = pick(['corsair', 'vela', 'traffic', 'traffic']);
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
