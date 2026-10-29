/* GPU Rig: animated variants. See stations/fx.js for the contract.
   All three keep the original read: three rack cabinets in a row, one lit per level (k.L, 1-3); dark ones wait.
   A rig upgrade (k.L going up) boots the new cabinet: a dark wind-up, a flicker, then its lights come on row by row.
   a  Fan wall: each lit cabinet has a cooling fan that idles, spools up for you, blurs flat out under an agent's
      job and breathes warm exhaust; a payout blows a puff of sparks out of the top vents.
   b  Load meter: the cabinet fronts are LED bar graphs of GPU load with peak caps; they bounce awake when you walk
      up, slam to the top on a payout, run in the agent's colour while one works here and drain when it's done.
   c  Rack robot: a little gantry carriage on a rail over the cabinets tends the blades; it scoots over to greet you,
      shines its lamp when the window is open, drops a coin in on a payout and plugs its cable in for an agent. */
(function () {
  'use strict';
  // Colours are the world's already-toned values (world.js maps its originals through TONE; k.r does not).
  const C = {
    case: '#34363c', inner: '#474a52', slot: '#24262b', offCase: '#2a2f3a', offIn: '#303540',
    g: '#8fbf8a', gd: '#4b5e4d', a: '#ffb347', ad: '#6a4a20', red: '#c98b7a', gold: '#ead79a', gold2: '#f2c230',
    ivory: '#f3ecdc', accent: '#c08a52', accentD: '#8f6b47', accentL: '#cfae86', steel: '#5d6370', steelL: '#8a8f99',
    ink: '#3e3f44', agent: '#9fb3b0'
  };
  const BOOT = 1.2;
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const now = () => performance.now() / 1000;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const c01 = v => cl(v, 0, 1);
  const outCubic = p => 1 - Math.pow(1 - c01(p), 3);
  const h01 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 1000 / 1000; };
  const hashId = s => { s = String(s); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const cabOf = (id, L) => hashId(id) % Math.max(1, Math.min(3, L));
  const cabX = (k, i) => k.x + 1 + i * 16;
  const lastEv = (k, kind) => { for (let i = k.events.length - 1; i >= 0; i--) if (k.events[i].kind === kind) return k.events[i]; return null; };
  const lit = k => Math.max(0, Math.min(3, k.L | 0));
  // Spring in fixed substeps (stable at 8 fps redraws); z < 1 overshoots and settles.
  function spring(o, key, vkey, target, dt, w, z) {
    for (let t = dt; t > 1e-6; t -= 1 / 60) {
      const h = Math.min(1 / 60, t);
      o[vkey] += (w * w * (target - o[key]) - 2 * z * w * o[vkey]) * h; o[key] += o[vkey] * h;
    }
  }
  // Per-variant clock and upgrade tracking.
  function tracker() { return { L: null, upT: -9, upWall: -9, upI: -1, lt: null }; }
  function track(st, k) {
    if (st.L != null && k.L > st.L && k.L <= 3) { st.upT = k.t; st.upWall = now(); st.upI = k.L - 1; }
    st.L = k.L;
    const dt = st.lt == null ? 0 : k.t - st.lt; st.lt = k.t;
    return cl(dt, 0, 0.25);
  }
  const bootP = (st, k, i) => !k.anim || i !== st.upI ? 1 : c01((k.t - st.upT) / BOOT);
  function offCab(c, k, i) {
    const x = cabX(k, i), y = k.y + 1;
    R(c, C.offCase, x, y, 14, 14); R(c, C.offIn, x + 1, y + 1, 12, 12);
    for (let j = 0; j < 3; j++) R(c, C.slot, x + 2, y + 2 + j * 4, 10, 3);
  }
  // The new cabinet powering on: 100 ms dark wind-up with a spark, a flicker, rows light 50 ms apart, a rim flash.
  function drawBoot(c, k, i, p) {
    const x = cabX(k, i), y = k.y + 1, s = p * BOOT, on = s > 0.1 && !(s > 0.16 && s < 0.22);
    R(c, on ? C.case : C.offCase, x, y, 14, 14); R(c, on ? C.inner : C.offIn, x + 1, y + 1, 12, 12);
    if (s < 0.1) R(c, C.a, x + 6, y - 1, 2, 1);
    for (let j = 0; j < 3; j++) {
      R(c, C.slot, x + 2, y + 2 + j * 4, 10, 3);
      const q = s - 0.3 - j * 0.05; if (q <= 0) continue;
      const w = Math.min(8, Math.floor(q * 40));
      if (q < 0.35) R(c, C.ivory, x + 3, y + 3 + j * 4, w, 1);
      else { R(c, C.g, x + 3, y + 3 + j * 4, 2, 1); R(c, C.a, x + 6, y + 3 + j * 4, 2, 1); }
    }
    if (s > 0.75 && s < 0.95) { R(c, C.ivory, x, y, 14, 1); R(c, C.ivory, x, y + 13, 14, 1); R(c, C.ivory, x, y, 1, 14); R(c, C.ivory, x + 13, y, 1, 14); }
  }
  // Which lit cabinet each agent here uses; the newest done-event's cabinet.
  function crewMap(k) {
    const m = [null, null, null], L = lit(k);
    k.agents.forEach(a => { const i = cabOf(a.id, L); if (!m[i] || a.status === 'working') m[i] = a; });
    return m;
  }
  function doneAt(k) {
    const e = lastEv(k, 'agent-done'); if (!e) return { i: -1, s: Infinity };
    return { i: cabOf(e.data.who, lit(k)), s: k.since('agent-done') };
  }
  function check(c, x, y, col) { R(c, col, x, y + 1, 1, 1); R(c, col, x + 1, y + 2, 1, 1); R(c, col, x + 2, y + 1, 1, 1); R(c, col, x + 3, y, 1, 1); R(c, col, x + 4, y - 1, 1, 1); }

  // ---------------------------------------------------------------- a: fan wall
  const fan = (() => {
    const st = tracker(); st.ph = [0, 0, 0]; st.sp = [2.5, 2.5, 2.5];
    // Four blade orientations (22.5 deg apart; the fan has 4-fold symmetry), precomputed once.
    const BL = [0, 1, 2, 3].map(ph => {
      const pts = [];
      for (let n = 0; n < 4; n++) {
        const a = (ph * 22.5 + n * 90 + 10) * Math.PI / 180;
        for (let r = 1; r <= 3; r++) pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
      }
      return pts;
    });
    function draw(c, k) {
      const dt = track(st, k), L = lit(k), crew = crewMap(k), done = doneAt(k);
      const sNear = k.since('near'), sPay = k.since('pay'), pay = lastEv(k, 'pay'), crit = !!(pay && pay.data.crit);
      for (let i = 0; i < 3; i++) {
        if (i >= L) { offCab(c, k, i); continue; }
        const p = bootP(st, k, i); if (p < 1) { drawBoot(c, k, i, p); continue; }
        const x = cabX(k, i), y = k.y + 1, ag = crew[i], col = ag && ag.color || C.agent;
        const working = ag && ag.status === 'working', walking = ag && !working;
        // Fan speed (quarter-turns per second): idle, spooled for you, flat out for an agent's job or a payout.
        let tgt = 2.5;
        if (k.near) tgt = 7; if (k.open) tgt = 9; if (k.night) tgt = 18; if (walking) tgt = Math.max(tgt, 8);
        if (working) tgt = 30; if (sPay < 1.3) tgt = 34;
        if (sNear < 0.1 + i * 0.05) tgt = -5; // anticipation: a small back-tick before spooling up
        st.sp[i] += (tgt - st.sp[i]) * Math.min(1, dt * (tgt > st.sp[i] ? 3 : 1.1));
        st.ph[i] = (st.ph[i] + st.sp[i] * dt) % 4; if (st.ph[i] < 0) st.ph[i] += 4;
        const sp = k.anim ? st.sp[i] : 0, ph = k.anim ? Math.floor(st.ph[i]) : 0;
        R(c, C.case, x, y, 14, 14); R(c, C.inner, x + 1, y + 1, 12, 12);
        // Top vent slits.
        for (let v = 0; v < 4; v++) R(c, C.slot, x + 3 + v * 2, y, 1, 1);
        // Fan bay with rounded corners.
        R(c, C.slot, x + 3, y + 2, 9, 7);
        R(c, C.inner, x + 3, y + 2, 1, 1); R(c, C.inner, x + 11, y + 2, 1, 1); R(c, C.inner, x + 3, y + 8, 1, 1); R(c, C.inner, x + 11, y + 8, 1, 1);
        const fx = x + 7, fy = y + 5;
        if (sp > 15) { // blur: the blades smear into a disc
          for (let q = 0; q < 4; q++) BL[q].forEach(pt => R(c, '#4f535b', fx + pt[0], fy + pt[1], 1, 1));
          if (k.anim && (k.f + i) % 2) BL[(k.f + i) % 4].forEach(pt => R(c, '#6a6e76', fx + pt[0], fy + pt[1], 1, 1));
        } else BL[ph].forEach(pt => R(c, '#9a9ea6', fx + pt[0], fy + pt[1], 1, 1));
        R(c, working || walking ? col : sp > 15 ? C.a : '#c9ccd2', fx, fy, 1, 1);
        // Drive row: two LEDs (as the original) and a status lamp; an agent's job races its colour along it.
        R(c, C.slot, x + 2, y + 10, 10, 2);
        if (working && k.anim) { for (let s = 0; s < 4; s++) R(c, (k.f + s) % 4 === 0 ? C.ivory : col, x + 3 + s * 2, y + 10, 1, 1); }
        else if (k.open) { const w = k.anim ? Math.min(8, Math.floor(c01((k.since('open') - i * 0.05) / 0.4) * 8)) : 8; R(c, C.g, x + 3, y + 10, w, 1); }
        else {
          R(c, !k.anim || (k.f + i * 5) % 7 < 4 ? C.g : C.gd, x + 3, y + 10, 2, 1);
          R(c, sPay < 1 || (k.anim && (k.f + i) % 5 < 2) ? C.a : C.ad, x + 6, y + 10, 2, 1);
        }
        const greet = k.near && (!k.anim || sNear > 0.15 + i * 0.05);
        R(c, walking ? (!k.anim || k.f % 4 < 2 ? col : C.slot) : greet || working ? C.g : C.ad, x + 10, y + 10, 1, 1);
        if (done.i === i && done.s < 1.1 && !working) { R(c, C.slot, x + 4, y + 3, 7, 5); check(c, x + 5, y + 4, C.g); }
        if (!k.anim) continue;
        // Warm exhaust rising out of the vent; more of it the harder the fan works.
        const q = c01(sp / 30);
        for (let n = 0; n < 3; n++) {
          const per = 1.5 - q * 0.6, cyc = k.t / per + n / 3 + i * 0.29, age = cyc % 1;
          const show = q > 0.2 ? n < 1 + q * 2.2 : n === 0 && h01(Math.floor(cyc), i) < 0.45;
          if (!show) continue;
          const yy = y - 1 - Math.floor(age * (5 + q * 4)), xx = x + 4 + n * 3 + (age > 0.5 ? ((n + i) % 2 ? 1 : -1) : 0);
          R(c, age < 0.45 ? (working ? col : '#c9a87c') : '#d6c6aa', xx, yy, 1, 1);
        }
        // Payout: a puff of sparks blows out of the vents, 50 ms apart per cabinet and per spark.
        if (sPay < 1.1) {
          for (let n = 0; n < 4; n++) {
            const a = (sPay - 0.1 - i * 0.05 - n * 0.05) / 0.8; if (a <= 0 || a >= 1) continue;
            const e = outCubic(a), yy = y - 1 - Math.round(e * 10), xx = x + 3 + n * 2.5 + Math.round((n - 1.5) * e * 3);
            const pc = crit ? (n % 2 ? C.gold2 : C.gold) : (n % 2 ? C.g : C.ivory), sz = a < 0.6 ? 2 : 1;
            R(c, pc, xx, yy, sz, sz);
          }
        }
      }
    }
    return { name: 'Fan wall: cooling fans idle, spool up for you, blur under an agent and puff sparks on a payout', draw,
      busy: k => now() - st.upWall < BOOT + 0.1 };
  })();

  // ---------------------------------------------------------------- b: load meter
  const meter = (() => {
    const st = tracker(); st.v = new Float32Array(9); st.vv = new Float32Array(9); st.pk = new Float32Array(9); st.pkT = new Float32Array(9);
    const SEG = [C.g, C.g, C.g, C.a, C.red], DIM = ['#2f3a33', '#2f3a33', '#2f3a33', '#3d3426', '#3d2f2c'];
    function draw(c, k) {
      const dt = track(st, k), L = lit(k), crew = crewMap(k), done = doneAt(k);
      const sNear = k.since('near'), sPay = k.since('pay'), sOpen = k.since('open'), pay = lastEv(k, 'pay'), crit = !!(pay && pay.data.crit);
      for (let i = 0; i < 3; i++) {
        if (i >= L) { offCab(c, k, i); continue; }
        const p = bootP(st, k, i); if (p < 1) { drawBoot(c, k, i, p); continue; }
        const x = cabX(k, i), y = k.y + 1, ag = crew[i], col = ag && ag.color || C.agent;
        const working = ag && ag.status === 'working', walking = ag && !working;
        R(c, C.case, x, y, 14, 14); R(c, C.inner, x + 1, y + 1, 12, 12); R(c, C.slot, x + 2, y + 2, 11, 10);
        for (let cI = 0; cI < 3; cI++) {
          const g = i * 3 + cI, d = g * 0.05;
          const nz = k.anim ? h01(working ? k.f : k.f >> 1, g * 7 + i) : 0.5;
          let tgt = 0.6 + nz * 1.4;
          if (k.night) tgt = 2.4 + nz * 1.8;
          if (k.near) tgt = 2.2 + nz * 1.2;
          if (k.open) tgt = 3.2;
          if (walking) tgt = Math.max(tgt, 1.6);
          if (working) tgt = 2.8 + nz * 2.4;
          if (sNear < 0.1 + d) tgt = 0; else if (sNear < 0.45 + d) tgt = 5.2; // greet: dip, sweep up, settle
          if (sPay < 0.1 + d) tgt = 0; else if (sPay < 0.7 + d) tgt = 5.5;      // payout: dip, slam to the top
          if (done.i === i && done.s < 1.2 + d) tgt = done.s < 0.1 ? 3 : 0;     // agent done: drain
          if (k.anim) {
            let v = st.v[g], vv = st.vv[g];
            for (let t = dt; t > 1e-6; t -= 1 / 60) { const h = Math.min(1 / 60, t); vv += (256 * (tgt - v) - 11 * vv) * h; v += vv * h; }
            st.v[g] = v; st.vv[g] = vv;
            if (v > st.pk[g]) { st.pk[g] = v; st.pkT[g] = k.t; } else if (k.t - st.pkT[g] > 0.35) st.pk[g] = Math.max(v, st.pk[g] - 4 * dt);
          } else { st.v[g] = tgt; st.pk[g] = tgt; }
          const n = cl(Math.round(st.v[g]), 0, 5), bx = x + 2 + cI * 4;
          const scan = k.open && k.anim ? Math.floor(sOpen * 6) % 6 : -1;
          for (let s = 0; s < 5; s++) {
            const yy = y + 10 - s * 2;
            let colS = s < n ? SEG[s] : DIM[s];
            if (s < n && working && s < 3) colS = col;
            if (s === 0 && walking && (!k.anim || k.f % 4 < 2)) colS = col;
            if (s < n && s === scan) colS = C.ivory;
            if (s < n && crit && sPay > 0.1 + d && sPay < 0.3 + d) colS = C.gold;
            R(c, colS, bx, yy, 3, 1);
          }
          const pk = Math.min(4, Math.floor(st.pk[g]));
          if (k.anim && st.pk[g] > 1 && pk >= n) R(c, crit && sPay < 2 ? C.gold2 : C.ivory, bx, y + 10 - pk * 2, 3, 1);
        }
        // Bottom lip: the cabinet's status lamp (amber idle, green when you're here or it's in use).
        R(c, k.near || working || k.open ? C.g : (k.anim && (k.f + i * 3) % 12 < 1 ? C.a : C.ad), x + 11, y + 12, 1, 1);
        if (done.i === i && done.s < 1.2 && !working) check(c, x + 5, y + 4, C.ivory);
      }
    }
    return { name: 'Load meter: LED bar graphs of GPU load bounce awake for you, slam on a payout, run in an agent\'s colour', draw,
      busy: k => now() - st.upWall < BOOT + 0.1 };
  })();

  // ---------------------------------------------------------------- c: rack robot
  const robot = (() => {
    const st = tracker(); Object.assign(st, { cx: null, cv: 0, arm: 0, av: 0, tx: null, windT: -9, dir: 0 });
    function draw(c, k) {
      const dt = track(st, k), L = lit(k), crew = crewMap(k), done = doneAt(k);
      const sNear = k.since('near'), sPay = k.since('pay'), pay = lastEv(k, 'pay'), crit = !!(pay && pay.data.crit);
      const ctr = i => k.x + 8 + i * 16;
      // Where the carriage wants to be and how far its arm reaches (0 = up; 3 + 4j = blade j).
      let tx = ctr(0), tArm = 0, poke = -1, pokeCab = -1, eye = C.g, look = 0, beam = false, cable = null;
      const busyAg = k.agents.find(a => a.status === 'working') || k.agents[0];
      if (k.anim) { // idle patrol: trundle to a cabinet, lower the arm, check a blade, raise it
        const P = k.night ? 1.9 : 3.2, n = Math.floor(k.t / P), ph = (k.t % P) / P;
        pokeCab = Math.floor(h01(n, 3) * L); tx = ctr(pokeCab);
        const j = Math.floor(h01(n, 11) * 3);
        if (ph > 0.42 && ph < 0.82) { tArm = 3 + j * 4; if (ph > 0.55 && ph < 0.78) poke = j; }
        eye = k.f % 16 < 1 ? C.slot : C.a;
      }
      if (k.night) eye = C.a;
      if (k.near) { tx = k.x + 6; tArm = 0; poke = -1; eye = C.g; look = -1;
        if (k.anim && sNear > 0.35 && sNear < 1.0) tArm = Math.floor(sNear * 8) % 2 ? 3 : 0; } // a two-bob wave
      if (k.open) { tx = ctr(Math.floor((L - 1) / 2)); tArm = 0; poke = -1; eye = C.ivory; beam = true; look = 0; }
      if (busyAg) {
        const i = cabOf(busyAg.id, L), col = busyAg.color || C.agent;
        tx = ctr(i); pokeCab = i; poke = -1; eye = busyAg.status === 'working' || !k.anim || k.f % 4 < 2 ? col : C.slot; look = 0;
        if (busyAg.status === 'working') { tArm = 7; cable = col; } else tArm = 2;
      }
      if (sPay < 1.6) { poke = -1; if (crit) eye = C.gold; }
      if (done.s < 1 && !busyAg) { tArm = 0; }
      // Anticipation: a long move first leans back for 100 ms.
      if (st.tx != null && Math.abs(tx - st.tx) > 6) { st.windT = k.t; st.dir = Math.sign(tx - (st.cx == null ? tx : st.cx)); }
      st.tx = tx;
      const wind = k.anim && k.t - st.windT < 0.1;
      if (!k.anim || st.cx == null) { st.cx = tx; st.cv = 0; st.arm = tArm; st.av = 0; }
      else {
        const fast = k.near && sNear < 1.2;
        if (!wind) spring(st, 'cx', 'cv', tx, dt, fast ? 22 : 12, fast ? 0.5 : 0.62);
        spring(st, 'arm', 'av', tArm, dt, 24, 0.55);
      }
      const cxp = Math.round(st.cx), arm = Math.max(0, Math.round(st.arm));
      // Cabinets, as the original: three blades each with a green and an amber LED.
      const raceCab = busyAg && busyAg.status === 'working' ? cabOf(busyAg.id, L) : -1;
      const under = cl(Math.round((cxp - k.x - 8) / 16), 0, Math.max(0, L - 1));
      for (let i = 0; i < 3; i++) {
        if (i >= L) { offCab(c, k, i); continue; }
        const p = bootP(st, k, i); if (p < 1) { drawBoot(c, k, i, p); continue; }
        const x = cabX(k, i), y = k.y + 1, ag = crew[i], col = ag && ag.color || C.agent;
        R(c, C.case, x, y, 14, 14); R(c, C.inner, x + 1, y + 1, 12, 12);
        for (let j = 0; j < 3; j++) {
          R(c, C.slot, x + 2, y + 2 + j * 4, 10, 3);
          let gC = !k.anim || (k.f + j * 3 + i * 5) % 7 < 4 ? C.g : C.gd, aC = k.anim && (k.f + j + i) % 5 < 2 ? C.a : C.ad;
          if (i === raceCab || (ag && ag.status === 'working')) { gC = (k.f + j) % 3 === 0 ? C.ivory : col; aC = (k.f + j) % 3 === 1 ? C.a : C.ad; }
          if (k.anim && i === under && sPay > 0.55 + j * 0.05 && sPay < 1.05 + j * 0.05) { gC = crit ? C.gold : C.g; aC = crit ? C.gold : C.g; R(c, crit ? C.gold2 : C.g, x + 9, y + 3 + j * 4, 2, 1); }
          R(c, gC, x + 3, y + 3 + j * 4, 2, 1); R(c, aC, x + 6, y + 3 + j * 4, 2, 1);
          if (poke === j && i === under && Math.abs(st.arm - tArm) < 0.8) R(c, k.f % 2 ? C.ivory : '#c9ccd2', x + 9, y + 3 + j * 4, 2, 1);
        }
        if (done.i === i && done.s < 1 && !(ag && ag.status === 'working')) check(c, x + 9, y + 9, C.g);
      }
      // Lamp beam while the window is open (flat translucent rows, no gradient).
      if (beam) { c.fillStyle = 'rgba(243,236,220,.18)'; for (let r = 0; r < 14; r++) { const w = 3 + r; c.fillRect(cxp - (w >> 1), k.y + r, w, 1); } }
      // Arm: a cable down from the carriage with a gripper at the tip; an agent's job runs data up it.
      if (arm > 0) {
        R(c, cable || C.ink, cxp, k.y - 1, 1, arm + 1);
        R(c, C.steelL, cxp - 1, k.y + arm, 3, 1);
        if (cable && k.anim) { for (let n = 0; n < 2; n++) { const yy = k.y + arm - 1 - ((k.f * 2 + n * 4) % (arm + 1)); if (yy >= k.y - 1) R(c, C.ivory, cxp, yy, 1, 1); } }
      }
      // Rail with end posts.
      R(c, C.steel, k.x + 1, k.y - 1, 46, 1); R(c, C.steelL, k.x + 1, k.y - 2, 46, 1);
      R(c, C.steel, k.x + 1, k.y - 2, 1, 3); R(c, C.steel, k.x + 46, k.y - 2, 1, 3);
      // Carriage: hop on a payout (squash, rise, land), lean during wind-up, smear when it zips.
      let by = k.y - 6, lean = 0;
      if (k.anim && sPay < 0.6) { const s = sPay; by += s < 0.1 ? 1 : s < 0.38 ? -Math.round(Math.sin((s - 0.1) / 0.28 * Math.PI) * 3) : s < 0.48 ? 1 : 0; }
      if (wind) lean = -st.dir;
      const bx = cxp - 3 + lean;
      if (k.anim && Math.abs(st.cv) > 70) { const sd = -Math.sign(st.cv); c.globalAlpha = 0.35; R(c, C.accent, bx + sd * 3, by + 1, 7, 3); c.globalAlpha = 0.15; R(c, C.accent, bx + sd * 6, by + 1, 7, 3); c.globalAlpha = 1; }
      R(c, C.accentD, bx, by, 7, 4); R(c, C.accent, bx, by, 7, 3); R(c, C.accentL, bx + 1, by, 5, 1);
      R(c, C.slot, bx + 2, by + 1, 3, 1); R(c, eye, bx + 3 + look, by + 1, 1, 1);
      R(c, C.slot, bx + 1, by + 4, 1, 1); R(c, C.slot, bx + 5, by + 4, 1, 1);
      if (done.s < 1 && !busyAg) check(c, cxp - 2, by - 4, C.g);
      // Payout: coins drop from the carriage into the cabinet under it, 50 ms apart (three and gold on a critical).
      if (k.anim && sPay < 0.9) {
        for (let n = 0; n < (crit ? 3 : 1); n++) {
          const a = (sPay - 0.3 - n * 0.05) / 0.25; if (a <= 0 || a >= 1) continue;
          R(c, crit ? C.gold2 : C.gold, cxp - 1 + (n - (crit ? 1 : 0)) * 2, by + 4 + Math.round(a * a * 6), 2, 2);
        }
      }
    }
    return { name: 'Rack robot: a gantry carriage tends the blades, greets you, drops in payouts and plugs in for agents', draw,
      busy: k => now() - st.upWall < BOOT + 0.1 || Math.abs(st.cv) > 4 || Math.abs(st.av) > 4 };
  })();

  window.StationFX?.add('rig', { a: fan, b: meter, c: robot });
})();
