/* Button motion, shared by Stage 1 (meet.html) and the office (index.html).
   #14 Tactile buttons: CSS :active sinks a button (~70 ms, style.css / meet.html); here, on release, it springs back
   past rest by 1-2 px and settles (220 ms). A re-render that swaps the button mid-pop carries the pop on in the new one.
   #15 Attention nudges (office only): a button with something waiting for you wiggles every ~3.5 s, then its badge pops. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = () => document.timeline.currentTime || performance.now();

  // ---------- #14 Tactile buttons ----------
  // Rooms (centred with translate), floor sprites and code lines don't press; disabled buttons never move.
  const TAP = 'button:not(:disabled,.room,.s3-agent,.code-line)';
  const key = b => b.id ? '#' + CSS.escape(b.id) : b.dataset.station ? `[data-station="${b.dataset.station}"]`
    : b.dataset.act ? `[data-act="${b.dataset.act}"]` + (b.dataset.id ? `[data-id="${CSS.escape(b.dataset.id)}"]` : '') : null;
  let held = null, last = null, kb = false; // the button under the press (kb: by Space); the last release {el, key, kf, t}
  function tapPop(el, kf, t) {
    if (el.getAnimations().some(a => a.id === 'tap')) return null;
    const a = el.animate(kf, { id: 'tap', duration: 220 }); a.startTime = t; return a;
  }
  // .pressing mirrors :active, which a touch only gets after a delay and Chrome lifts before pointerup is dispatched:
  // the press shows on the first frame, and is still there to be read on release.
  function hold(el, key) {
    held?.classList.remove('pressing'); held = el; kb = !!key; if (!el) return;
    el.getAnimations().forEach(a => { if (a.id === 'tap') a.cancel(); }); // a quick second press sinks again
    el.classList.add('pressing');
  }
  function release() {
    const el = held; held = null; if (!el) return;
    const cs = getComputedStyle(el), y = parseFloat(cs.translate.split(' ')[1]) || 0, over = parseFloat(cs.getPropertyValue('--tap-over')) || -1;
    el.classList.remove('pressing'); if (y <= 0 || reduced) return;
    // The pop starts where the press left the button; its end is implicit, so it settles onto whatever the button rests at.
    // The press also scales to .97 (style.css); it eases back to 1 by the overshoot, which is translate only.
    const sc = cs.scale === 'none' ? '1' : cs.scale;
    const kf = [{ translate: `0 ${y}px`, scale: sc, filter: cs.filter, boxShadow: cs.boxShadow, easing: 'ease-out' }, { translate: `0 ${over}px`, scale: '1', offset: .55, easing: 'ease-in-out' }, { translate: '0 0', scale: '1' }];
    last = { el, key: key(el), kf, t: clock() }; tapPop(el, kf, last.t);
    // A click that re-renders (the dock, a window redraw) replaces the button: the pop carries on in its successor.
    requestAnimationFrame(() => { const r = last; if (!r || r.el.isConnected || !r.key) return; const n = document.querySelector(r.key); if (n && n.matches(TAP)) tapPop(n, r.kf, r.t); });
  }
  addEventListener('pointerdown', e => hold(e.button ? null : e.target.closest?.(TAP) || null), true);
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  addEventListener('keydown', e => { if (e.key === ' ' && !e.repeat && e.target.matches?.(TAP)) hold(e.target, true); }, true);
  // A Space press ends on its keyup wherever focus went (Nib's bubble takes it 30 ms after a line starts), or when focus leaves.
  addEventListener('keyup', e => { if (e.key === ' ' && kb) release(); }, true);
  addEventListener('focusout', e => { if (kb && e.target === held) release(); }, true);
  // #5 asks here first: a window opening from a button you just pressed grows as that press springs back, so the
  // button is pressed once (by you), not twice. Null when there was no press: #5 then presses the button itself.
  window.Tactile = {
    release(src) {
      const r = last; if (!r || clock() - r.t > 400 || (r.el !== src && (!r.key || !src.matches(r.key)))) return null;
      return tapPop(src, r.kf, r.t) || src.getAnimations().find(a => a.id === 'tap') || null;
    },
  };

  // ---------- #15 Attention nudges ----------
  // Who needs you: the Team button ("N needs you") and dock badges (Ops tray count, HQ "!", or their Jobs group). Opening it acknowledges the
  // count it showed; only a higher count nudges again, and a cleared badge forgets. Nothing nudges while a window, a
  // dialog or Team is open, at night, or in a hidden tab. One clock for all, so re-renders never restart or stack it.
  const EVERY = 3500, WIGGLE = 650, POP = 260, STAGGER = 50;
  const acked = {}, runs = {}; // key -> count acknowledged; key -> {t, el, badge} of the nudge in flight
  let next = 0, timer = 0, wasQuiet = false;
  function targets() {
    const out = [], team = document.getElementById('s3-toggle'), need = team && team.querySelector('.need');
    if (need) out.push({ key: 'team', el: team, badge: need, n: parseInt(need.textContent) || 1, seen: document.body.classList.contains('s3-agents-open') });
    // Dock buttons and group buttons (a group's badge adds up its stations'); stations inside a group's menu don't nudge.
    document.querySelectorAll('#dock>[data-station],#dock>[data-group]').forEach(el => { const b = el.querySelector('.badge'); if (b) out.push({ key: el.dataset.station || 'group:' + el.dataset.group, el, badge: b, n: parseInt(b.textContent) || 1, seen: el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true' }); });
    return out.filter(t => t.el.getClientRects().length);
  }
  const blocked = () => document.hidden || document.body.classList.contains('s3-agents-open') || !!document.querySelector('dialog[open]') || !!document.querySelector('#night:not([hidden])');
  function stop(k) { const r = runs[k]; if (!r) return; delete runs[k]; [r.el, r.badge].forEach(e => e?.getAnimations().forEach(a => { if (a.id === 'nudge') a.cancel(); })); }
  function nudge(t, at) {
    if (reduced || t.el.classList.contains('fresh')) return; // a dock button still arriving finishes its entrance first
    // Anticipation squash, two small wiggles, settle (the mockup's 650 ms); then the badge pops 1.35x.
    const a = t.el.animate([{ transform: 'none' }, { transform: 'translateY(2px) scale(1.04,.94)', offset: .15 }, { transform: 'translateY(-4px) rotate(-4deg)', offset: .35 },
      { transform: 'translateY(-4px) rotate(4deg)', offset: .55 }, { transform: 'translateY(-2px) rotate(-2deg)', offset: .72 }, { transform: 'none' }], { id: 'nudge', duration: WIGGLE, easing: 'ease-out' });
    const k = Math.min(1.35, 1 + 12 / (t.badge.offsetWidth || 12)); // a count chip pops 1.35x; Team's wider "N needs you" grows the same ~12px
    const b = t.badge.animate([{ transform: 'scale(1)' }, { transform: `scale(${k.toFixed(3)})` }, { transform: 'scale(1)' }], { id: 'nudge', duration: POP, delay: WIGGLE });
    a.startTime = b.startTime = at;
    runs[t.key] = { t: at, el: t.el, badge: t.badge };
  }
  function tick() {
    const now = clock(), list = targets(), live = new Set();
    for (const t of list) {
      if (t.seen) acked[t.key] = t.n; else if (acked[t.key] > t.n) acked[t.key] = t.n; // fewer waiting: a new one counts again
      const want = !t.seen && t.n > (acked[t.key] || 0);
      t.el.classList.toggle('nudge', want); // reduced motion: a steady amber edge instead (style.css)
      if (want) live.add(t.key);
    }
    for (const k in acked) if (!list.some(t => t.key === k)) delete acked[k]; // resolved: the next badge nudges afresh
    const quiet = blocked() || !live.size;
    for (const k in runs) { const r = runs[k], t = list.find(t => t.key === k);
      if (quiet || !t || !live.has(k) || now - r.t > WIGGLE + POP + 4 * STAGGER) stop(k);
      else if (t.el !== r.el || t.badge !== r.badge) { stop(k); nudge(t, r.t); } } // re-rendered mid-nudge: carry on in the new button
    if (quiet) wasQuiet = true;
    else {
      if (wasQuiet) { wasQuiet = false; next = now + 1500; } // first nudge 1.5 s after something needs you (or after the window closes)
      if (now >= next) { next = now + EVERY; list.filter(t => live.has(t.key)).forEach((t, i) => nudge(t, now + i * STAGGER)); } // 3 frames apart, never in unison
    }
    // No poll: wake when the next nudge is due or a running one ends. The observers below catch what changes the
    // targets; a slow check backs them up while the tab is visible, and a hidden tab has no timer at all.
    let at = document.hidden ? Infinity : now + 2000;
    if (!quiet) at = Math.min(at, next);
    for (const k in runs) at = Math.min(at, runs[k].t + WIGGLE + POP + 4 * STAGGER + 1);
    clearTimeout(timer); timer = at < Infinity ? setTimeout(tick, Math.max(16, at - now)) : 0;
  }
  addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('dock')) return; // Stage 1 has nothing to nudge
    const mo = new MutationObserver(() => tick()); // a swapped dock button, a new badge or an opened window is handled on the same frame
    mo.observe(document.getElementById('dock'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); // subtree: badges inside dock buttons
    const hud = document.querySelector('.hud'); // Team's toggle and its "N needs you" badge live in the HUD (crew.js)
    if (hud) mo.observe(hud, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    tick();
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.querySelectorAll('dialog,#night').forEach(d => mo.observe(d, { attributes: true, attributeFilter: ['open', 'hidden'] }));
    document.addEventListener('visibilitychange', () => tick());
    addEventListener('pointerdown', e => { const b = e.target.closest?.('.nudge'); if (b) for (const k in runs) if (runs[k].el === b) stop(k); }, true); // pressed: hold still under the finger
  });
})();
