/* Tool shelf (Agent Forge): animated variants. See stations/fx.js for the contract.
   Footprint is 2x1 tiles (32x16 office px); art may rise one tile above it. Every variant keeps the six level
   lamps (lit = k.L, 1-6) and keeps the second bay dark until level 2, as the original art does.
   a  Gantry welder   - a carriage on an overhead rail welds at the bays; tools drop onto a conveyor.
   b  Spin-up pods    - two glass vats where dormant agents float; working agents are printed line by line.
   c  Smithy          - a brick furnace and a trip-hammer anvil; tools are hammered out with sparks.
   Motion: idle keys off k.f (8 fps); event motion uses k.since() (seconds) with a ~100 ms wind-up, 50 ms
   stagger and overshoot. Under reduced motion (k.anim false) every variant draws a still frame of its state. */
(function () {
  'use strict';
  const FX = window.StationFX; if (!FX) return;

  // ---------- shared ----------
  const LIT = '#4cf08a', DARK = '#1d2742', HOT = '#fff3c8', AMBER = '#ffb347', GOLD = '#ffe28a';
  const AG = ['#7cc4f0', '#ffb07a', '#c9b8ff', '#9ff0c8', '#ffe28a'];
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const outBack = p => { const s = 1.70158; p -= 1; return 1 + (s + 1) * p * p * p + s * p * p; };
  const outCubic = p => 1 - (1 - p) * (1 - p) * (1 - p);
  const inQuad = p => p * p;
  const lerp = (a, b, p) => a + (b - a) * p;
  const R = Math.round;
  // Seconds since an event; Infinity under reduced motion so no event animation is ever mid-way.
  const age = (k, kind) => k.anim ? k.since(kind) : Infinity;
  function agentCol(a) {
    if (!a) return LIT;
    if (typeof a.color === 'string') return a.color;
    if (a.color && a.color.glow) return a.color.glow;
    const cast = window.Avatars?.CAST?.[a.id]; if (cast && cast.body) return cast.body;
    let h = 0; const s = String(a.id || a.name || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return AG[Math.abs(h) % AG.length];
  }
  // Colour of an agent known only by id (agent-done events carry { who }).
  const colOf = id => agentCol({ id, color: window.Stage3Agents?.roster?.[id]?.color || null });
  function lastDone(k) { const e = k.events || []; for (let i = e.length - 1; i >= 0; i--) if (e[i].kind === 'agent-done') return (e[i].data || {}).who; return null; }
  function crew(k) {
    let work = null, work2 = null, walk = null;
    const list = k.agents || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.status === 'working') { if (!work) work = a; else if (!work2) work2 = a; } else if (!walk) walk = a;
    }
    return { work, work2, walk };
  }
  function lastPay(k) { const e = k.events || []; for (let i = e.length - 1; i >= 0; i--) if (e[i].kind === 'pay') return e[i].data || {}; return {}; }
  // The six level lamps. A chase runs across them (50 ms apart) after near, open, pay or a finished agent job.
  function lampAt(k, i) {
    const lit = i < k.L;
    const a = Math.min(age(k, 'pay'), age(k, 'open'), age(k, 'near'), age(k, 'agent-done')) - i * 0.05;
    if (a >= 0 && a < 0.18) return lit ? HOT : '#39445c';
    return lit ? LIT : DARK;
  }
  // Spark directions: an upward fan, varied speeds (office px/s). Fixed table, no per-frame allocation.
  const SPARK = [];
  for (let i = 0; i < 20; i++) {
    const a = -Math.PI * (0.08 + 0.84 * ((i * 7) % 20) / 19), v = 26 + ((i * 13) % 11) * 3;
    SPARK.push([Math.cos(a) * v, Math.sin(a) * v]);
  }
  // A burst from (x, y), t seconds old; n sparks; brief streak on the fastest first frames.
  function sparks(k, c, x, y, t, n, colA, colB, life) {
    if (t < 0 || t > life) return;
    for (let i = 0; i < n; i++) {
      const s = SPARK[i % 20], tt = t * (0.8 + (i % 3) * 0.15);
      const px = R(x + s[0] * tt), py = R(y + s[1] * tt + 70 * tt * tt);
      if (py > y + 6) continue;
      const col = i % 3 === 0 ? colB : colA;
      if (t < 0.12) k.r(c, col, px - (s[0] > 0 ? 1 : 0), py, 2, 1); else k.r(c, col, px, py, 1, 1);
    }
  }
  // Small cheap pseudo-random 0..n-1 keyed by frame and slot.
  const pr = (f, i, n) => ((f * 73 + i * 151 + ((f * i) >> 1)) % n + n) % n;

  // The world draws a level plate over every facility (rows y+1..y+3, centre 17 px). Each variant gives it a dark
  // fascia to sit on and keeps its moving parts above the cabinet top, so the plate never hides them.
  function cabinet(k, c, x, y) { k.r(c, '#1b1f2b', x + 1, y, 30, 15); k.r(c, '#2e3547', x + 1, y, 30, 1); k.r(c, '#11141c', x + 6, y + 1, 20, 3); }

  // ---------- A: Gantry welder ----------
  // Idle path of the carriage over 64 frames: weld bay 1, glide, weld bay 2, glide back, rest.
  function gantryIdle(f, L) {
    const p = f % 64, S1 = 9, S2 = L >= 2 ? 23 : 16;
    if (p < 8) return { x: S1, len: 7, weld: true };
    if (p < 10) return { x: S1, len: p === 8 ? 5 : 4, weld: false };
    if (p < 22) return { x: lerp(S1, S2, outCubic((p - 10) / 11)), len: 3, weld: false };
    if (p < 24) return { x: S2, len: p === 22 ? 4 : 6, weld: false };
    if (p < 32) return { x: S2, len: 7, weld: L >= 2 };
    if (p < 34) return { x: S2, len: p === 32 ? 5 : 4, weld: false };
    if (p < 46) return { x: lerp(S2, S1, outCubic((p - 34) / 11)), len: 3, weld: false };
    return { x: S1, len: p < 48 ? 5 : 3, weld: false };
  }
  const gantry = {
    name: 'Gantry welder',
    busy: k => k.since('pay') < 1.6 || k.since('agent-done') < 1.2 || k.since('near') < 0.5 || k.since('leave') < 0.5,
    draw(c, k) {
      const { x, y, L } = k, f = k.anim ? k.f : 0, r = k.r, cr = crew(k);
      // Frame: posts and the overhead rail (rises one tile above the footprint).
      r(c, '#39445c', x + 1, y - 12, 2, 13); r(c, '#39445c', x + 29, y - 12, 2, 13);
      r(c, '#2e3547', x + 1, y - 14, 30, 2); r(c, '#9aa9ab', x + 1, y - 14, 30, 1);
      // Beacons on the post tops: alternate amber when an agent is on the way, blink together while the founder
      // stands here, green while the window is open (and briefly after it closes), white-hot on pay.
      const pay = age(k, 'pay'), linger = !k.open && age(k, 'open') < 2.5;
      let bA = '#1b1f2b', bB = bA;
      if (pay < 0.6) bA = bB = f % 2 ? GOLD : HOT;
      else if (k.near) bA = bB = f % 4 < 2 ? AMBER : HOT;
      else if (cr.walk) { bA = f % 4 < 2 ? AMBER : '#6a4a20'; bB = f % 4 < 2 ? '#6a4a20' : AMBER; }
      else if (k.open || linger) bA = bB = LIT;
      r(c, bA, x + 1, y - 16, 2, 2); r(c, bB, x + 29, y - 16, 2, 2);
      // Conveyor on the cabinet top; it runs faster while the founder is here, the window is open or an agent works,
      // and its rollers light up while the founder is here.
      cabinet(k, c, x, y);
      const hot = k.near || k.open || !!cr.work || pay < 1.6;
      r(c, '#11141c', x + 1, y - 2, 30, 2); r(c, hot ? '#6fd6a6' : '#39445c', x + 1, y - 2, 30, 1);
      const belt = hot ? f : f >> 1;
      for (let i = 0; i < 8; i++) r(c, hot && i % 2 ? '#4a6a5a' : '#2e3547', x + 2 + ((i * 4 + belt) % 28), y - 1, 2, 1);
      // Lamp strip and two bays: bay 1 always runs; bay 2 wakes at level 2. A working agent fills a bay with its colour.
      r(c, '#2e3547', x + 2, y + 5, 28, 4);
      for (let i = 0; i < 6; i++) r(c, lampAt(k, i), x + 4 + i * 4, y + 6, 2, 2);
      const prog = k.anim ? (f % 16) / 15 : 0.6;
      // The first working agent takes the right bay (the left half sits under the agent's own sprite and bubble).
      for (let b = 0; b < 2; b++) {
        const bx = x + 4 + b * 14, on = b === 0 || L >= 2, ag = b === 1 ? cr.work : cr.work2;
        r(c, '#0f1630', bx, y + 10, 10, 4);
        if (ag) { r(c, '#1d2742', bx + 1, y + 11, 8, 2); r(c, agentCol(ag), bx + 1, y + 11, Math.max(1, R(8 * prog)), 2); }
        else if ((k.open || k.near) && on) { for (let j = 0; j < 3; j++) r(c, j === (f >> 1) % 3 ? HOT : '#6fd6a6', bx + 1 + j * 3, y + 11, 2, 2); }
        else r(c, !on ? '#6a4a20' : b === 0 ? (f % 12 < 6 ? '#b09ae0' : '#6fd6a6') : '#f2c230', bx + 1, y + 11 + (b && on && k.anim ? f % 2 : 0), 8, b === 0 ? 2 : 1);
      }
      // Carriage position: idle path, pulled to the right bay while the founder stands here (the prompt and name tag
      // cover the left and centre), or to a working agent's bay (first agent right, second left).
      const idle = gantryIdle(f, L), PARK = 24;
      let cx = idle.x, len = idle.len, weld = idle.weld, eye = '#6a4a20';
      if (cr.work) { cx = cr.work2 && f % 32 >= 16 ? 9 : 23; len = 7; weld = true; }
      const nearIn = k.near ? (k.anim ? clamp(age(k, 'near') / 0.4) : 1) : 0;
      const nearOut = !k.near && k.anim ? 1 - clamp(age(k, 'leave') / 0.4) : 0;
      if (!cr.work && (k.near || nearOut > 0)) {
        const w = k.near ? outBack(nearIn) : nearOut;
        cx = lerp(cx, PARK, w); len = lerp(len, 5, clamp(w));
        if (k.near) { weld = false; eye = f % 8 < 6 ? AMBER : HOT; }
        if (k.near && age(k, 'near') < 0.1) len = 1; // wind-up: the arm flinches up before it swings over
      }
      // Pay: wind-up (arm lifts), slam with a streak, spark burst and a crate dropped onto the belt.
      let crateX = null, crateY = 0, streak = 0;
      const crit = !!lastPay(k).crit;
      if (pay < 1.6) {
        if (!cr.work) cx = lerp(cx, PARK, outCubic(clamp(pay / 0.1)));
        if (pay < 0.1) len = 1;
        else if (pay < 0.18) { len = lerp(1, 7, inQuad((pay - 0.1) / 0.08)); streak = 1; }
        else { len = lerp(7, 3, clamp((pay - 0.3) / 0.5)); eye = HOT; }
        if (pay >= 0.18) {
          const d = pay - 0.18, sx = R(x + cx) - 2;
          crateY = R(lerp(y - 8, y - 5, outBack(clamp(d / 0.25))));
          crateX = d < 0.8 ? sx : R(sx + (d - 0.8) * 10);
        }
      }
      cx = R(x + cx); len = Math.max(1, Math.min(7, R(len)));
      // The part an agent is building sits under the torch and grows with its progress.
      if (cr.work) { const w = 1 + R(4 * prog), col = agentCol(cr.work); r(c, '#39445c', cx - 3, y - 4, 6, 2); r(c, col, cx - 3, y - 4, w + 1, 2); r(c, HOT, cx - 3 + w, y - 4, 1, 1); }
      if (crateX !== null && crateX < x + 27) { r(c, crit ? '#e8c14a' : '#8a5e3a', crateX, crateY, 5, 3); r(c, crit ? GOLD : '#e8c14a', crateX + 1, crateY, 3, 1); r(c, '#5a3a22', crateX, crateY + 2, 5, 1); }
      // Carriage, telescoping arm, torch head.
      r(c, '#c4572b', cx - 3, y - 15, 7, 4); r(c, '#8a3516', cx - 3, y - 12, 7, 1); r(c, '#f1e6c8', cx - 2, y - 14, 1, 1);
      if (streak) r(c, 'rgba(207,212,222,.4)', cx - 2, y - 11, 5, len);
      r(c, '#9aa9ab', cx - 1, y - 11, 2, len); r(c, '#cfd4de', cx - 2, y - 11 + len, 5, 2);
      const tipY = y - 9 + len, flt = age(k, 'float');
      r(c, flt < 0.3 ? HOT : weld && f % 2 === 0 ? HOT : eye, cx, tipY, 1, 1);
      // Weld sparks: a few pixels hopping around the tip; agent colour while an agent works.
      if (weld && k.anim) {
        const col = cr.work ? agentCol(cr.work) : GOLD;
        for (let i = 0; i < (cr.work ? 4 : 2); i++) r(c, i % 2 ? col : AMBER, cx - 3 + pr(f, i, 7), tipY - pr(f, i + 3, 3), 1, 1);
      }
      if (pay >= 0.18) sparks(k, c, cx, tipY, pay - 0.18, crit ? 18 : 10, crit ? GOLD : AMBER, HOT, 0.7);
      // A finished agent job: a wrench pops off the belt with overshoot and glints.
      const done = age(k, 'agent-done');
      if (done < 1.2) {
        const p = outBack(clamp(done / 0.35)), ty = R(y - 3 - 7 * p);
        r(c, '#cfd4de', x + 22, ty, 5, 1); r(c, '#cfd4de', x + 21, ty - 1, 1, 1); r(c, '#cfd4de', x + 21, ty + 1, 1, 1); r(c, '#cfd4de', x + 27, ty - 1, 1, 3);
        if (done < 0.5 && f % 2 === 0) r(c, HOT, x + 28, ty - 2, 1, 1);
      }
    }
  };

  // ---------- B: Spin-up pods ----------
  const POD = [{ dx: 2, liq: '#3d9a68', top: '#9ff0c8', bub: '#c8ffe0', rim: '#6fd6a6' }, { dx: 20, liq: '#6e5cae', top: '#d6c8ff', bub: '#e6dcff', rim: '#b09ae0' }];
  const podMem = { col: null }; // colour of the last agent printed in the left pod (kept after it walks off)
  const GT = -12, GB = -1, GH = 12; // glass rows (relative to y): top, bottom, height
  const pods = {
    name: 'Spin-up pods',
    busy: k => k.since('pay') < 1.5 || k.since('agent-done') < 1 || k.since('open') < 0.6,
    draw(c, k) {
      const { x, y, L } = k, f = k.anim ? k.f : 0, r = k.r, cr = crew(k);
      const pay = age(k, 'pay'), crit = !!lastPay(k).crit, done = age(k, 'agent-done'), flt = age(k, 'float');
      // Base housing with a status window under each pod (the original bays), and the level lamps up the
      // centre column, lit bottom-up.
      cabinet(k, c, x, y);
      for (let i = 0; i < 9; i++) r(c, '#2e3547', x + 3 + i * 3, y + 5, 2, 1);
      r(c, '#1b1f2b', x + 13, y - 13, 6, 13); r(c, '#2e3547', x + 14, y - 12, 4, 11);
      for (let i = 0; i < 6; i++) r(c, lampAt(k, i), x + 14, y - 2 - i * 2, 4, 1);
      if (cr.work) podMem.col = agentCol(cr.work);
      for (let p = 0; p < 2; p++) {
        const P = POD[p], px = x + P.dx, on = p === 0 || L >= 2, ag = p === 0 ? cr.work : cr.work2;
        const pp = pay - p * 0.05; // second pod 50 ms behind
        // Status window: original bay colours, agent colour while printing.
        r(c, '#0f1630', px + 1, y + 8, 8, 5);
        r(c, ag ? agentCol(ag) : !on ? '#6a4a20' : p === 0 ? (f % 12 < 6 ? '#b09ae0' : '#6fd6a6') : '#f2c230', px + 2, y + 9 + (p && on && !ag && k.anim ? f % 3 : 0), 6, p && !ag ? 1 : 3);
        // Liquid level: rest 9 of 12 rows; pay dips (wind-up) then surges to the brim with overshoot.
        let hL = on ? 9 + (k.anim && ((f >> 2) + p) % 4 === 0 ? 1 : 0) : 1;
        if (ag) hL = 2; // drained while an agent is printed, so the figure reads
        if (on && pp >= 0 && pp < 1.5) {
          if (pp < 0.1) hL = 7;
          else if (pp < 0.6) hL = Math.min(GH, R(lerp(7, GH, outBack(clamp((pp - 0.1) / 0.5)))));
          else hL = R(lerp(GH, 9, clamp((pp - 0.6) / 0.9)));
        }
        const bot = y + GB + 1, flash = p === 0 && done < 0.15;
        r(c, '#0f1630', px + 1, y + GT, 8, GH);
        r(c, flash ? HOT : P.liq, px + 1, bot - hL, 8, hL);
        if (on) r(c, P.top, px + 1, bot - hL, 8, 1);
        // Bubbles rise one px per frame; more while open, working or surging.
        if (on && k.anim && hL > 2) {
          const n = pp >= 0.1 && pp < 1 ? 6 : k.open || ag ? 4 : 2;
          for (let i = 0; i < n; i++) r(c, P.bub, px + 2 + ((i * 3 + p + (f >> 3)) % 6), bot - 1 - ((f + i * 5 + p * 3) % (hL - 1)), 1, 1);
        }
        // Figure: a dormant silhouette that sways; it wakes (eyes, 50 ms apart) when the founder walks up.
        // A working agent is printed bottom-up in its colour under a scan line; whole and lit when done.
        if (on) {
          const sway = k.anim && ((f >> 3) + p) % 2 ? 1 : 0;
          let dip = 0;
          if (k.near && k.anim) { const a = age(k, 'near') - p * 0.05; dip = a >= 0 && a < 0.1 ? 1 : a < 0.45 ? -R(outBack(clamp((a - 0.1) / 0.35))) : 0; }
          const headTop = y - 9 + dip, bodyTop = y - 6 + dip;
          const who = !ag && p === 0 && done < 2 ? lastDone(k) : null;
          const doneCol = who ? (window.Stage3Agents?.roster?.[who]?.color ? colOf(who) : podMem.col || colOf(who)) : null;
          if (ag || doneCol) {
            const col = ag ? agentCol(ag) : doneCol, prog = ag ? (k.anim ? (f % 24) / 23 : 0.6) : 1, scan = R(y - 1 - 10 * prog);
            r(c, '#39445c', px + 3, headTop, 4, 1); r(c, '#39445c', px + 2, bodyTop, 1, 6); r(c, '#39445c', px + 7, bodyTop, 1, 6);
            if (scan < bodyTop + 6) r(c, col, px + 2, Math.max(scan, bodyTop), 6, bodyTop + 6 - Math.max(scan, bodyTop));
            if (scan < headTop + 3) r(c, col, px + 3, Math.max(scan, headTop), 4, headTop + 3 - Math.max(scan, headTop));
            if (prog >= 1) { r(c, '#1b1f2b', px + 4, headTop + 1, 1, 1); r(c, '#1b1f2b', px + 6, headTop + 1, 1, 1); }
            if (ag && k.anim) { r(c, HOT, px + 1, scan, 8, 1); r(c, col, px + 1 + pr(f, p, 8), scan - 1, 1, 1); }
          } else {
            // Dark figure with a lit rim on its right edge so it still reads under the night overlay.
            const body = k.near ? '#1f2a4a' : '#11141c', sx = px + sway;
            r(c, body, sx + 3, headTop, 4, 3); r(c, body, sx + 2, bodyTop, 6, 6);
            r(c, P.rim, sx + 6, headTop, 1, 3); r(c, P.rim, sx + 7, bodyTop, 1, 6);
            if (k.near) {
              const blink = f % 24 === 5, lx = sx + 4; r(c, blink ? body : HOT, lx, headTop + 1, 1, 1); r(c, blink ? body : HOT, lx + 2, headTop + 1, 1, 1);
              // The right pod (clear of the founder's name tag) also waves.
              if (p === 1) { const up = k.anim ? (f >> 1) % 2 : 0; r(c, HOT, sx + 1, bodyTop - 2 - up, 1, 3); }
            }
          }
        }
        // Scan ring sweeping down every 4 s while idle.
        if (on && k.anim && !ag && f % 32 < GH) r(c, P.top, px + 1, y + GT + (f % 32), 8, 1);
        // Glass walls and a glint.
        r(c, '#39445c', px, y + GT, 1, GH); r(c, '#39445c', px + 9, y + GT, 1, GH); r(c, 'rgba(241,230,200,.22)', px + 2, y + GT + 1, 1, 8);
        // Cap: lifts with a wind-up and overshoot when the window opens (pods 50 ms apart); status lamp on top.
        let lift = 0;
        if (k.open) { const a = age(k, 'open') - p * 0.05; lift = a === Infinity || a > 0.45 ? 2 : a < 0 ? 0 : a < 0.1 ? -1 : R(2 * outBack(clamp((a - 0.1) / 0.3))); }
        const capY = y + GT - 2 - Math.max(-1, lift);
        if (lift > 0) r(c, P.top, px + 1, capY + 2, 8, y + GT - capY - 2);
        r(c, '#39445c', px, capY, 10, 2); r(c, '#9aa9ab', px + 1, capY, 8, 1);
        const capLamp = !on ? '#1b1f2b' : p === 0 && cr.walk ? (f % 4 < 2 ? agentCol(cr.walk) : '#1b1f2b')
          : flt < 0.3 || (pp >= 0 && pp < 0.3) ? HOT : ag ? agentCol(ag) : k.near ? AMBER : P.top;
        r(c, capLamp, px + 4, capY - 1, 2, 1);
        // Crit pay: gold sparkles over the caps.
        // Twinkles beside the caps, alternating sides, never more than one tile above the footprint.
        if (crit && pp >= 0.1 && pp < 1) {
          const s = R((pp - 0.1) * 8), sx = px + (s % 2 ? 10 : -1), sy = Math.max(y - 16, capY - 1 - (s % 3));
          r(c, GOLD, sx, sy - 1, 1, 3); r(c, GOLD, sx - 1, sy, 3, 1);
        }
      }
    }
  };

  // ---------- C: Smithy ----------
  const FIRE = ['#c4572b', '#ffb347', '#f2c230', '#ffb347', '#e86a3a'];
  const smithy = {
    name: 'Smithy',
    busy: k => k.since('pay') < 1.5 || k.since('agent-done') < 1.3 || k.since('near') < 0.6 || k.since('leave') < 0.5,
    draw(c, k) {
      const { x, y, L } = k, f = k.anim ? k.f : 0, r = k.r, cr = crew(k);
      const pay = age(k, 'pay'), crit = !!lastPay(k).crit, done = age(k, 'agent-done'), flt = age(k, 'float');
      const roar = k.open || !!cr.work || flt < 0.4 || (pay > 0.1 && pay < 0.8), stoked = roar || !!cr.walk || k.near;
      // Workbench: the level lamps along its front, a quench trough and a coal bin that lights from level 2.
      cabinet(k, c, x, y);
      r(c, '#2e3547', x + 2, y + 5, 28, 4);
      for (let i = 0; i < 6; i++) r(c, lampAt(k, i), x + 4 + i * 4, y + 6, 2, 2);
      r(c, '#0f1630', x + 4, y + 10, 10, 4); r(c, '#355c8a', x + 5, y + 11, 8, 2); r(c, '#7cc4f0', x + 5 + (k.anim ? (f >> 1) % 6 : 2), y + 11, 2, 1);
      r(c, '#0f1630', x + 18, y + 10, 10, 4); r(c, L >= 2 ? '#f2c230' : '#6a4a20', x + 20, y + 11 + (k.anim && L >= 2 ? f % 3 : 0), 6, 1);
      // Furnace: brick body, chimney, fire mouth.
      r(c, '#8a3516', x + 1, y - 10, 13, 10); r(c, '#a44a2a', x + 1, y - 10, 13, 1);
      for (let j = 0; j < 2; j++) { r(c, '#5a3a22', x + 1, y - 7 + j * 4, 13, 1); r(c, '#5a3a22', x + 3 + j * 3, y - 10 + j * 4, 1, 3); r(c, '#5a3a22', x + 11 - j * 2, y - 10 + j * 4, 1, 3); }
      r(c, '#5a3a22', x + 5, y - 12, 5, 2); r(c, '#39445c', x + 4, y - 13, 7, 1);
      r(c, '#1b1f2b', x + 4, y - 7, 7, 6);
      for (let i = 0; i < 5; i++) { const hg = 2 + pr(f, i, stoked ? 4 : 3) + (roar ? 1 : 0); r(c, FIRE[pr(f, i + 2, 5)], x + 5 + i, y - 1 - Math.min(5, hg), 1, Math.min(5, hg)); }
      if (roar) r(c, HOT, x + 6 + (k.anim ? f % 2 : 0), y - 3, 3, 1);
      // Door: shut (glowing slits) at rest; lifts with a wind-up and overshoot when the founder walks up.
      let open = k.near ? 1 : 0;
      if (k.anim) {
        const a = age(k, 'near'), b = age(k, 'leave');
        if (k.near) open = a < 0.1 ? -0.2 : outBack(clamp((a - 0.1) / 0.35));
        else if (b < 0.3) open = 1 - outCubic(b / 0.3);
      }
      const lift = R(6 * open), dTop = y - 7 - lift, vis = 6 - Math.max(0, lift);
      if (vis > 0) {
        r(c, '#39445c', x + 4, Math.max(y - 7, dTop), 7, vis + (lift < 0 ? 0 : 0)); r(c, '#2e3547', x + 4, Math.max(y - 7, dTop), 7, 1);
        for (let j = 0; j < 2; j++) { const sy = dTop + 2 + j * 2; if (sy > y - 7 && sy < y - 1) r(c, FIRE[pr(f, j, 5)], x + 5, sy, 5, 1); }
      }
      if (lift > 0) r(c, '#39445c', x + 4, y - 8, 7, 1); // door tucked up under the arch
      // Embers from the chimney; more when stoked; never above y-16 (one tile over the footprint).
      if (k.anim) {
        const n = roar ? 5 : stoked ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const life = (f + i * 3) % 8, ey = y - 14 - ((life * 3) >> 3);
          r(c, life < 3 ? AMBER : life < 6 ? '#c4572b' : '#5a3a22', x + 6 + ((f >> 2) + i * 2) % 3, ey, 1, 1);
        }
      }
      // Anvil on the bench; the ingot glows after each strike and cools.
      r(c, '#2e3547', x + 20, y - 2, 6, 2); r(c, '#39445c', x + 18, y - 4, 11, 2); r(c, '#9aa9ab', x + 18, y - 4, 11, 1); r(c, '#39445c', x + 16, y - 4, 2, 1);
      // Trip-hammer: idle tap every 3 s (from level 2, like the original's second bay); an agent at work pounds
      // twice a second; pay is one big strike with a wind-up.
      const tap = f % 24, pound = f % 4;
      let hy = y - 11, hit = false, streak = 0;
      if (cr.work) { if (k.anim) { hy = [y - 13, y - 8, y - 9, y - 11][pound]; hit = pound === 1; } else hy = y - 8; }
      else if (k.near) hy = y - 13; // raised, ready
      else if (k.anim && L >= 2) { if (tap === 0) hy = y - 13; else if (tap === 1) { hy = y - 8; hit = true; } else if (tap === 2) hy = y - 9; }
      if (pay < 1.5) {
        if (pay < 0.1) hy = y - 14;
        else if (pay < 0.18) { hy = R(lerp(y - 14, y - 8, inQuad((pay - 0.1) / 0.08))); streak = 1; }
        else if (pay < 0.28) hy = y - 8;
        else hy = Math.max(y - 14, R(lerp(y - 8, y - 11, outBack(clamp((pay - 0.28) / 0.4)))));
      }
      const sinceHit = pay < 1.5 && pay >= 0.18 ? pay - 0.18 : Infinity;
      let ingot = sinceHit < 0.3 ? HOT : sinceHit < 0.8 ? GOLD : sinceHit < 1.3 ? AMBER : '#8a3516';
      // Founder walks up: the ingot is pulled from the fire white-hot and cools on the anvil (right half, clear of tags).
      const nr = k.near ? age(k, 'near') : Infinity;
      if (cr.work) ingot = pound === 1 || pound === 2 ? HOT : agentCol(cr.work);
      else if (hit) ingot = AMBER;
      else if (nr >= 0.1 && nr < 1.4 && sinceHit === Infinity) ingot = nr < 0.5 ? HOT : nr < 0.9 ? GOLD : AMBER;
      r(c, ingot, x + 21, y - 5, 5, 1);
      r(c, '#5a3a22', x + 29, y - 15, 2, 15); r(c, '#5a3a22', x + 21, y - 16, 10, 2); r(c, '#8a5e3a', x + 21, y - 16, 10, 1);
      if (streak) r(c, 'rgba(207,212,222,.4)', x + 20, hy - 3, 7, 3);
      r(c, '#9aa9ab', x + 23, y - 14, 1, Math.max(0, hy - (y - 14)));
      r(c, '#cfd4de', x + 20, hy, 7, 3); r(c, '#9aa9ab', x + 20, hy + 2, 7, 1); r(c, '#39445c', x + 20, hy, 1, 3);
      // Sparks: small pops on taps and agent strikes, a shower on pay.
      if (hit) { const col = cr.work ? agentCol(cr.work) : GOLD; for (let i = 0; i < (cr.work ? 4 : 2); i++) r(c, i % 2 ? col : HOT, x + 17 + pr(f, i, 12), y - 6 - pr(f, i + 5, 3), 1, 1); }
      if (pay >= 0.18) sparks(k, c, x + 23, y - 6, pay - 0.18, crit ? 20 : 12, crit ? GOLD : AMBER, HOT, 0.75);
      if (nr >= 0.1 && nr < 0.6 && !(pay < 1.5)) sparks(k, c, x + 24, y - 6, nr - 0.1, 6, AMBER, HOT, 0.5);
      // Finished agent job: a forged wrench pops up off the anvil, then a quench puff of steam over the trough.
      if (done < 1.3) {
        const p = outBack(clamp(done / 0.35)), ty = R(y - 6 - 7 * p), col = '#cfd4de';
        r(c, col, x + 18, ty, 5, 1); r(c, col, x + 17, ty - 1, 1, 1); r(c, col, x + 17, ty + 1, 1, 1); r(c, '#8a5e3a', x + 23, ty, 3, 1);
        if (done < 0.5 && f % 2 === 0) r(c, HOT, x + 24, ty - 2, 1, 1);
        if (done > 0.5) { const s = R((done - 0.5) * 8); for (let i = 0; i < 3; i++) r(c, 'rgba(241,230,200,.6)', x + 6 + i * 3, y + 9 - s - (i % 2), 2, 1); }
      }
    }
  };

  FX.add('forge', { a: gantry, b: pods, c: smithy });
})();
