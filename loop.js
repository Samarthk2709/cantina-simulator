/* One animation loop for the office page (PERF_PLAN phase 1). Each system adds a tick(now) instead of running its own
   requestAnimationFrame. A tick returns true while it still wants frames; when none does, the loop sleeps until
   Loop.wake(). Ticks run in the order they were added, and one that throws is logged and kept, so it can't stop the rest.
   On screens above 60 Hz frames closer than ~12 ms to the last one are skipped (120 Hz → 60 fps). Everything moves by
   elapsed time, so speeds don't change. */
(function () {
  'use strict';
  const subs = [], GAP = 12;
  let raf = 0, last = 0, ticking = false, woken = false;
  function frame(now) {
    raf = 0;
    if (last && now - last < GAP) { raf = requestAnimationFrame(frame); return; }
    last = now;
    let more = false; ticking = true; woken = false;
    for (const s of subs.slice()) {
      if (s.off) continue;
      try { if (s.fn(now)) more = true; } catch (e) { console.error('loop:', e); more = true; }
    }
    ticking = false;
    if (more || woken) raf = requestAnimationFrame(frame);
  }
  // A wake from inside a tick asks for the next frame once the tick is done, so it never starts a second chain.
  function wake() { if (ticking) woken = true; else if (!raf) raf = requestAnimationFrame(frame); }
  window.Loop = {
    // Returns a function that removes the tick.
    add(fn) { const s = { fn }; subs.push(s); wake(); return () => { s.off = true; subs.splice(subs.indexOf(s), 1); }; },
    wake,
  };
  // Input can start motion in any system: wake on it so the first frame isn't late.
  for (const ev of ['keydown', 'pointerdown', 'resize', 'focus']) addEventListener(ev, wake, true);
  document.addEventListener('visibilitychange', wake);
})();
