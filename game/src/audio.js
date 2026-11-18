// PUERTO MIRA — synthesized audio. W5.
// WebAudio ONLY, everything synthesized (no audio files): engine hum, two-tone
// siren, gunshots, synthwave radio (pad + bass + arp per station), UI blips,
// mission stings. The AudioContext is created on the first user gesture only
// (browser autoplay policy); before that every call is a safe no-op.
import { RADIO } from './config.js';

let gameRef = null;
let ctx = null;
let master = null;
let musicBus = null;
let sfxBus = null;
let noiseBuf = null;
let unlocked = false;
let musicOn = true;
let sfxOn = true;

// Radio state (independent of the AudioContext so the HUD can show it early).
let radioIndex = 0;
let trackIndex = 0;

// Engine nodes.
let engineNodes = null; // { osc, sub, filter, gain }
let engineTargetGain = 0;

// Siren nodes.
let sirenNodes = null; // { osc, gain }
let sirenOn = false;
let sirenHigh = false;
let sirenTimer = 0;

// Radio step sequencer.
let nextNoteTime = 0;
let stepInBar = 0;
let barInTrack = 0;
let stepCount = 0;

// Q key edge detection (prev radio station).
let qWasDown = false;
let qCooldown = 0;

// Synthwave chord progressions per station (MIDI note numbers, triads).
// Order MUST match config RADIO: [ONDA 96.5 FM, BRISA 88.3, CORAL 101.7].
const PROGRESSIONS = [
  // ONDA 96.5 FM — Onda Sunset: Am F C G
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  // BRISA 88.3 — Brisa Chill: Dm Bb F Gm
  [[50, 53, 57], [46, 50, 53], [48, 52, 55], [43, 47, 50]],
  // CORAL 101.7 — Coral Nights: Em C G D
  [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]],
];
const STEP_DUR = 0.21; // 8th note at ~143 BPM
const STEPS_PER_BAR = 8;
const BARS_PER_TRACK = 8;

function midiHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? 0.5 : 0;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxOn ? 0.9 : 0;
    sfxBus.connect(master);
    const len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

function unlock() {
  if (unlocked) return;
  const c = ensureCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === 'suspended') c.resume().catch(() => {});
  nextNoteTime = c.currentTime + 0.1;
}

// One enveloped oscillator tone.
function tone(opts) {
  if (!ctx || !unlocked || !sfxBus) return;
  const freq = opts.freq;
  const freqEnd = opts.freqEnd ?? freq;
  const dur = opts.dur ?? 0.2;
  const type = opts.type ?? 'sine';
  const gainVal = opts.gain ?? 0.2;
  const when = opts.when ?? ctx.currentTime;
  const attack = opts.attack ?? 0.005;
  const bus = opts.bus ?? sfxBus;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), when + dur);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(gainVal, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  } catch (err) {
    // Audio must never break the game loop.
  }
}

// Filtered noise burst (gunshots, crashes, wind).
function noiseHit(opts) {
  if (!ctx || !unlocked || !sfxBus || !noiseBuf) return;
  const dur = opts.dur ?? 0.15;
  const gainVal = opts.gain ?? 0.3;
  const freq = opts.freq ?? 1200;
  const type = opts.filterType ?? 'bandpass';
  const when = opts.when ?? ctx.currentTime;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    src.start(when);
    src.stop(when + dur + 0.05);
  } catch (err) {
    // Audio must never break the game loop.
  }
}

function currentChord() {
  const prog = PROGRESSIONS[radioIndex % PROGRESSIONS.length];
  const bar = barInTrack % prog.length;
  return prog[bar];
}

function scheduleStep(step, when) {
  const chord = currentChord();
  const barStep = step % STEPS_PER_BAR;
  // Pad: one warm chord at the top of each bar (two detuned saws, slow attack).
  if (barStep === 0) {
    for (const note of chord) {
      for (const detune of [-6, 6]) {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          osc.type = 'sawtooth';
          osc.frequency.value = midiHz(note);
          osc.detune.value = detune;
          filter.type = 'lowpass';
          filter.frequency.value = 900;
          gain.gain.setValueAtTime(0, when);
          gain.gain.linearRampToValueAtTime(0.045, when + 0.5);
          gain.gain.setValueAtTime(0.045, when + STEP_DUR * STEPS_PER_BAR - 0.4);
          gain.gain.linearRampToValueAtTime(0, when + STEP_DUR * STEPS_PER_BAR);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(musicBus);
          osc.start(when);
          osc.stop(when + STEP_DUR * STEPS_PER_BAR + 0.05);
        } catch (err) { /* never break the loop */ }
      }
    }
  }
  // Bass: root on beats 0 and 4, fifth on 6.
  if (barStep === 0 || barStep === 4) {
    tone({ freq: midiHz(chord[0] - 24), dur: STEP_DUR * 1.8, type: 'triangle', gain: 0.22, when, bus: musicBus, attack: 0.01 });
  } else if (barStep === 6) {
    tone({ freq: midiHz(chord[0] - 17), dur: STEP_DUR, type: 'triangle', gain: 0.12, when, bus: musicBus, attack: 0.01 });
  }
  // Arp: chord tones cycling an octave up, short pluck on every 8th.
  const arpNote = chord[(step * 2 + Math.floor(step / 4)) % chord.length] + 12;
  tone({ freq: midiHz(arpNote), dur: STEP_DUR * 0.9, type: 'square', gain: 0.05, when, bus: musicBus, attack: 0.004 });
  // Hats: faint noise tick on off-beats.
  if (barStep % 2 === 1) {
    noiseHit({ dur: 0.03, gain: 0.03, freq: 6000, filterType: 'highpass', when });
  }
}

function advanceTrack() {
  trackIndex = (trackIndex + 1) % RADIO[radioIndex].tracks.length;
  if (gameRef && gameRef.events) {
    gameRef.events.emit('radio', { station: radioIndex, track: trackIndex });
  }
}

function ensureEngine() {
  if (engineNodes || !ctx) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 27.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(sfxBus);
    osc.start();
    sub.start();
    engineNodes = { osc, sub, filter, gain };
  } catch (err) {
    engineNodes = null;
  }
}

function ensureSiren() {
  if (sirenNodes || !ctx) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(sfxBus);
    osc.start();
    sirenNodes = { osc, gain };
  } catch (err) {
    sirenNodes = null;
  }
}

export function play(name) {
  if (!ctx || !unlocked || !sfxOn) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  switch (name) {
    case 'shoot':
      noiseHit({ dur: 0.12, gain: 0.5, freq: 1800 });
      tone({ freq: 190, freqEnd: 60, dur: 0.09, type: 'square', gain: 0.18 });
      break;
    case 'blip':
      tone({ freq: 880, dur: 0.06, type: 'sine', gain: 0.12 });
      break;
    case 'sting':
      [72, 76, 79, 84].forEach((note, i) => {
        tone({ freq: midiHz(note), dur: 0.35, type: 'triangle', gain: 0.16, when: now + i * 0.09 });
      });
      break;
    case 'cash':
      tone({ freq: midiHz(88), dur: 0.1, type: 'sine', gain: 0.16 });
      tone({ freq: midiHz(93), dur: 0.22, type: 'sine', gain: 0.16, when: now + 0.08 });
      break;
    case 'crash':
      noiseHit({ dur: 0.4, gain: 0.45, freq: 400, filterType: 'lowpass' });
      tone({ freq: 75, freqEnd: 35, dur: 0.35, type: 'sine', gain: 0.3 });
      break;
    case 'reload':
      tone({ freq: 520, dur: 0.05, type: 'square', gain: 0.1 });
      tone({ freq: 760, dur: 0.05, type: 'square', gain: 0.1, when: now + 0.12 });
      break;
    case 'pickup':
      tone({ freq: 660, freqEnd: 990, dur: 0.16, type: 'sine', gain: 0.14 });
      break;
    case 'busted':
      [62, 58, 55].forEach((note, i) => {
        tone({ freq: midiHz(note), dur: 0.4, type: 'sawtooth', gain: 0.12, when: now + i * 0.18 });
      });
      break;
    case 'wasted':
      tone({ freq: 55, dur: 1.2, type: 'sawtooth', gain: 0.2, attack: 0.05 });
      tone({ freq: 58, dur: 1.2, type: 'sawtooth', gain: 0.14, attack: 0.05 });
      break;
    default:
      tone({ freq: 660, dur: 0.08, type: 'sine', gain: 0.1 });
      break;
  }
  return true;
}

export function setRadio(i) {
  const count = RADIO.length || 1;
  radioIndex = ((Math.floor(i) % count) + count) % count;
  trackIndex = 0;
  barInTrack = 0;
  stepInBar = 0;
  if (gameRef && gameRef.events) {
    gameRef.events.emit('radio', { station: radioIndex, track: trackIndex });
  }
  return radioIndex;
}

export function engine(on, speed) {
  if (!ctx || !unlocked) return;
  ensureEngine();
  if (!engineNodes) return;
  const spd = Math.abs(speed ?? 0);
  engineTargetGain = on ? 0.055 : 0;
  const now = ctx.currentTime;
  try {
    engineNodes.gain.gain.setTargetAtTime(engineTargetGain, now, 0.1);
    if (on) {
      engineNodes.osc.frequency.setTargetAtTime(52 + spd * 1.7, now, 0.08);
      engineNodes.sub.frequency.setTargetAtTime(26 + spd * 0.85, now, 0.08);
      engineNodes.filter.frequency.setTargetAtTime(320 + spd * 20, now, 0.1);
    }
  } catch (err) { /* never break the loop */ }
}

export function siren(on) {
  if (!ctx || !unlocked) {
    sirenOn = !!on;
    return;
  }
  ensureSiren();
  sirenOn = !!on;
  if (!sirenNodes) return;
  try {
    sirenNodes.gain.gain.setTargetAtTime(sirenOn ? 0.045 : 0, ctx.currentTime, 0.15);
  } catch (err) { /* never break the loop */ }
}

function setMusic(on) {
  musicOn = !!on;
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(musicOn ? 0.5 : 0, ctx.currentTime, 0.1);
}

function setSfx(on) {
  sfxOn = !!on;
  if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(sfxOn ? 0.9 : 0, ctx.currentTime, 0.1);
}

function update(dt) {
  if (!gameRef) return;
  // Q = previous radio station (main.js does not handle Q; audio owns it).
  qCooldown = Math.max(0, qCooldown - dt);
  const qDown = gameRef.input ? gameRef.input.keys.has('KeyQ') : false;
  if (qDown && !qWasDown && qCooldown <= 0) {
    setRadio(radioIndex - 1);
    play('blip');
    qCooldown = 0.3;
  }
  qWasDown = qDown;

  if (!ctx || !unlocked) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  // Radio sequencer: schedule ahead while the context runs.
  if (musicOn) {
    try {
      while (nextNoteTime < ctx.currentTime + 0.18) {
        scheduleStep(stepCount, nextNoteTime);
        stepCount += 1;
        stepInBar += 1;
        nextNoteTime += STEP_DUR;
        if (stepInBar >= STEPS_PER_BAR) {
          stepInBar = 0;
          barInTrack += 1;
          if (barInTrack >= BARS_PER_TRACK) {
            barInTrack = 0;
            advanceTrack();
          }
        }
      }
    } catch (err) { /* never break the loop */ }
  } else {
    nextNoteTime = Math.max(nextNoteTime, ctx.currentTime + 0.05);
  }

  // Engine follows the player's car; siren follows wanted level.
  const driving = gameRef.mode === 'playing' && gameRef.currentCar;
  engine(!!driving, driving ? gameRef.currentCar.speed ?? 0 : 0);
  siren(gameRef.mode === 'playing' && (gameRef.wanted ?? 0) > 0);

  // Two-tone siren alternation.
  if (sirenOn && sirenNodes) {
    sirenTimer -= dt;
    if (sirenTimer <= 0) {
      sirenTimer = 0.42;
      sirenHigh = !sirenHigh;
      try {
        sirenNodes.osc.frequency.setTargetAtTime(sirenHigh ? 920 : 660, ctx.currentTime, 0.03);
      } catch (err) { /* never break the loop */ }
    }
  }
}

export default {
  init(game) {
    gameRef = game;
    // First gesture unlocks audio (autoplay policy). Pointer + key both count.
    const gesture = () => unlock();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    if (gameRef && gameRef.events) {
      gameRef.events.on('money', (data) => {
        if (data && data.amount > 0) play('cash');
      });
      gameRef.events.on('objective', () => play('sting'));
    }
  },
  update,
  play,
  setRadio,
  engine,
  siren,
  setMusic,
  setSfx,
  get radioIndex() { return radioIndex; },
  get trackIndex() { return trackIndex; },
  get station() { return RADIO[radioIndex] ? RADIO[radioIndex].station : ''; },
  get track() {
    const st = RADIO[radioIndex];
    return st && st.tracks[trackIndex] ? st.tracks[trackIndex] : '';
  },
  get musicOn() { return musicOn; },
  get sfxOn() { return sfxOn; },
  get unlocked() { return unlocked; },
};
