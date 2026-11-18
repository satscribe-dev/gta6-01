// SOLARA BAY — W1 world: city, sky, ocean, lighting, day cycle.
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

// --- facade textures: one diffuse + one emissive (lit windows) per variant ---
function facadeTextures(rng) {
  const variants = [];
  for (let v = 0; v < 4; v++) {
    const cols = 5 + v;
    const rows = 9 + v * 2;
    const map = makeCanvas(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#e6ded2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9c0b0';
      ctx.fillRect(0, h - 18, w, 18); // ground floor band
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = 8 + c * ((w - 16) / cols);
          const y = 10 + r * ((h - 36) / rows);
          const shade = 36 + Math.floor(rng() * 30);
          ctx.fillStyle = `rgb(${shade},${shade + 14},${shade + 34})`;
          ctx.fillRect(x + 1, y + 1, (w - 16) / cols - 3, (h - 36) / rows - 4);
        }
      }
    });
    const emissive = makeCanvas(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng() < 0.45) {
            const x = 8 + c * ((w - 16) / cols);
            const y = 10 + r * ((h - 36) / rows);
            ctx.fillStyle = rng() < 0.8 ? '#ffca7a' : '#ffd9a0';
            ctx.fillRect(x + 1, y + 1, (w - 16) / cols - 3, (h - 36) / rows - 4);
          }
        }
      }
    });
    variants.push({ map, emissive });
  }
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

// --- sky dome (gradient + sun glow shader) ---
function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
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
        vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
        float s = max(dot(normalize(vDir), normalize(sunDirection)), 0.0);
        col += sunColor * pow(s, 220.0) * 1.4;
        col += sunColor * pow(s, 7.0) * 0.28;
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
    new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.95 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  scene.add(base);

  // Sidewalk slabs: one per city block (park block is grass instead).
  const slabGeo = new THREE.PlaneGeometry(CITY.block, CITY.block);
  const slabMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.9 });
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
    new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }),
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
      color: PALETTE.ocean, roughness: 0.3, metalness: 0.15,
      transparent: true, opacity: 0.93,
    }),
  );
  ocean.position.set(0, 0.15, 425);
  scene.add(ocean);
}

// Centre dashes + zebra crossings as instanced strips (2 draw calls total).
function buildRoadMarkings(scene) {
  const dashGeo = new THREE.PlaneGeometry(3, 0.35);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5d76e });
  const dashSpots = [];
  for (const s of STREETS) {
    for (let t = -228; t <= 228; t += 8) {
      dashSpots.push([s, t, 0]);
      dashSpots.push([t, s, Math.PI / 2]);
    }
  }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  dashSpots.forEach(([x, z, rot], i) => {
    e.set(0, rot, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.08, z), q, sc);
    dashes.setMatrixAt(i, m4);
  });
  scene.add(dashes);

  const stripeGeo = new THREE.PlaneGeometry(3.4, 0.55);
  stripeGeo.rotateX(-Math.PI / 2);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
  const stripeSpots = [];
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      for (const [dx, dz, rot] of [[0, -10.5, 0], [0, 10.5, 0], [-10.5, 0, Math.PI / 2], [10.5, 0, Math.PI / 2]]) {
        for (let k = -2; k <= 2; k++) {
          const off = k * 2.6;
          stripeSpots.push([sx + dx + (rot ? 0 : off), sz + dz + (rot ? off : 0), rot]);
        }
      }
    }
  }
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, stripeSpots.length);
  stripeSpots.forEach(([x, z, rot], i) => {
    e.set(0, rot, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.08, z), q, sc);
    stripes.setMatrixAt(i, m4);
  });
  scene.add(stripes);
}

// --- buildings: ~80 boxes, canvas facades, shared materials, rooftop props ---
function buildBuildings(scene, rng) {
  const variants = facadeTextures(rng);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.95 });
  const sideMats = new Map();
  for (let v = 0; v < variants.length; v++) {
    for (const c of PALETTE.building) {
      const mat = new THREE.MeshStandardMaterial({
        map: variants[v].map,
        emissiveMap: variants[v].emissive,
        emissive: new THREE.Color(0xffc27a),
        emissiveIntensity: 0,
        color: c,
        roughness: 0.85,
      });
      sideMats.set(`${v}:${c}`, mat);
      buildingMats.push(mat);
    }
  }

  const roofs = []; // {x, z, w, d, h} for rooftop props
  let count = 0;
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (bx === -37 && bz === 37) continue; // park block stays open
      const beachRow = bz === 185;
      const slots = beachRow ? 1 : 2 + Math.floor(rng() * 2); // 2-3 per block (~80 total)
      for (let s = 0; s < slots; s++) {
        const qx = (s % 2) * 2 - 1;
        const qz = (s < 2 ? -1 : 1);
        const w = 12 + rng() * 12;
        const d = 12 + rng() * 12;
        const x = bx + qx * 14 + (rng() - 0.5) * 6;
        const z = bz + qz * 14 + (rng() - 0.5) * 6;
        // Taller towers near the centre and in Harbor Heights (x > 0, z < 0).
        const tallZone = (Math.abs(x) < 110 && Math.abs(z) < 110) || (x > 0 && z < 0);
        let h = 8 + rng() * 22;
        if (tallZone) h = 8 + rng() * rng() * 52; // up to 60 m
        if (beachRow) h = Math.min(h, 14);
        const v = Math.floor(rng() * variants.length);
        const c = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
        const side = sideMats.get(`${v}:${c}`);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          [side, side, roofMat, roofMat, side, side],
        );
        mesh.position.set(x, 0.05 + h / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        roofs.push({ x, z, w, d, h });
        count++;
      }
    }
  }

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
  return count;
}

// --- palm trees: instanced trunks + merged-frond crowns (2 draw calls) ---
function buildPalms(scene, rng) {
  const spots = [];
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (bx === -37 && bz === 37) continue;
      spots.push([bx + (rng() - 0.5) * 44, bz + (rng() - 0.5) * 44]);
    }
  }
  for (let i = 0; i < 10; i++) { // park cluster
    spots.push([-37 + (rng() - 0.5) * 48, 37 + (rng() - 0.5) * 48]);
  }
  for (let i = 0; i < 15; i++) { // beach line
    spots.push([-220 + rng() * 440, 196 + rng() * 6]);
  }

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5.5, 6);
  trunkGeo.translate(0, 2.75, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
  const frondParts = [];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.PlaneGeometry(3.6, 1.1);
    f.translate(1.8, 0, 0);
    f.rotateZ(-0.5); // droop
    f.rotateY((i / 7) * Math.PI * 2);
    frondParts.push(f);
  }
  const crownGeo = mergeGeometries(frondParts);
  crownGeo.translate(0, 5.6, 0);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x2e9e5b, roughness: 1, side: THREE.DoubleSide,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  trunks.castShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  spots.forEach(([x, z], i) => {
    const s = 0.8 + rng() * 0.5;
    e.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 0.05, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
  });
  scene.add(trunks);
  scene.add(crowns);
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
    { text: 'HOTEL SOLARA', color: '#2ee6ff', x: 80, z: -60, rot: -Math.PI / 2 },
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
    { text: 'SOLARA BAY', sub: 'GOLDEN HOUR • TIDE 101', x: -160, z: 8, rot: Math.PI / 2 },
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
  sun = new THREE.DirectionalLight(PALETTE.sun, 1.1);
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
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a6a, 0.55);
  scene.add(hemi);
  scene.fog = new THREE.Fog(PALETTE.fog, 150, 950);
}

// Day-cycle keyframes (minutes of day -> sky/fog/light/lamp values).
const SKY_KEYS = [
  { m: 0, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
  { m: 300, top: 0x070d20, hor: 0x131c38, fog: 0x10182e, sun: 0x8fa8ff, sunI: 0.25, hemi: 0.45, lamp: 1.30, win: 1.20 },
  { m: 360, top: 0x2a3a6a, hor: 0xffb37a, fog: 0xc98a7a, sun: 0xffb37a, sunI: 0.70, hemi: 0.50, lamp: 0.6, win: 0.5 },
  { m: 480, top: 0x3f7fd0, hor: 0xbfe0ea, fog: 0xcfe0e8, sun: 0xfff2d0, sunI: 1.60, hemi: 0.90, lamp: 0.0, win: 0.0 },
  { m: 1020, top: 0x3f7fd0, hor: 0xbfe0ea, fog: 0xcfe0e8, sun: 0xfff2d0, sunI: 1.60, hemi: 0.90, lamp: 0.0, win: 0.0 },
  { m: 1110, top: PALETTE.skyTop, hor: PALETTE.skyHorizon, fog: PALETTE.fog, sun: PALETTE.sun, sunI: 1.10, hemi: 0.55, lamp: 0.35, win: 0.35 },
  { m: 1170, top: 0x141c3a, hor: 0xd96a5a, fog: 0x8a5560, sun: 0xff8a5a, sunI: 0.40, hemi: 0.35, lamp: 0.9, win: 0.8 },
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
    out.set(Math.cos(th), Math.sin(th), 0.35).normalize();
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
