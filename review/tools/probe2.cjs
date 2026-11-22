const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { const s = p.getByRole('button', { name: 'Start', exact: true }); if (await s.isVisible().catch(() => false)) await s.click().catch(() => {}); const g = p.getByText('Play without an account'); if (await g.isVisible().catch(() => false)) await g.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const O = window.Office3D, out = {};
    await O.interact('hunt'); await new Promise(r => setTimeout(r, 2500));
    const V = O.robot.position.constructor; O.robot.updateMatrixWorld(true);
    const pts = []; O.robot.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.attributes.position; const st = Math.max(1, Math.ceil(pos.count / 8000)); for (let i = 0; i < pos.count; i += st) { const v = new V(); if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); v.applyMatrix4(o.matrixWorld); pts.push(v); } });
    // raw triangle test: for every scene mesh near the robot (not robot), count robot points within 1 cm of the mesh's triangles? cheaper: count mesh vertices inside the robot's per-bone hull approx = inside robot AABB shrunk
    let mn = new V(1e9,1e9,1e9), mx = new V(-1e9,-1e9,-1e9); for (const q of pts) { mn.min(q); mx.max(q); }
    const res = [];
    O.scene.traverse(o => { if (!o.isMesh || !o.visible) return; for (let q = o; q; q = q.parent) if (q === O.robot) return; const pos = o.geometry.attributes.position; if (!pos) return; o.updateMatrixWorld(true);
      let n = 0, ex = []; const v = new V(); for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.x > mn.x && v.x < mx.x && v.y > 1.15 && v.y < mx.y && v.z > mn.z && v.z < mx.z) { n++; if (ex.length < 3) ex.push(v.toArray().map(x => +x.toFixed(2))); } }
      if (n) res.push([o.name || o.parent?.name, n, ex]); });
    out.robotBox = [mn.toArray().map(x => +x.toFixed(2)), mx.toArray().map(x => +x.toFixed(2))]; out.meshVertsInHeadZone = res;
    return out;
  })));
  await b.close();
})();
