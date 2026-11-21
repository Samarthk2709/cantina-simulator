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
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { C, A, K, T, X0, X1, Z0, Z1, H, makeMaterials, allTextures, gltf, hazeMats } from './kit.js';
import { buildRoom, buildSkyline, tickRoom, getGoalTex } from './room.js';
import { buildRobot } from './robot.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
const IRR = { nx: 28, ny: 8, nz: 20, tex: null, u: { irrVol: { value: null }, irrMin: { value: new THREE.Vector3(X0, 0, Z0) }, irrSize: { value: new THREE.Vector3(X1 - X0, H, Z1 - Z0) }, irrK: { value: +(Q.get('gi') || 0.8) } } };
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

// ---------- floor reflections of the practicals (planar, layer-limited) ----------
// A mirror camera below the floor renders only the bright things (screens, bulbs, neon, LED strips, Nib) into a
// half-res mipmapped target; the glossy floor samples it projectively, blurred by its scuffed clearcoat roughness and
// smeared vertically, so lamps and monitors streak across the herringbone like a polished floor at night.
const REFL = { rt: null, cam: new THREE.PerspectiveCamera(), u: { reflMap: { value: null }, reflMat: { value: new THREE.Matrix4() }, reflK: { value: +(Q.get('refl') || 1.6) } } };
function setupReflection(floorMat) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  REFL.rt = new THREE.WebGLRenderTarget(Math.round(size.x / 2), Math.round(size.y / 2), { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  REFL.u.reflMap.value = REFL.rt.texture; REFL.k = REFL.u.reflK.value;
  scene.traverse(o => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return; const m = o.material;
    const glow = (m.emissive && (m.emissiveIntensity > 0.3) && (m.emissiveMap || m.emissive.getHex() !== 0)) || (m.isMeshBasicMaterial && Math.max(m.color.r, m.color.g, m.color.b) > 1.0);
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (glow && o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 0.3 && o.getWorldPosition(new THREE.Vector3()).y > 0.05) o.layers.enable(1);
    if (o.userData.city) o.layers.enable(1); // the night city shows through the reflected windows
  });
  // walls and ceiling block the mirror view as black silhouettes, so the city only shows through the window openings
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const o of C.occluders) { if (o === C.floorMesh) continue; const m = new THREE.Mesh(o.geometry, black); o.updateMatrixWorld(); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.layers.set(1); scene.add(m); }
  const base = THREE.MeshStandardMaterial.prototype.onBeforeCompile;
  floorMat.onBeforeCompile = function (shader) {
    base.call(this, shader); Object.assign(shader.uniforms, REFL.u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D reflMap; uniform mat4 reflMat; uniform float reflK;')
      .replace('#include <opaque_fragment>', `{
        vec4 rc = reflMat * vec4( vBPWorld, 1.0 ); vec2 ruv = rc.xy / rc.w + normal.xy * 0.012;
        float rough = material.clearcoatRoughness; float lod = rough * 6.0;
        vec3 refl = vec3( 0.0 );
        for ( int i = -3; i <= 3; i ++ ) refl += textureLod( reflMap, ruv + vec2( 0.0, float( i ) * ( 0.006 + rough * 0.02 ) ), lod + abs( float( i ) ) * 0.4 ).rgb;
        refl /= 7.0;
        float NoV = saturate( dot( geometryNormal, geometryViewDir ) ), F = 0.04 + 0.96 * pow( 1.0 - NoV, 5.0 );
        outgoingLight += refl * reflK * mix( 0.35, 1.0, F ) * ( 1.0 - rough * 0.8 );
      }
      #include <opaque_fragment>`);
  };
  floorMat.customProgramCacheKey = () => 'fo-floor-refl';
  floorMat.needsUpdate = true;
}
const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
function renderReflection() {
  if (!REFL.rt || REFL.on === false) { REFL.u.reflK.value = 0; return; }
  REFL.u.reflK.value = REFL.k;
  const c = REFL.cam; c.fov = camera.fov; c.aspect = camera.aspect; c.near = 0.05; c.far = 60; c.updateProjectionMatrix();
  const p = camera.position, dir = camera.getWorldDirection(new THREE.Vector3()), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  c.position.set(p.x, -p.y, p.z); c.up.set(up.x, -up.y, up.z); c.lookAt(p.x + dir.x, -p.y - dir.y, p.z + dir.z); c.updateMatrixWorld();
  REFL.u.reflMat.value.copy(_bias).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
  c.layers.set(1);
  const bg = scene.background, au = renderer.shadowMap.autoUpdate; scene.background = null; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(REFL.rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, c);
  scene.background = bg; renderer.shadowMap.autoUpdate = au; renderer.setRenderTarget(null);
}

// ---------- scene ----------
let renderer, scene, camera, composer, gtao, bloom, smaa, grade, cine, tPrev = 0, t0 = 0;
let world, G;

// ---------- Nib: a small hovering drone that follows Nib's position in the 2D game ----------
let nib3d;
function buildNib() {
  const M = C.M, g = new THREE.Group(); scene.add(g); nib3d = g;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), new THREE.MeshPhysicalMaterial({ color: 0xb9b6ae, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.15 })); body.castShadow = true; g.add(body);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.162, 32, 20, -0.9, 1.8, 0.95, 0.9), new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.05, clearcoat: 1 })); g.add(face);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.2, 1.5) })); e.position.set(s * 0.045, 0.02, 0.155); g.add(e); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 40), M.alu); ring.rotation.x = Math.PI / 2; g.add(ring);
  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.004, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.2, 1.5) })); glowRing.rotation.x = Math.PI / 2; glowRing.position.y = -0.012; g.add(glowRing);
  const l = new THREE.PointLight(0x7ae8ff, 0.15, 1.2, 2); l.position.set(0, -0.1, 0.25); g.add(l);
}

// ---------- the player: FO-1, the founder robot (robot.js) ----------
let charLight, rimLight, player, robot, playerRadius = 0.2;
function buildPlayer() {
  robot = buildRobot();
  player = new THREE.Group(); player.add(robot.mesh); scene.add(player);
  // soft key + cool rim on the character (keeps the robot readable against the dark room)
  charLight = new THREE.PointLight(0xffe6cc, 0.8, 2.6, 2); scene.add(charLight);
  rimLight = new THREE.PointLight(0x9fbfff, 1.4, 2.4, 2); scene.add(rimLight);
  // soft contact shadow blob under the feet
  const blobT = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; })());
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: blobT, transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.006; blob.userData.noAO = true; blob.userData.dynamic = true; player.add(blob);
  player.traverse(o => (o.userData.dynamic = true));
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
  canvas.addEventListener('pointerdown', e => { if (act) { userOrbit = true; camInit = false; } drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); freeCam = null; });
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
  const sp = routeMoving ? 1.55 : moved ? speedNow : 0;
  // the visual body follows the logical (2D) position unless a station interaction drives it
  let anim = { speed: sp };
  if (act) anim = stepInteraction(dt);
  else { vis.copy(pos); visH = heading; }
  player.position.copy(vis); player.rotation.y = visH;
  robot.anim.update(dt, performance.now() / 1000, anim);
  sparks(dt, !!(act && act.id === 'forge' && act.phase === 'loop')); stationFX(dt);
}

// small solder sparks from the robot's tool hand while it tinkers at the forge
const SPK = { n: 40, pts: null, life: new Float32Array(40), vel: new Float32Array(120), t: 0 };
function sparks(dt, on) {
  if (!SPK.pts) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPK.n * 3), 3));
    SPK.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(3.5, 1.8, 0.6), size: 0.03, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    SPK.pts.frustumCulled = false; SPK.pts.userData.dynamic = true; scene.add(SPK.pts);
  }
  const P = SPK.pts.geometry.attributes.position, hand = robot.bones.rFi.getWorldPosition(new THREE.Vector3());
  SPK.t += dt;
  for (let i = 0; i < SPK.n; i++) {
    if (SPK.life[i] <= 0) { if (on && Math.random() < dt * 45 && Math.sin(SPK.t * 2.2) > -0.3) { SPK.life[i] = 0.25 + Math.random() * 0.35; P.setXYZ(i, hand.x, hand.y - 0.03, hand.z); SPK.vel.set([(Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4], i * 3); } else { P.setXYZ(i, 0, -50, 0); continue; } }
    SPK.life[i] -= dt; SPK.vel[i * 3 + 1] -= 6 * dt;
    P.setXYZ(i, P.getX(i) + SPK.vel[i * 3] * dt, Math.max(0.92, P.getY(i) + SPK.vel[i * 3 + 1] * dt), P.getZ(i) + SPK.vel[i * 3 + 2] * dt);
  }
  P.needsUpdate = true;
}

// ---------- station interactions ----------
// Each usable station has a use-spot (where the robot stands or sits, and which way it faces) and a pose in robot.js.
// E (or Office3D.interact) walks the robot to the spot, turns it, then loops the station animation while the window
// is open; closing the window plays the exit (stand up / step back) and returns control.
const vis = new THREE.Vector3(); let visH = Math.PI;
const USE = {
  hunt: [7.175, 4.83, Math.PI], contract: [2.725, 3.31, Math.PI], stats: [12.5, 2.67, Math.PI / 2], training: [11.47, 7.8, Math.PI],
  forge: [3.75, 8.55, Math.PI], hq: [7.25, 1.62, Math.PI], rig: [12.38, 8.93, 0], terminals: [13.125, 7.4, 0], lounge: [3.2, 9.95, Math.PI],
};
let act = null;
const angDiff = (a, b) => { const d = b - a; return Math.atan2(Math.sin(d), Math.cos(d)); };
function startInteraction(id) {
  if (!USE[id]) return Promise.reject(new Error('no such station: ' + id));
  if (act && act.id === id && act.phase === 'loop') return Promise.resolve(id);
  let resolve; const p = new Promise(r => (resolve = r));
  const [x, z, h] = USE[id];
  act = { id, phase: 'walk', t: 0, st: 0, spot: new THREE.Vector3(x, 0, z), h, resolve };
  if (vis.distanceTo(act.spot) > 4) { vis.set(x - Math.sin(h) * 0.9, 0, z - Math.cos(h) * 0.9); } // far away: start a short walk from just behind the spot
  return p;
}
// while a station is being used it is lit and its screens are on (even if the game hasn't unlocked it yet)
let usePowered = null;
function usePower(id, on) {
  if (on && !powered[id] && C.power[id]) { for (const fn of C.power[id]) fn(true); usePowered = id; }
  if (!on && usePowered) { if (!powered[usePowered]) for (const fn of C.power[usePowered] || []) fn(false); usePowered = null; }
}
let ledger = null;
function buildLedger() { // a ledger the robot holds and leafs through at the vault
  const g = new THREE.Group(), cover = new THREE.MeshStandardMaterial({ color: 0x1f4a2e, roughness: 0.6 }), paper = new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: 0.9, side: THREE.DoubleSide });
  const b = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  b(0.16, 0.006, 0.22, cover, -0.08, 0, 0); b(0.16, 0.006, 0.22, cover, 0.08, 0, 0); b(0.15, 0.012, 0.21, paper, -0.08, 0.009, 0); b(0.15, 0.012, 0.21, paper, 0.08, 0.009, 0);
  const pivot = new THREE.Group(); pivot.position.set(0, 0.016, 0); g.add(pivot);
  const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.21), paper); pg.rotation.x = -Math.PI / 2; pg.position.x = 0.075; pivot.add(pg);
  g.userData = { pivot, dynamic: true }; g.position.set(0, -0.09, 0.05); g.rotation.set(-1.2, 0, 0); g.visible = false;
  robot.bones.lWr.add(g); return g;
}
function stationFX(dt) {
  const st = act && (act.phase === 'loop' || act.phase === 'enter' || act.phase === 'exit') ? act.id : null, t = act ? act.st : 0;
  if (st) usePower(st, true); else usePower(null, false);
  // vault: spin the dial, swing the door, leaf through the ledger
  const S = C.safe;
  if (S) {
    const ph = st === 'stats' ? t % 9 : 0, open = st === 'stats' ? Math.min(1, Math.max(0, (ph - 3) / 0.9)) * (1 - Math.min(1, Math.max(0, (ph - 8) / 0.9))) : 0;
    S.door.rotation.y += (-1.5 * open - S.door.rotation.y) * Math.min(1, dt * 6);
    if (st === 'stats' && ph < 3) S.dial.rotation.z = Math.sin(t * 2.6) * 2.2;
    if (st === 'stats' && ph >= 2.6 && ph < 3.4) S.wheel.rotation.z += dt * 6;
    S.key.intensity += ((st === 'stats' ? 9 : 3.5) - S.key.intensity) * Math.min(1, dt * 4);
    if (!ledger) ledger = buildLedger();
    ledger.visible = st === 'stats' && act.phase !== 'exit';
    if (ledger.visible) ledger.userData.pivot.rotation.z = (Math.sin(t * 1.6) > 0.6 ? Math.PI * Math.min(1, (Math.sin(t * 1.6) - 0.6) * 3) : 0);
  }
}
function stepInteraction(dt) {
  const A = act; A.t += dt;
  if (A.phase === 'walk' || A.phase === 'return') {
    const goal = A.phase === 'walk' ? A.spot : pos, d = goal.clone().sub(vis).setY(0), dist = d.length(), sp = Math.min(1.45, dist * 4);
    if (dist > 0.03) { const want = Math.atan2(d.x, d.z); visH += angDiff(visH, want) * Math.min(1, dt * 10); vis.addScaledVector(d.normalize(), Math.min(dist, sp * dt)); }
    if (dist <= 0.03 || A.t > 6) { if (A.phase === 'walk') { A.phase = 'turn'; A.t = 0; } else { act = null; return { speed: 0 }; } }
    return { speed: sp };
  }
  if (A.phase === 'turn') { visH += angDiff(visH, A.h) * Math.min(1, dt * 9); if (A.t > 0.35) { A.phase = 'enter'; A.t = 0; } return { speed: 0 }; }
  if (A.phase === 'enter' || A.phase === 'loop') {
    visH += angDiff(visH, A.h) * Math.min(1, dt * 9); A.st += dt;
    if (A.phase === 'enter' && A.t > 0.45) { A.phase = 'loop'; A.resolve && A.resolve(A.id); A.resolve = null; }
    return { station: A.id, stationT: A.st };
  }
  if (A.phase === 'exit') { if (A.t > 0.7) { A.phase = 'return'; A.t = 0; } return { speed: 0, rate: 6 }; }
  return { speed: 0 };
}
function leaveInteraction() {
  if (!act) return Promise.resolve();
  if (act.resolve) { act.resolve(act.id); act.resolve = null; }
  act.phase = 'exit'; act.t = 0;
  const dlg = document.getElementById('panel-dialog'); if (dlg?.open) { suppressClose = true; dlg.close(); suppressClose = false; }
  return new Promise(r => { const chk = () => (!act || act.phase === 'return' ? r() : setTimeout(chk, 50)); chk(); });
}
let suppressClose = false;
// The game opens a station window when E is pressed near a usable station: start that station's interaction.
function watchWindows() {
  const dlg = document.getElementById('panel-dialog'); if (!dlg) return;
  new MutationObserver(() => {
    if (dlg.open && !act) { const id = nearestStation(); if (id) startInteraction(id); }
    else if (!dlg.open && act && act.phase !== 'exit' && act.phase !== 'return' && !suppressClose) leaveInteraction();
  }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
}
function nearestStation() {
  let best = null, bd = 1.6;
  for (const s of window.CantinaWorld.stations) { if (s.room !== 'office' || !USE[s.id]) continue; const d = Math.hypot(s.approach.x * K - pos.x, s.approach.y * K - pos.z); if (d < bd) { bd = d; best = s.id; } }
  return best;
}
// Office3D.interact(id): put the founder at the station's approach (so the game agrees), open its window when the game
// allows it (locked stations still play their animation), and resolve once the station animation is playing.
function interact(id) {
  const s = window.CantinaWorld.stations.find(s => s.id === id && s.room === 'office');
  if (s) { pos.set(s.approach.x * K, 0, s.approach.y * K); world.setPose(s.approach.x, s.approach.y, 'up', false); }
  const p = startInteraction(id);
  if (s) setTimeout(() => { const btn = document.getElementById('interact'); if (btn && !btn.disabled && !document.getElementById('panel-dialog')?.open) btn.click(); }, 120);
  return p;
}

const DOF = { focus: 2.6, ap: 0.12 };
let userOrbit = false; const camTgt = new THREE.Vector3();
// never let the camera sit inside the robot (exit animations, tight corners): push it out horizontally
function keepOff(p) { const dx = p.x - vis.x, dz = p.z - vis.z, d = Math.hypot(dx, dz), m = 0.95; if (d < m && p.y < 1.9) { const k = d > 1e-3 ? m / d : 0; if (k) { p.x = vis.x + dx * k; p.z = vis.z + dz * k; } else p.y = 1.95; } }
function stationCam(id) {
  const sp = USE[id], c = USE_CAM[id] || [-1.55, 1.25, 1.55, 0.45, 0.95], f = new THREE.Vector3(Math.sin(sp[2]), 0, Math.cos(sp[2])), side = new THREE.Vector3(f.z, 0, -f.x);
  return { p: new THREE.Vector3(sp[0], 0, sp[1]).addScaledVector(f, c[0]).addScaledVector(side, c[2]).setY(c[1]), t: new THREE.Vector3(sp[0], 0, sp[1]).addScaledVector(f, c[3]).setY(c[4]) };
}
function updateCamera(dt) {
  const head = new THREE.Vector3(vis.x, act && /hunt|contract|lounge|stats/.test(act.id) && act.phase !== 'walk' ? 1.15 : 1.5, vis.z);
  if (freeCam) {
    let p = freeCam.p, t = freeCam.t;
    if (freeCam.follow) { t = vis.clone().add(new THREE.Vector3(0, freeCam.ty ?? 1.05, 0)); p = t.clone().add(freeCam.follow); }
    camPos.copy(p); camera.position.copy(p); camera.lookAt(t);
    if (camera.fov !== (freeCam.fov || 50)) { camera.fov = freeCam.fov || 50; camera.updateProjectionMatrix(); }
    DOF.focus = freeCam.focus ?? p.distanceTo(t); DOF.ap = freeCam.ap ?? 0.35;
    player.visible = !freeCam.hidePlayer; if (nib3d) nib3d.visible = !freeCam.hidePlayer;
    if (charLight) { const hd = new THREE.Vector3(vis.x, 1.45, vis.z), toCam = p.clone().sub(hd).setY(0).normalize(), side = new THREE.Vector3(-toCam.z, 0, toCam.x);
      charLight.position.copy(hd).addScaledVector(toCam, 0.9).addScaledVector(side, 0.6).add(new THREE.Vector3(0, 0.3, 0)); rimLight.position.copy(hd).addScaledVector(toCam, -0.8).addScaledVector(side, -0.4).add(new THREE.Vector3(0, 0.3, 0)); }
    return;
  }
  if (nib3d) nib3d.visible = true;
  // station interactions get a framed shot of the robot at work (until the player drags the camera)
  if (act && !userOrbit && act.phase !== 'walk' && act.phase !== 'return') {
    yaw = Math.atan2(camPos.x - vis.x, camPos.z - vis.z); // so the orbit camera resumes from here, not from behind the robot's old spot
    const { p, t } = stationCam(act.id), k = Math.min(1, dt * 3);
    camPos.lerp(p, k); camTgt.lerp(t, k); keepOff(camPos); camera.position.copy(camPos); camera.lookAt(camTgt);
    if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
    DOF.focus = camPos.distanceTo(vis) + 0.2; DOF.ap = 0.1; player.visible = true;
    if (charLight) { const hd = new THREE.Vector3(vis.x, 1.3, vis.z), toCam = camPos.clone().sub(hd).setY(0).normalize(), side = new THREE.Vector3(-toCam.z, 0, toCam.x);
      charLight.position.copy(hd).addScaledVector(toCam, 0.9).addScaledVector(side, 0.6).add(new THREE.Vector3(0, 0.3, 0)); rimLight.position.copy(hd).addScaledVector(toCam, -0.8).addScaledVector(side, -0.4).add(new THREE.Vector3(0, 0.3, 0)); }
    return;
  }
  if (!act) userOrbit = false;
  camTgt.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()));
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
  camPos.lerp(want, Math.min(1, dt * (act ? 3 : 12))); keepOff(camPos);
  camera.position.copy(camPos); camera.lookAt(target);
  player.visible = camPos.distanceTo(head) > 0.45;
  if (rimLight) { const away = head.clone().sub(camPos).setY(0).normalize(); rimLight.position.copy(head).addScaledVector(away, 0.75).add(new THREE.Vector3(0, 0.35, 0)); }
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
  // Renders the scene (optional depth pre-pass, then the lit pass) into its own MSAA target whose depth texture is shared
  // with the AO and depth-of-field passes (so no separate normal/depth pass is needed), then copies the colour into the
  // composer's read buffer.
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera; this.enabled = true; this.needsSwap = false; this.clear = true; this.renderToScreen = false;
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.skip = [];
    const d = new THREE.DepthTexture(1, 1); d.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'ultra' ? 4 : 0, depthTexture: d });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms) })); this.copy.material.uniforms.tDiffuse.value = this.rt.texture;
  }
  collect() { this.skip = []; this.scene.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const big = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 1.5; if (!big || o.userData.noAO || o.isSkinnedMesh || ms.some(m => m.transparent || m.alphaTest > 0 || m.alphaMap || m.isShaderMaterial || m.side === THREE.BackSide)) this.skip.push(o); }); }
  setSize(w, h) { this.rt.setSize(w, h); }
  dispose() { this.rt.dispose(); }
  render(renderer, writeBuffer, readBuffer) {
    const S = this.scene, bg = S.background;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x05070b, 1); renderer.clear(true, true, false);
    if (prepassOn) {
      const vis = this.skip.map(o => o.visible);
      this.skip.forEach(o => (o.visible = false)); S.overrideMaterial = this.mat; S.background = null;
      renderer.shadowMap.autoUpdate = true; renderer.autoClear = false; renderer.render(S, this.camera);
      S.overrideMaterial = null; S.background = bg; this.skip.forEach((o, i) => (o.visible = vis[i]));
      renderer.shadowMap.autoUpdate = false;
    }
    renderer.autoClear = false; renderer.render(S, this.camera); renderer.autoClear = true; renderer.shadowMap.autoUpdate = true;
    renderer.setRenderTarget(readBuffer); this.copy.render(renderer);
  }
}
let prepassOn = true, prepass;

// ---------- post-processing ----------
// Cinema pass (HDR, before bloom): depth of field from the AO pass's depth buffer, plus a faint distance haze.
const CineShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.05 }, far: { value: 400 }, focus: { value: 2.6 }, ap: { value: 0.1 }, maxBlur: { value: 6 }, res: { value: new THREE.Vector2(1, 1) },
    fogColor: { value: new THREE.Color(0.02, 0.026, 0.042) }, fogDensity: { value: 0.05 }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform float near, far, focus, ap, maxBlur, fogDensity; uniform vec2 res; uniform vec3 fogColor; uniform mat4 projInv, camWorld; varying vec2 vUv;
    float lin(float d){ return (near * far) / (far - d * (far - near)); }
    float coc(float z){ float c = clamp(abs(z - focus) / max(z, 0.01) * ap, 0.0, 1.0) * maxBlur; return z > 22.0 ? max(c, 1.6) : c; } // the city behind the glass is always slightly soft
    vec3 wpos(vec2 uv, float d){ vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; return (camWorld * v).xyz; }
    void main(){
      float d0 = texture2D(tDepth, vUv).x, zc = lin(d0), cc = coc(zc);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (cc > 0.6) {
        vec3 acc = col; float wsum = 1.0;
        const int N = 36;
        for (int i = 0; i < N; i++) {
          float fi = float(i) + 0.5; float r = sqrt(fi / float(N)) * cc; float a = fi * 2.39996;
          vec2 o = vec2(cos(a), sin(a)) * r / res;
          float cs = coc(lin(texture2D(tDepth, vUv + o).x));
          float w = smoothstep(r - 1.0, r + 0.5, cs);
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          acc += s * w; wsum += w;
        }
        col = acc / wsum;
      }
      // height fog: thicker near the floor, thinning toward the ceiling; integrated along the view ray inside the room
      vec3 P = wpos(vUv, d0), Cp = camWorld[3].xyz; float dist = min(length(P - Cp), 16.0);
      float hy = 0.5 * (clamp(P.y, -1.0, 3.3) + Cp.y), hf = exp(-max(hy, 0.0) * 0.55);
      float f = 1.0 - exp(-dist * fogDensity * hf);
      col = mix(col, fogColor, f * 0.8);
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
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      // split tone: cool teal shadows, warm highlights
      c = mix(c, c * vec3(0.9,1.0,1.1) + vec3(0.0,0.004,0.01), smoothstep(0.45,0.0,l)*0.7);
      c = mix(c, c * vec3(1.07,1.0,0.9), smoothstep(0.4,1.0,l)*0.55);
      c = mix(vec3(l), c, 1.1);
      // gentle S-curve around mid grey
      c = clamp(c, 0.0, 1.0); c = mix(c, c*c*(3.0-2.0*c), 0.28);
      c *= 1.0 - vig * smoothstep(0.08, 0.9, r2*2.2);
      gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);
    }`,
};
function buildPost() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
  prepass = new PrepassRenderPass(scene, camera); composer.addPass(prepass);
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight, { depthTexture: prepass.rt.depthTexture });
  gtao.updateGtaoMaterial({ radius: 1.0, distanceExponent: 1.3, thickness: 2.0, scale: 1.35, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
  cine = new ShaderPass(CineShader); cine.uniforms.tDepth.value = prepass.rt.depthTexture; composer.addPass(cine);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.12, 0.4, 1.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  smaa = new SMAAPass(); composer.addPass(smaa);
}
// Quality tiers. high: everything at DPR <= 1.5 (1.25 by default); medium: DPR 1, no AO depth-of-field blur taps
// reduced; low: DPR 1, no AO / reflections / DOF / bloom / depth pre-pass, static shadows (CPU-light for weak laptops).
function applyQuality() {
  const dpr = quality === 'ultra' ? 1.5 : quality === 'high' ? Math.min(devicePixelRatio || 1, 1.25) : 1;
  renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
  const low = quality === 'low';
  gtao.enabled = !low; cine.enabled = !low; bloom.enabled = !low; prepassOn = !low; REFL.on = !low;
  gtao.updateGtaoMaterial({ samples: quality === 'medium' ? 8 : 16 });
  if (C.moon) { C.moon.shadow.autoUpdate = !low; C.moon.shadow.needsUpdate = true; }
  renderer.shadowMap.enabled = true;
  grade.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
  cine.uniforms.res.value.set(innerWidth * dpr, innerHeight * dpr);
  cine.uniforms.tDepth.value = prepass.rt.depthTexture;
}

// ---------- static geometry merge ----------
// Everything that never moves is merged per material (and per shadow / layer flags) into a few big meshes: the room
// draws in tens of calls per pass instead of thousands. Meshes that animate, toggle or swap materials are left alone.
function mergeStatic() {
  scene.updateMatrixWorld(true);
  // split multi-material meshes into one mesh per material group first (each part can then batch with its kind)
  const multi = []; scene.traverse(o => { if (o.isMesh && Array.isArray(o.material) && !o.isSkinnedMesh && !o.userData.dynamic) multi.push(o); });
  for (const o of multi) {
    const g = o.geometry.index ? o.geometry : null; if (!g || !g.groups.length) continue;
    for (const gr of g.groups) {
      const sub = new THREE.BufferGeometry(); for (const n in g.attributes) sub.setAttribute(n, g.attributes[n]);
      sub.setIndex(new THREE.BufferAttribute(g.index.array.slice(gr.start, gr.start + gr.count), 1));
      const part = new THREE.Mesh(sub, o.material[gr.materialIndex]); part.castShadow = o.castShadow; part.receiveShadow = o.receiveShadow; part.layers.mask = o.layers.mask; part.userData = { ...o.userData };
      o.matrixWorld.decompose(part.position, part.quaternion, part.scale); scene.add(part);
    }
    o.parent.remove(o);
  }
  scene.updateMatrixWorld(true);
  const buckets = new Map(), victims = [];
  const isDyn = o => { for (let p = o; p; p = p.parent) if (p.userData.dynamic) return true; return false; };
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.visible || isDyn(o)) return;
    const g = o.geometry; if (!g.attributes.position || g.morphAttributes.position) return;
    const flags = '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + '|' + o.layers.mask + '|' + o.renderOrder + '|' + (o.userData.noAO ? 1 : 0) + '|' + (o.userData.city ? 1 : 0);
    const m = o.material, vc = vcSig(m);
    const key = (vc ? 'VC' + vc : m.uuid) + flags;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(o);
  });
  let merged = 0;
  for (const objs of buckets.values()) {
    if (objs.length < 2) continue;
    const vc = !!vcSig(objs[0].material);
    const names = Object.keys(objs[0].geometry.attributes).filter(n => ['position', 'normal', 'uv', 'seed'].includes(n)); if (vc) names.push('color');
    if (vc && !names.includes('uv') && objs.some(o => o.geometry.attributes.uv)) names.push('uv');
    const geos = [];
    for (const o of objs) {
      let g = o.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      for (const n of names) if (!g.attributes[n]) { const sz = n === 'uv' ? 2 : n === 'seed' ? 1 : 3; g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * sz), sz)); }
      if (!g.index) { const n = g.attributes.position.count, idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
      for (const n of names) { const a = g.attributes[n]; if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array)) { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k); g.setAttribute(n, new THREE.BufferAttribute(f, a.itemSize)); } }
      if (vc) { const c = o.material.color, n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
      g.applyMatrix4(o.matrixWorld); geos.push(g);
    }
    let mg; try { mg = mergeGeometries(geos, false); } catch { mg = null; }
    geos.forEach(g => g.dispose()); if (!mg) continue;
    const o0 = objs[0], m = new THREE.Mesh(mg, vc ? vcMaterial(o0.material) : o0.material);
    m.castShadow = o0.castShadow; m.receiveShadow = o0.receiveShadow; m.layers.mask = o0.layers.mask; m.renderOrder = o0.renderOrder; m.userData = { ...o0.userData, merged: true };
    m.matrixAutoUpdate = false; scene.add(m); merged += objs.length;
    for (const o of objs) victims.push(o);
  }
  const old = new Set();
  for (const o of victims) { o.parent && o.parent.remove(o); if (!C.occluders.includes(o)) old.add(o.geometry); }
  old.forEach(g => g.dispose());
  // empty groups left behind
  const empties = []; scene.traverse(o => { if (o !== scene && !o.isMesh && !o.isLight && !o.isBone && o.type === 'Group' && o.children.length === 0) empties.push(o); });
  empties.forEach(o => o.parent && o.parent.remove(o));
  return merged;
}

// Plain standard materials that differ only in colour share one vertex-coloured material per (maps, roughness,
// metalness, side) signature, so e.g. all the dark-steel / plastic / painted bits batch together.
const vcMats = new Map();
function vcSig(m) {
  if (m.type !== 'MeshStandardMaterial' || m.transparent || m.vertexColors || m.opacity < 1 || m.alphaTest > 0 || m.onBeforeCompile !== THREE.MeshStandardMaterial.prototype.onBeforeCompile) return null;
  if (m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0)) return null;
  const id = t => (t ? t.uuid.slice(0, 8) : '-');
  return [id(m.map), id(m.normalMap), id(m.roughnessMap), id(m.metalnessMap), id(m.aoMap), m.roughness.toFixed(2), m.metalness.toFixed(2), m.normalScale ? m.normalScale.x.toFixed(2) : '', m.side, m.envMapIntensity, m.flatShading ? 1 : 0].join(',');
}
function vcMaterial(m) {
  const k = vcSig(m); let v = vcMats.get(k);
  if (!v) { v = m.clone(); v.vertexColors = true; v.color.set(0xffffff); v.onBeforeCompile = THREE.MeshStandardMaterial.prototype.onBeforeCompile; vcMats.set(k, v); }
  return v;
}

// ---------- frame stats / GPU memory estimate ----------
const STATS = { calls: 0, tris: 0, frameMs: 16, gpuMB: 0 };
function estimateGPU() {
  let bytes = 0; const seen = new Set();
  const texBytes = t => { if (!t || seen.has(t.uuid)) return; seen.add(t.uuid); const im = t.image; const w = im?.width || 0, h = im?.height || 0, d = im?.depth || 1; const bpp = t.type === THREE.HalfFloatType ? 8 : t.type === THREE.FloatType ? 16 : 4; bytes += w * h * d * bpp * (t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 1.33 : 1); };
  scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) texBytes(v); } for (const m of ms) if (m.uniforms) for (const u in m.uniforms) { const v = m.uniforms[u].value; if (v && v.isTexture) texBytes(v); } });
  texBytes(IRR.tex); if (scene.environment) bytes += 256 * 256 * 8 * 6 * 1.6; // PMREM
  const geoSeen = new Set(); scene.traverse(o => { const g = o.geometry; if (!g || geoSeen.has(g.uuid)) return; geoSeen.add(g.uuid); for (const n in g.attributes) bytes += g.attributes[n].array.byteLength; if (g.index) bytes += g.index.array.byteLength; });
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2()), px = sz.x * sz.y;
  bytes += px * 8 * 2;                                      // composer ping-pong targets
  bytes += px * (8 + 4) * (quality === 'ultra' ? 5 : 1);   // scene colour + depth (MSAA renderbuffers on ultra)
  bytes += px * (4 + 4);                                    // AO + denoise targets
  bytes += px * 8 * 0.7;                                   // bloom mip chain
  bytes += px / 4 * 8 * 1.33;                              // reflection target
  for (const l of C.lights) if (l.castShadow) bytes += l.shadow.mapSize.x * l.shadow.mapSize.y * 4;
  return bytes / 1048576;
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
// camera for station shots, in the robot's frame: [forward, height, side, target forward, target height]
const USE_CAM = {
  hunt: [-1.0, 1.45, 1.1, 0.5, 0.95], contract: [-1.2, 1.5, -1.3, 0.45, 0.95], stats: [0.2, 1.35, 1.7, 0.45, 0.75], training: [-1.2, 1.75, -0.45, 0.4, 1.35],
  forge: [-1.4, 1.65, 1.2, 0.45, 1.0], hq: [-1.5, 1.55, 1.2, 0.5, 1.4], rig: [-0.95, 1.55, -1.2, 0.5, 1.05], terminals: [-1.3, 1.65, -1.1, 0.5, 1.0], lounge: [2.3, 1.5, 0.9, 0.0, 0.8],
};
const DESK_VIEWS = {
  'desk-hunt': { p: V3(8.15, 1.18, 5.05), t: V3(7.0, 0.92, 3.95), fov: 48, ap: 0.16 },
  'desk-contract': { p: V3(3.75, 1.3, 3.85), t: V3(2.45, 0.95, 2.45), fov: 50, ap: 0.16 },
  'desk-stats': { p: V3(11.75, 1.45, 3.6), t: V3(13.5, 1.15, 2.85), fov: 54, ap: 0.16 },
  'desk-training': { p: V3(11.1, 1.3, 9.1), t: V3(10.0, 0.95, 7.6), fov: 50, ap: 0.16 },
  'desk-forge': { p: V3(4.75, 1.45, 9.05), t: V3(3.65, 1.05, 7.65), fov: 50, ap: 0.16 },
  'desk-hq': { p: V3(8.9, 1.5, 3.35), t: V3(7.3, 1.45, 0.9), fov: 52, ap: 0.12 },
  'desk-rig': { p: V3(12.2, 2.05, 8.45), t: V3(13.35, 0.95, 9.25), fov: 54, ap: 0.12 },
  'desk-terminals': { p: V3(11.2, 1.6, 6.7), t: V3(13.0, 0.95, 8.2), fov: 50, ap: 0.14 },
  'lounge': { p: V3(5.7, 1.45, 7.6), t: V3(3.3, 0.6, 9.9), fov: 52, ap: 0.1 },
};
function setPlayer(x, z, h, facing) { act = null; pos.set(x, 0, z); vis.set(x, 0, z); heading = visH = h; world.setPose(x / K, z / K, facing || 'up', false); speedNow = 0; }
function approach(id) { const s = window.CantinaWorld.stations.find(s => s.id === id); return s ? [s.approach.x * K, s.approach.y * K] : [7.1, 7.1]; }
function shots() {
  return [{ name: 'wide' }, { name: 'wide-west' }, { name: 'wide-ne' }, { name: 'portrait' }, { name: 'walk-side', wait: 1500 }, { name: 'use-terminals' }, { name: 'gameplay' }, { name: 'walking', wait: 1500 }, { name: 'using-desk', wait: 3000 },
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
  else if (DESK_VIEWS[name] || name.startsWith('use-')) {
    const id = name.replace(/^(desk|use)-/, '') ; const sp = USE[id];
    if (sp) { // the robot is at the station, already in its animation
      setPlayer(sp[0], sp[1], sp[2], 'up'); act = { id, phase: 'loop', t: 0, st: 0, spot: new THREE.Vector3(sp[0], 0, sp[1]), h: sp[2], resolve: null };
      const f = new THREE.Vector3(Math.sin(sp[2]), 0, Math.cos(sp[2])), side = new THREE.Vector3(f.z, 0, -f.x), c = USE_CAM[id] || [-1.55, 1.25, 1.55, 0.45, 0.95];
      const p = new THREE.Vector3(sp[0], 0, sp[1]).addScaledVector(f, c[0]).addScaledVector(side, c[2]).setY(c[1]);
      const t = new THREE.Vector3(sp[0], 0, sp[1]).addScaledVector(f, c[3]).setY(c[4]);
      freeCam = name.startsWith('use-') || !DESK_VIEWS[name] ? { p, t, fov: 50, ap: 0.12 } : { p, t, fov: 50, ap: 0.12 };
    } else { setPlayer(1.6, 5.2, 0, 'down'); freeCam = { ...DESK_VIEWS[name], hidePlayer: true }; }
  }
  if (name === 'gameplay' || name === 'using-desk') keys.shot = false;
}

// ---------- main ----------
let fpsEl, frames = 0, fpsT = 0, fpsNow = 0, slowFor = 0;
// ---------- loading screen ----------
// Shown from the moment the 3D office is chosen until its first frame, over the play area (the 2D office never flashes).
let loadEl = null;
function showLoading() {
  document.documentElement.classList.add('o3d-loading');
  const st = document.createElement('style');
  st.textContent = `html.o3d-loading #world-wrap,html.o3d-loading #nib-layer,html.o3d-loading .world-actions,html.o3d-loading .dpad{visibility:hidden!important}
#load3d{position:fixed;inset:0;z-index:40;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 40%,#1a1d24 0%,#08090c 70%);color:#e9e4da;font:500 14px/1.4 var(--sans,system-ui);transition:opacity .5s;pointer-events:none}
#load3d.done{opacity:0}#load3d .box{width:min(420px,80vw);text-align:center}#load3d h2{margin:0 0 6px;font:700 13px/1 var(--mono,monospace);letter-spacing:.32em;color:#d4561f}
#load3d .bar{height:4px;border-radius:2px;background:#22262e;overflow:hidden;margin:18px 0 10px}#load3d .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#d4561f,#ffb46b);transition:width .25s}
#load3d small{color:#8a8f99;font:12px var(--mono,monospace)}
html.o3d-fallback-note #note3d{display:block}#note3d{display:none;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:60;background:#14171c;color:#e9e4da;padding:8px 14px;border-radius:6px;font:13px var(--sans,system-ui);box-shadow:0 6px 20px rgba(0,0,0,.4)}`;
  document.head.appendChild(st);
  loadEl = document.createElement('div'); loadEl.id = 'load3d';
  loadEl.innerHTML = '<div class="box"><h2>FIRST OFFICE</h2><div>Opening the office…</div><div class="bar"><i></i></div><small>starting</small></div>';
  document.body.appendChild(loadEl);
}
function setLoading(frac, text) { if (!loadEl) return; loadEl.querySelector('i').style.width = Math.round(frac * 100) + '%'; if (text) loadEl.querySelector('small').textContent = text; }
function hideLoading() { document.documentElement.classList.remove('o3d-loading'); if (!loadEl) return; loadEl.classList.add('done'); const el = loadEl; setTimeout(() => el.remove(), 600); loadEl = null; }
function fallback2D(msg) {
  hideLoading(); document.documentElement.classList.remove('o3d');
  try { window.Stage2.world.setExternal(false); } catch {}
  document.getElementById('o3d')?.remove();
  const n = document.createElement('div'); n.id = 'note3d'; n.textContent = msg || '3D view unavailable here, showing the 2D office.'; document.body.appendChild(n);
  document.documentElement.classList.add('o3d-fallback-note'); setTimeout(() => n.remove(), 6000);
}

async function start() {
  G = window.Stage2; world = G.world;
  THREE.DefaultLoadingManager.onProgress = (url, done, total) => setLoading(0.05 + 0.65 * done / Math.max(1, total), 'loading ' + done + ' / ' + total);
  RectAreaLightUniformsLib.init();
  patchShaders(); installIrradiance();
  const canvas = document.createElement('canvas'); canvas.id = 'o3d'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Your office in 3D. WASD to walk, Shift to run, drag to look, E to use a desk.');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = Q.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping; renderer.toneMappingExposure = +(Q.get('exp') || 0.82);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x05070b); C.scene = scene;
  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 400);
  makeMaterials();
  buildSkyline(SKY_YAW); buildRoom(G); buildNib(); buildPlayer();
  await Promise.all(C.pending);
  await Promise.all(allTextures().map(t => t.image ? null : new Promise(r => { const t1 = performance.now() + 8000; const chk = () => (t.image && (t.image.complete ?? true)) || performance.now() > t1 ? r() : setTimeout(chk, 50); chk(); })));
  setLoading(0.72, 'building the room');
  scene.traverse(o => { if (o.isMesh && o.material && (o.material.transparent || o.material.isShaderMaterial)) o.userData.noAO = true; });
  t0 = performance.now() / 1000;
  const s0 = world.getState(); pos.set(s0.x * K, 0, s0.y * K); vis.copy(pos); heading = visH = Math.PI; yaw = 0;
  buildPost(); applyQuality(); setupReflection(C.M.floor);
  syncStations(true); mergeStatic(); prepass.collect();
  for (const l of C.lights) if (l.castShadow && l !== C.moon) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
  bakeIrradiance();
  setLoading(0.8, 'compiling shaders');
  document.querySelector('.playfield').prepend(canvas);
  try { await renderer.compileAsync(scene, camera); } catch {}
  // upload every texture now, so walking into a new corner never stalls on a first-use upload
  { const seen = new Set(); scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); renderer.initTexture(v); } } if (m.uniforms) for (const u in m.uniforms) { const v = m.uniforms[u].value; if (v && v.isTexture && !v.isRenderTargetTexture && !seen.has(v)) { seen.add(v); renderer.initTexture(v); } } } }); }
  setLoading(0.9, 'lighting');
  bakeEnvironment();
  try { await renderer.compileAsync(scene, camera); } catch {}
  // prewarm: draw every object once through every pass (GPU pipeline states are created on first draw, which would
  // otherwise stall the first frame that looks at a new corner of the room)
  setLoading(0.95, 'warming up');
  { const fc = []; scene.traverse(o => { if (o.isMesh && o.frustumCulled) { fc.push(o); o.frustumCulled = false; } });
    for (const pp of [[1.6, 5.2], [12, 6], [7, 9]]) { camera.position.set(pp[0], 1.6, pp[1]); camera.lookAt(7.5, 1, 5.6); camera.updateMatrixWorld(); renderReflection(); composer.render(0.016); }
    fc.forEach(o => (o.frustumCulled = true)); }
  promptEl = document.createElement('div'); promptEl.id = 'prompt3d'; promptEl.hidden = true; document.querySelector('.playfield').appendChild(promptEl);
  const help = document.createElement('div'); help.id = 'help3d'; help.innerHTML = '<kbd>WASD</kbd> walk · <kbd>Shift</kbd> run · drag to look · <kbd>E</kbd> use desk';
  document.querySelector('.playfield').appendChild(help); setTimeout(() => help.classList.add('fade'), 9000);
  const st = document.createElement('style'); st.textContent = 'html.o3d-shot #nib-bubble,html.o3d-shot #help3d{display:none!important}'; document.head.appendChild(st);
  if (Q.has('fps')) { fpsEl = document.createElement('div'); fpsEl.id = 'fps3d'; document.body.appendChild(fpsEl); }
  document.documentElement.classList.add('o3d');
  world.setExternal(true);
  bindInput(canvas); watchWindows();
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(); });
  // pause when hidden; survive a lost GPU context
  document.addEventListener('visibilitychange', () => { renderer.setAnimationLoop(document.hidden || ctxLost ? null : loop); tPrev = 0; });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ctxLost = true; renderer.setAnimationLoop(null); }, false);
  canvas.addEventListener('webglcontextrestored', () => { ctxLost = false; for (const l of C.lights) if (l.castShadow) l.shadow.needsUpdate = true; bakeIrradiance(); bakeEnvironment(); renderer.setAnimationLoop(loop); }, false);
  STATS.gpuMB = estimateGPU();
  window.Office3D = {
    ready: false, renderer, scene, camera, shots, shot,
    quality: q => { if (q) { quality = q; try { localStorage.setItem('fo.q3d', q); } catch {} applyQuality(); STATS.gpuMB = estimateGPU(); } return quality; },
    fps: () => fpsNow, view: (y, p, d) => { yaw = y; pitch = p; dist = d; camInit = false; freeCam = null; },
    cam: (p, t, o = {}) => { freeCam = { p: V3(...p), t: V3(...t), ...o }; },
    stations: () => Object.keys(USE), interact, leave: leaveInteraction,
    stats: () => ({ fps: Math.round(fpsNow * 10) / 10, frameMs: Math.round(STATS.frameMs * 10) / 10, calls: STATS.calls, triangles: STATS.tris, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, gpuMB: Math.round(STATS.gpuMB), quality, pixelRatio: renderer.getPixelRatio() }),
    prepass: on => (prepassOn = on), passes: { gtao: () => gtao, bloom: () => bloom, smaa: () => smaa, grade: () => grade, cine: () => cine },
    lights: () => C.lights, rebake: bakeEnvironment, irr: IRR, refl: REFL, robot: () => robot,
    dbg: () => ({ pos: pos.toArray(), vis: vis.toArray(), act: act && { id: act.id, phase: act.phase }, keys: { ...keys }, speedNow, yaw, heading, active: world.active(), st: world.getState() }),
  };
  renderer.setAnimationLoop(loop);
}
let ctxLost = false, firstFrame = true;
let rebakeAt = 0;
function loop() {
  // per-frame draw stats; if an external tool is accumulating renderer.info (autoReset off), measure by difference
  const I = renderer.info, ext = I.autoReset === false; let c0 = 0, t0r = 0;
  if (ext) { c0 = I.render.calls; t0r = I.render.triangles; } else { I.autoReset = false; I.reset(); }
  const now = performance.now() / 1000, dt = tPrev ? Math.min(0.05, now - tPrev) : 0.016; tPrev = now; const t = now - t0;
  const _p0 = performance.now(); updatePlayer(dt); const _p1 = performance.now(); updateCamera(dt); updatePrompt(); const _p2 = performance.now();
  if ((frames & 15) === 0 && syncStations()) rebakeAt = now + 0.5;
  if (rebakeAt && now > rebakeAt) { rebakeAt = 0; for (const l of C.lights) if (l.castShadow) l.shadow.needsUpdate = true; bakeIrradiance(); bakeEnvironment(); }
  const np = G.nib?.pos?.();
  if (np && nib3d) { const tx = np.x * K, tz = np.y * K; nib3d.position.x += (tx - nib3d.position.x) * Math.min(1, dt * 4); nib3d.position.z += (tz - nib3d.position.z) * Math.min(1, dt * 4); nib3d.position.y = 1.45 + Math.sin(t * 2.2) * 0.04; const look = Math.atan2(pos.x - nib3d.position.x, pos.z - nib3d.position.z); nib3d.rotation.y += (((look - nib3d.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3); }
  tickRoom(t);
  for (const m of hazeMats) m.uniforms.time.value = t;
  const gt = getGoalTex(); if (gt && (Math.floor(t * 60) % 120) === 0) gt.userData.redraw();
  grade.uniforms.time.value = t;
  cine.uniforms.focus.value = DOF.focus; cine.uniforms.ap.value = DOF.ap; cine.uniforms.near.value = camera.near; cine.uniforms.far.value = camera.far; cine.uniforms.projInv.value.copy(camera.projectionMatrixInverse); cine.uniforms.camWorld.value.copy(camera.matrixWorld);
  const _p3 = performance.now(); renderReflection(); const _p4 = performance.now();
  composer.render(dt); const _p5 = performance.now();
  if (_p5 - _p0 > 45 && (window.__slow || []).length < 50) (window.__slow || (window.__slow = [])).push({ player: _p1 - _p0, cam: _p2 - _p1, mid: _p3 - _p2, refl: _p4 - _p3, comp: _p5 - _p4, act: act && act.id + ':' + act.phase });
  STATS.calls = I.render.calls - c0; STATS.tris = I.render.triangles - t0r; if (!ext) I.autoReset = true; STATS.frameMs += (dt * 1000 - STATS.frameMs) * 0.1;
  if (firstFrame) { firstFrame = false; hideLoading(); window.Office3D.ready = true; window.Office3D.firstFrameAt = performance.now(); }
  frames++; fpsT += dt;
  if (fpsT >= 1) {
    fpsNow = frames / fpsT; frames = 0; fpsT = 0; if (fpsEl) fpsEl.textContent = Math.round(fpsNow) + ' fps · ' + quality;
    if (!Q.get('q') && t > 6 && fpsNow < 30 && document.visibilityState === 'visible') { if (++slowFor >= 4 && quality !== 'low') { quality = quality === 'high' ? 'medium' : 'low'; applyQuality(); slowFor = 0; } } else slowFor = 0;
  }
}

// Boot once game.js has made the world.
if (want3d()) {
  showLoading();
  let tries = 0;
  const wait = () => { if (window.Stage2?.world?.setExternal) start().catch(e => { console.warn('office3d: staying 2D', e); fallback2D(); }); else if (++tries < 300) setTimeout(wait, 100); else fallback2D(); };
  wait();
}
