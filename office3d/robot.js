// First Office 3D: the founder robot ("FO-1"). An original stylised humanoid robot built in code from bevelled parts:
// painted ivory shell with orange accents, graphite joints, ribbed rubber bellows at the neck and waist, a black glass
// visor with emissive eyes, panel seams and screw heads. All parts are merged into ONE rigidly-skinned mesh (each part
// follows one bone) with a palette material, so the whole character is a single draw call per pass.
// Animation is procedural: a pose is a set of joint angles; poses blend smoothly every frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- palette material ----------
// Each part carries a material id in its UV; tiny palette textures give colour, roughness/metalness and emission.
const PAL = { ivory: 0, orange: 1, graphite: 2, rubber: 3, visor: 4, chrome: 5, eye: 6, seam: 7, led: 8, sole: 9, ivoryDark: 10 };
const N = 16;
function palette() {
  const col = new Uint8Array(N * 4), orm = new Uint8Array(N * 4), em = new Uint8Array(N * 4);
  const set = (id, hex, rough, metal, emHex = 0) => {
    const c = new THREE.Color(hex); col.set([c.r * 255, c.g * 255, c.b * 255, 255], id * 4);
    orm.set([255, rough * 255, metal * 255, 255], id * 4);
    const e = new THREE.Color(emHex); em.set([e.r * 255, e.g * 255, e.b * 255, 255], id * 4);
  };
  set(PAL.ivory, 0xe6e0d4, 0.34, 0.0);
  set(PAL.ivoryDark, 0xc9c2b4, 0.4, 0.0);
  set(PAL.orange, 0xd4561f, 0.32, 0.0);
  set(PAL.graphite, 0x34373c, 0.38, 0.75);
  set(PAL.rubber, 0x161719, 0.82, 0.0);
  set(PAL.visor, 0x07090c, 0.06, 0.2);
  set(PAL.chrome, 0xb8bcc2, 0.22, 1.0);
  set(PAL.eye, 0x0a1214, 0.3, 0.0, 0x9ff6ff);
  set(PAL.seam, 0x15171a, 0.7, 0.3);
  set(PAL.led, 0x0a0a0a, 0.4, 0.0, 0xffa040);
  set(PAL.sole, 0x101112, 0.9, 0.0);
  const tex = (data, srgb) => { const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const m = new THREE.MeshPhysicalMaterial({
    map: tex(col, true), roughnessMap: tex(orm), metalnessMap: tex(orm), emissiveMap: tex(em, true), emissive: 0xffffff, emissiveIntensity: 2.2,
    roughness: 1, metalness: 1, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 1.0, sheen: 0.0,
  });
  m.name = 'robot-palette';
  return m;
}

// ---------- skeleton (rest pose: standing, arms hanging) ----------
const BONES = [
  // name, parent, x, y, z (offset from parent)
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.86, 0], ['spine', 'hips', 0, 0.09, 0], ['chest', 'spine', 0, 0.12, 0],
  ['neck', 'chest', 0, 0.3, 0], ['head', 'neck', 0, 0.065, 0], ['eyes', 'head', 0, 0.13, 0.158],
  ['lSh', 'chest', 0.218, 0.235, 0], ['lEl', 'lSh', 0, -0.27, 0], ['lWr', 'lEl', 0, -0.245, 0], ['lFi', 'lWr', 0, -0.085, 0.0],
  ['rSh', 'chest', -0.218, 0.235, 0], ['rEl', 'rSh', 0, -0.27, 0], ['rWr', 'rEl', 0, -0.245, 0], ['rFi', 'rWr', 0, -0.085, 0.0],
  ['lHip', 'hips', 0.1, -0.03, 0], ['lKn', 'lHip', 0, -0.37, 0], ['lAn', 'lKn', 0, -0.38, 0],
  ['rHip', 'hips', -0.1, -0.03, 0], ['rKn', 'rHip', 0, -0.37, 0], ['rAn', 'rKn', 0, -0.38, 0],
];

export function buildRobot() {
  const bones = {}, list = [];
  for (const [n, p, x, y, z] of BONES) { const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z); (p ? bones[p] : null)?.add(b); bones[n] = b; list.push(b); }
  bones.root.updateMatrixWorld(true);
  const parts = [];
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
  // add a part: geometry placed relative to its bone's rest frame
  function part(bone, geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let g = geo;
    if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
    g = g.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    tmpQ.setFromEuler(new THREE.Euler(rx, ry, rz)); tmpS.set(sx, sy, sz);
    tmpM.compose(new THREE.Vector3(px, py, pz), tmpQ, tmpS);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bones[bone].matrixWorld, tmpM));
    const n = g.attributes.position.count, bi = list.indexOf(bones[bone]);
    const uv = new Float32Array(n * 2), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { uv[i * 2] = (mat + 0.5) / N; uv[i * 2 + 1] = 0.5; si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  }
  const P = PAL;
  const rb = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const cap = (r, l, seg = 16) => new THREE.CapsuleGeometry(r, l, 6, seg);
  const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
  const cyl = (rt, rbt, h, seg = 20) => new THREE.CylinderGeometry(rt, rbt, h, seg);
  const tor = (r, t, seg = 24) => new THREE.TorusGeometry(r, t, 8, seg);
  const screw = (bone, x, y, z, rx = 0, ry = 0) => part(bone, cyl(0.006, 0.006, 0.004, 8), P.chrome, x, y, z, rx + Math.PI / 2, ry, 0);

  // --- head ---
  part('head', rb(0.3, 0.26, 0.28, 0.095, 4), P.ivory, 0, 0.12, 0);
  part('head', rb(0.312, 0.018, 0.29, 0.009), P.seam, 0, 0.055, 0);           // seam band around the head
  part('head', rb(0.06, 0.03, 0.2, 0.012), P.orange, 0, 0.255, -0.02);         // crest ridge
  part('head', rb(0.258, 0.135, 0.05, 0.035, 4), P.visor, 0, 0.13, 0.125);     // glass visor
  part('head', rb(0.272, 0.149, 0.04, 0.04, 4), P.graphite, 0, 0.13, 0.115);   // visor bezel
  for (const s of [-1, 1]) {
    part('head', cyl(0.055, 0.055, 0.03, 24), P.graphite, s * 0.158, 0.12, 0, 0, 0, Math.PI / 2); // ear pods
    part('head', tor(0.045, 0.007), P.orange, s * 0.175, 0.12, 0, 0, Math.PI / 2, 0);
    part('head', cyl(0.022, 0.022, 0.012, 16), P.chrome, s * 0.176, 0.12, 0, 0, 0, Math.PI / 2);
  }
  part('head', cyl(0.004, 0.004, 0.12, 6), P.graphite, 0.17, 0.22, -0.03, 0, 0, -0.25); // antenna
  part('head', sph(0.012, 10, 8), P.led, 0.185, 0.28, -0.03);
  for (const [x, y] of [[-0.11, 0.21], [0.11, 0.21]]) screw('head', x, y, 0.13);
  // eyes (own bone, so they can blink / glance)
  for (const s of [-1, 1]) part('eyes', rb(0.05, 0.034, 0.012, 0.016), P.eye, s * 0.052, 0, 0.0);
  part('eyes', rb(0.04, 0.006, 0.01, 0.003), P.eye, 0, -0.045, 0.0); // a small mouth line

  // --- neck: ribbed rubber bellows ---
  for (let i = 0; i < 4; i++) part('neck', tor(0.05 - i * 0.002, 0.014, 20), P.rubber, 0, 0.0 + i * 0.018, 0, Math.PI / 2, 0, 0);
  part('neck', cyl(0.035, 0.035, 0.08, 14), P.graphite, 0, 0.03, 0);

  // --- chest / torso ---
  part('chest', rb(0.38, 0.3, 0.25, 0.085, 4), P.ivory, 0, 0.15, 0);
  part('chest', rb(0.26, 0.17, 0.03, 0.03), P.ivoryDark, 0, 0.17, 0.118);           // chest plate
  part('chest', rb(0.27, 0.006, 0.032, 0.003), P.seam, 0, 0.262, 0.118);             // plate seams
  part('chest', rb(0.006, 0.16, 0.034, 0.003), P.seam, 0, 0.17, 0.12);
  part('chest', rb(0.08, 0.02, 0.02, 0.008), P.led, 0.07, 0.11, 0.135);              // status light bar
  part('chest', rb(0.05, 0.02, 0.02, 0.008), P.orange, -0.08, 0.11, 0.135);
  for (const [x, y] of [[-0.115, 0.24], [0.115, 0.24], [-0.115, 0.1], [0.115, 0.1]]) screw('chest', x, y, 0.134);
  for (const s of [-1, 1]) { part('chest', rb(0.045, 0.22, 0.17, 0.02), P.orange, s * 0.19, 0.14, 0); part('chest', rb(0.006, 0.2, 0.18, 0.003), P.seam, s * 0.168, 0.14, 0); }
  part('chest', rb(0.28, 0.26, 0.11, 0.035), P.graphite, 0, 0.16, -0.15);            // back pack
  for (let i = 0; i < 5; i++) part('chest', rb(0.2, 0.012, 0.02, 0.005), P.seam, 0, 0.08 + i * 0.035, -0.205);
  part('chest', rb(0.03, 0.03, 0.015, 0.008), P.led, 0.1, 0.25, -0.205);
  part('chest', rb(0.3, 0.06, 0.2, 0.03), P.graphite, 0, -0.005, 0);                // lower ribcage ring
  // --- waist bellows + pelvis ---
  for (let i = 0; i < 4; i++) part('spine', tor(0.095 - (i % 2) * 0.006, 0.018, 24), P.rubber, 0, 0.0 + i * 0.028, 0, Math.PI / 2, 0, 0);
  part('hips', rb(0.32, 0.13, 0.21, 0.05), P.graphite, 0, 0.0, 0);
  part('hips', rb(0.33, 0.025, 0.215, 0.01), P.orange, 0, 0.05, 0);
  part('hips', rb(0.12, 0.08, 0.04, 0.02), P.ivoryDark, 0, -0.01, 0.105);
  for (const s of [-1, 1]) screw('hips', s * 0.045, -0.01, 0.126);

  // --- arms ---
  for (const [sd, s] of [['l', 1], ['r', -1]]) {
    const sh = sd + 'Sh', el = sd + 'El', wr = sd + 'Wr', fi = sd + 'Fi';
    part(sh, sph(0.068), P.graphite, 0, 0, 0);
    part(sh, new THREE.SphereGeometry(0.088, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), P.ivory, s * 0.01, 0.0, 0, 0, 0, -s * 0.35); // shoulder pad
    part(sh, tor(0.072, 0.008), P.orange, s * 0.02, -0.02, 0, Math.PI / 2, 0, -s * 0.35);
    part(sh, cap(0.047, 0.15), P.ivory, 0, -0.145, 0);
    part(sh, tor(0.05, 0.006), P.seam, 0, -0.07, 0, Math.PI / 2, 0, 0);
    part(el, sph(0.047, 16, 12), P.rubber, 0, 0, 0);
    part(el, new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), P.graphite, 0, 0, -0.008, -Math.PI / 2 - 0.3, 0, 0); // elbow cap (back)
    part(el, cap(0.05, 0.13), P.ivory, 0, -0.125, 0, 0, 0, 0, 1, 1, 0.95);
    part(el, cyl(0.054, 0.05, 0.045, 20), P.orange, 0, -0.2, 0);                 // cuff
    part(el, rb(0.035, 0.07, 0.012, 0.006), P.graphite, s * 0.0, -0.11, 0.05);    // forearm panel
    part(wr, sph(0.03, 12, 10), P.graphite, 0, 0, 0);
    part(wr, rb(0.085, 0.085, 0.038, 0.016), P.graphite, 0, -0.045, 0.0);       // palm
    part(wr, rb(0.06, 0.03, 0.04, 0.012), P.ivory, 0, -0.03, 0.0, 0, 0, 0);    // back-of-hand plate
    part(wr, cap(0.013, 0.04, 8), P.rubber, s * 0.048, -0.045, 0.018, 0.3, 0, s * 0.6); // thumb
    for (let k = 0; k < 4; k++) { const fx = (k - 1.5) * 0.021; part(fi, cap(0.0095, 0.045, 8), P.rubber, fx, -0.025, 0.0); part(fi, sph(0.011, 8, 6), P.graphite, fx, 0.0, 0.0); }
  }
  // --- legs ---
  for (const [sd, s] of [['l', 1], ['r', -1]]) {
    const hp = sd + 'Hip', kn = sd + 'Kn', an = sd + 'An';
    part(hp, sph(0.064), P.graphite, 0, 0, 0);
    part(hp, cap(0.064, 0.2), P.ivory, 0, -0.19, 0);
    part(hp, tor(0.066, 0.006), P.seam, 0, -0.11, 0, Math.PI / 2, 0, 0);
    part(hp, rb(0.05, 0.12, 0.02, 0.008), P.orange, s * 0.06, -0.19, 0.0, 0, Math.PI / 2, 0);
    part(kn, sph(0.056, 16, 12), P.rubber, 0, 0, 0);
    part(kn, rb(0.08, 0.075, 0.04, 0.018), P.orange, 0, 0.0, 0.05);             // kneecap
    part(kn, cap(0.058, 0.22), P.ivory, 0, -0.19, 0, 0, 0, 0, 1, 1, 0.95);
    part(kn, rb(0.07, 0.2, 0.035, 0.015), P.graphite, 0, -0.18, 0.052);         // shin guard
    part(kn, tor(0.06, 0.006), P.seam, 0, -0.3, 0, Math.PI / 2, 0, 0);
    part(an, sph(0.045, 14, 10), P.graphite, 0, 0, 0);
    part(an, rb(0.115, 0.07, 0.25, 0.03), P.graphite, 0, -0.035, 0.045);        // boot
    part(an, rb(0.12, 0.018, 0.26, 0.009), P.sole, 0, -0.072, 0.045);           // sole
    part(an, rb(0.105, 0.05, 0.06, 0.022), P.orange, 0, -0.03, 0.15);           // toe cap
    part(an, rb(0.09, 0.03, 0.1, 0.012), P.ivory, 0, 0.005, 0.0);               // ankle cuff
  }

  const geo = mergeGeometries(parts, false); geo.computeBoundingSphere();
  const mat = palette();
  const mesh = new THREE.SkinnedMesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'founder-robot';
  mesh.add(bones.root); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  // glass visor shell over the eyes (reflects the room), and printed decals (emblem, unit number, warning chevrons)
  const visor = new THREE.Mesh(new RoundedBoxGeometry(0.262, 0.139, 0.012, 3, 0.006), new THREE.MeshPhysicalMaterial({ color: 0x0b1014, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.38, envMapIntensity: 2.2, depthWrite: false }));
  visor.position.set(0, 0.13, 0.166); visor.renderOrder = 2; visor.userData.noAO = true; bones.head.add(visor);
  const decal = new THREE.CanvasTexture((() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = '#1b1d21'; g.font = 'bold 44px Arial, sans-serif'; g.fillText('FO-1', 10, 52); g.font = 'bold 13px Arial'; g.fillText('FIRST OFFICE · UNIT 01', 12, 74);
    g.fillStyle = '#d4561f'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(150 + i * 18, 92); g.lineTo(160 + i * 18, 92); g.lineTo(150 + i * 18, 118); g.lineTo(140 + i * 18, 118); g.fill(); }
    g.strokeStyle = '#1b1d21'; g.lineWidth = 3; g.beginPath(); g.arc(214, 40, 26, 0, 7); g.stroke(); g.beginPath(); g.arc(214, 40, 10, 0, 7); g.fill();
    g.fillStyle = '#1b1d21'; g.font = 'bold 22px Arial'; g.fillText('01', 18, 112);
    return c;
  })());
  decal.colorSpace = THREE.SRGBColorSpace; decal.anisotropy = 4;
  const dm = new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const dec = (bone, w, h, u0, v0, u1, v1, x, y, z, ry = 0) => { const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); const m = new THREE.Mesh(geo, dm); m.position.set(x, y, z); m.rotation.y = ry; m.userData.noAO = true; m.renderOrder = 1; bones[bone].add(m); };
  dec('chest', 0.11, 0.05, 0.0, 0.4, 0.55, 1.0, -0.035, 0.205, 0.1345);       // FO-1 text on the chest plate
  dec('chest', 0.06, 0.03, 0.53, 0.0, 0.98, 0.3, 0.075, 0.07, 0.126);           // chevrons
  dec('chest', 0.07, 0.07, 0.72, 0.5, 1.0, 1.0, 0, 0.17, -0.2055, Math.PI);    // emblem on the back pack
  for (const [sd, s] of [['lSh', 1], ['rSh', -1]]) dec(sd, 0.045, 0.04, 0.0, 0.0, 0.18, 0.3, s * 0.05, -0.12, 0.045);  // unit number on the upper arms
  const rest = {}; for (const n in bones) rest[n] = bones[n].position.clone();
  return { mesh, bones, rest, material: mat, anim: makeAnimator(bones, rest) };
}

// ---------- procedural animation ----------
// A pose: { joint: [rx, ry, rz], ..., root: [x, y, z] (offset), eyes: blink 0..1 }. Joint angles are local Euler.
// Sign conventions (bone hangs down for limbs, points up for torso/head):
//   limbs: rx < 0 swings forward;  torso/head: rx > 0 leans forward / looks down.
//   left arm rz > 0 lifts it outward (right arm: rz < 0).
const J = ['hips', 'spine', 'chest', 'neck', 'head', 'lSh', 'lEl', 'lWr', 'lFi', 'rSh', 'rEl', 'rWr', 'rFi', 'lHip', 'lKn', 'lAn', 'rHip', 'rKn', 'rAn'];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function blank() { const p = { root: [0, 0, 0] }; for (const j of J) p[j] = [0, 0, 0]; return p; }
function addTo(p, j, x = 0, y = 0, z = 0) { p[j][0] += x; p[j][1] += y; p[j][2] += z; }

function idle(t) {
  const p = blank(), br = Math.sin(t * 1.7);
  p.root[0] = Math.sin(t * 0.45) * 0.012; p.root[1] = br * 0.003;
  addTo(p, 'hips', 0, Math.sin(t * 0.45) * 0.04, Math.sin(t * 0.45) * 0.035);
  addTo(p, 'lHip', 0, 0, -Math.sin(t * 0.45) * 0.035 + 0.02); addTo(p, 'rHip', 0, 0, -Math.sin(t * 0.45) * 0.035 - 0.02);
  addTo(p, 'lKn', 0.04 + Math.max(0, Math.sin(t * 0.45)) * 0.06); addTo(p, 'rKn', 0.04 + Math.max(0, -Math.sin(t * 0.45)) * 0.06);
  addTo(p, 'lAn', -0.02); addTo(p, 'rAn', -0.02);
  addTo(p, 'spine', 0.0, 0, -Math.sin(t * 0.45) * 0.02); addTo(p, 'chest', 0.02 + br * 0.015);
  addTo(p, 'lSh', 0.06 + br * 0.01, 0, 0.11); addTo(p, 'rSh', 0.06 + br * 0.01, 0, -0.11);
  addTo(p, 'lEl', -0.22, 0.2); addTo(p, 'rEl', -0.22, -0.2); addTo(p, 'lFi', -0.35); addTo(p, 'rFi', -0.35);
  addTo(p, 'lWr', 0, 0.3); addTo(p, 'rWr', 0, -0.3);
  const look = Math.sin(t * 0.31) * 0.35 + Math.sin(t * 0.13) * 0.15;
  addTo(p, 'head', Math.sin(t * 0.21) * 0.06 - 0.03, look, 0); addTo(p, 'neck', 0, look * 0.3, 0);
  return p;
}
function locomotion(ph, a, run) {
  // a: stride amplitude 0..1; ph: gait phase (one cycle = two steps)
  const p = blank(), s = Math.sin(ph), c = Math.cos(ph), amp = (run ? 0.75 : 0.45) * a;
  p.root[1] = (run ? 0.035 : 0.02) * a * Math.cos(2 * ph) - (run ? 0.04 : 0.012) * a;
  addTo(p, 'hips', 0, s * 0.12 * a, -c * 0.03 * a);
  addTo(p, 'chest', (run ? 0.18 : 0.06) * a, -s * 0.16 * a, c * 0.02 * a);
  addTo(p, 'head', -(run ? 0.12 : 0.04) * a, s * 0.06 * a, 0);
  // legs: hip swing, knee flexes during the swing, ankle keeps the foot level and pushes off
  const leg = (side, ps) => {
    const hs = -Math.sin(ps) * amp, swing = Math.max(0, Math.cos(ps));
    const kn = (run ? 0.25 : 0.08) * a + (run ? 1.5 : 0.95) * a * Math.pow(swing, 1.4) + 0.12 * a * Math.max(0, -Math.cos(ps));
    addTo(p, side + 'Hip', hs - (run ? 0.12 : 0.03) * a); addTo(p, side + 'Kn', kn); addTo(p, side + 'An', -(hs + kn) * 0.55 + 0.15 * a * Math.max(0, Math.sin(ps)));
  };
  leg('l', ph); leg('r', ph + Math.PI);
  // arms swing opposite to the legs; elbows bend more on the forward swing
  const arm = (side, ps, sg) => {
    const sw = Math.sin(ps) * amp * (run ? 1.1 : 0.85);
    addTo(p, side + 'Sh', sw, 0, sg * 0.1); addTo(p, side + 'El', -(run ? 1.2 : 0.3) - 0.35 * a * Math.max(0, -Math.sin(ps)), sg * 0.2); addTo(p, side + 'Fi', run ? -1.1 : -0.45);
  };
  arm('l', ph, 1); arm('r', ph + Math.PI, -1);
  return p;
}
// --- station poses ---
function seated(p, seatDrop = 0.36) {
  p.root[1] -= seatDrop;
  addTo(p, 'lHip', -1.5, 0.08, 0.04); addTo(p, 'rHip', -1.5, -0.08, -0.04);
  addTo(p, 'lKn', 1.45); addTo(p, 'rKn', 1.45); addTo(p, 'lAn', 0.05); addTo(p, 'rAn', 0.05);
}
const STATION = {
  hunt(t) { // sit, type, glance between the three monitors
    const p = blank(); seated(p);
    addTo(p, 'chest', 0.16, 0, 0); addTo(p, 'spine', 0.05);
    const ty = (side, ph) => { addTo(p, side + 'Sh', -0.72 + Math.sin(t * 9 + ph) * 0.03, 0, (side === 'l' ? 1 : -1) * 0.18); addTo(p, side + 'El', -1.05 + Math.sin(t * 11 + ph) * 0.04, side === 'l' ? -0.35 : 0.35); addTo(p, side + 'Wr', 0.25 + Math.sin(t * 13 + ph) * 0.08); addTo(p, side + 'Fi', -0.6 + Math.sin(t * 17 + ph) * 0.35); };
    ty('l', 0); ty('r', 1.7);
    const g = Math.sin(t * 0.55), glance = g > 0.35 ? 0.42 : g < -0.35 ? -0.42 : 0;
    addTo(p, 'head', 0.06, glance, 0); addTo(p, 'neck', 0, glance * 0.3, 0);
    return p;
  },
  contract(t) { // sit back, headset hand at the ear, scroll with the other hand, nod while talking
    const p = blank(); seated(p);
    addTo(p, 'chest', -0.08, -0.12, 0);
    addTo(p, 'rSh', -0.55, 0, -1.15); addTo(p, 'rEl', -2.25, 0.4); addTo(p, 'rWr', 0.2, 0, 0.3); addTo(p, 'rFi', -0.9);
    addTo(p, 'lSh', -0.65, 0, 0.2); addTo(p, 'lEl', -0.95, -0.3); addTo(p, 'lWr', 0.2 + Math.sin(t * 5) * 0.12); addTo(p, 'lFi', -0.4 + Math.sin(t * 5) * 0.2);
    addTo(p, 'head', 0.05 + Math.sin(t * 3.1) * 0.06 * (Math.sin(t * 0.7) > 0 ? 1 : 0.2), 0.2, -0.12);
    return p;
  },
  stats(t) { // crouch at the safe, turn the dial, flip the ledger
    const p = blank(); p.root[1] -= 0.36;
    addTo(p, 'lHip', -1.95, 0.25, 0.15); addTo(p, 'rHip', -1.4, -0.15, -0.1); addTo(p, 'lKn', 2.25); addTo(p, 'rKn', 2.0); addTo(p, 'lAn', -0.3); addTo(p, 'rAn', 0.05);
    addTo(p, 'chest', 0.35); addTo(p, 'spine', 0.15);
    const dial = Math.sin(t * 2.6);
    addTo(p, 'rSh', -1.25, 0, -0.1); addTo(p, 'rEl', -0.55, 0.2); addTo(p, 'rWr', 0, dial * 0.9, 0); addTo(p, 'rFi', -0.9);
    const flip = sstep(0.0, 0.25, Math.sin(t * 0.8)) * 0.6;
    addTo(p, 'lSh', -0.8 - flip * 0.4, 0, 0.25); addTo(p, 'lEl', -1.2 + flip * 0.5, -0.5); addTo(p, 'lWr', 0, 0, flip * 1.2); addTo(p, 'lFi', -0.3);
    addTo(p, 'head', 0.22, -0.1 + flip * 0.25, 0);
    return p;
  },
  training(t) { // stand at the whiteboard, write with the right hand, point at the pattern book now and then
    const p = blank(), ph = t % 7, pointing = sstep(4.6, 5.0, ph) * (1 - sstep(6.4, 6.9, ph));
    addTo(p, 'hips', 0, -0.15, 0); addTo(p, 'chest', 0.04, -0.12);
    const wx = Math.sin(t * 5) * 0.09, wy = Math.cos(t * 5) * 0.06, sweep = ((t * 0.25) % 1) * 0.5 - 0.25;
    addTo(p, 'rSh', -1.75 + wy * (1 - pointing), 0, -0.35 + sweep + wx * (1 - pointing)); addTo(p, 'rEl', -0.75 + pointing * 0.65); addTo(p, 'rFi', -1.0);
    addTo(p, 'lSh', 0.05 - pointing * 1.4, 0, 0.12 + pointing * 0.4); addTo(p, 'lEl', -0.35 + pointing * 0.25); addTo(p, 'lFi', -0.3 - pointing * 0.6);
    addTo(p, 'head', -0.1, -0.15 + sweep * 0.6 + pointing * 0.5, 0);
    addTo(p, 'lKn', 0.05); addTo(p, 'rKn', 0.12);
    return p;
  },
  forge(t) { // lean over the bench, both hands tinkering, head down
    const p = blank();
    addTo(p, 'chest', 0.32); addTo(p, 'spine', 0.1); addTo(p, 'lKn', 0.12); addTo(p, 'rKn', 0.12); addTo(p, 'lHip', -0.08); addTo(p, 'rHip', -0.08);
    addTo(p, 'lSh', -1.0 + Math.sin(t * 6.1) * 0.06, 0, 0.12); addTo(p, 'lEl', -0.95, -0.4); addTo(p, 'lWr', Math.sin(t * 7.3) * 0.35, 0, 0); addTo(p, 'lFi', -0.9);
    addTo(p, 'rSh', -0.95 + Math.sin(t * 4.3 + 1) * 0.1, 0, -0.08 + Math.sin(t * 3.1) * 0.08); addTo(p, 'rEl', -1.0 + Math.sin(t * 8.5) * 0.12, 0.35); addTo(p, 'rWr', 0, Math.sin(t * 9) * 0.5, 0); addTo(p, 'rFi', -1.1);
    addTo(p, 'head', 0.38, Math.sin(t * 0.7) * 0.15, 0);
    return p;
  },
  hq(t) { // face the goal board: point and tap at it, then cross the arms and review
    const p = blank(), ph = t % 8, point = 1 - sstep(3.4, 4.0, ph) + sstep(7.4, 8.0, ph), cross = 1 - point;
    const tap = point * Math.max(0, Math.sin(t * 7)) * (ph > 1.5 && ph < 3.2 ? 1 : 0);
    addTo(p, 'rSh', -1.45 * point - 0.55 * cross + tap * 0.08, 0, -0.2 * point + 0.55 * cross); addTo(p, 'rEl', -0.12 * point - 1.95 * cross, 0.8 * cross); addTo(p, 'rFi', -0.2 * point - 0.8 * cross);
    addTo(p, 'lSh', 0.05 * point - 0.6 * cross, 0, 0.12 * point - 0.5 * cross); addTo(p, 'lEl', -0.3 * point - 1.9 * cross, -0.8 * cross); addTo(p, 'lFi', -0.5);
    addTo(p, 'chest', -0.04 * cross, 0.05 * point); addTo(p, 'head', -0.18 + Math.sin(t * 1.3) * 0.05 * cross, Math.sin(t * 0.5) * 0.2 * cross, 0.08 * cross);
    addTo(p, 'hips', 0, 0, 0.04 * cross); addTo(p, 'lKn', 0.1 * cross); addTo(p, 'rHip', 0, 0, -0.06 * cross);
    return p;
  },
  rig(t) { // open the rack door, lean in to inspect, tap the rack screen
    const p = blank(), ph = t % 6, door = sstep(0, 0.8, ph) * (1 - sstep(5.2, 6, ph)), tap = sstep(1.6, 2.0, ph) * (1 - sstep(4.6, 5.0, ph));
    addTo(p, 'chest', 0.15 + tap * 0.12, -0.1 * door); addTo(p, 'spine', 0.05);
    addTo(p, 'lSh', -1.2 * door, 0, 0.45 * door + 0.1); addTo(p, 'lEl', -0.4 * door - 0.2, -0.3); addTo(p, 'lFi', -1.1 * door - 0.3);
    addTo(p, 'rSh', -1.35 * tap + 0.04 * (1 - tap) + tap * Math.max(0, Math.sin(t * 8)) * 0.06, 0, -0.12); addTo(p, 'rEl', -0.5 * tap - 0.25); addTo(p, 'rFi', -0.3 - tap * 0.5);
    addTo(p, 'head', 0.1 + tap * 0.12, 0.25 * door - tap * 0.15, 0); addTo(p, 'lKn', 0.1); addTo(p, 'rKn', 0.15);
    return p;
  },
  terminals(t) { // stand-up typing at an agent pod, glancing at the log
    const p = blank();
    addTo(p, 'chest', 0.38); addTo(p, 'spine', 0.12); addTo(p, 'lKn', 0.08); addTo(p, 'rKn', 0.08); addTo(p, 'lHip', -0.1); addTo(p, 'rHip', -0.1);
    const ty = (side, ph) => { addTo(p, side + 'Sh', -0.95 + Math.sin(t * 9 + ph) * 0.03, 0, (side === 'l' ? 1 : -1) * 0.15); addTo(p, side + 'El', -0.55 + Math.sin(t * 12 + ph) * 0.04, side === 'l' ? -0.4 : 0.4); addTo(p, side + 'Wr', 0.35); addTo(p, side + 'Fi', -0.5 + Math.sin(t * 16 + ph) * 0.35); };
    ty('l', 0); ty('r', 2.1);
    addTo(p, 'head', -0.05, Math.sin(t * 0.6) * 0.25, 0);
    return p;
  },
  lounge(t) { // sit back on the sofa, arms along the backrest, one leg crossed
    const p = blank(); seated(p, 0.42);
    addTo(p, 'chest', -0.32 + Math.sin(t * 1.4) * 0.015); addTo(p, 'spine', -0.08);
    addTo(p, 'lSh', 0.25, 0, 1.25); addTo(p, 'rSh', 0.25, 0, -1.25); addTo(p, 'lEl', -0.55, -0.3); addTo(p, 'rEl', -0.55, 0.3); addTo(p, 'lFi', -0.5); addTo(p, 'rFi', -0.5);
    addTo(p, 'rHip', 0.15, -0.25, 0.1); addTo(p, 'rKn', -0.35);
    addTo(p, 'head', -0.18, Math.sin(t * 0.25) * 0.4, 0.05);
    return p;
  },
};
STATION.minis = STATION.terminals;

function makeAnimator(bones, rest) {
  const cur = blank(), state = { ph: 0, blink: 0, nextBlink: 2 };
  function apply(target, dt, rate) {
    const k = 1 - Math.exp(-dt * rate);
    for (const j of J) for (let i = 0; i < 3; i++) cur[j][i] += (target[j][i] - cur[j][i]) * k;
    for (let i = 0; i < 3; i++) cur.root[i] += (target.root[i] - cur.root[i]) * k;
    for (const j of J) bones[j].rotation.set(cur[j][0], cur[j][1], cur[j][2]);
    bones.hips.position.set(rest.hips.x + cur.root[0], rest.hips.y + cur.root[1], rest.hips.z + cur.root[2]);
  }
  return {
    cur,
    // speed m/s (locomotion), mode: null or station id, t: time, weight of station pose
    update(dt, t, { speed = 0, station = null, stationT = 0, rate = 9 } = {}) {
      let target;
      if (station && STATION[station]) target = STATION[station](stationT);
      else {
        const run = speed > 2.4, a = Math.min(1, speed / (run ? 4.2 : 1.55));
        state.ph += dt * speed * Math.PI / (run ? 1.15 : 0.66);
        const idl = idle(t), loc = locomotion(state.ph, a, run), w = Math.min(1, speed / 0.5);
        target = blank();
        for (const j of [...J, 'root']) for (let i = 0; i < 3; i++) target[j][i] = idl[j][i] * (1 - w) + loc[j][i] * w;
      }
      apply(target, dt, station ? Math.min(rate, 7) : 14);
      // blink
      state.nextBlink -= dt; if (state.nextBlink < 0) { state.blink = 0.14; state.nextBlink = 2 + Math.random() * 3.5; }
      state.blink = Math.max(0, state.blink - dt); const b = state.blink > 0 ? 0.12 : 1;
      bones.eyes.scale.y += (b - bones.eyes.scale.y) * Math.min(1, dt * 30);
    },
    stations: Object.keys(STATION),
  };
}
