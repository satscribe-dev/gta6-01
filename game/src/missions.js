// missions.js — Slice E: 8 story missions for VANDARA RUSH.
// Sequential objectives, gold light-pillar beacon at the active target,
// full-sentence character dialogue (via VR.HUD when present), money +
// respect rewards, finale timer for mission 8. Every cross-module call
// is guarded: HUD / Minimap / Police / Combat / Economy / Save may not
// exist yet (slices C/D load in parallel).
(function (VR) {
  'use strict';

  var MISSIONS = (VR.Config && VR.Config.MISSIONS) || [];

  // ---- Objective chains (2-4 per mission). Coordinates are road-grid
  // points (streets at -210..210 step 60; boardwalk x = -228).
  // Garage Soraya: (-30, 150). Golden Pier: x -240..-150.
  // Pasar Lentera: z 90..240. Highrise Plaza: centre-north.
  // Dockyard: x 150..240.
  var CHAINS = [
    [ // 1 First Delivery
      { text: 'Pick up the package at Soraya\'s garage', x: -30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'The package is on the garage table, dear. Brown wrapping, don\'t open it. Deliver it to Pasar Lentera before the lanterns light up.' },
      { text: 'Deliver the package to Pasar Lentera', x: -90, z: 210,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'The recipient is waiting by the lantern stall at the far end. Hand over the package, don\'t say much, then come back here.' },
      { text: 'Return to Soraya\'s garage', x: -30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'Good, Damian. Your money is ready. This city needs a driver it can trust, and you just proved you are one.' }
    ],
    [ // 2 Lantern Chase
      { text: 'Chase the courier through the Pasar Lentera alley', x: -150, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'Halim\'s men are chasing our courier through the market alley. Go after him, Damian, and bring the goods back. Don\'t let them slip away past the lanterns.' },
      { text: 'Cut off the courier at the far end of the market', x: -30, z: 210,
        who: 'Damian Reyes', role: 'Driver',
        line: 'He turned toward the fish stalls. If I cut through the next alley, I can head him off before he reaches the main road.' },
      { text: 'Take the goods back', x: 30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'You got him, dear. Take the goods and bring them home. Halim\'s men won\'t stop here, so don\'t linger.' }
    ],
    [ // 3 Dockyard Heist
      { text: 'Enter the Dockyard through the east gate', x: 210, z: -90,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'The blue container at the Dockyard holds port documents that could bring Halim down. Slip in quietly, and don\'t let the cranes stop moving.' },
      { text: 'Take the documents from the blue container', x: 210, z: 30,
        who: 'Damian Reyes', role: 'Driver',
        line: 'Blue container, second row. The documents must be inside that wooden crate. Grab them fast, before the patrol guard comes back this way.' },
      { text: 'Leave the Dockyard unseen', x: 150, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'The documents are in your hands. Now leave through the south side, nice and slow. One wrong step and the whole port will be after you.' }
    ],
    [ // 4 Soraya's Escort
      { text: 'Pick up Soraya at the garage', x: -30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'Tonight I have to meet someone at Golden Pier, and Bramantyo has already caught wind of it. Pick me up at the garage, Damian, and don\'t be late.' },
      { text: 'Escort Soraya to Highrise Plaza', x: 90, z: -90,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'We have to pass through Highrise first to make sure nobody is following. Stay close to me, dear. Tonight I can\'t be alone.' },
      { text: 'Arrive at the Golden Pier boardwalk', x: -210, z: 90,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'We made it, Damian. You looked after me well tonight. Remember, whatever you hear at this meeting, keep it to yourself.' }
    ],
    [ // 5 Apex Repo
      { text: 'Enter the Highrise Plaza garage', x: 90, z: -150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'That Apex GT is yours, Damian. Halim seized it and stashed it in a Highrise Plaza garage. Slip in through the back door, the guards are changing shift.' },
      { text: 'Take back the Apex GT', x: 150, z: -150,
        who: 'Damian Reyes', role: 'Driver',
        line: 'There it is. My teal paint, my spoiler, my car. Halim thought he could keep my car forever. He was very wrong.' },
      { text: 'Bring the Apex GT to Soraya\'s garage', x: -30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'You did it, dear. Bring your car home to the garage and let me look it over. From now on, nobody touches the Apex GT again.' }
    ],
    [ // 6 Vault at Golden Pier
      { text: 'Meet Halim\'s contact at Golden Pier', x: -210, z: -90,
        who: 'Victor Halim', role: 'Syndicate Boss',
        line: 'Reyes. You\'ve done good work so far. My contact is waiting at the end of the Golden Pier boulevard. He will show you the way to the vault.' },
      { text: 'Open the vault under the dock', x: -228, z: -150,
        who: 'Victor Halim', role: 'Syndicate Boss',
        line: 'The small vault under the Golden Pier dock holds my money. Open it, take your cut, and don\'t think about running. I always know.' },
      { text: 'Take the money to the drop-off point', x: -150, z: -30,
        who: 'Victor Halim', role: 'Syndicate Boss',
        line: 'Good. Now take that money to the drop-off at the end of the boulevard. Hand it to my man, and your cut will be paid in cash. Don\'t be late.' }
    ],
    [ // 7 Double Cross
      { text: 'Escape the ambush at Golden Pier', x: -210, z: 30,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'Halim set you up, Damian. The vault was bait, and Bramantyo is already waiting outside. Run now, dear. Don\'t trust anyone tonight, except me.' },
      { text: 'Break through the blockade at Highrise Plaza', x: 30, z: -30,
        who: 'Inspektur Bramantyo', role: 'Police Commander',
        line: 'Reyes! You\'re surrounded. Surrender now, or I\'ll drag you out of that car myself. This city is mine, not yours.' },
      { text: 'Reach Soraya\'s garage', x: -30, z: 150,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'You made it, thank goodness. Shut the garage door, Damian. Bramantyo won\'t dare come in here, but we have to plan tonight\'s last move.' }
    ],
    [ // 8 Last Hydrofoil Out
      { text: 'Get the hydrofoil keys at the Dockyard', x: 210, z: 90,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'This is the last one, Damian. My man at the Dockyard has the hydrofoil keys. Grab them, and don\'t stop for anything. We don\'t have much time left.' },
      { text: 'Break through to Golden Pier', x: -150, z: 90,
        who: 'Inspektur Bramantyo', role: 'Police Commander',
        line: 'All units, close every road to Golden Pier! Reyes must not reach the dock. I want him alive, but I won\'t wait forever.' },
      { text: 'Board the hydrofoil at the dock before midnight', x: -228, z: -210,
        who: 'Tante Soraya', role: 'Fixer & Garage Owner',
        line: 'The hydrofoil is waiting at the dock before midnight. Bramantyo has closed every road and Halim has sent all his men. Run, and never look back.' }
    ]
  ];

  var ARRIVE_RADIUS = 7;
  var FINALE_SECONDS = 300; // 5 minutes for mission 8 (midnight)

  var active = false;
  var current = 0;
  var objectiveIndex = 0;
  var objectiveText = '';
  var targetPos = null; // reused {x, z} object, read by the minimap
  var _target = { x: 0, z: 0 };
  var timeLeft = 0; // seconds left in the finale (mission 8 only)
  var _pulseT = 0;
  var _beacon = null; // gold light-pillar mesh (CylinderGeometry, additive)

  function toast(text) {
    if (VR.HUD && VR.HUD.showToast) {
      try { VR.HUD.showToast(text); } catch (e) { /* HUD optional */ }
    }
  }

  function dialogue(name, role, text) {
    if (VR.HUD && VR.HUD.showDialogue) {
      try { VR.HUD.showDialogue(name, role, text); } catch (e) { /* HUD optional */ }
    }
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
  }

  // ---- Beacon: gold vertical light pillar at the active target ----
  function ensureBeacon() {
    if (_beacon) return _beacon;
    if (typeof THREE === 'undefined') return null;
    if (!VR.World || !VR.World.scene) return null;
    try {
      var geo = new THREE.CylinderGeometry(1.4, 1.4, 70, 12, 1, true);
      var mat = new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 35, 0);
      if (VR.World.makeGlowSprite) {
        var glow = VR.World.makeGlowSprite(0xffd23f, 14);
        glow.position.y = -33;
        mesh.add(glow);
      }
      mesh.visible = false;
      VR.World.scene.add(mesh);
      _beacon = mesh;
    } catch (e) { _beacon = null; }
    return _beacon;
  }

  function placeBeacon(x, z) {
    var b = ensureBeacon();
    if (b) {
      b.position.x = x;
      b.position.z = z;
      b.visible = true;
    }
  }

  function hideBeacon() {
    if (_beacon) _beacon.visible = false;
  }

  function setObjectiveText() {
    var chain = CHAINS[current];
    if (!chain || !active) { objectiveText = ''; return; }
    var obj = chain[objectiveIndex];
    objectiveText = obj ? obj.text : '';
    if (current === 7 && timeLeft > 0) {
      objectiveText += ' — ' + fmtTime(timeLeft) + ' remaining';
    }
  }

  function applyObjective() {
    var chain = CHAINS[current];
    if (!chain) { active = false; objectiveText = ''; targetPos = null; hideBeacon(); return; }
    var obj = chain[objectiveIndex];
    if (!obj) { active = false; objectiveText = ''; targetPos = null; hideBeacon(); return; }
    _target.x = obj.x;
    _target.z = obj.z;
    targetPos = _target;
    setObjectiveText();
    placeBeacon(obj.x, obj.z);
    if (obj.who && obj.line) dialogue(obj.who, obj.role || '', obj.line);
  }

  function start(i) {
    if (typeof i !== 'number' || i < 0 || i >= MISSIONS.length) return false;
    if (!CHAINS[i]) return false;
    current = i;
    objectiveIndex = 0;
    active = true;
    timeLeft = (i === 7) ? FINALE_SECONDS : 0;
    if (VR.State) VR.State.mission = i;
    if (i === 7 && VR.World && VR.World.setTimeOfDay) {
      try { VR.World.setTimeOfDay(23 * 60 + 30); } catch (e) { /* optional */ }
    }
    var m = MISSIONS[i];
    if (m) {
      dialogue(m.giver, m.role || '', m.dialogue || '');
      toast('Mission ' + (i + 1) + ': ' + m.title);
    }
    applyObjective();
    return true;
  }

  function payReward(m) {
    var money = m.reward || 0;
    var respect = m.respect || 0;
    if (money > 0) {
      if (VR.Economy && VR.Economy.addMoney) VR.Economy.addMoney(money);
      else if (VR.State) VR.State.money = (VR.State.money || 0) + money;
    }
    if (respect > 0) {
      if (VR.Economy && VR.Economy.addRespect) VR.Economy.addRespect(respect);
      else if (VR.State) VR.State.respect = (VR.State.respect || 0) + respect;
    }
    return { money: money, respect: respect };
  }

  function finishMission() {
    var m = MISSIONS[current];
    active = false;
    objectiveText = '';
    targetPos = null;
    hideBeacon();
    timeLeft = 0;
    var rw = m ? payReward(m) : { money: 0, respect: 0 };
    if (m) {
      var msg = 'Mission complete: ' + m.title;
      if (rw.money > 0) msg += '  +$' + rw.money;
      if (rw.respect > 0) msg += '  +' + rw.respect + ' respect';
      toast(msg);
    }
    if (current === 7) {
      toast('VANDARA RUSH complete — Damian escaped Vandara Bay!');
      dialogue('Tante Soraya', 'Fixer & Garage Owner',
        'You did it, Damian. The hydrofoil is far from the dock and nobody is chasing you anymore. Vandara Bay will always remember your name, dear.');
    }
    if (VR.State) VR.State.mission = Math.min(current + 1, MISSIONS.length - 1);
    if (VR.Save && VR.Save.save) {
      try { VR.Save.save(); } catch (e) { /* save optional */ }
    }
    // Chain the story: the next mission starts at once with its giver
    // dialogue — otherwise the game stalls with no active mission.
    if (current < MISSIONS.length - 1) {
      start(current + 1);
    }
    return true;
  }

  function completeObjective() {
    if (!active) return false;
    var chain = CHAINS[current];
    if (!chain) return false;
    objectiveIndex++;
    if (objectiveIndex >= chain.length) {
      finishMission();
    } else {
      applyObjective();
      toast(objectiveText);
    }
    return true;
  }

  // Forward a crime committed during a mission to the police (slice D).
  // Called by combat / vehicle hijack code; safe when police is absent.
  function reportCrime(kind) {
    if (VR.Police && VR.Police.addHeat) {
      try {
        var heat = (kind === 'shoot') ? 1 : (kind === 'hijack') ? 1 : 1;
        VR.Police.addHeat(heat);
      } catch (e) { /* police optional */ }
    } else if (VR.Police && VR.Police.reportCrime) {
      try { VR.Police.reportCrime(kind); } catch (e) { /* optional */ }
    }
  }

  // ---- per-frame: beacon pulse, arrival detection, finale timer ----
  function playerXZ(out) {
    if (VR.State && VR.State.inCar && VR.State.car && VR.State.car.group) {
      out.x = VR.State.car.group.position.x;
      out.z = VR.State.car.group.position.z;
      return true;
    }
    if (VR.Player && VR.Player.pos) {
      out.x = VR.Player.pos.x;
      out.z = VR.Player.pos.z;
      return true;
    }
    return false;
  }

  var _pp = { x: 0, z: 0 };

  function update(dt) {
    _pulseT += dt;
    if (_beacon && _beacon.visible) {
      _beacon.material.opacity = 0.35 + 0.18 * Math.sin(_pulseT * 3.5);
      _beacon.rotation.y += dt * 0.4;
    }
    // Economy proximity/prompts run even with no mission active;
    // main.js only calls Missions.update, so we forward the tick.
    // (E-key interaction itself lives on economy.js's keydown listener,
    // so it can never double-fire with a justPressed check here.)
    if (VR.Economy && VR.Economy.update) {
      try { VR.Economy.update(dt); } catch (e) { /* economy optional */ }
    }
    if (!active) return;
    if (!VR.State || VR.State.mode !== 'playing') return;

    // Finale countdown (mission 8): midnight = fail, restart the mission.
    if (current === 7 && timeLeft > 0) {
      timeLeft -= dt;
      setObjectiveText();
      if (timeLeft <= 0) {
        timeLeft = 0;
        toast('Midnight — the hydrofoil left without Damian. Mission restarted.');
        dialogue('Tante Soraya', 'Fixer & Garage Owner',
          'That hydrofoil is gone, dear. But we still have one more chance. This time, don\'t stop for anything.');
        start(7);
        return;
      }
    }

    // Arrival: player (or their car) reached the active target.
    if (targetPos && playerXZ(_pp)) {
      var dx = _pp.x - targetPos.x;
      var dz = _pp.z - targetPos.z;
      if (dx * dx + dz * dz <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
        completeObjective();
      }
    }
  }

  VR.Missions = {
    list: MISSIONS,
    get current() { return current; },
    get objectiveText() { return objectiveText; },
    get targetPos() { return targetPos; },
    get beacon() { return _beacon; },
    get active() { return active; },
    get objectiveIndex() { return objectiveIndex; },
    get timeLeft() { return timeLeft; },
    start: start,
    completeObjective: completeObjective,
    reportCrime: reportCrime,
    update: update
  };

})(window.VR = window.VR || {});
