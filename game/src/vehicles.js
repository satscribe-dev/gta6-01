// vehicles.js — Slice B: vehicle factory + arcade-sim physics for VANDARA RUSH.
// Ownership (single owner, no double-stepping):
//   * VR.Vehicles owns the factory (createCar) and the bicycle-model step
//     (stepCar) used by EVERY car. VR.Vehicles.update(dt) drives ONLY the
//     player car (input -> throttle/steer flags -> stepCar).
//   * VR.Traffic owns civilian-car DECISIONS (route, speed target, stops);
//     it sets the same throttle/steer flags and calls VR.Vehicles.stepCar.
//   * VR.Police (slice D) does the same for patrol cars.
// All cross-module access is guarded: this file never crashes when
// VR.World / VR.Roads / VR.Player / VR.Effects / VR.Audio / VR.State are
// missing (standalone test). No new Vector3 / arrays in the hot loop.
// Paint: MeshStandardMaterial flatShading, LOW metalness (v3 lesson: 0.78
// metalness turned paint black). Hero car teal is kept BRIGHT for golden hour.
(function (VR) {
  'use strict';

  var _tmp = new THREE.Vector3();
  var _tmp2 = new THREE.Vector3();

  function std(color, rough, metal, extra) {
    var o = { color: color, roughness: (rough === undefined ? 0.45 : rough),
              metalness: (metal === undefined ? 0.25 : metal), flatShading: false };
    if (extra) { for (var k in extra) o[k] = extra[k]; }
    return new THREE.MeshStandardMaterial(o);
  }
  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  // Side-profile body: an extruded wedge silhouette (reads as a car, not a
  // stack of boxes). pts = [[x,y],...] along the length, front = +x.
  function profileBody(pts, width, mat) {
    var s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }
  // Smooth version for the hero car: the same side profile, but the
  // extrude carries a bevel so every edge rolls into a curve instead of
  // creasing — a sleek aerodynamic shell, not a stack of slabs.
  // bt/bs default to the original bevel; callers pass larger values
  // for a rounder shell and must inset the profile by the same amount
  // so the outer envelope stays identical.
  function profileBodySmooth(pts, width, mat, bt, bs) {
    var s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    var g = new THREE.ExtrudeGeometry(s, {
      depth: width, bevelEnabled: true,
      bevelThickness: (bt === undefined ? 0.07 : bt),
      bevelSize: (bs === undefined ? 0.06 : bs),
      bevelSegments: 5, curveSegments: 24, steps: 1
    });
    g.translate(0, 0, -width / 2);
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }
  // Curved shell: same beveled extrude, but the top edge is a smooth
  // spline through topPts (front -> rear) instead of straight segments,
  // so the hood, windshield and roof flow in one continuous curve.
  // The bottom edge is a straight line at yBot; the front/rear faces
  // close vertically. topPts[0] is the nose top, topPts[last] the tail.
  function profileBodyCurved(topPts, yBot, width, mat, bt, bs) {
    var s = new THREE.Shape();
    var n = topPts.length;
    s.moveTo(topPts[0][0], yBot);
    s.lineTo(topPts[n - 1][0], yBot);
    s.lineTo(topPts[n - 1][0], topPts[n - 1][1]);
    var rev = [];
    for (var i = n - 2; i >= 0; i--) rev.push(new THREE.Vector2(topPts[i][0], topPts[i][1]));
    s.splineThru(rev);
    s.closePath();
    var g = new THREE.ExtrudeGeometry(s, {
      depth: width, bevelEnabled: true,
      bevelThickness: bt, bevelSize: bs,
      bevelSegments: 5, curveSegments: 24, steps: 1
    });
    g.translate(0, 0, -width / 2);
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }
  // Thin LED strip: a swept trapezoid extruded 0.06 deep, no bevel.
  // Shape space is (lateral, height); rotate the mesh about Y so the
  // depth faces forward/back and the strip runs across the car.
  function ledStrip(len, h, mat) {
    var s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(len, 0);
    s.lineTo(len * 0.86, h);
    s.lineTo(len * 0.14, h);
    s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
    var m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }

  var TIRE = 0x161616, RIM = 0xcfd6dd, GLASS = 0x0e2230, DARK = 0x1c1f24;
  var tireMat = std(TIRE, 0.92, 0.0);
  var rimMat = std(RIM, 0.35, 0.6);
  // Hero chrome: mid-grey alloy (was 0xeef4f8 — golden hour pulled it
  // cream, so the wheel read as a flat cream disc). Darker + rougher
  // so the spokes read against it.
  var chromeRimMat = std(0xa9b4bc, 0.30, 0.9);
  var glassMat = std(GLASS, 0.12, 0.35);
  var darkMat = std(DARK, 0.7, 0.1);
  var headMat = std(0xfff6d8, 0.3, 0.1, { emissive: 0xfff2c0, emissiveIntensity: 2.2 });
  var tailMat = std(0xff2a2a, 0.3, 0.1, { emissive: 0xff1a1a, emissiveIntensity: 2.6 });

  var SPECS = {
    sport: { L: 4.5, W: 1.95, wheelR: 0.42, wheelW: 0.36, maxSpeed: 44, accel: 20,
             reverse: 11, wheelbase: 2.7, colors: [0x00f0d0], spoiler: true, wide: true },
    sedan: { L: 4.4, W: 1.85, wheelR: 0.35, wheelW: 0.26, maxSpeed: 31, accel: 14,
             reverse: 10, wheelbase: 2.7, colors: [0xd96a4a, 0x3f6fd1, 0xe8e4d8, 0x7fd1a8] },
    taxi:  { L: 4.4, W: 1.85, wheelR: 0.35, wheelW: 0.26, maxSpeed: 31, accel: 14,
             reverse: 10, wheelbase: 2.7, colors: [0xffc21c] },
    suv:   { L: 4.6, W: 2.0, wheelR: 0.40, wheelW: 0.30, maxSpeed: 33, accel: 15,
             reverse: 10, wheelbase: 2.8, colors: [0x5b7a8c, 0x8a5a3b, 0x4a6b4f] },
    truck: { L: 6.4, W: 2.3, wheelR: 0.46, wheelW: 0.34, maxSpeed: 24, accel: 10,
             reverse: 8, wheelbase: 3.9, colors: [0xe2725b, 0x2e7d6b, 0x4a6fa5] },
    bike:  { L: 2.1, W: 0.62, wheelR: 0.33, wheelW: 0.12, maxSpeed: 38, accel: 18,
             reverse: 6, wheelbase: 1.4, colors: [0xd23c3c, 0x1f8fff, 0x222222] },
    boat:  { L: 7.2, W: 2.4, wheelR: 0, wheelW: 0, maxSpeed: 30, accel: 12,
             reverse: 6, wheelbase: 4.5, colors: [0xf2f0e8] }
  };

  function makeWheel(r, w, front, hero) {
    var pivot = new THREE.Group();
    // Base yaw PI/2: the tyre cylinder's axle (local z after rotX) must lie
    // along the car's lateral (x) axis; front wheels add steer on top.
    pivot.rotation.y = Math.PI / 2;
    var spin = new THREE.Group();
    var tyre = cyl(r, r, w, tireMat, 0, 0, 0, 18);
    tyre.rotation.x = Math.PI / 2;
    // Hero wheels: small hub (was 0.66r — it swallowed the spokes) +
    // 5 long thin spokes so the rim reads as a star, not a solid disc.
    var rim = hero ? chromeRimMat : rimMat;
    var hub = cyl(r * (hero ? 0.36 : 0.55), r * (hero ? 0.36 : 0.55), w + 0.02, rim, 0, 0, 0, 10);
    hub.rotation.x = Math.PI / 2;
    spin.add(tyre); spin.add(hub);
    // spokes so the spin is visible (3 traffic, 5 hero). Box axes:
    // x = thin in-plane width, y = radial length, z = axle span
    // (was x = w+0.04 / z = 0.07 — fat in-plane paddles that overlapped
    // into a disc). Hero spokes reach 0.90r, nearly to the tyre edge.
    var nSp = hero ? 5 : 3;
    for (var i = 0; i < nSp; i++) {
      var sp = box(hero ? 0.12 : 0.14, r * (hero ? 1.8 : 1.5), w + 0.04, rim, 0, 0, 0);
      sp.rotation.z = i * Math.PI / nSp;
      spin.add(sp);
    }
    pivot.add(spin);
    return { pivot: pivot, spin: spin, front: !!front };
  }

  function glowSprite(color, size) {
    if (VR.World && VR.World.makeGlowSprite) return VR.World.makeGlowSprite(color, size);
    return null;
  }

  // ---- body builders: one silhouette per type, all multi-part ----
  // HERO CAR (Slice F rebuild): the Apex GT as a sleek aerodynamic body,
  // not a stack of boxes. A beveled extruded shell with a long sloping
  // hood, a smooth-sweep glass canopy, protruding torus wheel arches,
  // and a carbon rear wing. The paint is a MeshPhysicalMaterial with a
  // clearcoat sheen — but metalness stays LOW (v3 lesson: metalness
  // 0.78 turned the teal black), so the teal stays bright and pops.
  function buildSport(body, spec, paint) {
    var L = spec.L, W = spec.W;
    // Visual length VL: the shell is stretched ~+25% over the physics
    // envelope (spec.L stays 4.5, so wheel stations +/-1.40, wheelbase
    // 2.7 and the collision probe are untouched — only the nose/tail
    // overhangs grow, which is exactly what makes it read long-low).
    // Outer envelope: length 5.62, width 1.934, deck top 0.72,
    // dome top 1.07, wing top 1.36. Roofline ~15% lower than the
    // pre-v1 build (glass peak 1.16 -> dome 1.07) for a low fastback
    // read: length 5.62 vs roof height 1.07, a ~5.25:1 silhouette.
    var VL = 5.62, HL = VL / 2; // HL = 2.81, visual half-length
    // Hero paint: bright saturated cyan, clearcoat shine, moderate metalness.
    var heroPaint = new THREE.MeshPhysicalMaterial({
      color: paint.color, roughness: 0.28, metalness: 0.45,
      clearcoat: 0.9, clearcoatRoughness: 0.22, flatShading: false
    });
    // Envelope note: the bevel expands the shell by bevelSize in the
    // profile plane and bevelThickness across the width, so every
    // profile below is inset by exactly that amount.
    // Lower body: one continuous spline — low nose rising along the
    // hood into the rear deck, tail dropping into a fastback — with a
    // deep 0.15/0.12 bevel so the whole shell rolls instead of creasing.
    body.add(profileBodyCurved([
      [2.69, 0.36], [1.30, 0.52], [0.30, 0.58], [-1.90, 0.60], [-2.69, 0.50]
    ], 0.18, W * 0.92 - 0.16, heroPaint, 0.15, 0.12));
    // Glass cockpit: a DOME, not an extruded slab — a sphere segment
    // (recipe: SphereGeometry(0.48, 20, 12, 0, 2PI, 0, 0.52PI), scaled)
    // so the canopy reads as a curved glasshouse from every angle.
    // Radius 1.0, scale (1.45, 0.42, 0.78): footprint 2.90 x 1.56,
    // peak 1.07 — the same low roofline as the v1 build (was 1.16).
    // The rim sits just inside the deck (base y 0.62 vs deck 0.64-0.72)
    // so it never floats or gaps.
    var heroGlass = new THREE.MeshPhysicalMaterial({
      color: 0x0e2230, roughness: 0.08, metalness: 0.15,
      clearcoat: 1.0, clearcoatRoughness: 0.08, flatShading: false
    });
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
      heroGlass);
    dome.scale.set(1.45, 0.42, 0.78);
    dome.position.set(-0.25, 0.62, 0);
    dome.castShadow = true;
    dome.name = 'cockpitGlass';
    body.add(dome);
    // Wheel-arch fenders: half-torus rings that bulge outboard of the
    // flanks and hug each tyre, so the arches read as real fenders from
    // every angle. TorusGeometry already lies in the x-y plane (car
    // length x height), and arc PI is exactly the top half. Stations
    // stay +/-1.40 (wheel positions unchanged); radius grows 0.44 ->
    // 0.50 for the bigger 0.42 wheels.
    // Wheel-arch fenders: half-torus rings sunk INTO the flanks
    // (z 0.90, tube 0.07 — outer face 0.97, flush with the shell flank
    // ~0.97; was z 1.00 / tube 0.09, sticking outboard of the body so
    // the bright ring read as a loose hoop / lifebuoy floating around
    // the tyre). Radius 0.48 hugs the 0.42 tyre tighter.
    var fender = std(paint.color, 0.35, 0.35);
    [[1.40, 0.90], [1.40, -0.90], [-1.40, 0.90], [-1.40, -0.90]].forEach(function (p) {
      var arch = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 10, 24, Math.PI), fender);
      arch.position.set(p[0], 0.42, p[1]);
      arch.castShadow = true;
      body.add(arch);
    });
    // Fender haunches: flattened spheres over each wheel that flare
    // outboard of the flanks, so the fenders read as sculpted muscle
    // instead of flat slab sides. They stay inside the wheel envelope
    // (outer face 1.11 vs tyre outer 1.075) and below the deck line.
    [[1.40, 0.92], [1.40, -0.92], [-1.40, 0.92], [-1.40, -0.92]].forEach(function (p) {
      var haunch = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), fender);
      haunch.scale.set(1.05, 0.5, 0.34);
      haunch.position.set(p[0], 0.44, p[1]);
      haunch.castShadow = true;
      body.add(haunch);
    });
    // Side mirrors: thin cylinder stalks + rounded housings, mounted
    // low on the dome flanks (dome half-width is 0.73 at y 0.72, so the
    // stalks bridge from the glass to the housings).
    [1, -1].forEach(function (side) {
      var stalk = cyl(0.02, 0.02, 0.14, darkMat, 0.10, 0.72, side * 0.78, 8);
      stalk.rotation.x = Math.PI / 2;
      body.add(stalk);
      var mirror = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), darkMat);
      mirror.scale.set(1.3, 0.8, 0.8);
      mirror.position.set(0.10, 0.72, side * 0.88);
      mirror.castShadow = true;
      body.add(mirror);
    });
    // Flat-shaded dark trim: sharp panels (intake, endplates, diffuser)
    // use flatShading so their edges stay crisp, not smoothed.
    var flatDark = std(0x14161a, 0.6, 0.2, { flatShading: true });
    // NOSE: wedge intake + sensor strip. The intake is a beveled plate
    // (recipe: closed XY profile, ~0.02 bevel) set proud of the nose
    // face between splitter and headlights; the cyan sensor bar fills
    // the gap between the two headlight strips.
    var intake = profileBodySmooth([
      [2.84, 0.20], [2.32, 0.20], [2.32, 0.36], [2.84, 0.32]
    ], 1.30, flatDark, 0.02, 0.02);
    intake.name = 'noseIntake';
    body.add(intake);
    var sensorMat = std(0x0a2a2a, 0.3, 0.1, { emissive: 0x00f0ff, emissiveIntensity: 2.5 });
    var sensor = box(0.04, 0.06, 0.50, sensorMat, HL + 0.01, 0.44, 0);
    sensor.name = 'noseSensor';
    body.add(sensor);
    // Carbon rear wing: BIG and near-black so it reads from the rear
    // against sky and road. Wide airfoil blade (1.92 across, deeper
    // 0.84 chord, slight attack angle) on twin thick struts, with
    // endplates at the tips. Top stays at 1.36, well above the lowered
    // glass canopy top at 1.07, so the spoiler reads from low rear
    // angles instead of hiding behind the canopy.
    var wingMat = std(0x0d0d0f, 0.35, 0.6);
    var wing = profileBodySmooth([
      [0.42, -0.02], [0.42, 0.05], [-0.40, 0.06], [-0.42, -0.02]
    ], 1.92, wingMat, 0.02, 0.02);
    wing.position.set(-HL + 0.22, 1.28, 0);
    wing.rotation.z = 0.08;
    wing.name = 'wingBlade';
    body.add(wing);
    [1, -1].forEach(function (side) {
      body.add(box(0.72, 0.20, 0.03, flatDark, -HL + 0.22, 1.30, side * 0.96));
    });
    body.add(cyl(0.06, 0.06, 0.62, wingMat, -HL + 0.28, 1.00, 0.60, 10));
    body.add(cyl(0.06, 0.06, 0.62, wingMat, -HL + 0.28, 1.00, -0.60, 10));
    // Racing stripes: twin white stripes over the hood and the rear
    // deck, laid to follow each surface slope (hood falls toward the
    // nose, deck falls toward the tail). They stop short of the glass
    // canopy and of the tail edge so they never clip through.
    var stripeMat = std(0xf4f6f6, 0.4, 0.1);
    [0.20, -0.20].forEach(function (z) {
      var hs = box(1.15, 0.03, 0.24, stripeMat, 1.825, 0.58, z);
      hs.rotation.z = -0.114;
      body.add(hs);
      var ds = box(0.75, 0.03, 0.24, stripeMat, -2.28, 0.67, z);
      ds.rotation.z = 0.127;
      body.add(ds);
    });
    // DECALS — panel lines: two shut lines on the hood flanking the
    // stripes (following the hood slope) + one transverse line across
    // the rear deck. Thin dark boxes laid on the surface like the stripes.
    [0.55, -0.55].forEach(function (z) {
      var pl = box(1.05, 0.012, 0.035, darkMat, 1.85, 0.58, z);
      pl.rotation.z = -0.114;
      body.add(pl);
    });
    body.add(box(0.035, 0.012, 1.30, darkMat, -1.95, 0.72, 0));
    // DECALS — race number "07": a white roundel on each door with a
    // torus "0" + boxed "7". One local layout serves both flanks: the
    // -z group is rotated PI about Y, which reads correctly from that
    // side (same as a physical two-sided decal).
    var numWhite = std(0xf4f6f6, 0.4, 0.1);
    var numDark = std(0x14161a, 0.5, 0.2);
    [1, -1].forEach(function (side) {
      var dec = new THREE.Group();
      dec.position.set(-0.35, 0.50, side * 0.972);
      if (side < 0) dec.rotation.y = Math.PI;
      var roundel = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), numWhite);
      roundel.position.z = 0.002;
      dec.add(roundel);
      var zero = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 20), numDark);
      zero.position.set(-0.055, 0, 0.006);
      dec.add(zero);
      var sevenTop = box(0.09, 0.022, 0.012, numDark, 0.055, 0.05, 0.006);
      dec.add(sevenTop);
      var sevenDiag = box(0.022, 0.11, 0.012, numDark, 0.055, 0.0, 0.006);
      sevenDiag.rotation.z = -0.35;
      dec.add(sevenDiag);
      body.add(dec);
    });
    // LED headlights: wider + taller emissive strips on the nose, angled
    // back along the flanks. LED tail: one full-width red strip.
    // Hero-local mats run hotter (3.2 / 3.6) so the strips glow hard.
    var heroHeadMat = std(0xfff6d8, 0.3, 0.1, { emissive: 0xfff2c0, emissiveIntensity: 3.2 });
    var heroTailMat = std(0xff2a2a, 0.3, 0.1, { emissive: 0xff1a1a, emissiveIntensity: 3.6 });
    var hl = ledStrip(0.78, 0.14, heroHeadMat);
    hl.rotation.y = Math.PI / 2;
    hl.position.set(HL - 0.04, 0.42, 0.90);
    body.add(hl);
    var hl2 = ledStrip(0.78, 0.14, heroHeadMat);
    hl2.rotation.y = -Math.PI / 2;
    hl2.position.set(HL + 0.02, 0.42, -0.90);
    body.add(hl2);
    var tl = ledStrip(W * 0.88, 0.16, heroTailMat);
    tl.rotation.y = -Math.PI / 2;
    tl.position.set(-HL + 0.04, 0.50, -W * 0.44);
    body.add(tl);
    // Twin rear ENGINES: cylinder pods on the car's length axis, each
    // with a nozzle ring (torus) + an inner emissive disc. The discs
    // are named 'nitroDisc' — stepCar raises their emissiveIntensity
    // while nitro is active (boost state cue, visual only).
    var engineMat = std(0x2a2e33, 0.4, 0.7);
    var nozzleMat = std(0x111318, 0.35, 0.8);
    [1, -1].forEach(function (side) {
      var pod = cyl(0.13, 0.13, 0.30, engineMat, -HL - 0.06, 0.32, side * 0.42, 14);
      pod.rotation.z = Math.PI / 2; // cylinder axis -> car length (X)
      pod.name = side > 0 ? 'engineL' : 'engineR';
      body.add(pod);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 10, 24), nozzleMat);
      ring.position.set(-HL - 0.21, 0.32, side * 0.42);
      ring.rotation.y = Math.PI / 2;
      ring.castShadow = true;
      body.add(ring);
      var discMat = new THREE.MeshStandardMaterial({
        color: 0x1a0d08, roughness: 0.4, metalness: 0.2,
        emissive: 0xff6a22, emissiveIntensity: 2.2
      });
      var disc = new THREE.Mesh(new THREE.CircleGeometry(0.105, 20), discMat);
      disc.position.set(-HL - 0.215, 0.32, side * 0.42);
      disc.rotation.y = -Math.PI / 2; // face rearward
      disc.name = 'nitroDisc';
      body.add(disc);
    });
    // front splitter: thin extruded blade under the nose
    body.add(profileBodySmooth([
      [HL + 0.06, 0.10], [HL - 0.28, 0.10], [HL - 0.28, 0.18], [HL + 0.06, 0.18]
    ], W * 0.94, darkMat, 0.02, 0.02));
    // side skirts: rounded rails along the sills (cylinders, not boxes)
    var sk1 = cyl(0.05, 0.05, 2.6, darkMat, 0, 0.14, W / 2 - 0.02, 10);
    sk1.rotation.z = Math.PI / 2;
    body.add(sk1);
    var sk2 = cyl(0.05, 0.05, 2.6, darkMat, 0, 0.14, -W / 2 + 0.02, 10);
    sk2.rotation.z = Math.PI / 2;
    body.add(sk2);
    // UNDERCARRIAGE: flat under-tray just below the hull bottom, four
    // suspension arms (chassis rail -> wheel hub, angled in the Y-Z
    // plane), and a rear diffuser with four vertical fins.
    var tray = box(4.2, 0.05, 1.5, darkMat, 0, 0.07, 0);
    tray.name = 'underTray';
    body.add(tray);
    [[1.40, 1], [1.40, -1], [-1.40, 1], [-1.40, -1]].forEach(function (a) {
      var arm = box(0.10, 0.05, 0.55, darkMat, a[0], 0.32, a[1] * 0.675);
      arm.rotation.x = -a[1] * 0.42;
      arm.name = 'suspensionArm';
      body.add(arm);
    });
    [-0.30, -0.12, 0.12, 0.30].forEach(function (z) {
      var fin = box(0.30, 0.10, 0.025, flatDark, -HL + 0.18, 0.12, z);
      fin.name = 'diffuserFin';
      body.add(fin);
    });
    // Front glow: small + dimmed (was 0.85 @ full opacity — a white
    // blob that swallowed the 0.14-tall headlight strips). 0.42 keeps
    // the halo tight to the strip so the strip shape still reads.
    var g1 = glowSprite(0xfff2c0, 0.42); if (g1) { g1.material.opacity = 0.7; g1.position.set(HL + 0.25, 0.44, 0.62); body.add(g1); }
    var g2 = glowSprite(0xfff2c0, 0.42); if (g2) { g2.material.opacity = 0.7; g2.position.set(HL + 0.25, 0.44, -0.62); body.add(g2); }
    var g3 = glowSprite(0xff2a2a, 1.1); if (g3) { g3.position.set(-HL - 0.25, 0.54, 0); body.add(g3); }
  }

  function buildSedan(body, spec, paint, taxi) {
    var L = spec.L, W = spec.W;
    body.add(profileBody([
      [L / 2, 0.16], [L / 2, 0.58], [1.15, 0.74], [0.35, 0.82],
      [-1.5, 0.84], [-L / 2, 0.80], [-L / 2, 0.16]
    ], W * 0.92, paint));
    body.add(profileBody([
      [0.75, 0.80], [0.15, 1.24], [-0.95, 1.26], [-1.5, 0.82]
    ], W * 0.80, glassMat));
    body.add(box(0.06, 0.10, 0.5, headMat, L / 2 + 0.01, 0.56, 0.58));
    body.add(box(0.06, 0.10, 0.5, headMat, L / 2 + 0.01, 0.56, -0.58));
    body.add(box(0.05, 0.10, W * 0.86, tailMat, -L / 2 - 0.01, 0.62, 0));
    body.add(box(0.5, 0.08, W * 0.9, darkMat, L / 2 - 0.1, 0.16, 0));
    if (taxi) {
      var sign = box(0.5, 0.16, 0.3, std(0xffe9a8, 0.4, 0.1,
        { emissive: 0xffc21c, emissiveIntensity: 0.9 }), -0.35, 1.38, 0);
      body.add(sign);
      body.add(box(0.06, 0.06, W * 0.94, darkMat, 0.9, 0.86, 0)); // checker band hint
    }
    var g = glowSprite(0xff2a2a, 1.2); if (g) { g.position.set(-L / 2 - 0.25, 0.62, 0); body.add(g); }
  }

  function buildSUV(body, spec, paint) {
    var L = spec.L, W = spec.W;
    body.add(profileBody([
      [L / 2, 0.18], [L / 2, 0.86], [0.9, 0.92], [-1.7, 0.96], [-L / 2, 0.92], [-L / 2, 0.18]
    ], W * 0.92, paint));
    body.add(profileBody([
      [0.85, 0.90], [0.25, 1.42], [-1.35, 1.44], [-1.75, 0.92]
    ], W * 0.82, glassMat));
    body.add(box(L * 0.55, 0.07, W * 0.6, darkMat, -0.2, 1.52, 0)); // roof rails
    body.add(box(0.06, 0.12, 0.55, headMat, L / 2 + 0.01, 0.78, 0.62));
    body.add(box(0.06, 0.12, 0.55, headMat, L / 2 + 0.01, 0.78, -0.62));
    body.add(box(0.05, 0.11, W * 0.86, tailMat, -L / 2 - 0.01, 0.80, 0));
    var g = glowSprite(0xff2a2a, 1.2); if (g) { g.position.set(-L / 2 - 0.25, 0.80, 0); body.add(g); }
  }

  function buildTruck(body, spec, paint) {
    var L = spec.L, W = spec.W;
    // cab (front) + tall cargo box (rear)
    body.add(box(1.5, 1.55, W * 0.94, paint, L / 2 - 0.85, 1.05, 0));
    body.add(profileBody([
      [L / 2 - 0.1, 1.05], [L / 2 - 0.1, 1.86], [L / 2 - 1.55, 1.86], [L / 2 - 1.62, 1.05]
    ], W * 0.8, glassMat));
    var cargoMat = std(0xe8e4d8, 0.6, 0.15);
    body.add(box(L - 1.9, 2.05, W * 0.96, cargoMat, -0.75, 1.32, 0));
    body.add(box(0.08, 2.05, W * 0.96, std(spec.colors[0], 0.55, 0.2), -0.75, 1.32, 0));
    body.add(box(0.06, 0.12, 0.5, headMat, L / 2 + 0.01, 0.72, 0.6));
    body.add(box(0.06, 0.12, 0.5, headMat, L / 2 + 0.01, 0.72, -0.6));
    body.add(box(0.05, 0.11, W * 0.86, tailMat, -L / 2 - 0.01, 0.62, 0));
  }

  function buildBike(body, spec, paint) {
    var L = spec.L;
    body.add(box(1.7, 0.22, 0.22, paint, 0, 0.62, 0));            // tank + tail
    body.add(profileBody([[-0.55, 0.55], [-0.95, 1.0], [-0.2, 1.02], [0.1, 0.55]],
      0.3, std(0x181818, 0.5, 0.2)));                               // seat hump
    body.add(box(0.08, 0.5, 0.7, darkMat, 0.85, 0.85, 0));          // handlebar
    body.add(box(0.5, 0.35, 0.16, headMat, L / 2 + 0.05, 0.66, 0)); // headlamp
    body.add(box(0.06, 0.12, 0.2, tailMat, -L / 2 - 0.02, 0.66, 0));
    body.add(cyl(0.06, 0.06, 0.7, darkMat, -0.5, 0.42, 0.22, 8).rotateX(Math.PI / 2));
  }

  function buildBoat(body, spec, paint) {
    var L = spec.L, W = spec.W;
    body.add(profileBody([
      [L / 2, 0.35], [L / 2 - 0.8, 0.15], [-L / 2 + 0.6, 0.10], [-L / 2, 0.55],
      [-L / 2 + 0.4, 0.95], [L / 2 - 1.6, 0.95]
    ], W * 0.9, paint));
    body.add(box(L * 0.5, 0.1, W * 0.7, std(0x1fd6c1, 0.5, 0.2), -0.3, 0.98, 0)); // teal stripe
    body.add(profileBody([
      [0.9, 0.95], [0.4, 1.7], [-1.2, 1.7], [-1.6, 0.95]
    ], W * 0.55, glassMat)); // canopy
    // hydrofoil struts + foils under the hull
    [[1.6, 0.55], [-1.6, -0.55]].forEach(function (p) {
      body.add(box(0.08, 0.7, 0.08, darkMat, p[0], -0.25, p[1]));
    });
    body.add(box(0.5, 0.06, 1.3, darkMat, 1.6, -0.62, 0.55));
    body.add(box(0.5, 0.06, 1.3, darkMat, -1.6, -0.62, -0.55));
    body.add(box(0.06, 0.12, 0.4, headMat, L / 2 + 0.02, 0.7, 0));
  }

  // ---- factory ----
  function createCar(type, x, z, yaw) {
    type = SPECS[type] ? type : 'sedan';
    var spec = SPECS[type];
    var color = spec.colors[(Math.random() * spec.colors.length) | 0];
    if (type === 'sport') color = 0x00f0d0; // hero Apex GT: bright saturated cyan, always
    var paint = std(color, 0.42, 0.28);

    var group = new THREE.Group();
    // Model space has the nose along +X (extruded side profile); the mount
    // rotates it to car space where the nose is +Z, so group.rotation.y
    // always equals car.yaw (player.js reads group.rotation.y on exit).
    var mount = new THREE.Group();
    mount.rotation.y = -Math.PI / 2;
    var body = new THREE.Group();
    mount.add(body);
    group.add(mount);

    if (type === 'sport') buildSport(body, spec, paint);
    else if (type === 'sedan' || type === 'taxi') buildSedan(body, spec, paint, type === 'taxi');
    else if (type === 'suv') buildSUV(body, spec, paint);
    else if (type === 'truck') buildTruck(body, spec, paint);
    else if (type === 'bike') buildBike(body, spec, paint);
    else if (type === 'boat') buildBoat(body, spec, paint);

    var wheels = [];
    if (spec.wheelR > 0) {
      var fx = spec.L / 2 - (type === 'truck' ? 1.15 : 0.85);
      var rx = -spec.L / 2 + (type === 'truck' ? 1.35 : 0.85);
      var zw = spec.W / 2 - 0.08;
      // defs: [along-length, lateral, isFront] -> group space (x=lateral, z=along)
      var defs = [[fx, zw, true], [fx, -zw, true], [rx, zw, false], [rx, -zw, false]];
      if (type === 'bike') defs = [[0.75, 0, true], [-0.75, 0, false]];
      defs.forEach(function (d) {
        var w = makeWheel(spec.wheelR, spec.wheelW, d[2], type === 'sport');
        w.pivot.position.set(d[1], spec.wheelR, d[0]);
        group.add(w.pivot);
        wheels.push(w);
      });
    }

    group.position.set(x || 0, type === 'boat' ? 0.15 : 0, z || 0);
    group.rotation.y = yaw || 0;
    if (VR.World && VR.World.scene) VR.World.scene.add(group);

    var car = {
      group: group, body: body, type: type, spec: spec,
      x: x || 0, z: z || 0, yaw: yaw || 0,
      speed: 0, steer: 0,
      throttle: 0, brake: 0, steerInput: 0, handbrake: false, nitro: false,
      hp: 100, nitroFuel: 100, nitroActive: false,
      wheels: wheels, dead: false, wrecked: false,
      _smokeT: 0, _flameT: 0, _skidT: 0, _roll: 0, _pitch: 0
    };
    VR.Vehicles.all.push(car);
    return car;
  }

  function damage(car, n) {
    if (!car || car.dead) return;
    car.hp -= n;
    if (car.hp <= 0) {
      car.hp = 0; car.dead = true; car.wrecked = true; car.speed = 0;
      if (VR.Effects && VR.Effects.explosion) VR.Effects.explosion(car.x, 0.8, car.z);
      if (VR.Audio && VR.Audio.play) VR.Audio.play('explosion');
      car.group.visible = false;
    }
  }

  // ---- bicycle-model step (shared by player + AI) ----
  function stepCar(car, dt) {
    if (!car || car.dead) return;
    var spec = car.spec;
    var spd = car.speed;
    var absSpd = Math.abs(spd);

    // steering: less lock at speed
    var steerMax = 0.58 / (1 + absSpd * 0.045);
    var target = car.steerInput * steerMax;
    car.steer += (target - car.steer) * Math.min(1, dt * 9);

    // nitro
    var top = spec.maxSpeed, acc = spec.accel;
    car.nitroActive = false;
    if (car.nitro && car.nitroFuel > 0.5 && car.throttle > 0) {
      top *= 1.35; acc *= 1.9;
      car.nitroFuel = Math.max(0, car.nitroFuel - 30 * dt);
      car.nitroActive = true;
    } else {
      car.nitroFuel = Math.min(100, car.nitroFuel + 6 * dt);
    }

    // longitudinal
    var drag = spd * 0.35 + spd * absSpd * 0.004;
    spd += (car.throttle * acc - car.brake * 32 - drag) * dt;
    if (car.handbrake) spd -= spd * 1.4 * dt;
    if (spd > top) spd = Math.max(top, spd - 30 * dt);
    if (spd < -spec.reverse) spd = -spec.reverse;
    if (car.throttle === 0 && car.brake === 0 && absSpd < 0.15) spd = 0;
    car.speed = spd;

    // yaw (bicycle model) + handbrake drift boost
    var yawRate = (absSpd > 0.05) ? (spd / spec.wheelbase) * Math.tan(car.steer) : 0;
    if (car.handbrake && absSpd > 6) yawRate *= 1.7;
    car.yaw += yawRate * dt;

    // integrate
    var fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    var nx = car.x + fx * spd * dt, nz = car.z + fz * spd * dt;

    // building / sea collision (guarded)
    if (VR.World && VR.World.isBlocked) {
      var probe = 0.35 + spec.L / 2;
      if (VR.World.isBlocked(nx + fx * probe, nz + fz * probe) ||
          VR.World.isBlocked(nx - fx * probe, nz - fz * probe)) {
        if (absSpd > 12) damage(car, (absSpd - 12) * 1.2);
        if (VR.Effects && absSpd > 8) VR.Effects.shake(Math.min(0.6, absSpd * 0.02));
        spd = -spd * 0.22; car.speed = spd;
        nx = car.x; nz = car.z;
      }
    }
    car.x = nx; car.z = nz;

    // group transform (nose is +Z in car space; see createCar mount)
    car.group.position.set(car.x, car.type === 'boat' ? 0.15 : 0, car.z);
    car.group.rotation.y = car.yaw;
    car.group.updateMatrixWorld(true);

    // body roll / pitch (visual only). In body space the length axis is
    // local x (nose) and the width axis local z, so roll = rotation.x,
    // pitch = rotation.z.
    var rollT = -car.steer * spd * 0.004;
    var pitchT = -car.throttle * 0.012 + car.brake * 0.02;
    car._roll += (rollT - car._roll) * Math.min(1, dt * 6);
    car._pitch += (pitchT - car._pitch) * Math.min(1, dt * 6);
    car.body.rotation.x = Math.max(-0.06, Math.min(0.06, car._roll));
    car.body.rotation.z = Math.max(-0.04, Math.min(0.04, car._pitch));
    if (car.type === 'boat') car.body.rotation.x = Math.sin(performance.now() * 0.0012) * 0.02;

    // wheels: steer front (base yaw PI/2 + steer), spin all
    for (var i = 0; i < car.wheels.length; i++) {
      var w = car.wheels[i];
      if (w.front) w.pivot.rotation.y = Math.PI / 2 + car.steer;
      w.spin.rotation.z -= (spd * dt) / spec.wheelR;
    }

    // handbrake smoke + skid
    if (car.handbrake && absSpd > 8) {
      car._skidT -= dt;
      if (car._skidT <= 0) {
        car._skidT = 0.07;
        if (VR.Effects && VR.Effects.spawnSmoke) {
          // rear wheels, car space: (lateral, y, along)
          _tmp.set(spec.W / 2 - 0.1, 0.25, -spec.L / 2 + 0.8);
          car.group.localToWorld(_tmp);
          VR.Effects.spawnSmoke(_tmp.x, _tmp.y, _tmp.z, 2);
          _tmp2.set(-spec.W / 2 + 0.1, 0.25, -spec.L / 2 + 0.8);
          car.group.localToWorld(_tmp2);
          VR.Effects.spawnSmoke(_tmp2.x, _tmp2.y, _tmp2.z, 2);
        }
        if (VR.Audio && VR.Audio.play && car === VR.Vehicles.playerCar) VR.Audio.play('skid');
      }
    }

    // nitro exhaust flame
    if (car.nitroActive) {
      car._flameT -= dt;
      if (car._flameT <= 0) {
        car._flameT = 0.05;
        if (VR.Effects && VR.Effects.spawnFlame) {
          _tmp.set(0.35, 0.3, -spec.L / 2 - 0.3);
          car.group.localToWorld(_tmp);
          VR.Effects.spawnFlame(_tmp.x, _tmp.y, _tmp.z, 2);
          _tmp2.set(-0.35, 0.3, -spec.L / 2 - 0.3);
          car.group.localToWorld(_tmp2);
          VR.Effects.spawnFlame(_tmp2.x, _tmp2.y, _tmp2.z, 2);
        }
      }
    }

    // Hero boost state cue (visual only, no physics): the twin engine
    // discs ('nitroDisc') glow harder while nitro is active. The discs
    // are looked up once and cached on the car.
    if (car.type === 'sport') {
      if (!car._nitroDiscs) {
        car._nitroDiscs = [];
        car.body.traverse(function (o) { if (o.name === 'nitroDisc') car._nitroDiscs.push(o); });
      }
      var discTarget = car.nitroActive ? 6.0 : 2.2;
      for (var di = 0; di < car._nitroDiscs.length; di++) {
        var dm = car._nitroDiscs[di].material;
        dm.emissiveIntensity += (discTarget - dm.emissiveIntensity) * Math.min(1, dt * 8);
      }
    }

    // damage smoke from the hood when HP is low
    if (car.hp < 35 && !car.dead) {
      car._smokeT -= dt;
      if (car._smokeT <= 0) {
        car._smokeT = car.hp < 15 ? 0.08 : 0.18;
        if (VR.Effects && VR.Effects.spawnSmoke) {
          _tmp.set(0, 0.9, spec.L / 2 - 0.6);
          car.group.localToWorld(_tmp);
          VR.Effects.spawnSmoke(_tmp.x, _tmp.y, _tmp.z, car.hp < 15 ? 3 : 1);
        }
      }
    }
  }

  // ---- player car update (input -> flags -> step) ----
  function updatePlayer(dt) {
    var car = VR.Vehicles.playerCar;
    if (!car || car.dead) return;
    var keys = (VR.Input && VR.Input.keys) ? VR.Input.keys : null;
    var fwd = 0, brk = 0, str = 0, hb = false, nt = false;
    if (keys) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwd = 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) brk = 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) str += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) str -= 1;
      hb = keys.has('Space');
      nt = keys.has('ShiftLeft') || keys.has('ShiftRight');
    }
    // S = brake when moving forward, reverse when stopped
    if (brk && car.speed > 0.5) { car.brake = 1; car.throttle = 0; }
    else if (brk) { car.throttle = 0; car.brake = 0; car.speed = Math.max(car.speed - 14 * dt, -car.spec.reverse); }
    else { car.brake = 0; car.throttle = fwd; }
    car.steerInput = str;
    car.handbrake = hb;
    car.nitro = nt;
    stepCar(car, dt);

    // shared flags for main.js (FOV) / HUD
    if (VR.State) {
      VR.State.nitroActive = car.nitroActive;
      VR.State.speedKmh = Math.abs(car.speed) * 3.6;
    }
    if (VR.Audio && VR.Audio.setEngine) {
      var rpm = Math.min(1, Math.abs(car.speed) / (car.spec.maxSpeed * 1.2));
      VR.Audio.setEngine(0.15 + rpm * 0.85, fwd ? 1 : 0.25);
    }
  }

  function update(dt) {
    updatePlayer(dt);
    // player-vs-traffic soft collision (guarded; Traffic keeps distance too)
    var pc = VR.Vehicles.playerCar;
    if (pc && !pc.dead && VR.Traffic && VR.Traffic.cars) {
      var list = VR.Traffic.cars;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o || o.dead || o === pc) continue;
        var dx = o.x - pc.x, dz = o.z - pc.z;
        var d2 = dx * dx + dz * dz;
        if (d2 < 5.3 && d2 > 0.0001) {
          var d = Math.sqrt(d2), push = (2.3 - d) * 0.5;
          var ux = dx / d, uz = dz / d;
          o.x += ux * push; o.z += uz * push;
          var rel = Math.abs(pc.speed - o.speed);
          if (rel > 10) { damage(pc, rel * 0.25); damage(o, rel * 0.35); }
          pc.speed *= 0.82; o.speed *= 0.85;
        }
      }
    }
  }

  // F enter/exit support (called by VR.Player): nearest drivable car.
  function nearestCar(x, z, maxDist) {
    var best = null, bestD2 = maxDist * maxDist;
    var list = VR.Vehicles.all;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.dead) continue;
      var dx = c.x - x, dz = c.z - z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  }

  function enterCar(car) {
    if (!car || car.dead) return false;
    VR.Vehicles.playerCar = car;
    return true;
  }

  function exitCar() {
    VR.Vehicles.playerCar = null;
  }

  VR.Vehicles = {
    all: [],
    playerCar: null,
    createCar: createCar,
    setPlayerCar: function (car) { VR.Vehicles.playerCar = car; },
    nearestCar: nearestCar,
    enterCar: enterCar,
    exitCar: exitCar,
    stepCar: stepCar,
    damage: damage,
    update: update
  };
})(window.VR);
