/* Stage 3 setup. Runs after engine.js and before game.js:
   1. program scope and strikes on the shared engine, for the player and agents alike (Stage 3 only),
   2. the crew save (agents, rules, strikes, penalties),
   3. seed(): a finished first job, used by the chapter menu to jump straight to Stage 3. */
(function () {
  'use strict';
  const D = window.Stage2Data, E = window.Stage2Engine;
  const CREW = 'first-office-crew-v1';

  // Each program publishes rooms that are off limits. Touching one is a strike.
  const OUT_OF_SCOPE = {chat: ['bots'], inv: ['admin'], vault: ['crypto'], bank: ['core'], ship: ['hub']};
  const STRIKE_REP = 6, BAN_AT = 3;
  const active = () => !!(window.Stage2 && window.Stage2.stage3());
  const roomName = (t, r) => E.targetById[t].rooms.find(x => x[0] === r)[1];

  // ---------- crew save ----------
  const blankCrew = () => ({version: 1, strikes: {chat: 0, inv: 0, vault: 0, bank: 0, ship: 0}, pens: [], rules: {all: {}}, custom: {all: []}, agents: null, hired: ['nib', 'pip', 'moss']});
  let crew;
  try { crew = JSON.parse(localStorage.getItem(CREW)) || blankCrew(); } catch { crew = blankCrew(); }
  if (crew.version !== 1) crew = blankCrew();
  const listeners = [];
  let frozen = false; // set by reset(), which is always followed by a reload: nothing may write the old crew back
  const Scope = {
    data: () => crew,
    save() { if (frozen) return; try { localStorage.setItem(CREW, JSON.stringify(crew)); } catch {} },
    reset() { crew = blankCrew(); frozen = true; try { localStorage.removeItem(CREW); } catch {} },
    outOfScope: t => OUT_OF_SCOPE[t] || [],
    inScope: (t, room) => !(OUT_OF_SCOPE[t] || []).includes(room),
    banned: t => (crew.strikes[t] || 0) >= BAN_AT,
    on: fn => listeners.push(fn),
    // Penalties come from the programs, not the game, and are recorded for whoever acted.
    // applied: the engine already took the reputation (false alarms, overclaims), so only record it.
    penalize(s, who, title, text, rep, program, applied) {
      if (!applied) E.penalize(s, rep, title.toLowerCase() + ' · ' + who);
      if (program) crew.strikes[program] = (crew.strikes[program] || 0) + 1;
      const p = {who, title, text, rep, program, strikes: program ? crew.strikes[program] : 0, banned: program ? Scope.banned(program) : false, at: Date.now()};
      crew.pens.push(p); crew.pens = crew.pens.slice(-60); Scope.save();
      listeners.forEach(fn => fn(p));
      return p;
    },
    STRIKE_REP, BAN_AT, seed,
  };
  window.Stage3Scope = Scope;

  // ---------- scope and strikes on the shared engine ----------
  // window.Stage3Actor names whoever is acting ('You' unless an agent's tool is running).
  const bannedWhy = t => ({ok: false, why: `${E.targetById[t].name} banned the company after ${BAN_AT} out-of-scope strikes.`});
  function strike(s, tid, rid, what) {
    const who = window.Stage3Actor || 'You', t = E.targetById[tid];
    return Scope.penalize(s, who, 'Out of scope', `${who === 'You' ? 'You' : who} ${what} ${roomName(tid, rid)}, which is out of scope for ${t.name}. −${STRIKE_REP} rep · strike ${(crew.strikes[tid] || 0) + 1}/${BAN_AT}.`, STRIKE_REP, tid);
  }
  const takeJob = E.takeJob, mapRoom = E.mapRoom, guess = E.guess;
  E.takeJob = function (s, tid) { return active() && Scope.banned(tid) ? bannedWhy(tid) : takeJob(s, tid); };
  E.mapRoom = function (s, rid) {
    if (active() && s.target && Scope.banned(s.target)) return bannedWhy(s.target);
    const r = mapRoom(s, rid);
    if (r.ok && active() && !Scope.inScope(s.target, rid)) r.penalty = strike(s, s.target, rid, 'mapped');
    return r;
  };
  // Only a find counts: the program sees the report, not the wrong guesses.
  E.guess = function (s, fid, line, by) {
    const f = E.FINDINGS[fid];
    if (active() && f && Scope.banned(f.target)) return bannedWhy(f.target);
    const r = guess(s, fid, line, by);
    if (r.ok && r.hit && active() && !Scope.inScope(f.target, f.room)) r.penalty = strike(s, f.target, f.room, 'hunted in');
    return r;
  };

  // Nib's night shift and every way of getting paid respect scope and bans too, not just mapping and hunting.
  E.roomFilter = (t, rid) => !active() || (Scope.inScope(t, rid) && !Scope.banned(t));
  const fidOf = (s, id) => (s.tray.find(c => c.id === id) || {}).fid;
  for (const [name, fidFrom] of [['submit', (s, fid) => fid], ['prove', fidOf], ['submitRaw', fidOf], ['trace', (s, tid) => null]]) {
    const orig = E[name];
    E[name] = function (s, x, ...rest) {
      const tid = name === 'trace' ? x : E.FINDINGS[fidFrom(s, x)]?.target;
      if (active() && tid && Scope.banned(tid)) return bannedWhy(tid);
      return orig(s, x, ...rest);
    };
  }

  // ---------- a finished first job (chapter select) ----------
  function seed(profile) {
    const s = E.create(profile || {}, 424242);
    const lit = {chat: ['login', 'msgs', 'groups', 'media', 'search'], inv: ['acct', 'inv', 'up', 'pdf'], vault: ['sync', 'share', 'import', 'ext', 'login']};
    s.lit = JSON.parse(JSON.stringify(lit)); s.target = 'inv';
    s.tools = ['proxy', 'fuzz', 'dbg']; s.gpu = 2; s.desk = ['coffee'];
    s.lessons = {info: {clean: 3, noisy: 0}, auth: {clean: 3, noisy: 1}, inj: {clean: 2, noisy: 0}, path: {clean: 2, noisy: 1}, mem: {clean: 1, noisy: 0}, race: {clean: 1, noisy: 1}};
    // Twenty accepted findings, all in scope, starting with ChatterBox's chain.
    const ids = ['chat:login:0', 'chat:msgs:0'].concat(Object.keys(lit).flatMap(t => lit[t].flatMap(r => E.roomFindings(t, r))))
      .filter((fid, i, a) => a.indexOf(fid) === i && Scope.inScope(E.FINDINGS[fid].target, E.FINDINGS[fid].room))
      // Leave the other programs' chain halves unfound, so chapter 3's criticals have to be earned.
      .filter(fid => { const f = E.FINDINGS[fid], c = E.targetById[f.target].chain; return f.target === 'chat' || ![c.a, c.b].includes(f.room + ':' + f.slot); }).slice(0, 20);
    let earned = 0;
    ids.forEach((fid, i) => {
      const pay = E.payout(s, fid, i % 3 ? 'A' : 'B', i < 11, false); earned += pay;
      s.found[fid] = {status: 'accepted', source: i < 11 ? 'manual' : 'nib', proven: i < 11, report: {title: 0, impact: 0, steps: 0, proof: 0, fix: 0}, verdict: null, grade: i % 3 ? 'A' : 'B', pay, crit: false, day: 1 + (i >> 2)};
    });
    const chainPay = Math.round(E.targetById.chat.base * 4 * 1.1);
    Object.assign(s, {bugs: 20, crits: 1, chains: {chat: true}, rep: 34, day: 7, cash: 2400, won: true, wonDay: 6,
      stats: Object.assign(s.stats, {manual: 11, nib: 9, proven: 6, raw: 3, falseSubmits: 1, earned: earned + chainPay})});
    Object.keys(s.picked).forEach(t => { if (!E.targetById[t].private) s.picked[t] = Math.min(0.9, +(s.picked[t] + 0.12).toFixed(2)); });
    ['job', 'training', 'ops', 'forge', 'rig', 'stats', 'hq', 'rest', 'intro'].forEach(k => { s.seen[k] = true; });
    E.log(s, 'CRITICAL chain: ' + E.targetById.chat.chain.name + ' · $' + chainPay, 'crit');
    E.log(s, 'First job done: 20 bugs and a critical.', 'good');
    return E.restore(JSON.parse(JSON.stringify(s)));
  }
})();
