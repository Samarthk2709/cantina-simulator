// Interpenetration / glitch sampler for review3d.cjs (SPEC 1b). Everything here runs in-page via page.evaluate.
// installClip(page) defines window.__clip; then runStation(id) / runWalk() return hit lists + motion metrics.

// ---------- in-page code (stringified by page.addScriptTag-free evaluate) ----------
function inPageInstall(opts) {
  const O = window.Office3D; if (!O) return { error: 'no Office3D' };
  const TOL = opts.tol, TOLC = opts.tolContact;
  const getRobot = () => { let r = O.robot; if (typeof r === 'function') r = r(); if (!r) return null; return r.isObject3D ? r : (r.mesh || r.root || null); };
  const rob = getRobot();
  const hasRobotHook = !!rob && !!O.robot && (typeof O.robot === 'function' ? true : O.robot.isObject3D);
  const robotHookShape = !O.robot ? 'MISSING' : (typeof O.robot === 'function' ? 'function (SPEC wants Object3D)' : (O.robot.isObject3D ? 'ok' : 'object without isObject3D'));
  if (!rob) return { error: 'robot not found', robotHook: robotHookShape };
  // sample points: skinned vertices (by dominant bone) + vertices of rigid child meshes
  const V = rob.position.constructor; const tmp = new V();
  const sets = [];
  rob.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position, n = pos.count, stride = Math.max(1, Math.ceil(n / (o.isSkinnedMesh ? 5000 : 200)));
    const idx = []; for (let i = 0; i < n; i += stride) idx.push(i);
    let names;
    if (o.isSkinnedMesh) { const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight; names = idx.map(i => { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; b = si.getComponent(i, k); } } return o.skeleton.bones[b]?.name || 'bone' + b; }); }
    else { let p = o.parent; while (p && !p.isBone && p !== rob) p = p.parent; const nm = (p && p.isBone ? p.name : '') + ':' + (o.name || 'part'); names = idx.map(() => nm); }
    sets.push({ o, idx, names });
  });
  const samplePoints = () => {
    const pts = [], names = [];
    for (const s of sets) { s.o.updateMatrixWorld(true); for (let j = 0; j < s.idx.length; j++) { const p = new V(); if (s.o.isSkinnedMesh) s.o.getVertexPosition(s.idx[j], p); else p.fromBufferAttribute(s.o.geometry.attributes.position, s.idx[j]); p.applyMatrix4(s.o.matrixWorld); pts.push(p); names.push(s.names[j]); } }
    return { pts, names };
  };
  // colliders
  let cols = [], colSource;
  const isRobotObj = o => { let p = o; while (p) { if (p === rob) return true; p = p.parent; } return false; };
  if (typeof O.colliders === 'function') {
    colSource = 'hook';
    for (const c of O.colliders()) {
      let box = null, approx = false;
      if (c.box && c.box.isBox3) box = c.box.clone();
      else if (c.mesh) { c.mesh.updateMatrixWorld(true); c.mesh.geometry.computeBoundingBox(); box = c.mesh.geometry.boundingBox.clone().applyMatrix4(c.mesh.matrixWorld); approx = true; }
      if (box) cols.push({ name: c.name || '?', station: c.station || null, contact: c.contact || null, box, approx, wall: /wall|ceiling/i.test(c.name || '') });
    }
  } else {
    colSource = 'fallback: scene mesh bounding boxes (ADVISORY, loose for merged meshes)';
    O.scene.traverse(o => {
      if (!o.isMesh || !o.visible || isRobotObj(o) || o.material?.transparent || o.isInstancedMesh || o.isBatchedMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      if (Math.max(sx, sy, sz) > 2.5 || Math.min(sx, sy, sz) < 0.004 || b.max.y < 0.02) return; // skip room shell/merged/rugs/decals
      let nm = o.name, q = o.parent; while (!nm && q && q !== O.scene) { nm = q.name; q = q.parent; } cols.push({ name: (nm || o.geometry.name || 'mesh') + `@${((b.min.x + b.max.x) / 2).toFixed(1)},${((b.min.z + b.max.z) / 2).toFixed(1)}`, box: b, contact: null, approx: true });
    });
  }
  // ---- independent checks (do not rely on the builder's proxies) ----
  // (a) room shell from the floor collider (walls are not in colliders()): anything outside the footprint is in a wall
  const floorC = cols.find(c => c.name === 'floor'); const room = floorC ? { x0: floorC.box.min.x, x1: floorC.box.max.x, z0: floorC.box.min.z, z1: floorC.box.max.z, h: opts.ceiling || 3.3 } : null;
  // (b) robot bone volumes (bone-local AABBs of the rigidly skinned vertices, shrunk by tol) vs live scene-mesh vertices
  const M4 = rob.matrixWorld.constructor; const boneVol = [];
  rob.traverse(o => { if (!o.isSkinnedMesh) return; const g = o.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; const ext = {};
    for (let i = 0; i < pos.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; b = si.getComponent(i, k); } }
      const v = new V().fromBufferAttribute(pos, i).applyMatrix4(o.bindMatrix).applyMatrix4(o.skeleton.boneInverses[b]); const e = ext[b] || (ext[b] = { mn: v.clone(), mx: v.clone() }); e.mn.min(v); e.mx.max(v); }
    for (const b in ext) { const e = ext[b]; e.mn.addScalar(TOL); e.mx.addScalar(-TOL); if (e.mn.x < e.mx.x && e.mn.y < e.mx.y && e.mn.z < e.mx.z) boneVol.push({ bone: o.skeleton.bones[b], name: o.skeleton.bones[b].name, mn: e.mn, mx: e.mx }); } });
  const isNib = o => { for (let p = o; p; p = p.parent) if (p.userData && (p.userData.nib || p.name === 'nib')) return true; return false; };
  let cand = [], candAt = -1e9; const tmpW = new V(), tmpL = new V(), inv = new M4();
  const gather = (rmin, rmax) => { cand = []; const m = 0.05;
    O.scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || isRobotObj(o) || !o.geometry?.attributes?.position) return; const mat = Array.isArray(o.material) ? o.material[0] : o.material; if (mat && (mat.transparent || mat.depthWrite === false)) return;
      let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) vis = false; if (!vis) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (bb.max.x < rmin.x - m || bb.min.x > rmax.x + m || bb.max.y < rmin.y - m || bb.min.y > rmax.y + m || bb.max.z < rmin.z - m || bb.min.z > rmax.z + m) return;
      const pos = o.geometry.attributes.position; const idx = []; for (let i = 0; i < pos.count; i++) { tmpW.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (tmpW.x > rmin.x - m && tmpW.x < rmax.x + m && tmpW.y > rmin.y - m && tmpW.y < rmax.y + m && tmpW.z > rmin.z - m && tmpW.z < rmax.z + m) idx.push(i); }
      if (idx.length) { let nm = o.name, q = o.parent; while (!nm && q && q !== O.scene) { nm = q.name; q = q.parent; } cand.push({ o, idx, name: (nm || 'mesh') + (o.userData.compact || o.parent?.userData?.compact ? ' (moving)' : '') }); } }); };
  const geomCheck = (rmin, rmax, t, phase, hitsG) => {
    if (t - candAt > 600) { gather(rmin, rmax); candAt = t; }
    for (const bv of boneVol) { inv.copy(bv.bone.matrixWorld).invert();
      for (const c of cand) { c.o.updateMatrixWorld(); const pos = c.o.geometry.attributes.position; let worst = 0;
        for (const i of c.idx) { tmpL.fromBufferAttribute(pos, i).applyMatrix4(c.o.matrixWorld).applyMatrix4(inv); if (tmpL.x > bv.mn.x && tmpL.x < bv.mx.x && tmpL.y > bv.mn.y && tmpL.y < bv.mx.y && tmpL.z > bv.mn.z && tmpL.z < bv.mx.z) { const d = Math.min(tmpL.x - bv.mn.x, bv.mx.x - tmpL.x, tmpL.y - bv.mn.y, bv.mx.y - tmpL.y, tmpL.z - bv.mn.z, bv.mx.z - tmpL.z) + TOL; if (d > worst) worst = d; } }
        if (worst > 0) { const k = bv.name + '|' + c.name; if (!hitsG[k] || worst * 100 > hitsG[k].depthCm) hitsG[k] = { station: null, part: bv.name, object: c.name, depthCm: +(worst * 100).toFixed(1), tMs: Math.round(t), phase, check: 'geometry' }; } } } };

  const depthIn = (b, p) => { if (p.x <= b.min.x || p.x >= b.max.x || p.y <= b.min.y || p.y >= b.max.y || p.z <= b.min.z || p.z >= b.max.z) return 0; return Math.min(p.x - b.min.x, b.max.x - p.x, p.y - b.min.y, b.max.y - p.y, p.z - b.min.z, b.max.z - p.z); };
  const feet = () => { const out = {}; rob.traverse(o => { if (o.isBone && /^(lAn|rAn|foot_L|foot_R)$/.test(o.name)) out[o.name] = o.getWorldPosition(new V()); }); return out; };

  async function run(label, action, ms, every = 100, extraPhases = []) {
    const hits = {}; const cam = {}; const hitsG = {}; let frames = 0, popMax = {}, prev = null, minY = {}, footTrack = {}, minSole = { y: 9 }, samples = 0;
    const t0 = performance.now(); let phase = 'enter';
    const ctl = { setPhase: p => { phase = p; } };
    const act = action ? action(ctl) : null; let finished = false; if (act && act.done) act.done.then(() => { finished = true; });
    while (!finished && performance.now() - t0 < ms) {
      await new Promise(r => requestAnimationFrame(() => r())); frames++;
      const t = performance.now() - t0;
      if (phase === 'settle') continue;
      { let vis = true; for (let q = rob; q; q = q.parent) if (q.visible === false) vis = false; if (!vis) { samples++; continue; } } // hidden robot (desk-* close-ups) cannot glitch on screen // shot() teleports: ignore the first 400 ms while the pose settles
      const { pts, names } = samplePoints(); samples++;
      if (colSource === 'hook' && samples % 5 === 1) { const live = liveCols(); for (let i = 0; i < live.length && i < cols.length; i++) if (cols[i].name === live[i].name && !cols[i].box.equals(live[i].box)) { cols[i].box = live[i].box.clone(); cols[i].live = true; } }
      // robot vs colliders
      let rmin = new V(1e9, 1e9, 1e9), rmax = new V(-1e9, -1e9, -1e9); for (const p of pts) { rmin.min(p); rmax.max(p); }
      for (const c of cols) {
        const b = c.box; if (b.max.x < rmin.x || b.min.x > rmax.x || b.max.y < rmin.y || b.min.y > rmax.y || b.max.z < rmin.z || b.min.z > rmax.z) continue;
        const tol = TOL; // test at the strict tolerance; contact-flag leniency is applied when reporting (strictOnly marks hits only the flag excuses)
        for (let i = 0; i < pts.length; i++) { const d = depthIn(b, pts[i]); if (d > tol) { const k = names[i] + '|' + c.name; const h = hits[k]; if (!h || d > h.depth) hits[k] = { station: label, part: names[i], object: c.name, contact: c.contact, depthCm: +(d * 100).toFixed(1), tMs: Math.round(t), phase, approx: c.approx, live: !!c.live, strictOnly: !!c.contact && d <= TOLC }; } }
      }
      if (samples % 3 === 1) geomCheck(rmin, rmax, t, phase, hitsG);
      if (samples % 2 === 0 && phase !== 'walk' && phase !== 'idle') camRays(t, phase, cam);
      // camera vs colliders and vs robot
      const cp = O.camera.position;
      if (room) { const d = Math.max(room.x0 + 0.05 - cp.x, cp.x - (room.x1 - 0.05), room.z0 + 0.05 - cp.z, cp.z - (room.z1 - 0.05), cp.y - (room.h - 0.05), 0.05 - cp.y); if (d > 0) { const k = 'camera|room shell'; if (!cam[k] || d * 100 > cam[k].depthCm) cam[k] = { station: label, part: 'CAMERA', object: 'room shell (wall/ceiling/floor)', depthCm: +(d * 100).toFixed(1), tMs: Math.round(t), phase }; } }
      if (room) { const d = Math.max(room.x0 - rmin.x, rmax.x - room.x1, room.z0 - rmin.z, rmax.z - room.z1); if (d > TOL) { const k = 'robot|room shell'; if (!hits[k] || d * 100 > hits[k].depthCm) hits[k] = { station: label, part: 'robot', object: 'room shell (wall)', depthCm: +(d * 100).toFixed(1), tMs: Math.round(t), phase }; } }
      for (const c of cols) { const d = depthIn(c.box, cp); if (d > 0.02) { const k = 'camera|' + c.name; if (!cam[k] || d > cam[k].depth) cam[k] = { station: label, part: 'CAMERA', object: c.name, depthCm: +(d * 100).toFixed(1), tMs: Math.round(t), phase, approx: c.approx }; } }
      let near = 9; for (const p of pts) { const d = p.distanceTo(cp); if (d < near) near = d; }
      if (near < 0.12) { const k = 'camera|robot'; const d = 0.12 - near; if (!cam[k] || d > cam[k].depth) cam[k] = { station: label, part: 'CAMERA', object: 'robot (camera within 12 cm of robot surface)', depthCm: +(near * 100).toFixed(1), tMs: Math.round(t), phase }; }
      // pose pops: per-point displacement relative to root motion between consecutive samples
      // pose pops: displacement in the robot's own frame (removes walking + turning), between consecutive samples
      const inv = rob.matrixWorld.clone().invert(); const loc = []; for (let i = 0; i < pts.length; i += 7) loc.push(pts[i].clone().applyMatrix4(inv));
      if (prev && prev.length === loc.length) { let m = 0, mi = 0; for (let i = 0; i < loc.length; i++) { const d = loc[i].distanceTo(prev[i]); if (d > m) { m = d; mi = i; } } const dt = Math.max(1, t - prev.t); const v = m / (dt / 1000); if (!popMax.v || v > popMax.v) popMax = { v: +v.toFixed(2), dCm: +(m * 100).toFixed(1), tMs: Math.round(t), phase, part: names[mi * 7] }; }
      prev = loc; prev.t = t;
      // floor: robot points below the floor plane (y=0) by more than tolerance
      if (rmin.y < -TOL) { let pi = 0; for (let i = 0; i < pts.length; i++) if (pts[i].y < pts[pi].y) pi = i; const k = names[pi] + '|floor'; const d = -rmin.y; if (!hits[k] || d * 100 > hits[k].depthCm) hits[k] = { station: label, part: names[pi], object: 'floor (y=0)', depthCm: +(d * 100).toFixed(1), tMs: Math.round(t), phase }; }
      minY[phase] = Math.min(minY[phase] ?? 9, rmin.y);
      // feet: sliding while in loop phase, floating (lowest robot point above floor)
      if (phase === 'loop') { const f = feet(); for (const k in f) { const tr = footTrack[k] || (footTrack[k] = { first: f[k], max: 0 }); tr.max = Math.max(tr.max, Math.hypot(f[k].x - tr.first.x, f[k].z - tr.first.z)); } if (rmin.y < minSole.y) minSole = { y: rmin.y, tMs: Math.round(t) }; }
      const step = every - (performance.now() - t0 - t); if (step > 4) await new Promise(r => setTimeout(r, step));
    }
    if (act && act.done) await act.done;
    const sliding = Object.fromEntries(Object.entries(footTrack).map(([k, v]) => [k, +(v.max * 100).toFixed(1)]));
    for (const h of Object.values(hitsG)) h.station = label; for (const h of Object.values(cam)) h.station = label;
    // occlusion counts as a glitch only if it lasts >= 3 ray samples (~0.6 s), so a prop briefly crossing the view is ignored
    for (const k of Object.keys(cam)) if (k.startsWith('camera|occluded') && cam[k].count < 3) delete cam[k];
    return { label, samples, geomHits: Object.values(hitsG).sort((a, b) => b.depthCm - a.depthCm), hits: Object.values(hits).sort((a, b) => b.depthCm - a.depthCm), camera: Object.values(cam).sort((a, b) => b.depthCm - a.depthCm), popMax, footSlideCm: sliding, loopMinYcm: minSole.y < 9 ? +(minSole.y * 100).toFixed(1) : null, minYcmByPhase: Object.fromEntries(Object.entries(minY).map(([k, v]) => [k, +(v * 100).toFixed(1)])) };
  }

  // camera rays (needs three.js Raycaster): robot occluded by an opaque object, or geometry within 15 cm in front of the lens
  let rayT = null; const camRays = (t, phase, cam) => {
    if (!rayT) return; const { Raycaster, Vector3 } = rayT; const rc = new Raycaster(); rc.camera = O.camera;
    const isRob = o => isRobotObj(o); const opaque = h => { const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material; return h.object.visible && !(m && (m.transparent || m.depthWrite === false || m.colorWrite === false)) && !h.object.isPoints && !h.object.isLine && !h.object.isSprite; };
    const cp = O.camera.position.clone();
    // a) near-lens: center + 4 corner-ish rays
    for (const [x, y] of [[0, 0], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) { rc.setFromCamera({ x, y }, O.camera); rc.far = 0.25; const h = rc.intersectObjects(O.scene.children, true).find(h => opaque(h) && !isRob(h.object)); if (h) { const k = 'camera|near:' + (h.object.name || h.object.parent?.name || 'mesh'); const d = 25 - h.distance * 100; if (!cam[k] || d > cam[k].depthCm) cam[k] = { station: null, part: 'CAMERA', object: `geometry ${(h.distance * 100).toFixed(0)} cm in front of lens: ${h.object.name || h.object.parent?.name || 'mesh'}`, depthCm: +d.toFixed(1), tMs: Math.round(t), phase }; } }
    // b) robot occlusion: ray to the robot head and chest
    for (const bn of ['head', 'chest']) { const b = rob.getObjectByName(bn); if (!b) continue; const tp = b.getWorldPosition(new Vector3()); const dir = tp.clone().sub(cp); const dist = dir.length(); rc.set(cp, dir.normalize()); rc.far = dist; rc.near = 0;
      const h = rc.intersectObjects(O.scene.children, true).find(h => opaque(h) && !isRob(h.object) && h.distance < dist - 0.25); if (h) { const k = 'camera|occluded:' + bn + ':' + (h.object.name || h.object.parent?.name || 'mesh'); if (!cam[k]) cam[k] = { station: null, part: 'CAMERA', object: `robot ${bn} hidden behind ${h.object.name || h.object.parent?.name || 'mesh'} (${h.distance.toFixed(2)} m from camera)`, depthCm: 0, tMs: Math.round(t), phase, count: 0 }; cam[k].count++; } }
  };
  // ---- contact gate (SPEC 1/1b: sitting rests ON the seat, hands touch surfaces, feet on the floor) ----
  // Review-side table of intended contacts per station (reviewer's reading of SPEC section 1).
  //  kind 'hold' = must stay within TOL for the median of the settled loop; 'tap' = must reach within TOL at least once.
  //  target: 'floor' | 'seat' (contact:'seat' or chair/sofa/seat-named) | regex on collider name | 'any' (any non-floor collider)
  const FEET = { parts: ['lAn', 'rAn'], target: 'floor', kind: 'hold', label: 'feet on floor', each: true };
  const CONTACTS = {
    hunt: [FEET, { parts: ['hips'], target: 'seat', kind: 'hold', label: 'seat on chair' }, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hands on desk/keyboard' }],
    contract: [FEET, { parts: ['hips'], target: 'seat', kind: 'hold', label: 'seat on chair' }, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hand on desk/keyboard' }],
    terminals: [FEET, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hands on terminal keyboard' }],
    stats: [{ parts: ['lAn', 'rAn', 'lKn', 'rKn'], target: 'floor', kind: 'hold', label: 'crouch: feet/knee on floor' }, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hand on safe dial/door' }],
    training: [FEET, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hand writes/points on board' }],
    forge: [FEET, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'hands at workbench/tool' }],
    hq: [FEET, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'taps goal board' }],
    rig: [FEET, { parts: ['lWr', 'lFi', 'lF2', 'rWr', 'rFi', 'rF2'], target: 'any', kind: 'tap', label: 'taps rack/screen' }],
    lounge: [FEET, { parts: ['hips'], target: 'seat', kind: 'hold', label: 'seat on sofa cushion' }, { parts: ['lEl', 'lWr', 'lFi', 'lF2'], target: /sofa_back|sofa_arm/i, kind: 'hold', label: 'left arm resting on sofa back/arm' }],
  };
  const boxDist = (b, p) => { const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y), dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z); return Math.hypot(dx, dy, dz); };
  const liveCols = () => typeof O.colliders === 'function' ? O.colliders().map(c => { let box = c.box; if (!box && c.mesh) { c.mesh.updateMatrixWorld(true); c.mesh.geometry.computeBoundingBox(); box = c.mesh.geometry.boundingBox.clone().applyMatrix4(c.mesh.matrixWorld); } return { name: c.name || '?', contact: c.contact || null, box }; }).filter(c => c.box) : cols;
  const contactCols = target => liveCols().filter(c => c.name !== 'floor' && !/wall|ceil/i.test(c.name) && (target === 'any' ? true : target === 'seat' ? (c.contact === 'seat' || /chair|sofa_seat|seat/i.test(c.name)) : target.test(c.name)));
  async function contactRun(id, settleMs, sampleMs) {
    const spec = CONTACTS[id]; if (!spec) return { id, skipped: 'no contact spec' };
    try { await Promise.race([O.interact(id), new Promise(r => setTimeout(r, 15000))]); } catch {}
    await new Promise(r => setTimeout(r, settleMs));
    const recs = spec.map(c => ({ c, perPart: {}, series: [] }));
    const t0 = performance.now();
    while (performance.now() - t0 < sampleMs) {
      await new Promise(r => requestAnimationFrame(() => r()));
      const { pts, names } = samplePoints();
      for (const r of recs) {
        const cand = r.c.target === 'floor' ? null : contactCols(r.c.target);
        let best = { d: 9 }; const per = {};
        for (let i = 0; i < pts.length; i++) { const bn = names[i].split(':')[0]; if (!r.c.parts.includes(bn)) continue; const p = pts[i];
          let d, obj;
          if (r.c.target === 'floor') { d = Math.max(0, p.y); obj = 'floor'; }
          else { d = 9; for (const c of cand) { const dd = boxDist(c.box, p); if (dd < d) { d = dd; obj = c.name; } } }
          if (!per[bn] || d < per[bn].d) per[bn] = { d, obj };
          if (d < best.d) best = { d, obj, part: bn }; }
        r.series.push({ best, per });
      }
      await new Promise(r => setTimeout(r, 120));
    }
    try { await O.leave?.(); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return { id, checks: recs.map(r => {
      let value, obj, part;
      if (r.c.each) { // every listed part individually (both feet)
        const vals = r.c.parts.map(pn => ({ pn, m: med(r.series.map(s => s.per[pn]?.d ?? 9)) })); const worst = vals.sort((a, b) => b.m - a.m)[0]; value = worst.m; part = worst.pn; obj = 'floor';
      } else if (r.c.kind === 'hold') { value = med(r.series.map(s => s.best.d)); const last = r.series[r.series.length - 1]?.best || {}; obj = last.obj; part = last.part; }
      else { let m = { best: { d: 9 } }; for (const s of r.series) if (s.best.d < m.best.d) m = s; value = m.best.d; obj = m.best.obj; part = m.best.part; }
      return { station: id, label: r.c.label, kind: r.c.kind, part, object: obj, gapCm: +(value * 100).toFixed(1), pass: value <= CTOL };
    }) };
  }
  const CTOL = opts.contactTol ?? 0.03;

  window.__clip = {
    contact: (id, settleMs = 1500, sampleMs = 3000) => contactRun(id, settleMs, sampleMs),
    loadThree: async () => { try { rayT = await import(new URL('vendor/three/three.module.js', location.origin + '/').href); return !!rayT.Raycaster; } catch (e) { return 'three import failed: ' + e.message; } },
    info: { boneVolumes: boneVol.length, room, colliderNames: { walls: cols.filter(c => /wall/i.test(c.name) && !/clock/i.test(c.name)).length, unnamed: cols.filter(c => /^(prop|mesh)$/.test(c.name)).length, detachedMeshRefs: (typeof O.colliders === 'function' ? O.colliders() : []).filter(c => { if (!c.mesh) return false; for (let q = c.mesh; q; q = q.parent) if (q === O.scene) return false; return true; }).length }, colliders: cols.length, colSource, points: sets.reduce((a, s) => a + s.idx.length, 0), robotHook: robotHookShape, collidersHook: typeof O.colliders === 'function' ? 'ok' : 'MISSING', contactColliders: cols.filter(c => c.contact).length },
    station: (id, loopMs, exitMs) => run(id, ctl => {
      const done = (async () => {
        try { await Promise.race([O.interact(id), new Promise(r => setTimeout(r, 15000))]); } catch {}
        ctl.setPhase('loop'); await new Promise(r => setTimeout(r, loopMs));
        ctl.setPhase('exit'); try { await O.leave?.(); } catch {}
        await new Promise(r => setTimeout(r, exitMs));
      })();
      return { done };
    }, 15000 + loopMs + exitMs).catch(e => ({ label: id, error: e.message })),
    shot: (name, ms) => run('shot:' + name, ctl => { O.shot(name); ctl.setPhase('settle'); setTimeout(() => ctl.setPhase('shot'), 400); return { done: new Promise(r => setTimeout(r, ms)) }; }, ms + 500),
    walk: (ms) => run('walk-past-furniture', ctl => {
      const k = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
      ctl.setPhase('idle');
      const seq = [['KeyW', 2200], ['KeyD', 1500], ['KeyS', 2200], ['KeyA', 2600], ['KeyW', 1800], ['KeyD', 1200]];
      const done = (async () => { await new Promise(r => setTimeout(r, 800)); ctl.setPhase('walk'); for (const [c, d] of seq) { k(c, true); await new Promise(r => setTimeout(r, d)); k(c, false); } })();
      void ms;
      return { done };
    }, ms),
  };
  return window.__clip.info;
}

// The station run waits for interact to resolve (enter phase), then `loopMs` of loop, then leave() + exitMs.
async function clipTest(page, ids, { loopMs = 3500, exitMs = 2500, tol = 0.015, tolContact = 0.03, log = console.log } = {}) {
  const info = await page.evaluate(inPageInstall, { tol, tolContact });
  if (!info.error) info.three = await page.evaluate(() => window.__clip.loadThree());
  if (info.error) return { info, results: [], pass: false };
  const results = [];
  await page.evaluate(() => window.Office3D.shot && window.Office3D.shot('gameplay'));
  await page.waitForTimeout(800);
  results.push(await page.evaluate(() => window.__clip.walk(12000)));
  // every standard shot view (walking shots keep the robot moving into whatever is ahead of it)
  const shotNames = await page.evaluate(() => (window.Office3D.shots ? window.Office3D.shots().map(s => s.name) : []));
  for (const n of shotNames) results.push(await page.evaluate(n => window.__clip.shot(n, 1800), n));
  await page.evaluate(() => document.documentElement.classList.remove('o3d-shot'));
  for (const id of ids) {
    await page.evaluate(() => { const O = window.Office3D; O.leave?.(); O.shot && O.shot('gameplay'); });
    await page.waitForTimeout(600);
    const r = await page.evaluate(([id, a, b]) => window.__clip.station(id, a, b), [id, loopMs, exitMs]);
    // station runs end early once the action is done; trim is fine
    results.push(r); log('clip', id, (r.hits || []).length, 'hits', (r.camera || []).length, 'camera');
  }
  const contacts = [];
  for (const id of ids) { await page.evaluate(() => { const O = window.Office3D; O.leave?.(); O.shot && O.shot('gameplay'); }); await page.waitForTimeout(600); const r = await page.evaluate(id => window.__clip.contact(id), id); contacts.push(...(r.checks || [])); log('contact', id, JSON.stringify((r.checks || []).map(c => c.label + ' ' + c.gapCm)), r.skipped || ''); }
  const hits = results.flatMap(r => r.hits || []), cam = results.flatMap(r => r.camera || []), geom = results.flatMap(r => r.geomHits || []);
  const gating = info.colSource === 'hook';
  return { info, results, hits, cam, geom, contacts, gating, pass: gating && info.robotHook === 'ok' && hits.length === 0 && cam.length === 0 };
}

// Dense frame capture of an interaction (enter -> loop -> exit), every ~`every` ms (screenshot latency adds ~60-120 ms).
async function denseFrames(page, id, dir, { enterMs = 4500, loopMs = 1500, exitMs = 2500, every = 120 } = {}) {
  const fs = require('fs'), path = require('path'); fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => { const O = window.Office3D; O.leave?.(); O.shot && O.shot('gameplay'); });
  await page.waitForTimeout(700);
  await page.evaluate(id => { window.__dense = window.Office3D.interact(id); }, id);
  let n = 0; const snap = async () => { await page.screenshot({ path: path.join(dir, String(n++).padStart(3, '0') + '.jpg'), type: 'jpeg', quality: 80 }); await page.waitForTimeout(every); };
  const t0 = Date.now(); while (Date.now() - t0 < enterMs + loopMs) await snap();
  await page.evaluate(() => window.Office3D.leave?.());
  const t1 = Date.now(); while (Date.now() - t1 < exitMs) await snap();
  return n;
}

module.exports = { clipTest, denseFrames, inPageInstall };
