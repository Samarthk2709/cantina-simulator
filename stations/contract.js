/* Ops Center (Nib's overnight finds): animated variants. See stations/fx.js for the contract.
   Footprint 3x1 tiles (48x16 office px); art may rise one tile above. Every variant keeps the level readable
   (pinned contracts = k.L, 1-5), shows Nib's overnight finds waiting in the tray, and reacts to the player
   (near / leave / open / pay / float) and to Stage 3 agents writing or submitting reports here.
     a  Red-string board  a corkboard of pinned contracts tied with red string; pay stamps a card PAID.
     b  Ops radar         a wall scope sweeps contract blips over a console; pay flares a blip, agents lock on.
     c  Split-flap board  a departures board of contracts; flaps flip to greet you, to $$$ on pay, to show agents. */
(function () {
  'use strict';
  const FX = window.StationFX; if (!FX) return;

  // ---------- shared helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const out3 = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const back = t => { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const lev = k => clamp(k.L | 0, 0, 5);
  const lastEv = (k, kind) => { for (let i = k.events.length - 1; i >= 0; i--) if (k.events[i].kind === kind) return k.events[i]; return null; };
  const tray = () => { const s = window.Stage2?.state?.(); return s && s.tray ? Math.min(12, s.tray.length) : 0; };
  const AG = { nib: '#6fd6a6', pip: '#7cc4f0', moss: '#9fd36a', rook: '#c9b8ff', wren: '#ffb07a' };
  const agCol = a => a.color || AG[a.id] || '#7cc4f0';
  const SUBMIT = { submit_report: 1, submit_as_is: 1, prove: 1 };
  // A pixel painter bound to this frame: integer office pixels only.
  const painter = (c, k) => (col, X, Y, W, H) => k.r(c, col, Math.round(X), Math.round(Y), W, H);
  // Seconds since an event while it is still "live"; Infinity under reduced motion (no event animations).
  const ago = (k, kind) => k.anim ? k.since(kind) : Infinity;

  // =====================================================================================
  // A · Red-string board: the original corkboard, alive. Pins tied with red string carry a travelling glint,
  // cards flutter in turn, Nib's finds wait as sticky notes on top. Walking up perks the cards, opening runs a
  // gold pulse down the string, pay slams a PAID stamp on a card and pops coins. Agents hang draft cards on a
  // clip rail above the board and write them line by line; submitting slides the arrow, done flies the card off.
  // =====================================================================================
  // The string runs pin to pin across the pinned cards, then on to a brass tack at the far right (the lead
  // still to chase) while the board has open slots. Cached per level as offsets from the station corner.
  const strings = {};
  function stringPath(L) {
    if (strings[L]) return strings[L];
    const xs = [], pts = [];
    for (let i = 0; i < L; i++) xs.push(8 + i * 9);
    if (L < 5) xs.push(44);
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], len = xs[i + 1] - a, sag = Math.min(4, Math.max(1, Math.round(len / 4)));
      for (let d = 0; d < len; d++) pts.push([a + d, 5 + Math.round(Math.sin(Math.PI * d / len) * sag)]);
    }
    return (strings[L] = pts);
  }
  const A = {
    name: 'Red-string board',
    draw(c, k) {
      const p = painter(c, k), { x, y, w, h } = k, L = lev(k), an = k.anim, f = an ? k.f : 0;
      const sN = ago(k, 'near'), sL = ago(k, 'leave'), sO = ago(k, 'open'), sP = ago(k, 'pay'), sF = ago(k, 'float');
      // Frame and cork, specks for texture.
      p('#1f2a4a', x, y + 1, w, h - 1); p('#c89a5a', x + 2, y + 3, w - 4, h - 5);
      p('#b88a5c', x + 3, y + 13, 1, 1); p('#b88a5c', x + 22, y + 4, 1, 1); p('#d8aa6a', x + 40, y + 13, 1, 1); p('#d8aa6a', x + 13, y + 13, 1, 1);
      // Pay: which card is stamped, and its squash on impact.
      const pay = sP < 2.5 ? lastEv(k, 'pay') : null, tgt = pay && L ? Math.floor(pay.at * 10) % L : -1;
      const crit = !!(pay && pay.data.crit), ink = crit ? '#e2b93c' : '#2f9e5a';
      // Cards: pinned ones perk up when the player walks up (dip, overshoot, settle), staggered 50 ms.
      for (let i = 0; i < 5; i++) {
        const cx = x + 4 + i * 9;
        if (i >= L) { p('#b88a5c', cx, y + 5, 7, 8); continue; }
        let dy = 0;
        if (k.near) { const t = sN - i * 0.05; dy = t < 0 ? 0 : t < 0.1 ? 1 : t < 0.25 ? -2 : -1; if (!an) dy = -1; }
        else if (sL < 0.4) { const t = sL - i * 0.05; dy = t < 0 ? -1 : t < 0.12 ? 1 : 0; }
        if (i === tgt && sP >= 0.2 && sP < 0.32) dy += 1; // squash under the stamp
        const cy = y + 5 + dy;
        p('#6e4a2e', cx + 1, y + 13, 6, 1); // shadow on the cork
        p(i % 2 ? '#f1e6c8' : '#fff', cx, cy, 7, 8);
        p(sO < 1.2 && sO - i * 0.05 > 0 && sO - i * 0.05 < 0.3 ? '#c4572b' : '#8a8a8a', cx + 1, cy + 2, 5, 1);
        p('#b5b0a2', cx + 1, cy + 4, 4, 1); p('#b5b0a2', cx + 1, cy + 6, 3, 1);
        // Idle flutter: one card at a time lifts its bottom corner (4 s cycle), not while the player is here.
        if (an && !k.near && L && ((f >> 5) % L) === i) {
          const ph = f & 31;
          if (ph < 4) { const big = ph === 1 || ph === 2; p('#c89a5a', cx + 6, cy + 7, 1, 1); p('#d9d2bd', cx + 5, cy + 6, 1, 1); if (big) { p('#c89a5a', cx + 5, cy + 7, 1, 1); p('#c89a5a', cx + 6, cy + 6, 1, 1); p('#d9d2bd', cx + 4, cy + 6, 1, 1); p('#d9d2bd', cx + 5, cy + 5, 1, 1); } }
        }
        // PAID imprint: an inked box with a bar, stays until the event ages out.
        if (i === tgt && sP >= 0.2 && sP < 2.4) { p(ink, cx + 1, cy + 3, 5, 1); p(ink, cx + 1, cy + 6, 5, 1); p(ink, cx + 1, cy + 3, 1, 4); p(ink, cx + 5, cy + 3, 1, 4); p(ink, cx + 2, cy + 5, 3, 1); }
        p('#c4572b', cx + 3, cy - 1, 2, 2); p('#e86a6a', cx + 3, cy - 1, 1, 1); // pin
      }
      // Red string between pins, with a glint travelling along it (3 s loop); opening sends a gold pulse.
      const path = stringPath(L);
      if (L < 5) { p('#8a6a20', x + 44, y + 5, 1, 1); p('#e8c14a', x + 43, y + 4, 2, 1); } // the brass tack
      if (path.length) {
        const glint = an ? Math.floor(((f % 24) / 24) * path.length * 1.6) : -9, gold = sO < 1.2 ? sO * 70 : -1;
        for (let j = 0; j < path.length; j++) {
          const q = path[j], perkUp = k.near ? -1 : 0;
          const col = gold >= 0 && Math.abs(j - gold) < 4 ? '#f2c230' : j === glint ? '#ff9a8e' : j === glint - 1 ? '#d8574a' : '#b42318';
          p(col, x + q[0], y + q[1] + perkUp, 1, 1);
        }
      }
      // Nib's overnight finds: a pile of sticky notes on the frame's top-left corner (one per find, up to 6),
      // each with a teal Nib dot; the top note lifts now and then as if a draught caught it.
      const n = tray();
      for (let j = 0; j < Math.min(6, n); j++) {
        const nx = x + 1 + j * 2, ny = y - 3 - (j & 1), top = j === Math.min(6, n) - 1, up = top && an && (f % 24) < 2 ? 1 : 0;
        p('#e8c14a', nx, ny + 3 - up, 5, 1); p(j & 1 ? '#fff3c8' : '#ffe28a', nx, ny - up, 5, 3); p('#6fd6a6', nx + 3, ny + 1 - up, 1, 1);
      }
      if (n > 6) p('#c4572b', x + 14, y - 4, 1, 1);
      // Squad lamp.
      p(!an || f % 10 < 5 ? '#4cf08a' : '#1f5a36', x + w - 5, y + h - 4, 3, 2);
      // Float: a quick note pinned at the right end.
      if (sF < 1.4) { const s = back(sF / 0.25); p('#fff3c8', x + w - 9, y + 4 + Math.round((1 - s) * 3), 5, Math.max(1, Math.round(4 * s))); p('#c4572b', x + w - 7, y + 3, 1, 1); }
      // The stamp: wind-up, fast slam with a streak, impact dust, lift away. Coins arc out after impact.
      if (tgt >= 0) {
        const cx = x + 4 + tgt * 9, top = y + 5;
        let sy = null;
        if (sP < 0.1) sy = top - 9 - Math.round(sP / 0.1 * 2);
        else if (sP < 0.2) { const t = (sP - 0.1) / 0.1; sy = Math.round(top - 11 + t * t * 11); if (t < 0.9) { p('rgba(241,230,200,.45)', cx + 3, sy - 6, 1, 5); p('rgba(241,230,200,.25)', cx + 2, sy - 3, 1, 3); } }
        else if (sP < 0.32) sy = top;
        else if (sP < 0.7) sy = top - Math.round(out3((sP - 0.32) / 0.38) * 12);
        if (sy != null) { p('#5a3a22', cx + 2, sy - 6, 3, 3); p('#8a5e3a', cx + 3, sy - 3, 1, 2); p('#8a5e3a', cx, sy - 1, 7, 2); p(ink, cx, sy + 1, 7, 1); }
        if (sP >= 0.2 && sP < 0.5) { const d = Math.round((sP - 0.2) / 0.3 * 3); p('#f1e6c8', cx - 1 - d, y + 11, 1, 1); p('#f1e6c8', cx + 7 + d, y + 11, 1, 1); p('#e0d2b4', cx - 2 - d, y + 9, 1, 1); p('#e0d2b4', cx + 8 + d, y + 9, 1, 1); }
        const coins = crit ? 5 : 3;
        for (let j = 0; j < coins; j++) {
          const t = (sP - 0.25 - j * 0.05) / 0.7; if (t < 0 || t > 1.3) continue;
          const ux = cx + 3 + (j - (coins - 1) / 2) * 3 * out3(t), uy = top - 2 - out3(t) * 12 + (t > 1 ? (t - 1) * 20 : 0);
          p('#f2c230', ux, uy, 2, 2); p('#fff3c8', ux, uy, 1, 1);
        }
        if (crit && sP < 1.4 && (Math.floor(sP * 10) % 2 === 0)) { [[-6, 2], [w - 2, 4], [10, -6], [w - 14, -8]].forEach(s => { p('#ffe28a', x + s[0], y + s[1] - 1, 1, 3); p('#ffe28a', x + s[0] - 1, y + s[1], 3, 1); }); }
      }
      // Agents: a clip rail above the board; each agent's draft card hangs on it while they work here.
      const ags = k.agents, sAS = ago(k, 'agent-start'), sAD = ago(k, 'agent-done');
      if (ags.length || sAD < 0.9) { p('#39445c', x + 16, y - 13, w - 18, 1); p('#39445c', x + 16, y - 13, 1, 3); p('#39445c', x + w - 3, y - 13, 1, 3); }
      ags.forEach((a, j) => {
        const col = agCol(a), cx = x + 18 + j * 10;
        let cy = y - 12;
        if (a.status === 'walking') { // a reserved spot: dashed outline blinking
          if (!an || f % 4 < 3) { for (let d = 0; d < 7; d += 2) { p(col, cx + d, cy + 1, 1, 1); p(col, cx + d, cy + 7, 1, 1); } p(col, cx, cy + 3, 1, 1); p(col, cx + 6, cy + 3, 1, 1); p(col, cx, cy + 5, 1, 1); p(col, cx + 6, cy + 5, 1, 1); }
          return;
        }
        if (sAS < 0.4 && j === ags.length - 1) cy = Math.round(y - 20 + back(sAS / 0.4) * 8); // drop in, overshoot, settle
        p('#2a2f45', cx + 1, cy + 8, 7, 1);
        p('#fff', cx, cy + 1, 7, 7); p(col, cx, cy + 1, 7, 1); p('#9aa9ab', cx + 3, cy, 1, 2);
        if (SUBMIT[a.tool]) { // submitting: an arrow slides right, card wiggles
          const o = an ? (f % 4) : 0; p('#c4572b', cx + 1 + o, cy + 4, 3, 1); p('#c4572b', cx + 3 + o, cy + 3, 1, 3);
        } else { // writing: lines fill in, the pen dot moves along
          const prog = an ? (f + j * 3) % 18 : 17, lines = [5, 4, 5];
          for (let li = 0; li < 3; li++) { const len = clamp(prog - li * 6, 0, lines[li]); if (len) p('#5b6b8a', cx + 1, cy + 3 + li * 2, len, 1); if (an && len < lines[li] && prog >= li * 6) { p('#1b1b24', cx + 1 + len, cy + 2 + li * 2, 1, 2); break; } }
        }
      });
      if (sAD < 0.9 && !ags.some(a => a.status === 'working')) { // the finished card flies up with a check
        const t = sAD / 0.9, cx = x + 18, cy = Math.round(y - 12 - out3(t) * 8);
        if (t < 0.85) { p('#fff', cx, cy + 1, 7, 7); p('#4cf08a', cx + 1, cy + 5, 1, 1); p('#4cf08a', cx + 2, cy + 6, 1, 1); p('#4cf08a', cx + 3, cy + 5, 1, 1); p('#4cf08a', cx + 4, cy + 4, 1, 1); p('#4cf08a', cx + 5, cy + 3, 1, 1); }
      }
    }
  };

  // =====================================================================================
  // B · Ops radar: a wall scope over a console. A sweep turns every 2 s; each pinned contract is a blip that
  // flares as the beam passes; Nib's finds blink orange on the rim; the contract list on the right lights one
  // row per level. Walking up pings the scope, opening flashes the list, pay flares a blip into a gold ring and
  // fills its row. Agents lock a crosshair on a blip and run a progress bar in their colour on the console.
  // =====================================================================================
  const RC = [12, -7], RR = 5; // radar centre (relative), radius
  const SWEEP = [], RING = {};
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, pts = []; for (let r = 1; r <= RR; r++) pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); SWEEP.push(pts); }
  function ring(r) {
    if (RING[r]) return RING[r];
    const seen = {}, pts = [];
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, px = Math.round(Math.cos(a) * r), py = Math.round(Math.sin(a) * r), key = px + ',' + py; if (!seen[key]) { seen[key] = 1; pts.push([px, py]); } }
    return (RING[r] = pts);
  }
  const BLIPS = [[2, -2], [-3, 1], [1, 3], [-2, -3], [3, 1]];
  const blipDir = BLIPS.map(b => ((Math.round((Math.atan2(b[1], b[0]) + Math.PI / 2) / (Math.PI * 2) * 16) % 16) + 16) % 16);
  const RIM = [[-5, 0], [4, -3], [0, 5], [5, 1], [-4, -3], [-3, 4], [3, 4], [0, -5], [-5, 2], [5, -1], [-2, 5], [2, -5]];
  const B = {
    name: 'Ops radar',
    draw(c, k) {
      const p = painter(c, k), { x, y, w, h } = k, L = lev(k), an = k.anim, f = an ? k.f : 0;
      const sN = ago(k, 'near'), sO = ago(k, 'open'), sP = ago(k, 'pay'), sF = ago(k, 'float'), sAS = ago(k, 'agent-start'), sAD = ago(k, 'agent-done');
      const ox = x + RC[0], oy = y + RC[1];
      const inGlass = (X, Y) => X >= x + 3 && X <= x + 21 && Y >= y - 12 && Y <= y - 2;
      const pay = sP < 2.5 ? lastEv(k, 'pay') : null, tgt = pay && L ? Math.floor(pay.at * 10) % L : -1, crit = !!(pay && pay.data.crit);
      // Console desk (the footprint) and the screen housing rising one tile above it.
      p('#2e3547', x, y + 1, w, h - 1); p('#3a4878', x, y + 1, w, 1); p('#1b1f2b', x, y + h - 2, w, 2);
      p('#39445c', x + 22, y, 4, 1);
      let rim = k.near ? '#6d7fc4' : '#39445c';
      if (crit && sP < 1.2 && Math.floor(sP * 8) % 2 === 0) rim = '#f2c230';
      p('#1b1f2b', x + 2, y - 13, w - 4, 13); p(rim, x + 2, y - 13, w - 4, 1);
      p('#0b2a1f', x + 3, y - 12, 19, 11); p('#0f1630', x + 23, y - 12, 22, 11);
      // Radar: crosshair, rim ring, sweep with a fading trail.
      p('#123d26', ox - RR, oy, RR * 2 + 1, 1); p('#123d26', ox, oy - RR, 1, RR * 2 + 1);
      ring(RR).forEach(q => p('#1f5a36', ox + q[0], oy + q[1], 1, 1));
      const sw = f % 16;
      if (an) for (let tr = 2; tr >= 0; tr--) { const col = tr === 0 ? '#4cf08a' : tr === 1 ? '#2a8a52' : '#1f6a3e'; SWEEP[(sw - tr + 16) % 16].forEach(q => p(col, ox + q[0], oy + q[1], 1, 1)); }
      p(sN < 0.1 ? '#123d26' : '#9ff0c8', ox, oy, 1, 1);
      // Contract blips: bright as the beam passes, then decay.
      for (let i = 0; i < L; i++) {
        const b = BLIPS[i], age = an ? (sw - blipDir[i] + 16) % 16 : 4;
        let col = age < 2 ? '#fff3c8' : age < 7 ? '#f2c230' : '#8a6a20';
        if (i === tgt) col = sP < 0.1 ? '#6a4a20' : sP < 1.6 ? '#fff' : col; // anticipation dip, then flare
        p(col, ox + b[0], oy + b[1], 2, 2);
      }
      // Nib's overnight finds: orange blips blinking on the rim, incoming.
      const n = tray();
      for (let j = 0; j < n; j++) { const q = RIM[j]; if (!an || (f + j * 3) % 8 < 5) p('#ffb07a', ox + q[0], oy + q[1], 1, 1); }
      // Player walks up: a ping ring expands from the centre.
      if (sN >= 0.1 && sN < 0.7) ring(1 + Math.round(out3((sN - 0.1) / 0.6) * 6)).forEach(q => { const X = ox + q[0], Y = oy + q[1]; if (inGlass(X, Y)) p('#9ff0c8', X, Y, 1, 1); });
      // Pay: rings flare out of the paid blip (two for a critical).
      if (tgt >= 0 && sP >= 0.1 && sP < 1.1) {
        const b = BLIPS[tgt];
        [0, crit ? 0.25 : -1].forEach(d => {
          if (d < 0) return; const t = (sP - 0.1 - d) / 0.8; if (t < 0 || t > 1) return;
          ring(1 + Math.round(out3(t) * 6)).forEach(q => { const X = ox + b[0] + q[0], Y = oy + b[1] + q[1]; if (inGlass(X, Y)) p(t < 0.6 ? '#f2c230' : '#8a6a20', X, Y, 1, 1); });
        });
      }
      // Contract list: one row per slot, lit for pinned contracts; a cursor walks the pinned rows.
      const cur = L ? (f >> 3) % L : -1;
      for (let i = 0; i < 5; i++) {
        const ry = y - 11 + i * 2, on = i < L;
        let tag = on ? '#f2c230' : '#1d2742', bar = on ? '#cfd4de' : '#1d2742', len = on ? [14, 10, 16, 12, 9][i] : 16;
        if (on && i === cur && an) bar = '#f1e6c8';
        if (sO < 1.0) { const t = sO - i * 0.05; if (t >= 0 && t < 0.15) { bar = '#fff'; tag = '#fff'; } }
        p(tag, x + 25, ry, 2, 1); p(bar, x + 28, ry, len, 1);
        if (i === tgt) { // pay: the row fills green, then shows a "$"
          const fill = Math.round(out3((sP - 0.1) / 0.5) * 16);
          if (sP >= 0.1) p(crit ? '#e2b93c' : '#4cf08a', x + 28, ry, fill, 1);
          if (sP >= 0.6 && sP < 2.2 && (Math.floor(sP * 6) % 2 === 0)) p(crit ? '#ffe28a' : '#9ff0c8', x + 44, ry - 1, 1, 3);
        }
      }
      if (an && cur >= 0) p('#f1e6c8', x + 24, y - 11 + cur * 2, 1, 1); // cursor
      if (sO < 1.0) { p('#f2c230', x + 23, y - 12, 22, 1); p('#f2c230', x + 23, y - 2, 22, 1); }
      // Float: a text line types across the bottom of the list.
      if (sF < 1.6) p('#ffb07a', x + 25, y - 2, Math.round(out3(sF / 0.5) * 18), 1);
      // Console front: keyboard, a ticker of activity, the squad lamp.
      p('#cfd4de', x + 26, y + 5, 14, 2); p('#9aa9ab', x + 26, y + 6, 14, 1);
      p('#0f1630', x + 3, y + 10, w - 11, 3);
      for (let i = 0; i < w - 13; i++) { const v = ((i + (an ? f : 0)) * 7) % 11; if (v < 4 && (i % 5) !== 4) p(sP < 1.5 && pay ? '#f2c230' : '#ffb347', x + 4 + i, y + 11, 1, 1); }
      p(!an || f % 10 < 5 ? '#4cf08a' : '#1f5a36', x + w - 6, y + 11, 3, 2);
      // Agents: a crosshair locks onto a blip; a progress bar runs on the console in their colour.
      k.agents.forEach((a, j) => {
        const col = agCol(a), b = L ? BLIPS[j % L] : [0, 0], bx = ox + b[0], by = oy + b[1], by2 = y + 4 + j * 2;
        if (j > 2) return;
        if (a.status === 'walking') { // searching: the crosshair drifts in from the rim
          const t = an ? (f % 8) / 8 : 1, d = Math.round(4 - t * 2);
          if (inGlass(bx - d, by - d)) p(col, bx - d, by - d, 1, 1); if (inGlass(bx + 1 + d, by + 1 + d)) p(col, bx + 1 + d, by + 1 + d, 1, 1);
          if (!an || f % 4 < 2) p(col, x + 3, by2, 2, 1);
          return;
        }
        const d = sAS < 0.3 ? 3 - Math.round(out3(sAS / 0.3) * 2) : (an && f % 4 < 2 ? 2 : 1);
        [[-d, -d], [1 + d, -d], [-d, 1 + d], [1 + d, 1 + d]].forEach(q => { const X = bx + q[0], Y = by + q[1]; if (inGlass(X, Y)) p(col, X, Y, 1, 1); });
        p('#1b1f2b', x + 3, by2, 20, 1);
        const prog = an ? ((f + j * 5) % 24) / 23 : 0.6;
        p(SUBMIT[a.tool] ? '#f1e6c8' : col, x + 3, by2, Math.max(1, Math.round(prog * 20)), 1);
      });
      if (sAD < 1.2) { // done: a green check over the first blip, the bar flashes green
        const b = L ? BLIPS[0] : [0, 0], cx = ox + b[0] - 1, cy = oy + b[1] - 1;
        if (Math.floor(sAD * 6) % 2 === 0) { p('#4cf08a', cx, cy + 2, 1, 1); p('#4cf08a', cx + 1, cy + 3, 1, 1); p('#4cf08a', cx + 2, cy + 2, 1, 1); p('#4cf08a', cx + 3, cy + 1, 1, 1); p('#4cf08a', x + 3, y + 4, 20, 1); }
      }
    }
  };

  // =====================================================================================
  // C · Split-flap board: a departures board for contracts. Five columns, one per contract slot; pinned ones
  // show a code on top and a pinned card below, open ones stay blank. Every 2 s one pinned code flips to the
  // next. Walking up cascades your name across (HELLO if it won't fit), opening flips READY, pay flips $$$$$
  // (gold for a critical) and flips back. An agent working here claims a column: its card turns their colour,
  // the code spins while they write and settles to a check when they finish. Nib's finds are amber header lamps.
  // =====================================================================================
  const FONT = {
    A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], H: [5, 5, 7, 5, 5],
    I: [7, 2, 2, 2, 7], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], O: [7, 5, 5, 5, 7], P: [6, 5, 6, 4, 4],
    R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
    Y: [5, 5, 2, 2, 2], N: [6, 5, 5, 5, 5], G: [3, 4, 5, 5, 3], F: [7, 4, 6, 4, 4], J: [1, 1, 1, 5, 2], V: [5, 5, 5, 5, 2],
    '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1], '5': [7, 4, 6, 1, 6],
    '7': [7, 1, 2, 2, 2], '9': [7, 5, 7, 1, 6], $: [3, 6, 7, 3, 6], '>': [4, 2, 1, 2, 4], '!': [2, 2, 2, 0, 2], '+': [0, 2, 7, 2, 0],
    '*': [0, 1, 1, 6, 0] /* check */, ' ': [0, 0, 0, 0, 0]
  };
  const POOL = 'ABCDEHKLPRSTX123457 9'.replace(/ /g, '').split('');
  const glyph = (p, ch, X, Y, col, rows0, rows1) => { // rows0..rows1 (0-5) of the 3x5 glyph only
    const g = FONT[ch] || FONT[' '];
    for (let r = rows0; r < rows1; r++) { const b = g[r]; if (b & 4) p(col, X, Y + r, 1, 1); if (b & 2) p(col, X + 1, Y + r, 1, 1); if (b & 1) p(col, X + 2, Y + r, 1, 1); }
  };
  // One flap tile 7x7 at X,Y: old -> new, phase 0 steady (new), 1 top half new / bottom old under a falling flap, 2 hinge flash.
  function tile(p, X, Y, from, to, phase, col, bg) {
    p(bg, X, Y, 7, 7);
    if (phase === 1) { glyph(p, to, X + 2, Y + 1, col, 0, 2); glyph(p, from, X + 2, Y + 1, col, 3, 5); p('#2c3b66', X, Y + 3, 7, 1); p('#3a4878', X + 1, Y + 4, 5, 1); }
    else { p(phase === 2 ? '#6d7fc4' : '#060a18', X, Y + 3, 7, 1); glyph(p, to, X + 2, Y + 1, col, 0, 5); }
  }
  const memo = { col: {} }; // agent id -> claimed column (kept so "done" lands on the same column)
  function nameWord() {
    const s = window.Stage2?.state?.(), nm = String(s && s.player || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (nm && nm.length <= 5 && nm.split('').every(ch => FONT[ch])) { const pad = Math.floor((5 - nm.length) / 2); return (' '.repeat(pad) + nm + '     ').slice(0, 5); }
    return 'HELLO';
  }
  // A cascade message: column i shows `word[i]` between start_i and end_i, flipping in and out.
  function cascade(s, i, hold) {
    const a = 0.1 + i * 0.05, b = a + hold; // 100 ms wind-up, 50 ms stagger
    if (s < a || s >= b + 0.12) return null;
    if (s < a + 0.06) return { phase: 1, into: true }; if (s < a + 0.12) return { phase: 2, into: true };
    if (s >= b) return { phase: s < b + 0.06 ? 1 : 2, into: false };
    return { phase: 0, into: true };
  }
  const C = {
    name: 'Split-flap board',
    draw(c, k) {
      const p = painter(c, k), { x, y, w } = k, L = lev(k), an = k.anim, f = an ? k.f : 0;
      const sN = ago(k, 'near'), sO = ago(k, 'open'), sP = ago(k, 'pay'), sF = ago(k, 'float'), sAD = ago(k, 'agent-done'), sAS = ago(k, 'agent-start');
      const pay = sP < 2.5 ? lastEv(k, 'pay') : null, crit = !!(pay && pay.data.crit);
      // The newest live message wins: pay > open > near (by recency).
      let msg = null;
      const cands = [];
      if (pay) cands.push({ s: sP, word: crit ? '$!$!$' : '$$$$$', col: crit ? '#ffe28a' : '#4cf08a', hold: 1.6 });
      if (sO < 2.2) cands.push({ s: sO, word: 'READY', col: '#fff3c8', hold: 1.4 });
      if (k.near && sN < 2.2) cands.push({ s: sN, word: nameWord(), col: '#9ff0c8', hold: 1.4 });
      if (sF < 1.8) cands.push({ s: sF, word: ' +++ ', col: '#ffb07a', hold: 1.0 });
      cands.forEach(m => { if (!msg || m.s < msg.s) msg = m; });
      // Housing rising above the footprint, header lamps, feet.
      p('#1b1f2b', x + 3, y + 13, 3, 3); p('#1b1f2b', x + w - 6, y + 13, 3, 3);
      p('#1f2a4a', x, y - 9, w, 22); p('#2c3b66', x + 1, y - 8, w - 2, 1);
      // Wind-up before a cascade: the board shudders 1 px for 100 ms.
      if (msg && msg.s < 0.1) p('#2c3b66', x, y - 10, w, 1);
      // Header: amber lamps for Nib's overnight finds (blinking slowly), crit chases them gold.
      const n = tray();
      for (let j = 0; j < 12; j++) {
        const on = j < n, chase = crit && sP < 1.6 && ((Math.floor(sP * 12) + j) % 4 === 0);
        p(chase ? '#ffe28a' : on ? (!an || (f + j) % 16 < 13 ? '#ffb347' : '#6a4a20') : '#141c38', x + 6 + j * 3, y - 8, 2, 1);
      }
      // Claimed columns for agents working here (first open slot, else from the right).
      const claim = {};
      k.agents.forEach((a, j) => { const col = L + j < 5 ? L + j : 4 - j; if (col >= 0) { claim[col] = a; memo.col[a.id] = col; } });
      const done = sAD < 1.4 ? lastEv(k, 'agent-done') : null, doneCol = done && memo.col[done.data.who] != null ? memo.col[done.data.who] : -1;
      for (let i = 0; i < 5; i++) {
        const X = x + 3 + i * 9, pinned = i < L, ag = claim[i];
        // Idle: the column whose turn it is flips its code (2 s per flip, columns in turn).
        const tick = f >> 4, base = (i * 7 + Math.floor((tick + (L - i)) / Math.max(1, L))) % POOL.length;
        let cur = pinned ? POOL[base] : ' ', prev = pinned ? POOL[(base + POOL.length - 1) % POOL.length] : ' ', ph = 0, col = '#f1e6c8';
        if (pinned && an && L && tick % L === i) { const q = f & 15; ph = q === 0 ? 1 : q === 1 ? 2 : 0; }
        if (!ph) prev = cur;
        if (ag) { // an agent's column: the code spins while they work, their tool's letter shows on every 4th frame
          col = agCol(ag);
          if (ag.status === 'working') { const spin = an ? f >> 1 : 0; cur = (f & 6) === 6 ? (SUBMIT[ag.tool] ? 'S' : 'W') : POOL[(spin + i) % POOL.length]; prev = POOL[(spin + i + POOL.length - 1) % POOL.length]; ph = an ? (f & 1 ? 2 : 1) : 0; if (sAS < 0.3) { cur = '>'; ph = 0; } }
          else { cur = '>'; prev = cur; ph = 0; }
        }
        if (i === doneCol && !ag) { cur = '*'; col = '#4cf08a'; ph = sAD < 0.06 ? 1 : sAD < 0.12 ? 2 : 0; prev = ' '; }
        if (msg) { const m = cascade(msg.s, i, msg.hold); if (m) { const ch = msg.word[i]; if (m.into) { prev = cur; cur = ch; col = msg.col; } else { prev = ch; } ph = m.phase; } }
        tile(p, X, y - 6, prev, cur, an ? ph : 0, col, '#0f1630');
        // Lower row: the pinned contract card (cream with a rust pin), the agent's card, or a blank flap.
        const LY = y + 4;
        p('#0f1630', X, LY, 7, 7); p('#060a18', X, LY + 3, 7, 1);
        if (ag) {
          const blink = ag.status === 'walking' && an && f % 4 >= 2;
          if (!blink) { p(agCol(ag), X + 1, LY + 1, 5, 5); p('#060a18', X + 1, LY + 3, 5, 1); }
          if (ag.status === 'working') { const fill = an ? (f >> 1) % 6 : 3; p('#fff', X + 1, LY + 6 - Math.max(1, fill), 1, Math.max(1, fill)); }
        } else if (pinned) {
          p(i % 2 ? '#f1e6c8' : '#fff', X + 1, LY + 1, 5, 5); p('#b5b0a2', X + 1, LY + 3, 5, 1); p('#c4572b', X + 3, LY, 1, 2);
          if (pay && sP > 0.3 && sP < 2.0) p(crit ? '#e2b93c' : '#4cf08a', X + 2, LY + 4, 3, 1);
        }
      }
      // Separators in the gap row (the level plate draws in the middle), squad lamp at the bottom right.
      p('#141c38', x + 3, y + 2, 12, 1); p('#141c38', x + 33, y + 2, 12, 1);
      p(!an || f % 10 < 5 ? '#4cf08a' : '#1f5a36', x + w - 5, y + 11, 3, 1);
      if (k.near) { p('#f1e6c8', x + 1, y - 7, 1, 19); p('#f1e6c8', x + w - 2, y - 7, 1, 19); } // lit edge while you are here
    }
  };

  FX.add('contract', { a: A, b: B, c: C });
})();
