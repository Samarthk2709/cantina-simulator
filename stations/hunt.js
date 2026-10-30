/* Desk (Founder Workstation): animated variants. See stations/fx.js for the contract.
   Every variant keeps the desk's identity from original/world.js: the walnut desk, two monitors (cream code screen
   on the left, orange screen on the right), the keyboard, the paper and the orange chair at the approach tile.
   The desk has no facility level, so what it carries instead is progress: bugs / crits toward the
   bugs + 1 critical goal (engine GOAL), and cash as a pile of coins (A), bugs in a jar (B) or blips on a radar (C).
     A  Bug Squash   - the screens sleep with a bouncing-bug screensaver, wake when you walk up, squash the bug on pay;
                       agents slide a split pane into the editor and type in their colour.
     B  Lamp & Jar   - a cozy analog desk: a roach wanders, the lamp clicks on and it bolts; pay drops a bug in the jar;
                       agents pin coloured sticky notes on the monitors and peel them off when done.
     C  Bounty Sonar - the right screen is an amber radar sweeping for bugs, a receipt printer prints your payouts;
                       agents show up as coloured blips homing in on the centre. */
(function () {
  'use strict';
  const FX = window.StationFX; if (!FX) return;

  // ---------- shared helpers ----------
  // Stage 3 roster has no colours (k.agents[].color is null): match each agent's avatar body (avatars.js CAST).
  const AGENT = { nib: '#7ff0d8', pip: '#6cc28a', moss: '#d0705f', rook: '#a68ad8', wren: '#e8b54a' };
  const agentCol = a => (a && (a.color || AGENT[a.id])) || '#7cc4f0';
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const outBack = p => { p -= 1; return 1 + p * p * (2.70158 * p + 1.70158); };
  const outCubic = p => 1 - (1 - p) * (1 - p) * (1 - p);
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  // Progress 0..1 of an event animation lasting dur seconds, -1 when it is not playing. Reduced motion holds the end frame.
  const prog = (k, kind, dur) => { const s = k.since(kind); return s > dur ? -1 : k.anim ? clamp(s / dur) : 1; };
  const lastEv = (k, kind) => { for (let i = k.events.length - 1; i >= 0; i--) if (k.events[i].kind === kind) return k.events[i]; return null; };
  const tri = (n, span) => { const m = n % (span * 2); return m < span ? m : span * 2 - m; }; // 0..span..0
  // Progress lives in the save, not in k.S (that's the world's view state: started/paused/speed), so it is read
  // from Stage2.live() (the live save object, no copy). k.save lets an offline harness pass its own.
  const save = k => k.save || (window.Stage2 && window.Stage2.live && window.Stage2.live()) || {};
  const bugsOf = k => save(k).bugs || 0, critsOf = k => save(k).crits || 0, cashOf = k => save(k).cash || 0;
  const working = k => k.agents.filter(a => a.status === 'working');
  const awake = k => k.near || k.open || k.agents.length > 0;
  function payCol(k) { const e = lastEv(k, 'pay'); const who = e && e.data.who; return who && who !== 'you' ? agentCol({ id: who }) : null; }

  // Original pieces, in the original colours and positions.
  function desk(c, k) { R(c, '#5a3a22', k.x, k.y + 3, k.w, 12); R(c, '#8a5e3a', k.x, k.y + 3, k.w, 2); }
  function chair(c, k, dx, narrow) { // the approach tile (9,6): footprint x + 24, y + 24
    const ax = k.x + 24 + (dx || 0), ay = k.y + 24, w = narrow ? 6 : 10;
    R(c, '#c4572b', ax - (w >> 1), ay - 4, w, 9); R(c, '#8a3516', ax - (w >> 1), ay + 3, w, 2);
    if (narrow) R(c, '#8a3516', ax - (w >> 1), ay - 4, 1, 9); // the chair seen side-on
  }
  function bezel(c, k, mx, top) { R(c, '#1d2233', mx, k.y - 7 - (top || 0), 16, 11 + (top || 0)); }
  function keyboard(c, k, typing, col) {
    R(c, '#cfd4de', k.x + 16, k.y + 7, 16, 3);
    if (typing && k.anim) for (let i = 0; i < 2; i++) R(c, col || '#ffffff', k.x + 17 + ((k.f * 5 + i * 7) % 14), k.y + 8, 1, 1);
  }
  function clipRect(c, x, y, w, h) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); }

  // Code lines on the cream screen (left monitor, 14x8 at x+6, y-6). Lengths cycle so the code scrolls.
  const CODE = [9, 5, 11, 7, 3, 10, 6, 12, 4, 8, 11, 5];
  function codeLines(c, k, sx, sy, w, scroll, col, hot) {
    for (let i = 0; i < 4; i++) {
      const n = CODE[(i + scroll) % CODE.length], ind = (i + scroll) % 3 === 1 ? 2 : 0, len = Math.min(w - 1 - ind, n);
      R(c, col, sx + 1 + ind, sy + 1 + i * 2, len, 1);
      if (hot && (i + scroll) % 4 === 0) R(c, hot, sx + 1 + ind, sy + 1 + i * 2, 2, 1); // a keyword
    }
  }
  function bugSprite(c, x, y, col, legs) { // 3x2 bug with legs every other frame
    R(c, col, x, y, 3, 2); R(c, '#1b1f2b', x + 2, y, 1, 1);
    if (legs) { R(c, '#1b1f2b', x, y + 2, 1, 1); R(c, '#1b1f2b', x + 2, y + 2, 1, 1); }
  }

  // =====================================================================================================
  // A · Bug Squash: an editor that sleeps, wakes, and squashes the bug it shows.
  // =====================================================================================================
  const A = {
    name: 'Bug Squash: screens wake for you, pay squashes the bug, agents type in a split pane',
    draw(c, k) {
      const x = k.x, y = k.y, f = k.anim ? k.f : 0, t = k.anim ? k.t : 0, up = awake(k) || k.since('agent-done') < 0.9 || k.since('pay') < 1.6;
      const L = { x: x + 6, y: y - 6 }, Rt = { x: x + 28, y: y - 6 }, crew = working(k);
      // Chair: spins for a moment after you get up (anticipation: a tiny lean first).
      const lv = prog(k, 'leave', 0.9);
      if (lv >= 0 && lv < 1 && !k.near) { const s = lv < 0.11 ? 0 : Math.floor((lv - 0.11) * 14); chair(c, k, lv < 0.11 ? -1 : 0, s % 2 === 1 && s < 10); }
      else chair(c, k, 0, false);
      desk(c, k); coins(c, k, t);
      bezel(c, k, x + 5); bezel(c, k, x + 27);
      // Wake wipe: the awake screen rolls down over the screensaver (350 ms, eased); going to sleep rolls it back up.
      const nearP = prog(k, 'near', 0.35), leaveP = prog(k, 'leave', 0.35);
      let rows = up ? 8 : 0;
      if (up && nearP >= 0 && k.near) rows = Math.round(8 * outCubic(nearP));
      if (!up && leaveP >= 0) rows = Math.round(8 * (1 - outCubic(leaveP)));
      if (rows < 8) saver(c, k, f, L, Rt);
      if (rows > 0) {
        clipRect(c, L.x, L.y, 14, rows); editor(c, k, f, t, L, crew); c.restore();
        clipRect(c, Rt.x, Rt.y, 14, rows); chart(c, k, Rt); c.restore();
        if (rows < 8) { R(c, '#ffffff', L.x, L.y + rows, 14, 1); R(c, '#ffffff', Rt.x, Rt.y + rows, 14, 1); } // scan edge
      }
      // Agents on their way: a bezel LED blinks in their colour; at work, keys flash in their colour.
      k.agents.forEach((a, i) => { if (a.status === 'walking' && (!k.anim || (f + i * 2) % 6 < 3)) R(c, agentCol(a), x + 18 - i * 3, y - 7, 2, 1); });
      keyboard(c, k, k.near || k.open || crew.length > 0, crew.length && !k.near ? agentCol(crew[0]) : null);
      // At work: the right monitor's top bezel lights an LED strip per agent (a chase pixel runs along it) and the
      // paper fills with notes in their colour. Both sit clear of the speech bubbles, which cover the screens' middle.
      crew.slice(0, 2).forEach((a, i) => { const col = agentCol(a), lx = x + 29 + i * 7;
        R(c, col, lx, y - 7, 5, 1); if (k.anim) R(c, '#ffffff', lx + (f + i * 2) % 5, y - 7, 1, 1); });
      R(c, '#f1e6c8', x + 36, y + 7, 7, 5);
      if (crew.length && !k.open) { const col = agentCol(crew[0]), n = k.anim ? 1 + (f >> 2) % 3 : 3; for (let i = 0; i < n; i++) R(c, col, x + 37, y + 8 + i * 1 + i, 2 + (i * 2) % 4, 1); }
      if (k.open) { R(c, '#8a8a8a', x + 37, y + 8, 5, 1); R(c, '#8a8a8a', x + 37, y + 10, k.anim ? 1 + (f >> 1) % 4 : 3, 1); } // notes while the window is open
      paySparks(c, k, L);
    },
    busy(k) { return k.since('leave') < 1 || k.since('pay') < 1.6; }
  };
  // Asleep: dark screens, a little bug bounces DVD-style across both of them (hidden in the bezel gap).
  function saver(c, k, f, L, Rt) {
    R(c, '#1f2a4a', L.x, L.y, 14, 8); R(c, '#2a2238', Rt.x, Rt.y, 14, 8);
    const bx = x0 => tri(x0, 33), by = tri(Math.floor(f * 0.75), 6), px = L.x + bx(f);
    if (k.anim && (px + 3 <= L.x + 14 || px >= Rt.x)) bugSprite(c, px, L.y + by, '#e86a6a', f % 2 === 0);
    if (!k.anim) bugSprite(c, L.x + 5, L.y + 3, '#e86a6a', true);
  }
  // Awake left screen: scrolling code, a bug crawling on one line (bracketed while the window is open), and
  // agents' split panes sliding in from the right edge.
  function editor(c, k, f, t, L, crew) {
    R(c, '#fff3c8', L.x, L.y, 14, 8);
    const scroll = Math.floor(f / 6);
    codeLines(c, k, L.x, L.y, 14, scroll, '#1f2a4a', '#c4572b');
    if (k.anim) R(c, '#1f2a4a', L.x + 1 + (f % 10), L.y + 4, 3, 1); // the original's moving cursor
    // The bug lives on line 2 until a payment squashes it.
    const pay = prog(k, 'pay', 1.6), ev = lastEv(k, 'pay'), crit = ev && ev.data.crit, bx = L.x + 2 + tri(Math.floor(f / 2), 8), by = L.y + 3;
    if (pay < 0 || pay >= 0.9) {
      if (pay >= 0.9) { R(c, '#4cf08a', L.x + 4, by, 6, 1); } // fixed line flashes green as the next bug spawns
      else { bugSprite(c, bx, by, '#c4572b', f % 2 === 0); if (k.open && (!k.anim || f % 4 < 3)) { R(c, '#c4572b', bx - 2, by - 2, 2, 1); R(c, '#c4572b', bx + 3, by - 2, 2, 1); R(c, '#c4572b', bx - 2, by + 3, 2, 1); R(c, '#c4572b', bx + 3, by + 3, 2, 1); } }
    } else {
      const s = pay * 1.6, sx = L.x + 6;
      if (s < 0.1) bugSprite(c, sx, by - 1, '#c4572b', false); // anticipation: it hops up
      else { const col = crit ? '#e8c14a' : payCol(k) || '#4cf08a'; R(c, col, sx - 1, by + 1, 5, 1); R(c, col, sx, by, 1, 1); R(c, col, sx + 2, by, 1, 1); // splat
        if (s < 0.35) { R(c, col, L.x, L.y, 14, 1); R(c, col, L.x, L.y + 7, 14, 1); R(c, col, L.x, L.y, 1, 8); R(c, col, L.x + 13, L.y, 1, 8); } } // screen rim flash
    }
    // Agent panes: slide in on agent-start with overshoot, show a check and slide out on agent-done.
    const st = prog(k, 'agent-start', 0.4), dn = prog(k, 'agent-done', 0.9);
    const show = crew.length ? crew.slice(0, 1) : dn >= 0 ? [{ id: (lastEv(k, 'agent-done') || {}).data?.who }] : [];
    show.forEach(a => {
      const col = agentCol(a), off = crew.length ? (st >= 0 ? Math.round(6 * (1 - outBack(st))) : 0) : Math.round(6 * clamp((dn - 0.5) / 0.5));
      const px = L.x + 8 + off;
      R(c, '#1b1f2b', px - 1, L.y, 1, 8); R(c, '#0f1630', px, L.y, 6, 8); R(c, col, px, L.y, 6, 1);
      if (crew.length) for (let i = 0; i < 3; i++) R(c, col, px + 1, L.y + 2 + i * 2, 1 + (f + i * 3) % 5, 1);
      else { R(c, '#4cf08a', px + 1, L.y + 4, 1, 1); R(c, '#4cf08a', px + 2, L.y + 5, 1, 1); R(c, '#4cf08a', px + 3, L.y + 3, 1, 2); R(c, '#4cf08a', px + 4, L.y + 2, 1, 1); }
    });
    if (crew[1]) { const col = agentCol(crew[1]); R(c, col, L.x, L.y + 7, 14, 1); } // a second agent at the desk tints the status bar
  }
  // Awake right screen: progress toward the goal: one pip per goal bug (the engine's GOAL), a goal bar and a crit lamp.
  function chart(c, k, Rt) {
    R(c, '#ffb07a', Rt.x, Rt.y, 14, 8);
    const G = window.Stage2Engine?.GOAL?.bugs || 5, n = Math.min(G, bugsOf(k)), pay = prog(k, 'pay', 1.6);
    const big = G <= 5, per = big ? G : 7, step = big ? 3 : 2, sz = big ? 2 : 1;
    for (let i = 0; i < G; i++) {
      const fresh = i === n - 1 && pay >= 0 && pay < 0.6 && k.anim && Math.floor(pay * 10) % 2 === 0;
      R(c, fresh ? '#ffffff' : i < n ? '#1f2a4a' : '#e8955f', Rt.x + (big ? 0 : 1) + (i % per) * step, Rt.y + 1 + Math.floor(i / per) * step, sz, sz);
    }
    R(c, critsOf(k) ? '#c4572b' : '#e8955f', Rt.x + 11, Rt.y + 6, 2, 1);
    R(c, '#1f2a4a', Rt.x + 1, Rt.y + 6, Math.min(9, 1 + Math.round(8 * n / G)), 1); // goal bar
  }
  // Cash as a coin stack on the desk's left end (0-4 coins by cash), fed by a coin that arcs from the screen on pay.
  const CASH = [1, 400, 1500, 6000];
  function coins(c, k, t) {
    const cash = cashOf(k); let n = 0; for (let i = 0; i < CASH.length; i++) if (cash >= CASH[i]) n++;
    const pay = prog(k, 'pay', 1.6), s = pay * 1.6, land = pay >= 0 && s >= 0.75 && s < 1.05;
    const bob = land && k.anim ? Math.round(Math.sin((s - 0.75) / 0.3 * Math.PI) * -1) : 0; // overshoot on landing
    for (let i = 0; i < n; i++) { R(c, '#a8862a', k.x + 1, k.y + 10 - i * 2 + (i === n - 1 ? bob : 0), 4, 2); R(c, '#e8c14a', k.x + 1, k.y + 10 - i * 2 + (i === n - 1 ? bob : 0), 4, 1); }
  }
  function paySparks(c, k, L) {
    const pay = prog(k, 'pay', 1.6); if (pay < 0 || !k.anim) return;
    const s = pay * 1.6, ev = lastEv(k, 'pay'), crit = ev && ev.data.crit;
    // The coin: leaves the screen at 0.15 s, peaks above the monitor, drops onto the stack at 0.75 s.
    if (s >= 0.15 && s < 0.75) {
      const p = (s - 0.15) / 0.6, cx = L.x + 6 + (k.x + 2 - (L.x + 6)) * p, cy = L.y + 2 - 14 * 4 * p * (1 - p) + (k.y + 6 - (L.y + 2)) * p * p;
      if (p > 0.55) R(c, '#a8862a', cx, cy - 2, 2, 2); // streak while it falls fast
      R(c, '#e8c14a', cx, cy, 2, 2); R(c, '#fff3c8', cx, cy, 1, 1);
    }
    // Crit: four sparks off the screen corners, 50 ms apart.
    if (crit) for (let i = 0; i < 4; i++) {
      const q = clamp((s - 0.1 - i * 0.05) / 0.5); if (q <= 0 || q >= 1) continue;
      const dx = i % 2 ? 1 : -1, dy = i < 2 ? -1 : 1, d = 2 + Math.round(5 * outCubic(q));
      R(c, q < 0.6 ? '#fff3c8' : '#e8c14a', L.x + (dx > 0 ? 13 : 0) + dx * d, L.y + (dy > 0 ? 7 : 0) + dy * d, 1, 1);
    }
  }

  // =====================================================================================================
  // B · Lamp & Jar: a cozy analog desk. A roach wanders, a desk lamp, a mug, a jar of caught bugs.
  // =====================================================================================================
  const B = {
    name: 'Lamp & Jar: a roach wanders until the lamp clicks on, pay drops a bug in the jar, agents pin sticky notes',
    draw(c, k) {
      const x = k.x, y = k.y, f = k.anim ? k.f : 0, crew = working(k);
      chair(c, k, 0, false); desk(c, k);
      // Monitors as in the original; the code screen types in an agent's colour while they work.
      bezel(c, k, x + 5); bezel(c, k, x + 27);
      R(c, '#fff3c8', x + 6, y - 6, 14, 8); R(c, '#ffb07a', x + 28, y - 6, 14, 8);
      const ink = crew.length ? agentCol(crew[0]) : '#1f2a4a';
      codeLines(c, k, x + 6, y - 6, 14, crew.length ? Math.floor(f / 2) : Math.floor(f / 12), crew.length ? '#9aa0ae' : '#1f2a4a', null);
      if (k.anim) R(c, ink, x + 7 + (crew.length ? (f * 2) % 10 : f % 10), y - 4, 3, 1);
      for (let i = 0; i < 3; i++) R(c, '#e8955f', x + 30, y - 4 + i * 2, 4 + ((i * 3) % 7), 1); // right screen: a report
      lamp(c, k, f);
      mug(c, k, f);
      keyboard(c, k, k.near || k.open || crew.length > 0, crew.length && !k.near ? agentCol(crew[0]) : null);
      notepad(c, k, f);
      jar(c, k, f);
      roach(c, k, f);
      notes(c, k, f);
      flyer(c, k);
    },
    busy(k) { return k.since('near') < 0.8 || k.since('pay') < 1.4 || k.since('agent-done') < 1; }
  };
  const lampOn = k => k.near || k.open || k.night || k.agents.length > 0;
  // Lamp on the desk's left end, its head over the left monitor. Turning on: the head dips (100 ms), the bulb
  // flickers twice (50 ms steps) and the pool of light settles with a small overshoot.
  function lamp(c, k, f) {
    const x = k.x, y = k.y, on = lampOn(k), p = k.near ? prog(k, 'near', 0.6) : -1, s = p * 0.6;
    const dip = p >= 0 && s < 0.1 ? 1 : 0;
    // Pool of light as solid wood tints (palette pixels, no alpha): 0 off, 1 flicker, 2 on, 3 overshoot.
    let lit = on, glow = on ? 2 : 0;
    if (p >= 0 && k.anim) {
      if (s < 0.1) lit = false; else if (s < 0.25) lit = Math.floor((s - 0.1) / 0.05) % 2 === 1; // flicker
      glow = !lit ? 0 : s < 0.25 ? 1 : s < 0.45 ? 3 : 2; // overshoot then settle
    }
    if (lit && glow) {
      R(c, '#6a4428', x + 2, y + 5, 20, 8); R(c, '#6a4428', x + 4, y + 4, 16, 10);
      if (glow > 1) R(c, glow === 3 ? '#8f6a3c' : '#7a5530', x + 7, y + 6, 10, 6);
    }
    R(c, '#2c2f3a', x + 1, y + 5, 5, 2); R(c, '#39445c', x + 3, y - 8 + dip, 1, 13 - dip); // base and arm
    R(c, '#39445c', x + 3, y - 9 + dip, 4, 1); // elbow
    R(c, '#c4572b', x + 5, y - 11 + dip, 4, 3); R(c, '#8a3516', x + 5, y - 9 + dip, 4, 1); // shade
    R(c, lit ? '#fff3c8' : '#5a5f6e', x + 6, y - 8 + dip, 2, 1); // bulb
  }
  // Mug between the monitors; steam curls up through the gap.
  function mug(c, k, f) {
    const x = k.x + 22, y = k.y + 2;
    R(c, '#f1e6c8', x, y, 4, 4); R(c, '#c4572b', x, y + 1, 4, 1); R(c, '#f1e6c8', x + 4, y + 1, 1, 2);
    if (!k.anim) return;
    for (let i = 0; i < 3; i++) { const h = (f + i * 4) % 12; if (h < 9) R(c, h < 3 ? '#cfd4de' : h < 6 ? '#9aa0ae' : '#5a5f6e', x + 1 + ((h >> 2) + i) % 2, y - 1 - h, 1, 1); }
  }
  // Notepad: while the window is open, a pen writes lines on it.
  function notepad(c, k, f) {
    const x = k.x + 34, y = k.y + 7;
    R(c, '#f1e6c8', x, y, 7, 5); R(c, '#c4572b', x, y, 7, 1);
    const n = k.open ? (k.anim ? Math.floor(f / 3) % 13 : 12) : 0;
    for (let i = 0; i < 3; i++) { const w = Math.max(0, Math.min(5, n - i * 4)); if (w) R(c, '#8a8a8a', x + 1, y + 2 + i, w, 1); }
    if (k.open) { const i = Math.min(2, Math.floor(n / 4)), w = Math.min(5, n - i * 4); R(c, '#1f2a4a', x + 1 + w, y - 1 + i, 1, 3); }
  }
  // Jar of caught bugs on the right end: one bug per 3 found (max 7); a critical is a gold one.
  function jar(c, k, f) {
    const x = k.x + 42, y = k.y - 2, pay = prog(k, 'pay', 1.4), s = pay * 1.4;
    let lid = 0; if (pay >= 0 && k.anim) { if (s > 0.35 && s < 0.6) lid = -2; else if (s >= 0.6 && s < 0.7) lid = 1; } // pops for the incoming bug, snaps shut
    const flash = pay >= 0 && s >= 0.6 && s < 0.9 && k.anim;
    R(c, flash ? '#fff3c8' : '#9fc4cf', x, y, 6, 9); R(c, '#3d4a5c', x + 1, y + 1, 4, 7); R(c, '#cfe3ea', x + 1, y + 1, 1, 6);
    R(c, '#8a5e3a', x - (lid < 0 ? 0 : 0), y - 1 + lid, 6, 2);
    const n = Math.min(7, Math.ceil(bugsOf(k) / 3)), crit = critsOf(k) > 0;
    for (let i = 0; i < n; i++) {
      const jx = x + 2 + ((i * 2 + (k.anim && (f + i * 3) % 10 < 2 ? 1 : 0)) % 3), jy = y + 7 - Math.floor(i / 2) * 1 - (i % 2);
      R(c, crit && i === 0 ? '#e8c14a' : '#e86a6a', jx, jy, 1, 1);
    }
  }
  // The flying bug on pay: wind-up squash on the screen (100 ms), arc into the jar with a streak, lid snaps shut.
  function flyer(c, k) {
    const pay = prog(k, 'pay', 1.4); if (pay < 0 || !k.anim) return;
    const s = pay * 1.4, ev = lastEv(k, 'pay'), col = ev && ev.data.crit ? '#e8c14a' : payCol(k) || '#e86a6a';
    const sx = k.x + 12, sy = k.y - 3, ex = k.x + 44, ey = k.y - 4;
    if (s < 0.1) { R(c, col, sx, sy + 1, 4, 1); return; } // squash
    if (s < 0.6) {
      const p = (s - 0.1) / 0.5, e = outCubic(p), bx = sx + (ex - sx) * e, by = sy + (ey - sy) * e - 8 * Math.sin(Math.PI * e);
      R(c, '#a85a5a', bx - 2, by + (p < 0.5 ? 1 : -1), 2, 1); // streak behind
      bugSprite(c, bx, by, col, Math.floor(s * 20) % 2 === 0);
    }
    if (ev && ev.data.crit) for (let i = 0; i < 4; i++) { // sparkles round the jar, 50 ms apart
      const q = clamp((s - 0.6 - i * 0.05) / 0.4); if (q <= 0 || q >= 1) continue;
      R(c, '#fff3c8', k.x + 44 + [-3, 7, -2, 6][i] + (i % 2 ? 1 : -1) * Math.round(2 * q), k.y + [-4, -3, 4, 3][i], 1, 1);
    }
  }
  // The loose roach: patrols the front edge of the desk. When the lamp clicks on it bolts behind the jar;
  // while the lamp stays on, it only peeks its antennae out now and then.
  function roach(c, k, f) {
    const y = k.y + 12, hideX = k.x + 41;
    if (!k.anim) { if (!lampOn(k)) bugSprite(c, k.x + 14, y, '#6b3b1f', true); return; }
    const pat = Math.floor(f / 2) % 48, walkX = k.x + 6 + tri(pat, 24) + (pat >= 24 ? 0 : 0); // back and forth
    const pause = f % 40 >= 32; // stops to wiggle its antennae
    if (!lampOn(k)) {
      const bx = pause ? k.x + 6 + tri(Math.floor((f - (f % 40) + 32) / 2) % 48, 24) : walkX;
      bugSprite(c, bx, y, '#6b3b1f', !pause && f % 2 === 0);
      R(c, '#1b1f2b', bx + (pat < 24 ? 3 : -1), y - 1 + (pause && f % 2 ? 1 : 0), 1, 1);
      return;
    }
    const p = k.near ? prog(k, 'near', 0.6) : -1;
    if (p >= 0 && p < 1) { // bolt: freeze 100 ms, then dash to cover with a streak
      const s = p * 0.6, from = walkX;
      if (s < 0.1) { bugSprite(c, from, y - 1, '#6b3b1f', false); return; }
      const q = outCubic(clamp((s - 0.1) / 0.3)), bx = from + (hideX - from) * q;
      if (q < 1) { R(c, '#4a2a16', bx - 3, y, 3, 1); bugSprite(c, bx, y, '#6b3b1f', Math.floor(s * 30) % 2 === 0); }
      return;
    }
    if (f % 48 < 6) { R(c, '#1b1f2b', hideX - 1, y - 1, 1, 1); R(c, '#1b1f2b', hideX - 2, y, 1, 1); } // peeking
  }
  // Agents' sticky notes in a column on the right monitor's right edge, above the jar (the speech bubbles sit over
  // the screens), one per agent heading here or working. Arriving: an outline
  // (reserved); at work: a filled note that drops in with overshoot and flutters; done: a check, then it peels off.
  function notes(c, k, f) {
    const st = prog(k, 'agent-start', 0.45);
    k.agents.slice(0, 3).forEach((a, i) => {
      const col = agentCol(a), nx = k.x + 43, ny = k.y - 7 - i * 4;
      if (a.status === 'walking') { if (!k.anim || f % 8 < 6) { R(c, col, nx, ny, 4, 1); R(c, col, nx, ny + 3, 4, 1); R(c, col, nx, ny, 1, 4); R(c, col, nx + 3, ny, 1, 4); } return; }
      const drop = st >= 0 ? Math.round(-5 * (1 - outBack(st))) : 0, lift = k.anim && (f + i * 3) % 10 < 2 ? 1 : 0;
      R(c, col, nx, ny + drop, 4, 4 - lift); R(c, '#1b1f2b', nx + 1, ny + drop + 1, 2, 1);
    });
    const dn = prog(k, 'agent-done', 1), e = lastEv(k, 'agent-done');
    if (dn >= 0 && e && !k.agents.some(a => a.id === e.data.who)) {
      const col = agentCol({ id: e.data.who }), nx = k.x + 43, s = dn;
      const fall = s < 0.4 ? 0 : Math.round(30 * (s - 0.4) * (s - 0.4)), ny = k.y - 7 - Math.min(2, k.agents.length) * 4 + fall;
      if (ny < k.y + 3) { R(c, col, nx + (s >= 0.4 ? 1 : 0), ny, 4, 4); R(c, '#1f5a36', nx + 1, ny + 2, 1, 1); R(c, '#1f5a36', nx + 2, ny + 1, 1, 1); }
    }
  }

  // =====================================================================================================
  // C · Bounty Sonar: an amber radar sweeps for bugs, a beacon, and a receipt printer for payouts.
  // =====================================================================================================
  const C = {
    name: 'Bounty Sonar: an amber radar sweeps for bugs, pay prints a receipt, agents are blips homing in',
    draw(c, k) {
      const x = k.x, y = k.y, f = k.anim ? k.f : 0, crew = working(k);
      chair(c, k, 0, false); desk(c, k);
      // Left: the cream screen as a hex dump scrolling past.
      bezel(c, k, x + 5); R(c, '#fff3c8', x + 6, y - 6, 14, 8);
      hexDump(c, k, f, x + 6, y - 6, crew);
      // Right: a taller monitor (rises 3 px more) holding the radar, with the beacon on top.
      bezel(c, k, x + 27, 3); radar(c, k, f, crew);
      beacon(c, k, f);
      keyboard(c, k, k.near || k.open || crew.length > 0, crew.length && !k.near ? agentCol(crew[0]) : null);
      printer(c, k, f);
    },
    busy(k) { const p = k.since('pay'), d = k.since('agent-done'); return p < 2 || (p > 3.5 && p < 4.6) || (d > 1.8 && d < 2.6) || k.since('near') < 0.6; }
  };
  // A hex dump: pairs of bytes per row, scrolling. While open, one row is highlighted (the suspicious bytes).
  function hexDump(c, k, f, sx, sy, crew) {
    const scroll = Math.floor(f / (crew.length ? 1 : 3)), col = crew.length ? '#5a5f6e' : '#1f2a4a';
    for (let i = 0; i < 4; i++) {
      const row = scroll + i;
      for (let j = 0; j < 4; j++) if ((row * 7 + j * 3) % 5 !== 0) R(c, col, sx + 1 + j * 3, sy + 1 + i * 2, 2, 1);
    }
    if (crew.length) R(c, agentCol(crew[0]), sx + 1 + (f % 4) * 3, sy + 7, 2, 1); // the agent's read head
    if (k.open && (!k.anim || f % 6 < 4)) { R(c, '#c4572b', sx, sy + 2, 1, 3); R(c, '#c4572b', sx + 13, sy + 2, 1, 3); R(c, '#c4572b', sx + 4, sy + 3, 5, 1); }
  }
  // Radar screen 14x11 at (x+28, y-9), centre (x+34, y-4), radius 5. 16 sweep steps per 2 s (8 fps).
  const BLIPS = [[0.7, 4], [2.4, 3], [4.0, 5], [5.3, 2]];
  const TAU = Math.PI * 2;
  function radar(c, k, f, crew) {
    const sx = k.x + 28, sy = k.y - 9, cx = k.x + 34, cy = k.y - 4, near = k.near || k.open;
    R(c, '#2a1608', sx, sy, 14, 11);
    R(c, '#4a2810', sx, cy, 14, 1); R(c, '#4a2810', cx, sy, 1, 11); // crosshair
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; R(c, '#3e220e', cx + Math.round(Math.cos(a) * 5), cy + Math.round(Math.sin(a) * 5), 1, 1); } // ring
    const step = k.anim ? (near ? f * 2 : f) : 2, ang = (step % 16) / 16 * TAU;
    // Sweep: the line and a fading trail one step behind.
    for (let rr = 1; rr <= 5; rr++) {
      const tb = ang - TAU / 16;
      R(c, '#7a3a14', cx + Math.round(Math.cos(tb) * rr), cy + Math.round(Math.sin(tb) * rr), 1, 1);
      R(c, '#ffb07a', cx + Math.round(Math.cos(ang) * rr), cy + Math.round(Math.sin(ang) * rr), 1, 1);
    }
    // Found bugs: blips (how many by S.bugs, up to 4) that flare as the sweep passes and fade after.
    const n = Math.min(BLIPS.length, Math.ceil(bugsOf(k) / 5));
    for (let i = 0; i < n; i++) {
      const b = BLIPS[i], d = ((ang - b[0]) % TAU + TAU) % TAU, bx = cx + Math.round(Math.cos(b[0]) * b[1]), by = cy + Math.round(Math.sin(b[0]) * b[1]);
      if (d < 0.5) plus(c, bx, by, '#fff3c8', '#ffb07a'); else R(c, d < 2 ? '#ffb07a' : '#7a3a14', bx, by, 2, 1);
    }
    if (critsOf(k)) { // the critical: a 2x1 dot, a plus while the sweep passes it
      const ca = Math.atan2(-4, 4), d = ((ang - ca) % TAU + TAU) % TAU;
      if (d < 0.5 && k.anim) plus(c, cx + 4, cy - 3, '#ffffff', '#e86a6a'); else R(c, (k.anim ? f % 8 < 5 : true) ? '#e86a6a' : '#7a3a14', cx + 4, cy - 3, 2, 1);
    }
    // Open: lock-on brackets round the strongest blip.
    if (k.open && n) { const b = BLIPS[0], bx = cx + Math.round(Math.cos(b[0]) * b[1]), by = cy + Math.round(Math.sin(b[0]) * b[1]), on = !k.anim || f % 4 < 3;
      if (on) { R(c, '#fff3c8', bx - 2, by - 2, 2, 1); R(c, '#fff3c8', bx + 1, by - 2, 2, 1); R(c, '#fff3c8', bx - 2, by + 2, 2, 1); R(c, '#fff3c8', bx + 1, by + 2, 2, 1); } }
    // Agents: walking ones come in from the rim; working ones circle close to the centre.
    k.agents.forEach((a, i) => {
      const col = agentCol(a), base = i * 2.1;
      let rr, an;
      if (a.status === 'walking') { const e = lastWho(k, 'agent-arrive', a.id), s = e ? performance.now() / 1000 - e.at : 0; rr = 5 - Math.min(3, Math.floor((k.anim ? s : 0) * 1.2)); an = base + 0.6; }
      else { rr = 2; an = base + (k.anim ? f * 0.25 : 0); }
      R(c, col, cx + Math.round(Math.cos(an) * rr), cy + Math.round(Math.sin(an) * rr), 2, 1);
    });
    // Pings: expanding ring from the centre on near (amber), agent-start (agent colour) and pay (white).
    ping(c, k, cx, cy, sx, sy, 'near', '#ffb07a', null);
    const st = lastEv(k, 'agent-start'); ping(c, k, cx, cy, sx, sy, 'agent-start', st ? agentCol({ id: st.data.who }) : '#7cc4f0', null);
    ping(c, k, cx, cy, sx, sy, 'pay', '#fff3c8', null);
  }
  function plus(c, x, y, mid, arm) { R(c, arm, x - 1, y, 3, 1); R(c, arm, x, y - 1, 1, 3); R(c, mid, x, y, 1, 1); }
  function lastWho(k, kind, who) { for (let i = k.events.length - 1; i >= 0; i--) { const e = k.events[i]; if (e.kind === kind && e.data.who === who) return e; } return null; }
  function ping(c, k, cx, cy, sx, sy, kind, col) {
    const p = prog(k, kind, 0.6); if (p < 0 || p >= 1 || !k.anim) return;
    const rad = 1 + Math.round(6 * outCubic(p));
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU, px = cx + Math.round(Math.cos(a) * rad), py = cy + Math.round(Math.sin(a) * rad);
      if (px >= sx && px < sx + 14 && py >= sy && py < sy + 11) R(c, col, px, py, 1, 1);
    }
  }
  // Beacon on top of the radar monitor: idle a dull red glint; on pay it spins (alternating halves, rays out),
  // white-gold for a critical; on agent-done it flashes that agent's colour.
  function beacon(c, k, f) {
    const bx = k.x + 33, by = k.y - 13, pay = prog(k, 'pay', 2), dn = prog(k, 'agent-done', 0.8), ev = lastEv(k, 'pay');
    R(c, '#1d2233', bx - 1, by + 2, 6, 1);
    if (pay >= 0 && pay < 1 && k.anim) {
      const s = pay * 2, spin = Math.floor(s / 0.08) % 4, col = ev && ev.data.crit ? '#e8c14a' : payCol(k) || '#e86a6a';
      if (s < 0.1) { R(c, '#8b3a3a', bx, by + 1, 4, 1); return; } // wind-up: squashes before it spins
      R(c, '#8b3a3a', bx, by, 4, 2); R(c, col, bx + (spin < 2 ? 0 : 2), by, 2, 2);
      if (spin === 0) R(c, col, bx - 3, by, 2, 1); if (spin === 2) R(c, col, bx + 5, by, 2, 1);
      return;
    }
    if (dn >= 0 && dn < 1 && k.anim) { const e = lastEv(k, 'agent-done'); R(c, Math.floor(dn * 8) % 2 ? '#8b3a3a' : agentCol({ id: e && e.data.who }), bx, by, 4, 2); return; }
    R(c, '#8b3a3a', bx, by, 4, 2); if (k.anim && f % 16 === 0) R(c, '#e86a6a', bx + 1, by, 1, 1);
    if (k.near || k.open) R(c, '#e8955f', bx + 1, by, 2, 1);
  }
  // Receipt printer on the desk's right end, right of the radar monitor so the slip rises in the clear. Idle: a status LED. On pay a receipt feeds up (1 px steps, settles),
  // shows dollar marks (gold edge for a critical), then tears off and drops. Agent-done prints a short stub.
  function printer(c, k, f) {
    const x = k.x + 40, y = k.y + 8, pay = prog(k, 'pay', 4.5), ev = lastEv(k, 'pay'), dn = prog(k, 'agent-done', 2.5);
    let len = 0, tear = 0, col = '#ffffff', edge = null;
    if (pay >= 0 && pay < 1) {
      const s = pay * 4.5; len = Math.round(8 * outBack(clamp((s - 0.15) / 0.9)));
      if (s > 3.6) tear = Math.round((s - 3.6) * 16);
      edge = ev && ev.data.crit ? '#e8c14a' : payCol(k);
    } else if (dn >= 0 && dn < 1) {
      const s = dn * 2.5, e = lastEv(k, 'agent-done'); len = Math.round(5 * outBack(clamp(s / 0.6))); if (s > 1.9) tear = Math.round((s - 1.9) * 16);
      edge = agentCol({ id: e && e.data.who });
    }
    if (len > 0 && tear < 12) {
      const ry = y - len + tear, h = Math.max(1, len - (tear ? 0 : 0));
      R(c, col, x + 3, ry, 5, h);
      for (let i = 1; i < h - 1; i += 2) R(c, '#8a8a8a', x + 4, ry + i, (i * 3) % 3 + 2, 1);
      if (h > 4) { R(c, '#3b7a3a', x + 6, ry + 1, 1, 3); R(c, '#3b7a3a', x + 5, ry + 2, 3, 1); } // $
      if (edge) R(c, edge, x + 3, ry, 5, 1);
    }
    R(c, '#cfd4de', x + 1, y, 7, 5); R(c, '#9aa0ae', x + 1, y + 4, 7, 1); R(c, '#1b1f2b', x + 2, y, 5, 1);
    const busyLed = len > 0 && tear === 0;
    R(c, busyLed ? (k.anim && f % 2 ? '#ffb347' : '#6a4a20') : (!k.anim || f % 12 < 9 ? '#4cf08a' : '#1f5a36'), x + 5, y + 2, 2, 1);
  }

  FX.add('hunt', { a: A, b: B, c: C });
})();
