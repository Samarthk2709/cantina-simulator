// First Office 3D: the room. Shell, windows, light rig, the stations (one desk per game operation) and set dressing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  C, onPower, tr, X0, X1, Z0, Z1, H, rnd, rr, pick, tex, pbr, canvasTex, box, rbox, cyl, plane, std, group, cable, floorCable,
  screenMat, powerScreen, worn, codeScreen, dashScreen, termScreen, kanbanScreen, ledgerScreen, agentScreen, nodeScreen, courseScreen, gpuScreen,
  docTex, posterTex, stickyMat, place, monitor, laptop, keyboard, mug, coffeeCup, can, papers, crumpled, books, binders, officeChair, desk,
  powerStrip, pcTower, contactShadow, bin, headphones, pizzaBox, backpack, lightCone, hazeMaterial,
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
  const cone = { visible: true }; // (no geometric light cones: the haze comes from the post height fog)
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
  void geo; void len;
}

// ---------- shell ----------
export function buildShell() {
  const M = C.M;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); floor.receiveShadow = true;
  const uv = floor.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 2.2, uv.getY(i) * (Z1 - Z0) / 2.2);
  C.scene.add(floor); C.occluders.push(floor); C.floorMesh = floor;
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
let beaconM;
const lr = (() => { let q = 99173; return () => ((q = (q * 16807) % 2147483647) / 2147483647); })(); // skyline-only rng
export function buildSkyline(yaw) {
  const t = tex('sky/skyline.jpg', true); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  const R = 150, top = R * Math.tan(THREE.MathUtils.degToRad(50.4)), bot = R * Math.tan(THREE.MathUtils.degToRad(28.6));
  t.repeat.x = -1; const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, top + bot, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, color: 0x4a5266 }));
  m.position.set((X0 + X1) / 2, (top - bot) / 2 - 14, (Z0 + Z1) / 2); m.rotation.y = yaw; m.userData.city = true; C.scene.add(m);
  // street level: dark asphalt with sodium street-light pools and car light streaks
  const st = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#06080b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { const y = 60 + i * 80; g.fillStyle = '#0d1014'; g.fillRect(0, y, w, 26); g.fillRect(y, 0, 26, h); }
    for (let i = 0; i < 260; i++) { const x = rnd() * w, y = rnd() * h, r = rr(6, 22), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,170,80,.55)'); gr.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 120; i++) { const y = 60 + Math.floor(rnd() * 12) * 80 + rr(4, 22), x = rnd() * w; g.fillStyle = rnd() < 0.5 ? 'rgba(255,60,40,.8)' : 'rgba(255,245,220,.8)'; g.fillRect(x, y, rr(8, 30), 2); }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: st, color: 0xaaaaaa })); ground.rotation.x = -Math.PI / 2; ground.position.set(7, -9, 5); C.scene.add(ground);
  // towers: an interior-mapped window shader. Every window cell is a little room (back wall, side walls, floor and
  // ceiling) seen in parallax through the glass, lit warm or cool or dark per cell, with mullions, blinds and furniture
  // silhouettes, so the near towers have depth instead of flat coloured rectangles.
  const cityM = new THREE.ShaderMaterial({
    uniforms: { haze: { value: new THREE.Color(0x141c2a) }, gain: { value: 0.62 } },
    vertexShader: `attribute float seed; varying vec3 vW; varying vec3 vN; varying float vSeed; varying vec3 vLocal;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vSeed = seed; vLocal = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 haze; uniform float gain; varying vec3 vW; varying vec3 vN; varying float vSeed; varying vec3 vLocal;
      float h1(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 n = normalize(vN);
        if (abs(n.y) > 0.5) { gl_FragColor = vec4(0.012, 0.014, 0.02, 1.0); return; }
        vec3 up = vec3(0.0, 1.0, 0.0), rt = normalize(cross(up, n));
        float kind = floor(h1(vec3(vSeed, 1.0, 2.0)) * 3.0);
        vec2 cs = (kind == 1.0 ? vec2(1.8, 3.2) : kind == 2.0 ? vec2(1.5, 3.6) : vec2(2.6, 3.4)) * mix(0.7, 1.7, h1(vec3(vSeed, 4.0, 4.0)));
        vec2 uv = vec2(dot(vW, rt), vW.y) / cs; vec2 id = floor(uv), f = fract(uv);
        float rowLit = h1(vec3(id.y, vSeed, dot(n, vec3(1.0, 0.0, 3.0))));
        float r = h1(vec3(id, vSeed + dot(n, vec3(7.0, 0.0, 13.0))));
        float lit = step(r, rowLit < 0.45 ? 0.75 : rowLit > 0.93 ? 0.98 : 0.08); // some floors fully lit (offices working late)
        vec2 fr = kind == 2.0 ? vec2(0.04, 0.06) : vec2(0.14, 0.2);
        bool frame = f.x < fr.x || f.x > 1.0 - fr.x || f.y < fr.y || f.y > 1.0 - fr.y;
        if (kind == 0.0 && mod(id.y, 4.0) < 1.0 && f.y < 0.42) frame = true;                       // spandrel band every 4th floor
        if (kind == 1.0 && mod(id.x, 3.0) < 1.0 && f.x < 0.3) frame = true;                         // vertical fins
        vec3 V = normalize(vW - cameraPosition);
        vec3 col;
        if (frame) { col = vec3(0.025, 0.027, 0.032) * (kind == 2.0 ? 0.6 : kind == 1.0 ? 1.8 : 1.0); col += vec3(0.03, 0.035, 0.05) * pow(1.0 - abs(dot(normalize(vW - cameraPosition), n)), 3.0); }
        else {
          vec3 d = vec3(dot(V, rt), dot(V, up), dot(V, -n)); vec2 o = (f - fr) / (1.0 - 2.0 * fr);
          float depth = 0.8; vec3 t3 = vec3(d.x > 0.0 ? (1.0 - o.x) / d.x : -o.x / d.x, d.y > 0.0 ? (1.0 - o.y) / d.y : -o.y / d.y, depth / max(d.z, 1e-3));
          float t = min(min(t3.x, t3.y), t3.z); vec3 hp = vec3(o, 0.0) + d * t;
          vec3 tint = h1(vec3(id, vSeed + 5.0)) < 0.72 ? mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.66), h1(vec3(id, 3.0))) : vec3(0.6, 0.78, 1.0);
          float shade = t == t3.z ? 0.9 : t == t3.x ? 0.62 : (d.y > 0.0 ? 0.78 : 0.42 + 0.3 * hp.z);
          if (t == t3.z && hp.y < 0.38 && abs(hp.x - h1(vec3(id, 9.0))) < 0.22) shade *= 0.25; // furniture silhouette
          float lamp = exp(-pow(length(hp.xy - vec2(0.5, 0.95)), 2.0) * 6.0) * 0.6;
          col = lit > 0.5 ? tint * (shade + lamp) * (0.5 + 0.6 * h1(vec3(id, 11.0))) : vec3(0.012, 0.016, 0.026) * shade * 3.0;
          if (lit > 0.5) { // room detail: a ceiling light strip, a desk edge, now and then a person at the window
            if (t == t3.y && d.y > 0.0) col += tint * 0.9 * smoothstep(0.08, 0.0, abs(hp.x - 0.5) - 0.25) * step(0.35, hp.z) * step(hp.z, 0.65);
            if (t == t3.z && abs(hp.y - 0.32) < 0.025) col *= 0.35;
            float who = h1(vec3(id, 31.0)); if (who < 0.22 && t == t3.z) { float px = 0.25 + who * 2.2; vec2 q = hp.xy - vec2(px, 0.0); if ((abs(q.x) < 0.07 && q.y < 0.5) || length(q - vec2(0.0, 0.58)) < 0.07) col *= 0.12; }
          }
          if (lit > 0.5 && h1(vec3(id, 21.0)) < 0.35) { float bl = h1(vec3(id, 23.0)); if (o.y > 1.0 - bl) col *= 0.18 + 0.1 * step(0.5, fract(o.y * 18.0)); } // blinds
          float F = pow(1.0 - abs(dot(V, n)), 4.0); col += vec3(0.02, 0.025, 0.04) * (0.3 + F); // glass sheen
        }
        float dist = length(vW - cameraPosition), k = clamp((dist - 20.0) / 170.0, 0.0, 1.0);
        float low = 1.0 - smoothstep(-9.0, 25.0, vW.y);
        col = mix(col * gain, haze * (1.0 + 0.6 * low), clamp(k * 0.8 + low * k * 0.3, 0.0, 0.92));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  const crownMats = [new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.55, 0.25) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.6, 1.0) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.3, 0.6) })];
  const roofM = new THREE.MeshBasicMaterial({ color: 0x0a0c10 });
  // sodium haze glowing up from the streets along the horizon
  const glowT = canvasTex(16, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,140,80,0)'); gr.addColorStop(0.55, 'rgba(255,130,80,0.05)'); gr.addColorStop(0.85, 'rgba(255,150,90,0.28)'); gr.addColorStop(1, 'rgba(255,170,110,0.42)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(240, 240, 90, 48, 1, true), new THREE.MeshBasicMaterial({ map: glowT, transparent: true, depthWrite: false, side: THREE.BackSide }));
  glow.position.set(cx, 20, cz); glow.userData.cityDetail = true; glow.renderOrder = -1; C.scene.add(glow);
  let n = 0;
  for (let tries = 0; tries < 1600 && n < 150; tries++) {
    const far = n >= 75, x = far ? rr(-230, 60) : rr(-110, 40), z = far ? rr(-230, 60) : rr(-110, 40);
    if (!(x < -6 || z < -6)) continue;
    const d = Math.hypot(x - cx, z - cz); if (far ? d < 120 || d > 230 : d < 28 || d > 125) continue;
    const w = rr(10, 30), dd = rr(10, 30), hgt = d < 45 ? rr(14, 45) : far ? rr(50, 190) : rr(30, 120);
    const shp = lr(), rad = Math.min(w, dd) / 2;
    const geo = !far && d < 40 ? new THREE.BoxGeometry(w, hgt, dd) : shp < 0.16 ? new THREE.CylinderGeometry(rad, rad, hgt, 28) : shp < 0.28 ? new THREE.CylinderGeometry(rad * 1.15, rad * 1.25, hgt, 8) : shp < 0.36 ? new THREE.CylinderGeometry(rad * 0.75, rad * 1.2, hgt, 4) : new THREE.BoxGeometry(w, hgt, dd), sd = rnd() * 100; geo.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(sd), 1));
    const ry = rr(-0.2, 0.2) + (rnd() < 0.5 ? 0 : Math.PI / 2);
    const b = new THREE.Mesh(geo, cityM); b.position.set(x, -9 + hgt / 2, z); b.rotation.y = ry; b.userData.city = true; C.scene.add(b);
    // setback upper tiers and lit crowns make the silhouettes read as real towers
    let top = -9 + hgt;
    if (hgt > 35 && rnd() < 0.6) { const h2 = hgt * rr(0.15, 0.35), g2 = new THREE.BoxGeometry(w * rr(0.55, 0.8), h2, dd * rr(0.55, 0.8)); g2.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(g2.attributes.position.count).fill(sd + 1), 1)); const b2 = new THREE.Mesh(g2, cityM); b2.position.set(x, top + h2 / 2, z); b2.rotation.y = ry; b2.userData.city = true; C.scene.add(b2); top += h2; }
    if (rnd() < 0.45) { const cm = crownMats[Math.floor(rnd() * crownMats.length)], cr = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6 + 0.4, 1.2, dd * 0.6 + 0.4), cm); cr.position.set(x, top - 0.8, z); cr.rotation.y = ry; cr.userData.cityDetail = true; C.scene.add(cr); }
    if (rnd() < 0.35) { const an = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 8, 6), roofM); an.position.set(x, top + 4, z); an.userData.cityDetail = true; C.scene.add(an); }
    if (hgt > 50 && rnd() < 0.7) { const bl = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beaconM || (beaconM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.15, 0.1) }))); bl.position.set(x, -9 + hgt + 1, z); C.scene.add(bl); }
    n++;
  }
  // a second, denser ring of mid-distance towers (own rng, so the room layout is unchanged): varied shapes, crowns
  for (let i = 0, tries = 0; i < 70 && tries < 900; tries++) {
    const a = -Math.PI * 0.05 - lr() * Math.PI * 0.6 + Math.PI, d = 55 + lr() * 90, x = cx + Math.cos(a) * d * 0 + (-1) * Math.abs(Math.cos(a)) * d * (lr() < 0.5 ? 1 : 0.3), z = cz - Math.abs(Math.sin(a)) * d;
    if (!(x < -6 || z < -6)) continue; i++;
    const w = 8 + lr() * 16, dd = 8 + lr() * 16, hgt = 25 + lr() * 95, shp = lr(), rad = Math.min(w, dd) / 2;
    const geo = shp < 0.2 ? new THREE.CylinderGeometry(rad, rad, hgt, 24) : shp < 0.32 ? new THREE.CylinderGeometry(rad * 0.8, rad * 1.15, hgt, 6) : new THREE.BoxGeometry(w, hgt, dd);
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(200 + lr() * 300), 1));
    const b = new THREE.Mesh(geo, cityM); b.position.set(x, -9 + hgt / 2, z); b.rotation.y = lr() * 1.5; b.userData.city = true; C.scene.add(b);
    if (lr() < 0.5) { const t2 = new THREE.BoxGeometry(w * 0.6, hgt * 0.18, dd * 0.6); t2.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(t2.attributes.position.count).fill(700 + lr() * 100), 1)); const u = new THREE.Mesh(t2, cityM); u.position.set(x, -9 + hgt + hgt * 0.09, z); u.rotation.y = b.rotation.y; u.userData.city = true; C.scene.add(u); }
    if (lr() < 0.4) { const cr = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.8, dd * 0.5), crownMats[Math.floor(lr() * 3)]); cr.position.set(x, -9 + hgt + 0.4, z); cr.rotation.y = b.rotation.y; cr.userData.cityDetail = true; C.scene.add(cr); }
  }
  // open up the near view: no tall towers right across the street (they flattened the view into one facade); the
  // low block below takes their place and the towers start a street further out
  for (const o of C.scene.children.slice()) if ((o.userData.city || o.userData.cityDetail || o.material === beaconM) && o.geometry && !o.geometry.parameters?.radiusTop?.toString().startsWith('24')) { const d = Math.hypot(o.position.x - cx, o.position.z - cz); if (d > 20 && d < 50) C.scene.remove(o); }
  // the block across the street: low roofs a few storeys below the office, with plant rooms, water tanks, AC units,
  // parapets and a few lit skylights; strong parallax as the camera moves, so the view has a foreground layer
  const roofKit = new THREE.MeshLambertMaterial({ color: 0x34373c }), roofTar = roofKit, skyLit = crownMats[0];
  const addB = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.userData.cityDetail = true; C.scene.add(o); return o; };
  const near = [[X0 - 16, 1.5, 14, 22, 5], [X0 - 19, 13, 18, 16, 3.5], [X0 - 31, -8, 16, 20, 8], [X0 - 34, 14, 14, 18, 6.5], [cx - 6, Z0 - 17, 20, 14, 4.5], [cx + 10, Z0 - 21, 16, 18, 6], [cx - 4, Z0 - 35, 18, 16, 9], [cx + 16, Z0 - 37, 14, 14, 7], [X0 - 22, Z0 - 20, 18, 18, 3]];
  for (const [x, z, w, dd, hgt] of near) {
    const geo = new THREE.BoxGeometry(w, hgt, dd), sd = 500 + lr() * 100; geo.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(sd), 1));
    const b = new THREE.Mesh(geo, cityM); b.position.set(x, -9 + hgt / 2, z); b.userData.city = true; C.scene.add(b);
    const top = -9 + hgt;
    addB(new THREE.BoxGeometry(w + 0.4, 0.9, 0.3), roofKit, x, top + 0.45, z - dd / 2); addB(new THREE.BoxGeometry(w + 0.4, 0.9, 0.3), roofKit, x, top + 0.45, z + dd / 2);
    addB(new THREE.BoxGeometry(0.3, 0.9, dd), roofKit, x - w / 2, top + 0.45, z); addB(new THREE.BoxGeometry(0.3, 0.9, dd), roofKit, x + w / 2, top + 0.45, z);
    addB(new THREE.BoxGeometry(w - 0.4, 0.05, dd - 0.4), roofTar, x, top + 0.03, z);
    addB(new THREE.BoxGeometry(w * 0.3, 2.6, dd * 0.25), roofKit, x + w * 0.2, top + 1.3, z - dd * 0.15);                 // plant room
    for (let i = 0; i < 4; i++) addB(new THREE.BoxGeometry(1.4, 1.0, 1.0), roofKit, x - w * 0.3 + i * 1.8, top + 0.5, z + dd * 0.25); // AC units
    const tk = addB(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 16), roofKit, x - w * 0.25, top + 3.4, z - dd * 0.25);     // water tank on legs
    for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addB(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 5), roofKit, tk.position.x + a * 0.9, top + 1.1, tk.position.z + c * 0.9);
    addB(new THREE.ConeGeometry(1.4, 0.7, 16), roofKit, tk.position.x, top + 4.95, tk.position.z);
    for (let i = 0; i < 3; i++) addB(new THREE.BoxGeometry(1.6, 0.25, 1.1), skyLit, x + rr(-w * 0.3, w * 0.3) * 0 + (i - 1) * 2.4, top + 0.15, z + dd * 0.05);       // lit skylights
  }
}

// ---------- global light rig ----------
// warm uplights on the steel beams: wash the ceiling and the upper walls (and fill the dark back corner)
let upM;
function uplight(x, z) { // fixture + baked fill (feeds the irradiance volume; no runtime light, to keep the per-pixel cost flat)
  const M = C.M, g = group(null, x, H - 0.36, z);
  cyl(0.07, 0.05, 0.08, M.steel, 0, 0, 0, g, 16, false); cyl(0.06, 0.06, 0.005, upM || (upM = emissive(0xffe0b8, 2)), 0, 0.043, 0, g, 16, false);
  (C.fakeLights || (C.fakeLights = [])).push({ x, y: H - 0.15, z, color: new THREE.Color(0xffd9b0), intensity: 3.6 });
}
export function buildLightRig() {
  for (const [x, z] of [[3.5, 3.0], [3.5, 8.0], [11.5, 3.0], [11.5, 8.0]]) uplight(x, z);
  // bounce fill for the back half (light coming off the lit floor, desks and walls there): baked into the GI volume only
  for (const [x, y, z, c, k] of [[2.6, 1.3, 2.0, 0xffcfa0, 1.6], [7.5, 1.4, 1.6, 0xffc8a8, 1.5], [12.3, 1.3, 2.2, 0xffd2a8, 1.8], [13.4, 1.2, 5.6, 0xd8dcff, 1.5], [12.6, 1.2, 9.4, 0xffd2a8, 1.6], [8.5, 1.1, 9.8, 0xffcfa0, 1.2], [2.0, 1.2, 6.0, 0xffd6b0, 1.0]])
    C.fakeLights.push({ x, y, z, color: new THREE.Color(c), intensity: k * 1.5 });
  C.scene.add(new THREE.HemisphereLight(0x6a78a0, 0x3a2a20, 0.42));
  // soft warm key from above the open floor (no shadow; shapes read, walls and floor pick up a lit side)
  { const key = new THREE.DirectionalLight(0xffe2c4, 0.55); key.position.set(10, 6, 9); key.target.position.set(6, 0, 4); C.scene.add(key, key.target); }
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
  const m = plane(0.5, 0.125, new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide }), x, y, z, g); m.rotation.y = ry; m.rotation.z = rr(-0.08, 0.08); m.userData.dynamic = true;
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
  headphones(g, r.cx + 0.62, y, dz + 0.22, 0.6);
  place('desk_lamp_arm_01', r.cx + 0.85, y, dz - 0.25, -2.2, 1, g);
  lampPoint(r.cx + 0.66, y + 0.45, dz - 0.12, 0xffb46b, 0.45, 2.2, id);
  place('potted_plant_04', r.cx - 0.88, y, dz - 0.27, 0.4, 1.2, g);
  place('office_notepads', r.cx - 0.5, y, dz + 0.08, 0.1, 0.5, g, { pick: /sticky_stack/, shadow: false });
  pcTower(g, r.cx + 0.72, dz + 0.02, 0, 0x6a5cff, id);
  // the chair is parked beside the desk; the robot pulls it in when it sits down
  (C.chairs || (C.chairs = {})).hunt = { g: officeChair(g, r.cx + 0.9, dz + 0.8, -Math.PI / 2, { jacket: 0x3b2f2a, exact: true, noArms: true }), park: [r.cx + 0.9, dz + 0.8, -Math.PI / 2], sit: [r.cx + 0.05, dz + 0.725, 0] };
  backpack(g, r.cx - 1.25, dz + 0.55, 0.5, 0x2c3540);
  bin(g, r.cx - 1.25, dz + 0.1);
  powerStrip(g, r.cx + 0.2, dz - 0.2, 0.3);
  cable(g, [[r.cx, y + 0.12, dz - 0.26], [r.cx + 0.1, y - 0.1, dz - 0.36], [r.cx + 0.2, 0.3, dz - 0.36], [r.cx + 0.25, 0.02, dz - 0.25]]);
  cable(g, [[r.cx - 0.66, y + 0.1, dz - 0.22], [r.cx - 0.5, y - 0.15, dz - 0.36], [r.cx - 0.2, 0.25, dz - 0.38], [r.cx + 0.1, 0.02, dz - 0.22]]);
  cable(g, [[r.cx + 0.66, y + 0.1, dz - 0.22], [r.cx + 0.5, y - 0.2, dz - 0.36], [r.cx + 0.35, 0.02, dz - 0.25]]);
  floorCable(g, [r.cx + 0.2, dz - 0.2], [r.cx + 1.6, dz - 0.6]);
  // nameplate
  const np = canvasTex(256, 64, (q, w, h) => { q.fillStyle = '#1a1612'; q.fillRect(0, 0, w, h); q.fillStyle = '#d9b77a'; q.font = 'bold 26px Georgia'; q.textAlign = 'center'; q.fillText('FOUNDER', w / 2, 42); });
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.02), [M.brass, M.brass, M.brass, M.brass, new THREE.MeshStandardMaterial({ map: np, roughness: 0.4, metalness: 0.3 }), M.brass]); pl.position.set(r.cx - 0.62, y + 0.025, dz + 0.3); pl.rotation.x = -0.4; g.add(pl);
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
  place('clipboard', r.cx - 0.5, y, r.cz - 0.06, 0.6, 1, g, { shadow: false });
  place('binder_notebook', r.cx + 0.45, y, r.cz + 0.26, 0.2, 1, g, { pick: /closed/, shadow: false });
  // desk phone
  const ph = group(g, r.cx - 0.8, y, r.cz - 0.12, 0.3); rbox(0.2, 0.05, 0.18, 0.02, M.plastic, 0, 0.025, 0, ph); rbox(0.2, 0.04, 0.05, 0.02, M.plastic, 0, 0.07, -0.05, ph);
  (C.chairs || (C.chairs = {})).contract = { g: officeChair(g, r.cx + 1.36, r.cz + 0.82, -Math.PI / 2, { mat: M.leatherBrown, exact: true, noArms: true }), park: [r.cx + 1.36, r.cz + 0.82, -Math.PI / 2], sit: [r.cx + 0.1, r.cz + 0.705, 0] };
  pcTower(g, r.cx - 0.8, r.cz + 0.05, 0, 0xff7a2b, id);
  for (let i = 0; i < 2; i++) { box(0.26, 0.05, 0.34, std(0x232528, 0.4, 0.8), r.cx + 0.82, y + 0.025 + i * 0.07, r.cz - 0.2, 1, g); papers(g, r.cx + 0.82, y + 0.03 + i * 0.07, r.cz - 0.2, 3, 0.15); }
  bin(g, r.cx - 0.55, r.cz - 0.65);
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
  // the door hangs on a hinge (left edge) so the robot can swing it open; the dial and wheel turn
  rbox(0.58, 0.94, 0.02, 0.01, std(0x0b0d0c, 0.6, 0.2), 0, 0.53, 0.302, safe); // dark recess behind the door
  const door = group(safe, -0.28, 0, 0.3); door.userData.dynamic = true; door.userData.contact = 'surface'; door.userData.compact = true; door.name = 'safe_door';
  rbox(0.56, 0.92, 0.045, 0.015, std(0x34423b, 0.28, 0.8), 0.28, 0.53, 0.025, door);
  rbox(0.46, 0.8, 0.012, 0.01, std(0x2a3530, 0.35, 0.8), 0.28, 0.53, 0.052, door);  // inset panel
  const dial = group(door, 0.38, 0.68, 0.06); dial.userData.compact = true; dial.name = 'safe_dial';
  const dm = cyl(0.07, 0.07, 0.03, M.brass, 0, 0, 0, dial, 32); dm.rotation.x = Math.PI / 2;
  for (let i = 0; i < 24; i++) { const tk = box(0.004, 0.014, 0.004, std(0x1a1a1a, 0.5), Math.sin(i / 24 * 6.283) * 0.058, Math.cos(i / 24 * 6.283) * 0.058, 0.017, 1, dial, false); tk.rotation.z = -i / 24 * 6.283; }
  box(0.01, 0.03, 0.006, std(0xb3261e, 0.4), 0, 0.075, 0.02, 1, dial, false);
  const wheel = group(door, 0.18, 0.55, 0.07); wheel.userData.compact = true; wheel.name = 'safe_wheel';
  for (let i = 0; i < 3; i++) { const sp = cyl(0.008, 0.008, 0.16, M.alu, 0, 0, 0, wheel, 8); sp.rotation.z = (i / 3) * Math.PI; }
  cyl(0.025, 0.025, 0.05, M.alu, 0, 0, -0.01, wheel, 16).rotation.x = Math.PI / 2;
  for (const yy of [0.25, 0.85]) cyl(0.02, 0.02, 0.1, M.steelLight, 0.57, yy, 0.03, door, 12);
  // inside: cash bricks and ledgers on a shelf, revealed when the door opens
  box(0.5, 0.015, 0.45, std(0x5a5a52, 0.6, 0.4), 0, 0.5, 0.05, 1, safe, false);
  binders(safe, -0.2, 0.51, 0.05, 4, 0);
  C.safe = { door, dial, wheel };
  // a key light on the safe so it reads in the dark corner (brightens while the robot works it)
  const key = new THREE.SpotLight(0xffe2bb, 3.5, 4, 0.55, 0.6, 2); key.position.set(r.cx - 1.1, 2.4, r.z0 + 0.45); key.target.position.set(r.cx - 0.1, 0.55, r.z0 + 0.42); addLight(key); C.safe.key = key;
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
  lampPoint(r.cx - 0.05, 1.3, r.z0 + 0.36, 0xffc27a, 1.0, 2.2, id);
  // filing cabinet
  const fc = group(g, r.cx + 0.05, 0, r.z1 - 0.32, -Math.PI / 2);
  rbox(0.46, 1.32, 0.6, 0.012, worn(0x5d6466, { ns: 0.12 }), 0, 0.66, 0, fc);
  for (let i = 0; i < 4; i++) { const dy = 0.18 + i * 0.32; rbox(0.42, 0.3, 0.018, 0.006, worn(0x6b7376, { ns: 0.12 }), 0, dy, 0.305, fc); box(0.13, 0.03, 0.012, M.steel, 0, dy + 0.09, 0.318, 1, fc); box(0.11, 0.016, 0.02, M.alu, 0, dy + 0.085, 0.326, 1, fc); box(0.09, 0.045, 0.004, M.alu, 0, dy + 0.035, 0.316, 1, fc); box(0.08, 0.035, 0.003, M.paper, 0, dy + 0.035, 0.319, 1, fc); }
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
  books(g, r.cx - 0.95, y, r.cz - 0.22, 7, 0);
  books(g, r.cx - 0.85, y, r.cz + 0.15, 1);
  const open = group(g, r.cx + 0.05, y + 0.012, r.cz + 0.22, -0.2); for (const s of [-1, 1]) { const p = box(0.16, 0.012, 0.22, M.paper, s * 0.08, 0, 0, 1, open, false); p.rotation.z = s * -0.06; }
  papers(g, r.cx + 0.6, y, r.cz + 0.2, 2);
  mug(g, r.cx + 0.88, y, r.cz + 0.18, 0x8a2c2c);
  place('rubber_duck_toy', r.cx + 0.82, y, r.cz - 0.22, -0.6, 0.5, g, { shadow: false });
  officeChair(g, r.cx - 0.95, r.cz + 0.72, 0.6);
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
  const wb = group(g, r.cx + 1.47, 0, r.z0 - 0.12); wb.scale.set(0.95, 0.8, 1);
  // its back (seen from the terminals): the agent fleet's sprint board, a taped network map and sticky-note columns
  const wbB = canvasTex(1024, 640, (c, w, h) => {
    c.fillStyle = '#eef0ec'; c.fillRect(0, 0, w, h); c.lineCap = 'round';
    c.fillStyle = 'rgba(0,0,0,.04)'; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(rr(0, w), rr(0, h), rr(60, 160), rr(10, 30), rr(0, 3), 0, 7); c.fill(); }
    c.fillStyle = '#1b1b1b'; c.font = 'bold 40px "Marker Felt", "Comic Sans MS", cursive'; c.fillText('AGENT FLEET · SPRINT 3', 36, 62);
    // taped printout: a small network map of the six terminals
    c.save(); c.translate(560, 110); c.rotate(-0.03); c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, 420, 300); c.strokeStyle = '#d8d8d2'; c.strokeRect(0, 0, 420, 300);
    c.fillStyle = '#3a3a3a'; c.font = 'bold 18px Menlo, monospace'; c.fillText('lab net 10.0.3.0/24', 16, 28);
    const nodes = [['scout', 70, 90], ['fuzzer', 210, 70], ['triage', 340, 100], ['repro', 90, 220], ['writer', 220, 240], ['ledger', 350, 220]];
    c.strokeStyle = '#2a6fb0'; c.lineWidth = 2; for (const [, x, y] of nodes) { c.beginPath(); c.moveTo(210, 160); c.lineTo(x, y); c.stroke(); }
    c.fillStyle = '#2a6fb0'; c.beginPath(); c.arc(210, 160, 16, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 11px Menlo, monospace'; c.fillText('GW', 201, 164);
    for (const [n, x, y] of nodes) { c.fillStyle = '#e8f1fa'; c.fillRect(x - 38, y - 14, 76, 28); c.strokeStyle = '#2a6fb0'; c.strokeRect(x - 38, y - 14, 76, 28); c.fillStyle = '#1b3a5a'; c.font = '13px Menlo, monospace'; c.fillText(n, x - 30, y + 5); }
    c.restore();
    c.fillStyle = 'rgba(240,230,170,.75)'; for (const [x, y, a] of [[560, 100, -0.5], [960, 96, 0.4], [570, 400, 0.3], [968, 398, -0.4]]) { c.save(); c.translate(x, y); c.rotate(a); c.fillRect(-30, -9, 60, 18); c.restore(); }
    // kanban columns
    ['TODO', 'DOING', 'DONE'].forEach((t, i) => { const x = 36 + i * 170; c.fillStyle = '#333'; c.font = 'bold 24px "Marker Felt", cursive'; c.fillText(t, x + 10, 120); c.strokeStyle = '#999'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 160, 96); c.lineTo(x + 160, 600); c.stroke();
      const notes = [['rate-limit\nfuzz', 'auth bypass\nrepro', 'write-up\n#14'], ['triage\nqueue', 'retest\nIDOR'], ['ledger\nsync', 'scope\nreview', 'SSRF\nfixed']][i];
      notes.forEach((n, k) => { c.save(); c.translate(x + 14 + (k % 2) * 8, 140 + k * 140); c.rotate(rr(-0.08, 0.08)); c.fillStyle = ['#ffe873', '#ff9ec7', '#8de3ff', '#b9f59a'][(i + k) % 4]; c.fillRect(0, 0, 130, 118); c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(0, 108, 130, 10);
        c.fillStyle = '#2b2b2b'; c.font = '21px "Marker Felt", cursive'; n.split('\n').forEach((ln, j) => c.fillText(ln, 10, 40 + j * 28)); c.restore(); }); });
    c.strokeStyle = '#b3261e'; c.lineWidth = 5; c.beginPath(); c.moveTo(600, 470); c.lineTo(960, 470); c.stroke(); c.fillStyle = '#b3261e'; c.font = 'bold 30px "Marker Felt", cursive'; c.fillText('ship Friday!', 640, 540);
  });
  { const wm = std(0xd8d8d8, 0.3, 0, { map: wbT }), wmB = std(0xd8d8d8, 0.32, 0, { map: wbB }), bm = std(0x9a9c9e, 0.6); const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.03), [bm, bm, bm, bm, wm, wmB]); b.position.set(0, 1.45, 0); b.castShadow = b.receiveShadow = true; b.userData.contact = 'surface'; wb.add(b); }
  box(1.64, 0.025, 0.04, M.alu, 0, 1.96, 0, 1, wb); box(1.64, 0.025, 0.04, M.alu, 0, 0.94, 0, 1, wb);
  box(1.4, 0.03, 0.07, M.alu, 0, 0.93, 0.03, 1, wb);
  for (let i = 0; i < 3; i++) { const mk = cyl(0.008, 0.008, 0.12, std([0x1f3b8f, 0xb3261e, 0x1b7a3a][i], 0.4), -0.3 + i * 0.05, 0.955, 0.04, wb, 8, false); mk.rotation.z = Math.PI / 2; }
  for (const s of [-1, 1]) { box(0.035, 1.9, 0.035, M.alu, s * 0.82, 0.98, 0, 1, wb); box(0.035, 0.035, 0.5, M.alu, s * 0.82, 0.06, 0, 1, wb); }
  C.colliders.push({ x0: r.cx + 1.47 - 0.8, x1: r.cx + 1.47 + 0.8, z0: r.z0 - 0.4, z1: r.z0 - 0.02 });
  pendant(r.cx, r.cz + 0.15, 1.15, { shadow: true, id, intensity: 10, tz: 0.35 });
  lampPoint(r.cx + 0.42, y + 0.45, r.cz - 0.02, 0xa58cff, 0.5, 2.0, id);
  standbyTag(g, r.cx, y + 0.45, r.cz - 0.2, 0, id);
}
function buildForge() { // Agent Forge: a workbench where tools get built.
  const id = 'forge', r = tr(4, 10, 2, 1), g = stationGroup(id), M = C.M, y = 0.92;
  rbox(1.5, 0.05, 0.72, 0.006, M.walnut, r.cx, y - 0.025, r.cz, g).userData.contact = 'surface';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, y - 0.05, 0.05, M.steel, r.cx + sx * 0.68, (y - 0.05) / 2, r.cz + sz * 0.3, 1, g);
  box(1.4, 0.03, 0.62, M.walnut, r.cx, 0.22, r.cz, 1, g);
  const peg = canvasTex(512, 256, (c, w, h) => { c.fillStyle = '#b08a5c'; c.fillRect(0, 0, w, h); c.fillStyle = '#3b2a18'; for (let x = 8; x < w; x += 16) for (let yy = 8; yy < h; yy += 16) { c.beginPath(); c.arc(x, yy, 2.4, 0, 7); c.fill(); } });
  box(1.5, 0.75, 0.02, std(0xffffff, 0.8, 0, { map: peg }), r.cx, y + 0.55, r.z0 - 0.02, 1, g);
  C.colliders.push({ x0: r.cx - 0.8, x1: r.cx + 0.8, z0: r.z0 - 0.1, z1: r.z0 });
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
  const spool = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 10, 28), std(0xb8501a, 0.6)); spool.position.set(0.25, 0.4, 0); spool.scale.setScalar(0.7); spool.rotation.y = Math.PI / 2; pr.add(spool);
  cyl(0.035, 0.035, 0.045, M.plastic, 0.25, 0.4, 0, pr, 20).rotation.z = Math.PI / 2;
  cable(pr, [[0.25, 0.47, 0], [0.18, 0.56, 0], [0.04, 0.4, 0], [0.04, 0.33, 0]], 0.0015, std(0xb8501a, 0.6));
  const enc = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.4), new THREE.MeshStandardMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })); enc.position.y = 0.26; enc.userData.noAO = true; pr.add(enc);
  const partM = new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff7a2a, emissiveIntensity: 1.4 });
  cyl(0.05, 0.07, 0.09, partM, 0, 0.09, 0, pr, 6);
  const pl = new THREE.PointLight(0xff8a3d, 0.9, 1.6, 2); pl.position.set(r.cx - 0.42, y + 0.3, r.cz - 0.06); addLight(pl, id);
  onPower(id, on => (partM.emissiveIntensity = on ? 1.4 : 0));
  place('circuit_board', r.cx + 0.15, y, r.cz + 0.1, 0.3, 0.5, g, { shadow: false, contact: 'surface' }); // the robot solders on it
  place('retro_multimeter', r.cx + 0.5, y, r.cz - 0.15, -0.5, 1, g);
  place('metal_toolbox', r.cx + 0.3, 0.235, r.cz, 0.2, 1, g);
  const iron = cyl(0.006, 0.01, 0.2, std(0x1a3a8a, 0.4), r.cx + 0.45, y + 0.06, r.cz + 0.18, g, 8, false); iron.rotation.z = 1.2;
  laptop(g, r.cx + 0.1, y, r.cz - 0.12, -0.15, nodeScreen(61), id);
  place('cardboard_box_01', r.cx - 0.4, 0.25, r.cz + 0.05, 0.3, 0.7, g);
  can(g, r.cx + 0.6, y, r.cz - 0.02, 0x2a5fd0); can(g, r.cx + 0.67, y, r.cz + 0.05, 0xc8401e);
  // bench stool
  const st = group(g, r.cx + 0.62, 0, r.cz + 0.78); cyl(0.17, 0.17, 0.04, M.leatherBrown, 0, 0.66, 0, st); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, lg = cyl(0.012, 0.012, 0.68, M.steel, Math.cos(a) * 0.12, 0.33, Math.sin(a) * 0.12, st, 6); lg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); } const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.008, 6, 20), M.steel); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; st.add(ring);
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
  rbox(2.3, 1.32, 0.05, 0.01, M.plastic, 0, 0, 0, disp).userData.contact = 'surface';
  const gm = screenMat(goalTex, 1.2), sc = plane(2.26, 1.27, gm, 0, 0, 0.026, disp); powerScreen(id, sc, gm); disp.userData.contact = 'surface';
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
  const tp = group(g, r.cx - 0.25, 0.67, Z0 + 0.3); box(0.08, 0.04, 0.08, M.walnut, 0, 0.02, 0, 1, tp); cyl(0.012, 0.012, 0.08, M.brass, 0, 0.08, 0, tp); const cup = new THREE.Mesh(new THREE.LatheGeometry([0, 0.02, 0.04, 0.05, 0.052].map((x, i) => new THREE.Vector2(x, i * 0.025)), 20), M.brass); cup.position.y = 0.12; tp.add(cup);
  // standing command table with a tablet
  const ct = group(g, r.cx + 1.5, 0, r.z1 - 0.32);
  cyl(0.03, 0.03, 1.0, M.steel, 0, 0.5, 0, ct); cyl(0.2, 0.22, 0.02, M.steel, 0, 0.01, 0, ct, 32);
  rbox(0.6, 0.03, 0.4, 0.006, M.walnut, 0, 1.02, 0, ct);
  const tab = rbox(0.25, 0.008, 0.18, 0.004, M.plastic, 0.02, 1.04, 0, ct); tab.rotation.y = 0.2;
  const tm = screenMat(dashScreen(61, '#22d3ee'), 1.1), ts = plane(0.23, 0.16, tm, 0.02, 1.045, 0, ct); ts.rotation.x = -Math.PI / 2; ts.rotation.z = 0.2; powerScreen(id, ts, tm);
  coffeeCup(ct, -0.2, 1.035, 0.08);
  place('calathea_orbifolia_01', r.x0 + 0.2, 0, Z0 + 0.35, 0.4, 0.9, g, { pick: /_c$/ });
}
const rackLeds = [];
function buildRig() { // GPU Rig: server racks with blinking LEDs.
  const id = 'rig', r = tr(16, 12, 3, 1), g = stationGroup(id), M = C.M;
  const face = canvasTex(512, 1024, (c, w, h) => {
    c.fillStyle = '#08090b'; c.fillRect(0, 0, w, h);
    for (let u = 0; u < 22; u++) {
      const y = 12 + u * 45, kind = u % 5; c.fillStyle = '#15171b'; c.fillRect(16, y, w - 32, 41); c.fillStyle = '#202329'; c.fillRect(16, y, w - 32, 2);
      c.fillStyle = '#6a6e75'; c.beginPath(); c.arc(26, y + 20, 4, 0, 7); c.arc(w - 26, y + 20, 4, 0, 7); c.fill(); // rack screws
      if (kind === 0) { for (let i = 0; i < 12; i++) { c.fillStyle = '#1d2026'; c.fillRect(70 + i * 33, y + 6, 29, 29); c.fillStyle = '#0d0e10'; c.fillRect(74 + i * 33, y + 12, 21, 4); c.fillStyle = rnd() < 0.7 ? '#2bff88' : '#ffb02b'; c.fillRect(92 + i * 33, y + 28, 4, 3); } }
      else if (kind === 4) { c.fillStyle = '#0e1013'; c.fillRect(60, y + 6, w - 120, 29); c.fillStyle = '#2bb8ff'; c.font = 'bold 18px Menlo, monospace'; c.fillText('GPU-NODE-' + String(u).padStart(2, '0') + '  OK', 80, y + 27); }
      else { c.fillStyle = '#25282e'; for (let yy = y + 8; yy < y + 34; yy += 5) for (let xx = 120; xx < w - 60; xx += 6) c.fillRect(xx, yy, 3, 3); c.fillStyle = '#0d0e10'; c.fillRect(40, y + 10, 60, 20); }
      for (let i = 0; i < 4; i++) { c.fillStyle = rnd() < 0.6 ? '#2bff88' : rnd() < 0.5 ? '#2bb8ff' : '#ffb02b'; c.fillRect(46 + i * 12, y + 16, 6, 6); }
    }
  });
  const rackM = worn(0x17181b, { roughness: 0.6, metalness: 0.7, ns: 0.4 });
  for (let i = 0; i < 3; i++) {
    const x = r.x0 + 0.38 + i * 0.72, rk = group(g, x, 0, 10.05, 0); rk.scale.z = 0.83;
    rbox(0.68, 1.95, 0.72, 0.01, rackM, 0, 0.975, 0, rk).userData.contact = 'surface'; // the robot's hands work on its front
    const fm = new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.5 });
    const f = plane(0.56, 1.8, fm, 0, 0.98, -0.362, rk); f.rotation.y = Math.PI;
    const gl = plane(0.6, 1.86, new THREE.MeshPhysicalMaterial({ color: 0x9fb0c0, roughness: 0.08, transparent: true, opacity: 0.05, envMapIntensity: 0.8, depthWrite: false }), 0, 0.98, -0.37, rk); gl.rotation.y = Math.PI; gl.userData.noAO = true;
    box(0.03, 1.2, 0.03, M.alu, 0.26, 1.0, -0.38, 1, rk); rbox(0.7, 0.05, 0.74, 0.01, M.steel, 0, 1.975, 0, rk); rbox(0.66, 0.06, 0.7, 0.008, M.rubber, 0, 0.03, 0, rk);
    for (const sx of [-1, 1]) box(0.025, 1.86, 0.02, M.steel, sx * 0.3, 0.98, -0.372, 1, rk); for (const yy of [0.06, 1.9]) box(0.62, 0.025, 0.02, M.steel, 0, yy, -0.372, 1, rk);
    // warning label
    const wl = plane(0.12, 0.08, new THREE.MeshStandardMaterial({ map: canvasTex(64, 48, (q, w, h) => { q.fillStyle = '#f5c518'; q.fillRect(0, 0, w, h); q.fillStyle = '#111'; q.beginPath(); q.moveTo(32, 6); q.lineTo(56, 42); q.lineTo(8, 42); q.closePath(); q.fill(); q.fillStyle = '#f5c518'; q.font = 'bold 22px Arial'; q.fillText('!', 28, 38); }), roughness: 0.6 }), -0.2, 1.75, -0.375, rk); wl.rotation.y = Math.PI;
    rackLeds.push(fm);
    onPower(id, on => { fm.emissiveIntensity = on ? 0.8 : 0.02; fm.userData.off = !on; });
  }
  for (let i = 0; i < 4; i++) cable(g, [[r.x0 + 0.3 + i * 0.5, 1.95, r.cz + 0.2], [r.x0 + 0.3 + i * 0.5, 2.6, r.cz + 0.25], [r.x0 + 0.2 + i * 0.45, H - 0.05, r.cz + 0.3]], 0.012);
  lampPoint(r.cx, 1.6, 8.95, 0x3fb8ff, 0.8, 2.0, id);
  // floor fan and a crate of spare parts
  place('plastic_crate_02', r.x0 - 0.55, 0, r.cz + 0.82, 0.3, 1, g);
}
function buildTerminals() { // six one-tile agent terminals: compact pods where the AI agents run
  const id = 'terminals', g = stationGroup(id), M = C.M, names = ['scout', 'fuzzer', 'triage', 'repro', 'writer', 'ledger'];
  [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]].forEach((p, i) => {
    // pods sit back to back: row 10 faces north (screens toward its north side), row 11 faces south
    const r = tr(p[0], p[1], 1, 1), north = p[1] === 10, ry = north ? Math.PI : 0, cz = r.cz + (north ? 0.12 : -0.12);
    const pod = group(g, r.cx, 0, cz, ry);
    rbox(0.7, 0.03, 0.44, 0.006, M.oak, 0, 0.74, 0, pod).userData.contact = 'surface';
    box(0.03, 0.72, 0.4, M.steel, -0.33, 0.36, 0, 1, pod); box(0.03, 0.72, 0.4, M.steel, 0.33, 0.36, 0, 1, pod);
    box(0.7, 0.42, 0.02, std(0x2e3b3a, 0.9), 0, 0.95, -0.22, 1, pod); // privacy screen between rows
    monitor(pod, 0, 0.755, -0.12, 0, 0.5, 0.29, agentScreen(100 + i, names[i]), { id, k: 1.3 });
    keyboard(pod, -0.05, 0.755, 0.1, 0);
    if (i % 2 === 0 && north) mug(pod, 0.26, 0.755, 0.1, pick([0xf1eee8, 0x2a4f8a, 0x2f4a33]), false);
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
}
// Filling the empty wall runs the wide views see: a printer station and floating shelves on the north wall, a low
// storage credenza with framed prints on the south wall, crates between the west windows, plants, cable runs along
// the skirting. Reuses already-loaded models and shared plain materials, so it all folds into existing draw batches.
function dressWalls() {
  const M = C.M, W = M.walnut, dark = std(0x26282b, 0.5, 0.3), white = std(0xe8e6df, 0.5), kraft = std(0xb08a5c, 0.5);
  const frameArt = (x, y, z, ry, w, h, c1, c2) => { const g = group(null, x, y, z, ry); box(w, h, 0.025, dark, 0, 0, 0, 1, g, false); box(w - 0.06, h - 0.06, 0.004, white, 0, 0, 0.014, 1, g, false); box(w - 0.14, (h - 0.14) * 0.55, 0.004, std(c1, 0.5), 0, (h - 0.14) * 0.2, 0.017, 1, g, false); box(w - 0.14, (h - 0.14) * 0.3, 0.004, std(c2, 0.5), 0, -(h - 0.14) * 0.3, 0.017, 1, g, false); };
  // north wall, east of the HQ credenza: printer station + floating shelves above
  { const x = 9.75, z = Z0 + 0.28; rbox(0.9, 0.74, 0.5, 0.01, dark, x, 0.37, z, null); for (let i = 0; i < 2; i++) box(0.84, 0.005, 0.005, std(0x111111, 0.6), x, 0.25 + i * 0.25, z + 0.252, 1, null, false);
    rbox(0.56, 0.26, 0.44, 0.02, white, x - 0.1, 0.87, z, null); box(0.4, 0.02, 0.2, dark, x - 0.1, 1.0, z + 0.05, 1, null, false); box(0.3, 0.012, 0.24, std(0xf1eee6, 0.6), x - 0.1, 0.92, z + 0.25, 1, null, false);
    box(0.22, 0.12, 0.3, white, x + 0.3, 0.8, z - 0.02, 1, null, false); box(0.21, 0.004, 0.29, std(0x7aa0c8, 0.5), x + 0.3, 0.862, z - 0.02, 1, null, false);
    for (const y of [1.45, 1.85]) { box(1.1, 0.03, 0.24, W, x, y, Z0 + 0.13, 1, null, false); }
    binders(C.scene, x - 0.35, 1.465, Z0 + 0.13, 5, 0); place('potted_plant_04', x + 0.32, 1.465, Z0 + 0.13, 0.2, 0.9);
    books(C.scene, x - 0.3, 1.865, Z0 + 0.13, 6, 0, true); box(0.2, 0.14, 0.18, kraft, x + 0.3, 1.935, Z0 + 0.13, 1, null, false); }
  place('pachira_aquatica_01', 5.1, 0, 1.15, 2.1, 0.75, null, { pick: /_c$/ });
  // south wall, west of the coffee cart: low storage credenza, plant, boxes, framed prints
  { const x = 6.7, z = Z1 - 0.24; rbox(2.2, 0.6, 0.42, 0.01, W, x, 0.3, z, null); for (let i = 0; i < 3; i++) { box(0.7, 0.5, 0.01, W, x - 0.73 + i * 0.73, 0.3, z - 0.215, 0.6, null); box(0.16, 0.012, 0.02, M.brass, x - 0.73 + i * 0.73, 0.44, z - 0.225, 1, null, false); }
    books(C.scene, x - 0.85, 0.6, z, 7, Math.PI); place('ceramic_vase_01', x - 0.3, 0.6, z, 0, 0.9); box(0.32, 0.2, 0.26, kraft, x + 0.25, 0.7, z, 1, null, false); box(0.26, 0.14, 0.2, kraft, x + 0.27, 0.87, z, 1, null, false).rotation.y = 0.25;
    place('potted_plant_04', x + 0.8, 0.6, z, 1.0, 1.1);
    frameArt(x - 0.55, 1.45, Z1 - 0.015, Math.PI, 0.5, 0.65, 0xd4561f, 0x22313f); frameArt(x + 0.1, 1.5, Z1 - 0.015, Math.PI, 0.42, 0.42, 0x2aa198, 0xe8c547); frameArt(x + 0.62, 1.42, Z1 - 0.015, Math.PI, 0.38, 0.5, 0x6b4fa0, 0xe8e6df); }
  place('calathea_orbifolia_01', 9.25, 0, Z1 - 0.3, 1.4, 1.0, null, { pick: /_b$/ });
  // west wall, between the windows: a stack of storage crates with a box on top
  place('plastic_crate_02', X0 + 0.3, 0, 4.95, Math.PI / 2, 0.9); place('plastic_crate_02', X0 + 0.3, 0.3, 4.98, Math.PI / 2 + 0.1, 0.9); place('cardboard_box_01', X0 + 0.3, 0.6, 5.0, 0.3, 0.6);
  // cable runs along the skirting
  for (const [x0, x1, z] of [[1.4, 4.4, Z0 + 0.03], [10.6, 13.6, Z0 + 0.03], [5.2, 9.2, Z1 - 0.03]]) { const c = cyl(0.007, 0.007, x1 - x0, dark, (x0 + x1) / 2, 0.012, z, null, 6, false); c.rotation.z = Math.PI / 2; const c2 = cyl(0.005, 0.005, x1 - x0, dark, (x0 + x1) / 2, 0.025, z + 0.004, null, 6, false); c2.rotation.z = Math.PI / 2; }
  for (const [z0, z1] of [[1.6, 4.4], [5.6, 9.4]]) { const c = cyl(0.007, 0.007, z1 - z0, dark, X1 - 0.03, 0.012, (z0 + z1) / 2, null, 6, false); c.rotation.x = Math.PI / 2; }
}
// The open middle of the floor: a two-chair seating nook by the rug, a whiteboard trolley, a cable protector across
// the floor, bins, standing plants and a stack of gear boxes; everything sits off the walking lanes to the stations.
function dressFloor() {
  const M = C.M, L = M.leatherBrown, dark = std(0x26282b, 0.5, 0.3), white = std(0xe8e6df, 0.5);
  const armchair = (x, z, ry) => { const g = group(null, x, 0, z, ry); rbox(0.7, 0.18, 0.66, 0.04, L, 0, 0.19, 0, g); rbox(0.56, 0.12, 0.5, 0.05, L, 0, 0.34, 0.04, g);
    rbox(0.7, 0.42, 0.14, 0.05, L, 0, 0.5, -0.27, g); for (const s of [-1, 1]) rbox(0.12, 0.2, 0.62, 0.04, L, s * 0.29, 0.38, 0.0, g); for (const s of [-1, 1]) for (const t of [-1, 1]) box(0.04, 0.1, 0.04, dark, s * 0.3, 0.05, t * 0.27, 1, g, false); };
  armchair(9.35, 4.05, Math.PI / 2 + 0.35); armchair(10.55, 4.5, -Math.PI / 2 - 0.25);
  { const t = group(null, 9.95, 0, 4.2); cyl(0.3, 0.3, 0.03, M.walnut, 0, 0.47, 0, t, 28); cyl(0.03, 0.03, 0.45, dark, 0, 0.23, 0, t, 10, false); cyl(0.2, 0.22, 0.02, dark, 0, 0.01, 0, t, 20, false);
    books(t, -0.05, 0.485, 0.05, 3, 0.4); const mg = cyl(0.04, 0.036, 0.095, white, 0.14, 0.533, -0.08, t, 14, false); void mg; }
  // whiteboard trolley (double-sided board on a wheeled frame), facing the room
  { const g = group(null, 4.6, 0, 4.62, 0); for (const s of [-1, 1]) { box(0.035, 1.6, 0.035, M.alu, s * 0.6, 0.85, 0, 1, g, false); box(0.035, 0.035, 0.46, M.alu, s * 0.6, 0.06, 0, 1, g, false); for (const t of [-1, 1]) { const w = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), dark); w.position.set(s * 0.6, 0.025, t * 0.21); g.add(w); } }
    box(1.16, 0.78, 0.025, white, 0, 1.15, 0, 1, g); box(1.2, 0.025, 0.04, M.alu, 0, 1.55, 0, 1, g, false); box(1.2, 0.025, 0.04, M.alu, 0, 0.75, 0, 1, g, false); box(0.9, 0.025, 0.06, M.alu, 0, 0.74, 0.03, 1, g, false);
    for (let i = 0; i < 4; i++) { const n = box(0.09, 0.09, 0.004, std([0xf3d34a, 0xff8fbf, 0x8de3ff, 0xb9f59a][i], 0.5), -0.4 + i * 0.13, 1.3 - (i % 2) * 0.12, 0.015, 1, g, false); n.rotation.z = (i - 1.5) * 0.05; }
    for (let i = 0; i < 5; i++) box(0.3 + (i % 3) * 0.12, 0.012, 0.004, std(0x1f3b8f, 0.5), -0.3 + (i % 2) * 0.25, 1.05 - i * 0.07, 0.014, 1, g, false); }
  // cable protector across the floor from the founder's desk (low enough to walk over)
  { const c = box(1.6, 0.02, 0.14, std(0x2b2d31, 0.7), 5.55, 0.01, 5.0, 1, null, false); c.rotation.y = 0.25; const y = box(1.6, 0.003, 0.03, std(0xd9b42a, 0.5), 5.55, 0.021, 5.0, 1, null, false); y.rotation.y = 0.25; }
  place('metal_trash_can', 8.85, 0, 4.85, 0.4, 0.55); place('metal_trash_can', 2.25, 0, 6.55, 1.1, 0.5);
  place('potted_plant_04', 4.45, 0, 6.45, 0.7, 1.7); place('pachira_aquatica_01', 8.75, 0, 9.25, 2.6, 0.7, null, { pick: /_b$/ });
  place('plastic_crate_02', 7.85, 0, 9.3, 0.15, 0.9); place('plastic_crate_02', 7.85, 0.3, 9.3, 0.25, 0.9); place('cardboard_box_01', 8.25, 0, 9.4, -0.3, 0.8);
}
function buildDecor() {
  const M = C.M;
  sconce(X1 - 0.01, 2.15, 4.45, -Math.PI / 2); sconce(X1 - 0.01, 2.15, 6.7, -Math.PI / 2); sconce(X1 - 0.01, 2.15, 8.05, -Math.PI / 2);
  sconce(6.1, 2.1, Z1 - 0.01, Math.PI); sconce(8.3, 2.1, Z1 - 0.01, Math.PI);
  dressWalls(); dressFloor();
  // corner plants (solid tiles in the 2D office)
  place('pachira_aquatica_01', 1.15, 0, 1.15, 0.3, 0.9, null, { pick: /_b$/ });
  place('pachira_aquatica_01', 13.9, 0, 1.15, 1.2, 0.85, null, { pick: /_c$/ });
  place('calathea_orbifolia_01', 1.15, 0, 10.1, 0.2, 1.1, null, { pick: /_b$/ });
  place('calathea_orbifolia_01', 13.85, 0, 10.1, 2.0, 1.1, null, { pick: /_d$/ });
  // ---- lounge on the south wall, west side ----
  // a low-slung modern leather sofa built to natural proportions (seat 0.33 m, back 0.67 m, arms 0.44 m): plump seat and
  // back cushions with piping, rolled arm pads, a plinth and dark legs; matches the collision proxies below exactly
  { const sf = group(null, 0, 0, 0); sf.name = 'sofa'; const L = M.leatherBrown, D = std(0x1d1b19, 0.5, 0.3);
    sf.userData.noCollider = true;
    rbox(2.74, 0.16, 0.92, 0.04, L, 3.4, 0.12, 10.03, sf);                                   // plinth / frame
    for (const x of [2.12, 4.68]) for (const z of [9.62, 10.42]) box(0.05, 0.05, 0.05, D, x, 0.025, z, 1, sf, false); // legs
    for (let i = 0; i < 3; i++) { const cx = 2.4 + 0.713 * i + 0.356; const c = rbox(0.70, 0.13, 0.5, 0.055, L, cx, 0.268, 9.81, sf); c.userData.contact = 'seat';
      box(0.66, 0.006, 0.006, D, cx, 0.333, 9.565, 1, sf, false);                               // piping along the front
      const b = rbox(0.70, 0.34, 0.2, 0.07, L, cx, 0.47, 10.19, sf); b.rotation.x = -0.12; }
    rbox(2.74, 0.48, 0.2, 0.05, L, 3.4, 0.38, 10.38, sf);                                     // back frame (top 0.62)
    rbox(2.6, 0.04, 0.24, 0.02, L, 3.4, 0.625, 10.3, sf);                                     // back rail the forearms rest on (top 0.645)
    for (const x of [2.18, 4.62]) { rbox(0.28, 0.3, 0.92, 0.06, L, x, 0.24, 10.03, sf); const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.9, 20), L); roll.rotation.x = Math.PI / 2; roll.position.set(x, 0.36, 10.03); roll.castShadow = roll.receiveShadow = true; sf.add(roll); }
    sf.traverse(o => { if (o.isMesh) o.userData.noCollider = true; }); // the sofa_* proxies below describe it exactly
  }
  (C.proxyBoxes || (C.proxyBoxes = [])).push(
    { name: 'sofa_seat', box: [2.33, 0, 9.58, 4.47, 0.333, 10.04], contact: 'seat' }, { name: 'sofa_back', box: [2.05, 0, 10.04, 4.75, 0.666, 10.48], contact: 'seat' },
    { name: 'sofa_arm_left', box: [2.03, 0, 9.56, 2.33, 0.439, 10.48] }, { name: 'sofa_arm_right', box: [4.47, 0, 9.56, 4.77, 0.439, 10.48] });
  C.colliders.push({ x0: 2.05, x1: 4.75, z0: Z1 - 0.95, z1: Z1 });
  place('throw_pillows_01', 4.3, 0.33, Z1 - 0.5, Math.PI, 0.9, null, { contact: 'seat' });
  place('side_table_01', 1.65, 0, Z1 - 0.4, 0, 1); C.colliders.push({ x0: 1.4, x1: 1.9, z0: Z1 - 0.65, z1: Z1 - 0.15 });
  
  rugSlab(C.scene, 3.0, 1.8, pbr('dirty_carpet', { color: 0x6b4e40 }), 3.4, Z1 - 1.1);
  pizzaBox(C.scene, 1.65, 0.55, Z1 - 0.42, 0.3, false); // takeaway on the side table
  can(C.scene, 1.5, 0.596, Z1 - 0.25, 0xd61d4a);
  // arc floor lamp over the sofa
  const fl = group(null, 5.45, 0, Z1 - 0.35);
  cyl(0.15, 0.16, 0.03, std(0x222222, 0.3, 0.6), 0, 0.015, 0, fl, 32);
  const arc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-0.4, 2.0, -0.2), new THREE.Vector3(-1.1, 1.85, -0.35)]);
  const am = new THREE.Mesh(new THREE.TubeGeometry(arc, 40, 0.012, 8), M.brass); am.castShadow = true; fl.add(am);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x111111, 0.3, 0.8, { side: THREE.DoubleSide })); sh.position.set(-1.1, 1.82, -0.35); fl.add(sh);
  const fb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), emissive(0xffc890, 2)); fb.position.set(-1.1, 1.76, -0.35); fl.add(fb);
  const fll = new THREE.SpotLight(0xffb070, 9, 6, 1.1, 0.8, 2); fll.position.set(4.35, 1.75, Z1 - 0.7); fll.target.position.set(4.1, 0, Z1 - 1.0);
  fll.castShadow = true; fll.shadow.mapSize.set(1024, 1024); fll.shadow.bias = -0.0004; fll.shadow.radius = 5; addLight(fll);
  C.colliders.push({ x0: 5.25, x1: 5.65, z0: Z1 - 0.55, z1: Z1 - 0.15 });
  poster('ship', 2.7, 1.65, Z1 - 0.02, Math.PI, 0.62); poster('nib', 4.0, 1.65, Z1 - 0.02, Math.PI, 0.62);
  // ---- coffee corner on the south wall, east side ----
  place('CoffeeCart_01', 10.45, 0, Z1 - 0.4, Math.PI, 1, null, { pick: /_cart$|_mugs$/ });
  C.colliders.push({ x0: 9.72, x1: 11.18, z0: Z1 - 0.85, z1: Z1 });
  lampPoint(10.6, 1.25, Z1 - 0.45, 0xffc98a, 1.0, 2.2);
  place('metal_trash_can', 11.8, 0, Z1 - 0.32, 0, 0.9, null, { pick: /^metal_trash_can(_lid|_handle|$)/ }); C.colliders.push({ x0: 11.5, x1: 12.1, z0: Z1 - 0.6, z1: Z1 });
  const wc = group(null, 9.45, 0, Z1 - 0.3);
  rbox(0.32, 1.0, 0.32, 0.02, M.plasticWhite, 0, 0.5, 0, wc);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.38, 20), new THREE.MeshPhysicalMaterial({ color: 0x7fb8e8, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 })); jug.position.y = 1.2; wc.add(jug);
  for (const s of [-1, 1]) { const tap = box(0.03, 0.05, 0.04, s < 0 ? std(0x2a5fd0, 0.4) : std(0xc0392b, 0.4), s * 0.06, 0.75, 0.17, 1, wc, false); }
  C.colliders.push({ x0: 9.25, x1: 9.65, z0: Z1 - 0.5, z1: Z1 });
  poster('bug', 8.4, 1.7, Z1 - 0.02, Math.PI, 0.55);
  // wall clock above the coffee
  place('wall_clock', 10.6, 2.45, Z1 - 0.04, Math.PI, 1);
  // ---- east wall: bookshelf, art, cork board ----
  place('wooden_bookshelf_worn', X1 - 0.3, 0, 5.6, -Math.PI / 2, 1);
  C.colliders.push({ x0: X1 - 0.6, x1: X1, z0: 4.85, z1: 6.35 });
  for (let s = 0; s < 4; s++) { binders(C.scene, X1 - 0.3, 0.12 + s * 0.47, 5.05, 3 + (s % 2), -Math.PI / 2); books(C.scene, X1 - 0.3, 0.12 + s * 0.47, 5.6, 6 + s, -Math.PI / 2, true); }
  poster('map', X1 - 0.02, 1.7, 7.2, -Math.PI / 2, 0.6);
  poster('crit', X1 - 0.02, 1.7, 3.95 + 0.0, -Math.PI / 2, 0.42);
  place('dartboard', 0.77, 1.75, 5.0, Math.PI / 2, 1);
  place('korean_fire_extinguisher_01', 8.1, 0, Z1 - 0.15, Math.PI, 1);
  place('cardboard_box_01', 12.6, 0, 1.0, 0.2, 1); place('cardboard_box_01', 12.9, 0.0, 1.45, -0.3, 0.8); place('cardboard_box_01', 12.65, 0.335, 1.05, 0.5, 0.75);
  C.colliders.push({ x0: 12.2, x1: 13.3, z0: 0.75, z1: 1.8 });
  // radiators under the west windows
  for (const z of [3.0, 7.5]) { const rg = group(null, X0 + 0.08, 0.35, z); for (let i = 0; i < 14; i++) box(0.06, 0.5, 0.05, std(0xd8d8d2, 0.4, 0.3), 0, 0, -0.45 + i * 0.07, 1, rg, false); }
  // window sill clutter
  place('potted_plant_04', X0 + 0.1, 0.62, 6.0, 0.4, 1.1); books(C.scene, X0 + 0.1, 0.62, 8.6, 5, Math.PI / 2);
  coffeeCup(C.scene, X0 + 0.1, 0.62, 7.0);
  place('potted_plant_04', 11.2, 0.77, Z0 + 0.1, 0.4, 1.0);
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
  place('plastic_crate_02', 5.15, 0, 7.75, 0.3, 0.8); C.colliders.push({ x0: 4.95, x1: 5.4, z0: 7.5, z1: 8.0 });
  // Nib's charging dock: a small pedestal with a glowing ring (Nib floats home here at night)
  const dock = group(null, 10.9, 0, 5.6);
  cyl(0.24, 0.3, 0.06, std(0x1a1c1e, 0.35, 0.7), 0, 0.03, 0, dock, 32); cyl(0.06, 0.09, 0.7, std(0xe8e6e0, 0.25, 0.1), 0, 0.41, 0, dock, 24);
  cyl(0.2, 0.16, 0.05, std(0xe8e6e0, 0.25, 0.1), 0, 0.79, 0, dock, 32);
  const dr = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.2, 1.5) })); dr.rotation.x = Math.PI / 2; dr.position.y = 0.82; dock.add(dr);
  const dr2 = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.006, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.1) })); dr2.rotation.x = Math.PI / 2; dr2.position.y = 0.065; dock.add(dr2);
  lampPoint(10.9, 0.95, 5.6, 0x6ee7ff, 0.5, 1.6);
  C.colliders.push({ x0: 10.6, x1: 11.2, z0: 5.3, z1: 5.9 });
}

// contact shadows under the big pieces (desks, cabinets, sofa, racks, boxes)
function grounding() {
  const S = (x, z, w, d, k) => contactShadow(null, x, z, w, d, k);
  let r = tr(8, 5, 3, 1); S(r.cx, r.cz - 0.02, 2.3, 1.1, 0.6);
  r = tr(2, 3, 3, 1); S(r.cx, r.cz, 2.4, 1.05, 0.6);
  r = tr(12, 10, 3, 1); S(r.cx, r.cz, 2.3, 1.0, 0.6);
  r = tr(4, 10, 2, 1); S(r.cx, r.cz, 1.8, 1.0, 0.65);
  r = tr(7, 1, 6, 2); S(r.cx, Z0 + 0.32, 3.6, 0.8, 0.6);
  S(13.15, 9.46, 2.5, 0.9, 0.75); S(13.1, 8.25, 2.5, 1.5, 0.45);
  S(13.18, 2.6, 0.95, 0.95, 0.6); S(13.18, 3.45, 0.85, 0.75, 0.6);
  S(3.4, Z1 - 0.48, 3.0, 1.2, 0.6); S(10.6, Z1 - 0.4, 2.3, 1.1, 0.55); S(X1 - 0.3, 5.6, 0.8, 1.6, 0.55);
  S(12.75, 1.25, 1.3, 1.1, 0.6); S(X0 + 0.45, 3.5, 0.8, 1.0, 0.55); S(3.4, Z1 - 1.35, 1.3, 0.75, 0.45);
}
export function buildRoom(G) {
  buildShell(); buildLightRig();
  buildHunt(); buildContract(); buildStats(); buildTraining(); buildForge(); buildHQ(G); buildRig(); buildTerminals(); buildDecor(); grounding();
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
