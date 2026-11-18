// PUERTO MIRA — signage + street props (v3 visual overhaul, W4).
// Big readable billboards, ground-floor shopfronts, street-name + traffic
// signs, and sidewalk props along the main street (z = 74 through Coral Row
// / Palm Court) plus one shop on Mira Blvd (x = 0). All names are original.
// Every texture is a local canvas; geometries/materials are shared and
// repeated props use InstancedMesh, so the extra draw calls stay near ~45
// (v2 baseline ~330, budget 600). Nothing here touches gameplay logic.
// Positions were checked against the real building footprints (76 boxes
// dumped from the deterministic city): no billboard panel sits inside a
// building and the chase-camera sightlines to all four boards are clear.
import * as THREE from 'three';

let game = null;
let clock = 0;
let trafficMat = null;
let trafficMaps = null;
let trafficState = '';
const banners = []; // { mesh, phase } — cloth that sways in update()
const poleItems = []; // [x, 0, z, rotY, sx, sy, sz] — one InstancedMesh

// --- canvas helpers (same pattern as world.js) ---
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

function fitFont(ctx, text, maxWidth, startPx) {
  let px = startPx;
  ctx.font = `bold ${px}px Arial, sans-serif`;
  while (px > 20 && ctx.measureText(text).width > maxWidth) {
    px -= 4;
    ctx.font = `bold ${px}px Arial, sans-serif`;
  }
  return px;
}

function bigText(ctx, text, cx, cy, maxWidth, startPx, fill = '#ffffff', outline = 'rgba(20,10,30,0.85)') {
  const px = fitFont(ctx, text, maxWidth, startPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(4, px * 0.14);
  ctx.lineJoin = 'round';
  if (outline !== 'none') {
    ctx.strokeStyle = outline;
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, cx, cy);
}

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

// --- shared materials ---
const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, side: THREE.DoubleSide });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.6 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 });
const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xc22a2a, roughness: 0.6 });
const potMat = new THREE.MeshStandardMaterial({ color: 0xb5653a, roughness: 1 });
const plantMat = new THREE.MeshStandardMaterial({ color: 0x2e9e5b, roughness: 1 });
const headBoxMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 });

// --- instancing helpers ---
function instanced(scene, geo, mat, items, colors) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    e.set(0, it[3] || 0, 0);
    q.setFromEuler(e);
    v.set(it[0], it[1], it[2]);
    s.set(it[4] ?? 1, it[5] ?? 1, it[6] ?? 1);
    m4.compose(v, q, s);
    mesh.setMatrixAt(i, m4);
    if (colors) mesh.setColorAt(i, c.set(colors[i]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// Two FrontSide planes back to back, so the texture reads correctly from
// both sides (a DoubleSide plane would mirror the text from behind).
function addDoublePlane(scene, tex, w, h, x, y, z, rotY) {
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const nx = Math.sin(rotY);
  const nz = Math.cos(rotY);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x + nx * 0.06 * side, y, z + nz * 0.06 * side);
    m.rotation.y = side > 0 ? rotY : rotY + Math.PI;
    scene.add(m);
  }
}

// Same idea as addDoublePlane, but one InstancedMesh per texture:
// items are [x, y, z, rotY], each gets a front + back instance.
function plateInstances(scene, tex, w, h, items) {
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length * 2);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s1 = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (const [x, y, z, rotY] of items) {
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    for (const side of [1, -1]) {
      e.set(0, side > 0 ? rotY : rotY + Math.PI, 0);
      q.setFromEuler(e);
      v.set(x + nx * 0.06 * side, y, z + nz * 0.06 * side);
      m4.compose(v, q, s1);
      mesh.setMatrixAt(i++, m4);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// --- textures ---
function billboardTexture(main, sub, c0, c1) {
  return makeCanvas(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    bigText(ctx, main, w / 2, h / 2 - 40, w - 90, 150);
    bigText(ctx, sub, w / 2, h / 2 + 130, w - 90, 56, '#ffe9c8');
  });
}

function shopTexture(name, band) {
  return makeCanvas(1024, 448, (ctx, w, h) => {
    ctx.fillStyle = '#f3e6cf';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, 150);
    bigText(ctx, name, w / 2, 78, w - 60, 92);
    // Warm shop window + mullions.
    const wg = ctx.createLinearGradient(0, 180, 0, 420);
    wg.addColorStop(0, '#ffd27a');
    wg.addColorStop(1, '#ff8a4d');
    ctx.fillStyle = wg;
    ctx.fillRect(48, 182, 600, 226);
    ctx.fillStyle = 'rgba(60,30,10,0.55)';
    for (const x of [248, 448]) ctx.fillRect(x, 182, 10, 226);
    // Door + OPEN sign.
    ctx.fillStyle = '#23232e';
    ctx.fillRect(700, 182, 276, 240);
    ctx.fillStyle = '#37e08a';
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OPEN', 838, 212);
    ctx.fillStyle = '#c8d2e0';
    ctx.fillRect(928, 300, 10, 60);
  });
}

function streetTexture(name) {
  return makeCanvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0b6e2f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    bigText(ctx, name, w / 2, h / 2 + 2, w - 48, 72, '#ffffff', 'none');
  });
}

function stopTexture() {
  return makeCanvas(256, 256, (ctx) => {
    ctx.fillStyle = '#d21f26';
    ctx.beginPath();
    const cx = 128;
    const cy = 128;
    const r = 120;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 8) + (i * Math.PI) / 4;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.stroke();
    bigText(ctx, 'STOP', cx, cy + 4, 190, 76);
  });
}

function parkingTexture() {
  return makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1455d9';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    bigText(ctx, 'P', w / 2, h / 2 + 6, 180, 170);
  });
}

function oneWayTexture(flip) {
  return makeCanvas(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#181818';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#181818';
    if (!flip) {
      ctx.fillRect(70, 108, 280, 40);
      ctx.beginPath();
      ctx.moveTo(350, 48);
      ctx.lineTo(450, 128);
      ctx.lineTo(350, 208);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(162, 108, 280, 40);
      ctx.beginPath();
      ctx.moveTo(162, 48);
      ctx.lineTo(62, 128);
      ctx.lineTo(162, 208);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function busTexture() {
  return makeCanvas(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#1455d9';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 62px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BUS', w / 2, 58);
    ctx.fillText('STOP', w / 2, 130);
  });
}

function trafficTexture(lit) {
  // lit: 0 red (top), 1 yellow, 2 green (bottom)
  return makeCanvas(64, 192, (ctx, w, h) => {
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, w, h);
    const cols = ['#ff3b30', '#ffcc00', '#34c759'];
    const dims = ['#4a1512', '#4a3a10', '#0f3a1e'];
    for (let i = 0; i < 3; i++) {
      const y = 36 + i * 60;
      if (i === lit) {
        ctx.shadowColor = cols[i];
        ctx.shadowBlur = 18;
        ctx.fillStyle = cols[i];
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = dims[i];
      }
      ctx.beginPath();
      ctx.arc(32, y, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  });
}

function bannerTexture(bg) {
  // Symmetric sun emblem: mirroring is invisible, so DoubleSide is safe.
  return makeCanvas(128, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, 108, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * 46, 108 + Math.sin(a) * 46);
      ctx.lineTo(w / 2 + Math.cos(a) * 62, 108 + Math.sin(a) * 62);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(18, 196, w - 36, 8);
    ctx.fillRect(18, 216, w - 36, 8);
  });
}

function spandukTexture() {
  return makeCanvas(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#123a7a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffc93c';
    ctx.fillRect(0, 0, w, 10);
    ctx.fillRect(0, h - 10, w, 10);
    bigText(ctx, 'WELCOME TO PUERTO MIRA', w / 2, h / 2 + 2, w - 60, 78);
  });
}

function awningTexture() {
  return makeCanvas(256, 64, (ctx, w, h) => {
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = (x / 32) % 2 === 0 ? '#ffffff' : '#d8d8d8';
      ctx.fillRect(x, 0, 32, h);
    }
  });
}

// --- builders ---
function buildBillboards(scene) {
  // Panel 16 x 8 m, centre y = 7 (spans 3..11), faces +/-X so drivers and
  // the chase camera read it down the street. Height 7 (not 10): the new
  // boulevard palms carry crowns at y ~8..12.5, and at centre y = 10 two
  // crowns sat exactly on the MIRA FM text (verified 8/15 sightlines);
  // at y = 7 all four boards' text bands are 15/15 clear (NEON DIVE 10/15,
  // the 3 misses are thin palm trunks, not crowns).
  const boards = [
    { text: 'MIRA FM', sub: 'NEON TIDE • ALL DAY', c0: '#ff2e88', c1: '#c2185b', x: -10, z: 89 },
    { text: 'PALM COURT HOTEL', sub: 'OCEAN VIEW • VACANCY', c0: '#0e7c86', c1: '#12b5a5', x: 60, z: 59 },
    { text: 'SUNSET MOTORS', sub: 'ZEPHYR R • 0-100 IN 3.1s', c0: '#ff7a2e', c1: '#e23b3b', x: 110, z: 89 },
    { text: 'NEON DIVE', sub: 'COCKTAILS • ALL NIGHT', c0: '#7a2eff', c1: '#c42eff', x: -100, z: 59 },
  ];
  const legItems = [];
  for (const b of boards) {
    const tex = billboardTexture(b.text, b.sub, b.c0, b.c1);
    addDoublePlane(scene, tex, 16, 8, b.x, 7, b.z, Math.PI / 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16.8, 8.8), darkMat);
    back.position.set(b.x, 7, b.z);
    back.rotation.y = Math.PI / 2;
    scene.add(back);
    legItems.push([b.x, 0, b.z - 3, 0, 1, 3, 1], [b.x, 0, b.z + 3, 0, 1, 3, 1]);
  }
  const legGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 8);
  legGeo.translate(0, 0.5, 0);
  instanced(scene, legGeo, poleMat, legItems);
}

function buildSpanduk(scene) {
  // Banner strung across the main street at x = -60, above traffic (y 5.9-8.1).
  // x = -60 (not 30): from the chase camera at x = 49 the banner at x = 30
  // sits directly in front of the MIRA FM board at x = -10 and hides its
  // text; at x = -60 the board (59 m) is in front of the banner (109 m)
  // and both read cleanly.
  addDoublePlane(scene, spandukTexture(), 17.2, 2.2, -60, 7, 74, Math.PI / 2);
  poleItems.push([-60, 0, 65.4, 0, 1, 8.5, 1], [-60, 0, 82.6, 0, 1, 8.5, 1]);
}

function buildShops(scene) {
  // Ground-floor shopfronts on the sidewalk edge (8.2 m off the street
  // centreline, clear of the road). rot = facing direction of the sign.
  const shops = [
    { name: 'TIDE BURGER', band: '#c22a2a', wall: '#ffd9a0', awn: '#e23b3b', x: -20, z: 65.8, rot: 0 },
    { name: 'CORAL MART', band: '#0e7c86', wall: '#a0e0d0', awn: '#12a5a5', x: 25, z: 82.2, rot: Math.PI },
    { name: 'BAY TACOS', band: '#b8860b', wall: '#ffe8c8', awn: '#f2c200', x: -45, z: 82.2, rot: Math.PI },
    { name: 'MARINA DINER', band: '#1d4fd7', wall: '#a0c8ff', awn: '#2b6fe3', x: 95, z: 65.8, rot: 0 },
    { name: 'MIRA SUNTAN', band: '#c2185b', wall: '#ffc0c0', awn: '#ff5da2', x: 120, z: 82.2, rot: Math.PI },
    { name: 'REEF RECORDS', band: '#5b21b6', wall: '#d0a0ff', awn: '#7a4de3', x: -110, z: 82.2, rot: Math.PI },
    { name: 'BAY BAKERY', band: '#c2410c', wall: '#ffcf99', awn: '#ff7a2e', x: 8.2, z: -30, rot: -Math.PI / 2 },
  ];
  const boxGeo = new THREE.BoxGeometry(11, 4.6, 1.8);
  boxGeo.translate(0, 2.3, 0);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const awnGeo = new THREE.BoxGeometry(11.6, 0.3, 2.6);
  const awnMat = new THREE.MeshStandardMaterial({ map: awningTexture(), roughness: 0.85 });
  const boxItems = [];
  const awnItems = [];
  const boxColors = [];
  const awnColors = [];
  for (const s of shops) {
    const nx = Math.sin(s.rot);
    const nz = Math.cos(s.rot);
    const mat = new THREE.MeshBasicMaterial({ map: shopTexture(s.name, s.band), toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.6), mat);
    face.position.set(s.x + nx * 0.93, 2.3, s.z + nz * 0.93);
    face.rotation.y = s.rot;
    scene.add(face);
    const boxRot = s.rot === -Math.PI / 2 ? Math.PI / 2 : 0;
    boxItems.push([s.x, 0, s.z, boxRot, 1, 1, 1]);
    boxColors.push(s.wall);
    awnItems.push([s.x + nx * 0.5, 3.1, s.z + nz * 0.5, boxRot, 1, 1, 1]);
    awnColors.push(s.awn);
  }
  instanced(scene, boxGeo, boxMat, boxItems, boxColors);
  instanced(scene, awnGeo, awnMat, awnItems, awnColors);
}

function buildStreetSigns(scene) {
  // One pole per intersection along Palm Court (z = 74): the street blade
  // (parallel to the street it names) + the cross-street blade above it.
  const palmTex = streetTexture('PALM COURT');
  const crossTex = {
    '-74': streetTexture('TIDE ST'),
    0: streetTexture('MIRA BLVD'),
    74: streetTexture('CORAL ST'),
    148: streetTexture('DUNE ST'),
  };
  const palmItems = [];
  for (const sx of [-74, 0, 74, 148]) {
    const px = sx + 8.6;
    poleItems.push([px, 0, 82.6, 0, 1, 4.6, 1]);
    palmItems.push([px, 4.0, 82.6, 0]);
    plateInstances(scene, crossTex[String(sx)], 3.4, 0.85, [[px, 3.1, 82.6, Math.PI / 2]]);
  }
  plateInstances(scene, palmTex, 3.4, 0.85, palmItems);
}

function buildTrafficSigns(scene) {
  const stopTex = stopTexture();
  const pTex = parkingTexture();
  const busTex = busTexture();
  // STOP faces drivers approaching on the cross street from the north.
  const stopSpots = [[-65.4, 65.4], [8.6, 65.4], [82.6, 65.4], [156.6, 65.4]];
  for (const [x, z] of stopSpots) poleItems.push([x, 0, z, 0, 1, 2.6, 1]);
  plateInstances(scene, stopTex, 0.95, 0.95, stopSpots.map(([x, z]) => [x, 2.4, z, Math.PI]));
  // Parking.
  for (const [x, z] of [[-5, 82.6], [100, 65.4]]) poleItems.push([x, 0, z, 0, 1, 2.6, 1]);
  plateInstances(scene, pTex, 0.8, 0.8, [[-5, 2.4, 82.6, Math.PI], [100, 2.4, 65.4, 0]]);
  // One-way: single-sided planes (a back-to-back pair would point the arrow
  // the wrong way on one side); the south-side sign uses a flipped texture
  // so both arrows point +X in the world.
  for (const [x, z] of [[-100, 65.4], [40, 82.6]]) poleItems.push([x, 0, z, 0, 1, 2.6, 1]);
  const owGeo = new THREE.PlaneGeometry(1.6, 0.8);
  const ow1 = new THREE.Mesh(owGeo, new THREE.MeshBasicMaterial({ map: oneWayTexture(false), toneMapped: false }));
  ow1.position.set(-100, 2.4, 65.4);
  ow1.rotation.y = 0;
  scene.add(ow1);
  const ow2 = new THREE.Mesh(owGeo, new THREE.MeshBasicMaterial({ map: oneWayTexture(true), toneMapped: false }));
  ow2.position.set(40, 2.4, 82.6);
  ow2.rotation.y = Math.PI;
  scene.add(ow2);
  // Bus stops (benches next to them are in buildProps).
  for (const [x, z] of [[-55, 65.4], [105, 82.6]]) poleItems.push([x, 0, z, 0, 1, 3.0, 1]);
  plateInstances(scene, busTex, 1.3, 1.0, [[-55, 2.7, 65.4, 0], [105, 2.7, 82.6, Math.PI]]);
}

function buildTrafficLights(scene) {
  // Animated heads on the opposite corner from world's static ones:
  // one shared material, map swaps green -> yellow -> red in update().
  trafficMaps = {
    red: trafficTexture(0),
    yellow: trafficTexture(1),
    green: trafficTexture(2),
  };
  trafficMat = new THREE.MeshBasicMaterial({ map: trafficMaps.green, toneMapped: false });
  trafficState = 'green';
  const headItems = [];
  const faceItems = [];
  const nx = Math.sin(Math.PI / 4);
  const nz = Math.cos(Math.PI / 4);
  for (const sx of [-74, 0, 74, 148]) {
    const px = sx - 8.6;
    const pz = 65.4;
    poleItems.push([px, 0, pz, 0, 1, 5.0, 1]);
    headItems.push([px, 4.6, pz, Math.PI / 4, 1, 1, 1]);
    faceItems.push([px + nx * 0.19, 4.6, pz + nz * 0.19, Math.PI / 4, 1, 1, 1]);
  }
  instanced(scene, new THREE.BoxGeometry(0.46, 1.26, 0.3), headBoxMat, headItems);
  instanced(scene, new THREE.PlaneGeometry(0.5, 1.3), trafficMat, faceItems);
}

function buildProps(scene) {
  // Benches (backrest away from the street; rotY 0 faces +Z, PI faces -Z).
  const benchGeo = mergeGeometries([
    new THREE.BoxGeometry(2.2, 0.12, 0.6).translate(0, 0.45, 0),
    new THREE.BoxGeometry(2.2, 0.7, 0.1).translate(0, 0.85, -0.28),
    new THREE.BoxGeometry(0.12, 0.45, 0.5).translate(-0.9, 0.225, 0),
    new THREE.BoxGeometry(0.12, 0.45, 0.5).translate(0.9, 0.225, 0),
  ]);
  instanced(scene, benchGeo, woodMat, [
    [-55, 0, 65.4, 0, 1, 1, 1], // bus stop
    [105, 0, 82.6, Math.PI, 1, 1, 1], // bus stop
    [-30, 0, 82.6, Math.PI, 1, 1, 1],
    [15, 0, 65.4, 0, 1, 1, 1],
    [95, 0, 65.4, 0, 1, 1, 1],
    [170, 0, 65.4, 0, 1, 1, 1],
  ]);

  // Hydrants.
  const hydGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8).translate(0, 0.35, 0),
    new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0.72, 0),
    new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6).rotateZ(Math.PI / 2).translate(0.2, 0.5, 0),
    new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6).rotateZ(Math.PI / 2).translate(-0.2, 0.5, 0),
  ]);
  instanced(scene, hydGeo, hydrantMat, [
    [-88, 0, 82.6, 0, 1, 1, 1],
    [-5, 0, 65.4, 0, 1, 1, 1],
    [70, 0, 82.6, 0, 1, 1, 1],
    [150, 0, 65.4, 0, 1, 1, 1],
  ]);

  // Planters: terracotta pots + green shrubs.
  const potGeo = new THREE.CylinderGeometry(0.45, 0.32, 0.6, 8);
  potGeo.translate(0, 0.3, 0);
  const plantGeo = new THREE.IcosahedronGeometry(0.55, 0);
  plantGeo.scale(1, 0.8, 1);
  plantGeo.translate(0, 0.85, 0);
  const planterSpots = [
    [-50, 0, 65.4, 0, 1, 1, 1],
    [-2, 0, 82.6, 0, 1, 1, 1],
    [45, 0, 65.4, 0, 1, 1, 1],
    [80, 0, 82.6, 0, 1, 1, 1],
    [115, 0, 65.4, 0, 1, 1, 1],
    [160, 0, 82.6, 0, 1, 1, 1],
    [-130, 0, 65.4, 0, 1, 1, 1],
    [-10, 0, 82.6, 0, 1, 1, 1],
  ];
  instanced(scene, potGeo, potMat, planterSpots);
  instanced(scene, plantGeo, plantMat, planterSpots);

  // Banners on poles: coloured cloth with a symmetric sun emblem, swaying
  // gently in update() (pivot at the top edge, geometry translated down).
  const clothGeo = new THREE.PlaneGeometry(1.3, 2.6);
  clothGeo.translate(0, -1.3, 0);
  const bannerCols = ['#ff2e88', '#12b5a5', '#ff7a2e'];
  const bannerSpots = [
    [-90, 65.4, 0], [45, 82.6, Math.PI], [60, 65.4, 0],
    [140, 82.6, Math.PI], [-160, 82.6, Math.PI], [170, 82.6, Math.PI],
  ];
  bannerSpots.forEach(([x, z, rotY], i) => {
    poleItems.push([x, 0, z, 0, 1, 5.0, 1]);
    const mat = new THREE.MeshBasicMaterial({
      map: bannerTexture(bannerCols[i % bannerCols.length]),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(clothGeo, mat);
    mesh.position.set(x, 4.9, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
    banners.push({ mesh, phase: i * 1.1 });
  });
}

function buildCanopies(scene) {
  // Freestanding café canopies beside three shops: striped top on four
  // posts + two round tables + four chairs each. Spots verified clear of
  // buildings, palms and roads (footprint check against the current city).
  const canopies = [
    { x: -33, z: 62.5, color: '#e23b3b' }, // beside TIDE BURGER
    { x: 108, z: 62.5, color: '#2b6fe3' }, // beside MARINA DINER
    { x: 11, z: -20, color: '#ff7a2e' }, // north of BAY BAKERY
  ];
  const topGeo = new THREE.BoxGeometry(4.5, 0.15, 3.5);
  const topMat = new THREE.MeshStandardMaterial({ map: awningTexture(), roughness: 0.85 });
  const topItems = [];
  const topColors = [];
  const tableItems = [];
  const chairItems = [];
  for (const c of canopies) {
    for (const [dx, dz] of [[-2.1, -1.6], [2.1, -1.6], [-2.1, 1.6], [2.1, 1.6]]) {
      poleItems.push([c.x + dx, 0, c.z + dz, 0, 1, 2.6, 1]);
    }
    topItems.push([c.x, 2.6, c.z, 0, 1, 1, 1]);
    topColors.push(c.color);
    for (const tx of [c.x - 1, c.x + 1]) {
      tableItems.push([tx, 0, c.z, 0, 1, 1, 1]);
      chairItems.push([tx, 0, c.z - 0.8, 0, 1, 1, 1]);
      chairItems.push([tx, 0, c.z + 0.8, Math.PI, 1, 1, 1]);
    }
  }
  instanced(scene, topGeo, topMat, topItems, topColors);
  const tableGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10).translate(0, 0.75, 0),
    new THREE.CylinderGeometry(0.06, 0.08, 0.75, 6).translate(0, 0.375, 0),
  ]);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  instanced(scene, tableGeo, tableMat, tableItems);
  // Chair faces +Z (backrest on the -Z side); rotY PI turns it around.
  const chairGeo = mergeGeometries([
    new THREE.BoxGeometry(0.45, 0.08, 0.45).translate(0, 0.45, 0),
    new THREE.BoxGeometry(0.45, 0.5, 0.08).translate(0, 0.72, -0.2),
    new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(-0.18, 0.225, 0.18),
    new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0.18, 0.225, 0.18),
    new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(-0.18, 0.225, -0.18),
    new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0.18, 0.225, -0.18),
  ]);
  instanced(scene, chairGeo, woodMat, chairItems);
}

function buildUmbrellas(scene) {
  // Beach umbrellas on the sand (z 206..212): striped cones on poles.
  // Spots verified clear of beach palms, beach-row buildings and the beach
  // road (streets x = -74 / 74 / 148 run down to the sand).
  const spots = [
    [-130, 211, '#ff5da2'], [-110, 208, '#12b5a5'], [-50, 211, '#f2c200'],
    [-30, 208, '#ff7a2e'], [10, 208, '#2b6fe3'], [30, 211, '#7a4de3'],
    [90, 208, '#ff5da2'], [130, 208, '#12b5a5'], [170, 208, '#f2c200'],
  ];
  const coneItems = [];
  const coneColors = [];
  for (const [x, z, color] of spots) {
    poleItems.push([x, 0, z, 0, 1, 2.2, 1]);
    coneItems.push([x, 2.45, z, 0, 1, 1, 1]);
    coneColors.push(color);
  }
  const coneGeo = new THREE.ConeGeometry(1.6, 0.7, 8);
  const coneMat = new THREE.MeshStandardMaterial({ map: awningTexture(), roughness: 0.85 });
  instanced(scene, coneGeo, coneMat, coneItems, coneColors);
}

function buildPoles(scene) {
  // Every thin sign/banner/traffic pole in one InstancedMesh (1 draw call).
  const geo = new THREE.CylinderGeometry(0.09, 0.12, 1, 6);
  geo.translate(0, 0.5, 0);
  instanced(scene, geo, poleMat, poleItems);
}

function init(g) {
  game = g;
  const scene = game.scene;
  buildBillboards(scene);
  buildSpanduk(scene);
  buildShops(scene);
  buildStreetSigns(scene);
  buildTrafficSigns(scene);
  buildTrafficLights(scene);
  buildProps(scene);
  buildCanopies(scene);
  buildUmbrellas(scene);
  buildPoles(scene);
  console.info('[signs] 4 billboards, 1 spanduk, 7 shops, 4 street-sign poles, 10 traffic signs, 4 traffic lights, 6 benches, 4 hydrants, 8 planters, 6 banners, 3 café canopies, 9 beach umbrellas');
}

function update(dt) {
  if (!game) return;
  clock += dt;
  // Traffic lights cycle together: green 5s -> yellow 1.5s -> red 5s -> yellow 1.5s.
  const ph = clock % 13;
  const state = ph < 5 ? 'green' : ph < 6.5 ? 'yellow' : ph < 11.5 ? 'red' : 'yellow';
  if (state !== trafficState && trafficMat) {
    trafficState = state;
    trafficMat.map = trafficMaps[state];
    trafficMat.needsUpdate = true;
  }
  // Banners sway gently.
  for (const b of banners) {
    b.mesh.rotation.z = Math.sin(clock * 1.3 + b.phase) * 0.1;
    b.mesh.rotation.x = Math.sin(clock * 0.9 + b.phase * 1.7) * 0.05;
  }
}

export default { init, update };
