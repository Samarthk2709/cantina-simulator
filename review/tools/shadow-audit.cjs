// Lists visible meshes: castShadow on/off, with world-bbox size; flags floor-standing meshes (min.y<0.05, height>0.15)
// that do NOT cast shadows, and thin/flat meshes (height<0.01) that DO cast.
const { chromium } = require('/Users/samarthkumbla/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); localStorage.setItem('first-office-nib-v1', JSON.stringify({ completedAt: Date.now(), playerName: 'Alex' })); });
  await p.goto('http://localhost:55190/');
  for (let i = 0; i < 400 && !(await p.evaluate(() => window.Office3D?.ready)); i++) { for (const l of [p.getByRole('button', { name: 'Start', exact: true }), p.getByText('Play without an account')]) if (await l.isVisible().catch(() => false)) await l.click().catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(() => {
    const O = window.Office3D; let cast = 0, nocast = 0; const floorNo = [], flatYes = []; const V = O.camera.position.constructor;
    O.scene.traverse(o => { if (!o.isMesh || !o.visible || o.isSkinnedMesh) return; let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false; if (!vis) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && (m.transparent || m.isShaderMaterial)) return;
      o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); const h = bb.max.y - bb.min.y, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      if (w > 6) return; // room shell / big merged
      if (o.castShadow) cast++; else nocast++;
      if (!o.castShadow && bb.min.y < 0.05 && h > 0.15) floorNo.push(`${o.name || o.parent?.name} h${h.toFixed(2)} w${w.toFixed(2)} @${((bb.min.x + bb.max.x) / 2).toFixed(1)},${((bb.min.z + bb.max.z) / 2).toFixed(1)}`);
      if (o.castShadow && h < 0.01) flatYes.push(o.name || o.parent?.name);
    });
    return { cast, nocast, floorStandingNoShadow: floorNo, flatCasting: flatYes.slice(0, 20) };
  })));
  await b.close();
})();
