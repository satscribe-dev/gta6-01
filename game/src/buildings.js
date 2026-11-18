// buildings.js — the city itself: pastel shophouses, glass towers,
// dockyard containers + cranes, lantern tents, boardwalk palms.
// InstancedMesh + a deterministic seeded PRNG, so the city is identical
// on every load. Every solid prop registers a collider in VR.World.
(function (VR) {
  'use strict';

  var C = VR.Config;
  var P = C.PALETTE;
  var scene = VR.World.scene;

  // Deterministic PRNG (mulberry32).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1337);
  function rr(min, max) { return min + rng() * (max - min); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  // Second stream for the art-pass details (19 Nov): everything below
  // draws from rng2, so the main stream — and the city layout it
  // already fixed — never shifts when details are added or tuned.
  var rng2 = mulberry32(20261118);
  function rr2(min, max) { return min + rng2() * (max - min); }
  function pick2(arr) { return arr[Math.floor(rng2() * arr.length)]; }

  // Sidewalk-corner palm spots: 22.5 units from the block centre keeps
  // the trunk on the sidewalk band — the road edge is at 24, the widest
  // building face reaches 21 — so no palm ever stands on asphalt or
  // inside a building (the old +/-14 scatter could do both).
  // sx/sz: the corner sign; the buildings lie toward (-sx, -sz).
  function sidewalkCorner(bx, bz) {
    var sx = rng() < 0.5 ? -1 : 1;
    var sz = rng() < 0.5 ? -1 : 1;
    return { x: bx + sx * 22.5 + rr(-1, 1), z: bz + sz * 22.5 + rr(-1, 1), sx: sx, sz: sz };
  }

  // ---------- facade textures ----------
  // Returns {map, emissive}: the map is the lit facade; the emissive
  // canvas is black except the lit windows, so at night only the
  // windows glow (emissiveIntensity is driven by nightness — see
  // VR.Buildings.setNightness). Without this the towers read as flat
  // black slabs after dark.
  function facadeTexture(base, litRatio) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');
    var ev = document.createElement('canvas');
    ev.width = 256; ev.height = 256;
    var ectx = ev.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, 256, 256);
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 5; c++) {
        var lit = rng() < litRatio;
        ctx.fillStyle = lit ? '#ffd27a' : '#46687a';
        ctx.fillRect(18 + c * 48, 16 + r * 30, 28, 20);
        if (lit) {
          ectx.fillStyle = '#ffd27a';
          ectx.fillRect(18 + c * 48, 16 + r * 30, 28, 20);
        }
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    var etex = new THREE.CanvasTexture(ev);
    etex.anisotropy = 4;
    etex.colorSpace = THREE.SRGBColorSpace;
    return { map: tex, emissive: etex };
  }

  var _pastel = facadeTexture('#e8dcc8', 0.3);
  var pastelTex = _pastel.map, pastelEmissive = _pastel.emissive;
  // Glass towers: bright teal-blue; windows lighter so the facade never
  // goes black (no env map in this scene, so metalness stays near zero).
  var _glass = facadeTexture('#57b8d4', 0.55);
  var glassTex = _glass.map, glassEmissive = _glass.emissive;

  // ---------- placement ----------
  var lowrise = [];   // {x,z,w,d,h,color,blk,district}
  var towers = [];
  var containers = [];
  var warehouses = [];
  var tents = [];     // {x,z,ry,color}
  var palms = [];     // {x,z,lean,scale,ix,iz} — ix/iz: inward (building) unit dir
  var lamps = [];     // {x,z,dbl}

  var BLOCKS = [-180, -120, -60, 0, 60, 120, 180];
  var PASTEL = [P.terracotta, P.sandCream, P.mint, P.teal, 0xd9a441, 0xe07856];
  var CONTAINER_COLORS = [P.containerRed, P.containerBlue, P.containerGreen,
    P.containerYellow, P.containerOrange];

  var bi, bj, bx, bz, district, k, i, j, pc;
  for (bi = 0; bi < BLOCKS.length; bi++) {
    for (bj = 0; bj < BLOCKS.length; bj++) {
      bx = BLOCKS[bi]; bz = BLOCKS[bj];
      district = VR.World.districtAt(bx, bz);
      if (district === 'Golden Pier') {
        // Low beachfront buildings + palms.
        for (k = 0; k < 2; k++) {
          lowrise.push({
            x: bx + rr(-12, 12), z: bz + rr(-12, 12),
            w: rr(12, 18), d: rr(12, 18), h: rr(8, 16),
            color: pick(PASTEL), blk: bi * 7 + bj, district: district
          });
        }
        if (rng() < 0.7) {
          pc = sidewalkCorner(bx, bz);
          palms.push({ x: pc.x, z: pc.z, lean: rr(-0.12, 0.12), scale: rr(0.9, 1.2), ix: -pc.sx, iz: -pc.sz });
        }
      } else if (district === 'Pasar Lentera') {
        // Shophouses + lantern tents.
        for (k = 0; k < 3; k++) {
          lowrise.push({
            x: bx + rr(-13, 13), z: bz + rr(-13, 13),
            w: rr(10, 15), d: rr(10, 15), h: rr(8, 14),
            color: pick(PASTEL), blk: bi * 7 + bj, district: district
          });
        }
        for (k = 0; k < 2; k++) {
          tents.push({
            x: bx + rr(-14, 14), z: bz + rr(-14, 14),
            ry: rr(0, Math.PI), color: pick([0xff4d4d, 0xffd23f, 0xff8c42, 0x37e0ff])
          });
        }
        if (rng() < 0.4) {
          pc = sidewalkCorner(bx, bz);
          palms.push({ x: pc.x, z: pc.z, lean: rr(-0.1, 0.1), scale: rr(0.8, 1.1), ix: -pc.sx, iz: -pc.sz });
        }
      } else if (district === 'Highrise Plaza') {
        // One glass tower per block (some blocks stay open plaza).
        if (rng() < 0.85) {
          towers.push({
            x: bx + rr(-8, 8), z: bz + rr(-8, 8),
            w: rr(18, 26), d: rr(18, 26), h: rr(35, 85),
            color: pick([0x3fa7c4, 0x2e8b8b, 0x5fb8d4, 0x7fc8d4])
          });
        }
        if (rng() < 0.35) {
          pc = sidewalkCorner(bx, bz);
          palms.push({ x: pc.x, z: pc.z, lean: rr(-0.08, 0.08), scale: rr(0.8, 1.0), ix: -pc.sx, iz: -pc.sz });
        }
      } else { // Industrial Dockyard
        warehouses.push({
          x: bx + rr(-6, 6), z: bz + rr(-6, 6),
          w: rr(24, 30), d: rr(16, 22), h: rr(9, 13),
          color: pick([0x8a8f98, 0x9a7b4f, 0x6b7c8a])
        });
        var stacks = 2 + Math.floor(rng() * 3);
        for (k = 0; k < stacks; k++) {
          var cx = bx + rr(-16, 16), cz = bz + rr(-16, 16);
          var levels = 1 + Math.floor(rng() * 3);
          for (var lv = 0; lv < levels; lv++) {
            containers.push({
              x: cx, z: cz, y: lv * 2.7,
              w: 6.1, d: 2.6, h: 2.6,
              ry: (rng() < 0.5 ? 0 : Math.PI / 2),
              color: pick(CONTAINER_COLORS)
            });
          }
        }
      }
    }
  }

  // Boardwalk palms: a proud row along the coast, big and visible.
  // Buildings lie east (+x), so the frond fan's inward side is +x.
  for (var pz = -210; pz <= 210; pz += 30) {
    palms.push({ x: -222, z: pz + rr(-6, 6), lean: rr(-0.1, 0.1), scale: rr(1.1, 1.4), ix: 1, iz: 0 });
  }
  // A second row on the boulevard sidewalk (road edge is at -199, so
  // -197.5 keeps the trunk fully on the sidewalk, never on asphalt).
  for (pz = -195; pz <= 195; pz += 60) {
    palms.push({ x: -197.5, z: pz + rr(-8, 8), lean: rr(-0.1, 0.1), scale: rr(1.0, 1.25), ix: 1, iz: 0 });
  }

  // Street lamps at intersection corners; every 4th is a double-arm
  // lamp (built as its own group below, not in the instanced mesh).
  var STREETS = [-210, -150, -90, -30, 30, 90, 150, 210];
  for (i = 0; i < STREETS.length; i++) {
    for (j = 0; j < STREETS.length; j++) {
      if ((i + j) % 2 === 0) {
        lamps.push({ x: STREETS[i] + 8, z: STREETS[j] + 8, dbl: ((i * 8 + j) % 4 === 0) });
      }
    }
  }

  // ---------- art-pass details (19 Nov, scope 19:57) ----------
  // Every list below derives from the placed lists above + rng2, so
  // the base city never moves when details are added or tuned.

  // Per-block pastel dominance: within each block, 70% of the
  // shophouses take the block's most common pastel, the rest keep
  // their own — one hue per block, still varied.
  var _blkCount = {}, _blkBest = {}, _li, _b, _k, _c;
  for (_li = 0; _li < lowrise.length; _li++) {
    _b = lowrise[_li];
    if (!_blkCount[_b.blk]) _blkCount[_b.blk] = {};
    _blkCount[_b.blk][_b.color] = (_blkCount[_b.blk][_b.color] || 0) + 1;
  }
  for (_k in _blkCount) {
    var _best = 0, _bestColor = 0;
    for (_c in _blkCount[_k]) {
      if (_blkCount[_k][_c] > _best) { _best = _blkCount[_k][_c]; _bestColor = +_c; }
    }
    _blkBest[_k] = _bestColor;
  }
  for (_li = 0; _li < lowrise.length; _li++) {
    _b = lowrise[_li];
    if (rng2() < 0.7) _b.color = _blkBest[_b.blk];
  }

  // Tower crowns (tapered step, reads as a skyscraper silhouette) +
  // antennas, and pyramid roofs on the dockyard warehouses.
  var crowns = [];   // {x,z,y,w,h,d,color} — built by buildBoxes
  var antennas = []; // {x,z,y}
  var roofs = [];    // {x,z,y,w,d} — pyramid, base sits at y
  var _ti;
  for (_ti = 0; _ti < towers.length; _ti++) {
    var _tw = towers[_ti];
    var _ch = 4 + _tw.h * 0.16;
    crowns.push({ x: _tw.x, z: _tw.z, y: _tw.h, w: _tw.w * 0.55, h: _ch, d: _tw.d * 0.55, color: _tw.color });
    if (rng2() < 0.45) antennas.push({ x: _tw.x, z: _tw.z, y: _tw.h + _ch });
  }
  var _wi;
  for (_wi = 0; _wi < warehouses.length; _wi++) {
    var _wh = warehouses[_wi];
    roofs.push({ x: _wh.x, z: _wh.z, y: _wh.h, w: _wh.w, d: _wh.d });
  }

  // Street-facing side of a lowrise/tower: the face toward the nearest
  // street (streets sit at 30 + 60k). Returns ry (facing), fx/fz (the
  // outward normal), hw (half-extent outward), aw (half-width along
  // the face).
  function nearestStreet(v) { return 30 + 60 * Math.round((v - 30) / 60); }
  function streetFace(b) {
    var nx = nearestStreet(b.x), nz = nearestStreet(b.z);
    var dx = Math.abs(nx - b.x), dz = Math.abs(nz - b.z);
    if (dx <= dz) {
      var s = nx >= b.x ? 1 : -1;
      return { ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, fx: s, fz: 0, hw: b.w / 2, aw: b.d / 2 };
    }
    var s2 = nz >= b.z ? 1 : -1;
    return { ry: s2 > 0 ? 0 : Math.PI, fx: 0, fz: s2, hw: b.d / 2, aw: b.w / 2 };
  }

  // Balconies + rails + sloped canopies on commercial shophouses,
  // AC units, vertical pipes, lit glass bands on towers, fire escapes.
  // Prop entries: {x,y,z,ry,w,h,d,color?} — centred boxes, built by
  // buildProps below (no colliders: they sit on walls / above heads).
  var balconies = [], rails = [], canopies = [], acUnits = [];
  var pipes = [], glassBands = [], escapes = [];
  var AWNINGS = [0xe07856, 0x37e0ff, 0xffd23f, 0xff4d4d];
  var _li2;
  for (_li2 = 0; _li2 < lowrise.length; _li2++) {
    var _lb = lowrise[_li2];
    var _f = streetFace(_lb);
    var _bw = Math.min(3.4, _f.aw * 2 - 1.2);
    if (_bw > 1.2 && (_lb.district === 'Pasar Lentera' || _lb.district === 'Golden Pier') && rng2() < 0.85) {
      var _bx = _lb.x + _f.fx * (_f.hw + 0.55);
      var _bz = _lb.z + _f.fz * (_f.hw + 0.55);
      balconies.push({ x: _bx, y: 4.6, z: _bz, ry: _f.ry, w: _bw, h: 0.25, d: 1.1, color: _lb.color });
      rails.push({ x: _bx + _f.fx * 0.5, y: 5.15, z: _bz + _f.fz * 0.5, ry: _f.ry, w: _bw, h: 0.7, d: 0.08 });
      canopies.push({ x: _lb.x + _f.fx * (_f.hw + 1.0), y: 3.1, z: _lb.z + _f.fz * (_f.hw + 1.0), ry: _f.ry, w: _bw + 0.8, h: 0.12, d: 2.2, color: pick2(AWNINGS) });
    }
    if (rng2() < 0.6) {
      var _off = rr2(-_f.aw + 1.0, _f.aw - 1.0);
      acUnits.push({
        x: _lb.x + _f.fx * (_f.hw + 0.3) + (_f.fx === 0 ? _off : 0),
        y: rr2(2.5, 6.5),
        z: _lb.z + _f.fz * (_f.hw + 0.3) + (_f.fz === 0 ? _off : 0),
        ry: _f.ry, w: 0.9, h: 0.6, d: 0.45
      });
    }
    if (rng2() < 0.7) {
      pipes.push({
        x: _lb.x + (rng2() < 0.5 ? -1 : 1) * (_lb.w / 2 + 0.12),
        z: _lb.z + (rng2() < 0.5 ? -1 : 1) * (_lb.d / 2 + 0.12),
        h: _lb.h
      });
    }
  }
  for (_ti = 0; _ti < towers.length; _ti++) {
    var _tw2 = towers[_ti];
    if (rng2() < 0.85) {
      glassBands.push({ x: _tw2.x, y: _tw2.h * rr2(0.35, 0.75), z: _tw2.z, w: _tw2.w + 0.25, h: 0.7, d: _tw2.d + 0.25 });
    }
    if (rng2() < 0.35) {
      var _ef = streetFace(_tw2);
      var _ew = Math.min(3.0, _ef.aw * 2 - 1);
      for (var _fl = 0; _fl < 3; _fl++) {
        var _fy = 3.5 + _fl * 3.2;
        var _fo = (_fl % 2 === 0 ? 0.55 : 1.15);
        escapes.push({ x: _tw2.x + _ef.fx * (_ef.hw + _fo), y: _fy, z: _tw2.z + _ef.fz * (_ef.hw + _fo), ry: _ef.ry, w: _ew, h: 0.18, d: 1.0 });
      }
      // Two posts hold the stack up.
      escapes.push({ x: _tw2.x + _ef.fx * (_ef.hw + 1.0) + (_ef.fx === 0 ? _ew / 2 - 0.1 : 0), y: 6.7, z: _tw2.z + _ef.fz * (_ef.hw + 1.0) + (_ef.fz === 0 ? _ew / 2 - 0.1 : 0), ry: _ef.ry, w: 0.1, h: 7.4, d: 0.1 });
      escapes.push({ x: _tw2.x + _ef.fx * (_ef.hw + 1.0) - (_ef.fx === 0 ? _ew / 2 - 0.1 : 0), y: 6.7, z: _tw2.z + _ef.fz * (_ef.hw + 1.0) - (_ef.fz === 0 ? _ew / 2 - 0.1 : 0), ry: _ef.ry, w: 0.1, h: 7.4, d: 0.1 });
    }
  }

  // Billboards: {x, baseY, z, ry, text, fg, planeY, poleH}.
  // Rooftop ones sit on real buildings (first shophouse in the market,
  // first tower); the roadside one stands on the boulevard sidewalk.
  var billboards = [];
  var _bb;
  for (_bb = 0; _bb < lowrise.length; _bb++) {
    if (lowrise[_bb].district === 'Pasar Lentera') {
      billboards.push({ x: lowrise[_bb].x, baseY: lowrise[_bb].h, z: lowrise[_bb].z, ry: streetFace(lowrise[_bb]).ry, text: 'VANDARA COLA', fg: '#37e0ff', planeY: 4.5, poleH: 1.5 });
      break;
    }
  }
  billboards.push({ x: -197.5, baseY: 0, z: 120, ry: -Math.PI / 2, text: 'SHARK ENERGY', fg: '#ff4da6', planeY: 8, poleH: 5 });
  if (towers.length) {
    var _bt = towers[0];
    var _bch = 4 + _bt.h * 0.16;
    billboards.push({ x: _bt.x, baseY: _bt.h + _bch, z: _bt.z, ry: streetFace(_bt).ry, text: 'BAYVIEW MOTORS', fg: '#ffd23f', planeY: 4.5, poleH: 1.5 });
  }

  // Traffic signs, mid-block on sidewalks (clear of corner palms):
  // {x, z, ry, lines, accent}. ry faces the street.
  var SIGNS = [
    { x: -82, z: 0, ry: -Math.PI / 2, lines: ['GOLDEN PIER', 'THIS WAY'], accent: '#2e8b8b' },
    { x: 22, z: -60, ry: Math.PI / 2, lines: ['SPEED', '40'], accent: '#c0392b' },
    { x: -142, z: 120, ry: -Math.PI / 2, lines: ['PASAR LENTERA', 'AHEAD'], accent: '#c96f4a' },
    { x: 158, z: -120, ry: -Math.PI / 2, lines: ['DOCKYARD', 'NEXT RIGHT'], accent: '#c96f4a' },
    { x: 38, z: 180, ry: -Math.PI / 2, lines: ['HIGHRISE', 'PLAZA'], accent: '#2e8b8b' },
    { x: 98, z: -180, ry: -Math.PI / 2, lines: ['SPEED', '40'], accent: '#c0392b' }
  ];

  // Utility boxes + trash bins, mid-block on sidewalks (x = street
  // +/- 8, z = block centre +/- 14 — clear of corner palms, lamps
  // and signs by construction).
  var eboxes = [], bins = [];
  var _eb;
  for (_eb = 0; _eb < 16; _eb++) {
    var _es = pick2(STREETS);
    eboxes.push({
      x: _es + (rng2() < 0.5 ? -8 : 8),
      z: 60 * Math.round(rr2(-180, 180) / 60) + rr2(-14, 14)
    });
  }
  for (_eb = 0; _eb < 20; _eb++) {
    var _bs = pick2(STREETS);
    bins.push({
      x: _bs + (rng2() < 0.5 ? -8 : 8),
      z: 60 * Math.round(rr2(-180, 180) / 60) + rr2(-14, 14)
    });
  }

  // ---------- instanced builders ----------
  var dummy = new THREE.Object3D();
  var _col = new THREE.Color();

  function buildBoxes(list, material, withY) {
    if (!list.length) return;
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // base sits on y = 0
    var mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      dummy.position.set(b.x, withY ? (b.y || 0) : 0, b.z);
      dummy.rotation.set(0, b.ry || 0, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, _col.setHex(b.color));
      VR.World.registerBlocker(b.x, b.z, Math.max(b.w, b.d) / 2 + 0.4, Math.max(b.w, b.d) / 2 + 0.4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  var stdMat = function (opts) {
    opts.flatShading = true;
    return new THREE.MeshStandardMaterial(opts);
  };

  // Generic instanced props: centred boxes, per-instance position /
  // yaw / scale / optional colour. No colliders — these sit on walls
  // or above head height. geo may be a pre-shaped geometry (canopies).
  var _unitBox = new THREE.BoxGeometry(1, 1, 1);
  function buildProps(list, geo, material, withColor) {
    if (!list.length) return;
    var mesh = new THREE.InstancedMesh(geo || _unitBox, material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.ry || 0, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (withColor && b.color !== undefined) mesh.setColorAt(i, _col.setHex(b.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // Facade materials (named: their emissiveIntensity is driven by
  // nightness via VR.Buildings.setNightness so windows glow at night).
  var lowriseMat = stdMat({ map: pastelTex, emissiveMap: pastelEmissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85, metalness: 0 });
  var glassMat = stdMat({ map: glassTex, emissiveMap: glassEmissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4, metalness: 0.05 });
  buildBoxes(lowrise, lowriseMat);
  buildBoxes(towers, glassMat);
  buildBoxes(warehouses, stdMat({ roughness: 0.9, metalness: 0.05 }));
  buildBoxes(containers, stdMat({ roughness: 0.7, metalness: 0.15 }), true);

  // ---------- art-pass detail builds ----------
  var _propGrey = stdMat({ color: 0xb8bec6, roughness: 0.7, metalness: 0.3 });
  var _propDark = stdMat({ color: 0x2c313a, roughness: 0.7, metalness: 0.4 });
  buildBoxes(crowns, glassMat, true);
  if (roofs.length) {
    var _roofGeo = new THREE.ConeGeometry(1, 1, 4);
    _roofGeo.rotateY(Math.PI / 4);
    _roofGeo.translate(0, 0.5, 0); // base sits on the warehouse top
    var _roofMesh = new THREE.InstancedMesh(_roofGeo,
      stdMat({ color: 0x5a4632, roughness: 0.9, metalness: 0 }), roofs.length);
    _roofMesh.castShadow = true;
    for (var _ri = 0; _ri < roofs.length; _ri++) {
      var _rf = roofs[_ri];
      dummy.position.set(_rf.x, _rf.y, _rf.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(_rf.w * 0.72, 3.2, _rf.d * 0.72);
      dummy.updateMatrix();
      _roofMesh.setMatrixAt(_ri, dummy.matrix);
    }
    _roofMesh.instanceMatrix.needsUpdate = true;
    scene.add(_roofMesh);
  }
  if (antennas.length) {
    var _antGeo = new THREE.CylinderGeometry(0.1, 0.16, 8, 5);
    _antGeo.translate(0, 4, 0);
    var _antMesh = new THREE.InstancedMesh(_antGeo, _propDark, antennas.length);
    for (var _ai = 0; _ai < antennas.length; _ai++) {
      dummy.position.set(antennas[_ai].x, antennas[_ai].y, antennas[_ai].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      _antMesh.setMatrixAt(_ai, dummy.matrix);
    }
    _antMesh.instanceMatrix.needsUpdate = true;
    scene.add(_antMesh);
  }
  if (pipes.length) {
    var _pipeGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 5);
    _pipeGeo.translate(0, 0.5, 0);
    var _pipeMesh = new THREE.InstancedMesh(_pipeGeo, _propDark, pipes.length);
    for (var _pi2 = 0; _pi2 < pipes.length; _pi2++) {
      dummy.position.set(pipes[_pi2].x, 0, pipes[_pi2].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, pipes[_pi2].h, 1);
      dummy.updateMatrix();
      _pipeMesh.setMatrixAt(_pi2, dummy.matrix);
    }
    _pipeMesh.instanceMatrix.needsUpdate = true;
    scene.add(_pipeMesh);
  }
  buildProps(balconies, null, stdMat({ roughness: 0.85, metalness: 0 }), true);
  buildProps(rails, null, _propDark, false);
  // Canopy geometry is pre-sloped (outward edge droops) so the
  // instance needs only its yaw — no Euler-order trap.
  var _canopyGeo = new THREE.BoxGeometry(1, 1, 1);
  _canopyGeo.rotateX(0.45);
  buildProps(canopies, _canopyGeo, stdMat({ roughness: 0.85, metalness: 0 }), true);
  buildProps(acUnits, null, _propGrey, false);
  buildProps(escapes, null, _propDark, false);
  buildProps(glassBands, null,
    new THREE.MeshStandardMaterial({ color: 0x7fc8d4, roughness: 0.15, metalness: 0.1, emissive: 0x2a6a7a, emissiveIntensity: 0.55, flatShading: true }),
    false);
  // Utility boxes + bins (ground props — small colliders so nobody
  // walks through them).
  if (eboxes.length) {
    var _ebGeo = new THREE.BoxGeometry(0.9, 1.2, 0.5);
    _ebGeo.translate(0, 0.6, 0);
    var _ebMesh = new THREE.InstancedMesh(_ebGeo, stdMat({ color: 0x5a6b52, roughness: 0.9, metalness: 0.1 }), eboxes.length);
    _ebMesh.castShadow = true;
    for (var _ei = 0; _ei < eboxes.length; _ei++) {
      dummy.position.set(eboxes[_ei].x, 0, eboxes[_ei].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      _ebMesh.setMatrixAt(_ei, dummy.matrix);
      VR.World.registerCircle(eboxes[_ei].x, eboxes[_ei].z, 0.6);
    }
    _ebMesh.instanceMatrix.needsUpdate = true;
    scene.add(_ebMesh);
  }
  if (bins.length) {
    var _binGeo = new THREE.CylinderGeometry(0.35, 0.3, 0.9, 8);
    _binGeo.translate(0, 0.45, 0);
    var _binMesh = new THREE.InstancedMesh(_binGeo, stdMat({ color: 0x2e4a3a, roughness: 0.9, metalness: 0.1 }), bins.length);
    _binMesh.castShadow = true;
    for (var _bi2 = 0; _bi2 < bins.length; _bi2++) {
      dummy.position.set(bins[_bi2].x, 0, bins[_bi2].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      _binMesh.setMatrixAt(_bi2, dummy.matrix);
      VR.World.registerCircle(bins[_bi2].x, bins[_bi2].z, 0.45);
    }
    _binMesh.instanceMatrix.needsUpdate = true;
    scene.add(_binMesh);
  }

  // ---------- billboards (neon fictional brands) + traffic signs ----------
  function billboardTexture(text, fg) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#101828';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = fg; ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 492, 236);
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = fg; ctx.shadowBlur = 28;
    ctx.fillStyle = fg;
    ctx.fillText(text, 256, 118);
    ctx.shadowBlur = 0;
    ctx.fillRect(156, 172, 200, 10);
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  var _bbFrameMat = stdMat({ color: 0x3a4048, roughness: 0.5, metalness: 0.7 });
  var _bbPoleMat = stdMat({ color: 0x2c313a, roughness: 0.6, metalness: 0.6 });
  function _fbox(g, w, h, d, px, py, pz) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _bbFrameMat);
    m.position.set(px, py, pz);
    g.add(m);
  }
  for (var _bbi = 0; _bbi < billboards.length; _bbi++) {
    var _bbd = billboards[_bbi];
    var _bg = new THREE.Group();
    // Two planes back-to-back so the brand reads correctly from BOTH
    // sides (a single DoubleSide plane shows mirrored text from behind).
    var _bbTex = billboardTexture(_bbd.text, _bbd.fg);
    var _face = new THREE.Mesh(new THREE.PlaneGeometry(12, 6),
      new THREE.MeshBasicMaterial({ map: _bbTex, toneMapped: false }));
    _face.position.set(0, _bbd.planeY, 0.02);
    _bg.add(_face);
    var _faceBack = new THREE.Mesh(new THREE.PlaneGeometry(12, 6),
      new THREE.MeshBasicMaterial({ map: _bbTex, toneMapped: false }));
    _faceBack.position.set(0, _bbd.planeY, -0.02);
    _faceBack.rotation.y = Math.PI;
    _bg.add(_faceBack);
    _fbox(_bg, 12.4, 0.35, 0.3, 0, _bbd.planeY + 3.1, 0);
    _fbox(_bg, 12.4, 0.35, 0.3, 0, _bbd.planeY - 3.1, 0);
    _fbox(_bg, 0.35, 6.4, 0.3, -6.1, _bbd.planeY, 0);
    _fbox(_bg, 0.35, 6.4, 0.3, 6.1, _bbd.planeY, 0);
    var _p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, _bbd.poleH, 6), _bbPoleMat);
    _p1.position.set(-4, _bbd.planeY - 3 - _bbd.poleH / 2, 0);
    _p1.castShadow = true;
    _bg.add(_p1);
    var _p2 = _p1.clone();
    _p2.position.x = 4;
    _bg.add(_p2);
    _bg.position.set(_bbd.x, _bbd.baseY, _bbd.z);
    _bg.rotation.y = _bbd.ry;
    scene.add(_bg);
    if (_bbd.baseY === 0) VR.World.registerBlocker(_bbd.x, _bbd.z, 1.5, 5.5);
  }
  function signTexture(lines, accent) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 160;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = accent; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 150);
    ctx.fillStyle = '#1c2430'; ctx.font = 'bold 34px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], 128, 80 + (li - (lines.length - 1) / 2) * 40);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  var _signPoleMat = stdMat({ color: 0x6b7280, roughness: 0.5, metalness: 0.6 });
  for (var _si = 0; _si < SIGNS.length; _si++) {
    var _sg = SIGNS[_si];
    var _spole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), _signPoleMat);
    _spole.position.set(_sg.x, 1.7, _sg.z);
    _spole.castShadow = true;
    scene.add(_spole);
    var _panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshStandardMaterial({ map: signTexture(_sg.lines, _sg.accent), roughness: 0.6, metalness: 0, side: THREE.DoubleSide }));
    _panel.position.set(_sg.x, 3.3, _sg.z);
    _panel.rotation.y = _sg.ry;
    _panel.castShadow = true;
    scene.add(_panel);
    VR.World.registerCircle(_sg.x, _sg.z, 0.3);
  }

  // ---------- lantern tents (stall + pyramid roof + glowing lantern) ----------
  if (tents.length) {
    var stallGeo = new THREE.BoxGeometry(4, 2.2, 3);
    stallGeo.translate(0, 1.1, 0);
    var stallMesh = new THREE.InstancedMesh(stallGeo,
      stdMat({ roughness: 0.9, metalness: 0 }), tents.length);
    var roofGeo = new THREE.ConeGeometry(3.4, 1.8, 4);
    roofGeo.rotateY(Math.PI / 4);
    var roofMesh = new THREE.InstancedMesh(roofGeo,
      stdMat({ roughness: 0.85, metalness: 0 }), tents.length);
    stallMesh.castShadow = true; roofMesh.castShadow = true;
    for (var ti = 0; ti < tents.length; ti++) {
      var t = tents[ti];
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      stallMesh.setMatrixAt(ti, dummy.matrix);
      stallMesh.setColorAt(ti, _col.setHex(t.color));
      dummy.position.set(t.x, 2.2, t.z);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(ti, dummy.matrix);
      roofMesh.setColorAt(ti, _col.setHex(0xf2e6c8));
      var lantern = VR.World.makeGlowSprite(0xff8c42, 7);
      lantern.position.set(t.x, 2.6, t.z);
      scene.add(lantern);
      if (VR.World.registerGlow) VR.World.registerGlow(lantern, 0.55, 1.0);
      VR.World.registerBlocker(t.x, t.z, 2.4, 2.0);
    }
    stallMesh.instanceMatrix.needsUpdate = true;
    roofMesh.instanceMatrix.needsUpdate = true;
    if (stallMesh.instanceColor) stallMesh.instanceColor.needsUpdate = true;
    if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
    scene.add(stallMesh);
    scene.add(roofMesh);
  }

  // ---------- palms: instanced trunks (curved, 3 segments) + fronds ----------
  // Trunk: THREE stacked segments with a progressive natural curve —
  // the old two-segment trunk (<=7 deg lean) still read as a straight
  // pole. Each palm bends 13-20 deg AWAY from the nearest building
  // (toward street/sea), so the silhouette is a leaning tropical
  // palm, never a lamppost. Segment radii match at the joints.
  var palmCount = palms.length;
  function hash01(n) {
    var h = (n * 374761393 + 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  var TRUNK_LEN = [3.2, 2.8, 2.4]; // geometry lengths (0.2 overlap)
  var TRUNK_ADV = [3.0, 2.6, 2.4]; // advance between segment bases
  var TRUNK_TILT = [0.35, 0.7, 1.0]; // progressive fraction of the bend
  var TRUNK_RAD = [[0.34, 0.5], [0.30, 0.34], [0.26, 0.30]]; // [top, bottom]
  var trunkMat = stdMat({ color: P.palmTrunk, roughness: 1, metalness: 0 });
  var trunkMeshes = [];
  for (var _ti = 0; _ti < 3; _ti++) {
    var _tg = new THREE.CylinderGeometry(TRUNK_RAD[_ti][0], TRUNK_RAD[_ti][1], TRUNK_LEN[_ti], 6);
    _tg.translate(0, TRUNK_LEN[_ti] / 2, 0);
    var _tm = new THREE.InstancedMesh(_tg, trunkMat, palmCount);
    _tm.castShadow = true;
    trunkMeshes.push(_tm);
  }
  // Fronds: TWO-SEGMENT curved blades (art pass 19:59) — the old
  // single straight cone read as punk-hair spikes. Each blade is a
  // short base rising ~29 deg, then a longer tip drooping to ~-58 deg,
  // so the crown reads as a tropical umbrella from afar. Base and tip
  // are tapered flattened cylinders, joined end to end.
  var frondBaseGeo = new THREE.CylinderGeometry(0.26, 0.6, 2.2, 4);
  frondBaseGeo.translate(0, 1.1, 0);
  frondBaseGeo.scale(1, 1, 0.28);
  var frondTipGeo = new THREE.CylinderGeometry(0.05, 0.3, 2.6, 4);
  frondTipGeo.translate(0, 1.3, 0);
  frondTipGeo.scale(1, 1, 0.28);
  var FRONDS = 8;
  var frondBaseMesh = new THREE.InstancedMesh(frondBaseGeo,
    stdMat({ color: P.palmLeaf, roughness: 0.9, metalness: 0 }),
    palmCount * FRONDS);
  var frondTipMesh = new THREE.InstancedMesh(frondTipGeo,
    stdMat({ color: P.palmLeaf, roughness: 0.9, metalness: 0 }),
    palmCount * FRONDS);
  frondBaseMesh.castShadow = true;
  frondTipMesh.castShadow = true;
  // Coconuts: small spheres under the crown.
  var nutGeo = new THREE.SphereGeometry(0.32, 6, 5);
  var nutMesh = new THREE.InstancedMesh(nutGeo,
    stdMat({ color: 0x6b4a2a, roughness: 1, metalness: 0 }), palmCount * 3);

  var _bendAxis = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _e = new THREE.Euler();
  var _v = new THREE.Vector3();
  var _s = new THREE.Vector3();
  var _m = new THREE.Matrix4();
  var fi = 0, ni = 0;
  // Shared frond orientations (constant): base rises ~29 deg, tip
  // droops to ~-58 deg. yawQ is built per blade (it carries the yaw).
  var Y_AXIS = new THREE.Vector3(0, 1, 0);
  var X_AXIS = new THREE.Vector3(1, 0, 0);
  var tiltBase = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2 + 0.5);
  var tiltTip = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2 - 1.0);
  for (var pi = 0; pi < palmCount; pi++) {
    var p = palms[pi];
    // Three trunk segments, progressive bend away from the building.
    var bendBase = Math.atan2(-(p.ix || 0), -(p.iz || 0));
    if ((p.ix || 0) === 0 && (p.iz || 0) === 0) bendBase = hash01(pi * 2 + 1) * Math.PI * 2;
    var bendDir = bendBase + (hash01(pi * 2 + 3) - 0.5) * 1.2;
    var bendMag = 0.22 + hash01(pi * 2 + 2) * 0.13; // 13-20 deg total
    var bdx = Math.sin(bendDir), bdz = Math.cos(bendDir);
    _bendAxis.set(Math.cos(bendDir), 0, -Math.sin(bendDir));
    var bx = p.x, by = 0, bz = p.z;
    for (var si = 0; si < 3; si++) {
      var tilt = bendMag * TRUNK_TILT[si];
      _q.setFromAxisAngle(_bendAxis, tilt);
      _v.set(bx, by, bz); _s.set(p.scale, p.scale, p.scale);
      _m.compose(_v, _q, _s);
      trunkMeshes[si].setMatrixAt(pi, _m);
      var adv = TRUNK_ADV[si] * p.scale;
      bx += bdx * Math.sin(tilt) * adv;
      by += Math.cos(tilt) * adv;
      bz += bdz * Math.sin(tilt) * adv;
    }
    // Crown position (top of the leaning trunk).
    var crownX = bx;
    var crownY = by + 0.6 * p.scale;
    var crownZ = bz;
    // Frond fan: no blade aims straight at the building — the fan is
    // offset half a step (22.5 deg) from the inward diagonal, so the
    // drooping tips never sink into a facade.
    var inward = Math.atan2(-(p.ix || 0), -(p.iz || 0));
    for (var f = 0; f < FRONDS; f++) {
      var yaw = inward + (f + 0.5) * (Math.PI * 2 / FRONDS);
      var sy = Math.sin(yaw), cy = Math.cos(yaw);
      var yawQ = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
      // Base segment: rises ~29 deg from the crown.
      _q.copy(yawQ).multiply(tiltBase);
      _v.set(crownX, crownY, crownZ);
      _s.set(p.scale, p.scale, p.scale);
      _m.compose(_v, _q, _s);
      frondBaseMesh.setMatrixAt(fi, _m);
      // Tip segment: starts where the base ends, droops to ~-58 deg —
      // the blade arcs over like a tropical umbrella, not a spike.
      // Base axis is (0, 0.479, -0.878) before yaw; its tip sits 2.2
      // units out along it.
      var tipX = crownX - 0.878 * sy * 2.2 * p.scale;
      var tipY = crownY + 0.479 * 2.2 * p.scale;
      var tipZ = crownZ - 0.878 * cy * 2.2 * p.scale;
      _q.copy(yawQ).multiply(tiltTip);
      _v.set(tipX, tipY, tipZ);
      _m.compose(_v, _q, _s);
      frondTipMesh.setMatrixAt(fi, _m);
      fi++;
    }
    for (var cn = 0; cn < 3; cn++) {
      var a = cn * 2.1;
      _v.set(crownX + Math.cos(a) * 0.5, crownY - 0.4, crownZ + Math.sin(a) * 0.5);
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_v, _q, _s);
      nutMesh.setMatrixAt(ni++, _m);
    }
    VR.World.registerCircle(p.x, p.z, 0.8);
  }
  for (var _ti2 = 0; _ti2 < 3; _ti2++) {
    trunkMeshes[_ti2].instanceMatrix.needsUpdate = true;
    scene.add(trunkMeshes[_ti2]);
  }
  frondBaseMesh.instanceMatrix.needsUpdate = true;
  frondTipMesh.instanceMatrix.needsUpdate = true;
  nutMesh.instanceMatrix.needsUpdate = true;
  scene.add(frondBaseMesh);
  scene.add(frondTipMesh);
  scene.add(nutMesh);

  // ---------- street lamps (pole + warm glow) ----------
  // Single-arm lamps stay instanced; double-arm lamps (every 4th) get
  // their own group: taller pole, two arms, a glow at each end.
  var singleLamps = lamps.filter(function (L) { return !L.dbl; });
  var doubleLamps = lamps.filter(function (L) { return !!L.dbl; });
  if (singleLamps.length) {
    var poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6);
    poleGeo.translate(0, 2.6, 0);
    var poleMesh = new THREE.InstancedMesh(poleGeo,
      stdMat({ color: 0x2c313a, roughness: 0.6, metalness: 0.6 }), singleLamps.length);
    for (var li = 0; li < singleLamps.length; li++) {
      var L = singleLamps[li];
      dummy.position.set(L.x, 0, L.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(li, dummy.matrix);
      var glow = VR.World.makeGlowSprite(0xffc46b, 6);
      glow.position.set(L.x, 5.3, L.z);
      scene.add(glow);
      if (VR.World.registerGlow) VR.World.registerGlow(glow, 0.45, 1.0);
      VR.World.registerCircle(L.x, L.z, 0.3);
    }
    poleMesh.instanceMatrix.needsUpdate = true;
    scene.add(poleMesh);
  }
  var _dblPoleMat = stdMat({ color: 0x2c313a, roughness: 0.6, metalness: 0.6 });
  for (var di = 0; di < doubleLamps.length; di++) {
    var D = doubleLamps[di];
    var dg = new THREE.Group();
    var dpole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 6.2, 6), _dblPoleMat);
    dpole.position.set(0, 3.1, 0);
    dpole.castShadow = true;
    dg.add(dpole);
    var armDir = (di % 2 === 0) ? 0 : Math.PI / 2;
    var a1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), _dblPoleMat);
    a1.position.set(0, 6.0, 0);
    a1.rotation.y = armDir;
    dg.add(a1);
    var ax = Math.cos(armDir) * 1.2, az = -Math.sin(armDir) * 1.2;
    var dglow1 = VR.World.makeGlowSprite(0xffc46b, 6);
    var dglow2 = VR.World.makeGlowSprite(0xffc46b, 6);
    dglow1.position.set(ax, 5.9, az);
    dglow2.position.set(-ax, 5.9, -az);
    dg.add(dglow1); dg.add(dglow2);
    if (VR.World.registerGlow) {
      VR.World.registerGlow(dglow1, 0.45, 1.0);
      VR.World.registerGlow(dglow2, 0.45, 1.0);
    }
    dg.position.set(D.x, 0, D.z);
    scene.add(dg);
    VR.World.registerCircle(D.x, D.z, 0.3);
  }

  // ---------- dockyard cranes (2, built from boxes) ----------
  function buildCrane(x, z, ry) {
    var g = new THREE.Group();
    var matY = stdMat({ color: 0xd4ac0d, roughness: 0.7, metalness: 0.2 });
    var matD = stdMat({ color: 0x2c313a, roughness: 0.7, metalness: 0.4 });
    function box(w, h, d, px, py, pz, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || matY);
      m.position.set(px, py, pz);
      m.castShadow = true;
      g.add(m);
      return m;
    }
    // Four legs.
    box(1.2, 22, 1.2, -5, 11, -4);
    box(1.2, 22, 1.2, 5, 11, -4);
    box(1.2, 22, 1.2, -5, 11, 4);
    box(1.2, 22, 1.2, 5, 11, 4);
    // Top frame + jib.
    box(13, 1.6, 10, 0, 22.5, 0);
    box(26, 1.2, 1.6, 10, 24, 0);
    box(8, 1.2, 1.6, -9, 24, 0);
    // Operator cabin + counterweight.
    box(3, 2.6, 3, 0, 21, 3.4, matD);
    box(3, 3, 4, -9, 22.5, 0, matD);
    // Cable + hook block hanging over the yard.
    box(0.18, 12, 0.18, 18, 18, 0, matD);
    box(1.6, 1.6, 1.6, 18, 11.5, 0, matD);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    VR.World.registerBlocker(x, z, 7, 6);
    // Warning glow on the jib tip.
    var tip = VR.World.makeGlowSprite(0xff4d4d, 4);
    tip.position.set(x + Math.cos(ry) * 23, 24, z - Math.sin(ry) * 23);
    scene.add(tip);
    if (VR.World.registerGlow) VR.World.registerGlow(tip, 0.5, 1.0);
  }
  buildCrane(205, -60, 0.3);
  buildCrane(205, 90, -0.4);

  VR.Buildings = {
    counts: {
      lowrise: lowrise.length,
      towers: towers.length,
      containers: containers.length,
      warehouses: warehouses.length,
      tents: tents.length,
      palms: palms.length,
      lamps: lamps.length,
      crowns: crowns.length,
      roofs: roofs.length,
      balconies: balconies.length,
      canopies: canopies.length,
      acUnits: acUnits.length,
      pipes: pipes.length,
      glassBands: glassBands.length,
      escapes: escapes.length,
      billboards: billboards.length,
      signs: SIGNS.length,
      eboxes: eboxes.length,
      bins: bins.length
    },
    // Night window glow: 0 at day, full at night. The emissive maps
    // are black except the lit windows, so only windows glow.
    setNightness: function (n) {
      lowriseMat.emissiveIntensity = n * 0.85;
      glassMat.emissiveIntensity = n * 1.1;
    }
  };

})(window.VR = window.VR || {});
