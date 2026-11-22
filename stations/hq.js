/* HQ (criticals): animated variants. See stations/fx.js for the contract.
   Every variant paints the original building first (k.base()), so the level read stays intact: lit first-floor
   windows = level, nameplate and awning from 2, third storey from 3, parapet/antenna from 5, glass crown 7, lit crown 8.
   The overlays only touch the lit windows, the ground floor (counters, door) and the sign, all inside the
   footprint plus the wall band above it (x..x+96, y-16..y+32).
     a  Lights On     the building is inhabited: people in the lit windows, receptionists, sliding doors.
     b  Ticker & Siren an LED ticker in the nameplate and a siren lamp over the door that sweeps light on a critical.
     c  Chain Lights  a festoon of bulbs over the entrance; two sparks meet and link, a critical sprays coins.
   Colours are the toned values world.js paints with (k.r does not tone), so the overlays match the base art. */
(function () {
  'use strict';
  const FX = window.StationFX; if (!FX) return;

  // ---- palette (toned) ----
  const SHELL = '#3e3f44', DARK = '#2b2d33', INK = '#24262b', GLASS = '#9fb3b0', IVORY = '#f3ecdc', IVORY2 = '#e2d8c4',
    LIT = '#ead79a', HOT = '#fff3c8', GOLD = '#e8c14a', CRIT = '#f2c230', AMBER = '#ffb347', RUST = '#c08a52', ROSE = '#c98b7a',
    WINE = '#8f6458', SAGE = '#8fbf8a', BROWN = '#7d5a40', WARM = '#efcf9c', WOOD = '#c49a6c', SKIN = ['#f1c9a0', '#d9a577', '#a8704a'],
    HAIR = ['#2b1b12', '#6b3b1f', '#1c1c24', '#a8452a'];

  // ---- helpers ----
  function P(c, col, x, y, w, h) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const outBack = p => { const q = p - 1; return 1 + 2.70158 * q * q * q + 1.70158 * q * q; };
  const outCubic = p => 1 - Math.pow(1 - p, 3);
  // Anticipation then settle: a small wind-up (negative) for the first 100 ms, then an overshooting move to 1.
  function swing(age, dur) {
    if (!(age >= 0)) return 0;
    if (age < 0.1) return -0.18 * Math.sin(Math.PI * age / 0.1 * 0.5);
    return outBack(clamp((age - 0.1) / dur, 0, 1));
  }
  const last = (k, kinds) => { for (let i = k.events.length - 1; i >= 0; i--) if (kinds.indexOf(k.events[i].kind) >= 0) return k.events[i]; return null; };
  function colorOf(a) {
    if (a && a.color) return a.color;
    const cast = window.Avatars && window.Avatars.CAST;
    return (a && cast && cast[a.id] && cast[a.id].body) || SAGE;
  }
  function hashId(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0); }
  // A door/transition tracker: remembers when a boolean target last flipped (world time), per variant.
  function tracker() {
    let on = false, at = -9;
    return (want, t) => { if (want !== on) { on = want; at = t; } return { on, age: t - at }; };
  }
  // 0..1 open amount for a door that eases open with a wind-up and closes with a settle.
  function doorAmount(st, anim) {
    if (!anim) return st.on ? 1 : 0;
    return st.on ? clamp(swing(st.age, 0.28), -0.18, 1.1) : 1 - clamp(outCubic(clamp(st.age / 0.22, 0, 1)), 0, 1);
  }
  function geo(k) { return { x: k.x, y: k.y, w: k.w, h: k.h, top: k.y - (k.T || 16), L: k.L | 0 }; }
  // Chains ready to connect (the HQ board's "!"), cached per frame.
  let readyF = -1, readyN = 0;
  function chainsReady(k) {
    if (readyF === k.f) return readyN;
    readyF = k.f; readyN = 0;
    const E = window.Stage2Engine, D = window.Stage2Data, s = window.Stage2 && window.Stage2.state && window.Stage2.state();
    if (!E || !D || !s || !s.found) return 0;
    try { const list = D.ALL_TARGETS || D.TARGETS || []; for (let i = 0; i < list.length; i++) if (E.chainState(s, list[i].id).ready) readyN++; } catch { readyN = 0; }
    return readyN;
  }

  // ---- the glass door (shared by a and c): two panels that slide apart over a warm lobby ----
  function door(c, g, o, glow) {
    const dx = g.x + 38, dy = g.y + 15, dw = 20, dh = g.h - 15;
    if (o > 0.02) {
      P(c, glow || WARM, dx, dy, dw, dh); P(c, HOT, dx + 6, dy, 8, 1);
      P(c, WOOD, dx, g.y + g.h - 3, dw, 3); P(c, RUST, dx, g.y + g.h - 3, dw, 1);
    }
    const s = Math.round(clamp(o, -0.2, 1.1) * 8); // panel travel
    const lw = clamp(9 - s, 0, 10), rw = lw; // visible width of each panel (clipped by the frame)
    if (lw > 0) { P(c, DARK, dx, dy, lw, dh); P(c, GLASS, dx + lw - 1, dy, 1, dh); }
    if (rw > 0) { P(c, DARK, dx + dw - rw, dy, rw, dh); P(c, GLASS, dx + dw - rw, dy, 1, dh); }
    if (s <= 0) P(c, GLASS, dx + 9, dy + 1, 2, dh - 2);
    P(c, IVORY, dx, g.y + 14, dw, 1);
  }

  // =========================================================================================
  // a · Lights On: the building is inhabited.
  // =========================================================================================
  const doorA = tracker();
  function drawA(c, k) {
    k.base();
    const g = geo(k), f = k.f, anim = k.anim, L = g.L;
    const ag = k.agents || [], walking = ag.some(a => a.status === 'walking'), workers = ag.filter(a => a.status === 'working');
    const pay = anim ? k.since('pay') : Infinity, open = anim ? Math.min(k.since('open'), k.since('float')) : Infinity;
    const start = anim ? k.since('agent-start') : Infinity, done = anim ? k.since('agent-done') : Infinity;

    // Which lit window an agent works in: its own, picked from its id among the lit ones.
    const lit = Math.min(L, 8), seat = {};
    workers.forEach(a => { if (lit) seat[hashId(a.id) % lit] = a; });

    for (let i = 0; i < lit; i++) {
      const wx = g.x + 4 + i * 12, wy = g.y + 4;
      // Window flash: a ripple left to right (50 ms apart) on open/float, gold on a critical.
      const fo = open - i * 0.05, fp = pay - 0.1 - i * 0.05;
      if (fp >= 0 && fp < 0.9) P(c, (fp * 8 | 0) % 2 ? CRIT : HOT, wx, wy, 8, 7);
      else if (fo >= 0 && fo < 0.25) P(c, HOT, wx, wy, 8, 7);
      // Hop on a critical: wind-up crouch, then up and settle (each window 50 ms after the last).
      let dy = 0;
      if (fp > -0.1 && fp < 0.9) dy = fp < 0 ? 1 : -Math.round(2 * Math.sin(Math.PI * clamp(fp / 0.5, 0, 1)));
      c.save(); c.beginPath(); c.rect(wx, wy, 8, 7); c.clip();
      const a = seat[i];
      if (a) occupantAgent(c, a, wx, wy + dy, f, anim, start, done);
      else occupant(c, i, wx, wy, dy, f, anim);
      c.restore();
      P(c, SHELL, wx + 3, wy, 1, 7); // mullion stays on top
    }

    // The dark floors (not built yet) stay dark: only a night guard's torch crosses them now and then.
    if (lit < 8 && anim) {
      const span = (8 - lit) * 12, cyc = 120, ph = f % cyc;
      if (ph < span) {
        const tx = g.x + 4 + lit * 12 + ph, wi = (tx - g.x - 4) % 12;
        if (wi >= 0 && wi < 8 && wi !== 3) { c.globalAlpha = 0.35; P(c, LIT, tx - 1, g.y + 6, 3, 3); c.globalAlpha = 1; P(c, HOT, tx, g.y + 7, 1, 1); }
      }
    }

    // Ground floor: two receptionists behind the counters.
    const greet = k.near || k.open;
    receptionist(c, g.x + 17, g.y + 17, 0, f, anim, greet, walking, pay);
    receptionist(c, g.x + 75, g.y + 17, 1, f, anim, greet, walking, pay);

    // Door: opens for the player, while the window is open, and for an agent on its way in.
    const st = doorA(!!(k.near || k.open || walking), k.t);
    door(c, g, doorAmount(st, anim));
    // Agent at work: a small badge lamp in its colour on the door frame.
    if (workers.length) workers.slice(0, 3).forEach((a, j) => P(c, colorOf(a), g.x + 40 + j * 3, g.y + 16, 2, 2));

    // Confetti from the windows on a critical: falls in front of the facade to the counters.
    if (pay < 2.2) confetti(c, g, pay - 0.15);
  }
  // Someone in a lit window: walks past, sits at a screen, or lowers the blind. Scenes rotate every 8 s.
  function occupant(c, i, wx, wy, dy, f, anim) {
    const seed = (i * 37 + 11) % 8, cyc = anim ? ((f + seed * 9) / 64 | 0) : 0, scene = (seed + cyc) % 4, ph = anim ? (f + seed * 9) % 64 : 20;
    const ink = BROWN, skin = SKIN[i % 3];
    if (scene === 0) { // walks across, 1 px a frame, with a two-frame step
      const px = wx - 4 + (ph % 32) * 0.5 | 0;
      if (ph < 32) { P(c, ink, px, wy + 3 + dy, 3, 4); P(c, skin, px + 1, wy + 1 + dy, 2, 2); P(c, ink, px + (ph % 2), wy + 6 + dy, 1, 1); }
    } else if (scene === 1) { // at a desk with a screen
      P(c, ink, wx + 4, wy + 3 + dy, 3, 4); P(c, skin, wx + 5, wy + 1 + dy, 2, 2);
      P(c, INK, wx, wy + 5, 3, 2); P(c, anim && (f + i) % 6 < 2 ? HOT : GLASS, wx, wy + 5, 2, 1);
    } else if (scene === 2) { // blind comes down, stays, goes back up
      const n = anim ? (ph < 8 ? ph : ph < 48 ? 7 : Math.max(0, 55 - ph)) : 4;
      for (let r = 0; r < n; r += 2) P(c, WOOD, wx, wy + r, 8, 1);
      if (n < 6) { P(c, ink, wx + 5, wy + 3 + dy, 2, 4); P(c, skin, wx + 5, wy + 1 + dy, 2, 2); }
    } else { // a plant and an empty chair
      P(c, '#6d8660', wx + 5, wy + 3, 2, 2); P(c, '#5f7458', wx + 4, wy + 4, 1, 1); P(c, RUST, wx + 5, wy + 5, 2, 2);
      if (anim && ph > 40 && ph < 52) { P(c, ink, wx + 1, wy + 3 + dy, 2, 4); P(c, skin, wx + 1, wy + 1 + dy, 2, 2); } // pops in for a coffee
    }
  }
  // An agent working in a window: its colour, typing at a screen that flickers; it waves when it finishes.
  function occupantAgent(c, a, wx, wy, f, anim, start, done) {
    const col = colorOf(a);
    if (start < 0.6) P(c, (start * 10 | 0) % 2 ? col : HOT, wx, wy, 8, 7); // a flash as it sits down
    P(c, col, wx + 4, wy + 3, 3, 4); P(c, col, wx + 4, wy + 1, 3, 2); P(c, INK, wx + 5, wy + 2, 1, 1);
    P(c, INK, wx, wy + 4, 3, 3); P(c, anim && f % 2 ? HOT : SAGE, wx, wy + 4, 2, 2);
    if (anim) P(c, col, wx + 3, wy + 5 - (f % 2), 1, 1); // typing hand
    if (done < 1.2 && anim) P(c, col, wx + 7, wy + ((done * 8 | 0) % 2 ? 1 : 2), 1, 2); // wave
  }
  // Receptionist: head and shoulders over the counter. Looks around, looks up and waves at the player.
  function receptionist(c, x, y, i, f, anim, greet, walking, pay) {
    const hop = pay > 0.1 && pay < 0.6 ? -1 : pay >= 0 && pay <= 0.1 ? 1 : 0;
    const yy = y + (greet ? -1 : 0) + hop;
    P(c, i ? '#6d8190' : RUST, x - 1, yy + 3, 5, 2);       // shoulders
    P(c, SKIN[i ? 2 : 0], x, yy, 3, 3); P(c, HAIR[i ? 2 : 1], x, yy - 1, 3, 1); // head, hair
    const look = !anim ? 1 : greet ? 1 : walking ? (i ? 0 : 2) : ((f + i * 23) / 24 | 0) % 3; // 0 left, 1 front, 2 right
    if (look === 1) { P(c, INK, x, yy + 1, 1, 1); P(c, INK, x + 2, yy + 1, 1, 1); } else P(c, INK, x + (look ? 2 : 0), yy + 1, 1, 1);
    if (pay > 0.1 && pay < 1.6) { const up = anim && (f + i) % 4 < 2 ? 0 : 1; P(c, SKIN[i ? 2 : 0], x - 2, yy - 2 + up, 1, 3); P(c, SKIN[i ? 2 : 0], x + 4, yy - 2 + up, 1, 3); } // arms up: a critical!
    else if (greet && i === 1) P(c, SKIN[2], x + 4, yy - 1 + (anim && f % 4 < 2 ? 0 : 1), 1, 3); // a wave
  }
  function confetti(c, g, age) {
    if (age < 0) return;
    const cols = [CRIT, RUST, IVORY, SAGE, ROSE];
    for (let i = 0; i < 16; i++) {
      const a = age - (i % 4) * 0.05; if (a < 0) continue;
      const x0 = g.x + 6 + ((i * 53) % 84), sway = Math.round(Math.sin(a * 6 + i) * 2);
      const y = g.y + 10 + Math.round(a * (14 + (i % 5) * 3));
      if (y > g.y + 29) continue;
      P(c, cols[i % 5], x0 + sway, y, (i + (a * 8 | 0)) % 2 ? 2 : 1, 1);
    }
  }

  // =========================================================================================
  // b · Ticker & Siren: an LED ticker in the nameplate and a siren lamp over the entrance.
  // =========================================================================================
  // 3x5 pixel font: five rows of 3 bits (4 = left, 2 = middle, 1 = right).
  const GLYPH = {
    A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3],
    H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5],
    O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7],
    V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
    0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [6, 1, 2, 4, 7], 3: [6, 1, 2, 1, 6], 4: [5, 5, 7, 1, 1], 5: [7, 4, 6, 1, 6], 6: [3, 4, 7, 5, 7],
    7: [7, 1, 2, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 6], $: [3, 6, 7, 3, 6], '+': [0, 2, 7, 2, 0], '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2],
    '·': [0, 0, 2, 0, 0], ':': [0, 2, 0, 2, 0], '!': [2, 2, 2, 0, 2], '?': [6, 1, 2, 0, 2], ' ': [0, 0, 0, 0, 0]
  };
  const colsCache = new Map();
  // A string as pixel columns (5-bit masks, bit 0 = top row), 4 px per character. Cached.
  function columns(text) {
    let v = colsCache.get(text); if (v) return v;
    v = [];
    for (const ch of text.toUpperCase()) {
      const g = GLYPH[ch] || GLYPH[' '];
      for (let col = 0; col < 3; col++) { let m = 0; for (let row = 0; row < 5; row++) if (g[row] & (4 >> col)) m |= 1 << row; v.push(m); }
      v.push(0);
    }
    if (colsCache.size > 64) colsCache.clear();
    colsCache.set(text, v); return v;
  }
  // Paints columns [from, from+w) of text at (x, y), clipped to the panel; dy shifts rows (clipped to 5).
  function text(c, cols, from, x, y, w, col, dy) {
    c.fillStyle = col;
    for (let i = 0; i < w; i++) {
      const m = cols[from + i]; if (!m) continue;
      for (let row = 0; row < 5; row++) if (m & (1 << row)) { const yy = row + (dy || 0); if (yy >= 0 && yy < 5) c.fillRect(x + i, y + yy, 1, 1); }
    }
  }
  const tickB = { msg: '', at: -9 };
  function drawB(c, k) {
    k.base();
    const g = geo(k), f = k.f, anim = k.anim, L = g.L, t = k.t;
    const ag = k.agents || [], walker = ag.find(a => a.status === 'walking'), worker = ag.find(a => a.status === 'working');
    const pay = anim ? k.since('pay') : Infinity, done = k.since('agent-done'), fl = k.since('float');
    const payEv = pay < 3 ? last(k, ['pay']) : null;
    const st2 = window.Stage2 && window.Stage2.state && window.Stage2.state(), name = String((st2 && st2.player) || 'founder').slice(0, 10);

    // What the ticker says, most urgent first. `steady` messages sit still and blink; others scroll.
    let msg, col = AMBER, steady = false;
    if (payEv) { msg = '+$' + Math.round(payEv.data.amount || 0); col = (f % 4 < 2) ? CRIT : ROSE; steady = true; }
    else if (fl < 2.5 && anim) { const e = last(k, ['float']); msg = String((e && e.data.text) || 'CRITICAL').slice(0, 12); col = ROSE; steady = true; }
    else if (worker) { msg = worker.name + ' CHAINING · ' + (worker.tool ? worker.tool.replace(/_/g, ' ') + ' · ' : ''); col = colorOf(worker); }
    else if (done < 2.5) { const e = last(k, ['agent-done']); const who = e && e.data.who, nm = who && window.Stage3Agents && window.Stage3Agents.get(who); msg = ((nm && nm.name) || who || 'AGENT') + ' DONE'; col = SAGE; steady = true; }
    else if (walker) { msg = walker.name + ' INBOUND · '; col = colorOf(walker); }
    else if (k.open) { const n = chainsReady(k); msg = 'BOARD OPEN · ' + (n ? n + ' READY · ' : 'NO CHAIN READY · '); }
    else if (k.near) { msg = 'HI ' + name + ' · '; col = HOT; }
    else { const n = chainsReady(k); msg = 'GOAL BOARD · LV ' + L + ' · ' + (n ? 'CHAIN READY! · ' : ''); }
    // Panel: the nameplate from level 2 (same place, now an LED strip), the left counter's display before that.
    const big = L >= 2, px = big ? g.x + 33 : g.x + 5, py = big ? g.top + 9 : g.y + 23, pw = big ? 30 : 28, W = pw - 2, fits = m => m.length * 4 - 1 <= W;
    if (!anim) { // reduced motion: a still label, the message's first part (or first word) if it fits
      msg = msg.split(' · ')[0]; if (!fits(msg)) msg = msg.split(' ')[0]; while (msg.length > 1 && !fits(msg)) msg = msg.slice(0, -1); steady = true;
    }
    if (steady && !fits(msg)) steady = false;
    if (!steady && !/· $/.test(msg)) msg += ' · ';
    if (msg !== tickB.msg) { tickB.msg = msg; tickB.at = t; }
    P(c, IVORY, px, py, pw, 7); P(c, INK, px + 1, py + 1, pw - 2, 5);
    const cols = columns(msg), age = anim ? t - tickB.at : 9;
    // Change of message: 100 ms dark (wind-up), then the text drops in with a 1 px overshoot.
    if (age >= 0.1) {
      const dy = age < 0.4 ? Math.round([-4, -2, 1, 0][clamp((age - 0.1) / 0.075 | 0, 0, 3)]) : 0;
      if (steady) {
        const tw = Math.max(0, cols.length - 1), x0 = px + 1 + Math.max(0, (W - tw) >> 1);
        if (!(anim && payEv && f % 8 === 7)) text(c, cols, 0, x0, py + 1, Math.min(W, tw), col, dy);
      } else {
        // Scroll 1 px a frame (8 px/s), wrapping with the message repeated.
        const n = cols.length, off = (f % n);
        c.fillStyle = col;
        for (let i = 0; i < W; i++) { const m = cols[(off + i) % n]; if (!m) continue; for (let row = 0; row < 5; row++) if (m & (1 << row)) { const yy = row + dy; if (yy >= 0 && yy < 5) c.fillRect(px + 1 + i, py + 1 + yy, 1, 1); } }
      }
    }

    // Siren lamp over the entrance, in the gap between windows 4 and 5, sitting on the awning/door head.
    const sx = g.x + 48, sy = g.y + 9;
    const alarm = pay < 2.6 ? 'crit' : worker ? 'agent' : (k.open || walker) ? 'warm' : k.near ? 'hello' : 'idle';
    const lens = alarm === 'crit' ? ((t * 10 | 0) % 2 ? CRIT : ROSE) : alarm === 'agent' ? colorOf(worker) : alarm === 'warm' ? AMBER : alarm === 'hello' ? SAGE : WINE;
    P(c, INK, sx - 1, sy + 3, 6, 1); P(c, lens, sx, sy, 4, 3); P(c, INK, sx, sy, 4, 1);
    // The reflector turning inside the lens: a bright pixel crossing it (front half of the turn only).
    const spin = alarm === 'crit' ? (t * 24 | 0) : alarm === 'idle' ? (f >> 1) : f;
    const ph = spin % 8; if (anim && ph < 4) P(c, HOT, sx + ph, sy + 1, 1, 2); else if (!anim) P(c, HOT, sx + 1, sy + 1, 1, 2);
    // The beam: a band of light sweeping across the front while the siren is up (agent, window open, critical).
    if (anim && alarm !== 'idle' && alarm !== 'hello') {
      const speed = alarm === 'crit' ? 2.2 : 0.7, ang = (alarm === 'crit' ? t : f / 8) * speed * Math.PI * 2;
      const cx = Math.round(g.x + 49 + Math.sin(ang) * 46), front = Math.cos(ang) > -0.2;
      if (front) {
        c.globalAlpha = alarm === 'crit' ? 0.32 : 0.18; c.fillStyle = alarm === 'crit' ? CRIT : lens;
        const x0 = clamp(cx - 4, g.x + 2, g.x + g.w - 2), x1 = clamp(cx + 4, g.x + 2, g.x + g.w - 2);
        if (x1 > x0) c.fillRect(x0, g.y + 2, x1 - x0, g.h - 4);
        c.globalAlpha = 1;
      }
    }
    // A critical also strobes the building's edges, red and amber alternating, with a wind-up blink.
    if (pay < 2.2) {
      const on = pay < 0.1 ? false : ((pay - 0.1) * 8 | 0) % 2 === 0, e = on ? CRIT : ROSE;
      if (pay >= 0.1) { P(c, e, g.x, g.top + 1, 2, g.h + 14); P(c, e, g.x + g.w - 2, g.top + 1, 2, g.h + 14); }
    }
  }

  // =========================================================================================
  // c · Chain Lights: a festoon of bulbs over the entrance; sparks link, criticals spray coins.
  // =========================================================================================
  const NB = 16, bulbX = new Int16Array(NB), bulbY = new Int16Array(NB);
  let wireFor = -1;
  const wireY = new Int16Array(96);
  function layWire(g) { // two swags, anchored at the edges and over the door, sagging 3 px
    if (wireFor === g.x * 1000 + g.y) return; wireFor = g.x * 1000 + g.y;
    for (let i = 0; i < 92; i++) { const u = i < 46 ? i / 46 : (i - 46) / 46; wireY[i] = g.y + 12 + Math.round(3 * Math.sin(Math.PI * u)); }
    for (let b = 0; b < NB; b++) { const i = 2 + Math.round(b * 87 / (NB - 1)); bulbX[b] = g.x + 2 + i; bulbY[b] = wireY[Math.min(i + 1, 91)] + 1; }
  }
  const nearC = tracker();
  function drawC(c, k) {
    k.base();
    const g = geo(k), f = k.f, anim = k.anim, t = k.t;
    layWire(g);
    const ag = k.agents || [], walker = ag.find(a => a.status === 'walking'), worker = ag.find(a => a.status === 'working');
    const pay = anim ? k.since('pay') : Infinity, start = anim ? k.since('agent-start') : Infinity, done = anim ? k.since('agent-done') : Infinity;
    const fl = anim ? k.since('float') : Infinity, ws = nearC(!!(k.near || k.open), t);

    // Wire.
    c.fillStyle = INK; for (let i = 0; i < 92; i++) c.fillRect(g.x + 2 + i, wireY[i], 1, 1);
    P(c, INK, g.x + 2, g.y + 11, 1, 2); P(c, INK, g.x + 48, g.y + 11, 1, 2); P(c, INK, g.x + 93, g.y + 11, 1, 2); // hooks

    const de = done < 0.8 ? last(k, ['agent-done']) : null, doneCol = colorOf(de ? { id: de.data.who } : null);
    // Per bulb colour: base state, then sparks and events on top.
    const sparkCol = walker ? colorOf(walker) : HOT;
    const per = 56, ph = anim ? f % per : 0, run = ph < 28 ? ph >> 2 : -1; // sparks travel 7 bulbs in 3.5 s
    for (let b = 0; b < NB; b++) {
      const fromC = Math.abs(b - 7.5) - 0.5; // 0 at the centre pair, 7 at the ends
      let col = WINE, glow = false;
      // Near / window open: lights cascade on from the centre outwards, 50 ms apart; off again on leave.
      const cas = anim ? ws.age - fromC * 0.05 : 1;
      if (ws.on ? cas >= 0 : cas < 0) { col = LIT; glow = true; }
      if (ws.on && anim && cas >= 0 && cas < 0.12) col = HOT; // pop as each comes on
      if (k.open && anim && (b + f) % 3 === 0) col = HOT; // theatre chase while the board is open
      if (ws.on && !k.open && anim && ((f * 7 + b * 5) % 23) === 0) col = HOT; // twinkle
      // Idle sparks (or agent-coloured ones while an agent walks in): from both ends toward the door.
      if (anim && run >= 0 && (b === run || b === NB - 1 - run)) { col = sparkCol; glow = true; }
      if (anim && run >= 1 && (b === run - 1 || b === NB - run)) { col = walker ? sparkCol : LIT; }
      // An agent at work: the string fills in its colour from the ends, bulb by bulb, then starts over.
      if (worker) { const fill = anim ? (f % 24) / 3 | 0 : 8; if (7 - fromC < fill + 0.5) { col = colorOf(worker); glow = true; } }
      if (done < 0.8) col = ((done * 10 | 0) + b) % 2 ? doneCol : HOT;
      // Critical: 100 ms all dark (wind-up), then gold outward 50 ms apart, blinking.
      if (pay < 2.2) {
        const d = pay - 0.1 - fromC * 0.05;
        if (pay < 0.1) col = DARK; else if (d >= 0) { col = ((d * 8 | 0) % 2) ? CRIT : HOT; glow = true; }
      } else if (fl < 0.6) col = ((fl * 10 | 0) + b) % 2 ? ROSE : LIT;
      const bx = bulbX[b], by = bulbY[b];
      P(c, INK, bx, by, 2, 1); P(c, col, bx, by + 1, 2, 2);
      if (glow && col !== DARK) { c.globalAlpha = 0.25; P(c, col, bx - 1, by + 1, 4, 3); c.globalAlpha = 1; P(c, col, bx, by + 1, 2, 2); }
    }

    // The link: when the two sparks meet over the door, a chain icon lights on the door glass.
    const met = anim ? (ph >= 28 && ph < 40) : false, linkCol = worker ? colorOf(worker) : CRIT;
    const halfLink = !!worker && !(done < 0.8);
    if (met || halfLink || done < 0.8 || (pay >= 0.1 && pay < 2.2)) link(c, g.x + 42, g.y + 19, halfLink ? (f % 8 < 4 ? 1 : 2) : 2, done < 0.8 || pay < 2.2 ? HOT : linkCol, met && ph < 30);

    // Coins out of the door on a critical: a fountain that lands and bounces on the doorstep.
    if (pay < 2.2 && pay >= 0.1) coins(c, g, pay - 0.1, last(k, ['pay']));
  }
  // Two interlocking rings (7x4 each); `n` = how many are lit (1 = half a chain while an agent works on it).
  function link(c, x, y, n, col, pop) {
    const ring = (rx, on) => { const cc = on ? col : SHELL; P(c, cc, rx, y, 5, 1); P(c, cc, rx, y + 3, 5, 1); P(c, cc, rx, y + 1, 1, 2); P(c, cc, rx + 4, y + 1, 1, 2); };
    ring(x, true); ring(x + 3 + (pop ? 1 : 0), n >= 2);
    if (n >= 2) P(c, col, x + 3, y + 1, 2, 2);
  }
  function coins(c, g, age, ev) {
    const amt = ev && ev.data ? +ev.data.amount || 0 : 0, n = clamp(4 + Math.round(amt / 150), 4, 10);
    const floor = g.y + g.h - 3, cx = g.x + 48;
    for (let i = 0; i < n; i++) {
      const a = age - i * 0.05; if (a < 0) continue; // 50 ms apart
      const vx = ((i % 2) ? 1 : -1) * (10 + (i * 7) % 22), vy = -(34 + (i * 11) % 18), G = 90;
      // Flight, then bounces (each one shorter) on the step.
      let tt = a, y0 = g.y + 22, x = cx + vx * a, y = y0 + vy * tt + G * tt * tt / 2, bounce = 0, v = vy;
      const tland = (-vy + Math.sqrt(vy * vy + 2 * G * (floor - y0))) / G;
      if (a > tland) { let rem = a - tland, vb = (vy + G * tland) * 0.45; bounce = 1; y = floor - (vb * rem - G * rem * rem / 2); if (y > floor) { y = floor; bounce = 2; } x = cx + vx * tland + vx * 0.4 * Math.min(rem, vb * 2 / G); v = 0; }
      x = clamp(Math.round(x), g.x + 3, g.x + g.w - 5); y = Math.round(clamp(y, g.top + 2, floor));
      if (a > 1.7 + (i % 3) * 0.1) continue; // they get picked up
      const spinW = bounce === 2 ? 2 : ((a * 16 | 0) + i) % 3 === 0 ? 1 : 2;
      if (a < 0.25 && v < 0) { c.globalAlpha = 0.35; P(c, CRIT, x, y + 2, spinW, 2); c.globalAlpha = 1; } // streak while fast
      P(c, CRIT, x, y, spinW, 2); P(c, HOT, x, y, 1, 1); if (spinW === 2) P(c, GOLD, x + 1, y + 1, 1, 1);
    }
  }

  function busyEvt(k) { return k.since('pay') < 2.6 || k.since('agent-done') < 1.2 || k.since('agent-start') < 0.8; }
  FX.add('hq', {
    a: { name: 'Lights On: people in the windows, receptionists, sliding doors', draw: drawA, busy: k => busyEvt(k) || k.since('near') < 0.5 || k.since('leave') < 0.5 },
    b: { name: 'Ticker & Siren: LED ticker in the nameplate, siren lamp sweeps on a critical', draw: drawB, busy: k => k.since('pay') < 2.7 },
    c: { name: 'Chain Lights: festoon over the door, sparks link, criticals spray coins', draw: drawC, busy: busyEvt }
  });
})();
