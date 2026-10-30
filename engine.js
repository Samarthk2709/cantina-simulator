/* First Office rules (Stages 2 and 3). Pure state transitions; the page only renders and calls these.
   Stage 3 agents use the same calls as the player; `by` names the agent where it matters. */
(function (root) {
  'use strict';
  const D = typeof module === 'object' && module.exports ? require('./data.js') : root.Stage2Data;
  const { CLASSES, TARGETS, ALL_TARGETS, TOOLS, RIGS, DESK, REP_TIERS, GRADES, COST, SECTIONS } = D;
  const VERSION = 2, GOAL = { bugs: 5, crits: 1 };
  const targetById = Object.fromEntries(ALL_TARGETS.map(t => [t.id, t]));
  const FINDINGS = {};
  ALL_TARGETS.forEach(t => t.rooms.forEach(r => r[5].forEach((_, i) => { const f = D.finding(t, r, i); FINDINGS[f.id] = f; })));

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function rand(s) { // mulberry32 on s.rng
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function create(profile, seed) {
    profile = profile || {};
    const s = {
      v: VERSION, rng: (seed >>> 0) || 1, player: clean(profile.playerName, 'friend'), nib: clean(profile.nibName, 'Nib'),
      memories: Array.isArray(profile.facts) ? profile.facts.filter(x => typeof x === 'string').slice(0, 3).map(x => x.slice(0, 80)) : [],
      stage: 2, day: 1, focus: COST.focus, cups: COST.cups, cash: 0, rep: 0, bugs: 0, crits: 0,
      target: null, picked: Object.fromEntries(ALL_TARGETS.map(t => [t.id, t.picked])), lit: {},
      found: {}, misses: {}, lessons: {}, pendingTeach: null, tray: [], nextId: 1,
      tools: ['proxy'], gpu: 0, desk: [], chains: {}, seen: {}, log: [], days: [], won: false, wonDay: 0, won3: false,
      stats: { manual: 0, nib: 0, agent: 0, proven: 0, raw: 0, falseSubmits: 0, earned: 0 }
    };
    Object.keys(CLASSES).forEach(k => { s.lessons[k] = { clean: 0, noisy: 0 }; });
    return s;
  }
  function clean(v, d) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : d; }
  function restore(o) {
    if (!o || o.v !== VERSION || typeof o.day !== 'number' || !o.found || !o.lessons) throw new Error('bad save');
    const s = create({}, 1);
    Object.keys(s).forEach(k => { if (o[k] !== undefined) s[k] = o[k]; });
    s.stats = Object.assign(create({}, 1).stats, o.stats);
    s.picked = Object.assign(create({}, 1).picked, o.picked); // programs added later get their starting crowd
    // Drop anything that no longer exists in data.js, so an old save can't crash the page.
    s.tray = s.tray.filter(c => FINDINGS[c.fid]);
    Object.keys(s.found).forEach(fid => { if (!FINDINGS[fid]) delete s.found[fid]; });
    if (s.pendingTeach && !s.found[s.pendingTeach]) s.pendingTeach = null;
    Object.keys(s.lit).forEach(t => { if (!targetById[t]) delete s.lit[t]; else s.lit[t] = s.lit[t].filter(r => targetById[t].rooms.some(x => x[0] === r)); });
    if (s.target && !targetById[s.target]) s.target = null;
    checkWin(s); // a save from before the goal was lowered may already meet it
    return s;
  }

  // ---- derived values ----
  const maxFocus = s => COST.focus + (s.desk.includes('monitor') ? 30 : 0);
  const maxCups = s => COST.cups + (s.desk.includes('coffee') ? 1 : 0);
  const tier = s => REP_TIERS.reduce((a, t) => (s.rep >= t.min ? t : a), REP_TIERS[0]);
  const nextTier = s => REP_TIERS.find(t => t.min > s.rep) || null;
  const has = (s, tool) => s.tools.includes(tool);
  const unlocked = (s, cls) => !CLASSES[cls].tool || has(s, CLASSES[cls].tool);
  function precision(s, cls) {
    const l = s.lessons[cls];
    if (!l || l.clean + l.noisy === 0) return 0;
    return clamp(0.25 + 0.18 * l.clean - 0.12 * l.noisy, 0.07, 0.95);
  }
  const knows = (s, cls) => precision(s, cls) > 0;
  const crowd = (s, tid) => 1 - s.picked[tid] * 0.5;
  function canTake(s, tid) {
    const t = targetById[tid];
    if (!t) return { ok: false, why: 'Unknown program.' };
    if (t.late && s.stage !== 3) return { ok: false, why: 'Opens in chapter 3.' };
    if (t.private && s.rep < t.rep) return { ok: false, why: 'Invite only. Reach ' + t.rep + ' reputation.' };
    return { ok: true };
  }
  const isLit = (s, tid, rid) => (s.lit[tid] || []).includes(rid);
  function canMap(s, tid, rid) {
    if (isLit(s, tid, rid)) return false;
    return targetById[tid].links.some(([a, b]) => (a === rid && isLit(s, tid, b)) || (b === rid && isLit(s, tid, a)));
  }
  const inTray = (s, fid) => s.tray.some(c => c.fid === fid);
  // What a finding slot looks like to the player right now.
  function slotState(s, fid) {
    const f = FINDINGS[fid];
    if (s.found[fid]) return s.found[fid].status === 'accepted' ? 'accepted' : 'draft';
    if (inTray(s, fid)) return 'tray';
    if (!unlocked(s, f.cls)) return 'locked';
    return 'open';
  }
  function roomFindings(tid, rid) { const r = targetById[tid].rooms.find(x => x[0] === rid); return r[5].map((_, i) => tid + ':' + rid + ':' + i); }
  function payout(s, fid, grade, proven, crit) {
    const f = FINDINGS[fid], t = targetById[f.target];
    return Math.round(t.base * CLASSES[f.cls].mult * GRADES[grade].m * crowd(s, t.id) * tier(s).bonus * (proven ? 1.25 : 1) * (crit ? 3 : 1));
  }
  function log(s, text, kind) { s.log.unshift({ day: s.day, text, kind: kind || '' }); s.log.length = Math.min(s.log.length, 30); }
  function addRep(s, n, why) { const before = tier(s).name; s.rep = Math.max(0, s.rep + n); log(s, (n >= 0 ? '+' : '') + n + ' rep · ' + why, n >= 0 ? 'good' : 'bad'); return tier(s).name !== before ? tier(s) : null; }
  function reveal(s, id) { if (s.seen[id]) return false; s.seen[id] = true; return true; }

  // ---- actions: each returns {ok, ...}; failures carry a short reason ----
  function takeJob(s, tid) {
    const c = canTake(s, tid); if (!c.ok) return c;
    s.target = tid;
    if (!s.lit[tid]) s.lit[tid] = [targetById[tid].rooms[0][0]];
    return { ok: true, first: reveal(s, 'job') };
  }
  function mapRoom(s, rid) {
    const tid = s.target;
    if (!tid || !canMap(s, tid, rid)) return { ok: false, why: 'Map a room next to one you can already see.' };
    if (s.focus < COST.map) return { ok: false, why: 'Too tired. Coffee or sleep.' };
    s.focus -= COST.map; s.lit[tid].push(rid);
    return { ok: true };
  }
  // `by` is an agent's name (Stage 3). Agents skip teaching Nib: that stays the player's job.
  function guess(s, fid, line, by) {
    const f = FINDINGS[fid];
    if (!f || f.target !== s.target || !isLit(s, f.target, f.room)) return { ok: false, why: 'Map that room first.' };
    if (slotState(s, fid) !== 'open') return { ok: false, why: 'Nothing to hunt there.' };
    if (s.pendingTeach && !by) return { ok: false, why: 'Nib is waiting to hear why the last one was a bug.' };
    const lines = CLASSES[f.cls].variants[f.variant], L = lines[line];
    if (!L) return { ok: false, why: 'No such line.' };
    if (!L.bad) {
      if (s.focus < COST.miss) return { ok: false, why: 'Too tired. Coffee or sleep.' };
      s.focus -= COST.miss; s.misses[fid] = (s.misses[fid] || 0) + 1;
      return { ok: true, hit: false, why: D.fill(L.ok, f.nouns) };
    }
    if (s.focus < COST.find) return { ok: false, why: 'Too tired to write it up. Coffee or sleep.' };
    s.focus -= COST.find;
    if (by) { s.found[fid] = { status: 'draft', source: 'agent', by, proven: false, report: {}, verdict: null }; return { ok: true, hit: true, why: D.fill(L.bad, f.nouns) }; }
    s.stats.manual++;
    s.found[fid] = { status: 'draft', source: 'manual', proven: false, report: {}, verdict: null };
    // Once Nib has mastered a class there is nothing left to teach: it drafts the report instead.
    const mastered = precision(s, f.cls) >= 0.95;
    const first = reveal(s, 'training');
    if (mastered) return { ok: true, hit: true, mastered, why: D.fill(L.bad, f.nouns), first, paid: fileFound(s, fid, 'S') };
    s.pendingTeach = fid;
    return { ok: true, hit: true, mastered, why: D.fill(L.bad, f.nouns), first };
  }
  function teach(s, choice) {
    const fid = s.pendingTeach; if (!fid) return { ok: false, why: 'Nothing to teach right now.' };
    const cls = FINDINGS[fid].cls, before = precision(s, cls);
    if (choice === 'wrong') return { ok: true, learned: false };
    if (choice === 'sharp') s.lessons[cls].clean++; else if (choice === 'shallow') s.lessons[cls].noisy++; else return { ok: false, why: 'Pick an answer.' };
    s.pendingTeach = null; s.found[fid].lesson = choice;
    // No report to write: how well you explained the bug is how well it's reported.
    const paid = fileFound(s, fid, choice === 'sharp' ? 'S' : 'B');
    return { ok: true, learned: true, clean: choice === 'sharp', before, after: precision(s, cls), firstOfClass: before === 0, paid };
  }
  function setSection(s, fid, sec, idx) {
    const r = s.found[fid];
    if (!r || r.status === 'accepted' || !SECTIONS.some(x => x.id === sec) || ![0, 1, 2].includes(idx)) return { ok: false };
    if (sec === 'proof' && idx === 0 && r.source === 'nib' && !r.proven) return { ok: false, why: 'This one was never proven, so there is no recording to attach.' };
    r.report[sec] = idx; r.verdict = null; return { ok: true };
  }
  function gradeOf(report) {
    const picks = SECTIONS.map(x => report[x.id]);
    if (picks.some(p => p === undefined)) return { grade: null, why: 'Fill every section.' };
    if (picks.includes(2)) return { grade: 'F', over: true, why: 'Rejected: the report claims more than the bug shows.' };
    const good = picks.filter(p => p === 0).length;
    const g = good === 5 ? 'S' : good === 4 ? 'A' : good === 3 ? 'B' : good === 2 ? 'C' : 'F';
    return { grade: g, why: g === 'F' ? 'Rejected: too vague to act on.' : '' };
  }
  function submit(s, fid) {
    const r = s.found[fid];
    if (!r || r.status === 'accepted') return { ok: false, why: 'Nothing to submit.' };
    if (s.pendingTeach === fid) return { ok: false, why: 'Tell Nib why it\'s a bug first.' };
    const g = gradeOf(r.report);
    if (!g.grade) return { ok: false, why: g.why };
    if (g.grade === 'F') {
      r.verdict = g.why;
      const before = s.rep, tierUp = g.over ? addRep(s, -2, 'overclaimed report') : null;
      return { ok: true, accepted: false, why: g.why, over: !!g.over, repDelta: s.rep - before, tierUp };
    }
    return accept(s, fid, g.grade);
  }
  function accept(s, fid, grade) {
    const r = s.found[fid], f = FINDINGS[fid];
    const crit = rand(s) < COST.crit;
    const pay = payout(s, fid, grade, r.proven, crit);
    r.status = 'accepted'; r.grade = grade; r.pay = pay; r.crit = crit; r.day = s.day; r.verdict = null;
    s.cash += pay; s.stats.earned += pay; s.bugs++; if (crit) s.crits++;
    if (r.source === 'nib') s.stats.nib++; else if (r.source === 'agent') s.stats.agent++;
    const rep = GRADES[grade].rep + (crit ? 5 : 0);
    const tierUp = addRep(s, rep, grade + ' report on ' + targetById[f.target].name);
    log(s, (crit ? 'CRITICAL ' : '') + CLASSES[f.cls].name + ' accepted · $' + pay, crit ? 'crit' : 'good');
    const firsts = { stats: reveal(s, 'stats'), forge: reveal(s, 'forge'), hq: s.bugs >= 3 ? reveal(s, 'hq') : false };
    return { ok: true, accepted: true, grade, pay, crit, rep, tierUp, firsts, won: checkWin(s) };
  }
  // Files a found bug at a grade, without the player writing anything. Agents still write reports section by section.
  function fullReport(grade) { const good = { S: 5, A: 4, B: 3, C: 2 }[grade], rep = {}; SECTIONS.forEach((x, i) => { rep[x.id] = i < good ? 0 : 1; }); return rep; }
  function fileFound(s, fid, grade) { const r = s.found[fid]; r.report = fullReport(grade); return accept(s, fid, grade); }
  // A leftover draft (an agent gave up on it, or an old save): filing it is one click, at a plain grade.
  function fileDraft(s, fid) { const r = s.found[fid]; if (!r || r.status !== 'draft' || s.pendingTeach === fid) return { ok: false, why: 'Nothing to file.' }; return fileFound(s, fid, r.proven ? 'A' : 'B'); }
  function checkWin(s) { if (!s.won && s.bugs >= GOAL.bugs && s.crits >= GOAL.crits) { s.won = true; s.wonDay = s.day; return true; } return false; }

  function coffee(s) {
    if (s.cups <= 0) return { ok: false, why: 'No coffee left today.' };
    if (s.focus >= maxFocus(s)) return { ok: false, why: 'Already sharp.' };
    s.cups--; s.focus = Math.min(maxFocus(s), s.focus + COST.coffee); return { ok: true };
  }

  // Nib's night: map one room next to what's lit, then try `tries` slots it knows how to look for.
  function sleep(s) {
    const night = { day: s.day, mapped: [], tries: RIGS[s.gpu].tries, made: 0, idle: '' };
    // End-of-day totals for the vitals box: today's numbers are the change since the last entry.
    s.days.push({ day: s.day, bugs: s.bugs, crits: s.crits, cash: s.cash, rep: s.rep, earned: s.stats.earned }); if (s.days.length > 60) s.days.shift();
    s.day++; s.focus = maxFocus(s); s.cups = maxCups(s);
    TARGETS.forEach(t => { if (!t.private) s.picked[t.id] = Math.min(0.9, +(s.picked[t.id] + COST.crowd).toFixed(2)); });
    const tid = s.target;
    if (tid) {
      // api.roomFilter (Stage 3) keeps Nib out of off-limits rooms and banned programs.
      const allowed = (t, rid) => !api.roomFilter || api.roomFilter(t, rid);
      const dark = () => targetById[tid].rooms.map(r => r[0]).filter(rid => canMap(s, tid, rid) && allowed(tid, rid));
      const mapOne = () => { const d = dark(); if (!d.length) return false; const rid = d[Math.floor(rand(s) * d.length)]; s.lit[tid].push(rid); night.mapped.push(rid); return true; };
      mapOne(); // one room every night for free
      // Nib searches every lit room it knows how to: the current job first, then leftovers from earlier jobs.
      const pool = () => {
        const out = [];
        [tid].concat(Object.keys(s.lit).filter(x => x !== tid)).forEach(t => s.lit[t].filter(rid => allowed(t, rid)).forEach(rid => roomFindings(t, rid).forEach(fid => {
          if (slotState(s, fid) === 'open' && knows(s, FINDINGS[fid].cls)) out.push(fid);
        })));
        const cur = fid => FINDINGS[fid].target === tid ? 1 : 0;
        return out.sort((a, b) => cur(b) - cur(a) || precision(s, FINDINGS[b].cls) - precision(s, FINDINGS[a].cls) || rand(s) - 0.5);
      };
      const taught = Object.values(s.lessons).some(l => l.clean + l.noisy > 0);
      // Each try either searches a slot or, when nothing is left to search, maps another room.
      for (let left = night.tries; left > 0 && s.tray.length < COST.tray; left--) {
        const p = taught ? pool() : [];
        if (!p.length) { if (taught && mapOne()) continue; break; }
        const fid = p[0], pr = precision(s, FINDINGS[fid].cls), real = rand(s) < pr;
        const conf = clamp(Math.round((pr + (real ? 0.12 : -0.12) + (rand(s) - 0.5) * 0.36) * 100), 8, 97);
        s.tray.push({ id: s.nextId++, fid, real, conf, night: night.day });
        night.made++;
      }
      if (!night.made) night.idle = s.tray.length >= COST.tray ? 'full' : taught ? 'nothing' : 'untaught';
    } else night.idle = 'nojob';
    night.firsts = { rig: reveal(s, 'rig'), ops: night.made ? reveal(s, 'ops') : false };
    return { ok: true, night };
  }

  function nibDraft(s, fid, proven) {
    const p = precision(s, FINDINGS[fid].cls), rep = {};
    SECTIONS.forEach(x => { rep[x.id] = x.id === 'proof' ? (proven ? 0 : 1) : rand(s) < p ? 0 : 1; });
    return rep;
  }
  const cand = (s, id) => s.tray.find(c => c.id === id);
  function drop(s, id) { s.tray = s.tray.filter(c => c.id !== id); }
  function prove(s, id) {
    const c = cand(s, id); if (!c) return { ok: false, why: 'Gone.' };
    if (s.focus < COST.prove) return { ok: false, why: 'Proving takes 15 focus. Coffee or sleep.' };
    s.focus -= COST.prove; drop(s, id); s.stats.proven++;
    if (!c.real) { log(s, 'Proof showed a false alarm. No harm done.', ''); return { ok: true, real: false }; }
    s.found[c.fid] = { status: 'draft', source: 'nib', proven: true, report: {}, verdict: null };
    return { ok: true, real: true, fid: c.fid, paid: fileFound(s, c.fid, 'A') };
  }
  function submitRaw(s, id) {
    const c = cand(s, id); if (!c) return { ok: false, why: 'Gone.' };
    drop(s, id); s.stats.raw++;
    if (!c.real) { s.stats.falseSubmits++; const tierUp = addRep(s, -3, 'false alarm submitted'); return { ok: true, real: false, repDelta: -3, tierUp }; }
    s.found[c.fid] = { status: 'draft', source: 'nib', proven: false, report: {}, verdict: null };
    // Unproven: filed as Nib wrote it, so it's only as good as what you've taught.
    const res = fileFound(s, c.fid, precision(s, FINDINGS[c.fid].cls) >= 0.7 ? 'B' : 'C');
    return Object.assign({ real: true, fid: c.fid }, res);
  }
  function toss(s, id) { if (!cand(s, id)) return { ok: false }; drop(s, id); return { ok: true }; }

  function buyTool(s, id) {
    const t = TOOLS.find(x => x.id === id);
    if (!t || has(s, id)) return { ok: false, why: 'Already on the shelf.' };
    if (t.need && !has(s, t.need)) return { ok: false, why: 'Needs the ' + TOOLS.find(x => x.id === t.need).name + ' first.' };
    if (s.cash < t.cost) return { ok: false, why: 'Not enough cash.' };
    s.cash -= t.cost; s.tools.push(id); log(s, 'Bought the ' + t.name + '.', '');
    return { ok: true, first: id === 'dbg' || id === 'trace' ? reveal(s, 'hq') : false };
  }
  function setRig(s, level) {
    if (!(level >= 0 && level < RIGS.length) || level === s.gpu) return { ok: false };
    const diff = RIGS[level].cost - RIGS[s.gpu].cost;
    if (diff > s.cash) return { ok: false, why: 'Not enough cash.' };
    s.cash -= diff; s.gpu = level; return { ok: true, refund: diff < 0 ? -diff : 0 };
  }
  function toggleDesk(s, id) {
    const d = DESK.find(x => x.id === id); if (!d) return { ok: false };
    if (s.desk.includes(id)) { s.desk = s.desk.filter(x => x !== id); s.cash += d.cost; s.focus = Math.min(s.focus, maxFocus(s)); s.cups = Math.min(s.cups, maxCups(s)); return { ok: true, sold: true }; }
    if (s.cash < d.cost) return { ok: false, why: 'Not enough cash.' };
    s.cash -= d.cost; s.desk.push(id); return { ok: true, sold: false };
  }
  function chainState(s, tid) {
    const t = targetById[tid], a = t.id + ':' + t.chain.a, b = t.id + ':' + t.chain.b;
    const acc = fid => s.found[fid] && s.found[fid].status === 'accepted';
    return { a, b, haveA: acc(a), haveB: acc(b), done: !!s.chains[tid], ready: acc(a) && acc(b) && has(s, 'trace') && !s.chains[tid] };
  }
  function trace(s, tid, option) {
    const c = chainState(s, tid); if (!c.ready) return { ok: false, why: c.done ? 'Already chained.' : 'Needs both bugs accepted and the Tracer.' };
    if (option !== 0) return { ok: true, chained: false };
    const t = targetById[tid], pay = Math.round(t.base * 4 * tier(s).bonus);
    s.chains[tid] = true; s.crits++; s.cash += pay; s.stats.earned += pay;
    const tierUp = addRep(s, 6, 'critical chain on ' + t.name);
    log(s, 'CRITICAL chain: ' + t.chain.name + ' · $' + pay, 'crit');
    return { ok: true, chained: true, pay, tierUp, won: checkWin(s) };
  }

  // Program penalties in Stage 3 (out of scope and so on) go through the same reputation log.
  const penalize = (s, n, why) => addRep(s, -n, why);

  const api = { roomFilter: null, VERSION, GOAL, penalize, log, FINDINGS, targetById, create, restore, maxFocus, maxCups, tier, nextTier, precision, knows, unlocked, has, crowd, canTake, isLit, canMap, slotState, roomFindings, payout, gradeOf,
    takeJob, mapRoom, guess, teach, setSection, submit, fileDraft, coffee, sleep, prove, submitRaw, toss, buyTool, setRig, toggleDesk, chainState, trace, nibDraft };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Stage2Engine = api;
})(typeof window !== 'undefined' ? window : null);
