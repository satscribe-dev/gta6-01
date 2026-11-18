// shots.js — Slice F: deterministic ?shot= staging for VANDARA RUSH.
//
// Open game/index.html?shot=cover|night|combat|map and the game boots
// straight into a composed, live frame for that screenshot — no clicks,
// no keys. The staging runs once, on the first animation frame after
// main.js has built VR.State (this file loads before main.js, so it
// polls for the boot with requestAnimationFrame).
//
// Rules this file lives by:
//  * It never touches window.__gameReady (main.js owns that, set after
//    the first rendered frame).
//  * It sets window.__shotReady ONLY when the frame is final: the
//    dialogue typewriter has finished (VR.HUD.dialogueComplete), the
//    chase / fight is actually in frame (phase + helicopter + pinned
//    police units), never on a fixed timer alone.
//  * Driving shots steer the hero car through VR.Vehicles.stepCar with
//    real throttle / steer / handbrake / nitro flags — the tyre smoke
//    and exhaust flames come out of the normal vehicle code, not from
//    a frozen pose. A small yaw-hold controller keeps the car at a
//    steady drift angle instead of spinning.
//  * The in-car camera is re-aimed after VR.Player.update each frame:
//    low (2.7), close (7.6 back), offset to the east-behind side so
//    the frame reads as a rear three-quarter of a sports car — and so
//    the sea stays on the right of the frame while the gold mission
//    pillar stays on the left.
//  * Police units are pinned to fixed slots ahead of the hero car
//    (20 / 30 units) every staging tick, so the required two patrol
//    cars are guaranteed in frame instead of hoping the pursuit AI
//    happens to close in during SwiftShader's ~1 fps.
//  * No ?shot= parameter (or an unknown one) means no staging at all:
//    the game boots to the title screen exactly as before.
(function (VR) {
  'use strict';

  var qs = new URLSearchParams(window.location.search);
  var shot = qs.get('shot') || '';
  var KNOWN = { cover: true, night: true, combat: true, map: true };

  var staged = false;
  var shotReady = false;
  var heroCar = null;      // driving shots only
  var baseYaw = 0;         // road direction the hero car starts on
  var gameT = 0;           // game-seconds accumulated by driveStep
  var phase = 0;           // 0 build speed, 1 drift, 2 hold the pose
  var phaseT = 0;
  var buildLen = 1.1;      // game-seconds of straight-line build
  var driftLen = 1.0;      // game-seconds of held drift
  var wantedAt = -1;       // gameT at which to raise the heat to 4
  var wantedSet = false;
  var shotsFired = 0;
  var stageRealAt = 0;
  var mapOpen = false;
  var mapFrames = 0;

  var vehWrapped = false;
  var playerWrapped = false;
  var _camLook = null;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function hideTitleCard() {
    var el = document.getElementById('title-card');
    if (el) el.style.display = 'none';
  }

  // ---- shared staging steps ----
  function enterPlay() {
    hideTitleCard();
    if (VR.Menus) VR.Menus.hideAll();
    VR.State.mode = 'playing';
    VR.State.health = 100;
    if (VR.Player) VR.Player.health = 100;
  }

  function setClock(minutes, night) {
    VR.State.timeMinutes = minutes;
    VR.State.night = !!night;
    if (VR.World && VR.World.setTimeOfDay) VR.World.setTimeOfDay(minutes);
  }

  // Pick a clear spawn on the road: step south in 15-unit hops until no
  // traffic car or existing vehicle is within 9 units.
  function clearSpawn(x, z0) {
    var z = z0;
    for (var t = 0; t < 8; t++) {
      var ok = true;
      var lists = [];
      if (VR.Traffic && VR.Traffic.cars) lists.push(VR.Traffic.cars);
      if (VR.Vehicles && VR.Vehicles.all) lists.push(VR.Vehicles.all);
      for (var li = 0; li < lists.length && ok; li++) {
        var list = lists[li];
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (!c) continue;
          var cx = (typeof c.x === 'number') ? c.x : (c.group ? c.group.position.x : 0);
          var cz = (typeof c.z === 'number') ? c.z : (c.group ? c.group.position.z : 0);
          var dx = cx - x, dz = cz - z;
          if (dx * dx + dz * dz < 81) { ok = false; break; }
        }
      }
      if (ok) return z;
      z += 15;
    }
    return z;
  }

  function makeHero(x, z, yaw) {
    var car = VR.Vehicles.createCar('sport', x, z, yaw);
    VR.Player.pos.set(x, 0, z);
    VR.Player.yaw = yaw;
    VR.Player.enterCar(car);
    heroCar = car;
    baseYaw = yaw;
    return car;
  }

  // ---- driving: one real physics step per game step, with staging flags ----
  function driveStep(dt) {
    gameT += dt;
    phaseT += dt;
    var car = heroCar;
    if (!car || car.dead) return;
    if (phase === 0) {
      car.throttle = 1; car.nitro = true; car.handbrake = false; car.steerInput = 0;
      if (phaseT >= buildLen) { phase = 1; phaseT = 0; }
    } else {
      // Drift + hold: handbrake + nitro, yaw held ~11 degrees off the
      // road (nose toward the sea) by a proportional steer controller.
      // stepCar turns these flags into real tyre smoke (handbrake at
      // speed) and exhaust flames (nitro) by itself.
      var desired = baseYaw - 0.2;
      var err = wrapAngle(desired - car.yaw);
      car.throttle = 0.5; car.nitro = true; car.handbrake = true;
      car.steerInput = clamp(err * 2.0, -0.45, 0.45);
      if (phase === 1 && phaseT >= driftLen) { phase = 2; phaseT = 0; }
    }
    VR.Vehicles.stepCar(car, dt);
    if (VR.State) {
      VR.State.nitroActive = car.nitroActive;
      VR.State.speedKmh = Math.abs(car.speed) * 3.6;
    }
    // Raise the heat once the car is rolling. Cover waits until the
    // drift starts so the roadblock lands far ahead of the final pose;
    // night raises it immediately so the roadblock sits close ahead.
    if (!wantedSet && wantedAt >= 0 && gameT >= wantedAt) {
      wantedSet = true;
      if (VR.Police && VR.Police.setWanted) VR.Police.setWanted(4);
    }
  }

  function installDriveWrappers() {
    if (!vehWrapped && VR.Vehicles) {
      vehWrapped = true;
      var origVehUpdate = VR.Vehicles.update;
      VR.Vehicles.update = function (dt) {
        if (heroCar && (shot === 'cover' || shot === 'night')) {
          // Stock update drives the player car from the (empty) keyboard.
          // Park the hero car out of its way for one call, then step it
          // ourselves with the staging flags — exactly one step per
          // game step, never double-stepped.
          var saved = VR.Vehicles.playerCar;
          VR.Vehicles.playerCar = null;
          origVehUpdate(dt);
          VR.Vehicles.playerCar = saved;
          driveStep(dt);
        } else {
          origVehUpdate(dt);
        }
      };
    }
    if (!playerWrapped && VR.Player && VR.World && VR.World.camera) {
      playerWrapped = true;
      var origPlayerUpdate = VR.Player.update;
      _camLook = new THREE.Vector3();
      VR.Player.update = function (dt) {
        origPlayerUpdate(dt);
        if (heroCar && VR.State && VR.State.inCar) {
          var car = heroCar, cam = VR.World.camera;
          if (!car || !car.group || !cam) return;
          var cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
          // Car's right flank (-cos yaw, sin yaw) points west while
          // southbound; negating it offsets the camera east-behind.
          var rx = -cy, rz = sy;
          // Art pass (18 Nov): farther back + higher than the old
          // 7.6 / 2.7 — at the old framing the hero car was half-cropped
          // by the bottom edge (shot 02, 19:35). Now the whole car sits
          // in the lower frame with sky + towers + sea across the top.
          cam.position.set(
            car.group.position.x - sy * 9.2 - rx * 3.4,
            3.6,
            car.group.position.z - cy * 9.2 - rz * 3.4
          );
          _camLook.set(
            car.group.position.x + sy * 8,
            // Look slightly up (was 1.25): the police helicopter hovers
            // ~27 deg above the chase view, and at the old aim its body
            // was cut by the top edge of the frame.
            3.0,
            car.group.position.z + cy * 8
          );
          cam.lookAt(_camLook);
        }
      };
    }
  }

  // ---- police pinning: keep two patrol cars in fixed slots ahead ----
  function pinPolice(px, pz, yaw, speed) {
    if (!VR.Police || !VR.Police.units) return 0;
    var units = VR.Police.units;
    var n = 0;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    var rx = -Math.cos(yaw), rz = Math.sin(yaw);
    for (var i = 0; i < units.length && i < 2; i++) {
      var u = units[i];
      if (!u || !u.car || u.car.dead) continue;
      var ahead = 16 + i * 10;
      var lat = (i === 0 ? -3 : 3);
      var tx = px + fx * ahead + rx * lat;
      var tz = pz + fz * ahead + rz * lat;
      u.car.x = tx; u.car.z = tz;
      u.car.yaw = yaw;
      u.car.speed = speed;
      u.car.group.position.set(tx, 0, tz);
      u.car.group.rotation.y = yaw;
      u.waypoints = null; // pursuit AI replans; the pin re-asserts next tick
      n++;
    }
    return n;
  }

  // ---- pedestrian pinning: keep a few walkers on the sidewalk next
  // to the action (boardwalk for cover, market sidewalk for night) ----
  function pinPeds(px, pz, yaw) {
    if (!VR.Peds || !VR.Peds.list) return;
    var list = VR.Peds.list;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    var rx = -Math.cos(yaw), rz = Math.sin(yaw);
    var placed = 0;
    for (var i = 0; i < list.length && placed < 4; i++) {
      var p = list[i];
      if (!p || !p.group) continue;
      var ahead = 12 + placed * 8;
      // Lateral +14.5 along the car's right flank = the west sidewalk
      // (boardwalk side on the boulevard, market sidewalk at night).
      var tx = px + fx * ahead + rx * 14.5;
      var tz = pz + fz * ahead + rz * 14.5;
      p.x = tx; p.z = tz; p.tx = tx; p.tz = tz;
      p.group.position.set(tx, 0, tz);
      p.group.rotation.y = yaw + (placed % 2 === 0 ? 0.3 : -0.3);
      placed++;
    }
  }

  // ---- per-shot staging ----
  function stageCover() {
    enterPlay();
    setClock(18 * 60 + 52, false);
    buildLen = 1.1; driftLen = 1.0;
    wantedAt = 1.1; // heat at drift start: roadblock lands far ahead
    var z = clearSpawn(-210, -70); // far north: beacon 24 deg off-axis
    makeHero(-210, z, 0);          // southbound on the Golden Pier boulevard
    if (VR.Missions) {
      VR.Missions.start(0);            // First Delivery
      VR.Missions.completeObjective(); // objective 1: Pasar Lentera (-90, 210)
    }
    installDriveWrappers();
  }

  function stageNight() {
    enterPlay();
    setClock(21 * 60 + 30, true); // full night, neon market
    buildLen = 0.9; driftLen = 0.8;
    wantedAt = 0; // heat from the start: roadblock sits close ahead
    var z = clearSpawn(-90, 60); // Pasar Lentera avenue, southbound
    makeHero(-90, z, 0);
    if (VR.Missions) {
      VR.Missions.start(1);            // Lantern Chase
      VR.Missions.completeObjective(); // objective 1: (-30, 210)
    }
    installDriveWrappers();
  }

  function stageCombat() {
    enterPlay();
    setClock(18 * 60 + 52, false);
    VR.State.weapon = 2; // SMG
    VR.State.ammo.smg = 120;
    VR.State.armor = 50;
    if (VR.Player) { VR.Player.armor = 50; VR.Player.health = 100; }
    VR.Player.pos.set(30, 0, -60);
    VR.Player.yaw = Math.PI; // face north up the Highrise avenue
    if (VR.Missions) VR.Missions.start(2); // Dockyard Heist
    if (VR.Police && VR.Police.setWanted) VR.Police.setWanted(4);
    if (VR.Combat && VR.Combat.selectWeapon) VR.Combat.selectWeapon(2);
    if (VR.Combat && VR.Combat.setAiming) VR.Combat.setAiming(true);
  }

  function stageMap() {
    enterPlay();
    setClock(18 * 60 + 52, false);
    if (VR.Missions) VR.Missions.start(0); // waypoint diamond on the map
    if (VR.Police && VR.Police.setWanted) VR.Police.setWanted(2);
    // Let a few frames run so police units exist, then open pause.
    setTimeout(function () {
      if (!VR.State) return;
      VR.State.mode = 'paused';
      if (VR.Menus) VR.Menus.showPause();
      mapOpen = true;
      mapFrames = 0;
    }, 2500);
  }

  // ---- readiness + staging tick (real time, 200 ms) ----
  function dialogueDone() {
    return !VR.HUD || VR.HUD.dialogueComplete;
  }
  function heliUp() {
    return !!(VR.Police && VR.Police.heli);
  }
  function setReady() {
    if (shotReady) return;
    shotReady = true;
    window.__shotReady = true;
  }

  function tick() {
    if (shotReady || !staged) return;
    try {
      if (shot === 'cover' || shot === 'night') {
        var n = 0;
        if (heroCar) {
          n = pinPolice(heroCar.x, heroCar.z, heroCar.yaw, heroCar.speed);
          pinPeds(heroCar.x, heroCar.z, heroCar.yaw);
        }
        // Final frame: drift pose held, dialogue fully typed, helicopter
        // up, two pinned patrol cars ahead.
        if (phase >= 2 && dialogueDone() && heliUp() && n >= 2) setReady();
      } else if (shot === 'combat') {
        // Pin the patrol cars ahead so they never close in and bust the
        // on-foot player mid-shot; tactical officers hold at range.
        if (VR.Player) pinPolice(VR.Player.pos.x, VR.Player.pos.z, VR.Player.yaw, 0);
        if (VR.Combat) {
          try { if (VR.Combat.shoot()) shotsFired++; } catch (e) { /* retry next tick */ }
        }
        var tact = (VR.Police && VR.Police.tactUnits) ? VR.Police.tactUnits.length : 0;
        if (performance.now() - stageRealAt > 5000 && dialogueDone() &&
            tact >= 1 && shotsFired >= 2) setReady();
      } else if (shot === 'map') {
        if (mapOpen) {
          mapFrames++;
          if (mapFrames >= 3) setReady();
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('VR.Shots tick failed: ' + (e && e.message ? e.message : e));
      }
    }
  }

  function stage() {
    if (staged || !KNOWN[shot]) return;
    staged = true;
    stageRealAt = performance.now();
    try {
      if (shot === 'cover') stageCover();
      else if (shot === 'night') stageNight();
      else if (shot === 'combat') stageCombat();
      else if (shot === 'map') stageMap();
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('VR.Shots stage failed: ' + (e && e.message ? e.message : e));
      }
    }
    setInterval(tick, 200);
  }

  // Boot poll: main.js creates VR.State after this file loads, so wait
  // for the world to exist before staging. Registered before main.js's
  // own rAF loop, so the first rendered frame is already staged.
  function bootPoll() {
    if (staged) return;
    if (window.VR && VR.State && VR.World && VR.World.scene && VR.Player &&
        VR.Menus && VR.Missions && VR.Vehicles && VR.Police && VR.HUD) {
      stage();
      return;
    }
    requestAnimationFrame(bootPoll);
  }
  if (KNOWN[shot]) requestAnimationFrame(bootPoll);

  VR.Shots = {
    name: shot,
    stage: stage,
    get ready() { return shotReady; }
  };

})(window.VR = window.VR || {});
