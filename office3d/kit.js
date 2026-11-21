// First Office 3D: shared kit. Helpers, materials, procedural textures, screen content and small furniture builders.
// Everything here draws into C.scene (or a parent group) and registers colliders / occluders / power hooks on C.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const A = 'office3d/assets/';
// 1 office px = K metres; a 16 px tile is 0.75 m, so the 20x15-tile office is 15 m x 11.25 m.
export const K = 0.75 / 16, T = 0.75, X0 = 0.75, X1 = 14.25, Z0 = 0.75, Z1 = 10.5, H = 3.3;
export const tr = (tx, ty, tw, th) => ({ x0: tx * T, z0: ty * T, x1: (tx + tw) * T, z1: (ty + th) * T, cx: (tx + tw / 2) * T, cz: (ty + th / 2) * T, w: tw * T, d: th * T });

// Shared state for the room builders.
export const C = {
  scene: null, M: null,
  colliders: [],   // extra solid boxes (metres) on top of the 2D grid: {x0,z0,x1,z1, id?}
  occluders: [],   // meshes the camera must not pass through
  pending: [],     // model loads
  groups: {},      // station id -> THREE.Group
  power: {},       // station id -> [fn(on)]
  tick: [],        // fn(t, dt) per frame
  lights: [],
};
export const onPower = (id, fn) => (C.power[id] || (C.power[id] = [])).push(fn);

// ---------- seeded random ----------
let seed = 7;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const rr = (a, b) => a + rnd() * (b - a);
export const pick = a => a[Math.floor(rnd() * a.length)];

// ---------- textures ----------
const texLoader = new THREE.TextureLoader();
const texCache = {};
export function tex(path, srgb) {
  const key = path + srgb;
  if (texCache[key]) return texCache[key];
  const t = texLoader.load(A + path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}
export const allTextures = () => Object.values(texCache);
export function pbr(name, o = {}) {
  const P = o.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new P({
    map: tex(`tex/${name}/diff.jpg`, true), normalMap: tex(`tex/${name}/nor.jpg`), roughnessMap: tex(`tex/${name}/rough.jpg`),
    roughness: o.roughness ?? 1, metalness: o.metalness ?? 0, color: o.color ?? 0xffffff, envMapIntensity: o.env ?? 1,
    ...(o.physical || {}),
  });
  m.normalScale.set(o.ns ?? 1, -(o.ns ?? 1));
  return m;
}
export function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (!o.linear) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.redraw = () => { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}
// Soft grime: a tiling greyscale noise used to break up roughness / colour on large surfaces.
let grimeT;
export function grime() {
  if (grimeT) return grimeT;
  grimeT = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const r = rr(4, 60); const x = rnd() * w, y = rnd() * h, v = Math.floor(rr(90, 170)); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${v},${v},${v},.18)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); } }
  }, { linear: true, repeat: true });
  return grimeT;
}

// ---------- geometry helpers ----------
export function boxUV(g, w, h, d, s) {
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s); }
  return g;
}
const geoCache = new Map();
function boxGeo(w, h, d, s) {
  const k = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${s}`;
  let g = geoCache.get(k); if (!g) { g = boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, s); geoCache.set(k, g); }
  return g;
}
export function box(w, h, d, mat, x, y, z, s = 1, parent, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d, s), mat);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  (parent || C.scene).add(m); return m;
}
export function rbox(w, h, d, r, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  (parent || C.scene).add(m); return m;
}
export function cyl(rt, rb, h, mat, x, y, z, parent, seg = 20, shadow = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  (parent || C.scene).add(m); return m;
}
export function plane(w, h, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.receiveShadow = true; (parent || C.scene).add(m); return m;
}
export const std = (color, roughness = 0.5, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
export function group(parent, x = 0, y = 0, z = 0, ry = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; (parent || C.scene).add(g); return g; }
export function cable(parent, pts, r = 0.005, mat) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(8, pts.length * 10), r, 6), mat || C.M.rubber); m.castShadow = false; m.receiveShadow = true; (parent || C.scene).add(m); return m;
}
// A cable lying on the floor between two points, with a little slack wobble.
export function floorCable(parent, a, b, r = 0.006, mat) {
  const pts = [], n = 6; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t + (i && i < n ? rr(-0.08, 0.08) : 0), r, a[1] + (b[1] - a[1]) * t + (i && i < n ? rr(-0.08, 0.08) : 0)]); }
  return cable(parent, pts, r, mat);
}

// ---------- materials ----------
export function makeMaterials() {
  const M = {
    floor: pbr('herringbone_parquet', { color: 0xb59d86, env: 1.0, ns: 0.8, physical: { clearcoat: 0.8, clearcoatRoughness: 0.09 } }),
    brick: pbr('red_brick_03', { color: 0xc9ada0, ns: 1.6 }),
    plaster: pbr('painted_plaster_wall', { color: 0x8d9692 }),
    plasterDark: pbr('painted_plaster_wall', { color: 0x283335 }),
    ceiling: pbr('rough_plaster_03', { color: 0x9a958c }),
    concrete: pbr('concrete_floor_02', { color: 0x8c8a86 }),
    oak: pbr('oak_veneer_01', { color: 0xe3cfb8, roughness: 0.75, env: 0.9 }),
    walnut: pbr('walnut_veneer', { color: 0xd2b9a4, roughness: 0.7, env: 0.9 }),
    rug: pbr('dirty_carpet', { color: 0x8a8079 }),
    fabric: pbr('fabric_pattern_07', { color: 0x9a9a9a }),
    leather: pbr('fabric_leather_02', { color: 0x2a2624, roughness: 0.75, env: 0.8 }),
    leatherBrown: pbr('fabric_leather_02', { color: 0x6b3d24, roughness: 0.6, env: 0.8 }),
    steel: std(0x1b1c1e, 0.45, 0.85),
    steelLight: std(0x8d9196, 0.32, 0.95),
    alu: std(0xb9bcc0, 0.3, 1),
    aluDark: std(0x3c3e42, 0.35, 1),
    plastic: std(0x121314, 0.42, 0),
    plasticGrey: std(0x3a3c40, 0.5, 0),
    plasticWhite: std(0xd9d7d0, 0.45, 0),
    rubber: std(0x0b0b0c, 0.75, 0),
    paper: std(0xe9e5da, 0.85, 0),
    cardboard: std(0x9c7a52, 0.9, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xaab8c0, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.6, depthWrite: false }),
    brass: std(0xb08d57, 0.3, 1),
    ceramicW: std(0xf1eee8, 0.25, 0),
    blackGloss: std(0x050506, 0.12, 0),
    screenOff: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.2 }),
  };
  return (C.M = M);
}

// ---------- screen content ----------
export function screenMat(t, k = 1.4) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: k, roughness: 0.16, metalness: 0, envMapIntensity: 0.6 });
  m.userData.k = k; return m;
}
const mkR = s => () => ((s = (s * 16807) % 2147483647) / 2147483647);
function chrome(g, w, h, title, accent = '#1f6feb') {
  g.fillStyle = '#0c1016'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#161b24'; g.fillRect(0, 0, w, 34);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(18 + i * 20, 17, 6, 0, 7); g.fill(); });
  g.fillStyle = '#9aa4b2'; g.font = '15px Menlo, monospace'; g.fillText(title, 90, 22);
  g.fillStyle = accent; g.fillRect(0, h - 22, w, 22);
}
export function codeScreen(seed, hot) {
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed); chrome(g, w, h, 'refund.ts — first-office');
    g.fillStyle = '#11161e'; g.fillRect(0, 34, 170, h - 56);
    g.font = '15px Menlo, monospace'; g.fillStyle = '#7d8590';
    ['src', '  api', '  auth', '    session.ts', '    token.ts', '  payments', '    refund.ts', 'tests', 'package.json'].forEach((t, i) => g.fillText(t, 12, 64 + i * 22));
    const cols = ['#ff7b72', '#79c0ff', '#d2a8ff', '#a5d6ff', '#7ee787', '#e6edf3', '#ffa657'];
    for (let i = 0; i < 25; i++) {
      const y = 58 + i * 22;
      if (hot && i === 13) { g.fillStyle = 'rgba(248,81,73,.28)'; g.fillRect(170, y - 15, w, 21); }
      g.fillStyle = '#484f58'; g.fillText(String(40 + i).padStart(3), 180, y);
      let x = 230 + Math.floor(r() * 4) * 26; const n = 2 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) { const ww = 30 + r() * 90; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, y - 11, ww, 11); x += ww + 10; if (x > w - 40) break; }
    }
    g.fillStyle = '#fff'; g.font = '13px Menlo, monospace'; g.fillText('main  ⎇  0 errors  1 finding', 12, h - 6);
  });
}
export function dashScreen(seed, accent = '#58a6ff', title = 'Programs · live findings') {
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6edf3'; g.font = 'bold 26px Arial'; g.fillText(title, 28, 46);
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
export function termScreen(seed, col = '#3fb950') {
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#05080a'; g.fillRect(0, 0, w, h); g.font = '17px Menlo, monospace';
    for (let i = 0; i < 28; i++) { g.fillStyle = r() < 0.15 ? '#ffb454' : r() < 0.3 ? '#7ee787' : col; let t = '$ '; const n = 10 + Math.floor(r() * 50); for (let k = 0; k < n; k++) t += 'abcdefghijklmnopqrstuvwxyz/._-  '[Math.floor(r() * 32)]; g.fillText(t, 16, 26 + i * 22); }
  });
}
export function kanbanScreen(seed) { // Ops: incoming contracts
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#10131a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f0883e'; g.font = 'bold 24px Arial'; g.fillText('OPS · CONTRACT BOARD', 24, 40);
    ['INBOX', 'SCOPED', 'IN PROGRESS', 'PAID'].forEach((c, i) => {
      const x = 24 + i * 250; g.fillStyle = '#181d27'; g.fillRect(x, 60, 236, 560); g.fillStyle = '#8b949e'; g.font = 'bold 15px Arial'; g.fillText(c, x + 12, 84);
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) { const y = 100 + k * 104; g.fillStyle = '#222a37'; g.fillRect(x + 10, y, 216, 92); g.fillStyle = ['#f85149', '#d29922', '#3fb950', '#58a6ff'][Math.floor(r() * 4)]; g.fillRect(x + 10, y, 4, 92);
        g.fillStyle = '#e6edf3'; g.font = '15px Arial'; g.fillText(['Acme Pay', 'Northwind', 'Globex API', 'Initech', 'Hooli Cloud', 'Umbra Bank'][Math.floor(r() * 6)], x + 24, y + 26);
        g.fillStyle = '#7d8590'; g.font = '13px Arial'; g.fillText('$' + (500 + Math.floor(r() * 40) * 100) + ' · ' + (1 + Math.floor(r() * 9)) + 'd left', x + 24, y + 50); g.fillStyle = '#30363d'; g.fillRect(x + 24, y + 64, 180, 8); g.fillStyle = '#f0883e'; g.fillRect(x + 24, y + 64, 180 * r(), 8); }
    });
  });
}
export function ledgerScreen(seed) { // Vault: a ledger spreadsheet
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#0e1512'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d6b45'; g.fillRect(0, 0, w, 44);
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.fillText('LEDGER · Q1', 18, 30);
    g.font = '15px Menlo, monospace';
    for (let i = 0; i < 24; i++) { const y = 70 + i * 23; g.fillStyle = i % 2 ? '#131c18' : '#0e1512'; g.fillRect(0, y - 16, w, 23); g.fillStyle = '#5b6b63'; g.fillText(String(i + 1).padStart(2), 10, y); g.fillStyle = '#cfe3d6'; g.fillText(['bounty', 'payout', 'gpu rent', 'coffee', 'contract', 'tooling'][Math.floor(r() * 6)], 60, y); const v = Math.floor((r() - 0.3) * 4000); g.fillStyle = v < 0 ? '#ff6b5e' : '#4ade80'; g.fillText((v < 0 ? '-' : '+') + '$' + Math.abs(v).toLocaleString(), 330, y); }
    g.strokeStyle = '#4ade80'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x < 380; x += 10) { const y = 520 - x * 0.8 - r() * 60; x ? g.lineTo(600 + x, y) : g.moveTo(600, y); } g.stroke();
    g.strokeStyle = '#2a3a33'; g.lineWidth = 1; g.strokeRect(590, 80, 410, 480);
  });
}
export function agentScreen(seed, name) { // agent terminals: a chat-like log
  return canvasTex(768, 480, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#0b1114'; g.fillRect(0, 0, w, h); g.fillStyle = '#12343a'; g.fillRect(0, 0, w, 36);
    g.fillStyle = '#5eead4'; g.font = 'bold 18px Menlo, monospace'; g.fillText('agent/' + name + '  ● running', 14, 24);
    g.font = '15px Menlo, monospace';
    for (let i = 0; i < 18; i++) { const y = 62 + i * 23; const kind = r(); g.fillStyle = kind < 0.2 ? '#fbbf24' : kind < 0.35 ? '#f87171' : kind < 0.6 ? '#5eead4' : '#94a3b8'; let t = ['> scan ', '> fuzz ', '  ok ', '  found ', '> diff ', '  retry '][Math.floor(r() * 6)]; const n = 8 + Math.floor(r() * 40); for (let k = 0; k < n; k++) t += 'abcdefghijklmnop/._-  '[Math.floor(r() * 22)]; g.fillText(t, 14, y); }
  });
}
export function nodeScreen(seed) { // Forge: an agent tool graph
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#14110f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a241f'; for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const nodes = []; for (let i = 0; i < 8; i++) nodes.push([80 + (i % 4) * 230 + r() * 40, 120 + Math.floor(i / 4) * 260 + r() * 60]);
    g.strokeStyle = '#ff8a3d'; g.lineWidth = 3; for (let i = 1; i < 8; i++) { const a = nodes[i - 1], b = nodes[i]; g.beginPath(); g.moveTo(a[0] + 150, a[1] + 30); g.bezierCurveTo(a[0] + 220, a[1] + 30, b[0] - 70, b[1] + 30, b[0], b[1] + 30); g.stroke(); }
    nodes.forEach((n, i) => { g.fillStyle = '#26201b'; g.fillRect(n[0], n[1], 150, 80); g.fillStyle = ['#ff8a3d', '#fbbf24', '#60a5fa'][i % 3]; g.fillRect(n[0], n[1], 150, 22); g.fillStyle = '#111'; g.font = 'bold 13px Arial'; g.fillText(['fetch', 'parse', 'fuzz', 'triage', 'repro', 'report', 'verify', 'ship'][i], n[0] + 8, n[1] + 16); g.fillStyle = '#b8aa9c'; g.font = '12px Menlo'; g.fillText('in → out', n[0] + 8, n[1] + 50); });
    g.fillStyle = '#ff8a3d'; g.font = 'bold 22px Arial'; g.fillText('AGENT FORGE · tool graph', 20, 36);
  });
}
export function courseScreen(seed) { // Training: a lesson video
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1e1033'); gr.addColorStop(1, '#0b1a33'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4b5fd'; g.font = 'bold 30px Arial'; g.fillText('Lesson 4 · Race conditions', 40, 70);
    g.fillStyle = '#e9e5ff'; g.font = '22px Arial'; ['Two requests, one balance', 'Lock, then re-check', 'Prove it with a timing diff'].forEach((t, i) => g.fillText('•  ' + t, 60, 150 + i * 46));
    g.strokeStyle = '#a78bfa'; g.lineWidth = 4; g.strokeRect(560, 130, 400, 250); g.beginPath(); g.moveTo(580, 340); for (let x = 0; x < 360; x += 12) g.lineTo(580 + x, 340 - Math.abs(Math.sin(x * 0.03)) * 160 * r()); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, h - 70, w, 70); g.fillStyle = '#a78bfa'; g.fillRect(30, h - 40, w * 0.45, 6); g.fillStyle = '#444'; g.fillRect(30 + w * 0.45, h - 40, w * 0.5, 6); g.fillStyle = '#fff'; g.beginPath(); g.arc(30 + w * 0.45, h - 37, 9, 0, 7); g.fill();
  });
}
export function gpuScreen(seed) { // Rig: utilisation graphs
  return canvasTex(1024, 640, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = '#060a10'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#38bdf8'; g.font = 'bold 24px Menlo, monospace'; g.fillText('RIG-01  8x GPU   util 94%   72°C', 24, 40);
    for (let i = 0; i < 8; i++) { const x = 24 + (i % 4) * 248, y = 70 + Math.floor(i / 4) * 280; g.fillStyle = '#0d1520'; g.fillRect(x, y, 232, 260); g.fillStyle = '#7dd3fc'; g.font = '15px Menlo'; g.fillText('gpu' + i, x + 10, y + 22); g.strokeStyle = i === 5 ? '#fbbf24' : '#22d3ee'; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < 220; k += 6) { const yy = y + 240 - (0.6 + r() * 0.35) * 190; k ? g.lineTo(x + 6 + k, yy) : g.moveTo(x + 6, yy); } g.stroke(); }
  });
}

// ---------- generic paper / poster textures ----------
export function docTex(seed, opts = {}) {
  return canvasTex(256, 362, (g, w, h) => {
    const r = mkR(seed);
    g.fillStyle = opts.bg || '#f1ede3'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2b2b'; g.fillRect(20, 22, 120 + r() * 80, 10);
    for (let i = 0; i < 26; i++) { if (r() < 0.08) continue; g.fillStyle = 'rgba(40,40,40,.55)'; g.fillRect(20, 50 + i * 11, (w - 40) * (0.5 + r() * 0.5), 4); }
    if (opts.stamp) { g.strokeStyle = 'rgba(180,30,30,.7)'; g.lineWidth = 4; g.strokeRect(140, 280, 90, 40); g.fillStyle = 'rgba(180,30,30,.7)'; g.font = 'bold 18px Arial'; g.fillText(opts.stamp, 148, 307); }
    if (opts.chart) { g.strokeStyle = '#1f6feb'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x < 200; x += 10) { const y = 300 - x * 0.4 - r() * 30; x ? g.lineTo(28 + x, y) : g.moveTo(28, y); } g.stroke(); }
    // creases
    g.fillStyle = 'rgba(0,0,0,.04)'; g.fillRect(0, h / 3, w, 2); g.fillRect(0, (2 * h) / 3, w, 2);
  });
}
// Original posters for the walls (First Office's own fictional brands / motivational prints).
export function posterTex(kind) {
  return canvasTex(512, 720, (g, w, h) => {
    if (kind === 'ship') {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff6a3d'); gr.addColorStop(1, '#5b1a6e'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,230,180,.9)'; g.beginPath(); g.arc(w / 2, 300, 150, 0, 7); g.fill();
      g.fillStyle = '#2a0b33'; for (let i = 0; i < 9; i++) g.fillRect(0, 300 + i * 22, w, 9 - i * 0.6);
      g.fillStyle = '#fff3e0'; g.font = 'bold 74px Futura, Arial Black, sans-serif'; g.textAlign = 'center'; g.fillText('SHIP IT', w / 2, 590); g.font = '22px Arial'; g.fillText('SEASON ONE · FIRST OFFICE', w / 2, 640);
    } else if (kind === 'bug') {
      g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 6; g.beginPath(); g.ellipse(w / 2, 300, 90, 130, 0, 0, 7); g.stroke(); g.beginPath(); g.arc(w / 2, 150, 50, 0, 7); g.stroke();
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * 85, 240 + i * 60); g.lineTo(w / 2 + s * 170, 210 + i * 80); g.stroke(); }
      g.fillStyle = '#c0392b'; g.font = 'bold 60px Georgia, serif'; g.textAlign = 'center'; g.fillText('FOUND ONE', w / 2, 560); g.fillStyle = '#1a1a1a'; g.font = 'italic 24px Georgia, serif'; g.fillText('every bug is a story', w / 2, 610);
    } else if (kind === 'map') {
      g.fillStyle = '#0f2a3a'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(120,220,255,.35)'; g.lineWidth = 1;
      for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(rnd() * w, rnd() * h); g.lineTo(rnd() * w, rnd() * h); g.stroke(); }
      for (let i = 0; i < 30; i++) { g.fillStyle = rnd() < 0.3 ? '#ff6b6b' : '#7dd3fc'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 4, 0, 7); g.fill(); }
      g.fillStyle = '#e0f2fe'; g.font = 'bold 40px Menlo, monospace'; g.fillText('ATTACK', 30, 640); g.fillText('SURFACE', 30, 690);
    } else if (kind === 'nib') {
      g.fillStyle = '#121a1d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f0ea'; g.beginPath(); g.arc(w / 2, 300, 140, 0, 7); g.fill();
      g.fillStyle = '#07090c'; g.beginPath(); g.ellipse(w / 2, 310, 100, 60, 0, 0, 7); g.fill(); g.fillStyle = '#5ee8ff'; g.fillRect(w / 2 - 40, 295, 16, 30); g.fillRect(w / 2 + 24, 295, 16, 30);
      g.fillStyle = '#5ee8ff'; g.font = 'bold 56px Arial'; g.textAlign = 'center'; g.fillText('ASK NIB', w / 2, 560); g.fillStyle = '#9fb3b8'; g.font = '22px Arial'; g.fillText('your night-shift partner', w / 2, 605);
    } else {
      g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f5c518'; g.font = 'bold 120px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('0', w / 2, 300); g.font = 'bold 40px Arial'; g.fillText('DAYS SINCE', w / 2, 400); g.fillText('LAST CRIT', w / 2, 450);
    }
  });
}
let stickyMats;
export function stickyMat() {
  if (!stickyMats) stickyMats = ['#ffe873', '#ff9ec7', '#8de3ff', '#b5f28a', '#ffb870'].map(c => {
    const t = canvasTex(64, 64, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(30,30,60,.7)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(8, 16 + i * 11); for (let x = 8; x < 56; x += 4) g.lineTo(x, 16 + i * 11 + (rnd() - 0.5) * 3); g.stroke(); } });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide });
  });
  return pick(stickyMats);
}

// ---------- models (Poly Haven, CC0) ----------
export const gltf = new GLTFLoader();
const modelCache = {};
function loadModel(id) {
  if (!modelCache[id]) modelCache[id] = gltf.loadAsync(`${A}models/${id}/${id}.gltf`).then(r => { r.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); return r.scene; });
  return modelCache[id];
}
// place(id, x, y, z, rotY, scale, parent, opts): opts.pick = regex of top-level node names to keep (sets with variants);
// the kept nodes are re-centred on x/z. opts.tint = colour multiplier; opts.shadow=false for small props.
export function place(id, x, y, z, rotY = 0, s = 1, parent, opts = {}) {
  const p = loadModel(id).then(src => {
    let o = src.clone();
    if (opts.pick) {
      const keep = o.children.filter(c => opts.pick.test(c.name)); const g = new THREE.Group();
      const ox = keep.length ? keep[0].position.x : 0, oz = keep.length ? keep[0].position.z : 0;
      keep.forEach(c => { c.position.x -= ox; c.position.z -= oz; g.add(c); }); o = g;
    }
    o.position.set(x, y, z); o.rotation.y = rotY; o.scale.setScalar(s);
    if (opts.shadow === false || opts.tint) o.traverse(m => { if (!m.isMesh) return; if (opts.shadow === false) m.castShadow = false; if (opts.tint) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(opts.tint)); } });
    (parent || C.scene).add(o); return o;
  }).catch(e => console.warn('office3d model', id, e));
  C.pending.push(p); return p;
}

// ---------- furniture builders ----------
// screens registered per station for power on/off
export function powerScreen(id, mesh, mat) {
  if (!id) return;
  onPower(id, on => { mesh.material = on ? mat : C.M.screenOff; });
}
export function monitor(parent, x, y, z, rotY, w, h, screenTex, opts = {}) {
  const M = C.M, g = group(parent, x, y, z, rotY);
  rbox(w + 0.02, h + 0.02, 0.025, 0.006, M.plastic, 0, h / 2 + 0.11, -0.005, g);
  rbox(w * 0.5, h * 0.5, 0.04, 0.01, M.plasticGrey, 0, h / 2 + 0.11, -0.035, g, false);
  const mat = screenMat(screenTex, opts.k);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, h - 0.012), mat); s.position.set(0, h / 2 + 0.11, 0.0076); g.add(s);
  powerScreen(opts.id, s, mat);
  box(0.05, 0.16, 0.03, M.alu, 0, 0.08, -0.05, 1, g);
  rbox(0.22, 0.012, 0.17, 0.005, M.alu, 0, 0.006, -0.02, g, false);
  // a status LED on the bezel
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0025, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2, 0.6) })); led.position.set(w / 2 - 0.02, 0.112, 0.008); g.add(led);
  if (opts.id) onPower(opts.id, on => led.material.color.set(on ? new THREE.Color(0.2, 2, 0.6) : new THREE.Color(2, 0.3, 0.1)));
  if (opts.sticky) for (let i = 0; i < opts.sticky; i++) { const st = plane(0.06, 0.06, stickyMat(), (i % 2 ? 1 : -1) * (w / 2 - 0.02) + rr(-0.03, 0.03), h + 0.08 - i * 0.07, 0.009, g); st.rotation.z = rr(-0.2, 0.2); }
  return g;
}
export function laptop(parent, x, y, z, rotY, screenTex, id) {
  const M = C.M, lp = group(parent, x, y, z, rotY);
  rbox(0.33, 0.014, 0.23, 0.005, M.aluDark, 0, 0.007, 0, lp, false);
  const kt = canvasTex(256, 160, (g, w, h) => { g.fillStyle = '#2a2c30'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let r = 0; r < 5; r++) for (let c = 0; c < 13; c++) g.fillRect(10 + c * 18, 10 + r * 18, 15, 15); g.fillStyle = '#1c1d20'; g.fillRect(80, 110, 96, 44); });
  const kb = plane(0.3, 0.2, new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 }), 0, 0.0145, 0.005, lp); kb.rotation.x = -Math.PI / 2;
  const lid = group(lp, 0, 0.014, -0.115); lid.rotation.x = -0.3;
  rbox(0.33, 0.22, 0.006, 0.004, M.aluDark, 0, 0.11, -0.003, lid, false);
  const mat = screenMat(screenTex, 1.2), sc = plane(0.3, 0.19, mat, 0, 0.11, 0.001, lid); powerScreen(id, sc, mat);
  return lp;
}
export function keyboard(parent, x, y, z, rotY) {
  const M = C.M;
  const kt = canvasTex(512, 160, (g, w, h) => { g.fillStyle = '#1a1b1e'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b2d31'; for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) g.fillRect(8 + c * 33, 8 + r * 30, 29, 26); g.fillRect(140, 128, 200, 26); g.fillStyle = 'rgba(255,255,255,.18)'; g.font = '9px Arial'; for (let r = 0; r < 4; r++) for (let c = 0; c < 15; c++) g.fillText('QWERTYUIOPASDFGHJKLZXCVBNM'[(r * 15 + c) % 26], 12 + c * 33, 20 + r * 30); });
  const k = rbox(0.42, 0.018, 0.13, 0.005, new THREE.MeshStandardMaterial({ map: kt, roughness: 0.55 }), x, y + 0.009, z, parent, false); k.rotation.y = rotY;
  const mx = x + Math.cos(rotY) * 0.3, mz = z - Math.sin(rotY) * 0.3;
  const pad = box(0.3, 0.003, 0.24, std(0x16181a, 0.9), mx, y + 0.0015, mz, 1, parent, false); pad.rotation.y = rotY;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), M.plastic); m.scale.set(0.9, 0.45, 1.5); m.position.set(mx, y + 0.014, mz); parent.add(m);
}
export function mug(parent, x, y, z, color = 0xf1eee8, full = true) {
  const mt = std(color, 0.3);
  const c = cyl(0.04, 0.036, 0.095, mt, x, y + 0.048, z, parent, 18, false);
  const hd = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 14), mt); hd.position.set(x + 0.045, y + 0.05, z); parent.add(hd);
  if (full) { const cof = new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), std(0x1d0f07, 0.08)); cof.rotation.x = -Math.PI / 2; cof.position.set(x, y + 0.08, z); parent.add(cof); }
  return c;
}
export function coffeeCup(parent, x, y, z) { // takeaway cup with sleeve and lid
  cyl(0.042, 0.032, 0.13, std(0xf2efe9, 0.6), x, y + 0.065, z, parent, 16, false);
  cyl(0.041, 0.037, 0.045, std(0x8a5a35, 0.85), x, y + 0.07, z, parent, 16, false);
  cyl(0.045, 0.045, 0.012, std(0x1a1a1a, 0.4), x, y + 0.135, z, parent, 16, false);
}
export function can(parent, x, y, z, color = 0x1d8fd6, lying = false) { // energy drink can
  const m = cyl(0.033, 0.033, 0.12, std(color, 0.25, 0.7), x, y + (lying ? 0.033 : 0.06), z, parent, 14, false);
  if (lying) { m.rotation.z = Math.PI / 2; m.rotation.y = rnd() * 3; }
  return m;
}
export function papers(parent, x, y, z, n = 4, spread = 0.4) {
  for (let i = 0; i < n; i++) {
    const mat = rnd() < 0.5 ? C.M.paper : new THREE.MeshStandardMaterial({ map: docTex(Math.floor(rnd() * 1e6), { stamp: rnd() < 0.2 ? 'PAID' : null, chart: rnd() < 0.3 }), roughness: 0.85 });
    const p = box(0.21, 0.0015, 0.297, mat, x + (rnd() - 0.5) * 0.04, y + 0.001 + i * 0.002, z + (rnd() - 0.5) * 0.04, 1, parent, false); p.rotation.y = (rnd() - 0.5) * spread;
  }
}
export function crumpled(parent, x, y, z) { // a crumpled paper ball
  const g = new THREE.IcosahedronGeometry(0.035, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rr(0.7, 1.2), p.getY(i) * rr(0.7, 1.2), p.getZ(i) * rr(0.7, 1.2)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, C.M.paper); m.position.set(x, y + 0.03, z); m.castShadow = false; m.receiveShadow = true; parent.add(m); return m;
}
export function books(parent, x, y, z, n, rotY = 0, lean = false) {
  const cols = [0x6b2a22, 0x1f3550, 0x2f4a33, 0xb88a3a, 0x2a2a2e, 0x7a6a55, 0x8c1f1f, 0x3d3550, 0xd9d2c0, 0x355f6b];
  const g = group(parent, x, y, z, rotY);
  let px = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.022 + rnd() * 0.035, h = 0.17 + rnd() * 0.1, d = 0.13 + rnd() * 0.06;
    const b = box(w, h, d, std(pick(cols), rr(0.55, 0.85)), px + w / 2, h / 2, 0, 1, g, false);
    if (lean && i === n - 1) { b.rotation.z = -0.35; b.position.x += 0.04; b.position.y -= 0.01; }
    px += w + 0.002;
  }
  return g;
}
export function binders(parent, x, y, z, n, rotY = 0) { // office ring binders with spine labels
  const g = group(parent, x, y, z, rotY), cols = [0x1d3c78, 0x0d0d0d, 0x7a1b1b, 0x2e5a3a, 0xdedad0];
  for (let i = 0; i < n; i++) {
    const c = pick(cols), lab = canvasTex(32, 128, (q, w, h) => { q.fillStyle = '#' + new THREE.Color(c).getHexString(); q.fillRect(0, 0, w, h); q.fillStyle = '#efe9da'; q.fillRect(5, 18, 22, 40); q.fillStyle = '#333'; for (let k = 0; k < 4; k++) q.fillRect(8, 24 + k * 8, 14, 2); q.fillStyle = '#ddd'; q.beginPath(); q.arc(16, 100, 6, 0, 7); q.fill(); });
    const mats = [std(c, 0.6), std(c, 0.6), std(c, 0.6), std(c, 0.6), new THREE.MeshStandardMaterial({ map: lab, roughness: 0.6 }), std(c, 0.6)];
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.27), mats); b.position.set(i * 0.064, 0.15, 0); b.castShadow = false; b.receiveShadow = true; if (i === n - 1 && rnd() < 0.5) { b.rotation.z = -0.25; b.position.x += 0.03; } g.add(b);
  }
  return g;
}
export function officeChair(parent, x, z, rotY, o = {}) {
  const M = C.M, g = group(parent, x, 0, z, rotY + (o.exact ? 0 : (rnd() - 0.5) * 0.5));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, leg = box(0.3, 0.035, 0.05, M.alu, Math.cos(a) * 0.15, 0.075, Math.sin(a) * 0.15, 1, g); leg.rotation.y = -a;
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), M.plastic); w.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3); g.add(w);
  }
  cyl(0.025, 0.025, 0.3, M.steelLight, 0, 0.25, 0, g);
  const seat = o.mat || M.leather;
  rbox(0.52, 0.08, 0.5, 0.03, seat, 0, 0.46, 0, g);
  const back = rbox(0.5, 0.62, 0.07, 0.03, seat, 0, 0.86, 0.25, g); back.rotation.x = -0.12;
  box(0.06, 0.4, 0.03, M.steel, 0, 0.62, 0.28, 1, g).rotation.x = -0.12;
  for (const s of [-1, 1]) { box(0.035, 0.2, 0.035, M.steel, s * 0.27, 0.58, 0.02, 1, g); rbox(0.06, 0.03, 0.26, 0.012, M.plastic, s * 0.27, 0.69, 0.02, g); }
  if (o.jacket) jacket(g, o.jacket);
  return g;
}
// A jacket draped over a chair back: a few bent slabs of cloth.
export function jacket(chair, color = 0x2f3a4a) {
  const m = pbr('fabric_pattern_07', { color }); m.map.repeat?.set(2, 2);
  const g = group(chair, 0, 0, 0.27);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.54, 12, 1, false, 0, Math.PI), m); sh.rotation.z = Math.PI / 2; sh.rotation.y = 0; sh.position.set(0, 1.17, 0.02); sh.castShadow = true; g.add(sh);
  const back = box(0.5, 0.5, 0.02, m, 0, 0.93, 0.08, 1, g); back.rotation.x = -0.18;
  const front = box(0.44, 0.38, 0.02, m, 0, 0.98, -0.07, 1, g); front.rotation.x = 0.08;
  for (const s of [-1, 1]) { const sl = cyl(0.045, 0.04, 0.5, m, s * 0.24, 0.9, 0.1, g, 10); sl.rotation.x = -0.15; }
}
export function desk(parent, cx, cz, w, d, rotY, top, h = 0.74, o = {}) {
  const M = C.M, g = group(parent, cx, 0, cz, rotY);
  rbox(w, 0.035, d, 0.008, top || M.oak, 0, h - 0.0175, 0, g);
  for (const s of [-1, 1]) {
    box(0.06, h - 0.035, 0.04, M.steel, s * (w / 2 - 0.08), (h - 0.035) / 2, -d / 2 + 0.07, 1, g);
    box(0.06, h - 0.035, 0.04, M.steel, s * (w / 2 - 0.08), (h - 0.035) / 2, d / 2 - 0.07, 1, g);
    box(0.06, 0.04, d - 0.1, M.steel, s * (w / 2 - 0.08), h - 0.055, 0, 1, g);
    box(0.06, 0.04, d - 0.1, M.steel, s * (w / 2 - 0.08), 0.02, 0, 1, g);
  }
  box(w - 0.2, 0.06, 0.03, M.steel, 0, h - 0.07, -d / 2 + 0.08, 1, g);
  box(w * 0.6, 0.06, 0.12, std(0x222426, 0.6, 0.6), 0, h - 0.13, -d / 2 + 0.12, 1, g, false);
  if (o.drawers) { // a drawer pedestal under one side
    const px = o.drawers * (w / 2 - 0.3);
    rbox(0.42, h - 0.1, d - 0.12, 0.005, std(0x2b2e31, 0.45, 0.6), px, (h - 0.1) / 2 + 0.02, 0.0, g);
    for (let i = 0; i < 3; i++) { box(0.38, 0.005, 0.005, std(0x111111, 0.6), px, 0.2 + i * 0.18, d / 2 - 0.058, 1, g, false); box(0.1, 0.012, 0.012, M.alu, px, 0.25 + i * 0.18, d / 2 - 0.05, 1, g, false); }
  }
  return g;
}
export function powerStrip(parent, x, z, rotY = 0) {
  const g = group(parent, x, 0, z, rotY);
  rbox(0.3, 0.035, 0.06, 0.008, C.M.plasticWhite, 0, 0.0175, 0, g, false);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) })); led.position.set(0.13, 0.036, 0); g.add(led);
  for (let i = 0; i < 3; i++) box(0.035, 0.03, 0.04, C.M.plastic, -0.09 + i * 0.07, 0.045, 0, 1, g, false);
  return g;
}
export function pcTower(parent, x, z, rotY, rgb = 0x6a5cff, id) {
  const M = C.M, g = group(parent, x, 0, z, rotY);
  rbox(0.21, 0.46, 0.45, 0.01, M.plastic, 0, 0.24, 0, g);
  const on = new THREE.MeshStandardMaterial({ color: 0x050507, emissive: rgb, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.38), on);
  glass.rotation.y = Math.PI / 2; glass.position.set(0.106, 0.25, 0); g.add(glass);
  const fans = [];
  for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb).multiplyScalar(3) })); f.position.set(0.0, 0.12 + i * 0.12, 0.226); g.add(f); fans.push(f); }
  if (id) onPower(id, p => { glass.material = p ? on : M.blackGloss; fans.forEach(f => (f.visible = p)); });
  return g;
}
export function bin(parent, x, z, n = 3) { // mesh office bin with crumpled paper
  const g = group(parent, x, 0, z);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.32, 20, 1, true), std(0x202224, 0.5, 0.7, { side: THREE.DoubleSide })); m.position.y = 0.16; m.castShadow = true; m.receiveShadow = true; g.add(m);
  cyl(0.11, 0.11, 0.01, C.M.steel, 0, 0.005, 0, g, 20, false);
  for (let i = 0; i < n; i++) crumpled(g, rr(-0.06, 0.06), 0.2 + i * 0.03, rr(-0.06, 0.06));
  crumpled(g, rr(0.18, 0.28), 0, rr(-0.1, 0.1));
  return g;
}
export function headphones(parent, x, y, z, ry = 0) {
  const g = group(parent, x, y, z, ry), m = std(0x111214, 0.35);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 6, 20, Math.PI), m); band.rotation.x = -Math.PI / 2 + 0.1; band.position.y = 0.035; g.add(band);
  for (const s of [-1, 1]) { const c = cyl(0.045, 0.045, 0.035, m, s * 0.085, 0.035, 0, g, 16, false); c.rotation.z = Math.PI / 2 + s * 0.1; }
  return g;
}
export function pizzaBox(parent, x, y, z, ry = 0, open = false) {
  const g = group(parent, x, y, z, ry);
  const t = canvasTex(256, 256, (q, w, h) => { q.fillStyle = '#d8c7a4'; q.fillRect(0, 0, w, h); q.fillStyle = '#b8261b'; q.beginPath(); q.arc(128, 118, 70, 0, 7); q.fill(); q.fillStyle = '#fff'; q.font = 'bold 30px Georgia'; q.textAlign = 'center'; q.fillText('LUIGI\'S', 128, 128); q.font = '16px Georgia'; q.fillText('hot & fast', 128, 150); q.fillStyle = 'rgba(120,70,20,.25)'; q.beginPath(); q.arc(190, 200, 30, 0, 7); q.fill(); });
  const lidMat = [C.M.cardboard, C.M.cardboard, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), C.M.cardboard, C.M.cardboard, C.M.cardboard];
  box(0.4, 0.04, 0.4, C.M.cardboard, 0, 0.02, 0, 1, g, false);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.006, 0.4), lidMat); lid.castShadow = false; lid.receiveShadow = true;
  if (open) { const hinge = group(g, 0, 0.04, -0.2); hinge.rotation.x = -1.9; lid.position.set(0, 0, 0.2); hinge.add(lid); const pz = cyl(0.17, 0.17, 0.01, std(0xd98b3a, 0.7), 0, 0.045, 0, g, 24, false); pz.scale.set(1, 1, 1); for (let i = 0; i < 9; i++) cyl(0.018, 0.018, 0.006, std(0x9c1f14, 0.5), rr(-0.11, 0.11), 0.052, rr(-0.11, 0.11), g, 10, false); }
  else { lid.position.y = 0.043; g.add(lid); }
  return g;
}
export function backpack(parent, x, z, ry = 0, color = 0x24303a) {
  const g = group(parent, x, 0, z, ry), m = pbr('fabric_pattern_07', { color });
  rbox(0.3, 0.42, 0.18, 0.07, m, 0, 0.21, 0, g);
  rbox(0.24, 0.18, 0.06, 0.04, m, 0, 0.16, 0.11, g);
  g.rotation.x = -0.12; return g;
}
// Additive light cone / shaft (fake volumetrics). Soft at the silhouette (fresnel) and fading with distance from the apex.
const haze = [];
export const hazeMats = haze;
export function hazeMaterial(color, strength = 0.5, o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength }, time: { value: 0 }, len: { value: o.len || 2 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL; varying vec3 vW;
      void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 color; uniform float strength, time, len; varying vec3 vN; varying vec3 vV; varying vec3 vL; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = clamp(-vL.y / len, 0.0, 1.0);           // 0 at the apex, 1 at the far end (geometry hangs down -y)
        float fall = (1.0 - along) * (1.0 - along) * smoothstep(0.0, 0.08, along);
        float dust = 0.65 + 0.7 * n3(vW * 2.2 + vec3(0.0, time * 0.05, time * 0.03));
        gl_FragColor = vec4(color * strength * edge * fall * dust, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  haze.push(m); return m;
}
export function lightCone(parent, x, y, z, rTop, rBot, len, color, strength) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 32, 1, true); g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, hazeMaterial(color, strength, { len })); m.position.set(x, y, z); m.renderOrder = 10; m.userData.noAO = true; m.castShadow = false; m.receiveShadow = false;
  (parent || C.scene).add(m); return m;
}
