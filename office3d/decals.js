// Decals: coffee rings, hand grease, scratches, rubber scuffs, caster arcs and dust, stuck onto whatever surface a
// ray finds (desk tops, floor, walls, the safe door). One atlas, one material: after the static merge they draw in one call.
import * as THREE from 'three';
import { C, canvasTex, rr, rnd } from './kit.js';

let mat = null;
function atlas() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cell = (i, f) => { g.save(); g.translate((i % 4) * 256 + 128, Math.floor(i / 4) * 256 + 128); f(); g.restore(); };
    const ring = (r, a, lw) => { g.strokeStyle = `rgba(70,38,16,${a})`; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, rr(0, 1), 6.283 - rr(0, 1.2)); g.stroke();
      g.strokeStyle = `rgba(70,38,16,${a * 0.35})`; g.lineWidth = lw * 3; g.beginPath(); g.arc(0, 0, r - lw, 0, 6.283); g.stroke(); };
    cell(0, () => ring(78, 0.55, 5));                                                            // coffee ring
    cell(1, () => { ring(70, 0.5, 4); g.translate(38, 26); ring(66, 0.32, 4); });                // overlapping rings
    cell(2, () => { for (let i = 0; i < 9; i++) { const gr = g.createRadialGradient(rr(-50, 50), rr(-50, 50), 0, 0, 0, rr(30, 90)); gr.addColorStop(0, 'rgba(92,58,28,.35)'); gr.addColorStop(1, 'rgba(92,58,28,0)'); g.fillStyle = gr; g.fillRect(-128, -128, 256, 256); } }); // dried spill
    cell(3, () => { for (let i = 0; i < 26; i++) { const x = rr(-90, 90), y = rr(-50, 50), gr = g.createRadialGradient(x, y, 0, x, y, rr(14, 40)); gr.addColorStop(0, 'rgba(20,16,12,.16)'); gr.addColorStop(1, 'rgba(20,16,12,0)'); g.fillStyle = gr; g.fillRect(-128, -128, 256, 256); } }); // hand grease
    cell(4, () => { g.lineCap = 'round'; for (let i = 0; i < 70; i++) { const x = rr(-110, 110), y = rr(-110, 110), a = rr(-0.4, 0.4), l = rr(10, 70); g.strokeStyle = `rgba(235,225,210,${rr(0.15, 0.45)})`; g.lineWidth = rr(0.6, 1.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }); // scratches
    cell(5, () => { g.lineCap = 'round'; for (let i = 0; i < 14; i++) { const x = rr(-90, 90), y = rr(-90, 90), a = rr(0, 6.28), l = rr(14, 60); g.strokeStyle = `rgba(12,12,12,${rr(0.25, 0.6)})`; g.lineWidth = rr(2, 6); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rr(-8, 8), y + Math.sin(a) * l * 0.5 + rr(-8, 8), x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }); // rubber scuffs
    cell(6, () => { for (let i = 0; i < 40; i++) { const x = rr(-100, 100), y = rr(-100, 100), gr = g.createRadialGradient(x, y, 0, x, y, rr(20, 60)); gr.addColorStop(0, 'rgba(150,140,125,.10)'); gr.addColorStop(1, 'rgba(150,140,125,0)'); g.fillStyle = gr; g.fillRect(-128, -128, 256, 256); } }); // dust
    cell(7, () => { g.strokeStyle = 'rgba(60,50,40,.35)'; g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, 100, 84, 0.3, 0, 6.283); g.stroke(); const gr = g.createRadialGradient(0, 0, 40, 0, 0, 100); gr.addColorStop(0, 'rgba(60,50,40,0)'); gr.addColorStop(1, 'rgba(60,50,40,.18)'); g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 100, 84, 0.3, 0, 6.283); g.fill(); }); // water stain
    cell(8, () => { for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(20,30,70,${rr(0.2, 0.6)})`; g.beginPath(); g.arc(rr(-80, 80), rr(-80, 80), rr(1, 4), 0, 7); g.fill(); } g.strokeStyle = 'rgba(20,30,70,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-60, 40); g.bezierCurveTo(-20, -10, 20, 60, 70, 10); g.stroke(); }); // ink
    cell(9, () => { g.lineCap = 'round'; for (let k = 0; k < 5; k++) { const a0 = k / 5 * 6.283; g.strokeStyle = `rgba(14,14,14,${rr(0.18, 0.34)})`; g.lineWidth = rr(3, 5); g.beginPath(); g.arc(rr(-6, 6), rr(-6, 6), rr(92, 108), a0 - 0.6, a0 + 0.6); g.stroke(); } }); // caster arcs
    cell(10, () => { const gr = g.createRadialGradient(0, 0, 10, 0, 0, 120); gr.addColorStop(0, 'rgba(255,245,230,.10)'); gr.addColorStop(0.6, 'rgba(255,245,230,.05)'); gr.addColorStop(1, 'rgba(255,245,230,0)'); g.fillStyle = gr; g.fillRect(-128, -128, 256, 256); for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(240,235,225,${rr(0.05, 0.15)})`; g.lineWidth = 1; const x = rr(-90, 90), y = rr(-90, 90); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-30, 30), y + rr(-6, 6)); g.stroke(); } }); // walked-on wear
    cell(11, () => { g.fillStyle = 'rgba(200,190,150,.28)'; g.fillRect(-70, -18, 140, 36); g.fillStyle = 'rgba(40,36,30,.18)'; g.fillRect(-70, -18, 140, 3); g.fillRect(-70, 15, 140, 3); }); // tape residue
  });
}
export function decalMaterial() {
  if (mat) return mat;
  mat = new THREE.MeshStandardMaterial({ map: atlas(), transparent: true, depthWrite: false, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.name = 'decal'; return mat;
}
const KIND = { ring: 0, rings: 1, spill: 2, grease: 3, scratch: 4, scuff: 5, dust: 6, water: 7, ink: 8, caster: 9, wear: 10, tape: 11 };
const ray = new THREE.Raycaster();
// stick a decal where a ray from `from` along `dir` first hits solid geometry; size in metres
export function stick(scene, kind, from, dir, size, rot = rnd() * 6.283, opts = {}) {
  ray.set(from, dir.clone().normalize()); ray.far = opts.far || 2.5;
  const hit = ray.intersectObjects(scene.children, true).find(h => h.object.isMesh && !h.object.isSkinnedMesh && h.face && h.object.visible && !(h.object.material?.transparent) && !h.object.userData.proxy && h.object.name !== 'robot' && !/nib/.test(h.object.name || '') && !isRobot(h.object));
  if (!hit) return null;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); if (n.dot(ray.ray.direction) > 0) n.negate();
  if (opts.flat && n.y < 0.9) return null;
  const k = KIND[kind] ?? 0, u0 = (k % 4) / 4, v0 = 1 - (Math.floor(k / 4) + 1) / 4;
  const g = new THREE.PlaneGeometry(size, size * (opts.aspect || 1)); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4, v0 + uv.getY(i) / 4);
  const m = new THREE.Mesh(g, decalMaterial()); m.position.copy(hit.point).addScaledVector(n, 0.0015);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); m.rotateZ(rot);
  m.receiveShadow = true; m.castShadow = false; m.userData.noAO = true; m.userData.decal = true; m.renderOrder = 1; m.name = 'decal_' + kind;
  scene.add(m); return m;
}
function isRobot(o) { for (let p = o; p; p = p.parent) if (p.name === 'robot' || p.name === 'nib') return true; return false; }
export function placeDecals(scene, use, chairs) {
  const down = new THREE.Vector3(0, -1, 0), V = (x, y, z) => new THREE.Vector3(x, y, z);
  let n = 0; const s = (...a) => { if (stick(scene, ...a)) n++; };
  for (const id in use) {
    const u = use[id], f = V(Math.sin(u.spot[2]), 0, Math.cos(u.spot[2])), side = V(f.z, 0, -f.x), p = V(u.spot[0], 0, u.spot[1]);
    // floor: worn patch where the robot stands or sits, a few rubber scuffs
    s('wear', p.clone().setY(0.08), down, 0.9, undefined, { flat: true });
    s('scuff', p.clone().addScaledVector(side, rr(-0.3, 0.3)).addScaledVector(f, -0.2).setY(0.08), down, 0.5, undefined, { flat: true });
    if (id === 'lounge' || id === 'rig' || id === 'stats') continue;
    // work surface: grease where the hands rest, a ring or two, scratches
    const desk = (fw, sw) => p.clone().addScaledVector(f, fw).addScaledVector(side, sw).setY(1.25);
    s('grease', desk(0.5, rr(-0.1, 0.1)), down, 0.42, rr(-0.2, 0.2), { flat: true, aspect: 0.5 });
    s(rnd() < 0.5 ? 'ring' : 'rings', desk(0.6, (rnd() < 0.5 ? -1 : 1) * rr(0.45, 0.6)), down, 0.11, undefined, { flat: true });
    s('scratch', desk(0.62, rr(-0.3, 0.3)), down, 0.35, undefined, { flat: true });
    if (rnd() < 0.6) s('spill', desk(0.7, rr(-0.5, 0.5)), down, 0.22, undefined, { flat: true });
    if (id === 'forge') { s('ink', desk(0.5, 0.3), down, 0.25, undefined, { flat: true }); s('scratch', desk(0.45, -0.35), down, 0.4, undefined, { flat: true }); s('spill', desk(0.6, 0.0), down, 0.3, undefined, { flat: true }); }
  }
  // swivel chairs: caster arcs on the floor at both of their spots
  for (const id in chairs || {}) { const c = chairs[id]; for (const q of [c.park, c.sit]) s('caster', V(q[0], 0.08, q[1]), down, 0.62, undefined, { flat: true }); }
  // traffic lanes: wear and dust across the main floor, scuffs near the door
  for (let i = 0; i < 26; i++) s(rnd() < 0.55 ? 'wear' : rnd() < 0.5 ? 'scuff' : 'dust', V(rr(3.0, 12.5), 0.08, rr(4.2, 7.6)), down, rr(0.5, 1.1), undefined, { flat: true });
  for (let i = 0; i < 10; i++) s('dust', V(rr(1.2, 13.8), 0.08, rr(1.2, 10.0)), down, rr(0.6, 1.0), undefined, { flat: true });
  // the safe: grease around the dial and the handle wheel
  return n;
}
