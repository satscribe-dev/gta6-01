// effects.js — Slice B: pooled particles + screen shake for VANDARA RUSH.
// Fixed-size pools, zero allocation per frame in the hot path: sprites are
// created once at init and recycled. Smoke (white, expanding), flame
// (blue/orange, additive), muzzle flash (glow sprite), tracers (thin lines),
// explosion (flame + smoke + shake). Screen shake is a FLAG read by main.js
// (VR.Effects.shakeX / shakeY) — this file never touches the camera.
// Guarded: safe no-op when VR.World / VR.Audio are missing.
(function (VR) {
  'use strict';

  var SMOKE_N = 140, FLAME_N = 70, TRACER_N = 24, FLASH_N = 8;

  var smokeTex = null, glowTex = null;
  var smokePool = [], flamePool = [], tracerPool = [], flashPool = [];
  var trauma = 0;
  var initialized = false;

  function radialTexture(inner, outer) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    return tex;
  }

  function init() {
    if (initialized || !VR.World || !VR.World.scene) return false;
    smokeTex = radialTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
    glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    var scene = VR.World.scene;
    var i, s, m, line, geo;
    for (i = 0; i < SMOKE_N; i++) {
      m = new THREE.SpriteMaterial({ map: smokeTex, color: 0xd8d8d8, transparent: true, opacity: 0, depthWrite: false });
      s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      smokePool.push({ spr: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1, base: 1 });
    }
    for (i = 0; i < FLAME_N; i++) {
      m = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      flamePool.push({ spr: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: -1, base: 1 });
    }
    for (i = 0; i < TRACER_N; i++) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      tracerPool.push({ line: line, life: 0, max: 0.09 });
    }
    for (i = 0; i < FLASH_N; i++) {
      m = new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      flashPool.push({ spr: s, life: 0, max: 0.07 });
    }
    initialized = true;
    return true;
  }

  function nextFree(pool) {
    for (var i = 0; i < pool.length; i++) if (pool[i].life <= 0) return pool[i];
    return pool[0]; // pool full: recycle the oldest slot
  }

  function spawnSmoke(x, y, z, n) {
    if (!init()) return;
    n = n || 1;
    for (var k = 0; k < n; k++) {
      var p = nextFree(smokePool);
      p.spr.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.5);
      p.vx = (Math.random() - 0.5) * 0.8; p.vy = 0.7 + Math.random() * 0.9; p.vz = (Math.random() - 0.5) * 0.8;
      p.max = 0.9 + Math.random() * 0.9; p.life = p.max;
      p.base = 0.7 + Math.random() * 0.6; p.grow = 2.2;
      p.spr.material.opacity = 0.55;
      p.spr.scale.set(p.base, p.base, 1);
      p.spr.visible = true;
    }
  }

  function spawnFlame(x, y, z, n) {
    if (!init()) return;
    n = n || 1;
    for (var k = 0; k < n; k++) {
      var p = nextFree(flamePool);
      p.spr.position.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.3);
      p.vx = (Math.random() - 0.5) * 0.6; p.vy = 1.2 + Math.random() * 1.4; p.vz = (Math.random() - 0.5) * 0.6;
      p.max = 0.28 + Math.random() * 0.22; p.life = p.max;
      p.base = 0.55 + Math.random() * 0.5; p.grow = -0.8;
      // blue core sometimes, orange mostly (nitro / explosion mix)
      p.spr.material.color.setHex(Math.random() < 0.3 ? 0x37e0ff : (Math.random() < 0.5 ? 0xffa040 : 0xff5a1a));
      p.spr.material.opacity = 0.95;
      p.spr.scale.set(p.base, p.base, 1);
      p.spr.visible = true;
    }
  }

  function muzzleFlash(pos, dir) {
    if (!init() || !pos) return;
    var f = nextFree(flashPool);
    f.spr.position.set(pos.x, pos.y, pos.z);
    f.max = 0.07; f.life = f.max;
    f.spr.scale.set(1.6, 1.6, 1);
    f.spr.material.opacity = 1;
    f.spr.visible = true;
    spawnFlame(pos.x, pos.y, pos.z, 2);
  }

  function tracer(from, to) {
    if (!init() || !from || !to) return;
    var t = nextFree(tracerPool);
    var arr = t.line.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.max = 0.09; t.life = t.max;
    t.line.material.opacity = 0.9;
    t.line.visible = true;
  }

  function explosion(x, y, z) {
    if (!init()) return;
    spawnFlame(x, y + 0.5, z, 16);
    spawnSmoke(x, y + 1.0, z, 12);
    shake(1.0);
    if (VR.Audio && VR.Audio.play) VR.Audio.play('explosion');
  }

  function shake(amount) {
    trauma = Math.min(1, trauma + amount);
  }

  function update(dt) {
    if (!initialized) { init(); return; }
    var i, p, k;
    for (i = 0; i < smokePool.length; i++) {
      p = smokePool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.spr.visible = false; p.spr.material.opacity = 0; continue; }
      var f = p.life / p.max;
      p.spr.position.x += p.vx * dt; p.spr.position.y += p.vy * dt; p.spr.position.z += p.vz * dt;
      var s = p.base + (1 - f) * p.grow;
      p.spr.scale.set(s, s, 1);
      p.spr.material.opacity = 0.55 * f;
    }
    for (i = 0; i < flamePool.length; i++) {
      p = flamePool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.spr.visible = false; p.spr.material.opacity = 0; continue; }
      k = p.life / p.max;
      p.spr.position.x += p.vx * dt; p.spr.position.y += p.vy * dt; p.spr.position.z += p.vz * dt;
      var fs = Math.max(0.1, p.base * (0.5 + k));
      p.spr.scale.set(fs, fs, 1);
      p.spr.material.opacity = 0.95 * k;
    }
    for (i = 0; i < tracerPool.length; i++) {
      var t = tracerPool[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; t.line.material.opacity = 0; continue; }
      t.line.material.opacity = 0.9 * (t.life / t.max);
    }
    for (i = 0; i < flashPool.length; i++) {
      p = flashPool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.spr.visible = false; p.spr.material.opacity = 0; continue; }
      p.spr.material.opacity = p.life / p.max;
    }
    // shake decay; main.js reads shakeX/shakeY and adds them to the camera
    trauma = Math.max(0, trauma - dt * 1.6);
    var sh = trauma * trauma;
    VR.Effects.shakeX = (Math.random() * 2 - 1) * sh * 0.35;
    VR.Effects.shakeY = (Math.random() * 2 - 1) * sh * 0.35;
  }

  VR.Effects = {
    spawnSmoke: spawnSmoke,
    spawnFlame: spawnFlame,
    muzzleFlash: muzzleFlash,
    tracer: tracer,
    explosion: explosion,
    shake: shake,
    update: update,
    shakeX: 0,
    shakeY: 0,
    get trauma() { return trauma; }
  };
})(window.VR);
