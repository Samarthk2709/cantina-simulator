/* Ledger Vault: animated variants. See stations/fx.js for the contract.
   a Tumbler Lock: the dial idles and spins open for you, the door swings to show gold bars (one per $800 held).
   b Ticker Ledger: an adding-machine head on the safe reads your reputation on a rolling counter and prints a tape.
   c Sentry Vault: a camera pans and scans, tripwire lasers guard the base, payments ride a pneumatic tube in.
   The original identity stays: safe body, door, dial and handle, bottom lamp; beacon from level 4 (on the roof, where
   the level plate doesn't cover it), gold trim from level 7. world.js still draws the fill gauge and level plate on top.
   Contract gaps, worked around here:
   - Money never lands at the vault (pay events fire at the desk or Ops), so StationFX.emit is wrapped once to mirror
     every pay elsewhere into a 'deposit' event here ({ ...pay, from }). who says whether you or an agent earned it.
   - Stage 3 agents never walk to the vault today, so agent reactions use k.agents and agent-* events when present
     (StationFX.emit('stats', 'agent-start', { who: 'pip' })) and agents' deposits. The roster has no colours: AG below.
   - Windows have no close event, so open/close and near/leave edges are timed here (edge()). */
(function () {
  'use strict';
  const SF = window.StationFX; if (!SF) return;
  if (!SF.vaultTap) {
    const emit0 = SF.emit;
    SF.emit = function (id, kind, data) { emit0(id, kind, data); if (kind === 'pay' && id !== 'stats') emit0('stats', 'deposit', Object.assign({ from: id }, data || {})); };
    SF.vaultTap = true;
  }

  const now = () => performance.now() / 1000;
  const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const out3 = p => 1 - (1 - p) * (1 - p) * (1 - p);
  const back = p => { p -= 1; return 1 + p * p * (2.7 * p + 1.7); }; // overshoot, then settle
  const AG = { nib: '#f1e6c8', pip: '#6fd6a6', moss: '#e86a6a', rook: '#7cc4f0', wren: '#c9b8ff' };
  const tint = (who, col) => col || AG[who] || '#7cc4f0';
  const GOLD = '#e8c14a', PALE = '#ffe28a', CREAM = '#f1e6c8', STEEL = '#9aa9ab', DARK = '#1b1f2b', DOOR = '#39445c', INK = '#0f1630', GREEN = '#4cf08a', RED = '#e86a6a';

  // Edge timer: seconds since `on` last changed (huge at start, so a page load doesn't animate).
  const edges = {};
  function edge(key, on) { let m = edges[key]; if (!m) m = edges[key] = { on: on, at: -1e9 }; if (m.on !== on) { m.on = on; m.at = now(); } return now() - m.at; }
  const edging = () => { const t = now(); for (const key in edges) if (t - edges[key].at < 1) return true; return false; };
  function lastEv(k, a, b) { for (let i = k.events.length - 1; i >= 0; i--) { const e = k.events[i]; if (e.kind === a || e.kind === b) return e; } return null; }
  function money(k) { const e = lastEv(k, 'pay', 'deposit'); return e && { e: e, age: now() - e.at, crit: !!e.data.crit, who: e.data.who || 'you', agent: !!e.data.who && e.data.who !== 'you' }; }
  // Agents here: k.agents, plus agent-* events (kept past the 6 s event log, dropped on agent-done or after 20 s).
  const crewMem = {};
  function crew(k) {
    const t = now(), list = [];
    for (const e of k.events) {
      if (e.kind.slice(0, 6) !== 'agent-') continue;
      const w = e.data.who || 'agent', m = crewMem[w];
      if (m && m.at >= e.at) continue;
      crewMem[w] = { st: e.kind === 'agent-done' ? 'done' : e.kind === 'agent-start' ? 'working' : 'walking', at: e.at, col: e.data.color };
    }
    for (const a of k.agents) list.push({ who: a.id, st: a.status, col: tint(a.id, a.color) });
    for (const w in crewMem) { const m = crewMem[w]; if (m.st !== 'done' && t - m.at < 20 && !list.some(a => a.who === w)) list.push({ who: w, st: m.st, col: tint(w, m.col) }); }
    return list;
  }
  const wallet = () => { const S = window.Stage2; return (S && (S.wallet?.() || S.state?.())) || { cash: 0, rep: 0 }; };

  // ---------- shared safe parts ----------
  // 6x6 dial, rows as [x0, w]; RIM: eight marker spots clockwise from the top.
  const DIAL = [[1, 4], [0, 6], [0, 6], [0, 6], [0, 6], [1, 4]];
  const RIM = [[3, 0], [4, 1], [5, 3], [4, 4], [2, 5], [1, 4], [0, 2], [1, 1]];
  function dial(c, k, X, Y, pos, mark, trail) {
    for (let i = 0; i < 6; i++) k.r(c, CREAM, X + DIAL[i][0], Y + i, DIAL[i][1], 1);
    k.r(c, DARK, X + 2, Y + 2, 2, 2);
    if (trail) { const q = RIM[(pos + 7) & 7], q2 = RIM[(pos + 6) & 7]; k.r(c, '#e8a05a', X + q[0], Y + q[1], 1, 1); k.r(c, '#f1c9a0', X + q2[0], Y + q2[1], 1, 1); }
    const p = RIM[pos & 7]; k.r(c, mark || '#c4572b', X + p[0], Y + p[1], 1, 1);
  }
  // Handle: 0 up, 1 turning, 2 across.
  function handle(c, k, X, Y, st) {
    if (st === 0) { k.r(c, STEEL, X, Y, 1, 6); k.r(c, '#cfd4de', X, Y, 1, 1); }
    else if (st === 1) { k.r(c, STEEL, X - 1, Y + 1, 1, 1); k.r(c, STEEL, X, Y + 2, 1, 2); k.r(c, STEEL, X + 1, Y + 4, 1, 1); }
    else { k.r(c, STEEL, X - 1, Y + 3, 3, 1); k.r(c, '#cfd4de', X - 1, Y + 3, 1, 1); }
  }
  function shell(c, k, ox) { k.r(c, DARK, k.x + 1 + ox, k.y + 1, 14, 30); }
  function beacon(c, k, ox) {
    if (k.L < 4) return;
    k.r(c, '#2e3547', k.x + 6 + ox, k.y, 4, 1);
    k.r(c, k.anim && k.f % 12 < 6 ? '#ffb347' : '#6a4a20', k.x + 7 + ox, k.y - 2, 2, 2);
  }
  function trim(c, k, ox, force) { if (k.L >= 7 || force) { k.r(c, GOLD, k.x + 2 + ox, k.y + 2, 12, 1); k.r(c, GOLD, k.x + 2 + ox, k.y + 14, 12, 1); } }
  function lamp(c, k, col) { k.r(c, col || (k.anim && k.f % 8 < 4 ? GREEN : '#1f5a36'), k.x + 6, k.y + k.h - 3, 4, 1); }
  // Small side panel beside the gauge (x+13..14): a screen pixel pair over two key pixels.
  function keypad(c, k, col) { k.r(c, INK, k.x + 13, k.y + 18, 2, 5); k.r(c, col || '#1d2742', k.x + 13, k.y + 19, 2, 1); k.r(c, DOOR, k.x + 13, k.y + 21, 1, 1); k.r(c, DOOR, k.x + 14, k.y + 21, 1, 1); }

  // 3x5 digits, rows top to bottom as 3-bit masks.
  const FONT = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1], [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];
  function digit(c, k, X, Y, d, col, top, bot) {
    const g = FONT[d];
    for (let i = 0; i < 5; i++) { const yy = Y + i; if (yy < top || yy > bot) continue; for (let j = 0; j < 3; j++) if (g[i] & (4 >> j)) k.r(c, col, X + j, yy, 1, 1); }
  }

  // ======================= A · Tumbler Lock =======================
  const IDLE_A = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 2, 1, 0, 7, 6, 6, 7, 0, 0];
  const A = {
    name: 'Tumbler Lock',
    busy: () => edging(),
    draw(c, k) {
      const { x, y, r, f, anim } = k, unlock = k.near || k.open;
      const ua = edge('a-unlock', unlock), oa = edge('a-open', k.open), mo = money(k), team = crew(k);
      const work = team.find(a => a.st === 'working'), walk = team.find(a => a.st === 'walking');
      const done = lastEv(k, 'agent-done'), doneAge = done ? now() - done.at : 9;
      // Lock state: dial position, handle, two bolts, lamp.
      let pos = 0, trail = false, hd = unlock ? 2 : 0, bolts = unlock ? 0 : 2, mark = null, lampCol = unlock ? GREEN : null;
      if (anim) {
        if (unlock && ua < 0.7) {
          if (ua < 0.1) pos = 7; // wind-up: a notch back
          else if (ua < 0.45) { pos = Math.floor((ua - 0.1) / 0.35 * 16); trail = true; }
          hd = ua < 0.45 ? 0 : ua < 0.55 ? 1 : 2; bolts = ua < 0.6 ? 2 : ua < 0.65 ? 1 : 0; lampCol = ua < 0.65 ? null : GREEN;
        } else if (!unlock && ua < 0.5) {
          hd = ua < 0.06 ? 1 : 0; bolts = ua < 0.1 ? 0 : ua < 0.15 ? 1 : 2;
          if (ua > 0.15 && ua < 0.45) { pos = (16 - Math.floor((ua - 0.15) / 0.3 * 16)) & 7; trail = true; }
        } else if (!unlock) pos = IDLE_A[f % IDLE_A.length];
        if (work && !unlock) { pos = f & 7; mark = work.col; hd = 1; }
      }
      // Door swing: waits for the unlock when both start together; slams shut fast.
      let door = 0;
      if (k.open) { const delay = Math.max(0.1, 0.7 - Math.max(0, ua - oa)); door = anim ? back(cl((oa - delay) / 0.35)) : 1; }
      else if (anim && oa < 0.25) door = 1 - out3(oa / 0.25);
      // Coins: anticipation hang, gravity drop into the roof slot, shudder on landing.
      let ox = 0;
      const coins = mo ? (mo.crit ? 3 : 1) : 0, land = 0.38;
      if (anim && mo && mo.age > land && mo.age < land + 0.08) ox = 1;

      shell(c, k, ox);
      const dw = Math.max(1, Math.min(12, 12 - Math.round(10 * door)));
      if (dw < 12) { // inside: shelves of gold bars, one per $800 held (1 to 6)
        r(c, INK, x + 2 + ox, y + 2, 12, 13); r(c, '#1d2742', x + 3 + ox, y + 3, 10, 11);
        r(c, '#6a4a20', x + 3 + ox, y + 10, 10, 1); r(c, '#6a4a20', x + 3 + ox, y + 14, 10, 1);
        const bars = Math.max(1, Math.min(6, Math.floor(wallet().cash / 800) + 1)), gl = anim ? (f >> 1) % 12 : -1;
        for (let i = 0; i < bars; i++) {
          const bx = x + 3 + (i % 3) * 4 + ox, by = y + (i < 3 ? 8 : 12);
          r(c, PALE, bx, by, 3, 1); r(c, GOLD, bx, by + 1, 3, 1);
          if (gl === i * 2) r(c, '#fff3c8', bx + 1, by, 1, 1);
        }
        if (k.night) r(c, '#3a2f22', x + 3 + ox, y + 3, 10, 1);
      }
      r(c, DOOR, x + 2 + ox, y + 2, dw, 13);
      if (dw < 12) r(c, '#cfd4de', x + 1 + dw + ox, y + 2, 1, 13); // the door's edge catches the light
      if (dw >= 10) { const s = 12 - dw; dial(c, k, x + 5 - s + ox, y + 8, pos, mark, trail); handle(c, k, x + 12 - s + ox, y + 8, hd); }
      if (dw === 12) { if (bolts >= 1) r(c, '#cfd4de', x + 14 + ox, y + 9, 1, 1); if (bolts >= 2) r(c, '#cfd4de', x + 14 + ox, y + 12, 1, 1); }
      const critFlash = anim && mo && mo.crit && mo.age > land && mo.age < land + 0.6 && ((mo.age * 10) | 0) % 2 === 0;
      trim(c, k, ox, critFlash);
      beacon(c, k, ox);
      // Keypad: agents badge in here. Walking: slow blink; working: steady; their deposits flash it.
      let kp = null;
      if (work) kp = work.col; else if (walk && anim && f % 8 < 4) kp = walk.col;
      if (mo && mo.agent && mo.age > land && mo.age < land + 0.5) kp = anim && ((mo.age * 12) | 0) % 2 ? '#fff3c8' : tint(mo.who);
      keypad(c, k, kp);
      if (done && doneAge < 0.75) lampCol = anim && ((doneAge * 8) | 0) % 2 ? null : tint(done.data.who);
      lamp(c, k, lampCol || (!anim ? GREEN : null));
      if (!anim || !mo) return;
      for (let i = 0; i < coins; i++) {
        const a = mo.age - i * 0.07; if (a < 0) continue;
        const cx = x + 6 + (i % 2) + ox;
        if (a < 0.1) { coin(c, k, cx, y - 12 - (a < 0.05 ? 1 : 0), mo); continue; }
        const p = (a - 0.1) / (land - 0.1);
        if (p < 1) { const cy = y - 12 + Math.round(12 * p * p); if (p > 0.5) r(c, '#b5842a', cx + 1, cy - 2, 1, 2); coin(c, k, cx, cy, mo); }
        else if (a < land + 0.12) r(c, PALE, x + 6 + ox, y + 1, 4, 1); // slot flash
      }
    }
  };
  function coin(c, k, X, Y, mo) { k.r(c, GOLD, X, Y, 3, 3); k.r(c, PALE, X, Y, 1, 1); if (mo.agent) k.r(c, tint(mo.who), X + 1, Y + 1, 1, 1); }

  // ======================= B · Ticker Ledger =======================
  const od = { from: 0, to: -1, t0: -9, dur: 0.6, seen: 0, near: false }; // odometer: rolls from → to
  const tape = [null, null, null, null], tp = { tick: -1, stamp: -1, print: 0, tear: -9, seenDone: 0, seenStart: 0 };
  function feed(col, len) { tape.shift(); tape.push(col ? { col: col, len: len } : null); }
  function odoShown(t) { const p = cl((t - od.t0 - 0.1) / od.dur); return od.from + (od.to - od.from) * out3(p); }
  const B = {
    name: 'Ticker Ledger',
    busy: () => edging() || now() - od.t0 < od.dur + 0.2 || now() - tp.tear < 0.5,
    draw(c, k) {
      const { x, y, r, f, anim } = k, t = now(), rep = Math.max(0, Math.round(wallet().rep || 0)) % 1000;
      const na = edge('b-near', k.near), oa = edge('b-open', k.open), mo = money(k), team = crew(k);
      const work = team.find(a => a.st === 'working'), walk = team.find(a => a.st === 'walking');
      // Odometer target: reputation (as the wallet shows it). Walking up reads it from zero; a payout with no
      // reputation change still turns the counter over once.
      if (od.to < 0) { od.to = od.from = rep; }
      if (anim && k.near && na < 0.05 && !od.near) { od.from = 0; od.to = rep; od.t0 = t; od.dur = 0.65; }
      od.near = k.near;
      if (rep !== od.to) { od.from = anim ? odoShown(t) : rep; od.to = rep; od.t0 = t; od.dur = 0.6; }
      if (mo && mo.e.at !== od.seen) {
        od.seen = mo.e.at;
        if (anim && t - od.t0 > od.dur + 0.1) { od.from = Math.max(0, rep - 10); od.to = rep; od.t0 = t; od.dur = 0.5; }
        feed(mo.agent ? tint(mo.who) : mo.crit ? GOLD : GREEN, 6); feed(null);
      }
      // Tape: idle feeds a grey line every 2.5 s; opening prints a burst; working agents stamp their colour.
      if (anim) {
        const tick = Math.floor(f / 20);
        if (tick !== tp.tick) { if (tp.tick >= 0) feed(tick % 2 ? null : '#8a8f99', 2 + (tick * 7) % 4); tp.tick = tick; }
        if (k.open && oa < 1 && t - tp.print > 0.12) { tp.print = t; feed((tp.print * 10 | 0) % 2 ? null : '#39445c', 2 + ((t * 13) | 0) % 4); }
        const st = Math.floor(f / 8);
        if (work && st !== tp.stamp) { tp.stamp = st; feed(work.col, 3); }
      }
      const start = lastEv(k, 'agent-start'); if (start && start.at !== tp.seenStart) { tp.seenStart = start.at; feed(tint(start.data.who), 6); feed(null); }
      const done = lastEv(k, 'agent-done'); if (done && done.at !== tp.seenDone) { tp.seenDone = done.at; tp.tear = t; }
      const tearA = t - tp.tear; if (tearA >= 0.4 && tearA < 9) { tape[0] = tape[1] = null; tp.tear = -9; }

      // Safe: the original front, the dial still.
      shell(c, k, 0); r(c, DOOR, x + 2, y + 2, 12, 13); dial(c, k, x + 5, y + 8, 0); handle(c, k, x + 12, y + 8, 0);
      trim(c, k, 0); keypad(c, k, work ? work.col : walk && anim && f % 8 < 4 ? walk.col : null); lamp(c, k, !anim ? GREEN : null);

      // Head: wakes with a dip and a hop when you walk up.
      let dy = 0;
      if (anim && k.near && na < 0.35) dy = na < 0.1 ? 1 : na < 0.22 ? -1 : 0;
      const hy = y - 11 + dy;
      r(c, '#2e3547', x, hy, 16, 11); r(c, DOOR, x, hy, 16, 1); r(c, DARK, x, hy + 10, 16, 1);
      r(c, INK, x + 4, hy, 8, 1); // tape slot
      r(c, INK, x + 2, hy + 2, 12, 7);
      // Digits roll like an odometer: each wheel turns as the one below it passes 9.
      const v = anim ? odoShown(t) : rep, rolling = anim && t - od.t0 < od.dur + 0.1, fast = rolling && Math.abs(od.to - od.from) >= 10;
      const lit = k.near || k.open || rolling || work ? PALE : '#e8a05a', nudge = anim && rolling && t - od.t0 < 0.1 ? -1 : 0;
      for (let i = 0; i < 3; i++) {
        const place = i === 0 ? 1 : i === 1 ? 10 : 100, vi = v / place, d = Math.floor(vi) % 10;
        const frac = i === 0 ? vi - Math.floor(vi) : Math.max(0, (v % place) - (place - 1));
        const off = Math.round(frac * 7) + nudge, X = x + 11 - i * 4, top = hy + 2, bot = hy + 8;
        const col = fast && i === 0 ? '#b5842a' : lit;
        digit(c, k, X, hy + 3 - off, d, col, top, bot);
        digit(c, k, X, hy + 10 - off, (d + 1) % 10, col, top, bot);
        if (fast && i === 0) r(c, '#6a4a20', X + 1, Math.max(top, hy + 2 - off), 1, 1); // streak
      }
      // Bell (top right): rings on a critical.
      const ring = anim && mo && mo.crit && mo.age < 0.7 ? (((mo.age * 16) | 0) % 2 ? 1 : -1) : 0;
      r(c, GOLD, x + 13 + ring, hy - 3, 1, 1); r(c, GOLD, x + 12 + ring, hy - 2, 3, 1); r(c, '#b5842a', x + 12, hy - 1, 3, 1);
      // Status lamp on the head: reading, an agent walking in, or idle.
      r(c, k.near || k.open ? GREEN : walk && (!anim || f % 8 < 4) ? walk.col : work ? work.col : '#1f5a36', x + 1, hy + 2, 1, 2);
      // Paper tape above the slot (4 rows, newest at the bottom), torn off when an agent finishes.
      for (let i = 0; i < 4; i++) {
        const ty = hy - 4 + i - (i < 2 && tearA < 0.4 ? Math.round(tearA * 8) : 0);
        r(c, i === 0 ? '#fff3c8' : CREAM, x + 5, ty, 6, 1);
        const ln = tape[i]; if (ln) r(c, ln.col, x + 5 + (ln.len >= 6 ? 0 : 1), ty, Math.min(6, ln.len), 1);
      }
      // Stamp arm: an agent at work stamps the tape once a second.
      if (work) { const down = anim && f % 8 < 2; r(c, STEEL, x + 3, hy - 5, 1, 4); r(c, work.col, x + 2, hy - (down ? 3 : 5), 3, 2); }
      beacon(c, k, 0);
    }
  };

  // ======================= C · Sentry Vault =======================
  const PAN = [0, 0, 0, -1, -1, -1, -1, -1, 0, 0, 0, 1, 1, 1, 1, 1]; // idle sweep, 3 frames a step
  const C = {
    name: 'Sentry Vault',
    busy: () => edging(),
    draw(c, k) {
      const { x, y, r, f, anim } = k, unlock = k.near || k.open;
      const na = edge('c-near', unlock), oa = edge('c-open', k.open), mo = money(k), team = crew(k);
      const work = team.find(a => a.st === 'working'), who = work || team.find(a => a.st === 'walking');
      const start = lastEv(k, 'agent-start'), sa = start ? now() - start.at : 9;
      const done = lastEv(k, 'agent-done'), da = done ? now() - done.at : 9;
      // Camera pan: idle sweep; you: a jerk away, then a snap to you with overshoot; an agent: held on them.
      let pan = anim ? PAN[((f / 3) | 0) % PAN.length] : 0, rec = anim && f % 8 < 4 ? RED : '#8b3a3a';
      if (unlock) { pan = !anim || na > 0.3 ? -1 : na < 0.1 ? 1 : -2; rec = GREEN; }
      else if (who) { pan = -1; rec = who.col; }
      // Lasers: two halves that retract into their posts, 50 ms apart; an agent clears the left half.
      const pull = (d) => !anim ? (unlock ? 1 : 0) : unlock ? cl((na - 0.15 - d) / 0.2) : 1 - cl((na - d) / 0.15);
      let lh = pull(0), rh = pull(0.05);
      if (who && !unlock) lh = 1;
      if (done && da < 0.4 && !unlock) lh = 1 - cl((da - 0.1) / 0.2);
      // Lock bar slides into the right housing, then the door cracks open with a warm gap.
      let bar = 0, gap = 0;
      if (k.open) { bar = anim ? cl((oa - 0.1) / 0.3) : 1; gap = anim ? back(cl((oa - 0.4) / 0.3)) : 1; if (anim && oa < 0.1) bar = -0.1; }
      else if (anim && oa < 0.2) { bar = 1 - cl(oa / 0.2); gap = 1 - cl(oa / 0.1); }

      shell(c, k, 0);
      const g = Math.max(0, Math.round(2 * gap)), dw = 12 - g;
      if (g) { r(c, PALE, x + 2 + dw, y + 2, g, 13); r(c, '#ffb347', x + 2 + dw, y + 8, 1, 7); }
      r(c, DOOR, x + 2, y + 2, dw, 13);
      dial(c, k, x + 5, y + 8, 0); handle(c, k, x + 12 - g, y + 8, k.open ? 2 : 0);
      // Scan line: idle every 8 s in red; an agent's badge scan in their colour, repeating while they work.
      let scan = -1, scol = RED;
      if (anim && !unlock) {
        if (start && sa < 1) { scan = Math.floor(sa * 10); scol = tint(start.data.who); }
        else if (work) { scan = f % 16 < 8 ? f % 16 : -1; scol = work.col; }
        else if (f % 64 < 8) scan = f % 64;
      }
      if (scan >= 0 && scan < 8) { r(c, scol, x + 2, y + 8 + scan, 12 - g, 1); if (scan > 0) r(c, '#8b3a3a', x + 2, y + 7 + scan, 12 - g, 1); }
      // Lock bar across the door foot.
      const bw = Math.max(0, Math.min(13, Math.round(12 * (1 - bar))));
      if (bw) { r(c, STEEL, x + 14 - bw, y + 15, bw, 1); r(c, '#cfd4de', x + 14 - bw, y + 15, 1, 1); }
      r(c, '#2e3547', x + 13, y + 15, 2, 2);
      trim(c, k, 0, anim && mo && mo.crit && mo.age > 0.35 && mo.age < 0.9 && ((mo.age * 10) | 0) % 2 === 0);
      // Pneumatic tube down the right edge: payments shoot down it into the intake.
      r(c, '#2e3547', x + 15, y - 2, 1, 21); r(c, STEEL, x + 14, y - 3, 2, 1); r(c, STEEL, x + 15, y + 6, 1, 1);
      let intake = who ? who.col : null;
      if (anim && mo && mo.age < 0.6) {
        const a = mo.age;
        if (a < 0.1) r(c, GOLD, x + 15, y - 5 + (a < 0.05 ? 0 : 1), 1, 3);
        else if (a < 0.3) { const cy = y - 4 + Math.round(22 * cl((a - 0.1) / 0.2)); r(c, '#b5842a', x + 15, cy - 3, 1, 3); r(c, mo.agent ? tint(mo.who) : GOLD, x + 15, cy, 1, 3); }
        else intake = ((a * 12) | 0) % 2 ? '#fff3c8' : mo.agent ? tint(mo.who) : GOLD;
      }
      keypad(c, k, intake);
      lamp(c, k, unlock || !anim ? GREEN : done && da < 0.6 && ((da * 8) | 0) % 2 === 0 ? tint(done.data.who) : null);
      // Tripwire posts and beams along the base.
      r(c, STEEL, x, y + 30, 1, 2); r(c, STEEL, x + 15, y + 30, 1, 2);
      const lw = Math.round(7 * (1 - lh)), rw = Math.round(7 * (1 - rh)), beam = k.night ? '#ff8a8a' : RED, hole = anim ? 1 + (f % 14) : -1;
      if (lw) r(c, beam, x + 1, y + 31, lw, 1);
      if (rw) r(c, beam, x + 15 - rw, y + 31, rw, 1);
      if (hole > 0 && lw + rw === 14) r(c, '#8b3a3a', x + hole, y + 31, 1, 1);
      // Camera on its mount (top right): body slides with the pan, lens on the side it faces.
      const bx = x + 9 + Math.max(-1, Math.min(1, pan)) + (pan === -2 ? -1 : 0), cy = y - 6;
      r(c, DOOR, x + 11, y - 3, 1, 4); r(c, STEEL, x + 10, y - 3, 3, 1);
      r(c, '#cfd4de', bx, cy, 5, 3); r(c, STEEL, bx, cy + 2, 5, 1);
      const lx = pan < 0 ? bx : pan > 0 ? bx + 4 : bx + 2;
      r(c, k.night ? RED : INK, lx, pan === 0 ? cy + 2 : cy + 1, 1, 1);
      r(c, mo && mo.crit && anim && mo.age < 1 ? (((mo.age * 10) | 0) % 2 ? GOLD : RED) : rec, bx + 4 - (pan > 0 ? 4 : 0), cy - 1, 1, 1);
      // Flash: a photo of each badge and each critical.
      const flash = anim && ((start && sa < 0.12) || (mo && mo.crit && mo.age > 0.3 && mo.age < 0.42));
      if (flash) { r(c, '#fff3c8', lx - 1, cy + 1, 3, 1); r(c, '#fff3c8', lx, cy, 1, 3); }
      beacon(c, k, -3);
    }
  };

  SF.add('stats', { a: A, b: B, c: C });
})();
