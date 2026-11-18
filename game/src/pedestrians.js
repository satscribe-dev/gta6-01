// pedestrians.js — Slice B: low-poly pedestrians for VANDARA RUSH.
// ~35 walkers on sidewalks: walk, chat in pairs, limbs swing sin(t).
// Panic-flee from gunfire / sirens via the shared flag VR.State.alarm
// (set by VR.Police / VR.Combat; absent flag = calm). Never walk through
// buildings: next position is checked with VR.World.isBlocked (guarded).
// No new Vector3 / arrays in the hot loop; no crash when VR.World /
// VR.Roads / VR.Player / VR.State are missing.
(function (VR) {
  'use strict';

  var TARGET = 35;
  var SKINS = [0xc98d64, 0x8a5a3b, 0xe8b98a, 0x6b4423, 0xd9a066];
  var SHIRTS = [0xd96a4a, 0x3f6fd1, 0x7fd1a8, 0xffc21c, 0xe8e4d8, 0x9b59b6, 0x1fd6c1, 0xe2725b];
  var PANTS = [0x2b3a4a, 0x3a3a3a, 0x5b4a3a, 0x4a6b4f, 0x6b6b7a];

  // Slice F upgrade: smooth shading everywhere (no faceted boxes).
  function std(color, rough) {
    return new THREE.MeshStandardMaterial({
      color: color, roughness: (rough === undefined ? 0.8 : rough),
      metalness: 0.0, flatShading: false
    });
  }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Limbs are tapered cylinders (smooth), never boxes. Signature kept:
  // w = limb width (diameter); d is unused, kept for the callers.
  function makeLimb(w, h, d, mat, px, py, pz) {
    var pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    var m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.5, h, 12), mat);
    m.position.y = -h / 2;
    m.castShadow = true;
    pivot.add(m);
    return pivot;
  }

  function buildPed() {
    var g = new THREE.Group();
    var shirt = std(pick(SHIRTS));
    var pants = std(pick(PANTS));
    var skin = std(pick(SKINS));

    // Torso: flattened capsule with rounded shoulders, never a box.
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.16, 6, 14), shirt);
    torso.position.y = 1.12;
    torso.scale.set(1, 1, 0.62);
    torso.castShadow = true;
    g.add(torso);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(head);
    // hair cap
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      std(pick([0x1a1a1a, 0x3a2a1a, 0x5a5a5a, 0x2a1a0a]), 0.9));
    hair.position.y = 1.65;
    g.add(hair);

    var legL = makeLimb(0.16, 0.78, 0.18, pants, -0.12, 0.82, 0);
    var legR = makeLimb(0.16, 0.78, 0.18, pants, 0.12, 0.82, 0);
    var armL = makeLimb(0.12, 0.6, 0.14, shirt, -0.30, 1.38, 0);
    var armR = makeLimb(0.12, 0.6, 0.14, shirt, 0.30, 1.38, 0);
    g.add(legL); g.add(legR); g.add(armL); g.add(armR);
    // Rounded hands and shoes (spheres), never boxes.
    var handGeo = new THREE.SphereGeometry(0.06, 10, 8);
    var handL = new THREE.Mesh(handGeo, skin); handL.position.y = -0.62; armL.add(handL);
    var handR = new THREE.Mesh(handGeo, skin); handR.position.y = -0.62; armR.add(handR);
    var shoeGeo = new THREE.SphereGeometry(0.09, 10, 8);
    var shoeMat = std(0x222222);
    var shoeL = new THREE.Mesh(shoeGeo, shoeMat);
    shoeL.scale.set(1, 0.55, 1.4); shoeL.position.set(0, -0.78, 0.03); legL.add(shoeL);
    var shoeR = new THREE.Mesh(shoeGeo, shoeMat);
    shoeR.scale.set(1, 0.55, 1.4); shoeR.position.set(0, -0.78, 0.03); legR.add(shoeR);
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR };
  }

  function alarmSource() {
    if (!VR.State || !VR.State.alarm) return null;
    var a = VR.State.alarm;
    if (typeof a === 'object' && typeof a.x === 'number' && typeof a.z === 'number') return a;
    if (a === true) {
      if (VR.Player && VR.Player.pos) return { x: VR.Player.pos.x, z: VR.Player.pos.z };
      var pc = VR.Vehicles && VR.Vehicles.playerCar;
      if (pc) return { x: pc.x, z: pc.z };
    }
    return null;
  }

  function sidewalkPoint() {
    // a point on the sidewalk: road point + perpendicular offset
    if (VR.Roads && VR.Roads.randomRoadPoint) {
      var p = VR.Roads.randomRoadPoint(Math.random);
      if (p) {
        var a = rand(0, Math.PI * 2);
        var off = rand(6.5, 9.5) * (Math.random() < 0.5 ? -1 : 1);
        return { x: p.x + Math.cos(a) * off, z: p.z + Math.sin(a) * off };
      }
    }
    return { x: rand(-200, 200), z: rand(-200, 200) };
  }

  function spawnPed() {
    var parts = buildPed();
    var p = sidewalkPoint();
    parts.group.position.set(p.x, 0, p.z);
    if (VR.World && VR.World.scene) VR.World.scene.add(parts.group);
    var ped = {
      group: parts.group, legL: parts.legL, legR: parts.legR,
      armL: parts.armL, armR: parts.armR,
      x: p.x, z: p.z, yaw: rand(0, Math.PI * 2),
      phase: rand(0, Math.PI * 2),
      speed: rand(1.1, 1.8), state: 'walk',
      tx: p.x, tz: p.z, wait: rand(0, 4),
      panicT: 0, chatPartner: null, bob: rand(0, Math.PI * 2)
    };
    // some peds start as chatting pairs (stand close, face each other)
    if (Math.random() < 0.3) ped.state = 'chat';
    return ped;
  }

  function pickTarget(ped) {
    var t = sidewalkPoint();
    ped.tx = t.x; ped.tz = t.z;
    ped.state = 'walk';
  }

  function updatePed(ped, dt, t, alarm) {
    var g = ped.group;

    // --- panic: flee away from the alarm source ---
    if (alarm) {
      var dx = ped.x - alarm.x, dz = ped.z - alarm.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (d < 55) {
        ped.state = 'flee';
        ped.panicT = 5;
        ped.tx = ped.x + (dx / d) * 30;
        ped.tz = ped.z + (dz / d) * 30;
      }
    }
    if (ped.state === 'flee') {
      ped.panicT -= dt;
      if (ped.panicT <= 0) { ped.state = 'walk'; pickTarget(ped); }
    }

    if (ped.state === 'chat') {
      // stand, small bob + hand gestures; occasionally wander off
      ped.bob += dt * 2;
      g.position.y = Math.abs(Math.sin(ped.bob)) * 0.02;
      ped.armR.rotation.x = Math.sin(ped.bob * 1.7) * 0.5 - 0.2;
      ped.armL.rotation.x = Math.sin(ped.bob * 1.3 + 1) * 0.3 - 0.1;
      ped.legL.rotation.x = 0; ped.legR.rotation.x = 0;
      ped.wait -= dt;
      if (ped.wait <= 0) { ped.wait = rand(6, 18); pickTarget(ped); }
      return;
    }

    // --- walk / flee along target ---
    var tx = ped.tx - ped.x, tz = ped.tz - ped.z;
    var dist = Math.sqrt(tx * tx + tz * tz);
    if (dist < 1.2) {
      if (ped.state === 'flee') { pickTarget(ped); }
      else {
        ped.wait -= dt;
        // idle: tiny sway
        ped.legL.rotation.x = 0; ped.legR.rotation.x = 0;
        ped.armL.rotation.x = Math.sin(t * 1.2 + ped.phase) * 0.05;
        ped.armR.rotation.x = -Math.sin(t * 1.2 + ped.phase) * 0.05;
        if (ped.wait <= 0) {
          if (Math.random() < 0.25) { ped.state = 'chat'; ped.wait = rand(5, 14); }
          else { ped.wait = rand(0, 3); pickTarget(ped); }
        }
      }
      return;
    }

    var speed = ped.state === 'flee' ? 4.4 : ped.speed;
    var desired = Math.atan2(tx, tz);
    var diff = desired - ped.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ped.yaw += diff * Math.min(1, dt * 6);

    var nx = ped.x + Math.sin(ped.yaw) * speed * dt;
    var nz = ped.z + Math.cos(ped.yaw) * speed * dt;
    // never walk through a building
    if (VR.World && VR.World.isBlocked && VR.World.isBlocked(nx, nz)) {
      ped.yaw += Math.PI * 0.6; // turn away
      pickTarget(ped);
    } else {
      ped.x = nx; ped.z = nz;
    }

    // limb swing
    var freq = ped.state === 'flee' ? 11 : 6.5;
    ped.phase += dt * freq;
    var sw = Math.sin(ped.phase) * (ped.state === 'flee' ? 0.85 : 0.55);
    ped.legL.rotation.x = sw;
    ped.legR.rotation.x = -sw;
    ped.armL.rotation.x = -sw * 0.8;
    ped.armR.rotation.x = sw * 0.8;
    g.position.set(ped.x, 0, ped.z);
    g.rotation.y = ped.yaw;
  }

  function update(dt) {
    if (!VR.World || !VR.World.scene) return;
    while (VR.Peds.list.length < TARGET) {
      var p = spawnPed();
      if (p) VR.Peds.list.push(p);
    }
    var t = performance.now() * 0.001;
    var alarm = alarmSource();
    var list = VR.Peds.list;
    for (var i = 0; i < list.length; i++) updatePed(list[i], dt, t, alarm);
  }

  VR.Peds = {
    list: [],
    update: update,
    _spawnPed: spawnPed
  };
})(window.VR);
