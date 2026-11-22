#!/usr/bin/env node
// Reviewer harness for the 3D office (office3d/SPEC.md section 2 budgets + section 3 hooks).
// Usage: node review/review3d.cjs [--round N] [--loop SEC] [--port P] [--no-low] [--no-shots] [--no-leak]
//          [--no-clip] [--only-clip] [--dense hunt,lounge|all|none] [--clip-loop MS]
//   --only-clip  load + interpenetration test + dense frames only (fast; perf budgets marked 'not measured')
//   --round   output folder name under review/out/ (default: "dev")
//   --loop    seconds for the play-loop leak check (default 180; SPEC budget is defined for 180)
//   --port    server port (default 55190)
// Writes review/out/<round>/report.json, report.md, screenshots (shots/, stations/<id>/), console.txt.
const PW = '/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const ROUND = String(arg('round', 'dev'));
const LOOP_S = +arg('loop', 180);
const PORT = arg('port', 55190);
const BASE = `http://localhost:${PORT}/`;
const OUT = path.join(__dirname, 'out', ROUND);
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'stations'), { recursive: true });
const ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const { clipTest, denseFrames } = require('./clip.cjs');
const ONLY_CLIP = !!arg('only-clip', false);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function otherChromes() {
  try { return +execSync(`ps ax -o command | grep -i -E "chrome.*(headless|remote-debugging)" | grep -v grep | grep -v -- "--type=" | wc -l`).toString().trim(); } catch { return -1; }
}
function loadAvg() { try { return execSync('sysctl -n vm.loadavg').toString().trim(); } catch { return '?'; } }

// In-page instrumentation (runs before any page script).
function initScript(opts) {
  if (opts.nowebdriver) { try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); } catch {} }
  try { if (!localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); } catch {}
  const R = window.__rv = { ts: [], first3d: null, canvasAt: null, twoDSeen: false };
  const tick = t => { R.ts.push(t); if (R.ts.length > 400000) R.ts.splice(0, 200000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // first 3D frame: Office3D exists (and ready, if the hook exists) and the renderer has drawn at least once
  const poll = () => {
    const O = window.Office3D;
    if (!R.canvasAt && document.getElementById('o3d')) R.canvasAt = performance.now();
    if (O && O.renderer && ('ready' in O ? O.ready : true) && O.renderer.info.render.frame > 0) { requestAnimationFrame(() => { R.first3d = performance.now(); }); return; }
    setTimeout(poll, 20);
  };
  poll();
}

// ---------- in-page helpers (evaluated) ----------
const HOOKS = () => { const O = window.Office3D || {}; const h = {}; for (const k of ['ready', 'shots', 'shot', 'stations', 'interact', 'leave', 'stats', 'quality', 'colliders']) h[k] = k === 'ready' ? ('ready' in O ? O.ready : 'MISSING') : (typeof O[k] === 'function' ? 'ok' : 'MISSING'); h.robot = !O.robot ? 'MISSING' : (O.robot.isObject3D ? 'ok' : (typeof O.robot === 'function' ? 'function (SPEC wants Object3D)' : 'not an Object3D')); return h; };

function sceneAudit() {
  const O = window.Office3D, r = O.renderer, scene = O.scene;
  const texs = new Map(), geos = new Map(); let shadowLights = 0, lights = 0; const shadowList = [];
  const addTex = t => { if (t && t.isTexture && !texs.has(t.uuid)) texs.set(t.uuid, t); };
  scene.traverse(o => {
    if (o.isLight) { lights++; if (o.castShadow) { shadowLights++; shadowList.push(`${o.type}:${o.name || ''}:${o.shadow?.mapSize?.x}`); } }
    if (o.geometry && !geos.has(o.geometry.uuid)) geos.set(o.geometry.uuid, o.geometry);
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { for (const k in m) { const v = m[k]; if (v && v.isTexture) addTex(v); } if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (v && v.isTexture) addTex(v); if (Array.isArray(v)) v.forEach(x => x && x.isTexture && addTex(x)); } }
  });
  addTex(scene.environment); addTex(scene.background);
  let texBytes = 0, maxTex = 0; const big = [];
  for (const t of texs.values()) {
    const img = t.image; let w = 0, h = 0, faces = 1;
    if (Array.isArray(img)) { faces = img.length; w = img[0]?.width || 0; h = img[0]?.height || 0; }
    else if (img) { w = img.width || img.videoWidth || 0; h = img.height || img.videoHeight || 0; }
    if (t.isRenderTargetTexture || (!w && t.source?.data)) { w = w || t.source?.data?.width || 0; h = h || t.source?.data?.height || 0; }
    const depth = img?.depth || 1;
    const bpp = t.type === 1016 /*HalfFloat*/ ? 8 : t.type === 1015 /*Float*/ ? 16 : 4;
    const mip = (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003) ? 1.33 : 1;
    texBytes += w * h * depth * faces * bpp * mip;
    const m = Math.max(w, h); if (m > maxTex) maxTex = m; if (m > 2048) big.push(`${t.name || t.uuid.slice(0, 6)} ${w}x${h}`);
  }
  let geoBytes = 0; for (const g of geos.values()) { for (const a of Object.values(g.attributes || {})) geoBytes += a.array?.byteLength || a.data?.array?.byteLength || 0; if (g.index) geoBytes += g.index.array.byteLength; }
  const db = { x: r.domElement.width, y: r.domElement.height };
  const rtBytes = db.x * db.y * 8 * 6; // ~6 HalfFloat RGBA full-res targets for the composer chain (estimate)
  const st = typeof O.stats === 'function' ? O.stats() : null;
  return {
    textures: texs.size, geometries: geos.size, texMB: texBytes / 1048576, geoMB: geoBytes / 1048576, rtMB: rtBytes / 1048576,
    estGpuMB: (texBytes + geoBytes + rtBytes) / 1048576, maxTex, bigTextures: big, lights, shadowLights, shadowList,
    rendererMemory: { ...r.info.memory }, programs: r.info.programs?.length, pixelRatio: r.getPixelRatio(), drawingBuffer: [db.x, db.y], stats: st,
  };
}

// Measure renderer.info per game frame over `ms` (accumulates all render() calls of the frame: passes, reflections).
async function frameInfo(ms) {
  const r = window.Office3D.renderer; const info = r.info; info.autoReset = false; info.reset();
  const orig = r.render; let maxPass = 0, maxPassTris = 0; r.render = function (...a) { const c0 = info.render.calls, t0 = info.render.triangles; const res = orig.apply(this, a); const dc = info.render.calls - c0; if (dc > maxPass) { maxPass = dc; maxPassTris = info.render.triangles - t0; } return res; };
  let frames = 0; let on = true; const c = () => { if (!on) return; frames++; requestAnimationFrame(c); }; requestAnimationFrame(c);
  await new Promise(res => setTimeout(res, ms)); on = false;
  const out = { frames, calls: info.render.calls / Math.max(1, frames), triangles: info.render.triangles / Math.max(1, frames), points: info.render.points / Math.max(1, frames), lines: info.render.lines / Math.max(1, frames), textures: info.memory.textures, geometries: info.memory.geometries };
  out.maxPassCalls = maxPass; out.maxPassTris = maxPassTris; r.render = orig;
  info.autoReset = true; info.reset();
  out.stats = typeof window.Office3D.stats === 'function' ? window.Office3D.stats() : null;
  return out;
}

function frameStats(deltas) {
  if (!deltas.length) return { n: 0 };
  const s = [...deltas].sort((a, b) => a - b), mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const p = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: deltas.length, avgFps: 1000 / mean, p5Fps: 1000 / p(0.95), p1Fps: 1000 / p(0.99), worstMs: s[s.length - 1], p95Ms: p(0.95), over40: deltas.filter(d => d > 40).length, over100: deltas.filter(d => d > 100).length };
}
const deltasBetween = (ts, a, b) => { const d = []; for (let i = 1; i < ts.length; i++) if (ts[i - 1] >= a && ts[i] <= b) d.push(ts[i] - ts[i - 1]); return d; };

async function gate(page) {
  // sign-in / intro skipping (as in the old shoot.cjs), polled quickly so it does not inflate first-frame time much
  const t0 = Date.now(); let clicked = 0;
  while (Date.now() - t0 < 120000) {
    const st = await page.evaluate(() => ({ o: !!window.Office3D, ready: window.Office3D ? ('ready' in window.Office3D ? !!window.Office3D.ready : true) : false, f: window.__rv?.first3d })).catch(() => ({}));
    if (st.o && st.ready && st.f) return { ok: true, clicked };
    const guest = page.getByText('Play without an account'); if (await guest.isVisible().catch(() => false)) { await guest.click().catch(() => {}); clicked++; }
    const start = page.getByRole('button', { name: 'Start', exact: true }); if (await start.isVisible().catch(() => false)) { await start.click().catch(() => {}); clicked++; }
    await sleep(150);
  }
  return { ok: false, clicked };
}

async function openPage(browser, { w, h, url, label }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable').catch(() => {});
  const net = { bytes: 0, reqs: 0, byUrl: {} }; const urls = {};
  cdp.on('Network.requestWillBeSent', e => { urls[e.requestId] = e.request.url; });
  cdp.on('Network.loadingFinished', e => { net.bytes += e.encodedDataLength; net.reqs++; const u = (urls[e.requestId] || '?').replace(BASE, '/'); net.byUrl[u] = (net.byUrl[u] || 0) + e.encodedDataLength; });
  const logs = [];
  const lag = []; page.on('console', m => { const t = m.type(), x = m.text(); if (x.startsWith('[lag]')) { lag.push(`[${label}] ${x}`); return; } if (t === 'error' || (t === 'warning' && /webgl|GL_|GL ERROR|THREE\.|shader|context lost/i.test(x))) logs.push(`[${label}] ${t}: ${x}`); });
  page.on('pageerror', e => logs.push(`[${label}] pageerror: ${e.message}`));
  await page.addInitScript(initScript, { nowebdriver: true });
  return { ctx, page, cdp, net, logs, lag };
}

const mb = b => b / 1048576;
async function heap(page, cdp, gc) { if (gc) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await sleep(500); } return page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null); }

function clipMd(R) {
  const c = R.clip; if (!c) return ['(not run)'];
  const out = [`- colliders: ${c.info?.colliders} (${c.info?.colSource}; contact-flagged ${c.info?.contactColliders}; hook quality ${JSON.stringify(c.info?.colliderNames)}; room ${JSON.stringify(c.info?.room)}; bone volumes ${c.info?.boneVolumes}); robot sample points ${c.info?.points}; robot hook: ${c.info?.robotHook}; gating: ${c.gating}`];
  const rows = [...(c.hits || []), ...(c.geom || []).map(h => ({ ...h, object: h.object + ' [geom]' })), ...(c.cam || [])];
  if (rows.length) { out.push('', '| station | phase | t (ms) | part | object | depth cm |', '|---|---|---|---|---|---|'); for (const h of rows.slice(0, 80)) out.push(`| ${h.station} | ${h.phase} | ${h.tMs} | ${h.part} | ${h.object}${h.contact ? ' (' + h.contact + ')' : ''}${h.approx ? ' ~' : ''} | ${h.depthCm} |`); if (rows.length > 80) out.push(`| ... ${rows.length - 80} more in report.json | | | | | |`); }
  out.push('', '| run | samples | max local motion (pop check, robot frame) | foot slide in loop (cm) | lowest robot point by phase (cm, floor=0) |', '|---|---|---|---|---|');
  for (const r of c.results || []) out.push(`| ${r.label} | ${r.samples} | ${r.popMax?.v != null ? `${r.popMax.v} m/s (${r.popMax.dCm} cm ${r.popMax.part} @${r.popMax.tMs} ${r.popMax.phase})` : '-'} | ${JSON.stringify(r.footSlideCm || {})} | ${JSON.stringify(r.minYcmByPhase || {})} |`);
  out.push('', 'Floor hits (robot below y=0 beyond tolerance) are gating once colliders() exists. Pop check: > ~3 m/s local motion in the robot frame between 100 ms samples suggests a snap. Foot slide > 3 cm in a static loop = sliding. Lowest point > 2 cm while standing = floating. `~` = box from mesh bounds (approximate).');
  if (c.contacts) { out.push('', '### Contact gate (intended contacts per station: review/clip.cjs CONTACTS)', '', '| station | contact | kind | part | nearest surface | gap cm | result |', '|---|---|---|---|---|---|---|'); for (const x of c.contacts) out.push(`| ${x.station} | ${x.label} | ${x.kind} | ${x.part ?? '-'} | ${x.object ?? '-'} | ${x.gapCm} | ${x.pass ? 'PASS' : '**FAIL**'} |`); }
  if (R.dense) out.push('', `- dense frame sequences: ${JSON.stringify(R.dense)} -> stations/<id>/dense/, dense-sheet.jpg`);
  return out;
}

(async () => {
  const R = { round: ROUND, date: new Date().toISOString(), url: BASE, loopSeconds: LOOP_S, env: { chromesBefore: otherChromes(), loadBefore: loadAvg() }, hooks: {}, budgets: [], views: {}, stations: {}, notes: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
  const A = await openPage(browser, { w: 1920, h: 1080, url: BASE, label: 'default' });
  const { page, cdp } = A;
  log('default run: goto', BASE);
  const navT = Date.now();
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 }).catch(e => R.notes.push('goto: ' + e.message));
  await sleep(1200); await page.screenshot({ path: path.join(OUT, 'shots', '_loading-1s.png') }).catch(() => {});
  const g = await gate(page);
  R.gate = g;
  const early = await page.evaluate(() => ({ first3d: window.__rv.first3d, canvasAt: window.__rv.canvasAt, has: !!window.Office3D, is3d: document.documentElement.classList.contains('o3d') }));
  R.firstFrameMs = early.first3d; R.canvasAtMs = early.canvasAt;
  if (!g.ok || !early.has) {
    R.fatal = 'Office3D never became ready on the default path (no ?3d, webdriver=false).';
    await page.screenshot({ path: path.join(OUT, 'shots', '_fatal.png') }).catch(() => {});
  }
  if (!R.fatal) {
    R.hooks = await page.evaluate(HOOKS);
    log('hooks', JSON.stringify(R.hooks));
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await sleep(3000);
    R.audit = await page.evaluate(sceneAudit);
    R.heapAfterLoad = mb(await heap(page, cdp, false));
    // ---------- scripted tour (perf; no screenshots during it) ----------
    const views = await page.evaluate(() => (window.Office3D.shots ? window.Office3D.shots() : [{ name: 'wide' }]));
    const stations = await page.evaluate(() => typeof window.Office3D.stations === 'function' ? window.Office3D.stations() : null);
    R.stationList = stations; if (!stations) R.notes.push('Office3D.stations() MISSING HOOK; station tour/screens use fallbacks');
    const fallbackStations = await page.evaluate(() => (window.CantinaWorld?.stations || []).filter(s => s.room === 'office').map(s => s.id));
    const stIds = stations || fallbackStations;
    if (!ONLY_CLIP) {
    const tourStart = await page.evaluate(() => performance.now());
    log('tour: views', views.length, 'stations', stIds.length);
    for (const v of views) {
      await page.evaluate(n => window.Office3D.shot(n), v.name).catch(() => {});
      await sleep(800);
      R.views[v.name] = await page.evaluate(frameInfo, 700);
    }
    // camera orbit around the player in gameplay view
    await page.evaluate(() => window.Office3D.shot && window.Office3D.shot('gameplay'));
    const hasView = await page.evaluate(() => typeof window.Office3D.view === 'function');
    for (let i = 0; i <= 40 && hasView; i++) { await page.evaluate(i => window.Office3D.view(i / 40 * Math.PI * 2, 0.15 + 0.1 * Math.sin(i / 6), 2.6), i); await sleep(100); }
    R.views['_orbit'] = await page.evaluate(frameInfo, 500);
    // walk around (keyboard)
    await page.focus('#o3d').catch(() => {});
    for (const [k, ms] of [['KeyW', 1500], ['KeyD', 900], ['KeyS', 1500], ['KeyA', 900]]) { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); }
    R.views['_walk'] = await page.evaluate(frameInfo, 400);
    // every station interaction
    for (const id of stIds) {
      const res = await page.evaluate(async id => {
        const O = window.Office3D; if (typeof O.interact !== 'function') { const n = 'desk-' + id; if (O.shot) O.shot(O.shots().some(s => s.name === n) ? n : id); return 'MISSING'; }
        try { await Promise.race([O.interact(id), new Promise((_, j) => setTimeout(() => j(new Error('interact timeout 15s')), 15000))]); return 'ok'; } catch (e) { return 'error: ' + e.message; }
      }, id);
      R.stations[id] = { interact: res };
      await sleep(1500);
      R.views['station:' + id] = await page.evaluate(frameInfo, 600);
      await page.evaluate(() => { const O = window.Office3D; if (typeof O.leave === 'function') return O.leave(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }).catch(() => {});
      await sleep(700);
    }
    const tourEnd = await page.evaluate(() => performance.now());
    const ts = await page.evaluate(() => window.__rv.ts);
    // exclude the first 2 s after the first 3D frame
    const from = Math.max(tourStart, (R.firstFrameMs || 0) + 2000);
    R.tour = { ms: tourEnd - tourStart, ...frameStats(deltasBetween(ts, from, tourEnd)) };
    const afterLoad = frameStats(deltasBetween(ts, (R.firstFrameMs || 0) + 2000, tourEnd));
    R.worstFrameAfterLoadMs = afterLoad.worstMs;
    R.statsAfterTour = await page.evaluate(() => typeof window.Office3D.stats === 'function' ? window.Office3D.stats() : null);
    R.heapSteady = mb(await heap(page, cdp, true));
    R.auditAfterTour = await page.evaluate(sceneAudit);
    log('tour done', JSON.stringify(R.tour));
    }

    // ---------- screenshots ----------
    if (!arg('no-shots', false) && !ONLY_CLIP) {
      await page.evaluate(() => document.documentElement.classList.add('o3d-shot'));
      for (const v of views) {
        await page.evaluate(n => window.Office3D.shot(n), v.name).catch(() => {});
        await sleep(v.wait || 2500);
        await page.screenshot({ path: path.join(OUT, 'shots', `${v.name}.png`) });
      }
      for (const id of stIds) {
        const dir = path.join(OUT, 'stations', id); fs.mkdirSync(dir, { recursive: true });
        await page.evaluate(() => { const O = window.Office3D; if (O.shot) O.shot('gameplay'); });
        await sleep(400);
        const res = await page.evaluate(async id => {
          const O = window.Office3D; if (typeof O.interact !== 'function') { const n = 'desk-' + id; if (O.shot) O.shot(O.shots().some(s => s.name === n) ? n : 'using-desk'); return 'MISSING'; }
          try { await Promise.race([O.interact(id), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 15000))]); return 'ok'; } catch (e) { return 'error: ' + e.message; }
        }, id);
        await sleep(900);
        await page.screenshot({ path: path.join(dir, 'mid.png') });
        for (let i = 0; i < 4; i++) { await sleep(250); await page.screenshot({ path: path.join(dir, `f${i}.png`), scale: 'css' }); }
        await page.evaluate(() => { const O = window.Office3D; if (typeof O.leave === 'function') return O.leave(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); }).catch(() => {});
        await sleep(500);
        await page.screenshot({ path: path.join(dir, 'exit.png') });
        R.stations[id] = { ...(R.stations[id] || {}), shots: res };
      }
      await page.evaluate(() => document.documentElement.classList.remove('o3d-shot'));
    }

    // ---------- interpenetration / glitch test (SPEC 1b) ----------
    if (!arg('no-clip', false)) {
      log('clip test');
      await page.evaluate(() => document.documentElement.classList.remove('o3d-shot'));
      R.clip = await clipTest(page, stIds, { loopMs: +arg('clip-loop', 3500), log });
      const dz = String(arg('dense', 'hunt,lounge')); const dIds = dz === 'none' ? [] : dz === 'all' ? stIds : dz.split(',').filter(x => stIds.includes(x));
      R.dense = {};
      for (const id of dIds) {
        const dir = path.join(OUT, 'stations', id, 'dense'); fs.rmSync(dir, { recursive: true, force: true });
        const n = await denseFrames(page, id, dir); R.dense[id] = n;
        try { execSync(`ffmpeg -loglevel error -y -framerate 1 -pattern_type glob -i '${dir}/*.jpg' -vf "scale=640:360,tile=6x${Math.ceil(n / 6)}" -frames:v 1 '${path.join(OUT, 'stations', id, 'dense-sheet.jpg')}'`); } catch (e) { R.notes.push('dense sheet ' + id + ': ' + e.message.slice(0, 80)); }
        log('dense', id, n, 'frames');
      }
    }

    // ---------- leak loop ----------
    if (!arg('no-leak', false) && LOOP_S > 0 && !ONLY_CLIP) {
      log('leak loop', LOOP_S, 's');
      await page.evaluate(() => { const O = window.Office3D; if (O.shot) O.shot('gameplay'); });
      await sleep(1000); await page.evaluate(() => document.documentElement.classList.remove('o3d-shot'));
      const h0 = await heap(page, cdp, true); const samples = [mb(h0)];
      const loopStart = Date.now(); let i = 0;
      while (Date.now() - loopStart < LOOP_S * 1000) {
        await page.focus('#o3d').catch(() => {});
        const k = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][i % 4]; await page.keyboard.down(k); await page.keyboard.down('ShiftLeft'); await sleep(1200); await page.keyboard.up('ShiftLeft'); await page.keyboard.up(k);
        const id = stIds[i % Math.max(1, stIds.length)];
        if (id) {
          await page.evaluate(async id => { const O = window.Office3D; if (typeof O.interact === 'function') { try { await Promise.race([O.interact(id), new Promise(r => setTimeout(r, 8000))]); } catch {} } else if (O.shot) O.shot('desk-' + id); }, id);
          await sleep(2000);
          await page.evaluate(() => { const O = window.Office3D; if (typeof O.leave === 'function') return O.leave(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); O.shot && O.shot('gameplay'); }).catch(() => {});
          await sleep(800);
        }
        if (i % 5 === 4) samples.push(mb(await heap(page, cdp, false)));
        i++;
      }
      const h1 = await heap(page, cdp, true); samples.push(mb(h1));
      R.leak = { seconds: LOOP_S, cycles: i, startMB: mb(h0), endMB: mb(h1), growthMB: mb(h1 - h0), samplesMB: samples.map(x => +x.toFixed(1)), rendererMemoryEnd: await page.evaluate(() => ({ ...window.Office3D.renderer.info.memory })) };
      log('leak', JSON.stringify(R.leak));
    }
    R.transfer = { bytes: A.net.bytes, MB: mb(A.net.bytes), requests: A.net.reqs, top: Object.entries(A.net.byUrl).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([u, b]) => [u, +mb(b).toFixed(2)]) };
    R.finalQuality = await page.evaluate(() => { try { return window.Office3D.stats ? window.Office3D.stats().quality : localStorage.getItem('fo.q3d'); } catch { return null; } });
  } else { R.transfer = { bytes: A.net.bytes, MB: mb(A.net.bytes), requests: A.net.reqs }; }
  R.consoleDefault = A.logs.slice(); R.lagDefault = A.lag.slice();
  await A.ctx.close();

  // ---------- low tier: ?3d&q=low, 1280x720, CPU x4 ----------
  if (!arg('no-low', false) && !ONLY_CLIP) {
    log('low tier run');
    const B = await openPage(browser, { w: 1280, h: 720, label: 'low' });
    await B.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await B.page.goto(BASE + '?3d&q=low', { waitUntil: 'load', timeout: 180000 }).catch(e => R.notes.push('low goto: ' + e.message));
    const gl = await gate(B.page);
    if (gl.ok) {
      await sleep(4000);
      const t0 = await B.page.evaluate(() => performance.now());
      const vs = await B.page.evaluate(() => (window.Office3D.shots ? window.Office3D.shots() : [])).catch(() => []);
      for (const v of vs.slice(0, 8)) { await B.page.evaluate(n => window.Office3D.shot(n), v.name).catch(() => {}); await sleep(1500); }
      await B.page.evaluate(() => window.Office3D.shot && window.Office3D.shot('gameplay')).catch(() => {});
      await B.page.focus('#o3d').catch(() => {});
      for (const k of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) { await B.page.keyboard.down(k); await sleep(1000); await B.page.keyboard.up(k); }
      const t1 = await B.page.evaluate(() => performance.now());
      const ts = await B.page.evaluate(() => window.__rv.ts);
      R.low = { ...frameStats(deltasBetween(ts, t0, t1)), first3dMs: await B.page.evaluate(() => window.__rv.first3d), stats: await B.page.evaluate(() => typeof window.Office3D.stats === 'function' ? window.Office3D.stats() : null), pixelRatio: await B.page.evaluate(() => window.Office3D.renderer.getPixelRatio()) };
      await B.page.screenshot({ path: path.join(OUT, 'shots', '_low-gameplay.png') });
    } else R.low = { fatal: 'low tier never became ready' };
    R.consoleLow = B.logs.slice(); R.lagLow = B.lag.slice();
    await B.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await B.ctx.close();
  }
  await browser.close();
  R.env.chromesAfter = otherChromes(); R.env.loadAfter = loadAvg();
  if (R.env.chromesBefore > 0 || R.env.chromesAfter > 0) R.notes.push(`CONTENTION: ${R.env.chromesBefore}/${R.env.chromesAfter} other automated Chrome instances seen before/after; perf numbers may be pessimistic.`);

  // ---------- budgets ----------
  const B = (name, value, ok, budget, unit = '') => R.budgets.push({ name, value: value == null || Number.isNaN(value) ? null : (typeof value === 'number' ? +value.toFixed(2) : value), unit, budget, pass: value == null ? false : ok });
  const hk = R.hooks || {};
  const views = Object.entries(R.views || {});
  const worstCalls = views.reduce((m, [n, v]) => v.calls > m[1] ? [n, v.calls] : m, ['', 0]);
  const worstTris = views.reduce((m, [n, v]) => v.triangles > m[1] ? [n, v.triangles] : m, ['', 0]);
  const gpu = R.statsAfterTour?.gpuMB ?? null; const gpuEst = R.auditAfterTour?.estGpuMB;
  const errs = (R.consoleDefault || []).length + (R.consoleLow || []).length;
  if (!ONLY_CLIP) {
  B('Tour p5 fps', R.tour?.p5Fps, R.tour?.p5Fps >= 25, '>= 25 fps');
  B('Tour avg fps', R.tour?.avgFps, R.tour?.avgFps >= 50, '>= 50 fps');
  B('Worst frame after first 2 s', R.worstFrameAfterLoadMs, R.worstFrameAfterLoadMs <= 100, '<= 100 ms', 'ms');
  B('JS heap steady state', R.heapSteady, R.heapSteady <= 250, '<= 250 MB', 'MB');
  B(`Heap growth over ${LOOP_S}s play loop`, R.leak?.growthMB, R.leak?.growthMB <= 20, '<= 20 MB' + (LOOP_S < 180 ? ' (SHORT RUN, not authoritative)' : ''), 'MB');
  B('GPU memory (' + (gpu != null ? 'stats().gpuMB' : 'MISSING HOOK stats.gpuMB; harness estimate') + ')', gpu ?? gpuEst, (gpu ?? gpuEst) <= 400 && gpu != null, '<= 400 MB', 'MB');
  B(`Draw calls worst view (${worstCalls[0]})`, worstCalls[1], worstCalls[1] <= 400, '<= 400');
  B(`Triangles worst view (${worstTris[0]})`, worstTris[1], worstTris[1] <= 1.5e6, '<= 1.5 M');
  B('Total transfer', R.transfer?.MB, R.transfer?.MB <= 60, '<= 60 MB', 'MB');
  B('Navigation to first 3D frame', R.firstFrameMs, R.firstFrameMs <= 8000, '<= 8000 ms', 'ms');
  B('Max texture size', R.auditAfterTour?.maxTex, R.auditAfterTour?.maxTex <= 2048 || (R.auditAfterTour?.maxTex <= 4096 && R.auditAfterTour.bigTextures.length <= 2), '2048 (4096 for <= 2 hero atlases)', 'px');
  B('Shadow-casting lights', R.auditAfterTour?.shadowLights, R.auditAfterTour?.shadowLights <= 4, '<= 4');
  B('Console errors / WebGL warnings', errs, errs === 0, '0');
  B('Low tier avg fps (q=low 1280x720 CPUx4)', R.low?.avgFps, R.low?.avgFps >= 30, '>= 30 fps');
  } else R.notes.push('ONLY-CLIP run: performance budgets not measured');
  if (R.clip) {
    const strictH = (R.clip.hits || []).filter(h => h.strictOnly); R.clip.strictOnly = strictH; R.notes.push(`FLAG AUDIT: ${strictH.length} contacts penetrate 1.5-3 cm into contact-flagged surfaces (allowed by the flag; would fail strict): ${strictH.sort((a, b) => b.depthCm - a.depthCm).slice(0, 6).map(h => `${h.part} in ${h.object} ${h.depthCm} cm @${h.station}/${h.phase}`).join('; ')}`);
    R.clip.hits = (R.clip.hits || []).filter(h => !h.strictOnly);
    const liveH = (R.clip.hits || []).filter(h => h.live); R.clip.hits = (R.clip.hits || []).filter(h => !h.live); R.clip.liveHits = liveH;
    const c = R.clip, nH = (c.hits || []).length, nC = (c.cam || []).length, worst = (c.hits || [])[0], worstC = (c.cam || [])[0];
    const val = c.info?.error ? c.info.error : !c.gating ? `MISSING HOOK colliders() (advisory fallback found ${nH} robot / ${nC} camera hits)` : `${nH} robot hits${worst ? `, worst ${worst.depthCm} cm ${worst.part} in ${worst.object} @${worst.station}` : ''}`;
    B('No interpenetration: robot vs colliders (SPEC 1b)', val, c.gating && nH === 0 && c.info?.robotHook === 'ok', '0 hits (tol 1.5 cm, 3 cm on contact surfaces)');
    const nG = (c.geom || []).length, wG = (c.geom || [])[0];
    R.notes.push(`ADVISORY: ${liveH.length} hits against MOVING collider boxes (world AABBs of rotated chair/safe parts are loose); the exact check for moving furniture is the live-geometry gate. Worst: ${liveH.sort((a, b) => b.depthCm - a.depthCm).slice(0, 3).map(h => `${h.part} in ${h.object} ${h.depthCm} cm @${h.station}`).join('; ')}`);
    B('No interpenetration: robot bone volumes vs live scene geometry (independent of proxies)', `${nG} hits${wG ? `, worst ${wG.depthCm} cm ${wG.part} in ${wG.object} @${wG.station}/${wG.phase}` : ''}`, nG === 0, '0 hits (bone boxes shrunk 1.5 cm)');
    const cf = (c.contacts || []).filter(x => !x.pass);
    B('Contact: resting hands/feet/seat within 3 cm of intended surface (every station loop)', c.contacts ? `${cf.length} of ${c.contacts.length} fail${cf.length ? ': ' + cf.map(x => `${x.station} ${x.label} ${x.gapCm} cm`).join('; ') : ''}` : 'not run', !!c.contacts && cf.length === 0, '<= 3 cm (hold: median over loop; tap: closest reach)');
    B('No camera clipping (vs colliders, room shell, robot)', c.gating ? `${nC} hits${worstC ? `, worst ${worstC.object} @${worstC.station}/${worstC.phase}` : ''}` : `MISSING HOOK colliders() (advisory ${nC})`, c.gating && nC === 0, '0 hits');
  }
  for (const k of ['robot', 'colliders']) B(`Hook Office3D.${k}`, hk[k] === 'MISSING' || hk[k] == null ? 'MISSING HOOK' : String(hk[k]), hk[k] === 'ok', 'present (SPEC 3)');
  for (const k of ['ready', 'stations', 'interact', 'leave', 'stats']) B(`Hook Office3D.${k}`, hk[k] === 'MISSING' || hk[k] == null ? 'MISSING HOOK' : String(hk[k]), hk[k] !== 'MISSING' && hk[k] != null && hk[k] !== false, 'present');
  for (const [id, s] of Object.entries(R.stations)) if (s.interact !== 'ok') B(`interact(${id})`, s.interact === 'MISSING' ? 'MISSING HOOK' : s.interact, false, 'resolves');
  if (R.fatal) B('Default path boots to 3D', R.fatal, false, 'ready');
  R.allPass = R.budgets.every(b => b.pass);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(OUT, 'console.txt'), [...(R.consoleDefault || []), ...(R.consoleLow || [])].join('\n'));

  const md = [];
  md.push(`# Office3D review — round ${ROUND}`, '', `${R.date} · ${BASE} · loop ${LOOP_S}s · final quality: ${R.finalQuality}`, '');
  if (R.notes.length) md.push(...R.notes.map(n => `- NOTE: ${n}`), '');
  md.push('| Budget | Value | Limit | Result |', '|---|---|---|---|');
  for (const b of R.budgets) md.push(`| ${b.name} | ${b.value ?? 'n/a'} ${b.value != null && typeof b.value === 'number' ? b.unit : ''} | ${b.budget} | ${b.pass ? 'PASS' : '**FAIL**'} |`);
  md.push('', `**All budgets pass: ${R.allPass ? 'YES' : 'NO'}**`, '', '## Per-view renderer.info (per game frame, all passes)', '', '| View | calls/frame | triangles/frame | biggest single pass calls | its tris | textures | geometries |', '|---|---|---|---|---|---|---|');
  for (const [n, v] of views) md.push(`| ${n} | ${Math.round(v.calls)} | ${Math.round(v.triangles).toLocaleString()} | ${v.maxPassCalls} | ${Math.round(v.maxPassTris || 0).toLocaleString()} | ${v.textures} | ${v.geometries} |`);
  const au = R.auditAfterTour || {};
  md.push('', '## Scene audit', '', `- textures ${au.textures}, geometries ${au.geometries}, tex ${au.texMB?.toFixed(1)} MB, geo ${au.geoMB?.toFixed(1)} MB, render targets (est) ${au.rtMB?.toFixed(1)} MB, total est ${au.estGpuMB?.toFixed(1)} MB`, `- max texture ${au.maxTex}px; >2048: ${(au.bigTextures || []).join(', ') || 'none'}`, `- lights ${au.lights}, shadow casters: ${(au.shadowList || []).join(', ')}`, `- pixelRatio ${au.pixelRatio}, drawing buffer ${au.drawingBuffer}`, `- stats(): ${JSON.stringify(R.statsAfterTour)}`, `- tour: ${JSON.stringify(R.tour)}`, `- leak: ${JSON.stringify(R.leak)}`, `- low: ${JSON.stringify(R.low)}`, `- transfer top: ${JSON.stringify(R.transfer?.top)}`, `- env: ${JSON.stringify(R.env)}`, '', '## Interpenetration / glitch sampler (SPEC 1b)', '', ...clipMd(R), '', '## Console', '', '```', ...(R.consoleDefault || []), ...(R.consoleLow || []), '```', '', '## Game [lag] hitch log (info, not counted)', '', '```', ...(R.lagDefault || []), ...(R.lagLow || []), '```');
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
  log('wrote', OUT, 'allPass', R.allPass);
})().catch(e => { console.error(e); process.exit(1); });
