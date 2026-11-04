/* One animation loop for the office page (PERF_PLAN phase 1). Each system adds a tick(now) instead of running its own
   requestAnimationFrame. A tick returns true while it still wants frames; when none does, the loop sleeps until
   Loop.wake(). Ticks run in the order they were added, and one that throws is logged and kept, so it can't stop the rest.
   While awake it runs at the screen's rate: a frame cap (120 Hz → 60 fps) made walking and the follow camera visibly
   choppy on high-refresh screens. Everything moves by elapsed time, so speeds don't depend on the rate. */
(function () {
  'use strict';
  const subs = [];
  let raf = 0, ticking = false, woken = false, chained = false, prev = 0; // chained: this frame was asked for by the last one
  function frame(now) {
    raf = 0;
    let more = false; ticking = true; woken = false;
    const t0 = performance.now(), ms = {}; // per tick, for the lag log (lag.js)
    for (const s of subs.slice()) {
      if (s.off) continue;
      const a = performance.now();
      try { if (s.fn(now)) more = true; } catch (e) { console.error('loop:', e); more = true; }
      const k = s.fn.name || 'tick'; ms[k] = (ms[k] || 0) + performance.now() - a;
    }
    ticking = false;
    window.Lag?.frame(performance.now() - t0, ms, chained ? now - prev : null); // the gap only counts while the loop runs on
    prev = now; chained = more || woken;
    if (chained) raf = requestAnimationFrame(frame);
  }
  // A wake from inside a tick asks for the next frame once the tick is done, so it never starts a second chain.
  function wake() { if (ticking) woken = true; else if (!raf) raf = requestAnimationFrame(frame); }
  window.Loop = {
    // Returns a function that removes the tick.
    add(fn) { const s = { fn }; subs.push(s); wake(); return () => { s.off = true; const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); }; },
    wake,
  };
  // Input can start motion in any system: wake on it so the first frame isn't late.
  for (const ev of ['keydown', 'pointerdown', 'resize', 'focus']) addEventListener(ev, wake, true);
  document.addEventListener('visibilitychange', wake);
})();
