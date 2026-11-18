// traffic.js — Slice B: civilian traffic for VANDARA RUSH.
// Cars follow the VR.Roads graph, keep distance, pause at intersections,
// brake + swerve when the player gets close. Decisions live HERE;
// the bicycle-model step lives in VR.Vehicles.stepCar (single owner).
// No-ops safely when VR.Vehicles / VR.Roads / VR.World are not loaded yet.
(function (VR) {
  'use strict';

  var TARGET = 45;
  var TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'suv', 'suv', 'truck', 'sport'];
  var _dx = 0, _dz = 0;

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function playerPos() {
    if (VR.Player && VR.Player.pos) return VR.Player.pos;
    var pc = VR.Vehicles && VR.Vehicles.playerCar;
    if (pc) return { x: pc.x, z: pc.z };
    return null;
  }

  function newRoute(car) {
    if (!VR.Roads) return false;
    var dest = VR.Roads.randomRoadPoint ? VR.Roads.randomRoadPoint(Math.random) : null;
    if (!dest) return false;
    var pts = null;
    if (VR.Roads.route) {
      try { pts = VR.Roads.route(car.x, car.z, dest.x, dest.z); } catch (e) { pts = null; }
    }
    if (!pts || !pts.length) pts = [dest];
    car.ai.waypoints = pts;
    car.ai.wp = 0;
    return true;
  }

  function spawnCar(near) {
    if (!VR.Vehicles || !VR.Vehicles.createCar || !VR.Roads) return null;
    var p = null;
    if (near) {
      // spawn on a road point near the player so the street stays alive
      for (var t = 0; t < 12; t++) {
        var cand = VR.Roads.randomRoadPoint ? VR.Roads.randomRoadPoint(Math.random) : null;
        if (!cand) break;
        var dx = cand.x - near.x, dz = cand.z - near.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > 35 && d < 170) { p = cand; break; }
      }
    }
    if (!p) {
      if (!VR.Roads.randomRoadPoint) return null;
      p = VR.Roads.randomRoadPoint(Math.random);
      if (!p) return null;
    }
    var car = VR.Vehicles.createCar(pick(TYPES), p.x, p.z, rand(0, Math.PI * 2));
    car.ai = {
      waypoints: [], wp: 0, wait: 0,
      cruise: rand(9, 14), lane: (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 2.4),
      swerve: 0, honked: false
    };
    newRoute(car);
    return car;
  }

  function ensureCount() {
    var pp = playerPos();
    while (VR.Traffic.cars.length < TARGET) {
      var c = spawnCar(pp);
      if (!c) break;
      VR.Traffic.cars.push(c);
    }
  }

  function driveCar(car, dt) {
    var ai = car.ai;
    if (!ai) return;
    if (car.dead) return;

    // intersection pause
    if (ai.wait > 0) {
      ai.wait -= dt;
      car.throttle = 0; car.brake = 1; car.steerInput = 0; car.handbrake = false; car.nitro = false;
      VR.Vehicles.stepCar(car, dt);
      return;
    }

    var wp = ai.waypoints[ai.wp];
    if (!wp) { if (!newRoute(car)) { car.throttle = 0; car.brake = 1; VR.Vehicles.stepCar(car, dt); return; } wp = ai.waypoints[0]; }
    // lateral lane offset (right-hand traffic): offset perpendicular to heading
    var hx = Math.sin(car.yaw), hz = Math.cos(car.yaw);
    // lane offset applied perpendicular: right = (-hz, hx) * (lane + swerve)
    var tx = wp.x + (-hz) * (ai.lane + ai.swerve);
    var tz = wp.z + (hx) * (ai.lane + ai.swerve);

    _dx = tx - car.x; _dz = tz - car.z;
    var dist = Math.sqrt(_dx * _dx + _dz * _dz);
    if (dist < 6) {
      ai.wp++;
      if (ai.wp >= ai.waypoints.length) {
        // reached destination: sometimes pause at the "intersection", then reroute
        if (Math.random() < 0.4) ai.wait = rand(0.5, 1.8);
        newRoute(car);
      }
      return;
    }

    var desired = Math.atan2(_dx, _dz);
    var diff = wrapAngle(desired - car.yaw);
    car.steerInput = Math.max(-1, Math.min(1, diff * 1.9));
    var targetSpeed = ai.cruise * (Math.abs(diff) > 0.9 ? 0.35 : 1);

    // keep distance: car ahead in our lane
    var cars = VR.Traffic.cars;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car || !o || o.dead) continue;
      var ox = o.x - car.x, oz = o.z - car.z;
      var ahead = ox * hx + oz * hz;          // along our heading
      var side = ox * (-hz) + oz * hx;        // lateral
      if (ahead > 0 && ahead < 9 && Math.abs(side) < 2.4) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 4.5) * 1.2));
        if (ahead < 5) targetSpeed = 0;
      }
    }

    // player near ahead: brake + swerve away (and never ram the player)
    var pp = playerPos();
    if (pp) {
      var px = pp.x - car.x, pz = pp.z - car.z;
      var pa = px * hx + pz * hz, ps = px * (-hz) + pz * hx;
      var pd = Math.sqrt(px * px + pz * pz);
      if (pd < 14 && pa > -2) {
        if (pa > 0 && Math.abs(ps) < 3.2) {
          targetSpeed = Math.min(targetSpeed, 2);
          ai.swerve = (ps >= 0 ? -1 : 1) * 2.2; // swerve to the other side
          if (pd < 7) targetSpeed = 0;
        }
      } else {
        ai.swerve += (0 - ai.swerve) * Math.min(1, dt * 1.5);
      }
    }

    if (targetSpeed < 0.5) { car.throttle = 0; car.brake = 1; }
    else {
      car.brake = 0;
      car.throttle = car.speed < targetSpeed ? 0.75 : 0.25;
    }
    car.handbrake = false; car.nitro = false;
    VR.Vehicles.stepCar(car, dt);
  }

  function update(dt) {
    if (!VR.Vehicles || !VR.Vehicles.createCar || !VR.Roads || !VR.World) return;
    ensureCount();
    var pp = playerPos();
    var cars = VR.Traffic.cars;
    var pc = VR.Vehicles && VR.Vehicles.playerCar;
    for (var i = cars.length - 1; i >= 0; i--) {
      var car = cars[i];
      if (!car) { cars.splice(i, 1); continue; }
      // never AI-drive the car the player is driving: driveCar would overwrite
      // the player's throttle/steer every frame (W3 found holding W reversed it)
      if (pc && car === pc) continue;
      // respawn far-away cars near the player so traffic stays visible
      if (pp) {
        var dx = car.x - pp.x, dz = car.z - pp.z;
        if (dx * dx + dz * dz > 300 * 300) {
          var fresh = spawnCar(pp);
          if (fresh) {
            if (car.group && car.group.parent) car.group.parent.remove(car.group);
            var idx = VR.Vehicles.all.indexOf(car);
            if (idx >= 0) VR.Vehicles.all.splice(idx, 1);
            cars[i] = fresh;
            continue;
          }
        }
      }
      driveCar(car, dt);
    }
  }

  VR.Traffic = {
    cars: [],
    update: update,
    _spawnCar: spawnCar
  };
})(window.VR);
