// First Office 3D: the room. Shell, windows, light rig, the stations (one desk per game operation) and set dressing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  C, onPower, tr, X0, X1, Z0, Z1, H, rnd, rr, pick, tex, pbr, canvasTex, box, rbox, cyl, plane, std, group, cable, floorCable,
  screenMat, powerScreen, worn, codeScreen, dashScreen, termScreen, kanbanScreen, ledgerScreen, agentScreen, nodeScreen, courseScreen, gpuScreen,
  docTex, posterTex, stickyMat, place, monitor, laptop, keyboard, mug, coffeeCup, can, papers, crumpled, books, binders, officeChair, desk,
  powerStrip, pcTower, bin, headphones, pizzaBox, backpack, lightCone, hazeMaterial,
} from './kit.js';

export const MOON_DIR = new THREE.Vector3(0.62, -0.5, 0.6).normalize(); // direction the moon/city light travels (from NW, down)
const winLights = [];

// ---------- light helpers ----------
function addLight(l, id, base) { C.scene.add(l); if (l.target) C.scene.add(l.target); C.lights.push(l); if (id) { const k = base ?? l.intensity; onPower(id, on => (l.intensity = on ? k : 0)); } return l; }
function lampPoint(x, y, z, color, intensity, dist, id) { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); return addLight(l, id); }
function rectLight(color, intensity, w, h, pos, look, id) { const l = new THREE.RectAreaLight(color, intensity, w, h); l.position.copy(pos); l.lookAt(look); return addLight(l, id); }
function emissive(color, k) { return new THREE.MeshStandardMaterial({ color: 0, emissive: color, emissiveIntensity: k }); }

// Hanging lamp: a dark metal dome on a cord, with a warm spot below it and a soft haze cone.
function pendant(x, z, drop, o = {}) {
  const M = C.M, color = o.color ?? 0xffbf80, g = group(null, x, H, z);
  cyl(0.004, 0.004, drop, M.rubber, 0, -drop / 2, 0, g, 6, false);
  cyl(0.03, 0.03, 0.02, M.steel, 0, -0.01, 0, g, 12, false);
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.025 + Math.sin(t * Math.PI / 2) * 0.21, -t * 0.22)); }
  const shade = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), std(o.shade ?? 0x1f2a24, 0.35, 0.85, { side: THREE.DoubleSide })); shade.position.y = -drop; shade.castShadow = true; g.add(shade);
  const inner = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p.x - 0.003, p.y)), 32), std(0xf4efe6, 0.6, 0, { side: THREE.BackSide })); inner.position.y = -drop; g.add(inner);
  const bulbM = emissive(color, 5), bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), bulbM); bulb.position.y = -drop - 0.12; g.add(bulb);
  const l = new THREE.SpotLight(color, o.intensity ?? 28, 8, o.angle ?? 0.95, 0.7, 2); l.position.set(x, H - drop - 0.13, z); l.target.position.set(x + (o.tx || 0), 0, z + (o.tz || 0));
  if (o.shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0003; l.shadow.normalBias = 0.02; l.shadow.radius = 5; l.shadow.camera.near = 0.15; l.shadow.camera.far = 6; }
  addLight(l, o.id);
  const cone = lightCone(null, x, H - drop - 0.14, z, 0.19, 1.15, H - drop - 0.14, color, o.haze ?? 0.1);
  if (o.id) onPower(o.id, on => { bulbM.emissiveIntensity = on ? 5 : 0.02; cone.visible = on; });
  return l;
}

// A rug: 8 mm pile slab with a rounded edge, so it sits on the floor and catches a contact line instead of floating.
function rugSlab(parent, w, d, mat, x, z) {
  const geo = new RoundedBoxGeometry(w, 0.01, d, 2, 0.004), uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, 0.5 - pos.getZ(i) / d); // planar top-down UVs
  const m = new THREE.Mesh(geo, mat); m.position.set(x, 0.005, z); m.receiveShadow = true; parent.add(m); return m;
}

// ---------- walls, windows, blinds ----------
function wallPanel(axis, at, a0, a1, y0, y1, mat, s, inward) {
  const w = a1 - a0, h = y1 - y0, t = 0.3;
  const m = axis === 'z' ? box(w, h, t, mat, (a0 + a1) / 2, (y0 + y1) / 2, at - inward * t / 2, s) : box(t, h, w, mat, at - inward * t / 2, (y0 + y1) / 2, (a0 + a1) / 2, s);
  C.occluders.push(m); return m;
}
function wallWithWindows(axis, at, a0, a1, wins, sill, head, mat, s, inward) {
  let cur = a0;
  for (const w of wins) {
    if (w.a0 > cur) wallPanel(axis, at, cur, w.a0, 0, H, mat, s, inward);
    wallPanel(axis, at, w.a0, w.a1, 0, sill, mat, s, inward);
    wallPanel(axis, at, w.a0, w.a1, head, H, mat, s, inward);
    windowFrame(axis, at, w.a0, w.a1, sill, head, inward, w.blind);
    cur = w.a1;
  }
  if (cur < a1) wallPanel(axis, at, cur, a1, 0, H, mat, s, inward);
}
function windowFrame(axis, at, a0, a1, y0, y1, inward, blind) {
  const M = C.M, g = new THREE.Group(), w = a1 - a0, h = y1 - y0, f = 0.06;
  const put = (mw, mh, x, y, d = 0.08) => box(mw, mh, d, M.steel, x, y, 0, 1, g);
  put(w, f, 0, -h / 2 + f / 2); put(w, f, 0, h / 2 - f / 2); put(f, h, -w / 2 + f / 2, 0); put(f, h, w / 2 - f / 2, 0);
  const cols = Math.max(2, Math.round(w / 0.8)), rows = 3;
  for (let i = 1; i < cols; i++) put(0.035, h, -w / 2 + (w * i) / cols, 0, 0.06);
  for (let j = 1; j < rows; j++) put(w, 0.035, 0, -h / 2 + (h * j) / rows, 0.06);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass); glass.position.z = -0.01; glass.userData.noAO = true; g.add(glass);
  // deep concrete sill with some clutter later
  box(w + 0.12, 0.05, 0.3, M.concrete, 0, -h / 2 - 0.025, 0.12, 0.8, g);
  if (blind) { // venetian blind lowered to `blind` (0..1) of the window, slats tilted: casts striped moonlight
    const drop = h * blind, n = Math.floor(drop / 0.032), slat = new THREE.BoxGeometry(w - 0.04, 0.003, 0.048);
    const im = new THREE.InstancedMesh(slat, std(0x9c9890, 0.7, 0.05), n), o = new THREE.Object3D();
    for (let i = 0; i < n; i++) { o.position.set(0, h / 2 - 0.06 - i * 0.032, 0.09); o.rotation.set(0.55, 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
    im.castShadow = true; im.receiveShadow = true; g.add(im);
    box(w - 0.02, 0.05, 0.06, std(0xd8d4ca, 0.5), 0, h / 2 - 0.03, 0.09, 1, g);
    box(w - 0.04, 0.012, 0.05, std(0xc9c5bb, 0.5), 0, h / 2 - 0.06 - n * 0.032, 0.09, 1, g);
    cyl(0.002, 0.002, drop + 0.3, std(0xeeeeee, 0.6), w / 2 - 0.1, h / 2 - drop / 2 - 0.15, 0.12, g, 4, false);
  }
  if (axis === 'z') { g.position.set((a0 + a1) / 2, (y0 + y1) / 2, at); if (inward < 0) g.rotation.y = Math.PI; }
  else { g.position.set(at, (y0 + y1) / 2, (a0 + a1) / 2); g.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2; }
  C.scene.add(g);
  // cool city glow through the glass (no shadows)
  (C.windows || (C.windows = [])).push({ axis, at, a0, a1, y0, y1, inward, blind: blind || 0 });
  if (axis === 'x') { const l = new THREE.RectAreaLight(0x6f8fd8, 1.8, w, h); l.position.copy(g.position); l.rotation.copy(g.rotation); l.rotateY(Math.PI); l.translateZ(-0.05); C.scene.add(l); winLights.push(l); }
  // light shaft volume along the moonlight direction, cross-section ~ the window
  g.updateMatrixWorld(true);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion), v = MOON_DIR.clone().negate(), ww = new THREE.Vector3().crossVectors(u, v).normalize(); u.crossVectors(v, ww).normalize();
  const len = 4.6, geo = new THREE.BoxGeometry(w * 0.92, len, h * 0.8); geo.translate(0, -len / 2, 0);
  const sh = new THREE.Mesh(geo, hazeMaterial(0x9db6ff, blind ? 0.04 : 0.06, { len })); sh.renderOrder = 10; sh.userData.noAO = true;
  sh.matrixAutoUpdate = false; sh.matrix.makeBasis(u, v, ww).setPosition(g.position.clone().add(new THREE.Vector3(0, 0, 0))); C.scene.add(sh);
}

// ---------- shell ----------
export function buildShell() {
  const M = C.M;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); floor.receiveShadow = true;
  const uv = floor.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 2.2, uv.getY(i) * (Z1 - Z0) / 2.2);
  C.scene.add(floor); C.occluders.push(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), M.ceiling);
  ceil.rotation.x = Math.PI / 2; ceil.position.set((X0 + X1) / 2, H, (Z0 + Z1) / 2); ceil.receiveShadow = true;
  const cu = ceil.geometry.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * (X1 - X0) / 3, cu.getY(i) * (Z1 - Z0) / 3);
  // baked ceiling bounce: soft pools above the lamps, cool spill near the windows, magenta from the neon
  const lm = canvasTex(512, 384, (g, w, h) => {
    const sx = w / (X1 - X0), sz = h / (Z1 - Z0), P = (x, z) => [(x - X0) * sx, (z - Z0) * sz];
    g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, w, h);
    const blob = (x, z, r, col) => { const [px, pz] = P(x, z), gr = g.createRadialGradient(px, pz, 0, px, pz, r * sx); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    g.globalCompositeOperation = 'lighter';
    for (const [x, z] of [[7.125, 4.15], [2.6, 2.7], [10.1, 8.0], [3.75, 7.95]]) blob(x, z, 1.8, 'rgba(255,170,100,.55)');
    for (const [x, z] of [[5.5, 4.2], [9.5, 4.2], [5.5, 7.6], [9.5, 7.6]]) blob(x, z, 1.6, 'rgba(255,230,200,.35)');
    blob(7.5, 1.0, 2.6, 'rgba(255,80,190,.45)'); blob(13.1, 8.3, 1.8, 'rgba(80,230,210,.35)'); blob(13.2, 9.4, 1.4, 'rgba(60,160,255,.3)');
    for (const z of [3.0, 7.5]) blob(X0 + 0.3, z, 2.6, 'rgba(120,150,255,.35)');
    for (const x of [2.9, 12.1]) blob(x, Z0 + 0.3, 2.2, 'rgba(120,150,255,.3)');
    for (const z of [4.45, 6.7, 8.05]) blob(X1 - 0.2, z, 1.2, 'rgba(255,180,110,.4)');
    blob(3.6, Z1 - 0.8, 2.0, 'rgba(255,170,100,.45)'); blob(10.6, Z1 - 0.4, 1.4, 'rgba(255,190,130,.35)');
  });
  lm.repeat.set(3 / (X1 - X0), 3 / (Z1 - Z0)); lm.flipY = false;
  ceil.material = M.ceiling.clone(); ceil.material.lightMap = lm; ceil.material.lightMapIntensity = 1.5;
  C.scene.add(ceil); C.occluders.push(ceil);
  // North: exposed brick with two big loft windows either side of HQ. West: tall windows between brick piers.
  wallWithWindows('z', Z0, X0, X1, [{ a0: 1.25, a1: 4.6, blind: 0.45 }, { a0: 10.4, a1: 13.75, blind: 0.25 }], 0.75, 2.85, M.brick, 1.3, 1);
  wallWithWindows('x', X0, Z0, Z1, [{ a0: 1.4, a1: 4.6, blind: 0.6 }, { a0: 5.4, a1: 9.6, blind: 0.4 }], 0.6, 2.85, M.brick, 1.3, 1);
  // East and South: painted plaster with a dark wainscot band.
  wallPanel('x', X1, Z0, Z1, 0, H, M.plasterDark, 2.5, -1);
  wallPanel('z', Z1, X0, X1, 0, H, M.plaster, 2.5, -1);
  const wains = std(0x1e2526, 0.55, 0.1);
  box(X1 - X0, 1.0, 0.025, wains, (X0 + X1) / 2, 0.5, Z1 - 0.012, 1, null, false);
  box(X1 - X0, 0.03, 0.04, std(0x111516, 0.4), (X0 + X1) / 2, 1.0, Z1 - 0.02, 1, null, false);
  // skirting boards
  const sk = std(0x16191a, 0.5);
  box(0.025, 0.12, Z1 - Z0, sk, X1 - 0.012, 0.06, (Z0 + Z1) / 2, 1, null, false); box(X1 - X0, 0.12, 0.03, sk, (X0 + X1) / 2, 0.06, Z1 - 0.03, 1, null, false);
  box(0.03, 0.12, Z1 - Z0, sk, X0 + 0.015, 0.06, (Z0 + Z1) / 2, 1, null, false); box(X1 - X0, 0.12, 0.03, sk, (X0 + X1) / 2, 0.06, Z0 + 0.015, 1, null, false);
  // exposed steel beams, a round duct and a cable tray on the ceiling (loft)
  for (const x of [3.5, 7.5, 11.5]) { box(0.2, 0.34, Z1 - Z0, M.steel, x, H - 0.17, (Z0 + Z1) / 2); for (let z = Z0 + 0.6; z < Z1; z += 0.9) cyl(0.012, 0.012, 0.02, M.steelLight, x + 0.1, H - 0.05, z, null, 6, false).rotation.z = Math.PI / 2; }
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, X1 - X0, 24, 1, true), std(0x9da2a6, 0.42, 0.9, { side: THREE.DoubleSide }));
  duct.rotation.z = Math.PI / 2; duct.position.set((X0 + X1) / 2, H - 0.55, 9.7); duct.castShadow = true; C.scene.add(duct);
  for (let x = 1.5; x < X1; x += 1.6) cyl(0.215, 0.215, 0.04, M.steelLight, x, H - 0.55, 9.7, null, 24).rotation.z = Math.PI / 2;
  for (let x = 2; x < X1; x += 3) box(0.02, 0.32, 0.02, M.steel, x, H - 0.2, 9.7);
  for (const z of [3.2, 7.0]) { // wire cable tray with a bundle of cables
    const trayM = std(0x8a8d90, 0.4, 0.9);
    box(X1 - X0 - 0.4, 0.01, 0.3, trayM, (X0 + X1) / 2, H - 0.42, z, 1, null, false);
    for (const s of [-1, 1]) box(X1 - X0 - 0.4, 0.06, 0.008, trayM, (X0 + X1) / 2, H - 0.39, z + s * 0.15, 1, null, false);
    for (let x = 1.4; x < X1 - 0.3; x += 1.8) for (const s of [-1, 1]) cyl(0.004, 0.004, 0.42, trayM, x, H - 0.21, z + s * 0.15, null, 4, false);
    for (let i = 0; i < 5; i++) cable(null, [[X0 + 0.3, H - 0.4, z - 0.1 + i * 0.05], [7, H - 0.395, z - 0.1 + i * 0.05 + rr(-0.02, 0.02)], [X1 - 0.3, H - 0.4, z - 0.1 + i * 0.05]], 0.008, std(pick([0x1a1a1a, 0x2a4f8a, 0x8a2a2a, 0xcfcfcf]), 0.6));
  }
  // sprinkler pipe with heads
  const red = std(0x8c1b14, 0.45, 0.3);
  const sp = cyl(0.025, 0.025, Z1 - Z0, red, 5.4, H - 0.12, (Z0 + Z1) / 2, null, 10, false); sp.rotation.x = Math.PI / 2;
  for (let z = Z0 + 1.2; z < Z1; z += 2.4) { cyl(0.008, 0.008, 0.1, M.brass, 5.4, H - 0.18, z, null, 6, false); cyl(0.025, 0.01, 0.02, M.brass, 5.4, H - 0.24, z, null, 8, false); }
  // door on the south wall
  const door = group(null, 7.1, 0, Z1 - 0.02);
  box(1.12, 2.24, 0.06, std(0x15191b, 0.5, 0.6), 0, 1.12, 0, 1, door);
  box(0.94, 2.12, 0.04, M.walnut, 0, 1.06, -0.03, 1, door);
  const dw = plane(0.22, 0.9, new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.15, transmission: 0, metalness: 0.2 }), 0.25, 1.45, -0.052, door); dw.rotation.y = Math.PI;
  cyl(0.012, 0.012, 0.16, M.alu, -0.38, 1.05, -0.08, door).rotation.x = Math.PI / 2;
  box(0.02, 0.4, 0.02, M.alu, -0.38, 1.05, -0.12, 1, door);
  const exit = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#0b3d1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#5dff9a'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.fillText('EXIT', w / 2, 68); });
  const ex = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.05), [M.plastic, M.plastic, M.plastic, M.plastic, M.plastic, new THREE.MeshStandardMaterial({ map: exit, emissiveMap: exit, emissive: 0xffffff, emissiveIntensity: 1.4 })]);
  ex.rotation.y = Math.PI; ex.position.set(7.1, 2.45, Z1 - 0.04); C.scene.add(ex);
  // light switch, thermostat and outlets
  box(0.08, 0.12, 0.012, std(0xe8e6e0, 0.4), 6.35, 1.2, Z1 - 0.01);
  for (const [x, z, ry] of [[6.2, Z1 - 0.01, 0], [X1 - 0.01, 3.9, Math.PI / 2], [X1 - 0.01, 8.5, Math.PI / 2], [9.0, Z1 - 0.01, 0]]) { const o = box(0.08, 0.12, 0.012, std(0xe8e6e0, 0.4), x, 0.3, z); o.rotation.y = ry; }
}

// The city outside: a far night panorama (Poly Haven "shanghai_bund", CC0) pushed back to 150 m, and in front of it a
// procedural block of towers with lit window grids at 15-110 m, so the view through the glass has real parallax depth.
function facadeTex(kind, seed) {
  let sd = seed; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = kind === 2 ? '#0c141e' : '#0b0d11'; g.fillRect(0, 0, w, h);
    const cols = kind === 1 ? 8 : 6, rows = kind === 1 ? 20 : 14, cw = w / cols, rh = h / rows;
    const warm = ['#ffd9a0', '#ffe6c2', '#ffc983', '#fff1dc'], cool = ['#a9cdfa', '#cfe3ff', '#8fb6e8'];
    for (let y = 0; y < rows; y++) {
      const floorOn = r() < 0.55; // whole floors tend to be lit or dark
      for (let x = 0; x < cols; x++) {
        const on = floorOn ? r() < 0.75 : r() < 0.12;
        g.fillStyle = on ? (r() < 0.75 ? warm : cool)[Math.floor(r() * 3)] : (kind === 2 ? '#18283a' : '#151a22');
        g.globalAlpha = on ? 0.25 + r() * 0.6 : 1;
        if (kind === 2) g.fillRect(x * cw + 1, y * rh + 1, cw - 2, rh - 2);
        else g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.22, cw * 0.64, rh * 0.56);
        if (on && r() < 0.3) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.22, cw * 0.64 * r(), rh * 0.56); } // blinds
      }
    }
    g.globalAlpha = 1;
    if (kind !== 2) { g.fillStyle = 'rgba(255,255,255,.04)'; for (let y = 0; y < rows; y++) g.fillRect(0, y * rh, w, 2); }
  }, { repeat: true });
}
export function buildSkyline(yaw) {
  const t = tex('sky/skyline.jpg', true); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  const R = 150, top = R * Math.tan(THREE.MathUtils.degToRad(50.4)), bot = R * Math.tan(THREE.MathUtils.degToRad(28.6));
  t.repeat.x = -1; const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, top + bot, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, color: 0x6a7490 }));
  m.position.set((X0 + X1) / 2, (top - bot) / 2 - 14, (Z0 + Z1) / 2); m.rotation.y = yaw; C.scene.add(m);
  // street level: dark asphalt with sodium street-light pools and car light streaks
  const st = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#06080b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { const y = 60 + i * 80; g.fillStyle = '#0d1014'; g.fillRect(0, y, w, 26); g.fillRect(y, 0, 26, h); }
    for (let i = 0; i < 260; i++) { const x = rnd() * w, y = rnd() * h, r = rr(6, 22), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,170,80,.55)'); gr.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 120; i++) { const y = 60 + Math.floor(rnd() * 12) * 80 + rr(4, 22), x = rnd() * w; g.fillStyle = rnd() < 0.5 ? 'rgba(255,60,40,.8)' : 'rgba(255,245,220,.8)'; g.fillRect(x, y, rr(8, 30), 2); }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: st, color: 0xaaaaaa })); ground.rotation.x = -Math.PI / 2; ground.position.set(7, -9, 5); C.scene.add(ground);
  // towers
  const facs = [0, 1, 2, 0, 1, 2].map((k, i) => facadeTex(k, 11 + i * 97)), roofM = new THREE.MeshBasicMaterial({ color: 0x07090c });
  const haze = new THREE.Color(0x1b2436), cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  let n = 0;
  for (let tries = 0; tries < 600 && n < 75; tries++) {
    const x = rr(-110, 40), z = rr(-110, 40);
    if (!(x < -6 || z < -6)) continue;
    const d = Math.hypot(x - cx, z - cz); if (d < 28 || d > 125) continue;
    const w = rr(10, 26), dd = rr(10, 26), hgt = d < 45 ? rr(14, 45) : rr(30, 120);
    const fi = Math.floor(rnd() * facs.length), ft = facs[fi].clone(); ft.needsUpdate = true; ft.repeat.set(Math.max(1, Math.round(w / ((fi % 3) === 1 ? 14 : 11))), Math.max(1, Math.round(hgt / ((fi % 3) === 1 ? 60 : 44))));
    const k = Math.min(1, (d - 28) / 100), fm = new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(0.8, 0.8, 0.82).lerp(haze, k * 0.7) });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, dd), [fm, fm, roofM, roofM, fm, fm]); b.position.set(x, -9 + hgt / 2, z); b.rotation.y = rr(-0.2, 0.2) + (rnd() < 0.5 ? 0 : Math.PI / 2); C.scene.add(b);
    if (hgt > 50 && rnd() < 0.7) { const bl = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.2, 0.15) })); bl.position.set(x, -9 + hgt + 1, z); C.scene.add(bl); }
    n++;
  }
}

// ---------- global light rig ----------
export function buildLightRig() {
  C.scene.add(new THREE.HemisphereLight(0x5d6c94, 0x3a2a20, 0.3));
  // moon / city glow through the NW windows: the one big shadow caster (window mullions and blind slats)
  const moon = new THREE.DirectionalLight(0x9db2e6, 1.25);
  const c = new THREE.Vector3((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  moon.position.copy(c).addScaledVector(MOON_DIR, -14); moon.target.position.copy(c);
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03; moon.shadow.radius = 3;
  Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
  C.scene.add(moon, moon.target); C.lights.push(moon); C.moon = moon;
  // linear LED fixtures between the beams, dimmed for the night
  for (const [x, z] of [[5.5, 4.2], [9.5, 4.2], [5.5, 7.6], [9.5, 7.6]]) {
    box(0.08, 0.04, 1.6, C.M.steel, x, H - 0.25, z, 1, null, false);
    plane(0.05, 1.55, emissive(0xfff0dd, 2.2), x, H - 0.275, z).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) cyl(0.002, 0.002, 0.23, C.M.rubber, x, H - 0.115, z + s * 0.7, null, 4, false);
  }
}

// ================= stations =================
function stationGroup(id) { const g = new THREE.Group(); g.name = id; C.scene.add(g); C.groups[id] = g; return g; }
// little "standby" ribbon over powered-down desks
function standbyTag(g, x, y, z, ry, id) {
  const t = canvasTex(256, 64, (q, w, h) => { q.fillStyle = '#f5c518'; q.fillRect(0, 0, w, h); q.fillStyle = '#111'; for (let i = -2; i < 12; i++) { q.beginPath(); q.moveTo(i * 28, 0); q.lineTo(i * 28 + 14, 0); q.lineTo(i * 28 - 6, h); q.lineTo(i * 28 - 20, h); q.fill(); } q.fillStyle = '#f5c518'; q.fillRect(40, 16, 176, 32); q.fillStyle = '#111'; q.font = 'bold 22px Arial'; q.textAlign = 'center'; q.fillText('NOT YET OPEN', 128, 40); });
  const m = plane(0.5, 0.125, new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide }), x, y, z, g); m.rotation.y = ry; m.rotation.z = rr(-0.08, 0.08);
  onPower(id, on => (m.visible = !on));
}

function buildHunt() { // Founder Workstation: triple monitors, the main desk.
  const id = 'hunt', r = tr(8, 5, 3, 1), g = stationGroup(id), M = C.M, y = 0.74, dz = r.cz - 0.02;
  desk(g, r.cx, dz, 2.0, 0.8, 0, M.walnut, 0.74, { drawers: -1 });
  monitor(g, r.cx, y, dz - 0.2, 0, 0.62, 0.36, codeScreen(11, true), { k: 1.6, id, sticky: 2 });
  monitor(g, r.cx - 0.66, y, dz - 0.14, 0.38, 0.55, 0.32, dashScreen(5), { id, sticky: 1 });
  monitor(g, r.cx + 0.66, y, dz - 0.14, -0.38, 0.55, 0.32, termScreen(9), { id });
  keyboard(g, r.cx - 0.05, y, dz + 0.17, 0);
  mug(g, r.cx + 0.52, y, dz + 0.22, 0x253a52);
  coffeeCup(g, r.cx + 0.78, y, dz + 0.05);
  can(g, r.cx - 0.5, y, dz + 0.27, 0x1d8fd6); can(g, r.cx - 0.85, y, dz + 0.3, 0xd61d4a, true);
  papers(g, r.cx - 0.72, y, dz + 0.12, 5);
  headphones(g, r.cx + 0.35, y, dz + 0.28, 0.6);
  place('desk_lamp_arm_01', r.cx + 0.85, y, dz - 0.25, -2.2, 1, g);
  lampPoint(r.cx + 0.66, y + 0.45, dz - 0.12, 0xffb46b, 0.45, 2.2, id);
  place('potted_plant_04', r.cx - 0.88, y, dz - 0.27, 0.4, 1.2, g);
  place('office_notepads', r.cx - 0.1, y, dz + 0.31, 0.1, 0.5, g, { pick: /sticky_stack/, shadow: false });
  place('round_spectacles', r.cx + 0.2, y, dz + 0.3, 2.4, 1, g, { shadow: false });
  place('alarm_clock_01', r.cx - 0.95, y, dz + 0.0, 0.7, 0.9, g, { shadow: false });
  pcTower(g, r.cx + 0.72, dz + 0.02, 0, 0x6a5cff, id);
  officeChair(g, r.cx + 0.05, dz + 0.72, 0.15, { jacket: 0x3b2f2a });
  backpack(g, r.cx - 0.55, dz + 0.75, 0.5, 0x2c3540);
  bin(g, r.cx - 1.25, dz + 0.1);
  powerStrip(g, r.cx + 0.2, dz - 0.2, 0.3);
  cable(g, [[r.cx, y + 0.12, dz - 0.26], [r.cx + 0.1, y - 0.1, dz - 0.36], [r.cx + 0.2, 0.3, dz - 0.36], [r.cx + 0.25, 0.02, dz - 0.25]]);
  cable(g, [[r.cx - 0.66, y + 0.1, dz - 0.22], [r.cx - 0.5, y - 0.15, dz - 0.36], [r.cx - 0.2, 0.25, dz - 0.38], [r.cx + 0.1, 0.02, dz - 0.22]]);
  cable(g, [[r.cx + 0.66, y + 0.1, dz - 0.22], [r.cx + 0.5, y - 0.2, dz - 0.36], [r.cx + 0.35, 0.02, dz - 0.25]]);
  floorCable(g, [r.cx + 0.2, dz - 0.2], [r.cx + 1.6, dz - 0.6]);
  // nameplate
  const np = canvasTex(256, 64, (q, w, h) => { q.fillStyle = '#1a1612'; q.fillRect(0, 0, w, h); q.fillStyle = '#d9b77a'; q.font = 'bold 26px Georgia'; q.textAlign = 'center'; q.fillText('FOUNDER', w / 2, 42); });
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.02), [M.brass, M.brass, M.brass, M.brass, new THREE.MeshStandardMaterial({ map: np, roughness: 0.4, metalness: 0.3 }), M.brass]); pl.position.set(r.cx + 0.3, y + 0.025, dz + 0.36); pl.rotation.x = -0.4; g.add(pl);
  rugSlab(g, 3.4, 2.4, M.rug, r.cx, dz + 0.35);
  pendant(r.cx, dz + 0.05, 1.25, { shadow: true, id, intensity: 26 });
  rectLight(0x7fb0ff, 3.2, 1.6, 0.35, new THREE.Vector3(r.cx, y + 0.3, dz - 0.15), new THREE.Vector3(r.cx, y + 0.3, dz + 2), id);
  standbyTag(g, r.cx, y + 0.5, dz - 0.18, 0, id);
}
function buildContract() { // Ops Center: contracts come in here.
  const id = 'contract', r = tr(2, 3, 3, 1), g = stationGroup(id), M = C.M, y = 0.74;
  desk(g, r.cx, r.cz, 2.1, 0.75, 0, M.oak, 0.74, { drawers: 1 });
  monitor(g, r.cx - 0.36, y, r.cz - 0.16, 0.12, 0.6, 0.34, kanbanScreen(21), { id, sticky: 2 });
  monitor(g, r.cx + 0.36, y, r.cz - 0.16, -0.12, 0.6, 0.34, dashScreen(31, '#f0883e', 'Ops · SLAs'), { id });
  keyboard(g, r.cx, y, r.cz + 0.16, 0);
  mug(g, r.cx - 0.75, y, r.cz + 0.12, 0xb3261e);
  place('stationery_supplies', r.cx + 0.78, y + 0.07, r.cz + 0.08, -0.4, 1, g, { shadow: false });
  place('clipboard', r.cx - 0.55, y, r.cz + 0.22, 0.6, 1, g, { shadow: false });
  place('binder_notebook', r.cx + 0.45, y, r.cz + 0.26, 0.2, 1, g, { pick: /closed/, shadow: false });
  // desk phone
  const ph = group(g, r.cx - 0.8, y, r.cz - 0.12, 0.3); rbox(0.2, 0.05, 0.18, 0.02, M.plastic, 0, 0.025, 0, ph); rbox(0.2, 0.04, 0.05, 0.02, M.plastic, 0, 0.07, -0.05, ph);
  officeChair(g, r.cx + 0.1, r.cz + 0.68, -0.2, { mat: M.leatherBrown });
  pcTower(g, r.cx - 0.8, r.cz + 0.05, 0, 0xff7a2b, id);
  for (let i = 0; i < 2; i++) { box(0.26, 0.05, 0.34, std(0x232528, 0.4, 0.8), r.cx + 0.82, y + 0.025 + i * 0.07, r.cz - 0.2, 1, g); papers(g, r.cx + 0.82, y + 0.03 + i * 0.07, r.cz - 0.2, 3, 0.15); }
  bin(g, r.cx + 1.25, r.cz + 0.15);
  // contract corkboard on an easel behind the desk: pinned contracts, red string
  const cork = canvasTex(1024, 640, (q, w, h) => {
    q.fillStyle = '#a77b4f'; q.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { q.fillStyle = `rgba(${rnd() < 0.5 ? '70,40,20' : '220,180,130'},.25)`; q.fillRect(rnd() * w, rnd() * h, 2, 2); }
    const pins = [];
    for (let i = 0; i < 9; i++) { const x = 60 + (i % 3) * 320 + rr(-30, 30), yy = 50 + Math.floor(i / 3) * 200 + rr(-20, 20); q.save(); q.translate(x + 90, yy + 70); q.rotate(rr(-0.1, 0.1)); q.fillStyle = i % 4 === 1 ? '#ffe873' : '#f2efe6'; q.fillRect(-90, -70, 180, 140); q.fillStyle = '#333'; q.font = 'bold 18px Arial'; q.fillText(pick(['ACME PAY', 'GLOBEX', 'INITECH', 'HOOLI', 'UMBRA', 'NORTHWIND']), -78, -40); for (let k = 0; k < 6; k++) { q.fillStyle = 'rgba(40,40,40,.5)'; q.fillRect(-78, -22 + k * 14, rr(80, 150), 4); } q.restore(); pins.push([x + 90, yy + 6]); q.fillStyle = '#c0392b'; q.beginPath(); q.arc(x + 90, yy + 6, 7, 0, 7); q.fill(); }
    q.strokeStyle = '#c0392b'; q.lineWidth = 3; q.beginPath(); [0, 4, 2, 7, 5].forEach((k, i) => (i ? q.lineTo(...pins[k]) : q.moveTo(...pins[k]))); q.stroke();
  });
  const easel = group(g, r.cx + 0.2, 0, r.z0 - 0.75);
  box(1.6, 1.0, 0.03, new THREE.MeshStandardMaterial({ map: cork, roughness: 0.95 }), 0, 1.35, 0, 1, easel);
  box(1.66, 1.06, 0.02, M.oak, 0, 1.35, -0.02, 1, easel);
  for (const s of [-1, 1]) { box(0.04, 1.85, 0.04, M.steel, s * 0.82, 0.93, -0.03, 1, easel); box(0.04, 0.04, 0.55, M.steel, s * 0.82, 0.03, -0.03, 1, easel); }
  C.colliders.push({ x0: r.cx + 0.2 - 0.9, x1: r.cx + 0.2 + 0.9, z0: r.z0 - 1.05, z1: r.z0 - 0.45 });
  // printer on a low cabinet next to the window
  const pc = group(g, X0 + 0.45, 0, r.cz + 0.9, Math.PI / 2);
  rbox(0.8, 0.6, 0.5, 0.012, worn(0x3a3f44), 0, 0.3, 0, pc);
  rbox(0.5, 0.3, 0.42, 0.02, M.plasticWhite, 0, 0.75, 0, pc); box(0.36, 0.02, 0.2, M.plastic, 0, 0.91, 0.08, 1, pc); papers(pc, 0, 0.66, 0.28, 2, 0.05);
  const pled = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.005), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 0.6) })); pled.position.set(0.2, 0.86, 0.21); pc.add(pled);
  binders(pc, -0.38, 0.6, -0.05, 4, 0);
  C.colliders.push({ x0: X0, x1: X0 + 0.75, z0: r.cz + 0.45, z1: r.cz + 1.35 });
  pendant(r.cx, r.cz + 0.05, 1.2, { id, intensity: 22, color: 0xffc890 });
  lampPoint(r.cx, y + 0.3, r.cz + 0.05, 0xffa060, 0.9, 2.2, id);
  standbyTag(g, r.cx, y + 0.5, r.cz - 0.2, 0, id);
}
function buildStats() { // Ledger Vault: a floor safe, ledgers, a banker's lamp, the cash counter.
  const id = 'stats', r = tr(17, 3, 1, 2), g = stationGroup(id), M = C.M;
  const safe = group(g, r.cx + 0.05, 0, r.z0 + 0.42, -Math.PI / 2);
  const sm = worn(0x2c3a33, { roughness: 0.6, metalness: 0.6, ns: 0.5 });
  rbox(0.66, 1.05, 0.62, 0.03, sm, 0, 0.525, 0, safe);
  rbox(0.56, 0.92, 0.04, 0.015, std(0x34423b, 0.28, 0.8), 0, 0.53, 0.32, safe);
  const dial = cyl(0.07, 0.07, 0.03, M.brass, 0.1, 0.68, 0.35, safe, 32); dial.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) { const s = cyl(0.008, 0.008, 0.16, M.alu, -0.1, 0.55, 0.36, safe, 8); s.rotation.z = (i / 3) * Math.PI; }
  cyl(0.025, 0.025, 0.05, M.alu, -0.1, 0.55, 0.35, safe, 16).rotation.x = Math.PI / 2;
  for (const yy of [0.25, 0.85]) cyl(0.02, 0.02, 0.1, M.steelLight, 0.29, yy, 0.33, safe, 12);
  books(safe, -0.27, 1.05, -0.05, 6, 0, true);
  // cash stacks + banker's lamp on the safe
  const cashT = canvasTex(128, 64, (q, w, h) => { q.fillStyle = '#5f7f5a'; q.fillRect(0, 0, w, h); q.strokeStyle = '#2f4a2c'; q.strokeRect(6, 6, w - 12, h - 12); q.fillStyle = '#d8c79a'; q.fillRect(54, 0, 20, h); q.fillStyle = '#2f4a2c'; q.font = 'bold 20px Georgia'; q.fillText('100', 12, 40); });
  const cashM = [std(0xcdd5bf, 0.9), std(0xcdd5bf, 0.9), new THREE.MeshStandardMaterial({ map: cashT, roughness: 0.8 }), std(0xcdd5bf, 0.9), std(0xcdd5bf, 0.9), std(0xcdd5bf, 0.9)];
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.03, 0.066), cashM); s.position.set(0.02 + (i % 2) * 0.06, 1.065 + Math.floor(i / 2) * 0.031, -0.12 + (i % 3) * 0.08); s.rotation.y = rr(-0.3, 0.3); safe.add(s); }
  cyl(0.06, 0.07, 0.02, M.brass, 0.18, 1.06, 0.12, safe); cyl(0.008, 0.008, 0.3, M.brass, 0.18, 1.21, 0.12, safe);
  const shadeOn = new THREE.MeshStandardMaterial({ color: 0x0f5a2c, roughness: 0.12, emissive: 0x1a8a45, emissiveIntensity: 0.9, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 20, 1, true, 0, Math.PI), shadeOn);
  shade.rotation.z = Math.PI / 2; shade.position.set(0.18, 1.36, 0.14); safe.add(shade);
  const lb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), emissive(0xffd29a, 3)); lb.position.set(0.18, 1.33, 0.14); safe.add(lb);
  onPower(id, on => { shade.material.emissiveIntensity = on ? 0.9 : 0; lb.material.emissiveIntensity = on ? 3 : 0; });
  lampPoint(r.cx - 0.25, 1.28, r.z0 + 0.3, 0xffc27a, 1.8, 2.6, id);
  // filing cabinet
  const fc = group(g, r.cx + 0.05, 0, r.z1 - 0.32, -Math.PI / 2);
  rbox(0.46, 1.32, 0.6, 0.012, worn(0x5d6466, { ns: 0.45 }), 0, 0.66, 0, fc);
  for (let i = 0; i < 4; i++) { box(0.42, 0.3, 0.01, std(0x6b7376, 0.38, 0.7), 0, 0.18 + i * 0.32, 0.305, 1, fc); box(0.12, 0.015, 0.025, M.alu, 0, 0.27 + i * 0.32, 0.32, 1, fc); box(0.08, 0.04, 0.003, M.paper, 0, 0.22 + i * 0.32, 0.312, 1, fc); }
  place('ceramic_vase_01', r.cx + 0.05, 1.32, r.z1 - 0.2, 0, 0.6, g);
  binders(g, r.cx - 0.1, 1.32, r.z1 - 0.48, 3, Math.PI / 2);
  // wall-mounted ledger screen above
  const lm = group(g, X1 - 0.04, 1.85, r.cz, -Math.PI / 2);
  rbox(1.0, 0.6, 0.04, 0.01, M.plastic, 0, 0, 0, lm);
  const lmat = screenMat(ledgerScreen(51), 1.1), ls = plane(0.96, 0.56, lmat, 0, 0, 0.022, lm); powerScreen(id, ls, lmat);
  lampPoint(X1 - 0.35, 1.8, r.cz, 0xc8ffe0, 0.7, 2.6, id);
  // gold-leaf vault lettering on the wall
  const vt = canvasTex(512, 96, (q, w, h) => { q.clearRect(0, 0, w, h); q.fillStyle = '#d9b77a'; q.font = 'bold 52px Georgia'; q.textAlign = 'center'; q.fillText('LEDGER VAULT', w / 2, 66); });
  const vl = plane(0.9, 0.17, new THREE.MeshStandardMaterial({ map: vt, transparent: true, metalness: 0.9, roughness: 0.3, color: 0xffffff }), X1 - 0.01, 2.35, r.cz, g); vl.rotation.y = -Math.PI / 2;
  standbyTag(g, r.cx - 0.3, 1.2, r.z0 + 0.42, -Math.PI / 2, id);
}
function buildTraining() { // Training Bench: lessons, Nib's pattern book on a whiteboard.
  const id = 'training', r = tr(12, 10, 3, 1), g = stationGroup(id), M = C.M, y = 0.74;
  desk(g, r.cx, r.cz, 2.0, 0.72, 0, M.oak);
  laptop(g, r.cx - 0.25, y, r.cz + 0.02, 0.1, codeScreen(77, false), id);
  monitor(g, r.cx + 0.42, y, r.cz - 0.14, -0.15, 0.62, 0.36, courseScreen(41), { id, sticky: 1 });
  place('book_encyclopedia_set_01', r.cx - 0.85, y, r.cz - 0.2, 0.1, 1, g, { pick: /book0[1-9]/, shadow: false });
  books(g, r.cx - 0.85, y, r.cz + 0.15, 1);
  const open = group(g, r.cx + 0.05, y + 0.012, r.cz + 0.22, -0.2); for (const s of [-1, 1]) { const p = box(0.16, 0.012, 0.22, M.paper, s * 0.08, 0, 0, 1, open, false); p.rotation.z = s * -0.06; }
  papers(g, r.cx + 0.6, y, r.cz + 0.2, 2);
  mug(g, r.cx + 0.88, y, r.cz + 0.18, 0x8a2c2c);
  place('rubber_duck_toy', r.cx + 0.82, y, r.cz - 0.22, -0.6, 0.5, g, { shadow: false });
  place('magnifying_glass_01', r.cx - 0.4, y, r.cz + 0.26, 1.2, 1, g, { shadow: false });
  officeChair(g, r.cx - 0.2, r.cz + 0.66, 0.3);
  // rolling whiteboard behind the desk
  const wbT = canvasTex(1024, 640, (c, w, h) => {
    c.fillStyle = '#f4f5f2'; c.fillRect(0, 0, w, h); c.lineCap = 'round'; c.lineJoin = 'round';
    const pen = (col, lw) => { c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; };
    pen('rgba(0,0,0,.05)', 60); c.beginPath(); c.moveTo(80, 560); c.lineTo(560, 600); c.stroke(); c.beginPath(); c.moveTo(500, 80); c.lineTo(900, 60); c.stroke();
    pen('#1f3b8f', 5); c.font = 'bold 44px "Marker Felt", "Comic Sans MS", cursive'; c.fillText('PATTERN BOOK', 40, 70);
    c.font = '30px "Marker Felt", "Comic Sans MS", cursive';
    ['IDOR → check owner id', 'race → lock + recheck', 'XSS → escape output', 'SSRF → allow-list hosts'].forEach((t, i) => { pen(i % 2 ? '#b3261e' : '#1b1b1b', 4); c.fillText('• ' + t, 50, 140 + i * 56); });
    pen('#1b7a3a', 5); c.strokeRect(620, 110, 150, 80); c.strokeRect(820, 260, 150, 80); c.strokeRect(620, 400, 150, 80);
    c.beginPath(); c.moveTo(770, 150); c.quadraticCurveTo(880, 160, 895, 260); c.moveTo(895, 340); c.quadraticCurveTo(880, 440, 770, 440); c.stroke();
    c.font = '26px "Marker Felt", cursive'; c.fillText('login', 650, 160); c.fillText('token', 850, 310); c.fillText('refund', 645, 450);
    pen('#b3261e', 6); c.beginPath(); c.arc(700, 440, 75, 0, 7); c.stroke();
    ['#ffe873', '#ff9ec7', '#8de3ff'].forEach((col, i) => { c.fillStyle = col; c.save(); c.translate(80 + i * 130, 420); c.rotate(rr(-0.1, 0.1)); c.fillRect(0, 0, 110, 110); c.fillStyle = '#333'; c.font = '20px "Marker Felt", cursive'; c.fillText(['retest', 'ask Nib', 'CVE?'][i], 12, 50); c.restore(); });
  });
  const wb = group(g, r.cx + 0.1, 0, r.z0 - 0.12); wb.scale.set(0.95, 0.8, 1);
  { const wm = std(0xd8d8d8, 0.3, 0, { map: wbT }), bm = std(0x9a9c9e, 0.6); const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.03), [bm, bm, bm, bm, wm, bm]); b.position.set(0, 1.45, 0); b.castShadow = b.receiveShadow = true; wb.add(b); }
  box(1.64, 0.025, 0.04, M.alu, 0, 1.96, 0, 1, wb); box(1.64, 0.025, 0.04, M.alu, 0, 0.94, 0, 1, wb);
  box(1.4, 0.03, 0.07, M.alu, 0, 0.93, 0.03, 1, wb);
  for (let i = 0; i < 3; i++) { const mk = cyl(0.008, 0.008, 0.12, std([0x1f3b8f, 0xb3261e, 0x1b7a3a][i], 0.4), -0.3 + i * 0.05, 0.955, 0.04, wb, 8, false); mk.rotation.z = Math.PI / 2; }
  for (const s of [-1, 1]) { box(0.035, 1.9, 0.035, M.alu, s * 0.82, 0.98, 0, 1, wb); box(0.035, 0.035, 0.5, M.alu, s * 0.82, 0.06, 0, 1, wb); }
  C.colliders.push({ x0: r.cx + 0.1 - 0.85, x1: r.cx + 0.1 + 0.85, z0: r.z0 - 0.4, z1: r.z0 - 0.02 });
  pendant(r.cx, r.cz + 0.15, 1.15, { shadow: true, id, intensity: 10, tz: 0.35 });
  lampPoint(r.cx + 0.42, y + 0.45, r.cz - 0.02, 0xa58cff, 0.5, 2.0, id);
  standbyTag(g, r.cx, y + 0.45, r.cz - 0.2, 0, id);
}
function buildForge() { // Agent Forge: a workbench where tools get built.
  const id = 'forge', r = tr(4, 10, 2, 1), g = stationGroup(id), M = C.M, y = 0.92;
  rbox(1.5, 0.05, 0.72, 0.006, M.walnut, r.cx, y - 0.025, r.cz, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, y - 0.05, 0.05, M.steel, r.cx + sx * 0.68, (y - 0.05) / 2, r.cz + sz * 0.3, 1, g);
  box(1.4, 0.03, 0.62, M.walnut, r.cx, 0.22, r.cz, 1, g);
  const peg = canvasTex(512, 256, (c, w, h) => { c.fillStyle = '#b08a5c'; c.fillRect(0, 0, w, h); c.fillStyle = '#3b2a18'; for (let x = 8; x < w; x += 16) for (let yy = 8; yy < h; yy += 16) { c.beginPath(); c.arc(x, yy, 2.4, 0, 7); c.fill(); } });
  box(1.5, 0.75, 0.02, std(0xffffff, 0.8, 0, { map: peg }), r.cx, y + 0.55, r.z0 - 0.02, 1, g);
  C.colliders.push({ x0: r.cx - 0.8, x1: r.cx + 0.8, z0: r.z0 - 0.1, z1: r.z0 });
  place('pliers', r.cx - 0.6, y + 0.62, r.z0 + 0.01, 0, 1, g, { shadow: false });
  place('screwdriver', r.cx - 0.5, y + 0.62, r.z0 + 0.02, 0, 1, g, { shadow: false });
  place('measuring_tape_01', r.cx - 0.35, y + 0.5, r.z0 + 0.05, 0, 1, g, { shadow: false });
  for (let i = 0; i < 4; i++) cyl(0.012, 0.012, 0.22, std([0xe0b030, 0x2060c0, 0xc03030, 0x202020][i], 0.5), r.cx + 0.2 + i * 0.07, y + 0.62, r.z0 + 0.01, g, 8, false);
  // 3D printer with a glowing build
  const pr = group(g, r.cx - 0.42, y, r.cz - 0.06);
  const prM = worn(0x1c1d20, { metalness: 0.2, roughness: 0.55, ns: 0.2 });
  rbox(0.44, 0.06, 0.44, 0.012, prM, 0, 0.03, 0, pr); rbox(0.44, 0.05, 0.44, 0.012, prM, 0, 0.505, 0, pr);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(0.03, 0.46, 0.03, 0.006, M.aluDark, sx * 0.2, 0.27, sz * 0.2, pr);
  box(0.36, 0.006, 0.36, std(0x2a2c30, 0.3, 0.6), 0, 0.12, 0, 1, pr, false); // print bed
  for (const sx of [-1, 1]) cyl(0.005, 0.005, 0.4, M.steelLight, sx * 0.17, 0.34, -0.17, pr, 8, false).rotation.x = Math.PI / 2;
  const head = rbox(0.07, 0.06, 0.06, 0.008, std(0xc8501e, 0.5), 0.04, 0.3, 0, pr); cyl(0.004, 0.001, 0.02, M.brass, 0.04, 0.26, 0, pr, 8, false);
  cyl(0.006, 0.006, 0.4, M.steelLight, 0, 0.3, 0, pr, 8, false).rotation.z = Math.PI / 2;
  const disp = plane(0.08, 0.05, screenMat(termScreen(5, '#ff9a5a'), 0.8), 0.12, 0.03, 0.222, pr); // status display
  const spool = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 10, 28), std(0xb8501a, 0.6)); spool.position.set(0.25, 0.4, 0); spool.rotation.y = Math.PI / 2; pr.add(spool);
  cyl(0.035, 0.035, 0.045, M.plastic, 0.25, 0.4, 0, pr, 20).rotation.z = Math.PI / 2;
  cable(pr, [[0.25, 0.47, 0], [0.18, 0.56, 0], [0.04, 0.4, 0], [0.04, 0.33, 0]], 0.0015, std(0xb8501a, 0.6));
  const enc = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.4), new THREE.MeshStandardMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })); enc.position.y = 0.26; enc.userData.noAO = true; pr.add(enc);
  const partM = new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff7a2a, emissiveIntensity: 1.4 });
  cyl(0.05, 0.07, 0.09, partM, 0, 0.09, 0, pr, 6);
  const pl = new THREE.PointLight(0xff8a3d, 0.9, 1.6, 2); pl.position.set(r.cx - 0.42, y + 0.3, r.cz - 0.06); addLight(pl, id);
  onPower(id, on => (partM.emissiveIntensity = on ? 1.4 : 0));
  place('circuit_board', r.cx + 0.15, y, r.cz + 0.1, 0.3, 0.5, g, { shadow: false });
  place('retro_multimeter', r.cx + 0.5, y, r.cz - 0.15, -0.5, 1, g);
  place('metal_toolbox', r.cx + 0.3, 0.235, r.cz, 0.2, 1, g);
  const iron = cyl(0.006, 0.01, 0.2, std(0x1a3a8a, 0.4), r.cx + 0.45, y + 0.06, r.cz + 0.18, g, 8, false); iron.rotation.z = 1.2;
  laptop(g, r.cx + 0.1, y, r.cz - 0.12, -0.15, nodeScreen(61), id);
  place('vintage_stapler', r.cx + 0.6, y, r.cz + 0.22, 0.5, 1, g, { shadow: false });
  place('cardboard_box_01', r.cx - 0.4, 0.25, r.cz + 0.05, 0.3, 0.7, g);
  place('spray_paint_bottles', r.cx + 0.62, y, r.cz + 0.0, 0.3, 1, g, { shadow: false });
  // bench stool
  const st = group(g, r.cx - 0.1, 0, r.cz + 0.7); cyl(0.17, 0.17, 0.04, M.leatherBrown, 0, 0.66, 0, st); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, lg = cyl(0.012, 0.012, 0.68, M.steel, Math.cos(a) * 0.12, 0.33, Math.sin(a) * 0.12, st, 6); lg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); } const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.008, 6, 20), M.steel); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; st.add(ring);
  // tool cart beside the bench
  place('tool_cart', r.x0 - 0.75, 0, r.cz + 0.05, Math.PI / 2, 0.75, g);
  C.colliders.push({ x0: r.x0 - 1.1, x1: r.x0 - 0.35, z0: r.cz - 0.5, z1: r.cz + 0.55 });
  lampPoint(r.cx, y + 0.85, r.cz + 0.15, 0xfff0d8, 0.7, 2.4, id);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.015, 0.03), emissive(0xfff2dc, 3)); strip.position.set(r.cx, y + 0.95, r.z0 + 0.03); g.add(strip);
  onPower(id, on => (strip.material.emissiveIntensity = on ? 3 : 0));
  pendant(r.cx, r.cz + 0.1, 1.2, { id, intensity: 18, color: 0xffd2a0 });
  standbyTag(g, r.cx, y + 0.35, r.z0 + 0.06, 0, id);
}
let goalTex = null;
export const getGoalTex = () => goalTex;
function buildHQ(G) { // Headquarters: the goal board on the brick wall, a credenza, a neon sign.
  const id = 'hq', r = tr(7, 1, 6, 2), g = stationGroup(id), M = C.M;
  for (let i = 0; i < 42; i++) box(0.045, 2.4, 0.03, M.walnut, r.cx - 2.1 + i * 0.1025, 1.4, Z0 + 0.04, 0.6, g);
  box(4.3, 2.4, 0.02, std(0x101010, 0.9), r.cx, 1.4, Z0 + 0.012, 1, g);
  // warm LED washers grazing the slats
  const wash = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.02, 0.03), emissive(0xffb070, 2)); wash.position.set(r.cx, 2.62, Z0 + 0.09); g.add(wash);
  goalTex = canvasTex(1280, 720, (c, w, h) => {
    const s = G?.state?.() || {};
    const grd = c.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#0b1220'); grd.addColorStop(1, '#151f36'); c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7dd3fc'; c.font = 'bold 30px Arial'; c.fillText('FIRST OFFICE · HEADQUARTERS', 56, 72);
    c.fillStyle = '#fff'; c.font = 'bold 92px Arial'; c.fillText('$' + (s.cash ?? 0).toLocaleString(), 56, 200);
    c.fillStyle = '#94a3b8'; c.font = '30px Arial'; c.fillText('cash', 60, 244); c.fillText('reputation', 560, 244); c.fillText('day', 960, 244);
    c.fillStyle = '#fff'; c.font = 'bold 92px Arial'; c.fillText(String(s.rep ?? 0), 556, 200); c.fillText(String(s.day ?? 1), 956, 200);
    const bugs = Object.keys(s.paid || s.found || {}).length;
    const rows = [['Bugs filed', Math.min(1, (s.bugs ?? bugs ?? 0) / 5)], ['Critical chain', s.crits ? 1 : 0.15], ['Reputation · Elite', Math.min(1, (s.rep ?? 0) / 60)]];
    rows.forEach(([t, p], i) => { const y = 340 + i * 110; c.fillStyle = '#cbd5e1'; c.font = '34px Arial'; c.fillText(t, 60, y); c.fillStyle = '#1e293b'; c.fillRect(60, y + 22, 1160, 26); const gr = c.createLinearGradient(60, 0, 1220, 0); gr.addColorStop(0, '#22d3ee'); gr.addColorStop(1, '#a78bfa'); c.fillStyle = gr; c.fillRect(60, y + 22, 1160 * Math.max(0.04, p), 26); });
  });
  const disp = group(g, r.cx, 1.55, Z0 + 0.1);
  rbox(2.3, 1.32, 0.05, 0.01, M.plastic, 0, 0, 0, disp);
  const gm = screenMat(goalTex, 1.2), sc = plane(2.26, 1.27, gm, 0, 0, 0.026, disp); powerScreen(id, sc, gm);
  rectLight(0x7ab8ff, 2.5, 2.2, 1.2, new THREE.Vector3(r.cx, 1.55, Z0 + 0.16), new THREE.Vector3(r.cx, 1.2, Z0 + 3), id);
  // neon sign above (original wordmark)
  const neon = canvasTex(1024, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.font = 'italic bold 120px "Brush Script MT", "Segoe Script", cursive'; c.textAlign = 'center';
    c.shadowColor = '#ff3fb4'; c.shadowBlur = 24; c.strokeStyle = '#ffd1ef'; c.lineWidth = 7; c.strokeText('first office', w / 2, 140); c.shadowBlur = 0; c.strokeStyle = '#fff3fb'; c.lineWidth = 3; c.strokeText('first office', w / 2, 140);
  });
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshBasicMaterial({ map: neon, transparent: true, color: new THREE.Color(2.2, 1.05, 1.8), depthWrite: false }));
  nm.position.set(r.cx, 2.55, Z0 + 0.075); g.add(nm);
  rectLight(0xff4fb8, 7, 1.8, 0.3, new THREE.Vector3(r.cx, 2.55, Z0 + 0.12), new THREE.Vector3(r.cx, 2.0, Z0 + 3));
  // credenza with books, plant, trophies
  const cr = group(g, r.cx, 0, Z0 + 0.3);
  rbox(3.2, 0.62, 0.48, 0.008, M.walnut, 0, 0.36, 0, cr);
  for (let i = 0; i < 4; i++) { box(0.78, 0.5, 0.01, M.walnut, -1.2 + i * 0.8, 0.36, 0.245, 0.6, cr); box(0.2, 0.012, 0.02, M.brass, -1.2 + i * 0.8, 0.5, 0.255, 1, cr); }
  for (const s of [-1, 1]) for (const z of [-1, 1]) box(0.03, 0.05, 0.03, M.brass, s * 1.5, 0.025, z * 0.2, 1, cr);
  books(g, r.cx - 1.45, 0.67, Z0 + 0.3, 9, 0);
  place('ceramic_vase_01', r.cx + 1.3, 0.67, Z0 + 0.3, 0, 1.0, g);
  place('potted_plant_04', r.cx + 0.95, 0.67, Z0 + 0.3, 0, 1.4, g);
  place('standing_picture_frame_01', r.cx - 0.7, 0.67, Z0 + 0.3, 1.4, 1, g, { shadow: false });
  place('standing_picture_frame_02', r.cx + 0.6, 0.67, Z0 + 0.32, 1.9, 1, g, { shadow: false });
  // trophy: a brass cup for the first critical
  const tp = group(g, r.cx - 0.25, 0.67, Z0 + 0.3); box(0.08, 0.04, 0.08, M.walnut, 0, 0.02, 0, 1, tp); cyl(0.012, 0.012, 0.08, M.brass, 0, 0.08, 0, tp); const cup = new THREE.Mesh(new THREE.LatheGeometry([0, 0.02, 0.04, 0.05, 0.052].map((x, i) => new THREE.Vector2(x, i * 0.025)), 20), M.brass); cup.position.y = 0.12; tp.add(cup);
  // standing command table with a tablet
  const ct = group(g, r.cx + 1.5, 0, r.z1 - 0.32);
  cyl(0.03, 0.03, 1.0, M.steel, 0, 0.5, 0, ct); cyl(0.2, 0.22, 0.02, M.steel, 0, 0.01, 0, ct, 32);
  rbox(0.6, 0.03, 0.4, 0.006, M.walnut, 0, 1.02, 0, ct);
  const tab = rbox(0.25, 0.008, 0.18, 0.004, M.plastic, 0.02, 1.04, 0, ct); tab.rotation.y = 0.2;
  const tm = screenMat(dashScreen(61, '#22d3ee'), 1.1), ts = plane(0.23, 0.16, tm, 0.02, 1.045, 0, ct); ts.rotation.x = -Math.PI / 2; ts.rotation.z = 0.2; powerScreen(id, ts, tm);
  coffeeCup(ct, -0.2, 1.035, 0.08);
  place('potted_plant_01', r.x0 + 0.2, 0, Z0 + 0.35, 0, 0.9, g);
}
const rackLeds = [];
function buildRig() { // GPU Rig: server racks with blinking LEDs.
  const id = 'rig', r = tr(16, 12, 3, 1), g = stationGroup(id), M = C.M;
  const face = canvasTex(256, 512, (c, w, h) => {
    c.fillStyle = '#0a0b0d'; c.fillRect(0, 0, w, h);
    for (let u = 0; u < 16; u++) { const y = 8 + u * 31; c.fillStyle = '#16181c'; c.fillRect(10, y, w - 20, 27); c.fillStyle = '#25282e'; for (let i = 0; i < 14; i++) c.fillRect(60 + i * 12, y + 6, 8, 15);
      for (let i = 0; i < 3; i++) { c.fillStyle = rnd() < 0.6 ? '#2bff88' : rnd() < 0.5 ? '#2bb8ff' : '#ffb02b'; c.fillRect(20 + i * 10, y + 10, 5, 5); } }
  });
  const rackM = worn(0x17181b, { roughness: 0.6, metalness: 0.7, ns: 0.4 });
  for (let i = 0; i < 3; i++) {
    const x = r.x0 + 0.38 + i * 0.72, rk = group(g, x, 0, 9.46, 0); rk.scale.z = 0.83;
    rbox(0.68, 1.95, 0.72, 0.01, rackM, 0, 0.975, 0, rk);
    const fm = new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.5 });
    const f = plane(0.56, 1.8, fm, 0, 0.98, -0.362, rk); f.rotation.y = Math.PI;
    const gl = plane(0.6, 1.86, new THREE.MeshPhysicalMaterial({ color: 0x9fb0c0, roughness: 0.08, transparent: true, opacity: 0.05, envMapIntensity: 0.8, depthWrite: false }), 0, 0.98, -0.37, rk); gl.rotation.y = Math.PI; gl.userData.noAO = true;
    box(0.03, 1.2, 0.03, M.alu, 0.26, 1.0, -0.38, 1, rk);
    // warning label
    const wl = plane(0.12, 0.08, new THREE.MeshStandardMaterial({ map: canvasTex(64, 48, (q, w, h) => { q.fillStyle = '#f5c518'; q.fillRect(0, 0, w, h); q.fillStyle = '#111'; q.beginPath(); q.moveTo(32, 6); q.lineTo(56, 42); q.lineTo(8, 42); q.closePath(); q.fill(); q.fillStyle = '#f5c518'; q.font = 'bold 22px Arial'; q.fillText('!', 28, 38); }), roughness: 0.6 }), -0.2, 1.75, -0.375, rk); wl.rotation.y = Math.PI;
    rackLeds.push(fm);
    onPower(id, on => { fm.emissiveIntensity = on ? 0.8 : 0.02; fm.userData.off = !on; });
  }
  for (let i = 0; i < 4; i++) cable(g, [[r.x0 + 0.3 + i * 0.5, 1.95, r.cz + 0.2], [r.x0 + 0.3 + i * 0.5, 2.6, r.cz + 0.25], [r.x0 + 0.2 + i * 0.45, H - 0.05, r.cz + 0.3]], 0.012);
  lampPoint(r.cx, 1.6, 8.95, 0x3fb8ff, 0.8, 2.0, id);
  // floor fan and a crate of spare parts
  place('plastic_crate_02', r.x0 - 0.15, 0, r.cz + 0.5, 0.3, 1, g);
  place('power_box_01', X1 - 0.03, 1.4, r.z1 + 0.3, -Math.PI / 2, 1, g);
}
function buildTerminals() { // six one-tile agent terminals: compact pods where the AI agents run
  const id = 'terminals', g = stationGroup(id), M = C.M, names = ['scout', 'fuzzer', 'triage', 'repro', 'writer', 'ledger'];
  [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]].forEach((p, i) => {
    // pods sit back to back: row 10 faces north (screens toward its north side), row 11 faces south
    const r = tr(p[0], p[1], 1, 1), north = p[1] === 10, ry = north ? Math.PI : 0, cz = r.cz + (north ? 0.12 : -0.12);
    const pod = group(g, r.cx, 0, cz, ry);
    rbox(0.7, 0.03, 0.44, 0.006, M.oak, 0, 0.74, 0, pod);
    box(0.03, 0.72, 0.4, M.steel, -0.33, 0.36, 0, 1, pod); box(0.03, 0.72, 0.4, M.steel, 0.33, 0.36, 0, 1, pod);
    box(0.7, 0.42, 0.02, std(0x2e3b3a, 0.9), 0, 0.95, -0.22, 1, pod); // privacy screen between rows
    monitor(pod, 0, 0.755, -0.12, 0, 0.5, 0.29, agentScreen(100 + i, names[i]), { id, k: 1.3 });
    keyboard(pod, -0.05, 0.755, 0.1, 0);
    if (i % 2 === 0) mug(pod, 0.26, 0.755, 0.1, pick([0xf1eee8, 0x2a4f8a, 0x2f4a33]), false);
    if (i === 3) can(pod, -0.27, 0.755, 0.12, 0x23a455);
    const label = canvasTex(128, 32, (q, w, h) => { q.fillStyle = '#0f1416'; q.fillRect(0, 0, w, h); q.fillStyle = '#5eead4'; q.font = 'bold 18px Menlo, monospace'; q.fillText(names[i].toUpperCase(), 8, 22); });
    plane(0.16, 0.04, new THREE.MeshStandardMaterial({ map: label, emissiveMap: label, emissive: 0xffffff, emissiveIntensity: 0.6 }), 0, 1.12, -0.208, pod);
  });
  lampPoint(13.1, 1.1, 7.7, 0x5eead4, 1.2, 2.6, id); lampPoint(13.1, 1.1, 8.8, 0x5eead4, 1.0, 2.2, id);
  standbyTag(g, 13.1, 1.25, 8.25, 0, id);
}

// ================= decor outside the stations =================
function poster(kind, x, y, z, ry, w = 0.6, frame = true) {
  const t = posterTex(kind), g = group(null, x, y, z, ry);
  if (frame) box(w + 0.04, w * 1.406 + 0.04, 0.02, std(0x111111, 0.4, 0.3), 0, 0, 0, 1, g, false);
  plane(w, w * 1.406, new THREE.MeshStandardMaterial({ map: t, roughness: frame ? 0.25 : 0.8 }), 0, 0, 0.011, g);
  return g;
}
// Industrial wall sconce: a warm pool grazing down the wall.
function sconce(x, y, z, ry, color = 0xffb878) {
  place('industrial_wall_lamp', x, y, z, ry, 1);
  const dx = Math.sin(ry) * 0.16, dz = Math.cos(ry) * 0.16;
  const l = new THREE.SpotLight(color, 7, 4, 0.75, 0.85, 2); l.position.set(x + dx, y - 0.08, z + dz); l.target.position.set(x + dx * 2.2, 0, z + dz * 2.2); addLight(l);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), emissive(color, 4)); b.position.set(x + dx, y - 0.1, z + dz); C.scene.add(b);
  lightCone(null, x + dx, y - 0.1, z + dz, 0.06, 0.45, 1.2, color, 0.035).rotation.x = Math.sin(ry) * 0 ;
}
function buildDecor() {
  const M = C.M;
  sconce(X1 - 0.01, 2.15, 4.45, -Math.PI / 2); sconce(X1 - 0.01, 2.15, 6.7, -Math.PI / 2); sconce(X1 - 0.01, 2.15, 8.05, -Math.PI / 2);
  sconce(6.1, 2.1, Z1 - 0.01, Math.PI); sconce(8.3, 2.1, Z1 - 0.01, Math.PI);
  // corner plants (solid tiles in the 2D office)
  place('pachira_aquatica_01', 1.15, 0, 1.15, 0.3, 0.9, null, { pick: /_b$/ });
  place('potted_plant_01', 13.9, 0, 1.15, 1.2, 1.0);
  place('calathea_orbifolia_01', 1.15, 0, 10.1, 0.2, 1.1, null, { pick: /_b$/ });
  place('calathea_orbifolia_01', 13.85, 0, 10.1, 2.0, 1.1, null, { pick: /_d$/ });
  // ---- lounge on the south wall, west side ----
  place('sofa_03', 3.4, 0, Z1 - 0.48, Math.PI, 1);
  C.colliders.push({ x0: 2.05, x1: 4.75, z0: Z1 - 0.95, z1: Z1 });
  place('throw_pillows_01', 2.85, 0.45, Z1 - 0.5, Math.PI, 1);
  place('side_table_01', 1.65, 0, Z1 - 0.4, 0, 1); C.colliders.push({ x0: 1.4, x1: 1.9, z0: Z1 - 0.65, z1: Z1 - 0.15 });
  place('vintage_electric_kettle', 1.65, 0.45, Z1 - 0.4, 0.5, 0.6, null, { shadow: false });
  rugSlab(C.scene, 3.0, 1.8, pbr('dirty_carpet', { color: 0x6b4e40 }), 3.4, Z1 - 1.1);
  place('modern_coffee_table_01', 3.4, 0, Z1 - 1.35, Math.PI / 2, 1); C.colliders.push({ x0: 2.8, x1: 4.0, z0: Z1 - 1.65, z1: Z1 - 1.05 });
  pizzaBox(C.scene, 3.1, 0.39, Z1 - 1.35, 0.2, true);
  can(C.scene, 3.65, 0.39, Z1 - 1.25, 0xd61d4a); can(C.scene, 3.75, 0.39, Z1 - 1.42, 0x1d8fd6, true);
  place('gamepad', 3.9, 0.39, Z1 - 1.3, 0.6, 0.45, null, { shadow: false });
  // arc floor lamp over the sofa
  const fl = group(null, 4.95, 0, Z1 - 0.35);
  cyl(0.15, 0.16, 0.03, std(0x222222, 0.3, 0.6), 0, 0.015, 0, fl, 32);
  const arc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-0.4, 2.0, -0.2), new THREE.Vector3(-1.1, 1.85, -0.35)]);
  const am = new THREE.Mesh(new THREE.TubeGeometry(arc, 40, 0.012, 8), M.brass); am.castShadow = true; fl.add(am);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x111111, 0.3, 0.8, { side: THREE.DoubleSide })); sh.position.set(-1.1, 1.82, -0.35); fl.add(sh);
  const fb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), emissive(0xffc890, 5)); fb.position.set(-1.1, 1.76, -0.35); fl.add(fb);
  const fll = new THREE.SpotLight(0xffb070, 14, 6, 1.1, 0.8, 2); fll.position.set(3.85, 1.75, Z1 - 0.7); fll.target.position.set(3.6, 0, Z1 - 1.0);
  fll.castShadow = true; fll.shadow.mapSize.set(1024, 1024); fll.shadow.bias = -0.0004; fll.shadow.radius = 5; addLight(fll);
  lightCone(null, 3.85, 1.74, Z1 - 0.7, 0.15, 0.9, 1.7, 0xffb070, 0.05);
  C.colliders.push({ x0: 4.75, x1: 5.15, z0: Z1 - 0.55, z1: Z1 - 0.15 });
  poster('ship', 2.7, 1.65, Z1 - 0.02, Math.PI, 0.62); poster('nib', 4.0, 1.65, Z1 - 0.02, Math.PI, 0.62);
  // ---- coffee corner on the south wall, east side ----
  place('CoffeeCart_01', 10.6, 0, Z1 - 0.4, Math.PI, 1);
  C.colliders.push({ x0: 9.85, x1: 11.35, z0: Z1 - 0.85, z1: Z1 });
  lampPoint(10.6, 1.25, Z1 - 0.45, 0xffc98a, 1.0, 2.2);
  place('metal_trash_can', 11.8, 0, Z1 - 0.32, 0, 0.9, null, { pick: /^metal_trash_can(_lid|_handle|$)/ }); C.colliders.push({ x0: 11.5, x1: 12.1, z0: Z1 - 0.6, z1: Z1 });
  place('trashbag', 12.25, 0, Z1 - 0.3, 1.2, 0.8);
  // water cooler
  const wc = group(null, 9.45, 0, Z1 - 0.3);
  rbox(0.32, 1.0, 0.32, 0.02, M.plasticWhite, 0, 0.5, 0, wc);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.38, 20), new THREE.MeshPhysicalMaterial({ color: 0x7fb8e8, roughness: 0.05, transmission: 0.6, thickness: 0.2, transparent: true, opacity: 0.7 })); jug.position.y = 1.2; wc.add(jug);
  for (const s of [-1, 1]) { const tap = box(0.03, 0.05, 0.04, s < 0 ? std(0x2a5fd0, 0.4) : std(0xc0392b, 0.4), s * 0.06, 0.75, 0.17, 1, wc, false); }
  C.colliders.push({ x0: 9.25, x1: 9.65, z0: Z1 - 0.5, z1: Z1 });
  poster('bug', 8.4, 1.7, Z1 - 0.02, Math.PI, 0.55);
  // wall clock above the coffee
  place('wall_clock', 10.6, 2.45, Z1 - 0.04, Math.PI, 1);
  // ---- east wall: bookshelf, art, cork board ----
  place('wooden_bookshelf_worn', X1 - 0.3, 0, 5.6, -Math.PI / 2, 1);
  C.colliders.push({ x0: X1 - 0.6, x1: X1, z0: 4.85, z1: 6.35 });
  for (let s = 0; s < 4; s++) { binders(C.scene, X1 - 0.3, 0.12 + s * 0.47, 5.05, 3 + (s % 2), -Math.PI / 2); books(C.scene, X1 - 0.3, 0.12 + s * 0.47, 5.6, 6 + s, -Math.PI / 2, true); }
  place('chess_set', X1 - 0.3, 2.06, 5.6, 0.3, 0.6, null, { shadow: false });
  poster('map', X1 - 0.02, 1.7, 7.2, -Math.PI / 2, 0.6);
  poster('crit', X1 - 0.02, 1.7, 3.95 + 0.0, -Math.PI / 2, 0.42);
  place('dartboard', 0.77, 1.75, 5.0, Math.PI / 2, 1);
  place('korean_fire_extinguisher_01', 8.1, 0, Z1 - 0.15, Math.PI, 1);
  place('fire_alarm', 8.1, 1.5, Z1 - 0.01, Math.PI, 1, null, { shadow: false });
  place('security_camera_01', X1 - 0.1, H - 0.35, Z0 + 0.15, -2.3, 1, null, { shadow: false });
  // boxes stacked in the NE corner by the plant
  place('cardboard_box_01', 12.6, 0, 1.0, 0.2, 1); place('cardboard_box_01', 12.9, 0.0, 1.45, -0.3, 0.8); place('cardboard_box_01', 12.65, 0.335, 1.05, 0.5, 0.75);
  C.colliders.push({ x0: 12.2, x1: 13.3, z0: 0.75, z1: 1.8 });
  // radiators under the west windows
  for (const z of [3.0, 7.5]) { const rg = group(null, X0 + 0.08, 0.35, z); for (let i = 0; i < 14; i++) box(0.06, 0.5, 0.05, std(0xd8d8d2, 0.4, 0.3), 0, 0, -0.45 + i * 0.07, 1, rg, false); }
  // window sill clutter
  place('potted_plant_04', X0 + 0.1, 0.62, 6.0, 0.4, 1.1); books(C.scene, X0 + 0.1, 0.62, 8.6, 5, Math.PI / 2);
  coffeeCup(C.scene, X0 + 0.1, 0.62, 7.0); place('cassette_player', X0 + 0.12, 0.62, 9.1, 1.2, 1, null, { shadow: false });
  place('potted_plant_04', 11.2, 0.77, Z0 + 0.1, 0.4, 1.0); place('portable_cassette_player', 12.5, 0.77, Z0 + 0.12, 0.2, 1, null, { shadow: false });
  // big lounge rug in the middle of the floor (where Nib floats around)
  const rugT = canvasTex(1024, 512, (g, w, h) => { // an original geometric wool rug, slightly worn
    g.fillStyle = '#2f3d3c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a5a3c'; g.lineWidth = 18; g.strokeRect(30, 30, w - 60, h - 60);
    g.strokeStyle = '#c9b48a'; g.lineWidth = 4; g.strokeRect(56, 56, w - 112, h - 112); g.strokeRect(70, 70, w - 140, h - 140);
    for (let i = 0; i < 7; i++) { const cx = 150 + i * 120, cy = h / 2; g.fillStyle = i % 2 ? '#7a3b2e' : '#3e5b57'; g.beginPath(); g.moveTo(cx, cy - 120); g.lineTo(cx + 55, cy); g.lineTo(cx, cy + 120); g.lineTo(cx - 55, cy); g.closePath(); g.fill(); g.strokeStyle = '#c9b48a'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#c9b48a'; g.fillRect(cx - 8, cy - 8, 16, 16); }
    for (let x = 90; x < w - 80; x += 24) { g.fillStyle = '#8a5a3c'; g.beginPath(); g.moveTo(x, 90); g.lineTo(x + 12, 102); g.lineTo(x, 114); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x, h - 90); g.lineTo(x + 12, h - 102); g.lineTo(x, h - 114); g.closePath(); g.fill(); }
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,240,220'},${rr(0.02, 0.07)})`; g.fillRect(rnd() * w, rnd() * h, rr(1, 4), rr(1, 4)); }
    const wear = g.createRadialGradient(w * 0.45, h * 0.55, 20, w * 0.45, h * 0.55, 380); wear.addColorStop(0, 'rgba(200,190,170,.18)'); wear.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = wear; g.fillRect(0, 0, w, h);
  });
  const rugM = pbr('dirty_carpet', { color: 0x8f8f8f }); rugM.map = rugT; rugM.normalMap.repeat?.set(3, 1.5);
  rugSlab(C.scene, 5.2, 2.6, rugM, 7.4, 6.6);
  // a few floor details: a stray paper, a cable run, a box by the forge
  crumpled(C.scene, 6.0, 0, 6.0); papers(C.scene, 11.4, 0, 5.1, 1, 2);
  floorCable(C.scene, [11.6, 7.4], [12.3, 9.0]); floorCable(C.scene, [X1 - 0.05, 8.5], [13.6, 8.9]);
  place('plastic_crate_01', 5.15, 0, 7.75, 0.3, 1); C.colliders.push({ x0: 4.95, x1: 5.4, z0: 7.5, z1: 8.0 });
  // Nib's charging dock: a small pedestal with a glowing ring (Nib floats home here at night)
  const dock = group(null, 10.9, 0, 5.6);
  cyl(0.24, 0.3, 0.06, std(0x1a1c1e, 0.35, 0.7), 0, 0.03, 0, dock, 32); cyl(0.06, 0.09, 0.7, std(0xe8e6e0, 0.25, 0.1), 0, 0.41, 0, dock, 24);
  cyl(0.2, 0.16, 0.05, std(0xe8e6e0, 0.25, 0.1), 0, 0.79, 0, dock, 32);
  const dr = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.2, 1.5) })); dr.rotation.x = Math.PI / 2; dr.position.y = 0.82; dock.add(dr);
  const dr2 = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.006, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.1) })); dr2.rotation.x = Math.PI / 2; dr2.position.y = 0.065; dock.add(dr2);
  lampPoint(10.9, 0.95, 5.6, 0x6ee7ff, 0.5, 1.6);
  C.colliders.push({ x0: 10.6, x1: 11.2, z0: 5.3, z1: 5.9 });
  place('vintage_suitcase', X0 + 0.35, 0, 4.95, Math.PI / 2, 0.9, null, { pick: /suitcase_02/ });
}

export function buildRoom(G) {
  buildShell(); buildLightRig();
  buildHunt(); buildContract(); buildStats(); buildTraining(); buildForge(); buildHQ(G); buildRig(); buildTerminals(); buildDecor(); buildDust();
}
// Dust motes drifting in the lamp light: each mote's brightness is baked from the nearby practicals, so they only show
// where light would catch them.
let dust;
function buildDust() {
  const want = 300, pos = [], col = [], seedA = [];
  const ls = C.lights.filter(l => (l.isPointLight || l.isSpotLight) && l.intensity > 0);
  for (let tries = 0; tries < 40000 && seedA.length < want; tries++) {
    const x = rr(X0 + 0.2, X1 - 0.2), y = rr(0.4, 2.4), z = rr(Z0 + 0.2, Z1 - 0.2), c = new THREE.Color(0, 0, 0);
    for (const l of ls) {
      if (!l.isSpotLight) continue; // only inside lamp cones...
      const dx = x - l.position.x, dy = y - l.position.y, dz = z - l.position.z, d = Math.hypot(dx, dy, dz), ax = new THREE.Vector3().subVectors(l.target.position, l.position).normalize();
      const cosA = (dx * ax.x + dy * ax.y + dz * ax.z) / d; if (cosA < Math.cos(l.angle * 0.8)) continue;
      c.add(l.color.clone().multiplyScalar(Math.min(l.intensity, 20) / 20 / (1 + d * d)));
    }
    // ...and the moonlight shafts at the west windows
    if (x < 3.6 && ((z > 1.6 && z < 4.4) || (z > 5.6 && z < 9.4)) && Math.abs(y - (2.0 - (x - X0) * 0.8)) < 0.5) c.add(new THREE.Color(0x9db6ff).multiplyScalar(0.35));
    if (c.r + c.g + c.b < 0.25) continue;
    pos.push(x, y, z); col.push(...[c.r, c.g, c.b].map(v => Math.min(v, 1) * 0.5)); seedA.push(rnd() * 100);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('seed', new THREE.Float32BufferAttribute(seedA, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float seed; attribute vec3 color; uniform float time; varying vec3 vC; varying float vA;
      void main(){ vec3 p = position + vec3(sin(time*0.07+seed)*0.12, sin(time*0.05+seed*1.7)*0.1, cos(time*0.06+seed*0.9)*0.12);
        vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv; float z = -mv.z; gl_PointSize = clamp(5.0 / z, 1.0, 3.0);
        vC = color; vA = (0.5 + 0.5 * sin(time * 0.8 + seed * 3.0)) * smoothstep(0.6, 1.4, z) * (1.0 - smoothstep(3.5, 7.0, z)); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vC * a * vA, 1.0); }`,
  });
  dust = new THREE.Points(g, m); dust.frustumCulled = false; dust.userData.noAO = true; C.scene.add(dust);
}
export function tickRoom(t) {
  if (dust) dust.material.uniforms.time.value = t;
  for (const m of rackLeds) if (!m.userData.off) m.emissiveIntensity = 0.75 + Math.sin(t * 7 + m.id) * 0.12;
}
