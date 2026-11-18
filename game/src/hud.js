// hud.js — VR.HUD: DOM HUD for VANDARA RUSH (DESIGN.md §6).
// Reads VR.State every frame (money, clock, wanted, speedo, weapon,
// radio) and renders it into the #hud DOM. Every access to a module
// from another slice (Missions, Police, Audio, Economy, Save) is
// guarded with `if (VR.X)` so the HUD never crashes when that slice
// has not loaded yet. No network, no external fonts.
(function (VR) {
  'use strict';

  // VR.State is created by main.js, which loads AFTER this file, so
  // never capture it at load time: a live proxy reads/writes the
  // real State object on every access.
  var S = new Proxy({}, {
    get: function (_, k) { return VR.State ? VR.State[k] : undefined; },
    set: function (_, k, v) { if (VR.State) VR.State[k] = v; return true; }
  });

  function $(id) { return document.getElementById(id); }

  // ---------- cached element handles ----------
  var el = {};
  var IDS = ['hud', 'mission-box', 'mission-title', 'mission-objective',
    'mission-toast', 'dialogue-box', 'dialogue-name', 'dialogue-text',
    'dialogue-portrait', 'money', 'clock', 'weather-icon', 'wanted-stars',
    'speedo', 'speed-value', 'gear', 'nitro-bar', 'condition-bar',
    'weapon-slot', 'weapon-icon', 'weapon-ammo', 'radio-capsule',
    'controls-hint', 'crosshair'];
  for (var i = 0; i < IDS.length; i++) el[IDS[i]] = $(IDS[i]);

  // ---------- wanted stars (5, built once) ----------
  var starSpans = [];
  if (el['wanted-stars']) {
    for (var s = 0; s < 5; s++) {
      var sp = document.createElement('span');
      sp.className = 'wanted-star';
      sp.textContent = '\u2605'; // ★
      el['wanted-stars'].appendChild(sp);
      starSpans.push(sp);
    }
  }

  // ---------- weapon silhouettes (inline SVG, drawn — never text) ----------
  var WEAPON_SVG = {
    0: '<svg viewBox="0 0 64 40" aria-label="Fists"><g fill="#e8e4d8" stroke="#111" stroke-width="1.5"><path d="M14 26 V14 a4 4 0 0 1 8 0 V12 a4 4 0 0 1 8 0 V11 a4 4 0 0 1 8 0 V13 a4 4 0 0 1 8 0 v13 c0 8 -6 12 -14 12 c-9 0 -18 -4 -18 -12z"/><path d="M30 26 v8 M38 26 v8" stroke="#111" fill="none"/></g></svg>',
    1: '<svg viewBox="0 0 64 40" aria-label="Pistol"><g fill="#d8d8dc" stroke="#111" stroke-width="1.5"><path d="M8 10 h40 a3 3 0 0 1 3 3 v4 H14 l-2 14 a3 3 0 0 1 -3 3 h-3 a3 3 0 0 1 -3 -3 V13 a3 3 0 0 1 3 -3z"/><rect x="34" y="6" width="10" height="5" rx="1"/><rect x="18" y="17" width="6" height="5" fill="#8a6f4d"/></g></svg>',
    2: '<svg viewBox="0 0 64 40" aria-label="SMG"><g fill="#c8ccd4" stroke="#111" stroke-width="1.5"><path d="M6 12 h44 v7 H28 l-3 5 H14 l-2 10 a3 3 0 0 1 -3 3 h-2 a3 3 0 0 1 -3 -3 V15 a3 3 0 0 1 3 -3z"/><rect x="50" y="14" width="10" height="4"/><rect x="22" y="19" width="5" height="12" fill="#8a6f4d"/><rect x="30" y="8" width="14" height="4" rx="1"/></g></svg>',
    3: '<svg viewBox="0 0 64 40" aria-label="Shotgun"><g fill="#a88a5a" stroke="#111" stroke-width="1.5"><rect x="6" y="13" width="34" height="7" rx="2"/><rect x="40" y="14" width="18" height="5" fill="#5a5f66"/><path d="M8 20 h22 l-2 12 a3 3 0 0 1 -3 3 h-4 a3 3 0 0 1 -3 -3z" fill="#7a4a2b"/><rect x="30" y="10" width="6" height="4"/></g></svg>'
  };

  // ---------- character portraits (simple illustrated SVG: face +
  // hair + signature colours per character — never a generic silhouette) ----------
  function portraitSVG(name) {
    var n = (name || '').toLowerCase();
    if (n.indexOf('soraya') !== -1) {
      // Tante Soraya: warm brown skin, dark hair in a bun with grey
      // streaks, gold earrings, teal kebaya collar.
      return '<svg viewBox="0 0 80 80" aria-label="Tante Soraya"><rect width="80" height="80" fill="#1d3a4a"/><circle cx="40" cy="38" r="19" fill="#b97e56"/><path d="M21 36 q-2 -20 19 -20 q21 0 19 20 q-1 -9 -8 -12 q-4 -6 -11 -6 q-7 0 -11 6 q-7 3 -8 12z" fill="#2b2b2b"/><path d="M30 20 q6 -4 12 -1" stroke="#9aa0a6" stroke-width="2" fill="none"/><circle cx="40" cy="16" r="6" fill="#2b2b2b"/><circle cx="33" cy="39" r="2" fill="#1a1a1a"/><circle cx="47" cy="39" r="2" fill="#1a1a1a"/><path d="M34 49 q6 4 12 0" stroke="#7a3b2e" stroke-width="2" fill="none"/><circle cx="22" cy="42" r="2.4" fill="#ffd23f"/><circle cx="58" cy="42" r="2.4" fill="#ffd23f"/><path d="M18 80 v-8 q22 -10 44 0 v8z" fill="#0e7c7b"/><path d="M36 72 l4 6 4 -6" stroke="#ffd23f" stroke-width="1.6" fill="none"/></svg>';
    }
    if (n.indexOf('bramantyo') !== -1 || n.indexOf('inspektur') !== -1) {
      // Inspector Bramantyo: police cap, heavy moustache, stern brow.
      return '<svg viewBox="0 0 80 80" aria-label="Inspektur Bramantyo"><rect width="80" height="80" fill="#232a35"/><circle cx="40" cy="40" r="19" fill="#c98d64"/><path d="M20 34 q0 -16 20 -16 q20 0 20 16 l-3 1 q-17 -7 -34 0z" fill="#14181f"/><rect x="18" y="30" width="44" height="5" rx="2" fill="#14181f"/><circle cx="40" cy="23" r="4" fill="#ffd23f"/><path d="M30 36 l6 1 M44 37 l6 -1" stroke="#1a1a1a" stroke-width="2.4"/><circle cx="33" cy="42" r="2" fill="#1a1a1a"/><circle cx="47" cy="42" r="2" fill="#1a1a1a"/><path d="M31 50 q9 6 18 0 q-2 5 -9 5 q-7 0 -9 -5z" fill="#3a2a22"/><path d="M18 80 v-8 q22 -10 44 0 v8z" fill="#1c2b45"/><path d="M40 74 v6 M32 76 l8 -2 8 2" stroke="#ffd23f" stroke-width="1.4" fill="none"/></svg>';
    }
    if (n.indexOf('halim') !== -1 || n.indexOf('victor') !== -1) {
      // Victor Halim: slicked grey-streaked hair, thin scar, dark suit.
      return '<svg viewBox="0 0 80 80" aria-label="Victor Halim"><rect width="80" height="80" fill="#3a1f2b"/><circle cx="40" cy="39" r="19" fill="#d9a67e"/><path d="M22 34 q-1 -18 18 -18 q19 0 18 18 q-6 -9 -18 -9 q-12 0 -18 9z" fill="#3a3a3a"/><path d="M30 19 q8 -3 16 0" stroke="#c8c8c8" stroke-width="1.6" fill="none"/><path d="M30 40 l4 -6" stroke="#a34a3a" stroke-width="1.6"/><circle cx="33" cy="40" r="2" fill="#1a1a1a"/><circle cx="47" cy="40" r="2" fill="#1a1a1a"/><path d="M34 51 q6 3 12 0" stroke="#7a3b2e" stroke-width="2" fill="none"/><path d="M18 80 v-8 q22 -10 44 0 v8z" fill="#1f1f26"/><path d="M40 74 l-4 6 h8z" fill="#8a1f2b"/></svg>';
    }
    // Damian Reyes (default): young, black side-swept hair, blue shirt.
    return '<svg viewBox="0 0 80 80" aria-label="Damian Reyes"><rect width="80" height="80" fill="#274b63"/><circle cx="40" cy="39" r="19" fill="#c98d64"/><path d="M21 36 q-2 -19 19 -19 q21 0 19 19 q-5 -11 -14 -12 q-3 -5 -10 -4 q-8 1 -14 16z" fill="#1a1a1a"/><circle cx="33" cy="40" r="2" fill="#1a1a1a"/><circle cx="47" cy="40" r="2" fill="#1a1a1a"/><path d="M34 50 q6 4 12 0" stroke="#7a3b2e" stroke-width="2" fill="none"/><path d="M18 80 v-8 q22 -10 44 0 v8z" fill="#2e86c1"/><path d="M36 73 l4 5 4 -5" stroke="#e8e4d8" stroke-width="1.4" fill="none"/></svg>';
  }

  // ---------- weather icon (sun / moon SVG) ----------
  var SUN_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffd23f"/><g stroke="#ffd23f" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></g></svg>';
  var MOON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" fill="#cdd6ff"/></svg>';

  // ---------- dialogue typewriter ----------
  var dlgFull = '';
  var dlgShown = 0;
  var dlgTimer = null;
  var dlgSpeed = 90; // chars per second — full text well before __shotReady
  var dialogueComplete = true;

  function finishDialogue() {
    if (dlgTimer) { clearInterval(dlgTimer); dlgTimer = null; }
    dlgShown = dlgFull.length;
    if (el['dialogue-text']) el['dialogue-text'].textContent = dlgFull;
    dialogueComplete = true;
  }

  function showDialogue(name, role, text) {
    dlgFull = String(text || '');
    dlgShown = 0;
    dialogueComplete = (dlgFull.length === 0);
    if (el['dialogue-name']) {
      el['dialogue-name'].textContent = name || '';
      var roleEl = document.getElementById('dialogue-role');
      if (roleEl) roleEl.textContent = role || '';
    }
    if (el['dialogue-portrait']) el['dialogue-portrait'].innerHTML = portraitSVG(name);
    if (el['dialogue-text']) el['dialogue-text'].textContent = '';
    if (el['dialogue-box']) el['dialogue-box'].classList.add('visible');
    if (dlgTimer) clearInterval(dlgTimer);
    if (dlgFull.length === 0) return;
    var step = Math.max(1, Math.round(dlgSpeed / 30));
    dlgTimer = setInterval(function () {
      dlgShown = Math.min(dlgFull.length, dlgShown + step);
      if (el['dialogue-text']) {
        // Never cut mid-word visually: extend to the next space if the
        // cut lands inside a word, unless the word is the last one.
        var cut = dlgShown;
        if (cut < dlgFull.length && dlgFull.charAt(cut) !== ' ' &&
            dlgFull.charAt(cut - 1) !== ' ') {
          var sp = dlgFull.indexOf(' ', cut);
          if (sp !== -1 && sp - cut <= 10) cut = sp;
        }
        el['dialogue-text'].textContent = dlgFull.slice(0, cut);
      }
      if (dlgShown >= dlgFull.length) finishDialogue();
    }, 1000 / 30);
  }

  // Click the subtitle to reveal the full line at once.
  if (el['dialogue-box']) {
    el['dialogue-box'].addEventListener('click', finishDialogue);
  }

  // ---------- toast ----------
  var toastTimer = null;
  function showToast(text) {
    if (!el['mission-toast']) return;
    el['mission-toast'].textContent = String(text || '');
    el['mission-toast'].classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el['mission-toast'].classList.remove('visible');
    }, 4200);
  }

  // ---------- crosshair: right mouse button = aim ----------
  var aiming = false;
  document.addEventListener('mousedown', function (e) {
    if (e.button === 2) aiming = true;
  });
  document.addEventListener('mouseup', function (e) {
    if (e.button === 2) aiming = false;
  });
  document.addEventListener('contextmenu', function (e) {
    // The game canvas owns right-click aiming; never show the menu.
    if (S.mode === 'playing') e.preventDefault();
  });
  document.addEventListener('blur', function () { aiming = false; });

  // ---------- helpers ----------
  function fmtMoney(n) {
    n = Math.round(n || 0);
    return '$' + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtClock(minutes, day) {
    var m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm +
      '  ·  DAY ' + (day || 1);
  }
  function isNight() {
    if (S.night) return true;
    var m = ((S.timeMinutes || 0) % 1440 + 1440) % 1440;
    return m >= 19 * 60 || m < 6 * 60;
  }

  // Last rendered values — skip DOM writes when nothing changed.
  var last = { money: null, clock: null, wanted: -1, night: null,
    speed: null, gear: null, nitro: null, cond: null, weapon: -1,
    ammo: null, radio: null, mission: null, objective: null,
    health: null, armor: null, inCar: null, aiming: null };

  function update(dt) {
    if (!el.hud) return;
    // HUD is only visible while playing (menus hide it on title/pause).
    if (S.mode !== 'playing') return;

    // ---- money (Economy wins when present, else State) ----
    var money = (VR.Economy && typeof VR.Economy.money === 'number')
      ? VR.Economy.money : S.money;
    var moneyTxt = fmtMoney(money);
    if (last.money !== moneyTxt && el.money) {
      el.money.textContent = moneyTxt;
      last.money = moneyTxt;
    }

    // ---- clock + weather ----
    var clockTxt = fmtClock(S.timeMinutes, S.day);
    if (last.clock !== clockTxt && el.clock) {
      el.clock.textContent = clockTxt;
      last.clock = clockTxt;
    }
    var night = isNight();
    if (last.night !== night && el['weather-icon']) {
      el['weather-icon'].innerHTML = night ? MOON_SVG : SUN_SVG;
      el['weather-icon'].setAttribute('title', night ? 'Night' : 'Day');
      last.night = night;
    }

    // ---- wanted stars (Police wins when present, else State) ----
    var wanted = (VR.Police && typeof VR.Police.wanted === 'number')
      ? VR.Police.wanted : (S.wanted || 0);
    wanted = Math.max(0, Math.min(5, Math.round(wanted)));
    if (last.wanted !== wanted) {
      for (var s = 0; s < starSpans.length; s++) {
        starSpans[s].classList.toggle('active', s < wanted);
      }
      if (el['wanted-stars']) {
        el['wanted-stars'].classList.toggle('hot', wanted > 0);
      }
      last.wanted = wanted;
    }

    // ---- mission box ----
    var missionIdx = (VR.Missions && typeof VR.Missions.current === 'number')
      ? VR.Missions.current : (S.mission || 0);
    var mTitle = '', mObj = '';
    if (VR.Missions && VR.Missions.list && VR.Missions.list[missionIdx]) {
      mTitle = VR.Missions.list[missionIdx].title || '';
    } else if (VR.Config && VR.Config.MISSIONS && VR.Config.MISSIONS[missionIdx]) {
      mTitle = VR.Config.MISSIONS[missionIdx].title || '';
    }
    if (VR.Missions && typeof VR.Missions.objectiveText === 'string' &&
        VR.Missions.objectiveText) {
      mObj = VR.Missions.objectiveText;
    } else if (VR.Config && VR.Config.MISSIONS && VR.Config.MISSIONS[missionIdx]) {
      mObj = VR.Config.MISSIONS[missionIdx].objective || '';
    }
    var missionKey = (missionIdx + 1) + '|' + mTitle;
    if (last.mission !== missionKey && el['mission-title']) {
      el['mission-title'].textContent = 'MISSION ' + (missionIdx + 1) + ' — ' + mTitle;
      last.mission = missionKey;
    }
    if (last.objective !== mObj && el['mission-objective']) {
      el['mission-objective'].textContent = mObj;
      last.objective = mObj;
    }

    // ---- in-car vs on-foot panels ----
    var inCar = !!S.inCar;
    if (last.inCar !== inCar) {
      if (el.speedo) el.speedo.classList.toggle('hidden', !inCar);
      if (el['weapon-slot']) el['weapon-slot'].classList.toggle('hidden', inCar);
      if (el['radio-capsule']) el['radio-capsule'].classList.toggle('hidden', !inCar);
      last.inCar = inCar;
    }

    if (inCar) {
      var car = S.car || (VR.Vehicles && VR.Vehicles.playerCar);
      var kmh = 0, nitro = 100, cond = 100, reverse = false;
      if (typeof S.speedKmh === 'number') kmh = S.speedKmh;
      if (car) {
        if (typeof car.speed === 'number') {
          kmh = Math.abs(car.speed) * 3.6;
          reverse = car.speed < -0.5;
        }
        if (typeof car.nitroFuel === 'number') nitro = car.nitroFuel;
        if (typeof car.hp === 'number') cond = car.hp;
      }
      var kmhR = Math.round(kmh);
      if (last.speed !== kmhR && el['speed-value']) {
        el['speed-value'].textContent = String(kmhR);
        last.speed = kmhR;
      }
      var gear = reverse ? 'R' : (kmhR < 1 ? 'N' : kmhR < 35 ? '1' : kmhR < 65 ? '2' :
        kmhR < 95 ? '3' : kmhR < 125 ? '4' : kmhR < 155 ? '5' : '6');
      if (last.gear !== gear && el.gear) {
        el.gear.textContent = gear;
        last.gear = gear;
      }
      var nitroR = Math.round(nitro);
      if (last.nitro !== nitroR && el['nitro-bar']) {
        el['nitro-bar'].style.width = nitroR + '%';
        el['nitro-bar'].classList.toggle('low', nitroR < 25);
        last.nitro = nitroR;
      }
      var condR = Math.round(cond);
      if (last.cond !== condR && el['condition-bar']) {
        el['condition-bar'].style.width = condR + '%';
        el['condition-bar'].classList.toggle('low', condR < 35);
        last.cond = condR;
      }
      // Radio capsule (Audio wins, else Config data).
      var station = '';
      if (VR.Audio) {
        if (typeof VR.Audio.stationName === 'function') {
          try { station = VR.Audio.stationName(); } catch (err) { station = ''; }
        } else if (typeof VR.Audio.station === 'number' &&
            VR.Config && VR.Config.RADIO && VR.Config.RADIO[VR.Audio.station]) {
          station = VR.Config.RADIO[VR.Audio.station].name;
        }
      }
      if (!station && VR.Config && VR.Config.RADIO && VR.Config.RADIO[0]) {
        station = VR.Config.RADIO[0].name;
      }
      if (last.radio !== station && el['radio-capsule']) {
        el['radio-capsule'].textContent = station ? ('♪ ' + station + '  ·  [Q] switch station') : '';
        last.radio = station;
      }
    } else {
      // ---- on-foot weapon slot ----
      var w = S.weapon || 0;
      if (last.weapon !== w && el['weapon-icon']) {
        el['weapon-icon'].innerHTML = WEAPON_SVG[w] || WEAPON_SVG[0];
        var wName = (VR.Config && VR.Config.WEAPONS && VR.Config.WEAPONS[w])
          ? VR.Config.WEAPONS[w].name : '';
        var slotLabel = document.getElementById('weapon-name');
        if (slotLabel) slotLabel.textContent = wName;
        last.weapon = w;
      }
      var ammoTxt = '';
      if (w === 0) ammoTxt = '—';
      else {
        var key = w === 1 ? 'pistol' : w === 2 ? 'smg' : 'shotgun';
        var reserve = (S.ammo && typeof S.ammo[key] === 'number') ? S.ammo[key] : 0;
        ammoTxt = String(reserve);
      }
      if (last.ammo !== ammoTxt && el['weapon-ammo']) {
        el['weapon-ammo'].textContent = ammoTxt;
        last.ammo = ammoTxt;
      }
    }

    // ---- crosshair: only while aiming (right mouse held) ----
    var showCross = aiming || !!S.aiming;
    if (last.aiming !== showCross && el.crosshair) {
      el.crosshair.classList.toggle('visible', showCross);
      last.aiming = showCross;
    }

    // ---- dialogue auto-hide: once fully typed it lingers, then fades
    // after 6s (a new showDialogue re-opens it). Keep it simple: the
    // box stays until the next dialogue or a manual hide. ----
  }

  function hideDialogue() {
    finishDialogue();
    if (el['dialogue-box']) el['dialogue-box'].classList.remove('visible');
  }

  VR.HUD = {
    update: update,
    showDialogue: showDialogue,
    showToast: showToast,
    hideDialogue: hideDialogue,
    get dialogueComplete() { return dialogueComplete; },
    show: function () { if (el.hud) el.hud.style.display = 'block'; },
    hide: function () { if (el.hud) el.hud.style.display = 'none'; }
  };

})(window.VR = window.VR || {});
