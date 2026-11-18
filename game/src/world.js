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

  // Sun direction (low over the western sea at golden hour).
  var SUN_DIR_DAY = new THREE.Vector3(-0.82, 0.30, -0.42).normalize();
  var SUN_DIR_NIGHT = new THREE.Vector3(0.35, 0.75, 0.25).normalize();
  var _sunPos = new THREE.Vector3();
  var _focus = new THREE.Vector3();

  // ---------- glow sprite factory ----------
  function makeGlowSprite(color, size) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    var css = '#' + ('000000' + color.toString(16)).slice(-6);
    g.addColorStop(0, css);
    g.addColorStop(0.35, css);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
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

  // City base (sidewalk concrete, one tile per block).
  var baseTex = sidewalkTex.clone();
  baseTex.needsUpdate = true;
  baseTex.repeat.set(8, 8);
  flatPlane(480, 480, new THREE.MeshStandardMaterial({
    map: baseTex, roughness: 0.95, metalness: 0, flatShading: true
  }), 0, 0, 0);

  // Far ground beyond the city so the horizon never shows void.
  // Warm hazy tone (not dark slate): at distance the fog tints it to
  // the peach horizon, so the ground melts into the sky instead of
  // drawing a hard dark line across the horizon.
  flatPlane(1600, 1600, new THREE.MeshStandardMaterial({
    color: 0x8a6f5c, roughness: 1, metalness: 0, flatShading: true
  }), -120, 0, -0.15);

  // Roads on every grid street.
  var streets = [-210, -150, -90, -30, 30, 90, 150, 210];
  var roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex, roughness: 0.9, metalness: 0, flatShading: true
  });
  var roadGeoV = new THREE.PlaneGeometry(12, 480);
  var roadGeoB = new THREE.PlaneGeometry(22, 480); // boulevard, 4 lanes
  var i, s;
  for (i = 0; i < streets.length; i++) {
    s = streets[i];
    // Vertical (along z).
    var mv = new THREE.Mesh(s === -210 ? roadGeoB : roadGeoV, roadMat);
    mv.rotation.x = -Math.PI / 2;
    mv.position.set(s, 0.03, 0);
    mv.receiveShadow = true;
    scene.add(mv);
    // Horizontal (along x).
    var mh = new THREE.Mesh(roadGeoV, roadMat);
    mh.rotation.x = -Math.PI / 2;
    mh.rotation.z = Math.PI / 2;
    mh.position.set(0, 0.04, s);
    mh.receiveShadow = true;
    scene.add(mh);
  }
  // Boulevard centre median glow strip (visual only).
  var median = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 480),
    new THREE.MeshStandardMaterial({
      color: 0x6b7c8a, roughness: 0.8, metalness: 0, flatShading: true
    }));
  median.position.set(-210, 0.12, 0);
  scene.add(median);

  // Sand beach + boardwalk + sea (west edge).
  flatPlane(24, 480, new THREE.MeshStandardMaterial({
    color: P.sand, roughness: 1, metalness: 0, flatShading: true
  }), -234, 0, 0.01);
  var bwTex = plankTex.clone();
  bwTex.needsUpdate = true;
  bwTex.repeat.set(1, 12);
  flatPlane(12, 480, new THREE.MeshStandardMaterial({
    map: bwTex, roughness: 0.9, metalness: 0, flatShading: true
  }), -216, 0, 0.02);
  var sea = flatPlane(260, 480, new THREE.MeshStandardMaterial({
    color: P.sea, roughness: 0.28, metalness: 0.15, flatShading: true
  }), -376, 0, -0.05);
  sea.receiveShadow = false;
  // Sun glints on the water (small, soft — never another sun disc).
  for (i = 0; i < 6; i++) {
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
    // World bounds + sea fence: nobody walks into the water or off the map.
    if (x < -236 || x > 240 || z < -240 || z > 240) return true;
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
  for (var fz = -240; fz <= 240; fz += 20) {
    registerBlocker(-239, fz, 3, 10);
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

  var DAY = {
    top: new THREE.Color(P.skyZenith), mid: new THREE.Color(0xffc98a),
    hor: new THREE.Color(P.skyHorizon),
    fog: new THREE.Color(P.fogHorizon), sun: new THREE.Color(0xffc27a),
    hemiSky: new THREE.Color(0xffd9a0), hemiGround: new THREE.Color(0x8a6f52),
    hemiI: 1.05, sunI: 2.1, fogD: 0.0019, sunScale: 1
  };
  var NIGHT = {
    top: new THREE.Color(P.skyNightTop), mid: new THREE.Color(0x3a2b5c),
    hor: new THREE.Color(P.skyNightHorizon),
    fog: new THREE.Color(0x1a1f3a), sun: new THREE.Color(0x8fa8ff),
    hemiSky: new THREE.Color(0x4a5a8a), hemiGround: new THREE.Color(0x1a1626),
    hemiI: 0.35, sunI: 0.35, fogD: 0.0022, sunScale: 0.55
  };

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
    scene.fog.color.copy(_cFog);
    scene.fog.density = DAY.fogD + (NIGHT.fogD - DAY.fogD) * n;
    sunLight.color.copy(_cSun);
    sunLight.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * n;
    hemi.color.copy(_cHemiSky);
    hemi.intensity = DAY.hemiI + (NIGHT.hemiI - DAY.hemiI) * n;
    var sc = DAY.sunScale + (NIGHT.sunScale - DAY.sunScale) * n;
    sunGlow.scale.set(260 * sc, 260 * sc, 1);
    sunCore.scale.set(90 * sc, 90 * sc, 1);
  }

  // Re-centre the sun shadow camera + sky on the focus point every frame.
  function update(dt, focusX, focusZ) {
    _focus.set(focusX || 0, 0, focusZ || 0);
    var dir = nightness > 0.5 ? SUN_DIR_NIGHT : SUN_DIR_DAY;
    _sunPos.copy(_focus).addScaledVector(dir, 150);
    sunLight.position.copy(_sunPos);
    sunLight.target.position.copy(_focus);
    sunLight.target.updateMatrixWorld();
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
    hemiLight: hemi,
    setTimeOfDay: setTimeOfDay,
    districtAt: districtAt,
    isBlocked: isBlocked,
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
