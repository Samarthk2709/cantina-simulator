/* Nib's Training Bench (pattern book): animated variants. See stations/fx.js for the contract.
   Every variant keeps the wooden bench and shows the six bug patterns Nib can learn (taught or not, and how
   precise Nib is at each), read live from the save. a: an open pattern book under a desk lamp ·
   b: a specimen board of pinned bugs with a live one in a jar · c: a punch-card teaching machine with a CRT.
   Stage 3 agents never get a job at this bench today (stage3/harness.js has no training station), so the agent
   reactions fire on k.agents / agent-* events whenever one does come here (or is sent here for filming). */
(function () {
  'use strict';
  const CLS = ['auth', 'info', 'inj', 'path', 'mem', 'race'];
  const PC = ['#e86a6a', '#7cc4f0', '#f2c230', '#4cf08a', '#c9b8ff', '#ffb07a']; // one colour per pattern
  const AGENT = { nib: '#7cc4f0', pip: '#6fcf8e', moss: '#e07a6a', rook: '#9aa9ab', wren: '#c9b8ff' };
  const P = [0, 0, 0, 0, 0, 0];
  const LIGHT = 'rgba(255,226,138,.3)', GLASS = 'rgba(207,230,240,.3)', LENS = 'rgba(255,255,255,.22)', SCAN = 'rgba(76,240,138,.14)';

  // Precision per pattern (0 = not taught yet, up to .95), same rule as the pattern book window.
  function readBook() {
    const s = window.Stage2?.state?.(), E = window.Stage2Engine;
    for (let i = 0; i < 6; i++) P[i] = s && E && s.lessons ? E.precision(s, CLS[i]) : 0;
    return P;
  }
  const cl = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const outBack = u => { u = cl(u) - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };
  // Seconds since the event while it plays (and motion is allowed), else -1.
  const ev = (k, kind, dur) => { if (!k.anim) return -1; const s = k.since(kind); return s < dur ? s : -1; };
  // 0 → 1 with a ~100 ms wind-up below 0 first and an overshoot settle after.
  const spring = (s, d) => (s < 0 ? 0 : s < 0.1 ? -0.25 * (s / 0.1) : outBack((s - 0.1) / (d || 0.35)));
  const lastData = (k, kind) => { for (let i = k.events.length - 1; i >= 0; i--) if (k.events[i].kind === kind) return k.events[i].data || {}; return {}; };
  const agentCol = (a) => (a && (a.color || AGENT[a.id])) || '#7cc4f0';
  const whoCol = (k, kind) => AGENT[lastData(k, kind).who] || '#7cc4f0';
  const working = k => { for (const a of k.agents) if (a.status === 'working') return a; return null; };
  const clock = () => performance.now() / 1000;
  // The pattern book window covers the bench while it is open, so each variant also plays a short beat
  // when it closes (fx.js has no close event: tracked here from k.open).
  const shut = { a: { was: false, at: -9 }, b: { was: false, at: -9 }, c: { was: false, at: -9 } };
  function closing(st, k, dur) {
    if (st.was && !k.open) st.at = clock();
    st.was = !!k.open;
    const s = clock() - st.at; return k.anim && s < dur ? s : -1;
  }
  const busyFor = st => k => clock() - st.at < 1.6 || k.since('pay') < 2.4 || k.since('open') < 1.6 || k.since('near') < 0.8 || k.since('agent-start') < 1 || k.since('agent-done') < 1.9;

  function bench(k) {
    const { x, y, w, r } = k, c = k.c;
    r(c, '#6e4a2e', x, y + 4, w, 8); r(c, '#8a5e3a', x, y + 4, w, 2); r(c, '#4a3020', x, y + 11, w, 1);
    r(c, '#3e2716', x + 3, y + 12, 3, 4); r(c, '#3e2716', x + w - 6, y + 12, 3, 4);
  }
  function star(r, c, col, cx, cy, R) {
    r(c, col, cx - R, cy, 2 * R + 1, 1); r(c, col, cx, cy - R, 1, 2 * R + 1);
    if (R > 1) r(c, col, cx - 1, cy - 1, 3, 3);
  }
  function check(r, c, col, x, y) { r(c, col, x, y + 2, 1, 1); r(c, col, x + 1, y + 3, 1, 1); r(c, col, x + 2, y + 2, 1, 1); r(c, col, x + 3, y + 1, 1, 1); r(c, col, x + 4, y, 1, 1); }

  // ---------------------------------------------------------------------------------------------------
  // A · Pattern Book: an open book on a stand, one page per taught pattern (colour badge + precision bar),
  // a ribbon per pattern hanging over the bench edge (length = precision), and a desk lamp.
  const A = {
    name: 'Pattern Book · pages turn through the taught patterns under a desk lamp',
    busy: busyFor(shut.a),
    draw(c, k) {
      const { x, y, r } = k, f = k.anim ? k.f : 0; k.c = c; readBook();
      const wk = working(k), here = k.agents[0] || null;
      const taught = []; for (let i = 0; i < 6; i++) if (P[i] > 0) taught.push(i);
      const sc = closing(shut.a, k, 1.4), so = sc >= 0 ? sc : ev(k, 'open', 1.4); // closing the book riffles it again
      const sn = ev(k, 'near', 0.6), sl = ev(k, 'leave', 0.3), ps = ev(k, 'pay', 2.3), fs = ev(k, 'float', 1.2);
      const sa = ev(k, 'agent-start', 0.8), sd = ev(k, 'agent-done', 1.8);

      // book hop: open riffles the pages up off the stand, walking up makes it perk once
      let dy = 0;
      if (so >= 0) dy = so < 0.1 ? 1 : so < 0.9 ? -1 : Math.round(-(1 - outBack((so - 0.9) / 0.4)));
      else if (sn >= 0) dy = sn < 0.1 ? 1 : sn < 0.25 ? -1 : 0;

      // page: cycles through the taught patterns every 5 s; turning shows a page in flight
      const cyc = taught.length ? Math.floor(f / 40) : 0;
      let page = taught.length ? taught[cyc % taught.length] : -1, tp = -1;
      if (k.anim && taught.length > 1 && f % 40 >= 36) tp = f % 40 - 36;
      if (so >= 0.1 && so < 0.9) { tp = Math.floor((so - 0.1) * 16) % 4; if (taught.length) page = taught[(cyc + Math.floor((so - 0.1) * 4)) % taught.length]; }
      else if (sn >= 0.1 && sn < 0.6) tp = Math.min(3, Math.floor((sn - 0.1) / 0.11));
      else if (sd >= 0 && sd < 0.45) tp = Math.min(3, Math.floor(sd / 0.11));
      const writing = !!wk || (here && here.status === 'walking'); // an agent studying: a fresh page

      bench(k);
      // The player's 'You' tag sits over x+19..x+29 while they stand here, so everything that reacts
      // (badge, bar, quill, tick, star, slip) lives on the LEFT page; the right page is plain lesson text.
      const bx = x + 1, by = y - 7 + dy;
      r(c, '#3e2716', x + 3, y + 1, 24, 3); // stand
      r(c, '#1f2a4a', bx, by, 28, 10); r(c, '#2c3b66', bx, by + 9, 28, 1); // cover
      r(c, '#f1e6c8', bx + 1, by + 1, 12, 8); r(c, '#f1e6c8', bx + 15, by + 1, 12, 8);
      r(c, '#e0d2b4', bx + 1, by + 8, 12, 1); r(c, '#e0d2b4', bx + 15, by + 8, 12, 1);
      r(c, '#1b1f2b', bx + 13, by, 2, 10); // spine
      // right page: the lesson text, headed in the pattern's colour
      r(c, page >= 0 && !writing ? PC[page] : '#9aa9ab', bx + 16, by + 2, 4, 1);
      r(c, '#9aa9ab', bx + 16, by + 4, 9, 1); r(c, '#9aa9ab', bx + 16, by + 6, 7, 1);
      if (writing) {
        // agent's notes: ink lines grow behind a quill in the agent's colour
        const col = agentCol(wk || here), n = wk && k.anim ? f % 24 : 0, row = n >> 3, cut = n & 7;
        for (let j = 0; j < row; j++) r(c, '#1f2a4a', bx + 3, by + 2 + j * 2, 8, 1);
        if (wk) {
          if (cut) r(c, '#1f2a4a', bx + 3, by + 2 + row * 2, cut, 1);
          const qd = sa >= 0 ? Math.round((1 - spring(sa, 0.3)) * -6) : 0, tx = bx + 3 + cut, ty = by + 2 + row * 2 + qd;
          r(c, '#1b1f2b', tx, ty, 1, 1); r(c, col, tx + 1, ty - 3, 1, 3); r(c, col, tx + 2, ty - 5, 1, 3); r(c, '#f1e6c8', tx + 2, ty - 3, 1, 1);
        }
      } else if (sd >= 0) { /* a fresh page for the agent's tick below */ }
      else if (page >= 0) {
        // left page: the pattern's bug badge and its precision bar
        const pc = PC[page];
        r(c, pc, bx + 4, by + 2, 3, 2); r(c, '#1b1f2b', bx + 7, by + 2, 1, 1); r(c, '#1b1f2b', bx + 3, by + 2, 1, 1); r(c, '#1b1f2b', bx + 3, by + 4, 1, 1); r(c, '#1b1f2b', bx + 7, by + 4, 1, 1);
        r(c, '#cfd4de', bx + 2, by + 6, 10, 1); r(c, pc, bx + 2, by + 6, Math.max(1, Math.round(10 * P[page] / 0.95)), 1);
        if (k.anim && f % 40 < 20 && (f & 4)) r(c, '#1f2a4a', bx + 10, by + 3, 1, 1); // ink cursor
      } else { r(c, '#cfd4de', bx + 3, by + 2, 8, 1); r(c, '#cfd4de', bx + 3, by + 4, 6, 1); } // nothing taught yet
      // page in flight
      if (tp >= 0) {
        const PX = [[16, 9], [15, 4], [11, 4], [5, 9]][tp];
        r(c, '#fff8e6', bx + PX[0], by - 1, PX[1], 9); r(c, '#e0d2b4', bx + PX[0], by + 7, PX[1], 1);
      }
      // ribbons over the bench edge: one per pattern, longer = more precise; they flutter when the book opens
      for (let i = 0; i < 6; i++) {
        const u = so - 0.1 - i * 0.05, o = so >= 0 && u > 0 && u < 0.8 ? (Math.floor(u * 16) & 1) : 0;
        const len = P[i] > 0 ? 2 + Math.round(P[i] / 0.95 * 5) : 1, w2 = ps - 0.35 - i * 0.05; // pay: they jump in a wave
        const lift = ps >= 0 && w2 > 0 ? (w2 < 0.15 ? 2 : w2 < 0.25 ? 1 : 0) : 0;
        r(c, P[i] > 0 ? PC[i] : '#3a2f22', bx + 3 + i * 4 + o, by + 10 - lift, 2, len - (i === page && k.anim && (f & 8) ? 1 : 0));
      }
      // agent done: a tick in their colour on the new page
      if (sd >= 0.45) check(r, c, whoCol(k, 'agent-done'), bx + 5, by + 2);
      // float: a slip of paper peeks out of the book
      if (fs >= 0) { const h = Math.round(4 * Math.sin(Math.PI * fs / 1.2)); if (h > 0) r(c, '#fff8e6', bx + 6, by - h, 3, h); }
      // pay: a gold star stamps onto the left page (red for a critical), with sparks
      if (ps >= 0) {
        const crit = !!lastData(k, 'pay').crit, cx = bx + 7, cy = by + 4;
        if (ps < 0.1) r(c, '#e0d2b4', cx - 1, cy, 3, 1); // shadow first
        else if (ps < 2 || (f & 1)) {
          const u = outBack((ps - 0.1) / 0.3), yo = Math.round((1 - u) * -12);
          star(r, c, crit ? '#e86a6a' : '#f2c230', cx, cy + yo, ps < 0.3 ? 3 : 2);
          r(c, crit ? '#f2c230' : '#fff3c8', cx, cy + yo, 1, 1);
        }
        if (ps > 0.35 && ps < 0.9) {
          const d = 3 + Math.min(4, Math.round((ps - 0.35) * 14)), sc = crit ? '#f2c230' : '#fff3c8';
          r(c, sc, cx - d, cy - d, 1, 1); r(c, sc, cx + d, cy - d, 1, 1); r(c, sc, cx - d, cy + d, 1, 1); r(c, sc, cx + d, cy + d, 1, 1);
          if (crit) { r(c, '#e86a6a', cx, cy - d - 2, 1, 1); r(c, '#e86a6a', cx - d - 2, cy, 1, 1); r(c, '#e86a6a', cx + d + 2, cy, 1, 1); }
        }
      }
      // desk lamp: clicks on when you walk up, open the book or an agent studies; always on at night
      let on = k.near || k.open || !!here || k.night, dip = 0;
      if (sn >= 0) { if (sn < 0.1) { dip = 1; on = k.night; } else if (sn < 0.3) on = k.night || (Math.floor((sn - 0.1) * 20) % 3 !== 1); }
      if (sl >= 0 && sl < 0.1) dip = 1;
      r(c, '#2c2f3a', x + 37, y + 2, 8, 2); r(c, '#5a5f6e', x + 42, y - 8, 1, 10); r(c, '#5a5f6e', x + 38, y - 9 + dip, 5, 1);
      r(c, '#c4572b', x + 34, y - 11 + dip, 6, 2); r(c, '#8a3516', x + 33, y - 9 + dip, 8, 1);
      r(c, ps >= 0.1 && ps < 0.7 && (f & 1) ? '#ffffff' : on ? '#ffe28a' : '#5a5f6e', x + 36, y - 8 + dip, 2, 1);
      if (on) { c.fillStyle = LIGHT; for (let j = 0; j < 10; j++) { const lx = x + 34 - ((j * 3) >> 3); c.fillRect(lx, y - 7 + dip + j, x + 40 + (j >> 1) - lx, 1); } } // ends right of the book
    }
  };

  // ---------------------------------------------------------------------------------------------------
  // B · Specimen Board: a cork board with one pinned bug per taught pattern (label ink = precision) and a
  // live practice bug in a glass jar that crawls, climbs and falls.
  const SPECK = [[4, 2], [9, 9], [15, 4], [21, 11], [26, 3], [12, 13], [24, 7], [6, 12], [18, 1]];
  // Jar bug idle path over 48 frames: crawl along the floor, climb the wall, fall, flail, right itself.
  function jarBug(n) {
    if (n < 14) return [Math.floor(n / 2), 0, 0];
    if (n < 26) return [6, -Math.floor((n - 14) / 2), 0];
    if (n < 28) return [6, -6 + (n - 26) * 3, 1];
    if (n < 40) return [6 - ((n - 28) >> 2), 0, 2];
    return [3 - ((n - 40) >> 2), 0, 0];
  }
  function bug(r, c, col, x, y, f, flip, still) {
    const l = still ? 0 : f & 1;
    if (flip) { r(c, col, x, y + 1, 3, 1); r(c, '#1b1f2b', x, y, 1, 1 - l); r(c, '#1b1f2b', x + 2, y, 1, l + 0); r(c, '#1b1f2b', x + 1, y - 1 + l, 1, 1); return; }
    r(c, col, x, y - 1, 3, 2); r(c, '#1b1f2b', x + 3, y - 1, 1, 1);
    r(c, '#1b1f2b', x + l, y + 1, 1, 1); r(c, '#1b1f2b', x + 2 - l, y + 1, 1, 1);
  }
  function specimen(r, c, i, sx, sy, k, lift, bright) {
    if (P[i] > 0) {
      const col = PC[i], yy = sy - lift;
      r(c, col, sx + 2, yy + 1, 3, 3); r(c, '#1b1f2b', sx + 3, yy, 1, 1);
      r(c, '#1b1f2b', sx + 1, yy + 1, 1, 1); r(c, '#1b1f2b', sx + 5, yy + 1, 1, 1); r(c, '#1b1f2b', sx + 1, yy + 3, 1, 1); r(c, '#1b1f2b', sx + 5, yy + 3, 1, 1);
      r(c, '#cfd4de', sx + 3, yy + 2, 1, 1); // pin
      r(c, bright ? '#fff3c8' : '#f1e6c8', sx + 1, sy + 5, 5, 1); r(c, '#1f2a4a', sx + 1, sy + 5, Math.max(1, Math.round(5 * P[i] / 0.95)), 1);
    } else {
      r(c, '#8a5e3a', sx + 1, sy, 1, 1); r(c, '#8a5e3a', sx + 5, sy, 1, 1); r(c, '#8a5e3a', sx + 1, sy + 4, 1, 1); r(c, '#8a5e3a', sx + 5, sy + 4, 1, 1);
      r(c, '#9a6a3e', sx + 1, sy + 5, 5, 1);
    }
  }
  const B = {
    name: 'Specimen Board · pinned bug per taught pattern, a live one in a jar',
    busy: busyFor(shut.b),
    draw(c, k) {
      const { x, y, r } = k, f = k.anim ? k.f : 0; k.c = c; readBook();
      const wk = working(k), here = k.agents[0] || null;
      const sc = closing(shut.b, k, 0.6), so = ev(k, 'open', 0.6), sn = ev(k, 'near', 0.8), ps = ev(k, 'pay', 2.3), fs = ev(k, 'float', 0.8);
      const sa = ev(k, 'agent-start', 0.6), sd = ev(k, 'agent-done', 1.8);
      let next = -1; for (let i = 0; i < 6; i++) if (P[i] === 0) { next = i; break; }
      const jarCol = next >= 0 ? PC[next] : '#e86a6a';
      const crit = ps >= 0 && !!lastData(k, 'pay').crit;
      let target = 0; { let best = -1; for (let i = 0; i < 6; i++) if (P[i] > 0 && P[i] < 0.95 && (best < 0 || P[i] < P[best])) best = i; target = best >= 0 ? best : next >= 0 ? next : 0; }

      // board (behind the bench); the frame flashes when the bug lands on every pay (gold/red on a critical,
      // cream otherwise) since the pinned slot itself can sit under the player's tag
      const fl = ps >= 0.6 && ps < 1.0 ? Math.floor((ps - 0.6) * 12) & 1 : -1;
      r(c, fl < 0 ? '#5a3a22' : crit ? (fl ? '#e86a6a' : '#f2c230') : fl ? '#f1e6c8' : '#fff3c8', x + 2, y - 13, 30, 17);
      r(c, '#b07c4c', x + 3, y - 12, 28, 15);
      for (const s of SPECK) r(c, '#9a6a3e', x + 3 + s[0], y - 12 + s[1], 1, 1);
      const sxy = i => [x + 5 + (i % 3) * 9, y - 11 + ((i / 3) | 0) * 7];
      const tw = wk ? (f >> 4) % 6 : -1; // slot the agent is sorting
      for (let i = 0; i < 6; i++) {
        const [sx, sy] = sxy(i);
        let lift = 0;
        if (sd >= 0) { const u = sd - i * 0.05; lift = u > 0 && u < 0.2 ? 1 : 0; } // done: specimens hop in a wave
        if (i === tw && (f & 2)) lift = 1;
        specimen(r, c, i, sx, sy, k, lift, k.near || k.open);
        if (k.anim && P[i] > 0 && (f >> 4) % 6 === i && (f & 15) < 2) r(c, '#ffffff', sx + 4, sy + 1, 1, 1); // glint
      }
      bench(k);

      // jar with the practice bug: the next pattern to teach
      // walking up: the jar leans back (wind-up), then wobbles with a rattling lid and a glint runs across the glass
      const wob = sn >= 0 && sn < 0.4 ? (sn < 0.1 ? -1 : (Math.floor(sn * 20) & 1) ? 1 : sn < 0.3 ? -1 : 0) : 0;
      const jx = x + 34 + wob, jy = y - 6;
      let lid = sn >= 0.1 && sn < 0.45 ? -((Math.floor(sn * 20) & 1)) : 0, showBug = true;
      if (ps >= 0) { lid = ps < 0.1 ? 1 : ps < 1.2 ? Math.round(-3 * spring(ps, 0.3)) : Math.round(-3 * (1 - cl((ps - 1.2) / 0.3))); showBug = ps < 0.15 || ps > 1.5; }
      if (fs >= 0) lid = (Math.floor(fs * 16) & 1) ? -1 : 0;
      c.fillStyle = GLASS; c.fillRect(jx + 1, jy, 8, 9);
      if (showBug) {
        let bx, byy, flip = false, still = false;
        if (k.near && !(sn >= 0 && sn < 0.1)) {
          // the bug spots you: it hops up and clings to the front of the glass
          const u = sn >= 0 ? spring(sn - 0.1, 0.3) : 1;
          bx = jx + 4; byy = jy + 8 - Math.round(4 * u); still = (f & 6) !== 0;
        } else if (sn >= 0 && sn < 0.1) { bx = jx + 2 + jarBug(f % 48)[0]; byy = jy + 9; still = true; } // crouch: wind-up
        else if (here) { bx = jx + 2 + ((f >> 3) & 1); byy = jy + 8; still = !(f & 4); } // agent here: it hides low
        else { const p = jarBug(f % 48); bx = jx + 2 + p[0]; byy = jy + 8 + p[1]; flip = p[2] === 1 || p[2] === 2; still = p[2] === 1; }
        if (ps > 1.5) byy = Math.min(byy, jy + Math.round((ps - 1.5) * 20)); // a new one drops in
        bug(r, c, jarCol, bx, byy, f, flip, still || !k.anim);
        if (k.near && !(sn >= 0 && sn < 0.1)) { r(c, '#ffffff', bx + 3, byy - 1, 1, 1); }
      }
      r(c, '#9aa9ab', jx, jy - 1, 1, 10); r(c, '#9aa9ab', jx + 9, jy - 1, 1, 10); r(c, '#9aa9ab', jx, jy + 9, 10, 1);
      r(c, '#eaf6ff', jx + 2, jy + 1, 1, 4);
      if (sn >= 0.2 && sn < 0.6) { const gx = jx + 1 + Math.floor((sn - 0.2) * 20); r(c, '#ffffff', gx, jy + 1, 1, 6); }
      r(c, '#c4572b', jx - 1, jy - 3 + lid, 12, 2); r(c, '#8a3516', jx + 4, jy - 4 + lid, 2, 1);

      // pay: the jar bug flies out on an arc and gets pinned to its slot, with a flash
      if (ps >= 0.15) {
        const [tx, ty] = sxy(target), u = cl((ps - 0.15) / 0.45), e = 1 - (1 - u) * (1 - u);
        const fx = Math.round(jx + 4 + (tx + 2 - jx - 4) * e), fy = Math.round(jy + 2 + (ty + 2 - jy - 2) * e - Math.sin(Math.PI * u) * 7);
        if (u < 1) { bug(r, c, jarCol, fx, fy, f, false, false); if (u > 0.2 && u < 0.8) r(c, 'rgba(255,255,255,.35)', fx + 3, fy - 1, 2, 1); }
        else if (ps < 0.8) { r(c, crit ? '#f2c230' : '#ffffff', tx + 1, ty, 5, 5); }
        else if (ps < 1.3) { const d = 2 + Math.round((ps - 0.8) * 10), sc = crit ? '#f2c230' : '#fff3c8'; r(c, sc, tx + 3 - d, ty + 2, 1, 1); r(c, sc, tx + 3 + d, ty + 2, 1, 1); r(c, sc, tx + 3, ty + 2 - d, 1, 1); }
      }

      // agent working: tweezers in their colour move from slot to slot; walking up: brackets mark the next slot
      if (here) {
        const col = agentCol(here), [sx, sy] = sxy(wk ? tw : target);
        if (!wk) { if (f & 4 || !k.anim) { r(c, col, sx, sy - 1, 2, 1); r(c, col, sx + 5, sy - 1, 2, 1); r(c, col, sx, sy + 6, 2, 1); r(c, col, sx + 5, sy + 6, 2, 1); } }
        else {
          const drop = sa >= 0 ? Math.round((1 - spring(sa, 0.3)) * -6) : 0, tx = sx + 4, ty = sy + 2 + drop;
          r(c, '#cfd4de', tx, ty - 1, 1, 1); r(c, '#cfd4de', tx + 1, ty - 3, 1, 2); r(c, '#cfd4de', tx + 2, ty - 5, 1, 2); r(c, '#cfd4de', tx + 3, ty - 2, 1, 1);
          r(c, col, tx + 3, ty - 7, 2, 3);
        }
      }
      if (sd >= 0.3) check(r, c, whoCol(k, 'agent-done'), x + 13, y - 16);

      // open: a magnifying glass swings in and drifts over the board while the book is open
      if (k.open || so >= 0 || sc >= 0) {
        let lx = x + 17 + Math.round(9 * Math.sin(k.anim ? k.t * 0.9 : 0)), ly = y - 8 + Math.round(2 * Math.sin(k.anim ? k.t * 1.8 : 0));
        if (so >= 0) { const u = spring(so, 0.4); lx = Math.round(x + 40 + (lx - x - 40) * u); ly = Math.round(y - 4 + (ly - y + 4) * u); }
        else if (sc >= 0) { const u = sc < 0.1 ? -0.1 * sc / 0.1 : ((sc - 0.1) / 0.4) ** 2; lx = Math.round(lx + (x + 38 - lx) * u); } // closed: it withdraws to the right (ring/handle stay inside x+47)
        c.fillStyle = LENS; c.fillRect(lx - 3, ly - 3, 7, 7);
        r(c, '#cfd4de', lx - 2, ly - 4, 5, 1); r(c, '#cfd4de', lx - 2, ly + 4, 5, 1); r(c, '#cfd4de', lx - 4, ly - 2, 1, 5); r(c, '#cfd4de', lx + 4, ly - 2, 1, 5);
        r(c, '#cfd4de', lx - 3, ly - 3, 1, 1); r(c, '#cfd4de', lx + 3, ly - 3, 1, 1); r(c, '#cfd4de', lx - 3, ly + 3, 1, 1); r(c, '#cfd4de', lx + 3, ly + 3, 1, 1);
        r(c, '#ffffff', lx - 2, ly - 2, 2, 1);
        r(c, '#5a3a22', lx + 4, ly + 4, 2, 2); r(c, '#5a3a22', lx + 6, ly + 6, 2, 2);
      }
    }
  };

  // ---------------------------------------------------------------------------------------------------
  // C · Punch-Card Trainer: a CRT plots one bar per pattern (height = precision) beside a card reader that
  // feeds lesson cards; six reader lamps light in the colours of the taught patterns.
  const C = {
    name: 'Punch-Card Trainer · a card reader feeds lessons, a CRT plots precision',
    busy: busyFor(shut.c),
    draw(c, k) {
      const { x, y, r } = k, f = k.anim ? k.f : 0; k.c = c; readBook();
      const wk = working(k), here = k.agents[0] || null;
      const sc = closing(shut.c, k, 1.6), so = sc >= 0 ? sc : ev(k, 'open', 1.6), sn = ev(k, 'near', 0.4), sl = ev(k, 'leave', 0.35), ps = ev(k, 'pay', 2.3), fs = ev(k, 'float', 0.9);
      const sa = ev(k, 'agent-start', 0.6), sd = ev(k, 'agent-done', 1.8);
      const crit = ps >= 0 && !!lastData(k, 'pay').crit;
      const awake = k.near || k.open || !!here;
      // nobody near for a while (and it's day): the CRT sleeps very dim, so walking up really powers it on
      const asleep = !awake && !k.night && k.since('leave') > 4 && k.since('agent-done') > 4 && !(ps >= 0) && !(so >= 0);

      bench(k);
      // CRT
      const cx = x + 3, cy = y - 11;
      r(c, '#e0d2b4', cx, cy, 20, 16); r(c, '#cdbd98', cx, cy + 13, 20, 3); r(c, '#f1e6c8', cx, cy, 20, 1);
      r(c, '#5a5f6e', cx + 14, cy + 14, 2, 1); r(c, '#5a5f6e', cx + 17, cy + 14, 2, 1);
      r(c, awake ? '#4cf08a' : '#1f5a36', cx + 2, cy + 14, 2, 1);
      const sx = cx + 2, sy = cy + 2, SW = 16, SH = 10;
      r(c, '#0b2a1f', sx, sy, SW, SH);
      // power on when you walk up (dot → line → screen), off again when you leave
      let mode = 'on';
      if (sn >= 0) mode = sn < 0.1 ? 'dot' : sn < 0.2 ? 'line' : 'grow';
      else if (sl >= 0 && !awake) mode = sl < 0.15 ? 'line' : sl < 0.3 ? 'dot' : 'on';
      const inv = crit && ps < 0.8 && (Math.floor(ps * 10) & 1); // critical: the screen flashes inverse
      if (mode === 'dot') r(c, '#eaffef', sx + 7, sy + 4, 2, 2);
      else if (mode === 'line') r(c, '#eaffef', sx + 1, sy + 4, SW - 2, 2);
      else {
        let hk = 1; if (mode === 'grow') hk = outBack((sn - 0.2) / 0.2);
        const bright = awake || k.night, ink = inv ? '#0b2a1f' : bright ? '#4cf08a' : asleep ? '#1d5234' : '#2f7a4f';
        if (inv) r(c, '#4cf08a', sx, sy, SW, SH);
        r(c, inv ? '#0b2a1f' : '#1f5a36', sx + 1, sy + SH - 2, SW - 2, 1); // baseline
        const reading = (f >> 2) % 6;
        for (let i = 0; i < 6; i++) {
          let h = P[i] > 0 ? 1 + Math.round(6 * P[i] / 0.95) : 0;
          if (so >= 0) h = Math.round(h * spring(so - 0.15 - i * 0.05, 0.35)); // open: bars regrow in a wave
          h = Math.max(0, Math.min(8, Math.round(h * hk)));
          if (h) r(c, i === reading && !asleep && k.anim ? (inv ? '#0b2a1f' : '#c8ffd8') : ink, sx + 2 + i * 2 + (i > 2 ? 1 : 0), sy + SH - 2 - h, 1, h);
          else r(c, '#1f5a36', sx + 2 + i * 2 + (i > 2 ? 1 : 0), sy + SH - 3, 1, 1);
        }
        if (bright && !inv) {
          // markers stay left of sx+SW-5 (x+19+ sits under the player's 'You' tag)
          if (here) { const col = agentCol(here); r(c, col, sx + 1 + (wk ? f % 14 : 0), sy + 1, 1, 1); if (!wk && (f & 4)) r(c, col, sx + SW - 6, sy + 1, 2, 1); } // agent: a plot point marches
          else if (k.anim && (f & 4)) r(c, '#4cf08a', sx + SW - 6, sy + 1, 2, 1); // cursor
          if (sd >= 0.2) { const col = whoCol(k, 'agent-done'); r(c, '#0b2a1f', sx + 3, sy, 5, 5); r(c, col, sx + 4, sy + 2, 3, 1); r(c, col, sx + 5, sy + 1, 1, 3); }
          if (fs >= 0) r(c, '#c8ffd8', sx + 1, sy + 1, Math.min(10, 2 + Math.round(fs * 14)), 1);
        }
        if (k.anim && !asleep) { c.fillStyle = SCAN; c.fillRect(sx, sy + (f % SH), SW, 1); }
      }
      r(c, '#c9b998', sx - 1, sy - 1, SW + 2, 1); // bezel lip

      // card reader with hopper
      const rx = x + 25, ry = y - 3;
      let shake = 0; if (so >= 0 && so < 0.1) shake = 1;
      r(c, '#39445c', rx + shake, ry, 20, 7); r(c, '#5b6b8a', rx + shake, ry, 20, 1); r(c, '#1b1f2b', rx + 3 + shake, ry + 5, 14, 1);
      // hopper: a stack of lesson cards
      r(c, '#2c2f3a', rx + 2, ry - 7, 1, 7); r(c, '#2c2f3a', rx + 17, ry - 7, 1, 7);
      const cycle = so >= 0.1 && so < 1.1 ? Math.floor((so - 0.1) * 32) % 8 : f % 32; // open: a fast batch
      const dropN = so >= 0.1 && so < 1.1 ? cycle : cycle < 4 ? cycle : -1;
      const fan = sn >= 0.2 || (k.near && !k.anim) ? 1 : 0;
      for (let j = 2; j >= 0; j--) {
        const yy = ry - 6 + j * 2 - (j === 0 ? fan : 0);
        r(c, '#f1e6c8', rx + 3, yy, 14, 2); r(c, '#cdbd98', rx + 3, yy + 1, 14, 1);
        for (let h = 0; h < 4; h++) r(c, '#5a5f6e', rx + 5 + h * 3 + ((j + h) & 1), yy, 1, 1); // punched holes
      }
      if (dropN >= 0 && dropN < 4 && k.anim) r(c, '#fff8e6', rx + 4, ry - 1 + dropN, 12, 1); // card sliding into the reader
      // lamps: one per pattern, in its colour when taught; the card being read lights its lamp white
      const chase = wk ? (f % 6) : so >= 0.1 && so < 1.1 ? Math.floor(so * 24) % 6 : cycle >= 4 && cycle < 20 ? ((cycle - 4) >> 1) % 6 : -1;
      for (let i = 0; i < 6; i++) r(c, i === chase && k.anim ? '#ffffff' : P[i] > 0 ? PC[i] : '#1b1f2b', rx + 4 + i * 2 + shake, ry + 2, 1, 1);
      if (cycle >= 20 && cycle < 26 && k.anim && !(so >= 0)) r(c, '#f1e6c8', rx + 5, ry + 6, 10, Math.min(2, cycle - 19)); // card out the front slot

      // agent working: punched paper tape curls up out of the reader, holes in their colour
      if (here) {
        const col = agentCol(here);
        if (wk) {
          const pop = sa >= 0 ? spring(sa, 0.3) : 1, len = Math.max(1, Math.round((3 + ((f >> 1) % 8)) * pop));
          r(c, '#f1e6c8', rx + 18, ry - len, 2, len); r(c, '#cdbd98', rx + 20, ry - len, 1, len); r(c, '#f1e6c8', rx + 16, ry - len - 1, 4, 1); r(c, '#cdbd98', rx + 16, ry - len, 2, 1);
          for (let j = (f & 1); j < len; j += 2) r(c, col, rx + 18 + (j & 2 ? 1 : 0), ry - len + j, 1, 1);
        } else if (f & 4 || !k.anim) r(c, col, rx + 18, ry + 2, 1, 1);
      }
      if (sd >= 0 && sd < 0.6) { const yy = Math.round(ry - 9 + sd * 20); r(c, '#f1e6c8', rx + 18, Math.min(yy, ry + 3), 2, 4); } // tape snips and drops

      // pay: a gold-punched card shoots up out of the hopper, holds, and drops back
      if (ps >= 0) {
        let u = ps < 0.1 ? -0.15 : ps < 1.6 ? spring(ps, 0.3) : 1 - cl((ps - 1.6) / 0.3);
        const yy = ry - 7 - Math.round(7 * u);
        r(c, '#fff8e6', rx + 3, yy, 14, 5); r(c, '#e0d2b4', rx + 3, yy + 4, 14, 1);
        const hc = crit ? '#e86a6a' : '#f2c230';
        if (u > 0.5) { r(c, hc, rx + 6, yy + 1, 3, 1); r(c, hc, rx + 6, yy + 2, 1, 1); r(c, hc, rx + 9, yy + 2, 1, 1); r(c, hc, rx + 11, yy + 1, 1, 3); r(c, hc, rx + 13, yy + 1, 2, 1); r(c, hc, rx + 13, yy + 3, 2, 1); }
        if (ps > 0.3 && ps < 0.8) { const d = 1 + Math.round((ps - 0.3) * 12), sc = crit ? '#f2c230' : '#fff3c8'; r(c, sc, rx + 2 - d, yy + 2, 1, 1); r(c, sc, rx + 17 + d, yy + 2, 1, 1); }
      }
    }
  };

  window.StationFX?.add('training', { a: A, b: B, c: C });
})();
