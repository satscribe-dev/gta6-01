// save.js — Slice E: save / load for VANDARA RUSH.
// Serialises the relevant VR.State (mission, money, respect, health,
// armour, clock, weapons + ammo, player position) to localStorage key
// 'vandara-rush-save-v1'. VR.Menus reads hasSave() for the Continue
// button; VR.Missions auto-saves on mission completion and VR.Economy
// saves at the safehouse. All storage access is guarded: a missing or
// blocked localStorage (private mode, headless) just returns false.
(function (VR) {
  'use strict';

  var KEY = 'vandara-rush-save-v1';

  function storageGet() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function storageSet(text) {
    try { window.localStorage.setItem(KEY, text); return true; } catch (e) { return false; }
  }

  function hasSave() {
    return storageGet() !== null;
  }

  function save() {
    if (!VR.State) return false;
    try {
      var pos = null;
      if (VR.Player && VR.Player.pos) {
        pos = { x: VR.Player.pos.x, z: VR.Player.pos.z };
      } else if (VR.State.inCar && VR.State.car && VR.State.car.group) {
        pos = { x: VR.State.car.group.position.x, z: VR.State.car.group.position.z };
      }
      var data = {
        v: 1,
        mission: (VR.Missions && typeof VR.Missions.current === 'number')
          ? VR.Missions.current : (VR.State.mission || 0),
        money: VR.State.money || 0,
        respect: VR.State.respect || 0,
        health: VR.State.health || 100,
        armor: VR.State.armor || 0,
        timeMinutes: VR.State.timeMinutes || 0,
        day: VR.State.day || 1,
        weapon: VR.State.weapon || 0,
        ammo: VR.State.ammo
          ? { pistol: VR.State.ammo.pistol || 0, smg: VR.State.ammo.smg || 0, shotgun: VR.State.ammo.shotgun || 0 }
          : { pistol: 48, smg: 120, shotgun: 18 },
        pos: pos,
        night: !!VR.State.night
      };
      return storageSet(JSON.stringify(data));
    } catch (e) {
      return false;
    }
  }

  function load() {
    var raw = storageGet();
    if (!raw) return false;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || typeof data !== 'object' || data.v !== 1) return false;
    if (!VR.State) return false;
    try {
      if (typeof data.mission === 'number') VR.State.mission = Math.max(0, Math.min(7, data.mission));
      if (typeof data.money === 'number') VR.State.money = Math.max(0, data.money);
      if (typeof data.respect === 'number') VR.State.respect = Math.max(0, data.respect);
      if (typeof data.health === 'number') VR.State.health = Math.max(1, Math.min(100, data.health));
      if (typeof data.armor === 'number') VR.State.armor = Math.max(0, Math.min(100, data.armor));
      if (typeof data.timeMinutes === 'number') VR.State.timeMinutes = data.timeMinutes;
      if (typeof data.day === 'number') VR.State.day = data.day;
      if (typeof data.weapon === 'number') VR.State.weapon = data.weapon;
      if (data.ammo) {
        VR.State.ammo = {
          pistol: data.ammo.pistol || 0,
          smg: data.ammo.smg || 0,
          shotgun: data.ammo.shotgun || 0
        };
      }
      if (typeof data.night === 'boolean') VR.State.night = data.night;
      if (data.pos && VR.Player && VR.Player.pos) {
        VR.Player.pos.set(data.pos.x || 0, 0, data.pos.z || 0);
        if (typeof VR.Player.health === 'number') VR.Player.health = VR.State.health;
        if (typeof VR.Player.armor === 'number') VR.Player.armor = VR.State.armor;
      }
      if (VR.World && VR.World.setTimeOfDay && typeof data.timeMinutes === 'number') {
        try { VR.World.setTimeOfDay(data.timeMinutes); } catch (e) { /* optional */ }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { window.localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  VR.Save = {
    save: save,
    load: load,
    hasSave: hasSave,
    clear: clear,
    key: KEY
  };

})(window.VR = window.VR || {});
