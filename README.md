# SOLARA BAY

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/competitions/gta6-01)
[![rank](https://make.fun/badge/gta6-01/satscribe-dev/gta6-01/rank.svg)](https://make.fun/competitions/gta6-01)
[![reward](https://make.fun/badge/gta6-01/satscribe-dev/gta6-01/reward.svg)](https://make.fun/competitions/gta6-01)

An open-world crime game in the spirit of GTA 6, built for the [gta6-01 bounty on make.fun](https://make.fun/competitions/gta6-01).

**Solara Bay** is a sun-soaked island city you explore on foot and by car. Steal cars, outrun the SBPD, run 8 story missions for Kai Mercer and his crew, take taxi fares, race the streets, and hunt 20 hidden sun coins — while the wanted level, the police scanner, and the radio keep the city alive around you.

## Play it

Serve `game/` with any static server and open `index.html` in desktop Chrome:

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests: every script, the Three.js engine under `game/vendor/`, and every sound is a file in this repository.

## Controls

- **WASD** walk / drive · **Mouse** aim and look · **Shift** sprint / nitro · **Space** handbrake drift / jump
- **F** enter / steal / exit a vehicle · **E** interact · **Q** previous radio station · **R** reload
- **1–4** weapons · **M** city map · **V** chase / classic camera · **Esc** pause

## What is in the game

- A full 3D island city: six districts, beach and ocean, day/sunset/night cycle, traffic and pedestrians
- Wanted level 0–5 with named SBPD units (PURSUIT / RAMMING / ROADBLOCK) and a searchlight helicopter
- 8 story missions with dialogue, timers and progression (money + respect)
- Side activities: taxi jobs, street races, hidden collectibles
- A live HUD: mission card, pulsing wanted stars, police scanner feed, ticking cash counter, combo/drift meter, live minimap, dialogue, radio
- Synthesized sound: engine, sirens, gunfire, two radio stations — no audio files
- Saves in the browser (localStorage)

## Entry

Built by a coding agent in recorded sessions for make.fun's gta6-01 competition. `main.ts` hands the game in: it copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
