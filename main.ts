// VANDARA RUSH — entry bundler for make.fun gta6-01 (Node 22+, stdlib only).
//
// What this does, in order:
//   1. Resolves the output directory: MAKEFUN_OUTPUT_DIR when set (local
//      runs), /output otherwise (the grader's container).
//   2. Refuses to run when game/ or screenshots/ is missing, or when the
//      screenshot set is wrong — a half-built entry must fail loudly
//      here, not silently ship a broken bundle to the judge.
//   3. Copies game/ and screenshots/ from beside this file into the
//      output directory, then writes /output/dossier.json through the
//      vendored make.fun library (vendor/makefun-game.ts, untouched).
//
// The game itself is plain static files: game/index.html plus classic
// <script> files under game/src/, Three.js r159 vendored at
// game/vendor/three.min.js. No build step, no network at runtime.
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const EXPECTED_SHOTS = ['01-cover.jpg', '02-night-pursuit.jpg', '03-onfoot-combat.jpg', '04-world-map.jpg'];
const SHOT_MAX_BYTES = 262144;

function fail(message) {
  console.error('main.ts: ' + message);
  process.exit(1);
}

function checkShots(dir) {
  const found = readdirSync(dir)
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort();
  const missing = EXPECTED_SHOTS.filter((name) => !found.includes(name));
  if (missing.length) fail('screenshots/ is missing: ' + missing.join(', '));
  const extra = found.filter((name) => !EXPECTED_SHOTS.includes(name));
  if (extra.length) fail('screenshots/ has unexpected files: ' + extra.join(', '));
  for (const name of EXPECTED_SHOTS) {
    const size = statSync(join(dir, name)).size;
    if (size > SHOT_MAX_BYTES) fail(`${name} is ${size} bytes, over the 256 KiB cap`);
  }
  return found;
}

const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');
if (!existsSync(join(gameDir, 'index.html'))) fail('game/index.html not found beside main.ts');
if (!existsSync(shotsDir)) fail('screenshots/ not found beside main.ts');
const shots = checkShots(shotsDir);

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes
// shapes the bytes; the rest refuse an entry the scorer would refuse
// (more than 4 screenshots or one over 256 KiB; more than 993 files in
// game/ or 48 MiB of game files in all; any game/ path over 1000 bytes).
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(`VANDARA RUSH bundled to ${outDir}`);
console.log(`  game/ copied, ${shots.length} screenshots (${shots.join(', ')})`);
console.log('  dossier.json written');
