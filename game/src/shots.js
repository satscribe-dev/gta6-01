// SOLARA BAY — screenshot staging. Reads ?shot=chase|title|foot|roam&seed=1, sets the scene
// up, lets the game run live, then sets window.__shotReady for the capture script.
// Positions are found by probing game.world.isOnRoad so staging never depends on the exact
// street layout world.js chose.
import { MISSIONS } from './config.js';

function findRoadPoint(game, nearX, nearZ) {
  for (let r = 0; r < 120; r += 10) {
    for (let dx = -r; dx <= r; dx += 10) {
      for (let dz = -r; dz <= r; dz += 10) {
        if (game.world.isOnRoad(nearX + dx, nearZ + dz)) return [nearX + dx, nearZ + dz];
      }
    }
  }
  return [nearX, nearZ];
}

function roadHeading(game, x, z) {
  // A road runs along the axis where the neighbour cells are also road.
  const alongX = game.world.isOnRoad(x + 12, z) && game.world.isOnRoad(x - 12, z);
  const alongZ = game.world.isOnRoad(x, z + 12) && game.world.isOnRoad(x, z - 12);
  if (alongX && !alongZ) return 0;
  if (alongZ && !alongX) return Math.PI / 2;
  return 0;
}

// v2: the dialogue typewriter runs on the clamped game clock (dt <= 0.05), so at
// ~1 fps under SwiftShader a briefing needs ~40 s of real time to type out.
// A fixed timer would capture mid-sentence. Wait until the HUD reports the full
// text on screen (window.__dialogueComplete), with a 120 s fallback so a shot
// never hangs the capture run.
function readyWhenDialogueComplete(onReady, fallbackMs = 120000) {
  const started = Date.now();
  const tick = () => {
    if (window.__dialogueComplete === true) {
      if (onReady) onReady();
      window.__shotReady = true;
      return;
    }
    if (Date.now() - started > fallbackMs) {
      window.__shotReady = true; // give up waiting: capture whatever is showing
      return;
    }
    window.setTimeout(tick, 250);
  };
  window.setTimeout(tick, 250);
}

function setMissionDisplay(game, missionId, stage) {
  const m = MISSIONS[missionId];
  const s = m.stages[stage];
  game.missions.current = missionId;
  game.missions.stage = stage;
  game.missions.state = 'active';
  game.missions.objective = s.objective;
  game.missions.target = s.target;
  game.events.emit('objective', { text: s.objective, stage: stage + 1, total: m.stages.length, chapter: m.chapter, title: m.title });
  game.events.emit('dialogue', { who: 'mira', role: 'Wheelwoman', text: m.briefing });
}

export function stageShot(game, name, seed) {
  // Deterministic-ish staging; the seed is accepted for future use.
  void seed;
  if (name === 'title') {
    readyWhenDialogueComplete();
    return;
  }

  if (name === 'chase') {
    game.time.day = 1;
    game.time.minutes = 18 * 60 + 52; // golden hour
    const [x, z] = findRoadPoint(game, 0, 60);
    const heading = roadHeading(game, x, z);
    // Put the player in a Zephyr on the road, moving, then raise the heat.
    import('./player.js').then((player) => {
      const parked = game.cars.find((c) => c.isParked);
      if (parked) {
        parked.pos.set(x, 0, z);
        parked.heading = heading;
        parked.isParked = false;
        player.enterCar(parked);
        parked.speed = 34;
      }
    });
    import('./police.js').then((police) => police.setWanted(4));
    setMissionDisplay(game, 4, 1); // Golden Hour — lose the cops, timer stage
    game.money = 38420;
    game.respect = 458;
    game.respectLevel = 4;
    readyWhenDialogueComplete();
    return;
  }

  if (name === 'foot') {
    game.time.day = 1;
    game.time.minutes = 21 * 60 + 42; // night
    const [x, z] = findRoadPoint(game, -90, 60);
    game.player.pos.set(x, 0, z + 6);
    game.player.heading = Math.PI;
    game.player.onFoot = true;
    game.player.weapon = 2; // SMG
    setMissionDisplay(game, 3, 1); // Night Shift — take out the crew
    game.money = 9850;
    game.respect = 500;
    game.respectLevel = 2;
    // Fire one burst right when the dialogue is fully typed, so the tracer +
    // muzzle flash are still on screen for the capture (the old fixed 2200 ms
    // timer fired ~40 s before the dialogue finished at 1 fps).
    readyWhenDialogueComplete(() => { game.input.clicked = true; });
    return;
  }

  if (name === 'roam') {
    game.time.day = 2;
    game.time.minutes = 14 * 60 + 30; // bright afternoon
    const [x, z] = findRoadPoint(game, -60, 30);
    game.player.pos.set(x, 0, z + 4);
    game.player.heading = Math.PI / 4;
    game.player.onFoot = true;
    game.money = 12480;
    game.respect = 820;
    game.respectLevel = 2;
    game.events.emit('dialogue', { who: 'lena', role: 'Fixer', text: 'Solara Bay is yours today, Kai. Taxi fares, races, sun coins — pick your hustle.' });
    readyWhenDialogueComplete();
    return;
  }

  readyWhenDialogueComplete();
}
