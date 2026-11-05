/* UI polish from charles.unemployed's "20 ways" reel (README → UI polish). Office only (index.html).
   - Menu and modal dialogs pop in from 0.95 out of the button that opened them (ease-out, 200 ms) and shrink back toward
     it on close (160 ms, 20% shorter). The office window (#panel-dialog) has its own grow (game.js #5).
   - The dock's open-window mark is one element that slides between buttons (ease-in-out), stretching 12% mid-move.
   - The goal button pulses when its progress goes up.
   - The zoom toggle's label crossfades: old and new words overlap, with a little blur. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOVE = 'cubic-bezier(.65,0,.35,1)', OUT = 'cubic-bezier(.2,.8,.2,1)';

  // ---------- dialogs: enter from the trigger, exit back to it ----------
  let trigger = null; // the last button pressed outside a dialog, and when
  addEventListener('pointerdown', e => { const b = e.target.closest?.('button'); if (b && !b.closest('dialog')) trigger = { el: b, t: performance.now() }; }, true);
  addEventListener('keydown', e => { if (/^(Enter| |[a-z])$/i.test(e.key)) trigger = { el: document.activeElement?.closest?.('button') || null, t: performance.now() }; }, true);
  const ours = d => d instanceof HTMLDialogElement && d.id !== 'panel-dialog';
  function originOf(d) {
    const r = d.getBoundingClientRect(), tr = trigger && performance.now() - trigger.t < 800 && trigger.el?.isConnected && trigger.el.getBoundingClientRect();
    return tr && tr.width ? `${Math.round(tr.left + tr.width / 2 - r.left)}px ${Math.round(tr.top + tr.height / 2 - r.top)}px` : '50% 50%';
  }
  function enter(d) {
    if (reduced) return;
    d.getAnimations().forEach(a => a.id === 'pop' && a.cancel());
    d._origin = originOf(d); d.style.transformOrigin = d._origin;
    const a = d.animate([{ opacity: 0, scale: '.95' }, { opacity: 1, scale: '1' }], { id: 'pop', duration: 200, easing: OUT });
    a.onfinish = () => { d.style.transformOrigin = ''; };
  }
  // A closed dialog can't be drawn, so a copy taken at its last place shrinks away instead. It goes at the end of <body>,
  // after the real one, so id lookups still find the real dialog.
  function snap(d) {
    if (reduced || !d.open) return null;
    const r = d.getBoundingClientRect(); if (!r.width) return null;
    const c = d.cloneNode(true); c.inert = true; c.setAttribute('aria-hidden', 'true');
    c.querySelectorAll('input').forEach((i, k) => { i.value = d.querySelectorAll('input')[k]?.value ?? i.value; });
    Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, maxWidth: 'none', maxHeight: 'none', zIndex: 10001, pointerEvents: 'none', transformOrigin: d._origin || '50% 50%' });
    const y = d.scrollTop;
    return () => {
      document.body.appendChild(c); c.scrollTop = y;
      c.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.95' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = () => c.remove();
    };
  }
  const close = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.close = function (...args) { if (ours(this) && this.open) { this._exit = null; snap(this)?.(); } return close.apply(this, args); };
  // Esc closes without close(): copy it on cancel, play the copy only if the close really happens (cancel can be refused).
  addEventListener('cancel', e => { if (ours(e.target)) e.target._exit = snap(e.target); }, true);
  addEventListener('close', e => { const d = e.target; if (ours(d) && d._exit) { d._exit(); d._exit = null; } }, true);
  new MutationObserver(ms => ms.forEach(m => { const d = m.target; if (ours(d) && d.open && m.oldValue === null) enter(d); }))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });

  addEventListener('DOMContentLoaded', () => {
    // ---------- dock: one mark that moves between buttons ----------
    const dock = document.getElementById('dock');
    if (dock) {
      const mark = document.createElement('i'); mark.className = 'dock-mark'; mark.setAttribute('aria-hidden', 'true'); dock.appendChild(mark);
      let at = null; // the rect the mark rests on
      const place = () => {
        const b = dock.querySelector(':scope>button[aria-pressed="true"]:is([data-station],[data-group])');
        const to = b && b.offsetWidth ? { x: b.offsetLeft + 10, y: b.offsetTop + b.offsetHeight - 3, w: b.offsetWidth - 20 } : null;
        if (!to) { if (at) { mark.classList.remove('on'); at = null; } return; }
        if (at && at.x === to.x && at.y === to.y && at.w === to.w) return;
        Object.assign(mark.style, { left: to.x + 'px', top: to.y + 'px', width: to.w + 'px' });
        if (at && !reduced && at.y === to.y) { // same row: slide over, stretched 12% at the middle of the move
          const dx = at.x + at.w / 2 - (to.x + to.w / 2), k = at.w / to.w;
          mark.animate([{ translate: `${dx}px 0`, scale: `${k} 1` }, { translate: `${dx / 2}px 0`, scale: `${((k + 1) / 2 * 1.12).toFixed(3)} 1`, offset: .5 }, { translate: '0 0', scale: '1 1' }], { duration: 320, easing: MOVE });
        }
        mark.classList.add('on'); at = to;
      };
      new MutationObserver(place).observe(dock, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed'] });
      addEventListener('resize', () => { at = null; place(); });
      place();
    }

    // ---------- goal button: pulse when progress goes up ----------
    const pay = document.getElementById('goal-pay'), goal = document.getElementById('goal-open');
    if (pay && goal) {
      const score = () => (pay.textContent.match(/\d+(?=\s*\/)/g) || pay.textContent.match(/\d+/g) || []).reduce((a, n) => a + +n, 0);
      let last = score();
      new MutationObserver(() => {
        const n = score(); if (n > last && !reduced) goal.classList.remove('ok-pulse'), void goal.offsetWidth, goal.classList.add('ok-pulse');
        last = n;
      }).observe(pay, { subtree: true, childList: true, characterData: true });
      goal.addEventListener('animationend', e => { if (e.animationName === 'ok-pulse') goal.classList.remove('ok-pulse'); });
    }

    // ---------- zoom toggle: the old label and the new one overlap ----------
    const label = document.querySelector('#view-toggle span');
    if (label) new MutationObserver(ms => {
      if (reduced || !label.offsetWidth) return;
      const old = ms.flatMap(m => [...m.removedNodes]).map(n => n.textContent).join(''); if (!old || old === label.textContent) return;
      const btn = label.parentNode; btn.querySelectorAll('.was').forEach(n => n.remove());
      const ghost = document.createElement('span'); ghost.className = 'was'; ghost.setAttribute('aria-hidden', 'true'); ghost.textContent = old;
      Object.assign(ghost.style, { left: label.offsetLeft + 'px', top: label.offsetTop + 'px' }); btn.appendChild(ghost);
      ghost.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = () => ghost.remove();
      label.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 220, easing: OUT });
    }).observe(label, { childList: true });
  });
})();
