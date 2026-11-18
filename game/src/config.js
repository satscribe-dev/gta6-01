// config.js — all shared data for VANDARA RUSH: palette, districts,
// weapons, vehicles, missions, radio, world constants. No logic here,
// just data every other module reads from VR.Config.
(function (VR) {
  'use strict';

  VR.Config = {

    // ---- World constants (single source of truth) ----
    WORLD_SIZE: 480,          // city is 480 x 480 units
    WORLD_HALF: 240,
    STREET_STEP: 60,          // grid step between streets
    STREET_MIN: -210,         // first street coordinate
    STREET_MAX: 210,          // last street coordinate
    ROAD_HALF_WIDTH: 6,       // half-width of a normal 2-lane street
    BOULEVARD_HALF_WIDTH: 11, // coastal boulevard x = -210, 4 lanes
    SEA_LINE: -240,           // sea begins west of this x
    BOARDWALK_X: -228,        // boardwalk strip centre x

    // ---- Controlled palette (DESIGN.md §2 — never invent colours) ----
    PALETTE: {
      skyHorizon: 0xff9e64,   // golden-hour peach at horizon
      skyZenith: 0x2b4170,    // dusk blue at zenith
      skyNightTop: 0x0f172a,  // night deep blue
      skyNightHorizon: 0x2a1b4a, // night dark purple
      fogHorizon: 0xff9e64,   // fog tinted to match horizon
      sun: 0xffd27a,
      asphalt: 0x383c46,      // warm grey
      sidewalk: 0x8a8f98,     // concrete
      sea: 0x1f8f8a,           // turquoise
      sand: 0xe8d5a8,
      boardwalk: 0x8a5a33,
      terracotta: 0xc96f4a,
      sandCream: 0xe8d5a8,
      mint: 0x7fc8a9,
      teal: 0x2e8b8b,
      glassTeal: 0x3fa7c4,
      policeBlack: 0x111318,
      policeWhite: 0xf2f2f2,
      money: 0x3ddc84,
      wanted: 0xffd23f,
      health: 0xff4d4d,
      armor: 0x4da6ff,
      nitro: 0x37e0ff,
      neonCyan: 0x37e0ff,
      neonMagenta: 0xff4da6,
      neonYellow: 0xffd23f,
      windowWarm: 0xffc46b,
      palmTrunk: 0x7a5230,
      palmLeaf: 0x2f9e5f,
      containerRed: 0xc0392b,
      containerBlue: 0x2471a3,
      containerGreen: 0x1e8449,
      containerYellow: 0xd4ac0d,
      containerOrange: 0xca6f1e,
      damianShirt: 0x2e86c1,
      damianPants: 0x2c3e50,
      damianSkin: 0xc98d64,
      damianHair: 0x1a1a1a
    },

    // ---- Districts (bounds are [minX, maxX, minZ, maxZ]) ----
    DISTRICTS: [
      { name: 'Golden Pier',        bounds: [-240, -150, -240, 240] },
      { name: 'Industrial Dockyard', bounds: [150, 240, -240, 240] },
      { name: 'Pasar Lentera',      bounds: [-150, 150, 90, 240] },
      { name: 'Highrise Plaza',     bounds: [-150, 150, -240, 90] }
    ],

    // ---- Weapons (data-driven; VR.Combat reads this) ----
    // fireInterval: seconds between shots. spread: radians. ammo: reserve.
    WEAPONS: [
      { id: 0, name: 'Fists',   damage: 12,  fireInterval: 0.45, magSize: 0,   ammo: 0,   spread: 0,     range: 2.2,  auto: false },
      { id: 1, name: 'Pistol',  damage: 22,  fireInterval: 0.28, magSize: 12,  ammo: 48,  spread: 0.012, range: 60,   auto: false },
      { id: 2, name: 'SMG',     damage: 14,  fireInterval: 0.09, magSize: 30,  ammo: 120, spread: 0.045, range: 45,   auto: true },
      { id: 3, name: 'Shotgun', damage: 11,  fireInterval: 0.85, magSize: 6,   ammo: 18,  spread: 0.09,  range: 22,   auto: false, pellets: 8 }
    ],

    // ---- Vehicles (7 types) ----
    VEHICLES: {
      sport: { name: 'Apex GT',   topSpeed: 52, accel: 26, brake: 42, grip: 3.4, steer: 1.9, color: 0x0e7c7b, seats: 2,  hp: 100 },
      sedan: { name: 'Aurum S',   topSpeed: 38, accel: 18, brake: 32, grip: 3.0, steer: 1.6, color: 0x8a8f98, seats: 4,  hp: 100 },
      taxi:  { name: 'Bay Taxi',  topSpeed: 36, accel: 17, brake: 32, grip: 3.0, steer: 1.6, color: 0xf7c948, seats: 4,  hp: 100 },
      suv:   { name: 'Jungle X',  topSpeed: 40, accel: 19, brake: 30, grip: 2.8, steer: 1.4, color: 0x3d5a80, seats: 5,  hp: 140 },
      truck: { name: 'Harbor Haul', topSpeed: 30, accel: 12, brake: 26, grip: 2.4, steer: 1.1, color: 0xc96f4a, seats: 2,  hp: 180 },
      bike:  { name: 'Thunder R', topSpeed: 46, accel: 24, brake: 36, grip: 2.6, steer: 2.4, color: 0xc0392b, seats: 2,  hp: 60 },
      boat:  { name: 'Hydrofoil', topSpeed: 48, accel: 20, brake: 20, grip: 2.0, steer: 1.3, color: 0xe8e8e8, seats: 4,  hp: 120 }
    },

    // ---- Missions (8, in story order) ----
    MISSIONS: [
      {
        title: 'First Delivery',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'Damian, dear, this city has changed since you left. Take this package to Pasar Lentera before the lanterns light up. Don\'t let the police catch a whiff of it.',
        objective: 'Drive the package to Pasar Lentera',
        reward: 1500, respect: 10
      },
      {
        title: 'Lantern Chase',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'Halim\'s men are chasing our courier through the market alley. Go after him, Damian, and bring the goods back. Don\'t let them slip away past the lanterns.',
        objective: 'Chase the courier through Pasar Lentera',
        reward: 2500, respect: 15
      },
      {
        title: 'Dockyard Heist',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'The blue container at the Dockyard holds port documents that could bring Halim down. Slip in quietly, grab them, and get out before the cranes stop moving.',
        objective: 'Steal the documents from the Dockyard',
        reward: 4000, respect: 20
      },
      {
        title: "Soraya's Escort",
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'Tonight I have to meet someone at Golden Pier, and Bramantyo has already caught wind of it. Escort me to the boardwalk, Damian. Don\'t let a single bullet touch me.',
        objective: 'Escort Soraya to Golden Pier',
        reward: 3500, respect: 20
      },
      {
        title: 'Apex Repo',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'That Apex GT is yours, Damian. Halim seized it and stashed it in a Highrise Plaza garage. Take your car back, and show them who the best driver in Vandara Bay is.',
        objective: 'Recover the Apex GT from Highrise Plaza',
        reward: 0, respect: 25
      },
      {
        title: 'Vault at Golden Pier',
        giver: 'Victor Halim', role: 'Syndicate Boss',
        dialogue: 'Reyes. You\'ve done good work so far. The small vault under the Golden Pier dock holds my money. Open it, take your cut, and don\'t think about running. I always know.',
        objective: 'Open the vault under Golden Pier',
        reward: 8000, respect: 10
      },
      {
        title: 'Double Cross',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'Halim set you up, Damian. The vault was bait, and Bramantyo is already waiting outside. Run now, dear. Don\'t trust anyone tonight, except me.',
        objective: 'Escape the ambush at Golden Pier',
        reward: 5000, respect: 30
      },
      {
        title: 'Last Hydrofoil Out',
        giver: 'Tante Soraya', role: 'Fixer & Garage Owner',
        dialogue: 'This is the last one, Damian. The hydrofoil is waiting at the dock before midnight. Bramantyo has closed every road and Halim has sent all his men. Run, and never look back.',
        objective: 'Reach the hydrofoil before midnight',
        reward: 12000, respect: 50
      }
    ],

    // ---- Radio stations (Web Audio synth loops, Q to switch) ----
    RADIO: [
      { name: 'VANDARA 104.2 FM', genre: 'Tropical pop & city beats' },
      { name: 'GELOMBANG 88.8 FM', genre: 'Late-night jazz & soul' }
    ],

    // ---- Player tuning ----
    PLAYER: {
      walkSpeed: 5.2,
      sprintSpeed: 9.0,
      jumpSpeed: 7.5,
      gravity: 22,
      eyeHeight: 1.62,
      camDistance: 4.6,
      camHeight: 2.1
    }
  };

})(window.VR = window.VR || {});
