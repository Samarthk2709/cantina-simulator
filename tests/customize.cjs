// Character customization (customize.js + avatars.js setLook): first visit opens the editor, the look persists,
// locked items can't be picked until the save earns them, and the office canvas and the chapter 3 layer draw your look.
//   node outputs/first-office/server.cjs
//   NODE_PATH=<dir containing playwright> node outputs/first-office/tests/customize.cjs
// Screenshots go to /tmp/customize.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const URL = process.env.FIRST_OFFICE_URL || 'http://localhost:55188/';
const OUT = '/tmp/customize';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const A = require('../avatars.js');

// Every hair × extra, in every pose, stays inside the 16×21 sprite.
for (const hair of ['fringe', 'short', 'long', 'spiky', 'bun', 'bald']) for (const acc of ['none', 'scarf', 'glasses', 'hoodie', 'cap', 'phones', 'shades', 'gold'])
  for (const o of [{}, { step: 1 }, { step: 2 }, { back: true, step: 1 }, { mood: 'happy' }, { mood: 'talk', f: 1 }, { mood: 'blink' }])
    for (const [x, y, w, h, c] of A.rects('you', { ...o, outfit: { hair, acc } })) assert.ok(x >= 0 && y >= 0 && x + w <= 16 && y + h <= 21 && /^#[0-9a-f]{6}$/i.test(c), `${hair}/${acc} ${JSON.stringify(o)}: [${x},${y},${w},${h},${c}]`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  async function context(intro) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await ctx.route('**/api/**', r => /\/api\/(leaderboard|lag)/.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[]}' })
      : r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await ctx.addInitScript(intro => {
      localStorage.setItem('first-office-guest', '1');
      if (intro && !localStorage.getItem('first-office-nib-v1')) localStorage.setItem('first-office-nib-v1', JSON.stringify({ playerName: 'Sam', facts: [], completedAt: '2026-10-25T00:00:00Z' }));
    }, intro);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    return p;
  }
  const opt = (k, v) => `#look-editor .lk-opt[data-key="${k}"][data-v="${v}"]`;
  const editorUp = p => p.$('#look-editor').then(Boolean);
  // Menu → Customize character. Retried: a window opening on load (Nib, a toast) can steal the first click.
  async function openEditor() {
    for (let i = 0; ; i++) {
      try { await p.keyboard.press('Escape'); await p.click('#settings', { timeout: 3000 }); await p.click('#customize', { timeout: 3000 }); await p.waitForSelector('#look-editor', { timeout: 3000 }); return; }
      catch (e) { if (i >= 3) throw e; }
    }
  }
  // Every fill the office draws for 'you' (wraps Avatars.draw and records the colours it paints).
  const youFills = p => p.evaluate(async () => {
    const seen = new Set(), draw = Avatars.draw;
    Avatars.draw = function (g, id, ...rest) { if (id !== 'you') return draw.call(this, g, id, ...rest); const fr = g.fillRect; g.fillRect = function (...a) { seen.add(String(g.fillStyle)); return fr.apply(this, a); }; try { return draw.call(this, g, id, ...rest); } finally { delete g.fillRect; } };
    window.Loop.wake(); await new Promise(r => setTimeout(r, 600)); Avatars.draw = draw; return [...seen];
  });

  // ---- Stage 1, first visit: the editor comes before the dark room ----
  {
    const p = await context(false);
    await p.goto(URL); await p.waitForURL(/meet\.html/); await p.waitForSelector('#look-editor', { timeout: 8000 });
    await p.screenshot({ path: OUT + '/01-meet-first-visit.png' });
    await p.click('#look-editor [data-act="save"]'); assert.equal(await editorUp(p), false);
    assert.ok(await p.isVisible('#wake'), 'the dark room waits behind the editor');
    await p.context().close();
  }

  const p = await context(true);
  // ---- Office, first visit ----
  await p.goto(URL); await p.waitForSelector('#look-editor', { timeout: 8000 });
  assert.equal(await p.evaluate(() => !!window.Stage2), false, 'the office waits for the editor');
  // Locked: disabled, shows the requirement, a forced click does nothing.
  for (const [k, v, need] of [['acc', 'cap', 'Find a critical'], ['acc', 'phones', 'Find 10 bugs'], ['acc', 'shades', 'Finish the first job'], ['acc', 'gold', 'Reach Elite (60 rep)'], ['hairColor', '#7ff0d8', 'Finish chapter 3']]) {
    assert.ok(await p.$eval(opt(k, v), e => e.disabled), v + ' is locked');
    assert.match(await p.textContent(opt(k, v)), new RegExp(need.replace(/[()]/g, '\\$&')));
    await p.click(opt(k, v), { force: true });
    assert.equal(await p.getAttribute(opt(k, v), 'aria-pressed'), 'false');
  }
  await p.screenshot({ path: OUT + '/02-office-first-visit.png' });
  const pick = { hair: 'spiky', hairColor: '#14121c', shirt: '#3f8f5a', pants: '#6b5a3a', acc: 'glasses', skin: '#8d5a3b' };
  for (const [k, v] of Object.entries(pick)) { await p.click(opt(k, v)); assert.equal(await p.getAttribute(opt(k, v), 'aria-pressed'), 'true'); }
  assert.ok((await p.innerHTML('#look-editor .lk-big')).includes('fill="#3f8f5a"'), 'the preview shows the shirt');
  await p.screenshot({ path: OUT + '/03-picked.png' });
  await p.click('#look-editor [data-act="save"]');
  await p.waitForFunction(() => window.Stage2, null, { timeout: 8000 }); await p.waitForTimeout(800);
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('first-office-look-v1'))).look, pick);
  let fills = await youFills(p);
  assert.ok(fills.includes('#3f8f5a') && fills.includes('#6b5a3a') && fills.includes('#14121c'), 'office canvas draws the look: ' + fills);
  await p.screenshot({ path: OUT + '/04-office.png' });

  // ---- Reload: no editor, same look ----
  await p.reload(); await p.waitForFunction(() => window.Stage2, null, { timeout: 8000 }); await p.waitForTimeout(500);
  assert.equal(await editorUp(p), false);
  assert.deepEqual(await p.evaluate(() => Avatars.look), pick);

  // ---- The menu reopens it; Esc cancels ----
  await openEditor();
  await p.click(opt('shirt', '#c84230')); await p.keyboard.press('Escape');
  assert.equal(await editorUp(p), false); assert.equal(await p.evaluate(() => Avatars.look.shirt), '#3f8f5a', 'cancel keeps the old look');

  // ---- Earn a critical (4 bugs, so the first job isn't finished): Cap unlocks, with a toast ----
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('first-office-game-v1')); s.crits = 1; s.bugs = 4; localStorage.setItem('first-office-game-v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForFunction(() => window.Stage2, null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => Stage2.state().crits), 1);
  await p.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(t => /New look unlocked: Cap/.test(t.textContent)), null, { timeout: 6000 });
  await p.screenshot({ path: OUT + '/05-unlock-toast.png' });
  await openEditor();
  assert.equal(await p.$eval(opt('acc', 'cap'), e => e.disabled), false);
  assert.ok(await p.$eval(opt('acc', 'phones'), e => e.disabled), 'headphones still locked');
  assert.ok(await p.$eval(opt('acc', 'shades'), e => e.disabled), 'sunglasses still locked');
  await p.click(opt('acc', 'cap')); await p.screenshot({ path: OUT + '/06-editor-unlocked.png' });
  await p.click('#look-editor [data-act="save"]');
  assert.equal(await p.evaluate(() => Avatars.look.acc), 'cap');
  // Randomize never picks a locked item.
  await openEditor();
  for (let i = 0; i < 40; i++) { await p.click('#look-editor [data-act="random"]'); assert.equal(await p.$$eval('#look-editor .lk-opt:disabled[aria-pressed="true"]', e => e.length), 0); }
  await p.keyboard.press('Escape');

  // ---- Chapter 3: the DOM layer draws you with the look ----
  await p.evaluate(() => { const st = Stage3Scope.seed({ playerName: 'Sam' }); st.stage = 3; Object.assign(st.seen, { team: true }); localStorage.removeItem('first-office-crew-v1'); localStorage.setItem('first-office-game-v1', JSON.stringify(st)); });
  await p.reload(); await p.waitForFunction(() => window.Stage3Agents, null, { timeout: 8000 }); await p.waitForTimeout(1200);
  const layer = await p.innerHTML('#s3-layer');
  assert.ok(layer.includes('fill="#3f8f5a"') && layer.includes('fill="#6b5a3a"'), 'chapter 3 layer draws your shirt and pants');
  // The first job is finished in this save, so sunglasses are earned now, and a new look redraws the layer at once.
  await openEditor();
  assert.equal(await p.$eval(opt('acc', 'shades'), e => e.disabled), false, 'sunglasses unlock with the finished job');
  await p.click(opt('shirt', '#a68ad8')); await p.click('#look-editor [data-act="save"]'); await p.waitForTimeout(500);
  assert.ok((await p.innerHTML('#s3-layer')).includes('fill="#a68ad8"'), 'the layer redraws with the new shirt');
  await p.screenshot({ path: OUT + '/07-chapter3.png' });

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('customize: ok');
})().catch(e => { console.error(e); process.exit(1); });
