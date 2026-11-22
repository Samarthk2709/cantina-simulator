const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const O = window.Office3D; await O.interact('lounge'); const V = O.robot.position.constructor; const out = [];
    const backs = O.colliders().filter(c => /sofa/i.test(c.name)).map(c => ({ n: c.name, min: c.box.min.toArray().map(x => +x.toFixed(2)), max: c.box.max.toArray().map(x => +x.toFixed(2)) }));
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 500)); const g = n => O.robot.getObjectByName(n).getWorldPosition(new V()).toArray().map(x => +x.toFixed(2)); const sh = O.robot.getObjectByName('lSh').getWorldPosition(new V()), wr = O.robot.getObjectByName('lWr').getWorldPosition(new V()); const ang = Math.atan2(sh.y - wr.y, Math.hypot(wr.x - sh.x, wr.z - sh.z)) * 180 / Math.PI; out.push({ t: i * 0.5, lWr: g('lWr'), rWr: g('rWr'), lSh: g('lSh'), armDropDeg: +ang.toFixed(0) }); }
    return { backs, out };
  })));
  await b.close();
})();
