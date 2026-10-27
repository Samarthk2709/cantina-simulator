/* Talking text (motion #11): Nib's lines type out like speech. ~28 ms a character, a breath after commas (140 ms) and
   full stops (260 ms), and the words that matter (money, CRITICAL, grades, %, rep) arrive whole in amber with a bump.
   Shared by Stage 1 (meet.html) and the office (nib.js bubble/strip, game.js dock line).
   The whole line is in the DOM from the start, untyped characters just invisible (.talk-u), so the box never changes
   size as it types, textContent is the full line, and screen readers get it once instead of per character. */
(function () {
  'use strict';
  const CHAR = 28, COMMA = 140, STOP = 260, WORD = 220; // the mockup's timings (work/motion-ideas, #11)
  const KEY = /\$\d+(?:,\d{3})*(?:\.\d+)?k?|\b(?:CRITICAL|[Cc]riticals?)\b|\b[SABC] grade\b|[+−]?\b\d+(?:\.\d+)?%|[+−]?\b\d+ rep\b|\bElite\b/g;
  const BUMP = [{ transform: 'translateY(4px) scale(.8)', opacity: 0 }, { transform: 'translateY(-3px) scale(1.15)', opacity: 1, offset: .5 }, { transform: 'none', opacity: 1 }];
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The pause after a character. Only when the next one is a space or the end: "$1.5" or "3,000" don't pause mid-token.
  function gap(s, i) {
    const c = s[i], n = s[i + 1];
    if (c === '\n') return STOP;
    if (n && !/[\s"'’)]/.test(n)) return CHAR;
    return /[.?!…]/.test(c) ? STOP : /[,;:—]/.test(c) ? COMMA : CHAR;
  }
  // The line as units: one per character, one per key word. ms = the wait after it appears.
  function plan(text) {
    const units = [], plain = (a, b) => { for (let i = a; i < b; i++) units.push({ s: text[i], ms: gap(text, i) }); };
    let at = 0;
    for (const m of text.matchAll(KEY)) { plain(at, m.index); units.push({ s: m[0], kw: true, ms: WORD }); at = m.index + m[0].length; }
    plain(at, text.length);
    return units;
  }
  // How long typing takes (0 under reduced motion): timed lines count their on-screen time from when it ends.
  const ms = text => reduced() ? 0 : plan(text).slice(0, -1).reduce((t, u) => t + u.ms, 0);
  // Types `text` into `el`, replacing whatever was there. Returns {text, typing, done (a promise), finish() (skip to the end)}.
  function type(el, text) {
    if (el.talk) el.talk.finish();
    const units = plan(String(text)), h = { text: String(text), typing: true };
    el.textContent = '';
    for (const u of units) { u.el = document.createElement(u.kw ? 'em' : 'span'); u.el.className = u.kw ? 'talk-kw talk-u' : 'talk-u'; u.el.textContent = u.s; el.appendChild(u.el); }
    el.talk = h;
    let i = 0, timer = 0, end;
    h.done = new Promise(r => { end = r; });
    const show = (u, bump) => { u.el.classList.remove('talk-u'); if (bump && u.kw) u.anim = u.el.animate(BUMP, { duration: 260, easing: 'ease-out' }); };
    const stop = () => { h.typing = false; end(); };
    // A skip shows the rest at once and lands any bump still playing.
    h.finish = () => { if (!h.typing) return; clearTimeout(timer); while (i < units.length) show(units[i++]); units.forEach(u => u.anim && u.anim.finish()); stop(); };
    const tick = () => { const u = units[i++]; show(u, true); if (i < units.length) timer = setTimeout(tick, u.ms); else stop(); };
    if (reduced() || !units.length) h.finish(); else tick(); // reduced motion: the whole line at once, key words still amber
    return h;
  }
  // Types only when the text changed (the dock line is re-rendered all the time).
  function set(el, text) { if (el.talk ? el.talk.text === text : el.textContent === text) return el.talk; return type(el, text); }
  window.Talk = { type, set, ms };
})();
