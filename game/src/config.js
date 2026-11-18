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
      asphalt: 0x3d363b,      // warm plum-tinted asphalt (never neutral grey)
      sidewalk: 0x9a8d80,     // warm taupe concrete
      sea: 0x1f8f8a,           // turquoise
      sand: 0xe8d5a8,
      boardwalk: 0xa8703a,    // rich warm cedar (never mud brown)
      terracotta: 0xff7a6b,   // saturated coral (was muted terracotta)
      sandCream: 0xffc93c,    // vivid kuning (was pale cream)
      coral: 0xff7a6b,         // bold coral accent
      yellow: 0xffc93c,        // vivid kuning accent
      pink: 0xff5fa2,          // bold hot-pink accent
      mint: 0x5fd4b8,          // saturated mint
      teal: 0x1fb5b0,          // saturated teal
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
      palmTrunk: 0x96603a,    // rich warm brown trunk
      palmLeaf: 0x2f9e5f,
      containerRed: 0xc0392b,
      containerBlue: 0x2471a3,
      containerGreen: 0x1e8449,
      containerYellow: 0xffc93c,
      containerOrange: 0xf07b1d,
      damianShirt: 0x2e86c1,
      damianPants: 0x2c3e50,
      damianSkin: 0xc98d64,
      damianHair: 0x1a1a1a,
      // ---- W7 district facades (r5): one controlled set per district,
      // mirrored as data in DISTRICTS.facades below (weights there cap
      // each facade at ~30% of its district's buildings). ----
      pierSand: 0xe8d5a8, pierCream: 0xf2e3c6, pierCoral: 0xff8a70, pierTan: 0xd9b380,
      marketBrick: 0xa84332, marketOchre: 0xd9a441, marketCream: 0xf0d9a0, marketDeepRed: 0x8e2f23,
      plazaGlassBlue: 0x3f7fb8, plazaGlassGreen: 0x2f6b5a, plazaGlassSlate: 0x6b7f8c, plazaGlassTeal: 0x2e7f8a,
      dockSteel: 0x8a8f98, dockSteelBlue: 0x6b7c8a, dockRust: 0x8a5a3b, dockDarkSteel: 0x5f6b73,
      windowDarkBlue: 0x1f3a5f, windowWarmWhite: 0xfff2d9, windowDark: 0x2a2f38,
      roofBrown: 0x5a4632, tankRust: 0x7a5a40
    },

    // ---- Districts (bounds are [minX, maxX, minZ, maxZ]) ----
    // W7 (r5): each district carries its own facade set + window set.
    // facades: {c, w, trim, pattern} — c = base colour, w = weight
    // (no facade exceeds ~30% of its district, enforced by quota in
    // buildings.js), trim = band/mullion colour, pattern = bands /
    // brick / grid / corrugated. windows: {c, w, lit} — mixed window
    // colours, never all yellow; lit ones glow at night.
    DISTRICTS: [
      { name: 'Golden Pier',        bounds: [-240, -150, -240, 240], accent: 0xff7a6b, // coral
        facades: [
          { c: 0xe8d5a8, w: 0.30, trim: 0xff7a6b, pattern: 'bands' },  // sand
          { c: 0xf2e3c6, w: 0.30, trim: 0xe07856, pattern: 'bands' },  // cream
          { c: 0xff8a70, w: 0.25, trim: 0xe8d5a8, pattern: 'bands' },  // coral
          { c: 0xd9b380, w: 0.15, trim: 0x8a6b45, pattern: 'bands' }   // tan
        ],
        windows: [
          { c: 0x1f3a5f, w: 0.40, lit: false }, // dark blue glass
          { c: 0xfff2d9, w: 0.25, lit: true },  // warm white, lit
          { c: 0x2a2f38, w: 0.25, lit: false }, // dark
          { c: 0xffd27a, w: 0.10, lit: true }   // warm yellow, lit
        ] },
      { name: 'Industrial Dockyard', bounds: [150, 240, -240, 240],  accent: 0xff6b1a, // safety orange
        facades: [
          { c: 0x8a8f98, w: 0.30, trim: 0x5f6b73, pattern: 'corrugated' }, // steel
          { c: 0x6b7c8a, w: 0.25, trim: 0x3d4a55, pattern: 'corrugated' }, // steel blue
          { c: 0x8a5a3b, w: 0.25, trim: 0x5f3a26, pattern: 'corrugated' }, // rust
          { c: 0x5f6b73, w: 0.20, trim: 0x8a8f98, pattern: 'corrugated' }  // dark steel
        ],
        windows: [
          { c: 0x2a2f38, w: 0.50, lit: false }, // dark
          { c: 0x1f3a5f, w: 0.30, lit: false }, // dark blue glass
          { c: 0xffd27a, w: 0.10, lit: true },  // warm yellow, lit
          { c: 0xfff2d9, w: 0.10, lit: true }   // warm white, lit
        ] },
      { name: 'Pasar Lentera',      bounds: [-150, 150, 90, 240],    accent: 0xc0392b, // brick red
        facades: [
          { c: 0xa84332, w: 0.30, trim: 0x7c2f22, pattern: 'brick' },  // brick red
          { c: 0xd9a441, w: 0.30, trim: 0x8a6b2f, pattern: 'brick' },  // ochre
          { c: 0xf0d9a0, w: 0.25, trim: 0xc0392b, pattern: 'brick' },  // warm cream
          { c: 0x8e2f23, w: 0.15, trim: 0xd9a441, pattern: 'brick' }   // deep red
        ],
        windows: [
          { c: 0x1f3a5f, w: 0.35, lit: false }, // dark blue glass
          { c: 0xffe9b0, w: 0.30, lit: true },  // warm lit (market glows)
          { c: 0x2a2f38, w: 0.20, lit: false }, // dark
          { c: 0xffc46b, w: 0.15, lit: true }   // warm yellow, lit
        ] },
      { name: 'Highrise Plaza',     bounds: [-150, 150, -240, 90],   accent: 0x37e0ff, // neon cyan
        facades: [
          { c: 0x3f7fb8, w: 0.30, trim: 0x1c2f3a, pattern: 'grid' }, // glass blue
          { c: 0x2f6b5a, w: 0.30, trim: 0x14261f, pattern: 'grid' }, // glass green
          { c: 0x6b7f8c, w: 0.25, trim: 0x2c313a, pattern: 'grid' }, // glass slate
          { c: 0x2e7f8a, w: 0.15, trim: 0x14333a, pattern: 'grid' }  // glass teal
        ],
        windows: [
          { c: 0x274b63, w: 0.45, lit: false }, // dark blue glass
          { c: 0x1a2530, w: 0.30, lit: false }, // dark
          { c: 0xfff2d9, w: 0.15, lit: true },  // warm white, lit
          { c: 0xcfe8ff, w: 0.10, lit: true }   // cool white, lit
        ] }
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
      sedan: { name: 'Aurum S',   topSpeed: 38, accel: 18, brake: 32, grip: 3.0, steer: 1.6, color: 0x8b98a8, seats: 4,  hp: 100 },
      taxi:  { name: 'Bay Taxi',  topSpeed: 36, accel: 17, brake: 32, grip: 3.0, steer: 1.6, color: 0xf7c948, seats: 4,  hp: 100 },
      suv:   { name: 'Jungle X',  topSpeed: 40, accel: 19, brake: 30, grip: 2.8, steer: 1.4, color: 0x3d5a80, seats: 5,  hp: 140 },
      truck: { name: 'Harbor Haul', topSpeed: 30, accel: 12, brake: 26, grip: 2.4, steer: 1.1, color: 0xff7a6b, seats: 2,  hp: 180 },
      bike:  { name: 'Thunder R', topSpeed: 46, accel: 24, brake: 36, grip: 2.6, steer: 2.4, color: 0xc0392b, seats: 2,  hp: 60 },
      boat:  { name: 'Hydrofoil', topSpeed: 48, accel: 20, brake: 20, grip: 2.0, steer: 1.3, color: 0xeaf2f0, seats: 4,  hp: 120 }
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
