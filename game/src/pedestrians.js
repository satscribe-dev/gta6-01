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
  // v4: taper runs shoulder->wrist / hip->ankle (wide end at the joint).
  function makeLimb(w, h, d, mat, px, py, pz) {
    var pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    var m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.42, h, 12), mat);
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

    // Torso: TAPERED cylinder (v5) — shoulders 0.29 wide, waist 0.15 —
    // flattened front-to-back, never a box. Shoulder caps + belt +
    // backpack give the same costume read as Damian, simpler.
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.15, 0.55, 10), shirt);
    torso.position.y = 1.15;
    torso.scale.set(1, 1, 0.62);
    torso.castShadow = true;
    g.add(torso);
    var capGeo = new THREE.SphereGeometry(0.12, 10, 8);
    [-0.27, 0.27].forEach(function (x) {
      var cap = new THREE.Mesh(capGeo, shirt);
      cap.position.set(x, 1.38, 0);
      cap.castShadow = true;
      g.add(cap);
    });
    var belt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 12), std(0x222222, 0.85));
    belt.position.y = 0.92;
    belt.scale.set(1, 1, 0.62);
    belt.castShadow = true;
    g.add(belt);
    // Collar ring + round pockets (v5): the jacket details must read.
    var collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 8, 12), std(0x222222, 0.85));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.44;
    g.add(collar);
    [-0.10, 0.10].forEach(function (x) {
      var pk = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std(0x222222, 0.85));
      pk.scale.set(1.1, 1.1, 0.45);
      pk.position.set(x, 1.05, 0.13);
      g.add(pk);
    });
    var pack = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), std(0x4a3524, 0.95));
    pack.scale.set(1, 1.2, 0.5);
    pack.position.set(0, 1.2, -0.19);
    pack.castShadow = true;
    g.add(pack);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(head);
    // Eyes (v4): small WHITE spheres + dark pupils, like Damian.
    var eyeW = std(0xffffff, 0.4);
    [-0.06, 0.06].forEach(function (x) {
      var w = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), eyeW);
      w.position.set(x, 1.64, 0.14);
      g.add(w);
      var pu = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), std(0x222222, 0.85));
      pu.position.set(x, 1.64, 0.18);
      g.add(pu);
    });
    // hair cap
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      std(pick([0x1a1a1a, 0x3a2a1a, 0x5a5a5a, 0x2a1a0a]), 0.9));
    hair.position.y = 1.65;
    g.add(hair);
    // hair crest (v4, same recipe as Damian, smaller) + bangs
    var crest = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), hair.material);
    crest.scale.set(1, 0.5, 1.8);
    crest.position.set(0, 1.8, 0);
    g.add(crest);
    [-0.07, 0.07].forEach(function (x) {
      var bang = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), hair.material);
      bang.position.set(x, 1.74, 0.09);
      g.add(bang);
    });

    // Legs (v6 — rig proportions): hip pivot (thigh) + KNEE pivot
    // (shin + shoe), so the knee visibly bends during the stride
    // instead of the leg hanging as one straight tube. Hip raised
    // 0.82 -> 0.90 so the legs are ~49% of the figure (0.90 of
    // ~1.85 total); thigh + shin 0.43 each.
    var shoeGeo = new THREE.SphereGeometry(0.09, 10, 8);
    var shoeMat = std(0xf2f2f2, 0.6); // white shoes
    var soleGeo = new THREE.SphereGeometry(0.09, 10, 8);
    var soleMat = std(0x222222, 0.85);
    var kneeMat = std(0x3d5266, 0.85); // knee cap: lighter navy
    function buildPedLeg(m) {
      var hip = makeLimb(0.16, 0.43, 0.18, pants, m * 0.12, 0.90, 0);
      var knee = new THREE.Group();
      knee.position.set(0, -0.43, 0);
      knee.rotation.x = 0.15;
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), kneeMat);
      knee.add(cap);
      var shin = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.43, 10), pants);
      shin.position.y = -0.215;
      shin.castShadow = true;
      knee.add(shin);
      var ankle = new THREE.Group();
      ankle.position.set(0, -0.43, 0);
      var shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.scale.set(1, 0.55, 1.4); shoe.position.set(0, 0, 0.03); ankle.add(shoe);
      var sole = new THREE.Mesh(soleGeo, soleMat);
      sole.scale.set(1, 0.3, 1.4); sole.position.set(0, -0.02, 0.03); ankle.add(sole);
      knee.add(ankle);
      hip.add(knee);
      g.add(hip);
      return { hip: hip, knee: knee };
    }
    var _legL = buildPedLeg(-1), _legR = buildPedLeg(1);
    var legL = _legL.hip, legR = _legR.hip;
    var kneeL = _legL.knee, kneeR = _legR.knee;
    // Arms (v4): upper arm pivot at the shoulder + a separate
    // forearm on an ELBOW pivot group, so the arm bends at the
    // elbow instead of hanging as one tube.
    var armL = makeLimb(0.12, 0.32, 0.14, shirt, -0.30, 1.38, 0);
    var armR = makeLimb(0.12, 0.32, 0.14, shirt, 0.30, 1.38, 0);
    armL.rotation.z = -0.15; // slight outward rest tilt (v5)
    armR.rotation.z = 0.15;
    function addForearm(arm, m) {
      var elbow = new THREE.Group();
      elbow.position.set(0, -0.32, 0);
      elbow.rotation.z = -0.15 * m; // permanent inward kink (v5)
      var fore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.28, 10), shirt);
      fore.position.y = -0.14;
      fore.castShadow = true;
      elbow.add(fore);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), shirt);
      elbow.add(cap);
      // Mitten hand: flattened palm + thumb bump.
      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
      hand.scale.set(1, 1.3, 0.75);
      hand.position.set(0, -0.30, 0.01);
      elbow.add(hand);
      var thumb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin);
      thumb.position.set(m * 0.05, -0.27, 0.05);
      elbow.add(thumb);
      elbow.rotation.x = -0.3; // slight permanent bend
      arm.add(elbow);
      return elbow;
    }
    var elbowL = addForearm(armL, -1);
    var elbowR = addForearm(armR, 1);
    g.add(armL); g.add(armR);
    return { group: g, legL: legL, legR: legR, kneeL: kneeL, kneeR: kneeR, armL: armL, armR: armR, elbowL: elbowL, elbowR: elbowR };
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
      kneeL: parts.kneeL, kneeR: parts.kneeR,
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
      ped.kneeL.rotation.x = 0.15; ped.kneeR.rotation.x = 0.15;
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
        ped.kneeL.rotation.x = 0.15; ped.kneeR.rotation.x = 0.15;
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

    // limb swing — hips swing, knees bend when their leg swings
    // forward (v5: the knee pivot must visibly work, not just exist).
    var freq = ped.state === 'flee' ? 11 : 6.5;
    ped.phase += dt * freq;
    var sw = Math.sin(ped.phase) * (ped.state === 'flee' ? 0.85 : 0.55);
    ped.legL.rotation.x = sw;
    ped.legR.rotation.x = -sw;
    ped.kneeL.rotation.x = 0.15 + Math.max(0, sw) * 0.5;
    ped.kneeR.rotation.x = 0.15 + Math.max(0, -sw) * 0.5;
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
