// combat.js — Slice D: 4 data-driven weapons for VANDARA RUSH.
// Reads weapon stats from VR.Config.WEAPONS (Fists, Pistol, SMG,
// Shotgun). Left-click shoots (drive-by from a car), right-click aims
// (over-the-shoulder — the camera stays owned by player.js; this file
// only toggles VR.State.aiming + the #crosshair HUD element). Keys 1-4
// switch weapons, R reloads. Hits use a THREE.Raycaster against police
// / traffic cars and tactical officers; building hits are found by
// marching the ray through VR.World.isBlocked. Every shot adds heat
// via VR.Police.addHeat and sets VR.State.alarm so pedestrians panic.
// Mouse buttons are tracked here (input.js has no mouse buttons).
// All cross-module access is guarded. No allocations in the hot loop.
(function (VR) {
  'use strict';

  var WEAPONS = (VR.Config && VR.Config.WEAPONS) ? VR.Config.WEAPONS : [
    { id: 0, name: 'Fists', damage: 12, fireInterval: 0.45, magSize: 0, ammo: 0, spread: 0, range: 2.2, auto: false },
    { id: 1, name: 'Pistol', damage: 22, fireInterval: 0.28, magSize: 12, ammo: 48, spread: 0.012, range: 60, auto: false },
    { id: 2, name: 'SMG', damage: 14, fireInterval: 0.09, magSize: 30, ammo: 120, spread: 0.045, range: 45, auto: true },
    { id: 3, name: 'Shotgun', damage: 11, fireInterval: 0.85, magSize: 6, ammo: 18, spread: 0.09, range: 22, auto: false, pellets: 8 }
  ];

  // ---------- temp objects (reused) ----------
  var _ray = new THREE.Raycaster();
  var _origin = new THREE.Vector3();
  var _dir = new THREE.Vector3();
  var _muzzle = new THREE.Vector3();
  var _hit = new THREE.Vector3();
  var _fwd = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var _up = new THREE.Vector3();

  // ---------- state ----------
  var cooldown = 0;
  var triggerDown = false;   // left mouse held
  var triggerEdge = false;   // left mouse pressed this frame (semi-auto)
  var aiming = false;        // right mouse held
  var mags = { pistol: 12, smg: 30, shotgun: 6 }; // current magazine
  var reloading = false;
  var reloadT = 0;
  var lastShotAt = -10;
  var crosshairEl = null;

  function weapon() {
    var idx = (VR.State && typeof VR.State.weapon === 'number') ? VR.State.weapon : 0;
    return WEAPONS[idx] || WEAPONS[0];
  }
  function weaponKey(w) {
    return w.id === 1 ? 'pistol' : (w.id === 2 ? 'smg' : (w.id === 3 ? 'shotgun' : null));
  }
  function reserveAmmo(w) {
    var k = weaponKey(w);
    if (!k || !VR.State || !VR.State.ammo) return 0;
    return VR.State.ammo[k] || 0;
  }
  function setReserveAmmo(w, n) {
    var k = weaponKey(w);
    if (k && VR.State && VR.State.ammo) VR.State.ammo[k] = Math.max(0, n);
  }

  function playerPos(out) {
    if (VR.State && VR.State.inCar && VR.State.car) {
      out.x = VR.State.car.x; out.z = VR.State.car.z;
      out.y = 1.2; out.yaw = VR.State.car.yaw;
      return out;
    }
    if (VR.Player && VR.Player.pos) {
      out.x = VR.Player.pos.x; out.z = VR.Player.pos.z;
      out.y = VR.Player.pos.y + 1.45; out.yaw = VR.Player.yaw || 0;
      return out;
    }
    out.x = 0; out.y = 1.45; out.z = 0; out.yaw = 0;
    return out;
  }
  var _pp = { x: 0, y: 0, z: 0, yaw: 0 };

  // ---------- mouse input (input.js tracks keys only) ----------
  window.addEventListener('mousedown', function (e) {
    if (!VR.State || VR.State.mode !== 'playing') return;
    if (e.button === 0) { triggerDown = true; triggerEdge = true; }
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', function (e) {
    if (e.button === 0) triggerDown = false;
    if (e.button === 2) aiming = false;
  });
  window.addEventListener('contextmenu', function (e) {
    if (VR.State && VR.State.mode === 'playing') e.preventDefault();
  });
  window.addEventListener('blur', function () { triggerDown = false; aiming = false; });

  function setAiming(on) {
    aiming = on;
    if (VR.State) VR.State.aiming = on;
    syncCrosshair();
  }

  function syncCrosshair() {
    if (!crosshairEl) crosshairEl = document.getElementById('crosshair');
    if (!crosshairEl) return;
    var show = aiming && VR.State && VR.State.mode === 'playing' && weapon().id !== 0;
    crosshairEl.style.display = show ? 'block' : 'none';
  }

  // ---------- weapon switching / reload ----------
  function selectWeapon(i) {
    if (!VR.State || i < 0 || i > 3) return;
    if (VR.State.weapon === i) return;
    VR.State.weapon = i;
    reloading = false;
    cooldown = 0.15;
    if (VR.Audio && VR.Audio.play) VR.Audio.play('ui');
    syncAmmoHUD();
  }

  function reload() {
    var w = weapon();
    var k = weaponKey(w);
    if (!k || reloading) return;
    if (mags[k] >= w.magSize) return;
    if (reserveAmmo(w) <= 0) {
      if (VR.HUD && VR.HUD.showToast) VR.HUD.showToast('Out of ammo — find a gun shop.');
      return;
    }
    // No VR.Economy yet (Slice E): reloads are free from an unlimited
    // reserve for now — the reserve counter still ticks down so the
    // economy hook can charge per bullet later.
    reloading = true;
    reloadT = w.id === 3 ? 1.4 : 0.9;
    if (VR.Audio && VR.Audio.play) VR.Audio.play('ui');
  }

  function finishReload() {
    var w = weapon();
    var k = weaponKey(w);
    if (!k) return;
    var need = w.magSize - mags[k];
    var take = Math.min(need, reserveAmmo(w));
    mags[k] += take;
    setReserveAmmo(w, reserveAmmo(w) - take);
    reloading = false;
    syncAmmoHUD();
  }

  function syncAmmoHUD() {
    var el = document.getElementById('weapon-ammo');
    if (!el) return;
    var w = weapon();
    var k = weaponKey(w);
    el.textContent = k ? (mags[k] + ' / ' + reserveAmmo(w)) : '—';
    // NOTE (Slice F, verified 18 Nov): the weapon icon is owned by
    // VR.HUD (hud.js), which draws a weapon silhouette SVG into
    // #weapon-icon. This function used to write the weapon NAME into
    // that same element on every frame, replacing the drawn silhouette
    // with plain text ("Fists"). It no longer touches the icon.
  }

  // ---------- hit resolution ----------
  // Collect shootable groups: police cars, roadblock cars, tactical
  // officers, traffic cars. userData carries the damage target.
  var _targets = [];
  function collectTargets() {
    _targets.length = 0;
    var i, j;
    if (VR.Police) {
      for (i = 0; i < VR.Police.units.length; i++) {
        var u = VR.Police.units[i];
        if (u.car && u.car.group && !u.car.dead) _targets.push(u.car.group);
      }
      for (i = 0; i < VR.Police.roadblocks.length; i++) {
        var rb = VR.Police.roadblocks[i];
        for (j = 0; j < rb.cars.length; j++) {
          if (rb.cars[j].group && !rb.cars[j].dead) _targets.push(rb.cars[j].group);
        }
      }
      for (i = 0; i < VR.Police.tactUnits.length; i++) {
        var t = VR.Police.tactUnits[i];
        if (t.group && !t.dead) _targets.push(t.group);
      }
    }
    if (VR.Traffic && VR.Traffic.cars) {
      for (i = 0; i < VR.Traffic.cars.length; i++) {
        var c = VR.Traffic.cars[i];
        if (c && c.group && !c.dead) _targets.push(c.group);
      }
    }
    return _targets;
  }

  function targetOf(hitObject) {
    var o = hitObject;
    while (o) {
      if (o.userData) {
        if (o.userData.policeUnit) return { kind: 'policeCar', unit: o.userData.policeUnit };
        if (o.userData.tactUnit) return { kind: 'tact', unit: o.userData.tactUnit };
      }
      // Traffic cars carry no userData marker; match by group identity.
      if (VR.Traffic && VR.Traffic.cars) {
        for (var i = 0; i < VR.Traffic.cars.length; i++) {
          if (VR.Traffic.cars[i] && VR.Traffic.cars[i].group === o) {
            return { kind: 'traffic', car: VR.Traffic.cars[i] };
          }
        }
      }
      o = o.parent;
    }
    return null;
  }

  function applyTargetDamage(target, dmg) {
    if (!target) return;
    if (target.kind === 'policeCar' || target.kind === 'tact') {
      if (VR.Police && VR.Police.damageTarget) VR.Police.damageTarget(target, dmg);
    } else if (target.kind === 'traffic' && target.car) {
      if (VR.Vehicles && VR.Vehicles.damage) VR.Vehicles.damage(target.car, dmg);
      if (VR.Police && VR.Police.reportCrime) VR.Police.reportCrime('hitCar');
    }
  }

  function impactSpark(x, y, z) {
    if (VR.Effects) {
      if (VR.Effects.spawnFlame) VR.Effects.spawnFlame(x, y, z, 2);
      if (VR.Effects.spawnSmoke) VR.Effects.spawnSmoke(x, y, z, 1);
    }
  }

  // March the ray through the city collision grid: a blocked sample
  // means the bullet hit a building / wall.
  function buildingHit(origin, dir, maxDist, out) {
    if (!VR.World || !VR.World.isBlocked) return -1;
    var step = 0.8;
    for (var d = 1; d < maxDist; d += step) {
      var x = origin.x + dir.x * d;
      var z = origin.z + dir.z * d;
      var y = origin.y + dir.y * d;
      if (y < 0 || y > 60) continue;
      if (VR.World.isBlocked(x, z)) {
        out.set(x, y, z);
        return d;
      }
    }
    return -1;
  }

  // ---------- fists (melee) ----------
  function punch() {
    var w = weapon();
    playerPos(_pp);
    var best = null, bestD2 = w.range * w.range;
    if (VR.Police) {
      for (var i = 0; i < VR.Police.tactUnits.length; i++) {
        var t = VR.Police.tactUnits[i];
        if (!t || t.dead) continue;
        var dx = t.x - _pp.x, dz = t.z - _pp.z;
        var d2 = dx * dx + dz * dz;
        if (d2 >= bestD2) continue;
        // Must be roughly in front of the player.
        var fx = Math.sin(_pp.yaw), fz = Math.cos(_pp.yaw);
        if ((dx * fx + dz * fz) / Math.sqrt(d2 || 1) < 0.4) continue;
        bestD2 = d2; best = { kind: 'tact', unit: t };
      }
    }
    if (best) {
      applyTargetDamage(best, w.damage);
      if (VR.Effects && VR.Effects.shake) VR.Effects.shake(0.12);
      if (VR.Audio && VR.Audio.play) VR.Audio.play('shot');
    } else {
      // Whiff: small shake, no heat (a punch in the air is not a crime).
      if (VR.Effects && VR.Effects.shake) VR.Effects.shake(0.05);
    }
    if (VR.State) VR.State.alarm = { x: _pp.x, z: _pp.z };
  }

  // ---------- shooting ----------
  function shoot() {
    if (!VR.State || VR.State.mode !== 'playing') return false;
    if (cooldown > 0 || reloading) return false;
    var w = weapon();
    if (w.id === 0) {
      cooldown = w.fireInterval;
      punch();
      return true;
    }
    var k = weaponKey(w);
    if (mags[k] <= 0) {
      if (VR.Audio && VR.Audio.play) VR.Audio.play('ui'); // dry click
      reload();
      cooldown = 0.25;
      return false;
    }
    cooldown = w.fireInterval;
    mags[k]--;
    lastShotAt = performance.now() / 1000;

    // Aim from the camera (over-shoulder on foot, chase cam in a car).
    var cam = VR.World ? VR.World.camera : null;
    if (!cam) return false;
    cam.getWorldDirection(_dir);
    // Spread: small random offset on the aim direction.
    _dir.x += (Math.random() - 0.5) * w.spread * 2;
    _dir.y += (Math.random() - 0.5) * w.spread * 2;
    _dir.z += (Math.random() - 0.5) * w.spread * 2;
    _dir.normalize();
    _origin.copy(cam.position);

    // Muzzle: just ahead of the camera, offset right + down (gun hand).
    cam.getWorldDirection(_fwd);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _muzzle.copy(cam.position)
      .addScaledVector(_fwd, 0.7)
      .addScaledVector(_right, 0.28)
      .addScaledVector(_up, -0.18);
    if (VR.State.inCar) _muzzle.y = Math.max(_muzzle.y, 1.1);

    var pellets = w.pellets || 1;
    var anyHit = false;
    for (var p = 0; p < pellets; p++) {
      // Per-pellet spread for the shotgun; single pellet uses _dir.
      var pd = _dir;
      if (pellets > 1) {
        _v3.copy(_dir);
        _v3.x += (Math.random() - 0.5) * w.spread * 2;
        _v3.y += (Math.random() - 0.5) * w.spread * 2;
        _v3.z += (Math.random() - 0.5) * w.spread * 2;
        _v3.normalize();
        pd = _v3;
      }
      _ray.set(_origin, pd);
      _ray.far = w.range;
      // Sprites in the car groups (headlight / rotator glows) need a
      // camera on the raycaster or their raycast throws on null
      // matrixWorld — the aim camera is the right one.
      _ray.camera = cam;
      var hits = _ray.intersectObjects(collectTargets(), true);
      var endD = w.range;
      var hitPoint = null;
      if (hits.length > 0) {
        endD = hits[0].distance;
        hitPoint = hits[0].point;
        applyTargetDamage(targetOf(hits[0].object), w.damage);
        anyHit = true;
      }
      // Building hit closer than any car hit?
      var bD = buildingHit(_origin, pd, Math.min(endD, w.range), _hit);
      if (bD > 0) {
        endD = bD;
        hitPoint = _hit;
      }
      // Tracer end: hit point, or max range.
      if (hitPoint) {
        if (VR.Effects && VR.Effects.tracer) VR.Effects.tracer(_muzzle, hitPoint);
        impactSpark(hitPoint.x, hitPoint.y, hitPoint.z);
      } else {
        _hit.copy(_origin).addScaledVector(pd, w.range);
        if (VR.Effects && VR.Effects.tracer) VR.Effects.tracer(_muzzle, _hit);
      }
    }

    if (VR.Effects) {
      if (VR.Effects.muzzleFlash) VR.Effects.muzzleFlash(_muzzle, _dir);
      if (VR.Effects.shake) VR.Effects.shake(w.id === 3 ? 0.4 : (w.id === 2 ? 0.1 : 0.18));
    }
    if (VR.Audio && VR.Audio.play) VR.Audio.play('shot');
    // A loud shot is a crime: +1 heat, pedestrians panic.
    if (VR.Police && VR.Police.addHeat) VR.Police.addHeat(1);
    playerPos(_pp);
    if (VR.State) VR.State.alarm = { x: _pp.x, z: _pp.z };
    syncAmmoHUD();
    return true;
  }

  // ---------- update ----------
  function update(dt) {
    if (!VR.State || VR.State.mode !== 'playing') {
      triggerEdge = false;
      return;
    }
    cooldown = Math.max(0, cooldown - dt);
    if (reloading) {
      reloadT -= dt;
      if (reloadT <= 0) finishReload();
    }

    // Weapon switching (Digit1..Digit4) + reload (R).
    if (VR.Input) {
      if (VR.Input.justPressed('Digit1')) selectWeapon(0);
      else if (VR.Input.justPressed('Digit2')) selectWeapon(1);
      else if (VR.Input.justPressed('Digit3')) selectWeapon(2);
      else if (VR.Input.justPressed('Digit4')) selectWeapon(3);
      if (VR.Input.justPressed('KeyR')) reload();
    }

    // Aim state follows the right mouse button.
    if (VR.State) VR.State.aiming = aiming;
    syncCrosshair();

    // Trigger: semi-auto fires on the press edge, auto fires while held.
    var w = weapon();
    if (w.auto) {
      if (triggerDown) shoot();
    } else if (triggerEdge) {
      shoot();
    }
    triggerEdge = false;
    syncAmmoHUD();
  }

  VR.Combat = {
    shoot: shoot,
    update: update,
    selectWeapon: selectWeapon,
    reload: reload,
    setAiming: setAiming,
    get cooldown() { return cooldown; },
    get reloading() { return reloading; },
    get lastShotAt() { return lastShotAt; },
    get mags() { return mags; },
    get aiming() { return aiming; }
  };

})(window.VR = window.VR || {});
