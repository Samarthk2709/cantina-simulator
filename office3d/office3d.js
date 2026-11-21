// First Office 3D: the office as a cinematic third-person 3D room (three.js), drawn over the 2D game.
// The 2D world (original/world.js) keeps all the game logic: stations, the "near a desk" check, E to open a window,
// saved position. This file draws the room (room.js, kit.js), moves the founder (world.setPose) and runs the camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { C, A, K, T, X0, X1, Z0, Z1, H, makeMaterials, allTextures, gltf, hazeMats } from './kit.js';
import { buildRoom, buildSkyline, tickRoom, getGoalTex } from './room.js';

const Q = new URLSearchParams(location.search);
const SKY_YAW = +(Q.get('sky') || 0.75);
const ENV_POS = new THREE.Vector3(7.5, 1.25, 5.6);

function want3d() {
  if (Q.has('2d')) return false;
  if (navigator.webdriver && !Q.has('3d')) return false; // automated tests keep the 2D office unless they ask
  if (matchMedia('(pointer: coarse)').matches && !Q.has('3d')) return false; // touch screens keep the 2D office and its pad
  try { const c = document.createElement('canvas'); if (!c.getContext('webgl2')) return false; } catch { return false; }
  return true;
}
let quality = Q.get('q') || (() => { try { return localStorage.getItem('fo.q3d'); } catch { return null; } })() || 'high';

// ---------- shader patch: box-projected (parallax-corrected) reflections ----------
// The room is a box, so reflections of the baked room cube map are corrected against its walls: the glossy floor and
// desks then reflect the windows, lamps and screens in the right places instead of at infinity.
function patchShaders() {
  const S = THREE.ShaderChunk, f = n => n.toFixed(3);
  S.common += `\n#ifdef STANDARD\nvarying vec3 vBPWorld;\n#endif\n`;
  S.worldpos_vertex += `\n#ifdef STANDARD\n{ vec4 bpw = vec4( transformed, 1.0 );\n#ifdef USE_BATCHING\nbpw = batchingMatrix * bpw;\n#endif\n#ifdef USE_INSTANCING\nbpw = instanceMatrix * bpw;\n#endif\nvBPWorld = ( modelMatrix * bpw ).xyz; }\n#endif\n`;
  const fn = `
#ifdef STANDARD
vec3 bpParallax( vec3 v ) {
  vec3 bmin = vec3(${f(X0)}, -0.01, ${f(Z0)}), bmax = vec3(${f(X1)}, ${f(H)}, ${f(Z1)});
  vec3 p = clamp( vBPWorld, bmin + 0.01, bmax - 0.01 );
  vec3 vv = v + vec3(1e-5);
  vec3 r = max( (bmax - p) / vv, (bmin - p) / vv );
  float d = min( min( r.x, r.y ), r.z );
  return normalize( p + v * d - vec3(${f(ENV_POS.x)}, ${f(ENV_POS.y)}, ${f(ENV_POS.z)}) );
}
#endif
`;
  // Light culling in the shader: skip the BRDF for punctual lights that don't reach this pixel (out of range / outside
  // the cone), and fade rect area lights out past ~5 m. Neighbouring pixels agree, so the branch is cheap.
  S.lights_fragment_begin = S.lights_fragment_begin.replace(/RE_Direct\( directLight,/g, 'if ( directLight.visible ) RE_Direct( directLight,')
    .replace('RE_Direct_RectArea( rectAreaLight,', '{ vec3 rlv = rectAreaLight.position - geometryPosition; float rd2 = dot( rlv, rlv ); if ( rd2 < 30.0 ) { rectAreaLight.color *= 1.0 - smoothstep( 10.0, 30.0, rd2 ); RE_Direct_RectArea( rectAreaLight,')
    .replace(/(RE_Direct_RectArea\( rectAreaLight,[^;]*;)/, '$1 } }');
  const old = 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );';
  if (S.envmap_physical_pars_fragment.includes(old)) {
    S.envmap_physical_pars_fragment = S.envmap_physical_pars_fragment.replace('#ifdef USE_ENVMAP', '#ifdef USE_ENVMAP\n' + fn)
      .replace(old, old + '\n#ifdef STANDARD\nreflectVec = bpParallax( reflectVec );\n#endif');
  }
}

// ---------- irradiance volume (GI-lite) ----------
// A 3D grid of indirect light over the room, rebuilt from the light rig whenever desks power on/off: each practical
// adds the light that bounces off what it hits (spot pools on the floor, lamp shades, screens, moonlit floor patches,
// the city glow at the windows). Every lit material adds it as ambient irradiance, sampled a little off the surface
// along its normal, so walls, beams and the ceiling pick up soft colour from nearby lamps instead of falling to black.
const IRR = { nx: 28, ny: 8, nz: 20, tex: null, u: { irrVol: { value: null }, irrMin: { value: new THREE.Vector3(X0, 0, Z0) }, irrSize: { value: new THREE.Vector3(X1 - X0, H, Z1 - Z0) }, irrK: { value: +(Q.get('gi') || 0.65) } } };
function irrSources() {
  const src = [], add = (x, y, z, col, p, r0) => src.push({ x, y, z, r: col.r * p, g: col.g * p, b: col.b * p, r0 });
  for (const l of C.lights) {
    if (!l.visible || l.intensity <= 0) continue;
    if (l.isPointLight) add(l.position.x, l.position.y, l.position.z, l.color, l.intensity * 0.35, 0.35);
    else if (l.isSpotLight) { add(l.target.position.x, 0.15, l.target.position.z, l.color, l.intensity * 0.09, 0.9); add(l.position.x, l.position.y, l.position.z, l.color, l.intensity * 0.012, 0.3); }
    else if (l.isRectAreaLight) { const n = new THREE.Vector3(0, 0, -1).applyQuaternion(l.quaternion); add(l.position.x + n.x * 0.4, l.position.y + n.y * 0.4, l.position.z + n.z * 0.4, l.color, l.intensity * l.width * l.height * 0.35, 0.5); }
  }
  const moon = C.moon, cool = new THREE.Color(0x7d95d8);
  for (const w of C.windows || []) {
    const ac = (w.a0 + w.a1) / 2, wc = w.axis === 'z' ? [ac, w.at + 0.4] : [w.at + 0.4, ac], area = (w.a1 - w.a0) * (w.y1 - w.y0);
    add(wc[0], (w.y0 + w.y1) / 2, wc[1], cool, area * 0.18, 0.8); // city glow through the glass
    if (moon && w.axis === 'x') { const t = ((w.y0 + w.y1) / 2) / -MOON.y; add(w.at + MOON.x * t, 0.1, ac + MOON.z * t, moon.color, moon.intensity * area * 0.11 * (1 - w.blind * 0.6), 1.2); }
  }
  return src;
}
const MOON = new THREE.Vector3(0.62, -0.5, 0.6).normalize();
function bakeIrradiance() {
  const { nx, ny, nz } = IRR, data = new Uint16Array(nx * ny * nz * 4), src = irrSources();
  const sx = (X1 - X0) / nx, sy = H / ny, sz = (Z1 - Z0) / nz, h = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = X0 + (i + 0.5) * sx, y = (j + 0.5) * sy, z = Z0 + (k + 0.5) * sz; let r = 0, g = 0, b = 0;
    for (const s of src) { const d2 = (s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2, f = 1 / (d2 + s.r0 * s.r0); r += s.r * f; g += s.g * f; b += s.b * f; }
    const o = ((k * ny + j) * nx + i) * 4; data[o] = h(r); data[o + 1] = h(g); data[o + 2] = h(b); data[o + 3] = h(1);
  }
  if (!IRR.tex) { IRR.tex = new THREE.Data3DTexture(data, nx, ny, nz); IRR.tex.type = THREE.HalfFloatType; IRR.tex.format = THREE.RGBAFormat; IRR.tex.minFilter = IRR.tex.magFilter = THREE.LinearFilter; IRR.tex.wrapS = IRR.tex.wrapT = IRR.tex.wrapR = THREE.ClampToEdgeWrapping; IRR.tex.unpackAlignment = 1; IRR.u.irrVol.value = IRR.tex; }
  else IRR.tex.image.data = data;
  IRR.tex.needsUpdate = true;
}
function installIrradiance() {
  const decl = `uniform highp sampler3D irrVol; uniform vec3 irrMin, irrSize; uniform float irrK;\n`;
  const use = `
#ifdef STANDARD
  { vec3 wn = inverseTransformDirection( geometryNormal, viewMatrix ); vec3 q = ( vBPWorld + wn * 0.3 - irrMin ) / irrSize;
    vec3 gi = texture( irrVol, clamp( q, vec3( 0.0 ), vec3( 1.0 ) ) ).rgb * irrK;
    irradiance += gi * ( 0.85 + 0.15 * wn.y ); }
#endif
`;
  THREE.MeshStandardMaterial.prototype.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, IRR.u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + decl).replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + use);
  };
}

// ---------- scene ----------
let renderer, scene, camera, composer, gtao, bloom, smaa, grade, cine, tPrev = 0, t0 = 0;
let world, G;

// ---------- Nib: a small hovering drone that follows Nib's position in the 2D game ----------
let nib3d;
function buildNib() {
  const M = C.M, g = new THREE.Group(); scene.add(g); nib3d = g;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 })); body.castShadow = true; g.add(body);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.162, 32, 20, -0.9, 1.8, 0.95, 0.9), new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.05, clearcoat: 1 })); g.add(face);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.2, 1.5) })); e.position.set(s * 0.045, 0.02, 0.155); g.add(e); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 40), M.alu); ring.rotation.x = Math.PI / 2; g.add(ring);
  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.004, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.2, 1.5) })); glowRing.rotation.x = Math.PI / 2; glowRing.position.y = -0.012; g.add(glowRing);
  const l = new THREE.PointLight(0x7ae8ff, 0.35, 1.6, 2); l.position.set(0, -0.1, 0.25); g.add(l);
}

// ---------- the player ----------
// The founder: the Ready Player Me sample avatar from the three.js examples, animated with the X Bot's idle/walk/run
// (Mixamo clips), retargeted at load because the two rigs have different rest poses (A-pose vs T-pose).
let charLight, player, model, mixer, actions = {}, playerRadius = 0.2;
async function buildPlayer() {
  const CH = Q.get('char') === 'rpm' ? 'founder.glb' : 'founder3.glb';
  const [dst, src] = await Promise.all([gltf.loadAsync(A + 'char/' + CH), gltf.loadAsync(A + 'char/anims.glb')]);
  model = dst.scene;
  const clips = {}; for (const n of ['idle', 'walk', 'run']) clips[n] = retarget(src.scene, src.animations.find(a => a.name === n), model);
  const tl = new THREE.TextureLoader(), roughT = {};
  if (CH === 'founder3.glb') for (const part of ['body', 'head']) { const t = tl.load(A + `char/founder3_${part}_rough.jpg`); t.flipY = false; roughT[part] = t; }
  model.traverse(o => {
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const m = o.material; if (!m) return;
    if (CH === 'founder3.glb') {
      // The founder (Microsoft Rocketbox avatar, MIT): photo-sourced diffuse + normal maps, roughness from its specular
      // map. Denim and cotton get a cloth sheen; the head is skin with a slightly tighter highlight.
      const head = /head/.test(m.name);
      o.material = new THREE.MeshPhysicalMaterial({
        map: m.map, normalMap: m.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: roughT[head ? 'head' : 'body'],
        roughness: head ? 0.78 : 1.0, metalness: 0, envMapIntensity: 0.85, side: THREE.FrontSide,
        sheen: head ? 0.15 : 0.6, sheenRoughness: head ? 0.4 : 0.75, sheenColor: new THREE.Color(head ? 0x8a5a48 : 0x5a6a80), specularIntensity: head ? 0.7 : 0.4,
      });
      o.material.name = m.name;
    } else {
      m.envMapIntensity = 0.7;
      if (/Skin|Body|Head/.test(m.name)) m.roughness = 0.58;
      if (/Outfit|Headwear/.test(m.name)) m.roughness = Math.max(0.75, m.roughness ?? 1);
    }
  });
  model.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(model); model.scale.multiplyScalar((CH === 'founder3.glb' ? 1.78 : 1.8) / (b.max.y - b.min.y));
  player = new THREE.Group(); player.add(model); scene.add(player);
  // soft 'character light' that keeps the founder readable against the dark room (a standard third-person trick)
  charLight = new THREE.PointLight(0xffe0c4, 0.9, 2.6, 2); scene.add(charLight);
  // soft contact shadow blob under the feet (grounds the character under any light)
  const blobT = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })());
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: blobT, transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.006; blob.userData.noAO = true; player.add(blob);
  mixer = new THREE.AnimationMixer(model);
  for (const k in clips) { actions[k] = mixer.clipAction(clips[k]); actions[k].play(); actions[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
}
const base = n => n.replace(/^mixamorig:?/, '');
function retarget(src, clip, dst) {
  const sb = {}, db = []; src.traverse(o => { if (o.isBone) sb[base(o.name)] = o; }); dst.traverse(o => { if (o.isBone && sb[base(o.name)]) db.push(o); });
  src.updateMatrixWorld(true); dst.updateMatrixWorld(true);
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
    const w = dHipW.clone(); w.y += (wp(sb.Hips).y - sHip.y) * scale; w.applyMatrix4(hipParentInv); pv.set([w.x, w.y, w.z], i * 3);
  }
  mx.stopAllAction(); mx.uncacheRoot(src);
  const tracks = db.map(b => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(hip.name + '.position', times, pv));
  return new THREE.AnimationClip(clip.name, (n - 1) / fps, tracks);
}

// ---------- input + camera ----------
const keys = {};
let yaw = 0, pitch = 0.2, dist = 2.6, camPos = new THREE.Vector3(), camInit = false;
const pos = new THREE.Vector3();
let heading = Math.PI, speedNow = 0;
let freeCam = null; // shots: {p, t, fov, focus, ap} or {follow: offset}
function ignoreKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  const el = e.target; return !!(el && el.closest && (el.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]')));
}
const MOVE = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
function bindInput(canvas) {
  addEventListener('keydown', e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = true; const m = MOVE[e.code]; if (!m || ignoreKey(e)) return; keys[m] = true; freeCam = null; e.preventDefault(); });
  addEventListener('keyup', e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = false; const m = MOVE[e.code]; if (m) keys[m] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); freeCam = null; });
  canvas.addEventListener('pointermove', e => {
    if (document.pointerLockElement === canvas) { yaw -= e.movementX * 0.0035; pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.003, -0.5, 1.1); return; }
    if (!drag) return; yaw -= (e.clientX - drag.x) * 0.006; pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.004, -0.5, 1.1); drag = { x: e.clientX, y: e.clientY };
  });
  const up = () => { drag = null; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => canvas.requestPointerLock?.());
  canvas.addEventListener('wheel', e => { dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.002, 1.3, 4.2); e.preventDefault(); }, { passive: false });
}
// Station footprints the game hides (not unlocked yet) are open floor in 2D, but the 3D room still shows their desk
// (powered down), so they are solid here.
let hiddenRects = [];
function blockedAt(x, z) {
  if (!world.walkable(x / K, z / K)) return true;
  const r = playerRadius;
  for (const c of C.colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  for (const c of hiddenRects) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  return false;
}
const ray = new THREE.Raycaster();
const blend = { idle: 1, walk: 0, run: 0 };
const keysHeld = () => keys.f || keys.b || keys.l || keys.r;
function updatePlayer(dt) {
  const st = world.getState(), active = world.active() && st.room === 'office';
  const gx = st.x * K, gz = st.y * K;
  if (Math.hypot(gx - pos.x, gz - pos.z) > 0.08 && !keysHeld()) { const dx = gx - pos.x, dz = gz - pos.z; if (world.routing()) heading = Math.atan2(dx, dz); pos.x = gx; pos.z = gz; }
  let fx = 0, fz = 0;
  if (active || keys.shot) { const f = (keys.f ? 1 : 0) - (keys.b ? 1 : 0), r = (keys.r ? 1 : 0) - (keys.l ? 1 : 0); fx = -Math.sin(yaw) * f + Math.cos(yaw) * r; fz = -Math.cos(yaw) * f - Math.sin(yaw) * r; }
  const n = Math.hypot(fx, fz), target = n ? (keys.run ? 4.2 : 1.55) : 0;
  speedNow += (target - speedNow) * Math.min(1, dt * (target > speedNow ? 6 : 9));
  let moved = false;
  if (n) { fx /= n; fz /= n; const want = Math.atan2(fx, fz), d = ((want - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI; heading += d * Math.min(1, dt * 10); }
  if (speedNow > 0.02) {
    const dirx = n ? fx : Math.sin(heading), dirz = n ? fz : Math.cos(heading), step = speedNow * dt;
    const nx = pos.x + dirx * step, nz = pos.z + dirz * step;
    if (!blockedAt(nx, pos.z)) { pos.x = nx; moved = true; }
    if (!blockedAt(pos.x, nz)) { pos.z = nz; moved = true; }
    if (moved) { const facing = Math.abs(dirx) > Math.abs(dirz) ? (dirx < 0 ? 'left' : 'right') : (dirz < 0 ? 'up' : 'down'); world.setPose(pos.x / K, pos.z / K, facing, true); }
  }
  const routeMoving = world.routing();
  player.position.copy(pos); player.rotation.y = heading;
  const sp = routeMoving ? 1.55 : moved ? speedNow : 0;
  const wWalk = THREE.MathUtils.clamp(sp / 1.55, 0, 1) * (1 - THREE.MathUtils.clamp((sp - 1.55) / 2.0, 0, 1));
  const wRun = THREE.MathUtils.clamp((sp - 1.55) / 2.0, 0, 1), wIdle = 1 - THREE.MathUtils.clamp(sp / 1.0, 0, 1);
  blend.idle += (wIdle - blend.idle) * Math.min(1, dt * 8); blend.walk += (wWalk - blend.walk) * Math.min(1, dt * 8); blend.run += (wRun - blend.run) * Math.min(1, dt * 8);
  const sum = blend.idle + blend.walk + blend.run || 1;
  for (const k in actions) actions[k].setEffectiveWeight(blend[k] / sum);
  // stride-matched playback: the clip's foot speed follows the ground speed so the feet don't slide
  actions.walk.timeScale = sp > 0.1 ? THREE.MathUtils.clamp(sp / 1.55, 0.6, 1.3) : 1; actions.run.timeScale = sp > 2 ? THREE.MathUtils.clamp(sp / 4.2, 0.7, 1.2) : 1;
  mixer.update(dt);
}
const DOF = { focus: 2.6, ap: 0.12 };
function updateCamera(dt) {
  const head = new THREE.Vector3(pos.x, 1.5, pos.z);
  if (freeCam) {
    let p = freeCam.p, t = freeCam.t;
    if (freeCam.follow) { t = pos.clone().add(new THREE.Vector3(0, freeCam.ty ?? 1.05, 0)); p = t.clone().add(freeCam.follow); }
    camPos.copy(p); camera.position.copy(p); camera.lookAt(t);
    if (camera.fov !== (freeCam.fov || 50)) { camera.fov = freeCam.fov || 50; camera.updateProjectionMatrix(); }
    DOF.focus = freeCam.focus ?? p.distanceTo(t); DOF.ap = freeCam.ap ?? 0.35;
    player.visible = !freeCam.hidePlayer; if (nib3d) nib3d.visible = !freeCam.hidePlayer;
    return;
  }
  if (nib3d) nib3d.visible = true;
  if (camera.fov !== 52) { camera.fov = 52; camera.updateProjectionMatrix(); }
  const shoulder = 0.38;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const target = head.clone().addScaledVector(right, shoulder * Math.min(1, dist / 2.6));
  const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
  let want = target.clone().add(off);
  ray.set(target, off.clone().normalize()); ray.far = dist + 0.2;
  const hit = ray.intersectObjects(C.occluders, false)[0];
  if (hit) want = target.clone().addScaledVector(off.clone().normalize(), Math.max(0.35, hit.distance - 0.22));
  want.x = THREE.MathUtils.clamp(want.x, X0 + 0.15, X1 - 0.15); want.z = THREE.MathUtils.clamp(want.z, Z0 + 0.15, Z1 - 0.15); want.y = THREE.MathUtils.clamp(want.y, 0.25, H - 0.15);
  if (!camInit) { camPos.copy(want); camInit = true; }
  camPos.lerp(want, Math.min(1, dt * 12));
  camera.position.copy(camPos); camera.lookAt(target);
  player.visible = camPos.distanceTo(head) > 0.45;
  if (charLight) { const back = camPos.clone().sub(head).setY(0).normalize(); charLight.position.copy(head).addScaledVector(back, 0.9).add(new THREE.Vector3(0, 0.45, 0)).addScaledVector(right, -0.5); }
  DOF.focus += (camPos.distanceTo(head) - DOF.focus) * Math.min(1, dt * 6); DOF.ap = 0.1;
}

// ---------- prompt "E · Desk" ----------
let promptEl, lastPrompt = '';
function updatePrompt() {
  const btn = document.getElementById('interact'), label = document.getElementById('interact-label')?.textContent || '';
  const on = btn && !btn.disabled && world.active();
  const text = on ? label.replace(/^Use /, '') : '';
  if (text !== lastPrompt) { lastPrompt = text; promptEl.hidden = !text; promptEl.innerHTML = text ? `<kbd>E</kbd><span></span>` : ''; if (text) promptEl.querySelector('span').textContent = text; }
}

// ---------- depth pre-pass ----------
// The lit materials are expensive (many practical lights), so opaque geometry first lays down depth with a trivial
// shader; the lit pass then shades each pixel once instead of once per overlapping surface.
class PrepassRenderPass {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera; this.enabled = true; this.needsSwap = false; this.clear = true; this.renderToScreen = false;
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.skip = [];
  }
  collect() { this.skip = []; this.scene.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; if (o.userData.noAO || o.isSkinnedMesh || ms.some(m => m.transparent || m.alphaTest > 0 || m.alphaMap || m.isShaderMaterial || m.side === THREE.BackSide)) this.skip.push(o); }); }
  setSize() {}
  dispose() {}
  render(renderer, writeBuffer, readBuffer) {
    const S = this.scene, bg = S.background, vis = this.skip.map(o => o.visible);
    renderer.setRenderTarget(readBuffer); renderer.setClearColor(0x05070b, 1); renderer.clear(true, true, false);
    if (prepassOn) {
      this.skip.forEach(o => (o.visible = false)); S.overrideMaterial = this.mat; S.background = null;
      renderer.shadowMap.autoUpdate = true; renderer.autoClear = false; renderer.render(S, this.camera);
      S.overrideMaterial = null; S.background = bg; this.skip.forEach((o, i) => (o.visible = vis[i]));
      renderer.shadowMap.autoUpdate = false;
    }
    renderer.autoClear = false; renderer.render(S, this.camera); renderer.autoClear = true; renderer.shadowMap.autoUpdate = true;
  }
}
let prepassOn = true, prepass;

// ---------- post-processing ----------
// Cinema pass (HDR, before bloom): depth of field from the AO pass's depth buffer, plus a faint distance haze.
const CineShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.05 }, far: { value: 200 }, focus: { value: 2.6 }, ap: { value: 0.1 }, maxBlur: { value: 6 }, res: { value: new THREE.Vector2(1, 1) }, fogColor: { value: new THREE.Color(0.018, 0.024, 0.04) }, fogDensity: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform float near, far, focus, ap, maxBlur, fogDensity; uniform vec2 res; uniform vec3 fogColor; varying vec2 vUv;
    float lin(float d){ return (near * far) / (far - d * (far - near)); }
    float coc(float z){ return clamp(abs(z - focus) / max(z, 0.01) * ap, 0.0, 1.0) * maxBlur; }
    void main(){
      float zc = lin(texture2D(tDepth, vUv).x);
      float cc = coc(zc);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (cc > 0.6) {
        vec3 acc = col; float wsum = 1.0;
        const int N = 36;
        for (int i = 0; i < N; i++) {
          float fi = float(i) + 0.5; float r = sqrt(fi / float(N)) * cc; float a = fi * 2.39996;
          vec2 o = vec2(cos(a), sin(a)) * r / res;
          float zs = lin(texture2D(tDepth, vUv + o).x); float cs = coc(zs);
          float w = smoothstep(r - 1.0, r + 0.5, cs);
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          w *= 1.0 + dot(s, vec3(0.3)) * 0.6; // bright samples bloom a little into bokeh
          acc += s * w; wsum += w;
        }
        col = acc / wsum;
      }
      float f = 1.0 - exp(-min(zc, 14.0) * fogDensity);
      col = col * (1.0 - f * 0.55) + fogColor * f;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.03 }, vig: { value: 0.38 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain, vig; uniform vec2 res; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d,d);
      vec3 c = vec3(texture2D(tDiffuse, vUv - d*0.0022*r2*4.0).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d*0.0022*r2*4.0).b);
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      // split tone: cool teal shadows, warm highlights
      c = mix(c, c * vec3(0.9,1.0,1.1) + vec3(0.0,0.004,0.01), smoothstep(0.45,0.0,l)*0.7);
      c = mix(c, c * vec3(1.07,1.0,0.9), smoothstep(0.4,1.0,l)*0.55);
      c = mix(vec3(l), c, 1.1);
      // gentle S-curve around mid grey
      c = clamp(c, 0.0, 1.0); c = mix(c, c*c*(3.0-2.0*c), 0.28);
      c *= 1.0 - vig * smoothstep(0.08, 0.9, r2*2.2);
      c += (h(vUv*res + fract(time)*91.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);
    }`,
};
function buildPost() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 }));
  prepass = new PrepassRenderPass(scene, camera); composer.addPass(prepass);
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 1.4, scale: 1.15, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  cine = new ShaderPass(CineShader); cine.uniforms.tDepth.value = gtao.depthTexture; composer.addPass(cine);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.45, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  smaa = new SMAAPass(); composer.addPass(smaa);
}
function applyQuality() {
  const dpr = quality === 'ultra' ? 1.5 : Math.min(devicePixelRatio || 1, quality === 'low' ? 0.75 : quality === 'medium' ? 1 : 1.25);
  renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
  gtao.enabled = quality !== 'low'; cine.enabled = quality !== 'low';
  renderer.shadowMap.enabled = true;
  grade.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
  cine.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
  cine.uniforms.tDepth.value = gtao.depthTexture;
}

// Environment for reflections and soft bounce: a cube capture of the lit room itself, prefiltered. Captured twice so
// the second capture already contains the first one's bounce light.
function bakeEnvironment() {
  const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const cc = new THREE.CubeCamera(0.05, 80, cubeRT); cc.position.copy(ENV_POS); scene.add(cc);
  const pv = player?.visible, nv = nib3d?.visible; if (player) player.visible = false; if (nib3d) nib3d.visible = false;
  const pm = new THREE.PMREMGenerator(renderer);
  let env = null;
  for (let i = 0; i < 2; i++) {
    cc.update(renderer, scene);
    const next = pm.fromCubemap(cubeRT.texture).texture;
    if (env) env.dispose(); env = next; scene.environment = env; scene.environmentIntensity = 1.1;
  }
  if (player) player.visible = pv; if (nib3d) nib3d.visible = nv;
  cubeRT.dispose(); pm.dispose(); scene.remove(cc);
}

// ---------- stations: power state ----------
let stationKey = '', powered = {};
function syncStations(force) {
  const hidden = [];
  for (const s of window.CantinaWorld.stations) if (s.room === 'office' && C.groups[s.id] && world.walkable(s.x, s.y)) hidden.push(s);
  const key = hidden.map(s => s.id).join(',');
  if (key === stationKey && !force) return false; stationKey = key;
  hiddenRects = hidden.map(s => ({ x0: s.tx * T, z0: s.ty * T, x1: (s.tx + s.tw) * T, z1: (s.ty + s.th) * T }));
  const ids = hidden.map(s => s.id), all = Q.has('all');
  for (const id in C.power) {
    // ?all (showcase) powers every desk; otherwise desks the player hasn't unlocked stand dark. The agent terminals light
    // up once any later station (the rig) is open.
    const on = all || (id === 'terminals' ? !ids.includes('rig') : !ids.includes(id));
    if (powered[id] === on) continue; powered[id] = on;
    for (const fn of C.power[id]) fn(on);
  }
  return true;
}

// ---------- screenshot / photo views ----------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DESK_VIEWS = {
  'desk-hunt': { p: V3(8.15, 1.18, 5.05), t: V3(7.0, 0.92, 3.95), fov: 48, ap: 0.16 },
  'desk-contract': { p: V3(3.75, 1.3, 3.85), t: V3(2.45, 0.95, 2.45), fov: 50, ap: 0.16 },
  'desk-stats': { p: V3(11.75, 1.45, 3.6), t: V3(13.5, 1.15, 2.85), fov: 54, ap: 0.16 },
  'desk-training': { p: V3(11.1, 1.3, 9.1), t: V3(10.0, 0.95, 7.6), fov: 50, ap: 0.16 },
  'desk-forge': { p: V3(4.75, 1.45, 9.05), t: V3(3.65, 1.05, 7.65), fov: 50, ap: 0.16 },
  'desk-hq': { p: V3(8.9, 1.5, 3.35), t: V3(7.3, 1.45, 0.9), fov: 52, ap: 0.12 },
  'desk-rig': { p: V3(11.6, 1.25, 8.95), t: V3(14.0, 1.2, 9.2), fov: 54, ap: 0.12, focus: 1.6 },
  'desk-terminals': { p: V3(11.2, 1.6, 6.7), t: V3(13.0, 0.95, 8.2), fov: 50, ap: 0.14 },
  'lounge': { p: V3(5.7, 1.45, 7.6), t: V3(3.3, 0.6, 9.9), fov: 52, ap: 0.1 },
};
function setPlayer(x, z, h, facing) { pos.set(x, 0, z); heading = h; world.setPose(x / K, z / K, facing || 'up', false); speedNow = 0; for (const k in blend) blend[k] = k === 'idle' ? 1 : 0; }
function approach(id) { const s = window.CantinaWorld.stations.find(s => s.id === id); return s ? [s.approach.x * K, s.approach.y * K] : [7.1, 7.1]; }
function shots() {
  return [{ name: 'wide' }, { name: 'wide-west' }, { name: 'wide-ne' }, { name: 'gameplay' }, { name: 'walking', wait: 1500 }, { name: 'using-desk', wait: 3000 },
    ...Object.keys(DESK_VIEWS).map(name => ({ name }))];
}
function shot(name) {
  document.documentElement.classList.add('o3d-shot');
  for (const k in keys) keys[k] = false;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  freeCam = null; camInit = false;
  if (name === 'wide') { setPlayer(6.3, 6.4, Math.PI * 1.15, 'up'); freeCam = { p: V3(8.2, 2.2, 10.2), t: V3(7.0, 0.85, 3.0), fov: 54, ap: 0.04 }; }
  else if (name === 'wide-west') { setPlayer(6.4, 6.2, Math.PI * 1.25, 'left'); freeCam = { p: V3(1.2, 2.25, 4.3), t: V3(9.5, 0.7, 6.6), fov: 54, ap: 0.04 }; }
  else if (name === 'wide-ne') { setPlayer(9.0, 6.6, Math.PI * 0.5, 'right'); freeCam = { p: V3(12.1, 2.35, 1.25), t: V3(6.0, 0.7, 7.4), fov: 54, ap: 0.04 }; }
  else if (name === 'portrait') { setPlayer(8.6, 6.5, -Math.PI / 2 + 0.35, 'left'); freeCam = { p: V3(6.95, 1.45, 7.25), t: V3(8.6, 1.2, 6.5), fov: 40, ap: 0.12 }; }
  else if (name === 'walk-side') { setPlayer(10.9, 6.15, -Math.PI / 2, 'left'); yaw = Math.PI / 2; keys.shot = true; keys.f = true; freeCam = { follow: V3(-0.3, 0.1, 2.6), ty: 0.95, fov: 45, ap: 0.15 }; }
  else if (name === 'gameplay') { setPlayer(7.6, 7.4, Math.PI * 1.05, 'up'); yaw = -0.18; pitch = 0.16; dist = 2.4; }
  else if (name === 'walking') { setPlayer(10.9, 6.15, -Math.PI / 2, 'left'); yaw = Math.PI / 2; keys.shot = true; keys.f = true; freeCam = { follow: V3(-1.75, 0.25, 1.95), ty: 0.95, fov: 50, ap: 0.25 }; }
  else if (name === 'using-desk') { const [x, z] = approach('hunt'); setPlayer(x, z, Math.PI, 'up'); yaw = 0.35; pitch = 0.2; dist = 2.0; }
  else if (DESK_VIEWS[name]) { setPlayer(1.6, 5.2, 0, 'down'); freeCam = { ...DESK_VIEWS[name], hidePlayer: true }; }
  if (name === 'gameplay' || name === 'using-desk') keys.shot = false;
}

// ---------- main ----------
let fpsEl, frames = 0, fpsT = 0, fpsNow = 0, slowFor = 0;
async function start() {
  G = window.Stage2; world = G.world;
  RectAreaLightUniformsLib.init();
  patchShaders(); installIrradiance();
  const canvas = document.createElement('canvas'); canvas.id = 'o3d'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Your office in 3D. WASD to walk, Shift to run, drag to look, E to use a desk.');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = Q.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping; renderer.toneMappingExposure = +(Q.get('exp') || 1.0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x05070b); C.scene = scene;
  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 400);
  makeMaterials();
  buildSkyline(SKY_YAW); buildRoom(G); buildNib();
  await Promise.all([buildPlayer(), ...C.pending]);
  await Promise.all(allTextures().map(t => t.image ? null : new Promise(r => { const t1 = performance.now() + 8000; const chk = () => (t.image && (t.image.complete ?? true)) || performance.now() > t1 ? r() : setTimeout(chk, 50); chk(); })));
  scene.traverse(o => { if (o.isMesh && o.material && (o.material.transparent || o.material.isShaderMaterial)) o.userData.noAO = true; });
  t0 = performance.now() / 1000;
  const s0 = world.getState(); pos.set(s0.x * K, 0, s0.y * K); heading = Math.PI; yaw = 0;
  buildPost(); applyQuality(); prepass.collect();
  syncStations(true); bakeIrradiance(); bakeEnvironment();
  document.querySelector('.playfield').prepend(canvas);
  promptEl = document.createElement('div'); promptEl.id = 'prompt3d'; promptEl.hidden = true; document.querySelector('.playfield').appendChild(promptEl);
  const help = document.createElement('div'); help.id = 'help3d'; help.innerHTML = '<kbd>WASD</kbd> walk · <kbd>Shift</kbd> run · drag to look · <kbd>E</kbd> use desk';
  document.querySelector('.playfield').appendChild(help); setTimeout(() => help.classList.add('fade'), 9000);
  const st = document.createElement('style'); st.textContent = 'html.o3d-shot #nib-bubble,html.o3d-shot #help3d{display:none!important}'; document.head.appendChild(st);
  if (Q.has('fps')) { fpsEl = document.createElement('div'); fpsEl.id = 'fps3d'; document.body.appendChild(fpsEl); }
  document.documentElement.classList.add('o3d');
  world.setExternal(true);
  bindInput(canvas);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(); });
  window.Office3D = {
    renderer, scene, camera, shots, shot,
    quality: q => { quality = q; try { localStorage.setItem('fo.q3d', q); } catch {} applyQuality(); },
    fps: () => fpsNow, view: (y, p, d) => { yaw = y; pitch = p; dist = d; camInit = false; freeCam = null; },
    cam: (p, t, o = {}) => { freeCam = { p: V3(...p), t: V3(...t), ...o }; },
    prepass: on => (prepassOn = on), passes: { gtao: () => gtao, bloom: () => bloom, smaa: () => smaa, grade: () => grade, cine: () => cine },
    lights: () => C.lights, rebake: bakeEnvironment, irr: IRR, dbg: () => ({ pos: pos.toArray(), keys: { ...keys }, speedNow, blend: { ...blend }, yaw, heading, active: world.active(), st: world.getState() }),
  };
  renderer.setAnimationLoop(loop);
}
let rebakeAt = 0;
function loop() {
  const now = performance.now() / 1000, dt = tPrev ? Math.min(0.05, now - tPrev) : 0.016; tPrev = now; const t = now - t0;
  updatePlayer(dt); updateCamera(dt); updatePrompt();
  if ((frames & 15) === 0 && syncStations()) rebakeAt = now + 0.5;
  if (rebakeAt && now > rebakeAt) { rebakeAt = 0; bakeIrradiance(); bakeEnvironment(); }
  const np = G.nib?.pos?.();
  if (np && nib3d) { const tx = np.x * K, tz = np.y * K; nib3d.position.x += (tx - nib3d.position.x) * Math.min(1, dt * 4); nib3d.position.z += (tz - nib3d.position.z) * Math.min(1, dt * 4); nib3d.position.y = 1.45 + Math.sin(t * 2.2) * 0.04; const look = Math.atan2(pos.x - nib3d.position.x, pos.z - nib3d.position.z); nib3d.rotation.y += (((look - nib3d.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3); }
  tickRoom(t);
  for (const m of hazeMats) m.uniforms.time.value = t;
  const gt = getGoalTex(); if (gt && (Math.floor(t * 60) % 120) === 0) gt.userData.redraw();
  grade.uniforms.time.value = t;
  cine.uniforms.focus.value = DOF.focus; cine.uniforms.ap.value = DOF.ap; cine.uniforms.near.value = camera.near; cine.uniforms.far.value = camera.far;
  composer.render(dt);
  frames++; fpsT += dt;
  if (fpsT >= 1) {
    fpsNow = frames / fpsT; frames = 0; fpsT = 0; if (fpsEl) fpsEl.textContent = Math.round(fpsNow) + ' fps · ' + quality;
    if (!Q.get('q') && t > 6 && fpsNow < 38 && document.visibilityState === 'visible') { if (++slowFor >= 4 && quality !== 'low') { quality = quality === 'high' ? 'medium' : 'low'; applyQuality(); slowFor = 0; } } else slowFor = 0;
  }
}

// Boot once game.js has made the world.
if (want3d()) {
  let tries = 0;
  const wait = () => { if (window.Stage2?.world?.setExternal) start().catch(e => { console.warn('office3d: staying 2D', e); document.documentElement.classList.remove('o3d'); try { window.Stage2.world.setExternal(false); } catch {} document.getElementById('o3d')?.remove(); }); else if (++tries < 200) setTimeout(wait, 100); };
  wait();
}
