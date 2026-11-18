// audio.js — Slice E: 100% synthetic Web Audio for VANDARA RUSH.
// No external files: engine hum, siren, SFX, two synth radio stations
// and beach ambience are all generated with oscillators / noise.
// Everything is wrapped in try/catch: in a headless browser (or any
// environment without AudioContext) the module is a silent no-op and
// never crashes the game. init() must be called from a user gesture.
(function (VR) {
  'use strict';

  var STATION_NAMES = ['VANDARA 104.2 FM', 'GELOMBANG 88.8 FM'];

  var ctx = null;
  var ok = false;
  var master = null;
  var radioGain = null;
  var noiseBuf = null;

  // Engine (created once, parameters morphed — never rebuilt per frame).
  var engOsc = null, engOsc2 = null, engFilter = null, engGain = null;
  // Siren (created once, LFO sweeps the pitch).
  var sirOsc = null, sirLfo = null, sirLfoGain = null, sirGain = null;
  // Ocean (created once, gain follows distance to the sea).
  var oceanSrc = null, oceanFilter = null, oceanGain = null;

  var station = 0;
  var _radioTimer = null;
  var _oceanTimer = null;
  var _nextNoteTime = 0;
  var _step = 0;

  // ---- Radio patterns: 16 steps per bar, 4-bar loops ----
  // Station 0 — tropical pop, 112 BPM: Am F C G, bright square lead.
  var POP = {
    bpm: 112, leadType: 'square', bassType: 'triangle', leadVol: 0.05, bassVol: 0.11,
    chords: [57, 53, 48, 55], // Am F C G roots (midi)
    bass: [45, 41, 36, 43, 45, 41, 36, 43, 45, 41, 36, 43, 45, 41, 43, 43],
    lead: [69, 0, 72, 0, 76, 0, 72, 69, 67, 0, 69, 0, 72, 0, 76, 0]
  };
  // Station 1 — late-night jazz, 84 BPM: Dm7 G7 Cmaj7 Am7, soft triangle.
  var JAZZ = {
    bpm: 84, leadType: 'triangle', bassType: 'sine', leadVol: 0.07, bassVol: 0.13,
    chords: [50, 55, 48, 57], // Dm G C Am roots (midi)
    bass: [38, 0, 38, 0, 43, 0, 43, 0, 36, 0, 36, 0, 45, 0, 43, 0],
    lead: [62, 0, 65, 0, 69, 0, 65, 62, 60, 0, 62, 0, 65, 0, 69, 0]
  };

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoiseBuffer() {
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    try {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, when);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), when + dur);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g);
      g.connect(master);
      o.start(when);
      o.stop(when + dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  function noiseBurst(dur, vol, filterFreq, when, type) {
    try {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = type || 'lowpass';
      f.frequency.setValueAtTime(filterFreq || 1000, when);
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(when);
      src.stop(when + dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  // ---- Radio scheduler (lookahead, 16th notes) ----
  function scheduleStep(step, when) {
    var pat = station === 0 ? POP : JAZZ;
    var stepDur = 60 / pat.bpm / 4;
    var bar = Math.floor(step / 16) % 4;
    var s16 = step % 16;
    // Bass on its pattern step.
    var b = pat.bass[s16];
    if (b) {
      try {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = pat.bassType;
        o.frequency.setValueAtTime(midiToFreq(b), when);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(pat.bassVol, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, when + stepDur * 1.8);
        o.connect(g); g.connect(radioGain);
        o.start(when); o.stop(when + stepDur * 2);
      } catch (e) { /* ignore */ }
    }
    // Lead melody.
    var l = pat.lead[s16];
    if (l) {
      try {
        var o2 = ctx.createOscillator();
        var g2 = ctx.createGain();
        o2.type = pat.leadType;
        o2.frequency.setValueAtTime(midiToFreq(l), when);
        g2.gain.setValueAtTime(0.0001, when);
        g2.gain.exponentialRampToValueAtTime(pat.leadVol, when + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.0001, when + stepDur * 1.5);
        o2.connect(g2); g2.connect(radioGain);
        o2.start(when); o2.stop(when + stepDur * 1.8);
      } catch (e) { /* ignore */ }
    }
    // Chord pad on bar start (root + third + fifth, quiet).
    if (s16 === 0) {
      var root = pat.chords[bar];
      var notes = [root, root + 4, root + 7];
      for (var i = 0; i < notes.length; i++) {
        tone(midiToFreq(notes[i]), stepDur * 16, 'sine', 0.018, when);
      }
    }
    // Light hat on off-beats (pop only).
    if (station === 0 && s16 % 4 === 2) {
      noiseBurst(0.05, 0.05, 6000, when, 'highpass');
    }
    void bar;
  }

  function radioTick() {
    if (!ok || !ctx) return;
    try {
      var pat = station === 0 ? POP : JAZZ;
      var stepDur = 60 / pat.bpm / 4;
      if (_nextNoteTime < ctx.currentTime) _nextNoteTime = ctx.currentTime + 0.05;
      while (_nextNoteTime < ctx.currentTime + 0.3) {
        // Jazz swing: delay odd 16ths slightly.
        var when = _nextNoteTime;
        if (station === 1 && (_step % 2 === 1)) when += stepDur * 0.3;
        scheduleStep(_step, when);
        _step = (_step + 1) % 64;
        _nextNoteTime += stepDur;
      }
    } catch (e) { /* ignore */ }
  }

  function oceanTick() {
    if (!ok || !oceanGain || !ctx) return;
    try {
      var x = null;
      if (VR.Player && VR.Player.pos) x = VR.Player.pos.x;
      else if (VR.State && VR.State.inCar && VR.State.car && VR.State.car.group) {
        x = VR.State.car.group.position.x;
      }
      var target = 0;
      if (x !== null) {
        // Sea is west of x = -240; audible from the boulevard inward.
        if (x < -240) target = 0.10;
        else if (x < -200) target = 0.10 * (-200 - x) / 40;
        else target = 0;
      }
      oceanGain.gain.setTargetAtTime(target, ctx.currentTime, 0.5);
    } catch (e) { /* ignore */ }
  }

  function init() {
    if (ok && ctx) {
      try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
      return true;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = makeNoiseBuffer();

      // Radio bus.
      radioGain = ctx.createGain();
      radioGain.gain.value = 0.14;
      radioGain.connect(master);

      // Engine: two detuned saws through a lowpass, gain morphs with RPM.
      engOsc = ctx.createOscillator();
      engOsc2 = ctx.createOscillator();
      engFilter = ctx.createBiquadFilter();
      engGain = ctx.createGain();
      engOsc.type = 'sawtooth';
      engOsc2.type = 'sawtooth';
      engOsc.frequency.value = 55;
      engOsc2.frequency.value = 55 * 1.01;
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 500;
      engGain.gain.value = 0;
      engOsc.connect(engFilter);
      engOsc2.connect(engFilter);
      engFilter.connect(engGain);
      engGain.connect(master);
      engOsc.start();
      engOsc2.start();

      // Siren: one osc, LFO (square, 0.55 Hz) swings it between two tones.
      sirOsc = ctx.createOscillator();
      sirOsc.type = 'triangle';
      sirOsc.frequency.value = 750;
      sirLfo = ctx.createOscillator();
      sirLfo.type = 'square';
      sirLfo.frequency.value = 0.55;
      sirLfoGain = ctx.createGain();
      sirLfoGain.gain.value = 130;
      sirGain = ctx.createGain();
      sirGain.gain.value = 0;
      sirLfo.connect(sirLfoGain);
      sirLfoGain.connect(sirOsc.frequency);
      sirOsc.connect(sirGain);
      sirGain.connect(master);
      sirOsc.start();
      sirLfo.start();

      // Ocean: looped noise through a low lowpass, gain by proximity.
      oceanSrc = ctx.createBufferSource();
      oceanSrc.buffer = noiseBuf;
      oceanSrc.loop = true;
      oceanFilter = ctx.createBiquadFilter();
      oceanFilter.type = 'lowpass';
      oceanFilter.frequency.value = 420;
      oceanGain = ctx.createGain();
      oceanGain.gain.value = 0;
      oceanSrc.connect(oceanFilter);
      oceanFilter.connect(oceanGain);
      oceanGain.connect(master);
      oceanSrc.start();

      ok = true;
      _nextNoteTime = ctx.currentTime + 0.1;
      _step = 0;
      if (!_radioTimer) _radioTimer = setInterval(radioTick, 120);
      if (!_oceanTimer) _oceanTimer = setInterval(oceanTick, 250);
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch (e) {
      ok = false;
      ctx = null;
      return false;
    }
  }

  function play(name) {
    if (!ok || !ctx) return;
    try {
      var now = ctx.currentTime;
      if (name === 'shot') {
        noiseBurst(0.12, 0.5, 2400, now);
        tone(190, 0.09, 'square', 0.25, now, 70);
      } else if (name === 'explosion') {
        noiseBurst(0.9, 0.8, 500, now);
        tone(120, 0.8, 'sine', 0.6, now, 32);
      } else if (name === 'siren') {
        tone(700, 0.35, 'triangle', 0.16, now);
        tone(950, 0.35, 'triangle', 0.16, now + 0.35);
      } else if (name === 'skid') {
        noiseBurst(0.35, 0.16, 1800, now, 'bandpass');
      } else if (name === 'ui') {
        tone(880, 0.07, 'sine', 0.12, now);
      } else if (name === 'pickup') {
        tone(660, 0.1, 'sine', 0.15, now);
        tone(990, 0.14, 'sine', 0.15, now + 0.09);
      }
    } catch (e) { /* ignore */ }
  }

  function setEngine(rpm01, load01) {
    if (!ok || !engOsc || !ctx) return;
    try {
      var rpm = Math.max(0, Math.min(1, rpm01 || 0));
      var load = Math.max(0, Math.min(1, load01 || 0));
      var f = 50 + rpm * 165;
      var t = ctx.currentTime;
      engOsc.frequency.setTargetAtTime(f, t, 0.05);
      engOsc2.frequency.setTargetAtTime(f * 1.01, t, 0.05);
      engFilter.frequency.setTargetAtTime(350 + rpm * 1400 + load * 700, t, 0.08);
      engGain.gain.setTargetAtTime(rpm > 0.02 ? 0.02 + load * 0.05 + rpm * 0.02 : 0, t, 0.1);
    } catch (e) { /* ignore */ }
  }

  function setSiren(on) {
    if (!ok || !sirGain || !ctx) return;
    try {
      sirGain.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.1);
    } catch (e) { /* ignore */ }
  }

  function stationName() {
    if (VR.Config && VR.Config.RADIO && VR.Config.RADIO[station]) {
      return VR.Config.RADIO[station].name;
    }
    return STATION_NAMES[station] || STATION_NAMES[0];
  }

  function nextStation() {
    station = (station + 1) % 2;
    _step = 0;
    if (ok && ctx) _nextNoteTime = ctx.currentTime + 0.05;
    if (VR.HUD && VR.HUD.showToast) {
      try { VR.HUD.showToast('Radio: ' + stationName()); } catch (e) { /* optional */ }
    }
    return station;
  }

  VR.Audio = {
    init: init,
    play: play,
    setEngine: setEngine,
    setSiren: setSiren,
    get station() { return station; },
    set station(n) { station = (n === 1) ? 1 : 0; _step = 0; },
    nextStation: nextStation,
    stationName: stationName,
    get ready() { return ok; }
  };

})(window.VR = window.VR || {});
