/* Nib on the office map: the Stage 1 sprite, walking the published office's paths, with a speech bubble.
   Drawn on its own overlay canvas so the published renderer stays byte-for-byte unchanged. */
(function () {
  'use strict';
  // Nib's look lives in avatars.js, shared with Stage 1, the team view and the endings.

  function create(opts) {
    const W = opts.W, world = opts.world, layer = opts.canvas, bubble = opts.bubble, g = layer.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const A = { x: 184, y: 104, path: [], walk: 0, mood: 'idle', face: 'idle', facing: 1, windup: 0, onArrive: null, visible: true, lit: false, hop: null };
    let t = 0, last = 0, f = 0, blinkAt = 3, sayTimer = 0, bubbleOpen = false, bubbleSide = 'left', finish = null;
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
      settle();
      const path = W.findPath(A.x, A.y, x, y, 'office', opts.hidden());
      if (!path.length) { A.x = x; A.y = y; A.path = []; if (onArrive) onArrive(); return; }
      if (reduced) { const end = path[path.length - 1]; A.x = end.x; A.y = end.y; A.path = []; if (onArrive) onArrive(); return; }
      const still = !A.path.length;
      A.path = path.slice(1); A.onArrive = onArrive || null;
      // Anticipation: from a standstill, crouch for ~6 frames facing the way he's going, then walk.
      if (still && A.path.length) { A.windup = 0.1; const w = A.path[0]; if (Math.abs(w.x - A.x) > 0.5) A.facing = w.x < A.x ? -1 : 1; }
      if (!A.path.length && onArrive) { A.onArrive = null; onArrive(); }
    }
    function place(x, y) { A.x = x; A.y = y; A.path = []; A.windup = 0; settle(); }
    function step(dt) {
      if (A.hop !== null) { A.hop += dt; if (A.path.length || A.hop >= 1) A.hop = null; } // squash & stretch hop: a walk cancels it
      if (A.path.length && A.windup > 0) A.windup -= dt;
      else if (A.path.length) {
        const x0 = A.x, y0 = A.y; // #6: this frame's step, for the follow-through's direction
        let budget = 70 * dt;
        while (budget > 0 && A.path.length) {
          const wp = A.path[0], dx = wp.x - A.x, dy = wp.y - A.y, n = Math.hypot(dx, dy);
          if (n < 0.1) { A.path.shift(); continue; }
          const d = Math.min(budget, n); A.x += dx / n * d; A.y += dy / n * d; A.walk += d; budget -= d;
          if (Math.abs(dx) > 0.5) A.facing = dx < 0 ? -1 : 1;
        }
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
      const far = 16 * px;
      return trail.to(x, y, performance.now(), px, bubble.dataset.side === 'left' ? [-far, 6, -far, far] : [-6, far, -far, far]);
    }
    function draw() {
      const dpr = window.devicePixelRatio || 1, w = layer.clientWidth, h = layer.clientHeight;
      if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, layer.width, layer.height);
      if (!A.visible || world.getState().room !== 'office') { bubble.hidden = true; return; }
      const rr = world.roomRect(), lr = layer.getBoundingClientRect(), s = rr.width / 320;
      const px = s; // one art pixel = one world pixel: the avatar is 16×21, like the founder
      const fx = rr.left - lr.left + A.x * s, fy = rr.top - lr.top + A.y * s + 2 * s; // between the feet
      const ox = fx - 8 * px, oy = fy - 21 * px;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
      // Squash & stretch hop: the pose for this frame; the shadow stays on the floor, shrinking and fading as Nib rises.
      const hp = A.hop === null ? null : window.Avatars.hop(A.hop * 1000), rise = hp ? hp.y / 9 : 0;
      g.fillStyle = `rgba(0,0,0,${.35 * (1 - rise / 2)})`; g.beginPath(); g.ellipse(fx, fy, 7 * px * (hp ? hp.sx : 1) * (1 - rise * .4), 2 * px, 0, 0, 7); g.fill();
      if (A.lit) { const gr = g.createRadialGradient(fx, oy + 8 * px, 0, fx, oy + 8 * px, 26 * px); gr.addColorStop(0, 'rgba(127,240,216,.22)'); gr.addColorStop(1, 'rgba(127,240,216,0)'); g.fillStyle = gr; g.fillRect(fx - 30 * px, oy - 20 * px, 60 * px, 60 * px); }
      const crouch = A.path.length > 0 && A.windup > 0, moving = A.path.length > 0 && !crouch;
      const stepN = moving ? ((A.walk / 5) | 0) % 4 : 0, bob = crouch ? -px : moving && !reduced ? (stepN % 2) * px : 0;
      const [lx, ly] = followLean(px); g.translate(lx, ly); // #6: the sprite leans on, its shadow doesn't
      window.Avatars.draw(g, 'nib', fx - (crouch ? A.facing * px : 0), fy, px, { mood: hp && A.mood === 'idle' ? 'happy' : A.face, step: stepN, f, lit: A.mood === 'think' || A.lit, flip: A.facing < 0, bob: hp ? hp.y * px : bob, sx: hp && hp.sx, sy: hp && hp.sy, ...(hp ? {} : lifePose()) });
      g.translate(-lx, -ly);
      if (A.mood === 'sleep' && !reduced) { g.fillStyle = '#d8d0b8'; g.font = Math.round(7 * px) + 'px "Office Pixel", monospace'; g.fillText('z', ox + 17 * px, oy - 2 * px - (t * 4 % 6)); }
      placeBubble(ox + lr.left, oy + lr.top, px);
    }
    function placeBubble(x, y, px) {
      [x, y] = trailBubble(x, y, px); // #6: lags Nib on a spring
      if (bubble.hidden) return;
      // A window is open: Nib speaks from a strip docked on top of it, never over what you're working on.
      const dock = opts.dock && opts.dock();
      bubble.classList.toggle('docked', !!dock);
      if (dock) { bubble.style.left = Math.round(dock.left) + 'px'; bubble.style.width = Math.round(dock.width) + 'px'; bubble.style.top = Math.max(8, Math.round(dock.top - bubble.offsetHeight - 6)) + 'px'; return; }
      bubble.style.width = '';
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight, nibW = 20 * px;
      const vw = innerWidth, margin = 10;
      let side = opts.side ? opts.side() : bubbleSide;
      if (side === 'left' && x - bw - 6 < margin) side = 'right';
      if (side === 'right' && x + nibW + 6 + bw > vw - margin) side = 'left';
      let left = side === 'left' ? x - bw - 6 : x + nibW + 6;
      const avoid = opts.avoid && opts.avoid();
      if (avoid && side === 'left') left = Math.min(left, avoid.left - bw - 8);
      left = Math.max(margin, Math.min(vw - bw - margin, left));
      let top = y - bh * 0.35; top = Math.max(70, Math.min(innerHeight - bh - 100, top));
      bubble.style.left = Math.round(left) + 'px'; bubble.style.top = Math.round(top) + 'px'; bubble.dataset.side = side;
    }
    function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; t += dt; f = (t * 7) | 0;
      step(dt); draw(); requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Bubble: text, optional choices [{label, value}], optional next. Returns a promise of the choice.
    function say(text, o) {
      o = o || {};
      clearTimeout(sayTimer);
      if (finish) finish(false); // a newer line replaces whatever Nib was saying
      const body = bubble.querySelector('.nib-text'), foot = bubble.querySelector('.nib-foot');
      body.textContent = text; foot.innerHTML = '';
      bubble.hidden = false; bubbleOpen = true; bubbleSide = o.side || 'left';
      bubble.classList.toggle('asks', !!(o.choices || o.next));
      setMood(o.mood || 'talk');
      if (!reduced && !o.choices) setTimeout(() => { if (A.mood === 'talk') setMood(o.after || 'idle'); }, Math.min(2400, 40 * text.length));
      else if (o.choices) setTimeout(() => { if (A.mood === 'talk') setMood('think'); }, 900);
      return new Promise(resolve => {
        let settled = false;
        const done = v => { if (settled) return; settled = true; if (finish === done) finish = null; clearTimeout(sayTimer); bubble.hidden = true; bubbleOpen = false; setMood(o.after || 'idle'); resolve(v); };
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
          setTimeout(() => b.focus({ preventScroll: true }), 30);
        } else {
          sayTimer = setTimeout(() => done(true), o.ms || Math.max(2600, 55 * text.length));
        }
      });
    }
    function hush() { clearTimeout(sayTimer); if (finish) finish(false); bubble.hidden = true; bubbleOpen = false; }
    function setMood(m) { A.mood = m; A.face = m; }
    return {
      hop: () => { if (!reduced && !A.path.length) A.hop = 0; }, // squash & stretch: one happy hop on the spot (not mid-walk)
      goTo, place, say, hush, setMood,
      get busy() { return A.path.length > 0; }, get talking() { return bubbleOpen; },
      pos: () => ({ x: A.x, y: A.y }), setLit: v => { A.lit = !!v; }, show: v => { A.visible = !!v; }
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
  window.NibActor = { create };
  window.BubbleTrail = springTrail; // #6: crew.js trails the agents' bubbles with the same spring
})();
