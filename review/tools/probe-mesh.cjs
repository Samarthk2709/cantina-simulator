const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { const s = p.getByRole('button', { name: 'Start', exact: true }); if (await s.isVisible().catch(() => false)) await s.click().catch(() => {}); const g = p.getByText('Play without an account'); if (await g.isVisible().catch(() => false)) await g.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const O = window.Office3D; const inScene = o => { for (let q = o; q; q = q.parent) if (q === O.scene) return true; return false; };
    const cs = O.colliders(); const mesh = cs.filter(c => c.mesh);
    const det = mesh.filter(c => !inScene(c.mesh));
    const byStation = {}; for (const c of cs) if (c.station) (byStation[c.station] ||= []).push(c.name + (c.contact ? '[' + c.contact + ']' : '') + (c.mesh ? (inScene(c.mesh) ? '{mesh}' : '{DETACHED}') : ''));
    const chairs = cs.filter(c => /chair|seat/i.test(c.name)).map(c => c.name + ' ' + (c.contact || '') + ' ' + (c.mesh ? (inScene(c.mesh) ? 'mesh' : 'DETACHED') : 'box') + ' ' + c.box.min.toArray().map(x => x.toFixed(2)) + '..' + c.box.max.toArray().map(x => x.toFixed(2)));
    return { total: cs.length, mesh: mesh.length, detached: det.length, detNames: [...new Set(det.map(c => c.name))].slice(0, 30), chairs, hunt: byStation.hunt?.slice(0, 60), stats: byStation.stats };
  })));
  await b.close();
})();
