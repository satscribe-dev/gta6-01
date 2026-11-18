// roads.js — the street graph: nodes at intersections, edges along
// streets (step 60, streets at -210..210). Single source of truth for
// traffic AI, police navigation and the minimap.
(function (VR) {
  'use strict';

  var C = VR.Config;
  var STREETS = [-210, -150, -90, -30, 30, 90, 150, 210];

  // Nodes: one per intersection.
  var nodes = [];
  var nodeIndex = {}; // "x,z" -> node id
  var i, j;
  for (i = 0; i < STREETS.length; i++) {
    for (j = 0; j < STREETS.length; j++) {
      var id = nodes.length;
      nodes.push({ x: STREETS[i], z: STREETS[j] });
      nodeIndex[STREETS[i] + ',' + STREETS[j]] = id;
    }
  }

  // Edges: along each street between neighbouring intersections.
  // Each edge: {a, b} node ids, plus cached endpoints.
  var edges = [];
  function addEdge(ax, az, bx, bz) {
    var a = nodeIndex[ax + ',' + az];
    var b = nodeIndex[bx + ',' + bz];
    edges.push({ a: a, b: b, ax: ax, az: az, bx: bx, bz: bz });
  }
  for (i = 0; i < STREETS.length; i++) {
    for (j = 0; j < STREETS.length - 1; j++) {
      addEdge(STREETS[i], STREETS[j], STREETS[i], STREETS[j + 1]); // vertical
      addEdge(STREETS[j], STREETS[i], STREETS[j + 1], STREETS[i]); // horizontal
    }
  }

  // Adjacency list for routing.
  var adj = [];
  for (i = 0; i < nodes.length; i++) adj.push([]);
  for (i = 0; i < edges.length; i++) {
    var e = edges[i];
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }

  function halfWidthAt(x, z) {
    // Coastal boulevard x = -210 is 4 lanes, everything else 2 lanes.
    if (Math.abs(x + 210) < 1) return C.BOULEVARD_HALF_WIDTH;
    return C.ROAD_HALF_WIDTH;
  }

  function isOnRoad(x, z) {
    for (var i = 0; i < STREETS.length; i++) {
      var s = STREETS[i];
      if (Math.abs(x - s) <= halfWidthAt(s, z)) return true;
      if (Math.abs(z - s) <= C.ROAD_HALF_WIDTH) return true;
    }
    return false;
  }

  // Closest point on the road network (snaps to the nearest street line).
  var _np = { x: 0, z: 0 };
  function nearestPointOnRoad(x, z) {
    var bestX = x, bestZ = z, bestD = Infinity;
    for (var i = 0; i < STREETS.length; i++) {
      var s = STREETS[i];
      // Snap x to the vertical street.
      var dx = Math.abs(x - s);
      if (dx < bestD) { bestD = dx; bestX = s; bestZ = z; }
      // Snap z to the horizontal street.
      var dz = Math.abs(z - s);
      if (dz < bestD) { bestD = dz; bestX = x; bestZ = s; }
    }
    // Clamp onto the street span.
    bestX = Math.max(C.STREET_MIN, Math.min(C.STREET_MAX, bestX));
    bestZ = Math.max(C.STREET_MIN, Math.min(C.STREET_MAX, bestZ));
    _np.x = bestX; _np.z = bestZ;
    return _np;
  }

  function randomRoadPoint(rng) {
    var r = rng || Math.random;
    var vertical = r() < 0.5;
    var s = STREETS[Math.floor(r() * STREETS.length)];
    var t = C.STREET_MIN + r() * (C.STREET_MAX - C.STREET_MIN);
    if (vertical) return { x: s, z: t };
    return { x: t, z: s };
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

  // Breadth-first route along the graph. Returns [{x,z}, ...] including
  // the start and end points (start/end snapped to their nearest nodes
  // only when they are off-road; exact endpoints are kept as given).
  function route(fx, fz, tx, tz) {
    var start = nearestNode(fx, fz);
    var goal = nearestNode(tx, tz);
    var prev = new Int32Array(nodes.length).fill(-1);
    var queue = [start];
    prev[start] = start;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (cur === goal) break;
      var nb = adj[cur];
      for (var i = 0; i < nb.length; i++) {
        if (prev[nb[i]] === -1) {
          prev[nb[i]] = cur;
          queue.push(nb[i]);
        }
      }
    }
    var path = [];
    if (prev[goal] === -1) {
      // No path (should not happen on a full grid) — straight line fallback.
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
    streets: STREETS,
    isOnRoad: isOnRoad,
    nearestPointOnRoad: nearestPointOnRoad,
    randomRoadPoint: randomRoadPoint,
    route: route,
    nearestNode: nearestNode
  };

})(window.VR = window.VR || {});
