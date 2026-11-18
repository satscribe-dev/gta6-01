// PUERTO MIRA — W1 world: city, sky, ocean, lighting, day cycle.
// Builds the whole static city once in init(); update() drives the sun,
// sky/fog colours, lamp + window glow, ocean waves, clouds and boats.
import * as THREE from 'three';
import { CITY, DISTRICTS, PALETTE } from './config.js';

// Streets run on a 74 m pitch (60 m block + 14 m street), centred on these lines.
export const STREETS = [-222, -148, -74, 0, 74, 148, 222];
const BLOCK_CENTERS = [-185, -111, -37, 37, 111, 185];
const SUNRISE_MIN = 360; // 06:00
const SUNSET_MIN = 1140; // 19:00

let game = null;
let sun = null;
let hemi = null;
let skyMat = null;
let sunDisc = null;
let ocean = null;
let oceanBase = null;
let lampMat = null;
let buildingMats = [];
let clouds = [];
let boats = [];
let oceanTime = 0;

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();
const tmpVec = new THREE.Vector3();
// Building footprints (x, z, halfW, halfD) recorded by buildBuildings so
// buildPalms never plants a palm inside a building.
const buildingRects = [];

// Deterministic RNG so the city is identical every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Merge small geometries into one (positions/normals/uvs concatenated).
function mergeGeometries(geoms) {
  const pos = [];
  const norm = [];
  const uv = [];
  for (const g of geoms) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
    norm.push(...ng.attributes.normal.array);
    if (ng.attributes.uv) uv.push(...ng.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- facade textures: 5 distinct variants, one diffuse + one emissive each ---
// Each variant draws its own base colour, window pattern and ground-floor
// shopfront (big shop windows + striped awning + blank sign band). The draw
// function is run twice with the same per-variant seed, so the emissive pass
// lights exactly the windows the map pass drew. Material colour stays white
// so the baked warm palette reads true instead of being tinted muddy.
function facadeTextures(rng) {
  void rng;
  const W = 128;
  const H = 256;
  const GROUND_TOP = H - 40; // ground-floor band starts here (canvas bottom)

  // Shared ground floor: blank sign band + striped awning + big shop windows.
  // Returns the shop-window rect so the emissive pass can light it.
  function drawGround(ctx, signColor, signInner, awnA, awnB, shopColor, frameColor, shopLit) {
    ctx.fillStyle = signColor;
    ctx.fillRect(0, GROUND_TOP, W, 12);
    ctx.fillStyle = signInner;
    ctx.fillRect(6, GROUND_TOP + 3, W - 12, 6);
    for (let x = 0; x < W; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? awnA : awnB;
      ctx.fillRect(x, GROUND_TOP + 12, 16, 9);
    }
    ctx.fillStyle = shopColor;
    ctx.fillRect(4, GROUND_TOP + 21, W - 8, H - GROUND_TOP - 23);
    ctx.fillStyle = frameColor;
    for (let x = 4 + (W - 8) / 3; x < W - 4; x += (W - 8) / 3) ctx.fillRect(x - 1, GROUND_TOP + 21, 2, H - GROUND_TOP - 23);
    return { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: shopLit };
  }

  function drawEmissive(ctx, wins, shop) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    for (const win of wins) {
      if (!win.lit) continue;
      ctx.fillStyle = win.cool ? '#9fd8ff' : '#ffca7a';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    if (shop.lit) {
      ctx.fillStyle = '#ffca7a';
      ctx.fillRect(shop.x, shop.y, shop.w, shop.h);
    }
  }

  // 0 — glass tower: reflective teal/blue curtain wall, full-height glazing.
  function drawGlass(ctx, w, h, r, pass) {
    const cols = 6;
    const rows = 11;
    const wins = [];
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        wins.push({
          x: 6 + c * ((w - 12) / cols),
          y: 12 + rr * ((h - 56) / rows),
          w: (w - 12) / cols - 3,
          h: (h - 56) / rows - 4,
          shade: r(),
          lit: r() < 0.55,
          cool: r() < 0.45,
        });
      }
    }
    const shop = { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: r() < 0.9 };
    if (pass === 'emissive') { drawEmissive(ctx, wins, shop); return; }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7cc0d4');
    g.addColorStop(1, '#3f8aa8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (const win of wins) {
      ctx.fillStyle = win.cool ? '#a8d8e8' : (win.lit ? '#e6c48a' : '#5fa8c0');
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(win.x, win.y, win.w, 2);
    }
    ctx.fillStyle = '#2a5a6e';
    for (let c = 0; c <= cols; c++) ctx.fillRect(6 + c * ((w - 12) / cols) - 1, 8, 2, h - 52);
    drawGround(ctx, '#0e2f3e', '#16485c', '#2ec4b6', '#0e2f3e', '#16384a', '#0e2f3e', shop.lit);
  }

  // 1 — red brick: terracotta courses, small dark windows, cream sills.
  function drawBrick(ctx, w, h, r, pass) {
    const cols = 4;
    const rows = 10;
    const wins = [];
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        wins.push({
          x: 10 + c * ((w - 20) / cols),
          y: 12 + rr * ((h - 56) / rows),
          w: (w - 20) / cols - 6,
          h: (h - 56) / rows - 7,
          shade: r(),
          lit: r() < 0.45,
          cool: false,
        });
      }
    }
    const shop = { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: r() < 0.9 };
    if (pass === 'emissive') { drawEmissive(ctx, wins, shop); return; }
    ctx.fillStyle = '#a34a2e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 6; y < h; y += 8) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0, row = 0; y < h; y += 8, row++) {
      for (let x = (row % 2) * 8; x < w; x += 16) ctx.fillRect(x, y, 1, 8);
    }
    for (const win of wins) {
      ctx.fillStyle = win.lit ? '#e8b06a' : '#33404f';
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(win.x - 1, win.y + win.h, win.w + 2, 2);
    }
    drawGround(ctx, '#f2e3c8', '#d8c8a8', '#c0392b', '#f5e6d0', '#2a2018', '#4a3226', shop.lit);
  }

  // 2 — stucco pastel: cream walls, white-framed windows, teal shutters.
  function drawStucco(ctx, w, h, r, pass) {
    const cols = 4;
    const rows = 8;
    const wins = [];
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        wins.push({
          x: 12 + c * ((w - 24) / cols),
          y: 14 + rr * ((h - 58) / rows),
          w: (w - 24) / cols - 8,
          h: (h - 58) / rows - 8,
          shade: r(),
          lit: r() < 0.5,
          cool: false,
        });
      }
    }
    const shop = { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: r() < 0.9 };
    if (pass === 'emissive') { drawEmissive(ctx, wins, shop); return; }
    ctx.fillStyle = '#f0d3ae';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(180,140,90,0.16)';
    for (let i = 0; i < 220; i++) ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
    for (const win of wins) {
      ctx.fillStyle = '#fdf6e8';
      ctx.fillRect(win.x - 2, win.y - 2, win.w + 4, win.h + 4);
      ctx.fillStyle = '#2e8b8b';
      ctx.fillRect(win.x - 7, win.y, 5, win.h);
      ctx.fillRect(win.x + win.w + 2, win.y, 5, win.h);
      ctx.fillStyle = win.lit ? '#ffca7a' : '#5a7a8a';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    drawGround(ctx, '#2e8b8b', '#3aa5a5', '#e8735a', '#f7e8d0', '#3a4a52', '#fdf6e8', shop.lit);
  }

  // 3 — art deco: sandstone with gold vertical fins, narrow tall windows.
  function drawDeco(ctx, w, h, r, pass) {
    const cols = 5;
    const rows = 11;
    const wins = [];
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        wins.push({
          x: 10 + c * ((w - 20) / cols),
          y: 18 + rr * ((h - 62) / rows),
          w: (w - 20) / cols - 7,
          h: (h - 62) / rows - 3,
          shade: r(),
          lit: r() < 0.5,
          cool: false,
        });
      }
    }
    const shop = { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: r() < 0.9 };
    if (pass === 'emissive') { drawEmissive(ctx, wins, shop); return; }
    ctx.fillStyle = '#d9b06a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c9a227';
    for (let x = 8; x < w; x += 16) ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = 'rgba(120,80,20,0.25)';
    for (let x = 14; x < w; x += 16) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 4, w, 2);
    ctx.fillRect(0, 9, w, 2);
    ctx.fillRect(0, 14, w, 2);
    for (const win of wins) {
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
      ctx.fillStyle = win.lit ? '#ffca7a' : '#2e3a4a';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    drawGround(ctx, '#1e4a3a', '#2a6a52', '#c9a227', '#1e4a3a', '#2a3a2a', '#c9a227', shop.lit);
  }

  // 4 — modern concrete: grey-beige slabs, horizontal strip windows.
  function drawModern(ctx, w, h, r, pass) {
    const rows = 12;
    const wins = [];
    for (let rr = 0; rr < rows; rr++) {
      wins.push({
        x: 6,
        y: 12 + rr * ((h - 56) / rows),
        w: w - 12,
        h: (h - 56) / rows - 6,
        shade: r(),
        lit: r() < 0.45,
        cool: r() < 0.5,
        glint: r(),
      });
    }
    const shop = { x: 4, y: GROUND_TOP + 21, w: W - 8, h: H - GROUND_TOP - 23, lit: r() < 0.9 };
    if (pass === 'emissive') { drawEmissive(ctx, wins, shop); return; }
    ctx.fillStyle = '#b5ada0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 10; y < h; y += 12) ctx.fillRect(0, y, w, 1);
    for (const win of wins) {
      ctx.fillStyle = win.lit ? '#e8b06a' : '#6f9ab0';
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const gw = win.w * (0.25 + win.glint * 0.3);
      ctx.fillRect(win.x + win.glint * (win.w - gw), win.y, gw, win.h);
      ctx.fillStyle = '#8a8578';
      ctx.fillRect(win.x, win.y + win.h, win.w, 1);
    }
    drawGround(ctx, '#d8d2c4', '#efe9da', '#8a8578', '#d8d2c4', '#4a5a62', '#8a8578', shop.lit);
  }

  const defs = [drawGlass, drawBrick, drawStucco, drawDeco, drawModern];
  const variants = [];
  defs.forEach((draw, i) => {
    const seed = 1000 + i * 77;
    const map = makeCanvas(W, H, (ctx, w, h) => draw(ctx, w, h, mulberry32(seed), 'map'));
    const emissive = makeCanvas(W, H, (ctx, w, h) => draw(ctx, w, h, mulberry32(seed), 'emissive'));
    variants.push({ map, emissive });
  });
  return variants;
}

function textTexture(text, color, w = 512, h = 128, font = 'bold 64px Arial') {
  return makeCanvas(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, h / 2);
  });
}

function cloudTexture() {
  return makeCanvas(256, 128, (ctx) => {
    ctx.clearRect(0, 0, 256, 128);
    for (let i = 0; i < 9; i++) {
      const x = 40 + Math.random() * 176;
      const y = 45 + Math.random() * 38;
      const r = 22 + Math.random() * 30;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// --- W7 ground textures: procedural asphalt / sidewalk / sand / ocean / markings ---
// Speckles use the seeded RNG so the city is identical every load.
function asphaltTexture() {
  const tex = makeCanvas(1024, 1024, (ctx, w, h) => {
    const r = mulberry32(4242);
    ctx.fillStyle = '#383c45';
    ctx.fillRect(0, 0, w, h);
    // Large soft tonal patches so the asphalt is not a flat slab.
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 60 + r() * 160;
      const g = ctx.createRadialGradient(x, y, 4, x, y, rad);
      g.addColorStop(0, r() < 0.5 ? 'rgba(20,22,28,0.16)' : 'rgba(86,92,105,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // Aggregate grain: thousands of 1-2 px flecks, light and dark.
    for (let i = 0; i < 9000; i++) {
      const v = r();
      ctx.fillStyle = v < 0.45 ? 'rgba(210,215,225,0.20)'
        : v < 0.8 ? 'rgba(12,14,18,0.28)' : 'rgba(150,155,168,0.16)';
      const s = 1 + Math.floor(r() * 2);
      ctx.fillRect(r() * w, r() * h, s, s);
    }
    // Hairline cracks.
    ctx.strokeStyle = 'rgba(15,17,21,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      let x = r() * w;
      let y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (r() - 0.5) * 46;
        y += (r() - 0.5) * 46;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30); // 16 m per tile over the 480 m city
  tex.anisotropy = 16; // clamped to the hardware max by three.js
  return tex;
}

// Framed concrete: speckled slab + expansion joints + dark outer border
// with a light inner lip, so each sidewalk reads as a framed panel.
function sidewalkTexture() {
  const tex = makeCanvas(512, 512, (ctx, w, h) => {
    const r = mulberry32(777);
    ctx.fillStyle = '#8b8f97';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? 'rgba(60,64,72,0.20)' : 'rgba(225,228,235,0.16)';
      const s = 1 + Math.floor(r() * 2);
      ctx.fillRect(r() * w, r() * h, s, s);
    }
    // Expansion joints: 4x4 cells.
    ctx.strokeStyle = 'rgba(52,56,64,0.55)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      const p = (i * w) / 4;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }
    // Framing border: dark outer band + light inner lip (the curb edge).
    ctx.strokeStyle = '#5d616a';
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.strokeStyle = 'rgba(235,238,244,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, w - 40, h - 40);
  });
  tex.anisotropy = 16;
  return tex;
}

function sandTexture() {
  const tex = makeCanvas(512, 512, (ctx, w, h) => {
    const r = mulberry32(5150);
    ctx.fillStyle = '#e8d5a3';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? 'rgba(160,130,80,0.22)' : 'rgba(255,244,214,0.20)';
      const s = 1 + Math.floor(r() * 2);
      ctx.fillRect(r() * w, r() * h, s, s);
    }
    // A few shells / pebbles.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,250,240,0.85)' : 'rgba(120,100,70,0.7)';
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 1.5 + r() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wet band along the waterline (canvas bottom = ocean side, v=0).
    const g = ctx.createLinearGradient(0, h * 0.78, 0, h);
    g.addColorStop(0, 'rgba(150,110,60,0)');
    g.addColorStop(1, 'rgba(120,88,48,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.anisotropy = 16;
  return tex;
}

// Teal-green sea with soft tonal blotches + sun sparkle flecks. The map
// carries the colour; the material stays white so it reads true.
function oceanTexture() {
  const tex = makeCanvas(256, 256, (ctx, w, h) => {
    const r = mulberry32(9091);
    ctx.fillStyle = '#189a90';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 20 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 2, x, y, rad);
      g.addColorStop(0, r() < 0.5 ? 'rgba(32,190,175,0.20)' : 'rgba(8,90,110,0.20)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = 'rgba(255,240,200,0.28)';
      ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 6);
  tex.anisotropy = 16;
  return tex;
}

// Full-city road-marking layer: double yellow centrelines, dashed white lane
// lines, edge lines and zebra crossings, drawn once into a transparent
// 1024 canvas over the whole 480 m city. Canvas px: x -> (x+240)*S,
// y -> (z+240)*S (canvas top row = z=-240, from the plane's UV orientation).
// Marking widths are exaggerated to ~1-2 px: a true 15 cm line would be
// sub-pixel at 2.13 px/m and vanish under minification.
function roadMarkingsTexture() {
  const S = 1024 / (CITY.half * 2);
  const px = (v) => (v + CITY.half) * S; // world metres -> canvas px
  const tex = makeCanvas(1024, 1024, (ctx) => {
    ctx.clearRect(0, 0, 1024, 1024);
    ctx.lineCap = 'butt';
    // Double yellow centreline: two solid lines flanking each centreline.
    // Kept to 1 px each (~0.5 m) so they read as lines, not a yellow band.
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 1;
    for (const s of STREETS) {
      for (const off of [-1.25, 1.25]) {
        ctx.beginPath(); ctx.moveTo(px(s) + off, px(-232)); ctx.lineTo(px(s) + off, px(232)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px(-232), px(s) + off); ctx.lineTo(px(232), px(s) + off); ctx.stroke();
      }
    }
    // Dashed white lane lines at +-3.5 m: 3 m dash, 4.5 m gap, kept clear
    // of the zebra zone near intersections.
    ctx.strokeStyle = '#f2f2ee';
    ctx.lineWidth = 2;
    const nearCross = (t) => STREETS.some((c) => Math.abs(t - c) < 13);
    for (const s of STREETS) {
      for (const off of [-3.5, 3.5]) {
        for (let t = -232; t < 232; t += 7.5) {
          if (nearCross(t + 1.5)) continue;
          ctx.beginPath(); ctx.moveTo(px(s + off), px(t)); ctx.lineTo(px(s + off), px(t + 3)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px(t), px(s + off)); ctx.lineTo(px(t + 3), px(s + off)); ctx.stroke();
        }
      }
    }
    // Solid white edge lines at +-6.6 m.
    for (const s of STREETS) {
      for (const off of [-6.6, 6.6]) {
        ctx.beginPath(); ctx.moveTo(px(s + off), px(-232)); ctx.lineTo(px(s + off), px(232)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px(-232), px(s + off)); ctx.lineTo(px(232), px(s + off)); ctx.stroke();
      }
    }
    // Punch the intersections clear (centrelines / edge lines stop there).
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const sx of STREETS) {
      for (const sz of STREETS) {
        ctx.fillRect(px(sx) - 13 * S, px(sz) - 13 * S, 26 * S, 26 * S);
      }
    }
    ctx.restore();
    // Zebra crossings: 4 per intersection, 5 stripes each, at +-10.5 m.
    ctx.fillStyle = '#f2f2ee';
    for (const sx of STREETS) {
      for (const sz of STREETS) {
        for (const off of [-5.2, -2.6, 0, 2.6, 5.2]) {
          // Crossing on the N-S road (stripes vary along x), north + south.
          for (const dz of [-10.5, 10.5]) {
            ctx.fillRect(px(sx + off) - 3.5, px(sz + dz) - 1, 7, 2);
          }
          // Crossing on the E-W road (stripes vary along z), west + east.
          for (const dx of [-10.5, 10.5]) {
            ctx.fillRect(px(sx + dx) - 1, px(sz + off) - 3.5, 2, 7);
          }
        }
      }
    }
  });
  tex.anisotropy = 16;
  return tex;
}

// --- sky dome (gradient + sun glow shader) ---
function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x283b6b) }, // spek: biru senja
      horizonColor: { value: new THREE.Color(0xff9e5e) }, // spek: peach/emas
      sunColor: { value: new THREE.Color(PALETTE.sun) },
      sunDirection: { value: new THREE.Vector3(0, 0.2, 1) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.15, 1.0);
        // Cinematic sunset: peach horizon -> warm gold band -> dusk blue.
        vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
        col = mix(col, horizonColor * 1.12 + vec3(0.10, 0.02, 0.0),
                  pow(max(1.0 - h * 4.0, 0.0), 2.0) * 0.55);
        float s = max(dot(normalize(vDir), normalize(sunDirection)), 0.0);
        col += sunColor * pow(s, 220.0) * 1.4;
        col += sunColor * pow(s, 7.0) * 0.28;
        // Warm haze hugging the horizon all around (not just near the sun).
        col += sunColor * pow(max(1.0 - h * 3.0, 0.0), 3.0) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, skyMat);
  dome.frustumCulled = false;
  scene.add(dome);

  sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  scene.add(sunDisc);
}

function buildClouds(scene) {
  const tex = cloudTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const spots = [
    [-260, 130, -180, 1.6], [60, 150, -260, 2.0], [260, 120, -120, 1.4],
    [-180, 140, 180, 1.8], [120, 125, 220, 1.5], [300, 155, 120, 1.9],
  ];
  for (const [x, y, z, s] of spots) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(150 * s, 70 * s), mat);
    m.position.set(x, y, z);
    m.userData.drift = 0.6 + Math.random() * 0.8;
    scene.add(m);
    clouds.push(m);
  }
}

// --- ground: asphalt base, sidewalk slabs, sand beach, grass park, ocean ---
function buildGround(scene) {
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.half * 2, CITY.half * 2),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  scene.add(base);

  // Sidewalk slabs: one per city block (park block is grass instead).
  const slabGeo = new THREE.PlaneGeometry(CITY.block, CITY.block);
  const slabMat = new THREE.MeshStandardMaterial({ map: sidewalkTexture(), roughness: 0.9 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5da24a, roughness: 1 });
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      const isPark = bx === -37 && bz === 37;
      const slab = new THREE.Mesh(slabGeo, isPark ? grassMat : slabMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(bx, isPark ? 0.06 : 0.05, bz);
      slab.receiveShadow = true;
      scene.add(slab);
    }
  }

  // Sand beach (z > 200) and ocean (z > 215).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 45),
    new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.09, 222.5);
  sand.receiveShadow = true;
  scene.add(sand);

  const oceanGeo = new THREE.PlaneGeometry(700, 420, 56, 40);
  oceanGeo.rotateX(-Math.PI / 2);
  oceanBase = oceanGeo.attributes.position.array.slice();
  ocean = new THREE.Mesh(
    oceanGeo,
    new THREE.MeshStandardMaterial({
      map: oceanTexture(), roughness: 0.16, metalness: 0.1,
      transparent: true, opacity: 0.93,
    }),
  );
  ocean.position.set(0, 0.15, 425);
  scene.add(ocean);

  // Foam line where the surf meets the sand.
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 2.5),
    new THREE.MeshStandardMaterial({
      color: 0xf4fbff, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false,
    }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.22, 215.5);
  scene.add(foam);
}

// Road markings as one transparent canvas overlay over the whole city
// (double yellow centrelines, dashed lane lines, edge lines, zebras).
// Replaces the old instanced dash/stripe meshes: same coverage, sharper,
// 1 draw call. The overlay sits at y=0.03, under the sidewalk slabs.
function buildRoadMarkings(scene) {
  const tex = roadMarkingsTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.85, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    depthWrite: false,
  });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2, CITY.half * 2), mat);
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.03;
  overlay.receiveShadow = true;
  scene.add(overlay);
}

// --- buildings: ~80 boxes, 5 canvas facades, shared materials, rooftop props ---
function buildBuildings(scene, rng) {
  const variants = facadeTextures(rng);
  buildingRects.length = 0;
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
  // One shared material per facade variant (white: the baked palette reads true).
  const sideMats = variants.map((v) => {
    const mat = new THREE.MeshStandardMaterial({
      map: v.map,
      emissiveMap: v.emissive,
      emissive: new THREE.Color(0xffc27a),
      emissiveIntensity: 0,
      color: 0xffffff,
      roughness: 0.85,
    });
    buildingMats.push(mat);
    return mat;
  });

  const roofs = []; // {x, z, w, d, h} for rooftop props
  // Merged per facade variant: all buildings of one variant share ONE draw
  // call (a multi-material box costs 6 calls each — 76 boxes was 456 max).
  const variantGeos = variants.map(() => []);
  const crownGeos = variants.map(() => []);
  const capGeos = []; // thin roof slabs, one merged mesh with roofMat
  let count = 0;
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (bx === -37 && bz === 37) continue; // park block stays open
      const beachRow = bz === 185;
      const slots = beachRow ? 1 : 2 + Math.floor(rng() * 2); // 2-3 per block (~80 total)
      for (let s = 0; s < slots; s++) {
        const qx = (s % 2) * 2 - 1;
        const qz = (s < 2 ? -1 : 1);
        let w = 10 + rng() * 16;
        let d = 10 + rng() * 16;
        const x = bx + qx * 14 + (rng() - 0.5) * 6;
        const z = bz + qz * 14 + (rng() - 0.5) * 6;
        // Taller towers near the centre and in Harbor Heights (x > 0, z < 0).
        const tallZone = (Math.abs(x) < 110 && Math.abs(z) < 110) || (x > 0 && z < 0);
        // Real height spread: ~30% low 2-3 storey, mid-rise, tall towers up to 60 m.
        let h;
        if (rng() < 0.3) h = 6 + rng() * 5;
        else h = 10 + rng() * 18;
        if (tallZone) h = 14 + rng() * rng() * 46; // up to 60 m
        if (beachRow) h = Math.min(h, 14);
        if (tallZone && rng() < 0.25) { // narrow slab tower
          w = 8 + rng() * 4;
          d = 8 + rng() * 4;
        }
        const v = Math.floor(rng() * variants.length);
        const box = new THREE.BoxGeometry(w, h, d);
        box.translate(x, 0.05 + h / 2, z);
        variantGeos[v].push(box);
        const cap = new THREE.BoxGeometry(w, 0.4, d);
        cap.translate(x, 0.05 + h + 0.2, z);
        capGeos.push(cap);
        roofs.push({ x, z, w, d, h });
        buildingRects.push([x, z, w / 2 + 1, d / 2 + 1]);
        if (h > 32) { // stepped setback crown so tall silhouettes differ
          const ch = 4 + rng() * 4;
          const crown = new THREE.BoxGeometry(w * 0.62, ch, d * 0.62);
          crown.translate(x, 0.05 + h + ch / 2, z);
          crownGeos[v].push(crown);
        }
        count++;
      }
    }
  }

  // One merged mesh per facade variant + one merged crown mesh per variant
  // + one merged roof-cap mesh: ~11 draw calls for all ~76 buildings.
  for (let v = 0; v < variants.length; v++) {
    if (variantGeos[v].length) {
      const merged = new THREE.Mesh(mergeGeometries(variantGeos[v]), sideMats[v]);
      merged.castShadow = true;
      merged.receiveShadow = true;
      scene.add(merged);
    }
    if (crownGeos[v].length) {
      const crownMesh = new THREE.Mesh(mergeGeometries(crownGeos[v]), sideMats[v]);
      crownMesh.castShadow = true;
      scene.add(crownMesh);
    }
  }
  const caps = new THREE.Mesh(mergeGeometries(capGeos), roofMat);
  caps.receiveShadow = true;
  scene.add(caps);

  // Rooftop props: AC boxes + antennas, instanced.
  const acGeo = new THREE.BoxGeometry(1.6, 0.9, 1.6);
  const acMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.8, metalness: 0.4 });
  const acSpots = [];
  const antGeo = new THREE.CylinderGeometry(0.06, 0.1, 6, 5);
  const antMat = new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.6, metalness: 0.7 });
  const antSpots = [];
  for (const r of roofs) {
    const nAc = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < nAc; i++) {
      acSpots.push([
        r.x + (rng() - 0.5) * (r.w - 3),
        0.05 + r.h + 0.45,
        r.z + (rng() - 0.5) * (r.d - 3),
      ]);
    }
    if (r.h > 30 && rng() < 0.7) {
      antSpots.push([r.x + (rng() - 0.5) * (r.w - 2), 0.05 + r.h + 3, r.z + (rng() - 0.5) * (r.d - 2)]);
    }
  }
  const m4 = new THREE.Matrix4();
  const ac = new THREE.InstancedMesh(acGeo, acMat, Math.max(1, acSpots.length));
  acSpots.forEach(([x, y, z], i) => m4.makeTranslation(x, y, z) && ac.setMatrixAt(i, m4));
  ac.castShadow = true;
  scene.add(ac);
  const ant = new THREE.InstancedMesh(antGeo, antMat, Math.max(1, antSpots.length));
  antSpots.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); ant.setMatrixAt(i, m4); });
  scene.add(ant);

  // Parapet rims: 4 thin boxes per roof, one InstancedMesh (1 draw call).
  const parGeo = new THREE.BoxGeometry(1, 0.9, 0.3);
  const parMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.95 });
  const parSpots = [];
  for (const r of roofs) {
    const y = 0.05 + r.h + 0.45;
    parSpots.push([r.x, y, r.z - r.d / 2, r.w + 0.4, 0]);
    parSpots.push([r.x, y, r.z + r.d / 2, r.w + 0.4, 0]);
    parSpots.push([r.x - r.w / 2, y, r.z, r.d + 0.4, Math.PI / 2]);
    parSpots.push([r.x + r.w / 2, y, r.z, r.d + 0.4, Math.PI / 2]);
  }
  const par = new THREE.InstancedMesh(parGeo, parMat, Math.max(1, parSpots.length));
  const pq = new THREE.Quaternion();
  const pe = new THREE.Euler();
  parSpots.forEach(([x, y, z, len, rot], i) => {
    pe.set(0, rot, 0);
    pq.setFromEuler(pe);
    m4.compose(new THREE.Vector3(x, y, z), pq, new THREE.Vector3(len, 1, 1));
    par.setMatrixAt(i, m4);
  });
  scene.add(par);

  // Water tanks on taller roofs, one InstancedMesh (1 draw call).
  const tankGeo = new THREE.CylinderGeometry(1.3, 1.3, 2.4, 10);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.7, metalness: 0.5 });
  const tankSpots = [];
  for (const r of roofs) {
    if (r.h > 25) {
      tankSpots.push([
        r.x + (rng() - 0.5) * (r.w - 5),
        0.05 + r.h + 1.2,
        r.z + (rng() - 0.5) * (r.d - 5),
      ]);
    }
  }
  const tanks = new THREE.InstancedMesh(tankGeo, tankMat, Math.max(1, tankSpots.length));
  tankSpots.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); tanks.setMatrixAt(i, m4); });
  scene.add(tanks);
  return count;
}

// --- palm trees: TALL boulevard palms framing every street (2 draw calls) ---
// Trunks ~11 m with wide crowns, planted tight along the sidewalk edge so
// they read in every street-level shot. Plus shrubs, corner planters and
// park bushes so the city is not bare concrete. Nothing is planted on a road,
// inside a building, or within 12 m of a sign / billboard.
function buildPalms(scene, rng) {
  const spots = [];
  // Keep clear of neon signs + billboards (positions from buildSigns).
  const clearOfSigns = (x, z) => {
    for (const [sx, sz] of [[-80, 60], [80, -60], [150, 150], [-150, -150], [-160, 8], [160, -8], [8, 160]]) {
      if (Math.abs(x - sx) < 12 && Math.abs(z - sz) < 12) return false;
    }
    return true;
  };
  const clearOfBuildings = (x, z) => {
    for (const [bx, bz, hw, hd] of buildingRects) {
      if (Math.abs(x - bx) < hw && Math.abs(z - bz) < hd) return false;
    }
    return true;
  };
  // A sidewalk point must be off every street's roadway: 9.5 m out from one
  // street's centreline, and not within 7.5 m of any other street's centreline
  // (that is where the cross street's road runs).
  const offRoad = (x, z) => !STREETS.some((s) => Math.abs(x - s) <= 7.5 || Math.abs(z - s) <= 7.5);
  const plantable = (x, z) => offRoad(x, z) && clearOfSigns(x, z) && clearOfBuildings(x, z);

  // Boulevard rows: both sidewalks of every street, ~18 m apart with jitter.
  // Palm Court (x 0..240, z 0..120) gets the densest rows (~13 m apart).
  for (const s of STREETS) {
    for (let t = -222; t <= 222; t++) {
      const dense = (s >= 0 && s <= 240 && t >= 0 && t <= 120) || (t >= 0 && t <= 240 && s >= 0 && s <= 120);
      if ((t + 222) % (dense ? 13 : 18) !== 0) continue;
      if (rng() < 0.12) continue; // organic gaps
      for (const off of [-9.5, 9.5]) {
        const jx = (rng() - 0.5) * 3;
        const jz = (rng() - 0.5) * 3;
        if (plantable(s + off + jx, t + jz)) spots.push([s + off + jx, t + jz]);
        if (plantable(t + jx, s + off + jz)) spots.push([t + jx, s + off + jz]);
      }
    }
  }
  for (let i = 0; i < 12; i++) { // park cluster
    spots.push([-37 + (rng() - 0.5) * 48, 37 + (rng() - 0.5) * 48]);
  }
  for (let i = 0; i < 18; i++) { // beach line (on the sand, clear of the roads)
    spots.push([-220 + rng() * 440, 204 + rng() * 6]);
  }

  // Tall trunk (~11 m) + wide crown: fronds 5.5 m long, 9 per crown.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 11, 6);
  trunkGeo.translate(0, 5.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
  const frondParts = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.PlaneGeometry(5.5, 1.6);
    f.translate(2.75, 0, 0);
    f.rotateZ(-0.55); // droop
    f.rotateY((i / 9) * Math.PI * 2);
    frondParts.push(f);
  }
  const crownGeo = mergeGeometries(frondParts);
  crownGeo.translate(0, 11.2, 0);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x34a862, roughness: 1, side: THREE.DoubleSide,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  trunks.castShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  spots.forEach(([x, z], i) => {
    const s = 0.9 + rng() * 0.5;
    e.set((rng() - 0.5) * 0.2, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.05, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
  });
  scene.add(trunks);
  scene.add(crowns);

  // Shrubs along the sidewalks + bushes in the park (1 draw call).
  const shrubSpots = [];
  for (const s of STREETS) {
    for (let t = -213; t <= 222; t += 27) {
      for (const off of [-9.5, 9.5]) {
        const jx = (rng() - 0.5) * 4;
        const jz = (rng() - 0.5) * 4;
        if (plantable(s + off + jx, t + jz)) shrubSpots.push([s + off + jx, 0.05, t + jz, 0.8 + rng() * 0.5]);
        if (plantable(t + jx, s + off + jz)) shrubSpots.push([t + jx, 0.05, s + off + jz, 0.8 + rng() * 0.5]);
      }
    }
  }
  for (let i = 0; i < 14; i++) {
    shrubSpots.push([-37 + (rng() - 0.5) * 46, 0.05, 37 + (rng() - 0.5) * 46, 0.9 + rng() * 0.7]);
  }
  const shrubGeo = new THREE.IcosahedronGeometry(0.9, 0);
  shrubGeo.scale(1, 0.7, 1);
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x2a7a4a, roughness: 1 });
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, Math.max(1, shrubSpots.length));
  shrubSpots.forEach(([x, y, z, s], i) => {
    e.set(0, rng() * Math.PI * 2, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y + 0.55 * s, z), q, new THREE.Vector3(s, s, s));
    shrubs.setMatrixAt(i, m4);
  });
  shrubs.castShadow = true;
  scene.add(shrubs);

  // Terracotta corner planters with a shrub on top (2 draw calls: the
  // planter mesh + a small instanced mesh of shrubs at planter height).
  const planterSpots = [];
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      if (Math.abs(sx) > 200 || Math.abs(sz) > 160) continue;
      for (const [dx, dz] of [[9.5, 9.5], [-9.5, -9.5]]) {
        const x = sx + dx;
        const z = sz + dz;
        if (plantable(x, z)) planterSpots.push([x, z]);
      }
    }
  }
  const planterGeo = new THREE.BoxGeometry(1.7, 0.7, 1.7);
  const planterMat = new THREE.MeshStandardMaterial({ color: 0xb06a45, roughness: 0.95 });
  const planters = new THREE.InstancedMesh(planterGeo, planterMat, Math.max(1, planterSpots.length));
  const planterShrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, Math.max(1, planterSpots.length));
  planterSpots.forEach(([x, z], i) => {
    e.set(0, rng() * Math.PI * 2, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.4, z), q, new THREE.Vector3(1, 1, 1));
    planters.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 0.75, z), q, new THREE.Vector3(0.85, 0.85, 0.85));
    planterShrubs.setMatrixAt(i, m4);
  });
  planters.castShadow = true;
  scene.add(planters);
  scene.add(planterShrubs);
  return spots.length;
}

// --- streetlights (emissive lamps, NO PointLights) + traffic-light poles ---
function buildStreetFurniture(scene) {
  // Pole + arm merged into one geometry; lamp sphere shares the same instance matrix.
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.12, 6.5, 6).translate(0, 3.25, 0),
    new THREE.BoxGeometry(1.7, 0.12, 0.12).translate(0.85, 6.4, 0),
  ]);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.6 });
  const lampGeo = new THREE.SphereGeometry(0.24, 10, 8);
  lampGeo.translate(1.65, 6.3, 0);
  lampMat = new THREE.MeshStandardMaterial({
    color: 0x444444, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0,
  });

  const spots = []; // [x, z, rotY]
  for (const s of STREETS) {
    for (let t = -222, k = 0; t <= 222; t += 37, k++) {
      const side = k % 2 === 0 ? 1 : -1;
      spots.push([s + side * 8.6, t, side > 0 ? Math.PI : 0]);
      spots.push([t, s + side * 8.6, side > 0 ? Math.PI / 2 : -Math.PI / 2]);
    }
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
  spots.forEach(([x, z, rot], i) => {
    e.set(0, rot, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.05, z), q, sc);
    poles.setMatrixAt(i, m4);
    lamps.setMatrixAt(i, m4);
  });
  scene.add(poles);
  scene.add(lamps);

  // Traffic-light poles at every intersection (visual only).
  const tlPoleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5, 6);
  tlPoleGeo.translate(0, 2.5, 0);
  const tlPoleMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.5 });
  const headTex = makeCanvas(64, 128, (ctx) => {
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, 64, 128);
    const dots = ['#ff3b30', '#ffcc00', '#34c759'];
    dots.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(32, 24 + i * 40, 13, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  const headGeo = new THREE.BoxGeometry(0.5, 1.2, 0.3);
  headGeo.translate(0, 4.6, 0);
  const headMat = new THREE.MeshStandardMaterial({ map: headTex, roughness: 0.7 });
  const tlCount = STREETS.length * STREETS.length;
  const tlPoles = new THREE.InstancedMesh(tlPoleGeo, tlPoleMat, tlCount);
  const tlHeads = new THREE.InstancedMesh(headGeo, headMat, tlCount);
  let i = 0;
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      e.set(0, Math.PI / 4, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(sx + 8.6, 0.05, sz + 8.6), q, sc);
      tlPoles.setMatrixAt(i, m4);
      tlHeads.setMatrixAt(i, m4);
      i++;
    }
  }
  scene.add(tlPoles);
  scene.add(tlHeads);
}

// --- neon signs + billboards (canvas-texture planes on poles) ---
function buildSigns(scene) {
  const signs = [
    { text: 'NEON PALMS', color: '#ff2e88', x: -80, z: 60, rot: Math.PI / 2 },
    { text: 'HOTEL PUERTO MIRA', color: '#2ee6ff', x: 80, z: -60, rot: -Math.PI / 2 },
    { text: 'TIDE BAR', color: '#ffa62e', x: 150, z: 150, rot: Math.PI },
    { text: 'BURGER BAY', color: '#7dff5e', x: -150, z: -150, rot: 0 },
  ];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.6 });
  for (const s of signs) {
    const tex = textTexture(s.text, s.color);
    // Two FrontSide text planes, back to back: one DoubleSide plane shows
    // the text mirrored from behind, so each side gets its own plane that
    // reads correctly from that side. The dark backing panel is DoubleSide
    // (plain colour, so mirroring is irrelevant) and sits between them.
    const nx = Math.sin(s.rot);
    const nz = Math.cos(s.rot);
    for (const side of [1, -1]) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), mat);
      plane.position.set(s.x + nx * 0.06 * side, 7.5, s.z + nz * 0.06 * side);
      plane.rotation.y = side > 0 ? s.rot : s.rot + Math.PI;
      scene.add(plane);
    }
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(16.6, 4.6),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, side: THREE.DoubleSide }),
    );
    back.position.set(s.x, 7.5, s.z);
    back.rotation.y = s.rot;
    scene.add(back);
    for (const dx of [-7, 7]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.5, 6), poleMat);
      pole.position.set(s.x + Math.cos(s.rot) * dx, 3.75, s.z - Math.sin(s.rot) * dx);
      scene.add(pole);
    }
  }

  const boards = [
    { text: 'PUERTO MIRA', sub: 'GOLDEN HOUR • ONDA 96.5 FM', x: -160, z: 8, rot: Math.PI / 2 },
    { text: 'ZEPHYR R', sub: '0-100 IN 3.1s', x: 160, z: -8, rot: -Math.PI / 2 },
    { text: 'TIDE 101', sub: 'NEON TIDE ALL NIGHT', x: 8, z: 160, rot: Math.PI },
  ];
  for (const b of boards) {
    const tex = makeCanvas(512, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ff9a5c');
      g.addColorStop(1, '#c94b7c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.font = 'bold 72px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.text, w / 2, h / 2 - 10);
      ctx.font = 'bold 30px Arial';
      ctx.fillStyle = '#ffe9c8';
      ctx.fillText(b.sub, w / 2, h / 2 + 48);
    });
    // Two FrontSide planes back to back (same reason as the neon signs:
    // a DoubleSide plane reads mirrored from behind). Texture is opaque,
    // so no backing panel is needed.
    const bnx = Math.sin(b.rot);
    const bnz = Math.cos(b.rot);
    for (const side of [1, -1]) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 7),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      plane.position.set(b.x + bnx * 0.06 * side, 11, b.z + bnz * 0.06 * side);
      plane.rotation.y = side > 0 ? b.rot : b.rot + Math.PI;
      scene.add(plane);
    }
    for (const dx of [-5, 5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8, 6), poleMat);
      pole.position.set(b.x + Math.cos(b.rot) * dx, 4, b.z - Math.sin(b.rot) * dx);
      scene.add(pole);
    }
  }
}

// --- pier, marina docks, 3 boats ---
function buildWaterfront(scene) {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 62), woodMat);
  pier.position.set(-180, 1.1, 242);
  pier.castShadow = true;
  scene.add(pier);
  const postGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, 12);
  const m4 = new THREE.Matrix4();
  let i = 0;
  for (let z = 216; z <= 268; z += 10) {
    for (const x of [-184, -176]) {
      m4.makeTranslation(x, 0.4, z);
      posts.setMatrixAt(i++, m4);
    }
  }
  scene.add(posts);
  // Small shack at the pier end.
  const shack = new THREE.Mesh(
    new THREE.BoxGeometry(5, 3.5, 4),
    new THREE.MeshStandardMaterial({ color: 0xd8a0a0, roughness: 0.9 }),
  );
  shack.position.set(-180, 3, 268);
  shack.castShadow = true;
  scene.add(shack);
  const shackRoof = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.3, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 }),
  );
  shackRoof.position.set(-180, 4.9, 268);
  scene.add(shackRoof);

  // Boardwalk fence: wooden posts + two rails along the promenade edge
  // (z = 201), with gaps where the north-south streets meet the beach.
  const fenceParts = [];
  const fenceZ = 201;
  const spans = [];
  let spanStart = -CITY.half;
  for (const s of STREETS) {
    spans.push([spanStart, s - 7]);
    spanStart = s + 7;
  }
  spans.push([spanStart, CITY.half]);
  for (const [x0, x1] of spans) {
    if (x1 - x0 < 2) continue;
    for (const y of [1.05, 0.6]) {
      const rail = new THREE.BoxGeometry(x1 - x0, 0.09, 0.09);
      rail.translate((x0 + x1) / 2, y, fenceZ);
      fenceParts.push(rail);
    }
    for (let x = x0 + 0.5; x <= x1 - 0.2; x += 2.2) {
      const post = new THREE.BoxGeometry(0.14, 1.15, 0.14);
      post.translate(x, 0.58, fenceZ);
      fenceParts.push(post);
    }
  }
  const fence = new THREE.Mesh(mergeGeometries(fenceParts), woodMat);
  fence.castShadow = true;
  scene.add(fence);

  // Marina docks + boats (east side of the beach).
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1 });
  for (const [x, z] of [[140, 240], [175, 246], [208, 238]]) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 22), dockMat);
    dock.position.set(x - 6, 0.5, z);
    scene.add(dock);
  }
  const boatDefs = [
    { x: 140, z: 246, rot: 0.2, hull: 0xffffff, cabin: 0x2ec4ff },
    { x: 175, z: 252, rot: -0.15, hull: 0xffd9a0, cabin: 0xff2e63 },
    { x: 208, z: 244, rot: 0.35, hull: 0xa0e0d0, cabin: 0xffffff },
  ];
  for (const b of boatDefs) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.2, 9),
      new THREE.MeshStandardMaterial({ color: b.hull, roughness: 0.5 }),
    );
    hull.position.y = 0.6;
    hull.castShadow = true;
    g.add(hull);
    const bow = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.0, 2.2),
      new THREE.MeshStandardMaterial({ color: b.hull, roughness: 0.5 }),
    );
    bow.position.set(0, 0.6, 5.2);
    bow.rotation.x = -0.35;
    g.add(bow);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.3, 3.2),
      new THREE.MeshStandardMaterial({ color: b.cabin, roughness: 0.5 }),
    );
    cabin.position.set(0, 1.8, -0.5);
    g.add(cabin);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.6 }),
    );
    mast.position.set(0, 5, 0.5);
    g.add(mast);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 5.6);
    sailShape.lineTo(2.6, 0.4);
    sailShape.lineTo(0, 0);
    const sail = new THREE.Mesh(
      new THREE.ShapeGeometry(sailShape),
      new THREE.MeshStandardMaterial({ color: 0xf5f0e0, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    sail.position.set(0.1, 2.4, 0.5);
    g.add(sail);
    g.position.set(b.x, 0.1, b.z);
    g.rotation.y = b.rot;
    g.userData.phase = Math.random() * Math.PI * 2;
    scene.add(g);
    boats.push(g);
  }
}

// --- lighting: one directional sun (2048 shadow map, follows player) + hemisphere ---
function buildLighting(scene) {
  sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a6a, 0.8);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(0xf29f67, 0.0018); // spek: kabut sunset
}

// Day-cycle keyframes (minutes of day -> sky/fog/light/lamp values).
const SKY_KEYS = [
  { m: 0, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
  { m: 300, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
  { m: 360, top: 0x2a3a6a, hor: 0xffb37a, fog: 0xc98a7a, sun: 0xffb37a, sunI: 0.90, hemi: 0.60, lamp: 0.6, win: 0.5 },
  { m: 480, top: 0x3f7fd0, hor: 0xbfe0ea, fog: 0xcfe0e8, sun: 0xfff2d0, sunI: 1.60, hemi: 0.90, lamp: 0.0, win: 0.0 },
  { m: 1020, top: 0x3f7fd0, hor: 0xbfe0ea, fog: 0xcfe0e8, sun: 0xfff2d0, sunI: 1.60, hemi: 0.90, lamp: 0.0, win: 0.0 },
  { m: 1110, top: PALETTE.skyTop, hor: PALETTE.skyHorizon, fog: PALETTE.fog, sun: PALETTE.sun, sunI: 1.75, hemi: 0.90, lamp: 0.35, win: 0.35 },
  { m: 1170, top: 0x141c3a, hor: 0xd96a5a, fog: 0x8a5560, sun: 0xff8a5a, sunI: 0.60, hemi: 0.50, lamp: 0.9, win: 0.8 },
  { m: 1260, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
  { m: 1440, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
];

function lerpKey(a, b, f, out) {
  out.top.lerpColors(tmpColor.set(a.top), tmpColor2.set(b.top), f);
  out.hor.lerpColors(tmpColor.set(a.hor), tmpColor2.set(b.hor), f);
  out.fog.lerpColors(tmpColor.set(a.fog), tmpColor2.set(b.fog), f);
  out.sun.lerpColors(tmpColor.set(a.sun), tmpColor2.set(b.sun), f);
  out.sunI = a.sunI + (b.sunI - a.sunI) * f;
  out.hemi = a.hemi + (b.hemi - a.hemi) * f;
  out.lamp = a.lamp + (b.lamp - a.lamp) * f;
  out.win = a.win + (b.win - a.win) * f;
  return out;
}

function skyAt(minutes) {
  const out = { top: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), sunI: 1, hemi: 0.5, lamp: 0, win: 0 };
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    if (minutes >= a.m && minutes <= b.m) {
      return lerpKey(a, b, (minutes - a.m) / Math.max(1, b.m - a.m), out);
    }
  }
  return lerpKey(SKY_KEYS[0], SKY_KEYS[0], 0, out);
}

function sunDirection(minutes, out) {
  if (minutes >= SUNRISE_MIN && minutes <= SUNSET_MIN) {
    const f = (minutes - SUNRISE_MIN) / (SUNSET_MIN - SUNRISE_MIN);
    const th = f * Math.PI;
    // Keep the sun at least ~17° up: at true sunset the light is almost
    // horizontal and street-facing facades go black. Golden hour stays warm,
    // but facades still get direct light.
    out.set(Math.cos(th), Math.max(Math.sin(th), 0.30), 0.35).normalize();
  } else {
    // Night: dim moonlight from the opposite side.
    out.set(-0.4, 0.65, -0.55).normalize();
  }
  return out;
}

// --- public queries ---
export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  return null;
}

export function isOnRoad(x, z) {
  if (Math.abs(x) > CITY.half || Math.abs(z) > CITY.half) return false;
  if (z > CITY.beachZ) return false; // beach / ocean, not road
  const halfStreet = CITY.street / 2;
  for (const s of STREETS) {
    if (Math.abs(x - s) <= halfStreet || Math.abs(z - s) <= halfStreet) return true;
  }
  return false;
}

// --- init / update ---
function init(g) {
  game = g;
  const scene = game.scene;
  const rng = mulberry32(1337);
  buildSky(scene);
  buildClouds(scene);
  buildGround(scene);
  buildRoadMarkings(scene);
  const buildingCount = buildBuildings(scene, rng);
  const palmCount = buildPalms(scene, rng);
  buildStreetFurniture(scene);
  buildSigns(scene);
  buildWaterfront(scene);
  buildLighting(scene);
  game.world = { districtAt, isOnRoad, streets: STREETS };
  update(0); // set initial sun/sky for the starting time (18:52 sunset)
  console.info(`[world] city built: ${buildingCount} buildings, ${palmCount} palms, 3 boats, 6 clouds`);
}

function update(dt) {
  if (!game) return;
  // Advance the clock (rate = game-minutes per real second).
  game.time.minutes += dt * (game.time.rate || 1);
  if (game.time.minutes >= 1440) {
    game.time.minutes -= 1440;
    game.time.day += 1;
  }
  const minutes = game.time.minutes;
  const sky = skyAt(minutes);

  // Sun position + shadow camera follow the player.
  const dir = sunDirection(minutes, tmpVec);
  const focus = game.currentCar ? game.currentCar.group.position : game.player.pos;
  sun.position.copy(focus).addScaledVector(dir, 220);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();
  sun.color.copy(sky.sun);
  sun.intensity = sky.sunI;
  hemi.intensity = sky.hemi;

  // Sky dome, fog, sun disc.
  skyMat.uniforms.topColor.value.copy(sky.top);
  skyMat.uniforms.horizonColor.value.copy(sky.hor);
  skyMat.uniforms.sunColor.value.copy(sky.sun);
  skyMat.uniforms.sunDirection.value.copy(dir);
  game.scene.fog.color.copy(sky.fog);
  sunDisc.position.copy(dir).multiplyScalar(850);
  sunDisc.lookAt(game.camera.position);
  sunDisc.material.color.copy(sky.sun);

  // Lamp + window glow (emissive only — no per-light PointLights).
  if (lampMat) lampMat.emissiveIntensity = sky.lamp * 2.2;
  for (const m of buildingMats) m.emissiveIntensity = sky.win * 1.4;

  // Ocean sine waves (cheap CPU displacement).
  oceanTime += dt;
  if (ocean) {
    const pos = ocean.geometry.attributes.position;
    const t = oceanTime;
    for (let i = 0; i < pos.count; i++) {
      const bx = oceanBase[i * 3];
      const bz = oceanBase[i * 3 + 2];
      pos.array[i * 3 + 1] = 0.35 * Math.sin(bx * 0.06 + t * 1.2) + 0.25 * Math.sin(bz * 0.08 + t * 0.9);
    }
    pos.needsUpdate = true;
    ocean.geometry.computeVertexNormals();
  }

  // Clouds drift slowly, wrap around the city.
  for (const c of clouds) {
    c.position.x += c.userData.drift * dt;
    if (c.position.x > 420) c.position.x = -420;
    c.lookAt(game.camera.position);
  }

  // Boats bob gently.
  for (const b of boats) {
    const ph = b.userData.phase;
    b.position.y = 0.1 + Math.sin(oceanTime * 0.8 + ph) * 0.12;
    b.rotation.z = Math.sin(oceanTime * 0.6 + ph) * 0.02;
  }
}

export default { init, update };
