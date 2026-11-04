/* First Office rules (Stages 2 and 3). Pure state transitions; the page only renders and calls these.
   Stage 3 agents use the same calls as the player; `by` names the agent where it matters. */
(function (root) {
  'use strict';
  const D = typeof module === 'object' && module.exports ? require('./data.js') : root.Stage2Data;
  const { CLASSES, TARGETS, ALL_TARGETS, TOOLS, RIGS, DESK, REP_TIERS, GRADES, COST, SECTIONS } = D;
  const CH2_TRIES = 4; // chapter 2 has no rig: Nib gets a fixed few tries a night (and never fewer in chapter 3)
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
      releases: [], seenAt: 0, realDay: '', strikes: {}, hired: ['nib', 'pip', 'moss'], energy: {}, ot: {}, tools: ['proxy'], gpu: 0, desk: [], chains: {}, seen: {}, log: [], days: [], won: false, wonDay: 0, won3: false,
      stats: { manual: 0, nib: 0, agent: 0, proven: 0, raw: 0, falseSubmits: 0, earned: 0 }
    };
    Object.keys(CLASSES).forEach(k => { s.lessons[k] = { clean: 0, noisy: 0 }; });
    return s;
  }
  function clean(v, d) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : d; }
  // Chapter 3: programs ship updates, so new findings appear over time. Each is a new slot in a room, recorded in the
  // save (s.releases) and re-added on load before anything checks that its id exists.
  function addSlot(x) {
    const t = targetById[x.t], r = t && t.rooms.find(y => y[0] === x.room); if (!r || !CLASSES[x.cls]) return null;
    const id = x.t + ':' + x.room + ':' + x.slot; if (FINDINGS[id]) return id;
    if (r[5].length !== x.slot) return null; // out of order: skip rather than leave a gap
    r.base ??= r[5].length; // the room's own slots, before any release (seed() uses only these)
    r[5].push(x.cls); FINDINGS[id] = D.finding(t, r, x.slot); return id;
  }
  function shipRelease(s) {
    const allowed = (t, rid) => allowedRoom(s, t, rid);
    const ts = ALL_TARGETS.filter(t => canTake(s, t.id).ok && t.rooms.some(r => allowed(t.id, r[0]) && r[5].length < 5)); if (!ts.length) return null;
    const t = ts[Math.floor(rand(s) * ts.length)], out = [];
    for (let n = 1 + (rand(s) < 0.5 ? 1 : 0); n > 0; n--) {
      const rooms = t.rooms.filter(r => allowed(t.id, r[0]) && r[5].length < 5); if (!rooms.length) break;
      const r = rooms[Math.floor(rand(s) * rooms.length)], cls = r[5][Math.floor(rand(s) * r[5].length)];
      const x = { t: t.id, room: r[0], slot: r[5].length, cls }; if (addSlot(x)) { (s.releases = s.releases || []).push(x); out.push(r[1]); }
    }
    return out.length ? { t: t.id, rooms: out } : null;
  }
  function restore(o) {
    if (!o || o.v !== VERSION || typeof o.day !== 'number' || !o.found || !o.lessons) throw new Error('bad save');
    (o.releases || []).forEach(addSlot);
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
    if (s.focus < COST.find) return { ok: false, why: 'Too tired to file it. Coffee or sleep.' };
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
    const night = { day: s.day, mapped: [], tries: s.stage === 3 ? Math.max(CH2_TRIES, RIGS[s.gpu].tries) : CH2_TRIES, made: 0, idle: '' };
    // End-of-day totals for the vitals box: today's numbers are the change since the last entry.
    s.days.push({ day: s.day, bugs: s.bugs, crits: s.crits, cash: s.cash, rep: s.rep, earned: s.stats.earned }); if (s.days.length > 60) s.days.shift();
    s.day++; s.focus = maxFocus(s); s.cups = maxCups(s);
    (s.hired || []).forEach(id => { s.energy[id] = COST.focus; }); // the team wakes up rested too
    TARGETS.forEach(t => { if (!t.private) s.picked[t.id] = Math.min(0.9, +(s.picked[t.id] + COST.crowd).toFixed(2)); });
    const tid = s.target;
    if (tid) {
      // Chapter 3 keeps Nib out of off-limits rooms and banned programs.
      const allowed = (t, rid) => allowedRoom(s, t, rid);
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
    if (s.stage === 3) night.release = shipRelease(s);
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
    if (!Number.isInteger(level) || !(level >= 0 && level < RIGS.length) || level === s.gpu) return { ok: false };
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
    if (!Object.hasOwn(targetById, tid)) return { ok: false, why: 'No such program.' };
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


  // ---------- chapter 3: scope, strikes and bans ----------
  // Each program publishes rooms that are off limits. Touching one is a strike; three bans the company there.
  const OUT_OF_SCOPE = { chat: ['bots'], inv: ['admin'], vault: ['crypto'], bank: ['core'], ship: ['hub'] };
  const STRIKE_REP = 6, BAN_AT = 3;
  const inScope = (t, room) => !(OUT_OF_SCOPE[t] || []).includes(room);
  const banned = (s, t) => s.stage === 3 && ((s.strikes || {})[t] || 0) >= BAN_AT;
  const allowedRoom = (s, t, rid) => s.stage !== 3 || (inScope(t, rid) && !banned(s, t));
  const bannedWhy = t => ({ ok: false, why: targetById[t].name + ' banned the company after ' + BAN_AT + ' out-of-scope strikes.' });
  function strike(s, tid, rid, what) {
    const who = s.actor || 'You', n = ((s.strikes = s.strikes || {})[tid] || 0) + 1, t = targetById[tid], room = t.rooms.find(x => x[0] === rid)[1];
    s.strikes[tid] = n; penalize(s, STRIKE_REP, 'out of scope · ' + who);
    return { who, title: 'Out of scope', text: who + ' ' + what + ' ' + room + ', which is out of scope for ' + t.name + '. −' + STRIKE_REP + ' rep · strike ' + n + '/' + BAN_AT + '.', rep: STRIKE_REP, program: tid, strikes: n, banned: n >= BAN_AT };
  }
  const st3 = {
    takeJob: (s, tid) => banned(s, tid) ? bannedWhy(tid) : takeJob(s, tid),
    mapRoom(s, rid) {
      if (s.target && banned(s, s.target)) return bannedWhy(s.target);
      const r = mapRoom(s, rid);
      if (r.ok && s.stage === 3 && !inScope(s.target, rid)) r.penalty = strike(s, s.target, rid, 'mapped');
      return r;
    },
    // Only a find counts: the program sees the report, not the wrong guesses.
    guess(s, fid, line, by) {
      const f = FINDINGS[fid]; if (f && banned(s, f.target)) return bannedWhy(f.target);
      const r = guess(s, fid, line, by);
      if (r.ok && r.hit && s.stage === 3 && !inScope(f.target, f.room)) r.penalty = strike(s, f.target, f.room, 'hunted in');
      return r;
    },
    submit: (s, fid, ...x) => FINDINGS[fid] && banned(s, FINDINGS[fid].target) ? bannedWhy(FINDINGS[fid].target) : submit(s, fid, ...x),
    prove: (s, id) => { const c = s.tray.find(x => x.id === id); return c && banned(s, FINDINGS[c.fid].target) ? bannedWhy(FINDINGS[c.fid].target) : prove(s, id); },
    submitRaw: (s, id) => { const c = s.tray.find(x => x.id === id); return c && banned(s, FINDINGS[c.fid].target) ? bannedWhy(FINDINGS[c.fid].target) : submitRaw(s, id); },
    trace: (s, tid, o) => banned(s, tid) ? bannedWhy(tid) : trace(s, tid, o),
  };

  // ---------- chapter 3: the team (focus, hiring, overtime) ----------
  const HIRES = { rook: 600, wren: 900 }, OT = { cost: 150, focus: 40, max: 2 };
  const NAMES = { pip: 'Pip', moss: 'Moss', rook: 'Rook', wren: 'Wren' };
  const agentName = (s, id) => id === 'nib' ? s.nib : NAMES[id] || id;
  const energyOf = (s, id) => (s.energy || {})[id] ?? COST.focus;
  function hire(s, id) {
    if (s.stage !== 3 || !Object.hasOwn(HIRES, id) || s.hired.includes(id)) return { ok: false, why: 'Can\'t hire them.' };
    if (s.cash < HIRES[id]) return { ok: false, why: 'Not enough cash.' };
    s.cash -= HIRES[id]; s.hired.push(id); s.energy[id] = COST.focus; log(s, 'Hired ' + NAMES[id] + ' · −$' + HIRES[id], '');
    return { ok: true, price: HIRES[id] };
  }
  // Overtime: a coffee run buys an out-of-focus agent more focus today. Each run the same day costs more.
  function coffeeRun(s, id) {
    if (!s.hired.includes(id)) return { ok: false, why: 'No such agent.' };
    const o = s.ot[id], n = o && o.day === s.day ? o.n : 0, price = OT.cost * (n + 1);
    if (n >= OT.max) return { ok: false, why: 'Two coffee runs a day is the limit.' };
    if (s.cash < price) return { ok: false, why: 'Not enough cash.' };
    s.cash -= price; s.energy[id] = energyOf(s, id) + OT.focus; s.ot[id] = { day: s.day, n: n + 1 };
    return { ok: true, price, focus: OT.focus };
  }
  // An agent's engine calls run with its own focus and, if it has one, its own program. keep: a take_target keeps it.
  let acting = null; // the agent context while fn runs (record() tags each call with it)
  function asAgent(s, id, target, keep, fn) {
    if (!s.hired.includes(id)) return { ok: false, why: 'No such agent.' };
    if (target && (!Object.hasOwn(targetById, target) || banned(s, target) || !canTake(s, target).ok)) return { ok: false, why: 'Can\'t work there.' };
    const saved = { target: s.target, focus: s.focus }, prev = acting;
    if (target) { s.target = target; if (!s.lit[target]) s.lit[target] = [targetById[target].rooms[0][0]]; }
    s.focus = energyOf(s, id); s.actor = agentName(s, id); acting = { actor: id, target: target || null, keep: !!keep };
    try { return fn(s); } finally { s.energy[id] = s.focus; s.focus = saved.focus; if (!keep) s.target = saved.target; delete s.actor; acting = prev; }
  }
  // Chapter 3's goal: Elite reputation with at least 5 bugs landed by the team.
  const TEAM_GOAL = 5;
  function checkWin3(s) { if (s.stage === 3 && !s.won3 && s.rep >= 60 && (s.stats.agent || 0) >= TEAM_GOAL) { s.won3 = true; return true; } return false; }
  function startStage3(s) {
    if (!s.won) return { ok: false, why: 'Finish the first job first.' };
    if (s.stage === 3) return { ok: true };
    s.stage = 3; ['job', 'training', 'ops', 'forge', 'rig', 'stats', 'hq', 'rest', 'intro'].forEach(k => { s.seen[k] = true; });
    s.hired = s.hired || ['nib', 'pip', 'moss']; s.hired.forEach(id => { s.energy[id] = COST.focus; });
    return { ok: true };
  }
  // A finished first job, for jumping straight to chapter 3 from the chapter menu.
  function seed3(profile) {
    const s = create(profile || {}, 424242);
    const lit = { chat: ['login', 'msgs', 'groups', 'media', 'search'], inv: ['acct', 'inv', 'up', 'pdf'], vault: ['sync', 'share', 'import', 'ext', 'login'] };
    s.lit = JSON.parse(JSON.stringify(lit)); s.target = 'inv';
    s.tools = ['proxy', 'fuzz', 'dbg']; s.gpu = 2; s.desk = ['coffee'];
    s.lessons = { info: { clean: 3, noisy: 0 }, auth: { clean: 3, noisy: 1 }, inj: { clean: 2, noisy: 0 }, path: { clean: 2, noisy: 1 }, mem: { clean: 1, noisy: 0 }, race: { clean: 1, noisy: 1 } };
    // Twenty accepted findings, all in scope, starting with ChatterBox's chain; the other chains' halves stay unfound.
    const own = (t, r) => roomFindings(t, r).filter(fid => { const room = targetById[t].rooms.find(x => x[0] === r); return +fid.split(':')[2] < (room.base ?? Infinity); });
    const ids = ['chat:login:0', 'chat:msgs:0'].concat(Object.keys(lit).flatMap(t => lit[t].flatMap(r => own(t, r))))
      .filter((fid, i, a) => a.indexOf(fid) === i && inScope(FINDINGS[fid].target, FINDINGS[fid].room))
      .filter(fid => { const f = FINDINGS[fid], c = targetById[f.target].chain; return f.target === 'chat' || ![c.a, c.b].includes(f.room + ':' + f.slot); }).slice(0, 20);
    let earned = 0;
    ids.forEach((fid, i) => {
      const pay = payout(s, fid, i % 3 ? 'A' : 'B', i < 11, false); earned += pay;
      s.found[fid] = { status: 'accepted', source: i < 11 ? 'manual' : 'nib', proven: i < 11, report: { title: 0, impact: 0, steps: 0, proof: 0, fix: 0 }, verdict: null, grade: i % 3 ? 'A' : 'B', pay, crit: false, day: 1 + (i >> 2) };
    });
    const chainPay = Math.round(targetById.chat.base * 4 * 1.1);
    Object.assign(s, { bugs: 20, crits: 1, chains: { chat: true }, rep: 34, day: 7, cash: 2400, won: true, wonDay: 6,
      stats: Object.assign(s.stats, { manual: 11, nib: 9, proven: 6, raw: 3, falseSubmits: 1, earned: earned + chainPay }) });
    Object.keys(s.picked).forEach(t => { if (!targetById[t].private) s.picked[t] = Math.min(0.9, +(s.picked[t] + 0.12).toFixed(2)); });
    log(s, 'CRITICAL chain: ' + targetById.chat.chain.name + ' · $' + chainPay, 'crit');
    log(s, 'First job done, with a critical.', 'good');
    startStage3(s);
    return restore(JSON.parse(JSON.stringify(s)));
  }
  // Names and tutorial flags: cosmetic, so the page may set them (the server checks only their shape).
  function meta(s, m) {
    m = m && typeof m === 'object' ? m : {};
    if (typeof m.player === 'string') s.player = clean(m.player, s.player);
    if (typeof m.nib === 'string') s.nib = clean(m.nib, s.nib);
    if (m.seen && typeof m.seen === 'object') for (const k of Object.keys(m.seen)) if (/^[a-z0-9]{1,16}$/.test(k) && m.seen[k] === true) s.seen[k] = true;
    if (Number.isFinite(m.seenAt)) s.seenAt = m.seenAt;
    return { ok: true };
  }

  // ---------- actions: everything that changes the save, by name, so a server can replay it ----------
  // The page plays them locally at once and sends them up; the server replays them on its own copy (which is the real
  // save). record(): the page's hook, told about every call to one of these, with the agent context if any.
  const ACTIONS = { takeJob: st3.takeJob, mapRoom: st3.mapRoom, guess: st3.guess, teach, setSection, submit: st3.submit, fileDraft, coffee, sleep, prove: st3.prove,
    submitRaw: st3.submitRaw, toss, buyTool, setRig, toggleDesk, trace: st3.trace, hire, coffeeRun, startStage3, meta };
  // What a replayed action may carry: plain values only (meta's one object aside), no prototype names, known agents
  // and programs. Anything else is refused before it reaches the rules.
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  const plain = v => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 80 && !BAD_KEYS.includes(v));
  function validAction(a) {
    if (!a || typeof a !== 'object' || typeof a.fn !== 'string' || !Object.hasOwn(ACTIONS, a.fn)) return false;
    const args = a.args == null ? [] : a.args; if (!Array.isArray(args) || args.length > 6) return false;
    if (!args.every((v, i) => plain(v) || (a.fn === 'meta' && i === 0 && v && typeof v === 'object' && !Array.isArray(v)))) return false;
    if (a.actor != null && !(typeof a.actor === 'string' && (a.actor === 'nib' || Object.hasOwn(NAMES, a.actor)))) return false;
    if (a.target != null && !(typeof a.target === 'string' && Object.hasOwn(targetById, a.target))) return false;
    return true;
  }
  function act(s, a) {
    if (!validAction(a)) return { ok: false, why: 'Bad action.' };
    const run = s2 => ACTIONS[a.fn](s2, ...(a.args || []));
    const r = a.actor ? asAgent(s, a.actor, a.target, a.keep, run) : run(s);
    checkWin3(s);
    return r;
  }
  // A fingerprint of what matters, so the page and the server can tell if their copies still agree.
  const digest = s => [s.day, s.cash, s.rep, s.bugs, s.crits, s.focus, s.cups, s.rng, s.tray.length, Object.keys(s.found).length, s.stage, s.won, s.won3, s.gpu, s.tools.length, s.stats.agent || 0].join('|');
  const recorded = {};
  let depth = 0;
  Object.keys(ACTIONS).forEach(name => {
    recorded[name] = function (s, ...args) {
      depth++;
      try { const r = ACTIONS[name](s, ...args); checkWin3(s); if (depth === 1 && api.record) api.record(s, { fn: name, args, ...(acting || {}) }, r); return r; }
      finally { depth--; }
    };
  });

  const api = { shipRelease, act, digest, asAgent, seed3, banned, inScope, OUT_OF_SCOPE, STRIKE_REP, BAN_AT, HIRES, OT, TEAM_GOAL, energyOf, checkWin3, ACTIONS: Object.keys(ACTIONS), record: null, VERSION, GOAL, penalize, log, FINDINGS, targetById, create, restore, maxFocus, maxCups, tier, nextTier, precision, knows, unlocked, has, crowd, canTake, isLit, canMap, slotState, roomFindings, payout, gradeOf,
    chainState, nibDraft, ...recorded };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Stage2Engine = api;
})(typeof window !== 'undefined' ? window : null);
