// Self-test: put a cloned dense prop inside the robot's chest and a box collider at its hips; both checks must fire.
const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
const { inPageInstall } = require('../clip.cjs');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const O = window.Office3D; O.shot('gameplay'); await new Promise(r => setTimeout(r, 500));
    let src = null; O.scene.traverse(o => { if (!src && o.isMesh && !o.isSkinnedMesh && o.geometry.attributes.position.count > 400 && o.geometry.attributes.position.count < 5000) src = o; });
    const c = src.clone(); c.scale.setScalar(1); const chest = O.robot.getObjectByName('chest').getWorldPosition(O.robot.position.clone());
    src.geometry.computeBoundingBox(); const ctr = src.geometry.boundingBox.getCenter(O.robot.position.clone()); c.position.copy(chest).sub(ctr); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1); O.scene.add(c); c.updateMatrixWorld(true);
    const hips = O.robot.getObjectByName('hips').getWorldPosition(O.robot.position.clone());
    const BoxCtor = O.colliders()[0].box.constructor; const extra = new BoxCtor(hips.clone().addScalar(-0.1), hips.clone().addScalar(0.1));
    const orig = O.colliders; O.colliders = () => [...orig(), { name: 'SELFTEST_BOX', box: extra }];
    window.__selfSrc = src.name || src.geometry.uuid;
    return { src: src.name, verts: src.geometry.attributes.position.count };
  });
  const info = await p.evaluate(inPageInstall, { tol: 0.015, tolContact: 0.03 });
  const res = await p.evaluate(() => window.__clip.walk(1500));
  console.log(JSON.stringify({ r, colliders: info.colliders, geomHits: res.geomHits.slice(0, 5), hits: res.hits.filter(h => /SELFTEST/.test(h.object)).slice(0, 3) }, null, 1));
  await b.close();
})();
