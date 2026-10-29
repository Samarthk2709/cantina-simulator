/* Nib on the office map: the Stage 1 sprite, walking the published office's paths, with a speech bubble.
   Drawn on its own overlay canvas so the published renderer stays byte-for-byte unchanged. */
(function () {
  'use strict';
  // Nib's look lives in avatars.js, shared with Stage 1, the team view and the endings.
  // talk.js (#11) didn't load: lines appear whole, through the same handle (already finished), so nothing else breaks.
  window.Talk = window.Talk || { type: (el, t) => (el.textContent = t, el.talk = { text: t, typing: false, said: t.length, done: Promise.resolve(), finish() {}, hurry() {} }),
    set: (el, t) => el.talk && el.talk.text === t ? el.talk : window.Talk.type(el, t) };

  function create(opts) {
    const W = opts.W, world = opts.world, layer = opts.canvas, bubble = opts.bubble, g = layer.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches, dust = window.FloorDust;
    const A = { x: 184, y: 104, path: [], walk: 0, mood: 'idle', face: 'idle', facing: 1, windup: 0, onArrive: null, visible: true, lit: false, hop: null };
    let t = 0, last = 0, f = 0, blinkAt = 3, sayTimer = 0, bubbleOpen = false, bubbleSide = 'left', finish = null;
    // Dirty redraws (PERF_PLAN phase 3): the canvas is redrawn only when what it shows changed, the bubble placed only when
    // it or Nib moved. poke() marks both dirty and wakes the loop from a microtask, so a call made inside another tick
    // doesn't wake the loop mid-frame.
    let dirty = true, placeDirty = true, queued = false;
    const poke = () => { dirty = placeDirty = true; if (queued) return; queued = true; queueMicrotask(() => { queued = false; window.Loop.wake(); }); };
    // The bubble's size (content, a window docking it) and a window opening or closing (where it docks) aren't Nib's calls.
    if (window.ResizeObserver) new ResizeObserver(poke).observe(bubble);
    new MutationObserver(poke).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
    // Idle life (motion #8): standing still, Nib breathes a pixel; when nothing's going on, a blink may turn into a glance.
    // Draw-only: A.facing is never touched, and the glance ends the moment he walks, talks, changes mood or a scene starts.
    let stillAt = 0, busyAt = 0, wasBlink = false, glance = 0;
    const scene = () => { const u = window.Stage2 && window.Stage2.ui(); return !u || u.busy || u.morning || u.night; };
    function idleLife() {
      if (A.path.length) stillAt = t;
      if (A.path.length || bubbleOpen || A.mood !== 'idle' || A.lit || !A.visible || scene()) { busyAt = t; glance = 0; }
      const blink = A.face === 'blink';
      // A turn happens on a blink, like a head turn; the next blink turns him back. Quiet for 3 s first.
      if (blink && !wasBlink && !reduced) glance = glance || t - busyAt < 3 || Math.random() > 0.35 ? 0 : Math.random() < 0.5 ? 1 : -1;
      wasBlink = blink;
    }
    // Pose for Avatars.draw: breath once he's been still half a second (slower asleep); a glance looks ahead, or turns and looks back.
    function lifePose() {
      if (reduced || A.path.length || t - stillAt < 0.5) return {};
      const P = A.mood === 'sleep' ? 4.6 : 3, pose = { breath: (t / P + 0.37) % 1 > 0.55, look: glance ? 1 : 0 };
      if (glance < 0) pose.flip = A.facing > 0;
      return pose;
    }

    // A new walk replaces the old one; the old walk's callback still fires so nothing awaits forever.
    function settle() { const cb = A.onArrive; A.onArrive = null; if (cb) cb(); }
    function goTo(x, y, onArrive) {
      poke(); settle();
      const path = W.findPath(A.x, A.y, x, y, 'office', opts.hidden());
      if (!path.length) { A.x = x; A.y = y; A.path = []; if (onArrive) onArrive(); return; }
      if (reduced) { const end = path[path.length - 1]; A.x = end.x; A.y = end.y; A.path = []; if (onArrive) onArrive(); return; }
      const still = !A.path.length;
      A.path = path.slice(1); A.onArrive = onArrive || null;
      // Anticipation: from a standstill, crouch for ~6 frames facing the way he's going, then walk.
      if (still && A.path.length) { A.windup = 0.1; const w = A.path[0]; if (Math.abs(w.x - A.x) > 0.5) A.facing = w.x < A.x ? -1 : 1; }
      if (!A.path.length && onArrive) { A.onArrive = null; onArrive(); }
    }
    function place(x, y) { poke(); A.x = x; A.y = y; A.path = []; A.windup = 0; settle(); }
    function step(dt) {
      if (A.hop !== null && A.hop < 0.7 && A.hop + dt >= 0.7 && !A.path.length && A.visible) dust.land(A.x, A.y + 2); // #10: lands at 700 ms (Avatars.hop)
      if (A.hop !== null) { A.hop += dt; if (A.path.length || A.hop >= 1) A.hop = null; } // squash & stretch hop: a walk cancels it
      if (A.path.length && A.windup > 0) A.windup -= dt;
      else if (A.path.length) {
        const x0 = A.x, y0 = A.y, w0 = A.walk; // #6: this frame's step, for the follow-through's direction
        let budget = 70 * dt;
        while (budget > 0 && A.path.length) {
          const wp = A.path[0], dx = wp.x - A.x, dy = wp.y - A.y, n = Math.hypot(dx, dy);
          if (n < 0.1) { A.path.shift(); continue; }
          const d = Math.min(budget, n); A.x += dx / n * d; A.y += dy / n * d; A.walk += d; budget -= d;
          if (Math.abs(dx) > 0.5) A.facing = dx < 0 ? -1 : 1;
        }
        if (A.visible && (A.walk / 10 | 0) !== (w0 / 10 | 0)) dust.step(A.x, A.y + 2, A.facing); // #10: a footfall on step frames 0 and 2
        if (!A.path.length) followFrom(x0, y0);
        if (!A.path.length && A.onArrive) { const cb = A.onArrive; A.onArrive = null; cb(); }
      }
      if (A.mood === 'idle' && t > blinkAt) { A.face = 'blink'; if (t > blinkAt + 0.14) { A.face = 'idle'; blinkAt = t + 2.5 + Math.random() * 2; } }
      else if (A.mood !== 'idle') A.face = A.mood;
      else A.face = 'idle';
      idleLife();
    }
    // Follow-through (#6): when Nib stops after walking, his body keeps going a moment: 1px on in the travel direction
    // (~6 frames), 1px back (~4 frames), then still. His shadow stays put. The agents do the same (harness.js).
    const FOLLOW = 0.16;
    function followFrom(x0, y0) { const dx = A.x - x0, dy = A.y - y0; A.followAt = t; A.followDir = Math.abs(dy) > Math.abs(dx) ? [0, Math.sign(dy)] : [Math.sign(dx) || A.facing, 0]; }
    function followLean(px) {
      const e = t - A.followAt; // NaN before the first stop
      if (A.path.length || !(e < FOLLOW)) return [0, 0];
      const s = Math.round(px) * (e < 0.09 ? 1 : -1); // whole art pixels on screen, so the sprite stays crisp
      return [A.followDir[0] * s, A.followDir[1] * s];
    }
    // ...and his bubble trails him on a spring instead of being glued on. It springs his anchor point, so placeBubble's
    // margins, avoid rect and side switch still hold. It may close the 6px gap to Nib but never covers him.
    const trail = springTrail();
    function trailBubble(x, y, px) {
      if (reduced || bubble.hidden) { trail.reset(); return [x, y]; } // a fresh bubble starts in place
      const far = 16 * px, box = { left: [-far, 6, -far, far], right: [-6, far, -far, far], above: [-far, far, -far, 6], below: [-far, far, -6, far] }[bubble.dataset.side];
      return trail.to(x, y, performance.now(), px, box || [0, 0, 0, 0]);
    }
    // The docked strip's height, for style.css (--strip): the window shortens so a tall strip never covers its title bar.
    let stripH = 0;
    function strip(h) { h = Math.round(h); if (h === stripH) return false; stripH = h; document.documentElement.style.setProperty('--strip', h + 'px'); return true; }
    // What was last drawn: the canvas's key, Nib's cleared box (device px; null: nothing of his on it), whether dust was
    // on it, and the bubble's placement key and spring position.
    let drawn = '', box = null, dustOn = false, placed = '', trailAt = null, springing = false, bubbleUp = false;
    function draw(force) {
      const dpr = window.devicePixelRatio || 1, w = layer.clientWidth, h = layer.clientHeight;
      let full = false;
      if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); full = true; box = null; dustOn = false; } // a resize blanks it
      const office = world.getState().room === 'office', now = performance.now();
      if (!office) dust.clear();
      const dusty = office && dust.alive(now); // specks fade every frame; drawn under Nib, so the whole canvas is redrawn
      if (!A.visible || !office) {
        if (box || dustOn || dusty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, layer.width, layer.height); box = null; }
        dustOn = false; drawn = ''; springing = false;
        if (dusty) { dust.draw(g, world.roomRect(), layer.getBoundingClientRect(), dpr); dustOn = true; }
        if (!bubble.hidden) bubble.hidden = true;
        strip(0); return;
      }
      const rr = world.roomRect(), lr = layer.getBoundingClientRect(), s = rr.width / 320;
      const px = s; // one art pixel = one world pixel: the avatar is 16×21, like the founder
      const fx = rr.left - lr.left + A.x * s, fy = rr.top - lr.top + A.y * s + 2 * s; // between the feet
      const ox = fx - 8 * px, oy = fy - 21 * px;
      // Squash & stretch hop: the pose for this frame; the shadow stays on the floor, shrinking and fading as Nib rises.
      const hp = A.hop === null ? null : window.Avatars.hop(A.hop * 1000), rise = hp ? hp.y / 9 : 0;
      const crouch = A.path.length > 0 && A.windup > 0, moving = A.path.length > 0 && !crouch;
      const stepN = moving ? ((A.walk / 5) | 0) % 4 : 0, bob = crouch ? -px : moving && !reduced ? (stepN % 2) * px : 0;
      const [lx, ly] = followLean(px); // #6: the sprite leans on, its shadow doesn't
      const mood = hp && A.mood === 'idle' ? 'happy' : A.face, pose = hp ? {} : lifePose();
      const zz = A.mood === 'sleep' && !reduced ? (Math.floor(t * 8) / 8) * 4 % 6 : -1; // the z drifts up in half-px steps at 8 Hz
      const key = [dpr, fx, fy, A.facing, A.lit, A.mood, mood, mood === 'talk' ? f % 2 : 0, crouch, stepN, bob, lx, ly, hp ? [hp.y, hp.sx, hp.sy] : '', pose.breath, pose.look, pose.flip, zz].join();
      if (force || dirty || key !== drawn || dusty || dustOn) {
        dirty = false; drawn = key;
        // Nib's box (CSS px): the lit glow (±30 px, 20 above to 40 below his top), a hop's rise, the z, the lean.
        const nb = [Math.floor((fx - 32 * px - 4) * dpr), Math.floor((oy - 30 * px - 16) * dpr), Math.ceil((fx + 32 * px + 4) * dpr), Math.ceil((fy + 22 * px + 4) * dpr)];
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (full || !box || dusty || dustOn) g.clearRect(0, 0, layer.width, layer.height); // dust is anywhere in the room
        else { const x0 = Math.min(box[0], nb[0]), y0 = Math.min(box[1], nb[1]); g.clearRect(x0, y0, Math.max(box[2], nb[2]) - x0, Math.max(box[3], nb[3]) - y0); }
        box = nb; dustOn = dusty;
        if (dusty) dust.draw(g, rr, lr, dpr); // #10: under every sprite
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
        g.fillStyle = `rgba(0,0,0,${.35 * (1 - rise / 2)})`; g.beginPath(); g.ellipse(fx, fy, 7 * px * (hp ? hp.sx : 1) * (1 - rise * .4), 2 * px, 0, 0, 7); g.fill();
        if (A.lit) { const gr = g.createRadialGradient(fx, oy + 8 * px, 0, fx, oy + 8 * px, 26 * px); gr.addColorStop(0, 'rgba(127,240,216,.22)'); gr.addColorStop(1, 'rgba(127,240,216,0)'); g.fillStyle = gr; g.fillRect(fx - 30 * px, oy - 20 * px, 60 * px, 60 * px); }
        g.translate(lx, ly);
        window.Avatars.draw(g, 'nib', fx - (crouch ? A.facing * px : 0), fy, px, { mood, step: stepN, f, lit: A.mood === 'think' || A.lit, flip: A.facing < 0, bob: hp ? hp.y * px : bob, sx: hp && hp.sx, sy: hp && hp.sy, ...pose });
        g.translate(-lx, -ly);
        if (zz >= 0) { g.fillStyle = '#d8d0b8'; g.font = Math.round(7 * px) + 'px "Office Pixel", monospace'; g.fillText('z', ox + 17 * px, oy - 2 * px - zz); }
      }
      // The bubble: its spring is stepped every frame it's up (cheap); the DOM is read and moved only when something moved.
      const nx = ox + lr.left, ny = oy + lr.top;
      if (bubble.hidden) { springing = false; trailAt = null; if (bubbleUp || placeDirty || force) { bubbleUp = false; placeDirty = false; placed = ''; placeBubble(nx, ny, px, rr); } return; }
      const tr = trailBubble(nx, ny, px), pk = [tr[0], tr[1], nx, ny, px, rr.left, rr.top, rr.width, rr.height, innerWidth, innerHeight].join();
      springing = !!trailAt && (Math.abs(tr[0] - trailAt[0]) > 0.01 || Math.abs(tr[1] - trailAt[1]) > 0.01) || Math.abs(tr[0] - nx) > 0.01 || Math.abs(tr[1] - ny) > 0.01;
      trailAt = tr;
      if (force || placeDirty || !bubbleUp || pk !== placed) { bubbleUp = true; placeDirty = false; placed = pk; placeBubble(nx, ny, px, rr, tr); }
    }
    function placeBubble(x, y, px, room, tr) {
      const nx = x, ny = y; // where Nib is: the side is picked from him, not from the bubble's lagging anchor
      [x, y] = tr || trailBubble(x, y, px); // #6: lags Nib on a spring (draw() steps it)
      if (bubble.hidden) { strip(0); delete bubble.dataset.side; return; }
      // A window is open: Nib speaks from a strip docked on top of it, never over what you're working on.
      let dock = opts.dock && opts.dock();
      bubble.classList.toggle('docked', !!dock);
      if (dock) {
        bubble.style.width = Math.round(dock.width) + 'px';
        const bh = bubble.offsetHeight;
        if (strip(bh)) dock = opts.dock(); // the window may have shortened to make room
        bubble.style.left = Math.round(dock.left) + 'px'; bubble.style.top = Math.max(8, Math.round(dock.top - bh - 6)) + 'px'; return;
      }
      strip(0); bubble.style.width = '';
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight, nibW = 20 * px, nibH = 23 * px, vw = innerWidth, margin = 10, cur = bubble.dataset.side;
      // Beside Nib when it fits, else above or below him (phones), on the side that covers less of the office, never on him.
      // A line waiting for your answer may cover the dock: you answer it first. Hysteresis: the side it's on holds until it
      // misses by more than the 6px gap, so a spring overshoot can't flip it.
      const floor = innerHeight - 8 - (bubble.classList.contains('asks') ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-top')) || 100);
      const spare = { left: nx - bw - 6 - margin, right: vw - margin - nx - nibW - 6 - bw, above: ny - bh - 6 - 70, below: floor - ny - nibH - 6 - bh };
      const fit = sd => spare[sd] >= (sd === cur ? -6 : 0), pref = opts.side ? opts.side() : bubbleSide;
      const cover = (a, b) => room ? Math.max(0, Math.min(b, room.top + room.height) - Math.max(a, room.top)) : 0;
      const vert = cover(ny - bh - 6, ny - 6) <= cover(ny + nibH + 6, ny + nibH + 6 + bh) ? ['above', 'below'] : ['below', 'above'];
      if (cur === vert[1]) vert.reverse();
      const side = [pref, pref === 'left' ? 'right' : 'left', ...vert].find(fit) || (spare.above > spare.below ? 'above' : 'below');
      let left, top;
      if (side === 'above' || side === 'below') {
        left = x + 8 * px - bw / 2;
        top = Math.max(8, Math.min(innerHeight - bh - 8, side === 'above' ? y - bh - 6 : y + nibH + 6));
      } else {
        left = side === 'left' ? x - bw - 6 : x + nibW + 6;
        const avoid = opts.avoid && opts.avoid();
        if (avoid && side === 'left') left = Math.min(left, avoid.left - bw - 8);
        top = Math.max(70, Math.min(innerHeight - bh - 100, y - bh * 0.35));
      }
      left = Math.max(margin, Math.min(vw - bw - margin, left));
      bubble.style.left = Math.round(left) + 'px'; bubble.style.top = Math.round(top) + 'px'; bubble.dataset.side = side;
    }
    // t (blinks, breath, the lean, the z) keeps real time across the loop's sleeps; movement steps at most 50 ms, and the
    // first step after Nib was idle at most a frame, so a walk asked for after a long sleep doesn't start with a jump.
    let awake = true, timer = 0, timerAt = 0;
    function frame(now) {
      const real = last ? (now - last) / 1000 : 0; last = now; t += real; f = (t * 7) | 0;
      step(Math.min(awake ? 0.05 : 1 / 60, real)); draw();
      awake = !!(A.path.length || A.hop !== null || dustOn || springing || t - A.followAt < FOLLOW);
      if (!awake) { // nothing moves now: sleep until his face or breath next changes
        const due = nextChange();
        if (due !== timerAt) { clearTimeout(timer); timerAt = due; timer = due < Infinity ? setTimeout(() => { timer = 0; timerAt = 0; window.Loop.wake(); }, (due - t) * 1000 + 4) : 0; }
      }
      return awake;
    }
    // When (in t) Nib's still pose next changes: a blink starts or ends, a breath turns, his mouth moves, the z rises.
    function nextChange() {
      let d = Infinity;
      if (A.mood === 'idle') d = A.face === 'blink' ? blinkAt + 0.14 : blinkAt;
      if (A.face === 'talk') d = Math.min(d, (f + 1) / 7);
      if (A.mood === 'sleep' && !reduced) d = Math.min(d, (Math.floor(t * 8) + 1) / 8);
      if (!reduced && !A.path.length) {
        if (t - stillAt < 0.5) d = Math.min(d, stillAt + 0.5);
        else { const P = A.mood === 'sleep' ? 4.6 : 3, u = (t / P + 0.37) % 1; d = Math.min(d, t + ((u < 0.55 ? 0.55 : 1) - u) * P); }
      }
      return Math.max(d, t + 0.02);
    }
    window.Loop.add(frame);

    // Bubble: text, optional choices [{label, value}], optional next. Returns a promise of the choice.
    function say(text, o) {
      o = o || {};
      clearTimeout(sayTimer);
      if (finish) finish(false); // a newer line replaces whatever Nib was saying
      const body = bubble.querySelector('.nib-text'), foot = bubble.querySelector('.nib-foot');
      const id = ++sayN, typed = sayType(body, text); foot.innerHTML = '';
      bubble.hidden = false; bubbleOpen = true; bubbleSide = o.side || 'left';
      bubble.classList.toggle('asks', !!(o.choices || o.next));
      setMood(o.mood || 'talk');
      // #11: he talks while the line types, then settles, or thinks over the choices.
      if (!reduced && !o.choices) typed.done.then(() => { if (id === sayN && A.mood === 'talk') setMood(o.after || 'idle'); });
      else if (o.choices) typed.done.then(() => setTimeout(() => { if (id === sayN && A.mood === 'talk') setMood('think'); }, 300));
      return new Promise(resolve => {
        let settled = false;
        const done = v => { if (settled) return; settled = true; poke(); if (finish === done) finish = null; clearTimeout(sayTimer); typed.finish(); bubble.hidden = true; bubbleOpen = false; setMood(o.after || 'idle'); resolve(v); };
        finish = done;
        if (o.choices) {
          o.choices.forEach((c, i) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'nib-choice'; b.innerHTML = '<kbd>' + (i + 1) + '</kbd>';
            b.appendChild(document.createTextNode(c.label)); b.addEventListener('click', () => done(c.value)); foot.appendChild(b);
          });
          // Focus the bubble, not a choice, so a stray Enter or Space can't pick an answer.
          setTimeout(() => bubble.focus({ preventScroll: true }), 30);
        } else if (o.next) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'accent nib-next'; b.dataset.icon = 'arrow';
          b.innerHTML = (o.nextLabel || 'Next') + ' <kbd>Enter</kbd>'; b.addEventListener('click', () => done(true)); foot.appendChild(b);
          // #11: Next is hidden while the line types, so the bubble holds focus (Enter skips), then hands it to Next.
          setTimeout(() => (typed.typing ? bubble : b).focus({ preventScroll: true }), 30);
          typed.done.then(() => { if (!settled && [bubble, document.body].includes(document.activeElement)) b.focus({ preventScroll: true }); });
        } else {
          // #11: a timed line's time on screen counts from when it has finished typing.
          typed.done.then(() => { if (!settled) sayTimer = setTimeout(() => done(true), o.ms || Math.max(2600, 55 * text.length)); });
        }
        // Place the new line now: a line said after this frame's draw (an arrival callback) would paint once at the old size.
        poke(); draw(true);
      });
    }
    function hush() { poke(); clearTimeout(sayTimer); if (finish) finish(false); bubble.hidden = true; bubbleOpen = false; }
    // Talking text (#11): the line types out (talk.js); choices and Next stay hidden (.typing) until it's done.
    // A click on the bubble, Enter or 1-3 (game.js) finishes it at once.
    let sayN = 0;
    function sayType(body, text) {
      const h = window.Talk.type(body, text), n = sayN;
      bubble.classList.toggle('typing', h.typing);
      h.done.then(() => { if (n === sayN) bubble.classList.remove('typing'); });
      return h;
    }
    function skip() { const h = bubble.querySelector('.nib-text').talk; if (!h || !h.typing) return false; h.finish(); return true; }
    bubble.addEventListener('click', e => { if (!bubble.hidden && !e.target.closest('button')) skip(); }); // an answer's click mustn't skip the line it brings
    function setMood(m) { A.mood = m; A.face = m; poke(); }
    return {
      // Squash & stretch: one happy hop on the spot (not mid-walk). If he's walking or the office is covered (a window open),
      // nobody would see it, so opts.faceHop plays it where you're looking (game.js: his dock portrait).
      hop: () => { if (reduced) return; if (!A.path.length) { A.hop = 0; poke(); } if (opts.faceHop && (A.path.length || !A.visible || (opts.covered && opts.covered()))) opts.faceHop(); },
      goTo, place, say, hush, setMood, skip,
      get busy() { return A.path.length > 0; }, get talking() { return bubbleOpen; },
      get typing() { const h = bubble.querySelector('.nib-text').talk; return bubbleOpen && !!h && h.typing; }, // #11
      pos: () => ({ x: A.x, y: A.y }), setLit: v => { A.lit = !!v; poke(); }, show: v => { A.visible = !!v; poke(); }
    };
  }
  // Follow-through (#6): a speech bubble trails its speaker on a spring (the mockup's: stiffness 72/s², damping 12/s,
  // so ζ≈0.7 and a ~2px overshoot), stepped in ≤1/120 s slices so it feels the same at any frame rate. `box` caps the
  // lag in screen px around the anchor [minX, maxX, minY, maxY]; at a cap the bubble moves with its speaker, so it
  // carries on a little when they stop. A reset, a teleport or a long gap puts it straight in place.
  function springTrail() {
    let on = false, x = 0, y = 0, vx = 0, vy = 0, ax = 0, ay = 0, at = 0;
    return {
      reset() { on = false; },
      to(tx, ty, now, unit, box) {
        const dt = Math.min(0.05, (now - at) / 1000);
        if (!on || now - at > 200 || Math.hypot(tx - ax, ty - ay) > 40 * unit) { x = tx; y = ty; vx = vy = 0; on = true; }
        else for (let r = dt; r > 1e-6; r -= 1 / 120) {
          const h = Math.min(r, 1 / 120), damp = Math.exp(-12 * h);
          vx = (vx + (tx - x) * 72 * h) * damp; vy = (vy + (ty - y) * 72 * h) * damp; x += vx * h; y += vy * h;
        }
        const ox = Math.max(box[0], Math.min(box[1], x - tx)), oy = Math.max(box[2], Math.min(box[3], y - ty));
        if (ox !== x - tx) { x = tx + ox; vx = dt ? (tx - ax) / dt : 0; }
        if (oy !== y - ty) { y = ty + oy; vy = dt ? (ty - ay) / dt : 0; }
        ax = tx; ay = ty; at = now;
        return [x, y];
      }
    };
  }
  // Footstep dust & landing puffs (#10): 1-art-px specks in floor-dust grey kick up behind a footfall (2) or burst
  // sideways from a hop's landing (6), rise 1–4 px on the mockup's ease-out and fade in 420–580 ms. They live in office
  // world pixels (they stay where they were kicked up) in one ring of 48, so 5 walkers can't grow it, and are drawn on
  // Nib's canvas under everyone (crew.js feeds the agents' steps). None under reduced motion or in a hidden tab.
  function floorDust() {
    const N = 48, P = [], calm = matchMedia('(prefers-reduced-motion: reduce)');
    let at = 0, until = 0, queued = false; // until: when the last speck fades
    function add(x, y, dx, rise, size) {
      const p = P[at] || (P[at] = {}); at = (at + 1) % N;
      Object.assign(p, { x, y, dx, rise, size, t0: performance.now(), life: 420 + Math.random() * 160 });
      until = Math.max(until, p.t0 + p.life);
      if (!queued) { queued = true; queueMicrotask(() => { queued = false; window.Loop.wake(); }); } // crew.js kicks them up too: Nib's canvas wakes to draw them
    }
    const off = () => calm.matches || document.hidden, j = () => Math.random() - 0.5;
    return {
      step(x, y, facing) { if (off()) return; x -= (facing || 1) * 3; for (let i = 0; i < 2; i++) add(x, y, (i - 0.5) - (facing || 1) * 0.5 + j() * 1.3, 2.3 + Math.random() * 1.7, 1); },
      // Three a side, from the feet's edges outward and low, so they clear the body they're drawn under.
      land(x, y) { if (off()) return; for (let i = 0; i < 6; i++) { const side = i < 3 ? -1 : 1, r = i % 3; add(x + side * (4 + r), y, side * (2 + r * 1.5 + Math.random()), 0.5 + r * 0.8 + Math.random(), r ? 1 : 2); } },
      clear() { P.length = 0; at = 0; until = 0; },
      alive: now => now < until, // a speck is still fading: redraw every frame
      // rr: the office's screen rect, lr: the canvas's. Positions round to whole art pixels, so specks step like sprites.
      draw(g, rr, lr, dpr) {
        if (!P.length) return;
        const s = rr.width / 320, now = performance.now(), ox = rr.left - lr.left, oy = rr.top - lr.top;
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#9fb3ba';
        for (const p of P) {
          const k = (now - p.t0) / p.life; if (!(k >= 0 && k < 1)) continue;
          const e = 1 - (1 - k) ** 3; // ≈ the mockup's cubic-bezier(.1,.8,.3,1)
          g.globalAlpha = 0.9 * (1 - k);
          g.fillRect(Math.round(ox + Math.round(p.x + p.dx * e) * s), Math.round(oy + Math.round(p.y - p.size - p.rise * e) * s), Math.ceil(p.size * s), Math.ceil(p.size * s));
        }
        g.globalAlpha = 1;
      }
    };
  }
  window.FloorDust = floorDust();
  window.NibActor = { create };
  window.BubbleTrail = springTrail; // #6: crew.js trails the agents' bubbles with the same spring
})();
