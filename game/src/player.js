// player.js — Damian Reyes on foot: third-person Pointer Lock mouse
// look, WASD + Shift sprint + Space jump, procedural limb swing,
// wall collision via VR.World.isBlocked, FOV widening on sprint.
// Car enter/exit delegates to VR.Vehicles when it exists (slice B).
// CAMERA OWNER: this file owns every gameplay camera — the on-foot
// over-shoulder camera AND the in-car chase camera (updateCarCamera,
// cinematic follow + corner roll + nitro FOV). main.js never positions
// the camera while playing; it only runs the title orbit.
(function (VR) {
  'use strict';

  var C = VR.Config;
  var P = C.PALETTE;
  var PT = C.PLAYER;

  var pos = new THREE.Vector3(-210, 0, -30); // boulevard intersection,
  // facing east down a clear street (no building directly ahead)
  var yaw = Math.PI / 2; // facing east, into the city
  // Art pass (18 Nov): near-level default pitch — the old -0.12 stared
  // down at the asphalt; -0.04 keeps the horizon and sky in the top
  // of the frame on foot and in the car.
  var pitch = -0.04;
  var vy = 0;
  var grounded = true;
  var walkPhase = 0;
  var speedNow = 0;
  var fovNow = 62;

  // ---------- Damian body (v6 — rig proportions, Codrops/Stacy) ----------
  // Head: SphereGeometry(0.3, 8, 8) — NEVER changed. Legs: the
  // user-spec CylinderGeometry(0.2, 0.15, 0.9, 8) for thigh + shin.
  // v6 vs v5: RIG proportions — hip raised 0.90 -> 1.30 so legs are
  // ~49% of the figure (thigh + shin 0.65 each); torso/arms/head
  // moved up to match; nose added (face: eyes + brows + nose +
  // mouth). The fixed Ø0.6 head caps the head ratio at ~1/4.4 —
  // 1/7 is unreachable without breaking the head spec, stated
  // honestly in the report. Shoulders (0.96 wide incl. caps) stay
  // wider than hips (0.70). No boxes anywhere.
  // Raw figure is ~2.32 tall, so the whole group is scaled 0.8x
  // uniformly -> ~1.86 total height; the constructor numbers above
  // are never changed, only the group scale.
  function std(color, rough) {
    return new THREE.MeshStandardMaterial({
      color: color, roughness: rough == null ? 0.85 : rough,
      metalness: 0, flatShading: false
    });
  }
  function ball(r, mat, px, py, pz, sx, sy, sz) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
    m.position.set(px, py, pz);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
    m.castShadow = true;
    return m;
  }

  var group = new THREE.Group();
  var shirt = std(P.damianShirt);
  var pants = std(P.damianPants);
  var skin = std(P.damianSkin, 0.7); // skin zone: smoother than cloth
  var hairMat = std(0x1a1a1a, 0.55);
  var dark = std(0x222222);
  // Costume zones (v4, riset v2 §1 game-studio recipe): jacket =
  // burnt orange, backpack = dark brown, skin smoother than cloth —
  // each zone has its own colour AND roughness, so the figure reads
  // as a dressed character, not stacked bare cylinders.
  var jacketMat = std(0xb85c14, 0.9);
  var jacketDark = std(0x7a3d0d, 0.9);
  var packMat = std(0x4a3524, 0.95);
  var eyeWhite = std(0xffffff, 0.4);

  // JACKET TORSO (v6 — rig proportions; v8: hem extended so the
  // torso FLOWS into the hips instead of ending in a cut at the
  // waist): the garment IS the torso — shoulders r 0.32 (0.64 wide)
  // tapering to hem r 0.19 (0.38), centre 1.63 (spans hip 1.25 ->
  // chest 2.01). The hem now overlaps the thigh tops, so the
  // waist seam is inside the jacket, not a cut line. The hip
  // sits at 1.30 raw so the legs are ~49% of the figure (human
  // proportion, riset v2/Codrops-Stacy rig); the old 0.90 hip made
  // the legs 37% and the figure squat. Head is fixed Ø0.6 by spec,
  // so 1/7 head ratio is unreachable (measured 1/4.4) — legs ~50%
  // + shoulders wider than hips is the honest fix.
  var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.19, 0.76, 10), jacketMat);
  torso.position.set(0, 1.63, 0);
  torso.castShadow = true;
  // Collar (v7): CREAM stand + thick torus ring under the chin — the
  // v6 dark-on-orange collar did not read from the front, so the
  // collar is now a high-contrast light zone against the jacket.
  var collarMat = std(0xf5e9c8, 0.85);
  var collarStand = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.18, 10), collarMat);
  collarStand.position.set(0, 2.00, 0);
  collarStand.castShadow = true;
  var collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.075, 8, 14), collarMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 2.04, 0);
  collar.castShadow = true;
  // Zipper: thin dark strip down the jacket front, tilted to follow
  // the taper (top proud of the 0.32 chest, bottom of the 0.19 hem).
  var zipper = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), dark);
  zipper.position.set(0, 1.65, 0.26);
  zipper.rotation.x = 0.216;
  zipper.castShadow = true;
  // Pockets: BIG round shapes with a flap above each — a pocket
  // must read as a pocket, not a flat patch.
  var pocketL = ball(0.09, jacketDark, -0.13, 1.42, 0.21, 1.1, 1.1, 0.45);
  var pocketR = ball(0.09, jacketDark, 0.13, 1.42, 0.21, 1.1, 1.1, 0.45);
  var flapL = ball(0.06, jacketDark, -0.13, 1.51, 0.22, 1.3, 0.5, 0.4);
  var flapR = ball(0.06, jacketDark, 0.13, 1.51, 0.22, 1.3, 0.5, 0.4);
  var pocketChest = ball(0.075, jacketDark, -0.12, 1.80, 0.28, 1.1, 1.1, 0.45);
  var flapChest = ball(0.05, jacketDark, -0.12, 1.87, 0.29, 1.3, 0.5, 0.4);
  // BACKPACK (v7): raised 1.68 -> 1.80 so the waist taper below it
  // stays visible from behind; the v6 pack hid the V. Straps + flap
  // move up with it. BACK V-PANEL (v8): the v7 DARK panel
  // (jacketDark on orange) did not read as a panel from behind,
  // so it is now the same CREAM as the collar — high contrast
  // against the orange jacket, so the panel + the V below the
  // pack read clearly. Front taper untouched. (v8-cont: bottom
  // radius 0.165 -> 0.20 so the panel stays proud of the wider
  // v8 torso hem, 0.19 at y 1.25; centre lowered to 1.60 so the
  // panel meets the hem band without a gap.)
  var pack = ball(0.21, packMat, 0, 1.80, -0.30, 1, 1.25, 0.55);
  var packFlap = ball(0.15, std(0x2e2015, 0.95), 0, 1.97, -0.35, 1.2, 0.7, 0.5);
  var backPanel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.335, 0.20, 0.62, 10, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    collarMat);
  backPanel.position.set(0, 1.60, 0);
  backPanel.castShadow = true;
  var strapL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), packMat);
  strapL.position.set(-0.15, 1.80, 0.26);
  strapL.rotation.x = -0.1;
  strapL.castShadow = true;
  var strapR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), packMat);
  strapR.position.set(0.15, 1.80, 0.26);
  strapR.rotation.x = -0.1;
  strapR.castShadow = true;
  // Epaulettes (v8 — jacket reads SHARP): dark shoulder boards
  // astride the torso top edge, clear of the collar.
  var epauL = ball(0.06, jacketDark, -0.26, 2.005, 0, 1.7, 0.4, 1.0);
  var epauR = ball(0.06, jacketDark, 0.26, 2.005, 0, 1.7, 0.4, 1.0);
  group.add(torso); group.add(collarStand); group.add(collar);
  group.add(zipper); group.add(pocketL); group.add(pocketR);
  group.add(flapL); group.add(flapR);
  group.add(pocketChest); group.add(flapChest);
  group.add(pack); group.add(packFlap); group.add(backPanel); group.add(strapL); group.add(strapR);
  group.add(epauL); group.add(epauR);
  // Head: skin sphere r=0.3 (spec, never changed) on a 2.28 centre —
  // the raised hips/torso moved the whole upper body up. Face,
  // front (+z is forward): white eyes + pupils, brows, NOSE (v6,
  // small skin bump), mouth.
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), skin);
  head.position.set(0, 2.28, 0);
  head.castShadow = true;
  // Eyes (v8 — NORMALISED: the v7 whites r 0.075 were cartoon-big,
  // doll/mascot eyes). Human proportion: each eye ~1/5 of the 0.6
  // face width (Ø 0.11), gap between the eyes ~one eye width
  // (centres ±0.115, inner gap 0.12). Whites flattened (z 0.55)
  // so they sit as lenses ON the face, not protruding balls;
  // pupil small (r 0.02) in the middle of the white.
  var eyeL, eyeR;
  [-1, 1].forEach(function (m) {
    var eye = ball(0.055, eyeWhite, m * 0.115, 2.32, 0.28, 1, 1, 0.55);
    group.add(eye);
    group.add(ball(0.02, dark, m * 0.115, 2.32, 0.305, 1, 1, 0.5));
    // Brows (v8 — CONFIDENT: long flat bars, inner ends angled
    // slightly down, not round blobs).
    var brow = ball(0.04, hairMat, m * 0.115, 2.415, 0.26, 1.9, 0.32, 0.5);
    brow.rotation.z = 0.12 * m;
    group.add(brow);
    if (m < 0) eyeL = eye; else eyeR = eye;
  });
  // Nose (v7): BIGGER + a shade darker than skin (0x9a6a42 vs skin
  // 0xc98d64) + pushed further forward — the v6 bump (r 0.05, skin
  // colour, tip only ~0.02 proud of the face) did not read at 3 m.
  // Tip now sits ~0.08 proud of the face; still a nose, not a clown nose.
  var noseMat = std(0x9a6a42, 0.7);
  var nose = ball(0.075, noseMat, 0, 2.24, 0.30, 1.1, 1.15, 1.0);
  group.add(nose);
  // Mouth (v8 — FIRM straight line: wider + flatter, no pout, no grin).
  var mouth = ball(0.045, dark, 0, 2.16, 0.265, 2.0, 0.35, 0.6);
  // Neck: small skin cylinder between torso top (2.00) and head.
  var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.22, 8), skin);
  neck.position.set(0, 2.08, 0);
  neck.castShadow = true;
  var hairTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hairTop.position.set(0, 2.31, -0.03);
  hairTop.castShadow = true;
  var hairBack = ball(0.2, hairMat, 0, 2.24, -0.12, 1, 1, 0.7);
  // Hair, shaped (v4; v8 — NEAT: the bangs are one continuous
  // flattened fringe, not three round buns; the crest is a tighter
  // swept-back ridge; one diagonal side-swept lock crosses the
  // right forehead so the hair reads styled, not a round cap).
  var crestA = ball(0.12, hairMat, 0, 2.57, 0.06, 1, 0.6, 1.4);
  var crestB = ball(0.13, hairMat, 0, 2.58, -0.08, 1, 0.6, 1.4);
  var crestC = ball(0.11, hairMat, 0, 2.55, -0.20, 1, 0.6, 1.4);
  var bangL = ball(0.09, hairMat, -0.10, 2.49, 0.20, 1.2, 0.75, 0.75);
  var bangC = ball(0.09, hairMat, 0, 2.50, 0.21, 1.2, 0.75, 0.75);
  var bangR = ball(0.09, hairMat, 0.10, 2.49, 0.20, 1.2, 0.75, 0.75);
  var sweep = ball(0.085, hairMat, 0.13, 2.53, 0.16, 1.7, 0.5, 0.8);
  sweep.rotation.z = -0.4;
  group.add(head);
  group.add(eyeL); group.add(eyeR); group.add(mouth); group.add(neck);
  group.add(hairTop); group.add(hairBack);
  group.add(crestA); group.add(crestB); group.add(crestC);
  group.add(bangL); group.add(bangC); group.add(bangR); group.add(sweep);
  // Belt + chest emblem (v8: the band is now a HEM STRIPE at the
  // jacket bottom (y 1.23, r 0.205 — proud of the 0.19 hem and of
  // the back panel's 0.20 bottom edge), not a waist belt — the v8
  // torso hem covers the old waist position.
  var bandMat = std(0xff8c1a, 0.8);
  var band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.195, 0.12, 10), bandMat);
  band.position.set(0, 1.23, 0);
  band.castShadow = true;
  var emblem = ball(0.07, std(0xf2f2f2, 0.6), 0.13, 1.82, 0.26, 1, 1, 0.4);
  group.add(band); group.add(emblem);

  // ---------- joints (Codrops pivot technique, riset v2) ----------
  // Every limb joint is a THREE.Group placed AT the joint; the mesh
  // hangs below it and the GROUP rotates, never the mesh (rotating a
  // mesh spins it around its own centre — wrong). Joints: shoulder,
  // elbow, hip, knee, ankle. Limbs are tapered cylinders (narrower
  // at the far end), never boxes.
  function limb(geo, mat, px, py) {
    var pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    var m = new THREE.Mesh(geo, mat);
    // v8: mesh top pokes 0.04 ABOVE the pivot, deep into the
    // deltoid cap — the segment never ends flush at the joint.
    m.position.y = -geo.parameters.height / 2 + 0.04;
    m.castShadow = true;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  }
  // Arms (v5, jacket sleeves): built in a mirror loop with
  // multiplier m (-1 left / +1 right): shoulder pivot at x = m * 0.34
  // (clear of the 0.32 jacket shoulder), rest tilt 15deg * m — the
  // old 30deg tilt splayed the hands wider than the shoulders and
  // killed the torso V-read. Each arm is TWO separate segments
  // joined at an elbow pivot group — upper arm (jacket) + forearm
  // (jacket) — with a PERMANENT inward kink (rotation.z) so the
  // elbow reads as a joint from the FRONT, not just from the side.
  // The deltoid cap rides INSIDE the shoulder pivot; the hand is a
  // flattened mitten palm + thumb bump; a blue cuff ring marks the
  // wrist. update() only ever writes rotation.x (swing), so the
  // rest tilt and the kink survive.
  var armL, armR, elbowL, elbowR;
  [-1, 1].forEach(function (m) {
    var shoulder = limb(new THREE.CylinderGeometry(0.115, 0.10, 0.34, 8), jacketMat, m * 0.34, 1.90);
    shoulder.rotation.z = 0.26 * m; // 15 deg outward rest tilt
    // v8: deltoid cap 0.14 -> 0.16 — a real SHOULDER CAP that
    // blends arm into torso, no gap at the shoulder seam.
    shoulder.add(ball(0.16, jacketMat, 0, 0.02, 0)); // deltoid cap
    var elbow = new THREE.Group();
    elbow.position.set(0, -0.34, 0);
    elbow.rotation.z = -0.18 * m; // permanent inward kink: elbow reads from the front
    var fore = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.085, 0.32, 8), jacketMat);
    // v8: forearm top pokes 0.03 above the elbow pivot, into the cap.
    fore.position.y = -0.13;
    fore.castShadow = true;
    elbow.add(fore);
    elbow.add(ball(0.11, jacketMat, 0, 0, 0)); // elbow joint cap (v8: 0.095 -> 0.11, covers the forearm top)
    // Blue cuff ring at the wrist (shirt colour kept in the costume).
    var cuff = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 12), shirt);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.30, 0);
    elbow.add(cuff);
    // Mitten hand: flattened palm + thumb bump on the inner side.
    elbow.add(ball(0.085, skin, 0, -0.35, 0.01, 1, 1.3, 0.75));
    elbow.add(ball(0.035, skin, m * 0.055, -0.31, 0.06)); // thumb
    shoulder.add(elbow);
    if (m < 0) { armL = shoulder; elbowL = elbow; }
    else { armR = shoulder; elbowR = elbow; }
  });
  // Legs (v6 — rig proportions): TWO separate legs (never one
  // cylinder). The user-spec leg geometry CylinderGeometry(0.2,
  // 0.15, 0.9, 8) is used for BOTH thigh and shin at 0.65 height
  // (scale.y 0.722 → 0.65 each); the shin is also narrowed (scale
  // 0.7) so the taper continues through the knee and the lower
  // segment reads slimmer than the thigh. Hip at 1.30 raw: legs
  // are ~49% of the figure. Knee pivot at -0.65, ankle pivot at
  // -0.65 below the knee; the WHITE shoe lives in the ankle pivot.
  var legL, legR, kneeL, kneeR, ankleL, ankleR;
  var shoeMat = std(0xf2f2f2, 0.5); // shoes: smoothest zone (0.5)
  var kneeMat = std(0x3d5266, 0.85); // knee cap: lighter navy, reads as a joint
  function buildLeg(m) {
    var hip = new THREE.Group();
    hip.position.set(m * 0.15, 1.30, 0);
    var thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.9, 8), pants);
    // v8: thigh LONGER (scale.y 0.722 -> 0.80): top pokes 0.035
    // above the hip pivot into the torso hem, bottom pokes 0.035
    // below the knee pivot into the knee cap — no end-to-end seam.
    thigh.scale.set(1, 0.80, 1);
    thigh.position.y = -0.325;
    thigh.castShadow = true;
    hip.add(thigh);
    var knee = new THREE.Group();
    knee.position.set(0, -0.65, 0);
    knee.add(ball(0.16, kneeMat, 0, 0, 0)); // knee joint cap (v8: 0.15 -> 0.16, covers thigh bottom + shin top)
    var shin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.9, 8), pants);
    shin.scale.set(0.7, 0.722, 0.7);
    // v8: shin raised 0.035 — top pokes above the knee pivot into
    // the knee cap, so a bent knee cannot open a wedge gap.
    shin.position.y = -0.29;
    shin.castShadow = true;
    knee.add(shin);
    var ankle = new THREE.Group();
    ankle.position.set(0, -0.65, 0);
    // v8: ankle cap — the shin used to end flush at the ankle
    // pivot; the cap blends shin into shoe.
    ankle.add(ball(0.11, pants, 0, 0.02, 0));
    // White shoe, clear shape (v4): bigger ellipsoid sitting ON the
    // ground (bottom at y=0) + a dark sole strip under it, so the
    // shoe reads as footwear from every angle, not a white blob.
    ankle.add(ball(0.14, shoeMat, 0, 0.084, 0.07, 1, 0.6, 1.7));
    ankle.add(ball(0.14, dark, 0, 0.021, 0.07, 1, 0.3, 1.7)); // sole
    knee.add(ankle);
    hip.add(knee);
    group.add(hip);
    return { hip: hip, knee: knee, ankle: ankle };
  }
  var _legL = buildLeg(-1), _legR = buildLeg(1);
  legL = _legL.hip; legR = _legR.hip;
  kneeL = _legL.knee; kneeR = _legR.knee;
  ankleL = _legL.ankle; ankleR = _legR.ankle;

  // Uniform scale: raw figure ~2.32 tall -> ~1.86 after 0.8x.
  // Feet stay on the ground (scale origin is at y=0).
  group.scale.setScalar(0.8);

  group.position.copy(pos);
  VR.World.scene.add(group);

  // ---------- movement helpers (no allocations) ----------
  var RADIUS = 0.45;
  function blockedAt(x, z) {
    return VR.World.isBlocked(x + RADIUS, z) ||
           VR.World.isBlocked(x - RADIUS, z) ||
           VR.World.isBlocked(x, z + RADIUS) ||
           VR.World.isBlocked(x, z - RADIUS);
  }

  var _camTarget = new THREE.Vector3();
  var _camDesired = new THREE.Vector3();
  var _lookAt = new THREE.Vector3();
  var _fwd = new THREE.Vector3();

  // Nitro FOV bonus (+6 deg). Gated on inCar so a stale flag can never
  // widen the on-foot FOV; exitCar() also clears VR.State.nitroActive.
  function nitroBonus() {
    return (VR.State && VR.State.inCar && VR.State.nitroActive) ? 6 : 0;
  }

  function updateCamera(dt) {
    var cam = VR.World.camera;
    // Over-shoulder: behind and above, offset to the right.
    // Art pass: pulled back and raised, aimed at chest height + 2.0
    // instead of 1.5 — the frame reads horizon + towers + sea in the
    // top 40% instead of a slab of asphalt.
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var dist = PT.camDistance + 0.9;
    _camDesired.set(
      pos.x - sy * cp * dist + cy * 0.7,
      pos.y + (PT.camHeight - 0.2) - sp * dist,
      pos.z - cy * cp * dist - sy * 0.7
    );
    if (_camDesired.y < 0.5) _camDesired.y = 0.5;
    var k = 1 - Math.exp(-dt * 12);
    cam.position.lerp(_camDesired, k);
    _lookAt.set(pos.x, pos.y + 2.0, pos.z);
    cam.lookAt(_lookAt);
    // FOV widens with sprint speed (+ nitro bonus while driving).
    var targetFov = 62 + Math.min(1, speedNow / PT.sprintSpeed) * 9 + nitroBonus();
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 6);
    if (Math.abs(cam.fov - fovNow) > 0.05) {
      cam.fov = fovNow;
      cam.updateProjectionMatrix();
    }
  }

  // ---------- in-car chase camera (cinematic follow) ----------
  // Behind + above the player's car, looking ahead down the road,
  // smoothed so it trails the car instead of snapping; slight roll
  // into corners; FOV widens with speed and +6 while nitro burns.
  var _carCamSnap = true;

  function updateCarCamera(dt, car) {
    var cam = VR.World.camera;
    if (!car || !car.group) return;
    var cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    // Art pass: farther back + higher, aimed up at 1.9 — the car stays
    // fully in the lower frame while the top 40% shows sky, towers
    // and sea instead of asphalt.
    var dist = 9.5, height = 4.0;
    _camDesired.set(
      car.group.position.x - sy * dist,
      height,
      car.group.position.z - cy * dist
    );
    if (_carCamSnap) {
      // First frame after entering: snap behind the car, never swoop
      // across the city from the old on-foot position.
      cam.position.copy(_camDesired);
      _carCamSnap = false;
    } else {
      var k = 1 - Math.exp(-dt * 6);
      cam.position.lerp(_camDesired, k);
    }
    _lookAt.set(
      car.group.position.x + sy * 8,
      1.9,
      car.group.position.z + cy * 8
    );
    cam.lookAt(_lookAt);
    // Slight roll into corners (visual only).
    var speedF = Math.min(1, Math.abs(car.speed || 0) / 30);
    cam.rotateZ(-(car.steer || 0) * speedF * 0.05);
    // FOV widens with speed, +6 while nitro burns.
    var nitro = car.nitroActive || (VR.State && VR.State.nitroActive);
    var targetFov = 62 + speedF * 8 + (nitro ? 6 : 0);
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - fovNow) > 0.05) {
      cam.fov = fovNow;
      cam.updateProjectionMatrix();
    }
  }

  function enterCar(car) {
    if (!car || !VR.Vehicles) return false;
    if (VR.Vehicles.playerCar && VR.Vehicles.playerCar !== car) return false;
    VR.State.inCar = true;
    VR.State.car = car;
    VR.State.nitroActive = false;
    _carCamSnap = true; // chase camera snaps behind the car on entry
    if (VR.Vehicles.enterCar) VR.Vehicles.enterCar(car);
    group.visible = false;
    return true;
  }

  function exitCar() {
    if (!VR.State.inCar) return;
    var car = VR.State.car;
    VR.State.inCar = false;
    VR.State.car = null;
    VR.State.nitroActive = false; // never leak the nitro FOV on foot
    if (VR.Vehicles && VR.Vehicles.exitCar) VR.Vehicles.exitCar();
    if (car && car.group) {
      // Step out to the driver's side.
      pos.set(car.group.position.x + 2.2, 0, car.group.position.z);
      yaw = car.group.rotation.y;
    }
    group.visible = true;
  }

  function update(dt) {
    // Mouse look.
    var mouse = VR.Input.consumeMouse();
    if (VR.Input.pointerLocked) {
      yaw -= mouse.dx * 0.0028;
      pitch -= mouse.dy * 0.0028;
      if (pitch > 0.55) pitch = 0.55;
      // Art pass: never let the player stare straight down at the
      // asphalt (-0.5 was a top-down view of their own feet).
      if (pitch < -0.3) pitch = -0.3;
    }

    // F: enter / exit car (guarded — vehicles arrive in slice B).
    if (VR.Input.justPressed('KeyF')) {
      if (VR.State.inCar) {
        exitCar();
      } else if (VR.Vehicles && VR.Vehicles.nearestCar) {
        var car = VR.Vehicles.nearestCar(pos.x, pos.z, 4);
        if (car) enterCar(car);
      }
    }

    if (VR.State.inCar) {
      // Driving: physics + input flags live in VR.Vehicles (called by
      // main.js before this update); this file still owns the camera.
      // Hands on the wheel while driving (the driver group is hidden
      // inside the car, but the pose is kept correct regardless).
      armL.rotation.x = -1.15; armR.rotation.x = -1.15;
      armL.rotation.z = 0.25; armR.rotation.z = -0.25;
      elbowL.rotation.x = -0.6; elbowR.rotation.x = -0.6;
      legL.rotation.x = -0.5; legR.rotation.x = -0.5;
      kneeL.rotation.x = 0.9; kneeR.rotation.x = 0.9;
      ankleL.rotation.x = -0.4; ankleR.rotation.x = -0.4;
      speedNow = 0;
      if (VR.State.car) updateCarCamera(dt, VR.State.car);
      return;
    }

    // WASD relative to facing.
    var ix = 0, iz = 0;
    var keys = VR.Input.keys;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    var moving = (ix !== 0 || iz !== 0);
    var sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    var targetSpeed = moving ? (sprint ? PT.sprintSpeed : PT.walkSpeed) : 0;
    speedNow += (targetSpeed - speedNow) * Math.min(1, dt * 10);

    if (moving) {
      var len = Math.sqrt(ix * ix + iz * iz);
      ix /= len; iz /= len;
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      // Forward is (sin yaw, cos yaw); right is (cos yaw, -sin yaw).
      var mx = (sy * -iz) + (cy * ix);
      var mz = (cy * -iz) + (-sy * ix);
      var step = speedNow * dt;
      var nx = pos.x + mx * step;
      var nz = pos.z + mz * step;
      // Axis-separated so the player slides along walls instead of sticking.
      if (!blockedAt(nx, pos.z)) pos.x = nx;
      if (!blockedAt(pos.x, nz)) pos.z = nz;
      walkPhase += dt * speedNow * 1.9;
    }

    // Jump + gravity.
    if (grounded && VR.Input.justPressed('Space')) {
      vy = PT.jumpSpeed;
      grounded = false;
    }
    if (!grounded) {
      vy -= PT.gravity * dt;
      pos.y += vy * dt;
      if (pos.y <= 0) { pos.y = 0; vy = 0; grounded = true; }
    }

    // Pose the character: the swing rotates the SHOULDER and HIP
    // pivots; elbows/knees/ankles follow from their own pivots, so
    // the limbs bend at the joints instead of wobbling mid-limb.
    group.position.copy(pos);
    group.rotation.y = yaw;
    var swing = Math.sin(walkPhase) * 0.65 * Math.min(1, speedNow / PT.walkSpeed);
    armL.rotation.x = swing;
    armR.rotation.x = -swing;
    // Rest tilt, re-asserted every frame on foot (the driving pose
    // above overwrites rotation.z while in a car). v5: 15deg, not
    // 30 — the wide splay hid the torso V-taper.
    armL.rotation.z = -0.26;
    armR.rotation.z = 0.26;
    // Elbows: the bend DEEPENS with the swing, so the elbow joint
    // visibly works while walking (v5); the permanent z-kink from
    // the build step keeps the joint readable while standing.
    elbowL.rotation.x = -0.35 - Math.abs(swing) * 0.45;
    elbowR.rotation.x = -0.35 - Math.abs(swing) * 0.45;
    legL.rotation.x = -swing;
    legR.rotation.x = swing;
    // Knees bend hard when their leg swings forward (v5: up to
    // ~0.67 rad mid-stride); ankles compensate so the white shoes
    // stay roughly flat on the ground.
    kneeL.rotation.x = 0.18 + Math.max(0, swing) * 0.75;
    kneeR.rotation.x = 0.18 + Math.max(0, -swing) * 0.75;
    ankleL.rotation.x = -(legL.rotation.x + kneeL.rotation.x) * 0.5;
    ankleR.rotation.x = -(legR.rotation.x + kneeR.rotation.x) * 0.5;
    // Idle breathing when standing still.
    var breathe = moving ? 0 : Math.sin(performance.now() * 0.002) * 0.02;
    torso.scale.set(1, 1 + breathe, 1);
    // Slight forward lean while sprinting.
    group.rotation.x = sprint && moving ? 0.08 : 0;

    updateCamera(dt);
  }

  VR.Player = {
    pos: pos,
    group: group,
    get yaw() { return yaw; },
    set yaw(v) { yaw = v; },
    get pitch() { return pitch; },
    health: 100,
    armor: 0,
    get speed() { return speedNow; },
    get grounded() { return grounded; },
    enterCar: enterCar,
    exitCar: exitCar,
    update: update,
    updateCamera: updateCamera
  };

})(window.VR = window.VR || {});
