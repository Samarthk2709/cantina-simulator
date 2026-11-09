// Run: node --test outputs/first-office/tests/engine.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../data.js');
const E = require('../engine.js');

const badLine = fid => { const f = E.FINDINGS[fid]; return D.CLASSES[f.cls].variants[f.variant].findIndex(l => l.bad); };
const okLine = fid => { const f = E.FINDINGS[fid]; return D.CLASSES[f.cls].variants[f.variant].findIndex(l => !l.bad); };
// The player never writes reports: teaching Nib files the find.
function huntAndBank(s, fid, lesson = 'sharp') {
  const r = E.guess(s, fid, badLine(fid)); assert.ok(r.ok && r.hit, 'hit ' + fid + ' ' + r.why);
  if (r.paid) return r.paid;
  const t = E.teach(s, lesson); assert.ok(t.learned);
  return t.paid;
}
const forceNoLuck = s => { s.rng = 1; };

test('every finding has exactly one teaching shape and at least one bad line', () => {
  const ids = Object.keys(E.FINDINGS).filter(id => !E.targetById[E.FINDINGS[id].target].late); // Stage 2 programs
  assert.equal(ids.length, 10 + 12 + 12 + 9);
  for (const id of ids) {
    const f = E.FINDINGS[id], lines = D.CLASSES[f.cls].variants[f.variant];
    assert.ok(lines.some(l => l.bad), id);
    assert.ok(lines.every(l => (l.bad ? !l.ok : typeof l.ok === 'string')), id);
  }
  const toolFreePublic = ids.filter(id => !D.TARGETS.find(t => t.id === E.FINDINGS[id].target).private && !D.CLASSES[E.FINDINGS[id].cls].tool);
  assert.ok(toolFreePublic.length >= 20, 'twenty bugs reachable without buying anything');
});

test('chain pairs are tool-free and sit in linked rooms', () => {
  for (const t of D.ALL_TARGETS) {
    const [ra] = t.chain.a.split(':'), [rb] = t.chain.b.split(':');
    assert.ok(t.links.some(([a, b]) => (a === ra && b === rb) || (a === rb && b === ra)), t.id);
    for (const k of [t.chain.a, t.chain.b]) assert.equal(D.CLASSES[E.FINDINGS[t.id + ':' + k].cls].tool, null);
  }
});

test('Parcelly opens only in chapter 3', () => {
  const s = E.create({}, 4);
  assert.equal(E.canTake(s, 'ship').ok, false);
  s.stage = 3; assert.equal(E.canTake(s, 'ship').ok, true);
  const old = JSON.parse(JSON.stringify(s)); delete old.picked.ship;
  assert.equal(typeof E.restore(old).picked.ship, 'number', 'old saves get a crowd value for new programs');
});

test('a job lights its front door; rooms map only next to lit rooms', () => {
  const s = E.create({ playerName: 'Sam' }, 5);
  assert.equal(s.player, 'Sam');
  assert.ok(E.takeJob(s, 'chat').ok);
  assert.deepEqual(s.lit.chat, ['login']);
  assert.equal(E.mapRoom(s, 'bots').ok, false);
  assert.ok(E.mapRoom(s, 'msgs').ok);
  assert.equal(s.focus, 100 - D.COST.map);
  assert.equal(E.takeJob(s, 'bank').ok, false, 'private program needs reputation');
});

test('wrong lines cost focus and explain themselves; the right line opens teaching', () => {
  const s = E.create({}, 5); E.takeJob(s, 'chat');
  const fid = 'chat:login:0';
  const miss = E.guess(s, fid, okLine(fid));
  assert.ok(miss.ok && !miss.hit && miss.why.length > 5);
  assert.equal(s.focus, 100 - D.COST.miss);
  const hit = E.guess(s, fid, badLine(fid));
  assert.ok(hit.hit && hit.first);
  assert.equal(s.pendingTeach, fid);
  assert.equal(E.guess(s, 'chat:login:1', badLine('chat:login:1')).ok, false, 'must teach before hunting on');
  assert.equal(E.submit(s, fid).ok, false, 'must teach before it is filed');
  assert.equal(E.teach(s, 'wrong').learned, false);
  assert.equal(s.pendingTeach, fid);
  const t = E.teach(s, 'sharp');
  assert.ok(t.learned && t.firstOfClass);
  assert.ok(t.paid.accepted && t.paid.grade === 'S', 'a sharp explanation files an S report');
  assert.equal(s.bugs, 1);
  assert.equal(Math.round(E.precision(s, 'info') * 100), 43);
});

test('teaching: clean lessons sharpen Nib, noisy ones blunt it; nothing else does', () => {
  const s = E.create({}, 1);
  s.lessons.auth = { clean: 5, noisy: 0 }; assert.equal(E.precision(s, 'auth'), 0.95);
  s.lessons.auth = { clean: 1, noisy: 3 }; assert.equal(E.precision(s, 'auth'), 0.07);
  s.gpu = 3; assert.equal(E.precision(s, 'auth'), 0.07, 'GPUs never change precision');
});

test('filing: a sharp lesson files S, a shallow one B; agents still write reports and overclaims cost rep', () => {
  const s = E.create({}, 3); E.takeJob(s, 'chat'); forceNoLuck(s);
  let r = huntAndBank(s, 'chat:login:0', 'sharp'); assert.ok(r.accepted); assert.equal(r.grade, 'S');
  assert.equal(s.bugs, 1); assert.ok(s.cash > 0); assert.ok(!s.seen.forge && s.seen.stats, 'the Shop waits for the second bug');
  forceNoLuck(s); r = huntAndBank(s, 'chat:login:1', 'shallow'); assert.equal(r.grade, 'B');
  // An agent's report, section by section, as before.
  s.lit.chat.push('msgs'); s.target = 'chat'; s.rep = 5;
  const fid = 'chat:msgs:0'; assert.ok(E.guess(s, fid, badLine(fid), 'Pip').hit);
  D.SECTIONS.forEach(x => E.setSection(s, fid, x.id, 0)); E.setSection(s, fid, 'impact', 2);
  r = E.submit(s, fid); assert.ok(!r.accepted && r.over); assert.equal(s.rep, 3);
  D.SECTIONS.forEach(x => E.setSection(s, fid, x.id, 0)); forceNoLuck(s);
  r = E.submit(s, fid); assert.ok(r.accepted); assert.equal(s.stats.agent, 1);
  assert.equal(E.submit(s, fid).ok, false, 'pays once');
});

test('night: Nib maps a room and only hunts classes it was taught', () => {
  const s = E.create({}, 11); E.takeJob(s, 'chat');
  let n = E.sleep(s).night;
  assert.equal(n.made, 0); assert.equal(n.idle, 'untaught'); assert.equal(s.lit.chat.length, 2, 'one free room, no extra mapping while untaught'); assert.equal(s.day, 2);
  huntAndBank(s, 'chat:login:1');
  s.gpu = 3; s.lit.chat = D.TARGETS[0].rooms.map(r => r[0]);
  n = E.sleep(s).night;
  assert.ok(n.made > 0 && n.made <= D.RIGS[3].tries);
  assert.ok(s.tray.every(c => E.FINDINGS[c.fid].cls === 'auth'));
  assert.ok(s.seen.ops && s.seen.rig);
  const fids = s.tray.map(c => c.fid); assert.equal(new Set(fids).size, fids.length, 'one candidate per slot');
  assert.ok(fids.every(fid => E.slotState(s, fid) === 'tray'), 'false alarms reserve their slot too, so the map does not leak validity');
});

test('validation: proof is safe, raw false alarms cost rep, raw real finds pay without proof bonus', () => {
  const s = E.create({}, 2); E.takeJob(s, 'chat'); s.rep = 10;
  s.tray = [{ id: 1, fid: 'chat:msgs:0', real: false, conf: 60, night: 1 }, { id: 2, fid: 'chat:groups:0', real: true, conf: 70, night: 1 }, { id: 3, fid: 'chat:bots:0', real: true, conf: 80, night: 1 }];
  s.lessons.auth = { clean: 5, noisy: 0 };
  let r = E.prove(s, 1); assert.ok(r.ok && !r.real); assert.equal(s.rep, 10); assert.equal(s.focus, 85);
  assert.equal(E.slotState(s, 'chat:msgs:0'), 'open', 'false alarm frees the slot');
  forceNoLuck(s);
  r = E.prove(s, 2); assert.ok(r.real); assert.ok(s.found['chat:groups:0'].proven);
  assert.ok(r.paid.accepted && r.paid.grade === 'A', 'a proven find files itself at A');
  s.tray.push({ id: 4, fid: 'chat:msgs:0', real: false, conf: 50, night: 2 });
  const repBefore = s.rep; r = E.submitRaw(s, 4); assert.equal(r.real, false); assert.equal(s.rep, repBefore - 3);
  forceNoLuck(s);
  r = E.submitRaw(s, 3); assert.ok(r.real && r.accepted);
  assert.ok(['B', 'C'].includes(r.grade), 'unproven files at B or C');
});

test('tools unlock bug types, not numbers; rig and desk are fully refundable without farming', () => {
  const s = E.create({}, 4); s.cash = 3000;
  assert.equal(E.unlocked(s, 'mem'), false);
  assert.ok(E.buyTool(s, 'trace').ok, 'the Tracer stands alone'); s.cash = 3000;
  assert.ok(E.buyTool(s, 'fuzz').ok); assert.ok(E.unlocked(s, 'mem'));
  assert.ok(E.setRig(s, 2).ok); assert.equal(s.cash, 3000 - 450 - 800);
  assert.ok(E.setRig(s, 0).ok); assert.equal(s.cash, 3000 - 450);
  assert.ok(E.toggleDesk(s, 'monitor').ok); assert.equal(s.focus, 100, 'buying raises the cap, not focus');
  E.sleep(s); assert.equal(s.focus, 130);
  assert.ok(E.toggleDesk(s, 'monitor').ok); assert.equal(s.focus, 100); assert.equal(s.cash, 3000 - 450);
  assert.ok(E.toggleDesk(s, 'coffee').ok); E.coffee(s); assert.ok(E.toggleDesk(s, 'coffee').ok);
  assert.ok(s.cups <= E.maxCups(s));
});

test('zero-luck worst case: shallow lessons at max crowding still afford the Tracer chain', () => {
  const s = E.create({}, 9);
  Object.keys(s.picked).forEach(k => { if (k !== 'bank') s.picked[k] = 0.9; });
  s.cash = 0; s.tools.push('fuzz'); // a wasted, non-refundable purchase
  const cheap = Object.keys(E.FINDINGS).filter(id => D.TARGETS.some(t => t.id === E.FINDINGS[id].target) && !D.TARGETS.find(t => t.id === E.FINDINGS[id].target).private && !D.CLASSES[E.FINDINGS[id].cls].tool);
  for (const fid of cheap) {
    const f = E.FINDINGS[fid];
    if (s.target !== f.target) E.takeJob(s, f.target);
    if (!E.isLit(s, f.target, f.room)) s.lit[f.target].push(f.room);
    s.focus = 100; s.rng = 1; // no lucky criticals
    const r = E.guess(s, fid, badLine(fid)); assert.ok(r.hit, fid);
    const res = r.paid || E.teach(s, 'shallow').paid; assert.ok(['B', 'S'].includes(res.grade), fid);
    s.crits = 0; Object.values(s.found).forEach(x => { x.crit = false; });
    s.rep = 0; // keep the payout bonus off as well
  }
  assert.ok(s.bugs >= 20);
  assert.ok(s.cash >= 600 + 900, 'cash ' + s.cash);
  assert.ok(E.buyTool(s, 'dbg').ok && E.buyTool(s, 'trace').ok);
  const chained = E.trace(s, 'chat', 0);
  assert.ok(chained.chained && chained.won);
});

test('chain needs both halves, the tracer, and the right explanation', () => {
  const s = E.create({}, 8); s.cash = 5000; E.takeJob(s, 'chat'); s.lit.chat.push('msgs');
  assert.equal(E.trace(s, 'chat', 0).ok, false);
  forceNoLuck(s); huntAndBank(s, 'chat:login:0'); forceNoLuck(s); huntAndBank(s, 'chat:msgs:0');
  assert.equal(E.trace(s, 'chat', 0).ok, false, 'no tracer yet');
  E.buyTool(s, 'dbg'); E.buyTool(s, 'trace');
  assert.equal(E.trace(s, 'chat', 1).chained, false);
  const crits = s.crits, r = E.trace(s, 'chat', 0);
  assert.ok(r.chained); assert.equal(s.crits, crits + 1); assert.equal(s.bugs, 2, 'a chain adds a critical, not bugs');
  assert.equal(E.trace(s, 'chat', 0).ok, false);
});

test('saves round-trip and reject garbage', () => {
  const s = E.create({ playerName: 'Ana', facts: ['likes tea'] }, 6); E.takeJob(s, 'chat'); E.sleep(s);
  const back = E.restore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.throws(() => E.restore({ v: 1 }));
});

test('restore drops ids that no longer exist; a full Ops desk is reported as full', () => {
  const s = E.create({}, 6); E.takeJob(s, 'chat');
  const o = JSON.parse(JSON.stringify(s));
  o.found['chat:gone:0'] = { status: 'draft', source: 'manual', report: {} }; o.pendingTeach = 'chat:gone:0'; o.lit.chat.push('gone'); o.lit.nowhere = ['x'];
  const back = E.restore(o);
  assert.equal(back.found['chat:gone:0'], undefined); assert.equal(back.pendingTeach, null);
  assert.deepEqual(back.lit.chat, ['login']); assert.equal(back.lit.nowhere, undefined);
  s.lessons.auth = { clean: 3, noisy: 0 }; s.tray = Array.from({ length: D.COST.tray }, (_, i) => ({ id: i + 1, fid: 'chat:msgs:0', real: true, conf: 50, night: 1 }));
  assert.equal(E.sleep(s).night.idle, 'full');
});

test('replayed actions run as an agent only in chapter 3, only for agent work, and only agents file team finds', () => {
  const bad = { ok: false, why: 'Bad action.' };
  const s2 = E.create({ playerName: 'Sam' }, 7);
  assert.deepEqual(E.act(s2, { fn: 'mapRoom', args: ['login'], actor: 'pip' }), bad, 'no agents in chapter 2');
  const s = E.seed3({ playerName: 'Sam' }), fid = Object.keys(E.FINDINGS).find(id => E.FINDINGS[id].target === s.target);
  assert.deepEqual(E.act(s, { fn: 'coffee', actor: 'pip' }), bad, 'coffee is the player\'s');
  assert.deepEqual(E.act(s, { fn: 'guess', args: [fid, 0, 'Pip'] }), bad, 'the player can\'t file a team find');
  assert.deepEqual(E.act(s, { fn: 'guess', args: [fid, 0], actor: 'pip' }), bad, 'an agent\'s find names the agent');
  assert.notDeepEqual(E.act(s, { fn: 'guess', args: [fid, 0, 'Pip'], actor: 'pip' }), bad, 'an agent hunts');
  assert.deepEqual(E.act(s, { fn: 'takeJob', args: ['toString'] }), bad, 'prototype names are not programs');
  assert.deepEqual(E.act(s, { fn: 'submit', args: ['valueOf'] }), bad, 'or findings');
  assert.equal(E.canTake(s, 'toString').ok, false);
});
