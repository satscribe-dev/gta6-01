// SOLARA BAY — shared data. Written by the coordinator. Workers import this, never redefine it.
export const CITY = { block: 60, street: 14, half: 240, beachZ: 200, oceanZ: 215 };

export const DISTRICTS = [
  { name: 'Old Town', x0: -240, z0: -240, x1: 0, z1: 0 },
  { name: 'Harbor Heights', x0: 0, z0: -240, x1: 240, z1: 0 },
  { name: 'Coral Row', x0: -240, z0: 0, x1: 0, z1: 120 },
  { name: 'Palm Court', x0: 0, z0: 0, x1: 240, z1: 120 },
  { name: 'Marina Verde', x0: -240, z0: 120, x1: 0, z1: 240 },
  { name: 'The Docks', x0: 0, z0: 120, x1: 240, z1: 240 },
];

export const PALETTE = {
  skyTop: 0x1e2a52, skyHorizon: 0xff9a5c, sun: 0xffd27a, fog: 0xe8937c,
  road: 0x2e3138, sidewalk: 0x6b6f78, sand: 0xe8d5a3, ocean: 0x1e6f8e,
  building: [0xffb3a0, 0xffd9a0, 0xa0e0d0, 0xa0c8ff, 0xffe8c8, 0xd0a0ff, 0x90d8b0, 0xffc0c0],
};

export const CARS = {
  zephyr: { name: 'Zephyr R', accel: 26, topSpeed: 62, brake: 40, steer: 0.55, color: 0xff2e63, nitro: true },
  corsair: { name: 'Corsair', accel: 20, topSpeed: 48, brake: 34, steer: 0.5, color: 0x2ec4ff, nitro: false },
  vela: { name: 'Vela S', accel: 22, topSpeed: 54, brake: 36, steer: 0.52, color: 0xffc93c, nitro: false },
  police: { name: 'SBPD Interceptor', accel: 24, topSpeed: 58, brake: 38, steer: 0.55, color: 0x181818, nitro: false },
  traffic: [0xcccccc, 0x8899aa, 0xaa6655, 0x55aa88, 0xdddddd, 0x7799cc],
};

export const WEAPONS = [
  { id: 0, name: 'Fists', damage: 12, rate: 0.45, ammo: Infinity, auto: false },
  { id: 1, name: 'Pistol', damage: 25, rate: 0.3, ammo: 48, auto: false },
  { id: 2, name: 'SMG', damage: 14, rate: 0.09, ammo: 120, auto: true },
  { id: 3, name: 'Shotgun', damage: 60, rate: 0.9, ammo: 18, auto: false },
];

export const POLICE_UNITS = ['ORCA-12', 'TIDE-07', 'REEF-22', 'SURGE-31', 'MARLIN-09', 'CORAL-17'];
export const HELI_NAME = 'HAWK-2';

export const RADIO = [
  { station: 'TIDE 101', genre: 'Golden Hour', tracks: ['Sunset Run — Coastline', 'Palm Static — Coral Ghosts', 'Neon Drive — Pink Horizon'] },
  { station: 'BAY 88.3', genre: 'Neon Tide', tracks: ['Tide Line — Marina Lights', 'Golden Hour — The Vela', 'Night Swim — Solara'] },
];

export const CHARACTERS = {
  kai: { name: 'Kai Mercer', role: 'Wheelman', color: 0xff7a2e },
  mira: { name: 'Mira Solano', role: 'Wheelwoman', color: 0xff2e63 },
  theo: { name: 'Theo Vane', role: 'Hacker', color: 0x2ec4ff },
  lena: { name: 'Lena Cross', role: 'Fixer', color: 0x9a6bff },
  voss: { name: 'Cassian Voss', role: 'Voss Syndicate boss', color: 0x222222 },
};

export const MISSIONS = [
  { id: 0, chapter: 1, title: 'First Light', briefing: 'Mira needs wheels. Steal the Zephyr R at Marina Verde and bring it to her garage.',
    stages: [
      { objective: 'Steal the Zephyr R at Marina Verde', target: [-180, 180] },
      { objective: 'Drive it to Mira’s garage in Palm Court', target: [90, 60] },
    ], reward: 500, respect: 100 },
  { id: 1, chapter: 2, title: 'The Drop', briefing: 'A package for the Docks. Fast, quiet, no heat above 2 stars.',
    stages: [
      { objective: 'Pick up the package at Old Town', target: [-150, -150] },
      { objective: 'Deliver it to The Docks — 3:00 on the clock', target: [180, 180], timer: 180 },
    ], reward: 900, respect: 150 },
  { id: 2, chapter: 3, title: 'Heat Wave', briefing: 'The SBPD is on you. Two stars. Lose them — break line of sight and stay hidden.',
    stages: [
      { objective: 'Lose the cops — break line of sight', target: null },
      { objective: 'Stay hidden until the heat dies down', target: null },
    ], reward: 1200, respect: 200 },
  { id: 3, chapter: 4, title: 'Night Shift', briefing: 'Voss crew at the Neon Palms club. On foot. Six of them. Make it quiet — or loud.',
    stages: [
      { objective: 'Reach the Neon Palms club in Coral Row', target: [-90, 60] },
      { objective: 'Take out the Voss crew — 0 / 6 down', target: [-90, 60] },
      { objective: 'Lose any heat', target: null },
    ], reward: 1800, respect: 300 },
  { id: 4, chapter: 5, title: 'Golden Hour', briefing: 'Grab the cash at Harbor Heights, then lose the cops before the window closes. The heli is up.',
    stages: [
      { objective: 'Grab the cash at Harbor Heights', target: [150, -150] },
      { objective: 'Lose the cops before the window closes — 2:30', target: null, timer: 150 },
      { objective: 'Bring the money home to Palm Court', target: [90, 60] },
    ], reward: 2500, respect: 400 },
  { id: 5, chapter: 6, title: 'Double Cross', briefing: 'Lena set a meet at the marina. It is a trap. Survive it, then chase the traitor down.',
    stages: [
      { objective: 'Meet Lena at the marina', target: [180, 150] },
      { objective: 'Survive the ambush — take out 4', target: [180, 150] },
      { objective: 'Chase the traitor’s car', target: null },
    ], reward: 3000, respect: 450 },
  { id: 6, chapter: 7, title: 'High Tide', briefing: 'The Corsair prototype sits in the Voss compound. Take it. Bring it home in one piece.',
    stages: [
      { objective: 'Reach the Voss compound in Old Town', target: [-180, -90] },
      { objective: 'Steal the Corsair prototype', target: [-180, -90] },
      { objective: 'Bring it to Mira’s garage', target: [90, 60] },
    ], reward: 4500, respect: 600 },
  { id: 7, chapter: 8, title: 'Solara Nights', briefing: 'It ends tonight. Confront Voss at Harbor Heights, survive the siege, escape to the pier.',
    stages: [
      { objective: 'Confront Voss at Harbor Heights', target: [120, -180] },
      { objective: 'Survive the siege', target: [120, -180] },
      { objective: 'Escape to the pier at Marina Verde', target: [-180, 210] },
    ], reward: 8000, respect: 1000 },
];
