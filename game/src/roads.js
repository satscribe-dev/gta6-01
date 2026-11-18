// roads.js — the street graph: nodes at intersections, edges along
// streets. Single source of truth for traffic AI, police navigation
// and the minimap. PLAN (r5 W5 network redesign, 18 Nov 2026): the
// uniform 8x8 grid is GONE. Streets are IRREGULARLY spaced, 4 are
// partial (T-junctions), widths form a hierarchy (boulevard 11 /
// mains 7 / streets 6 / lane 5 / alley 4), and the network is
// completed by curved chains (avenue, ring, beach road, crescent)
// + two straight east-west mains (Market z=52, Highrise z=-160) + 2
// dead-end stubs. Blocks are the cells between adjacent streets —
// different sizes by construction. A street is a node SEQUENCE
// (endpoints + crossings with other streets + chain/link points that
// lie on it), so a chain that crosses a street JOINS the graph there.
// W5d (r6) REBUILD: the W5c mid-run kinks are GONE. Kinking every run
// 8-12 units sideways made the aerial read as scattered slashes, not
// a city — a street must run straight between its junctions so the
// blocks it bounds CLOSE and read as blocks. The "warped lattice" is
// the irregular spacing + partials + curves + diagonals, not a jog in
// every run: streets are ~orthogonal with varying spacing, the curves
// and diagonals supply the gentle bends.
// W5f (r7) TIDY ROUND 2: the W5e cut of the Harbor Diagonal was not
// enough — Bos (02:30 WIB): the whole network still read messy from
// above. The cause was the two wavy mains through the middle of the
// city (Market Curve + Highrise Arc sawtoothing ±8 through their
// bands) plus the Bayview Curve cutting the NE corner: Market and
// Highrise are STRAIGHTENED to z=52 / z=-160, Bayview is CUT. The
// network is now a clean orthogonal grid + ONE diagonal (Vandara
// Avenue) + contained loops (Plaza Ring, Pasar Crescent, beach road
// along the coast). Every block is a closed rectangle except where
// the single avenue cuts it — by design.
// METHOD (OSM article, IDEAS ONLY — no OSM data, no copied code):
// roads are POLYLINES from a plan written in this session (our own
// fictional Vandara Bay, not a real city); a junction is a SHARED
// POINT of two polylines; buildings are irregular polygons extruded
// (see buildings.js); coast is a polyline. All code below is fresh.
(function (VR) {
  'use strict';

  var C = VR.Config;

  // ---- Street plan (serializable; see r5/w5-network-redesign-plan.md) ----
  // Vertical streets V {x, z0, z1, w} — gaps 52,54,52,60,56,54,92.
  var V = [
    { x: -210, z0: -210, z1: 210, w: 11 }, // boulevard (coastal highway)
    { x: -158, z0: -210, z1: 210, w: 6 },
    { x: -104, z0: -210, z1: 86, w: 6 },   // PARTIAL — T at (-104,86)
    { x: -52, z0: -210, z1: 210, w: 7 },   // main
    { x: 8, z0: -210, z1: 210, w: 4 },     // ALLEY (narrow, downtown)
    { x: 64, z0: -210, z1: 210, w: 6 },
    { x: 118, z0: -138, z1: 210, w: 6 },   // PARTIAL — T at (118,-138)
    { x: 210, z0: -210, z1: 210, w: 6 }    // east edge
  ];
  // Horizontal streets H {z, x0, x1, w} — gaps 72,54,54,54,62,54,70.
  var H = [
    { z: -210, x0: -210, x1: 210, w: 6 },  // north edge
    { z: -138, x0: -210, x1: 210, w: 6 },
    { z: -84, x0: -210, x1: 64, w: 6 },    // PARTIAL — T at (64,-84)
    { z: -30, x0: -210, x1: 210, w: 7 },   // main
    { z: 24, x0: -210, x1: 210, w: 5 },    // LANE (narrow)
    { z: 86, x0: -158, x1: 210, w: 6 },   // PARTIAL — T at (-52,86) and (-104,86)
    { z: 140, x0: -210, x1: 210, w: 6 },
    { z: 210, x0: -210, x1: 210, w: 6 }    // south edge
  ];
  var vStreets = V.map(function (s) { return s.x; });
  var hStreets = H.map(function (s) { return s.z; });

  // Nodes: one per intersection / chain point.
  var nodes = [];
  var nodeIndex = {}; // "x,z" -> node id
  var i, j;

  // Edges: {a, b} node ids, cached endpoints, half-width w, and src
  // ('street' | 'chain:<kind>' | 'link') so checks can attribute a
  // blocker to the road that owns it.
  var edges = [];
  // Node id for (x, z), creating the node when it does not exist yet.
  // Exact points reuse the existing node id, so a chain that crosses
  // a street joins the graph there.
  function addNode(x, z) {
    var key = x + ',' + z;
    var id = nodeIndex[key];
    if (id !== undefined) return id;
    id = nodes.length;
    nodes.push({ x: x, z: z });
    nodeIndex[key] = id;
    return id;
  }
  // Edge between two node ids. w = half-width of the road.
  function addEdgeById(a, b, w, src) {
    edges.push({
      a: a, b: b,
      ax: nodes[a].x, az: nodes[a].z, bx: nodes[b].x, bz: nodes[b].z,
      w: w || C.ROAD_HALF_WIDTH, src: src || 'street'
    });
  }

  // Per-street node sets: {"x,z": true} — seeded with endpoints and
  // V x H crossings, then chain/link points that lie on the street
  // are inserted (so the street sequence includes them).
  var vSets = [], hSets = [];
  for (i = 0; i < V.length; i++) {
    var vs = {};
    vs[V[i].x + ',' + V[i].z0] = true;
    vs[V[i].x + ',' + V[i].z1] = true;
    vSets.push(vs);
  }
  for (j = 0; j < H.length; j++) {
    var hs = {};
    hs[H[j].x0 + ',' + H[j].z] = true;
    hs[H[j].x1 + ',' + H[j].z] = true;
    hSets.push(hs);
  }
  // V x H crossings (within both streets' extents).
  for (i = 0; i < V.length; i++) {
    for (j = 0; j < H.length; j++) {
      if (H[j].z >= V[i].z0 && H[j].z <= V[i].z1 &&
          V[i].x >= H[j].x0 && V[i].x <= H[j].x1) {
        vSets[i][V[i].x + ',' + H[j].z] = true;
        hSets[j][V[i].x + ',' + H[j].z] = true;
      }
    }
  }
  // Insert a chain/link point into every street it lies on (within
  // that street's extent). Points on no street stay chain-only nodes.
  function insertOnStreets(x, z) {
    for (var vi = 0; vi < V.length; vi++) {
      if (x === V[vi].x && z >= V[vi].z0 && z <= V[vi].z1) {
        vSets[vi][x + ',' + z] = true;
      }
    }
    for (var hi = 0; hi < H.length; hi++) {
      if (z === H[hi].z && x >= H[hi].x0 && x <= H[hi].x1) {
        hSets[hi][x + ',' + z] = true;
      }
    }
  }

  // ---- Chains (defined first as data, so their points can be ----
  // ---- inserted into the street sequences before edges emit) ----
  // A chain is a polyline: { kind, halfWidth, pts: [[x, z], ...] }.
  // world.js renders the same chains as ribbons; minimap.js draws
  // them from VR.Roads.edges. Exposed as VR.Roads.chains.
  var chains = [];
  var chainDefs = [];
  function defineChain(kind, pts, halfWidth) {
    chainDefs.push({ kind: kind, pts: pts, halfWidth: halfWidth });
  }

  // 1) VANDARA AVENUE — diagonal, line x + z = -30, half-width 8.
  // Nodes are COMPUTED from the plan (OSM method: a junction is a
  // shared point — every crossing of the line with a street in its
  // extent, plus the junctions with the two curves). The line itself
  // is UNCHANGED from v2; the node list follows the streets, so it
  // can never go stale when a street moves. Dedupe < 2 keeps the
  // staggered pair (-54,24) [z=24] and (-52,22) [x=-52], 2.8 apart.
  // W5c (r6): +1 junction — (160,-190) where the Bayview Curve
  // crossed it — so the curve joins the avenue at grade.
  // W5e (r7): the Harbor Diagonal is CUT (it crossed the avenue at
  // (105,-135) at 90 degrees, an X through the NE superblock) and
  // its avenue junction point is gone with it.
  // W5f (r7): Market junction (-81,51) -> (-82,52) and Highrise
  // junction (133,-163) -> (130,-160) follow the straightened
  // mains; the Bayview junction (160,-190) is gone with the cut
  // Bayview Curve.
  var avPts = [];
  for (var avi = 0; avi < V.length; avi++) {
    var az = -30 - V[avi].x;
    if (az >= V[avi].z0 && az <= V[avi].z1) avPts.push([V[avi].x, az]);
  }
  for (var ahi = 0; ahi < H.length; ahi++) {
    var ax = -30 - H[ahi].z;
    if (ax >= H[ahi].x0 && ax <= H[ahi].x1) avPts.push([ax, H[ahi].z]);
  }
  avPts.push([-82, 52], [130, -160]); // junctions with Market Main / Highrise Main
  avPts.sort(function (a, b) { return b[0] - a[0]; }); // west to east
  var avDedup = [];
  for (var adi = 0; adi < avPts.length; adi++) {
    var prev = avDedup[avDedup.length - 1];
    if (!prev || Math.hypot(avPts[adi][0] - prev[0], avPts[adi][1] - prev[1]) >= 2) {
      avDedup.push(avPts[adi]);
    }
  }
  defineChain('avenue', avDedup, 8);

  // 2) PLAZA RING — a closed loop (r = 24) around the Highrise Plaza
  // block centre (-22, -57) — the new block is 60x54, so r=24 fits
  // where the old r=28 would have crossed the x=8 / z=-84 streets.
  // The tower at the block centre sits inside the loop, as before.
  // 16 nodes, ~9-unit segments.
  var ringPts = [];
  for (var rk = 0; rk < 16; rk++) {
    var ra = rk * Math.PI / 8;
    ringPts.push([-22 + Math.round(24 * Math.cos(ra)), -57 + Math.round(24 * Math.sin(ra))]);
  }
  defineChain('ring', ringPts, 6);

  // 3) BEACH ROAD — follows the Vandara Bay coastline: x = coastX(z)+8,
  // 8 units east of the waterline, z = -210..210 in 15-unit steps.
  // It curves WITH the bay: west to x=-250 around the peninsula
  // (z~-110), east to x=-230 at the inlet (z~+95), so the road, the
  // sand and the waterline all bend together. Clear of every footprint
  // and every boardwalk palm (worst centreline-to-palm distance 8.3,
  // need >= 4). world.js loads first, so VR.World.coastX is the one
  // true coastline; the fallback is the old straight beach (only if
  // world.js is absent).
  var coastFn = (VR.World && VR.World.coastX) || function (z) {
    return -238 + 2 * Math.sin(z * 0.025);
  };
  var bayPts = [];
  for (var bz = -210; bz <= 210; bz += 15) {
    bayPts.push([Math.round(coastFn(bz) + 8), bz]);
  }
  defineChain('curve', bayPts, 6);

  // 4) PASAR CRESCENT — a bow across Pasar Lentera's south edge, from
  // (-158, 210) to (118, 210) sagging north to (0, 192). Ends are
  // grid intersections (verticals -158 / 118 on z=210), so the chain
  // joins the grid with no spokes.
  defineChain('curve', [
    [-158, 210], [-100, 199], [-50, 194], [0, 192],
    [50, 194], [100, 199], [118, 210]
  ], 6);

  // 5) MARKET MAIN (W5f, r7) — was MARKET CURVE: a wavy east-west
  // main (60->48->58->51->42->56->44->58->60) that sawtoothed through
  // the middle of the z=24..86 band and sliced its blocks into
  // slivers — the main thing the aerial read as "acak-acakan" (Bos
  // 02:30 WIB). STRAIGHTENED to z=52, full width, w=7: every point
  // lies ON a vertical street, so every point is a junction, and
  // the band splits into two clean rectangle rows (24..52, 52..86).
  // It crosses the avenue at (-82,52), a shared node of both chains.
  defineChain('curve', [
    [-210, 52], [-158, 52], [-104, 52], [-82, 52], [-52, 52],
    [8, 52], [64, 52], [118, 52], [210, 52]
  ].sort(function (a, b) { return a[0] - b[0]; }), 7);

  // 6) HIGHRISE MAIN (W5f, r7) — was HIGHRISE ARC: a sawtooth
  // (-162->-150->-164->-152->-166->-154->-164->-163->-160) 12-28
  // south of the z=-138 street that read from above as a second
  // wavy line shadowing it. STRAIGHTENED to z=-160, full width, w=6
  // (kept inside the old corridor so no building footprint the old
  // arc dodged is newly cut): the -138..-210 band splits into two
  // clean rectangle rows (-138..-160, -160..-210). Every point lies
  // ON a vertical street (junctions); it crosses the avenue at
  // (130,-160), a shared node.
  defineChain('curve', [
    [-210, -160], [-158, -160], [-104, -160], [-52, -160],
    [8, -160], [64, -160], [118, -160], [130, -160], [210, -160]
  ].sort(function (a, b) { return a[0] - b[0]; }), 6);

  // 6b) BAYVIEW CURVE — CUT in W5f (r7). It sagged across the
  // north-east band (-210..-138) from (8,-210) to (210,-172),
  // cutting the NE corner blocks on a third diagonal-ish line
  // alongside the avenue and the arc. Redundant: every one of its
  // junctions already lay on another road, and the straightened
  // Highrise Main at z=-160 already splits the NE band — so cutting
  // it orphans no node and the NE closes as rectangles bounded by
  // the grid + the single avenue diagonal.

  // 7-8) DEAD-END STUBS — short cul-de-sac stubs into blocks, each
  // ending in a turnaround bulb (world.js renders a disc at the end
  // point). Degree-1 graph endpoints; everything else stays
  // connected through the stub's start junction.
  // W5f: D1 moved 50 -> 52 so it branches off the straightened
  // Market Main instead of floating 2 units off it.
  defineChain('deadend', [[8, 52], [40, 52]], 5);
  defineChain('deadend', [[150, -138], [150, -100]], 5);

  // Connector segments (ring spokes, beach ties): graph edges that
  // are NOT part of a chain polyline. Recorded as [ax, az, bx, bz]
  // so world.js can render them as short ribbons too — a car must
  // never drive on an invisible road.
  var links = [];
  var linkDefs = [
    // Ring spokes: 45-degree points to the nearest intersections.
    // The NE spoke ends ON the avenue node (0,-30) — the old (8,-30)
    // target would have crossed the avenue 4.6 from its node.
    [-5, -74, 8, -84], [-39, -74, -52, -84],
    [-39, -40, -52, -30], [-5, -40, 0, -30]
    // Beach ties to the boulevard are appended below (they need
    // bayPts): at z = -84, 24 (street lines) and 195. The old third
    // tie at z = 210 was hit by a boardwalk palm at (-222,212.1) —
    // the palm row (x=-222, z = 30k ± 6) leaves a palm-free gap at
    // 186..204, and 195 sits in it. 195 is not a street line, but the
    // tie only needs the boulevard (continuous, all z) — it joins as
    // a T-junction at (-210,195). The beach road's south end
    // (-246,210) becomes a degree-1 node at the map edge (reads as
    // continuing off-map, like the north end).
  ];
  for (var bc = 0; bc < bayPts.length; bc++) {
    var cz = bayPts[bc][1];
    if (cz === -84 || cz === 24 || cz === 195) {
      linkDefs.push([bayPts[bc][0], cz, -210, cz]);
    }
  }

  // Insert every chain/link point into the streets it lies on.
  for (var cd = 0; cd < chainDefs.length; cd++) {
    var cpts = chainDefs[cd].pts;
    for (var cp = 0; cp < cpts.length; cp++) insertOnStreets(cpts[cp][0], cpts[cp][1]);
  }
  for (var ld = 0; ld < linkDefs.length; ld++) {
    insertOnStreets(linkDefs[ld][0], linkDefs[ld][1]);
    insertOnStreets(linkDefs[ld][2], linkDefs[ld][3]);
  }

  // Emit street edges from the sequences (sorted along each street)
  // and record the polylines for rendering (world.js ribbons).
  // W5d (r6): streets run STRAIGHT on their nominal lines — the W5c
  // kink machine (jogStreet: a lateral 8-12 unit jog in every long
  // run) is deleted. It shattered block readability from above: the
  // aerial read as scattered slashes instead of closed city blocks.
  // Edge streets were never kinked; now no street is.
  var streetPolylines = [];
  function seqPts(set, vertical) {
    var pts = [];
    for (var key in set) {
      var parts = key.split(',');
      pts.push([+parts[0], +parts[1]]);
    }
    pts.sort(function (a, b) { return vertical ? (a[1] - b[1]) : (a[0] - b[0]); });
    return pts;
  }
  for (i = 0; i < V.length; i++) {
    var vpts = seqPts(vSets[i], true);
    streetPolylines.push({ pts: vpts, w: V[i].w, vertical: true });
    for (var vq = 0; vq < vpts.length - 1; vq++) {
      var va = addNode(vpts[vq][0], vpts[vq][1]);
      var vb = addNode(vpts[vq + 1][0], vpts[vq + 1][1]);
      addEdgeById(va, vb, V[i].w, 'street');
    }
  }
  for (j = 0; j < H.length; j++) {
    var hpts = seqPts(hSets[j], false);
    streetPolylines.push({ pts: hpts, w: H[j].w, vertical: false });
    for (var hq = 0; hq < hpts.length - 1; hq++) {
      var ha = addNode(hpts[hq][0], hpts[hq][1]);
      var hb = addNode(hpts[hq + 1][0], hpts[hq + 1][1]);
      addEdgeById(ha, hb, H[j].w, 'street');
    }
  }

  // Emit the chains (nodes dedupe with the street nodes above).
  function addChain(kind, pts, halfWidth) {
    var ids = [];
    for (var k = 0; k < pts.length; k++) ids.push(addNode(pts[k][0], pts[k][1]));
    for (var m = 0; m < ids.length - 1; m++) {
      addEdgeById(ids[m], ids[m + 1], halfWidth, 'chain:' + kind);
    }
    if (kind === 'ring') addEdgeById(ids[ids.length - 1], ids[0], halfWidth, 'chain:ring');
    chains.push({ kind: kind, halfWidth: halfWidth, pts: pts });
    return ids;
  }
  for (var ci = 0; ci < chainDefs.length; ci++) {
    addChain(chainDefs[ci].kind, chainDefs[ci].pts, chainDefs[ci].halfWidth);
  }
  // Emit the links.
  function addLink(ax, az, bx, bz, w) {
    addEdgeById(nodeIndex[ax + ',' + az], nodeIndex[bx + ',' + bz], w, 'link');
    links.push([ax, az, bx, bz]);
  }
  for (var li = 0; li < linkDefs.length; li++) {
    addLink(linkDefs[li][0], linkDefs[li][1], linkDefs[li][2], linkDefs[li][3], 6);
  }

  // Adjacency list for routing.
  var adj = [];
  for (i = 0; i < nodes.length; i++) adj.push([]);
  for (i = 0; i < edges.length; i++) {
    var e = edges[i];
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }

  // Distance from (px, pz) to edge segment (ax,az)-(bx,bz); returns
  // { d, x, z } — the distance and the closest point on the segment.
  // All queries run on EDGES, so the diagonal avenue, the ring and
  // the curves count exactly like grid streets.
  function distToSeg(px, pz, ax, az, bx, bz) {
    var vx = bx - ax, vz = bz - az;
    var len2 = vx * vx + vz * vz;
    var t = len2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var cx = ax + vx * t, cz = az + vz * t;
    var dx = px - cx, dz = pz - cz;
    return { d: Math.sqrt(dx * dx + dz * dz), x: cx, z: cz };
  }

  function nearestEdge(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var r = distToSeg(x, z, e.ax, e.az, e.bx, e.bz);
      if (r.d < bestD) { bestD = r.d; best = { edge: e, d: r.d, x: r.x, z: r.z }; }
    }
    return best;
  }

  function halfWidthAt(x, z) {
    var n = nearestEdge(x, z);
    return n ? (n.edge.w || C.ROAD_HALF_WIDTH) : C.ROAD_HALF_WIDTH;
  }

  function isOnRoad(x, z) {
    var n = nearestEdge(x, z);
    return !!n && n.d <= (n.edge.w || C.ROAD_HALF_WIDTH);
  }

  // Closest point on the road network (snaps to the nearest edge
  // segment — street, diagonal avenue, ring or curve alike).
  var _np = { x: 0, z: 0 };
  function nearestPointOnRoad(x, z) {
    var n = nearestEdge(x, z);
    if (!n) { _np.x = x; _np.z = z; return _np; }
    // Clamp to the world bounds (±240), NOT the street span: the beach
    // road runs at x ~ -230, outside the grid's -210..210.
    var B = C.WORLD_HALF || 240;
    _np.x = Math.max(-B, Math.min(B, n.x));
    _np.z = Math.max(-B, Math.min(B, n.z));
    return _np;
  }

  // Total length of every edge (for length-weighted random picks).
  var _edgeLen = [];
  var _totalLen = 0;
  for (var el = 0; el < edges.length; el++) {
    var ee = edges[el];
    var len = Math.sqrt((ee.bx - ee.ax) * (ee.bx - ee.ax) +
      (ee.bz - ee.az) * (ee.bz - ee.az));
    _edgeLen.push(len);
    _totalLen += len;
  }

  function randomRoadPoint(rng) {
    var r = rng || Math.random;
    // Pick an edge weighted by length, then a random point along it:
    // grid streets still dominate (most of the network), but a good
    // share of spawns land on the avenue / ring / curves, so traffic
    // and police actually use the new roads.
    var target = r() * _totalLen;
    var ei = 0;
    while (ei < edges.length - 1 && target > _edgeLen[ei]) {
      target -= _edgeLen[ei];
      ei++;
    }
    var e2 = edges[ei];
    var t = _edgeLen[ei] > 0 ? target / _edgeLen[ei] : 0;
    return {
      x: e2.ax + (e2.bx - e2.ax) * t,
      z: e2.az + (e2.bz - e2.az) * t
    };
  }

  function nearestNode(x, z) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var dx = nodes[i].x - x, dz = nodes[i].z - z;
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Shortest route along the graph, weighted by edge LENGTH (Dijkstra).
  // Length-weighting matters now that the graph is not a pure grid:
  // the diagonal avenue's long hops beat the grid's short ones, so a
  // route from one end of the avenue to the other actually USES the
  // avenue (plain BFS counts hops and would wander off onto the
  // grid). Returns [{x,z}, ...] including the start and end points
  // (start/end snapped to their nearest nodes only when they are
  // off-road; exact endpoints are kept as given).
  function route(fx, fz, tx, tz) {
    var start = nearestNode(fx, fz);
    var goal = nearestNode(tx, tz);
    var dist = new Float64Array(nodes.length).fill(Infinity);
    var prev = new Int32Array(nodes.length).fill(-1);
    var done = new Uint8Array(nodes.length);
    dist[start] = 0;
    prev[start] = start;
    for (var it = 0; it < nodes.length; it++) {
      var cur = -1, best = Infinity;
      for (var n = 0; n < nodes.length; n++) {
        if (!done[n] && dist[n] < best) { best = dist[n]; cur = n; }
      }
      if (cur === -1) break;
      done[cur] = 1;
      if (cur === goal) break;
      var nb = adj[cur];
      for (var i = 0; i < nb.length; i++) {
        var m = nb[i];
        if (done[m]) continue;
        var dx = nodes[cur].x - nodes[m].x, dz = nodes[cur].z - nodes[m].z;
        var nd = dist[cur] + Math.sqrt(dx * dx + dz * dz);
        if (nd < dist[m]) { dist[m] = nd; prev[m] = cur; }
      }
    }
    var path = [];
    if (prev[goal] === -1) {
      // No path (should not happen on a connected graph) — straight
      // line fallback.
      return [{ x: fx, z: fz }, { x: tx, z: tz }];
    }
    var n = goal;
    var rev = [];
    while (n !== start) { rev.push(n); n = prev[n]; }
    rev.push(start);
    path.push({ x: fx, z: fz });
    for (var k = rev.length - 1; k >= 0; k--) {
      path.push({ x: nodes[rev[k]].x, z: nodes[rev[k]].z });
    }
    path.push({ x: tx, z: tz });
    return path;
  }

  VR.Roads = {
    nodes: nodes,
    edges: edges,
    streets: vStreets,
    vStreets: vStreets,
    hStreets: hStreets,
    vWidths: V.map(function (s) { return s.w; }), // parallel to vStreets
    hWidths: H.map(function (s) { return s.w; }), // parallel to hStreets
    streetPolylines: streetPolylines,
    chains: chains,
    links: links,
    isOnRoad: isOnRoad,
    nearestPointOnRoad: nearestPointOnRoad,
    randomRoadPoint: randomRoadPoint,
    route: route,
    nearestNode: nearestNode
  };

})(window.VR = window.VR || {});
