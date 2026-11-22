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
  set(PAL.ivory, 0xd6d1c6, 0.46, 0.0);
  set(PAL.ivoryDark, 0xb9b3a7, 0.5, 0.0);
  set(PAL.orange, 0xb65a36, 0.45, 0.0);
  set(PAL.graphite, 0x34373c, 0.38, 0.75);
  set(PAL.rubber, 0x161719, 0.82, 0.0);
  set(PAL.visor, 0x07090c, 0.06, 0.2);
  set(PAL.chrome, 0xb8bcc2, 0.22, 1.0);
  set(PAL.eye, 0x0a1214, 0.3, 0.0, 0x9ff6ff);
  set(PAL.seam, 0x26292e, 0.6, 0.4);
  set(PAL.led, 0x0a0a0a, 0.4, 0.0, 0x9a5a22);
  set(PAL.sole, 0x101112, 0.9, 0.0);
  const tex = (data, srgb) => { const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const cc = new Uint8Array(N * 4); for (let i = 0; i < N; i++) { const painted = i === PAL.ivory || i === PAL.orange || i === PAL.ivoryDark; cc.set([painted ? 255 : 20, 0, 0, 255], i * 4); }
  const sh = new Uint8Array(N * 4); for (let i = 0; i < N; i++) { const rub = i === PAL.rubber || i === PAL.sole; sh.set(rub ? [120, 124, 130, 255] : [0, 0, 0, 255], i * 4); }
  const m = new THREE.MeshPhysicalMaterial({
    map: tex(col, true), roughnessMap: tex(orm), metalnessMap: tex(orm), emissiveMap: tex(em, true), emissive: 0xffffff, emissiveIntensity: 2.2,
    roughness: 1, metalness: 1, clearcoat: 0.35, clearcoatMap: tex(cc), clearcoatRoughness: 0.52, envMapIntensity: 1.0, sheen: 1.0, sheenColor: 0xffffff, sheenColorMap: tex(sh, true), sheenRoughness: 0.45,
  });
  // micro detail: fine noise in roughness, a faint orange-peel bump on the paint, and worn edges (bevels show bare
  // metal where the surface curves hardest), all computed from bind-pose position so it sticks to the parts.
  const base = THREE.MeshStandardMaterial.prototype.onBeforeCompile;
  m.onBeforeCompile = function (sh) {
    base.call(this, sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP; attribute float ao; varying float vAO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = position; vAO = ao;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRP; varying float vAO;
float rh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rh(i), rh(i + vec3(1,0,0)), f.x), mix(rh(i + vec3(0,1,0)), rh(i + vec3(1,1,0)), f.x), f.y), mix(mix(rh(i + vec3(0,0,1)), rh(i + vec3(1,0,1)), f.x), mix(rh(i + vec3(0,1,1)), rh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  float nA = rn(vRP * 60.0), nB = rn(vRP * 9.0);
  roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * nA) + 0.06 * nB, 0.04, 1.0);
  // micro-scratches: thin anti-aliased streaks in two directions, only in sparse patches
  { float sp = smoothstep(0.55, 0.8, rn(vRP * 7.0 + 3.0));
    float u1 = dot(vRP, vec3(41.0, 13.0, 29.0)) + rn(vRP * 15.0) * 1.5, u2 = dot(vRP, vec3(-17.0, 37.0, 23.0)) + rn(vRP * 13.0 + 5.0) * 1.5;
    float l1 = 1.0 - smoothstep(0.0, fwidth(u1) * 1.2 + 0.01, abs(fract(u1) - 0.5) - 0.46), l2 = 1.0 - smoothstep(0.0, fwidth(u2) * 1.2 + 0.01, abs(fract(u2) - 0.5) - 0.47);
    float scr = max(l1, l2) * sp * 0.6; roughnessFactor = clamp(roughnessFactor + scr * 0.25, 0.04, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.02, scr * 0.5); }
  // cavities (baked per vertex): darker and less shiny where parts tuck into each other
  { float cav = 1.0 - vAO, dn = rn(vRP * 22.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.27, 0.23), cav * (0.5 + 0.3 * dn)); // dust/grime packed in the cavities
    diffuseColor.rgb *= mix(0.5, 1.0, vAO); roughnessFactor = mix(min(1.0, roughnessFactor + 0.35), roughnessFactor, vAO);
    float tops = smoothstep(0.6, 0.95, normalize(vNormal).y * 0.0 + rn(vRP * 3.0)) * 0.12; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.52, 0.47), tops); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { float curv = clamp(length(fwidth(normal)) * 9.0, 0.0, 1.0); float painted = step(0.55, dot(diffuseColor.rgb, vec3(0.33)));
    float wear = smoothstep(0.58, 0.86, curv * 0.8 + rn(vRP * 30.0) * 0.45 + rn(vRP * 6.0) * 0.3) * painted;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.31, 0.33), wear * 0.75);
    metalnessFactor = mix(metalnessFactor, 0.85, wear * 0.7); roughnessFactor = mix(roughnessFactor, 0.45, wear);
    vec3 bump = vec3(rn(vRP * 140.0) - 0.5, rn(vRP * 140.0 + 7.0) - 0.5, 0.0) * 0.06 * painted; normal = normalize(normal + bump); }`);
  };
  { const prev = m.onBeforeCompile; m.onBeforeCompile = function (sh) { prev.call(this, sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '{ vec3 refl = (outgoingLight - totalEmissiveRadiance) * mix(0.7, 1.0, vAO); refl = refl / (1.0 + max(0.0, max(refl.r, max(refl.g, refl.b)) - 0.9) * 1.2); outgoingLight = refl + totalEmissiveRadiance; }\n#include <opaque_fragment>'); }; } // soft-clamp highlights below the bloom threshold
  m.defines = { ...(m.defines || {}), NO_WEATHER: '' };
  m.customProgramCacheKey = () => 'fo-robot';
  m.name = 'robot-palette';
  return m;
}

// Ambient occlusion baked per vertex in the bind pose: short rays over the hemisphere against the robot itself, so
// seams, joints and tucked-in parts get darker cavities (one attribute, no extra draw).
function bakeAO(geo) {
  // voxel version: mark the cells the surface passes through (1.5 cm), then probe a few points off each vertex
  const t0 = performance.now(); geo.computeBoundingBox(); const b = geo.boundingBox, c = 0.015;
  const ox = b.min.x - 0.05, oy = b.min.y - 0.05, oz = b.min.z - 0.05, nx = Math.ceil((b.max.x - ox + 0.05) / c), ny = Math.ceil((b.max.y - oy + 0.05) / c), nz = Math.ceil((b.max.z - oz + 0.05) / c);
  const occ = new Uint8Array(nx * ny * nz), pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index, n = pos.count;
  const mark = (x, y, z) => { const i = Math.floor((x - ox) / c), j = Math.floor((y - oy) / c), k = Math.floor((z - oz) / c); if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) occ[(k * ny + j) * nx + i] = 1; };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) { A.fromBufferAttribute(pos, idx.getX(t)); B.fromBufferAttribute(pos, idx.getX(t + 1)); Cc.fromBufferAttribute(pos, idx.getX(t + 2));
    const e = Math.max(A.distanceTo(B), B.distanceTo(Cc), Cc.distanceTo(A)), st = Math.min(8, Math.ceil(e / c));
    for (let u = 0; u <= st; u++) for (let v = 0; v <= st - u; v++) { const w = st - u - v; mark((A.x * u + B.x * v + Cc.x * w) / st, (A.y * u + B.y * v + Cc.y * w) / st, (A.z * u + B.z * v + Cc.z * w) / st); } }
  const at = (x, y, z) => { const i = Math.floor((x - ox) / c), j = Math.floor((y - oy) / c), k = Math.floor((z - oz) / c); return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz ? occ[(k * ny + j) * nx + i] : 0; };
  const ao = new Float32Array(n), P = new THREE.Vector3(), N = new THREE.Vector3(), T1 = new THREE.Vector3(), T2 = new THREE.Vector3();
  const dirs = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]], dists = [0.025, 0.045];
  for (let i = 0; i < n; i++) {
    P.fromBufferAttribute(pos, i); N.fromBufferAttribute(nor, i).normalize();
    T1.set(Math.abs(N.y) < 0.9 ? 0 : 1, Math.abs(N.y) < 0.9 ? 1 : 0, 0).cross(N).normalize(); T2.crossVectors(N, T1);
    let o = 0, cnt = 0; for (const d of dirs) for (const r of dists) { cnt++; o += at(P.x + (T1.x * d[0] + N.x * d[1] + T2.x * d[2]) * r, P.y + (T1.y * d[0] + N.y * d[1] + T2.y * d[2]) * r, P.z + (T1.z * d[0] + N.z * d[1] + T2.z * d[2]) * r) * (r < 0.03 ? 1.2 : 0.8); }
    ao[i] = Math.max(0, 1 - o / cnt * 1.5);
  }
  geo.setAttribute('ao', new THREE.BufferAttribute(ao, 1)); geo.userData.aoMs = performance.now() - t0;
}

// ---------- skeleton (rest pose: standing, arms hanging) ----------
const BONES = [
  // name, parent, x, y, z (offset from parent)
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.86, 0], ['spine', 'hips', 0, 0.09, 0], ['chest', 'spine', 0, 0.12, 0],
  ['neck', 'chest', 0, 0.3, 0], ['head', 'neck', 0, 0.065, 0], ['eyes', 'head', 0, 0.13, 0.158],
  ['lSh', 'chest', 0.218, 0.235, 0], ['lEl', 'lSh', 0, -0.27, 0], ['lWr', 'lEl', 0, -0.245, 0], ['lFi', 'lWr', 0, -0.085, 0.0], ['lF2', 'lFi', 0, -0.042, 0.0],
  ['rSh', 'chest', -0.218, 0.235, 0], ['rEl', 'rSh', 0, -0.27, 0], ['rWr', 'rEl', 0, -0.245, 0], ['rFi', 'rWr', 0, -0.085, 0.0], ['rF2', 'rFi', 0, -0.042, 0.0],
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
  // shape language helpers: keystone tapers and lathed limbs (bulge then taper), instead of plain capsules
  const taper = (g, bot, top, zToo = true) => { g.computeBoundingBox(); const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = (p.getY(i) - y0) / (y1 - y0), k = bot + (top - bot) * t; p.setX(i, p.getX(i) * k); if (zToo) p.setZ(i, p.getZ(i) * (1 - (1 - k) * 0.5)); } return g; };
  // pillow: bulge the front/back faces (z) toward the middle, so slabs read as moulded shells instead of boxes
  const pillow = (g, k, ky = 0) => { g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, hw = (b.max.x - b.min.x) / 2, hh = (b.max.y - b.min.y) / 2, cy = (b.max.y + b.min.y) / 2;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / hw, v = (p.getY(i) - cy) / hh; p.setZ(i, p.getZ(i) * (1 + k * Math.max(0, 1 - u * u) * (1 - ky * v * v))); } return g; };
  const lathe = (pts, seg = 22) => new THREE.LatheGeometry(pts.slice().sort((a, b) => a[1] - b[1]).map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const hub = (bone, r, w, x, y, z) => { part(bone, cyl(r, r, w, 22), P.graphite, x, y, z, 0, 0, Math.PI / 2); part(bone, cyl(r * 0.55, r * 0.55, w + 0.012, 16), P.chrome, x, y, z, 0, 0, Math.PI / 2); };
  const screw = (bone, x, y, z, rx = 0, ry = 0) => part(bone, cyl(0.006, 0.006, 0.004, 8), P.chrome, x, y, z, rx + Math.PI / 2, ry, 0);

  // --- head: one clean silhouette. A smooth skull that sweeps up and back, a wrap visor, and a single asymmetric
  // sensor pod on the right side carrying the antenna (the left side stays clean) ---
  { const g = rb(0.29, 0.26, 0.29, 0.11, 6); g.computeBoundingBox(); const bb = g.boundingBox, pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) { const t = (pa.getY(i) - bb.min.y) / (bb.max.y - bb.min.y), z = pa.getZ(i);
      pa.setZ(i, (z < 0 ? z * (1 + 0.32 * t * t) : z * (1 - 0.1 * t)) - 0.035 * t * t); pa.setX(i, pa.getX(i) * (1 - 0.1 * t * t)); }
    g.computeVertexNormals(); part('head', g, P.ivory, 0, 0.12, 0.01); }
  part('head', tor(0.148, 0.004, 48), P.seam, 0, 0.045, -0.005, Math.PI / 2, 0, 0);     // one panel line around the jaw
  part('head', rb(0.2, 0.045, 0.07, 0.02), P.graphite, 0, 0.012, 0.1);                 // jaw
  part('head', rb(0.262, 0.13, 0.05, 0.04, 4), P.visor, 0, 0.13, 0.128);                // glass visor
  part('head', rb(0.274, 0.142, 0.04, 0.045, 4), P.graphite, 0, 0.13, 0.118);           // visor bezel
  // sensor pod (robot's right)
  part('head', cyl(0.068, 0.062, 0.07, 28), P.graphite, -0.16, 0.14, -0.01, 0, 0, Math.PI / 2);
  part('head', tor(0.058, 0.008, 32), P.orange, -0.197, 0.14, -0.01, 0, Math.PI / 2, 0);
  part('head', cyl(0.032, 0.032, 0.012, 20), P.chrome, -0.2, 0.14, -0.01, 0, 0, Math.PI / 2);
  part('head', sph(0.018, 12, 10), P.led, -0.205, 0.14, -0.01);
  part('head', cyl(0.004, 0.004, 0.15, 6), P.graphite, -0.17, 0.25, -0.04, 0, 0, 0.2);    // antenna off the pod
  part('head', sph(0.011, 10, 8), P.led, -0.185, 0.325, -0.04);
  part('head', cyl(0.034, 0.034, 0.01, 20), P.ivoryDark, 0.148, 0.12, -0.01, 0, 0, Math.PI / 2); // flush cap on the left
  // eyes (own bone, so they can blink / glance)
  for (const s of [-1, 1]) part('eyes', rb(0.05, 0.034, 0.012, 0.016), P.eye, s * 0.052, 0, 0.0);
  part('eyes', rb(0.04, 0.006, 0.01, 0.003), P.eye, 0, -0.045, 0.0); // a small mouth line

  // --- neck: ribbed rubber bellows ---
  for (let i = 0; i < 4; i++) part('neck', tor(0.05 - i * 0.002, 0.014, 20), P.rubber, 0, 0.0 + i * 0.018, 0, Math.PI / 2, 0, 0);
  part('neck', cyl(0.035, 0.035, 0.08, 14), P.graphite, 0, 0.03, 0);

  // --- chest / torso ---
  part('chest', pillow(taper(rb(0.4, 0.3, 0.24, 0.085, 5), 0.72, 1.0), 0.14, 0.4), P.ivory, 0, 0.15, 0); // moulded V torso
  part('chest', taper(rb(0.28, 0.18, 0.03, 0.01), 0.7, 1.0, false), P.ivoryDark, 0, 0.17, 0.118); // keystone chest plate
  for (const s of [-1, 1]) part('chest', rb(0.11, 0.022, 0.03, 0.008), P.orange, s * 0.085, 0.27, 0.108, 0, 0, s * 0.12); // collar plates
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
  for (const s of [-1, 1]) { part('hips', rb(0.06, 0.1, 0.16, 0.02), P.ivory, s * 0.165, -0.03, 0); part('hips', cyl(0.012, 0.012, 0.12, 10), P.chrome, s * 0.17, -0.05, -0.07, 0.3, 0, 0); } // hip plates + pistons
  for (const s of [-1, 1]) screw('hips', s * 0.045, -0.01, 0.126);

  // --- arms ---
  for (const [sd, s] of [['l', 1], ['r', -1]]) {
    const sh = sd + 'Sh', el = sd + 'El', wr = sd + 'Wr', fi = sd + 'Fi';
    hub(sh, 0.056, 0.06, 0, 0, 0);                                               // shoulder joint
    part(sh, taper(rb(0.12, 0.075, 0.16, 0.025), 0.82, 1.0), P.ivory, s * 0.03, 0.04, 0, 0, 0, -s * 0.32);   // pauldron
    part(sh, rb(0.122, 0.014, 0.162, 0.006), P.orange, s * 0.022, 0.012, 0, 0, 0, -s * 0.32);
    part(sh, lathe([[0, -0.03], [0.04, -0.036], [0.05, -0.06], [0.053, -0.1], [0.049, -0.16], [0.042, -0.205], [0.03, -0.228], [0, -0.234]]), P.ivory, 0, 0, 0);
    part(sh, tor(0.05, 0.006), P.seam, 0, -0.07, 0, Math.PI / 2, 0, 0);
    part(sh, pillow(taper(rb(0.022, 0.13, 0.07, 0.008), 0.8, 1.0), 0.3), P.ivoryDark, s * 0.046, -0.135, 0);   // outer armour plate
    for (let i = 0; i < 3; i++) part(sh, rb(0.004, 0.006, 0.05, 0.002), P.seam, s * 0.058, -0.105 - i * 0.022, 0); // vent slits
    part(sh, tor(0.046, 0.005), P.seam, 0, -0.2, 0, Math.PI / 2, 0, 0);
    part(sh, cyl(0.034, 0.034, 0.26, 16), P.graphite, 0, -0.13, 0);                     // inner core (shows at the shell ends)
    part(sh, tor(0.041, 0.006), P.ivoryDark, 0, -0.04, 0, Math.PI / 2, 0, 0);            // shell rim lip
    part(el, sph(0.047, 16, 12), P.rubber, 0, 0, 0);
    part(el, new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), P.graphite, 0, 0, -0.008, -Math.PI / 2 - 0.3, 0, 0); // elbow cap (back)
    part(el, lathe([[0, -0.028], [0.043, -0.034], [0.054, -0.068], [0.055, -0.098], [0.047, -0.16], [0.04, -0.196], [0, -0.2]]), P.ivory, 0, 0, 0, 0, 0, 0, 1, 1, 0.95);
    part(el, cyl(0.054, 0.05, 0.045, 20), P.orange, 0, -0.2, 0);                 // cuff
    part(el, rb(0.035, 0.07, 0.012, 0.006), P.graphite, s * 0.0, -0.11, 0.05);    // forearm panel
    part(el, pillow(taper(rb(0.062, 0.12, 0.02, 0.008), 0.75, 1.0), 0.5), P.ivoryDark, 0, -0.105, -0.046);  // dorsal shell plate
    part(el, rb(0.012, 0.1, 0.03, 0.005), P.orange, s * 0.05, -0.11, -0.01);        // outer stripe
    part(el, tor(0.044, 0.006), P.ivoryDark, 0, -0.037, 0, Math.PI / 2, 0, 0);           // shell rim lip
    part(el, cyl(0.007, 0.007, 0.14, 8), P.chrome, s * 0.045, -0.1, -0.03, 0, 0, s * 0.08);  // hydraulic rod
    part(el, tor(0.051, 0.005), P.seam, 0, -0.06, 0, Math.PI / 2, 0, 0);
    part(wr, sph(0.03, 12, 10), P.graphite, 0, 0, 0);
    part(wr, taper(rb(0.085, 0.085, 0.038, 0.016), 1.0, 0.82), P.graphite, 0, -0.045, 0.0);       // palm (narrower at the wrist)
    part(wr, rb(0.09, 0.018, 0.046, 0.008), P.orange, 0, -0.082, 0.0);           // knuckle guard
    part(wr, sph(0.02, 12, 8), P.rubber, s * 0.03, -0.04, 0.018);                 // thumb base pad
    part(wr, rb(0.06, 0.03, 0.04, 0.012), P.ivory, 0, -0.03, 0.0, 0, 0, 0);    // back-of-hand plate
    // thumb: two segments with a knuckle
    part(wr, sph(0.013, 10, 8), P.graphite, s * 0.045, -0.035, 0.016);
    part(wr, cap(0.012, 0.026, 8), P.ivory, s * 0.055, -0.058, 0.026, 0.35, 0, s * 0.55);
    part(wr, cap(0.0105, 0.018, 8), P.rubber, s * 0.066, -0.083, 0.036, 0.5, 0, s * 0.45);
    // four fingers: knuckle, plated proximal segment, rubber distal segment with a tip pad
    const f2 = sd + 'F2';
    for (let k = 0; k < 4; k++) {
      const fx = (k - 1.5) * 0.0205, len = k === 0 || k === 3 ? 0.9 : 1;
      part(fi, sph(0.0105, 10, 8), P.graphite, fx, 0.0, 0.0);
      part(fi, rb(0.017, 0.036 * len, 0.019, 0.007), P.ivory, fx, -0.022 * len, 0.0);
      part(fi, rb(0.0185, 0.004, 0.02, 0.002), P.seam, fx, -0.006, 0.0);
      part(f2, sph(0.0095, 8, 6), P.graphite, fx, 0.0, 0.0);
      part(f2, cap(0.0085, 0.022 * len, 8), P.rubber, fx, -0.018 * len, 0.0);
      part(f2, rb(0.016, 0.012, 0.012, 0.005), P.ivoryDark, fx, -0.03 * len, -0.004); // nail plate
    }
  }
  // --- legs ---
  for (const [sd, s] of [['l', 1], ['r', -1]]) {
    const hp = sd + 'Hip', kn = sd + 'Kn', an = sd + 'An';
    part(hp, sph(0.06), P.graphite, 0, 0, 0); hub(hp, 0.05, 0.03, s * 0.062, 0, 0);   // hip joint
    part(hp, tor(0.05, 0.007), P.orange, s * 0.078, 0, 0, 0, Math.PI / 2, 0);
    part(hp, lathe([[0, -0.035], [0.056, -0.045], [0.066, -0.09], [0.065, -0.16], [0.058, -0.25], [0.05, -0.305], [0.035, -0.326], [0, -0.332]]), P.ivory, 0, 0, 0);
    part(hp, tor(0.066, 0.006), P.seam, 0, -0.11, 0, Math.PI / 2, 0, 0);
    part(hp, rb(0.05, 0.12, 0.02, 0.008), P.orange, s * 0.06, -0.19, 0.0, 0, Math.PI / 2, 0);
    part(hp, pillow(taper(rb(0.09, 0.17, 0.022, 0.01), 0.75, 1.0), 0.5), P.ivoryDark, 0, -0.17, 0.058);  // front thigh plate
    part(hp, tor(0.06, 0.005), P.seam, 0, -0.27, 0, Math.PI / 2, 0, 0);
    part(hp, tor(0.057, 0.007), P.ivoryDark, 0, -0.048, 0, Math.PI / 2, 0, 0);           // shell rim lip
    part(hp, cyl(0.038, 0.038, 0.36, 16), P.graphite, 0, -0.19, 0);                     // inner core
    part(kn, sph(0.056, 16, 12), P.rubber, 0, 0, 0);
    part(kn, rb(0.08, 0.075, 0.04, 0.018), P.orange, 0, 0.0, 0.05);             // kneecap
    part(kn, lathe([[0, -0.035], [0.048, -0.045], [0.06, -0.1], [0.059, -0.16], [0.05, -0.25], [0.042, -0.305], [0.03, -0.33], [0, -0.336]]), P.ivory, 0, 0, 0, 0, 0, 0, 1, 1, 0.95);
    part(kn, pillow(taper(rb(0.075, 0.21, 0.03, 0.012), 0.7, 1.0), 0.45), P.ivoryDark, 0, -0.17, 0.05);   // shaped shin guard
    part(kn, rb(0.04, 0.12, 0.012, 0.005), P.graphite, 0, -0.16, 0.066);                         // guard inset
    part(kn, pillow(taper(rb(0.07, 0.12, 0.025, 0.01), 0.8, 1.0), 0.4), P.ivoryDark, 0, -0.12, -0.05);   // calf plate
    part(kn, tor(0.06, 0.006), P.seam, 0, -0.3, 0, Math.PI / 2, 0, 0);
    part(kn, cyl(0.008, 0.008, 0.2, 8), P.chrome, s * 0.05, -0.2, -0.04);           // calf piston
    part(kn, rb(0.04, 0.05, 0.03, 0.01), P.orange, 0, -0.32, 0.05);
    part(an, sph(0.045, 14, 10), P.graphite, 0, 0, 0);
    part(an, rb(0.115, 0.07, 0.25, 0.03), P.graphite, 0, -0.035, 0.045);        // boot
    part(an, rb(0.12, 0.018, 0.26, 0.009), P.sole, 0, -0.072, 0.045);           // sole
    part(an, rb(0.105, 0.05, 0.06, 0.022), P.orange, 0, -0.03, 0.15);           // toe cap
    part(an, rb(0.09, 0.03, 0.1, 0.012), P.ivory, 0, 0.005, 0.0);               // ankle cuff
  }

  const geo = mergeGeometries(parts, false); geo.computeBoundingSphere();
  bakeAO(geo);
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
  // all printed decals ride in one skinned mesh on the same skeleton (one draw call instead of one per decal)
  const decGeos = [];
  const dec = (bone, w, h, u0, v0, u1, v1, x, y, z, ry = 0) => { const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const lm = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bones[bone].matrixWorld, lm));
    const n = geo.attributes.position.count, bi = list.indexOf(bones[bone]), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4); for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); decGeos.push(geo); };
  dec('chest', 0.11, 0.05, 0.0, 0.4, 0.55, 1.0, -0.035, 0.205, 0.1345);       // FO-1 text on the chest plate
  dec('chest', 0.06, 0.03, 0.53, 0.0, 0.98, 0.3, 0.075, 0.07, 0.126);           // chevrons
  dec('chest', 0.07, 0.07, 0.72, 0.5, 1.0, 1.0, 0, 0.17, -0.2055, Math.PI);    // emblem on the back pack
  for (const [sd, s] of [['lSh', 1], ['rSh', -1]]) dec(sd, 0.045, 0.04, 0.0, 0.0, 0.18, 0.3, s * 0.05, -0.12, 0.045);  // unit number on the upper arms
  { const dg = mergeGeometries(decGeos, false); const dmesh = new THREE.SkinnedMesh(dg, dm); dmesh.name = 'robot-decals'; dmesh.frustumCulled = false; dmesh.renderOrder = 1; dmesh.userData.noAO = true;
    mesh.add(dmesh); dmesh.bind(mesh.skeleton, mesh.bindMatrix); }
  // named collision proxies (invisible boxes riding on the bones) for the reviewer's interpenetration test
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = (name, bone, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), proxyMat); m.name = name; m.position.set(x, y, z); m.userData.proxy = true; m.castShadow = false; bones[bone].add(m); return m; };
  proxy('pelvis', 'hips', 0.3, 0.17, 0.19, 0, -0.016, 0); // down to the seat plates
  proxy('chest', 'chest', 0.36, 0.28, 0.23, 0, 0.15, 0);
  proxy('backpack', 'chest', 0.26, 0.24, 0.1, 0, 0.16, -0.15);
  proxy('head', 'head', 0.29, 0.25, 0.27, 0, 0.12, 0.005);
  for (const [sd, S] of [['l', 'L'], ['r', 'R']]) {
    proxy('upperarm_' + S, sd + 'Sh', 0.09, 0.2, 0.09, 0, -0.14, 0);
    proxy('forearm_' + S, sd + 'El', 0.082, 0.19, 0.082, 0, -0.115, 0);
    proxy('hand_' + S, sd + 'Wr', 0.08, 0.11, 0.04, 0, -0.065, 0);
    proxy('thigh_' + S, sd + 'Hip', 0.112, 0.3, 0.112, 0, -0.19, 0);
    proxy('shin_' + S, sd + 'Kn', 0.104, 0.3, 0.104, 0, -0.19, 0.0);
    proxy('foot_' + S, sd + 'An', 0.11, 0.07, 0.25, 0, -0.04, 0.045);
  }
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
const STAND_FEET = [[0.1, 0.08, 0.0], [-0.1, 0.08, 0.0]];
function blank() { const p = { root: [0, 0, 0], feet: STAND_FEET.map(f => f.slice()) }; for (const j of J) p[j] = [0, 0, 0]; return p; }
function addTo(p, j, x = 0, y = 0, z = 0) { p[j][0] += x; p[j][1] += y; p[j][2] += z; }

function idle(t) {
  const p = blank(), br = Math.sin(t * 1.7);
  p.root[0] = Math.sin(t * 0.45) * 0.012; p.root[1] = br * 0.003;
  addTo(p, 'hips', 0, Math.sin(t * 0.45) * 0.04, Math.sin(t * 0.45) * 0.035);
  p.root[1] -= 0.012 + Math.abs(Math.sin(t * 0.45)) * 0.01; // soft knees
  addTo(p, 'spine', 0.0, 0, -Math.sin(t * 0.45) * 0.02); addTo(p, 'chest', 0.02 + br * 0.015);
  addTo(p, 'lSh', 0.06 + br * 0.01, 0, 0.06); addTo(p, 'rSh', 0.06 + br * 0.01, 0, -0.06);
  addTo(p, 'lEl', -0.22, 0.2); addTo(p, 'rEl', -0.22, -0.2); addTo(p, 'lFi', -0.35); addTo(p, 'rFi', -0.35);
  addTo(p, 'lWr', 0, 0.3); addTo(p, 'rWr', 0, -0.3);
  const look = Math.sin(t * 0.31) * 0.35 + Math.sin(t * 0.13) * 0.15;
  addTo(p, 'head', Math.sin(t * 0.21) * 0.06 - 0.03, look, 0); addTo(p, 'neck', 0, look * 0.3, 0);
  return p;
}
function locomotion(ph, a, run) {
  // a: stride amplitude 0..1; ph: gait phase (one cycle = two steps)
  const p = blank(), s = Math.sin(ph), c = Math.cos(ph), amp = (run ? 0.75 : 0.45) * a; p.feet = null;
  p.root[1] = (run ? 0.035 : 0.02) * a * Math.cos(2 * ph) - (run ? 0.04 : 0.012) * a;
  addTo(p, 'hips', 0, s * 0.12 * a, -c * 0.03 * a);
  addTo(p, 'chest', (run ? 0.18 : 0.06) * a, -s * 0.16 * a, c * 0.02 * a);
  addTo(p, 'head', -(run ? 0.12 : 0.04) * a, s * 0.06 * a, 0);
  // legs: hip swing, knee flexes during the swing, ankle keeps the foot level and pushes off
  const leg = (side, ps) => {
    const hs = -Math.sin(ps) * amp, swing = Math.max(0, Math.cos(ps));
    const kn = (run ? 0.25 : 0.08) * a + (run ? 1.5 : 0.95) * a * Math.pow(swing, 1.4) + 0.12 * a * Math.max(0, -Math.cos(ps));
    addTo(p, side + 'Hip', hs - (run ? 0.12 : 0.03) * a); addTo(p, side + 'Kn', kn); addTo(p, side + 'An', -(hs + kn) * 0.75);
  };
  leg('l', ph); leg('r', ph + Math.PI);
  // arms swing opposite to the legs; elbows bend more on the forward swing
  const arm = (side, ps, sg) => {
    const sw = Math.sin(ps) * amp * (run ? 1.0 : 0.65);
    addTo(p, side + 'Sh', sw, 0, sg * 0.1); addTo(p, side + 'El', -(run ? 1.2 : 0.3) - 0.35 * a * Math.max(0, -Math.sin(ps)), sg * 0.2); addTo(p, side + 'Fi', run ? -1.1 : -0.45);
  };
  arm('l', ph, 1); arm('r', ph + Math.PI, -1);
  return p;
}
// --- station poses ---
// Seated: pelvis rests on a seat whose top is at `seatTop` (thigh undersides touch it), feet planted on the floor.
function seated(p, seatTop = 0.42, footZ = 0.4) {
  p.root[1] -= 0.86 - (seatTop + 0.102);
  p.feet = [[0.12, 0.08, footZ], [-0.12, 0.08, footZ]];
}
// sitting on / rising from a swivel chair: height leads when rising and lags when sitting (same curve both ways)
const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function chairProg(q) { return { h: sm((q - 0.15) / 0.85), v: sm(q * 1.5) }; }
const LOUNGE_ARM = [-2.636, -0.915, 2.313, -1.35], LOUNGE_WAY = [-1.6, 0.9, 1.6, -1.356];
export let SOFA_SEAT = 0.44; export function setSofaSeat(v) { SOFA_SEAT = v; }
function sitIdle(t, seatTop, footZ) { // seated, hands resting on the thighs (used while sitting down / swivelling)
  const p = blank(); seated(p, seatTop, footZ);
  addTo(p, 'chest', 0.05 + Math.sin(t * 1.7) * 0.01); addTo(p, 'lSh', -0.55, 0, 0.12); addTo(p, 'rSh', -0.55, 0, -0.12); addTo(p, 'lEl', -0.75, -0.2); addTo(p, 'rEl', -0.75, 0.2); addTo(p, 'lFi', -0.3); addTo(p, 'rFi', -0.3);
  addTo(p, 'head', -0.02, Math.sin(t * 0.4) * 0.2, 0);
  p.hands = { l: [0.17, 0.6, 0.02], r: [-0.17, 0.6, 0.02] }; // resting on the thighs
  return p;
}
const STATION = {
  // exit helpers: hands drawn back off the work surface; standing up from the sofa with the feet staying planted
  retract(t) { const p = idle(t); p.hands = { l: [0.2, 1.0, 0.12], r: [-0.2, 1.0, 0.12] }; return p; },
  rise(k) { // k: 0 seated on the sofa -> 1 standing (root moves forward by `side - spot`, feet stay put)
    const p = blank(), seatTop = SOFA_SEAT + 0.05, drop = 0.86 - (seatTop + 0.102), e = k * k * (3 - 2 * k);
    p.root[1] -= drop * (1 - e); const fz = Math.max(0, 0.45 - 0.55 * k); p.feet = [[0.12, 0.08, fz], [-0.12, 0.08, fz]];
    if (k < 0.45) { const A = LOUNGE_WAY; addTo(p, 'lSh', A[0], A[1], A[2]); addTo(p, 'lEl', A[3], 0, 0); addTo(p, 'rSh', A[0], -A[1], -A[2]); addTo(p, 'rEl', A[3], 0, 0); } // off the backrest via the same low waypoint
    addTo(p, 'chest', 0.25 * Math.sin(Math.PI * k)); addTo(p, 'lSh', -0.5 * (1 - e), 0, 0.1); addTo(p, 'rSh', -0.5 * (1 - e), 0, -0.1); addTo(p, 'lEl', -0.7 * (1 - e)); addTo(p, 'rEl', -0.7 * (1 - e));
    return p;
  },
  chairMove(q) { // q: 0 seated on a swivel chair .. 1 standing 0.4 m in front of it; feet stay planted throughout
    const p = blank(), { h, v } = chairProg(q), drop = 0.86 - (0.42 + 0.102);
    p.root[1] -= drop * (1 - v); const fz = 0.4 * (1 - h); p.feet = [[0.12, 0.08, fz], [-0.12, 0.08, fz]];
    const lean = Math.sin(Math.PI * Math.min(1, q * 1.3)) * 0.32; addTo(p, 'chest', lean); addTo(p, 'spine', lean * 0.4);
    addTo(p, 'lSh', -0.5 * (1 - v), 0, 0.1); addTo(p, 'rSh', -0.5 * (1 - v), 0, -0.1); addTo(p, 'lEl', -0.7 * (1 - v)); addTo(p, 'rEl', -0.7 * (1 - v));
    if (v < 0.9) p.hands = { l: [0.17, 0.6 + 0.2 * v, 0.02 + 0.08 * v], r: [-0.17, 0.6 + 0.2 * v, 0.02 + 0.08 * v] };
    return p;
  },
  sit(t) { return sitIdle(t, 0.42, 0.4); },
  sitSofa(t) { return sitIdle(t, SOFA_SEAT + 0.05, 0.45); },
  hunt(t) { // sit, type, glance between the three monitors
    const p = blank(); seated(p);
    addTo(p, 'chest', 0.16, 0, 0); addTo(p, 'spine', 0.05);
    const ty = (side, ph) => { addTo(p, side + 'Sh', -0.98 + Math.sin(t * 9 + ph) * 0.04, 0, (side === 'l' ? 1 : -1) * 0.2); addTo(p, side + 'El', -0.62 + Math.sin(t * 11 + ph) * 0.05, side === 'l' ? -0.3 : 0.3); addTo(p, side + 'Wr', 0.35 + Math.sin(t * 13 + ph) * 0.1); addTo(p, side + 'Fi', -0.6 + Math.sin(t * 17 + ph) * 0.35); };
    ty('l', 0); ty('r', 1.7);
    p.hands = { l: [0.21, 0.798 + Math.max(0, Math.sin(t * 9)) * 0.012, 0.55 + Math.sin(t * 1.3) * 0.02], r: [-0.01, 0.798 + Math.max(0, Math.sin(t * 9 + 2.1)) * 0.012, 0.55 + Math.sin(t * 1.1) * 0.02] };
    const g = Math.sin(t * 0.55), glance = g > 0.35 ? 0.42 : g < -0.35 ? -0.42 : 0;
    addTo(p, 'head', 0.06, glance, 0); addTo(p, 'neck', 0, glance * 0.3, 0);
    return p;
  },
  contract(t) { // sit back, headset hand at the ear, scroll + talk with the other hand, nod and turn while talking
    const p = blank(); seated(p);
    const talk = Math.sin(t * 0.7) > 0 ? 1 : 0.3, gest = Math.max(0, Math.sin(t * 0.9)) ;
    addTo(p, 'chest', -0.12 + Math.sin(t * 1.1) * 0.06, -0.15 + Math.sin(t * 0.6) * 0.25, Math.sin(t * 0.8) * 0.05);
    addTo(p, 'rSh', -0.55, 0, -1.15); addTo(p, 'rEl', -2.25, 0.4); addTo(p, 'rWr', 0.2, 0, 0.3); addTo(p, 'rFi', -0.9);
    addTo(p, 'lSh', -0.95 - gest * 0.45, 0, 0.22 + gest * 0.25); addTo(p, 'lEl', -0.62 - gest * 0.7 + Math.sin(t * 6) * 0.15 * gest, -0.3); addTo(p, 'lWr', 0.2 + Math.sin(t * 5) * 0.35, Math.sin(t * 3) * 0.4 * gest); addTo(p, 'lFi', -0.4 + Math.sin(t * 5) * 0.4);
    addTo(p, 'head', 0.06 + Math.sin(t * 3.1) * 0.14 * talk, 0.25 + Math.sin(t * 0.6) * 0.45, -0.14 + Math.sin(t * 1.3) * 0.08);
    p.hands = { l: [0.1 + Math.sin(t * 0.9) * 0.05 * gest, 0.78 + gest * 0.01 + Math.max(0, Math.sin(t * 5)) * 0.008, 0.5 - gest * 0.08], r: [-0.17, 1.3, 0.04] }; p.handDir = { r: 'up' };
    return p;
  },
  stats(t) { // crouch at the safe, turn the dial, flip the ledger
    const p = blank(); p.root[1] -= 0.4; p.feet = [[0.15, 0.08, 0.2], [-0.14, 0.08, -0.12]];
    addTo(p, 'chest', 0.2); addTo(p, 'spine', 0.08);
    const dial = Math.sin(t * 2.6);
    addTo(p, 'rSh', -1.15, 0, -0.08); addTo(p, 'rEl', -0.45, 0.2); addTo(p, 'rWr', 0, dial * 0.9, 0); addTo(p, 'rFi', -0.9);
    p.hands = { r: [-0.03, 0.68 + Math.sin(t * 2.6) * 0.01, 0.49] };
    const flip = sstep(0.0, 0.25, Math.sin(t * 0.8)) * 0.6;
    addTo(p, 'lSh', -0.15 - flip * 0.1, 0, 0.75); addTo(p, 'lEl', -1.2 + flip * 0.5, -0.5); addTo(p, 'lWr', 0, 0, flip * 1.2); addTo(p, 'lFi', -0.3);
    addTo(p, 'head', 0.22, -0.1 + flip * 0.25, 0);
    return p;
  },
  training(t) { // stand at the whiteboard, write with the right hand, point at the pattern book now and then
    const p = blank(), ph = t % 7, pointing = sstep(4.6, 5.0, ph) * (1 - sstep(6.4, 6.9, ph));
    
    const wx = Math.sin(t * 5) * 0.09, wy = Math.cos(t * 5) * 0.06, sweep = ((t * 0.25) % 1) * 0.5 - 0.25;
    addTo(p, 'hips', 0, -0.1, 0); addTo(p, 'chest', 0.06 + Math.sin(t * 0.9) * 0.04, -0.15 + sweep * 0.4);
    addTo(p, 'rSh', -1.6 + wy * 1.6 * (1 - pointing), 0, -0.25 + sweep + wx * 1.6 * (1 - pointing)); addTo(p, 'rEl', -1.25 + pointing * 0.85); addTo(p, 'rWr', 0.3, 0, 0); addTo(p, 'rFi', -1.0);
    addTo(p, 'lSh', 0.05 - pointing * 0.5, 0, 0.12); addTo(p, 'lEl', -0.35 - pointing * 0.9, -0.3 * pointing); addTo(p, 'lFi', -0.3 - pointing * 0.6);
    p.hands = { r: [-0.06 + sweep * 0.6 + wx, 1.22 + wy * 1.2, 0.36] }; p.handDir = { r: 'up' };
    addTo(p, 'head', -0.1, -0.15 + sweep * 0.6 + pointing * 0.5, 0);
    addTo(p, 'lKn', 0.05); addTo(p, 'rKn', 0.12);
    return p;
  },
  forge(t) { // lean over the bench, both hands tinkering, head down
    const p = blank();
    addTo(p, 'chest', 0.32); addTo(p, 'spine', 0.1); addTo(p, 'lKn', 0.12); addTo(p, 'rKn', 0.12); addTo(p, 'lHip', -0.08); addTo(p, 'rHip', -0.08);
    addTo(p, 'lSh', -1.05 + Math.sin(t * 6.1) * 0.06, 0, 0.12); addTo(p, 'lEl', -0.65, -0.4); addTo(p, 'lWr', Math.sin(t * 7.3) * 0.35, 0, 0); addTo(p, 'lFi', -0.9);
    addTo(p, 'rSh', -1.05 + Math.sin(t * 4.3 + 1) * 0.08, 0, -0.08 + Math.sin(t * 3.1) * 0.08); addTo(p, 'rEl', -0.65 + Math.sin(t * 8.5) * 0.1, 0.35); addTo(p, 'rWr', 0, Math.sin(t * 9) * 0.5, 0); addTo(p, 'rFi', -1.1);
    p.hands = { l: [0.15 + Math.sin(t * 6.1) * 0.03, 0.97 + Math.max(0, Math.sin(t * 7.3)) * 0.012, 0.56], r: [-0.14 + Math.sin(t * 3.1) * 0.04, 0.985 + Math.max(0, Math.sin(t * 8.5)) * 0.012, 0.56 + Math.sin(t * 4.3) * 0.03] };
    addTo(p, 'head', 0.38, Math.sin(t * 0.7) * 0.15, 0);
    return p;
  },
  hq(t) { // face the goal board: point and tap at it, then cross the arms and review
    const p = blank(), ph = t % 8, point = 1 - sstep(3.4, 4.0, ph) + sstep(7.4, 8.0, ph), cross = 1 - point;
    const tf = (ph - 1.5) % 0.6, tap = point * (ph > 1.5 && ph < 3.3 ? sstep(0, 0.12, tf) * (1 - sstep(0.38, 0.5, tf)) : 0); // three taps, each held ~0.25 s on the board
    addTo(p, 'rSh', -1.75 * point - 0.55 * cross + tap * 0.18, 0, -0.25 * point + 0.55 * cross); addTo(p, 'rEl', -0.12 * point - 1.95 * cross, 0.8 * cross); addTo(p, 'rFi', -0.2 * point - 0.8 * cross);
    addTo(p, 'lSh', 0.05 * point - 0.6 * cross, 0, 0.12 * point - 0.5 * cross); addTo(p, 'lEl', -0.3 * point - 1.9 * cross, -0.8 * cross); addTo(p, 'lFi', -0.5);
    addTo(p, 'chest', -0.04 * cross, 0.05 * point); addTo(p, 'head', -0.18 + Math.sin(t * 1.3) * 0.05 * cross, Math.sin(t * 0.5) * 0.2 * cross, 0.08 * cross);
    addTo(p, 'hips', 0, 0, 0.04 * cross); addTo(p, 'lKn', 0.1 * cross); addTo(p, 'rHip', 0, 0, -0.06 * cross);
    return p;
  },
  rig(t) { // open the rack door, lean in to inspect, tap the rack screen
    const p = blank(), ph = t % 6, door = sstep(0, 0.8, ph) * (1 - sstep(5.2, 6, ph)), tap = sstep(1.6, 2.0, ph) * (1 - sstep(4.6, 5.0, ph));
    addTo(p, 'chest', 0.04 + tap * 0.04, -0.15 * door); addTo(p, 'spine', 0.02);
    addTo(p, 'lSh', 0.05, 0, 0.12); addTo(p, 'lEl', -0.5 * door - 0.2, -0.3); addTo(p, 'lFi', -1.1 * door - 0.3);
    addTo(p, 'rFi', -0.3 - tap * 0.5); if (tap > 0.02) { p.hands = { r: [-0.05, 1.05 + (1 - tap) * -0.3, 0.12 + tap * (0.205 + Math.max(0, Math.sin(t * 8)) * 0.01)] }; p.handDir = { r: 'up' }; }
    addTo(p, 'lSh', 0, 0, 0); // door gesture stays sideways (out of the racks)
    addTo(p, 'head', 0.05 + tap * 0.06, 0.35 * door - tap * 0.15, 0);
    return p;
  },
  terminals(t) { // stand-up typing at an agent pod, glancing at the log, leaning in to read, then pointing at the screen
    const p = blank(), ph = t % 7, point = Math.min(1, Math.max(0, (ph - 4.8) / 0.4)) * (1 - Math.min(1, Math.max(0, (ph - 6.4) / 0.4)));
    addTo(p, 'chest', 0.38 + Math.sin(t * 0.9) * 0.12, Math.sin(t * 0.5) * 0.12); addTo(p, 'spine', 0.12); addTo(p, 'lKn', 0.08); addTo(p, 'rKn', 0.08 + Math.max(0, Math.sin(t * 0.45)) * 0.15); addTo(p, 'lHip', -0.1); addTo(p, 'rHip', -0.1);
    const ty = (side, ph2, w) => { addTo(p, side + 'Sh', (-0.9 + Math.sin(t * 9 + ph2) * 0.06) * w, 0, (side === 'l' ? 1 : -1) * 0.15); addTo(p, side + 'El', (-0.62 + Math.sin(t * 12 + ph2) * 0.08) * w, side === 'l' ? -0.4 : 0.4); addTo(p, side + 'Wr', 0.35 * w + Math.sin(t * 10 + ph2) * 0.15); addTo(p, side + 'Fi', -0.5 + Math.sin(t * 16 + ph2) * 0.6); };
    ty('l', 0, 1); ty('r', 2.1, 1 - point); p.root[1] -= 0.06;
    p.hands = { l: [0.17, 0.752 + Math.max(0, Math.sin(t * 9)) * 0.012, 0.47] }; if (point < 0.5) p.hands.r = [-0.07, 0.775 + Math.max(0, Math.sin(t * 9 + 2.1)) * 0.012, 0.47];
    addTo(p, 'rSh', -1.35 * point, 0, -0.1 * point); addTo(p, 'rEl', -0.15 * point); addTo(p, 'rFi', -0.3 * point);
    addTo(p, 'head', -0.05 + Math.sin(t * 0.8) * 0.1, Math.sin(t * 0.6) * 0.5 * (1 - point), Math.sin(t * 0.4) * 0.08);
    return p;
  },
  lounge(t) { // sit back, both arms hooked over the backrest: upper arms ~40 deg down, elbows ~100 deg, forearms on its top
    const p = blank(); seated(p, SOFA_SEAT + 0.05, 0.45);
    addTo(p, 'chest', -0.28 + Math.sin(t * 1.4) * 0.005); addTo(p, 'spine', -0.1);
    addTo(p, 'lFi', -0.35); addTo(p, 'rFi', -0.35);
    addTo(p, 'head', -0.05, Math.sin(t * 0.25) * 0.4, 0.05);
    // solved by aiming the bones at points on the sofa_back proxy (top 0.666 m): elbow 3 cm and wrist 2.5 cm above it;
    // the first 0.9 s go through a low side waypoint (found by sampling the shortest-arc path) so the arm never cuts it
    const A = t < 0.9 ? LOUNGE_WAY : LOUNGE_ARM;
    addTo(p, 'lSh', A[0], A[1], A[2]); addTo(p, 'lEl', A[3], 0, 0); addTo(p, 'rSh', A[0], -A[1], -A[2]); addTo(p, 'rEl', A[3], 0, 0);
    return p;
  },
};
STATION.minis = STATION.terminals;

function makeAnimator(bones, rest) {
  const QJ = ['lSh', 'rSh'], _qT = new THREE.Quaternion(), _eT = new THREE.Euler();
  let gY = 0; const cur = blank(), state = { ph: 0, blink: 0, nextBlink: 2 }; cur.ikW = 1; cur.feet = STAND_FEET.map(f => f.slice()); cur.hw = { l: 0, r: 0 }; cur.hand = { l: null, r: null }; cur.q = { lSh: new THREE.Quaternion(), rSh: new THREE.Quaternion() };
  const A = 0.37, B = 0.38;
  const mHips = new THREE.Matrix4(), qH = new THREE.Quaternion(), eH = new THREE.Euler(), v = new THREE.Vector3(), hj = new THREE.Vector3();
  // two-bone leg IK in the robot's root space: ankle at `foot`, knee bending forward, sole kept level
  function solveLeg(side, foot, w) {
    const hip = bones[side + 'Hip'], kn = bones[side + 'Kn'], an = bones[side + 'An'];
    hj.copy(hip.position).applyMatrix4(mHips);
    v.set(foot[0], foot[1], foot[2]).sub(hj).applyQuaternion(qH.clone().invert());
    let L = v.length(); const Lc = Math.min(A + B - 1e-3, Math.max(0.08, L)); v.multiplyScalar(Lc / L); L = Lc;
    const beta = Math.PI - Math.acos(Math.min(1, Math.max(-1, (A * A + B * B - L * L) / (2 * A * B))));
    const delta = Math.atan2(B * Math.sin(beta), A + B * Math.cos(beta));
    const vx = v.x / L, vy = v.y / L, vz = v.z / L;
    const gam = Math.asin(Math.max(-1, Math.min(1, vx / Math.cos(delta))));
    const c = Math.cos(gam) * Math.cos(delta), s2 = Math.sin(delta);
    const alpha = Math.atan2(-vz, -vy) - Math.atan2(s2, c);
    const mix = (o, k) => o * (1 - w) + k * w;
    hip.rotation.set(mix(hip.rotation.x, alpha), mix(hip.rotation.y, 0), mix(hip.rotation.z, gam));
    kn.rotation.set(mix(kn.rotation.x, beta), 0, 0);
    an.rotation.set(mix(an.rotation.x, -(alpha + beta) - eH.x), 0, mix(an.rotation.z, -gam));
  }
  // two-bone arm IK (world space, solved in the chest frame): wrist at `tgt` (robot root space), elbow bending forward
  const qC = new THREE.Quaternion(), w1 = new THREE.Vector3(), w2 = new THREE.Vector3(), AU = 0.27, AF = 0.245;
  function solveArm(side, tgt, w, dir) {
    const sh = bones[side + 'Sh'], el = bones[side + 'El'];
    w1.set(tgt[0], tgt[1], tgt[2]).applyMatrix4(bones.root.parent.matrixWorld);
    sh.getWorldPosition(w2); w1.sub(w2);
    sh.parent.getWorldQuaternion(qC); w1.applyQuaternion(qC.invert());
    let L = w1.length(); const Lc = Math.min(AU + AF - 2e-3, Math.max(0.06, L)); w1.multiplyScalar(Lc / L); L = Lc;
    const beta = Math.PI - Math.acos(Math.min(1, Math.max(-1, (AU * AU + AF * AF - L * L) / (2 * AU * AF))));
    const delta = Math.atan2(AF * Math.sin(beta), AU + AF * Math.cos(beta));
    const vx = w1.x / L, vy = w1.y / L, vz = w1.z / L;
    const gam = Math.asin(Math.max(-1, Math.min(1, vx / Math.cos(delta))));
    const c = Math.cos(gam) * Math.cos(delta), s2 = Math.sin(delta);
    const alpha = Math.atan2(-vz, -vy) - Math.atan2(-s2, c);
    const mix = (o, k) => o * (1 - w) + k * w;
    sh.rotation.set(mix(sh.rotation.x, alpha), mix(sh.rotation.y, 0), mix(sh.rotation.z, gam));
    el.rotation.set(mix(el.rotation.x, -beta), mix(el.rotation.y, 0), mix(el.rotation.z, 0));
    // hand orientation: 'fwd' = level, pointing forward (keys, bench); 'up' = flat against a vertical surface
    const torso = bones.hips.rotation.x + bones.spine.rotation.x + bones.chest.rotation.x;
    const want = (-Math.PI / 2 - dir * Math.PI / 2) - (alpha - beta) - torso; // dir: 0 = 'fwd' .. 1 = 'up' (blended)
    bones[side + 'Wr'].rotation.set(mix(bones[side + 'Wr'].rotation.x, want), mix(bones[side + 'Wr'].rotation.y, 0), mix(bones[side + 'Wr'].rotation.z, -gam));
  }
  function apply(target, dt, rate, calm = false) {
    const k = 1 - Math.exp(-dt * rate);
    // eased approach with a joint speed limit: a new pose never snaps in, however far away it is
    for (const j of J) { const wm = (/Fi$/.test(j) ? 9 : /Wr$/.test(j) ? 6 : calm && /Sh$|El$/.test(j) ? 2.8 : 4.5) * dt; for (let i = 0; i < 3; i++) { const d = (target[j][i] - cur[j][i]) * k; cur[j][i] += d > wm ? wm : d < -wm ? -wm : d; } }
    for (let i = 0; i < 3; i++) cur.root[i] += (target.root[i] - cur.root[i]) * k;
    cur.ikW += ((target.feet ? 1 : 0) - cur.ikW) * Math.min(1, dt * 10);
    if (target.feet) for (let f = 0; f < 2; f++) for (let i = 0; i < 3; i++) cur.feet[f][i] += (target.feet[f][i] - cur.feet[f][i]) * k;
    for (const j of J) if (!QJ.includes(j)) bones[j].rotation.set(cur[j][0], cur[j][1], cur[j][2]);
    for (const j of QJ) { // shoulders: rotate toward the target orientation along the shortest arc
      const qt = _qT.setFromEuler(_eT.set(target[j][0], target[j][1], target[j][2])), qc = cur.q[j];
      const ang = qc.angleTo(qt), step = Math.min(ang * k, (calm ? 2.8 : 4.5) * dt); if (ang > 1e-5) qc.rotateTowards(qt, step);
      bones[j].quaternion.copy(qc); _eT.setFromQuaternion(qc); cur[j][0] = _eT.x; cur[j][1] = _eT.y; cur[j][2] = _eT.z; }
    bones.lF2.rotation.x = cur.lFi[0] * 0.9; bones.rF2.rotation.x = cur.rFi[0] * 0.9;
    bones.hips.position.set(rest.hips.x + cur.root[0], rest.hips.y + cur.root[1], rest.hips.z + cur.root[2]);
    eH.set(cur.hips[0], cur.hips[1], cur.hips[2]); qH.setFromEuler(eH); mHips.compose(bones.hips.position, qH, new THREE.Vector3(1, 1, 1));
    if (cur.ikW > 0.001) { const fl = [cur.feet[0][0], cur.feet[0][1] + gY + 0.004, cur.feet[0][2]], fr = [cur.feet[1][0], cur.feet[1][1] + gY + 0.004, cur.feet[1][2]]; solveLeg('l', fl, cur.ikW); solveLeg('r', fr, cur.ikW); }
    for (const sd of ['l', 'r']) {
      const tg = target.hands && target.hands[sd];
      { const dw = (tg ? 1 : 0) - cur.hw[sd], st = dt * 2.2; cur.hw[sd] += dw > st ? st : dw < -st ? -st : dw; } // linear IK blend: no fast swing when a hand target appears or goes
      if (tg) {
        if (!cur.hand[sd] || cur.hw[sd] < 0.05) { const wp = bones[sd + 'Wr'].getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(bones.root.parent.matrixWorld).invert()); cur.hand[sd] = wp.toArray(); }
        // retracting: pull back before lowering; reaching: rise before going forward (clears desk edges)
        const h = cur.hand[sd], back = tg[2] < h[2], dy = Math.abs(tg[1] - h[1]), dz = Math.abs(tg[2] - h[2]);
        const ky = back ? (dz > 0.06 ? 1.2 : 9) : 14, kz = back ? 14 : (dy > 0.06 ? 1.2 : 9);
        // reaching up and over an edge: tuck the hand in toward the body while it rises, then go forward
        const tz = !back && dy > 0.06 && tg[1] > h[1] ? Math.min(h[2], -0.06) : tg[2], kz2 = !back && dy > 0.06 && tg[1] > h[1] ? 6 : kz;
        const sx = (tg[0] - h[0]) * Math.min(1, dt * 10), sy = (tg[1] - h[1]) * Math.min(1, dt * ky), sz = (tz - h[2]) * Math.min(1, dt * kz2), sl = Math.hypot(sx, sy, sz), vm = 1.3 * dt, sc = sl > vm ? vm / sl : 1;
        h[0] += sx * sc; h[1] += sy * sc; h[2] += sz * sc;
      }
      const hdT = target.handDir && target.handDir[sd] === 'up' ? 1 : 0; cur.hd = cur.hd || { l: 0, r: 0 }; cur.hd[sd] += Math.max(-dt * 3, Math.min(dt * 3, hdT - cur.hd[sd]));
      if (cur.hw[sd] > 0.001 && cur.hand[sd]) { bones.root.parent.updateMatrixWorld(true); solveArm(sd, cur.hand[sd], cur.hw[sd], cur.hd[sd]); }
    }
    // free legs (walking): keep the lower foot on the floor by adjusting the pelvis height
    if (cur.ikW < 0.999 || true) {
      bones.root.updateMatrixWorld(true);
      const yl = bones.lAn.getWorldPosition(v).y, yr = bones.rAn.getWorldPosition(v).y, pm = bones.root.parent ? bones.root.parent.matrixWorld.elements[13] : 0;
      const lowest = Math.min(yl, yr) - pm, d = 0.084 + gY - lowest; bones.hips.position.y += d > 0 ? d : d * (1 - cur.ikW);
    }
  }
  return {
    cur,
    update(dt, t, { speed = 0, station = null, stationT = 0, rate = 9, groundY = 0, back = false } = {}) {
      gY += (groundY - gY) * Math.min(1, dt * 8);
      let target;
      if (station && STATION[station]) target = STATION[station](stationT);
      else {
        const run = speed > 2.4, a = Math.min(1, speed / (run ? 4.2 : 1.55));
        state.ph += (back ? -1 : 1) * dt * speed * Math.PI / (run ? 1.15 : 0.66);
        const idl = idle(t), loc = locomotion(state.ph, a, run), w = Math.min(1, speed / 0.5);
        target = blank();
        for (const j of [...J, 'root']) for (let i = 0; i < 3; i++) target[j][i] = idl[j][i] * (1 - w) + loc[j][i] * w;
        target.feet = w > 0.5 ? null : idl.feet;
      }
      apply(target, dt, station ? Math.min(rate, 6) : rate, !!station || speed < 0.3);
      // blink
      state.nextBlink -= dt; if (state.nextBlink < 0) { state.blink = 0.14; state.nextBlink = 2 + Math.random() * 3.5; }
      state.blink = Math.max(0, state.blink - dt); const b = state.blink > 0 ? 0.12 : 1;
      bones.eyes.scale.y += (b - bones.eyes.scale.y) * Math.min(1, dt * 30);
    },
    stations: Object.keys(STATION),
  };
}
