// PUERTO MIRA — HUD, title screen, pause menu, map overlay. W5.
// Fills every HUD element in index.html and keeps it ALIVE: ticking cash,
// pulsing wanted stars, scrolling PMPD scanner chatter, moving minimap blips,
// typewriter dialogue, centre combo popups. update() only mutates textContent /
// style / classes — it never rebuilds DOM per frame. All reads of other
// systems are defensive: police/missions/world may not exist yet when a shot
// is staged, and the HUD must still render.
import { WEAPONS, RADIO, CHARACTERS, MISSIONS, DISTRICTS, CITY } from './config.js';
import { STREETS } from './world.js';
import { hasSave, saveGame, loadGame } from './save.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtClock = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};
const fmtTimer = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const hexCss = (hex) => '#' + hex.toString(16).padStart(6, '0');

// ---------- weapon slot icons (v3) ----------
// Drawn silhouettes, not text: each slot shows the weapon's shape in white
// on the dark tile (top-1 style). Fist / pistol / SMG / shotgun side views,
// plus a padlock for the locked 5th slot. currentColor so the tile controls
// the tint; viewBoxes keep the natural proportions of each weapon.
const WEAPON_ICONS = {
  0: '<svg viewBox="0 0 40 28" aria-hidden="true"><g fill="currentColor"><rect x="6" y="12" width="28" height="14" rx="4"/><circle cx="11" cy="11" r="4.5"/><circle cx="18" cy="9.5" r="4.5"/><circle cx="25" cy="9.5" r="4.5"/><circle cx="31" cy="11" r="4"/></g></svg>',
  1: '<svg viewBox="0 0 40 28" aria-hidden="true"><g fill="currentColor"><rect x="3" y="6" width="31" height="7" rx="1.5"/><rect x="33" y="8" width="4" height="3.5" rx="1"/><path d="M11 13 L19 13 L17 26 L9 26 Z"/><rect x="22" y="13" width="3" height="5"/></g></svg>',
  2: '<svg viewBox="0 0 48 28" aria-hidden="true"><g fill="currentColor"><rect x="7" y="8" width="30" height="7" rx="2"/><rect x="37" y="9.5" width="9" height="4" rx="1"/><path d="M14 15 L22 15 L20 27 L12 27 Z"/><rect x="27" y="15" width="5" height="5"/><rect x="2" y="9" width="5" height="6" rx="1"/></g></svg>',
  3: '<svg viewBox="0 0 48 28" aria-hidden="true"><g fill="currentColor"><rect x="12" y="8" width="32" height="4.5" rx="1"/><rect x="12" y="13.5" width="24" height="4" rx="1"/><path d="M3 8 L13 8 L13 17 L8 17 L6 25 L2 25 L2 12 Z"/><rect x="18" y="17.5" width="5" height="5"/></g></svg>',
};
const LOCK_ICON = '<svg viewBox="0 0 24 28" aria-hidden="true"><rect x="4" y="12" width="16" height="13" rx="2" fill="currentColor"/><path d="M8 13 V9 a4 4 0 0 1 8 0 v4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

// ---------- dialogue portrait (v3) ----------
// Drawn face silhouette (head + shoulders), not initials: the character's
// colour stays as the tile background, the white silhouette is the face.
const PORTRAIT_SVG = '<svg viewBox="0 0 56 56" aria-hidden="true"><g fill="#ffffff"><circle cx="28" cy="21" r="12"/><path d="M9 56 Q9 37 28 37 Q47 37 47 56 Z"/></g></svg>';

let gameRef = null;

// Cached element refs (built once in init).
const el = {};
// Transient HUD state.
const S = {
  displayedMoney: 0,
  moneyFlashUntil: 0,
  wantedShown: -1,
  prevHealth: 100,
  prevWeapon: -1,
  prevRadio: '',
  prevDistrict: '',
  prevRespect: -1,
  prevMode: '',
  missionKey: '',
  missionTimer: 0,
  missionTimerSet: false,
  driftStreak: 0,
  driftResetAt: 0,
  dialogue: null, // { full, shown, timer, holdUntil }
  mapOpen: false,
  titleSaveChecked: false,
  now: 0,
};

function districtAtFallback(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  if (z > CITY.beachZ) return 'Marina Verde';
  return 'Puerto Mira';
}

function districtName(x, z) {
  if (gameRef && gameRef.world && typeof gameRef.world.districtAt === 'function') {
    try {
      return gameRef.world.districtAt(x, z) || districtAtFallback(x, z);
    } catch (err) {
      return districtAtFallback(x, z);
    }
  }
  return districtAtFallback(x, z);
}

function currentMission() {
  const idx = gameRef && gameRef.missions ? gameRef.missions.current ?? 0 : 0;
  return MISSIONS[clamp(idx, 0, MISSIONS.length - 1)];
}

function currentStage() {
  const m = currentMission();
  const stage = gameRef && gameRef.missions ? gameRef.missions.stage ?? 0 : 0;
  return m.stages[clamp(stage, 0, m.stages.length - 1)];
}

function missionTarget() {
  if (gameRef && gameRef.missions && gameRef.missions.target) return gameRef.missions.target;
  const st = currentStage();
  return st && st.target ? st.target : null;
}

// ---------- real street network (same data as the 3D world) ----------
// The street lines come from world.js (exported STREETS / game.world.streets)
// — never re-typed here, so the minimap can never drift from the 3D city.
// Streets run the full city width; vertical streets end where the beach
// starts (z = CITY.beachZ) and the z = 222 line IS beach, not road —
// game.world.isOnRoad agrees, so both are excluded from the drivable net.
function roadStreets() {
  const w = gameRef && gameRef.world && Array.isArray(gameRef.world.streets)
    ? gameRef.world.streets : null;
  return (w && w.length) ? w : STREETS;
}

// Nearest point ON the street network to (x, z). Every street is a segment:
// vertical streets x = s, z in [-half, beachZ]; horizontal streets z = s
// (s <= beachZ), x in [-half, half].
function snapToRoad(x, z) {
  const streets = roadStreets();
  let best = null;
  for (const s of streets) {
    const vz = clamp(z, -CITY.half, CITY.beachZ);
    const d2v = (x - s) * (x - s) + (z - vz) * (z - vz);
    if (!best || d2v < best.d2) best = { x: s, z: vz, d2: d2v };
    if (s > CITY.beachZ) continue;
    const hx = clamp(x, -CITY.half, CITY.half);
    const d2h = (x - hx) * (x - hx) + (z - s) * (z - s);
    if (d2h < best.d2) best = { x: hx, z: s, d2: d2h };
  }
  return best;
}

// Shortest route that FOLLOWS the streets (never cuts across blocks).
// Graph: the 7x6 intersections plus the snapped start/end as extra nodes.
// Start/end connect to every intersection on their own street line (weight =
// true along-street distance), intersections connect to their 4 neighbours.
// Dijkstra over ~44 nodes — trivial cost, run once per map redraw.
function routeAlongRoads(from, to) {
  const streets = roadStreets();
  const rows = streets.filter((s) => s <= CITY.beachZ); // horizontal streets
  const a = snapToRoad(from[0], from[1]);
  const b = snapToRoad(to[0], to[1]);
  const key = (i, j) => i + ',' + j;
  const coord = (k) => {
    if (k === 'S') return [a.x, a.z];
    if (k === 'T') return [b.x, b.z];
    const parts = k.split(',');
    return [streets[+parts[0]], rows[+parts[1]]];
  };
  const neighbors = (k) => {
    const out = [];
    const [x, z] = coord(k);
    if (k === 'S' || k === 'T') {
      for (let i = 0; i < streets.length; i++) {
        for (let j = 0; j < rows.length; j++) {
          const ix = streets[i];
          const iz = rows[j];
          if (ix === x || iz === z) {
            const d = Math.abs(ix - x) + Math.abs(iz - z);
            if (d > 0) out.push([key(i, j), d]);
          }
        }
      }
      const other = k === 'S' ? 'T' : 'S';
      const [ox, oz] = coord(other);
      if (ox === x || oz === z) out.push([other, Math.abs(ox - x) + Math.abs(oz - z)]);
      return out;
    }
    const parts = k.split(',');
    const i = +parts[0];
    const j = +parts[1];
    const adj = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
    for (const [ni, nj] of adj) {
      if (ni < 0 || ni >= streets.length || nj < 0 || nj >= rows.length) continue;
      out.push([key(ni, nj), Math.abs(streets[ni] - streets[i]) + Math.abs(rows[nj] - rows[j])]);
    }
    // The snapped start/end sit ON a street line: an intersection on that
    // same line can reach them directly (weight = along-street distance).
    // Without these edges Dijkstra could never arrive at T at all.
    for (const other of ['S', 'T']) {
      const [ox, oz] = coord(other);
      if (ox === x || oz === z) {
        const d = Math.abs(ox - x) + Math.abs(oz - z);
        if (d > 0) out.push([other, d]);
      }
    }
    return out;
  };
  const dist = new Map([['S', 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let uk = null;
    let ud = Infinity;
    for (const [k, d] of dist) {
      if (!done.has(k) && d < ud) { uk = k; ud = d; }
    }
    if (uk === null || uk === 'T') break;
    done.add(uk);
    for (const [nk, w] of neighbors(uk)) {
      const nd = ud + w;
      if (nd < (dist.has(nk) ? dist.get(nk) : Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, uk);
      }
    }
  }
  if (!dist.has('T')) return [[a.x, a.z], [b.x, b.z]];
  const path = [];
  let cur = 'T';
  while (cur) {
    path.unshift(coord(cur));
    cur = prev.get(cur);
  }
  return path;
}

// ---------- combo popups ----------
function showCombo(title, sub, kind) {
  const box = el.combo;
  if (!box) return;
  while (box.children.length >= 3) box.removeChild(box.firstChild);
  const pop = document.createElement('div');
  pop.className = 'combo-pop' + (kind ? ' ' + kind : '');
  const t = document.createElement('div');
  t.className = 'combo-title';
  t.textContent = title;
  const s = document.createElement('div');
  s.className = 'combo-sub';
  s.textContent = sub;
  pop.appendChild(t);
  pop.appendChild(s);
  box.appendChild(pop);
  // Force reflow so the CSS animation restarts even for rapid repeats.
  void pop.offsetWidth;
  pop.classList.add('show');
  window.setTimeout(() => {
    if (pop.parentNode) pop.parentNode.removeChild(pop);
  }, 1700);
}

// ---------- scanner feed ----------
function scannerRow(text, kind) {
  const feed = el.scanner;
  if (!feed) return;
  const row = document.createElement('div');
  row.className = 'scanner-row' + (kind ? ' ' + kind : '');
  const time = gameRef && gameRef.time ? fmtClock(gameRef.time.minutes) : '';
  row.textContent = (time ? time + '  ' : '') + text;
  feed.insertBefore(row, feed.firstChild);
  while (feed.children.length > 5) feed.removeChild(feed.lastChild);
}

// ---------- dialogue typewriter ----------
function startDialogue(who, role, text) {
  const card = el.dialogue;
  if (!card || !text) return;
  // who may be a key ('mira') or a full name ('Mira Solano': missions.js
  // and activities.js emit c.name). Resolve both so the portrait colour
  // matches the speaker; unknown speakers keep the orange fallback.
  const ch = (who && CHARACTERS[who])
    || Object.values(CHARACTERS).find((c) => c.name === who)
    || null;
  const name = ch ? ch.name : (who || '???');
  const roleText = role || (ch ? ch.role : '');
  const color = ch ? hexCss(ch.color) : '#ff7a2e';
  el.dlgPortrait.innerHTML = PORTRAIT_SVG;
  el.dlgPortrait.style.background = color;
  el.dlgName.textContent = name;
  el.dlgRole.textContent = roleText;
  el.dlgText.textContent = '';
  card.classList.remove('hidden');
  card.classList.add('visible');
  window.__dialogueComplete = false; // new dialogue started: not fully shown yet
  S.dialogue = { full: String(text), shown: 0, timer: 0, holdUntil: 0 };
}

function updateDialogue(dt) {
  const d = S.dialogue;
  if (!d) return;
  if (d.shown < d.full.length) {
    d.timer += dt;
    const target = Math.floor(d.timer * 45);
    if (target !== d.shown) {
      d.shown = Math.min(d.full.length, target);
      el.dlgText.textContent = d.full.slice(0, d.shown);
    }
    if (d.shown >= d.full.length) {
      d.holdUntil = S.now + 3.0;
      window.__dialogueComplete = true; // full text on screen — safe to capture
    }
  } else if (S.now >= d.holdUntil) {
    el.dialogue.classList.remove('visible');
    el.dialogue.classList.add('hidden');
    window.__dialogueComplete = false; // card hidden: no complete dialogue showing
    S.dialogue = null;
  }
}

// ---------- damage vignette ----------
function flashDamage() {
  const v = el.vignette;
  if (!v) return;
  v.classList.remove('flash');
  void v.offsetWidth;
  v.classList.add('flash');
}

// ---------- minimap / big map ----------
function drawMap(canvasEl, size) {
  if (!canvasEl) return;
  const ctx2d = canvasEl.getContext('2d');
  if (!ctx2d) return;
  const scale = size / (CITY.half * 2);
  const px = (v) => (v + CITY.half) * scale;
  const big = size >= 400;
  ctx2d.clearRect(0, 0, size, size);
  // v3: the minimap is a full CIRCLE — clip every layer (base, beach,
  // streets, route, blips, player arrow) to the disc so no square corner
  // can ever show. The big map (M) stays square: no clip there.
  ctx2d.save();
  if (!big) {
    ctx2d.beginPath();
    ctx2d.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx2d.clip();
  }
  // City base.
  ctx2d.fillStyle = '#232a3d';
  ctx2d.fillRect(0, 0, size, size);
  // Beach + ocean (south edge, z > 200).
  ctx2d.fillStyle = '#c9b078';
  ctx2d.fillRect(0, px(CITY.beachZ), size, size - px(CITY.beachZ));
  ctx2d.fillStyle = '#1e6f8e';
  ctx2d.fillRect(0, px(CITY.oceanZ), size, size - px(CITY.oceanZ));
  // District tint + labels on the big map.
  if (big) {
    ctx2d.font = 'bold 13px system-ui, sans-serif';
    ctx2d.textAlign = 'center';
    for (const d of DISTRICTS) {
      ctx2d.fillStyle = 'rgba(255,255,255,0.05)';
      ctx2d.fillRect(px(d.x0), px(d.z0), px(d.x1) - px(d.x0), px(d.z1) - px(d.z0));
      ctx2d.fillStyle = 'rgba(255,255,255,0.55)';
      ctx2d.fillText(d.name.toUpperCase(), (px(d.x0) + px(d.x1)) / 2, (px(d.z0) + px(d.z1)) / 2);
    }
  }
  // Real streets, drawn as roads — not a grid: each street is an asphalt
  // band CITY.street wide on the exact STREETS lines from world.js, with a
  // dark casing edge and a dashed centre line (same yellow as the 3D dashes).
  // Intersections form themselves where vertical meets horizontal. Vertical
  // bands stop at the beach (z = CITY.beachZ); the z = 222 line is sand.
  const streets = roadStreets();
  const halfW = (CITY.street / 2) * scale;
  const casing = halfW + Math.max(1, scale * 1.5);
  const beachTop = px(CITY.beachZ);
  ctx2d.fillStyle = '#141824'; // casing (dark edge)
  for (const s of streets) {
    ctx2d.fillRect(px(s) - casing, 0, casing * 2, beachTop);
    if (s <= CITY.beachZ) ctx2d.fillRect(0, px(s) - casing, size, casing * 2);
  }
  ctx2d.fillStyle = '#3a4054'; // asphalt
  for (const s of streets) {
    ctx2d.fillRect(px(s) - halfW, 0, halfW * 2, beachTop);
    if (s <= CITY.beachZ) ctx2d.fillRect(0, px(s) - halfW, size, halfW * 2);
  }
  ctx2d.strokeStyle = 'rgba(245,215,110,0.85)'; // centre dashes
  ctx2d.lineWidth = Math.max(1, scale * 1.2);
  ctx2d.setLineDash([Math.max(4, scale * 6), Math.max(4, scale * 6)]);
  ctx2d.beginPath();
  for (const s of streets) {
    ctx2d.moveTo(px(s), 0);
    ctx2d.lineTo(px(s), beachTop);
    if (s <= CITY.beachZ) {
      ctx2d.moveTo(0, px(s));
      ctx2d.lineTo(size, px(s));
    }
  }
  ctx2d.stroke();
  ctx2d.setLineDash([]);
  // Route line to the mission target — follows the streets (BFS/Dijkstra
  // over the intersections), never a straight cut across blocks. The
  // mission marker sits on the road too: snapped for DISPLAY only, the
  // real 3D target in missions.js is untouched.
  const target = missionTarget();
  const p = gameRef && gameRef.player ? gameRef.player.pos : null;
  const markerAt = target ? snapToRoad(target[0], target[1]) : null;
  if (target && p) {
    const path = routeAlongRoads([p.x, p.z], target);
    ctx2d.strokeStyle = '#ffc93c';
    ctx2d.lineWidth = big ? 3 : 2;
    ctx2d.setLineDash([7, 5]);
    ctx2d.beginPath();
    path.forEach(([wx, wz], i) => {
      if (i === 0) ctx2d.moveTo(px(wx), px(wz));
      else ctx2d.lineTo(px(wx), px(wz));
    });
    ctx2d.stroke();
    ctx2d.setLineDash([]);
  }
  // Traffic (grey dots).
  if (gameRef && Array.isArray(gameRef.cars)) {
    ctx2d.fillStyle = '#9aa3b2';
    for (const car of gameRef.cars) {
      if (!car || !car.isTraffic || !car.pos) continue;
      ctx2d.beginPath();
      ctx2d.arc(px(car.pos.x), px(car.pos.z), big ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  // Police units (red dots, moving) + helicopter (ringed dot).
  if (gameRef && gameRef.police) {
    const units = Array.isArray(gameRef.police.units) ? gameRef.police.units : [];
    for (const u of units) {
      const pos = u && u.car ? u.car.pos : (u && u.pos ? u.pos : null);
      if (!pos) continue;
      ctx2d.fillStyle = '#ff2e4d';
      ctx2d.beginPath();
      ctx2d.arc(px(pos.x), px(pos.z), big ? 5 : 3.5, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = '#ffffff';
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    }
    const heli = gameRef.police.helicopter;
    const hpos = heli && heli.car ? heli.car.pos : (heli && heli.pos ? heli.pos : null);
    if (hpos) {
      ctx2d.fillStyle = '#ff2e4d';
      ctx2d.beginPath();
      ctx2d.arc(px(hpos.x), px(hpos.z), big ? 7 : 5, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = '#ffc93c';
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    }
  }
  // Mission marker (pulsing gold diamond) — snapped onto the road.
  if (markerAt) {
    const pulse = 1 + 0.25 * Math.sin(S.now * 5);
    const r = (big ? 9 : 6) * pulse;
    const mx = px(markerAt.x);
    const my = px(markerAt.z);
    ctx2d.fillStyle = '#ffc93c';
    ctx2d.beginPath();
    ctx2d.moveTo(mx, my - r);
    ctx2d.lineTo(mx + r, my);
    ctx2d.lineTo(mx, my + r);
    ctx2d.lineTo(mx - r, my);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();
  }
  // Player arrow (orange triangle, rotated to heading).
  if (p) {
    const heading = gameRef.player.heading ?? 0;
    const x = px(p.x);
    const y = px(p.z);
    const r = big ? 10 : 8;
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(Math.PI - heading);
    ctx2d.fillStyle = '#ff7a2e';
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(0, -r);
    ctx2d.lineTo(r * 0.8, r);
    ctx2d.lineTo(0, r * 0.4);
    ctx2d.lineTo(-r * 0.8, r);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.stroke();
    ctx2d.restore();
  }
  if (big) {
    ctx2d.fillStyle = 'rgba(255,255,255,0.8)';
    ctx2d.font = 'bold 14px system-ui, sans-serif';
    ctx2d.textAlign = 'left';
    ctx2d.fillText('N', 10, 22);
  }
  ctx2d.restore(); // undo the minimap circle clip (no-op for the big map)
}

// ---------- mission card ----------
function refreshMissionCard() {
  if (!el.mission) return;
  const m = currentMission();
  const stageIdx = gameRef && gameRef.missions ? gameRef.missions.stage ?? 0 : 0;
  const stage = m.stages[clamp(stageIdx, 0, m.stages.length - 1)];
  const state = gameRef && gameRef.missions ? gameRef.missions.state : 'idle';
  const key = m.id + ':' + stageIdx + ':' + state + ':' + (gameRef.missions ? (gameRef.missions.objective || '') : '');
  const objective = (gameRef.missions && gameRef.missions.objective) || stage.objective;
  // Nothing changed since the last refresh — textContent writes every frame
  // are wasted layout work. Only the timer (updateMissionTimer) ticks.
  if (key === S.missionKey) return;
  S.missionKey = key;
  el.mcChapter.textContent = 'CHAPTER ' + m.chapter + ' — ' + (state === 'done' ? 'COMPLETE' : state === 'failed' ? 'FAILED' : state === 'active' ? 'ACTIVE' : 'STANDBY');
  el.mcTitle.textContent = m.title;
  el.mcObjective.textContent = objective;
  el.mcStageText.textContent = 'STAGE ' + (stageIdx + 1) + ' / ' + m.stages.length;
  el.mcStageFill.style.width = ((stageIdx + 1) / m.stages.length * 100) + '%';
  const next = m.stages[stageIdx + 1];
  el.mcNext.textContent = next
    ? 'NEXT: ' + next.objective + '  ·  REWARD $' + m.reward.toLocaleString('en-US')
    : 'FINAL STAGE  ·  REWARD $' + m.reward.toLocaleString('en-US') + '  ·  +' + m.respect + ' RESPECT';
  // (Re)arm the stage timer when the stage changes.
  S.missionTimer = stage && stage.timer ? stage.timer : 0;
  S.missionTimerSet = !!(stage && stage.timer);
  el.mission.classList.remove('flash');
  void el.mission.offsetWidth;
  el.mission.classList.add('flash');
}

// ---------- visibility ----------
function refreshVisibility() {
  const mode = gameRef ? gameRef.mode : 'title';
  if (mode === S.prevMode && S.titleSaveChecked) return;
  S.prevMode = mode;
  const hud = $('hud');
  if (hud) hud.classList.toggle('hidden', mode === 'title');
  if (el.title) el.title.classList.toggle('hidden', mode !== 'title');
  if (el.pause) el.pause.classList.toggle('hidden', mode !== 'paused');
  if (el.endOverlay) el.endOverlay.classList.toggle('hidden', mode !== 'busted' && mode !== 'wasted');
  if (mode === 'busted' && el.endTitle) {
    el.endTitle.textContent = 'BUSTED';
    el.endText.textContent = 'The PMPD took you in. $200 fine — wake up at the hospital and try again.';
  }
  if (mode === 'wasted' && el.endTitle) {
    el.endTitle.textContent = 'WASTED';
    el.endText.textContent = 'Kai is down. Hospital bill $300 — wake up and take the bay back.';
  }
  if (mode === 'title') refreshTitleSave();
}

// ---------- title screen ----------
function refreshTitleSave() {
  const save = loadGame();
  S.titleSaveChecked = true;
  if (el.btnContinue) el.btnContinue.disabled = !hasSave();
  if (!el.titleSave) return;
  if (save) {
    const m = MISSIONS[clamp(save.mission ?? 0, 0, MISSIONS.length - 1)];
    const when = save.savedAt ? new Date(save.savedAt).toLocaleString() : '';
    el.titleSave.textContent = 'SAVE FOUND — ' + fmtMoney(save.money ?? 0) + '  ·  Day ' + (save.day ?? 1) + '  ·  ' + m.title + (when ? '  ·  ' + when : '');
  } else {
    el.titleSave.textContent = 'NO SAVE YET — NEW GAME STARTS CHAPTER 1: FIRST LIGHT';
  }
}

function buildTitle() {
  const t = el.title;
  if (!t) return;
  t.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'title-inner';
  const logo = document.createElement('div');
  logo.className = 'title-logo';
  logo.innerHTML = 'PUERTO<span>MIRA</span>';
  const tag = document.createElement('div');
  tag.className = 'title-tag';
  tag.textContent = 'Steal the sunset. Outrun the PMPD. Take back the bay.';
  const saveLine = document.createElement('div');
  saveLine.className = 'title-save';
  saveLine.id = 'title-save-line';
  el.titleSave = saveLine;
  const btns = document.createElement('div');
  btns.className = 'title-buttons';
  const mkBtn = (id, label, cls, fn) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'menu-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    btns.appendChild(b);
    return b;
  };
  el.btnContinue = mkBtn('btn-continue', 'CONTINUE', 'primary', () => {
    if (gameRef.audio) gameRef.audio.play('blip');
    gameRef.continueGame();
  });
  el.btnNew = mkBtn('btn-new', 'NEW GAME', '', () => {
    if (gameRef.audio) gameRef.audio.play('blip');
    gameRef.startNewGame();
  });
  const how = document.createElement('div');
  how.className = 'title-how hidden';
  how.id = 'title-how';
  how.innerHTML = '<div class="how-title">HOW TO PLAY</div>'
    + '<div class="how-row"><b>WASD</b> drive / walk &nbsp;·&nbsp; <b>SHIFT</b> nitro / sprint &nbsp;·&nbsp; <b>SPACE</b> drift / jump</div>'
    + '<div class="how-row"><b>F</b> enter / exit car &nbsp;·&nbsp; <b>E</b> interact &nbsp;·&nbsp; <b>CLICK</b> shoot</div>'
    + '<div class="how-row"><b>1–4</b> weapons &nbsp;·&nbsp; <b>R</b> reload &nbsp;·&nbsp; <b>Q</b> radio &nbsp;·&nbsp; <b>M</b> map &nbsp;·&nbsp; <b>V</b> camera</div>'
    + '<div class="how-row">Follow the gold marker. Lose the stars — break line of sight and stay hidden.</div>'
    + '<div class="how-row">Taxi fares, street races and 20 sun-discs pay extra. Save from the pause menu.</div>';
  el.titleHow = how;
  const settings = document.createElement('div');
  settings.className = 'title-settings hidden';
  settings.id = 'title-settings';
  const musicBtn = document.createElement('button');
  musicBtn.className = 'menu-btn small';
  musicBtn.textContent = 'MUSIC: ON';
  musicBtn.addEventListener('click', () => {
    const a = gameRef.audio;
    if (a && a.setMusic) {
      a.setMusic(!a.musicOn);
      musicBtn.textContent = 'MUSIC: ' + (a.musicOn ? 'ON' : 'OFF');
    }
  });
  const sfxBtn = document.createElement('button');
  sfxBtn.className = 'menu-btn small';
  sfxBtn.textContent = 'SFX: ON';
  sfxBtn.addEventListener('click', () => {
    const a = gameRef.audio;
    if (a && a.setSfx) {
      a.setSfx(!a.sfxOn);
      sfxBtn.textContent = 'SFX: ' + (a.sfxOn ? 'ON' : 'OFF');
    }
  });
  settings.appendChild(musicBtn);
  settings.appendChild(sfxBtn);
  el.btnHow = mkBtn('btn-how', 'HOW TO PLAY', '', () => {
    how.classList.toggle('hidden');
    settings.classList.add('hidden');
  });
  el.btnSettings = mkBtn('btn-settings', 'SETTINGS', '', () => {
    settings.classList.toggle('hidden');
    how.classList.add('hidden');
  });
  const chars = document.createElement('div');
  chars.className = 'title-chars';
  for (const key of ['kai', 'mira', 'theo', 'lena', 'voss']) {
    const c = CHARACTERS[key];
    if (!c) continue;
    const card = document.createElement('div');
    card.className = 'char-card' + (key === 'voss' ? ' villain' : '');
    const face = document.createElement('div');
    face.className = 'char-face';
    face.style.background = hexCss(c.color);
    face.textContent = c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const nm = document.createElement('div');
    nm.className = 'char-name';
    nm.textContent = c.name;
    const rl = document.createElement('div');
    rl.className = 'char-role';
    rl.textContent = c.role;
    card.appendChild(face);
    card.appendChild(nm);
    card.appendChild(rl);
    chars.appendChild(card);
  }
  inner.appendChild(logo);
  inner.appendChild(tag);
  inner.appendChild(saveLine);
  inner.appendChild(btns);
  inner.appendChild(chars);
  inner.appendChild(how);
  inner.appendChild(settings);
  t.appendChild(inner);
  refreshTitleSave();
}

function buildPause() {
  const p = el.pause;
  if (!p) return;
  p.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'pause-inner';
  const title = document.createElement('div');
  title.className = 'pause-title';
  title.textContent = 'PAUSED';
  const note = document.createElement('div');
  note.className = 'pause-note';
  note.id = 'pause-note';
  el.pauseNote = note;
  const how = document.createElement('div');
  how.className = 'pause-how hidden';
  how.innerHTML = '<div class="how-row"><b>WASD</b> drive / walk · <b>SHIFT</b> nitro / sprint · <b>SPACE</b> drift / jump</div>'
    + '<div class="how-row"><b>F</b> enter / exit car · <b>E</b> interact · <b>CLICK</b> shoot</div>'
    + '<div class="how-row"><b>1–4</b> weapons · <b>R</b> reload · <b>Q</b> radio · <b>M</b> map · <b>V</b> camera</div>';
  const mkBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'menu-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    inner.appendChild(b);
    return b;
  };
  inner.appendChild(title);
  mkBtn('RESUME', 'primary', () => gameRef.togglePause());
  mkBtn('SAVE GAME', '', () => {
    const ok = saveGame();
    if (el.pauseNote) el.pauseNote.textContent = ok ? 'SAVED — ' + fmtMoney(gameRef.money) + ' · Day ' + gameRef.time.day : 'SAVE FAILED — STORAGE UNAVAILABLE';
  });
  mkBtn('LOAD GAME', '', () => {
    if (hasSave()) {
      gameRef.continueGame();
    } else if (el.pauseNote) {
      el.pauseNote.textContent = 'NO SAVE FOUND';
    }
  });
  mkBtn('CONTROLS', '', () => how.classList.toggle('hidden'));
  mkBtn('QUIT TO TITLE', '', () => gameRef.quitToTitle());
  inner.appendChild(note);
  inner.appendChild(how);
  p.appendChild(inner);
}

function buildEndOverlay() {
  const o = document.createElement('div');
  o.id = 'end-overlay';
  o.className = 'hidden';
  const inner = document.createElement('div');
  inner.className = 'end-inner';
  const title = document.createElement('div');
  title.className = 'end-title';
  title.textContent = 'BUSTED';
  el.endTitle = title;
  const text = document.createElement('div');
  text.className = 'end-text';
  el.endText = text;
  const btn = document.createElement('button');
  btn.className = 'menu-btn primary';
  btn.textContent = 'RESPAWN';
  btn.addEventListener('click', () => gameRef.respawn());
  inner.appendChild(title);
  inner.appendChild(text);
  inner.appendChild(btn);
  o.appendChild(inner);
  document.body.appendChild(o);
  el.endOverlay = o;
}

function buildMapOverlay() {
  const o = document.createElement('div');
  o.id = 'map-overlay';
  o.className = 'hidden';
  const title = document.createElement('div');
  title.className = 'map-title';
  title.textContent = 'PUERTO MIRA — MAP  ·  M TO CLOSE';
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 480;
  canvasEl.height = 480;
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.textContent = 'ORANGE — YOU · RED — PMPD · GOLD — MISSION · GREY — TRAFFIC';
  o.appendChild(title);
  o.appendChild(canvasEl);
  o.appendChild(legend);
  o.addEventListener('click', () => {
    S.mapOpen = false;
    o.classList.add('hidden');
  });
  document.body.appendChild(o);
  el.mapOverlay = o;
  el.mapCanvas = canvasEl;
}

// ---------- per-frame updates ----------
function updateMoney(dt) {
  if (!el.money) return;
  const target = gameRef.money ?? 0;
  const diff = target - S.displayedMoney;
  if (Math.abs(diff) < 1) {
    S.displayedMoney = target;
  } else {
    const rate = Math.max(300, Math.abs(diff) * 5);
    S.displayedMoney += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
  }
  const text = fmtMoney(S.displayedMoney);
  if (el.money.textContent !== text) el.money.textContent = text;
  if (S.now < S.moneyFlashUntil) {
    el.money.classList.add(target >= 0 ? 'gain' : 'loss');
  } else {
    el.money.classList.remove('gain', 'loss');
  }
}

function updateWanted() {
  const stars = clamp(gameRef.wanted ?? 0, 0, 5);
  if (stars === S.wantedShown) return;
  const rising = stars > S.wantedShown;
  S.wantedShown = stars;
  const spans = el.stars ? el.stars.children : [];
  for (let i = 0; i < spans.length; i += 1) {
    spans[i].classList.toggle('lit', i < stars);
  }
  if (rising && stars > 0 && el.stars) {
    el.stars.classList.remove('rising');
    void el.stars.offsetWidth;
    el.stars.classList.add('rising');
  }
}

function updateWeapons() {
  const w = gameRef.player.weapon ?? 1;
  // Active weapon tile (bottom-right, by the speedo): refresh on switch only.
  if (w !== S.prevWeapon) {
    if (el.awIcon) el.awIcon.innerHTML = WEAPON_ICONS[w] || '';
    if (el.awName) el.awName.textContent = WEAPONS[w] ? WEAPONS[w].name.toUpperCase() : '';
  }
  const slots = el.weapons ? el.weapons.children : [];
  for (let i = 0; i < slots.length; i += 1) {
    const wp = WEAPONS[i];
    if (!wp) { // the locked 5th tile has no weapon: never active, no ammo
      slots[i].classList.toggle('active', false);
      continue;
    }
    const ammoEl = slots[i].querySelector('.ws-ammo');
    let ammoText = '—';
    if (wp.id === 0) ammoText = '∞';
    else if (wp.id === 1) ammoText = String(gameRef.player.ammo.pistol ?? wp.ammo);
    else if (wp.id === 2) ammoText = String(gameRef.player.ammo.smg ?? wp.ammo);
    else if (wp.id === 3) ammoText = String(gameRef.player.ammo.shotgun ?? wp.ammo);
    if (ammoEl && ammoEl.textContent !== ammoText) ammoEl.textContent = ammoText;
    slots[i].classList.toggle('active', i === w);
  }
  S.prevWeapon = w;
}

function updateSpeedo() {
  if (!el.speedo && !el.healthArmour) return;
  const car = gameRef.currentCar;
  const onFoot = !car || gameRef.player.onFoot;
  if (el.speedo) el.speedo.classList.toggle('hidden', onFoot);
  if (el.healthArmour) el.healthArmour.classList.toggle('hidden', !onFoot);
  if (!onFoot && car && el.speedo) {
    const kmh = Math.round(Math.abs(car.speed ?? 0) * 3.6);
    if (el.spSpeed.textContent !== String(kmh)) el.spSpeed.textContent = String(kmh);
    const top = car.topSpeed ?? 60;
    const gear = clamp(1 + Math.floor(Math.abs(car.speed ?? 0) / top * 4.99), 1, 5);
    el.spGear.textContent = 'GEAR ' + gear;
    const carName = car.type ? (car.name || car.type) : 'CAR';
    if (el.spCar.textContent !== carName) el.spCar.textContent = carName;
    const cond = clamp(car.condition ?? 100, 0, 100);
    el.spCondFill.style.width = cond + '%';
    el.spCondFill.classList.toggle('low', cond < 30);
    const nitro = car.type === 'zephyr';
    if (el.spNitroRow) el.spNitroRow.classList.toggle('hidden', !nitro);
    if (nitro) {
      // W6 fix: the gauge is fuel (0–100), not the nitro boolean — car.nitro
      // is true/false, which clamped to a permanent ~1% bar.
      const n = clamp(car.nitroFuel ?? 100, 0, 100);
      el.spNitroFill.style.width = n + '%';
    }
  }
  if (onFoot && el.healthArmour) {
    const hp = clamp(gameRef.player.health ?? 100, 0, 100);
    const ar = clamp(gameRef.player.armour ?? 0, 0, 100);
    el.hpFill.style.width = hp + '%';
    el.hpFill.classList.toggle('low', hp < 30);
    el.hpText.textContent = 'HEALTH ' + Math.round(hp);
    el.arFill.style.width = ar + '%';
    el.arText.textContent = 'ARMOUR ' + Math.round(ar);
  }
}

function updateRadio() {
  const a = gameRef.audio;
  const ri = a && typeof a.radioIndex === 'number' ? a.radioIndex : 0;
  const ti = a && typeof a.trackIndex === 'number' ? a.trackIndex : 0;
  const key = ri + ':' + ti;
  if (key === S.prevRadio) return;
  S.prevRadio = key;
  const st = RADIO[clamp(ri, 0, RADIO.length - 1)];
  if (el.radioStation) el.radioStation.textContent = st.station + ' · ' + st.genre;
  if (el.radioTrack) el.radioTrack.textContent = st.tracks[clamp(ti, 0, st.tracks.length - 1)] || '';
}

function updateClockDistrict() {
  const clockText = 'Day ' + (gameRef.time.day ?? 1) + '  ' + fmtClock(gameRef.time.minutes ?? 0);
  if (el.clock && el.clock.textContent !== clockText) el.clock.textContent = clockText;
  const d = districtName(gameRef.player.pos.x, gameRef.player.pos.z);
  if (d !== S.prevDistrict) {
    S.prevDistrict = d;
    if (el.district && el.district.textContent !== d) el.district.textContent = d;
  }
  const respect = gameRef.respect ?? 0;
  if (respect !== S.prevRespect && el.respectLabel && el.respectFill) {
    S.prevRespect = respect;
    const level = clamp(gameRef.respectLevel ?? 1, 1, 5);
    const prog = ((respect % 500) / 500) * 100;
    el.respectLabel.textContent = 'RESPECT  LV ' + level;
    el.respectFill.style.width = prog + '%';
  }
}

function updateMissionTimer(dt) {
  if (!S.missionTimerSet) {
    if (el.mcTimer) el.mcTimer.textContent = '';
    return;
  }
  if (gameRef.mode === 'playing') S.missionTimer = Math.max(0, S.missionTimer - dt);
  if (el.mcTimer) {
    const text = '◷ ' + fmtTimer(S.missionTimer);
    if (el.mcTimer.textContent !== text) el.mcTimer.textContent = text;
    el.mcTimer.classList.toggle('urgent', S.missionTimer > 0 && S.missionTimer < 30);
  }
}

// ---------- init ----------
function init(game) {
  gameRef = game;

  el.mission = $('mission-card');
  el.money = $('money');
  el.stars = $('wanted-stars');
  el.clock = $('clock');
  el.scanner = $('scanner-feed');
  el.weapons = $('weapon-slots');
  el.minimap = $('minimap');
  el.district = $('district');
  el.respect = $('respect-bar');
  el.dialogue = $('dialogue-card');
  el.speedo = $('speedo');
  el.healthArmour = $('health-armour');
  el.radio = $('radio-bar');
  el.combo = $('combo-popup');
  el.vignette = $('damage-vignette');
  el.hint = $('controls-hint');
  el.title = $('title-screen');
  el.pause = $('pause-menu');

  // v3 circular minimap: the canvas + "N" compass move into a round wrapper
  // (.mm-circle) so the compass rides the ring's top edge, GTA-style. The
  // header pill above the circle keeps PUERTO MIRA + the district name.
  // Guarded: if either node is missing the compass simply stays in the
  // header — no crash, no other HUD logic touched.
  const mmCompass = document.querySelector('#minimap-header .mm-compass');
  if (el.minimap && mmCompass && el.minimap.parentNode) {
    const circle = document.createElement('div');
    circle.className = 'mm-circle';
    el.minimap.parentNode.insertBefore(circle, el.minimap);
    circle.appendChild(el.minimap);
    circle.appendChild(mmCompass);
  }

  // City badge (v3): the header pill's text lives in index.html (static, not
  // a file this worker owns), so the rename is applied here at boot — the
  // pill reads PUERTO MIRA from the first frame on.
  const mmTitle = document.querySelector('#minimap-header .mm-title');
  if (mmTitle) mmTitle.textContent = 'PUERTO MIRA';

  // Mission card skeleton.
  if (el.mission) {
    el.mission.innerHTML = '';
    const mk = (tag, cls) => {
      const n = document.createElement(tag);
      n.className = cls;
      el.mission.appendChild(n);
      return n;
    };
    el.mcChapter = mk('div', 'mc-chapter');
    el.mcTitle = mk('div', 'mc-title');
    el.mcObjective = mk('div', 'mc-objective');
    const stageBar = mk('div', 'mc-stage');
    el.mcStageFill = document.createElement('div');
    el.mcStageFill.className = 'mc-stage-fill';
    stageBar.appendChild(el.mcStageFill);
    el.mcStageText = document.createElement('span');
    el.mcStageText.className = 'mc-stage-text';
    stageBar.appendChild(el.mcStageText);
    el.mcTimer = mk('div', 'mc-timer');
    el.mcNext = mk('div', 'mc-next');
  }

  // Wanted stars: 5 glyphs, lit per wanted level.
  if (el.stars) {
    el.stars.innerHTML = '';
    for (let i = 0; i < 5; i += 1) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      el.stars.appendChild(s);
    }
  }

  // Weapon slots 1-4 from config WEAPONS — icon tiles, not text rows:
  // [key badge] + drawn weapon silhouette + ammo count under the icon.
  // The weapon NAME lives under the active tile only (CSS shows it).
  // A 5th locked tile (padlock, dark) teases the next weapon.
  if (el.weapons) {
    el.weapons.innerHTML = '';
    WEAPONS.forEach((wp, i) => {
      const slot = document.createElement('div');
      slot.className = 'weapon-slot';
      const key = document.createElement('span');
      key.className = 'ws-key';
      key.textContent = String(i + 1);
      const icon = document.createElement('span');
      icon.className = 'ws-icon';
      icon.innerHTML = WEAPON_ICONS[wp.id] || '';
      const ammo = document.createElement('span');
      ammo.className = 'ws-ammo';
      ammo.textContent = wp.id === 0 ? '∞' : String(wp.ammo);
      const name = document.createElement('span');
      name.className = 'ws-name';
      name.textContent = wp.name.toUpperCase();
      slot.appendChild(key);
      slot.appendChild(icon);
      slot.appendChild(ammo);
      slot.appendChild(name);
      el.weapons.appendChild(slot);
    });
    const lock = document.createElement('div');
    lock.className = 'weapon-slot locked';
    const lockIcon = document.createElement('span');
    lockIcon.className = 'ws-icon';
    lockIcon.innerHTML = LOCK_ICON;
    const lockLabel = document.createElement('span');
    lockLabel.className = 'ws-ammo lock-label';
    lockLabel.textContent = 'LOCKED';
    lock.appendChild(lockIcon);
    lock.appendChild(lockLabel);
    el.weapons.appendChild(lock);
  }

  // Respect bar skeleton.
  if (el.respect) {
    el.respect.innerHTML = '';
    el.respectLabel = document.createElement('div');
    el.respectLabel.className = 'respect-label';
    el.respectLabel.textContent = 'RESPECT  LV 1';
    const track = document.createElement('div');
    track.className = 'respect-track';
    el.respectFill = document.createElement('div');
    el.respectFill.className = 'respect-fill';
    track.appendChild(el.respectFill);
    el.respect.appendChild(el.respectLabel);
    el.respect.appendChild(track);
  }

  // Dialogue card skeleton.
  if (el.dialogue) {
    el.dialogue.innerHTML = '';
    el.dialogue.classList.add('hidden');
    el.dlgPortrait = document.createElement('div');
    el.dlgPortrait.className = 'dlg-portrait';
    el.dlgPortrait.innerHTML = PORTRAIT_SVG;
    const body = document.createElement('div');
    body.className = 'dlg-body';
    const head = document.createElement('div');
    head.className = 'dlg-head';
    el.dlgName = document.createElement('span');
    el.dlgName.className = 'dlg-name';
    el.dlgRole = document.createElement('span');
    el.dlgRole.className = 'dlg-role';
    head.appendChild(el.dlgName);
    head.appendChild(el.dlgRole);
    el.dlgText = document.createElement('div');
    el.dlgText.className = 'dlg-text';
    body.appendChild(head);
    body.appendChild(el.dlgText);
    el.dialogue.appendChild(el.dlgPortrait);
    el.dialogue.appendChild(body);
  }

  // Active weapon tile (v3): the CURRENT weapon's silhouette next to the
  // speedometer, bottom-right — same WEAPON_ICONS as the slot column, no
  // redraw. Seeded on the first updateWeapons() pass (prevWeapon starts -1).
  if (el.speedo && el.speedo.parentNode) {
    el.activeWeapon = document.createElement('div');
    el.activeWeapon.id = 'active-weapon';
    el.awIcon = document.createElement('span');
    el.awIcon.className = 'aw-icon';
    el.awName = document.createElement('span');
    el.awName.className = 'aw-name';
    el.activeWeapon.appendChild(el.awIcon);
    el.activeWeapon.appendChild(el.awName);
    el.speedo.parentNode.insertBefore(el.activeWeapon, el.speedo);
  }

  // Speedo skeleton (driving) + health/armour (on foot).
  if (el.speedo) {
    el.speedo.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'sp-row';
    el.spSpeed = document.createElement('span');
    el.spSpeed.className = 'sp-speed';
    el.spSpeed.textContent = '0';
    const unit = document.createElement('span');
    unit.className = 'sp-unit';
    unit.textContent = 'KM/H';
    row.appendChild(el.spSpeed);
    row.appendChild(unit);
    el.spGear = document.createElement('div');
    el.spGear.className = 'sp-gear';
    el.spGear.textContent = 'GEAR 1';
    el.spCar = document.createElement('div');
    el.spCar.className = 'sp-car';
    el.spNitroRow = document.createElement('div');
    el.spNitroRow.className = 'sp-bar-row';
    const nLab = document.createElement('span');
    nLab.className = 'sp-bar-label';
    nLab.textContent = 'NITRO';
    const nTrack = document.createElement('div');
    nTrack.className = 'sp-bar-track';
    el.spNitroFill = document.createElement('div');
    el.spNitroFill.className = 'sp-bar-fill nitro';
    nTrack.appendChild(el.spNitroFill);
    el.spNitroRow.appendChild(nLab);
    el.spNitroRow.appendChild(nTrack);
    const cRow = document.createElement('div');
    cRow.className = 'sp-bar-row';
    const cLab = document.createElement('span');
    cLab.className = 'sp-bar-label';
    cLab.textContent = 'CONDITION';
    const cTrack = document.createElement('div');
    cTrack.className = 'sp-bar-track';
    el.spCondFill = document.createElement('div');
    el.spCondFill.className = 'sp-bar-fill cond';
    cTrack.appendChild(el.spCondFill);
    cRow.appendChild(cLab);
    cRow.appendChild(cTrack);
    el.speedo.appendChild(row);
    el.speedo.appendChild(el.spGear);
    el.speedo.appendChild(el.spCar);
    el.speedo.appendChild(el.spNitroRow);
    el.speedo.appendChild(cRow);
  }
  if (el.healthArmour) {
    el.healthArmour.innerHTML = '';
    const mkBar = (cls) => {
      const row = document.createElement('div');
      row.className = 'ha-row';
      const label = document.createElement('span');
      label.className = 'ha-label';
      const track = document.createElement('div');
      track.className = 'ha-track';
      const fill = document.createElement('div');
      fill.className = 'ha-fill ' + cls;
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      el.healthArmour.appendChild(row);
      return { label, fill };
    };
    const hp = mkBar('hp');
    el.hpText = hp.label;
    el.hpFill = hp.fill;
    const ar = mkBar('ar');
    el.arText = ar.label;
    el.arFill = ar.fill;
  }

  // Radio bar skeleton.
  if (el.radio) {
    el.radio.innerHTML = '';
    el.radioStation = document.createElement('span');
    el.radioStation.className = 'rb-station';
    el.radioTrack = document.createElement('span');
    el.radioTrack.className = 'rb-track';
    const hint = document.createElement('span');
    hint.className = 'rb-hint';
    hint.textContent = 'Q — CHANGE STATION';
    // Animated equaliser bars (v3): the radio bar visibly plays.
    const eq = document.createElement('span');
    eq.className = 'rb-eq';
    eq.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) eq.appendChild(document.createElement('i'));
    el.radio.appendChild(el.radioStation);
    el.radio.appendChild(el.radioTrack);
    el.radio.appendChild(hint);
    el.radio.appendChild(eq);
  }

  // Controls hint — short on purpose: the dialogue card now sits bottom-left,
  // so a full-width hint would run underneath it at 1280x720.
  if (el.hint) {
    el.hint.textContent = 'WASD DRIVE · SHIFT NITRO · SPACE DRIFT · F CAR · Q RADIO · ESC PAUSE';
  }

  buildTitle();
  buildPause();
  buildEndOverlay();
  buildMapOverlay();

  // Seed the scanner with a standby line so the feed is never empty.
  scannerRow('PMPD DISPATCH — ALL UNITS STANDBY', 'standby');

  // --- event subscriptions ---
  if (game.events && typeof game.events.on === 'function') {
    game.events.on('objective', (data) => {
      refreshMissionCard();
      if (data && data.text) showCombo('OBJECTIVE', data.text, 'objective');
    });
    game.events.on('dialogue', (data) => {
      if (data) startDialogue(data.who, data.role, data.text);
    });
    game.events.on('scanner', (data) => {
      if (!data) return;
      const unit = data.unit || (data.name ?? 'PMPD');
      const behavior = data.behavior || 'PATROL';
      const dist = typeof data.dist === 'number' ? Math.round(data.dist) + 'm' : '';
      const kind = /pursuit|ram/i.test(behavior) ? 'hot' : /roadblock|search/i.test(behavior) ? 'warm' : '';
      scannerRow(unit + ' — ' + behavior + (dist ? ' · ' + dist : ''), kind);
    });
    game.events.on('wanted', (data) => {
      if (data && typeof data.stars === 'number') updateWanted();
    });
    game.events.on('money', (data) => {
      if (!data) return;
      S.moneyFlashUntil = S.now + 0.8;
      if (typeof data.amount === 'number' && data.amount > 0 && /near miss/i.test(data.reason || '')) {
        showCombo('NEAR MISS', '+' + fmtMoney(data.amount), 'cash');
      }
    });
    game.events.on('drift', (data) => {
      const points = data && typeof data.points === 'number' ? data.points : 150;
      if (S.now > S.driftResetAt) S.driftStreak = 0;
      S.driftStreak += 1;
      S.driftResetAt = S.now + 4;
      showCombo('DRIFT x' + S.driftStreak, '+' + fmtMoney(points), 'cash');
    });
    game.events.on('mode', () => {
      S.prevMode = '';
      refreshVisibility();
    });
    game.events.on('respect', () => {
      S.prevRespect = -1;
    });
    game.events.on('map', () => {
      S.mapOpen = !S.mapOpen;
      if (el.mapOverlay) el.mapOverlay.classList.toggle('hidden', !S.mapOpen);
    });
    game.events.on('damage', () => flashDamage());
    game.events.on('radio', () => {
      S.prevRadio = '';
    });
  }

  S.displayedMoney = game.money ?? 0;
  S.prevHealth = game.player ? game.player.health ?? 100 : 100;
  // No dialogue showing yet: nothing mid-typewriter, safe to capture.
  window.__dialogueComplete = true;
  refreshMissionCard();
  refreshVisibility();
}

// ---------- update ----------
function update(dt) {
  if (!gameRef) return;
  S.now += dt;
  refreshVisibility();

  if (gameRef.mode === 'title') {
    // Keep the CONTINUE button honest if a save appears/disappears.
    if (el.btnContinue) el.btnContinue.disabled = !hasSave();
    return;
  }

  // Damage flash: health dropped since last frame.
  const hp = gameRef.player ? gameRef.player.health ?? 100 : 100;
  if (hp < S.prevHealth) flashDamage();
  S.prevHealth = hp;

  updateMoney(dt);
  updateWanted();
  updateWeapons();
  updateClockDistrict();
  updateSpeedo();
  updateRadio();
  updateMissionTimer(dt);
  updateDialogue(dt);
  refreshMissionCard();

  // Minimap redraws every frame — blips move, the route stays live.
  if (el.minimap && gameRef.mode !== 'paused') drawMap(el.minimap, 200);
  if (S.mapOpen && el.mapCanvas) drawMap(el.mapCanvas, 480);
}

export default { init, update };
