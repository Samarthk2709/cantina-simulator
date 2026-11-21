// Small lived-in clutter on the desks and under them: pens and pen cups, sticky pads, phones, headphones, cans,
// snack packets, crumpled paper, cable coils, power strips, a backpack. All procedural with plain shared materials, so
// the static merge folds them into existing batches (near-zero extra draw calls). Placed by ray onto real surfaces.
import * as THREE from 'three';
import { C, box, rbox, cyl, group, std, rr, rnd } from './kit.js';

const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0);
function surface(scene, x, z, lo, hi) {
  ray.set(new THREE.Vector3(x, hi + 0.3, z), DOWN); ray.far = hi - lo + 0.4;
  const h = ray.intersectObjects(scene.children, true).find(h => h.object.isMesh && h.object.visible && !h.object.material?.transparent && !isRobot(h.object));
  if (!h || h.point.y < lo || h.point.y > hi) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.y < 0.95) return null;
  const g = h.object.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox.clone().applyMatrix4(h.object.matrixWorld);
  if (bb.max.x - bb.min.x < 0.5 && bb.max.z - bb.min.z < 0.5) return null; // only on big slabs (desk tops, floor), never on top of another prop
  return h.point.y;
}
function isRobot(o) { for (let p = o; p; p = p.parent) if (p.name === 'robot' || p.name === 'nib') return true; return false; }
const M = () => ({
  black: std(0x18191b, 0.5), white: std(0xe8e6df, 0.5), red: std(0xb3261e, 0.5), blue: std(0x2a5d9c, 0.5), green: std(0x2f7d4a, 0.5), yellow: std(0xf3d34a, 0.5),
  pink: std(0xff8fbf, 0.5), steel: C.M.alu, paper: std(0xf1eee6, 0.5), kraft: std(0xb08a5c, 0.5), orange: std(0xe0662a, 0.5), teal: std(0x2aa198, 0.5),
});
const ITEMS = {
  penCup(p, m) { cyl(0.035, 0.03, 0.1, m.black, 0, 0.05, 0, p, 14, false); for (let i = 0; i < 4; i++) { const pen = cyl(0.004, 0.004, 0.14, [m.blue, m.red, m.black, m.yellow][i], rr(-0.015, 0.015), 0.12, rr(-0.015, 0.015), p, 6, false); pen.rotation.set(rr(-0.25, 0.25), 0, rr(-0.25, 0.25)); } },
  pens(p, m) { for (let i = 0; i < 2; i++) { const pen = cyl(0.004, 0.004, 0.14, [m.blue, m.red][i], i * 0.03, 0.004, 0, p, 6, false); pen.rotation.set(0, rr(0, 3), Math.PI / 2); } },
  sticky(p, m) { box(0.076, 0.012, 0.076, rnd() < 0.5 ? m.yellow : m.pink, 0, 0.006, 0, 1, p, false); },
  phone(p, m) { rbox(0.075, 0.009, 0.155, 0.008, m.black, 0, 0.0045, 0, p, false); },
  headphones(p, m) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 20, Math.PI), m.black); t.rotation.x = -Math.PI / 2 + 0.25; t.position.y = 0.03; p.add(t); for (const s of [-1, 1]) cyl(0.04, 0.04, 0.03, m.black, s * 0.085, 0.022, 0, p, 14, false).rotation.z = Math.PI / 2; },
  can(p, m) { cyl(0.033, 0.033, 0.12, rnd() < 0.5 ? m.green : m.orange, 0, 0.06, 0, p, 14, false); cyl(0.03, 0.03, 0.004, m.steel, 0, 0.122, 0, p, 14, false); },
  canDown(p, m) { const c = cyl(0.033, 0.033, 0.12, m.red, 0, 0.033, 0, p, 14, false); c.rotation.z = Math.PI / 2; },
  snack(p, m) { const b = rbox(0.13, 0.025, 0.18, 0.012, rnd() < 0.5 ? m.orange : m.teal, 0, 0.0125, 0, p, false); b.rotation.y = rr(-0.4, 0.4); },
  paperBall(p, m) { for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), m.paper); b.position.set(i * 0.06, 0.026, rr(-0.03, 0.03)); b.rotation.set(rr(0, 3), rr(0, 3), 0); p.add(b); } },
  notebook(p, m) { box(0.15, 0.015, 0.21, rnd() < 0.5 ? m.blue : m.black, 0, 0.0075, 0, 1, p, false); box(0.14, 0.012, 0.2, m.paper, 0.004, 0.008, 0, 1, p, false); },
  coil(p, m) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 24), m.black); t.rotation.x = Math.PI / 2; t.position.y = 0.006; p.add(t); const t2 = t.clone(); t2.scale.setScalar(0.8); t2.position.y = 0.014; p.add(t2); },
  usb(p, m) { box(0.05, 0.012, 0.018, m.steel, 0, 0.006, 0, 1, p, false); box(0.02, 0.012, 0.02, m.black, 0.032, 0.006, 0, 1, p, false); },
  // floor
  strip(p, m) { rbox(0.32, 0.045, 0.06, 0.01, m.white, 0, 0.0225, 0, p, false); for (let i = 0; i < 3; i++) box(0.03, 0.03, 0.035, m.black, -0.08 + i * 0.08, 0.06, 0, 1, p, false); const c = cyl(0.005, 0.005, 0.8, m.black, 0.55, 0.006, 0, p, 6, false); c.rotation.z = Math.PI / 2; },
  backpack(p, m) { rbox(0.32, 0.42, 0.18, 0.06, m.black, 0, 0.21, 0, p); rbox(0.24, 0.16, 0.06, 0.03, m.black, 0, 0.14, 0.11, p, false); box(0.26, 0.02, 0.02, m.red, 0, 0.3, 0.095, 1, p, false); },
  boxes(p, m) { box(0.34, 0.24, 0.28, m.kraft, 0, 0.12, 0, 1, p); box(0.26, 0.16, 0.22, m.kraft, 0.03, 0.32, 0.01, 1, p).rotation.y = 0.3; },
  shoes(p, m) { for (const s of [-1, 1]) rbox(0.1, 0.08, 0.27, 0.03, m.white, s * 0.07, 0.04, rr(-0.03, 0.03), p, false).rotation.y = rr(-0.2, 0.2); },
  cable(p, m) { const c = cyl(0.005, 0.005, 1.2, m.black, 0, 0.005, 0, p, 6, false); c.rotation.z = Math.PI / 2; },
};
export function placeClutter(scene, use) {
  const m = M(), V = (x, z) => new THREE.Vector3(x, 0, z); let n = 0;
  const put = (kind, x, z, lo, hi, ry = rr(0, 6.28)) => { const y = surface(scene, x, z, lo, hi); if (y === null) return; const g = group(scene, x, y + 0.001, z, ry); g.name = 'clutter_' + kind; ITEMS[kind](g, m); n++; };
  const desks = { hunt: ['penCup', 'sticky', 'phone', 'can', 'paperBall', 'notebook', 'usb', 'headphones'], contract: ['penCup', 'sticky', 'snack', 'pens', 'can', 'coil'], training: ['pens', 'sticky', 'canDown', 'paperBall', 'notebook'], forge: ['coil', 'usb', 'can', 'pens', 'paperBall', 'sticky'], hq: ['sticky', 'phone'] };
  for (const id in desks) {
    const u = use[id]; if (!u) continue; const f = V(Math.sin(u.spot[2]), Math.cos(u.spot[2])), sd = V(f.z, -f.x), p = V(u.spot[0], u.spot[1]);
    // far from where the hands work: the outer ends and the back of the desk
    const slots = [[0.62, 0.8], [0.62, -0.8], [0.78, 0.55], [0.78, -0.55], [0.7, 0.98], [0.7, -0.98], [0.85, 0.2], [0.85, -0.25]];
    desks[id].forEach((k, i) => { const s = slots[i % slots.length], q = p.clone().addScaledVector(f, s[0]).addScaledVector(sd, s[1] + rr(-0.05, 0.05)); put(k, q.x, q.z, 0.6, 1.05); });
    // under the desk, against the back
    const uq = p.clone().addScaledVector(f, 0.85).addScaledVector(sd, rr(-0.3, 0.3)); put(id === 'forge' ? 'boxes' : 'strip', uq.x, uq.z, -0.01, 0.03, Math.atan2(sd.x, sd.z) + Math.PI / 2);
  }
  // floor: a backpack by the founder's desk, shoes by the sofa, cable runs, boxes in the corner
  const hu = use.hunt; if (hu) { put('backpack', hu.spot[0] + 1.25, hu.spot[1] - 0.95, -0.01, 0.03, 0.4); }
  put('shoes', 4.55, 9.35, -0.01, 0.03, 0.2);
  put('cable', 9.2, 3.4, -0.01, 0.03, 0.1); put('cable', 3.6, 3.9, -0.01, 0.03, 1.4);
  put('boxes', 13.6, 4.4, -0.01, 0.03, 0.2); put('paperBall', 8.3, 4.2, -0.01, 0.03);
  C.clutter = n; return n;
}
