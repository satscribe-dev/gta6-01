// main.js — boot + game loop for VANDARA RUSH.
// Fixed physics timestep (1/60, accumulator capped at 5 steps, dt
// clamped). Every module beyond slice A is optional: each is guarded
// with `if (VR.X)` so the game boots with slice A files alone
// (on-foot in the city, no cars / police / missions / HUD yet).
// CAMERA: main.js only runs the title orbit. All gameplay cameras
// (on-foot + in-car chase) are owned by player.js.
(function (VR) {
  'use strict';

  // ---------- shared game state (DESIGN.md §5) ----------
  VR.State = {
    mode: 'title',        // 'title' | 'playing' | 'paused' | 'cutscene'
    mission: 0,           // current mission index (0..7)
    money: 28400, respect: 0,
    wanted: 0,            // 0..5
    health: 100, armor: 0,
    timeMinutes: 18 * 60 + 52, day: 1,
    inCar: false, car: null,
    weapon: 0,            // 0 fists, 1 pistol, 2 SMG, 3 shotgun
    ammo: { pistol: 48, smg: 120, shotgun: 18 },
    night: false
  };

  var renderer = VR.World.renderer;
  var scene = VR.World.scene;
  var camera = VR.World.camera;

  // Title screen: click the canvas to start playing (also the gesture
  // that lets later slices init audio + pointer lock).
  renderer.domElement.addEventListener('click', function () {
    if (VR.State.mode === 'title') {
      VR.State.mode = 'playing';
      if (VR.Menus) VR.Menus.hideAll();
      VR.Input.requestLock(renderer.domElement);
      if (VR.Audio && VR.Audio.init) VR.Audio.init();
    } else if (VR.State.mode === 'playing' && !VR.Input.pointerLocked) {
      VR.Input.requestLock(renderer.domElement);
    }
  });

  // P toggles pause (menus arrive in slice C; without them, pause just
  // freezes the simulation and releases the pointer).
  function togglePause() {
    if (VR.State.mode === 'playing') {
      VR.State.mode = 'paused';
      VR.Input.exitLock();
      if (VR.Menus) VR.Menus.showPause();
    } else if (VR.State.mode === 'paused') {
      VR.State.mode = 'playing';
      if (VR.Menus) VR.Menus.hideAll();
      VR.Input.requestLock(renderer.domElement);
    }
  }

  // ---------- cinematic title orbit (no allocations) ----------
  var _orbitTarget = new THREE.Vector3(0, 0, 0);
  var orbitAngle = 0.6;
  function updateTitleCamera(dt) {
    orbitAngle += dt * 0.03;
    var r = 190;
    camera.position.set(
      Math.sin(orbitAngle) * r,
      95,
      Math.cos(orbitAngle) * r
    );
    camera.lookAt(_orbitTarget);
    if (Math.abs(camera.fov - 55) > 0.05) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
  }

  // ---------- fixed-timestep loop ----------
  var STEP = 1 / 60;
  var last = performance.now();
  var acc = 0;
  var booted = false;

  function update(dt) {
    if (VR.State.mode === 'title') {
      updateTitleCamera(dt);
      VR.World.update(dt, 0, 0);
      if (VR.Buildings && VR.Buildings.setNightness) VR.Buildings.setNightness(VR.World.nightness);
      return;
    }
    if (VR.State.mode === 'paused') return;

    // Driving: physics + input flags live in VR.Vehicles (slice B).
    // VR.Player.update runs in BOTH modes: on foot it moves Damian,
    // in a car it runs the chase camera (player.js owns the camera).
    if (VR.State.inCar && VR.Vehicles) VR.Vehicles.update(dt);
    if (VR.Player) VR.Player.update(dt);

    if (VR.Traffic) VR.Traffic.update(dt);
    if (VR.Peds) VR.Peds.update(dt);
    if (VR.Police) VR.Police.update(dt);
    if (VR.Combat) VR.Combat.update(dt);
    if (VR.Missions) VR.Missions.update(dt);
    if (VR.Effects) VR.Effects.update(dt);
    if (VR.HUD) VR.HUD.update(dt);
    if (VR.Minimap) VR.Minimap.update(dt);

    // Sun shadow camera follows the player — or the car while driving.
    var fx = VR.Player.pos.x, fz = VR.Player.pos.z;
    if (VR.State.inCar && VR.State.car && VR.State.car.group) {
      fx = VR.State.car.group.position.x;
      fz = VR.State.car.group.position.z;
    }
    VR.World.update(dt, fx, fz);
    if (VR.Buildings && VR.Buildings.setNightness) VR.Buildings.setNightness(VR.World.nightness);

    // Pause key (edge-triggered).
    if (VR.Input.justPressed('KeyP')) togglePause();

    VR.Input.endFrame();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1; // clamp hitches
    if (dt < 0) dt = 0;
    acc += dt;
    var steps = 0;
    while (acc >= STEP && steps < 5) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0; // drop backlog rather than spiral
    renderer.render(scene, camera);
    if (!booted) {
      booted = true;
      window.__gameReady = true;
    }
  }

  // Apply the starting time of day, then go.
  VR.World.setTimeOfDay(VR.State.timeMinutes);
  if (VR.Menus) VR.Menus.showTitle();
  requestAnimationFrame(frame);

  VR.Main = {
    togglePause: togglePause
  };

})(window.VR = window.VR || {});
