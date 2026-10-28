// Progressive single-room top-down pixel renderer + navigation. Pure view: never mutates game state.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api.geo;
  if (root && root.document) root.CantinaWorld = api.world;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var T = 16, HW = 5, HH = 4, REACH = 28, SREACH = 12, CAP = 12, GPU_CAP = 8, BASE = 152, SUB = 4, MX = 16, MY = 24;
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }, INWARD = { top: 'down', bottom: 'up', left: 'right', right: 'left' };
  var SPEEDS = [1, 1.5, 2, 3];
  var ROLE = {
    engineers: { uni: '#c4572b', trim: '#8a3516', glow: '#ffb07a', seed: 0, noun: 'engineers' },
    compute: { seed: 0 },
    researchers: { uni: '#b09ae0', trim: '#7560ad', glow: '#c9b8ff', seed: 10, noun: 'researchers' },
    marketers: { uni: '#6fd6a6', trim: '#2f8a63', glow: '#9ff0c8', seed: 15, noun: 'marketers' }
  };
  // Agent role palette for the Agent Floor pods (mirrors dist/data.js roles). Renderer-only.
  var AGENT = {
    scout: { body: '#f2c230', trim: '#b88a10', glow: '#fff0a8' },
    validator: { body: '#6fd6a6', trim: '#2f8a63', glow: '#c6f5de' },
    auditor: { body: '#f08a5d', trim: '#b4502a', glow: '#ffc9a8' },
    chainer: { body: '#b09ae0', trim: '#7560ad', glow: '#ddccff' },
    sentinel: { body: '#7cc4f0', trim: '#2f6da0', glow: '#c6e8ff' }
  };
  var AGENT_ORDER = ['scout', 'validator', 'auditor', 'chainer', 'sentinel'];
  var has = Object.prototype.hasOwnProperty;
  function agentColor(role) { return typeof role === 'string' && has.call(AGENT, role) ? AGENT[role] : AGENT.scout; }
  function clamp01(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  function clampInt(v, lo, hi) { v = Math.floor(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }

  /*
   * OPTIONAL RENDERER VIEW MODEL (5th argument to update()).
   * When omitted, the renderer uses only the legacy state fields and behaves exactly as before.
   * One field affects navigation: `hq` chooses which earned rooms exist (1/3/5/7/9). All other
   * fields are cosmetic and never change geometry, routes, interaction or any game rule.
   *   view = {
   *     hq:          1..8   headquarters level; selects earned rooms instead of state.stage,
   *     facilities:  { <facilityId>: level }   level pips on each facility's station,
   *     vault:       0..1    fill ratio of the Ledger Vault gauge built into the Ops Monitor,
   *     construction:{ <facilityId>: 0..1 }    scaffolding on that facility's station,
   *     timers:       [ { station, caption, remaining, progress } ] countdowns above progress bars,
   *     agents:      [ { role, busy } ]         Agent Floor pods, roster lights, SOC sentinel desks,
   *     engineers:   integer occupied Review Room desks (else state.engineers),
   *     racks:       { cluster }                lit Server Room rack cabinets (else facilities.cluster, else state.compute)
   *   }
   * Physical artwork (consoles, gauges, displays, desks, pods, scaffolding, pips) stays inside solid
   * tiles. Only labels, the founder and the existing door mats/near marker are drawn on walkable floor.
   * STATION_FACILITY: which facility's level pips sit on each station (one each, no overlap).
   * FAC_STATION:      which station a facility's construction scaffolding overlays.
   */
  var STATION_FACILITY = { rig: 'rig', contract: 'ops', stats: 'vault', hq: 'hq', forge: 'forge', engineers: 'review', compute: 'cluster', researchers: 'lab', marketers: 'comms', defense: 'soc' };
  var FAC_STATION = {};
  Object.keys(STATION_FACILITY).forEach(function (sid) { FAC_STATION[STATION_FACILITY[sid]] = sid; });
  var FAC_COLOR = { rig: '#4cf08a', hq: '#ffe28a', vault: '#e8a05a', forge: '#f2c230', review: '#ffb07a', cluster: '#4cf08a', lab: '#c9b8ff', comms: '#9ff0c8', soc: '#7cc4f0', ops: '#f2c230' };
  // Maximum level of each facility (mirrors dist/data.js); the level plate and chip show level/max.
  var FAC_MAX = { hq: 8, rig: 3, forge: 6, vault: 10, ops: 5, review: 8, cluster: 8, lab: 6, comms: 6, soc: 6 };
  // Level chip and flag colours (screen space). Dark = upgradable, grey = waiting on Headquarters,
  // gold = fully upgraded, red/amber = a real bottleneck right now.
  var CHIP = { dark: 'rgba(52,54,59,.82)', near: '#f1e6c8', grey: 'rgba(118,120,126,.9)', gold: '#e2b93c', red: '#b42318', amber: '#b56a00' };
  var WASH = { red: 'rgba(180,35,24,.35)', amber: 'rgba(181,106,0,.35)' }, LAMP = { red: '#ff7a6e', amber: '#ffc24a' };

  // ---- Room layouts (tile grids). Collision and drawing both read these tables. ----
  // ROOM_LIST / STATIONS hold the original stage-based campus (unchanged public exports).
  // LATE_ROOMS / LATE_STATIONS hold the two HQ-5 rooms, reachable only through the optional HQ view.
  var ROOM_LIST = [], LATE_ROOMS = [], ROOMS = {}, STATIONS = [], LATE_STATIONS = [];
  function mkRoom(id, name, stage, cols, rows, floor, sp, late) {
    var R = { id: id, name: name, stage: stage, hq: stage + 1, cols: cols, rows: rows, width: cols * T, height: rows * T, floor: floor,
      wall: new Uint8Array(cols * rows), solid: new Uint8Array(cols * rows), own: new Array(cols * rows).fill(null), furn: [], desks: [], racks: [], pods: [], minis: [], stations: [], doors: [],
      spawn: { x: sp[0] * T + 8, y: sp[1] * T + 8, facing: sp[2] } };
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) if (!x || !y || x === cols - 1 || y === rows - 1) R.wall[y * cols + x] = R.solid[y * cols + x] = 1;
    (late ? LATE_ROOMS : ROOM_LIST).push(R); ROOMS[id] = R; return R;
  }
  // A solid tile may belong to exactly one station (or to the office agent terminals). While that owner is
  // hidden, its tiles are open floor; walls and furniture are always solid.
  function fill(R, x0, y0, x1, y1, owner) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var i = y * R.cols + x;
      R.own[i] = owner && (!R.solid[i] || R.own[i] === owner) ? owner : null;
      R.solid[i] = 1;
    }
  }
  function furn(R, k, tx, ty, tw, th) { R.furn.push({ k: k, tx: tx, ty: ty, tw: tw, th: th }); fill(R, tx, ty, tx + tw - 1, ty + th - 1); }
  function station(R, id, label, short, stage, tx, ty, tw, th, ax, ay, late) {
    fill(R, tx, ty, tx + tw - 1, ty + th - 1, id);
    var s = { id: id, label: label, short: short, area: R.name, room: R.id, stage: stage, tx: tx, ty: ty, tw: tw, th: th,
      x: (tx + tw / 2) * T, y: (ty + th / 2) * T, approach: { x: ax * T + 8, y: ay * T + 8 } };
    R.stations.push(s); (late ? LATE_STATIONS : STATIONS).push(s);
  }
  function door(R, target, tx, ty, side) {
    var home = target === 'office', D = ROOMS[target], a = side === 'top' ? [tx, 1] : side === 'bottom' ? [tx, ty - 1] : side === 'left' ? [1, ty] : [tx - 1, ty];
    R.doors.push({ id: 'door:' + target, kind: 'door', label: home ? 'Return to Founder Office' : 'Enter ' + D.name, short: home ? 'Founder Office' : D.name,
      area: R.name, room: R.id, target: target, stage: home ? R.stage : D.stage, side: side, tx: tx, ty: ty, tw: 1, th: 1,
      x: tx * T + 8, y: ty * T + 8, approach: { x: a[0] * T + 8, y: a[1] * T + 8 } });
  }
  // Door pair: A's door on `side` and the reciprocal door on B's opposite wall at the mirrored normalized position.
  function link(A, target, tx, ty, side) {
    var B = ROOMS[target], o = OPP[side], vert = side === 'top' || side === 'bottom';
    var bx = vert ? Math.round(tx * (B.cols - 1) / (A.cols - 1)) : o === 'left' ? 0 : B.cols - 1;
    var by = vert ? (o === 'top' ? 0 : B.rows - 1) : Math.round(ty * (B.rows - 1) / (A.rows - 1));
    if (vert) bx = Math.max(1, Math.min(B.cols - 2, bx)); else by = Math.max(1, Math.min(B.rows - 2, by));
    door(A, target, tx, ty, side); door(B, A.id, bx, by, o);
  }
  function staffRoom(id, name, stage, floor, role, label, short) {
    var R = mkRoom(id, name, stage, 22, 16, floor, [11, 11, 'up']);
    R.role = role;
    if (role === 'compute') [3, 8].forEach(function (ty) { [2, 6, 13, 17].forEach(function (tx) { R.racks.push({ tx: tx, ty: ty }); fill(R, tx, ty, tx + 1, ty + 2); }); });
    else {
      [3, 7, 11].forEach(function (ty, j) { [2, 6, 13, 17].forEach(function (tx, i) { R.desks.push({ tx: tx, ty: ty, i: j * 4 + i }); fill(R, tx, ty, tx + 1, ty + 1); }); });
      furn(R, 'shelf', 1, 1, 2, 1);
    }
    station(R, role, label, short, stage, 19, 2, 1, 1, 19, 3);
    furn(R, 'plant', 1, 14, 1, 1); furn(R, 'plant', 20, 14, 1, 1);
    return R;
  }

  var O = mkRoom('office', 'Founder Office', 0, 20, 15, 'lobby', [9, 9, 'down']);
  // Headquarters is the landmark: the largest footprint in the office, top centre, with a facade that
  // rises into the wall band above it (solid tiles, so the silhouette can grow without moving collision).
  station(O, 'hq', 'Headquarters', 'HQ', 0, 7, 1, 6, 2, 9, 3);
  station(O, 'hunt', 'Founder Workstation', 'Desk', 0, 8, 5, 3, 1, 9, 6);
  station(O, 'contract', 'Ops Center', 'Ops', 0, 2, 3, 3, 1, 3, 4);
  station(O, 'stats', 'Ledger Vault', 'Vault', 0, 17, 3, 1, 2, 16, 4);
  station(O, 'training', 'Training Bench', 'Training', 0, 12, 10, 3, 1, 13, 11);
  station(O, 'forge', 'Agent Forge', 'Forge', 0, 4, 10, 2, 1, 4, 11);
  // Six one-tile agent terminals: the first agents work here from day one, before the Agent Floor exists.
  [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]].forEach(function (p, i) { O.minis.push({ tx: p[0], ty: p[1], i: i }); fill(O, p[0], p[1], p[0], p[1], 'terminals'); });
  // The GPU Rig: a row of rack cabinets directly under the terminals it feeds (reachable from its left and
  // bottom edges; the terminals sit on its top and the wall on its right).
  station(O, 'rig', 'GPU Rig', 'Rig', 0, 16, 12, 3, 1, 15, 12);
  [[1, 1], [18, 1], [1, 13], [18, 13]].forEach(function (p) { furn(O, 'plant', p[0], p[1], 1, 1); });
  // Flat floor art only, so it never changes where the founder can walk. The office matures with
  // Headquarters: a plain rug, then a reception mat before the HQ (tier 1, HQ 3+), then a polished
  // border and a wider mat (tier 2, HQ 5+).
  O.decor = function (g, tier) {
    tier = tier || 0;
    if (tier >= 2) { r(g, '#e0d2b4', T, T, 6 * T, 1); r(g, '#e0d2b4', 13 * T, T, 6 * T, 1); r(g, '#e0d2b4', T, 14 * T - 1, 18 * T, 1); r(g, '#e0d2b4', T, T, 1, 13 * T); r(g, '#e0d2b4', 19 * T - 1, T, 1, 11 * T); r(g, '#e0d2b4', 19 * T - 1, 13 * T, 1, T); }
    r(g, tier >= 2 ? '#9fae9a' : '#a9b39c', 6 * T, 7 * T, 8 * T, 3 * T); r(g, '#f1e6c8', 6 * T + 3, 7 * T + 3, 8 * T - 6, 1); r(g, '#f1e6c8', 6 * T + 3, 10 * T - 4, 8 * T - 6, 1);
    for (var k = 0; k < 7; k++) r(g, '#98a38b', 6 * T + 10 + k * 16, 7 * T + 8, 6, 3 * T - 16);
    if (tier >= 1) { var mw = tier >= 2 ? 6 * T : 4 * T, mx = 10 * T - mw / 2; r(g, '#8a8f99', mx, 3 * T + 2, mw, T - 4); r(g, '#f1e6c8', mx + 2, 3 * T + 4, mw - 4, 1); r(g, '#f1e6c8', mx + 2, 4 * T - 5, mw - 4, 1); }
  };
  O.tier = function (hq) { return hq >= 5 ? 2 : hq >= 3 ? 1 : 0; };

  staffRoom('engineering', 'Review Room', 1, 'wood', 'engineers', 'Review Room', 'Review');
  var L = mkRoom('lounge', 'Lounge', 1, 20, 15, 'lounge', [10, 10, 'up']);
  station(L, 'coffee', 'Coffee Bar', 'Coffee', 1, 15, 2, 2, 1, 15, 3);
  furn(L, 'shelf', 1, 1, 3, 1); furn(L, 'couch', 3, 11, 4, 1); furn(L, 'table', 4, 9, 2, 1); furn(L, 'pong', 11, 7, 4, 2);
  [[18, 1], [1, 13], [18, 13]].forEach(function (p) { furn(L, 'plant', p[0], p[1], 1, 1); });
  L.decor = function (g) { r(g, '#8a3516', 2 * T, 8 * T, 6 * T, 4 * T); r(g, '#b0552e', 2 * T + 4, 8 * T + 4, 6 * T - 8, 4 * T - 8); };

  staffRoom('compute', 'Server Room', 2, 'tech', 'compute', 'Compute Cluster', 'Cluster');
  staffRoom('research', 'Research Lab', 2, 'lav', 'researchers', 'Research Lab', 'Lab');
  staffRoom('marketing', 'Comms Studio', 3, 'mint', 'marketers', 'Comms Studio', 'Studio');

  var C = mkRoom('courtyard', 'Courtyard', 3, 20, 15, 'grass', [10, 9, 'up']);
  station(C, 'mentor', 'Mentor', 'Mentor', 3, 5, 5, 1, 1, 5, 6);
  station(C, 'journal', 'Campus Notice Board', 'Journal', 3, 14, 4, 2, 1, 14, 5);
  furn(C, 'fountain', 8, 3, 5, 3);
  [[1, 1], [17, 1], [2, 10], [16, 10]].forEach(function (p) { furn(C, 'tree', p[0], p[1], 2, 2); });
  C.path = function (tx, ty) { return (tx >= 9 && tx <= 11 && ty >= 6) || ((ty === 6 || ty === 7) && tx >= 3 && tx <= 16); };

  // ---- HQ-5 late rooms: renderer geometry only; surfaced via the optional HQ view (stage 4). ----
  var AF = mkRoom('agents', 'Agent Floor', 4, 22, 16, 'tech', [11, 13, 'up'], true);
  station(AF, 'roster', 'Agent Roster', 'Roster', 4, 9, 2, 4, 1, 10, 3, true);
  [6, 10, 13].forEach(function (ty, j) { [2, 6, 15, 19].forEach(function (tx, i) { AF.pods.push({ tx: tx, ty: ty, i: j * 4 + i }); fill(AF, tx, ty, tx + 1, ty + 1); }); });
  furn(AF, 'plant', 1, 1, 1, 1); furn(AF, 'plant', 20, 1, 1, 1);
  // Floor emblem only (non-solid), so the founder walks the open floor between pods.
  AF.decor = function (g) { r(g, '#2a3658', 10 * T, 7 * T + 4, 2 * T, 2); r(g, '#2a3658', 11 * T - 1, 6 * T + 6, 2, 2 * T); r(g, '#3a4878', 10 * T + 6, 7 * T + 8, 2 * T - 12, 2); };

  var SO = mkRoom('soc', 'Security Ops Center', 4, 20, 15, 'tech', [10, 12, 'up'], true);
  station(SO, 'defense', 'Security Ops Center', 'SOC', 4, 8, 6, 4, 2, 10, 8, true);
  [[3, 10], [14, 10]].forEach(function (p, i) { SO.desks.push({ tx: p[0], ty: p[1], i: i }); fill(SO, p[0], p[1], p[0] + 1, p[1] + 1); });
  // Video-wall banks are solid furniture against the top wall; tiles 8-12 stay open as the entry corridor.
  SO.displays = [{ tx: 1, ty: 1, tw: 7, th: 2 }, { tx: 13, ty: 1, tw: 6, th: 2 }];
  SO.displays.forEach(function (d) { fill(SO, d.tx, d.ty, d.tx + d.tw - 1, d.ty + d.th - 1); });
  furn(SO, 'plant', 1, 13, 1, 1); furn(SO, 'plant', 18, 13, 1, 1);
  SO.noWindows = true;

  link(O, 'engineering', 3, 0, 'top'); link(O, 'research', 16, 0, 'top'); link(O, 'compute', 0, 7, 'left');
  link(O, 'lounge', 19, 7, 'right'); link(O, 'marketing', 5, 14, 'bottom'); link(O, 'courtyard', 14, 14, 'bottom');
  link(O, 'agents', 0, 11, 'left'); link(C, 'soc', 10, 14, 'bottom');
  var SPAWN = O.spawn;

  // ---- Geometry / navigation (shared by runtime and Node tests); always confined to one room ----
  // Stage 0-3 is the original campus; stage 4 (HQ 5+) adds the two late rooms through the HQ view only.
  function clampStage(v, def) { v = Math.floor(+v); return isFinite(v) ? Math.max(0, Math.min(4, v)) : def; }
  // HQ level (1-8) → effective stage. HQ 1/2/3/4/5+ reveal 1/3/5/7/9 rooms.
  function hqStage(hq) { return Math.min(4, clampInt(hq, 1, 8) - 1); }
  function roomOf(id) { id = id === undefined ? 'office' : id; return typeof id === 'string' && has.call(ROOMS, id) ? ROOMS[id] : null; }
  // `hid` (optional, everywhere below): ids of stations that are not there yet. Their tiles are open floor;
  // without it every station is present, as in the original geometry.
  function tileOk(R, tx, ty, hid) {
    if (!(tx >= 0 && ty >= 0 && tx < R.cols && ty < R.rows)) return false;
    var i = ty * R.cols + tx;
    return !R.solid[i] || !!(hid && R.own[i] && has.call(hid, R.own[i]));
  }
  function isWalkable(x, y, room, hid) {
    var R = roomOf(room);
    if (!R || typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return false;
    var a = Math.floor((x - HW) / T), b = Math.floor((x + HW - 0.01) / T), c = Math.floor((y - HH) / T), d = Math.floor((y + HH - 0.01) / T);
    for (var ty = c; ty <= d; ty++) for (var tx = a; tx <= b; tx++) if (!tileOk(R, tx, ty, hid)) return false;
    return true;
  }
  function nearestOpen(R, tx, ty, hid) {
    for (var rad = 0; rad <= 3; rad++) {
      var best = null, bd = 1e9;
      for (var y = ty - rad; y <= ty + rad; y++) for (var x = tx - rad; x <= tx + rad; x++) {
        var dd = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (tileOk(R, x, y, hid) && dd < bd) { bd = dd; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }
  function findPath(sx, sy, ex, ey, room, hid) {
    var R = roomOf(room);
    if (!R || ![sx, sy, ex, ey].every(function (n) { return typeof n === 'number' && isFinite(n); }) || sx < 0 || sy < 0 || ex < 0 || ey < 0 || sx >= R.width || ex >= R.width || sy >= R.height || ey >= R.height) return [];
    var s = nearestOpen(R, Math.floor(sx / T), Math.floor(sy / T), hid), e = nearestOpen(R, Math.floor(ex / T), Math.floor(ey / T), hid);
    if (!s || !e) return [];
    var W = R.cols, si = s[1] * W + s[0], ei = e[1] * W + e[0], prev = new Int32Array(W * R.rows).fill(-1), q = [si];
    prev[si] = si;
    for (var h = 0; h < q.length && prev[ei] < 0; h++) {
      var i = q[h], cx = i % W, cy = (i / W) | 0;
      for (var k in DIRS) {
        var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1], ni = ny * W + nx;
        if (tileOk(R, nx, ny, hid) && prev[ni] < 0) { prev[ni] = i; q.push(ni); }
      }
    }
    if (prev[ei] < 0) return [];
    var out = [];
    for (var j = ei; ; j = prev[j]) { out.unshift({ x: (j % W) * T + 8, y: ((j / W) | 0) * T + 8 }); if (j === si) break; }
    return out;
  }
  function lineClear(R, x0, y0, x1, y1, hid) {
    var n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
    for (var i = 0; i <= n; i++) { var u = n ? i / n : 0; if (!tileOk(R, Math.floor((x0 + (x1 - x0) * u) / T), Math.floor((y0 + (y1 - y0) * u) / T), hid)) return false; }
    return true;
  }
  // Gap between the player's collision box and a station's tile rectangle (0 when touching).
  function stationGap(x, y, s) {
    var x0 = s.tx * T, y0 = s.ty * T, x1 = (s.tx + s.tw) * T, y1 = (s.ty + s.th) * T;
    return Math.hypot(Math.max(0, x0 - (x + HW), (x - HW) - x1), Math.max(0, y0 - (y + HH), (y - HH) - y1));
  }
  // Short line from the player to the closest station edge; the station's own tiles never block, anything else does.
  function stationClear(R, x, y, s, hid) {
    var cx = Math.max(s.tx * T, Math.min((s.tx + s.tw) * T - 0.01, x)), cy = Math.max(s.ty * T, Math.min((s.ty + s.th) * T - 0.01, y));
    var n = Math.ceil(Math.hypot(cx - x, cy - y) / 2);
    for (var i = 0; i <= n; i++) {
      var u = n ? i / n : 0, tx = Math.floor((x + (cx - x) * u) / T), ty = Math.floor((y + (cy - y) * u) / T);
      if (tx >= s.tx && tx < s.tx + s.tw && ty >= s.ty && ty < s.ty + s.th) continue;
      if (!tileOk(R, tx, ty, hid)) return false;
    }
    return true;
  }
  function targets(R, st) {
    if (!R || R.stage > st) return [];
    return R.stations.concat(R.doors).filter(function (s) { return s.stage <= st; });
  }
  // Nearest station or door the founder can use from here; hidden stations are not candidates.
  function nearestIn(x, y, room, stage, hid) {
    var R = roomOf(room), best = null, bd = SREACH;
    if (!R || !isWalkable(x, y, R.id, hid)) return null;
    var list = targets(R, clampStage(stage, 3)).filter(function (s) { return s.kind || !(hid && has.call(hid, s.id)); });
    list.forEach(function (s) {
      if (s.kind) return;
      var d = stationGap(x, y, s);
      if (d <= bd && stationClear(R, x, y, s, hid)) { bd = d; best = s; }
    });
    if (best) return best;
    bd = REACH;
    list.forEach(function (s) {
      if (!s.kind) return;
      var d = Math.hypot(x - s.approach.x, y - s.approach.y);
      if (d <= bd && lineClear(R, x, y, s.approach.x, s.approach.y, hid)) { bd = d; best = s; }
    });
    return best;
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function pubRoom(R) { return { id: R.id, name: R.name, stage: R.stage, hq: R.hq, spawn: copy(R.spawn), width: R.width, height: R.height }; }
  var ALL_ROOMS = ROOM_LIST.concat(LATE_ROOMS), ALL_STATIONS = STATIONS.concat(LATE_STATIONS);
  function availableRooms(stage) { var st = clampStage(stage, 0); return ROOM_LIST.filter(function (R) { return R.stage <= st; }).map(pubRoom); }
  function availableStations(stage) { var st = clampStage(stage, 0); return STATIONS.filter(function (s) { return s.stage <= st && ROOMS[s.room].stage <= st; }).map(copy); }
  function doorsFor(room, stage) { var R = roomOf(room), st = clampStage(stage, 0); return !R || R.stage > st ? [] : R.doors.filter(function (d) { return d.stage <= st; }).map(copy); }
  // HQ-aware variants include the late rooms. Legacy callers keep the stage-based functions above.
  function roomsForHq(hq) { var st = hqStage(hq); return ALL_ROOMS.filter(function (R) { return R.stage <= st; }).map(pubRoom); }
  function stationsForHq(hq) { var st = hqStage(hq); return ALL_STATIONS.filter(function (s) { return s.stage <= st && ROOMS[s.room].stage <= st; }).map(copy); }
  function doorsForHq(room, hq) { return doorsFor(room, hqStage(hq)); }
  function nearestStation(x, y, room, stage, hid) { var s = nearestIn(x, y, room, stage, hid); return s ? copy(s) : null; }
  // Fit the room into the canvas with 16px horizontal / 24px vertical margins (room for screen-space labels).
  // With `insets` (canvas px: {top, bottom, hud: {left, bottom}}) the room fits the free band above the dock
  // (`bottom`) with 8px margins. Where it would meet the HUD box it moves left of it when that is a small shift
  // or a clearly (15%) larger room, else it fits below the HUD (`top`). A band under 40px is ignored.
  function roomView(width, height, room, insets) {
    var R = roomOf(room) || O, w = +width > 0 ? +width : 1, h = +height > 0 ? +height : 1, M = 8, bot = insets ? h - insets.bottom - M : 0;
    if (!insets || bot - M < 40) {
      var s = Math.max(0.05, Math.min((w - 2 * MX) / R.width, (h - 2 * MY) / R.height));
      return { s: s, ox: Math.round((w - R.width * s) / 2), oy: Math.round((h - R.height * s) / 2) };
    }
    function fit(x0, x1, y0) {
      var k = Math.max(0.05, Math.min((x1 - x0) / R.width, (bot - y0) / R.height));
      return { s: k, ox: Math.round(x0 + (x1 - x0 - R.width * k) / 2), oy: Math.round(y0 + (bot - y0 - R.height * k) / 2) };
    }
    // insets.left keeps a margin clear on the left (the page's vitals box). The room stays centred when that margin is
    // already clear, moves right just enough when it isn't, and only shrinks when it can't fit either way.
    var L = MX + (insets.left || 0), hud = insets.hud;
    function place(y0) { var c = fit(MX, w - MX, y0); return c.ox >= L ? c : L + R.width * c.s <= w - MX ? { s: c.s, ox: L, oy: c.oy } : fit(L, w - MX, y0); }
    var a = place(M);
    if (!hud || a.ox + R.width * a.s <= hud.left - M || a.oy >= hud.bottom + M) return a;
    var x1 = hud.left - M, below = place(Math.max(M, insets.top + M)), ox = Math.round(x1 - R.width * a.s);
    if (ox >= L && (a.ox - ox <= w * 0.06 || a.s > below.s * 1.15)) return { s: a.s, ox: ox, oy: a.oy };
    var left = fit(L, x1, M);
    return left.s > below.s * 1.15 ? left : below;
  }
  function movementSpeed(v) { return typeof v === 'number' && SPEEDS.indexOf(v) >= 0 ? v : 1; }

  // ---- Pixel art ----
  // Quiet palette: the artwork keeps its original colour names, and this table maps them onto warm ivory,
  // graphite, sage and amber. Agent role colours stay as they are so they match the interface swatches.
  var TONE = {
    '#141b33': '#e7e0d2', '#1f2a4a': '#3e3f44', '#2c3b66': '#5c5a55', '#0f1630': '#2b2d33', '#1b1f2b': '#34363c', '#2e3547': '#474a52',
    '#1d2233': '#303238', '#3a4878': '#5d6370', '#2a3658': '#575c66', '#39445c': '#555a63', '#11141c': '#24262b', '#1d2742': '#3a3d44', '#2a3550': '#40434a',
    '#3a4460': '#5a5f66', '#303852': '#50555c', '#4a5a7e': '#6a7078', '#efe4cc': '#efe8da', '#e0d2b4': '#e2d8c4',
    '#b9804a': '#c49a6c', '#a86f3e': '#b38b5f', '#9c653a': '#a88257', '#c89a6a': '#cfae86', '#b88a5c': '#c0a07a',
    '#ddd2ee': '#e3dde8', '#d0c3e6': '#d8d1e0', '#d4ecde': '#dce6dc', '#c6e3d2': '#d0dcd0',
    '#7cc46a': '#a7ba8f', '#76bd64': '#a0b489', '#5fa851': '#8ea078', '#3f8a45': '#71876a', '#4f9f52': '#7f9576', '#2f6d36': '#5f7458', '#e2cf9a': '#e6dac0', '#cdb780': '#d3c5a3', '#4c8f40': '#6d8660',
    '#3f9a4f': '#6f9271', '#58b865': '#88a985', '#2f7a3d': '#5b7a5c', '#6fca70': '#9cbb92', '#8a4f2c': '#9a7253', '#6d3c20': '#7d5a40',
    '#c4572b': '#c08a52', '#8a3516': '#8f6b47', '#a44a2a': '#a77f58', '#b0552e': '#b99472', '#f1e6c8': '#f3ecdc',
    '#4cf08a': '#8fbf8a', '#1f5a36': '#4b5e4d', '#ffe28a': '#ead79a', '#355c8a': '#6d8190', '#1f6d4a': '#5e8068',
    '#f7a86a': '#efcf9c', '#6d7fc4': '#9fb3b0', '#c9d2ea': '#f1ece0', '#e86a6a': '#c98b7a', '#e44': '#c98b7a', '#8b3a3a': '#8f6458', '#a44a4a': '#a87a6c'
  };
  function tone(col) { return has.call(TONE, col) ? TONE[col] : col; }
  function r(c, col, x, y, w, h) { c.fillStyle = tone(col); c.fillRect(Math.round(x), Math.round(y), w, h); }
  var HAIR = ['#2b1b12', '#6b3b1f', '#d9b36a', '#1c1c24', '#a8452a', '#8a8a8a'], SKIN = ['#f1c9a0', '#d9a577', '#a8704a', '#7a4b2f', '#f5d6b8'];
  function hash(a, b) { var h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 100; }
  function floorTile(g, R, x, y, tx, ty) {
    var kind = R.floor, alt = (tx + ty) % 2;
    if (kind === 'wood') { r(g, '#b9804a', x, y, 16, 16); r(g, '#a86f3e', x, y + 7, 16, 1); r(g, '#a86f3e', x, y + 15, 16, 1); r(g, '#9c653a', x + (ty % 2 ? 4 : 12), y, 1, 7); }
    else if (kind === 'tech') { r(g, '#3a4460', x, y, 16, 16); r(g, '#303852', x, y, 16, 1); r(g, '#303852', x, y, 1, 16); if (hash(tx, ty) < 8) r(g, '#4a5a7e', x + 6, y + 6, 4, 4); }
    else if (kind === 'lav') r(g, alt ? '#ddd2ee' : '#d0c3e6', x, y, 16, 16);
    else if (kind === 'mint') r(g, alt ? '#d4ecde' : '#c6e3d2', x, y, 16, 16);
    else if (kind === 'lobby') { r(g, '#efe4cc', x, y, 16, 16); r(g, '#e0d2b4', x, y + 15, 16, 1); r(g, '#e0d2b4', x + 15, y, 1, 16); }
    else if (kind === 'lounge') { r(g, '#c89a6a', x, y, 16, 16); r(g, '#b88a5c', x, y + 7, 16, 1); r(g, '#b88a5c', x + (ty % 2 ? 6 : 13), y, 1, 7); }
    else if (R.path && R.path(tx, ty)) { r(g, '#e2cf9a', x, y, 16, 16); if (hash(tx, ty) < 40) r(g, '#cdb780', x + (hash(ty, tx) % 12), y + (hash(tx + 3, ty) % 12), 3, 2); }
    else {
      var hv = hash(tx, ty); r(g, hv < 50 ? '#7cc46a' : '#76bd64', x, y, 16, 16);
      if (hv < 30) r(g, '#5fa851', x + hv % 13, y + (hv * 7) % 13, 2, 3);
      if (hv > 92) { r(g, ['#f2c230', '#e86a6a', '#f1e6c8'][hv % 3], x + 6, y + 6, 3, 3); r(g, '#4c8f40', x + 7, y + 9, 1, 3); }
    }
  }
  function wallTile(g, R, x, y, tx, ty) {
    if (R.floor === 'grass') { r(g, '#3f8a45', x, y, 16, 16); r(g, '#4f9f52', x + 2, y + 2, 5, 5); r(g, '#2f6d36', x + 9, y + 9, 5, 5); return; }
    r(g, '#1f2a4a', x, y, 16, 16);
    if (ty + 1 < R.rows && !R.wall[(ty + 1) * R.cols + tx]) {
      r(g, '#2c3b66', x, y + 4, 16, 12); r(g, '#f1e6c8', x, y + 14, 16, 2);
      if (ty === 0 && tx % 4 === 2 && tx > 1 && tx < R.cols - 2 && !R.noWindows) {
        r(g, '#0f1630', x + 1, y + 4, 14, 9); r(g, '#f7a86a', x + 2, y + 5, 12, 4); r(g, '#6d7fc4', x + 2, y + 9, 12, 3); r(g, '#c9d2ea', x + 7, y + 4, 1, 9);
      }
    }
  }
  function drawFurn(g, f) {
    var x = f.tx * T, y = f.ty * T, w = f.tw * T, h = f.th * T, i;
    if (f.k === 'plant') { r(g, '#8a4f2c', x + 4, y + 8, 8, 7); r(g, '#6d3c20', x + 4, y + 13, 8, 2); r(g, '#3f9a4f', x + 2, y + 1, 6, 8); r(g, '#58b865', x + 8, y - 2, 6, 10); r(g, '#2f7a3d', x + 5, y + 3, 5, 6); }
    else if (f.k === 'shelf') { r(g, '#5a3a22', x, y - 8, w, 22); r(g, '#3e2716', x + 2, y + 2, w - 4, 1); for (i = 0; i < w / 4 - 1; i++) { r(g, ['#c4572b', '#3b6fb0', '#e8c14a', '#6fd6a6', '#b09ae0'][i % 5], x + 2 + i * 4, y - 6 + (i % 2), 3, 8 - (i % 2)); r(g, ['#f1e6c8', '#c4572b', '#1f2a4a'][i % 3], x + 2 + i * 4, y + 4, 3, 8); } }
    else if (f.k === 'couch') { r(g, '#1f2a4a', x, y, w, 15); r(g, '#355c8a', x + 3, y + 5, w - 6, 8); r(g, '#1f2a4a', x, y, 4, 15); r(g, '#1f2a4a', x + w - 4, y, 4, 15); r(g, '#e8c14a', x + 10, y + 6, 7, 5); r(g, '#c4572b', x + w - 18, y + 6, 7, 5); }
    else if (f.k === 'table') { r(g, '#6e4a2e', x + 1, y + 3, w - 2, 10); r(g, '#8a5e3a', x + 1, y + 3, w - 2, 2); r(g, '#fff', x + 8, y + 5, 4, 4); r(g, '#c4572b', x + 20, y + 6, 5, 3); }
    else if (f.k === 'pong') { r(g, '#1f6d4a', x + 2, y + 2, w - 4, h - 6); r(g, '#f1e6c8', x + 2, y + 2, w - 4, 1); r(g, '#f1e6c8', x + 2, y + h - 5, w - 4, 1); r(g, '#f1e6c8', x + w / 2 - 1, y, 2, h - 3); r(g, '#c4572b', x + 10, y + 12, 5, 2); r(g, '#fff', x + 44, y + 9, 2, 2); }
    else if (f.k === 'fountain') { r(g, '#9aa0ab', x, y + 4, w, h - 6); r(g, '#b8bec8', x + 2, y + 6, w - 4, h - 10); r(g, '#5ab0e0', x + 6, y + 10, w - 12, h - 18); r(g, '#9fd8f5', x + 14, y + 14, 12, 3); r(g, '#9aa0ab', x + w / 2 - 3, y + 8, 6, 14); r(g, '#dff4ff', x + w / 2 - 1, y + 2, 2, 8); }
    else if (f.k === 'tree') { g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(x + 16, y + 28, 15, 4, 0, 0, 7); g.fill(); r(g, '#6d3c20', x + 12, y + 12, 8, 17); r(g, '#4e2a15', x + 12, y + 12, 2, 17); }
  }
  function canopy(c, f) { var x = f.tx * T, y = f.ty * T; r(c, '#2f7a3d', x - 4, y - 12, 40, 28); r(c, '#3f9a4f', x - 1, y - 16, 34, 26); r(c, '#58b865', x + 4, y - 14, 14, 9); r(c, '#6fca70', x + 7, y - 12, 5, 3); }
  function drawStatic(g, R, tier) {
    for (var ty = 0; ty < R.rows; ty++) for (var tx = 0; tx < R.cols; tx++) {
      if (R.wall[ty * R.cols + tx]) wallTile(g, R, tx * T, ty * T, tx, ty); else floorTile(g, R, tx * T, ty * T, tx, ty);
    }
    if (R.decor) R.decor(g, tier || 0);
    R.furn.forEach(function (f) { drawFurn(g, f); });
  }
  function drawDoor(c, d, near) {
    var x = d.tx * T, y = d.ty * T;
    if (d.side === 'top' || d.side === 'bottom') { r(c, '#d9c9a3', x - 2, y, 20, 16); r(c, '#8a3516', x, y + 2, 16, 14); r(c, '#a44a2a', x + 2, y + 4, 12, 10); r(c, '#f2c230', x + 11, y + 9, 2, 2); }
    else { r(c, '#d9c9a3', x, y - 2, 16, 20); r(c, '#8a3516', x + 2, y, 12, 16); r(c, '#a44a2a', x + 4, y + 2, 8, 12); r(c, '#f2c230', x + (d.side === 'left' ? 10 : 4), y + 8, 2, 2); }
    r(c, near ? '#f2c230' : '#c4572b', d.approach.x - 6, d.approach.y + (d.side === 'top' ? -8 : d.side === 'bottom' ? 6 : -1), d.side === 'top' || d.side === 'bottom' ? 12 : 2, 2);
  }
  function seated(c, x, y, uni, trim, seed, f, work) {
    var bob = work && ((f + seed * 3) >> 2) % 2, k = work ? ((f + seed) % 4 < 2 ? 1 : 0) : 0;
    r(c, '#3a2a20', x - 1, y + 12, 16, 3); r(c, uni, x, y + 3, 14, 10); r(c, trim, x, y + 11, 14, 2);
    r(c, uni, x - 1, y - 1, 3, 6); r(c, uni, x + 12, y - 1, 3, 6);
    r(c, SKIN[seed % 5], x + 1, y - 4 - k, 3, 3); r(c, SKIN[seed % 5], x + 9, y - 4 - (work ? 1 - k : 0), 3, 3);
    r(c, SKIN[seed % 5], x + 3, y - 1 - bob, 8, 6); r(c, HAIR[(seed * 7) % 6], x + 3, y - 2 - bob, 8, 4);
  }
  function standing(c, x, y, o) {
    x = Math.round(x); y = Math.round(y);
    c.fillStyle = 'rgba(10,15,30,.32)'; c.beginPath(); c.ellipse(x, y + 1, 7, 3, 0, 0, 7); c.fill();
    var la = o.step === 1 ? -1 : o.step === 3 ? 1 : 0, fc = o.facing;
    r(c, '#2a2f45', x - 4, y - 5 + Math.min(la, 0), 3, 5); r(c, '#2a2f45', x + 1, y - 5 - Math.max(la, 0), 3, 5);
    r(c, o.body, x - 5, y - 14, 10, 10); r(c, o.trim, x - 5, y - 6, 10, 2); if (o.shirt) r(c, o.shirt, x - 1, y - 14, 2, 7);
    r(c, o.body, x - 7, y - 13 + la, 2, 6); r(c, o.body, x + 5, y - 13 - la, 2, 6);
    r(c, o.skin, x - 4, y - 21, 8, 7); r(c, o.hair, x - 4, y - 22, 8, fc === 'up' ? 7 : 3);
    if (fc === 'down') { r(c, '#1b1b24', x - 2, y - 18, 1, 2); r(c, '#1b1b24', x + 1, y - 18, 1, 2); }
    else if (fc === 'left') { r(c, '#1b1b24', x - 3, y - 18, 1, 2); r(c, o.hair, x + 1, y - 21, 3, 4); }
    else if (fc === 'right') { r(c, '#1b1b24', x + 2, y - 18, 1, 2); r(c, o.hair, x - 4, y - 21, 3, 4); }
  }
  // A facility the player has not built yet: a taped-off pad with a sign, inside the station footprint.
  function drawSite(c, s, f, anim) {
    var x = s.tx * T, y = s.ty * T, w = s.tw * T, h = s.th * T, i, sx = x + Math.floor(w / 2) - 5;
    r(c, '#3a2f22', x + 1, y + 1, w - 2, h - 2);
    for (i = 0; i + 4 <= w; i += 6) { r(c, '#e8c14a', x + i, y, 4, 2); r(c, '#e8c14a', x + i, y + h - 2, 4, 2); }
    for (i = 0; i + 4 <= h; i += 6) { r(c, '#e8c14a', x, y + i, 2, 4); r(c, '#e8c14a', x + w - 2, y + i, 2, 4); }
    r(c, '#5a3a22', sx + 4, y + 7, 2, h - 9); r(c, '#f1e6c8', sx, y + 3, 10, 6); r(c, '#c4572b', sx + 2, y + 5, 6, 2);
    if (anim && f % 16 < 8) r(c, '#f2c230', x + w - 6, y + 3, 2, 2);
  }
  // Facility level shown on a station: from the view model, else the facility's starting level.
  function levelOf(V, fac) { return V && V.fac && V.fac[fac] != null ? V.fac[fac] : (fac === 'review' || fac === 'cluster' || fac === 'lab' || fac === 'comms' || fac === 'soc' ? 0 : 1); }
  // Headquarters: a building front, six tiles wide, that rises into the wall band above its footprint as it
  // levels up. Tiers: 1 two-storey block (lit windows = level) · 2 signage and awning · 3 third storey ·
  // 5 parapet and antenna · 7 glass crown · 8 lit crown. Every rect stays on solid tiles (footprint + wall).
  function drawHq(c, s, f, anim, L) {
    var x = s.tx * T, y = s.ty * T, w = s.tw * T, h = s.th * T, top = y - T, i, lit;
    r(c, '#1f2a4a', x, top, w, h + T); // shell over the footprint and the wall band
    r(c, '#2c3b66', x + 2, y + 2, w - 4, h - 4);
    // Ground floor: glass entrance and a reception counter either side.
    r(c, '#0f1630', x + 38, y + 14, 20, h - 14); r(c, '#6d7fc4', x + 47, y + 15, 2, h - 16); r(c, '#f1e6c8', x + 38, y + 14, 20, 1);
    r(c, '#f1e6c8', x + 4, y + 22, 30, 8); r(c, '#e0d2b4', x + 4, y + 22, 30, 2); r(c, '#f1e6c8', x + 62, y + 22, 30, 8); r(c, '#e0d2b4', x + 62, y + 22, 30, 2);
    r(c, '#cfd4de', x + 10, y + 25, 8, 2); r(c, '#cfd4de', x + 70, y + 25, 8, 2);
    // First floor: eight windows, one lit per Headquarters level.
    for (i = 0; i < 8; i++) { lit = i < L; r(c, lit ? (anim && (f + i * 5) % 40 === 0 ? '#fff3c8' : '#ffe28a') : '#0f1630', x + 4 + i * 12, y + 4, 8, 7); r(c, '#1f2a4a', x + 7 + i * 12, y + 4, 1, 7); }
    if (L >= 2) { r(c, '#c4572b', x + 32, y + 12, 32, 2); r(c, '#f1e6c8', x + 34, top + 10, 28, 5); r(c, '#1f2a4a', x + 40, top + 11, 3, 3); r(c, '#1f2a4a', x + 44, top + 11, 3, 3); r(c, '#1f2a4a', x + 49, top + 11, 7, 1); r(c, '#1f2a4a', x + 49, top + 13, 7, 1); } // awning and nameplate
    else r(c, '#f1e6c8', x + 2, y - 1, w - 4, 2); // flat roof edge
    if (L >= 3) { // third storey in the wall band, windows lit from level 3
      r(c, L >= 7 ? '#355c8a' : '#2c3b66', x + 2, top + 2, w - 4, 7);
      for (i = 0; i < 8; i++) { lit = i < L - 2; r(c, lit ? '#ffe28a' : '#0f1630', x + 4 + i * 12, top + 3, 8, 5); }
    }
    if (L >= 5) { r(c, '#e8c14a', x, top, w, 2); r(c, '#9aa9ab', x + w / 2 - 1, top, 2, 4); r(c, anim && f % 16 < 8 ? '#e86a6a' : '#8b3a3a', x + w / 2 - 1, top, 2, 1); } // parapet and antenna
    if (L >= 7) { r(c, '#c9d2ea', x + 2, top + 2, w - 4, 1); }
    if (L >= 8) for (i = 0; i < 6; i++) r(c, anim && (f + i) % 6 < 3 ? '#ffe28a' : '#e8c14a', x + 8 + i * 16, top + 1, 4, 1); // lit crown
  }
  function drawStation(c, s, S, f, anim, V) {
    var x = s.tx * T, y = s.ty * T, w = s.tw * T, h = s.th * T, R = ROLE[s.id], i, fac = STATION_FACILITY[s.id], L = fac ? levelOf(V, fac) : 0;
    if (V && V.fac && fac && V.fac[fac] === 0) { drawSite(c, s, f, anim); return; }
    if (s.id === 'hq') { drawHq(c, s, f, anim, L); return; }
    if (s.id === 'forge') {
      // Agent Forge: spin-up bays under a control strip whose lamps count its level (1–6).
      r(c, '#1b1f2b', x + 1, y + 1, w - 2, 14); r(c, '#2e3547', x + 2, y + 2, w - 4, 5);
      for (i = 0; i < 6; i++) r(c, i < L ? '#4cf08a' : '#1d2742', x + 4 + i * 4, y + 3, 2, 2);
      r(c, '#0f1630', x + 4, y + 9, 10, 5); r(c, anim && f % 12 < 6 ? '#b09ae0' : '#6fd6a6', x + 6, y + 10, 6, 3);
      r(c, '#0f1630', x + 18, y + 9, 10, 5); r(c, L >= 2 ? '#f2c230' : '#6a4a20', x + 20, y + 10 + (anim && L >= 2 ? f % 3 : 0), 6, 1);
      return;
    }
    if (s.id === 'rig') {
      // GPU Rig: three rack cabinets in a row; one lights up per level (1–3). Dark cabinets wait for the next level.
      for (i = 0; i < 3; i++) {
        var cx = x + 1 + i * 16, on = i < L;
        r(c, on ? '#1b1f2b' : '#2a2f3a', cx, y + 1, 14, 14); r(c, on ? '#2e3547' : '#303540', cx + 1, y + 2, 12, 12);
        for (var j = 0; j < 3; j++) { r(c, '#11141c', cx + 2, y + 3 + j * 4, 10, 3); if (on) { r(c, !anim || (f + j * 3 + i * 5) % 7 < 4 ? '#4cf08a' : '#1f5a36', cx + 3, y + 4 + j * 4, 2, 1); r(c, anim && (f + j + i) % 5 < 2 ? '#ffb347' : '#6a4a20', cx + 6, y + 4 + j * 4, 2, 1); } }
      }
      return;
    }
    if (s.id === 'hunt') {
      r(c, '#c4572b', s.approach.x - 5, s.approach.y - 4, 10, 9); r(c, '#8a3516', s.approach.x - 5, s.approach.y + 3, 10, 2);
      r(c, '#5a3a22', x, y + 3, w, 12); r(c, '#8a5e3a', x, y + 3, w, 2);
      r(c, '#1d2233', x + 5, y - 7, 16, 11); r(c, '#fff3c8', x + 6, y - 6, 14, 8); r(c, '#1d2233', x + 27, y - 7, 16, 11); r(c, '#ffb07a', x + 28, y - 6, 14, 8);
      if (anim) r(c, '#1f2a4a', x + 7 + (f % 10), y - 4, 3, 1);
      r(c, '#cfd4de', x + 16, y + 7, 16, 3); r(c, '#f1e6c8', x + 36, y + 7, 7, 5);
    } else if (s.id === 'contract') {
      // Ops Center: a planning board inside its footprint; pinned contracts count its level (1–5), a squad lamp blinks.
      r(c, '#1f2a4a', x, y + 1, w, h - 1); r(c, '#c89a5a', x + 2, y + 3, w - 4, h - 5);
      for (i = 0; i < 5; i++) { var pinned = i < L; r(c, pinned ? (i % 2 ? '#f1e6c8' : '#fff') : '#b88a5c', x + 4 + i * 9, y + 5, 7, 8); if (pinned) r(c, '#c4572b', x + 7 + i * 9, y + 4, 2, 2); }
      r(c, anim && f % 10 < 5 ? '#4cf08a' : '#1f5a36', x + w - 5, y + h - 4, 3, 2);
    } else if (s.id === 'stats') {
      // Ledger Vault: a safe. The door and dial fill the upper half; the fill gauge sits in the lower cabinet
      // (vaultGauge). Level 4 adds a beacon, level 7 a gold trim.
      r(c, '#1b1f2b', x + 1, y + 1, w - 2, h - 2); r(c, '#39445c', x + 2, y + 2, w - 4, 13);
      r(c, '#f1e6c8', x + 6, y + 5, 4, 4); r(c, '#1b1f2b', x + 7, y + 6, 2, 2); r(c, '#9aa9ab', x + 11, y + 4, 2, 6); // dial and handle
      if (L >= 4) r(c, anim && f % 12 < 6 ? '#ffb347' : '#6a4a20', x + 3, y + 3, 2, 2);
      if (L >= 7) { r(c, '#e8c14a', x + 2, y + 2, w - 4, 1); r(c, '#e8c14a', x + 2, y + 14, w - 4, 1); }
      r(c, anim && f % 8 < 4 ? '#4cf08a' : '#1f5a36', x + 6, y + h - 3, 4, 1);
    } else if (R) {
      r(c, '#39445c', x + 5, y + 5, 6, 10); r(c, '#1b1f2b', x + 1, y - 6, 14, 12);
      r(c, R.glow || '#4cf08a', x + 3, y - 4, 10, 7); r(c, R.uni || '#5b6b8a', x + 1, y + 13, 14, 3);
      if (anim && f % 10 < 5) r(c, '#fff', x + 4, y - 3, 2, 1);
    } else if (s.id === 'coffee') {
      r(c, '#8b3a3a', x, y + 2, w, 13); r(c, '#a44a4a', x, y + 2, w, 2); r(c, '#2c2f3a', x + 4, y - 9, 13, 15); r(c, '#4a4f60', x + 6, y - 7, 9, 4); r(c, '#e44', x + 13, y - 6, 2, 2);
      r(c, '#fff', x + 8, y + 1, 5, 4); r(c, '#f1e6c8', x + 21, y + 3, 4, 5); r(c, '#f1e6c8', x + 26, y + 3, 4, 5);
      if (anim) { var k = f % 12; r(c, 'rgba(255,255,255,.6)', x + 10 + (k > 5 ? 1 : 0), y - 3 - (k >> 2), 1, 2); }
    } else if (s.id === 'training') {
      r(c, '#6e4a2e', x, y + 4, w, 8); r(c, '#8a5e3a', x, y + 4, w, 2); r(c, '#3e2716', x + 3, y + 12, 3, 4); r(c, '#3e2716', x + w - 6, y + 12, 3, 4);
      r(c, '#1f2a4a', x + 6, y - 4, 14, 9); r(c, anim && f % 16 < 8 ? '#ffb07a' : '#e8c14a', x + 7, y - 3, 12, 6); r(c, '#cfd4de', x + 5, y + 5, 16, 2);
      r(c, '#5a5f6e', x + 28, y + 5, 12, 2); r(c, '#2c2f3a', x + 27, y + 3, 3, 6); r(c, '#2c2f3a', x + 38, y + 3, 3, 6);
    } else if (s.id === 'mentor') {
      standing(c, x + 8, y + 12, { body: '#1f2a4a', trim: '#f1e6c8', shirt: '#c4572b', skin: SKIN[2], hair: '#d8d8d8', facing: 'down', step: 0 });
      if (!anim || f % 16 < 11) { r(c, '#fff', x + 11, y - 22, 9, 10); r(c, '#c4572b', x + 15, y - 20, 2, 4); r(c, '#c4572b', x + 15, y - 15, 2, 2); }
    } else if (s.id === 'journal') {
      r(c, '#5a3a22', x + 3, y + 2, 3, 14); r(c, '#5a3a22', x + w - 6, y + 2, 3, 14); r(c, '#1f2a4a', x, y - 10, w, 16); r(c, '#f1e6c8', x + 2, y - 8, w - 4, 12);
      for (i = 0; i < 3; i++) r(c, '#8a8a8a', x + 5, y - 6 + i * 3, w - 10 - i * 6, 1);
      r(c, '#c4572b', x + w - 8, y - 7, 4, 4);
    } else if (s.id === 'roster') {
      // Agent Roster: low dispatch desk with one status light per Agent Floor pod. Stays inside its 4x1 footprint.
      var crew = floorAgents(V);
      r(c, '#1b1f2b', x + 1, y, w - 2, 10); r(c, '#0f1630', x + 3, y + 1, w - 6, 7); // screen bezel + glass
      for (i = 0; i < 12; i++) {
        var a = crew[i], col = a ? agentColor(a.role) : null;
        r(c, !col ? '#1d2742' : (anim && a.busy && (f + i) % 8 < 2) ? '#ffffff' : col.glow, x + 5 + i * 4 + (i >= 6 ? 4 : 0), y + 3, 3, 3);
      }
      r(c, '#2e3547', x, y + 10, w, 6); r(c, '#3a4878', x, y + 10, w, 1); // desk
      r(c, '#cfd4de', x + 22, y + 12, 20, 2); // keyboard
      r(c, anim && f % 8 < 4 ? '#4cf08a' : '#1f5a36', x + w - 7, y + 12, 4, 2); // status lamp
    } else if (s.id === 'defense') {
      // Security Ops Center console: three monitors (status, radar, alerts) on a command desk. Stays inside its 4x2 footprint.
      r(c, '#2e3547', x, y + 18, w, 14); r(c, '#3a4878', x, y + 18, w, 2); r(c, '#1b1f2b', x, y + h - 2, w, 2); // desk
      r(c, '#1b1f2b', x + 2, y + 2, 18, 14); r(c, '#0f1630', x + 3, y + 3, 16, 12); // left: status bars
      for (i = 0; i < 4; i++) r(c, ['#4cf08a', '#7cc4f0', '#f2c230', '#4cf08a'][i], x + 5 + i * 4, y + 13 - (3 + (i * 5 + (anim ? f : 0)) % 8), 2, 3 + (i * 5 + (anim ? f : 0)) % 8);
      r(c, '#1b1f2b', x + 22, y, 20, 17); r(c, '#0b2a1f', x + 23, y + 1, 18, 15); // centre: radar
      r(c, '#1f5a36', x + 23, y + 8, 18, 1); r(c, '#1f5a36', x + 32, y + 1, 1, 15); r(c, '#2f7a4f', x + 28, y + 5, 9, 7);
      var sweep = anim ? f % 8 : 2; r(c, '#4cf08a', x + 32 + [0, 3, 6, 3, 0, -3, -6, -3][sweep], y + 8 + [-6, -4, 0, 4, 6, 4, 0, -4][sweep], 2, 2);
      r(c, '#1b1f2b', x + 44, y + 2, 18, 14); r(c, '#0f1630', x + 45, y + 3, 16, 12); // right: alert feed
      for (i = 0; i < 3; i++) r(c, i === 0 && anim && f % 10 < 5 ? '#e86a6a' : '#9aa9ab', x + 47, y + 5 + i * 4, 12 - i * 3, 2);
      r(c, '#cfd4de', x + 24, y + 22, 16, 3); r(c, anim && f % 6 < 3 ? '#7cc4f0' : '#2f6da0', x + 6, y + 23, 6, 2); // keyboard + lamp
    }
  }
  function drawStaff(c, Rm, S, V, f, work, anim) {
    var R = ROLE[Rm.role];
    var headcount = S[Rm.role], racks = S.compute;
    if (V) {
      if (Rm.role === 'engineers' && V.engineers != null) headcount = V.engineers;
      if (V.racks && V.racks.cluster != null) racks = V.racks.cluster; else if (V.fac && V.fac.cluster != null) racks = V.fac.cluster;
    }
    if (R) Rm.desks.forEach(function (d) { // staff desks only in role rooms; the SOC draws its own sentinel desks
      var px = d.tx * T, py = d.ty * T, occ = d.i < Math.min(headcount, CAP);
      r(c, '#6e4a2e', px + 1, py + 5, 30, 10); r(c, '#8a5e3a', px + 1, py + 5, 30, 2); r(c, '#4a3020', px + 1, py + 14, 30, 2);
      r(c, '#1d2233', px + 9, py - 3, 14, 9); r(c, '#111', px + 15, py + 6, 2, 2);
      r(c, occ ? (work && (f + d.i * 5) % 6 >= 4 ? '#2a3550' : R.glow) : '#2a3550', px + 10, py - 2, 12, 7);
      if (occ && work) r(c, '#eaf2ff', px + 11 + ((f + d.i) % 9), py, 2, 1);
      r(c, '#cfd4de', px + 10, py + 9, 12, 3);
      if (occ) seated(c, px + 9, py + 16, R.uni, R.trim, d.i + R.seed, f, work); else r(c, '#3a2a20', px + 8, py + 22, 16, 6);
    });
    Rm.racks.forEach(function (k, i) {
      var x = k.tx * T + 3, y = k.ty * T + 2;
      if (i >= Math.min(racks, GPU_CAP)) { r(c, '#5a4a3a', x, y + 34, 26, 8); r(c, '#f2c230', x + 2, y + 36, 22, 2); return; }
      r(c, '#1b1f2b', x, y, 26, 44); r(c, '#2e3547', x + 2, y + 2, 22, 40);
      for (var j = 0; j < 5; j++) {
        r(c, '#11141c', x + 3, y + 4 + j * 8, 20, 6);
        r(c, !anim || (f + j * 3 + i * 5) % 7 < 4 ? '#4cf08a' : '#1f5a36', x + 5, y + 6 + j * 8, 2, 2);
        r(c, anim && work && (f + j + i) % 5 < 2 ? '#ffb347' : '#6a4a20', x + 9, y + 6 + j * 8, 2, 2);
      }
    });
  }
  // Title candidates from most to least detailed; the renderer picks the first that fits.
  function titles(R, S, V) {
    var n = R.role ? S[R.role] : 0, s = R.name;
    if (V) {
      var lv = function (k) { return V.fac && V.fac[k] != null ? V.fac[k] : 0; }, crew = (V.agents || []).length, eng = V.engineers != null ? V.engineers : S.engineers;
      var plural = function (k, word) { return k + ' ' + word + (k === 1 ? '' : 's'); };
      var extra = R.id === 'office' ? 'HQ ' + (V.hq || 1) + (crew ? ' · ' + plural(crew, 'agent') : '') :
        R.id === 'agents' ? plural(Math.max(0, crew - MINI_SEATS), 'agent') + ' on the floor' :
        R.id === 'engineering' ? (lv('review') ? 'level ' + lv('review') + ' · ' + plural(eng, 'engineer') : 'build site') :
        R.id === 'compute' ? (lv('cluster') ? 'level ' + lv('cluster') + ' · ' + S.compute + ' compute' : 'build site') :
        R.id === 'research' ? (lv('lab') ? 'level ' + lv('lab') + ' · harness ×' + S.harness.toFixed(1) : 'build site') :
        R.id === 'marketing' ? (lv('comms') ? 'level ' + lv('comms') : 'build site') :
        R.id === 'soc' ? (lv('soc') ? 'level ' + lv('soc') : 'build site') : '';
      return extra ? [s + ' · ' + extra, s] : [s];
    }
    if (!R.role) return [s];
    var brief = s + ' · ' + n + (R.role === 'compute' ? ' GPU' : ' ' + ROLE[R.role].noun);
    if (R.role === 'compute') return [s + ' · ' + n + ' GPU · harness ' + S.harness.toFixed(2) + (n > GPU_CAP ? '  +' + (n - GPU_CAP) + ' remote' : ''), brief, s];
    return [brief + (n > CAP ? '  +' + (n - CAP) + ' off-floor' : ''), brief, s];
  }

  // ---- Optional view-model visuals (drawn in the dynamic layer; cosmetic only) ----
  function podBot(c, x, y, role, busy, f, anim) {
    var col = agentColor(role);
    r(c, col.trim, x + 15, y, 2, 4); r(c, col.glow, x + 15, y - 1, 2, 2); // antenna
    r(c, '#d7dce6', x + 11, y + 4, 10, 9); r(c, col.body, x + 11, y + 4, 10, 2); // head
    r(c, (anim && busy && f % 6 < 3) ? '#fff' : col.glow, x + 13, y + 7, 6, 3); // visor
    r(c, col.body, x + 9, y + 12, 14, 11); r(c, col.trim, x + 9, y + 20, 14, 2); // torso
    r(c, col.body, x + 6, y + 13, 3, 6); r(c, col.body, x + 23, y + 13, 3, 6); // arms
  }
  function drawPod(c, k, agents, f, work, anim) {
    var x = k.tx * T, y = k.ty * T, occ = k.i < agents.length, a = occ ? agents[k.i] : null;
    r(c, '#171b26', x + 1, y + 1, 30, 30); r(c, '#1b1f2b', x + 2, y + 2, 28, 12); // pod shell + console
    if (occ) {
      var col = agentColor(a.role);
      r(c, (anim && work && a.busy && (f + k.i) % 6 < 3) ? '#eaf2ff' : col.glow, x + 4, y + 4, 24, 7); // screen
      podBot(c, x, y + 1, a.role, a.busy, f + k.i * 2, anim);
      if (a.busy) r(c, (anim && f % 8 < 4) ? col.glow : col.trim, x + 25, y + 15, 4, 4); // busy lamp
    } else { r(c, '#10131c', x + 4, y + 4, 24, 7); r(c, '#2c3550', x + 12, y + 17, 8, 9); } // dark screen + empty seat
  }
  // The first MINI_SEATS agents sit at the office terminals; the Agent Floor pods hold the next ones.
  var MINI_SEATS = 6;
  function floorAgents(V) { return ((V && V.agents) || []).slice(MINI_SEATS); }
  function drawPods(c, Rm, V, f, work, anim) {
    var agents = floorAgents(V);
    Rm.pods.forEach(function (k) { drawPod(c, k, agents, f, work, anim); });
  }
  function drawMinis(c, Rm, V, f, work, anim) {
    var agents = ((V && V.agents) || []).slice(0, MINI_SEATS);
    Rm.minis.forEach(function (k) {
      var x = k.tx * T, y = k.ty * T, a = agents[k.i];
      r(c, '#171b26', x, y, 16, 16); r(c, '#1b1f2b', x + 1, y + 1, 14, 6);
      if (!a) { r(c, '#10131c', x + 2, y + 2, 12, 4); r(c, '#2c3550', x + 5, y + 9, 6, 6); return; }
      var col = agentColor(a.role), blink = anim && a.busy && (f + k.i) % 6 < 3;
      r(c, work && blink ? '#eaf2ff' : col.glow, x + 2, y + 2, 12, 4); // screen
      r(c, '#d7dce6', x + 5, y + 8, 6, 4); r(c, col.body, x + 5, y + 8, 6, 1); r(c, blink ? '#fff' : col.glow, x + 6, y + 10, 4, 1); // head + visor
      r(c, col.body, x + 4, y + 12, 8, 4); r(c, col.trim, x + 4, y + 15, 8, 1); // body
    });
  }
  // Ledger Vault gauge built into the lower cabinet of the Ops Monitor (inside its 1x2 footprint).
  function vaultGauge(c, st, ratio, f, anim) {
    var x = st.tx * T, y = st.ty * T, fh = Math.round(10 * clamp01(ratio));
    r(c, '#0f1630', x + 3, y + 17, 10, 12); r(c, '#1b2742', x + 4, y + 18, 8, 10); // frame + empty tank
    if (fh) { r(c, ratio >= 0.999 ? '#c8563f' : '#c4572b', x + 4, y + 28 - fh, 8, fh); r(c, '#e8a05a', x + 4, y + 28 - fh, 8, 1); } // fluid + surface
    if (anim && fh > 4) r(c, '#ffd9a8', x + 5 + (f % 3) * 2, y + 27 - ((f >> 1) % (fh - 1)), 1, 1); // bubble
    r(c, '#9aa9ab', x + 3, y + 22, 1, 1); r(c, '#9aa9ab', x + 12, y + 22, 1, 1); // half-full ticks
  }
  // Level plate: one segment per possible level along the station's own top edge (two rows on narrow
  // stations). Filled = reached, hollow = still open under this Headquarters, dim = needs a higher
  // Headquarters. Every segment turns gold at the maximum, so a finished facility reads at a glance.
  function levelPlate(c, st, level, max, cap, color) {
    var w = st.tw * T, seg = w >= 32 ? 2 : 1, pitch = seg + 1, per = Math.max(1, Math.floor((w - 1) / pitch)), n = Math.max(1, Math.min(per * 2, Math.floor(max)));
    level = Math.max(0, Math.min(n, Math.floor(level))); cap = Math.max(0, Math.min(n, Math.floor(cap)));
    var done = level >= max;
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / per), inRow = Math.min(per, n - row * per), x0 = st.tx * T + Math.floor((w - (inRow * pitch - 1)) / 2), y0 = st.ty * T + 1 + row * 4;
      r(c, done ? '#e2b93c' : i < level ? color : i < cap ? '#3a4460' : '#11141c', x0 + (i % per) * pitch, y0, seg, 3);
    }
  }
  // A real bottleneck: a translucent red or amber wash and outline over the station and a blinking lamp in its
  // corner. Drawn after the night overlay (like the lamp glows) in untoned colours, so it reads at night.
  function flagWash(c, st, level, f, anim) {
    var x = st.tx * T, y = st.ty * T, w = st.tw * T, h = st.th * T, lamp = LAMP[level] || LAMP.amber;
    c.fillStyle = WASH[level] || WASH.amber; c.fillRect(x, y, w, h);
    c.strokeStyle = lamp; c.globalAlpha = 0.7; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); c.globalAlpha = 1;
    if (!anim || f % 12 < 7) { c.fillStyle = '#08131a'; c.fillRect(x + w - 6, y + h - 6, 5, 5); c.fillStyle = lamp; c.fillRect(x + w - 5, y + h - 5, 3, 3); }
  }
  function drawFlags(c, items, V, f, anim) {
    if (!V || !V.flags) return;
    items.forEach(function (s) { var fac = !s.kind && STATION_FACILITY[s.id]; if (fac && V.flags[fac]) flagWash(c, s, V.flags[fac], f, anim); });
  }
  // Scaffolding stays inside the station; the countdown and progress bar sit above it.
  function drawConstruction(c, st, frac, f, anim) {
    var x = st.tx * T, y = st.ty * T, w = st.tw * T, h = st.th * T;
    r(c, '#d9a441', x, y, 2, h); r(c, '#d9a441', x + w - 2, y, 2, h); // poles
    r(c, '#d9a441', x, y + 6, w, 2); if (h > 16) r(c, '#b5842a', x, y + Math.round(h / 2) + 2, w, 2); // rails
    for (var i = 0; i + 6 <= w; i += 8) r(c, (i / 8) % 2 ? '#1f2a4a' : '#e8c14a', x + i, y + h - 3, 6, 3); // hazard base
    if (anim && f % 8 < 4) r(c, '#fff3c8', x + 2 + (f % Math.max(1, w - 6)), y + 9, 2, 2); // welding spark
  }
  // SOC video-wall banks and sentinel desks, each drawn inside its own solid footprint.
  function drawSoc(c, Rm, V, f, anim) {
    var i, j;
    (Rm.displays || []).forEach(function (d, k) {
      var x = d.tx * T, y = d.ty * T, w = d.tw * T, h = d.th * T;
      r(c, '#0c1020', x, y, w, h); r(c, '#13213f', x + 2, y + 2, w - 4, h - 7); r(c, '#2e3547', x, y + h - 4, w, 4); // bezel, glass, base
      for (i = 16; i < w - 4; i += 16) r(c, '#1d3156', x + i, y + 2, 1, h - 7);
      for (j = 10; j < h - 5; j += 10) r(c, '#1d3156', x + 2, y + j, w - 4, 1);
      for (i = 0; i < 4; i++) {
        var bx = x + 5 + ((i * 37 + k * 11 + (anim ? f * 2 : 0)) % (w - 12)), by = y + 5 + (i * 7 + k * 5) % (h - 13);
        r(c, (i === 0 && anim && (f + k) % 10 < 5) ? '#e86a6a' : '#4cf08a', bx, by, 3, 3);
      }
    });
    var sentinels = ((V && V.agents) || []).filter(function (a) { return a.role === 'sentinel'; });
    (Rm.desks || []).forEach(function (d, n) {
      var px = d.tx * T, py = d.ty * T, on = n < sentinels.length;
      r(c, '#1b1f2b', px + 1, py + 1, 2 * T - 2, 12); r(c, on ? AGENT.sentinel.glow : '#10131c', px + 3, py + 3, 2 * T - 6, 6); // console
      if (on) podBot(c, px, py + 7, 'sentinel', sentinels[n].busy, f + n * 3, anim); else r(c, '#2c3550', px + 12, py + 18, 8, 9);
      r(c, '#2e3547', px + 1, py + 28, 2 * T - 2, 3); // desk edge
    });
  }
  function decorateFacilities(c, R, V, items, f, anim) {
    var present = {}; items.forEach(function (s) { if (!s.kind) present[s.id] = s; });
    if (V.vault != null && present.stats) vaultGauge(c, present.stats, V.vault, f, anim);
    var fac, sid, st;
    if (V.construction) for (fac in V.construction) {
      if (V.construction[fac] == null) continue;
      sid = FAC_STATION[fac]; st = sid && present[sid];
      if (st) drawConstruction(c, st, V.construction[fac], f, anim);
    }
    if (V.fac) for (sid in present) {
      fac = STATION_FACILITY[sid];
      if (!fac || V.fac[fac] == null || (V.construction && V.construction[fac] != null)) continue;
      var max = FAC_MAX[fac] || 1, cap = V.caps && V.caps[fac] != null ? V.caps[fac] : max;
      if (V.fac[fac] >= 1) levelPlate(c, present[sid], V.fac[fac], max, cap, FAC_COLOR[fac] || '#f1e6c8');
    }
  }
  // Level chip text and style for a facility station: "2/6" (dark: upgradable here), "2/6 · HQ 3" (grey:
  // waiting on Headquarters 3), gold at the maximum, "Build" for a site; a flag turns the chip red or amber.
  function chipFor(sid, V) {
    var fac = STATION_FACILITY[sid];
    if (!fac || !V || !V.fac || V.fac[fac] == null) return null;
    var lv = V.fac[fac], max = FAC_MAX[fac] || 1, flag = V.flags && V.flags[fac];
    if (lv < 1) return { text: 'Build', style: flag || 'dark' };
    var blocked = V.blocked && V.blocked[fac];
    return { text: lv + '/' + max + (!flag && lv < max && blocked ? ' · HQ ' + blocked : ''), style: flag ? flag : lv >= max ? 'gold' : blocked ? 'grey' : 'dark' };
  }
  // Sanitise the optional cosmetic view model. Returns null when absent so legacy callers are untouched.
  function sanitizeView(view) {
    if (!view || typeof view !== 'object') return null;
    var V = {}, k, i;
    V.hq = view.hq != null ? clampInt(view.hq, 1, 8) : null;
    if (view.facilities && typeof view.facilities === 'object') { V.fac = {}; for (k in view.facilities) if (view.facilities[k] != null) V.fac[k] = clampInt(view.facilities[k], 0, 20); }
    if (view.caps && typeof view.caps === 'object') { V.caps = {}; for (k in view.caps) if (view.caps[k] != null) V.caps[k] = clampInt(view.caps[k], 0, 20); }
    if (view.blocked && typeof view.blocked === 'object') { V.blocked = {}; for (k in view.blocked) if (view.blocked[k] != null) V.blocked[k] = clampInt(view.blocked[k], 1, 8); }
    if (view.flags && typeof view.flags === 'object') { V.flags = {}; for (k in view.flags) if (view.flags[k] === 'red' || view.flags[k] === 'amber') V.flags[k] = view.flags[k]; }
    V.vault = view.vault != null ? clamp01(view.vault) : null;
    if (view.construction && typeof view.construction === 'object') { V.construction = {}; for (k in view.construction) if (view.construction[k] != null) V.construction[k] = clamp01(view.construction[k]); }
    if (Array.isArray(view.agents)) { V.agents = []; for (i = 0; i < view.agents.length && V.agents.length < 60; i++) { var a = view.agents[i]; if (a && typeof a.role === 'string' && has.call(AGENT, a.role)) V.agents.push({ role: a.role, busy: !!a.busy }); } }
    V.timers = [];
    if (Array.isArray(view.timers)) view.timers.forEach(function (job) {
      if (!job || typeof job.station !== 'string' || typeof job.remaining !== 'string') return;
      V.timers.push({ station: job.station, caption: String(job.caption || ''), remaining: job.remaining, progress: clamp01(job.progress) });
    });
    V.engineers = view.engineers != null ? clampInt(view.engineers, 0, 99) : null;
    if (view.racks && typeof view.racks === 'object') V.racks = { cluster: view.racks.cluster != null ? clampInt(view.racks.cluster, 0, 99) : null };
    // Dormant (not yet earned) stations are absent: not drawn, not solid, not listed (progressive disclosure).
    if (Array.isArray(view.dormant)) { V.hidden = {}; view.dormant.forEach(function (id) { if (typeof id === 'string') V.hidden[id] = true; }); }
    return V;
  }

  // ---- Runtime ----
  function create(canvas, onInteract, onContext) {
    var c = canvas.getContext('2d'), bgs = {};
    canvas.style.imageRendering = 'pixelated'; canvas.tabIndex = 0;
    if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'application');
    var cur = O, P = { x: SPAWN.x, y: SPAWN.y, facing: SPAWN.facing }, keys = {}, touch = {}, route = [], routeFace = null;
    var S = null, V = null, blocked = true, frozen = false, t = 0, walk = 0, moving = false, pulseT = 0, boostUntil = 0, last = 0, raf = 0, alive = true, eHeld = false, arrive = null;
    // Distance the player actually walked (keys, touch pad, or a route they clicked or tapped). Guided
    // walks started by the app do not count, and pressing into a wall moves nothing.
    var walkedByPlayer = 0, ownRoute = false, founders = {}, founderRoom = '';
    function assignFounder(id,station){
      if(!['founder','helper-1','helper-2'].includes(id))return;
      var actor=founders[id];if(!actor)actor=founders[id]={id:id,x:P.x,y:P.y,facing:'down',station:null,path:[],walk:0};
      if(actor.station===station&&actor.room===cur.id)return;
      if(id==='founder'){actor.x=P.x;actor.y=P.y;}actor.station=station;actor.room=cur.id;var dest=here().find(function(x){return x.id===station;})||here().find(function(x){return x.kind==='door';});
      actor.path=dest?findPath(actor.x,actor.y,dest.approach.x,dest.approach.y,cur.id,hid()):[];
    }
    function stepFounders(dt){
      if(!S||!S.started||S.paused||frozen||document.hidden)return;
      Object.keys(founders).forEach(function(id){var actor=founders[id];if(actor.room!==cur.id){actor.x=P.x;actor.y=P.y;assignFounder(id,actor.station);}
        if(id==='founder'&&!blocked&&(route.length||Object.keys(keys).some(function(k){return keys[k];})||Object.keys(touch).some(function(k){return touch[k];}))){actor.x=P.x;actor.y=P.y;actor.path=[];return;}
        var travelling=actor.path.length>0,budget=BASE*dt;while(budget>0&&actor.path.length){var wp=actor.path[0],dx=wp.x-actor.x,dy=wp.y-actor.y,n=Math.hypot(dx,dy);if(n<.1){actor.path.shift();continue;}var d=Math.min(budget,n);actor.x+=dx/n*d;actor.y+=dy/n*d;actor.facing=Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');actor.walk+=d;budget-=d;}
        if(id==='founder'){if(travelling){P.x=actor.x;P.y=actor.y;P.facing=actor.facing;}else{actor.x=P.x;actor.y=P.y;}}
      });
    }
    // Canvas labels use the page's mono face (--mono) once it has loaded, so every browser draws the same letters;
    // until then, and in harnesses without document.fonts, plain monospace. Labels are redrawn every frame.
    var labelFace = 'monospace', D = 1; // D: device pixels per CSS pixel of the canvas backing store
    try {
      if (document.fonts && document.fonts.ready && window.getComputedStyle) document.fonts.ready.then(function () {
        var m = String(getComputedStyle(document.documentElement).getPropertyValue('--mono') || '').trim();
        if (m) return document.fonts.load('bold 16px ' + m).then(function () { labelFace = m; });
      }).catch(function () {});
    } catch (_) {}
    var view = { s: 1, ox: 0, oy: 0 }, ctxKey = '', ctxPos = '', ctxT = 0, aria = '', nearId = null, touchUI = false, insets = null;
    // The room's view on this canvas: the free band the app measured (CSS px) in canvas px, else the whole canvas.
    // Drawing, taps and guide anchors all use it.
    // Camera: cam.k eases 0 → 1 between the whole room (fit) and following the founder at cam.zoom× the fit scale,
    // with the founder held at the centre of the free band. Everything that reads fitView (drawing, taps, anchors,
    // roomRect and the page's layers on it) follows.
    var cam = { follow: false, zoom: 1.75, k: 0 };
    function fitView(R) {
      var rc = canvas.getBoundingClientRect(), cw = canvas.width / D, ch = canvas.height / D, k = rc.width ? cw / rc.width : 1, i = insets;
      var v = roomView(cw, ch, R.id, i && { top: i.top * k, bottom: i.bottom * k, left: i.left * k, hud: i.hud && { left: i.hud.left * k, bottom: i.hud.bottom * k } });
      if (cam.k > 0) {
        var e = cam.k < 1 ? cam.k * cam.k * (3 - 2 * cam.k) : 1, cx = cw / 2, cy = i ? (i.top * k + ch - i.bottom * k) / 2 : ch / 2;
        var fx0 = (cx - v.ox) / v.s, fy0 = (cy - v.oy) / v.s, fx = fx0 + (P.x - fx0) * e, fy = fy0 + (P.y - 10 - fy0) * e;
        var sv = v.s * Math.pow(cam.zoom, e) * D, sn = Math.floor(sv);
        if (e === 1 && sn >= 1 && sn / sv >= 0.9) sv = sn; // whole device pixels per art pixel once settled
        return { s: sv, ox: Math.round(cx * D - fx * sv), oy: Math.round(cy * D - fy * sv) };
      }
      if (D === 1) return v;
      // On dense screens the art gets whole device pixels per art pixel when that costs under 10% of its size.
      var sv = v.s * D, ox = v.ox * D, oy = v.oy * D, sn = Math.floor(sv);
      if (sn >= 1 && sn / sv >= 0.9) { ox += R.width * (sv - sn) / 2; oy += R.height * (sv - sn) / 2; sv = sn; }
      return { s: sv, ox: Math.round(ox), oy: Math.round(oy) };
    }
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // Feedback effects (view only): rings around a station and short labels that rise and fade. At most six
    // of each are live; none are made under reduced motion.
    var rings = [], floats = [], RING = 0.6, FLOAT = 0.8;
    var KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

    function stage() { return S ? S.stage : 0; }
    function active() { return !!(S && S.started && !blocked && !document.hidden); }
    function clearInput() { keys = {}; touch = {}; route = []; routeFace = null; arrive = null; eHeld = false; ownRoute = false; }
    // Doors are always there (rooms are gated by HQ); a station exists unless the view hides it.
    function hid() { return (V && V.hidden) || null; }
    function usable(s) { return !!s && (s.kind === 'door' || !(V && V.hidden && has.call(V.hidden, s.id))); }
    function nearestUsable() { var s = nearestIn(P.x, P.y, cur.id, stage(), hid()); return usable(s) ? s : null; }
    // A station that appears where the founder stands must never trap them: step to the nearest open tile.
    function unstick() {
      if (isWalkable(P.x, P.y, cur.id, hid())) return false;
      var t = nearestOpen(cur, Math.floor(P.x / T), Math.floor(P.y / T), hid());
      route = []; routeFace = null; arrive = null; nearId = null; ctxKey = '';
      if (t) { P.x = t[0] * T + 8; P.y = t[1] * T + 8; } else place(cur);
      return true;
    }
    function place(R) { cur = R; P.x = R.spawn.x; P.y = R.spawn.y; P.facing = R.spawn.facing; nearId = null; ctxKey = ''; }
    function here() { return targets(cur, stage()).filter(usable); }
    // World-space box of a station in this room, or of the agent terminals; null when it is not here.
    function spot(id) {
      if (id === 'terminals') {
        if (!cur.minis.length || !usable({ id: 'terminals' })) return null;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        cur.minis.forEach(function (m) { x0 = Math.min(x0, m.tx); y0 = Math.min(y0, m.ty); x1 = Math.max(x1, m.tx + 1); y1 = Math.max(y1, m.ty + 1); });
        return { x: x0 * T, y: y0 * T, w: (x1 - x0) * T, h: (y1 - y0) * T };
      }
      var st = typeof id === 'string' ? here().filter(function (s) { return s.id === id && !s.kind; })[0] : null;
      return st ? { x: st.tx * T, y: st.ty * T, w: (st.tw || 1) * T, h: (st.th || 1) * T } : null;
    }
    function still() { return !!(mq && mq.matches); }
    // Static backgrounds are cached per room and per Headquarters tier (the office floor matures with HQ).
    function bgFor(R) {
      var tier = R.tier && V && V.hq != null ? R.tier(V.hq) : 0, key = R.id + ':' + tier;
      if (!bgs[key]) { var b = document.createElement('canvas'); b.width = R.width; b.height = R.height; drawStatic(b.getContext('2d'), R, tier); bgs[key] = b; }
      return bgs[key];
    }
    function enter(target) {
      var R = roomOf(target), from = cur.id;
      if (!R || R.stage > stage()) return false;
      clearInput();
      var back = R.doors.filter(function (d) { return d.target === from; })[0];
      if (back) { cur = R; P.x = back.approach.x; P.y = back.approach.y; P.facing = INWARD[back.side]; nearId = null; ctxKey = ''; }
      else place(R);
      pulseT = 0.5; return true;
    }
    function resize() {
      var rc = canvas.getBoundingClientRect();
      var dpr = +window.devicePixelRatio; D = dpr > 0 && isFinite(dpr) ? dpr : 1;
      var w = Math.max(1, Math.round((rc.width || 640) * D)), h = Math.max(1, Math.round((rc.height || 400) * D));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      c.imageSmoothingEnabled = false;
    }
    function ignoreTarget(el) {
      if (document.querySelector && document.querySelector('dialog[open]')) return true;
      if (!el || el === canvas || el === document.body || el === document.documentElement || !el.tagName) return false;
      if (/^(INPUT|TEXTAREA|SELECT|A|SUMMARY)$/.test(el.tagName) || el.isContentEditable) return true;
      return !!(el.closest && el.closest('dialog,[role="dialog"],[aria-modal="true"]'));
    }
    function onKeyDown(e) {
      if (!active() || e.ctrlKey || e.metaKey || e.altKey || ignoreTarget(e.target)) return;
      var d = KEYS[e.code] || KEYS[e.key];
      if (d) { keys[d] = true; route = []; routeFace = null; arrive = null; e.preventDefault(); return; }
      if (e.code === 'KeyE' || e.code === 'Space' || e.key === 'e' || e.key === 'E' || e.key === ' ') {
        if ((e.code === 'Space' || e.key === ' ') && e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (!e.repeat && !eHeld) { eHeld = true; api.interact(); }
      }
    }
    function onKeyUp(e) {
      var d = KEYS[e.code] || KEYS[e.key];
      if (d) delete keys[d];
      if (e.code === 'KeyE' || e.code === 'Space' || e.key === 'e' || e.key === 'E' || e.key === ' ') eHeld = false;
    }
    function onVis() { if (document.hidden) clearInput(); }
    function onPointer(e) {
      if (!active()) return;
      var rc = canvas.getBoundingClientRect();
      if (!rc.width || !rc.height) return;
      var wx = ((e.clientX - rc.left) * canvas.width / rc.width - view.ox) / view.s, wy = ((e.clientY - rc.top) * canvas.height / rc.height - view.oy) / view.s;
      try { canvas.focus({ preventScroll: true }); } catch (_) {}
      e.preventDefault();
      var hit = here().filter(function (s) { var top = s.kind ? 4 : 6; return wx >= s.tx * T - 4 && wx <= (s.tx + s.tw) * T + 4 && wy >= s.ty * T - top && wy <= (s.ty + s.th) * T + 4; })[0];
      // Tapping what the founder already stands beside uses it, after this event (the app closes cards on
      // pointerdown); any other target is only walked to.
      if (hit && hit.id === nearId && !route.length && !moving) { (typeof setTimeout === 'function' ? setTimeout : function (f) { f(); })(function () { api.interact(); }, 0); return; }
      if (hit) { api.goTo(hit.id); ownRoute = true; return; }
      var p = findPath(P.x, P.y, wx, wy, cur.id, hid());
      if (p.length) { route = p; routeFace = null; arrive = null; ownRoute = true; }
    }
    function faceToward(s) { var dx = s.x - P.x, dy = s.y - P.y; P.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'); }
    function walkable(x, y) { return isWalkable(x, y, cur.id, hid()); }
    function tryAxis(dx, dy) {
      if (walkable(P.x + dx, P.y + dy)) { P.x += dx; P.y += dy; return true; }
      // corner assist: slide toward the tile centre so doorways and aisles are easy to enter
      var along = dx ? 'y' : 'x', cen = Math.floor(P[along] / T) * T + 8, off = cen - P[along], amt = Math.abs(dx || dy);
      if (!off || Math.abs(off) > 7) return false;
      var tx = dx ? P.x + dx : cen, ty = dy ? P.y + dy : cen;
      if (!walkable(tx, ty)) return false;
      var s = Math.sign(off) * Math.min(Math.abs(off), amt), nx = along === 'x' ? P.x + s : P.x, ny = along === 'y' ? P.y + s : P.y;
      if (!walkable(nx, ny)) return false;
      P.x = nx; P.y = ny; return true;
    }
    function step(dt) {
      moving = false;
      if (!active()) return;
      var budget = BASE * (S.speed === 1 ? 1 : 2) * S.movementSpeed * (Date.now() < boostUntil ? 1.6 : 1) * dt, dx = 0, dy = 0, x0 = P.x, y0 = P.y, i, m;
      for (var d in DIRS) if (keys[d] || touch[d]) { dx += DIRS[d][0]; dy += DIRS[d][1]; }
      var byPlayer = !!(dx || dy) || ownRoute;
      if (dx || dy) {
        route = []; routeFace = null; arrive = null;
        var n = Math.hypot(dx, dy), k = Math.ceil(budget / SUB), u = k ? budget / k : 0;
        dx /= n; dy /= n;
        for (i = 0; i < k; i++) { if (dx) tryAxis(dx * u, 0); if (dy) tryAxis(0, dy * u); }
        P.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      } else {
        while (budget > 1e-6 && route.length) {
          var wp = route[0], ex = wp.x - P.x, ey = wp.y - P.y;
          if (Math.abs(ex) > 0.01) {
            m = Math.sign(ex) * Math.min(Math.abs(ex), budget, SUB); P.facing = ex < 0 ? 'left' : 'right';
            if (!walkable(P.x + m, P.y)) { route = []; routeFace = null; arrive = null; break; }
            P.x += m; budget -= Math.abs(m);
          } else if (Math.abs(ey) > 0.01) {
            m = Math.sign(ey) * Math.min(Math.abs(ey), budget, SUB); P.facing = ey < 0 ? 'up' : 'down';
            if (!walkable(P.x, P.y + m)) { route = []; routeFace = null; arrive = null; break; }
            P.y += m; budget -= Math.abs(m);
          } else {
            P.x = wp.x; P.y = wp.y; route.shift();
            if (!route.length && routeFace) { faceToward(routeFace); routeFace = null; if (arrive) { var done = arrive; arrive = null; try { done(); } catch (_) {} } }
          }
        }
      }
      var moved = Math.hypot(P.x - x0, P.y - y0);
      if (moved > 0.001) { moving = true; walk += moved; if (byPlayer) walkedByPlayer += moved; }
    }
    function staffText() {
      if (!S || !cur.role) return '';
      if (cur.role === 'compute') return ' Compute: ' + S.compute + ' GPUs, harness ' + S.harness.toFixed(2) + '.';
      return ' Staff here: ' + S[cur.role] + ' ' + ROLE[cur.role].noun + '.';
    }
    function emitCtx() {
      var ns = nearestUsable(), rx = Math.round(P.x), ry = Math.round(P.y), now = Date.now();
      nearId = ns ? ns.id : null;
      var key = cur.id + '|' + nearId + '|' + moving, pos = rx + ',' + ry;
      if (key !== ctxKey || (pos !== ctxPos && now - ctxT > 150)) {
        ctxKey = key; ctxPos = pos; ctxT = now;
        if (typeof onContext === 'function') try { onContext({ id: nearId, label: ns ? ns.label : '', area: cur.name, room: cur.id, x: rx, y: ry, moving: moving }); } catch (_) {}
        var a = cur.name + '. You are the founder at ' + rx + ', ' + ry + (ns ? ', near ' + ns.label : '') + '.' + staffText();
        if (a !== aria) { aria = a; canvas.setAttribute('aria-label', a); }
      }
    }
    // Screen-space labels stay legible and can use the room's side margins on short screens.
    // The HUD box and the dock with its status line float over the canvas (insets from the app, CSS px): labels
    // keep clear of both. Returns canvas-px keep-out boxes and the lowest y a label may reach.
    function chromeKeep(vw, vh) {
      var i = insets, rc = canvas.getBoundingClientRect(), k = rc.width ? canvas.width / D / rc.width : 1, out = [], bot = vh;
      if (!i) return { boxes: out, bottom: bot };
      if (i.hud && i.hud.bottom > 0) out.push({ x: i.hud.left * k - 2, y: -4, w: vw, h: i.hud.bottom * k + 4, keep: true });
      if (i.bottom > 0 && i.bottom * k < vh - 40) { bot = vh - i.bottom * k; out.push({ x: -4, y: bot, w: vw + 8, h: vh, keep: true }); }
      return { boxes: out, bottom: bot };
    }
    function labels(vw, vh, sc, fs, list, bodies) {
      var lh = fs + 6, ko = chromeKeep(vw, vh), placed = ko.boxes.concat(bodies || []), shifts = [0, -1, 1, -2, 2, -3, 3, -4, 4];
      c.setTransform(D, 0, 0, D, 0, 0); c.font = 'bold ' + fs + 'px ' + labelFace; c.textAlign = 'center'; c.textBaseline = 'middle';
      list.forEach(function (L) {
        var w = Math.min(vw - 4, L.w || Math.ceil(c.measureText(L.s).width) + 10), height = lh + (L.progress != null ? 12 : 0), pos = null;
        var x = L.align === 'l' ? L.x + w / 2 : L.align === 'r' ? L.x - w / 2 : L.x;
        for (var col = 0; col < 3 && !pos; col++) for (var i = 0; i < shifts.length; i++) {
          var rx = x - w / 2 + [0, -1, 1][col] * (w + 8);
          if (L.room && w <= L.room[1] - L.room[0]) rx = Math.max(L.room[0], Math.min(L.room[1] - w, rx));
          rx = Math.max(2, Math.min(vw - w - 2, rx));
          var ry = Math.max(2, Math.min(ko.bottom - height - 2, L.y + shifts[i] * (height + 2)));
          if (!placed.some(function (q) { return !(L.tag && q.body) && rx < q.x + q.w + 2 && q.x < rx + w + 2 && ry < q.y + q.h + 2 && q.y < ry + height + 2; })) { pos = [rx, ry]; break; }
        }
        // Optional labels (stations and doors the founder is not next to) are skipped rather than overlapped.
        if (!pos && L.optional) return;
        if (!pos) pos = [Math.max(2, Math.min(vw - w - 2, x - w / 2)), Math.max(2, Math.min(ko.bottom - height - 2, L.y))];
        placed.push({ x: pos[0], y: pos[1], w: w, h: height, label: L });
      });
      placed = placed.filter(function (q) { return !q.keep; });
      placed.forEach(function (q) {
        var L = q.label;
        if (L.anchor && (Math.abs(q.x + q.w / 2 - L.x) > 16 || Math.abs(q.y - L.y) > lh + 2)) {
          c.strokeStyle = 'rgba(52,54,59,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(L.anchor.x, L.anchor.y); c.lineTo(Math.max(q.x, Math.min(q.x + q.w, L.anchor.x)), Math.max(q.y, Math.min(q.y + q.h, L.anchor.y))); c.stroke();
        }
      });
      placed.forEach(function (q) {
        r(c, q.label.bg, q.x, q.y, q.w, q.h); c.fillStyle = q.label.col;
        c.fillText(q.label.s, Math.round(q.x + q.w / 2), Math.round(q.y + lh / 2 + 1));
        if (q.label.progress != null) {
          var bx = Math.round(q.x + 5), by = Math.round(q.y + lh + 1), bw = q.w - 10;
          r(c, '#131820', bx, by, bw, 7);
          r(c, '#73d28a', bx + 1, by + 1, Math.round((bw - 2) * q.label.progress), 5);
        }
      });
    }
    function draw() {
      var dpr = +window.devicePixelRatio; if ((dpr > 0 && isFinite(dpr) ? dpr : 1) !== D) resize();
      var vw = canvas.width, vh = canvas.height, anim = !(mq && mq.matches), f = anim ? (t * 8) | 0 : 0, R = cur;
      var v = fitView(R), sc = v.s;
      view.s = sc; view.ox = v.ox; view.oy = v.oy;
      c.setTransform(1, 0, 0, 1, 0, 0); r(c, '#08131a', 0, 0, vw, vh);
      c.setTransform(sc, 0, 0, sc, view.ox, view.oy); c.imageSmoothingEnabled = false; c.drawImage(bgFor(R), 0, 0);
      var items = here(), live = active();
      if (S) {
        var work = anim && !frozen && S.started && !S.paused;
        drawStaff(c, R, S, V, f, work, anim);
        if (R.minis.length && usable({ id: 'terminals' })) drawMinis(c, R, V, f, work, anim);
        if (R.id === 'agents') drawPods(c, R, V, f, work, anim);
        if (R.id === 'soc') drawSoc(c, R, V, f, anim);
        // Only stations that exist are drawn; unearned ones are simply not there yet (no ghosts or pads).
        targets(R, stage()).forEach(function (s) {
          if (s.kind) drawDoor(c, s, s.id === nearId);
          else if (usable(s)) drawStation(c, s, S, f, anim, V);
        });
        if (V) decorateFacilities(c, R, V, items, f, anim);
      }
      var mainFounder=founders.founder;
      var stepN = mainFounder&&mainFounder.path.length?((mainFounder.walk/5)|0)%4:moving ? ((walk / 5) | 0) % 4 : 0;
      /* First Office: the founder uses the shared avatar set (avatars.js) when it's loaded. */ if (window.Avatars) { c.fillStyle = 'rgba(10,15,30,.32)'; c.beginPath(); c.ellipse(Math.round(P.x), Math.round(P.y) + 1, 7, 3, 0, 0, 7); c.fill(); window.Avatars.draw(c, 'you', Math.round(P.x), Math.round(P.y) + 2, 1, { step: stepN, back: P.facing === 'up', flip: P.facing === 'left' }); } else standing(c, P.x, P.y, { body: '#f1e6c8', trim: '#c4572b', shirt: '#1f2a4a', skin: SKIN[0], hair: '#3b2416', facing: P.facing, step: stepN });
      Object.keys(founders).forEach(function(id){if(id==='founder')return;var actor=founders[id];standing(c,actor.x,actor.y,{body:'#f1e6c8',trim:id==='helper-1'?'#0071e3':'#926000',shirt:id==='helper-1'?'#0071e3':'#926000',skin:SKIN[0],hair:'#3b2416',facing:actor.facing,step:actor.path.length?((actor.walk/5)|0)%4:0});if(!actor.path.length&&anim&&!frozen&&!S.paused)r(c,'#ffffff',actor.x+6,actor.y-24-(f%2),2,2);});
      if (pulseT > 0 && anim) { c.strokeStyle = 'rgba(241,230,200,' + (pulseT * 2).toFixed(2) + ')'; c.lineWidth = 1; c.beginPath(); c.ellipse(P.x, P.y, 12 + (0.5 - pulseT) * 20, 5 + (0.5 - pulseT) * 8, 0, 0, 7); c.stroke(); }
      rings = rings.filter(function (q) { return t - q.at < RING; });
      rings.forEach(function (q) {
        if (q.room !== R.id) return;
        var k = (t - q.at) / RING;
        c.strokeStyle = 'rgba(0,113,227,' + (0.9 * (1 - k)).toFixed(2) + ')'; c.lineWidth = 1.5; c.beginPath();
        c.ellipse(q.x + q.w / 2, q.y + q.h / 2, q.w / 2 + 4 + k * 12, q.h / 2 + 4 + k * 8, 0, 0, 7); c.stroke();
      });
      R.furn.forEach(function (fu) { if (fu.k === 'tree') canopy(c, fu); });
      if (S && live && nearId) items.forEach(function (s) { if (s.id === nearId && !s.kind) r(c, '#c4572b', s.x - 1, s.ty * T - 13, 3, 3); });
      if (Date.now() < boostUntil) r(c, '#ffb347', P.x + 7, P.y - 24 - (anim ? f % 2 : 0), 2, 2);

      // Daytime room tone: a light cool wash so the room reads lit (game.js's .night overlay does the dark).
      // Overlay artwork before screen-space labels.
      r(c,'rgba(8,19,26,.16)',0,0,R.width,R.height);
      if(c.createRadialGradient)items.filter(function(st){return ['hunt','forge','rig'].indexOf(st.id)>=0;}).forEach(function(st){var g=c.createRadialGradient(st.x,st.y,0,st.x,st.y,56);if(!g||!g.addColorStop)return;g.addColorStop(0,st.id==='rig'?'rgba(150,205,225,.2)':'rgba(255,184,108,.3)');g.addColorStop(1,'rgba(255,184,108,0)');c.fillStyle=g;c.fillRect(st.x-56,st.y-56,112,112);});
      if (S && V) drawFlags(c, items, V, f, anim);
      // Screen-space labels work in CSS px (labels() draws them at device scale D).
      var vwC = vw / D, scC = sc / D, fs = Math.max(14, Math.min(18, Math.round(scC * 5))), lh = fs + 6, list = [], rest = [], ts = T * scC;
      function sx(x) { return (v.ox + x * sc) / D; }
      function sy(y) { return (v.oy + y * sc) / D; }
      Object.keys(founders).forEach(function(id){if(id!=='founder'){var actor=founders[id];list.push({s:id==='helper-1'?'B':'C',x:sx(actor.x),y:sy(actor.y-26)-lh,col:'#fff',bg:id==='helper-1'?'#0071e3':'#926000',tag:true});}});
      list.push({ s: founders.founder?'A ★':'You', x: sx(P.x), y: sy(P.y - 26) - lh, col: '#fbf7ef', bg: '#18303a', tag: true });
      // Founders' sprites are keep-outs too, so a prompt or chip never covers them (their own tags may touch them).
      var bodies = [{ x: P.x, y: P.y }].concat(Object.keys(founders).filter(function (id) { return id !== 'founder'; }).map(function (id) { return founders[id]; }))
        .map(function (a) { return { x: sx(a.x - 7), y: sy(a.y - 22), w: 14 * scC, h: 24 * scC, keep: true, body: true }; });
      if (S) items.filter(function(st){return st.kind||st.id===nearId;}).forEach(function (s) {
        // A facility station's label carries its level chip ("Forge 2/6 · HQ 3"); the chip's state sets the
        // colour when the founder is not beside it. Headquarters reads gold on dark: the landmark.
        var near = s.id === nearId && live, chip = s.kind ? null : chipFor(s.id, V), style = chip ? chip.style : 'dark';
        var L = { anchor: { x: sx(s.x), y: sy(s.y) }, s: (near ? (touchUI ? 'Tap · ' : 'E · ') : '') + s.short + (chip ? ' ' + chip.text : ''),
          col: near ? '#2f3136' : style === 'gold' ? '#2f3136' : s.id === 'hq' && style === 'dark' ? '#ffe28a' : '#f3ecdc',
          bg: near ? CHIP.near : s.id === 'hq' && style === 'dark' ? '#2b2d33' : CHIP[style] || CHIP.dark };
        // Labels sit above their station; the Headquarters nameplate sits below its facade, on the corridor.
        if (!s.kind) { L.x = sx(s.x); L.y = s.id === 'hq' ? sy((s.ty + s.th) * T + 3) : sy(s.ty * T - 10) - lh; }
        else if (s.side === 'top' || s.side === 'bottom') { L.x = sx(s.x); L.y = sy(s.ty * T) + (ts - lh) / 2; }
        else { L.align = s.side === 'left' ? 'l' : 'r'; L.x = s.side === 'left' ? sx(T) + 4 : sx((R.cols - 1) * T) - 4; L.y = sy(s.ty * T - 2) - lh; }
        if (!near) L.optional = true;
        (near ? list : rest).push(L);
      });
      // Status labels share the label collision layout, so countdowns and names never cover each other.
      if (V && V.timers) V.timers.forEach(function (job) {
        var station = items.find(function (st) { return st.id === job.station && !st.kind; });
        if (!station) return;
        // A chip is as wide as its text and stays inside the room; a caption too long for the room is shortened with
        // "…", never dropped. The width counts "Paused · " and two-digit numbers, so pausing or a countdown never resizes it.
        c.font = 'bold ' + fs + 'px ' + labelFace;
        var room = [sx(0), sx(R.width)], cap = Math.min(vwC - 4, Math.max(120, room[1] - room[0])), name = job.caption, caption, cw;
        var width = function (n) { var s = (n ? n + ' · ' : '') + 'Paused · ' + job.remaining.replace(/^Paused · /, ''); return Math.ceil(c.measureText(s.replace(/\d+/g, function (d) { return d.length < 2 ? '00' : d; })).width) + 10; };
        while ((cw = width(name)) > cap && name) name = name.length > 2 ? name.replace(/…$/, '').slice(0, -1).replace(/\s+$/, '') + '…' : '';
        caption = name ? name + ' · ' + job.remaining : job.remaining;
        list.unshift({ s: caption, w: Math.max(72, Math.min(cap, cw)), room: room, x: sx(station.x), y: sy(station.ty * T) - lh - 16,
          anchor: { x: sx(station.x), y: sy(station.ty * T) }, col: '#ffffff', bg: '#28332d', progress: job.progress });
      });
      labels(vwC, vh / D, scC, fs, list.concat(rest), bodies);
      // Rising "+N" labels, in screen space so they stay legible; they rise about 20 px and fade.
      floats = floats.filter(function (q) { return t - q.at < FLOAT; });
      floats.forEach(function (q) {
        if (q.room !== R.id) return;
        var k = (t - q.at) / FLOAT, x = sx(q.x), y = sy(q.y) - lh / 2 - 4 - k * 20, w = Math.ceil(c.measureText(q.s).width) + 12;
        c.globalAlpha = 1 - k; r(c, '#0066cc', Math.round(x - w / 2), Math.round(y - lh / 2), w, lh);
        c.fillStyle = '#ffffff'; c.fillText(q.s, Math.round(x), Math.round(y + 1)); c.globalAlpha = 1;
      });
    }
    function frame(now) {
      if (!alive) return;
      raf = window.requestAnimationFrame(frame);
      var dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
      last = now; if (document.hidden) return; t += dt; pulseT = Math.max(0, pulseT - dt);
      cam.k = cam.follow ? Math.min(1, cam.k + dt / 0.45) : Math.max(0, cam.k - dt / 0.45);
      if (mq && mq.matches) cam.k = cam.follow ? 1 : 0;
      step(dt); stepFounders(dt); emitCtx(); draw();
    }

    var api = {
      assignFounder:assignFounder,
      founders:function(list){var ids=list.map(function(x){return x.id;});Object.keys(founders).forEach(function(id){if(ids.indexOf(id)<0)delete founders[id];});list.forEach(function(x){assignFounder(x.id,x.station);});},
      update: function (state, selectedRole, workersFrozen, controlsBlocked, view) {
        var s = state || {}, prev = S ? S.stage : null, sp = +s.speed;
        function num(v) { v = +v; return isFinite(v) && v > 0 ? v : 0; }
        V = sanitizeView(view);
        // HQ view, when supplied, drives earned-room availability; otherwise the legacy stage field does.
        var st = V && V.hq != null ? hqStage(V.hq) : clampStage(s.stage, 0);
        S = { stage: st, started: !!s.started, paused: !!s.paused, won: !!s.won, ready: !!s.ready, speed: sp === 2 || sp === 4 ? sp : 1,
          movementSpeed: movementSpeed(s.movementSpeed),
          engineers: Math.floor(num(s.engineers)), researchers: Math.floor(num(s.researchers)), marketers: Math.floor(num(s.marketers)),
          compute: Math.floor(num(s.compute)), harness: num(s.harness), publicity: num(s.publicity) };
        frozen = !!workersFrozen; blocked = !!controlsBlocked;
        if (cur.stage > S.stage) { clearInput(); place(O); }
        else if (prev !== null && prev !== S.stage) { route = []; routeFace = null; arrive = null; }
        unstick();// a station that was just revealed may sit where the founder is standing
        if (!active()) clearInput();
        ctxKey = '';
      },
      move: function (direction, pressed) {
        if (!DIRS[direction]) return;
        if (pressed && active()) { touch[direction] = true; route = []; routeFace = null; arrive = null; } else delete touch[direction];
      },
      interact: function () {
        if (!active()) return false;
        var s = nearestUsable();
        if (!s) return false;
        faceToward(s); pulseT = 0.5;
        if (s.kind === 'door') return enter(s.target);
        if (typeof onInteract === 'function') onInteract(s.id);
        return true;
      },
      // Route to a usable station or door in this room. onArrive (optional) runs once when the founder
      // gets there; any manual movement or new route cancels it.
      goTo: function (id, onArrive) {
        var s = here().filter(function (x) { return x.id === id; })[0];
        if (!s || !active()) return false;
        var p = findPath(P.x, P.y, s.approach.x, s.approach.y, cur.id, hid());
        if (!p.length) return false;
        keys = {}; touch = {}; route = p; routeFace = s; arrive = typeof onArrive === 'function' ? onArrive : null; ownRoute = false; return true;
      },
      destinations: function () { return here().map(copy); },
      getState: function () { return { room: cur.id, x: Math.round(P.x), y: Math.round(P.y), facing: P.facing }; },
      // Read-only viewport rectangle for contextual guide bubbles; does not move the founder.
      anchor: function (id) {
        var b = id === 'founder' ? { x: P.x - 8, y: P.y - 24, w: 16, h: 28 } : spot(id);
        if (!b) return null;
        var rect = canvas.getBoundingClientRect(), v = fitView(cur);
        return { left: rect.left + (v.ox + b.x * v.s) * rect.width / canvas.width,
          top: rect.top + (v.oy + b.y * v.s) * rect.height / canvas.height,
          width: b.w * v.s * rect.width / canvas.width, height: b.h * v.s * rect.height / canvas.height };
      },
      // A ring around a station (or 'terminals') in this room. Returns false when nothing was drawn.
      pulseAt: function (id) {
        var b = still() ? null : spot(id);
        if (!b) return false;
        rings.push({ room: cur.id, x: b.x, y: b.y, w: b.w, h: b.h, at: t }); if (rings.length > 6) rings.shift();
        return true;
      },
      // A short label ("+3") that rises over a station or the terminals and fades.
      float: function (text, id) {
        var b = still() ? null : spot(id);
        if (!b) return false;
        floats.push({ room: cur.id, x: b.x + b.w / 2, y: b.y, s: String(text).slice(0, 12), at: t }); if (floats.length > 6) floats.shift();
        return true;
      },
      walked: function () { return walkedByPlayer; },
      restore: function (v, st, view) {
        clearInput();
        st = clampStage(st, 0);
        if (view) V = sanitizeView(view);
        var R = v && typeof v === 'object' ? roomOf(v.room == null ? '' : v.room) : null;
        var x = v ? +v.x : NaN, y = v ? +v.y : NaN;
        var ok = !!R && R.stage <= st && v.x !== null && v.y !== null && isFinite(x) && isFinite(y) && x >= 0 && y >= 0 && x < R.cols * T && y < R.rows * T;
        if (!ok) { place(O); return; }
        cur = R; P.x = x; P.y = y; P.facing = DIRS[v.facing] ? v.facing : R.spawn.facing; nearId = null; ctxKey = '';
        unstick();
      },
      reset: function () { clearInput();founders={}; place(O); boostUntil = 0; },
      pulse: function () { pulseT = 0.5; },
      // Touch screens name the tap, not the E key, in the prompt beside the founder.
      setTouch: function (on) { touchUI = !!on; },
      // Free band for the room, in CSS px from the canvas edges: the HUD box ({left, bottom}), the band top
      // below it and the space the dock and status line take at the bottom. Null fits the whole canvas.
      // follow: true holds the founder at the centre, zoomed in; false shows the whole room. Eases over 450 ms.
      setCamera: function (o) { if (o && 'follow' in o) cam.follow = !!o.follow; if (o && +o.zoom > 1) cam.zoom = +o.zoom; },
      camera: function () { return { follow: cam.follow, zoom: cam.zoom, moving: cam.k > 0 && cam.k < 1 }; },
      setInsets: function (v) {
        function n(x) { x = +x; return isFinite(x) ? Math.max(0, x) : 0; }
        insets = v && typeof v === 'object' ? { top: n(v.top), bottom: n(v.bottom), left: n(v.left), hud: v.hud ? { left: n(v.hud.left), bottom: n(v.hud.bottom) } : null } : null;
      },
      // Read-only: where the current room is drawn, in viewport px.
      roomRect: function () {
        var rect = canvas.getBoundingClientRect(), v = fitView(cur), kx = rect.width / canvas.width, ky = rect.height / canvas.height;
        return { left: rect.left + v.ox * kx, top: rect.top + v.oy * ky, width: cur.width * v.s * kx, height: cur.height * v.s * ky };
      },
      boost: function () { boostUntil = Date.now() + 15000; },
      destroy: function () {
        alive = false; window.cancelAnimationFrame(raf); clearInput();
        window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', clearInput);
        document.removeEventListener('visibilitychange', onVis); canvas.removeEventListener('pointerdown', onPointer);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      }
    };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', onVis); canvas.addEventListener('pointerdown', onPointer);
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
    resize(); raf = window.requestAnimationFrame(frame);
    return api;
  }

  var helpers = {
    stations: STATIONS.map(copy), rooms: ROOM_LIST.map(pubRoom), spawn: { x: SPAWN.x, y: SPAWN.y, facing: SPAWN.facing, room: 'office' },
    availableRooms: availableRooms, availableStations: availableStations, isWalkable: isWalkable, findPath: findPath,
    nearestStation: nearestStation, doorsFor: doorsFor, roomView: roomView, movementSpeed: movementSpeed, tile: T, speed: BASE, tone: tone,
    // HQ-aware geometry (includes the two late rooms). Legacy stage-based exports above are unchanged.
    lateRooms: LATE_ROOMS.map(pubRoom), lateStations: LATE_STATIONS.map(copy), allRooms: ALL_ROOMS.map(pubRoom), allStations: ALL_STATIONS.map(copy),
    hqStage: hqStage, roomsForHq: roomsForHq, stationsForHq: stationsForHq, doorsForHq: doorsForHq, maxHq: 8
  };
  var world = { create: create };
  Object.keys(helpers).forEach(function (k) { world[k] = helpers[k]; });
  return { geo: helpers, world: world };
});
