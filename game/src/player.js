// SOLARA BAY — on-foot player controller (W2). Kai Mercer.
// WASD relative to the camera, sprint, jump, mouse-aimed hitscan shooting,
// weapon switching, enter/exit cars, health/armour, wasted at 0 HP.
import * as THREE from 'three';
import { WEAPONS, CHARACTERS } from './config.js';
import { nearestCar, stealCar } from './vehicles.js';

const WALK_SPEED = 4;
const SPRINT_SPEED = 7;
const JUMP_VELOCITY = 5.2;
const GRAVITY = 14;
const CITY_HALF = 238;
const BEACH_Z = 212;
const AMMO_KEY = ['fists', 'pistol', 'smg', 'shotgun'];

let game = null;
let fireCooldown = 0;
let reloadCooldown = 0;
let walkPhase = 0;
let vy = 0;
let grounded = true;
let mouseHeld = false;
let tracer = null;
let tracerLife = 0;
let flash = null;
let flashLife = 0;
let gun = null;
let armL = null;
let armR = null;
let legL = null;
let legR = null;
let body = null;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function buildCharacter() {
  const g = new THREE.Group();
  const shirt = CHARACTERS.kai.color;
  const skin = 0xd9a066;
  const pants = 0x2b3242;

  body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.72, 6, 12),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }),
  );
  body.position.y = 1.08;
  body.castShadow = true;
  g.add(body);

  // dark belt / jacket hem
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.12, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 }),
  );
  belt.position.y = 0.72;
  g.add(belt);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 14),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }),
  );
  head.position.y = 1.78;
  head.castShadow = true;
  g.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.245, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.95 }),
  );
  hair.position.y = 1.82;
  g.add(hair);

  function limb(w, h, d, color, x, y) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    g.add(pivot);
    return pivot;
  }

  armL = limb(0.13, 0.62, 0.13, shirt, -0.44, 1.42);
  armR = limb(0.13, 0.62, 0.13, shirt, 0.44, 1.42);
  legL = limb(0.17, 0.72, 0.17, pants, -0.17, 0.74);
  legR = limb(0.17, 0.72, 0.17, pants, 0.17, 0.74);

  // gun held in the right hand (hidden for fists)
  gun = new THREE.Group();
  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.12, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x191919, roughness: 0.4, metalness: 0.7 }),
  );
  gunBody.castShadow = true;
  gun.add(gunBody);
  gun.position.set(0, -0.62, 0.12);
  gun.visible = false;
  armR.add(gun);

  return g;
}

function buildShotFx(scene) {
  // tracer line (reused, hidden when idle)
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(),
  ]);
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0.9,
  }));
  tracer.visible = false;
  tracer.frustumCulled = false;
  scene.add(tracer);

  // muzzle flash sprite from a generated radial texture (no network)
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,160,40,0.9)');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
  }));
  flash.scale.set(0.7, 0.7, 1);
  flash.visible = false;
  scene.add(flash);
}

function init(g) {
  game = g;
  const group = buildCharacter();
  group.position.copy(game.player.pos);
  game.scene.add(group);
  game.player.group = group;
  game.player.mesh = body;
  buildShotFx(game.scene);

  window.addEventListener('mousedown', (e) => { if (e.button === 0) mouseHeld = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseHeld = false; });
  window.addEventListener('blur', () => { mouseHeld = false; });
}

function cameraForward() {
  game.camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 0.001) _fwd.set(0, 0, 1);
  _fwd.normalize();
  return _fwd;
}

function switchWeapon(id) {
  const p = game.player;
  if (id < 0 || id > 3 || p.weapon === id) return;
  p.weapon = id;
  if (gun) {
    gun.visible = id > 0;
    // pistol compact, SMG longer, shotgun longest
    const len = id === 1 ? 1 : id === 2 ? 1.5 : 1.9;
    gun.scale.set(1, 1, len);
  }
  game.events.emit('weapon', { weapon: id, name: WEAPONS[id].name });
}

function reload() {
  const p = game.player;
  if (p.weapon === 0) return;
  const key = AMMO_KEY[p.weapon];
  if (p.ammo[key] >= WEAPONS[p.weapon].ammo) return;
  p.ammo[key] = WEAPONS[p.weapon].ammo;
  reloadCooldown = 0.5;
  fireCooldown = Math.max(fireCooldown, 0.5);
  game.events.emit('reload', { weapon: p.weapon });
}

function shootTarget(root, kind, ref) {
  const hits = _ray.intersectObject(root, true);
  if (!hits.length) return null;
  return { dist: hits[0].distance, point: hits[0].point, kind, ref };
}

function fire() {
  const p = game.player;
  const w = WEAPONS[p.weapon];
  if (fireCooldown > 0 || reloadCooldown > 0) return;
  fireCooldown = w.rate;

  _eye.copy(p.pos); _eye.y += 1.55;
  cameraForward();
  _aim.copy(_fwd);

  // fists: short melee swing, no ammo, no tracer
  if (p.weapon === 0) {
    _ray.set(_eye, _aim);
    _ray.far = 2.4;
    let best = null;
    if (Array.isArray(game.enemies)) {
      for (const e of game.enemies) {
        if (!e || e.alive === false || !e.group) continue;
        const hit = shootTarget(e.group, 'enemy', e);
        if (hit && (!best || hit.dist < best.dist)) best = hit;
      }
    }
    if (best) damageEnemy(best.ref, w.damage);
    return;
  }

  const key = AMMO_KEY[p.weapon];
  if (p.ammo[key] <= 0) {
    game.events.emit('dryfire', { weapon: p.weapon });
    fireCooldown = 0.25;
    return;
  }
  p.ammo[key] -= 1;

  // heat + peds hear the shot
  game.lastShotPos = _eye.clone();
  game.lastShotAt = performance.now() / 1000;
  game.events.emit('shot', { x: p.pos.x, z: p.pos.z });
  game.events.emit('heat', { amount: 1, reason: 'shooting' });
  if (game.audio && typeof game.audio.play === 'function') game.audio.play('gunshot');

  const pellets = p.weapon === 3 ? 5 : 1;
  let endPoint = null;
  for (let i = 0; i < pellets; i += 1) {
    const dir = _aim.clone();
    if (pellets > 1) {
      dir.x += (Math.random() - 0.5) * 0.12;
      dir.y += (Math.random() - 0.5) * 0.12;
      dir.z += (Math.random() - 0.5) * 0.12;
      dir.normalize();
    }
    _ray.set(_eye, dir);
    _ray.far = 120;
    let best = null;
    if (Array.isArray(game.enemies)) {
      for (const e of game.enemies) {
        if (!e || e.alive === false || !e.group) continue;
        const hit = shootTarget(e.group, 'enemy', e);
        if (hit && (!best || hit.dist < best.dist)) best = hit;
      }
    }
    for (const car of game.cars) {
      if (!car || !car.group || car === game.currentCar) continue;
      const hit = shootTarget(car.group, 'car', car);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    const hitPoint = best ? best.point.clone() : _eye.clone().addScaledVector(dir, 120);
    if (!endPoint || (best && best.dist < endPoint.dist)) endPoint = { point: hitPoint, dist: best ? best.dist : 120 };
    if (best) {
      if (best.kind === 'enemy') damageEnemy(best.ref, w.damage);
      else damageCar(best.ref, w.damage);
    }
  }

  // tracer + muzzle flash
  if (gun) gun.getWorldPosition(_muzzle);
  else _muzzle.copy(_eye);
  const posAttr = tracer.geometry.attributes.position;
  posAttr.setXYZ(0, _muzzle.x, _muzzle.y, _muzzle.z);
  posAttr.setXYZ(1, endPoint.point.x, endPoint.point.y, endPoint.point.z);
  posAttr.needsUpdate = true;
  tracer.visible = true;
  tracerLife = 0.07;
  flash.position.copy(_muzzle);
  flash.visible = true;
  flashLife = 0.05;
}

function damageEnemy(enemy, dmg) {
  if (!enemy || typeof enemy.health !== 'number') return;
  enemy.health -= dmg;
  game.events.emit('hit', { target: 'enemy', damage: dmg });
  if (enemy.health <= 0 && enemy.alive !== false) {
    enemy.alive = false;
    if (enemy.group) enemy.group.visible = false;
    game.events.emit('enemyDown', { enemy });
  }
}

function damageCar(car, dmg) {
  if (!car) return;
  car.condition = Math.max(0, (car.condition ?? 100) - dmg * 0.4);
  game.events.emit('hit', { target: 'car', damage: dmg });
}

function enterCar(car) {
  if (!car || !game) return;
  if (game.currentCar && game.currentCar !== car) exitCar();
  car.isPlayer = true;
  game.currentCar = car;
  game.player.onFoot = false;
  game.player.speed = 0;
  game.player.pos.copy(car.pos);
  game.player.pos.y = 0;
  if (game.player.group) game.player.group.visible = false;
  game.events.emit('enterCar', { type: car.type });
}

function exitCar() {
  if (!game || !game.currentCar) return;
  const car = game.currentCar;
  car.isPlayer = false;
  game.currentCar = null;
  const p = game.player;
  p.onFoot = true;
  p.speed = 0;
  // step out on the driver's side, just clear of the body
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  p.pos.set(
    THREE.MathUtils.clamp(car.pos.x + rx * 2.6, -CITY_HALF, CITY_HALF),
    0,
    THREE.MathUtils.clamp(car.pos.z + rz * 2.6, -CITY_HALF, BEACH_Z),
  );
  p.heading = car.heading;
  if (p.group) {
    p.group.visible = true;
    p.group.position.copy(p.pos);
    p.group.rotation.y = p.heading;
  }
}

function takeDamage(n) {
  if (!game || game.mode !== 'playing') return;
  const p = game.player;
  if (p.health <= 0) return;
  const absorbed = Math.min(p.armour, n);
  p.armour -= absorbed;
  p.health = Math.max(0, p.health - (n - absorbed));
  game.events.emit('damage', { amount: n, health: p.health, armour: p.armour });
  if (p.health <= 0) {
    p.health = 0;
    game.setMode('wasted');
  }
}

function update(dt) {
  if (!game) return;
  const p = game.player;
  const keys = game.input.keys;

  fireCooldown = Math.max(0, fireCooldown - dt);
  reloadCooldown = Math.max(0, reloadCooldown - dt);

  if (tracerLife > 0) {
    tracerLife -= dt;
    if (tracerLife <= 0) tracer.visible = false;
  }
  if (flashLife > 0) {
    flashLife -= dt;
    if (flashLife <= 0) flash.visible = false;
  }

  // --- driving: only F (exit) is handled here; cars move in vehicles.js ---
  if (game.currentCar) {
    p.pos.copy(game.currentCar.pos);
    p.pos.y = 0;
    if (keys.has('KeyF')) {
      keys.delete('KeyF');
      exitCar();
    }
    return;
  }

  // --- weapon switch / reload (edge-triggered) ---
  if (keys.has('Digit1')) { keys.delete('Digit1'); switchWeapon(0); }
  if (keys.has('Digit2')) { keys.delete('Digit2'); switchWeapon(1); }
  if (keys.has('Digit3')) { keys.delete('Digit3'); switchWeapon(2); }
  if (keys.has('Digit4')) { keys.delete('Digit4'); switchWeapon(3); }
  if (keys.has('KeyR')) { keys.delete('KeyR'); reload(); }

  // --- enter nearest car ---
  if (keys.has('KeyF')) {
    keys.delete('KeyF');
    const car = nearestCar(p.pos, 4.5);
    if (car) {
      stealCar(car);
      enterCar(car);
      return;
    }
  }

  // --- on-foot movement, relative to the camera ---
  cameraForward();
  _right.set(_fwd.z, 0, -_fwd.x);
  _move.set(0, 0, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) _move.add(_fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) _move.sub(_fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) _move.add(_right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) _move.sub(_right);

  const moving = _move.lengthSq() > 0.001;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const targetSpeed = moving ? (sprint ? SPRINT_SPEED : WALK_SPEED) : 0;
  p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);
  if (Math.abs(p.speed) < 0.05) p.speed = 0;

  if (moving && p.speed > 0.1) {
    _move.normalize();
    p.pos.addScaledVector(_move, p.speed * dt);
    p.heading = Math.atan2(_move.x, _move.z);
    walkPhase += p.speed * dt * 2.2;
  }

  // --- jump ---
  if (keys.has('Space') && grounded) {
    vy = JUMP_VELOCITY;
    grounded = false;
  }
  if (!grounded) {
    vy -= GRAVITY * dt;
    p.pos.y += vy * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      vy = 0;
      grounded = true;
    }
  }

  // --- stay inside the city (beach edge, not the ocean) ---
  p.pos.x = THREE.MathUtils.clamp(p.pos.x, -CITY_HALF, CITY_HALF);
  p.pos.z = THREE.MathUtils.clamp(p.pos.z, -CITY_HALF, BEACH_Z);

  // --- shooting ---
  const clicked = game.input.clicked;
  game.input.clicked = false;
  const w = WEAPONS[p.weapon];
  if (w.auto ? mouseHeld : clicked) fire();

  // --- mesh sync + procedural walk swing ---
  if (p.group) {
    p.group.position.copy(p.pos);
    p.group.rotation.y = p.heading;
    const swing = moving ? Math.sin(walkPhase) * 0.65 * Math.min(1, p.speed / WALK_SPEED) : 0;
    if (armL) armL.rotation.x = swing;
    if (armR) armR.rotation.x = -swing;
    if (legL) legL.rotation.x = -swing;
    if (legR) legR.rotation.x = swing;
    // right arm aims forward while shooting
    if (mouseHeld && p.weapon > 0 && armR) armR.rotation.x = -1.2;
  }
}

export { enterCar, exitCar, takeDamage };
export default { init, update, enterCar, exitCar, takeDamage };
