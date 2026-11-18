// menus.js — VR.Menus: title screen, pause menu (full city map +
// legend + stats), controls and settings for VANDARA RUSH.
// The gameplay camera is never touched here: main.js already runs
// the title orbit while mode === 'title', and player.js owns the
// gameplay cameras. Every Save/Audio/Missions/Police read is guarded
// (`if (VR.X)`) so the menus work before slice D/E exist.
(function (VR) {
  'use strict';

  // VR.State is created by main.js, which loads AFTER this file, so
  // never capture it at load time: a live proxy reads/writes the
  // real State object on every access.
  var S = new Proxy({}, {
    get: function (_, k) { return VR.State ? VR.State[k] : undefined; },
    set: function (_, k, v) { if (VR.State) VR.State[k] = v; return true; }
  });

  // ---------- settings (persisted to localStorage only when VR.Save
  // exists — slice E; until then they live in memory) ----------
  var settings = { volume: 0.8, sensitivity: 1.0 };
  function loadSettings() {
    if (!VR.Save) return;
    try {
      var raw = window.localStorage.getItem('vandara_settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (typeof parsed.volume === 'number') settings.volume = parsed.volume;
        if (typeof parsed.sensitivity === 'number') settings.sensitivity = parsed.sensitivity;
      }
    } catch (err) { /* storage unavailable — keep defaults */ }
  }
  function saveSettings() {
    if (!VR.Save) return;
    try {
      window.localStorage.setItem('vandara_settings', JSON.stringify(settings));
    } catch (err) { /* ignore */ }
  }
  loadSettings();
  if (VR.Audio && typeof VR.Audio.setVolume === 'function') {
    try { VR.Audio.setVolume(settings.volume); } catch (err) { /* ignore */ }
  }

  // ---------- DOM helpers ----------
  function mk(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function hideOldTitleCard() {
    var t = document.getElementById('title-card');
    if (t) t.style.display = 'none';
  }

  // ---------- title screen ----------
  var titleScreen = mk('div', 'vr-menu');
  titleScreen.id = 'title-screen';
  titleScreen.innerHTML =
    '<div class="vr-logo"><h1>VANDARA <span class="rush">RUSH</span></h1>' +
    '<p>VANDARA BAY &middot; GOLDEN HOUR</p>' +
    '<div class="click-start" id="title-click-start">CLICK TO START</div></div>' +
    '<div class="vr-btn-col">' +
    '<button class="vr-btn primary" id="btn-continue">CONTINUE</button>' +
    '<button class="vr-btn" id="btn-newgame">NEW GAME</button>' +
    '<button class="vr-btn" id="btn-controls">CONTROLS</button>' +
    '<button class="vr-btn" id="btn-settings">SETTINGS</button>' +
    '</div>' +
    '<div class="vr-version">VANDARA RUSH &middot; 8 MISSIONS &middot; 100% OFFLINE</div>';
  document.body.appendChild(titleScreen);

  // ---------- controls panel ----------
  var controlsPanel = mk('div', 'vr-menu');
  controlsPanel.id = 'controls-screen';
  controlsPanel.style.display = 'none';
  controlsPanel.style.background = 'rgba(6,10,20,0.72)';
  controlsPanel.innerHTML =
    '<div class="vr-panel"><h2>Controls</h2>' +
    '<p class="sub">Damian Reyes &middot; Vandara Bay</p>' +
    '<div class="vr-controls-list">' +
    '<div><b>W A S D</b> Walk / drive</div>' +
    '<div><b>Mouse</b> Turn the camera (click to lock)</div>' +
    '<div><b>Shift</b> Run / Nitro (in a car)</div>' +
    '<div><b>Space</b> Jump / Handbrake (in a car)</div>' +
    '<div><b>F</b> Enter / exit car</div>' +
    '<div><b>Right click</b> Aim &middot; <b>Left click</b> Shoot</div>' +
    '<div><b>1 – 4</b> Switch weapon</div>' +
    '<div><b>Q</b> Switch radio station</div>' +
    '<div><b>P / Esc</b> Pause &amp; city map</div>' +
    '</div>' +
    '<div class="btn-row"><button class="vr-btn" id="btn-controls-back">BACK</button></div>' +
    '</div>';
  document.body.appendChild(controlsPanel);

  // ---------- settings panel ----------
  var settingsPanel = mk('div', 'vr-menu');
  settingsPanel.id = 'settings-screen';
  settingsPanel.style.display = 'none';
  settingsPanel.style.background = 'rgba(6,10,20,0.72)';
  settingsPanel.innerHTML =
    '<div class="vr-panel"><h2>Settings</h2>' +
    '<p class="sub">Saved automatically on this device</p>' +
    '<label class="row">Volume <input type="range" id="set-volume" min="0" max="100" step="1"><span class="row-val" id="set-volume-val"></span></label>' +
    '<label class="row">Mouse sensitivity <input type="range" id="set-sens" min="20" max="200" step="5"><span class="row-val" id="set-sens-val"></span></label>' +
    '<div class="btn-row"><button class="vr-btn" id="btn-settings-back">BACK</button></div>' +
    '</div>';
  document.body.appendChild(settingsPanel);

  // ---------- pause screen (full city map + legend + stats) ----------
  var pauseScreen = mk('div', 'vr-menu');
  pauseScreen.id = 'pause-screen';
  pauseScreen.style.display = 'none';
  pauseScreen.innerHTML =
    '<div id="pause-map-wrap"><h2>CITY MAP — VANDARA BAY</h2>' +
    '<canvas id="pause-map-canvas" width="560" height="560"></canvas></div>' +
    '<div id="pause-side">' +
    '<div class="vr-panel"><h3>Stats</h3><div id="pause-stats"></div></div>' +
    '<div class="vr-panel"><h3>Legend</h3><ul id="pause-legend">' +
    '<li><span class="swatch" style="background:#fff"></span> You (Damian)</li>' +
    '<li><span class="swatch diamond" style="background:#ffd23f"></span> Mission target</li>' +
    '<li><span class="swatch" style="background:#ff4d4d"></span> Police</li>' +
    '<li><span class="swatch" style="background:#3f8f4f"></span> Park</li>' +
    '<li><span class="swatch" style="background:#1f8f8a"></span> Sea</li>' +
    '<li><span class="swatch" style="background:#383c46"></span> Road</li>' +
    '</ul></div>' +
    '<div class="vr-btn-col" style="width:auto">' +
    '<button class="vr-btn primary" id="btn-resume">RESUME</button>' +
    '<button class="vr-btn" id="btn-pause-settings">SETTINGS</button>' +
    '<button class="vr-btn" id="btn-quit-title">QUIT TO TITLE</button>' +
    '</div></div>';
  document.body.appendChild(pauseScreen);

  // ---------- starting the game ----------
  function startPlaying() {
    hideAll();
    S.mode = 'playing';
    // Start the story: a fresh game begins mission 1, Continue resumes
    // the saved mission. Without this no mission ever starts — the only
    // start() caller was the screenshot script.
    if (VR.Missions && VR.Missions.start && !VR.Missions.active) {
      VR.Missions.start(S.mission || 0);
    }
    if (VR.HUD) VR.HUD.show();
    var canvas = VR.World && VR.World.renderer ? VR.World.renderer.domElement : null;
    if (VR.Input && VR.Input.requestLock) VR.Input.requestLock(canvas);
    if (VR.Audio && VR.Audio.init) VR.Audio.init();
  }

  function refreshContinue() {
    var btn = document.getElementById('btn-continue');
    if (!btn) return;
    var has = false;
    if (VR.Save && typeof VR.Save.hasSave === 'function') {
      try { has = !!VR.Save.hasSave(); } catch (err) { has = false; }
    }
    btn.disabled = !has;
    btn.style.display = has ? '' : 'none'; // hidden entirely until a save exists
  }

  // ---------- title wiring ----------
  document.getElementById('title-click-start').addEventListener('click', function (e) {
    e.stopPropagation();
    startPlaying();
  });
  document.getElementById('btn-newgame').addEventListener('click', function (e) {
    e.stopPropagation();
    startPlaying();
  });
  document.getElementById('btn-continue').addEventListener('click', function (e) {
    e.stopPropagation();
    if (VR.Save && typeof VR.Save.load === 'function') {
      try { VR.Save.load(); } catch (err) { /* ignore */ }
    }
    startPlaying();
  });
  document.getElementById('btn-controls').addEventListener('click', function (e) {
    e.stopPropagation();
    titleScreen.style.display = 'none';
    controlsPanel.style.display = 'flex';
  });
  document.getElementById('btn-settings').addEventListener('click', function (e) {
    e.stopPropagation();
    titleScreen.style.display = 'none';
    settingsPanel.style.display = 'flex';
    syncSettingsUI();
  });
  document.getElementById('btn-controls-back').addEventListener('click', function () {
    controlsPanel.style.display = 'none';
    if (S.mode === 'title') titleScreen.style.display = 'flex';
    else pauseScreen.style.display = 'flex';
  });
  document.getElementById('btn-settings-back').addEventListener('click', function () {
    settingsPanel.style.display = 'none';
    if (S.mode === 'title') titleScreen.style.display = 'flex';
    else pauseScreen.style.display = 'flex';
  });

  // ---------- settings wiring ----------
  function syncSettingsUI() {
    var v = document.getElementById('set-volume');
    var s = document.getElementById('set-sens');
    if (v) {
      v.value = String(Math.round(settings.volume * 100));
      document.getElementById('set-volume-val').textContent = v.value + '%';
    }
    if (s) {
      s.value = String(Math.round(settings.sensitivity * 100));
      document.getElementById('set-sens-val').textContent = (settings.sensitivity).toFixed(2) + 'x';
    }
  }
  document.getElementById('set-volume').addEventListener('input', function (e) {
    settings.volume = Number(e.target.value) / 100;
    document.getElementById('set-volume-val').textContent = e.target.value + '%';
    if (VR.Audio && typeof VR.Audio.setVolume === 'function') {
      try { VR.Audio.setVolume(settings.volume); } catch (err) { /* ignore */ }
    }
    saveSettings();
  });
  document.getElementById('set-sens').addEventListener('input', function (e) {
    settings.sensitivity = Number(e.target.value) / 100;
    document.getElementById('set-sens-val').textContent = settings.sensitivity.toFixed(2) + 'x';
    saveSettings();
  });

  // ---------- pause wiring ----------
  document.getElementById('btn-resume').addEventListener('click', function () {
    if (VR.Main && VR.Main.togglePause) VR.Main.togglePause();
  });
  document.getElementById('btn-pause-settings').addEventListener('click', function () {
    pauseScreen.style.display = 'none';
    settingsPanel.style.display = 'flex';
    syncSettingsUI();
  });
  document.getElementById('btn-quit-title').addEventListener('click', function () {
    S.mode = 'title';
    showTitle();
  });

  // Esc pauses / resumes (main.js owns P; Esc lives here so resume
  // also works while paused, when main.js's update() returns early).
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Escape') return;
    if (S.mode === 'playing') {
      if (VR.Main && VR.Main.togglePause) VR.Main.togglePause();
    } else if (S.mode === 'paused') {
      if (VR.Main && VR.Main.togglePause) VR.Main.togglePause();
    }
  });

  // ---------- full city map for the pause screen ----------
  function drawPauseMap() {
    var cv = document.getElementById('pause-map-canvas');
    if (!cv) return;
    var g = cv.getContext('2d');
    var size = cv.width;
    g.clearRect(0, 0, size, size);
    if (VR.Minimap && VR.Minimap.drawStaticMap) {
      VR.Minimap.drawStaticMap(g, size);
    } else {
      g.fillStyle = '#123a4a';
      g.fillRect(0, 0, size, size);
    }
    var px = function (x) { return (x + 260) / 520 * size; };
    var pz = function (z) { return (z + 260) / 520 * size; };
    // District names.
    g.font = 'bold 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,233,201,0.9)';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 3;
    g.fillText('GOLDEN PIER', px(-195), pz(0));
    g.fillText('HIGHRISE PLAZA', px(0), pz(-90));
    g.fillText('PASAR LENTERA', px(0), pz(165));
    g.fillText('DOCKYARD', px(195), pz(0));
    g.fillText('N', px(0) - size * 0.02, pz(-240) + 16);
    g.shadowBlur = 0;
    // Mission target (yellow diamond) + waypoint line from the player.
    var pos = null;
    if (S.inCar && S.car && S.car.group) {
      pos = { x: S.car.group.position.x, z: S.car.group.position.z };
    } else if (VR.Player && VR.Player.pos) {
      pos = { x: VR.Player.pos.x, z: VR.Player.pos.z };
    }
    if (VR.Missions && VR.Missions.targetPos &&
        typeof VR.Missions.targetPos.x === 'number') {
      var tp = VR.Missions.targetPos;
      if (pos) {
        g.beginPath();
        g.moveTo(px(pos.x), pz(pos.z));
        g.lineTo(px(tp.x), pz(tp.z));
        g.strokeStyle = 'rgba(255,210,63,0.85)';
        g.lineWidth = 2;
        g.setLineDash([7, 6]);
        g.stroke();
        g.setLineDash([]);
      }
      g.save();
      g.translate(px(tp.x), pz(tp.z));
      g.rotate(Math.PI / 4);
      g.fillStyle = '#ffd23f';
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.fillRect(-9, -9, 18, 18);
      g.strokeRect(-9, -9, 18, 18);
      g.restore();
    }
    // Police units (guarded).
    if (VR.Police && VR.Police.units) {
      for (var i = 0; i < VR.Police.units.length; i++) {
        var u = VR.Police.units[i];
        var up = null;
        if (u && u.group && u.group.position) up = u.group.position;
        else if (u && typeof u.x === 'number') up = u;
        if (!up) continue;
        g.beginPath();
        g.arc(px(up.x), pz(up.z), 5, 0, Math.PI * 2);
        g.fillStyle = '#ff4d4d';
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    // Player arrow.
    if (pos) {
      var yaw = 0;
      if (S.inCar && S.car) {
        yaw = (typeof S.car.yaw === 'number') ? S.car.yaw
          : (S.car.group ? S.car.group.rotation.y : 0);
      } else if (VR.Player && typeof VR.Player.yaw === 'number') {
        yaw = VR.Player.yaw;
      }
      g.save();
      g.translate(px(pos.x), pz(pos.z));
      // Map: +x right, +z down. Facing (sin yaw, cos yaw) -> canvas angle.
      g.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)) + Math.PI / 2);
      g.fillStyle = '#fff';
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(8, 9);
      g.lineTo(0, 4);
      g.lineTo(-8, 9);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }

  function fillPauseStats() {
    var el = document.getElementById('pause-stats');
    if (!el) return;
    var money = (VR.Economy && typeof VR.Economy.money === 'number')
      ? VR.Economy.money : S.money;
    var respect = (VR.Economy && typeof VR.Economy.respect === 'number')
      ? VR.Economy.respect : (S.respect || 0);
    var missionIdx = (VR.Missions && typeof VR.Missions.current === 'number')
      ? VR.Missions.current : (S.mission || 0);
    var mTitle = '';
    if (VR.Missions && VR.Missions.list && VR.Missions.list[missionIdx]) {
      mTitle = VR.Missions.list[missionIdx].title || '';
    } else if (VR.Config && VR.Config.MISSIONS && VR.Config.MISSIONS[missionIdx]) {
      mTitle = VR.Config.MISSIONS[missionIdx].title || '';
    }
    var m = ((Math.floor(S.timeMinutes) % 1440) + 1440) % 1440;
    var hh = Math.floor(m / 60), mm = m % 60;
    var clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    var wanted = (VR.Police && typeof VR.Police.wanted === 'number')
      ? VR.Police.wanted : (S.wanted || 0);
    el.innerHTML =
      'Money: <b>$' + String(Math.round(money)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</b><br>' +
      'Respect: <b>' + respect + '</b><br>' +
      'Mission: <b>' + (missionIdx + 1) + ' / 8 — ' + mTitle + '</b><br>' +
      'Wanted: <b>' + wanted + ' stars</b><br>' +
      'Time: <b>' + clock + ' · Day ' + (S.day || 1) + '</b><br>' +
      'Health: <b>' + Math.round(S.health || 0) + '</b> · Armor: <b>' + Math.round(S.armor || 0) + '</b>';
  }

  // ---------- public API ----------
  function showTitle() {
    hideOldTitleCard();
    pauseScreen.style.display = 'none';
    controlsPanel.style.display = 'none';
    settingsPanel.style.display = 'none';
    titleScreen.style.display = 'flex';
    refreshContinue();
    if (VR.HUD) VR.HUD.hide();
    var mm = document.getElementById('minimap-wrap');
    if (mm) mm.style.display = 'none';
  }

  function showPause() {
    hideOldTitleCard();
    titleScreen.style.display = 'none';
    controlsPanel.style.display = 'none';
    settingsPanel.style.display = 'none';
    pauseScreen.style.display = 'flex';
    drawPauseMap();
    fillPauseStats();
    if (VR.HUD) VR.HUD.hide();
    var mm = document.getElementById('minimap-wrap');
    if (mm) mm.style.display = 'none';
  }

  function hideAll() {
    hideOldTitleCard();
    titleScreen.style.display = 'none';
    pauseScreen.style.display = 'none';
    controlsPanel.style.display = 'none';
    settingsPanel.style.display = 'none';
    if (VR.HUD) VR.HUD.show();
    var mm = document.getElementById('minimap-wrap');
    if (mm) mm.style.display = '';
  }

  VR.Menus = {
    showTitle: showTitle,
    showPause: showPause,
    hideAll: hideAll,
    get settings() { return settings; }
  };

})(window.VR = window.VR || {});
