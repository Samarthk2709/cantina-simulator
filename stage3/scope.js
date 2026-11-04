/* Stage 3 setup, after engine.js and before game.js: the crew save (agents, rules, the penalty log) and thin views of the
   engine's chapter 3 rules (scope, strikes, bans and the chapter-select seed all live in engine.js). */
(function () {
  'use strict';
  const D = window.Stage2Data, E = window.Stage2Engine;
  const CREW = 'first-office-crew-v1';

  // Scope, strikes and bans live in engine.js (chapter 3 rules are part of the save, so a server can check them).
  const active = () => !!(window.Stage2 && window.Stage2.stage3());
  const live = () => window.Stage2 && window.Stage2.state();

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
    outOfScope: t => E.OUT_OF_SCOPE[t] || [],
    inScope: E.inScope,
    banned: t => !!live() && E.banned(live(), t),
    strikes: t => (live() && live().strikes || {})[t] || 0,
    on: fn => listeners.push(fn),
    // The engine has already taken the reputation; this records the penalty for the team view and its listeners.
    penalize(s, who, title, text, rep, program) { return note({who, title, text, rep, program, strikes: program ? Scope.strikes(program) : 0, banned: program ? Scope.banned(program) : false}); },
    STRIKE_REP: E.STRIKE_REP, BAN_AT: E.BAN_AT, seed: profile => E.seed3(profile),
  };
  window.Stage3Scope = Scope;

  function note(p) {
    p = {...p, at: Date.now()};
    crew.pens.push(p); crew.pens = crew.pens.slice(-60); Scope.save();
    listeners.forEach(fn => fn(p));
    return p;
  }
  // A strike from the engine (out of scope: the player or an agent) is recorded here as it happens.
  const prev = E.record;
  E.record = (s, a, r) => { if (r && r.penalty && active()) r.penalty = note(r.penalty); if (prev) prev(s, a, r); };
})();
