// economy.js — Slice E: money / respect, weapon shop, garage
// (repair + repaint), safehouse (heal + save) for VANDARA RUSH.
// Money and respect mirror VR.State via getters/setters so every module
// reads one truth. All HUD / Save / vehicle calls are guarded.
// Prices are set here (VR.Config carries no price table — see report).
(function (VR) {
  'use strict';

  // ---- Prices (USD in-game, from the starting purse of $28,400) ----
  var PRICES = {
    pistol: 1200,        // buy the pistol (includes 48 rounds)
    smg: 2500,           // buy the SMG (includes 120 rounds)
    shotgun: 2200,       // buy the shotgun (includes 18 shells)
    ammoPistol: 150,     // 24 pistol rounds
    ammoSmg: 350,        // 60 SMG rounds
    ammoShotgun: 300,    // 12 shells
    repair: 400,         // full car repair
    repaint: 600         // new paint job
  };

  var AMMO_PACK = { pistol: 24, smg: 60, shotgun: 12 };
  var WEAPON_KEY = { 1: 'pistol', 2: 'smg', 3: 'shotgun' };
  var WEAPON_NAME = { 1: 'Pistol', 2: 'SMG', 3: 'Shotgun' };
  var PAINTS = [0x1fd6c1, 0xd23c3c, 0xffc21c, 0x1f8fff, 0xe8e4d8, 0x8a5a3b];
  var PAINT_NAMES = ['Teal', 'Red', 'Yellow', 'Blue', 'White', 'Brown'];

  // ---- Interaction spots (road-grid points, read by the minimap) ----
  var SPOTS = [
    { id: 'gunshop', name: 'Kencana Gun Shop', x: 90, z: 210, radius: 6,
      hint: 'Press E — Gun Shop (buy ammo / weapons)' },
    { id: 'garage', name: 'Soraya\'s Garage', x: -30, z: 150, radius: 6,
      hint: 'Press E — Soraya\'s Garage (repair / repaint car)' },
    { id: 'safehouse', name: 'Safehouse Damian', x: -150, z: -210, radius: 6,
      hint: 'Press E — Safehouse (restore health + save)' }
  ];

  var _money = 0;
  var _respect = 0;
  var _owned = { pistol: true, smg: false, shotgun: false }; // pistol owned from start (48 rounds in VR.State)
  var _paintIdx = 0;
  var _nearId = null; // spot id the player is currently inside
  var _promptedId = null;

  function stateMoney() { return VR.State ? (VR.State.money || 0) : _money; }
  function stateRespect() { return VR.State ? (VR.State.respect || 0) : _respect; }

  function setMoney(n) {
    n = Math.max(0, Math.floor(n));
    _money = n;
    if (VR.State) VR.State.money = n;
  }

  function setRespect(n) {
    n = Math.max(0, Math.floor(n));
    _respect = n;
    if (VR.State) VR.State.respect = n;
  }

  function addMoney(n) {
    setMoney(stateMoney() + n);
    return stateMoney();
  }

  function addRespect(n) {
    setRespect(stateRespect() + n);
    return stateRespect();
  }

  function toast(text) {
    if (VR.HUD && VR.HUD.showToast) {
      try { VR.HUD.showToast(text); } catch (e) { /* HUD optional */ }
    }
  }

  function spend(n) {
    if (stateMoney() < n) { toast('Not enough money — need $' + n + '.'); return false; }
    setMoney(stateMoney() - n);
    return true;
  }

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

  // ---- Weapon shop: E buys ammo for the current weapon, or the next
  // weapon the player does not own yet (fists -> pistol first). ----
  function buyAtGunshop() {
    var w = VR.State ? (VR.State.weapon || 0) : 0;
    if (w === 0) {
      if (!_owned.pistol) {
        if (!spend(PRICES.pistol)) return;
        _owned.pistol = true;
        if (VR.State) {
          VR.State.weapon = 1;
          VR.State.ammo.pistol = (VR.State.ammo.pistol || 0) + 48;
        }
        toast('Pistol bought — $' + PRICES.pistol + ' (48 rounds).');
        if (VR.Audio && VR.Audio.play) { try { VR.Audio.play('pickup'); } catch (e) {} }
        return;
      }
      if (VR.State) VR.State.weapon = 1;
      w = 1;
    }
    var key = WEAPON_KEY[w];
    if (!key) { toast('Kencana Gun Shop — nothing to buy here.'); return; }
    if (!_owned[key]) {
      var price = PRICES[key];
      if (!spend(price)) return;
      _owned[key] = true;
      if (VR.State) VR.State.ammo[key] = (VR.State.ammo[key] || 0) + AMMO_PACK[key] * 2;
      toast(WEAPON_NAME[w] + ' bought — $' + price + '.');
    } else {
      var ap = key === 'pistol' ? PRICES.ammoPistol : key === 'smg' ? PRICES.ammoSmg : PRICES.ammoShotgun;
      if (!spend(ap)) return;
      if (VR.State) VR.State.ammo[key] = (VR.State.ammo[key] || 0) + AMMO_PACK[key];
      toast('Ammo ' + WEAPON_NAME[w] + ' +' + AMMO_PACK[key] + ' — $' + ap + '.');
    }
    if (VR.Audio && VR.Audio.play) { try { VR.Audio.play('pickup'); } catch (e) {} }
  }

  // ---- Garage: E repairs the driven car, or repaints it when healthy. ----
  function carMaxHp(car) {
    if (VR.Config && VR.Config.VEHICLES && VR.Config.VEHICLES[car.type]) {
      return VR.Config.VEHICLES[car.type].hp || 100;
    }
    return 100;
  }

  function repaintCar(car) {
    // Recolour the most-used body material (the shared paint instance).
    if (!car.body) return false;
    var counts = {};
    var mats = [];
    car.body.traverse(function (o) {
      if (o.material && o.material.color) {
        var idx = mats.indexOf(o.material);
        if (idx < 0) { mats.push(o.material); counts[mats.length - 1] = 1; }
        else counts[idx]++;
      }
    });
    if (!mats.length) return false;
    var best = 0, bestN = 0;
    for (var i = 0; i < mats.length; i++) {
      if (counts[i] > bestN) { bestN = counts[i]; best = i; }
    }
    _paintIdx = (_paintIdx + 1) % PAINTS.length;
    mats[best].color.setHex(PAINTS[_paintIdx]);
    return true;
  }

  function useGarage() {
    if (!VR.State || !VR.State.inCar || !VR.State.car) {
      toast('Soraya\'s Garage — bring your car here to be repaired or repainted.');
      return;
    }
    var car = VR.State.car;
    var maxHp = carMaxHp(car);
    if ((car.hp || 0) < maxHp) {
      if (!spend(PRICES.repair)) return;
      car.hp = maxHp;
      if (car.dead) { car.dead = false; car.wrecked = false; if (car.group) car.group.visible = true; }
      toast('Car repaired — $' + PRICES.repair + '. Back in top condition.');
    } else {
      if (!spend(PRICES.repaint)) return;
      if (repaintCar(car)) {
        toast('New paint: ' + PAINT_NAMES[_paintIdx] + ' — $' + PRICES.repaint + '.');
      } else {
        setMoney(stateMoney() + PRICES.repaint);
        toast('Repaint failed — money refunded.');
      }
    }
    if (VR.Audio && VR.Audio.play) { try { VR.Audio.play('pickup'); } catch (e) {} }
  }

  // ---- Safehouse: heal + save. ----
  function useSafehouse() {
    if (VR.State) {
      VR.State.health = 100;
      VR.State.armor = 50;
      if (VR.Player) { VR.Player.health = 100; VR.Player.armor = 50; }
    }
    var saved = false;
    if (VR.Save && VR.Save.save) {
      try { saved = VR.Save.save(); } catch (e) { saved = false; }
    }
    toast(saved ? 'Safehouse — health restored, game saved.' : 'Safehouse — health restored.');
    if (VR.Audio && VR.Audio.play) { try { VR.Audio.play('pickup'); } catch (e) {} }
  }

  function interact(spotId) {
    if (spotId === 'gunshop') buyAtGunshop();
    else if (spotId === 'garage') useGarage();
    else if (spotId === 'safehouse') useSafehouse();
  }

  // ---- per-frame (called from VR.Missions.update — main.js only calls
  // Missions.update — plus the KeyE listener below). ----
  function update(dt) {
    if (!VR.State || VR.State.mode !== 'playing') { _nearId = null; return; }
    if (!playerXZ(_pp)) { _nearId = null; return; }
    var found = null;
    for (var i = 0; i < SPOTS.length; i++) {
      var s = SPOTS[i];
      var dx = _pp.x - s.x, dz = _pp.z - s.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) { found = s; break; }
    }
    _nearId = found ? found.id : null;
    if (found && _promptedId !== found.id) {
      _promptedId = found.id;
      toast(found.hint);
    }
    if (!found) _promptedId = null;
    // Note: E-key interaction is handled by the keydown listener below
    // (not justPressed here) so a single press can never buy twice.
  }

  // KeyE listener as a backstop: if a future main.js stops calling
  // update() every frame, E still works while standing in a spot.
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyE') return;
    if (!VR.State || VR.State.mode !== 'playing') return;
    if (_nearId) interact(_nearId);
  });

  // Keep the local mirror in sync if VR.State appears after this file.
  if (VR.State) { _money = VR.State.money || 0; _respect = VR.State.respect || 0; }

  VR.Economy = {
    get money() { return stateMoney(); },
    set money(n) { setMoney(n); },
    get respect() { return stateRespect(); },
    set respect(n) { setRespect(n); },
    addMoney: addMoney,
    addRespect: addRespect,
    prices: PRICES,
    spots: SPOTS,
    get nearSpot() { return _nearId; },
    interact: interact,
    useSafehouse: useSafehouse,
    useGarage: useGarage,
    buyAtGunshop: buyAtGunshop,
    update: update
  };

})(window.VR = window.VR || {});
