/* First Office · #17 Pixel iris between chapters. A chunky circle (12 px blocks) closes onto a point, holds on black,
   and the next page opens from one. Stage 1 → office (meet.html, game.js) and the office's chapter changes use it.
   Time-boxed: every phase ends on a timer even if frames stall (a hidden tab), and the canvas never outlives its job. */
window.Iris = (() => {
  'use strict';
  const B = 12, KEY = 'first-office-iris', INK = '#0c0a22'; // Stage 1's ink, so its black and the office's are one black
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOut = t => 1 - (1 - t) * (1 - t), easeIn = t => t * t;
  function layer(block) {
    const cv = document.createElement('canvas'), w = innerWidth, h = innerHeight;
    cv.width = Math.ceil(w / B) * B; cv.height = Math.ceil(h / B) * B; // whole blocks, so the edges step like the rest
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = `position:fixed;left:0;top:0;width:${cv.width}px;height:${cv.height}px;z-index:2147483000;pointer-events:${block ? 'auto' : 'none'};image-rendering:pixelated`;
    document.body.appendChild(cv); return cv;
  }
  // Blocks whose centre lies outside radius r are black. r snaps to whole blocks, so the circle moves in steps.
  function paint(cv, cx, cy, r) {
    const g = cv.getContext('2d'); r = Math.round(r / B) * B;
    g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = INK;
    for (let y = 0; y < cv.height; y += B) for (let x = 0; x < cv.width; x += B) if (Math.hypot(x + B / 2 - cx, y + B / 2 - cy) > r) g.fillRect(x, y, B, B);
  }
  const reach = (cv, cx, cy) => Math.max(...[[0, 0], [cv.width, 0], [0, cv.height], [cv.width, cv.height]].map(([x, y]) => Math.hypot(x - cx, y - cy))) + B;
  // One phase: frames while they come, and a timer that finishes it at its last value if they don't.
  function tween(ms, fn, ease) {
    return new Promise(res => {
      let done = false; const t0 = performance.now(), end = () => { if (done) return; done = true; fn(1); res(); };
      setTimeout(end, ms + 250);
      (function f(t) { if (done) return; const k = Math.min(1, Math.max(0, t - t0) / ms); if (k >= 1) return end(); fn(ease(k)); requestAnimationFrame(f); })(t0);
    });
  }
  // Close onto (cx, cy): the circle opens a touch first (anticipation, 160 ms), then shuts in steps (650 ms).
  // Resolves on black; the canvas stays (and blocks input) until the page goes. If it doesn't, it's removed after 4 s.
  async function close(cx, cy) {
    if (reduced) return;
    const cv = layer(true), R = reach(cv, cx, cy), r0 = R * .8;
    setTimeout(() => cv.remove(), 4000);
    await tween(160, k => paint(cv, cx, cy, r0 + 2 * B * k), easeOut);
    await tween(650, k => paint(cv, cx, cy, (r0 + 2 * B) * (1 - k)), easeIn);
    return cv;
  }
  // Open from (cx, cy) over 700 ms, then the canvas is gone; it never takes input.
  async function open(cx, cy) {
    const cv = layer(false), R = reach(cv, cx, cy);
    paint(cv, cx, cy, 0); document.documentElement.classList.remove('iris-in'); // the page's early black cover hands over
    setTimeout(() => cv.remove(), 2000);
    try { await tween(700, k => paint(cv, cx, cy, R * k), easeOut); } finally { cv.remove(); }
  }
  // Close, mark the next page to open with the iris, hold a beat on black, then go. onBlack swaps in the page's own
  // black (Stage 1's chapter card) under the iris before the canvas goes.
  async function go(nav, cx, cy, hold = 150, onBlack) {
    if (reduced) return nav();
    const cv = await close(cx, cy);
    try { sessionStorage.setItem(KEY, '1'); } catch {}
    if (onBlack) { onBlack(); cv.remove(); }
    setTimeout(nav, hold);
  }
  // True once, on the page right after go(). Clears the mark either way (a page may have taken it early: html[data-iris]).
  function arrived() {
    let v = document.documentElement.dataset.iris; delete document.documentElement.dataset.iris;
    try { v = v || sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch {}
    if (!v || reduced) document.documentElement.classList.remove('iris-in');
    return !!v && !reduced;
  }
  return { close, open, go, arrived, KEY };
})();
