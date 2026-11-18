// player.js — Damian Reyes on foot: third-person Pointer Lock mouse
// look, WASD + Shift sprint + Space jump, procedural limb swing,
// wall collision via VR.World.isBlocked, FOV widening on sprint.
// Car enter/exit delegates to VR.Vehicles when it exists (slice B).
// CAMERA OWNER: this file owns every gameplay camera — the on-foot
// over-shoulder camera AND the in-car chase camera (updateCarCamera,
// cinematic follow + corner roll + nitro FOV). main.js never positions
// the camera while playing; it only runs the title orbit.
(function (VR) {
  'use strict';

  var C = VR.Config;
  var P = C.PALETTE;
  var PT = C.PLAYER;

  var pos = new THREE.Vector3(-210, 0, -30); // boulevard intersection,
  // facing east down a clear street (no building directly ahead)
  var yaw = Math.PI / 2; // facing east, into the city
  // Art pass (18 Nov): near-level default pitch — the old -0.12 stared
  // down at the asphalt; -0.04 keeps the horizon and sky in the top
  // of the frame on foot and in the car.
  var pitch = -0.04;
  var vy = 0;
  var grounded = true;
  var walkPhase = 0;
  var speedNow = 0;
  var fovNow = 62;

  // ---------- smooth low-poly Damian (Slice F upgrade) ----------
  // No box geometry anywhere on the character: the head is a smooth
  // sphere with modern short hair, the torso a flattened capsule with
  // a shoulder bar, and the limbs tapered cylinders. The pivots and
  // proportions are the same as before, so the walk swing, camera and
  // collision are untouched.
  function std(color, rough) {
    return new THREE.MeshStandardMaterial({
      color: color, roughness: rough == null ? 0.85 : rough,
      metalness: 0, flatShading: false
    });
  }
  function ball(r, mat, px, py, pz, sx, sy, sz) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
    m.position.set(px, py, pz);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
    m.castShadow = true;
    return m;
  }

  var group = new THREE.Group();
  var shirt = std(P.damianShirt);
  var pants = std(P.damianPants);
  var skin = std(P.damianSkin);
  var hair = std(0x1a1a1a, 0.55);

  // Torso: capsule, flattened front-to-back; the rounded top reads as
  // natural shoulders, and a horizontal shoulder capsule joins the arms.
  var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.20, 6, 16), shirt);
  torso.position.set(0, 1.12, 0);
  torso.scale.set(1, 1, 0.62);
  torso.castShadow = true;
  var shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.44, 4, 12), shirt);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.set(0, 1.42, 0);
  shoulders.castShadow = true;
  // Head: smooth sphere; hair: a short modern cap plus a back sweep.
  var head = ball(0.18, skin, 0, 1.68, 0);
  var hairTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairTop.position.set(0, 1.70, -0.01);
  hairTop.castShadow = true;
  var hairBack = ball(0.13, hair, 0, 1.66, -0.10, 1, 0.9, 0.6);
  group.add(torso); group.add(shoulders); group.add(head);
  group.add(hairTop); group.add(hairBack);

  // Arms pivot at the shoulder; legs pivot at the hip. Limbs are
  // tapered cylinders (narrower at the far end), never boxes.
  function limb(r, h, mat, px, py) {
    var pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 12), mat);
    m.position.y = -h / 2;
    m.castShadow = true;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  }
  var armL = limb(0.085, 0.62, shirt, -0.37, 1.44);
  var armR = limb(0.085, 0.62, shirt, 0.37, 1.44);
  var legL = limb(0.105, 0.72, pants, -0.14, 0.76);
  var legR = limb(0.105, 0.72, pants, 0.14, 0.76);
  // Hands (skin spheres) at the end of the arms.
  armL.add(ball(0.075, skin, 0, -0.66, 0));
  armR.add(ball(0.075, skin, 0, -0.66, 0));
  // Shoes: flattened ellipsoid toes.
  legL.add(ball(0.11, std(0x222222), 0, -0.74, 0.04, 1, 0.55, 1.4));
  legR.add(ball(0.11, std(0x222222), 0, -0.74, 0.04, 1, 0.55, 1.4));

  group.position.copy(pos);
  VR.World.scene.add(group);

  // ---------- movement helpers (no allocations) ----------
  var RADIUS = 0.45;
  function blockedAt(x, z) {
    return VR.World.isBlocked(x + RADIUS, z) ||
           VR.World.isBlocked(x - RADIUS, z) ||
           VR.World.isBlocked(x, z + RADIUS) ||
           VR.World.isBlocked(x, z - RADIUS);
  }

  var _camTarget = new THREE.Vector3();
  var _camDesired = new THREE.Vector3();
  var _lookAt = new THREE.Vector3();
  var _fwd = new THREE.Vector3();

  // Nitro FOV bonus (+6 deg). Gated on inCar so a stale flag can never
  // widen the on-foot FOV; exitCar() also clears VR.State.nitroActive.
  function nitroBonus() {
    return (VR.State && VR.State.inCar && VR.State.nitroActive) ? 6 : 0;
  }

  function updateCamera(dt) {
    var cam = VR.World.camera;
    // Over-shoulder: behind and above, offset to the right.
    // Art pass: pulled back and raised, aimed at chest height + 2.0
    // instead of 1.5 — the frame reads horizon + towers + sea in the
    // top 40% instead of a slab of asphalt.
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var dist = PT.camDistance + 0.9;
    _camDesired.set(
      pos.x - sy * cp * dist + cy * 0.7,
      pos.y + (PT.camHeight - 0.2) - sp * dist,
      pos.z - cy * cp * dist - sy * 0.7
    );
    if (_camDesired.y < 0.5) _camDesired.y = 0.5;
    var k = 1 - Math.exp(-dt * 12);
    cam.position.lerp(_camDesired, k);
    _lookAt.set(pos.x, pos.y + 2.0, pos.z);
    cam.lookAt(_lookAt);
    // FOV widens with sprint speed (+ nitro bonus while driving).
    var targetFov = 62 + Math.min(1, speedNow / PT.sprintSpeed) * 9 + nitroBonus();
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - fovNow) > 0.05) {
      cam.fov = fovNow;
      cam.updateProjectionMatrix();
    }
  }

  // ---------- in-car chase camera (cinematic follow) ----------
  // Behind + above the player's car, looking ahead down the road,
  // smoothed so it trails the car instead of snapping; slight roll
  // into corners; FOV widens with speed and +6 while nitro burns.
  var _carCamSnap = true;

  function updateCarCamera(dt, car) {
    var cam = VR.World.camera;
    if (!car || !car.group) return;
    var cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    // Art pass: farther back + higher, aimed up at 1.9 — the car stays
    // fully in the lower frame while the top 40% shows sky, towers
    // and sea instead of asphalt.
    var dist = 9.5, height = 4.0;
    _camDesired.set(
      car.group.position.x - sy * dist,
      height,
      car.group.position.z - cy * dist
    );
    if (_carCamSnap) {
      // First frame after entering: snap behind the car, never swoop
      // across the city from the old on-foot position.
      cam.position.copy(_camDesired);
      _carCamSnap = false;
    } else {
      var k = 1 - Math.exp(-dt * 6);
      cam.position.lerp(_camDesired, k);
    }
    _lookAt.set(
      car.group.position.x + sy * 8,
      1.9,
      car.group.position.z + cy * 8
    );
    cam.lookAt(_lookAt);
    // Slight roll into corners (visual only).
    var speedF = Math.min(1, Math.abs(car.speed || 0) / 30);
    cam.rotateZ(-(car.steer || 0) * speedF * 0.05);
    // FOV widens with speed, +6 while nitro burns.
    var nitro = car.nitroActive || (VR.State && VR.State.nitroActive);
    var targetFov = 62 + speedF * 8 + (nitro ? 6 : 0);
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - fovNow) > 0.05) {
      cam.fov = fovNow;
      cam.updateProjectionMatrix();
    }
  }

  function enterCar(car) {
    if (!car || !VR.Vehicles) return false;
    if (VR.Vehicles.playerCar && VR.Vehicles.playerCar !== car) return false;
    VR.State.inCar = true;
    VR.State.car = car;
    VR.State.nitroActive = false;
    _carCamSnap = true; // chase camera snaps behind the car on entry
    if (VR.Vehicles.enterCar) VR.Vehicles.enterCar(car);
    group.visible = false;
    return true;
  }

  function exitCar() {
    if (!VR.State.inCar) return;
    var car = VR.State.car;
    VR.State.inCar = false;
    VR.State.car = null;
    VR.State.nitroActive = false; // never leak the nitro FOV on foot
    if (VR.Vehicles && VR.Vehicles.exitCar) VR.Vehicles.exitCar();
    if (car && car.group) {
      // Step out to the driver's side.
      pos.set(car.group.position.x + 2.2, 0, car.group.position.z);
      yaw = car.group.rotation.y;
    }
    group.visible = true;
  }

  function update(dt) {
    // Mouse look.
    var mouse = VR.Input.consumeMouse();
    if (VR.Input.pointerLocked) {
      yaw -= mouse.dx * 0.0028;
      pitch -= mouse.dy * 0.0028;
      if (pitch > 0.55) pitch = 0.55;
      // Art pass: never let the player stare straight down at the
      // asphalt (-0.5 was a top-down view of their own feet).
      if (pitch < -0.3) pitch = -0.3;
    }

    // F: enter / exit car (guarded — vehicles arrive in slice B).
    if (VR.Input.justPressed('KeyF')) {
      if (VR.State.inCar) {
        exitCar();
      } else if (VR.Vehicles && VR.Vehicles.nearestCar) {
        var car = VR.Vehicles.nearestCar(pos.x, pos.z, 4);
        if (car) enterCar(car);
      }
    }

    if (VR.State.inCar) {
      // Driving: physics + input flags live in VR.Vehicles (called by
      // main.js before this update); this file still owns the camera.
      // Hands on the wheel while driving (the driver group is hidden
      // inside the car, but the pose is kept correct regardless).
      armL.rotation.x = -1.15; armR.rotation.x = -1.15;
      armL.rotation.z = 0.25; armR.rotation.z = -0.25;
      legL.rotation.x = -0.5; legR.rotation.x = -0.5;
      speedNow = 0;
      if (VR.State.car) updateCarCamera(dt, VR.State.car);
      return;
    }

    // WASD relative to facing.
    var ix = 0, iz = 0;
    var keys = VR.Input.keys;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    var moving = (ix !== 0 || iz !== 0);
    var sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    var targetSpeed = moving ? (sprint ? PT.sprintSpeed : PT.walkSpeed) : 0;
    speedNow += (targetSpeed - speedNow) * Math.min(1, dt * 10);

    if (moving) {
      var len = Math.sqrt(ix * ix + iz * iz);
      ix /= len; iz /= len;
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      // Forward is (sin yaw, cos yaw); right is (cos yaw, -sin yaw).
      var mx = (sy * -iz) + (cy * ix);
      var mz = (cy * -iz) + (-sy * ix);
      var step = speedNow * dt;
      var nx = pos.x + mx * step;
      var nz = pos.z + mz * step;
      // Axis-separated so the player slides along walls instead of sticking.
      if (!blockedAt(nx, pos.z)) pos.x = nx;
      if (!blockedAt(pos.x, nz)) pos.z = nz;
      walkPhase += dt * speedNow * 1.9;
    }

    // Jump + gravity.
    if (grounded && VR.Input.justPressed('Space')) {
      vy = PT.jumpSpeed;
      grounded = false;
    }
    if (!grounded) {
      vy -= PT.gravity * dt;
      pos.y += vy * dt;
      if (pos.y <= 0) { pos.y = 0; vy = 0; grounded = true; }
    }

    // Pose the character.
    group.position.copy(pos);
    group.rotation.y = yaw;
    var swing = Math.sin(walkPhase) * 0.65 * Math.min(1, speedNow / PT.walkSpeed);
    armL.rotation.x = swing;
    armR.rotation.x = -swing;
    legL.rotation.x = -swing;
    legR.rotation.x = swing;
    // Idle breathing when standing still (keep the z-flattening).
    var breathe = moving ? 0 : Math.sin(performance.now() * 0.002) * 0.02;
    torso.scale.set(1, 1 + breathe, 0.62);
    // Slight forward lean while sprinting.
    group.rotation.x = sprint && moving ? 0.08 : 0;

    updateCamera(dt);
  }

  VR.Player = {
    pos: pos,
    group: group,
    get yaw() { return yaw; },
    set yaw(v) { yaw = v; },
    get pitch() { return pitch; },
    health: 100,
    armor: 0,
    get speed() { return speedNow; },
    get grounded() { return grounded; },
    enterCar: enterCar,
    exitCar: exitCar,
    update: update,
    updateCamera: updateCamera
  };

})(window.VR = window.VR || {});
