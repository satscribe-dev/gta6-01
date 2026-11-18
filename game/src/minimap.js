// minimap.js — VR.Minimap: round radar minimap for VANDARA RUSH.
// The static city map is rendered ONCE to an offscreen canvas (sea,
// beach, parks, building blocks, road network from VR.Roads when
// present, grid fallback from VR.Config). Each frame the view is
// clipped to a circle, rotated by camera yaw, and dynamic blips are
// drawn (player arrow, rotating N, police, mission target, shops,
// police search circle). Also owns the Health/Armour bars beside the
// minimap and the district-name label. All cross-slice reads are
// guarded with `if (VR.X)`.
(function (VR) {
  'use strict';

  var C = VR.Config || {};
  // VR.State is created by main.js, which loads AFTER this file, so
  // never capture it at load time: a live proxy reads/writes the
  // real State object on every access.
  var S = new Proxy({}, {
    get: function (_, k) { return VR.State ? VR.State[k] : undefined; },
    set: function (_, k, v) { if (VR.State) VR.State[k] = v; return true; }
  });

  var canvas = document.getElementById('minimap-canvas');
  if (!canvas) return; // minimap DOM is added by slice C's index.html edit
  var ctx = canvas.getContext('2d');

  var SIZE = 190;              // CSS pixels; canvas backing is 2x for sharpness
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * DPR;
  canvas.height = SIZE * DPR;

  // Static map covers world [-260, 260] so the western sea strip is visible.
  var MAP_SPAN = 520;
  var STATIC = 512;
  var off = document.createElement('canvas');
  off.width = STATIC;
  off.height = STATIC;

  // Deterministic hash for building-block variation (stable every load).
  function hash2(i, j) {
    var h = (i * 374761393 + j * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function w2m(v) { return (v + MAP_SPAN / 2) / MAP_SPAN * STATIC; }

  // Rounded-rectangle path (own helper: no ctx.roundRect dependency).
  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h);
    g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r);
    g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }

  // West shoreline of Vandara Bay — the ONE coastline, defined in
  // world.js (VR.World.coastX): sine bay + peninsula at z~-110 +
  // inlet cove at z~+95, clamped to [-258,-238]. The minimap reads it
  // so the pause map and the 3D ground can never disagree. Fallback
  // is the same formula, in case world.js is absent.
  function coastX(z) {
    if (VR.World && VR.World.coastX) return VR.World.coastX(z);
    var base = -247 + 6 * Math.sin(z * 0.021 + 0.8) + 3 * Math.sin(z * 0.047 + 1.9);
    var v = base - 6 * Math.exp(-Math.pow((z + 110) / 32, 2))
      + 7 * Math.exp(-Math.pow((z - 95) / 30, 2));
    if (v < -258) v = -258;
    if (v > -238) v = -238;
    return v;
  }

  // Traces the city-land outline (east of the beach band) as a path.
  function traceLand(g) {
    g.beginPath();
    for (var lz = -260; lz <= 260; lz += 10) {
      var lx = w2m(coastX(lz) + 10);
      if (lz === -260) g.moveTo(lx, w2m(lz)); else g.lineTo(lx, w2m(lz));
    }
    g.lineTo(STATIC, w2m(260));
    g.lineTo(STATIC, w2m(-260));
    g.closePath();
  }

  var BLOCK_COLORS = ['#c96f4a', '#e8d5a8', '#7fc8a9', '#2e8b8b',
    '#d9a05b', '#b8c4a8', '#c98a7a', '#8fb8a8'];

  // Render the static map once. `g` is any 2d context, `size` its
  // pixel size; the same routine paints the pause-menu full map.
  // ORGANIC MAP (Nov 18 overhaul, footprint mix reworked): no more
  // checkerboard of square blocks. The west edge is a curving bay
  // (Vandara Bay), districts read as soft tinted ellipse blobs,
  // building footprints are an organic mix — big park clearings,
  // long merged slabs, curved elliptical blocks and singles of
  // strongly varied size/offset — parks are blobs, thin dotted
  // alleys thread the blocks, and a diagonal pier jetty reaches into
  // the sea. The world->map transform (w2m) stays linear, so the
  // player arrow, mission target and police blips stay exact — only
  // the land styling is organic, never the positions.
  function drawStaticMap(g, size) {
    var k = size / STATIC; // scale from static pixels to target pixels
    g.save();
    g.scale(k, k);
    // Sea (whole canvas) — deep bay teal.
    g.fillStyle = '#1f8f8a';
    g.fillRect(0, 0, STATIC, STATIC);
    // Subtle wave arcs in the bay (decorative, deterministic).
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 2;
    for (var wv = 0; wv < 5; wv++) {
      var wy = 60 + wv * 90;
      g.beginPath();
      g.arc(w2m(-252), w2m(wy), 26 + (wv % 2) * 10, Math.PI * 0.9, Math.PI * 1.9);
      g.stroke();
    }
    // Beach band: between the coast curve and 10 units inland.
    g.beginPath();
    for (var bz = -260; bz <= 260; bz += 10) {
      var bx = w2m(coastX(bz));
      if (bz === -260) g.moveTo(bx, w2m(bz)); else g.lineTo(bx, w2m(bz));
    }
    for (var bz2 = 260; bz2 >= -260; bz2 -= 10) {
      g.lineTo(w2m(coastX(bz2) + 10), w2m(bz2));
    }
    g.closePath();
    g.fillStyle = '#e8d5a8'; // sand
    g.fill();
    // City land: east of the beach band.
    traceLand(g);
    g.fillStyle = '#3f4a42';
    g.fill();
    // District tints: soft overlapping ellipses (low alpha, clipped
    // to land) — never rectangles, so a district never reads as a
    // grid-aligned panel.
    var districts = [
      { x0: -238, z0: -238, x1: -152, z1: 238, c: '#e8b34a', a: 0.13 }, // Golden Pier
      { x0: -148, z0: -238, x1: 148, z1: 88, c: '#4da6ff', a: 0.11 },  // Highrise Plaza
      { x0: -148, z0: 92, x1: 148, z1: 238, c: '#ff9e64', a: 0.13 },   // Pasar Lentera
      { x0: 152, z0: -238, x1: 238, z1: 238, c: '#c96f4a', a: 0.13 }   // Dockyard
    ];
    g.save();
    traceLand(g);
    g.clip();
    for (var di = 0; di < districts.length; di++) {
      var d = districts[di];
      g.globalAlpha = d.a;
      g.fillStyle = d.c;
      var dcx = w2m((d.x0 + d.x1) / 2), dcz = w2m((d.z0 + d.z1) / 2);
      var drx = (d.x1 - d.x0) / 2 / MAP_SPAN * STATIC;
      var drz = (d.z1 - d.z0) / 2 / MAP_SPAN * STATIC;
      var drot = (hash2(di, 3) - 0.5) * 0.5;
      g.beginPath();
      g.ellipse(dcx, dcz, drx * 0.92, drz * 0.88, drot, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(dcx - drx * 0.35, dcz + drz * 0.25, drx * 0.6, drz * 0.55,
        drot + 0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(dcx + drx * 0.4, dcz - drz * 0.3, drx * 0.55, drz * 0.5,
        drot - 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
    // Boardwalk: a curving promenade following the shore.
    g.beginPath();
    for (var pz = -260; pz <= 260; pz += 10) {
      var px = w2m(coastX(pz) + 14);
      if (pz === -260) g.moveTo(px, w2m(pz)); else g.lineTo(px, w2m(pz));
    }
    g.strokeStyle = '#8a5a33';
    g.lineWidth = 5;
    g.stroke();
    // Golden Pier jetty: a diagonal pier reaching into the bay.
    g.beginPath();
    g.moveTo(w2m(coastX(180) + 6), w2m(180));
    g.lineTo(w2m(-256), w2m(212));
    g.strokeStyle = '#a87a4a';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    g.arc(w2m(-256), w2m(212), 6, 0, Math.PI * 2);
    g.fillStyle = '#a87a4a';
    g.fill();
    // Parks (fixed, deterministic) — rounded blobs, not rectangles.
    g.fillStyle = '#3f8f4f';
    var parks = [[-120, -120, 40, 34], [60, 30, 46, 40], [-30, 150, 40, 30],
      [120, -180, 36, 30], [-180, 90, 30, 40]];
    for (var p = 0; p < parks.length; p++) {
      g.beginPath();
      g.ellipse(w2m(parks[p][0] + parks[p][2] / 2), w2m(parks[p][1] + parks[p][3] / 2),
        parks[p][2] / 2 / MAP_SPAN * STATIC, parks[p][3] / 2 / MAP_SPAN * STATIC,
        (hash2(p, p + 9) - 0.5) * 0.8, 0, Math.PI * 2);
      g.fill();
    }
    // Real polygon footprints (OSM method): if buildings.js exposed the
    // actual extruded outlines (VR.Buildings.footprints), draw THOSE —
    // the map shows the real city, not a generated mix. Otherwise fall
    // back to the generated mix below.
    var _fp = (VR.Buildings && VR.Buildings.footprints) || null;
    var _fpDrawn = !!(_fp && _fp.length);
    if (_fpDrawn) {
      var FP_COLORS = {
        'Golden Pier': '#7fc8a9', 'Highrise Plaza': '#2e8b8b',
        'Pasar Lentera': '#d9a05b', 'Industrial Dockyard': '#8a8f98'
      };
      for (var _fi = 0; _fi < _fp.length; _fi++) {
        var _f = _fp[_fi];
        g.fillStyle = FP_COLORS[_f.district] || '#b8c4a8';
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(w2m(_f.pts[0][0]), w2m(_f.pts[0][1]));
        for (var _fq = 1; _fq < _f.pts.length; _fq++)
          g.lineTo(w2m(_f.pts[_fq][0]), w2m(_f.pts[_fq][1]));
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (!_fpDrawn) {
    // Building footprints: an organic mix, rolled per cell from hash2
    // (deterministic, stable every load). Target mix per cell:
    // ~15% big park clearing, ~15% long slab merged horizontally,
    // ~10% tall slab merged vertically, ~10% curved (elliptical)
    // block, ~50% single footprint with strongly varied size and
    // offset. A merged slab swallows its neighbour cell, which is
    // then skipped, so no two adjacent cells ever look identical and
    // the checkerboard rhythm is gone. Every footprint still sits on
    // its real block — only the styling is organic, never positions.
    var vStreets = (VR.Roads && VR.Roads.vStreets) ||
      [-210, -150, -90, -30, 30, 90, 150, 210];
    var hStreets = (VR.Roads && VR.Roads.hStreets) ||
      [-210, -150, -90, -30, 30, 90, 150, 210];
    var NC = vStreets.length - 1; // cells per axis (7x7 in the plan)
    var cat = []; // cat[i][j]: 0 single, 1 big park, 2 merge-x, 3 merge-z, 4 curved
    // NOTE: hash2's output for these inputs only spans [0, ~0.47)
    // (its multiply overflows double precision), so the thresholds
    // below are calibrated to the measured roll distribution, not to
    // a textbook [0,1) range. Measured over the 7x7 grid they roll
    // 26 single / 8 park / 6 merge-x / 4 merge-z / 5 curved (a merge
    // rolled on the last row/column falls back to single).
    for (var ci = 0; ci < NC; ci++) {
      cat.push([]);
      for (var cj = 0; cj < NC; cj++) {
        var cr = hash2(ci * 3 + 11, cj * 7 + 5);
        var cc = 0;
        if (cr < 0.04) cc = 4;
        else if (cr < 0.128) cc = (cj < NC - 1) ? 3 : 0;
        else if (cr < 0.167) cc = (ci < NC - 1) ? 2 : 0;
        else if (cr < 0.25) cc = 1;
        cat[ci].push(cc);
      }
    }
    for (var i = 0; i < NC; i++) {
      for (var j = 0; j < NC; j++) {
        // Swallowed by a neighbour's merged slab: already covered.
        if (i > 0 && cat[i - 1][j] === 2) continue;
        if (j > 0 && cat[i][j - 1] === 3) continue;
        var x0 = vStreets[i] + 9, z0 = hStreets[j] + 9;
        var w = (vStreets[i + 1] - vStreets[i]) - 18;
        var d = (hStreets[j + 1] - hStreets[j]) - 18;
        var h = hash2(i, j);
        var h2 = hash2(j + 31, i + 17);
        var h3 = hash2(i + 51, j + 23);
        var c = cat[i][j];
        if (c === 1) {
          // Big park clearing: a large green blob, bigger than the
          // small fixed parks, with a lighter inner blob.
          var pcx = w2m(x0 + w / 2 + (h3 - 0.5) * 10);
          var pcz = w2m(z0 + d / 2 + (h2 - 0.5) * 10);
          var prx = (w * (0.62 + h * 0.2)) / MAP_SPAN * STATIC;
          var prz = (d * (0.62 + h2 * 0.2)) / MAP_SPAN * STATIC;
          g.fillStyle = '#3f8f4f';
          g.globalAlpha = 0.95;
          g.beginPath();
          g.ellipse(pcx, pcz, prx, prz, (h3 - 0.5) * 0.9, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#57a86a';
          g.beginPath();
          g.ellipse(pcx - prx * 0.2, pcz - prz * 0.15, prx * 0.55, prz * 0.5,
            (h - 0.5) * 0.7, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          continue;
        }
        g.fillStyle = BLOCK_COLORS[Math.floor(h * BLOCK_COLORS.length)];
        g.globalAlpha = 0.78 + h2 * 0.17;
        if (c === 2) {
          // Long horizontal slab: two cells wide, one cell tall.
          var mw = (vStreets[i + 2] - vStreets[i]) - 18;
          var mins = 4 + h * 5;
          var mbx = w2m(x0 + mins), mby = w2m(z0 + mins);
          var mbw = (mw - mins * 2) / MAP_SPAN * STATIC;
          var mbd = (d - mins * 2) / MAP_SPAN * STATIC;
          if (h3 < 0.5) {
            // Split slab: two unequal halves with a gap.
            var mgap = 5;
            var mcut = mbw * (0.4 + h2 * 0.2);
            roundRectPath(g, mbx, mby, mcut, mbd, 5);
            g.fill();
            roundRectPath(g, mbx + mcut + mgap, mby, mbw - mcut - mgap, mbd, 5);
            g.fill();
          } else {
            roundRectPath(g, mbx, mby, mbw, mbd, 6 + h * 5);
            g.fill();
          }
        } else if (c === 3) {
          // Tall vertical slab: one cell wide, two cells tall.
          var md = (hStreets[j + 2] - hStreets[j]) - 18;
          var vins = 4 + h * 5;
          var vbx = w2m(x0 + vins), vby = w2m(z0 + vins);
          var vbw = (w - vins * 2) / MAP_SPAN * STATIC;
          var vbd = (md - vins * 2) / MAP_SPAN * STATIC;
          if (h3 < 0.5) {
            var vgap = 5;
            var vcut = vbd * (0.4 + h2 * 0.2);
            roundRectPath(g, vbx, vby, vbw, vcut, 5);
            g.fill();
            roundRectPath(g, vbx, vby + vcut + vgap, vbw, vbd - vcut - vgap, 5);
            g.fill();
          } else {
            roundRectPath(g, vbx, vby, vbw, vbd, 6 + h * 5);
            g.fill();
          }
        } else if (c === 4) {
          // Curved block: an ellipse (with a small annex blob half
          // the time, so it reads as a bean, not a circle).
          var ecx = w2m(x0 + w / 2 + (h3 - 0.5) * 8);
          var ecz = w2m(z0 + d / 2 + (h2 - 0.5) * 8);
          var erx = (w * (0.34 + h * 0.12)) / MAP_SPAN * STATIC;
          var erz = (d * (0.34 + h2 * 0.12)) / MAP_SPAN * STATIC;
          g.beginPath();
          g.ellipse(ecx, ecz, erx, erz, (h3 - 0.5) * 1.2, 0, Math.PI * 2);
          g.fill();
          if (h < 0.5) {
            g.beginPath();
            g.ellipse(ecx + erx * 0.55, ecz + erz * 0.35, erx * 0.55, erz * 0.55,
              (h2 - 0.5) * 1.0, 0, Math.PI * 2);
            g.fill();
          }
        } else {
          // Single footprint: strongly varied size (45-95% of the
          // cell) and offset, so neighbours never match.
          var fw = w * (0.45 + h * 0.5);
          var fd = d * (0.45 + h2 * 0.5);
          var fox = (h3 - 0.5) * (w - fw);
          var foz = (h - 0.5) * (d - fd);
          var bx = w2m(x0 + fox), by = w2m(z0 + foz);
          var bw = fw / MAP_SPAN * STATIC;
          var bd = fd / MAP_SPAN * STATIC;
          if (h2 < 0.28) {
            // Split building: two rounded halves with a gap.
            var gap = 5;
            roundRectPath(g, bx, by, (bw - gap) / 2, bd, 5);
            g.fill();
            roundRectPath(g, bx + (bw + gap) / 2, by, (bw - gap) / 2, bd, 5);
            g.fill();
          } else {
            roundRectPath(g, bx, by, bw, bd, 4 + h * 10);
            g.fill();
            if (h2 > 0.62) {
              // Inner courtyard cut-out, scaled to the footprint.
              g.globalAlpha = 0.18;
              g.fillStyle = '#000';
              roundRectPath(g, bx + 7, by + 7, Math.max(2, bw - 14),
                Math.max(2, bd - 14), 4);
              g.fill();
            }
          }
        }
        g.globalAlpha = 1;
      }
    }
    // Alleys: thin dotted lanes threading the blocks (decorative
    // alley lanes — they never replace the real road graph below).
    g.strokeStyle = 'rgba(255,255,255,0.20)';
    g.lineWidth = 1.4;
    g.setLineDash([2, 5]);
    for (var ai = 0; ai < vStreets.length - 1; ai++) {
      for (var aj = 0; aj < hStreets.length - 1; aj++) {
        var ah = hash2(ai + 7, aj + 13);
        if (ah < 0.45) continue;
        var ax0 = vStreets[ai] + 9, az0 = hStreets[aj] + 9;
        var aw = (vStreets[ai + 1] - vStreets[ai]) - 18;
        var ad = (hStreets[aj + 1] - hStreets[aj]) - 18;
        var horiz = hash2(aj + 3, ai + 11) < 0.5;
        var bend = (hash2(ai + 21, aj + 5) - 0.5) * 12;
        g.beginPath();
        if (horiz) {
          g.moveTo(w2m(ax0), w2m(az0 + ad / 2));
          g.quadraticCurveTo(w2m(ax0 + aw / 2), w2m(az0 + ad / 2 + bend), w2m(ax0 + aw), w2m(az0 + ad / 2));
        } else {
          g.moveTo(w2m(ax0 + aw / 2), w2m(az0));
          g.quadraticCurveTo(w2m(ax0 + aw / 2 + bend), w2m(az0 + ad / 2), w2m(ax0 + aw / 2), w2m(az0 + ad));
        }
        g.stroke();
      }
    }
    g.setLineDash([]);
    } // end generated-mix fallback (real footprints drawn above instead)
    // Roads: from the road graph when present, grid fallback otherwise.
    // (Lighter than the 3D asphalt so streets read on the dark map land.)
    g.strokeStyle = '#565d6b';
    g.lineCap = 'round';
    if (VR.Roads && VR.Roads.edges && VR.Roads.edges.length) {
      var edges = VR.Roads.edges;
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        // Width from the edge itself: boulevard 11, avenue 8, the
        // rest 6 — so the diagonal avenue reads wider than a street.
        g.lineWidth = (ed.w || 6) / MAP_SPAN * STATIC * 2;
        g.beginPath();
        g.moveTo(w2m(ed.ax), w2m(ed.az));
        g.lineTo(w2m(ed.bx), w2m(ed.bz));
        g.stroke();
      }
      // Gold centre dashes along the diagonal avenue: the one line
      // that must read at a glance on the map.
      if (VR.Roads.chains) {
        g.strokeStyle = 'rgba(255,210,63,0.75)';
        g.lineWidth = 1.5;
        g.setLineDash([6, 8]);
        for (var ch = 0; ch < VR.Roads.chains.length; ch++) {
          var chain = VR.Roads.chains[ch];
          if (chain.kind !== 'avenue') continue;
          g.beginPath();
          for (var cp = 0; cp < chain.pts.length; cp++) {
            if (cp === 0) g.moveTo(w2m(chain.pts[cp][0]), w2m(chain.pts[cp][1]));
            else g.lineTo(w2m(chain.pts[cp][0]), w2m(chain.pts[cp][1]));
          }
          g.stroke();
        }
        g.setLineDash([]);
      }
    } else {
      // Grid fallback (roads.js not loaded yet): the plan streets.
      var fbV = (VR.Roads && VR.Roads.vStreets) || [-210, -150, -90, -30, 30, 90, 150, 210];
      var fbH = (VR.Roads && VR.Roads.hStreets) || [-210, -150, -90, -30, 30, 90, 150, 210];
      g.lineWidth = 6 / MAP_SPAN * STATIC * 2;
      for (var s2 = 0; s2 < fbV.length; s2++) {
        g.beginPath(); g.moveTo(w2m(fbV[s2]), 0);
        g.lineTo(w2m(fbV[s2]), STATIC); g.stroke();
      }
      for (var s3 = 0; s3 < fbH.length; s3++) {
        g.beginPath(); g.moveTo(0, w2m(fbH[s3]));
        g.lineTo(STATIC, w2m(fbH[s3])); g.stroke();
      }
    }
    // Centre dashes on the boulevard.
    g.strokeStyle = 'rgba(255,210,63,0.7)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(w2m(-210), 0); g.lineTo(w2m(-210), STATIC); g.stroke();
    g.setLineDash([]);
    g.restore();
  }

  drawStaticMap(off.getContext('2d'), STATIC);

  // ---------- dynamic state ----------
  var districtEl = document.getElementById('district-label');
  var healthFill = document.getElementById('health-fill');
  var armorFill = document.getElementById('armor-fill');
  var lastDistrict = '';
  var districtTimer = 0;
  var blinkT = 0;

  function playerPos() {
    // In a car: the car's position. On foot: VR.Player.pos.
    if (S.inCar && S.car && S.car.group) {
      return { x: S.car.group.position.x, z: S.car.group.position.z };
    }
    if (VR.Player && VR.Player.pos) {
      return { x: VR.Player.pos.x, z: VR.Player.pos.z };
    }
    return { x: 0, z: 0 };
  }

  function playerYaw() {
    if (S.inCar && S.car) {
      if (typeof S.car.yaw === 'number') return S.car.yaw;
      if (S.car.group) return S.car.group.rotation.y;
    }
    if (VR.Player && typeof VR.Player.yaw === 'number') return VR.Player.yaw;
    return 0;
  }

  function unitPos(u) {
    if (!u) return null;
    if (u.group && u.group.position) return { x: u.group.position.x, z: u.group.position.z };
    if (u.position) return { x: u.position.x, z: u.position.z };
    if (typeof u.x === 'number' && typeof u.z === 'number') return { x: u.x, z: u.z };
    return null;
  }

  // Fixed shop / landmark icons (world coords).
  var SHOPS = [
    { x: -186, z: 42, label: 'G', color: '#ffd23f' },   // Soraya's garage, Golden Pier
    { x: -30, z: 150, label: 'M', color: '#ff9e64' },   // Pasar Lentera market
    { x: 30, z: -60, label: 'H', color: '#4da6ff' },    // Highrise Plaza hotel
    { x: 186, z: -90, label: 'D', color: '#c96f4a' },   // Dockyard
    { x: -210, z: 180, label: 'P', color: '#37e0ff' }   // Pier
  ];

  function drawBlip(g, dx, dz, Z, r, fill, stroke) {
    g.beginPath();
    g.arc(dx * Z, dz * Z, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }

  function update(dt) {
    if (!ctx) return;
    blinkT += dt || 0;
    var R = SIZE / 2;
    var Z = 0.85; // minimap px per world unit (~110 units visible radius)
    var pos = playerPos();
    var yaw = playerYaw();
    // Rotation that puts the facing direction at the top of the circle.
    var theta = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    // Clip to the circle.
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    // Dark glass backing under the map.
    ctx.fillStyle = 'rgba(8, 16, 28, 0.85)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.translate(R, R);
    ctx.rotate(theta);
    // Static map, centred on the player.
    var f = Z * MAP_SPAN / STATIC; // static-px -> minimap-px scale
    var psx = w2m(pos.x), psy = w2m(pos.z);
    ctx.drawImage(off, -psx * f, -psy * f, STATIC * f, STATIC * f);

    // Police search circle (guarded: slice D may not exist yet).
    if (VR.Police && VR.Police.state === 'SEARCHING' &&
        typeof VR.Police.searchRadius === 'number' && VR.Police.searchRadius > 0) {
      var sc = (VR.Police.searchPos && typeof VR.Police.searchPos.x === 'number')
        ? VR.Police.searchPos : pos;
      ctx.beginPath();
      ctx.arc((sc.x - pos.x) * Z, (sc.z - pos.z) * Z,
        VR.Police.searchRadius * Z, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,77,77,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Shops / landmarks.
    for (var i = 0; i < SHOPS.length; i++) {
      var sh = SHOPS[i];
      var dx = sh.x - pos.x, dz = sh.z - pos.z;
      if (dx * dx + dz * dz > 120 * 120) continue;
      ctx.beginPath();
      ctx.arc(dx * Z, dz * Z, 5, 0, Math.PI * 2);
      ctx.fillStyle = sh.color;
      ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    }

    // Mission target (yellow diamond). Near: at its true spot. Far:
    // clamped to the rim so the objective direction is always visible.
    if (VR.Missions && VR.Missions.targetPos &&
        typeof VR.Missions.targetPos.x === 'number') {
      var tp = VR.Missions.targetPos;
      var tdx = tp.x - pos.x, tdz = tp.z - pos.z;
      var tDist = Math.sqrt(tdx * tdx + tdz * tdz);
      var tx = tdx * Z, tz = tdz * Z;
      var tSize = 6 + Math.sin(blinkT * 4) * 1.5;
      if (tDist > 130) {
        var tLen = Math.sqrt(tx * tx + tz * tz) || 1;
        var rim = R - 14;
        tx = tx / tLen * rim;
        tz = tz / tLen * rim;
        tSize = 7;
      }
      ctx.save();
      ctx.translate(tx, tz);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.fillRect(-tSize / 2, -tSize / 2, tSize, tSize);
      ctx.strokeRect(-tSize / 2, -tSize / 2, tSize, tSize);
      ctx.restore();
    }

    // Police units (blinking red/blue).
    if (VR.Police && VR.Police.units && VR.Police.units.length) {
      var red = (Math.floor(blinkT * 2) % 2) === 0;
      var units = VR.Police.units;
      for (var u = 0; u < units.length; u++) {
        var up = unitPos(units[u]);
        if (!up) continue;
        var udx = up.x - pos.x, udz = up.z - pos.z;
        if (udx * udx + udz * udz > 120 * 120) continue;
        drawBlip(ctx, udx, udz, Z, 4.5, red ? '#ff4d4d' : '#4da6ff', '#fff');
      }
    }
    // Police helicopter (bigger blip, guarded).
    if (VR.Police && VR.Police.heli) {
      var hp = unitPos(VR.Police.heli);
      if (hp) {
        var hdx = hp.x - pos.x, hdz = hp.z - pos.z;
        if (hdx * hdx + hdz * hdz < 120 * 120) {
          drawBlip(ctx, hdx, hdz, Z, 6, '#ff4d4d', '#fff');
        }
      }
    }

    ctx.restore(); // un-rotate, un-clip

    // Player arrow (white, points up = facing) — drawn unrotated.
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(R, R - 11);
    ctx.lineTo(R + 7, R + 8);
    ctx.lineTo(R, R + 3);
    ctx.lineTo(R - 7, R + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Rotating N at the rim (north = world -z).
    var nx = Math.sin(theta), ny = -Math.cos(theta);
    ctx.fillStyle = '#ffe9c9';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    ctx.fillText('N', R + nx * (R - 13), R + ny * (R - 13));
    ctx.shadowBlur = 0;

    // ---- district label (above the minimap, on change) ----
    if (VR.World && VR.World.districtAt) {
      var d = VR.World.districtAt(pos.x, pos.z);
      if (d !== lastDistrict) {
        lastDistrict = d;
        districtTimer = 3;
        if (districtEl) {
          districtEl.textContent = d;
          districtEl.classList.add('visible');
        }
      }
    }
    if (districtTimer > 0) {
      districtTimer -= dt || 0;
      if (districtTimer <= 0 && districtEl) {
        districtEl.classList.remove('visible');
      }
    }

    // ---- health / armour bars beside the minimap ----
    var hp = (VR.Player && typeof VR.Player.health === 'number')
      ? VR.Player.health : (S.health || 0);
    var ar = (VR.Player && typeof VR.Player.armor === 'number')
      ? VR.Player.armor : (S.armor || 0);
    if (healthFill) {
      healthFill.style.width = Math.max(0, Math.min(100, hp)) + '%';
    }
    if (armorFill) {
      armorFill.style.width = Math.max(0, Math.min(100, ar)) + '%';
    }
  }

  VR.Minimap = {
    update: update,
    drawStaticMap: drawStaticMap,
    get canvas() { return canvas; }
  };

})(window.VR = window.VR || {});
