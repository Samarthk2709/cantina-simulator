// Camera collision against the real scene: every opaque static triangle of the room goes into a uniform grid once
// (after the static merge), moving furniture (chairs, safe door, Nib) is tested live. The camera rig asks two things:
//   hit(a, dir, len)  -> distance to the first surface along a segment (or Infinity)
//   clear(p, r)       -> true when no surface is within r of p
import * as THREE from 'three';

const _ray = new THREE.Raycaster(), _v = new THREE.Vector3(), _b = new THREE.Box3();

export function buildCamCol(scene, { x0, x1, z0, z1, y0 = -0.2, y1 = 3.6, margin = 0.6, cell = 0.25, skip = () => false }) {
  const bx0 = x0 - margin, bz0 = z0 - margin, by0 = y0;
  const nx = Math.ceil((x1 - x0 + 2 * margin) / cell), ny = Math.ceil((y1 - y0) / cell), nz = Math.ceil((z1 - z0 + 2 * margin) / cell);
  const opaque = m => m && !(m.transparent || m.depthWrite === false || m.colorWrite === false || m.visible === false);
  const visibleChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const moving = o => { for (let p = o; p; p = p.parent) if (p.userData.compact || p.userData.moving) return true; return false; };
  const statics = [], dynamics = [];
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position || skip(o)) return;
    if (!o.layers.test(_ray.layers) || !visibleChain(o)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!opaque(m)) return;
    (moving(o) || o.userData.dynamic ? dynamics : statics).push(o);
  });
  // triangles (world space), clipped to the room box
  const tris = []; const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), M = new THREE.Matrix4();
  const inRoom = (p, q, r) => !(Math.max(p.x, q.x, r.x) < bx0 || Math.min(p.x, q.x, r.x) > bx0 + nx * cell || Math.max(p.z, q.z, r.z) < bz0 || Math.min(p.z, q.z, r.z) > bz0 + nz * cell || Math.max(p.y, q.y, r.y) < by0 || Math.min(p.y, q.y, r.y) > by0 + ny * cell);
  for (const o of statics) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index; const n = idx ? idx.count : pos.count;
    const mats = o.isInstancedMesh ? Array.from({ length: o.count }, (_, i) => { const im = new THREE.Matrix4(); o.getMatrixAt(i, im); return new THREE.Matrix4().multiplyMatrices(o.matrixWorld, im); }) : [o.matrixWorld];
    const s = g.drawRange.start, e = Math.min(n, s + g.drawRange.count);
    for (const mw of mats) {
      M.copy(mw);
      for (let i = s; i + 2 < e; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        A.fromBufferAttribute(pos, a).applyMatrix4(M); B.fromBufferAttribute(pos, b).applyMatrix4(M); Cc.fromBufferAttribute(pos, c).applyMatrix4(M);
        if (!inRoom(A, B, Cc)) continue;
        tris.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z);
      }
    }
  }
  const T = new Float32Array(tris), nt = T.length / 9;
  // grid: count, prefix, fill
  const ncell = nx * ny * nz, cnt = new Uint32Array(ncell + 1);
  const ci = (v, o0, n) => Math.min(n - 1, Math.max(0, Math.floor((v - o0) / cell)));
  const range = (t, f) => {
    const o = t * 9; const mnx = Math.min(T[o], T[o + 3], T[o + 6]), mxx = Math.max(T[o], T[o + 3], T[o + 6]), mny = Math.min(T[o + 1], T[o + 4], T[o + 7]), mxy = Math.max(T[o + 1], T[o + 4], T[o + 7]), mnz = Math.min(T[o + 2], T[o + 5], T[o + 8]), mxz = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    const ix0 = ci(mnx, bx0, nx), ix1 = ci(mxx, bx0, nx), iy0 = ci(mny, by0, ny), iy1 = ci(mxy, by0, ny), iz0 = ci(mnz, bz0, nz), iz1 = ci(mxz, bz0, nz);
    for (let z = iz0; z <= iz1; z++) for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) f((z * ny + y) * nx + x);
  };
  for (let t = 0; t < nt; t++) range(t, c => cnt[c + 1]++);
  for (let c = 0; c < ncell; c++) cnt[c + 1] += cnt[c];
  const fill = cnt.slice(0, ncell), list = new Uint32Array(cnt[ncell]);
  for (let t = 0; t < nt; t++) range(t, c => { list[fill[c]++] = t; });
  const stamp = new Uint32Array(nt); let st = 1;
  const bump = () => { if (++st > 0xfffffff0) { stamp.fill(0); st = 1; } };

  // ray-triangle (double sided), returns t or Infinity
  const rayTri = (ox, oy, oz, dx, dy, dz, t) => {
    const o = t * 9;
    const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2], e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x; const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity; const inv = 1 / det;
    const sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2]; const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) return Infinity;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x; const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; return tt > 1e-5 ? tt : Infinity;
  };
  function hitStatic(a, d, len) { // 3D DDA through the grid
    bump(); let best = Infinity;
    let x = Math.floor((a.x - bx0) / cell), y = Math.floor((a.y - by0) / cell), z = Math.floor((a.z - bz0) / cell);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(cell / (d.x || 1e-9)), tdy = Math.abs(cell / (d.y || 1e-9)), tdz = Math.abs(cell / (d.z || 1e-9));
    let tmx = (((d.x > 0 ? x + 1 : x) * cell + bx0) - a.x) / (d.x || 1e-9), tmy = (((d.y > 0 ? y + 1 : y) * cell + by0) - a.y) / (d.y || 1e-9), tmz = (((d.z > 0 ? z + 1 : z) * cell + bz0) - a.z) / (d.z || 1e-9);
    let tc = 0;
    for (let guard = 0; guard < 400 && tc <= len; guard++) {
      if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) {
        const c = (z * ny + y) * nx + x;
        for (let k = cnt[c], ke = cnt[c + 1]; k < ke; k++) { const t = list[k]; if (stamp[t] === st) continue; stamp[t] = st; const h = rayTri(a.x, a.y, a.z, d.x, d.y, d.z, t); if (h < best) best = h; }
      }
      const tn = Math.min(tmx, tmy, tmz); if (best <= tn) break; tc = tn;
      if (tmx === tn) { x += sx; tmx += tdx; } else if (tmy === tn) { y += sy; tmy += tdy; } else { z += sz; tmz += tdz; }
    }
    return best <= len ? best : Infinity;
  }
  // squared distance point-triangle (Ericson)
  const d2Tri = (px, py, pz, t) => {
    const o = t * 9; const ax = T[o], ay = T[o + 1], az = T[o + 2];
    const abx = T[o + 3] - ax, aby = T[o + 4] - ay, abz = T[o + 5] - az, acx = T[o + 6] - ax, acy = T[o + 7] - ay, acz = T[o + 8] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
      const bpx = px - T[o + 3], bpy = py - T[o + 4], bpz = pz - T[o + 5]; const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = T[o + 3]; qy = T[o + 4]; qz = T[o + 5]; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
        else {
          const cpx = px - T[o + 6], cpy = py - T[o + 7], cpz = pz - T[o + 8]; const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = T[o + 6]; qy = T[o + 7]; qz = T[o + 8]; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = T[o + 3] + (T[o + 6] - T[o + 3]) * w; qy = T[o + 4] + (T[o + 7] - T[o + 4]) * w; qz = T[o + 5] + (T[o + 8] - T[o + 5]) * w; }
              else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
            }
          }
        }
      }
    }
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  };
  function clearStatic(p, r) {
    bump(); const r2 = r * r;
    const ix0 = ci(p.x - r, bx0, nx), ix1 = ci(p.x + r, bx0, nx), iy0 = ci(p.y - r, by0, ny), iy1 = ci(p.y + r, by0, ny), iz0 = ci(p.z - r, bz0, nz), iz1 = ci(p.z + r, bz0, nz);
    for (let z = iz0; z <= iz1; z++) for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      const c = (z * ny + y) * nx + x;
      for (let k = cnt[c], ke = cnt[c + 1]; k < ke; k++) {
        const t = list[k]; if (stamp[t] === st) continue; stamp[t] = st; const o = t * 9;
        if (Math.max(T[o], T[o + 3], T[o + 6]) < p.x - r || Math.min(T[o], T[o + 3], T[o + 6]) > p.x + r || Math.max(T[o + 1], T[o + 4], T[o + 7]) < p.y - r || Math.min(T[o + 1], T[o + 4], T[o + 7]) > p.y + r || Math.max(T[o + 2], T[o + 5], T[o + 8]) < p.z - r || Math.min(T[o + 2], T[o + 5], T[o + 8]) > p.z + r) continue;
        if (d2Tri(p.x, p.y, p.z, t) < r2) return false;
      }
    }
    return true;
  }
  // moving furniture: live raycasts and (slightly loose) world boxes
  const dynVisible = () => dynamics.filter(o => visibleChain(o));
  function hitDynamic(a, d, len) {
    _ray.set(a, d); _ray.near = 0; _ray.far = len;
    const h = _ray.intersectObjects(dynVisible(), false)[0]; return h ? h.distance : Infinity;
  }
  function clearDynamic(p, r) {
    for (const o of dynamics) { if (!visibleChain(o)) continue; const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld); if (_b.distanceToPoint(p) < r) {
      // box says close: confirm against the mesh with a few rays (boxes of chair star bases are mostly air)
      for (const dv of DIRS) { _ray.set(p, dv); _ray.near = 0; _ray.far = r; if (_ray.intersectObject(o, false).length) return false; }
    } }
    return true;
  }
  const DIRS = []; for (let i = 0; i < 27; i++) { const x = (i % 3) - 1, y = (Math.floor(i / 3) % 3) - 1, z = Math.floor(i / 9) - 1; if (x || y || z) DIRS.push(new THREE.Vector3(x, y, z).normalize()); }
  return {
    tris: nt, cells: ncell, dynamics: dynamics.length,
    hit(a, d, len) { return Math.min(hitStatic(a, d, len), hitDynamic(a, d, len)); },
    clear(p, r) { return clearStatic(p, r) && clearDynamic(p, r); },
    hitStatic, clearStatic,
  };
}

// Spring arm: from the pivot (robot head) toward the wanted camera position, stop where the camera sits at least `r`
// clear of everything and the robot's head and chest are in plain view.
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3();
export function solveCam(col, pivot, want, out, { r = 0.34, minDist = 0.55, chest = null, inRoom = null } = {}) {
  _d.subVectors(want, pivot); const len = _d.length(); if (len < 1e-4) return out.copy(want);
  _d.multiplyScalar(1 / len);
  const h = col.hit(pivot, _d, len + r);
  let t = Math.min(len, h - r);
  const step = 0.04;
  for (; t >= minDist; t -= step) {
    _p.copy(pivot).addScaledVector(_d, t);
    if (inRoom && !inRoom(_p)) continue;
    if (!col.clear(_p, r)) continue;
    if (chest) { _c.subVectors(chest, _p); const dl = _c.length(); _c.multiplyScalar(1 / dl); if (col.hit(_p, _c, dl) < dl - 0.2) continue; }
    return out.copy(_p);
  }
  return null; // nowhere on this line works
}
