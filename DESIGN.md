# VANDARA RUSH — DESIGN.md

Open-world crime 3D (Three.js classic, 100% offline, no build step). Built fresh
in the recorded session `01a1ee60-4cb0-7662-af0a-f04498c4ecd4` for make.fun
gta6-01 ("Make GTA 6"). Everything below is original: no Rockstar/GTA names,
assets, or maps. This file is the contract every slice worker builds against —
read it before writing code, and do not change the shared APIs without telling
the coordinator.

## 1. Concept

**VANDARA RUSH** — a fictional tropical bay metropolis, **Vandara Bay**.
Damian Reyes, a young driver, returns to the city and takes jobs from Tante
Soraya (fixer, garage owner) while corrupt police chief Inspector Bramantyo
hunts him and port syndicate boss Victor Halim pulls the strings. Eight story
missions end in a midnight hydrofoil escape.

**Districts** (visual identity must differ per district):
- **Golden Pier** — coastal boulevard, wooden boardwalk, palms, beach, sea.
- **Pasar Lentera** — night-market shophouses, lantern tents, food stalls.
- **Highrise Plaza** — glass towers, wide avenues, plazas.
- **Industrial Dockyard** — colourful containers, port cranes, warehouses.

**Characters**: Damian Reyes (protagonist), Tante Soraya (fixer/garage),
Inspektur Bramantyo (corrupt police commander), Victor Halim (syndicate boss).

**Missions (8, in order)**: 1 First Delivery, 2 Lantern Chase,
3 Dockyard Heist, 4 Soraya's Escort, 5 Apex Repo, 6 Vault at Golden Pier,
7 Double Cross, 8 Last Hydrofoil Out (finale: chase to the dock before
midnight).

**Vehicles**: sport coupe "Apex GT" (player hero car), sedan, yellow taxi,
SUV, cargo truck, motorbike, mission hydrofoil (boat).

**Weapons** (data-driven in `config.js`): 1 Fists, 2 Pistol, 3 SMG,
4 Shotgun — each with muzzle flash, tracer, impact spark, screen shake.

**Radio** (Q to switch, Web Audio synth loops): VANDARA 104.2 FM,
GELOMBANG 88.8 FM.

## 2. Controlled palette (ALL hexes live in `config.js`; never invent colours)

- Golden-hour sky: peach `#ff9e64` at horizon → gold → dusk blue `#2b4170`
  at zenith. Fog `THREE.FogExp2` tinted to match the horizon (never neutral
  grey). Sun disc visible.
- Night sky: deep blue `#0f172a` → dark purple. Neon cyan / magenta /
  yellow signs. Warm emissive windows.
- Buildings: terracotta, sand cream, mint, teal (pastel). Glass towers
  reflective teal-blue.
- Asphalt warm grey `#383c46`. Sidewalk concrete `#8a8f98` with frame.
- Sea turquoise `#1f8f8a` with sun glints. Sand `#e8d5a8`.
- Police: black-white patrol cars, red/blue rotators.
- Money green `#3ddc84`. Wanted gold `#ffd23f`. Health red `#ff4d4d`,
  armour blue `#4da6ff`. Nitro cyan `#37e0ff`.

## 3. Technical architecture (classic scripts, no modules)

- Load order in `game/index.html` (plain `<script src>` in order, no
  `import`/`export`, no `fetch`, no workers):
  `vendor/three.min.js`, then `src/config.js`, `src/input.js`,
  `src/audio.js`, `src/world.js`, `src/roads.js`, `src/buildings.js`,
  `src/vehicles.js`, `src/traffic.js`, `src/pedestrians.js`, `src/player.js`,
  `src/police.js`, `src/combat.js`, `src/missions.js`, `src/economy.js`,
  `src/save.js`, `src/effects.js`, `src/hud.js`, `src/minimap.js`,
  `src/menus.js`, `src/shots.js`, `src/main.js`.
- One global namespace: `window.VR = {}`. Every file wraps itself as
  `(function(VR){ ... VR.ModuleName = {...}; })(window.VR);`.
- Three.js classic build r159 (`build/three.min.js`, `<= r159`) vendored at
  `game/vendor/three.min.js` + its `LICENSE` file. `npm i three@0.159.0`
  in a temp dir, copy the two files, delete the temp dir.
- `requestAnimationFrame` loop, fixed physics timestep `1/60` (accumulator
  max 5 steps, `dt` clamped). No `new THREE.Vector3()` or new arrays in the
  hot loop — reuse temp vectors; object pooling for bullets, particles,
  traffic, pedestrians.
- All meshes `flatShading: true`. Renderer: `antialias: true`,
  `powerPreference: "high-performance"`, pixel ratio `min(devicePixelRatio, 2)`,
  `ACESFilmicToneMapping`, exposure `1.15`, `PCFSoftShadowMap`.
  Sun `DirectionalLight` shadow camera tight
  (`left -75, right 75, top 75, bottom -75`, `mapSize 2048`,
  `bias -0.0005`) and re-centred on the player every frame.
  `HemisphereLight` (warm sky / ground bounce). No fake flat shadow blobs
  under cars; no `MeshBasicMaterial` for city objects.
- Canvas textures 1024x1024, `anisotropy = 4`: asphalt (double yellow
  centre line, dashed white lane lines, zebra crossings), framed sidewalk,
  building facades (window grid, some warm-lit).
- Fake bloom: `emissive` materials + radial-gradient glow sprites
  (`AdditiveBlending`) on street lamps, neon, car lights + thin CSS vignette
  over the canvas. No `EffectComposer`.

## 4. World layout (single source of truth: `roads.js` + `world.js`)

- City **480 x 480 units**. Streets on a grid, step **60** units:
  avenues at x/z = -210, -150, -90, -30, 30, 90, 150, 210.
  Coastal boulevard along the west edge (x = -210), sea beyond it
  (x < -240). Golden Pier district = west strip; Pasar Lentera = south;
  Highrise Plaza = centre-north; Dockyard = east.
- `VR.Roads` graph (nodes at intersections + edges along streets) is the
  single source for traffic AI, police navigation, and the minimap.
  API (do not rename): `VR.Roads.nodes` (`[{x,z}]`),
  `VR.Roads.edges`, `VR.Roads.isOnRoad(x, z)` → bool,
  `VR.Roads.nearestPointOnRoad(x, z)` → `{x, z}`,
  `VR.Roads.randomRoadPoint(rng)` → `{x, z}`,
  `VR.Roads.route(fromX, fromZ, toX, toZ)` → `[{x, z}, ...]` (along roads).
- `VR.World` API: `VR.World.scene`, `VR.World.sunLight`,
  `VR.World.setTimeOfDay(minutes)` (golden hour / night),
  `VR.World.districtAt(x, z)` → district name string,
  `VR.World.isBlocked(x, z)` → bool (AABB/circle collision via spatial hash
  grid — buildings, sea fence, trees; cars and player must NEVER pass
  through a building wall or get stuck on a roof prop),
  `VR.World.makeGlowSprite(color, size)` → `THREE.Sprite`,
  `VR.World.groundY(x, z)` → `0`.
- Buildings/props via `InstancedMesh` where it fits + deterministic seeded
  PRNG so the city is identical every load.

## 5. Shared game state (`VR.State`, in `main.js`)

```js
VR.State = {
  mode: 'title',        // 'title' | 'playing' | 'paused' | 'cutscene'
  mission: 0,           // current mission index (0..7)
  money: 28400, respect: 0,
  wanted: 0,            // 0..5
  health: 100, armor: 0,
  timeMinutes: 18*60+52, day: 1,
  inCar: false, car: null,      // VR.Vehicles car object or null
  weapon: 0,            // 0 fists, 1 pistol, 2 SMG, 3 shotgun
  ammo: { pistol: 48, smg: 120, shotgun: 18 },
  night: false
};
```

## 6. Module contracts (APIs other slices depend on — keep these exact)

- `VR.Input`: `keys` (Set of codes), `mouseDX/mouseDY` (consumed per frame),
  `pointerLocked` bool, `VR.Input.consumeMouse()` → `{dx, dy}`,
  `VR.Input.justPressed(code)` → bool (edge-triggered).
- `VR.Audio`: `VR.Audio.init()` (call on first user gesture),
  `VR.Audio.play(name)` (`'shot'|'explosion'|'siren'|'skid'|'ui'|'pickup'`),
  `VR.Audio.setEngine(rpm01, load01)`, `VR.Audio.setSiren(on)`,
  `VR.Audio.station` (0/1), `VR.Audio.nextStation()`,
  `VR.Audio.stationName()` → `'VANDARA 104.2 FM' | 'GELOMBANG 88.8 FM'`.
- `VR.Vehicles`: `VR.Vehicles.createCar(type, x, z, yaw)` → car
  `{group, type, speed, steer, hp, nitroFuel, wheels[], ...}`;
  `VR.Vehicles.playerCar` (the car the player drives, or null);
  `VR.Vehicles.update(dt)`; types: `'sport'|'sedan'|'taxi'|'suv'|
  'truck'|'bike'|'boat'`. Player hero car: sport, teal, spoiler, widebody
  fenders, LED headlights, full-width red tail bar, 4 wide wheels.
  Bicycle-model physics: responsive steering, lateral grip, `Space`
  handbrake drift + white tyre smoke, `Shift` nitro + blue/orange exhaust
  flame + FOV widen, body roll/pitch, damage smoke when HP low, explosion
  at 0 HP. `F` enters/exits any car.
- `VR.Traffic`: `VR.Traffic.cars` (array, ~45 active), `VR.Traffic.update(dt)`;
  cars follow the road graph, keep distance, stop at intersections, honk /
  swerve when the player is near.
- `VR.Peds`: `VR.Peds.list` (~35), `VR.Peds.update(dt)`;
  walkers chat/walk on sidewalks and **flee in panic** on gunfire or siren.
- `VR.Player`: `VR.Player.pos` (`THREE.Vector3`), `VR.Player.yaw`,
  `VR.Player.health`, `VR.Player.armor`, `VR.Player.enterCar(car)`,
  `VR.Player.exitCar()`, `VR.Player.update(dt)`. Third-person
  over-shoulder camera + Pointer Lock mouse look, smooth, no wall clipping,
  FOV up when sprinting/driving fast. Controls: WASD move, Shift sprint,
  Space jump, right-click aim (over-shoulder + crosshair), left-click shoot,
  F enter/exit car. Procedural limb swing `sin(t)`.
- `VR.Police`: `VR.Police.wanted` (0..5), `VR.Police.state`
  (`'IDLE'|'SEARCHING'|'PURSUIT'|'BUSTED'|'ESCAPED'`),
  `VR.Police.addHeat(n)`, `VR.Police.setWanted(n)`,
  `VR.Police.units` (patrol cars), `VR.Police.heli` (object or null),
  `VR.Police.update(dt)`. Escalation: 1–2 patrol cars (black-white, red/blue
  rotators, chase + cut off); 3 roadblocks; 4–5 armed tactical units +
  3D police helicopter ahead/above with spinning rotor + warm-white
  spotlight cone (`ConeGeometry`, additive) sweeping the road. Wanted decays
  slowly when the player escapes line of sight + search radius (shown on
  minimap).
- `VR.Combat`: `VR.Combat.shoot()` (current weapon), `VR.Combat.update(dt)`,
  muzzle flash + tracer + impact spark + screen shake. Weapon data lives in
  `VR.Config.WEAPONS`.
- `VR.Missions`: `VR.Missions.list` (8, from `VR.Config.MISSIONS`),
  `VR.Missions.current` (index), `VR.Missions.start(i)`,
  `VR.Missions.objectiveText` (string), `VR.Missions.targetPos` (`{x,z}`),
  `VR.Missions.completeObjective()`, `VR.Missions.beacon` (gold light-pillar
  mesh, `CylinderGeometry` additive, at the current target).
  Dialogue via `VR.HUD.showDialogue(name, role, text)` — full sentences,
  never cut mid-word in screenshots.
- `VR.Economy`: `VR.Economy.money`, `VR.Economy.respect`,
  `VR.Economy.addMoney(n)`, `VR.Economy.addRespect(n)`,
  weapon shop / garage (repair + repaint) / safehouse hooks.
- `VR.Save`: `VR.Save.save()`, `VR.Save.load()` → bool,
  `VR.Save.hasSave()` → bool (localStorage, Continue button on title).
- `VR.Effects`: `VR.Effects.spawnSmoke(x,y,z,n)`,
  `VR.Effects.spawnFlame(x,y,z,n)`, `VR.Effects.muzzleFlash(pos, dir)`,
  `VR.Effects.tracer(from, to)`, `VR.Effects.explosion(x,y,z)`,
  `VR.Effects.shake(amount)`, `VR.Effects.update(dt)` (pooled).
- `VR.HUD`: DOM ids — `#hud`, `#mission-box`, `#mission-title`,
  `#mission-objective`, `#mission-toast`, `#dialogue-box`,
  `#dialogue-name`, `#dialogue-text`, `#money`, `#clock`, `#weather-icon`,
  `#wanted-stars`, `#speedo`, `#speed-value`, `#gear`, `#nitro-bar`,
  `#condition-bar`, `#weapon-slot`, `#weapon-icon`, `#weapon-ammo`,
  `#radio-capsule`, `#controls-hint`, `#crosshair`.
  `VR.HUD.update(dt)`, `VR.HUD.showDialogue(name, role, text)`,
  `VR.HUD.showToast(text)`.
- `VR.Minimap`: canvas `#minimap-canvas` (~190px, `border-radius: 50%`,
  bottom-left). Static map (sea blue, parks green, building blocks, road
  network) rendered ONCE to an offscreen canvas; each frame clip a circle,
  rotate by camera yaw, draw dynamic blips (white player arrow centred,
  rotating `N` at the rim, blinking red/blue police dots, yellow mission
  icon, shop icons, police search circle). District name above the minimap
  on change; thin Health (red) + Armour (blue) bars beside it.
  `VR.Minimap.update(dt)`.
- `VR.Menus`: title screen (orbiting cinematic camera; Continue / New Game /
  Controls / Settings), pause menu with full city map + legend + stats.
  `VR.Menus.showTitle()`, `VR.Menus.showPause()`, `VR.Menus.hideAll()`.
- `VR.Shots`: `?shot=cover|night|combat|map` staging. Sets the scene up,
  lets the game run live, sets `window.__gameReady = true` when booted +
  one frame rendered, and `window.__shotReady = true` only when the frame
  is final (dialogue fully typed, chase in frame). Cover MUST show:
  player sport car drifting (white tyre smoke + blue exhaust flame) on the
  Golden Pier boulevard, 2 police cars with lit rotators chasing, helicopter
  with spotlight ahead, civilian traffic, pedestrians on the boardwalk, sea
  + palms on the coast side, gold mission light pillar ahead, full HUD +
  round minimap.

## 7. File list (one clear job each, 2–3 line header comment, descriptive names)

```
game/index.html
game/vendor/three.min.js (+ LICENSE)
game/src/config.js  input.js  audio.js  world.js  roads.js  buildings.js
game/src/vehicles.js  traffic.js  pedestrians.js  player.js  police.js
game/src/combat.js  missions.js  economy.js  hud.js  minimap.js  menus.js
game/src/save.js  effects.js  shots.js  main.js
game/src/hud.css
main.ts  serve.ts  shots.json  README.md  DESIGN.md  LICENSE
screenshots/01-cover.jpg  02-night-pursuit.jpg  03-onfoot-combat.jpg
  04-world-map.jpg   (1280x720, each < 256 KiB, no debug overlay)
```

## 8. Verification (every slice, no exceptions)

- `node --check` every JS file you write (classic scripts parse as scripts;
  the gate's js_parses row is informational, but a syntax error kills the game).
- Serve via repo `serve.ts` (`node serve.ts --port <n>`), open in headless
  Chromium (Playwright, `playwright-core` in
  `~/workspace/makefun/gta6-01-work/tools/node_modules/`), viewport
  1280x720. Console errors must be **0**. Evaluate the visuals yourself
  from screenshots — do not claim done from asserts alone.
- Cover acceptance (all must hold): player car reads as a sports car (not a
  box) · ≥2 police cars AND helicopter visible in frame · ≥3 big palms
  visible · ≥1 readable sign/billboard · gold mission pillar visible ·
  round minimap + full HUD visible · dialogue (if any) complete, never cut
  mid-word · 0 console errors.
- Final: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` + kit check
  (`node cli/makefun.mjs check ...`) — all gate rows pass, 0 failed.
- Never use generic `pkill -f` (it kills your own shell). Kill by explicit
  PID only. Verify the state of every action before moving on.
- Do NOT read the v3/v2/v1 committed files for content. Build fresh from
  this DESIGN.md + the super prompt. (Reference lessons only: the car must
  read as a sports car; police + heli must be IN the cover frame; palms big
  and visible; dialogue complete; flatShading + controlled palette, not
  dark metalness paint.)

## 9. Slices

- **A** (foundation): three.js vendor, index.html, config, input, world,
  roads, buildings, player, main boot + loop. Playable on-foot city.
- **B**: vehicles (physics + all types), traffic, pedestrians, effects.
- **C**: HUD, minimap radar, menus (title/pause/full map).
- **D**: police wanted system + heli, combat (4 weapons).
- **E**: 8 missions + dialogue, economy/shops/garage, audio (engine/siren/
  radio), save/load.
- **F**: shots.js staging + 4 screenshots + main.ts + README + final
  verification (playtest + main.ts + kit check) + commit + push.
