// world.js — renderer, golden-hour sky, sun + shadows that follow the
// player, sea / sand / boardwalk on the west edge, procedural road and
// sidewalk textures, and the spatial-hash collision registry (isBlocked).
(function (VR) {
  'use strict';

  var C = VR.Config;
  var P = C.PALETTE;

  // ---------- renderer / scene / camera ----------
  var renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // ENV-GLOW: explicit sRGB output (r152+ default, set anyway so a
  // future three bump can never silently flip the pipeline to linear).
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(P.fogHorizon, 0.0016);

  var camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 60, 120);

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- sky dome (golden-hour gradient) + sun disc ----------
  var skyUniforms = {
    topColor: { value: new THREE.Color(P.skyZenith) },
    midColor: { value: new THREE.Color(0xffc98a) },
    horizonColor: { value: new THREE.Color(P.skyHorizon) },
    offset: { value: 12 },
    exponent: { value: 0.75 }
  };
  var skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: [
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPosition = wp.xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 midColor;',
      'uniform float offset; uniform float exponent;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;',
      '  float f = pow(max(h, 0.0), exponent);',
      // Three-stop gradient: peach horizon -> warm gold band -> dusk
      // blue zenith. The overlapping smoothsteps leave no hard band
      // edge; the gold mid stops the peach from reading as flat red.
      '  vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.45, f));',
      '  col = mix(col, topColor, smoothstep(0.35, 1.0, f));',
      '  gl_FragColor = vec4(col, 1.0);',
      // Slice F (18 Nov): this shader used to end here, so its output
      // skipped the renderer's output transform entirely — the palette
      // hexes (authored as sRGB, converted to linear working space by
      // THREE.Color) were displayed raw, which turned the peach horizon
      // into flat saturated red. Including the standard chunks puts the
      // sky through the same ACES + sRGB output as every other material,
      // so the gradient finally displays as the palette intends (peach
      // #ff9e64 at the horizon -> dusk blue #2b4170 at the zenith). No
      // colour value changed; only the missing output transform.
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n')
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
  scene.add(sky);

  // ---------- lights ----------
  var hemi = new THREE.HemisphereLight(0xffd9a0, 0x8a6f52, 1.05);
  scene.add(hemi);

  var sunLight = new THREE.DirectionalLight(0xffc27a, 2.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -75;
  sunLight.shadow.camera.right = 75;
  sunLight.shadow.camera.top = 75;
  sunLight.shadow.camera.bottom = -75;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.bias = -0.0005;
  // normalBias kills the black acne blotches on flat asphalt far
  // better than bias alone at this world scale.
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // ENV-GLOW rim light: a second, weak warm directional from the
  // east (behind-side, opposite the low western sun) so the edges of
  // cars and the player catch a warm outline. No shadow, no PointLight
  // cost — it follows the focus point in update(), same as the sun.
  var rimLight = new THREE.DirectionalLight(0xffb070, 0.8);
  scene.add(rimLight);
  scene.add(rimLight.target);
  var RIM_DIR = new THREE.Vector3(0.55, 0.42, 0.60).normalize();
  var RIM_DAY = new THREE.Color(0xffb070);
  var RIM_NIGHT = new THREE.Color(0xff5fa2); // night: neon-pink rim
  var _cRim = new THREE.Color();

  // Sun direction (low over the western sea at golden hour).
  var SUN_DIR_DAY = new THREE.Vector3(-0.82, 0.30, -0.42).normalize();
  var SUN_DIR_NIGHT = new THREE.Vector3(0.35, 0.75, 0.25).normalize();
  var _sunPos = new THREE.Vector3();
  var _focus = new THREE.Vector3();

  // ---------- glow sprite factory ----------
  // ENV-GLOW: one shared CanvasTexture per colour (lamps alone spawn
  // ~40 sprites; a texture per sprite was ~40 redundant 128px uploads).
  // Gradient has a hot core (opaque -> 0.85) and a long soft tail so the
  // halo reads as light in the air, not a hard dot.
  var _glowTexCache = {};
  function glowTexture(color) {
    var key = color;
    if (_glowTexCache[key]) return _glowTexCache[key];
    var r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    var gr = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.28, 'rgba(' + r + ',' + g + ',' + b + ',0.85)');
    gr.addColorStop(0.55, 'rgba(' + r + ',' + g + ',' + b + ',0.28)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    _glowTexCache[key] = tex;
    return tex;
  }

  function makeGlowSprite(color, size) {
    var tex = glowTexture(color);
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var spr = new THREE.Sprite(mat);
    spr.scale.set(size, size, 1);
    return spr;
  }

  // Ambient glows (street lamps, lanterns, crane tips) brighten at
  // night: registerGlow(sprite, dayOpacity, nightOpacity) and
  // update() lerps the opacity by nightness. The sprites themselves
  // are created by buildings.js / police.js; this only owns the fade.
  var ambientGlows = [];
  function registerGlow(spr, dayOp, nightOp) {
    ambientGlows.push({ spr: spr, day: dayOp, night: nightOp });
    spr.material.opacity = dayOp;
  }
  var sunGlow = makeGlowSprite(P.sun, 260);
  var sunCore = makeGlowSprite(0xfff3c4, 90);
  scene.add(sunGlow);
  scene.add(sunCore);

  // ---------- procedural canvas textures (1024, anisotropy 4) ----------
  function canvasTexture(size, draw) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    draw(cv.getContext('2d'), size);
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Deterministic speckle so the asphalt never looks flat.
  function speckle(ctx, size, n, seed) {
    var s = seed;
    for (var i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      var x = (s % size);
      s = (s * 16807) % 2147483647;
      var y = (s % size);
      var v = (s % 3) - 1;
      ctx.fillStyle = v > 0 ? 'rgba(255,255,255,0.05)'
                            : 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y, 3, 3);
    }
  }

  // Asphalt: road runs along canvas Y. Double yellow centre, dashed white
  // lane lines, zebra crossings at both ends (one tile = one 60-unit block,
  // so zebras land on intersections).
  var asphaltTex = canvasTexture(1024, function (ctx, S) {
    ctx.fillStyle = '#383c46';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 2600, 12345);
    // Double yellow centre line (10 px each, centres +/-11 px from
    // the middle so the pair reads symmetric and crisp).
    ctx.fillStyle = '#e8c33a';
    ctx.fillRect(S / 2 - 16, 0, 10, S);
    ctx.fillRect(S / 2 + 6, 0, 10, S);
    // Dashed white lane lines at 1/4 and 3/4 width.
    ctx.fillStyle = '#dfe3e8';
    for (var y = 0; y < S; y += 128) {
      ctx.fillRect(S * 0.25 - 4, y, 8, 64);
      ctx.fillRect(S * 0.75 - 4, y, 8, 64);
    }
    // Zebra crossings at both ends of the tile.
    for (var x = 16; x < S; x += 56) {
      ctx.fillRect(x, 10, 24, 86);
      ctx.fillRect(x, S - 96, 24, 86);
    }
  });
  // One tile = one 60-unit block: 8 tiles along a 480-unit street.
  asphaltTex.repeat.set(1, 8);

  // Framed sidewalk: concrete tile with a darker frame + seams.
  var sidewalkTex = canvasTexture(1024, function (ctx, S) {
    ctx.fillStyle = '#8a8f98';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 1800, 777);
    ctx.strokeStyle = '#6e737c';
    ctx.lineWidth = 26;
    ctx.strokeRect(13, 13, S - 26, S - 26);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (var i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * S / 4, 0); ctx.lineTo(i * S / 4, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * S / 4); ctx.lineTo(S, i * S / 4); ctx.stroke();
    }
  });

  // Boardwalk planks.
  var plankTex = canvasTexture(512, function (ctx, S) {
    ctx.fillStyle = '#8a5a33';
    ctx.fillRect(0, 0, S, S);
    for (var y = 0; y < S; y += 64) {
      ctx.fillStyle = (y / 64) % 2 ? '#7d4f2c' : '#96683c';
      ctx.fillRect(0, y, S, 60);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y + 60, S, 4);
    }
    speckle(ctx, S, 500, 4242);
  });

  // ---------- ground: sidewalk base, roads, sand, boardwalk, sea ----------
  function flatPlane(w, h, mat, x, z, y) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // ---------- Vandara Bay coastline (organic, not a straight slab) ----------
  // coastX(z) = the waterline. A gentle sine bay, a westward peninsula
  // around z=-110, and a bay inlet (cove) around z=+95 that bites east.
  // Clamped to [-258,-238]: the beach road (coastX+8) must stay >= 4
  // clear of the -222 boardwalk palm row, and the peninsula tip must
  // stay inside the minimap's [-260,260] span. Land edge = coastX+10.
  // roads.js (beach chain), minimap.js and the buildings sea-guard all
  // read this one function via VR.World.coastX.
  function coastX(z) {
    var base = -247 + 6 * Math.sin(z * 0.021 + 0.8) + 3 * Math.sin(z * 0.047 + 1.9);
    var peninsula = -6 * Math.exp(-Math.pow((z + 110) / 32, 2));
    var cove = 7 * Math.exp(-Math.pow((z - 95) / 30, 2));
    var v = base + peninsula + cove;
    if (v < -258) v = -258;
    if (v > -238) v = -238;
    return v;
  }

  // City base (sidewalk concrete, one tile per block).
  // West edge follows the coastline (landX(z) = coastX(z)+10) instead of
  // a straight x=-240 slab edge, so the landmass silhouette is organic:
  // peninsula + bay inlet read from the aerial. Custom grid geometry:
  // rows along z, columns from landX(z) to x=240; UVs match the old
  // 480x480 plane with repeat (8,8), so the tile scale is unchanged.
  var baseTex = sidewalkTex.clone();
  baseTex.needsUpdate = true;
  baseTex.repeat.set(5, 5); // 5x5, not 8x8: an 8x8 repeat put a frame
  // every 60 units, aligned with the old grid streets — the wide aerial
  // read as a checkerboard. 5x5 frames every 96 units, off the streets.
  (function buildCurvedBase() {
    var geo = new THREE.BufferGeometry();
    var pos = [], uv = [], idx = [];
    var ROWS = 61, COLS = 9; // z -240..240 step 8; x landX(z)..240
    var r, c;
    for (r = 0; r < ROWS; r++) {
      var bz = -240 + r * 8;
      var landX = coastX(bz) + 10;
      for (c = 0; c < COLS; c++) {
        var bx = landX + (240 - landX) * c / (COLS - 1);
        pos.push(bx, 0, bz);
        uv.push((bx + 240) / 480, (bz + 240) / 480);
      }
    }
    for (r = 0; r < ROWS - 1; r++) {
      for (c = 0; c < COLS - 1; c++) {
        var a = r * COLS + c, b = a + 1, c2 = a + COLS, d2 = c2 + 1;
        idx.push(a, c2, b, b, c2, d2);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: baseTex, roughness: 0.95, metalness: 0, flatShading: true,
      side: THREE.DoubleSide // winding is row-dependent; render both faces
    }));
    m.receiveShadow = true;
    scene.add(m);
  })();

  // Far ground beyond the city so the horizon never shows void.
  // Warm hazy tone (not dark slate): at distance the fog tints it to
  // the peach horizon, so the ground melts into the sky instead of
  // drawing a hard dark line across the horizon.
  flatPlane(1600, 1600, new THREE.MeshStandardMaterial({
    color: 0x8a6f5c, roughness: 1, metalness: 0, flatShading: true
  }), -120, 0, -0.15);

  // Roads are NOT drawn here as flat grid planes any more. The old
  // 8x8 grid of PlaneGeometry roads is what made the wide aerial read
  // as a checkerboard. Every road is now a RIBBON built lazily from
  // the road GRAPH (VR.Roads.streetPolylines + chains + links) by
  // buildRoadRibbons() on the first update() after roads.js loads —
  // visual and graph are the same data by construction, so a car can
  // never drive on an invisible road (or a visible road it cannot use).
  // Boulevard centre median glow strip (visual only).
  var median = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 480),
    new THREE.MeshStandardMaterial({
      color: 0x6b7c8a, roughness: 0.8, metalness: 0, flatShading: true
    }));
  median.position.set(-210, 0.12, 0);
  scene.add(median);

  // ---------- MAP v2 ribbons: ALL roads from the graph ----------
  // roads.js loads AFTER world.js, so VR.Roads.chains is not available
  // at load time: buildRoadRibbons() runs once, lazily, on the first
  // update() after VR.Roads exists. A ribbon FOLLOWS its polyline:
  // per-point normals from averaged neighbour tangents, so joints are
  // mitred, never gapped (a chain of separate quads would split at
  // every curve node). Two layers: a wider sidewalk underlay, then
  // asphalt (same texture as the grid roads, one tile per 60 units).
  // y-stacked above the grid roads (0.03/0.04) so crossings never
  // z-fight. Connector links get the same treatment — a car must never
  // drive on an invisible road.
  var ribbonTex = asphaltTex.clone();
  ribbonTex.needsUpdate = true;
  ribbonTex.repeat.set(1, 1);
  var ribbonMat = new THREE.MeshStandardMaterial({
    map: ribbonTex, roughness: 0.9, metalness: 0, flatShading: true,
    side: THREE.DoubleSide
  });
  var ribbonWalkMat = new THREE.MeshStandardMaterial({
    color: 0x8a8f98, roughness: 0.95, metalness: 0, flatShading: true,
    side: THREE.DoubleSide
  });

  function ribbonGeometry(pts, halfW, closed, y) {
    var n = pts.length;
    var pos = [], uv = [], idx = [];
    var cum = [0];
    for (var s = 0; s < n - 1; s++) {
      var sx = pts[s + 1][0] - pts[s][0], sz = pts[s + 1][1] - pts[s][1];
      cum.push(cum[s] + Math.sqrt(sx * sx + sz * sz));
    }
    var total = cum[n - 1];
    if (closed) {
      var cx = pts[0][0] - pts[n - 1][0], cz = pts[0][1] - pts[n - 1][1];
      total += Math.sqrt(cx * cx + cz * cz);
    }
    for (var k = 0; k < n; k++) {
      var kp = closed ? (k + n - 1) % n : Math.max(0, k - 1);
      var kn = closed ? (k + 1) % n : Math.min(n - 1, k + 1);
      var tx = pts[kn][0] - pts[kp][0], tz = pts[kn][1] - pts[kp][1];
      var tl = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= tl; tz /= tl;
      var nx = -tz, nz = tx; // left normal in the xz plane
      var px = pts[k][0], pz = pts[k][1];
      pos.push(px + nx * halfW, y, pz + nz * halfW);
      pos.push(px - nx * halfW, y, pz - nz * halfW);
      uv.push(0, cum[k] / 60, 1, cum[k] / 60);
    }
    var segs = closed ? n : n - 1;
    for (var q = 0; q < segs; q++) {
      var a = q * 2, b = q * 2 + 1;
      var c2 = ((q + 1) % n) * 2, d2 = ((q + 1) % n) * 2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function ribbonMesh(pts, halfW, closed, mat, y) {
    var m = new THREE.Mesh(ribbonGeometry(pts, halfW, closed, y), mat);
    m.receiveShadow = true;
    return m;
  }

  var roadRibbonsBuilt = false;
  // Build EVERY road as a ribbon from the graph (OSM method: the plan
  // is the single source of truth, visual = graph). y-stack (proven by
  // the 0.03/0.04/0.045/0.055 stack): street underlay 0.045, vertical
  // streets 0.055, horizontal streets 0.065 (so crossings never
  // z-fight), chains 0.075 + chainIndex*0.01 (so the two chain x chain
  // crossings — avenue x Market Curve, avenue x Highrise Arc — never
  // z-fight), dead-end bulbs 0.07, links 0.155 (they cross streets and
  // chains and must sit above both). Dead-end stubs get a turnaround
  // bulb disc at their end point.
  function buildRoadRibbons() {
    if (roadRibbonsBuilt) return;
    if (!VR.Roads || !VR.Roads.chains) return;
    roadRibbonsBuilt = true;
    var polys = VR.Roads.streetPolylines || [];
    for (var p = 0; p < polys.length; p++) {
      var pl = polys[p];
      scene.add(ribbonMesh(pl.pts, pl.w + 3, false, ribbonWalkMat, 0.045));
      scene.add(ribbonMesh(pl.pts, pl.w, false, ribbonMat, pl.vertical ? 0.055 : 0.065));
    }
    var chains = VR.Roads.chains;
    for (var c = 0; c < chains.length; c++) {
      var ch = chains[c];
      var closed = ch.kind === 'ring';
      scene.add(ribbonMesh(ch.pts, ch.halfWidth + 3, closed, ribbonWalkMat, 0.045));
      scene.add(ribbonMesh(ch.pts, ch.halfWidth, closed, ribbonMat, 0.075 + c * 0.01));
      if (ch.kind === 'deadend') {
        var end = ch.pts[ch.pts.length - 1];
        var bulb = new THREE.Mesh(
          new THREE.CircleGeometry(ch.halfWidth + 2, 24), ribbonMat);
        bulb.rotation.x = -Math.PI / 2;
        bulb.position.set(end[0], 0.07, end[1]);
        bulb.receiveShadow = true;
        scene.add(bulb);
      }
    }
    var links = VR.Roads.links || [];
    for (var l = 0; l < links.length; l++) {
      var lk = links[l];
      var lp = [[lk[0], lk[1]], [lk[2], lk[3]]];
      scene.add(ribbonMesh(lp, 9, false, ribbonWalkMat, 0.045));
      scene.add(ribbonMesh(lp, 6, false, ribbonMat, 0.155));
    }
  }

  // Sand beach + boardwalk + sea (west edge). Sand and boardwalk are
  // ribbons that FOLLOW the coastline (centreline coastX+5 / coastX+17),
  // so the beach widens at the peninsula and narrows at the bay inlet.
  // The sea plane is widened east to x=-200 so it runs UNDER the curved
  // land edge everywhere; the visible waterline is the sand ribbon's
  // west edge (coastX-2), never a straight rectangle edge.
  (function buildCoastRibbons() {
    var sandPts = [], bwPts = [], z;
    for (z = -240; z <= 240; z += 10) {
      sandPts.push([coastX(z) + 5, z]);
      bwPts.push([coastX(z) + 17, z]);
    }
    scene.add(ribbonMesh(sandPts, 7, false, new THREE.MeshStandardMaterial({
      color: P.sand, roughness: 1, metalness: 0, flatShading: true,
      side: THREE.DoubleSide
    }), 0.01));
    var bwTex = plankTex.clone();
    bwTex.needsUpdate = true;
    bwTex.repeat.set(1, 1); // ribbon UV v is already cumLen/60 (0..8)
    scene.add(ribbonMesh(bwPts, 5, false, new THREE.MeshStandardMaterial({
      map: bwTex, roughness: 0.9, metalness: 0, flatShading: true,
      side: THREE.DoubleSide
    }), 0.02));
  })();
  var sea = flatPlane(306, 480, new THREE.MeshStandardMaterial({
    color: P.sea, roughness: 0.28, metalness: 0.15, flatShading: true
  }), -353, 0, -0.05);
  sea.receiveShadow = false;
  // Sun glints on the water (small, soft — never another sun disc).
  for (var i = 0; i < 6; i++) {
    var glint = makeGlowSprite(0xffd27a, 5 + (i % 3) * 3);
    glint.material.opacity = 0.5;
    glint.position.set(-280 - (i * 17) % 120, 0.4, -200 + i * 62);
    scene.add(glint);
  }

  // ---------- spatial hash collision registry ----------
  var CELL = 10;
  var grid = new Map(); // "cx,cz" -> array of AABBs {x0,z0,x1,z1}
  var _keyBuf = '';

  function cellKey(cx, cz) { return cx + ',' + cz; }

  function registerBlocker(x, z, hx, hz) {
    var x0 = x - hx, x1 = x + hx, z0 = z - hz, z1 = z + hz;
    var cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    var cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    var box = { x0: x0, z0: z0, x1: x1, z1: z1 };
    for (var cx = cx0; cx <= cx1; cx++) {
      for (var cz = cz0; cz <= cz1; cz++) {
        _keyBuf = cellKey(cx, cz);
        var list = grid.get(_keyBuf);
        if (!list) { list = []; grid.set(_keyBuf, list); }
        list.push(box);
      }
    }
  }

  function registerCircle(x, z, r) {
    registerBlocker(x, z, r, r);
  }

  function isBlocked(x, z) {
    // World bounds + sea: the west bound IS the coastline (coastX(z)-2),
    // not a straight x=-236 wall — the beach road runs to x=-250 at the
    // peninsula and the sand is walkable to the waterline.
    if (x < coastX(z) - 2 || x > 240 || z < -240 || z > 240) return true;
    var cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    var list = grid.get(cellKey(cx, cz));
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
  }

  // Sea fence colliders along the beach edge (keeps cars/player on land).
  // The fence FOLLOWS the coastline at coastX(z)-3, 11 units west of the
  // beach road centreline, so it never blocks the road at the peninsula
  // (where a straight x=-239 fence would sit ON the road).
  for (var fz = -240; fz <= 240; fz += 15) {
    registerBlocker(coastX(fz) - 3, fz, 3, 7.5);
  }

  // ---------- time of day ----------
  var _cTop = new THREE.Color();
  var _cMid = new THREE.Color();
  var _cHor = new THREE.Color();
  var _cFog = new THREE.Color();
  var _cSun = new THREE.Color();
  var _cHemiSky = new THREE.Color();
  var night = false;
  var nightness = 0;

  // W5d (r6): DAY fogD 0.0019 -> 0.0008, NIGHT 0.0022 -> 0.0016.
  // The orange wash on the wide aerial is DISTANCE fog, not sunset
  // (noon and 18:52 render identically — nightness is 0 before
  // 19:00). At the 0,500,200 brief camera the city sits ~540 units
  // out: 0.0019 fogged it ~65%, 0.0011 still left a visible veil
  // (~30%), 0.0008 leaves ~17% — the city reads from above while
  // the sunset mood (sky gradient, sun glow, warm lights) is
  // untouched. Fog is reduced, not removed.
  var DAY = {
    top: new THREE.Color(P.skyZenith), mid: new THREE.Color(0xffc98a),
    hor: new THREE.Color(P.skyHorizon),
    fog: new THREE.Color(P.fogHorizon), sun: new THREE.Color(0xffc27a),
    hemiSky: new THREE.Color(0xffd9a0), hemiGround: new THREE.Color(0x8a6f52),
    hemiI: 1.05, sunI: 2.1, fogD: 0.0008, sunScale: 1
  };
  var NIGHT = {
    top: new THREE.Color(P.skyNightTop), mid: new THREE.Color(0x3a2b5c),
    hor: new THREE.Color(P.skyNightHorizon),
    fog: new THREE.Color(0x1a1f3a), sun: new THREE.Color(0x8fa8ff),
    hemiSky: new THREE.Color(0x4a5a8a), hemiGround: new THREE.Color(0x1a1626),
    hemiI: 0.35, sunI: 0.35, fogD: 0.0016, sunScale: 0.55
  };

  // ---------- procedural environment map (ENV-GLOW) ----------
  // No HDR file, no CubeCamera per frame: paint the current sky gradient
  // (+ a bright sun disc and a warm horizon band) onto a small equirect
  // canvas, then PMREM it once into scene.environment. Every
  // MeshStandardMaterial picks it up at envMapIntensity 1.0 (in the
  // 0.6-1.2 band) — car paint and glass get sharp sun highlights
  // without any metalness push. Rebuilt only when the time of day
  // actually moves (setTimeOfDay is called at boot / mission 7 / save
  // load / screenshots, never per frame).
  var _envRT = null;
  var _envNightness = -1;
  var _cGround = new THREE.Color();
  var _cGround2 = new THREE.Color();
  function buildEnvMap() {
    var EW = 512, EH = 256;
    var cv = document.createElement('canvas');
    cv.width = EW; cv.height = EH;
    var ctx = cv.getContext('2d');
    // Vertical gradient: zenith -> gold band -> horizon -> dark ground
    // below the horizon line (v = 0.5). Ground is the horizon colour
    // darkened so reflections under the car read as asphalt, not sky.
    _cGround.copy(_cHor).multiplyScalar(0.32);
    _cGround2.copy(_cHor).multiplyScalar(0.14);
    var g = ctx.createLinearGradient(0, 0, 0, EH);
    g.addColorStop(0.00, '#' + _cTop.getHexString());
    g.addColorStop(0.40, '#' + _cMid.getHexString());
    g.addColorStop(0.50, '#' + _cHor.getHexString());
    g.addColorStop(0.56, '#' + _cGround.getHexString());
    g.addColorStop(1.00, '#' + _cGround2.getHexString());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, EW, EH);
    // Sun position in equirect space (three.js convention:
    // u = atan2(z, x) / 2PI + 0.5, v = asin(y) / PI + 0.5, canvas y
    // flipped). Drawn 3x across the seam so a sun near u = 0 never
    // gets cut in half by the texture edge.
    var sd = nightness > 0.5 ? SUN_DIR_NIGHT : SUN_DIR_DAY;
    var su = Math.atan2(sd.z, sd.x) / (Math.PI * 2) + 0.5;
    var sv = Math.asin(Math.max(-1, Math.min(1, sd.y))) / Math.PI + 0.5;
    var sx = su * EW, sy = (1 - sv) * EH;
    var isNight = nightness > 0.5;
    var coreCol = isNight ? '223,232,255' : '255,246,214';
    var haloCol = isNight ? '150,170,255' : '255,190,110';
    var bandCol = isNight ? '120,110,220' : '255,170,90';
    var k;
    for (k = -1; k <= 1; k++) {
      var cx = sx + k * EW;
      // Warm band hugging the horizon under the sun.
      ctx.save();
      ctx.translate(cx, EH / 2);
      ctx.scale(1, 0.26);
      var band = ctx.createRadialGradient(0, 0, 0, 0, 0, 190);
      band.addColorStop(0, 'rgba(' + bandCol + ',0.55)');
      band.addColorStop(1, 'rgba(' + bandCol + ',0)');
      ctx.fillStyle = band;
      ctx.beginPath(); ctx.arc(0, 0, 190, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Wide halo, then the hard bright disc (this is what makes the
      // sharp highlight on paint and glass).
      var halo = ctx.createRadialGradient(cx, sy, 0, cx, sy, 110);
      halo.addColorStop(0, 'rgba(' + haloCol + ',0.55)');
      halo.addColorStop(1, 'rgba(' + haloCol + ',0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - 110, sy - 110, 220, 220);
      var core = ctx.createRadialGradient(cx, sy, 0, cx, sy, 26);
      core.addColorStop(0, 'rgba(' + coreCol + ',1)');
      core.addColorStop(0.4, 'rgba(' + coreCol + ',0.9)');
      core.addColorStop(1, 'rgba(' + coreCol + ',0)');
      ctx.fillStyle = core;
      ctx.fillRect(cx - 30, sy - 30, 60, 60);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    var pmrem = new THREE.PMREMGenerator(renderer);
    var rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    if (_envRT) _envRT.dispose();
    _envRT = rt;
    scene.environment = rt.texture;
  }

  function setTimeOfDay(minutes) {
    // Golden hour until ~19:00, full night by ~20:00.
    var n = (minutes - 19 * 60) / 60;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    nightness = n;
    night = n > 0.5;
    _cTop.lerpColors(DAY.top, NIGHT.top, n);
    _cMid.lerpColors(DAY.mid, NIGHT.mid, n);
    _cHor.lerpColors(DAY.hor, NIGHT.hor, n);
    _cFog.lerpColors(DAY.fog, NIGHT.fog, n);
    _cSun.lerpColors(DAY.sun, NIGHT.sun, n);
    _cHemiSky.lerpColors(DAY.hemiSky, NIGHT.hemiSky, n);
    skyUniforms.topColor.value.copy(_cTop);
    skyUniforms.midColor.value.copy(_cMid);
    skyUniforms.horizonColor.value.copy(_cHor);
    // Fog stays the horizon colour, nudged a touch more saturated
    // (day peach is already near max saturation; night navy gains).
    scene.fog.color.copy(_cFog);
    scene.fog.color.offsetHSL(0, 0.08, 0);
    scene.fog.density = DAY.fogD + (NIGHT.fogD - DAY.fogD) * n;
    sunLight.color.copy(_cSun);
    sunLight.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * n;
    hemi.color.copy(_cHemiSky);
    hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * n;
    // Rim: warm gold by day, neon pink by night, dimmer at night.
    _cRim.lerpColors(RIM_DAY, RIM_NIGHT, n);
    rimLight.color.copy(_cRim);
    rimLight.intensity = 0.8 + (0.45 - 0.8) * n;
    var sc = DAY.sunScale + (NIGHT.sunScale - DAY.sunScale) * n;
    sunGlow.scale.set(260 * sc, 260 * sc, 1);
    sunCore.scale.set(90 * sc, 90 * sc, 1);
    // Env map follows the sky, but only when the time actually moved.
    if (_envNightness < 0 || Math.abs(n - _envNightness) > 0.08) {
      _envNightness = n;
      buildEnvMap();
    }
  }

  // Re-centre the sun shadow camera + sky on the focus point every frame.
  function update(dt, focusX, focusZ) {
    buildRoadRibbons(); // lazy: roads.js loads after world.js
    _focus.set(focusX || 0, 0, focusZ || 0);
    var dir = nightness > 0.5 ? SUN_DIR_NIGHT : SUN_DIR_DAY;
    _sunPos.copy(_focus).addScaledVector(dir, 150);
    sunLight.position.copy(_sunPos);
    sunLight.target.position.copy(_focus);
    sunLight.target.updateMatrixWorld();
    // Rim light trails the focus from behind-side, opposite the sun.
    rimLight.position.copy(_focus).addScaledVector(RIM_DIR, 140);
    rimLight.target.position.copy(_focus);
    rimLight.target.updateMatrixWorld();
    sky.position.copy(_focus);
    sunGlow.position.copy(_focus).addScaledVector(dir, 820);
    sunCore.position.copy(_focus).addScaledVector(dir, 820);
    // Ambient glows brighten as night falls (lamps, lanterns, beacons).
    for (var gi = 0; gi < ambientGlows.length; gi++) {
      var g = ambientGlows[gi];
      g.spr.material.opacity = g.day + (g.night - g.day) * nightness;
    }
  }

  function districtAt(x, z) {
    var d = C.DISTRICTS;
    for (var i = 0; i < d.length; i++) {
      var b = d[i].bounds;
      if (x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3]) return d[i].name;
    }
    return 'Highrise Plaza';
  }

  setTimeOfDay(18 * 60 + 52); // default: golden hour, 18:52

  VR.World = {
    scene: scene,
    camera: camera,
    renderer: renderer,
    sunLight: sunLight,
    rimLight: rimLight,
    hemiLight: hemi,
    setTimeOfDay: setTimeOfDay,
    districtAt: districtAt,
    isBlocked: isBlocked,
    coastX: coastX,
    registerBlocker: registerBlocker,
    registerCircle: registerCircle,
    registerGlow: registerGlow,
    makeGlowSprite: makeGlowSprite,
    groundY: function (x, z) { return 0; },
    update: update,
    get night() { return night; },
    get nightness() { return nightness; }
  };

})(window.VR = window.VR || {});
