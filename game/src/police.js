// police.js — Slice D: wanted system, patrol pursuit, roadblocks,
// tactical units + police helicopter for VANDARA RUSH.
// State machine: IDLE -> SEARCHING -> PURSUIT -> BUSTED / ESCAPED.
// Patrol cars are built with VR.Vehicles.createCar ('sedan' base) and
// driven with VR.Vehicles.stepCar — this file never re-implements car
// physics. Black-white livery + light bar are added on top of the
// factory car (vehicles.js is NOT edited). Sirens set VR.State.alarm
// so pedestrians panic (Slice B pattern). All cross-module access is
// guarded. No allocations in the hot loop (temp vectors are reused).
(function (VR) {
  'use strict';

  var P = VR.Config ? VR.Config.PALETTE : null;

  // ---------- temp vectors (reused, never allocated per frame) ----------
  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _v3 = new THREE.Vector3();

  // ---------- tuning ----------
  var MAX_UNITS = 4;            // patrol cars at once
  var LOSE_SIGHT_TIME = 6;      // seconds unseen before SEARCHING
  var SEARCH_DECAY_TIME = 9;    // seconds hidden before wanted drops 1
  var BUST_DIST = 2.4;          // touch distance for a bust (on foot)
  var BUST_MAX_SPEED = 2.5;     // player must be slow to be busted
  var REPLAN_TIME = 2.0;        // re-route pursuit units this often
  var BLOCK_REBUILD_TIME = 8;   // re-place roadblock this often
  var TACT_COUNT = 3;           // armed officers at wanted 4-5
  var TACT_HP = 50;
  var TACT_SHOOT_RANGE = 34;
  var TACT_SHOOT_INTERVAL = 1.4;
  var TACT_DAMAGE = 6;

  // ---------- state ----------
  var wanted = 0;
  var state = 'IDLE';
  var units = [];        // patrol cars {car, redMat, blueMat, light, redGlow, blueGlow, phase, waypoints, wp, replanT, cutoff, cruise}
  var roadblocks = [];   // {cars:[car...], x, z, age}
  var tactUnits = [];    // on-foot officers {group, x, z, yaw, hp, shootT, dead, armR, armL, legL, legR, phase}
  var heli = null;       // {group, rotor, tailRotor, cone, pool, light, x, y, z, yaw, sweepT}
  var searchCenter = { x: 0, z: 0 };
  var searchRadius = 0;
  var losTimer = 0;      // seconds since the player was last seen
  var hiddenTimer = 0;   // seconds hidden while SEARCHING
  var endTimer = 0;      // BUSTED/ESCAPED display timer
  var sirenOn = false;
  var lastKnown = { x: 0, z: 0 };
  var roadblockTimer = 0;

  // ---------- helpers ----------
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function std(color, rough, extra) {
    var o = { color: color, roughness: (rough === undefined ? 0.5 : rough),
              metalness: 0.15, flatShading: true };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new THREE.MeshStandardMaterial(o);
  }
  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  // Player position (car wins while driving) + heading + speed.
  function playerPos(out) {
    if (VR.State && VR.State.inCar && VR.State.car) {
      out.x = VR.State.car.x; out.z = VR.State.car.z;
      out.yaw = VR.State.car.yaw; out.speed = Math.abs(VR.State.car.speed || 0);
      return out;
    }
    if (VR.Player && VR.Player.pos) {
      out.x = VR.Player.pos.x; out.z = VR.Player.pos.z;
      out.yaw = VR.Player.yaw || 0; out.speed = VR.Player.speed || 0;
      return out;
    }
    out.x = 0; out.z = 0; out.yaw = 0; out.speed = 0;
    return out;
  }
  var _pp = { x: 0, z: 0, yaw: 0, speed: 0 };

  // Line of sight: sampled walk from A to B; any blocked sample = no LOS.
  function hasLOS(ax, az, bx, bz) {
    if (!VR.World || !VR.World.isBlocked) return true;
    var dx = bx - ax, dz = bz - az;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1) return true;
    var steps = Math.min(40, Math.ceil(d / 4));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (VR.World.isBlocked(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  function anyUnitSeesPlayer() {
    playerPos(_pp);
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.car || u.car.dead) continue;
      var dx = _pp.x - u.car.x, dz = _pp.z - u.car.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < 95 * 95 && hasLOS(u.car.x, u.car.z, _pp.x, _pp.z)) return true;
    }
    if (heli && hasLOS(heli.x, heli.z, _pp.x, _pp.z)) return true;
    return false;
  }

  // ---------- patrol car construction ----------
  // Turn a factory sedan into a black-white patrol car: repaint the body
  // white, add a black roof panel, a red/blue light bar (emissive halves
  // + alternating PointLight + glow sprites), and a door star badge.
  function makePatrolCar(x, z, yaw) {
    if (!VR.Vehicles || !VR.Vehicles.createCar) return null;
    var car = VR.Vehicles.createCar('sedan', x, z, yaw);
    if (!car) return null;
    var white = P ? P.policeWhite : 0xf2f2f2;
    var black = P ? P.policeBlack : 0x111318;

    // Repaint body panels white (skip glass 0x0e2230, dark trim 0x1c1f24,
    // and emissive head/tail lights).
    car.body.traverse(function (m) {
      if (!m.isMesh || !m.material || !m.material.color) return;
      var hex = m.material.color.getHex();
      if (hex === 0x0e2230 || hex === 0x1c1f24) return;
      if (m.material.emissiveIntensity > 1.5) return;
      m.material = m.material.clone();
      m.material.color.setHex(white);
    });

    // Black roof panel + black hood stripe (body space: nose = +x).
    var blackMat = std(black, 0.45);
    car.body.add(box(1.7, 0.07, 1.35, blackMat, -0.35, 1.28, 0));
    car.body.add(box(0.9, 0.05, 1.2, blackMat, 1.55, 0.80, 0));

    // Light bar: dark base + red (left) / blue (right) emissive domes.
    var barBase = std(0x222222, 0.4);
    car.body.add(box(0.42, 0.10, 1.15, barBase, -0.35, 1.38, 0));
    var redMat = std(0xff2a2a, 0.3, { emissive: 0xff1a1a, emissiveIntensity: 2.5 });
    var blueMat = std(0x2a5aff, 0.3, { emissive: 0x2244ff, emissiveIntensity: 2.5 });
    var redDome = box(0.34, 0.16, 0.5, redMat, -0.35, 1.50, 0.30);
    var blueDome = box(0.34, 0.16, 0.5, blueMat, -0.35, 1.50, -0.30);
    car.body.add(redDome);
    car.body.add(blueDome);

    // Alternating red/blue point light above the roof + glow sprites.
    var light = new THREE.PointLight(0xff2222, 2.2, 26, 1.6);
    light.position.set(0, 2.0, 0);
    car.group.add(light);
    var redGlow = null, blueGlow = null;
    if (VR.World && VR.World.makeGlowSprite) {
      // Art pass: wider, softer halo (was 2.6) so the rotators read as
      // light in the air, not a hard dot on the roof.
      redGlow = VR.World.makeGlowSprite(0xff2222, 3.4);
      redGlow.position.set(0, 1.55, 0.55);
      car.group.add(redGlow);
      blueGlow = VR.World.makeGlowSprite(0x3355ff, 3.4);
      blueGlow.position.set(0, 1.55, -0.55);
      car.group.add(blueGlow);
    }

    // Gold star badge on both doors (body space: doors face +/-z).
    var starMat = std(0xffd23f, 0.4, { emissive: 0xffd23f, emissiveIntensity: 0.5 });
    car.body.add(box(0.05, 0.34, 0.34, starMat, 0.15, 0.62, 0.94));
    car.body.add(box(0.05, 0.34, 0.34, starMat, 0.15, 0.62, -0.94));

    car.group.userData.policeUnit = null; // filled below
    var unit = {
      car: car, redMat: redMat, blueMat: blueMat, light: light,
      redGlow: redGlow, blueGlow: blueGlow, phase: Math.random() * Math.PI * 2,
      waypoints: null, wp: 0, replanT: 0, cutoff: false, cruise: 30,
      searchT: 0, searchTarget: { x: 0, z: 0 }
    };
    car.group.userData.policeUnit = unit;
    return unit;
  }

  // Spawn a patrol car on a road 40-70 units from the player, preferring
  // spots in FRONT of / beside the player (inside the camera's view),
  // so the chase cuts the player off instead of only tailing them.
  function spawnUnit() {
    if (!VR.Roads || !VR.Roads.randomRoadPoint) return null;
    playerPos(_pp);
    var fx = Math.sin(_pp.yaw), fz = Math.cos(_pp.yaw);
    var best = null, bestScore = -Infinity;
    for (var t = 0; t < 14; t++) {
      var p = VR.Roads.randomRoadPoint(Math.random);
      if (!p) continue;
      var dx = p.x - _pp.x, dz = p.z - _pp.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 35 || d > 85) continue;
      var ahead = (dx * fx + dz * fz) / d; // +1 = straight ahead
      var score = ahead + Math.random() * 0.4;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) {
      best = VR.Roads.nearestPointOnRoad(_pp.x + fx * 55, _pp.z + fz * 55);
      best = { x: best.x, z: best.z };
    }
    var yaw = Math.atan2(_pp.x - best.x, _pp.z - best.z);
    var unit = makePatrolCar(best.x, best.z, yaw);
    if (unit) units.push(unit);
    return unit;
  }

  function removeUnit(i) {
    var u = units[i];
    if (!u) return;
    if (u.car && u.car.group && u.car.group.parent) u.car.group.parent.remove(u.car.group);
    if (VR.Vehicles && VR.Vehicles.all) {
      var idx = VR.Vehicles.all.indexOf(u.car);
      if (idx >= 0) VR.Vehicles.all.splice(idx, 1);
    }
    units.splice(i, 1);
  }

  function desiredUnitCount() {
    if (wanted <= 0) return 0;
    return Math.min(MAX_UNITS, wanted + 1); // 1->2, 2->3, 3->4, 4-5->4
  }

  function ensureUnits() {
    var want = desiredUnitCount();
    while (units.length < want) if (!spawnUnit()) break;
    while (units.length > want) removeUnit(units.length - 1);
    // Dead / wrecked patrol cars get replaced while the heat is on.
    for (var i = units.length - 1; i >= 0; i--) {
      if (units[i].car && units[i].car.dead) removeUnit(i);
    }
    while (units.length < want) if (!spawnUnit()) break;
  }

  // ---------- pursuit driving ----------
  function planRoute(unit) {
    if (!VR.Roads || !VR.Roads.route) return;
    playerPos(_pp);
    var tx, tz;
    if (unit.cutoff) {
      // Cut-off: aim 26 units AHEAD of the player's heading.
      tx = _pp.x + Math.sin(_pp.yaw) * 26;
      tz = _pp.z + Math.cos(_pp.yaw) * 26;
    } else {
      // Intercept: aim where the player will be in ~1.2s.
      tx = _pp.x + Math.sin(_pp.yaw) * _pp.speed * 1.2;
      tz = _pp.z + Math.cos(_pp.yaw) * _pp.speed * 1.2;
    }
    try { unit.waypoints = VR.Roads.route(unit.car.x, unit.car.z, tx, tz); }
    catch (e) { unit.waypoints = [{ x: tx, z: tz }]; }
    unit.wp = 0;
  }

  function driveUnit(unit, dt) {
    var car = unit.car;
    if (!car || car.dead) return;
    unit.replanT -= dt;
    if (unit.replanT <= 0 || !unit.waypoints || unit.wp >= unit.waypoints.length) {
      unit.replanT = REPLAN_TIME;
      // Alternate chase / cut-off so units attack from the front too.
      unit.cutoff = Math.random() < 0.45;
      planRoute(unit);
    }
    var wp = unit.waypoints ? unit.waypoints[unit.wp] : null;
    if (!wp) { car.throttle = 0; car.brake = 1; car.steerInput = 0; VR.Vehicles.stepCar(car, dt); return; }

    var dx = wp.x - car.x, dz = wp.z - car.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 7) {
      unit.wp++;
      if (unit.wp >= unit.waypoints.length) { planRoute(unit); return; }
      wp = unit.waypoints[unit.wp];
      dx = wp.x - car.x; dz = wp.z - car.z;
      dist = Math.sqrt(dx * dx + dz * dz);
    }

    var desired = Math.atan2(dx, dz);
    var diff = wrapAngle(desired - car.yaw);
    car.steerInput = clamp(diff * 2.0, -1, 1);
    // Faster than the player's cruise so they close the gap; slower in
    // sharp turns so they don't overshoot the corner.
    var targetSpeed = unit.cruise * (Math.abs(diff) > 0.9 ? 0.4 : 1);
    playerPos(_pp);
    var pd = Math.sqrt((_pp.x - car.x) * (_pp.x - car.x) + (_pp.z - car.z) * (_pp.z - car.z));
    // Caught up: hold position around the player instead of driving
    // THROUGH them (the chase waypoint is the player's exact spot).
    if (pd < 9) {
      car.throttle = 0; car.brake = 1; car.steerInput = 0;
      car.handbrake = false; car.nitro = false;
      VR.Vehicles.stepCar(car, dt);
      return;
    }
    if (pd > 55) targetSpeed = unit.cruise * 1.15; // closing speed

    // Keep distance from other patrol cars ahead.
    for (var i = 0; i < units.length; i++) {
      var o = units[i];
      if (o === unit || !o.car || o.car.dead) continue;
      var ox = o.car.x - car.x, oz = o.car.z - car.z;
      var hx = Math.sin(car.yaw), hz = Math.cos(car.yaw);
      var ahead = ox * hx + oz * hz, side = ox * (-hz) + oz * hx;
      if (ahead > 0 && ahead < 10 && Math.abs(side) < 2.6) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 5) * 1.2));
      }
    }

    if (targetSpeed < 0.5) { car.throttle = 0; car.brake = 1; }
    else { car.brake = 0; car.throttle = car.speed < targetSpeed ? 1 : 0.3; }
    car.handbrake = false; car.nitro = false;
    VR.Vehicles.stepCar(car, dt);
  }

  // SEARCHING: wander the search circle instead of beelining the player.
  function searchUnit(unit, dt) {
    var car = unit.car;
    if (!car || car.dead) return;
    unit.searchT -= dt;
    if (unit.searchT <= 0 || !unit.waypoints || unit.wp >= unit.waypoints.length) {
      unit.searchT = rand(4, 7);
      var a = Math.random() * Math.PI * 2;
      var r = Math.random() * searchRadius;
      var tx = searchCenter.x + Math.cos(a) * r;
      var tz = searchCenter.z + Math.sin(a) * r;
      if (VR.Roads && VR.Roads.nearestPointOnRoad) {
        var p = VR.Roads.nearestPointOnRoad(tx, tz);
        tx = p.x; tz = p.z;
      }
      try { unit.waypoints = VR.Roads.route(car.x, car.z, tx, tz); }
      catch (e) { unit.waypoints = [{ x: tx, z: tz }]; }
      unit.wp = 0;
    }
    unit.cruise = 16;
    driveUnit(unit, dt);
  }

  // ---------- roadblocks (wanted >= 3) ----------
  function buildRoadblock() {
    if (!VR.Roads || !VR.Roads.nearestPointOnRoad) return;
    playerPos(_pp);
    var fx = Math.sin(_pp.yaw), fz = Math.cos(_pp.yaw);
    var p = VR.Roads.nearestPointOnRoad(_pp.x + fx * 55, _pp.z + fz * 55);
    var bx = p.x, bz = p.z;
    var roadYaw = Math.atan2(fx, fz); // direction of the road ahead
    var count = wanted >= 4 ? 3 : 2;
    var cars = [];
    for (var i = 0; i < count; i++) {
      // Parked ACROSS the road: lateral offsets, yaw = road + 90 deg.
      var lat = (i - (count - 1) / 2) * 4.2;
      var px = bx + Math.cos(roadYaw) * lat;
      var pz = bz - Math.sin(roadYaw) * lat;
      var u = makePatrolCar(px, pz, roadYaw + Math.PI / 2);
      if (u) { u.car.throttle = 0; u.car.brake = 1; cars.push(u.car); }
    }
    roadblocks.push({ cars: cars, x: bx, z: bz, age: 0 });
  }

  function clearRoadblocks() {
    for (var i = 0; i < roadblocks.length; i++) {
      var rb = roadblocks[i];
      for (var j = 0; j < rb.cars.length; j++) {
        var c = rb.cars[j];
        if (c.group && c.group.parent) c.group.parent.remove(c.group);
        if (VR.Vehicles && VR.Vehicles.all) {
          var idx = VR.Vehicles.all.indexOf(c);
          if (idx >= 0) VR.Vehicles.all.splice(idx, 1);
        }
      }
    }
    roadblocks.length = 0;
  }

  function ensureRoadblocks(dt) {
    if (wanted < 3) { if (roadblocks.length) clearRoadblocks(); return; }
    roadblockTimer -= dt;
    if (!roadblocks.length) { buildRoadblock(); roadblockTimer = BLOCK_REBUILD_TIME; return; }
    var rb = roadblocks[0];
    rb.age += dt;
    playerPos(_pp);
    var dx = _pp.x - rb.x, dz = _pp.z - rb.z;
    // Rebuild ahead of the player if they drove past / far away.
    if (rb.age > BLOCK_REBUILD_TIME || dx * dx + dz * dz > 120 * 120) {
      clearRoadblocks();
      buildRoadblock();
      roadblockTimer = BLOCK_REBUILD_TIME;
    }
  }

  // ---------- tactical units (wanted >= 4, on foot, armed) ----------
  function makeTact(x, z) {
    if (!VR.World || !VR.World.scene) return null;
    var group = new THREE.Group();
    var dark = std(0x1c2530, 0.7);
    var vest = std(0x2e3d4a, 0.75);
    var skin = std(0xc98d64, 0.8);
    var helmet = std(0x111318, 0.5);
    function limbPart(w, h, d, mat, px, py) {
      var pivot = new THREE.Group();
      pivot.position.set(px, py, 0);
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = -h / 2;
      m.castShadow = true;
      pivot.add(m);
      group.add(pivot);
      return pivot;
    }
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.32), vest);
    torso.position.y = 1.12; torso.castShadow = true; group.add(torso);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skin);
    head.position.y = 1.64; head.castShadow = true; group.add(head);
    var helm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.34), helmet);
    helm.position.y = 1.82; group.add(helm);
    var armL = limbPart(0.15, 0.58, 0.16, dark, -0.36, 1.40);
    var armR = limbPart(0.15, 0.58, 0.16, dark, 0.36, 1.40);
    var legL = limbPart(0.19, 0.72, 0.2, dark, -0.13, 0.74);
    var legR = limbPart(0.19, 0.72, 0.2, dark, 0.13, 0.74);
    // Rifle held across the chest (aim pose).
    var gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.85), std(0x111111, 0.4));
    gun.position.set(0.1, 1.25, 0.35); gun.castShadow = true; group.add(gun);
    group.position.set(x, 0, z);
    VR.World.scene.add(group);
    var unit = {
      group: group, x: x, z: z, yaw: 0, hp: TACT_HP, shootT: rand(0.5, 1.5),
      dead: false, armL: armL, armR: armR, legL: legL, legR: legR, phase: 0
    };
    group.userData.tactUnit = unit;
    return unit;
  }

  function spawnTact() {
    if (!VR.Roads || !VR.Roads.randomRoadPoint) return;
    playerPos(_pp);
    var fx = Math.sin(_pp.yaw), fz = Math.cos(_pp.yaw);
    for (var t = 0; t < 10; t++) {
      var p = VR.Roads.randomRoadPoint(Math.random);
      if (!p) continue;
      var dx = p.x - _pp.x, dz = p.z - _pp.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 18 || d > 45) continue;
      var ahead = (dx * fx + dz * fz) / d;
      if (ahead < -0.2) continue; // prefer ahead / beside, not behind
      tactUnits.push(makeTact(p.x, p.z));
      return;
    }
    // Fallback: beside the player on the road.
    var q = VR.Roads.nearestPointOnRoad(_pp.x + 20, _pp.z + 10);
    tactUnits.push(makeTact(q.x, q.z));
  }

  function removeTact(i) {
    var u = tactUnits[i];
    if (!u) return;
    if (u.group && u.group.parent) u.group.parent.remove(u.group);
    tactUnits.splice(i, 1);
  }

  function ensureTact() {
    var want = (wanted >= 4) ? TACT_COUNT : 0;
    while (tactUnits.length < want) spawnTact();
    while (tactUnits.length > want) removeTact(tactUnits.length - 1);
    for (var i = tactUnits.length - 1; i >= 0; i--) {
      if (tactUnits[i].dead) removeTact(i);
    }
    while (tactUnits.length < want) spawnTact();
  }

  function updateTact(unit, dt) {
    if (!unit || unit.dead) return;
    playerPos(_pp);
    var dx = _pp.x - unit.x, dz = _pp.z - unit.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var desired = Math.atan2(dx, dz);
    unit.yaw += wrapAngle(desired - unit.yaw) * Math.min(1, dt * 6);
    unit.group.rotation.y = unit.yaw;
    unit.phase += dt * 8;

    if (d > TACT_SHOOT_RANGE) {
      // Advance toward the player (axis-separated, never through walls).
      var step = 4.6 * dt;
      var nx = unit.x + Math.sin(unit.yaw) * step;
      var nz = unit.z + Math.cos(unit.yaw) * step;
      if (!VR.World || !VR.World.isBlocked || !VR.World.isBlocked(nx, unit.z)) unit.x = nx;
      if (!VR.World || !VR.World.isBlocked || !VR.World.isBlocked(unit.x, nz)) unit.z = nz;
      var swing = Math.sin(unit.phase) * 0.55;
      unit.legL.rotation.x = swing; unit.legR.rotation.x = -swing;
      unit.armL.rotation.x = -swing; unit.armR.rotation.x = swing;
    } else {
      // Hold ground, aim, fire on interval (only with line of sight).
      unit.legL.rotation.x = 0; unit.legR.rotation.x = 0;
      unit.armL.rotation.x = -1.2; unit.armR.rotation.x = -1.2;
      unit.shootT -= dt;
      if (unit.shootT <= 0) {
        unit.shootT = TACT_SHOOT_INTERVAL * rand(0.85, 1.2);
        if (hasLOS(unit.x, unit.z, _pp.x, _pp.z)) {
          // Muzzle at the rifle tip, tracer to the player (with spread).
          _v1.set(unit.x + Math.sin(unit.yaw) * 0.5, 1.3, unit.z + Math.cos(unit.yaw) * 0.5);
          _v2.set(_pp.x + rand(-1.2, 1.2), 1.1 + rand(-0.3, 0.3), _pp.z + rand(-1.2, 1.2));
          if (VR.Effects && VR.Effects.muzzleFlash) VR.Effects.muzzleFlash(_v1, _v2);
          if (VR.Effects && VR.Effects.tracer) VR.Effects.tracer(_v1, _v2);
          if (VR.Audio && VR.Audio.play) VR.Audio.play('shot');
          // Hit chance falls with distance; armour absorbs first.
          var hitChance = clamp(0.55 - d * 0.008, 0.12, 0.55);
          if (Math.random() < hitChance) damagePlayer(TACT_DAMAGE);
        }
      }
    }
    unit.group.position.set(unit.x, 0, unit.z);
  }

  function damagePlayer(n) {
    if (!VR.State) return;
    var remaining = n;
    if (VR.State.armor > 0) {
      var absorbed = Math.min(VR.State.armor, remaining);
      VR.State.armor -= absorbed;
      remaining -= absorbed;
    }
    VR.State.health = Math.max(0, (VR.State.health || 100) - remaining);
    if (VR.Player) { VR.Player.health = VR.State.health; VR.Player.armor = VR.State.armor; }
    if (VR.Effects && VR.Effects.shake) VR.Effects.shake(0.35);
    if (VR.HUD && VR.HUD.showToast) VR.HUD.showToast('Shot by police! -' + n + ' HP');
    if (VR.State.health <= 0) {
      // Down: treated as a bust (arrested at the hospital door).
      doBusted();
    }
  }

  // ---------- helicopter ----------
  function makeHeli() {
    if (!VR.World || !VR.World.scene) return null;
    var group = new THREE.Group();
    var bodyMat = std(0x111318, 0.45);
    var whiteMat = std(0xf2f2f2, 0.45);
    var glassMat = std(0x0e2230, 0.15, { metalness: 0.35 });
    // Fuselage (nose = +z in group space) + white belly stripe.
    var fus = box(2.2, 1.9, 4.6, bodyMat, 0, 0, 0);
    group.add(fus);
    group.add(box(2.24, 0.5, 4.0, whiteMat, 0, -0.55, 0));
    group.add(box(1.7, 1.1, 1.4, glassMat, 0, 0.15, 2.0)); // cockpit glass
    // Tail boom + fin + tail rotor.
    group.add(box(0.55, 0.55, 4.4, bodyMat, 0, 0.35, -4.2));
    group.add(box(0.16, 1.5, 1.0, bodyMat, 0, 0.9, -6.2));
    var tailRotor = new THREE.Group();
    tailRotor.position.set(0.35, 0.5, -6.2);
    var tr1 = box(0.06, 1.7, 0.12, std(0x333333, 0.4), 0, 0, 0);
    var tr2 = box(0.06, 1.7, 0.12, std(0x333333, 0.4), 0, 0, 0);
    tr2.rotation.x = Math.PI / 2;
    tailRotor.add(tr1); tailRotor.add(tr2);
    group.add(tailRotor);
    // Main rotor mast + 2-blade rotor (spins fast).
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 8), std(0x222222, 0.4));
    mast.position.set(0, 1.25, 0);
    group.add(mast);
    var rotor = new THREE.Group();
    rotor.position.set(0, 1.65, 0);
    var b1 = box(0.32, 0.07, 9.6, std(0x222222, 0.4), 0, 0, 0);
    var b2 = box(0.32, 0.07, 9.6, std(0x222222, 0.4), 0, 0, 0);
    b2.rotation.y = Math.PI / 2;
    rotor.add(b1); rotor.add(b2);
    group.add(rotor);
    // Skids.
    group.add(box(0.14, 0.14, 4.2, std(0x333333, 0.4), 0.85, -1.25, 0));
    group.add(box(0.14, 0.14, 4.2, std(0x333333, 0.4), -0.85, -1.25, 0));
    // Red beacon glow + nav lights (art pass: beacon 2.2 -> 2.6).
    if (VR.World.makeGlowSprite) {
      var beacon = VR.World.makeGlowSprite(0xff2222, 2.6);
      beacon.position.set(0, -1.3, 0);
      group.add(beacon);
      var nav = VR.World.makeGlowSprite(0xffffff, 1.6);
      nav.position.set(0, 0.4, 2.6);
      group.add(nav);
    }
    // Spotlight cone (additive, warm white) — apex at the belly, wide
    // end sweeping the asphalt below. ConeGeometry apex is at +y/2.
    var coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    var cone = new THREE.Mesh(new THREE.ConeGeometry(7, 30, 24, 1, true), coneMat);
    cone.position.set(0, -16, 0);
    group.add(cone);
    // Light pool on the asphalt (a bright disc under the beam — this is
    // a light pool, NOT a shadow blob).
    var poolMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var heliLightPool = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24), poolMat);
    heliLightPool.rotation.x = -Math.PI / 2;
    heliLightPool.position.set(0, 0.06, 0);
    heliLightPool.name = 'heliLightPool';
    VR.World.scene.add(heliLightPool);
    // Real spotlight so the beam lights the road.
    var spot = new THREE.SpotLight(0xfff2c0, 900, 70, 0.32, 0.5, 1.2);
    spot.position.set(0, -1, 0);
    group.add(spot);
    group.add(spot.target);
    spot.target.position.set(0, -30, 0);

    playerPos(_pp);
    // 28 units ahead (not 20): at y=17 the elevation from the chase
    // camera is ~26 deg, so the whole helicopter body reads IN frame
    // instead of only its beacon spilling over the top edge.
    var hx = _pp.x + Math.sin(_pp.yaw) * 28;
    var hz = _pp.z + Math.cos(_pp.yaw) * 28;
    group.position.set(hx, 17, hz);
    VR.World.scene.add(group);
    return {
      group: group, rotor: rotor, tailRotor: tailRotor, cone: cone,
      heliLightPool: heliLightPool, spot: spot, spotTarget: spot.target,
      x: hx, y: 17, z: hz, yaw: _pp.yaw, sweepT: 0, rotorAngle: 0
    };
  }

  function ensureHeli() {
    if (wanted >= 4 && !heli) heli = makeHeli();
    else if (wanted < 4 && heli) {
      if (heli.group && heli.group.parent) heli.group.parent.remove(heli.group);
      if (heli.heliLightPool && heli.heliLightPool.parent) heli.heliLightPool.parent.remove(heli.heliLightPool);
      heli = null;
    }
  }

  function updateHeli(dt) {
    if (!heli) return;
    playerPos(_pp);
    // Hover low ahead of / above the chase, tracking the player.
    var fx = Math.sin(_pp.yaw), fz = Math.cos(_pp.yaw);
    var tx = _pp.x + fx * 28, tz = _pp.z + fz * 28;
    heli.x += (tx - heli.x) * Math.min(1, dt * 1.2);
    heli.z += (tz - heli.z) * Math.min(1, dt * 1.2);
    // Low hover (~17) so the helicopter reads IN the chase-camera frame
    // instead of floating above the top edge (DESIGN: "fly low").
    heli.y += (17 + Math.sin(performance.now() * 0.0006) * 1.2 - heli.y) * Math.min(1, dt * 1.5);
    var desired = Math.atan2(_pp.x - heli.x, _pp.z - heli.z);
    heli.yaw += wrapAngle(desired - heli.yaw) * Math.min(1, dt * 2);
    heli.group.position.set(heli.x, heli.y, heli.z);
    heli.group.rotation.y = heli.yaw;
    // Rotors spin fast.
    heli.rotorAngle += dt * 26;
    heli.rotor.rotation.y = heli.rotorAngle;
    heli.tailRotor.rotation.x = heli.rotorAngle * 2.2;
    // Spotlight sweeps the asphalt ahead of the player's car: the cone
    // tilts in a slow circle, the pool follows the beam's ground hit.
    // The cone is scaled so its base always lands on the asphalt
    // (apex at the belly, base at the ground) whatever the hover is.
    heli.sweepT += dt;
    var sweep = Math.sin(heli.sweepT * 0.9) * 0.22;
    var sweepZ = Math.cos(heli.sweepT * 0.7) * 0.18;
    heli.cone.scale.y = Math.max(0.2, heli.y / 30);
    heli.cone.position.y = -heli.y / 2;
    heli.cone.rotation.x = sweepZ;
    heli.cone.rotation.z = sweep;
    heli.spot.target.position.set(Math.sin(sweep) * 12, -heli.y, Math.cos(sweepZ) * 12);
    heli.heliLightPool.position.set(
      heli.x + Math.sin(heli.yaw + sweep) * 10,
      0.06,
      heli.z + Math.cos(heli.yaw + sweep) * 10
    );
    heli.heliLightPool.material.opacity = 0.28 + Math.sin(heli.sweepT * 2.4) * 0.07;
  }

  // ---------- busted / escaped ----------
  function setSiren(on) {
    if (on === sirenOn) return;
    sirenOn = on;
    if (VR.Audio && VR.Audio.setSiren) VR.Audio.setSiren(on);
  }

  function syncState() {
    if (VR.State) VR.State.wanted = wanted;
  }

  function doBusted() {
    if (state === 'BUSTED') return;
    state = 'BUSTED';
    endTimer = 3.5;
    wanted = 0;
    syncState();
    setSiren(false);
    if (VR.State) VR.State.alarm = null;
    // Small fine: 5% of cash, capped at 500 (one path only — Economy
    // owns the balance when it exists, otherwise VR.State.money).
    var fine = 0;
    if (VR.State && VR.State.money > 0) {
      fine = Math.min(500, Math.floor(VR.State.money * 0.05));
      if (VR.Economy && VR.Economy.addMoney) VR.Economy.addMoney(-fine);
      else VR.State.money -= fine;
    }
    if (VR.HUD && VR.HUD.showToast) VR.HUD.showToast('BUSTED! Fine $' + fine + ' — Bramantyo caught you.');
    // Safe respawn: back on foot at the boulevard start, car left behind.
    if (VR.State && VR.State.inCar && VR.Player && VR.Player.exitCar) VR.Player.exitCar();
    if (VR.Player && VR.Player.pos) {
      VR.Player.pos.set(-210, 0, -30);
      VR.Player.yaw = Math.PI / 2;
    }
    if (VR.State) { VR.State.health = 100; }
    if (VR.Player) VR.Player.health = 100;
    clearRoadblocks();
    for (var i = tactUnits.length - 1; i >= 0; i--) removeTact(i);
  }

  function doEscaped() {
    if (state === 'ESCAPED') return;
    state = 'ESCAPED';
    endTimer = 3.5;
    wanted = 0;
    syncState();
    setSiren(false);
    if (VR.State) VR.State.alarm = null;
    if (VR.HUD && VR.HUD.showToast) VR.HUD.showToast('You escaped the police.');
    clearRoadblocks();
  }

  function resetToIdle() {
    state = 'IDLE';
    endTimer = 0;
    wanted = 0;
    syncState();
    setSiren(false);
    if (VR.State) VR.State.alarm = null;
    clearRoadblocks();
    for (var i = tactUnits.length - 1; i >= 0; i--) removeTact(i);
  }

  // ---------- public API ----------
  function addHeat(n) {
    if (state === 'BUSTED' || state === 'ESCAPED') return;
    wanted = clamp(wanted + (n || 1), 0, 5);
    syncState();
    if (wanted > 0 && state === 'IDLE') {
      state = 'PURSUIT';
      losTimer = 0;
      hiddenTimer = 0;
    }
    if (wanted > 0) {
      playerPos(_pp);
      lastKnown.x = _pp.x; lastKnown.z = _pp.z;
    }
  }

  function setWanted(n) {
    wanted = clamp(Math.round(n || 0), 0, 5);
    syncState();
    if (wanted === 0) {
      if (state === 'PURSUIT' || state === 'SEARCHING') doEscaped();
      else resetToIdle();
      return;
    }
    state = 'PURSUIT';
    losTimer = 0;
    hiddenTimer = 0;
    playerPos(_pp);
    lastKnown.x = _pp.x; lastKnown.z = _pp.z;
    searchCenter.x = _pp.x; searchCenter.z = _pp.z;
    searchRadius = 60 + wanted * 10;
  }

  // Crime reports from VR.Combat / Slice E (carjack, collisions, kills).
  var CRIME_HEAT = { shoot: 1, carjack: 1, hitCar: 1, hitPed: 2, killPed: 3, killCop: 3, explosion: 2, steal: 1 };
  function reportCrime(type) {
    var heat = CRIME_HEAT[type];
    if (heat === undefined) heat = 1;
    addHeat(heat);
    playerPos(_pp);
    lastKnown.x = _pp.x; lastKnown.z = _pp.z;
  }

  // Combat calls this when a bullet hits a police target.
  function damageTarget(target, dmg) {
    if (!target) return;
    if (target.kind === 'policeCar' && target.unit && target.unit.car) {
      if (VR.Vehicles && VR.Vehicles.damage) VR.Vehicles.damage(target.unit.car, dmg);
      addHeat(1);
    } else if (target.kind === 'tact' && target.unit) {
      target.unit.hp -= dmg;
      if (target.unit.hp <= 0 && !target.unit.dead) {
        target.unit.dead = true;
        reportCrime('killCop');
      }
    }
  }

  // ---------- update ----------
  function update(dt) {
    if (!VR.State || VR.State.mode !== 'playing') return;
    playerPos(_pp);

    // BUSTED / ESCAPED: countdown, then back to IDLE.
    if (state === 'BUSTED' || state === 'ESCAPED') {
      endTimer -= dt;
      ensureUnits();
      ensureHeli();
      if (endTimer <= 0) resetToIdle();
      return;
    }

    if (wanted <= 0) {
      if (state !== 'IDLE') resetToIdle();
      ensureUnits();
      ensureHeli();
      ensureTact();
      return;
    }

    // Siren + pedestrian panic while the heat is on.
    setSiren(true);
    if (VR.State) VR.State.alarm = { x: _pp.x, z: _pp.z };

    // Line-of-sight tracking.
    var seen = anyUnitSeesPlayer();
    if (seen) {
      losTimer = 0;
      hiddenTimer = 0;
      lastKnown.x = _pp.x; lastKnown.z = _pp.z;
      if (state === 'SEARCHING') state = 'PURSUIT';
    } else {
      losTimer += dt;
      if (state === 'PURSUIT' && losTimer > LOSE_SIGHT_TIME) {
        state = 'SEARCHING';
        searchCenter.x = lastKnown.x; searchCenter.z = lastKnown.z;
        searchRadius = 60 + wanted * 10;
        hiddenTimer = 0;
      }
    }

    if (state === 'SEARCHING') {
      hiddenTimer += dt;
      // Out of the search circle + unseen long enough: heat cools down.
      var sdx = _pp.x - searchCenter.x, sdz = _pp.z - searchCenter.z;
      if (sdx * sdx + sdz * sdz > searchRadius * searchRadius && hiddenTimer > SEARCH_DECAY_TIME) {
        hiddenTimer = 0;
        wanted = Math.max(0, wanted - 1);
        syncState();
        searchRadius = 60 + wanted * 10;
        if (wanted === 0) { doEscaped(); return; }
      }
    }

    ensureUnits();
    ensureRoadblocks(dt);
    ensureTact();
    ensureHeli();

    // Drive the patrol cars (pursuit or search).
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.car || u.car.dead) continue;
      // Rotators: alternate red / blue every ~0.25s.
      u.phase += dt * 12;
      var redOn = Math.sin(u.phase) > 0;
      u.redMat.emissiveIntensity = redOn ? 3.2 : 0.4;
      u.blueMat.emissiveIntensity = redOn ? 0.4 : 3.2;
      if (u.light) u.light.color.setHex(redOn ? 0xff2222 : 0x3355ff);
      if (u.redGlow) u.redGlow.material.opacity = redOn ? 0.95 : 0.15;
      if (u.blueGlow) u.blueGlow.material.opacity = redOn ? 0.15 : 0.95;
      if (state === 'SEARCHING') searchUnit(u, dt);
      else driveUnit(u, dt);
    }

    // Roadblock cars keep their rotators flashing too.
    for (var r = 0; r < roadblocks.length; r++) {
      var rb = roadblocks[r];
      for (var j = 0; j < rb.cars.length; j++) {
        var rc = rb.cars[j];
        if (!rc.group || !rc.group.userData || !rc.group.userData.policeUnit) continue;
        var ru = rc.group.userData.policeUnit;
        ru.phase += dt * 12;
        var rOn = Math.sin(ru.phase) > 0;
        ru.redMat.emissiveIntensity = rOn ? 3.2 : 0.4;
        ru.blueMat.emissiveIntensity = rOn ? 0.4 : 3.2;
        if (ru.light) ru.light.color.setHex(rOn ? 0xff2222 : 0x3355ff);
        if (ru.redGlow) ru.redGlow.material.opacity = rOn ? 0.95 : 0.15;
        if (ru.blueGlow) ru.blueGlow.material.opacity = rOn ? 0.15 : 0.95;
      }
    }

    // Tactical officers advance / shoot.
    for (var t = 0; t < tactUnits.length; t++) updateTact(tactUnits[t], dt);

    // Helicopter follows the chase.
    updateHeli(dt);

    // BUSTED: a patrol car touches the player on foot while they are slow.
    if (!VR.State.inCar) {
      for (var b = 0; b < units.length; b++) {
        var bu = units[b];
        if (!bu.car || bu.car.dead) continue;
        var bdx = _pp.x - bu.car.x, bdz = _pp.z - bu.car.z;
        if (bdx * bdx + bdz * bdz < BUST_DIST * BUST_DIST && _pp.speed < BUST_MAX_SPEED) {
          doBusted();
          return;
        }
      }
    } else if (VR.State.car) {
      // Ramming the player's car at speed: small damage + slow-down.
      for (var c = 0; c < units.length; c++) {
        var cu = units[c];
        if (!cu.car || cu.car.dead) continue;
        var cdx = _pp.x - cu.car.x, cdz = _pp.z - cu.car.z;
        var cd2 = cdx * cdx + cdz * cdz;
        if (cd2 < 6.5 && cd2 > 0.01) {
          var cd = Math.sqrt(cd2);
          var push = (2.6 - cd) * 0.4;
          VR.State.car.speed *= 0.86;
          cu.car.speed *= 0.9;
          // Push the player's car AWAY from the police car (along the
          // police->player direction).
          _v1.set(cdx / cd * push, 0, cdz / cd * push);
          VR.State.car.x += _v1.x; VR.State.car.z += _v1.z;
        }
      }
    }
  }

  VR.Police = {
    get wanted() { return wanted; },
    set wanted(v) { wanted = clamp(Math.round(v || 0), 0, 5); syncState(); },
    get state() { return state; },
    units: units,
    roadblocks: roadblocks,
    tactUnits: tactUnits,
    get heli() { return heli; },
    get searchRadius() { return searchRadius; },
    get searchCenter() { return searchCenter; },
    get lastKnown() { return lastKnown; },
    addHeat: addHeat,
    setWanted: setWanted,
    reportCrime: reportCrime,
    damageTarget: damageTarget,
    update: update
  };

})(window.VR = window.VR || {});
