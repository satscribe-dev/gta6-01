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

  // Third stream for the W7 material + massing pass (r5): everything
  // W7 draws from rng3, so the main stream (city layout) and the rng2
  // art-pass stream never shift when materials or massing are tuned.
  var rng3 = mulberry32(20261119);
  function rr3(min, max) { return min + rng3() * (max - min); }
  function hexCss(h) { return '#' + ('000000' + (h >>> 0).toString(16)).slice(-6); }
  // Weighted pick from [{w, ...}] — returns the picked entry.
  function pick3w(entries) {
    var tot = 0, i;
    for (i = 0; i < entries.length; i++) tot += entries[i].w;
    var r = rng3() * tot;
    for (i = 0; i < entries.length; i++) { r -= entries[i].w; if (r <= 0) return entries[i]; }
    return entries[entries.length - 1];
  }
  // Quota assignment: assigns each of n items an index 0..k-1 so the
  // share of every index stays at or under ~30% (largest-remainder
  // apportionment + a hard 30% cap, order shuffled with rng3 so
  // neighbours still vary). weights: [{w}...].
  function quotaAssign(n, weights) {
    var k = weights.length;
    if (!n || !k) return [];
    var cap = Math.max(1, Math.floor(0.30 * n));
    var counts = [], tot = 0, i, j;
    for (i = 0; i < k; i++) { counts.push(Math.floor(weights[i].w * n)); tot += counts[i]; }
    var frac = [];
    for (i = 0; i < k; i++) frac.push({ i: i, f: weights[i].w * n - Math.floor(weights[i].w * n) });
    frac.sort(function (a, b) { return b.f - a.f; });
    var rem = n - tot, fi = 0;
    while (rem > 0) { counts[frac[fi % k].i]++; rem--; fi++; }
    // Hard cap: move any excess to the index with most headroom.
    for (i = 0; i < k; i++) {
      while (counts[i] > cap) {
        var bi2 = -1, best = -1;
        for (j = 0; j < k; j++) {
          if (j !== i && cap - counts[j] > best) { best = cap - counts[j]; bi2 = j; }
        }
        if (bi2 < 0 || best <= 0) break;
        counts[i]--; counts[bi2]++;
      }
    }
    var out = [];
    for (i = 0; i < k; i++) for (j = 0; j < counts[i]; j++) out.push(i);
    // Fisher-Yates shuffle with rng3.
    for (i = out.length - 1; i > 0; i--) {
      var t = Math.floor(rng3() * (i + 1));
      var tmp = out[i]; out[i] = out[t]; out[t] = tmp;
    }
    return out;
  }

  // Sidewalk-corner palm spots: (hx-7.5)/(hz-7.5) from the block
  // centre keeps the trunk on the sidewalk band — the widest road
  // half-width is 5.5 (boulevard), so 7.5 leaves ~2 units of
  // pavement; the widest building face reaches hx-12, so no palm
  // ever stands on asphalt or inside a building. sx/sz: the corner
  // sign; the buildings lie toward (-sx, -sz). If the chosen corner
  // falls inside a road corridor (the diagonal avenue / curves cut
  // through plan cells), the other three corners are tried in fixed
  // order — deterministic, no rng, so the palm stream never shifts.
  // (W2 owns palms; this only chooses WHICH corner of the plan cell
  // the palm stands on.)
  function ptSegDist(px, pz, sx, sz, ex, ez) {
    var vx = ex - sx, vz = ez - sz, l2 = vx * vx + vz * vz;
    var t = l2 ? ((px - sx) * vx + (pz - sz) * vz) / l2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var dx = px - (sx + vx * t), dz = pz - (sz + vz * t);
    return Math.sqrt(dx * dx + dz * dz);
  }
  function sidewalkCorner(bx, bz, hx, hz) {
    var sx = rng() < 0.5 ? -1 : 1;
    var sz = rng() < 0.5 ? -1 : 1;
    var ox = (hx === undefined ? 22.5 : hx - 7.5);
    var oz = (hz === undefined ? 22.5 : hz - 7.5);
    var jx = rr(-1, 1), jz = rr(-1, 1);
    var corners = [[sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]];
    for (var ci = 0; ci < corners.length; ci++) {
      var cx = bx + corners[ci][0] * ox + jx, cz = bz + corners[ci][1] * oz + jz;
      var clear = true;
      if (VR.Roads && VR.Roads.edges) {
        var edges = VR.Roads.edges;
        for (var ei = 0; ei < edges.length; ei++) {
          var e = edges[ei];
          if (ptSegDist(cx, cz, e.ax, e.az, e.bx, e.bz) < (e.w || 6) + 4) { clear = false; break; }
        }
      }
      if (clear) return { x: cx, z: cz, sx: corners[ci][0], sz: corners[ci][1] };
    }
    return null; // no corner clears a road — skip this palm (a missing
    // palm beats a palm standing on asphalt)
  }

  // ---------- facade textures ----------
  // Returns {map, emissive}: the map is the lit facade; the emissive
  // canvas is black except the lit windows, so at night only the
  // windows glow (emissiveIntensity is driven by nightness — see
  // VR.Buildings.setNightness). Without this the towers read as flat
  // black slabs after dark.
  // W7: facade texture from config DISTRICTS data — base colour +
  // per-district pattern (bands / brick / grid / corrugated, drawn
  // under the windows) + MIXED window colours (winSpecs: {c, w, lit}
  // — dark blue glass, warm white, dark, some warm yellow; lit ones
  // glow at night via the emissive canvas). Draws only from rng3.
  function facadeTexture(base, winSpecs, trim, pattern) {
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
    var pi, pj;
    if (pattern === 'bands' && trim) {
      // Horizontal floor bands in the gaps between window rows.
      ctx.fillStyle = trim;
      for (pi = 0; pi < 7; pi++) ctx.fillRect(0, 41 + pi * 30, 256, 3);
      ctx.globalAlpha = 0.28;
      ctx.fillRect(0, 232, 256, 24);
      ctx.globalAlpha = 1;
    } else if (pattern === 'brick' && trim) {
      // Mortar joints: horizontal courses + offset vertical joints.
      ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
      for (pi = 0; pi <= 16; pi++) {
        ctx.beginPath(); ctx.moveTo(0, pi * 16); ctx.lineTo(256, pi * 16); ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      for (pi = 0; pi < 16; pi++) {
        var off = (pi % 2 === 0) ? 0 : 16;
        for (pj = off; pj < 256; pj += 32) {
          ctx.beginPath(); ctx.moveTo(pj, pi * 16); ctx.lineTo(pj, (pi + 1) * 16); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    } else if (pattern === 'corrugated' && trim) {
      // Vertical ribs, alternating light / dark.
      for (pi = 0; pi < 16; pi++) {
        ctx.fillStyle = (pi % 2 === 0) ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)';
        ctx.fillRect(pi * 16, 0, 8, 256);
      }
      ctx.fillStyle = trim;
      ctx.fillRect(0, 0, 256, 4);
    } else if (pattern === 'grid' && trim) {
      // Glass mullions: verticals in the gaps between window columns,
      // horizontals in the gaps between window rows.
      ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.globalAlpha = 0.65;
      for (pi = 0; pi < 7; pi++) {
        ctx.beginPath(); ctx.moveTo(0, 41 + pi * 30); ctx.lineTo(256, 41 + pi * 30); ctx.stroke();
      }
      for (pj = 0; pj <= 5; pj++) {
        ctx.beginPath(); ctx.moveTo(pj * 51.2, 0); ctx.lineTo(pj * 51.2, 256); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 5; c++) {
        var ws = pick3w(winSpecs);
        ctx.fillStyle = hexCss(ws.c);
        ctx.fillRect(18 + c * 48, 16 + r * 30, 28, 20);
        if (ws.lit) {
          ectx.fillStyle = hexCss(ws.c);
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

  // W7: the two facadeTexture() calls that used to live here drew
  // exactly 80 values from rng() (8x5 windows x 2 textures) before
  // placement. Facades are now built after placement from rng3, so
  // these 80 draws keep the main stream identical — every building
  // and palm stays exactly where W2/W5 put it.
  for (var _w7i = 0; _w7i < 80; _w7i++) rng();

  // ---------- placement ----------
  var lowrise = [];   // {x,z,w,d,h,color,blk,district}
  var towers = [];
  var containers = [];
  var warehouses = [];
  var tents = [];     // {x,z,ry,color}
  var palms = [];     // {x,z,lean,scale,ix,iz} — ix/iz: inward (building) unit dir
  var lamps = [];     // {x,z,dbl}

  // Cells from the road plan (roads.js): VX/HZ are the street lists
  // (irregular spacing — the OSM-method plan, our own fictional
  // Vandara Bay). A cell is the block between two adjacent streets;
  // buildings are placed INSIDE their cell, so the road guard below
  // only drops genuine overlaps instead of mass-dropping a city that
  // was laid out on the old 60-grid. Fallback is the old street list
  // if roads.js is absent. 7 cols x 7 rows = 49 cells, same as before.
  var VX = (VR.Roads && VR.Roads.vStreets) || [-210, -150, -90, -30, 30, 90, 150, 210];
  var HZ = (VR.Roads && VR.Roads.hStreets) || [-210, -150, -90, -30, 30, 90, 150, 210];
  var PASTEL = [P.terracotta, P.sandCream, P.mint, P.teal, 0xd9a441, 0xe07856];
  var CONTAINER_COLORS = [P.containerRed, P.containerBlue, P.containerGreen,
    P.containerYellow, P.containerOrange];

  // Rejection sampling (plan §5): a building slot draws a fresh
  // candidate (position + size) up to 5 times; the first candidate
  // that clears every road corridor is kept. roadClear is hoisted
  // from the guard below (function declaration, reads the real
  // VR.Roads.edges — streets AND curves AND the avenue). If no
  // candidate clears, the slot is dropped and recorded in
  // _placedSkipped (merged into clearanceSkipped by the guard).
  // This is what keeps the city dense: the plan's cells sit between
  // the roads, and only slots that genuinely cannot fit are removed
  // — instead of placing on the old grid and mass-dropping 75
  // footprints (W7 finding 16:05 WIB).
  var _placedSkipped = [];
  function tryPlace(list, mk, kind, hxFn, hzFn) {
    var b, t;
    for (t = 0; t < 15; t++) {
      b = mk();
      if (roadClear(b.x, b.z, hxFn(b), hzFn(b))) { list.push(b); return true; }
    }
    _placedSkipped.push({ kind: kind, x: +b.x.toFixed(1), z: +b.z.toFixed(1), why: 'road' });
    return false;
  }
  var _placeHalf = function (b) { return Math.max(b.w, b.d) / 2 + 0.4; };
  var _placeHalfW = function (b) { return b.w / 2 + 0.4; };
  var _placeHalfD = function (b) { return b.d / 2 + 0.4; };

  // A plan cell is CROSSED if a curved/diagonal road (chain or link —
  // not a street, which only bounds the cell) passes through its
  // interior (inset 2, so a road running along the boundary does not
  // count). Crossed cells get smaller buildings — a 26-wide tower
  // cannot fit in the clear triangle beside a diagonal, but a
  // 16-wide one can. segRectDist is hoisted from the guard below.
  function cellCrossed(x0, z0, x1, z1) {
    if (!VR.Roads) return false;
    var ix0 = x0 + 2, iz0 = z0 + 2, ix1 = x1 - 2, iz1 = z1 - 2;
    var ci, cj, pts, l;
    var chains = VR.Roads.chains || [];
    for (ci = 0; ci < chains.length; ci++) {
      pts = chains[ci].pts;
      for (cj = 0; cj < pts.length - 1; cj++) {
        if (segRectDist(pts[cj][0], pts[cj][1], pts[cj + 1][0], pts[cj + 1][1], ix0, iz0, ix1, iz1) === 0) return true;
      }
    }
    var links = VR.Roads.links || [];
    for (ci = 0; ci < links.length; ci++) {
      l = links[ci];
      if (segRectDist(l[0], l[1], l[2], l[3], ix0, iz0, ix1, iz1) === 0) return true;
    }
    return false;
  }

  // ---------- W5d (r6) REBUILD — district clustering + street rows ----------
  // The W5 scatter placed every building at a random point inside its
  // cell, so from above the city read as confetti: towers everywhere,
  // shophouses nowhere in particular. The rebuild places by DISTRICT
  // ROLE instead:
  // - TOWER CLUSTER: towers ONLY in the cells whose centre is within
  //   85 units of the plaza ring centre (-22,-57) — 9 cells, heights
  //   tapering 85 (ring) -> ~35 (edge), near the cell centre. Every
  //   other Highrise cell gets mid-rise ROWS (12-22), so downtown
  //   reads as one compact cluster with a shoulder, not towers
  //   scattered over the whole north.
  // - STREET ROWS: lowrise stands in ROWS along the cell's north and
  //   south street edges — fixed row line, regular pitch, +/-2
  //   jitter — so a block reads as street frontage from above. A
  //   slot the avenue or a curve cuts is dropped by tryPlace, never
  //   forced onto a road.
  // - MARKET SQUARE: Pasar Lentera's tents cluster ONLY in the two
  //   square cells (x -52..64, z 86..140) as a tight grid around the
  //   square centre; no tents anywhere else.
  // - DOCKYARD ROWS: warehouses in a row along the north edge,
  //   container stacks in a row along the south edge, per cell.
  // District BOUNDS still come from config DISTRICTS (untouched);
  // only placement inside them changes.
  var PLAZA_C = { x: -22, z: -57 };
  var TOWER_R = 85;
  function inTowerZone(cx, cz) {
    return Math.hypot(cx - PLAZA_C.x, cz - PLAZA_C.z) <= TOWER_R;
  }
  function inMarketSq(cx, cz) {
    return cx >= -52 && cx <= 64 && cz >= 86 && cz <= 140;
  }
  // One row of lowrise along a cell edge: zEdge is the cell edge
  // (a street centreline), inward is +1 (north edge, the building
  // sits south of it) or -1 (south edge). Slots at regular `pitch`
  // along x between the side streets; each slot draws its own w/d/h.
  // The row line sits (road half-width + 1 + d/2) inside the edge, so
  // the building face clears the street by construction and tryPlace
  // only has to drop slots a diagonal/curve actually crosses.
  // W5d fix: each retry also draws an inward SETBACK of 0-5, so a
  // slot a diagonal crosses at the row line can step back off it and
  // still place (the row stays on-pitch in x, just 0-5 deeper). A
  // slot squeezed between a street and a parallel curve (e.g. the
  // Highrise Arc shadowing H-138) has no clear depth at all and is
  // still correctly dropped — that strip is genuinely unbuildable.
  function placeRow(x0, x1, zEdge, inward, rwX, rwZ, pitch, hMin, hMax, district, blk, crossed) {
    var usable = (x1 - x0) - 2 * (rwX + 1) - 12;
    var n = Math.max(1, Math.floor(usable / pitch) + 1);
    var span = (n - 1) * pitch;
    var cx = (x0 + x1) / 2;
    for (var s = 0; s < n; s++) {
      (function (slotX) {
        tryPlace(lowrise, function () {
          var _w = crossed ? rr(8, 11) : rr(9, 11);
          var _d = crossed ? rr(8, 11) : rr(9, 11);
          return {
            x: slotX + rr(-2, 2),
            z: zEdge + inward * (rwZ + 1 + _d / 2 + rr(0, 5)) + rr(-1, 1),
            w: _w, d: _d, h: rr(hMin, hMax),
            color: pick(PASTEL), blk: blk, district: district
          };
        }, 'lowrise', _placeHalfW, _placeHalfD);
      })(cx - span / 2 + s * pitch);
    }
  }
  // Middle row for the two tall outer cell-rows (bj=0,6): a third row
  // down the cell centre, same pitch/sizes as the edge rows. Only
  // used where no tower stands and no yard rows run (tower cells and
  // dockyard excluded by the caller) — the mid row never meets the
  // edge rows: edge-row faces stop ~8 short of the centre band.
  function placeMidRow(x0, x1, zMid, rwX, pitch, hMin, hMax, district, blk, crossed) {
    var usable = (x1 - x0) - 2 * (rwX + 1) - 12;
    var n = Math.max(1, Math.floor(usable / pitch) + 1);
    var span = (n - 1) * pitch;
    var cx = (x0 + x1) / 2;
    for (var s = 0; s < n; s++) {
      (function (slotX) {
        tryPlace(lowrise, function () {
          var _w = crossed ? rr(8, 11) : rr(9, 11);
          var _d = crossed ? rr(8, 11) : rr(9, 11);
          return {
            x: slotX + rr(-2, 2),
            z: zMid + rr(-2, 2),
            w: _w, d: _d, h: rr(hMin, hMax),
            color: pick(PASTEL), blk: blk, district: district
          };
        }, 'lowrise', _placeHalfW, _placeHalfD);
      })(cx - span / 2 + s * pitch);
    }
  }

  var bi, bj, bx, bz, hx, hz, district, k, i, j, pc;
  for (bi = 0; bi < VX.length - 1; bi++) {
    for (bj = 0; bj < HZ.length - 1; bj++) {
      bx = (VX[bi] + VX[bi + 1]) / 2; bz = (HZ[bj] + HZ[bj + 1]) / 2;
      hx = (VX[bi + 1] - VX[bi]) / 2; hz = (HZ[bj + 1] - HZ[bj]) / 2;
      district = VR.World.districtAt(bx, bz);
      var crossed = cellCrossed(VX[bi], HZ[bj], VX[bi + 1], HZ[bj + 1]);
      // Adjacent streets' half-widths (for the row lines: a building's
      // face must stay (road half-width + 1) from the cell edge).
      var _vW2 = (VR.Roads && VR.Roads.vWidths) || [];
      var _hW2 = (VR.Roads && VR.Roads.hWidths) || [];
      var _rwX = Math.max(_vW2[bi] || 6, _vW2[bi + 1] || 6);
      var _rwZ = Math.max(_hW2[bj] || 6, _hW2[bj + 1] || 6);
      if (district === 'Golden Pier') {
        // Beachfront rows along both street edges + palms.
        placeRow(VX[bi], VX[bi + 1], HZ[bj], 1, _rwX, _rwZ, 15, 8, 16, district, bi * 7 + bj, crossed);
        placeRow(VX[bi], VX[bi + 1], HZ[bj + 1], -1, _rwX, _rwZ, 15, 8, 16, district, bi * 7 + bj, crossed);
        if (rng() < 0.7) {
          pc = sidewalkCorner(bx, bz, hx, hz);
          var _plnA = rr(-0.12, 0.12), _pscA = rr(0.9, 1.2);
          if (pc) palms.push({ x: pc.x, z: pc.z, lean: _plnA, scale: _pscA, ix: -pc.sx, iz: -pc.sz });
        }
      } else if (district === 'Pasar Lentera') {
        // Shophouse rows along both street edges.
        placeRow(VX[bi], VX[bi + 1], HZ[bj], 1, _rwX, _rwZ, 15, 8, 14, district, bi * 7 + bj, crossed);
        placeRow(VX[bi], VX[bi + 1], HZ[bj + 1], -1, _rwX, _rwZ, 15, 8, 14, district, bi * 7 + bj, crossed);
        // Lantern tents ONLY in the market-square cells: a tight grid
        // around the cell centre, so the market reads as one stall
        // field instead of tents scattered over the whole south.
        // 5 columns (the outer columns would stand in the side
        // streets' corridors) x 2 rows.
        if (inMarketSq(bx, bz)) {
          for (var _tx = -2; _tx <= 2; _tx++) {
            for (var _tz = 0; _tz < 2; _tz++) {
              (function (gx, gz) {
                tryPlace(tents, function () {
                  return {
                    x: bx + gx * 8 + rr(-1.5, 1.5),
                    z: bz + gz * 7 + rr(-1.5, 1.5),
                    ry: rr(0, Math.PI), color: pick([0xff4d4d, 0xffd23f, 0xff8c42, 0x37e0ff])
                  };
                }, 'tent', function () { return 2.4; }, function () { return 2.0; });
              })(_tx, _tz);
            }
          }
        }
        if (rng() < 0.4) {
          pc = sidewalkCorner(bx, bz, hx, hz);
          var _plnB = rr(-0.1, 0.1), _pscB = rr(0.8, 1.1);
          if (pc) palms.push({ x: pc.x, z: pc.z, lean: _plnB, scale: _pscB, ix: -pc.sx, iz: -pc.sz });
        }
      } else if (district === 'Highrise Plaza') {
        // TOWER CLUSTER: a tower in EVERY zone cell (no 0.85 gate —
        // the cluster must read as a cluster; the guard still drops
        // the two cells the avenue splits too narrow for a tower,
        // which stay open plaza). Near the cell centre, height
        // tapering with distance from the ring (85 at the ring ->
        // ~35 at the edge). Crossed cells get wider jitter (the
        // clear triangles beside a diagonal are off-centre) and
        // smaller towers; the fallback lowrise scatters wide so it
        // can find a clear triangle the tower could not.
        if (inTowerZone(bx, bz)) {
          var _tDist = Math.hypot(bx - PLAZA_C.x, bz - PLAZA_C.z);
          var _tJit = crossed ? 12 : 6;
          var _twOk = tryPlace(towers, function () {
            var _w = crossed ? rr(14, 20) : rr(18, 26);
            var _d = crossed ? rr(14, 20) : rr(18, 26);
            return {
              x: bx + rr(-_tJit, _tJit), z: bz + rr(-_tJit, _tJit),
              w: _w, d: _d,
              h: Math.max(35, Math.min(88, 35 + (1 - _tDist / TOWER_R) * 50 + rr(-4, 4))),
              color: pick([0x3fa7c4, 0x2e8b8b, 0x5fb8d4, 0x7fc8d4])
            };
          }, 'tower', _placeHalfW, _placeHalfD);
          if (!_twOk) {
            tryPlace(lowrise, function () {
              var _w = rr(10, 14), _d = rr(10, 14);
              var _sx = Math.max(3, hx - _w / 2 - _rwX - 1);
              var _sz = Math.max(3, hz - _d / 2 - _rwZ - 1);
              return {
                x: bx + rr(-_sx, _sx), z: bz + rr(-_sz, _sz),
                w: _w, d: _d, h: rr(12, 18),
                color: pick(PASTEL), blk: bi * 7 + bj, district: district
              };
            }, 'lowrise', _placeHalfW, _placeHalfD);
          }
        } else {
          // Mid-rise shoulder rows along both street edges.
          placeRow(VX[bi], VX[bi + 1], HZ[bj], 1, _rwX, _rwZ, 15, 12, 22, district, bi * 7 + bj, crossed);
          placeRow(VX[bi], VX[bi + 1], HZ[bj + 1], -1, _rwX, _rwZ, 15, 12, 22, district, bi * 7 + bj, crossed);
        }
        if (rng() < 0.35) {
          pc = sidewalkCorner(bx, bz, hx, hz);
          var _plnC = rr(-0.08, 0.08), _pscC = rr(0.8, 1.0);
          if (pc) palms.push({ x: pc.x, z: pc.z, lean: _plnC, scale: _pscC, ix: -pc.sx, iz: -pc.sz });
        }
      } else { // Industrial Dockyard
        // Warehouse in a row along the north edge, container stacks in
        // a row along the south edge — the yard reads as one industrial
        // strip per block, not scattered sheds. The warehouse draws x
        // across the full usable width + an inward setback per retry,
        // so it can dodge the avenue / Harbor Diagonal where they cut
        // the north row (a fixed x + fixed z sits on the diagonal).
        tryPlace(warehouses, function () {
          var _w = crossed ? rr(18, 22) : rr(24, 30);
          var _d = crossed ? rr(14, 18) : rr(16, 22);
          var _sx = Math.max(3, hx - _w / 2 - _rwX - 1);
          return {
            x: bx + rr(-_sx, _sx),
            z: HZ[bj] + _rwZ + 1 + _d / 2 + rr(0, 6) + rr(-1, 1),
            w: _w, d: _d, h: rr(9, 13),
            color: pick([0x8a8f98, 0x9a7b4f, 0x6b7c8a])
          };
        }, 'warehouse', _placeHalfW, _placeHalfD);
        var stacks = 3;
        for (k = 0; k < stacks; k++) {
          // A container stack retries its position as a group (all its
          // levels share one cx/cz); a stack that cannot clear any road
          // is dropped as a whole. Slots sit on the south-edge row.
          (function (slotX) {
            var cx, cz, _cok = false;
            for (var _ct = 0; _ct < 15 && !_cok; _ct++) {
              cx = slotX + rr(-2, 2);
              cz = HZ[bj + 1] - _rwZ - 1 - 3.5 + rr(-1, 1);
              _cok = roadClear(cx, cz, 3.5, 3.5);
            }
            if (!_cok) {
              _placedSkipped.push({ kind: 'container', x: +cx.toFixed(1), z: +cz.toFixed(1), why: 'road' });
              return;
            }
            var levels = 1 + Math.floor(rng() * 3);
            for (var lv = 0; lv < levels; lv++) {
              containers.push({
                x: cx, z: cz, y: lv * 2.7,
                w: 6.1, d: 2.6, h: 2.6,
                ry: (rng() < 0.5 ? 0 : Math.PI / 2),
                color: pick(CONTAINER_COLORS)
              });
            }
          })(bx + (k - 1) * 14);
        }
      }
      // W5d density: a middle row in the two tall outer cell-rows
      // (bj=0 north edge, bj=6 south edge) — the cells are 62-72
      // tall, so a third row fits down the centre. Skipped for the
      // dockyard (yard rows already use both edges) and for tower
      // cells (a mid row would meet the tower).
      if ((bj === 0 || bj === 6) && district !== 'Industrial Dockyard' && !inTowerZone(bx, bz)) {
        var _mh0 = district === 'Highrise Plaza' ? 12 : 8;
        var _mh1 = district === 'Highrise Plaza' ? 22 : (district === 'Golden Pier' ? 16 : 14);
        placeMidRow(VX[bi], VX[bi + 1], bz, _rwX, 15, _mh0, _mh1, district, bi * 7 + bj, crossed);
      }
    }
  }

  // ---------- MAP v2 CLEARANCE GUARD (r5 W5) ----------
  // No footprint may overlap any road corridor. A building whose
  // blocker rect comes within (road half-width + 1) of a road segment
  // centreline is DROPPED from the list. The rng draws for its
  // position were already spent, so every other building stays exactly
  // where it was — the city does not reshuffle. The guard reads
  // VR.Roads.edges (roads.js loads before buildings.js), so it covers
  // the grid, the diagonal avenue, the ring, the beach road and the
  // crescent with no hard-coded road data here. Palms are NOT filtered
  // (W2 scope): the v2 roads were routed to clear every palm instead.
  // Skipped footprints are reported in VR.Buildings.clearanceSkipped.
  function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
    function ptSeg(px, pz, sx, sz, ex, ez) {
      var vx = ex - sx, vz = ez - sz, l2 = vx * vx + vz * vz;
      var t = l2 ? ((px - sx) * vx + (pz - sz) * vz) / l2 : 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return Math.sqrt((px - (sx + vx * t)) * (px - (sx + vx * t)) +
        (pz - (sz + vz * t)) * (pz - (sz + vz * t)));
    }
    function orient(px, pz, qx, qz, rx, rz) {
      return (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    }
    var o1 = orient(ax, az, bx, bz, cx, cz), o2 = orient(ax, az, bx, bz, dx, dz);
    var o3 = orient(cx, cz, dx, dz, ax, az), o4 = orient(cx, cz, dx, dz, bx, bz);
    if (((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) &&
        o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return 0;
    return Math.min(ptSeg(ax, az, cx, cz, dx, dz), ptSeg(bx, bz, cx, cz, dx, dz),
      ptSeg(cx, cz, ax, az, bx, bz), ptSeg(dx, dz, ax, az, bx, bz));
  }
  // Distance from segment AB to axis-aligned rect [x0,x1]x[z0,z1]
  // (0 when they touch or overlap).
  function segRectDist(ax, az, bx, bz, x0, z0, x1, z1) {
    function ptIn(px, pz) { return px >= x0 && px <= x1 && pz >= z0 && pz <= z1; }
    if (ptIn(ax, az) || ptIn(bx, bz)) return 0;
    var d = segSegDist(ax, az, bx, bz, x0, z0, x1, z0);
    d = Math.min(d, segSegDist(ax, az, bx, bz, x1, z0, x1, z1));
    d = Math.min(d, segSegDist(ax, az, bx, bz, x1, z1, x0, z1));
    d = Math.min(d, segSegDist(ax, az, bx, bz, x0, z1, x0, z0));
    return d;
  }
  var _skipped = []; // {kind, x, z, why:'road'|'sea'} footprints dropped by the guard
  // Slots the placement loop already dropped (rejection sampling found
  // no clear position in 5 tries) join the same report.
  for (var _psi = 0; _psi < _placedSkipped.length; _psi++) _skipped.push(_placedSkipped[_psi]);
  function roadClear(x, z, hx, hz) {
    if (!VR.Roads || !VR.Roads.edges) return true;
    var edges = VR.Roads.edges;
    for (var ei = 0; ei < edges.length; ei++) {
      var e = edges[ei];
      var hw = (e.w || 6) + 1; // road half-width + 1 unit car headroom
      if (segRectDist(e.ax, e.az, e.bx, e.bz,
          x - hx, z - hz, x + hx, z + hz) < hw) return false;
    }
    return true;
  }
  function clearFilter(list, hxFn, hzFn, kind) {
    var kept = [];
    for (var fi = 0; fi < list.length; fi++) {
      var b = list[fi];
      if (roadClear(b.x, b.z, hxFn(b), hzFn(b))) kept.push(b);
      else _skipped.push({ kind: kind, x: +b.x.toFixed(1), z: +b.z.toFixed(1), why: 'road' });
    }
    return kept;
  }
  // Rect blockers (w/2+0.4, d/2+0.4) for axis-aligned masses — the
  // old square max(w,d) over-reached by up to 4.4 units and dropped
  // buildings whose real footprint cleared the road. Containers keep
  // the square: they rotate (ry 0 / PI/2), so the square is the
  // rotation-invariant bound. buildBoxes registers the same rect.
  var _boxHalfW = function (b) { return b.w / 2 + 0.4; };
  var _boxHalfD = function (b) { return b.d / 2 + 0.4; };
  var _boxHalf = function (b) { return Math.max(b.w, b.d) / 2 + 0.4; };
  lowrise = clearFilter(lowrise, _boxHalfW, _boxHalfD, 'lowrise');
  towers = clearFilter(towers, _boxHalfW, _boxHalfD, 'tower');
  warehouses = clearFilter(warehouses, _boxHalfW, _boxHalfD, 'warehouse');
  containers = clearFilter(containers, _boxHalf, _boxHalf, 'container');
  tents = clearFilter(tents,
    function () { return 2.4; }, function () { return 2.0; }, 'tent');

  // SEA GUARD (coastline): no building may stand in the sea or on the
  // sand — its whole blocker rect must sit east of the land edge
  // (coastX(z)+10) with 1 unit of margin. The coast varies with z, so
  // the westernmost land edge over the building's z-span is used.
  // Reads the one coastline from VR.World.coastX (world.js loads
  // before buildings.js); fallback is the old straight coast. Runs
  // after the road filter, on the same lists; palms are not filtered.
  var _coastFn = (VR.World && VR.World.coastX) || function () { return -244; };
  function seaClear(x, z, hx, hz) {
    var landMin = Infinity, zz;
    for (zz = z - hz; zz <= z + hz; zz += 2) {
      var lx = _coastFn(zz) + 10;
      if (lx < landMin) landMin = lx;
    }
    return (x - hx) >= landMin + 1;
  }
  function seaFilter(list, hxFn, hzFn, kind) {
    var kept = [];
    for (var fi2 = 0; fi2 < list.length; fi2++) {
      var b2 = list[fi2];
      if (seaClear(b2.x, b2.z, hxFn(b2), hzFn(b2))) kept.push(b2);
      else _skipped.push({ kind: kind, x: +b2.x.toFixed(1), z: +b2.z.toFixed(1), why: 'sea' });
    }
    return kept;
  }
  lowrise = seaFilter(lowrise, _boxHalfW, _boxHalfD, 'lowrise');
  towers = seaFilter(towers, _boxHalfW, _boxHalfD, 'tower');
  warehouses = seaFilter(warehouses, _boxHalfW, _boxHalfD, 'warehouse');
  containers = seaFilter(containers, _boxHalf, _boxHalf, 'container');
  tents = seaFilter(tents,
    function () { return 2.4; }, function () { return 2.0; }, 'tent');

  // W5d (r6): a palm trunk registers a 0.8 collider (createPalmTree),
  // so a palm standing IN a road corridor blocks the strip check.
  // The boulevard row (x=-197.5) is crossed by the diagonal avenue
  // at z~167 — one palm there blocked the avenue strip 3/3969. Both
  // rows are filtered: a trunk must clear every road centreline by
  // (half-width + trunk 0.8). The threshold has NO extra margin, so
  // the boulevard row itself survives: its trunks sit 12.5 from the
  // boulevard centreline (half-width 11) and only the avenue-crossing
  // palm is dropped. Draws happen before the check, so the rng stream
  // never shifts when a palm is skipped.
  function palmClear(x, z) {
    if (!VR.Roads || !VR.Roads.edges) return true;
    var edges = VR.Roads.edges;
    for (var ei = 0; ei < edges.length; ei++) {
      var e = edges[ei];
      if (segRectDist(e.ax, e.az, e.bx, e.bz, x, z, x, z) < (e.w || 6) + 0.8) return false;
    }
    return true;
  }
  // Boardwalk palms: a proud row along the coast, big and visible.
  // Buildings lie east (+x), so the frond fan's inward side is +x.
  for (var pz = -210; pz <= 210; pz += 30) {
    var _bwX = -222, _bwZ = pz + rr(-6, 6), _bwL = rr(-0.1, 0.1), _bwS = rr(1.1, 1.4);
    if (palmClear(_bwX, _bwZ)) palms.push({ x: _bwX, z: _bwZ, lean: _bwL, scale: _bwS, ix: 1, iz: 0 });
  }
  // A second row on the boulevard sidewalk (road edge is at -199, so
  // -197.5 keeps the trunk fully on the sidewalk, never on asphalt).
  for (pz = -195; pz <= 195; pz += 60) {
    var _blX = -197.5, _blZ = pz + rr(-8, 8), _blL = rr(-0.1, 0.1), _blS = rr(1.0, 1.25);
    if (palmClear(_blX, _blZ)) palms.push({ x: _blX, z: _blZ, lean: _blL, scale: _blS, ix: 1, iz: 0 });
  }

  // Street lamps at intersection corners; every 4th is a double-arm
  // lamp (built as its own group below, not in the instanced mesh).
  // Street lamps at intersection corners of the plan streets (VX/HZ);
  // every 4th is a double-arm lamp. (Was the old grid STREETS array.)
  // Offset is the street's own half-width + 2 — a fixed +8 would put
  // a lamp ON the boulevard (half-width 11).
  var _vW = (VR.Roads && VR.Roads.vWidths) || [];
  var _hW = (VR.Roads && VR.Roads.hWidths) || [];
  for (i = 0; i < VX.length; i++) {
    for (j = 0; j < HZ.length; j++) {
      if ((i + j) % 2 === 0) {
        lamps.push({
          x: VX[i] + (_vW[i] || 6) + 2,
          z: HZ[j] + (_hW[j] || 6) + 2,
          dbl: ((i * 8 + j) % 4 === 0)
        });
      }
    }
  }

  // ---------- art-pass details (19 Nov, scope 19:57) ----------
  // Every list below derives from the placed lists above + rng2, so
  // the base city never moves when details are added or tuned.

  // ---------- W7: per-district material variants (r5) ----------
  // REPLACES the old per-block 70% pastel dominance — that pass made
  // whole blocks a single colour, which is exactly the monotony the
  // user flagged (all teal/green + orange + yellow windows). Facade
  // variants now come from config DISTRICTS.facades, apportioned by
  // quota so no single facade exceeds ~30% of its district.
  // The rng2() call per building is kept (discarded) so the rng2
  // art-pass stream below never shifts.
  function districtDef(name) {
    for (var di = 0; di < C.DISTRICTS.length; di++) {
      if (C.DISTRICTS[di].name === name) return C.DISTRICTS[di];
    }
    return C.DISTRICTS[0];
  }
  var _w7stats = { variants: {}, massing: {}, roofs: {} };
  function _w7bump(table, key) {
    if (!_w7stats[table][key]) _w7stats[table][key] = 0;
    _w7stats[table][key]++;
  }
  var _li, _b;
  var _byDistrict = {};
  for (_li = 0; _li < lowrise.length; _li++) {
    _b = lowrise[_li];
    rng2(); // preserve the rng2 stream (old dominance pass drew here)
    (_byDistrict[_b.district] = _byDistrict[_b.district] || []).push(_b);
  }
  var _dn;
  for (_dn in _byDistrict) {
    var _list = _byDistrict[_dn];
    var _def = districtDef(_dn);
    var _assign = quotaAssign(_list.length, _def.facades);
    for (var _ai2 = 0; _ai2 < _list.length; _ai2++) {
      _list[_ai2].variant = _assign[_ai2];
      _list[_ai2].color = _def.facades[_assign[_ai2]].c;
      _w7bump('variants', _dn + '|' + _assign[_ai2]);
    }
  }
  // Tower glass tints (Highrise Plaza facades), same ~30% cap.
  var _hzDef = districtDef('Highrise Plaza');
  var _tAssign = quotaAssign(towers.length, _hzDef.facades);
  for (var _ti3 = 0; _ti3 < towers.length; _ti3++) {
    towers[_ti3].tint = _tAssign[_ti3];
    towers[_ti3].color = _hzDef.facades[_tAssign[_ti3]].c;
    _w7bump('variants', 'Highrise Plaza|tower|' + _tAssign[_ti3]);
  }
  // Dockyard warehouse colours (steel / rust) + roof type, same cap.
  var _dkDef = districtDef('Industrial Dockyard');
  var _wAssign = quotaAssign(warehouses.length, _dkDef.facades);
  for (var _wi3 = 0; _wi3 < warehouses.length; _wi3++) {
    warehouses[_wi3].color = _dkDef.facades[_wAssign[_wi3]].c;
    warehouses[_wi3].roof = pick3w([
      { v: 'pyramid', w: 0.4 }, { v: 'gable', w: 0.35 }, { v: 'flat', w: 0.25 }
    ]).v;
    _w7bump('variants', 'Industrial Dockyard|wh|' + _wAssign[_wi3]);
    _w7bump('roofs', 'warehouse|' + warehouses[_wi3].roof);
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
    crowns.push({ x: _tw.x, z: _tw.z, y: _tw.h, w: _tw.w * 0.55, h: _ch, d: _tw.d * 0.55, color: _tw.color, tint: _tw.tint });
    if (rng2() < 0.45) antennas.push({ x: _tw.x, z: _tw.z, y: _tw.h + _ch });
  }
  var _wi;
  for (_wi = 0; _wi < warehouses.length; _wi++) {
    var _wh = warehouses[_wi];
    // W7: only pyramid-roof warehouses go in the cone list now;
    // gable ones are built in the massing block, flat ones stay bare.
    if (_wh.roof === 'pyramid') roofs.push({ x: _wh.x, z: _wh.z, y: _wh.h, w: _wh.w, d: _wh.d, color: _wh.color });
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
      glassBands.push({ x: _tw2.x, y: _tw2.h * rr2(0.35, 0.75), z: _tw2.z, w: _tw2.w + 0.25, h: 0.7, d: _tw2.d + 0.25, color: _tw2.color });
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
    var _es = pick2(VX);
    eboxes.push({
      x: _es + (rng2() < 0.5 ? -8 : 8),
      z: 60 * Math.round(rr2(-180, 180) / 60) + rr2(-14, 14)
    });
  }
  for (_eb = 0; _eb < 20; _eb++) {
    var _bs = pick2(VX);
    bins.push({
      x: _bs + (rng2() < 0.5 ? -8 : 8),
      z: 60 * Math.round(rr2(-180, 180) / 60) + rr2(-14, 14)
    });
  }

  // ---------- MAP v2 PROP CLEARANCE (r5 W5) ----------
  // Utility boxes + bins sit on sidewalks by construction, but the
  // diagonal avenue + curves cut across the old 60-grid, so a prop
  // can land in a driving lane (the avenue stall was an ebox at
  // (-38,13), 3 units off the centreline). Drop any prop whose centre
  // is within (road half-width + radius + 1) of a road segment.
  // Recorded in clearanceSkipped as {kind:'ebox'|'bin', why:'road'}.
  // (The guard's segRectDist is a point-to-segment distance when the
  // rect is degenerate, so it is reused here.)
  function propClear(x, z, r) {
    if (!VR.Roads || !VR.Roads.edges) return true;
    var edges = VR.Roads.edges;
    for (var ei = 0; ei < edges.length; ei++) {
      var e = edges[ei];
      if (segRectDist(e.ax, e.az, e.bx, e.bz, x, z, x, z) < (e.w || 6) + r + 1) return false;
    }
    return true;
  }
  function propFilter(list, r, kind) {
    var kept = [];
    for (var fi = 0; fi < list.length; fi++) {
      var b = list[fi];
      if (propClear(b.x, b.z, r)) kept.push(b);
      else _skipped.push({ kind: kind, x: +b.x.toFixed(1), z: +b.z.toFixed(1), why: 'road' });
    }
    return kept;
  }
  eboxes = propFilter(eboxes, 0.6, 'ebox');
  bins = propFilter(bins, 0.45, 'bin');

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
      // Rect blocker matching the visual box (ry-aware: a PI/2 yaw
      // swaps w and d). The old square max(w,d) over-claimed up to
      // 4.4 units and is what dropped fitting buildings in the guard.
      var _bry = b.ry || 0, _bc = Math.abs(Math.cos(_bry)) > 0.5;
      VR.World.registerBlocker(b.x, b.z,
        (_bc ? b.w : b.d) / 2 + 0.4, (_bc ? b.d : b.w) / 2 + 0.4);
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

  // ---------- W7: facade materials + massing expansion (r5) ----------
  // Every facade texture is built from config DISTRICTS (facades +
  // windows) — the palette is finally wired to the buildings. One
  // material per (district, variant); instance colour is white, so
  // the texture's own base colour shows unshifted.
  // Massing: each placed box expands into 1-4 parts, ALL contained in
  // its original footprint rect — the W5 clearance guard already
  // validated that rect, so no new part can overlap a road (verified
  // again below: _massingViolations must be 0).
  var _facadeMats = {};    // key: district|variant -> material
  var _allFacadeMats = []; // every facade material (for setNightness)
  function facadeMat(distName, vi) {
    var key = distName + '|' + vi;
    if (_facadeMats[key]) return _facadeMats[key];
    var def = districtDef(distName);
    var f = def.facades[vi];
    var t = facadeTexture(hexCss(f.c), def.windows, f.trim ? hexCss(f.trim) : null, f.pattern || 'grid');
    var m = stdMat({
      map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      roughness: f.pattern === 'grid' ? 0.4 : 0.85, metalness: f.pattern === 'grid' ? 0.05 : 0
    });
    _facadeMats[key] = m;
    _allFacadeMats.push(m);
    return m;
  }
  var _WHITE = 0xffffff;
  var _massingRects = [];    // {x,z,hx,hz} of every built part (verify)
  var _massingViolations = 0;
  function _w7rect(x, z, w, d) {
    var hx = w / 2 + 0.4, hz = d / 2 + 0.4;
    _massingRects.push({ x: x, z: z, hx: hx, hz: hz });
    if (!roadClear(x, z, hx, hz)) _massingViolations++;
  }
  // Roof-shape + rooftop-prop + arcade lists, filled by expansion.
  var _gableRoofs = []; // {x,y,z,ry,w,h,d} gable roofs
  var _domes = [];      // {x,y,z,w,h,d,color} small domes
  var _roofAC = [];     // {x,y,z,ry,w,h,d} rooftop AC boxes
  var _tanks = [];      // {x,y,z,w,h,d} rooftop water tanks
  var _arcCols = [];    // {x,y,z,w,h,d} arcade columns
  var _arcSlabs = [];   // {x,y,z,ry,w,h,d,color} arcade slabs
  var _arcSpots = [];   // {x,z,district} buildings with an arcade (verify)
  var _towerCyl = [];   // {x,y,z,w,h,d,color} round tower drums
  // Gable roof: triangular prism, apex up, base at y=0, normalised to
  // unit-box extents (ridge along local X). Dome: hemisphere r=0.5.
  // Drums/tanks: cylinders with base at y=0.
  var _gableGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2);
  _gableGeo.rotateZ(Math.PI / 2);
  _gableGeo.translate(0, 0.5, 0);
  _gableGeo.scale(1, 1 / 1.5, 1 / 1.7320508);
  var _domeGeo = new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  var _cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  _cylGeo.translate(0, 0.5, 0);
  var _tankGeo = new THREE.CylinderGeometry(0.5, 0.55, 1, 10);
  _tankGeo.translate(0, 0.5, 0);

  // Lowrise massing: slab | stepped | L | podium+tower. Returns
  // {parts, top} — top is the highest part (roofs/props sit on it).
  function _lowriseParts(b) {
    var parts = [], top;
    var r = rng3();
    if (r < 0.30) {
      parts.push({ x: b.x, z: b.z, y: 0, w: b.w, d: b.d, h: b.h, color: _WHITE });
      top = { x: b.x, z: b.z, y: b.h, w: b.w, d: b.d };
      _w7bump('massing', 'lowrise|slab');
    } else if (r < 0.60) {
      var h1 = b.h * rr3(0.55, 0.7), s = rr3(0.62, 0.8);
      parts.push({ x: b.x, z: b.z, y: 0, w: b.w, d: b.d, h: h1, color: _WHITE });
      parts.push({ x: b.x, z: b.z, y: h1, w: b.w * s, d: b.d * s, h: b.h - h1, color: _WHITE });
      top = { x: b.x, z: b.z, y: b.h, w: b.w * s, d: b.d * s };
      _w7bump('massing', 'lowrise|stepped');
    } else if (r < 0.80) {
      var split = rr3(0.55, 0.7), hW = b.h * rr3(0.55, 0.8);
      var wM = b.w * split, wW = b.w - wM, dW = b.d * rr3(0.5, 0.75);
      var sx = (rng3() < 0.5 ? -1 : 1), sz = (rng3() < 0.5 ? -1 : 1);
      parts.push({ x: b.x - sx * (b.w / 2 - wM / 2), z: b.z, y: 0, w: wM, d: b.d, h: b.h, color: _WHITE });
      parts.push({ x: b.x + sx * (b.w / 2 - wW / 2), z: b.z + sz * (b.d / 2 - dW / 2), y: 0, w: wW, d: dW, h: hW, color: _WHITE });
      top = { x: b.x - sx * (b.w / 2 - wM / 2), z: b.z, y: b.h, w: wM, d: b.d };
      _w7bump('massing', 'lowrise|L');
    } else {
      var hP = b.h * rr3(0.28, 0.38), s2 = rr3(0.55, 0.7);
      parts.push({ x: b.x, z: b.z, y: 0, w: b.w, d: b.d, h: hP, color: _WHITE });
      parts.push({ x: b.x, z: b.z, y: hP, w: b.w * s2, d: b.d * s2, h: b.h - hP, color: _WHITE });
      top = { x: b.x, z: b.z, y: b.h, w: b.w * s2, d: b.d * s2 };
      _w7bump('massing', 'lowrise|podium');
    }
    return { parts: parts, top: top };
  }
  // Roof on a lowrise top: flat (+ AC / water tank) | pyramid | gable | dome.
  function _lowriseRoof(b, top) {
    var r = rng3();
    if (r < 0.42) {
      if (rng3() < 0.55) {
        _roofAC.push({ x: top.x + rr3(-1, 1), y: top.y + 0.35, z: top.z + rr3(-1, 1), ry: 0, w: 1.3, h: 0.7, d: 1.0 });
      }
      if (rng3() < 0.30) {
        _tanks.push({ x: top.x + rr3(-2, 2), y: top.y, z: top.z + rr3(-2, 2), w: 1.7, h: 2.1, d: 1.7 });
      }
      _w7bump('roofs', 'lowrise|flat');
    } else if (r < 0.62) {
      // Pyramid roofs join the existing `roofs` cone mesh (built below);
      // the roof takes the building's own facade colour, so districts
      // read apart from directly above too.
      roofs.push({ x: top.x, y: top.y, z: top.z, w: top.w, d: top.d, color: b.color });
      _w7bump('roofs', 'lowrise|pyramid');
    } else if (r < 0.82) {
      _gableRoofs.push({ x: top.x, y: top.y, z: top.z, ry: (rng3() < 0.5 ? 0 : Math.PI / 2), w: Math.max(top.w, top.d) * 1.02, h: rr3(1.8, 3.0), d: Math.min(top.w, top.d) * 1.02, color: b.color });
      _w7bump('roofs', 'lowrise|gable');
    } else {
      var dw = Math.min(top.w, top.d) * 0.55;
      _domes.push({ x: top.x, y: top.y, z: top.z, w: dw, h: dw * 0.55, d: dw, color: b.color });
      _w7bump('roofs', 'lowrise|dome');
    }
  }
  // Street arcade: colonnade + fascia slab along the street face
  // (Pasar Lentera / Golden Pier shophouses).
  function _arcade(b) {
    if (b.district !== 'Pasar Lentera' && b.district !== 'Golden Pier') return;
    if (rng3() >= 0.35) return;
    var f = streetFace(b);
    var faceW = f.aw * 2;
    var nCol = Math.max(2, Math.floor(faceW / 2.6));
    for (var ci = 0; ci <= nCol; ci++) {
      var off = -faceW / 2 + 0.6 + (faceW - 1.2) * (ci / nCol);
      _arcCols.push({
        x: b.x + f.fx * (f.hw + 1.6) + (f.fx === 0 ? off : 0),
        y: 1.6,
        z: b.z + f.fz * (f.hw + 1.6) + (f.fz === 0 ? off : 0),
        w: 0.35, h: 3.2, d: 0.35
      });
    }
    _arcSlabs.push({
      x: b.x + f.fx * (f.hw + 1.0), y: 3.2, z: b.z + f.fz * (f.hw + 1.0),
      ry: f.ry, w: faceW + 0.6, h: 0.25, d: 2.4, color: b.color
    });
    _arcSpots.push({ x: b.x, z: b.z, district: b.district });
    _w7bump('massing', 'lowrise|arcade');
  }
  // Towers: tapered setbacks (3 shrinking segments) or a round drum
  // on a box podium (the curved silhouette).
  function _towerParts(t) {
    var parts = [];
    if (rng3() < 0.20) {
      var hB = t.h * rr3(0.5, 0.6);
      var dia = Math.min(t.w, t.d) * 0.84;
      parts.push({ x: t.x, z: t.z, y: 0, w: t.w, d: t.d, h: hB, color: _WHITE });
      _towerCyl.push({ x: t.x, y: hB, z: t.z, w: dia, h: t.h - hB, d: dia, color: t.color });
      _w7bump('massing', 'tower|round');
      return parts;
    }
    var h1 = t.h * rr3(0.45, 0.55), h2 = t.h * rr3(0.28, 0.35), h3 = t.h - h1 - h2;
    var s1 = rr3(0.72, 0.82), s2 = rr3(0.55, 0.68);
    parts.push({ x: t.x, z: t.z, y: 0, w: t.w, d: t.d, h: h1, color: _WHITE });
    parts.push({ x: t.x, z: t.z, y: h1, w: t.w * s1, d: t.d * s1, h: h2, color: _WHITE });
    parts.push({ x: t.x, z: t.z, y: h1 + h2, w: t.w * s2, d: t.d * s2, h: h3, color: _WHITE });
    _w7bump('massing', 'tower|setback');
    return parts;
  }

  // ---------- MAP v2 OSM METHOD — POLYGON FOOTPRINTS (r5 W5) ----------
  // Method learned from the OSM article (ideas only — no real OSM data,
  // no copied code; everything below was written fresh in this session):
  // a building is a POLYGON (an irregular footprint) extruded to its
  // height, and merged per material into ONE mesh per group. The polygon
  // is generated from W7's massing parts (not from the placement rects):
  // each part gets a chamfered-rect outline (8 vertices) from its own
  // seeded PRNG — the outline is contained in the part's rect, so the
  // clearance guard (which checked the rect) still holds, and the
  // blocker registered here is the same rect buildBoxes used. The
  // footprints are exposed as VR.Buildings.footprints so the minimap
  // can draw the real outlines instead of the generated mix.
  var _footprints = []; // {pts: [[x,z],...], district} world-space polygons
  var _polyN = 0; // per-part seed counter (deterministic, fixed order)
  function _mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Chamfered rect, local (x,z), centred on the part, CCW in (x,z).
  // Each corner is cut by a seeded amount (0..25% of the smaller side).
  function _chamferPoly(w, d, seed) {
    var r = _mulberry32(seed);
    var hw = w / 2, hd = d / 2, m = Math.min(w, d) * 0.25;
    var c = [r() * m, r() * m, r() * m, r() * m];
    return [
      [-hw + c[0], -hd], [hw - c[1], -hd], [hw, -hd + c[1]],
      [hw, hd - c[2]], [hw - c[2], hd], [-hw + c[3], hd],
      [-hw, hd - c[3]], [-hw, -hd + c[0]]
    ];
  }
  function _signedArea2(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  // UVs: each side wall gets the full facade texture (like a box face);
  // the caps get a single solid patch — the facade texture's corner is
  // pure base colour with no windows, so the roof reads as a flat roof
  // in the aerial and does not glow at night.
  var _polySolidUV = new THREE.Vector2(0.02, 0.02);
  var _polyUVGen = {
    generateTopUV: function () { return [_polySolidUV, _polySolidUV, _polySolidUV]; },
    generateSideWallUV: function () {
      return [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0),
              new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)];
    }
  };
  function _extrudePart(part) {
    var pts = _chamferPoly(part.w, part.d, 900000 + (_polyN++) * 7919);
    var sp = pts.map(function (p) { return [p[0], -p[1]]; });
    if (_signedArea2(sp) < 0) sp = sp.reverse(); // CCW in shape space
    var shape = new THREE.Shape(sp.map(function (p) { return new THREE.Vector2(p[0], p[1]); }));
    var g = new THREE.ExtrudeGeometry(shape, { depth: part.h, bevelEnabled: false, UVGenerator: _polyUVGen });
    g.rotateX(-Math.PI / 2);
    g.translate(part.x, part.y || 0, part.z);
    var world = pts.map(function (p) { return [p[0] + part.x, p[1] + part.z]; });
    return { geo: g, pts: world };
  }
  // One merged mesh per material group (the article's merge-per-material,
  // written fresh here as a manual attribute concatenation — no utility
  // copied from anywhere). Replaces buildBoxes for the main masses only;
  // crowns, containers, tents and props keep their existing builders.
  function _buildPolygons(list, material, district) {
    if (!list.length) return;
    var geoms = [], i, k, m;
    for (i = 0; i < list.length; i++) {
      var pt = list[i];
      var out = _extrudePart(pt);
      geoms.push(out.geo);
      _footprints.push({ pts: out.pts, district: district });
      // Same rect blocker buildBoxes registered (the polygon is inside it).
      VR.World.registerBlocker(pt.x, pt.z, pt.w / 2 + 0.4, pt.d / 2 + 0.4);
    }
    var n = 0;
    for (k = 0; k < geoms.length; k++) n += geoms[k].attributes.position.count;
    var P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    var o3 = 0, o2 = 0;
    for (m = 0; m < geoms.length; m++) {
      var g = geoms[m];
      P.set(g.attributes.position.array, o3);
      N.set(g.attributes.normal.array, o3);
      U.set(g.attributes.uv.array, o2);
      o3 += g.attributes.position.count * 3;
      o2 += g.attributes.uv.count * 2;
      g.dispose();
    }
    var merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(P, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    var mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Group lowrise parts by (district, variant) — one InstancedMesh
  // per group with that variant's facade material.
  var _groups = {};
  for (var _gi = 0; _gi < lowrise.length; _gi++) {
    var _lb2 = lowrise[_gi];
    var _ex = _lowriseParts(_lb2);
    for (var _pi = 0; _pi < _ex.parts.length; _pi++) {
      var _pt = _ex.parts[_pi];
      _w7rect(_pt.x, _pt.z, _pt.w, _pt.d);
      var _key = _lb2.district + '|' + _lb2.variant;
      (_groups[_key] = _groups[_key] || []).push(_pt);
    }
    _lowriseRoof(_lb2, _ex.top);
    _arcade(_lb2);
  }
  var _tGroups = {};
  for (var _tj = 0; _tj < towers.length; _tj++) {
    var _tw3 = towers[_tj];
    var _tps = _towerParts(_tw3);
    for (var _pj = 0; _pj < _tps.length; _pj++) {
      var _tp = _tps[_pj];
      _w7rect(_tp.x, _tp.z, _tp.w, _tp.d);
      (_tGroups[_tw3.tint] = _tGroups[_tw3.tint] || []).push(_tp);
    }
  }
  for (var _gk in _groups) {
    var _ds = _gk.split('|');
    _buildPolygons(_groups[_gk], facadeMat(_ds[0], +_ds[1]), _ds[0]);
  }
  for (var _tk in _tGroups) {
    _buildPolygons(_tGroups[_tk], facadeMat('Highrise Plaza', +_tk), 'Highrise Plaza');
  }
  for (var _wh2 = 0; _wh2 < warehouses.length; _wh2++) {
    var _ww2 = warehouses[_wh2];
    _w7rect(_ww2.x, _ww2.z, _ww2.w, _ww2.d);
    if (_ww2.roof === 'gable') {
      _gableRoofs.push({ x: _ww2.x, y: _ww2.h, z: _ww2.z, ry: (rng3() < 0.5 ? 0 : Math.PI / 2), w: Math.max(_ww2.w, _ww2.d) * 1.02, h: rr3(2.5, 4.0), d: Math.min(_ww2.w, _ww2.d) * 1.02, color: _ww2.color });
    } else if (_ww2.roof === 'flat' && rng3() < 0.6) {
      _roofAC.push({ x: _ww2.x + rr3(-4, 4), y: _ww2.h + 0.35, z: _ww2.z + rr3(-3, 3), ry: 0, w: 1.6, h: 0.7, d: 1.2 });
    }
  }
  // Warehouses keep their per-building colour: group by colour and
  // build one polygon mesh per colour (a single merged mesh cannot
  // carry per-part colours — the first polygon version rendered them
  // all white, a regression from buildBoxes' setColorAt).
  var _whGroups = {};
  for (var _wh3 = 0; _wh3 < warehouses.length; _wh3++) {
    var _ww3 = warehouses[_wh3];
    (_whGroups[_ww3.color] = _whGroups[_ww3.color] || []).push(_ww3);
  }
  for (var _wc in _whGroups) {
    _buildPolygons(_whGroups[_wc], stdMat({ color: +_wc, roughness: 0.9, metalness: 0.05 }), 'Industrial Dockyard');
  }
  buildBoxes(containers, stdMat({ roughness: 0.7, metalness: 0.15 }), true);
  // Roof shapes + rooftop props + arcades + round drums.
  buildProps(_gableRoofs, _gableGeo, stdMat({ color: 0xffffff, roughness: 0.9, metalness: 0 }), true);
  buildProps(_domes, _domeGeo, stdMat({ color: 0xffffff, roughness: 0.8, metalness: 0 }), true);
  buildProps(_roofAC, null, stdMat({ color: 0xb8bec6, roughness: 0.7, metalness: 0.3 }), false);
  buildProps(_tanks, _tankGeo, stdMat({ color: P.tankRust, roughness: 0.9, metalness: 0.1 }), false);
  buildProps(_arcCols, null, stdMat({ color: 0xb8bec6, roughness: 0.7, metalness: 0.3 }), false);
  buildProps(_arcSlabs, null, stdMat({ roughness: 0.85, metalness: 0 }), true);
  buildProps(_towerCyl, _cylGeo, stdMat({ color: 0xffffff, roughness: 0.4, metalness: 0.05 }), true);

  // ---------- art-pass detail builds ----------
  var _propGrey = stdMat({ color: 0xb8bec6, roughness: 0.7, metalness: 0.3 });
  var _propDark = stdMat({ color: 0x2c313a, roughness: 0.7, metalness: 0.4 });
  // Tower crowns, grouped by glass tint like the towers themselves.
  var _cGroups = {};
  for (var _ci3 = 0; _ci3 < crowns.length; _ci3++) {
    var _cr = crowns[_ci3];
    _w7rect(_cr.x, _cr.z, _cr.w, _cr.d);
    (_cGroups[_cr.tint] = _cGroups[_cr.tint] || []).push({ x: _cr.x, z: _cr.z, y: _cr.y, w: _cr.w, h: _cr.h, d: _cr.d, color: _WHITE });
  }
  for (var _ck in _cGroups) buildBoxes(_cGroups[_ck], facadeMat('Highrise Plaza', +_ck), true);
  if (roofs.length) {
    var _roofGeo = new THREE.ConeGeometry(1, 1, 4);
    _roofGeo.rotateY(Math.PI / 4);
    _roofGeo.translate(0, 0.5, 0); // base sits on the warehouse top
    var _roofMesh = new THREE.InstancedMesh(_roofGeo,
      stdMat({ color: 0xffffff, roughness: 0.9, metalness: 0 }), roofs.length);
    _roofMesh.castShadow = true;
    for (var _ri = 0; _ri < roofs.length; _ri++) {
      var _rf = roofs[_ri];
      dummy.position.set(_rf.x, _rf.y, _rf.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(_rf.w * 0.72, 3.2, _rf.d * 0.72);
      dummy.updateMatrix();
      _roofMesh.setMatrixAt(_ri, dummy.matrix);
      _roofMesh.setColorAt(_ri, _col.setHex(_rf.color || 0x5a4632));
    }
    _roofMesh.instanceMatrix.needsUpdate = true;
    if (_roofMesh.instanceColor) _roofMesh.instanceColor.needsUpdate = true;
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
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.1, emissive: 0x2a6a7a, emissiveIntensity: 0.55, flatShading: true }),
    true);
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

  // ---------- palms: createPalmTree — rib skeleton + leaf cards ----------
  // RESEARCH v2 (research-visual-reference.md, §3 — shaal + FoliMesh):
  // "Blobs look like broccoli. Build a branch skeleton recursively,
  // then put alpha-tested leaf cards at the twig ends." So NO solid
  // blade/cone per frond: each frond is a CURVED RIB (thin tube: base
  // RISES 25-55 deg, middle FLAT, tip DROOPS 70-80 deg) + LEAF CARDS
  // (thin pointed leaflets) along the rib, splayed left/right with a
  // shallow V-fold like a feather. Trunk: single, slight lean, TAPERING
  // (wide at the base), leaf-scar rings + flared collar at the base.
  // Fronds sit at VARIED angles + heights, never one flat plane.
  // Frond arc ~5.0 long (~60% of the ~8-unit trunk — above the 45%
  // research target), so the crown is a FULL layered umbrella ~7 units
  // across, wider than the slim trunk. Cards are solid (no leaf texture
  // exists to alpha-test); DoubleSide on the card material only, so a
  // card reads from both sides — a geometric necessity, not a colour
  // or polish change (same precedent as the DoubleSide sign planes).
  var palmCount = palms.length;
  function hash01(n) {
    var h = (n * 374761393 + 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  // Trunk: 3 stacked cylinders, progressive bend 13-20 deg total, away
  // from the nearest building (toward street/sea). Radii match at joints.
  // SLIMMED ~18% vs the old radii so the crown dominates, not the trunk.
  var TRUNK_LEN = [3.2, 2.8, 2.4]; // geometry lengths (0.2 overlap)
  var TRUNK_ADV = [3.0, 2.6, 2.4]; // advance between segment bases
  var TRUNK_TILT = [0.35, 0.7, 1.0]; // progressive fraction of the bend
  var TRUNK_RAD = [[0.28, 0.41], [0.25, 0.28], [0.21, 0.25]]; // [top, bottom]
  var trunkMat = stdMat({ color: P.palmTrunk, roughness: 1, metalness: 0 });
  var trunkMeshes = [];
  for (var _ti = 0; _ti < 3; _ti++) {
    var _tg = new THREE.CylinderGeometry(TRUNK_RAD[_ti][0], TRUNK_RAD[_ti][1], TRUNK_LEN[_ti], 6);
    _tg.translate(0, TRUNK_LEN[_ti] / 2, 0);
    var _tm = new THREE.InstancedMesh(_tg, trunkMat, palmCount);
    _tm.castShadow = true;
    trunkMeshes.push(_tm);
  }
  // Collar: flared ring at the trunk base (leaf-base flare of a real palm).
  var collarGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.5, 8);
  collarGeo.translate(0, 0.25, 0);
  var collarMesh = new THREE.InstancedMesh(collarGeo, trunkMat, palmCount);
  collarMesh.castShadow = true;
  // Leaf-scar rings: thin bands proud of the trunk at the two segment
  // joints. Unit-radius cylinder; per-instance X/Z scale sets the radius
  // (0.31 at joint 0, 0.28 at joint 1 — just proud of the trunk surface).
  var RING_RAD = [0.31, 0.28];
  var ringGeo = new THREE.CylinderGeometry(1, 1, 0.14, 8);
  var ringMesh = new THREE.InstancedMesh(ringGeo, trunkMat, palmCount * 2);
  // Rib: ONE shared thin tube, unit height, base at the origin — each
  // frond writes 3 instances of it (one per arc phase), scaled in Y to
  // the phase length. Radius tapers 0.06 -> 0.035 along each segment
  // (W2b r2: was 0.10 -> 0.06 — read as a green girder, not a thin rib;
  // thinned ~40% but still visible at normal distance. W2c r3: 0.035 ->
  // 0.028 / 0.06 -> 0.05 — another ~20% so the rib reads as a vein,
  // not a beam, in the 7-unit close-up; still thick enough to see.)
  var ribGeo = new THREE.CylinderGeometry(0.028, 0.05, 1, 6);
  ribGeo.translate(0, 0.5, 0);
  var ribMesh = new THREE.InstancedMesh(ribGeo,
    stdMat({ color: P.palmLeaf, roughness: 0.9, metalness: 0 }),
    palmCount * 6 * 3);
  ribMesh.castShadow = true;
  // Leaf card: ONE shared pointed leaflet (unit length along +Y, max
  // width ~0.84, widest low, pointed tip), laid flat in the XY plane.
  // Per frond: 5 stations along the rib x 2 sides = 10 cards, splayed
  // outward-forward from the rib with a shallow V-fold tilt, widest
  // mid-frond, smallest at the tip — a feather, not a board.
  var _leafShape = new THREE.Shape();
  _leafShape.moveTo(0, 0);
  _leafShape.quadraticCurveTo(0.42, 0.25, 0.30, 0.62);
  _leafShape.quadraticCurveTo(0.20, 0.88, 0, 1.0);
  _leafShape.quadraticCurveTo(-0.20, 0.88, -0.30, 0.62);
  _leafShape.quadraticCurveTo(-0.42, 0.25, 0, 0);
  var leafGeo = new THREE.ShapeGeometry(_leafShape, 6);
  var leafMesh = new THREE.InstancedMesh(leafGeo,
    stdMat({ color: P.palmLeaf, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    palmCount * 6 * 10);
  leafMesh.castShadow = true;
  // Card stations along the rib arc (arc length 1.5 + 1.6 + 1.9 = 5.0):
  // [arc distance, length, width]. Length also scales with the frond's
  // lenF; width/length scale with p.scale. W2b r2: the two TOP stations
  // (arc 0.7 / 1.6 — highest in the crown, on the rising phase) were
  // giant dark paddles dominating the crown, so they are ~45% smaller
  // AND narrower than the mid-frond cards (0.75/0.32 and 0.90/0.40 vs
  // the old 1.3/0.55 and 1.6/0.70); the widest cards now sit mid-frond.
  // W2c r3: station 2 was the one left untouched and it moved into the
  // camera-facing frond as the new giant paddle, so it is cut the same
  // way (1.6/0.70 -> 1.1/0.45); station 3 narrowed a touch too
  // (1.3/0.55 -> 1.15/0.48). Widest card is now station 3, mid-frond.
  var LEAF_ST = [[0.7, 0.75, 0.32], [1.6, 0.90, 0.40], [2.5, 1.1, 0.45], [3.4, 1.15, 0.48], [4.3, 0.9, 0.40]];
  var LEAF_SPREAD = 1.00; // leaflet angle out from the rib (~57 deg — was 0.70/40 deg:
  // at 40 deg the two sides projected onto each other from the side and
  // each frond read as ONE solid flat blade; wider splay separates the
  // sides into a visible 3D feather)
  var LEAF_FOLD = 0.85; // V-fold tilt around the leaflet axis (~49 deg — was 0.61/35 deg:
  // deeper fold gives the frond vertical thickness from the side instead
  // of a flat board silhouette)
  // Coconuts: 3 small spheres tucked under the crown.
  var nutGeo = new THREE.SphereGeometry(0.32, 6, 5);
  var nutMesh = new THREE.InstancedMesh(nutGeo,
    stdMat({ color: 0x6b4a2a, roughness: 1, metalness: 0 }), palmCount * 3);

  // Shared scratch + instance cursors for createPalmTree (it writes into
  // the shared instanced meshes — no per-palm Group, no extra draw calls).
  var _bendAxis = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _v = new THREE.Vector3();
  var _s = new THREE.Vector3();
  var _m = new THREE.Matrix4();
  var _up = new THREE.Vector3(0, 1, 0);
  var _dir = new THREE.Vector3(); // rib phase A direction (rising)
  var _dirB = new THREE.Vector3(); // rib phase B direction (flat)
  var _dirC = new THREE.Vector3(); // rib phase C direction (drooping)
  var _qB = new THREE.Quaternion();
  var _qC = new THREE.Quaternion();
  var _jnt = new THREE.Vector3(); // joint 1: rib phase A -> B
  var _jnt2 = new THREE.Vector3(); // joint 2: rib phase B -> C
  var _sd = new THREE.Vector3(); // frond-plane normal (leaflet side axis)
  var _sp = new THREE.Vector3(); // leaflet station position on the rib
  var _cd = new THREE.Vector3(); // leaflet long axis
  var _cn = new THREE.Vector3(); // leaflet plane normal
  var _cx = new THREE.Vector3(); // leaflet width axis
  var _qL = new THREE.Quaternion(); // leaflet fold rotation
  var _bi = 0, _ci = 0, _ni = 0, _ri = 0;

  // Builds ONE palm (p from palms[], pi its index) into the shared
  // instanced meshes: 3 trunk segments + 6 drooping fronds + 3 nuts.
  function createPalmTree(p, pi) {
    // Trunk: bend away from the building, 13-20 deg total.
    var bendBase = Math.atan2(-(p.ix || 0), -(p.iz || 0));
    if ((p.ix || 0) === 0 && (p.iz || 0) === 0) bendBase = hash01(pi * 2 + 1) * Math.PI * 2;
    var bendDir = bendBase + (hash01(pi * 2 + 3) - 0.5) * 1.2;
    var bendMag = 0.23 + hash01(pi * 2 + 2) * 0.12; // 13-20 deg total
    var bdx = Math.sin(bendDir), bdz = Math.cos(bendDir);
    _bendAxis.set(Math.cos(bendDir), 0, -Math.sin(bendDir));
    // Flared collar at the trunk base.
    _v.set(p.x, 0, p.z); _q.identity(); _s.set(p.scale, p.scale, p.scale);
    _m.compose(_v, _q, _s);
    collarMesh.setMatrixAt(pi, _m);
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
      // Leaf-scar ring at the joint (top of this segment), same tilt.
      if (si < 2) {
        _v.set(bx, by, bz);
        _s.set(p.scale * RING_RAD[si], p.scale, p.scale * RING_RAD[si]);
        _m.compose(_v, _q, _s);
        ringMesh.setMatrixAt(_ri++, _m);
      }
    }
    // Crown position (top of the leaning trunk).
    var crownX = bx;
    var crownY = by + 0.6 * p.scale;
    var crownZ = bz;
    // Umbrella crown: exactly 6 fronds, radial fan. Each frond is a
    // 3-phase RIB (base RISES 25-55 deg — W2b r2: was 35-45, too narrow
    // a band for a dome — middle FLAT -5..+2 deg, tip DROOPS 70-80 deg
    // — the droop lives at the tip, not along the whole blade) + 10
    // LEAF CARDS along it, so the crown reads as a FULL layered
    // umbrella, never 6 short swords or a broccoli blob. Tip always
    // ends below its base: worst case the rise lifts 1.5*sin55 = 1.23
    // and the flat adds 1.6*sin2 = 0.06, while the droop drops
    // 1.9*sin70 = 1.79. Fronds sit at VARIED heights (+/-0.9 — W2b r2:
    // was +/-0.35, still one flat plane) and yaw jitter (+/-8 deg),
    // never one flat plane: a LAYERED DOME, not a flat fan. The fan is
    // offset half a step from the inward diagonal, so no blade aims
    // straight at a facade.
    var inward = Math.atan2(-(p.ix || 0), -(p.iz || 0));
    for (var f = 0; f < 6; f++) {
      var yaw = inward + (f + 0.5) * (Math.PI * 2 / 6) + (hash01(pi * 12 + f * 3 + 17) - 0.5) * 0.28;
      var rise = (25 + hash01(pi * 12 + f * 3 + 5) * 30) * Math.PI / 180;
      var flat = (-5 + hash01(pi * 12 + f * 3 + 19) * 7) * Math.PI / 180;
      var droop = (70 + hash01(pi * 12 + f * 3 + 13) * 10) * Math.PI / 180;
      var lenF = 0.92 + hash01(pi * 12 + f * 3 + 9) * 0.16;
      var sy = p.scale * lenF; // arc-length scale along the rib
      _v.set(crownX, crownY + (hash01(pi * 12 + f * 3 + 7) - 0.5) * 1.8, crownZ);
      _col.setHex(P.palmLeaf).offsetHSL(0, 0, (hash01(pi * 12 + f * 3 + 11) - 0.5) * 0.08);
      // Rib phase A: up at `rise`. Joint 1 = its end.
      _dir.set(Math.sin(yaw) * Math.cos(rise), Math.sin(rise), Math.cos(yaw) * Math.cos(rise));
      _q.setFromUnitVectors(_up, _dir);
      _s.set(p.scale, 1.5 * sy, p.scale);
      _m.compose(_v, _q, _s);
      ribMesh.setMatrixAt(_bi, _m);
      ribMesh.setColorAt(_bi, _col);
      _bi++;
      _jnt.copy(_v).addScaledVector(_dir, 1.5 * sy);
      // Rib phase B: flat. Joint 2 = its end.
      _dirB.set(Math.sin(yaw) * Math.cos(flat), Math.sin(flat), Math.cos(yaw) * Math.cos(flat));
      _qB.setFromUnitVectors(_up, _dirB);
      _s.set(p.scale, 1.6 * sy, p.scale);
      _m.compose(_jnt, _qB, _s);
      ribMesh.setMatrixAt(_bi, _m);
      ribMesh.setColorAt(_bi, _col);
      _bi++;
      _jnt2.copy(_jnt).addScaledVector(_dirB, 1.6 * sy);
      // Rib phase C: drooping to the tip.
      _dirC.set(Math.sin(yaw) * Math.cos(droop), -Math.sin(droop), Math.cos(yaw) * Math.cos(droop));
      _qC.setFromUnitVectors(_up, _dirC);
      _s.set(p.scale, 1.9 * sy, p.scale);
      _m.compose(_jnt2, _qC, _s);
      ribMesh.setMatrixAt(_bi, _m);
      ribMesh.setColorAt(_bi, _col);
      _bi++;
      // Leaf cards: 5 stations along the rib arc, one leaflet per side.
      // Side axis = frond-plane normal (horizontal, perpendicular to yaw).
      _sd.set(Math.cos(yaw), 0, -Math.sin(yaw));
      for (var st = 0; st < 5; st++) {
        var arc = LEAF_ST[st][0];
        var aLen = Math.min(arc, 1.5), bLen = Math.max(0, Math.min(arc - 1.5, 1.6)), cLen = Math.max(0, arc - 3.1);
        _sp.copy(_v).addScaledVector(_dir, aLen * sy).addScaledVector(_dirB, bLen * sy).addScaledVector(_dirC, cLen * sy);
        // Phase direction at this station (leaflet long axis follows it).
        var pd = (arc < 1.5) ? _dir : (arc < 3.1 ? _dirB : _dirC);
        for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
          // Long axis: rib direction splayed outward-forward by SPREAD.
          _cd.copy(pd).multiplyScalar(Math.cos(LEAF_SPREAD)).addScaledVector(_sd, sd2 * Math.sin(LEAF_SPREAD)).normalize();
          // Plane normal: frond-plane normal, orthogonalised against the
          // long axis, then tilted around it by FOLD (V-fold, mirrored).
          _cn.copy(_sd).addScaledVector(_cd, -_sd.dot(_cd)).normalize();
          _qL.setFromAxisAngle(_cd, sd2 * LEAF_FOLD);
          _cn.applyQuaternion(_qL);
          _cx.crossVectors(_cd, _cn);
          _m.makeBasis(_cx, _cd, _cn);
          _m.setPosition(_sp);
          _s.set(LEAF_ST[st][2] * p.scale, LEAF_ST[st][1] * sy, 1);
          _m.scale(_s);
          leafMesh.setMatrixAt(_ci, _m);
          leafMesh.setColorAt(_ci, _col.setHex(P.palmLeaf).offsetHSL(0, 0, (hash01(pi * 60 + f * 10 + st * 2 + (sd2 + 1) / 2 + 23) - 0.5) * 0.10));
          _ci++;
        }
      }
    }
    // Coconuts under the crown.
    for (var cn = 0; cn < 3; cn++) {
      var a = cn * 2.1;
      _v.set(crownX + Math.cos(a) * 0.5, crownY - 0.4, crownZ + Math.sin(a) * 0.5);
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_v, _q, _s);
      nutMesh.setMatrixAt(_ni++, _m);
    }
    VR.World.registerCircle(p.x, p.z, 0.8);
  }
  for (var pi = 0; pi < palmCount; pi++) {
    createPalmTree(palms[pi], pi);
  }
  for (var _ti2 = 0; _ti2 < 3; _ti2++) {
    trunkMeshes[_ti2].instanceMatrix.needsUpdate = true;
    scene.add(trunkMeshes[_ti2]);
  }
  ribMesh.instanceMatrix.needsUpdate = true;
  if (ribMesh.instanceColor) ribMesh.instanceColor.needsUpdate = true;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  collarMesh.instanceMatrix.needsUpdate = true;
  ringMesh.instanceMatrix.needsUpdate = true;
  nutMesh.instanceMatrix.needsUpdate = true;
  scene.add(ribMesh);
  scene.add(leafMesh);
  scene.add(collarMesh);
  scene.add(ringMesh);
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
    // MAP v2 clearance guard (r5 W5): footprints dropped for overlapping
    // a road corridor (avenue / ring / beach road / crescent / grid).
    clearanceSkipped: _skipped,
    footprints: _footprints, // OSM method: real polygon outlines for the minimap
    // W7 (r5): variant / massing / roof distribution, massing-vs-road
    // clearance proof (0 violations expected — every massing part is
    // contained in its guard-validated footprint rect), and every
    // built part's rect for independent verification.
    w7stats: _w7stats,
    massingClearanceViolations: _massingViolations,
    massingRects: _massingRects,
    arcadeSpots: _arcSpots,
    // Night window glow: 0 at day, full at night. The emissive maps
    // are black except the lit windows, so only windows glow.
    setNightness: function (n) {
      for (var i = 0; i < _allFacadeMats.length; i++) _allFacadeMats[i].emissiveIntensity = n * 0.95;
    }
  };

})(window.VR = window.VR || {});
