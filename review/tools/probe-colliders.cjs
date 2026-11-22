// Probe: list colliders near each station and the raw (no-tolerance) overlaps of robot points while interacting.
const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { const g = p.getByText('Play without an account'); if (await g.isVisible().catch(() => false)) await g.click().catch(() => {}); const s = p.getByRole('button', { name: 'Start', exact: true }); if (await s.isVisible().catch(() => false)) await s.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(2000);
  const ids = (process.argv[2] || 'lounge,hunt,contract,stats').split(',');
  for (const id of ids) {
    const r = await p.evaluate(async id => {
      const O = window.Office3D; await O.interact(id); await new Promise(r => setTimeout(r, 2500));
      const rob = O.robot; rob.updateMatrixWorld(true); const V = rob.position.constructor;
      const pts = []; rob.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.attributes.position; const st = Math.max(1, Math.ceil(pos.count / (o.isSkinnedMesh ? 6000 : 200))); for (let i = 0; i < pos.count; i += st) { const v = new V(); if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); v.applyMatrix4(o.matrixWorld); pts.push(v); } });
      let mn = new V(1e9, 1e9, 1e9), mx = new V(-1e9, -1e9, -1e9); for (const q of pts) { mn.min(q); mx.max(q); }
      const out = [];
      for (const c of O.colliders()) {
        const bx = c.box; if (bx.max.x < mn.x - .3 || bx.min.x > mx.x + .3 || bx.max.z < mn.z - .3 || bx.min.z > mx.z + .3 || c.name === 'floor') continue;
        let n = 0, d = 0; for (const q of pts) if (bx.containsPoint(q)) { n++; d = Math.max(d, Math.min(q.x - bx.min.x, bx.max.x - q.x, q.y - bx.min.y, bx.max.y - q.y, q.z - bx.min.z, bx.max.z - q.z)); }
        out.push({ name: c.name, contact: c.contact || '', mesh: !!c.mesh, size: [bx.max.x - bx.min.x, bx.max.y - bx.min.y, bx.max.z - bx.min.z].map(x => +x.toFixed(2)), y: [+bx.min.y.toFixed(2), +bx.max.y.toFixed(2)], inside: n, depthCm: +(d * 100).toFixed(1) });
      }
      await O.leave(); await new Promise(r => setTimeout(r, 1500));
      return { id, robotBox: [mn.toArray().map(x => +x.toFixed(2)), mx.toArray().map(x => +x.toFixed(2))], near: out.sort((a, b) => b.inside - a.inside).slice(0, 14) };
    }, id);
    console.log(JSON.stringify(r));
  }
  await b.close();
})();
