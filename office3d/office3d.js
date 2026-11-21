// First Office 3D: the office as a third-person 3D room (three.js), drawn over the 2D game.
// The 2D world (original/world.js) keeps all the game logic: stations, the "near a desk" check, E to open a window,
// saved position. This file only draws the room, moves the founder (world.setPose) and orbits the camera.
// 1 office px = K metres; a 16 px tile is 0.75 m, so the 20x15-tile office is 15 m x 11.25 m.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const Q = new URLSearchParams(location.search);
let SKY_YAW = +(Q.get('sky') || 0.75);
const A = 'office3d/assets/';
const K = 0.75 / 16, T = 0.75, X0 = 0.75, X1 = 14.25, Z0 = 0.75, Z1 = 10.5, H = 3.3;
const tr = (tx, ty, tw, th) => ({ x0: tx * T, z0: ty * T, x1: (tx + tw) * T, z1: (ty + th) * T, cx: (tx + tw / 2) * T, cz: (ty + th / 2) * T, w: tw * T, d: th * T });

function want3d() {
  if (Q.has('2d')) return false;
  if (navigator.webdriver && !Q.has('3d')) return false; // automated tests keep the 2D office unless they ask
  if (matchMedia('(pointer: coarse)').matches && !Q.has('3d')) return false; // touch screens keep the 2D office and its pad
  try { const c = document.createElement('canvas'); if (!c.getContext('webgl2')) return false; } catch { return false; }
  return true;
}

// ---------- quality ----------
let quality = Q.get('q') || (() => { try { return localStorage.getItem('fo.q3d'); } catch { return null; } })() || 'high';

// ---------- small helpers ----------
const texLoader = new THREE.TextureLoader();
const texCache = {};
function tex(path, srgb) {
  const key = path + srgb;
  if (texCache[key]) return texCache[key];
  const t = texLoader.load(A + path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}
function pbr(name, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex(`tex/${name}/diff.jpg`, true), normalMap: tex(`tex/${name}/nor.jpg`), roughnessMap: tex(`tex/${name}/rough.jpg`),
    roughness: o.roughness ?? 1, metalness: o.metalness ?? 0, color: o.color ?? 0xffffff, envMapIntensity: o.env ?? 1,
  });
  m.normalScale.set(o.ns ?? 1, -(o.ns ?? 1));
  return m;
}
// UVs in metres / s, so one texture covers s metres on every face of a box.
function boxUV(g, w, h, d, s) {
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s); }
  return g;
}
function box(w, h, d, mat, x, y, z, s = 1, parent) {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, s), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  (parent || scene).add(m); return m;
}
function rbox(w, h, d, r, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  (parent || scene).add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  (parent || scene).add(m); return m;
}
const std = (color, roughness = 0.5, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.userData.redraw = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ---------- scene ----------
let renderer, scene, camera, composer, gtao, bloom, smaa, grade, tPrev = 0, tNow = 0, t0 = 0;
const colliders = []; // extra solid boxes (metres) on top of the 2D grid: {x0,z0,x1,z1}
const occluders = []; // meshes the camera must not pass through
const stationGroups = {};
let world, G;

// Materials shared by the room.
let M;
function makeMaterials() {
  M = {
    floor: pbr('herringbone_parquet', { color: 0xc9b8a6, env: 0.6 }),
    brick: pbr('red_brick_03', { color: 0xd8c2b6, ns: 1.4 }),
    plaster: pbr('painted_plaster_wall', { color: 0x9aa3a0 }),
    plasterDark: pbr('painted_plaster_wall', { color: 0x2e3a3c }),
    ceiling: pbr('rough_plaster_03', { color: 0xb9b5ae }),
    concrete: pbr('concrete_floor_02', { color: 0x8c8a86 }),
    oak: pbr('oak_veneer_01', { color: 0xe8d6c0, roughness: 0.9, env: 0.8 }),
    walnut: pbr('walnut_veneer', { color: 0xd9c3b0, roughness: 0.85 }),
    rug: pbr('dirty_carpet', { color: 0x9a8f88 }),
    leather: pbr('fabric_leather_02', { color: 0x2a2624, roughness: 0.9 }),
    steel: std(0x1b1c1e, 0.45, 0.85),
    steelLight: std(0x8d9196, 0.32, 0.95),
    alu: std(0xb9bcc0, 0.28, 1),
    plastic: std(0x121314, 0.42, 0),
    plasticGrey: std(0x3a3c40, 0.5, 0),
    rubber: std(0x0b0b0c, 0.75, 0),
    paper: std(0xece8df, 0.85, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xaab8c0, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.5, depthWrite: false }),
    brass: std(0xb08d57, 0.3, 1),
    ceramicW: std(0xf1eee8, 0.25, 0),
  };
}

// ---------- room shell ----------
function wallPanel(axis, at, a0, a1, y0, y1, mat, s, inward) {
  // axis 'z': wall along x at z=at; 'x': wall along z at x=at. Thickness 0.3 behind the face.
  const w = a1 - a0, h = y1 - y0, t = 0.3;
  const m = axis === 'z'
    ? box(w, h, t, mat, (a0 + a1) / 2, (y0 + y1) / 2, at - inward * t / 2, s)
    : box(t, h, w, mat, at - inward * t / 2, (y0 + y1) / 2, (a0 + a1) / 2, s);
  occluders.push(m); return m;
}
// A wall with window openings [{a0,a1}], sill and head heights.
function wallWithWindows(axis, at, a0, a1, wins, sill, head, mat, s, inward) {
  let cur = a0;
  for (const w of wins) {
    if (w.a0 > cur) wallPanel(axis, at, cur, w.a0, 0, H, mat, s, inward);
    wallPanel(axis, at, w.a0, w.a1, 0, sill, mat, s, inward);
    wallPanel(axis, at, w.a0, w.a1, head, H, mat, s, inward);
    windowFrame(axis, at, w.a0, w.a1, sill, head, inward);
    cur = w.a1;
  }
  if (cur < a1) wallPanel(axis, at, cur, a1, 0, H, mat, s, inward);
}
const winLights = [];
function windowFrame(axis, at, a0, a1, y0, y1, inward) {
  const g = new THREE.Group(), w = a1 - a0, h = y1 - y0, f = 0.05, frameM = M.steel;
  const put = (mw, mh, x, y) => { const m = box(mw, mh, 0.07, frameM, x, y, 0, 1, g); m.castShadow = true; };
  put(w, f, 0, -h / 2 + f / 2); put(w, f, 0, h / 2 - f / 2); put(f, h, -w / 2 + f / 2, 0); put(f, h, w / 2 - f / 2, 0);
  const cols = Math.max(2, Math.round(w / 0.75)), rows = 3;
  for (let i = 1; i < cols; i++) put(0.03, h, -w / 2 + (w * i) / cols, 0);
  for (let j = 1; j < rows; j++) put(w, 0.03, 0, -h / 2 + (h * j) / rows + (j === 1 ? 0 : 0));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass); glass.position.z = -0.01; g.add(glass);
  // sill
  box(w + 0.1, 0.04, 0.26, M.concrete, 0, -h / 2 - 0.02, 0.1, 0.8, g);
  if (axis === 'z') { g.position.set((a0 + a1) / 2, (y0 + y1) / 2, at); if (inward < 0) g.rotation.y = Math.PI; }
  else { g.position.set(at, (y0 + y1) / 2, (a0 + a1) / 2); g.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2; }
  scene.add(g);
  // cool city glow coming in through the glass (no shadows)
  const l = new THREE.RectAreaLight(0x6d86c9, 2.2, w, h);
  l.position.copy(g.position); l.rotation.copy(g.rotation); l.rotateY(Math.PI); // RectAreaLight shines down -z of its own frame
  l.translateZ(-0.05); scene.add(l); winLights.push(l);
}

function buildShell() {
  // floor + skirting
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2); floor.receiveShadow = true;
  const uv = floor.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 2.2, uv.getY(i) * (Z1 - Z0) / 2.2);
  scene.add(floor); occluders.push(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), M.ceiling);
  ceil.rotation.x = Math.PI / 2; ceil.position.set((X0 + X1) / 2, H, (Z0 + Z1) / 2); ceil.receiveShadow = true;
  const cu = ceil.geometry.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * (X1 - X0) / 3, cu.getY(i) * (Z1 - Z0) / 3);
  scene.add(ceil); occluders.push(ceil);
  // North: exposed brick with two big loft windows either side of HQ.
  wallWithWindows('z', Z0, X0, X1, [{ a0: 1.25, a1: 4.6 }, { a0: 10.4, a1: 13.75 }], 0.75, 2.85, M.brick, 1.3, 1);
  // West: a run of tall windows between brick piers.
  wallWithWindows('x', X0, Z0, Z1, [{ a0: 1.4, a1: 4.6 }, { a0: 5.4, a1: 9.6 }], 0.6, 2.85, M.brick, 1.3, 1);
  // East and South: painted plaster.
  wallPanel('x', X1, Z0, Z1, 0, H, M.plasterDark, 2.5, -1);
  wallPanel('z', Z1, X0, X1, 0, H, M.plaster, 2.5, -1);
  // skirting boards on plaster walls
  const sk = std(0x1d2122, 0.6);
  box(0.02, 0.1, Z1 - Z0, sk, X1 - 0.01, 0.05, (Z0 + Z1) / 2); box(X1 - X0, 0.1, 0.02, sk, (X0 + X1) / 2, 0.05, Z1 - 0.01);
  // exposed steel beams and a round duct on the ceiling (loft)
  for (const x of [3.5, 7.5, 11.5]) { const b = box(0.18, 0.32, Z1 - Z0, M.steel, x, H - 0.16, (Z0 + Z1) / 2); b.material = M.steel; }
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, X1 - X0, 24, 1, true), std(0x9da2a6, 0.38, 0.9, { side: THREE.DoubleSide }));
  duct.rotation.z = Math.PI / 2; duct.position.set((X0 + X1) / 2, H - 0.55, 9.6); duct.castShadow = true; scene.add(duct);
  for (let x = 1.5; x < X1; x += 1.6) cyl(0.215, 0.215, 0.04, M.steelLight, x, H - 0.55, 9.6, null, 24).rotation.z = Math.PI / 2;
  for (let x = 2; x < X1; x += 3) box(0.02, 0.32, 0.02, M.steel, x, H - 0.2, 9.6);
  // a door on the south wall
  const door = new THREE.Group(); door.position.set(7.1, 0, Z1 - 0.02); scene.add(door);
  box(1.06, 2.2, 0.06, std(0x15191b, 0.5, 0.6), 0, 1.1, 0, 1, door);
  box(0.94, 2.12, 0.04, M.walnut, 0, 1.06, -0.03, 1, door);
  cyl(0.012, 0.012, 0.16, M.alu, 0.38, 1.05, -0.08, door).rotation.x = Math.PI / 2;
  box(0.02, 0.4, 0.02, M.alu, 0.38, 1.05, -0.12, 1, door);
  // exit sign above the door
  const exit = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#0b3d1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#5dff9a'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.fillText('EXIT', w / 2, 68); });
  const ex = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.05), [M.plastic, M.plastic, M.plastic, M.plastic, M.plastic, new THREE.MeshStandardMaterial({ map: exit, emissiveMap: exit, emissive: 0xffffff, emissiveIntensity: 2.5 })]);
  ex.position.set(7.1, 2.45, Z1 - 0.03); scene.add(ex);
}

// Skyline outside the windows: a night city panorama (Poly Haven "shanghai_bund", CC0) on a big cylinder.
function buildSkyline() {
  const t = tex('sky/skyline.jpg', true); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  const R = 45, top = R * Math.tan(THREE.MathUtils.degToRad(50.4)), bot = R * Math.tan(THREE.MathUtils.degToRad(28.6));
  const g = new THREE.CylinderGeometry(R, R, top + bot, 96, 1, true);
  t.repeat.x = -1; const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, color: 0xb8c0d8 }));
  m.position.set((X0 + X1) / 2, (top - bot) / 2 - 7, (Z0 + Z1) / 2); m.rotation.y = SKY_YAW;
  scene.add(m);
  // dark street/facade below the window line so nothing reads as floating
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std(0x05070a, 1)); ground.rotation.x = -Math.PI / 2; ground.position.y = -6; scene.add(ground);
}

// ---------- screens ----------
function codeScreen(seed, hot) {
  return canvasTex(1024, 640, (g, w, h) => {
    let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#0c1016'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#161b24'; g.fillRect(0, 0, w, 34); g.fillRect(0, 0, 170, h);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(18 + i * 20, 17, 6, 0, 7); g.fill(); });
    g.font = '15px Menlo, monospace'; g.fillStyle = '#7d8590';
    ['src', '  api', '  auth', '    session.ts', '    token.ts', '  payments', '    refund.ts', 'tests', 'package.json'].forEach((t, i) => g.fillText(t, 12, 64 + i * 22));
    const cols = ['#ff7b72', '#79c0ff', '#d2a8ff', '#a5d6ff', '#7ee787', '#e6edf3', '#ffa657'];
    for (let i = 0; i < 26; i++) {
      const y = 58 + i * 22;
      if (hot && i === 13) { g.fillStyle = 'rgba(248,81,73,.28)'; g.fillRect(170, y - 15, w, 21); }
      g.fillStyle = '#484f58'; g.fillText(String(40 + i).padStart(3), 180, y);
      let x = 230 + Math.floor(r() * 4) * 26;
      const n = 2 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) { const ww = 30 + r() * 90; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, y - 11, ww, 11); x += ww + 10; if (x > w - 40) break; }
    }
    g.fillStyle = '#1f6feb'; g.fillRect(0, h - 22, w, 22); g.fillStyle = '#fff'; g.font = '13px Menlo, monospace'; g.fillText('main  ⎇  0 errors  1 finding', 12, h - 6);
  });
}
function dashScreen(seed, accent = '#58a6ff') {
  return canvasTex(1024, 640, (g, w, h) => {
    let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6edf3'; g.font = 'bold 26px Arial'; g.fillText('Programs · live findings', 28, 46);
    for (let i = 0; i < 4; i++) {
      const x = 28 + i * 246; g.fillStyle = '#161b22'; g.fillRect(x, 70, 230, 110);
      g.fillStyle = '#7d8590'; g.font = '16px Arial'; g.fillText(['Open bugs', 'Paid', 'Rep', 'Queue'][i], x + 14, 98);
      g.fillStyle = i === 1 ? '#3fb950' : '#e6edf3'; g.font = 'bold 40px Arial'; g.fillText(['12', '$4.2k', '38', '5'][i], x + 14, 152);
    }
    g.fillStyle = '#161b22'; g.fillRect(28, 200, 600, 410);
    g.strokeStyle = accent; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 560; x += 14) { const y = 560 - (x / 560) * 220 - r() * 80; x ? g.lineTo(48 + x, y) : g.moveTo(48 + x, y); } g.stroke();
    g.strokeStyle = '#21262d'; g.lineWidth = 1; for (let y = 260; y < 600; y += 50) { g.beginPath(); g.moveTo(48, y); g.lineTo(610, y); g.stroke(); }
    g.fillStyle = '#161b22'; g.fillRect(648, 200, 348, 410);
    for (let i = 0; i < 9; i++) { g.fillStyle = ['#f85149', '#d29922', '#3fb950'][i % 3]; g.beginPath(); g.arc(672, 236 + i * 42, 6, 0, 7); g.fill(); g.fillStyle = '#c9d1d9'; g.font = '16px Arial'; g.fillText(['IDOR in /orders', 'Race in refund', 'XSS in profile', 'SSRF webhook', 'Open redirect', 'JWT none alg', 'CSRF settings', 'Path traversal', 'Rate limit'][i], 688, 242 + i * 42); }
  });
}
function termScreen(seed) {
  return canvasTex(1024, 640, (g, w, h) => {
    let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#05080a'; g.fillRect(0, 0, w, h); g.font = '17px Menlo, monospace';
    for (let i = 0; i < 28; i++) { g.fillStyle = r() < 0.15 ? '#ffb454' : r() < 0.3 ? '#7ee787' : '#3fb950'; let t = '$ '; const n = 10 + Math.floor(r() * 50); for (let k = 0; k < n; k++) t += 'abcdefghijklmnopqrstuvwxyz/._-  '[Math.floor(r() * 32)]; g.fillText(t, 16, 26 + i * 22); }
  });
}
function screenMat(t, k = 1.4) { return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: k, roughness: 0.18, metalness: 0 }); }

// ---------- furniture builders ----------
function monitor(parent, x, y, z, rotY, w, h, screenTex, opts = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  rbox(w + 0.02, h + 0.02, 0.025, 0.006, M.plastic, 0, h / 2 + 0.11, -0.005, g);
  rbox(w * 0.5, h * 0.5, 0.04, 0.01, M.plasticGrey, 0, h / 2 + 0.11, -0.035, g);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, h - 0.012), screenMat(screenTex, opts.k)); s.position.set(0, h / 2 + 0.11, 0.0076); g.add(s);
  if (!opts.arm) {
    box(0.05, 0.16, 0.03, M.alu, 0, 0.08, -0.05, 1, g);
    rbox(0.22, 0.012, 0.17, 0.005, M.alu, 0, 0.006, -0.02, g);
  }
  return g;
}
function keyboard(parent, x, y, z, rotY) {
  const kt = canvasTex(512, 160, (g, w, h) => { g.fillStyle = '#1a1b1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b2d31'; for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) g.fillRect(8 + c * 33, 8 + r * 30, 29, 26); g.fillRect(140, 128, 200, 26); });
  const k = rbox(0.42, 0.018, 0.13, 0.005, new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 }), x, y + 0.009, z, parent); k.rotation.y = rotY;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), M.plastic); m.scale.set(0.9, 0.45, 1.5); m.position.set(x + Math.cos(rotY) * 0.3, y + 0.012, z - Math.sin(rotY) * 0.3); m.castShadow = true; parent.add(m);
  const pad = box(0.3, 0.003, 0.24, std(0x16181a, 0.9), x + Math.cos(rotY) * 0.3, y + 0.0015, z - Math.sin(rotY) * 0.3, 1, parent); pad.rotation.y = rotY;
}
function mug(parent, x, y, z, color = 0xf1eee8) {
  const mt = std(color, 0.3);
  const c = cyl(0.04, 0.036, 0.095, mt, x, y + 0.048, z, parent, 20);
  const hd = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 16), mt); hd.position.set(x + 0.045, y + 0.05, z); hd.castShadow = true; parent.add(hd);
  const cof = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), std(0x2a160c, 0.15)); cof.rotation.x = -Math.PI / 2; cof.position.set(x, y + 0.085, z); parent.add(cof);
  return c;
}
function papers(parent, x, y, z, n = 4) {
  for (let i = 0; i < n; i++) { const p = box(0.21, 0.002, 0.297, M.paper, x + (rnd() - 0.5) * 0.04, y + 0.001 + i * 0.0025, z + (rnd() - 0.5) * 0.04, 1, parent); p.rotation.y = (rnd() - 0.5) * 0.4; }
}
function books(parent, x, y, z, n, rotY = 0, lean = false) {
  const cols = [0x6b2a22, 0x1f3550, 0x2f4a33, 0xb88a3a, 0x2a2a2e, 0x7a6a55, 0x8c1f1f, 0x3d3550];
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  let px = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.025 + rnd() * 0.035, h = 0.18 + rnd() * 0.09, d = 0.13 + rnd() * 0.06;
    const b = box(w, h, d, std(cols[Math.floor(rnd() * cols.length)], 0.7), px + w / 2, h / 2, 0, 1, g);
    if (lean && i === n - 1) { b.rotation.z = -0.35; b.position.x += 0.04; b.position.y -= 0.01; }
    px += w + 0.002;
  }
  return g;
}
function cable(parent, pts, r = 0.005) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, 40, r, 6), M.rubber); m.castShadow = true; parent.add(m); return m;
}
function officeChair(parent, x, z, rotY) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY + (rnd() - 0.5) * 0.5; parent.add(g);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, leg = box(0.3, 0.035, 0.05, M.alu, Math.cos(a) * 0.15, 0.075, Math.sin(a) * 0.15, 1, g); leg.rotation.y = -a;
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), M.plastic); w.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3); w.castShadow = true; g.add(w);
  }
  cyl(0.025, 0.025, 0.3, M.steelLight, 0, 0.25, 0, g);
  rbox(0.52, 0.08, 0.5, 0.03, M.leather, 0, 0.46, 0, g);
  const back = rbox(0.5, 0.62, 0.07, 0.03, M.leather, 0, 0.86, 0.25, g); back.rotation.x = -0.12;
  box(0.06, 0.4, 0.03, M.steel, 0, 0.62, 0.28, 1, g).rotation.x = -0.12;
  for (const s of [-1, 1]) { box(0.035, 0.2, 0.035, M.steel, s * 0.27, 0.58, 0.02, 1, g); rbox(0.06, 0.03, 0.26, 0.012, M.plastic, s * 0.27, 0.69, 0.02, g); }
  return g;
}
function desk(parent, cx, cz, w, d, rotY, top = M.oak, h = 0.74) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY; parent.add(g);
  rbox(w, 0.035, d, 0.008, top, 0, h - 0.0175, 0, g);
  for (const s of [-1, 1]) {
    box(0.06, h - 0.035, 0.04, M.steel, s * (w / 2 - 0.08), (h - 0.035) / 2, -d / 2 + 0.07, 1, g);
    box(0.06, h - 0.035, 0.04, M.steel, s * (w / 2 - 0.08), (h - 0.035) / 2, d / 2 - 0.07, 1, g);
    box(0.06, 0.04, d - 0.1, M.steel, s * (w / 2 - 0.08), h - 0.055, 0, 1, g);
    box(0.06, 0.04, d - 0.1, M.steel, s * (w / 2 - 0.08), 0.02, 0, 1, g);
  }
  box(w - 0.2, 0.06, 0.03, M.steel, 0, h - 0.07, -d / 2 + 0.08, 1, g);
  // cable tray under the back edge
  box(w * 0.6, 0.06, 0.12, std(0x222426, 0.6, 0.6), 0, h - 0.13, -d / 2 + 0.12, 1, g);
  return g;
}
function pcTower(parent, x, z, rotY, rgb = 0x6a5cff) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; parent.add(g);
  rbox(0.21, 0.46, 0.45, 0.01, M.plastic, 0, 0.24, 0, g);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.38), new THREE.MeshStandardMaterial({ color: 0x050507, emissive: rgb, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2 }));
  glass.rotation.y = Math.PI / 2; glass.position.set(0.106, 0.25, 0); g.add(glass);
  for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24), new THREE.MeshBasicMaterial({ color: rgb })); f.position.set(0.0, 0.12 + i * 0.12, 0.226); g.add(f); f.material.color.multiplyScalar(3); }
  return g;
}
function lampLight(parent, x, y, z, color = 0xffb46b, intensity = 3, dist = 3.5) {
  const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); parent.add(l); return l;
}

// ---------- models (Poly Haven, CC0) ----------
const gltf = new GLTFLoader();
const modelCache = {};
function loadModel(id) {
  if (!modelCache[id]) modelCache[id] = gltf.loadAsync(`${A}models/${id}/${id}.gltf`).then(r => { r.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 1; } }); return r.scene; });
  return modelCache[id];
}
const pending = [];
function place(id, x, y, z, rotY = 0, s = 1, parent) {
  const p = loadModel(id).then(src => { const o = src.clone(); o.position.set(x, y, z); o.rotation.y = rotY; o.scale.setScalar(s); (parent || scene).add(o); return o; }).catch(e => console.warn('office3d model', id, e));
  pending.push(p); return p;
}

// ---------- stations ----------
function group(id) { const g = new THREE.Group(); g.name = id; scene.add(g); stationGroups[id] = g; return g; }
const lights = { pendants: [], lamps: [] };

function pendant(x, z, drop, shadow, color = 0xffc58a, intensity = 30) {
  const g = new THREE.Group(); g.position.set(x, H, z); scene.add(g);
  cyl(0.004, 0.004, drop, M.rubber, 0, -drop / 2, 0, g, 6);
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.03 + Math.sin(t * Math.PI / 2) * 0.2, -t * 0.2)); }
  const shade = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), std(0x1a1c1d, 0.4, 0.8, { side: THREE.DoubleSide })); shade.position.y = -drop; shade.castShadow = true; g.add(shade);
  const inner = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p.x - 0.003, p.y)), 32), std(0xf4efe6, 0.6, 0, { side: THREE.BackSide })); inner.position.y = -drop; g.add(inner);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0, emissive: color, emissiveIntensity: 12 })); bulb.position.y = -drop - 0.11; g.add(bulb);
  const l = new THREE.SpotLight(color, intensity, 9, 1.0, 0.75, 2); l.position.set(x, H - drop - 0.12, z); l.target.position.set(x, 0, z);
  if (shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02; l.shadow.radius = 4; l.shadow.camera.near = 0.2; }
  scene.add(l, l.target); lights.pendants.push(l);
  // a little fill so the shade's top isn't pitch black
  const up = new THREE.PointLight(color, 0.6, 2.5, 2); up.position.set(x, H - drop - 0.05, z); scene.add(up);
  return l;
}

function buildHunt() { // Founder Workstation: triple monitors, the main desk.
  const r = tr(8, 5, 3, 1), g = group('hunt');
  const dz = r.cz - 0.02;
  desk(g, r.cx, dz, 2.0, 0.8, 0, M.walnut);
  const y = 0.74;
  monitor(g, r.cx, y, dz - 0.2, 0, 0.62, 0.36, codeScreen(11, true), { k: 1.6 });
  monitor(g, r.cx - 0.66, y, dz - 0.14, 0.38, 0.55, 0.32, dashScreen(5));
  monitor(g, r.cx + 0.66, y, dz - 0.14, -0.38, 0.55, 0.32, termScreen(9));
  keyboard(g, r.cx - 0.05, y, dz + 0.17, 0);
  mug(g, r.cx + 0.55, y, dz + 0.2, 0x253a52);
  papers(g, r.cx - 0.72, y, dz + 0.16, 5);
  place('desk_lamp_arm_01', r.cx + 0.85, y, dz - 0.25, -2.2, 1, g);
  lights.lamps.push(lampLight(g, r.cx + 0.62, y + 0.42, dz - 0.05, 0xffb46b, 0.7, 2.5));
  place('potted_plant_02', r.cx - 0.9, y, dz - 0.27, 0.4, 0.55, g);
  pcTower(g, r.cx + 0.75, dz + 0.0, 0);
  officeChair(g, r.cx, dz + 0.72, 0.05);
  cable(g, [[r.cx, y + 0.12, dz - 0.26], [r.cx + 0.1, y - 0.1, dz - 0.36], [r.cx + 0.3, 0.3, dz - 0.38], [r.cx + 0.6, 0.02, dz - 0.3]]);
  cable(g, [[r.cx - 0.66, y + 0.1, dz - 0.22], [r.cx - 0.5, y - 0.15, dz - 0.36], [r.cx - 0.2, 0.25, dz - 0.38], [r.cx + 0.1, 0.02, dz - 0.25]]);
  place('office_notepads', r.cx - 0.4, y, dz + 0.22, 0.3, 1, g);
  // the rug under the founder desk
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), M.rug); rug.rotation.x = -Math.PI / 2; rug.position.set(r.cx, 0.004, dz + 0.35); rug.receiveShadow = true; g.add(rug);
  pendant(r.cx, dz + 0.1, 1.2, true);
  // the screens glow onto the founder's face
  const glow = new THREE.RectAreaLight(0x7fb0ff, 3, 1.6, 0.35); glow.position.set(r.cx, y + 0.3, dz - 0.15); glow.lookAt(r.cx, y + 0.3, dz + 2); g.add(glow);
}
function buildContract() { // Ops Center: findings come in here.
  const r = tr(2, 3, 3, 1), g = group('contract'), y = 0.74;
  desk(g, r.cx, r.cz, 2.1, 0.75, 0);
  monitor(g, r.cx - 0.36, y, r.cz - 0.16, 0.12, 0.6, 0.34, dashScreen(21, '#f0883e'));
  monitor(g, r.cx + 0.36, y, r.cz - 0.16, -0.12, 0.6, 0.34, codeScreen(31, false));
  keyboard(g, r.cx, y, r.cz + 0.16, 0);
  mug(g, r.cx - 0.75, y, r.cz + 0.12);
  place('stationery_supplies', r.cx + 0.78, y, r.cz + 0.05, -0.4, 1, g);
  place('clipboard', r.cx - 0.6, y, r.cz + 0.2, 0.6, 1, g);
  officeChair(g, r.cx + 0.1, r.cz + 0.68, -0.2);
  pcTower(g, r.cx - 0.8, r.cz, 0, 0x2bd4ff);
  // in/out trays with paper
  for (let i = 0; i < 2; i++) { box(0.26, 0.05, 0.34, std(0x232528, 0.4, 0.8), r.cx + 0.82, y + 0.025 + i * 0.07, r.cz - 0.2, 1, g); papers(g, r.cx + 0.82, y + 0.03 + i * 0.07, r.cz - 0.2, 3); }
  pendant(r.cx, r.cz + 0.1, 1.2, false);
}
function buildStats() { // Ledger Vault: a floor safe and the ledgers.
  const r = tr(17, 3, 1, 2), g = group('stats');
  const safe = new THREE.Group(); safe.position.set(r.cx + 0.05, 0, r.z0 + 0.42); safe.rotation.y = -Math.PI / 2; g.add(safe);
  const sm = std(0x2a3530, 0.38, 0.75);
  rbox(0.66, 1.05, 0.62, 0.03, sm, 0, 0.525, 0, safe);
  rbox(0.56, 0.92, 0.04, 0.015, std(0x34423b, 0.32, 0.8), 0, 0.53, 0.32, safe);
  const dial = cyl(0.07, 0.07, 0.03, M.brass, 0.1, 0.68, 0.35, safe, 32); dial.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) { const sp = cyl(0.008, 0.008, 0.16, M.alu, -0.1, 0.55, 0.36, safe, 8); sp.rotation.z = (i / 3) * Math.PI; }
  cyl(0.025, 0.025, 0.05, M.alu, -0.1, 0.55, 0.35, safe, 16).rotation.x = Math.PI / 2;
  for (const yy of [0.25, 0.85]) cyl(0.02, 0.02, 0.1, M.steelLight, 0.29, yy, 0.33, safe, 12);
  books(safe, -0.25, 1.05, -0.05, 6, 0, true);
  // banker's lamp on the safe
  const lb = cyl(0.06, 0.07, 0.02, M.brass, 0.18, 1.06, 0, safe); cyl(0.008, 0.008, 0.3, M.brass, 0.18, 1.21, 0, safe);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 20, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x0f5a2c, roughness: 0.15, emissive: 0x0f5a2c, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
  shade.rotation.z = Math.PI / 2; shade.position.set(0.18, 1.36, 0.02); safe.add(shade);
  lights.lamps.push(lampLight(g, r.cx - 0.1, 1.3, r.z0 + 0.42, 0xffc27a, 1.6, 2.4));
  // filing cabinet next to the safe
  const fc = new THREE.Group(); fc.position.set(r.cx + 0.05, 0, r.z1 - 0.32); fc.rotation.y = -Math.PI / 2; g.add(fc);
  rbox(0.46, 1.32, 0.6, 0.01, std(0x5d6466, 0.45, 0.7), 0, 0.66, 0, fc);
  for (let i = 0; i < 4; i++) { box(0.42, 0.3, 0.01, std(0x6b7376, 0.4, 0.7), 0, 0.18 + i * 0.32, 0.305, 1, fc); box(0.12, 0.015, 0.025, M.alu, 0, 0.27 + i * 0.32, 0.32, 1, fc); box(0.08, 0.04, 0.003, M.paper, 0, 0.22 + i * 0.32, 0.312, 1, fc); }
  place('ceramic_vase_01', r.cx + 0.05, 1.32, r.z1 - 0.3, 0, 0.8, g);
}
function buildTraining() { // Training Bench: Nib's pattern book, a whiteboard behind.
  const r = tr(12, 10, 3, 1), g = group('training'), y = 0.74;
  desk(g, r.cx, r.cz, 2.0, 0.72, 0, M.oak);
  // laptop
  const lp = new THREE.Group(); lp.position.set(r.cx - 0.2, y, r.cz + 0.02); g.add(lp);
  rbox(0.33, 0.012, 0.23, 0.004, M.alu, 0, 0.006, 0, lp);
  const lid = new THREE.Group(); lid.position.set(0, 0.012, -0.115); lid.rotation.x = -0.32; lp.add(lid);
  rbox(0.33, 0.22, 0.006, 0.004, M.alu, 0, 0.11, -0.003, lid);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), screenMat(codeScreen(77, false), 1.3)); sc.position.set(0, 0.11, 0.001); lid.add(sc);
  monitor(g, r.cx + 0.45, y, r.cz - 0.14, -0.15, 0.6, 0.34, dashScreen(41, '#a371f7'));
  place('book_encyclopedia_set_01', r.cx - 0.75, y, r.cz - 0.18, 0.1, 1, g);
  books(g, r.cx - 0.85, y, r.cz + 0.15, 1);
  papers(g, r.cx + 0.1, y, r.cz + 0.2, 3);
  mug(g, r.cx + 0.85, y, r.cz + 0.18, 0x8a2c2c);
  place('rubber_duck_toy', r.cx + 0.75, y, r.cz - 0.2, -0.6, 1, g);
  officeChair(g, r.cx - 0.2, r.cz + 0.66, 0.3);
  // rolling whiteboard behind the desk (north side)
  const wbT = canvasTex(1024, 640, (c, w, h) => {
    c.fillStyle = '#f4f5f2'; c.fillRect(0, 0, w, h); c.lineCap = 'round'; c.lineJoin = 'round';
    const pen = (col, lw) => { c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; };
    pen('#1f3b8f', 5); c.font = 'bold 44px "Marker Felt", "Comic Sans MS", cursive'; c.fillText('PATTERN BOOK', 40, 70);
    c.font = '30px "Marker Felt", "Comic Sans MS", cursive';
    ['IDOR → check owner id', 'race → lock + recheck', 'XSS → escape output', 'SSRF → allow-list hosts'].forEach((t, i) => { pen(i % 2 ? '#b3261e' : '#1b1b1b', 4); c.fillText('• ' + t, 50, 140 + i * 56); });
    pen('#1b7a3a', 5); c.strokeRect(620, 110, 150, 80); c.strokeRect(820, 260, 150, 80); c.strokeRect(620, 400, 150, 80);
    c.beginPath(); c.moveTo(770, 150); c.quadraticCurveTo(880, 160, 895, 260); c.moveTo(895, 340); c.quadraticCurveTo(880, 440, 770, 440); c.stroke();
    c.font = '26px "Marker Felt", cursive'; c.fillText('login', 650, 160); c.fillText('token', 850, 310); c.fillText('refund', 645, 450);
    pen('#b3261e', 6); c.beginPath(); c.arc(700, 440, 75, 0, 7); c.stroke();
    pen('rgba(0,0,0,.05)', 40); c.beginPath(); c.moveTo(100, 560); c.lineTo(500, 600); c.stroke(); // ghost of an erased line
  });
  const wb = new THREE.Group(); wb.position.set(r.cx + 0.1, 0, r.z0 - 0.12); g.add(wb);
  box(1.6, 1.0, 0.03, std(0xffffff, 0.15, 0, { map: wbT }), 0, 1.45, 0, 1, wb);
  box(1.64, 0.025, 0.04, M.alu, 0, 1.96, 0, 1, wb); box(1.64, 0.025, 0.04, M.alu, 0, 0.94, 0, 1, wb);
  box(1.4, 0.03, 0.07, M.alu, 0, 0.93, 0.03, 1, wb);
  for (const s of [-1, 1]) { box(0.035, 1.9, 0.035, M.alu, s * 0.82, 0.98, 0, 1, wb); box(0.035, 0.035, 0.5, M.alu, s * 0.82, 0.06, 0, 1, wb); }
  colliders.push({ x0: r.cx + 0.1 - 0.85, x1: r.cx + 0.1 + 0.85, z0: r.z0 - 0.4, z1: r.z0 - 0.02 });
  pendant(r.cx, r.cz + 0.1, 1.15, true);
}
function buildForge() { // Agent Forge: a workbench where tools get built.
  const r = tr(4, 10, 2, 1), g = group('forge'), y = 0.92;
  // butcher-block bench
  const top = rbox(1.5, 0.05, 0.72, 0.006, M.walnut, r.cx, y - 0.025, r.cz, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, y - 0.05, 0.05, M.steel, r.cx + sx * 0.68, (y - 0.05) / 2, r.cz + sz * 0.3, 1, g);
  box(1.4, 0.03, 0.62, M.walnut, r.cx, 0.22, r.cz, 1, g);
  // pegboard behind
  const peg = canvasTex(512, 256, (c, w, h) => { c.fillStyle = '#b08a5c'; c.fillRect(0, 0, w, h); c.fillStyle = '#3b2a18'; for (let x = 8; x < w; x += 16) for (let yy = 8; yy < h; yy += 16) { c.beginPath(); c.arc(x, yy, 2.4, 0, 7); c.fill(); } });
  box(1.5, 0.75, 0.02, std(0xffffff, 0.8, 0, { map: peg }), r.cx, y + 0.55, r.z0 - 0.02, 1, g);
  colliders.push({ x0: r.cx - 0.8, x1: r.cx + 0.8, z0: r.z0 - 0.1, z1: r.z0 });
  const tools = [[0.3, 0.02, 0.012], [0.2, 0.025, 0.02], [0.25, 0.015, 0.015], [0.18, 0.04, 0.01]];
  tools.forEach((t, i) => { const m = box(t[1], t[0], t[2], i % 2 ? M.steelLight : std(0xb3261e, 0.5), r.cx - 0.55 + i * 0.16, y + 0.6, r.z0, 1, g); m.rotation.z = (rnd() - 0.5) * 0.2; });
  for (let i = 0; i < 4; i++) cyl(0.012, 0.012, 0.22, std([0xe0b030, 0x2060c0, 0xc03030, 0x202020][i], 0.5), r.cx + 0.2 + i * 0.07, y + 0.62, r.z0 + 0.01, g, 8);
  // 3D printer with a glowing build
  const pr = new THREE.Group(); pr.position.set(r.cx - 0.4, y, r.cz - 0.06); g.add(pr);
  box(0.42, 0.04, 0.42, M.plastic, 0, 0.02, 0, 1, pr); box(0.42, 0.04, 0.42, M.plastic, 0, 0.5, 0, 1, pr);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.025, 0.48, 0.025, M.plastic, sx * 0.2, 0.26, sz * 0.2, 1, pr);
  const side = new THREE.MeshStandardMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false });
  const enc = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.4), side); enc.position.y = 0.26; pr.add(enc);
  const part = cyl(0.05, 0.07, 0.09, new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff7a2a, emissiveIntensity: 1.2 }), 0, 0.09, 0, pr, 6);
  const pl = new THREE.PointLight(0xff8a3d, 0.8, 1.6, 2); pl.position.set(0, 0.3, 0); pr.add(pl);
  // circuit board, soldering iron, parts
  box(0.22, 0.008, 0.14, std(0x1f6b3a, 0.5), r.cx + 0.15, y + 0.004, r.cz + 0.08, 1, g);
  for (let i = 0; i < 6; i++) box(0.03, 0.008, 0.02, M.plastic, r.cx + 0.08 + (i % 3) * 0.06, y + 0.012, r.cz + 0.05 + Math.floor(i / 3) * 0.06, 1, g);
  const iron = cyl(0.006, 0.01, 0.2, std(0x1a3a8a, 0.4), r.cx + 0.45, y + 0.08, r.cz + 0.1, g, 8); iron.rotation.z = 1.0;
  box(0.1, 0.05, 0.1, std(0x2a2a2a, 0.5, 0.5), r.cx + 0.5, y + 0.025, r.cz - 0.12, 1, g);
  place('vintage_stapler', r.cx + 0.25, y, r.cz - 0.2, 0.5, 1, g);
  place('cardboard_box_01', r.cx + 0.42, 0.25, r.cz, 0.3, 0.7, g);
  lights.lamps.push(lampLight(g, r.cx, y + 0.85, r.cz, 0xfff0d8, 2.0, 2.6));
  // a strip light under the shelf of the pegboard
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.015, 0.03), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xfff2dc, emissiveIntensity: 6 })); strip.position.set(r.cx, y + 0.95, r.z0 + 0.03); g.add(strip);
  pendant(r.cx, r.cz + 0.1, 1.2, false);
}
function buildHQ() { // Headquarters: the goal board on the brick wall, a credenza, a neon sign.
  const r = tr(7, 1, 6, 2), g = group('hq');
  // walnut slat wall behind the display
  const slatM = M.walnut;
  for (let i = 0; i < 42; i++) box(0.045, 2.4, 0.03, slatM, r.cx - 2.1 + i * 0.1025, 1.4, Z0 + 0.04, 0.6, g);
  box(4.3, 2.4, 0.02, std(0x101010, 0.9), r.cx, 1.4, Z0 + 0.012, 1, g);
  // the goal board: live from the game state
  const goal = canvasTex(1280, 720, (c, w, h) => {
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
  goalTex = goal;
  const disp = new THREE.Group(); disp.position.set(r.cx, 1.55, Z0 + 0.1); g.add(disp);
  rbox(2.3, 1.32, 0.05, 0.01, M.plastic, 0, 0, 0, disp);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(2.26, 1.27), screenMat(goal, 1.25)); sc.position.z = 0.026; disp.add(sc);
  // neon sign above (original wordmark)
  const neon = canvasTex(1024, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.font = 'italic bold 120px "Brush Script MT", "Segoe Script", cursive'; c.textAlign = 'center';
    c.shadowColor = '#ff3fb4'; c.shadowBlur = 24; c.strokeStyle = '#ffd1ef'; c.lineWidth = 7; c.strokeText('first office', w / 2, 140); c.shadowBlur = 0; c.strokeStyle = '#fff3fb'; c.lineWidth = 3; c.strokeText('first office', w / 2, 140);
  });
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshBasicMaterial({ map: neon, transparent: true, color: new THREE.Color(4, 2.2, 3.4), depthWrite: false, toneMapped: true }));
  nm.position.set(r.cx, 2.55, Z0 + 0.075); g.add(nm);
  const neonL = new THREE.RectAreaLight(0xff4fb8, 6, 1.8, 0.3); neonL.position.set(r.cx, 2.55, Z0 + 0.12); neonL.lookAt(r.cx, 2.0, Z0 + 3); g.add(neonL);
  // credenza
  const cr = new THREE.Group(); cr.position.set(r.cx, 0, Z0 + 0.3); g.add(cr);
  rbox(3.2, 0.62, 0.48, 0.008, M.walnut, 0, 0.36, 0, cr);
  for (let i = 0; i < 4; i++) { box(0.78, 0.5, 0.01, M.walnut, -1.2 + i * 0.8, 0.36, 0.245, 0.6, cr); box(0.2, 0.012, 0.02, M.brass, -1.2 + i * 0.8, 0.5, 0.255, 1, cr); }
  for (const s of [-1, 1]) for (const z of [-1, 1]) box(0.03, 0.05, 0.03, M.brass, s * 1.5, 0.025, z * 0.2, 1, cr);
  books(g, r.cx - 1.4, 0.67, Z0 + 0.3, 9, 0);
  place('ceramic_vase_01', r.cx + 1.25, 0.67, Z0 + 0.3, 0, 1.2, g);
  place('potted_plant_04', r.cx + 0.6, 0.67, Z0 + 0.3, 0, 0.6, g);
  place('hanging_picture_frame_02', r.cx - 0.5, 0.67, Z0 + 0.22, 0, 0.9, g);
  // standing command table with a tablet in front
  const ct = new THREE.Group(); ct.position.set(r.cx + 1.5, 0, r.z1 - 0.32); g.add(ct);
  cyl(0.03, 0.03, 1.0, M.steel, 0, 0.5, 0, ct); cyl(0.2, 0.22, 0.02, M.steel, 0, 0.01, 0, ct, 32);
  rbox(0.6, 0.03, 0.4, 0.006, M.walnut, 0, 1.02, 0, ct);
  const tab = rbox(0.25, 0.008, 0.18, 0.004, M.plastic, 0.02, 1.04, 0, ct); tab.rotation.y = 0.2;
  const ts = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.16), screenMat(dashScreen(61, '#22d3ee'), 1.1)); ts.rotation.x = -Math.PI / 2; ts.rotation.z = 0.2; ts.position.set(0.02, 1.045, 0); ct.add(ts);
  place('potted_plant_01', r.x0 + 0.2, 0, Z0 + 0.35, 0, 0.9, g);
}
let goalTex = null;
function buildRig() { // GPU Rig: three server racks with blinking LEDs.
  const r = tr(16, 12, 3, 1), g = group('rig');
  const face = canvasTex(256, 512, (c, w, h) => {
    c.fillStyle = '#0a0b0d'; c.fillRect(0, 0, w, h);
    for (let u = 0; u < 16; u++) { const y = 8 + u * 31; c.fillStyle = '#16181c'; c.fillRect(10, y, w - 20, 27); c.fillStyle = '#25282e'; for (let i = 0; i < 14; i++) c.fillRect(60 + i * 12, y + 6, 8, 15);
      for (let i = 0; i < 3; i++) { c.fillStyle = Math.random() < 0.6 ? '#2bff88' : Math.random() < 0.5 ? '#2bb8ff' : '#ffb02b'; c.fillRect(20 + i * 10, y + 10, 5, 5); } }
  });
  const rackM = std(0x111214, 0.4, 0.8);
  for (let i = 0; i < 3; i++) {
    const x = r.x0 + 0.38 + i * 0.72, rk = new THREE.Group(); rk.position.set(x, 0, r.cz); rk.rotation.y = Math.PI; g.add(rk);
    rbox(0.68, 1.95, 0.72, 0.01, rackM, 0, 0.975, 0, rk);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.8), new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.5 })); f.position.set(0, 0.98, -0.362); f.rotation.y = Math.PI; rk.add(f);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.86), M.glass); gl.position.set(0, 0.98, -0.37); gl.rotation.y = Math.PI; rk.add(gl);
    box(0.03, 1.2, 0.03, M.alu, 0.26, 1.0, -0.38, 1, rk);
    rackLeds.push(f.material);
  }
  // cable bundle from racks into the ceiling tray
  for (let i = 0; i < 4; i++) cable(g, [[r.x0 + 0.3 + i * 0.5, 1.95, r.cz + 0.2], [r.x0 + 0.3 + i * 0.5, 2.6, r.cz + 0.25], [r.x0 + 0.2 + i * 0.45, H - 0.05, r.cz + 0.3]], 0.012);
  const rl = new THREE.RectAreaLight(0x3fb8ff, 1.6, 2.0, 1.6); rl.position.set(r.cx, 1.0, r.z0 - 0.02); rl.lookAt(r.cx, 1.0, r.z0 - 3); g.add(rl);
}
const rackLeds = [];

// Decor outside the stations (always present). Anything on walkable tiles adds a collider.
function buildDecor() {
  // corner plants (solid tiles in the 2D office)
  place('pachira_aquatica_01', 1.1, 0, 1.1, 0.3, 1.0);
  place('potted_plant_01', 13.9, 0, 1.1, 1.2, 1.0);
  place('potted_plant_04', 1.12, 0, 10.1, 0.2, 1.1);
  place('calathea_orbifolia_01', 13.85, 0, 10.1, 2.0, 1.1);
  // lounge on the south wall, west side
  place('sofa_03', 3.4, 0, Z1 - 0.48, Math.PI, 1);
  colliders.push({ x0: 2.2, x1: 4.6, z0: Z1 - 0.95, z1: Z1 });
  place('throw_pillows_01', 2.85, 0.42, Z1 - 0.5, Math.PI, 1);
  place('side_table_01', 1.8, 0, Z1 - 0.4, 0, 1); colliders.push({ x0: 1.55, x1: 2.05, z0: Z1 - 0.65, z1: Z1 - 0.15 });
  const lrug = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.6), pbr('dirty_carpet', { color: 0x6b5446 })); lrug.rotation.x = -Math.PI / 2; lrug.position.set(3.4, 0.004, Z1 - 1.0); lrug.receiveShadow = true; scene.add(lrug);
  // arc floor lamp over the sofa
  const fl = new THREE.Group(); fl.position.set(4.9, 0, Z1 - 0.35); scene.add(fl);
  cyl(0.15, 0.16, 0.03, std(0x222222, 0.3, 0.6), 0, 0.015, 0, fl, 32);
  const arc = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-0.4, 2.0, -0.2), new THREE.Vector3(-1.1, 1.85, -0.35)]);
  const am = new THREE.Mesh(new THREE.TubeGeometry(arc, 40, 0.012, 8), M.brass); am.castShadow = true; fl.add(am);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x111111, 0.3, 0.8, { side: THREE.DoubleSide })); sh.position.set(-1.1, 1.82, -0.35); fl.add(sh);
  const fb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffc890, emissiveIntensity: 10 })); fb.position.set(-1.1, 1.76, -0.35); fl.add(fb);
  const fll = new THREE.SpotLight(0xffbf80, 12, 6, 1.1, 0.8, 2); fll.position.set(3.8, 1.75, Z1 - 0.7); fll.target.position.set(3.6, 0, Z1 - 0.9); scene.add(fll, fll.target);
  colliders.push({ x0: 4.7, x1: 5.1, z0: Z1 - 0.55, z1: Z1 - 0.15 });
  // coffee corner on the south wall, east side
  place('CoffeeCart_01', 10.6, 0, Z1 - 0.4, Math.PI, 1);
  colliders.push({ x0: 9.9, x1: 11.3, z0: Z1 - 0.8, z1: Z1 });
  place('metal_trash_can', 11.75, 0, Z1 - 0.3, 0, 1); colliders.push({ x0: 11.5, x1: 12.0, z0: Z1 - 0.55, z1: Z1 });
  // bookshelf on the east wall between the vault and the terminal corner
  place('wooden_bookshelf_worn', X1 - 0.2, 0, 5.6, -Math.PI / 2, 1);
  colliders.push({ x0: X1 - 0.45, x1: X1, z0: 4.85, z1: 6.35 });
  // wall art, clock, extinguisher
  place('hanging_picture_frame_01', X1 - 0.03, 1.6, 7.6, -Math.PI / 2, 1.3);
  place('hanging_picture_frame_02', 2.6, 1.55, Z1 - 0.03, Math.PI, 1.4);
  place('wall_clock', 5.6, 2.35, Z1 - 0.04, Math.PI, 1);
  place('korean_fire_extinguisher_01', 8.0, 0, Z1 - 0.15, Math.PI, 1);
  place('dartboard', X1 - 0.03, 1.7, 3.0 + 6.0, -Math.PI / 2, 1);
  place('cardboard_box_01', 12.6, 0, 1.0, 0.2, 1); place('cardboard_box_01', 12.9, 0.0, 1.45, -0.3, 0.8);
  colliders.push({ x0: 12.2, x1: 13.3, z0: 0.75, z1: 1.8 });
  // ceiling: linear LED fixtures between the beams (soft fill)
  for (const [x, z] of [[5.5, 4.2], [9.5, 4.2], [5.5, 7.6], [9.5, 7.6]]) {
    box(0.08, 0.04, 1.6, M.steel, x, H - 0.25, z);
    const lm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 1.55), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xfff0dd, emissiveIntensity: 5 })); lm.position.set(x, H - 0.275, z); scene.add(lm);
    for (const s of [-1, 1]) cyl(0.002, 0.002, 0.23, M.rubber, x, H - 0.115, z + s * 0.7, null, 4);
  }
  for (const [x, z] of [[7.5, 4.2], [7.5, 7.6]]) { const ra = new THREE.RectAreaLight(0xffe8cc, 1.6, 4.5, 0.6); ra.position.set(x, H - 0.28, z); ra.lookAt(x, 0, z); scene.add(ra); }
  // radiators under the west windows
  for (const z of [3.0, 7.5]) { const rg = new THREE.Group(); rg.position.set(X0 + 0.08, 0.35, z); scene.add(rg); for (let i = 0; i < 14; i++) box(0.06, 0.5, 0.05, std(0xd8d8d2, 0.4, 0.3), 0, 0, -0.45 + i * 0.07, 1, rg); }
  // wall outlets and switches
  for (const [x, z, ry] of [[6.2, Z1 - 0.01, Math.PI], [X1 - 0.01, 3.9, -Math.PI / 2], [X1 - 0.01, 8.5, -Math.PI / 2]]) { const o = box(0.08, 0.12, 0.012, std(0xe8e6e0, 0.4), x, 0.3, z); o.rotation.y = ry; }
  // nib-style drone (Nib in 3D)
}

// ---------- Nib: a small hovering drone that follows Nib's position in the 2D game ----------
let nib3d;
function buildNib() {
  const g = new THREE.Group(); scene.add(g); nib3d = g;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 })); body.castShadow = true; g.add(body);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.162, 32, 20, -0.9, 1.8, 0.95, 0.9), std(0x07090c, 0.1, 0.2)); face.rotation.y = Math.PI / 2 - Math.PI / 2; g.add(face);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 1.7) })); e.position.set(s * 0.045, 0.02, 0.155); g.add(e); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 40), M.alu); ring.rotation.x = Math.PI / 2; g.add(ring);
  const l = new THREE.PointLight(0x7ae8ff, 0.12, 1.2, 2); l.position.z = 0.3; g.add(l);
}

// ---------- the player ----------
// The founder: the Ready Player Me sample avatar from the three.js examples, animated with the X Bot's idle/walk/run
// (Mixamo clips), retargeted at load because the two rigs have different rest poses (A-pose vs T-pose).
let player, mixer, actions = {}, playerRadius = 0.2;
async function buildPlayer() {
  const [dst, src] = await Promise.all([gltf.loadAsync(A + 'char/founder.glb'), gltf.loadAsync(A + 'char/anims.glb')]);
  const model = dst.scene;
  const clips = {}; for (const n of ['idle', 'walk', 'run']) clips[n] = retarget(src.scene, src.animations.find(a => a.name === n), model);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) o.material.envMapIntensity = 0.9; } });
  model.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(model); model.scale.multiplyScalar(1.8 / (b.max.y - b.min.y));
  player = new THREE.Group(); player.add(model); scene.add(player);
  mixer = new THREE.AnimationMixer(model);
  for (const k in clips) { actions[k] = mixer.clipAction(clips[k]); actions[k].play(); actions[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
}
// Bake a clip from one humanoid rig onto another. Bones match by name (minus Mixamo's prefix). Each target bone first
// turns so it points where the source bone points at rest, then copies the source bone's world rotation change.
const base = n => n.replace(/^mixamorig/, '');
function retarget(src, clip, dst) {
  const sb = {}, db = []; src.traverse(o => { if (o.isBone) sb[base(o.name)] = o; }); dst.traverse(o => { if (o.isBone && sb[base(o.name)]) db.push(o); });
  src.updateMatrixWorld(true); dst.updateMatrixWorld(true); // both at rest, as loaded
  const wq = o => o.getWorldQuaternion(new THREE.Quaternion()), wp = o => o.getWorldPosition(new THREE.Vector3());
  const sRestInv = {}; for (const k in sb) sRestInv[k] = wq(sb[k]).invert();
  const dRest = new Map(), dParent = new Map(), align = new Map();
  for (const b of db) {
    const kids = b.children.filter(c => c.isBone && sb[base(c.name)]), kid = kids.find(c => /Middle1|Spine|Neck|Head|ForeArm|Hand$|Leg$|Foot$|ToeBase/.test(c.name)) || kids[0];
    const a = new THREE.Quaternion();
    if (kid) { const dd = wp(kid).sub(wp(b)).normalize(), sd = wp(sb[base(kid.name)]).sub(wp(sb[base(b.name)])).normalize(); if (dd.lengthSq() > 0 && sd.lengthSq() > 0) a.setFromUnitVectors(dd, sd); }
    else if (align.has(b.parent)) a.copy(align.get(b.parent));
    align.set(b, a); dRest.set(b, a.clone().multiply(wq(b))); dParent.set(b, db.includes(b.parent) ? null : wq(b.parent));
  }
  const hip = db.find(b => base(b.name) === 'Hips'), sHip = wp(sb.Hips), dHipW = wp(hip), hipParentInv = hip.parent.matrixWorld.clone().invert(), scale = dHipW.y / sHip.y;
  const mx = new THREE.AnimationMixer(src); mx.clipAction(clip).play();
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1), times = new Float32Array(n), qv = new Map(db.map(b => [b, new Float32Array(n * 4)])), pv = new Float32Array(n * 3), desired = new Map(), tmp = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    times[i] = i / fps; mx.setTime(Math.min(clip.duration - 1e-4, i / fps)); src.updateMatrixWorld(true);
    for (const b of db) { const k = base(b.name), w = wq(sb[k]).multiply(sRestInv[k]).multiply(dRest.get(b)); desired.set(b, w); tmp.copy(dParent.get(b) || desired.get(b.parent)).invert().multiply(w); tmp.toArray(qv.get(b), i * 4); }
    const w = dHipW.clone(); w.y += (wp(sb.Hips).y - sHip.y) * scale; w.applyMatrix4(hipParentInv); pv.set([w.x, w.y, w.z], i * 3); // vertical bob only: the game moves the body
  }
  mx.stopAllAction(); mx.uncacheRoot(src);
  const tracks = db.map(b => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(hip.name + '.position', times, pv));
  return new THREE.AnimationClip(clip.name, (n - 1) / fps, tracks);
}

// ---------- input + camera ----------
const keys = {};
let yaw = 0, pitch = 0.22, dist = 2.6, camPos = new THREE.Vector3(), camInit = false;
const pos = new THREE.Vector3(), vel = new THREE.Vector3();
let heading = Math.PI, speedNow = 0;
function ignoreKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  const el = e.target; return !!(el && el.closest && (el.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]')));
}
const MOVE = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
function bindInput(canvas) {
  addEventListener('keydown', e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = true; const m = MOVE[e.code]; if (!m || ignoreKey(e)) return; keys[m] = true; e.preventDefault(); });
  addEventListener('keyup', e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = false; const m = MOVE[e.code]; if (m) keys[m] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', e => {
    if (document.pointerLockElement === canvas) { yaw -= e.movementX * 0.0035; pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.003, -0.5, 1.1); return; }
    if (!drag) return; yaw -= (e.clientX - drag.x) * 0.006; pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.004, -0.5, 1.1); drag = { x: e.clientX, y: e.clientY };
  });
  const up = () => { drag = null; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => canvas.requestPointerLock?.()); // double-click: mouse-look; Esc releases
  canvas.addEventListener('wheel', e => { dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.002, 1.3, 4.2); e.preventDefault(); }, { passive: false });
}
function blockedAt(x, z) {
  if (!world.walkable(x / K, z / K)) return true;
  for (const c of colliders) if (x > c.x0 - playerRadius && x < c.x1 + playerRadius && z > c.z0 - playerRadius && z < c.z1 + playerRadius) return true;
  return false;
}
const ray = new THREE.Raycaster();
function updatePlayer(dt) {
  const st = world.getState(), active = world.active() && st.room === 'office';
  // the game may move the founder itself (guided walks, restore): follow it
  const gx = st.x * K, gz = st.y * K;
  if (Math.hypot(gx - pos.x, gz - pos.z) > 0.08 && !keysHeld()) { const dx = gx - pos.x, dz = gz - pos.z; if (world.routing()) heading = Math.atan2(dx, dz); pos.x = gx; pos.z = gz; }
  let fx = 0, fz = 0;
  if (active) { const f = (keys.f ? 1 : 0) - (keys.b ? 1 : 0), r = (keys.r ? 1 : 0) - (keys.l ? 1 : 0); fx = -Math.sin(yaw) * f + Math.cos(yaw) * r; fz = -Math.cos(yaw) * f - Math.sin(yaw) * r; }
  const n = Math.hypot(fx, fz), target = n ? (keys.run ? 4.2 : 1.55) : 0;
  speedNow += (target - speedNow) * Math.min(1, dt * (target > speedNow ? 6 : 9));
  let moved = false;
  if (n) {
    fx /= n; fz /= n;
    let want = Math.atan2(fx, fz), d = ((want - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI; heading += d * Math.min(1, dt * 10);
  }
  if (speedNow > 0.02) {
    const dirx = n ? fx : Math.sin(heading), dirz = n ? fz : Math.cos(heading), step = speedNow * dt;
    const nx = pos.x + dirx * step, nz = pos.z + dirz * step;
    if (!blockedAt(nx, pos.z)) { pos.x = nx; moved = true; }
    if (!blockedAt(pos.x, nz)) { pos.z = nz; moved = true; }
    if (moved) {
      const facing = Math.abs(dirx) > Math.abs(dirz) ? (dirx < 0 ? 'left' : 'right') : (dirz < 0 ? 'up' : 'down');
      world.setPose(pos.x / K, pos.z / K, facing, true);
    }
  } else if (world.routing()) { /* walking a guided route */ }
  const routeMoving = world.routing();
  player.position.copy(pos); player.rotation.y = heading;
  // animation weights: idle / walk / run by speed
  const sp = routeMoving ? 1.55 : moved ? speedNow : 0;
  const wWalk = THREE.MathUtils.clamp(sp / 1.55, 0, 1) * (1 - THREE.MathUtils.clamp((sp - 1.55) / 2.0, 0, 1));
  const wRun = THREE.MathUtils.clamp((sp - 1.55) / 2.0, 0, 1), wIdle = 1 - THREE.MathUtils.clamp(sp / 1.0, 0, 1);
  blend.idle += (wIdle - blend.idle) * Math.min(1, dt * 8); blend.walk += (wWalk - blend.walk) * Math.min(1, dt * 8); blend.run += (wRun - blend.run) * Math.min(1, dt * 8);
  const sum = blend.idle + blend.walk + blend.run || 1;
  for (const k in actions) actions[k].setEffectiveWeight(blend[k] / sum);
  actions.walk.timeScale = sp > 0.1 ? THREE.MathUtils.clamp(sp / 1.55, 0.6, 1.3) : 1; actions.run.timeScale = sp > 2 ? THREE.MathUtils.clamp(sp / 4.2, 0.7, 1.2) : 1;
  mixer.update(dt);
}
const blend = { idle: 1, walk: 0, run: 0 };
const keysHeld = () => keys.f || keys.b || keys.l || keys.r;
function updateCamera(dt) {
  const shoulder = 0.38, head = new THREE.Vector3(pos.x, 1.5, pos.z);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const target = head.clone().addScaledVector(right, shoulder * Math.min(1, dist / 2.6));
  const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
  let want = target.clone().add(off);
  // camera collision: pull in to the first wall / furniture between the head and the camera
  ray.set(target, off.clone().normalize()); ray.far = dist + 0.2;
  const hit = ray.intersectObjects(occluders, false)[0];
  if (hit) want = target.clone().addScaledVector(off.clone().normalize(), Math.max(0.35, hit.distance - 0.22));
  want.x = THREE.MathUtils.clamp(want.x, X0 + 0.15, X1 - 0.15); want.z = THREE.MathUtils.clamp(want.z, Z0 + 0.15, Z1 - 0.15); want.y = THREE.MathUtils.clamp(want.y, 0.25, H - 0.15);
  if (!camInit) { camPos.copy(want); camInit = true; }
  camPos.lerp(want, Math.min(1, dt * 12));
  camera.position.copy(camPos); camera.lookAt(target);
  // hide the character when the camera is inside her
  player.visible = camPos.distanceTo(head) > 0.45;
}

// ---------- prompt "E · Desk" ----------
let promptEl, lastPrompt = '';
function updatePrompt() {
  const btn = document.getElementById('interact'), label = document.getElementById('interact-label')?.textContent || '';
  const on = btn && !btn.disabled && world.active();
  const text = on ? label.replace(/^Use /, '') : '';
  if (text !== lastPrompt) { lastPrompt = text; promptEl.hidden = !text; promptEl.innerHTML = text ? `<kbd>E</kbd><span></span>` : ''; if (text) promptEl.querySelector('span').textContent = text; }
}

// ---------- post-processing ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, vig: { value: 0.32 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain, vig; uniform vec2 res; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d,d);
      // slight chromatic fringe toward the corners
      vec3 c = vec3(texture2D(tDiffuse, vUv - d*0.0025*r2*4.0).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d*0.0025*r2*4.0).b);
      // grade: teal shadows, warm highlights, a touch more contrast and saturation
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(c, c * vec3(0.92,1.0,1.06), smoothstep(0.5,0.0,l)*0.6);
      c = mix(c, c * vec3(1.06,1.0,0.92), smoothstep(0.45,1.0,l)*0.5);
      c = mix(vec3(l), c, 1.12);
      c = (c - 0.5) * 1.06 + 0.5;
      c *= 1.0 - vig * smoothstep(0.1, 0.85, r2*2.2);
      c += (h(vUv*res + time) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);
    }`,
};
function buildPost() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 }));
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  smaa = new SMAAPass(); composer.addPass(smaa);
}
function applyQuality() {
  const dpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 0.75 : quality === 'medium' ? 1 : 1.5);
  renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
  gtao.enabled = quality !== 'low';
  renderer.shadowMap.enabled = true;
  grade.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
}

// Environment for reflections and soft bounce: a cube capture of the lit room itself, prefiltered.
function bakeEnvironment() {
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cc = new THREE.CubeCamera(0.05, 60, cubeRT); cc.position.set(7.5, 1.6, 5.6); scene.add(cc);
  const hidden = []; if (player) { player.visible = false; hidden.push(player); }
  cc.update(renderer, scene);
  hidden.forEach(o => (o.visible = true));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromCubemap(cubeRT.texture).texture;
  scene.environment = env; scene.environmentIntensity = 0.55;
  cubeRT.dispose(); pm.dispose(); scene.remove(cc);
}

// ---------- main ----------
let fpsEl, frames = 0, fpsT = 0, fpsNow = 0, slowFor = 0;
async function start() {
  G = window.Stage2; world = G.world;
  RectAreaLightUniformsLib.init();
  const canvas = document.createElement('canvas'); canvas.id = 'o3d'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Your office in 3D. WASD to walk, Shift to run, drag to look, E to use a desk.');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x05070b);
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 200);
  makeMaterials();
  buildShell(); buildSkyline();
  buildHunt(); buildContract(); buildStats(); buildTraining(); buildForge(); buildHQ(); buildRig(); buildDecor(); buildNib();
  scene.add(new THREE.HemisphereLight(0x8aa0c8, 0x2a2018, 0.25));
  await Promise.all([buildPlayer(), ...pending]);
  await Promise.all(Object.values(texCache).map(t => t.image ? null : new Promise(r => { const chk = () => (t.image && (t.image.complete ?? true) ? r() : setTimeout(chk, 50)); chk(); })));
  t0 = performance.now() / 1000;
  const s0 = world.getState(); pos.set(s0.x * K, 0, s0.y * K); heading = Math.PI; yaw = 0;
  // camera starts behind the founder looking toward HQ
  buildPost(); applyQuality();
  syncStations(); bakeEnvironment();
  // swap the 2D office for the 3D one
  document.querySelector('.playfield').prepend(canvas);
  promptEl = document.createElement('div'); promptEl.id = 'prompt3d'; promptEl.hidden = true; document.querySelector('.playfield').appendChild(promptEl);
  const help = document.createElement('div'); help.id = 'help3d'; help.innerHTML = '<kbd>WASD</kbd> walk · <kbd>Shift</kbd> run · drag to look · <kbd>E</kbd> use desk';
  document.querySelector('.playfield').appendChild(help); setTimeout(() => help.classList.add('fade'), 9000);
  if (Q.has('fps')) { fpsEl = document.createElement('div'); fpsEl.id = 'fps3d'; document.body.appendChild(fpsEl); }
  document.documentElement.classList.add('o3d');
  world.setExternal(true);
  bindInput(canvas);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(); });
  window.Office3D = { renderer, scene, camera, quality: q => { quality = q; try { localStorage.setItem('fo.q3d', q); } catch {} applyQuality(); }, fps: () => fpsNow, view: (y, p, d) => { yaw = y; pitch = p; dist = d; camInit = false; }, passes: { gtao: () => gtao, bloom: () => bloom, smaa: () => smaa, grade: () => grade }, lights: () => { const o = []; scene.traverse(x => x.isLight && o.push(x)); return o; } };
  renderer.setAnimationLoop(loop);
}
let stationKey = '';
function syncStations() {
  // a station the game hides (not unlocked yet) is open floor in the 2D office, so it isn't drawn either
  const v = G.ui && G.state ? null : null; void v;
  const hiddenIds = hiddenStations();
  const key = hiddenIds.join(',');
  if (key === stationKey) return; stationKey = key;
  for (const id in stationGroups) stationGroups[id].visible = !hiddenIds.includes(id);
}
function hiddenStations() {
  // The 2D world knows which stations are usable: a hidden one is walkable at its centre.
  const out = [];
  for (const s of window.CantinaWorld.stations) if (s.room === 'office' && stationGroups[s.id] && world.walkable(s.x, s.y)) out.push(s.id);
  return out;
}
function loop() {
  const now = performance.now() / 1000, dt = tPrev ? Math.min(0.05, now - tPrev) : 0.016; tPrev = now; const t = now - t0;
  updatePlayer(dt); updateCamera(dt); updatePrompt();
  if ((frames & 15) === 0) syncStations();
  // Nib follows his 2D position, hovering
  const np = G.nib?.pos?.();
  if (np && nib3d) { const tx = np.x * K, tz = np.y * K; nib3d.position.x += (tx - nib3d.position.x) * Math.min(1, dt * 4); nib3d.position.z += (tz - nib3d.position.z) * Math.min(1, dt * 4); nib3d.position.y = 1.45 + Math.sin(t * 2.2) * 0.04; const look = Math.atan2(pos.x - nib3d.position.x, pos.z - nib3d.position.z); nib3d.rotation.y += (((look - nib3d.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3); }
  for (const m of rackLeds) m.emissiveIntensity = 1.3 + Math.sin(t * 7 + m.id) * 0.25;
  if (goalTex && (frames % 120) === 0) goalTex.userData.redraw();
  grade.uniforms.time.value = t;
  composer.render(dt);
  frames++; fpsT += dt;
  if (fpsT >= 1) {
    fpsNow = frames / fpsT * 1; frames = 0; fpsT = 0; if (fpsEl) fpsEl.textContent = Math.round(fpsNow) + ' fps · ' + quality;
    // fall back a step if it stays slow (only when not forced by ?q=)
    if (!Q.get('q') && t > 6 && fpsNow < 38 && document.visibilityState === 'visible') { if (++slowFor >= 4 && quality !== 'low') { quality = quality === 'high' ? 'medium' : 'low'; applyQuality(); slowFor = 0; } } else slowFor = 0;
  }
}

// Boot once game.js has made the world.
if (want3d()) {
  let tries = 0;
  const wait = () => { if (window.Stage2?.world?.setExternal) start().catch(e => { console.warn('office3d: staying 2D', e); document.documentElement.classList.remove('o3d'); try { window.Stage2.world.setExternal(false); } catch {} document.getElementById('o3d')?.remove(); }); else if (++tries < 200) setTimeout(wait, 100); };
  wait();
}
