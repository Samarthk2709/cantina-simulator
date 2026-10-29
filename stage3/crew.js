/* Stage 3 UI, after Grok Bot: a roster of agents (name + what each is doing in a few words), one timeline per
   agent with its tool steps folded away, and cards only where you have to decide something. The avatar's
   motion shows its state; there are no status lights, dashboards or settings. */
(window.Stage3Boot = window.Stage3Boot || []).push(function () {
  'use strict';
  const A = window.Stage3Agents, C = window.Stage3Scope, G = window.Stage2, E = window.Stage2Engine, D = window.Stage2Data;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const setHTML = (el, html) => { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } };
  // setHTML that patches in place: unchanged nodes stay, attributes and text are updated, so a roster row or pane header
  // whose text changes never restarts its avatar's loop (hop, bob…) or drops its idle-life frame. An <svg> is art: kept
  // while its markup is the same (idle life draws inside it), swapped whole when it changes (a new state).
  function morph(el, html) {
    if (!el || el.__html === html) return; el.__html = html;
    const t = document.createElement('template'); t.innerHTML = html; sync(el, t.content);
  }
  const art = n => { for (const s of n.nodeName === 'svg' ? [n] : n.querySelectorAll?.('svg') || []) s.__src = s.outerHTML; return n; };
  function sync(el, to) {
    const old = [...el.childNodes], now = [...to.childNodes];
    now.forEach((n, i) => {
      const o = old[i];
      if (!o) el.appendChild(art(n));
      else if (o.nodeName !== n.nodeName || n.nodeType !== 1 && n.nodeType !== 3) o.replaceWith(art(n));
      else if (n.nodeType === 3) { if (o.data !== n.data) o.data = n.data; }
      else if (n.nodeName === 'svg') { if (o.__src !== n.outerHTML) o.replaceWith(art(n)); }
      else {
        for (const {name} of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
        for (const {name, value} of n.attributes) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
        sync(o, n);
      }
    });
    old.slice(now.length).forEach(o => o.remove());
  }
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  // ---------- avatar: avatars.js draws the whole cast. State is carried by motion and the eyes. ----------
  // idle · thinking · working · waiting · sad · done, as in Grok Bot's six states.
  function state(a) {
    if (a.q) return 'waiting';
    if (Date.now() - a.lastPenalty < 6000) return 'sad';
    if (a.status === 'thinking' || a.status === 'queued') return 'thinking';
    if (a.status === 'walking' || a.status === 'working') return 'working';
    if (a.status === 'done') return 'done';
    return 'idle';
  }
  const FACE = {waiting: 'ask', sad: 'sad', thinking: 'think', working: 'think', done: 'happy', idle: 'idle'};
  const avatar = (a, cls) => `<span class="s3-av st-${state(a)} ${cls || ''}" style="--i:${A.list().indexOf(a)}">${window.Avatars.svg(a.id, {mood: FACE[state(a)], lit: state(a) === 'thinking'})}</span>`;

  // ---------- shell ----------
  $('focus').insertAdjacentHTML('beforebegin', '<button id="s3-toggle" class="s3-toggle" type="button"></button>');
  document.body.insertAdjacentHTML('beforeend', `
    <div id="s3-layer"></div>
    <section id="s3-view" hidden aria-label="Team"><nav id="s3-side" aria-label="Agents"></nav><main id="s3-main"></main></section>`);
  let view = {kind: 'agent', id: 'nib'}, open = false;
  const openSteps = new Set(); // "agent:index" of step groups you unfolded
  function setOpen(v) {
    if (v && G.ui().win) G.close();
    // The team view swallows key releases, so let go of any walking key now or the founder keeps walking.
    if (v) ['up', 'down', 'left', 'right'].forEach(d => G.world.move?.(d, false));
    open = v; $('s3-view').hidden = !v; document.body.classList.toggle('s3-agents-open', v);
    if (v) renderMain(); else $('world')?.focus({preventScroll: true});
    renderToggle(); window.Loop.wake(); // the floor layer hides or comes back
  }
  function renderToggle() {
    const need = A.list().filter(a => a.q).length, busy = A.busy();
    setHTML($('s3-toggle'), `Team${need ? ` <b class="need">${need}<small> need${need > 1 ? '' : 's'} you</small></b>` : busy ? ` <span>${busy}<small> working</small></span>` : ''}`);
  }

  // ---------- agents on the office floor ----------
  // Runs on the shared loop, but writes only what changed: a sprite sits on a transform (rounded to device pixels) and
  // its markup is rebuilt only when its state, phrase or name moves on. It asks for frames only while someone walks,
  // crouches or drifts, or a bubble's spring is settling. Every frame something else animates (the camera, a room
  // change) it is called anyway, so the sprites still follow the room's rect.
  const sprites = {}, px = v => Math.round(v * devicePixelRatio) / devicePixelRatio;
  const put = (el, prop, v) => { const c = el.__css || (el.__css = {}); if (c[prop] !== v) { c[prop] = v; el.style.setProperty(prop, v); } };
  let shown = false;
  function drawLayer() {
    const w = G.world, layer = $('s3-layer');
    const show = !!w && !open && w.getState().room === 'office';
    if (layer.hidden !== !show) layer.hidden = !show;
    const night = !$('night')?.hidden && $('night').classList.contains('on');
    if (layer.classList.contains('night') !== night) layer.classList.toggle('night', night); // agents dim with the office (crew.css)
    if (!show) { shown = false; return false; }
    const back = !shown; shown = true; // a hidden layer drops its CSS animations: shown again, each hop starts over
    let more = false;
    const now = performance.now(), rect = w.roomRect(), room = window.CantinaWorld.allRooms.find(r => r.id === 'office'), k = rect.width / room.width, jobs = [], placed = [];
    for (const a of A.list()) {
      if (!a.pos) continue;
      let el = sprites[a.id];
      if (!el) { el = sprites[a.id] = document.createElement('button'); el.className = 's3-agent' + (a.id === 'nib' ? ' nib' : ''); el.dataset.chat = a.id; el.style.left = el.style.top = '0'; layer.appendChild(el); }
      // Walk bob is offset 3 frames (50 ms) per agent; during the wind-up the agent crouches a pixel and leans back.
      // Reduced motion: neither, the agent just walks.
      const i = A.list().indexOf(a), h = 21 * k, wd = 16 * k, crouch = a.crouch && !calm;
      const bob = crouch ? -k : a.moving && !calm ? Math.round(Math.sin((now + i * 50) / 90) * k) : 0, lean = crouch ? -(a.facing || 1) * k : 0;
      const st = state(a), busyNow = st === 'working' || st === 'waiting' || st === 'thinking', lift = st === 'waiting' && a.id !== 'nib' && !calm ? 9 * k : 0;
      if (el.classList.contains('flip') !== a.facing < 0) el.classList.toggle('flip', a.facing < 0);
      put(el, 'transform', `translate(${px(rect.left + a.pos.x * k + lean - wd / 2)}px,${px(rect.top + a.pos.y * k - h + 2 * k - bob)}px)`);
      put(el, 'width', wd + 'px'); put(el, 'height', h + 'px'); put(el, '--lift', lift + 'px');
      // Nib's body is drawn by the game; here it only gets the bubble saying what it's doing.
      const ph = A.phrase(a), key = `${st}|${i}|${a.name}|${busyNow ? ph : ''}`;
      if (el.__key !== key) {
        el.__key = key;
        setHTML(el, `${a.id === 'nib' ? '' : avatar(a) + `<span class="s3-tag">${esc(a.name)}</span>`}${busyNow ? `<span class="s3-bubble ${st === 'waiting' ? 'need' : ''}">${esc(short(ph))}</span>` : ''}`);
        el.__bubble = el.querySelector('.s3-bubble');
        if (DUST[a.id]) DUST[a.id].hop = null; // a new svg: its hop (if any) starts now
      }
      if (el.__label !== ph) { el.__label = ph; el.setAttribute('aria-label', `${a.name}: ${ph}. Open chat.`); }
      if (back && DUST[a.id]) DUST[a.id].hop = null;
      if (a.moving || a.crouch || a.drift || a.path.length || a.nibWalking) more = true;
      jobs.push([a, el, rect.left + a.pos.x * k, rect.top + a.pos.y * k, lean, -bob, h, k, lift, placed]);
      if (a.id !== 'nib' && window.FloorDust) kickDust(a, st, i, now); // #10 (Nib kicks his own in nib.js)
    }
    // Standing bubbles oldest first, then walkers: a newcomer stacks above its neighbours instead of pushing them up.
    const rank = a => a.path.length || a.nibWalking ? 2e9 : since[a.id] ?? 1e9;
    jobs.sort((p, q) => rank(p[0]) - rank(q[0])).forEach(j => { if (followThrough(...j)) more = true; });
    for (const id of Object.keys(sprites)) if (!A.get(id)) { sprites[id].remove(); delete sprites[id]; }
    return more;
  }
  const short = t => t.length > 34 ? t.slice(0, 32) + '…' : t;
  // Footstep dust & landing puffs (#10): a footfall every 10 px walked (step frames 0 and 2 of Nib's walk/5 cycle) and a
  // burst when the waiting hop (crew.css s3-hop: 1.6 s, delay −i × 50 ms) lands, at 43.75% of its loop. The landings are
  // worked out from when the hop's svg went in, not read off the animation, and a timeout wakes the loop for the next.
  // Specks sit at the feet in office pixels; nib.js (window.FloorDust) draws them.
  const DUST = {}, HOP = 1600, LAND = 0.4375 * HOP;
  let hopDue = Infinity, hopT = 0;
  function kickDust(a, st, i, now) {
    const d = DUST[a.id] || (DUST[a.id] = {x: a.pos.x, y: a.pos.y, walk: 0, hop: null});
    const moved = Math.hypot(a.pos.x - d.x, a.pos.y - d.y); d.x = a.pos.x; d.y = a.pos.y;
    if (a.moving && moved < 20) { const w0 = d.walk; d.walk += moved; if ((d.walk / 10 | 0) !== (w0 / 10 | 0)) window.FloorDust.step(a.pos.x, a.pos.y + 2, a.facing); } // a jump (sent home) isn't a step
    if (st !== 'waiting' || calm) { d.hop = null; return; }
    if (d.hop == null) { const t0 = now - i * 50; d.hop = t0 + LAND + Math.max(0, Math.ceil((now - t0 - LAND) / HOP + 1e-9)) * HOP; } // the first landing still to come
    else if (now >= d.hop) { window.FloorDust.land(a.pos.x, a.pos.y + 2); window.Loop.wake(); d.hop += Math.ceil((now - d.hop + 1e-9) / HOP) * HOP; }
    if (d.hop < hopDue || hopDue <= now) { clearTimeout(hopT); hopDue = d.hop; hopT = setTimeout(() => { hopDue = Infinity; window.Loop.wake(); }, d.hop - now + 1); }
  }
  // Follow-through (#6): an agent that stops leans on a pixel and rocks back (a.drift, from harness.js), and its bubble
  // trails it on Nib's bubble spring instead of riding the walk bob: it lags while walking and overshoots a touch on
  // stop. (x, y) is the agent's anchor without bob or lean, (dx, dy) how far the sprite sits from it. A bubble never
  // sinks onto its agent or leaves the screen (near an edge it slides in, so it reads on a phone), stacks above a
  // neighbour's bubble instead of covering it (same desk; a walker's rises as it nears), and a new one starts in place.
  // Reduced motion: no lean or spring; bubbles still keep on-screen and apart. Returns true while the spring still moves.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches, trails = {}, since = {}; // since: when each standing bubble settled, in order
  let born = 0;
  function followThrough(a, el, x, y, dx, dy, h, k, lift, placed) {
    let tr0 = '';
    if (a.drift && !a.crouch && !calm) { const ex = Math.round(a.drift[0] * k), ey = Math.round(a.drift[1] * k); tr0 = `${ex}px ${ey}px`; dx += ex; dy += ey; }
    put(el, 'translate', tr0);
    const b = el.__bubble;
    if (!b) { trails[a.id]?.reset(); delete since[a.id]; return false; }
    const [bw, bh] = b.__size || (b.__size = [b.offsetWidth, b.offsetHeight]), far = 16 * k, m = 4, lo = m + bw / 2, hi = innerWidth - m - bw / 2;
    const top = y - h + 2 * k - 15 - lift - bh, tx = Math.max(lo, Math.min(hi, x)); // its top on the anchor (.s3-bubble: 15px above the sprite)
    if (a.path.length || a.nibWalking) delete since[a.id]; else since[a.id] ??= ++born;
    let up = 0; // how far it rises to clear the bubbles of neighbours (a desk's width) placed before it this frame
    for (let j = 0; j < placed.length; j++) { const [px, pt, pw, ph, ax, ay] = placed[j]; if (Math.abs(ax - x) <= 64 * k && Math.abs(ay - y) <= 24 * k && Math.abs(px - tx) < (pw + bw) / 2 + 2 && top - up < pt + ph + 2 && top - up + bh + 2 > pt) { up = top + bh + 2 - pt; j = -1; } }
    up = Math.min(up, Math.max(0, top - m)); placed.push([tx, top - up, bw, bh, x, y]);
    if (calm) { put(b, 'translate', `${Math.round(tx - x - dx)}px ${Math.round(-up - dy)}px`); return false; }
    const tr = trails[a.id] || (trails[a.id] = window.BubbleTrail()), now = performance.now(), box = [Math.max(-far, lo - tx), Math.min(far, hi - tx), Math.max(-far, Math.min(0, m - top + up)), up];
    // A settled spring that slept past its 200 ms snap is touched at rest first, so a new target (a neighbour's bubble
    // stacking) still springs instead of jumping.
    if (b.__still >= 2 && b.__args && now - b.__args[2] > 150) tr.to(b.__args[0], b.__args[1], now - 16, b.__args[3], b.__args[4]);
    b.__args = [tx, y - up, now, k, box];
    const [sx, sy] = tr.to(tx, y - up, now, k, box);
    put(b, 'translate', `${Math.round(sx - x - dx)}px ${Math.round(sy - y - dy)}px`);
    // Settled once it moves under 0.02 px a frame for two frames running; a spring left a hair off snaps on the next move.
    const still = b.__at && Math.abs(sx - b.__at[0]) < 0.02 && Math.abs(sy - b.__at[1]) < 0.02;
    b.__still = still ? (b.__still || 0) + 1 : 0; b.__at = [sx, sy];
    return b.__still < 2;
  }
  window.Loop.add(drawLayer);
  // Night falling or lifting dims the agents: redraw then (night is a class on #night, toggled by game.js).
  new MutationObserver(() => window.Loop.wake()).observe($('night') || document.body, {attributes: true, attributeFilter: ['class', 'hidden']});

  // ---------- floating finds (motion #16): a label rises from the agent's head on the office floor ----------
  // harness.js calls Stage3Float: "+1 bug" on a find, the grade and rep on a payout (the pay chip, #4, carries the
  // money, so it's never shown twice; its label waits until the chip has left the head), "−3 rep" on a penalty. Pop
  // .7 → 1.1, dip 4 px back to 1 (the anticipation), drift up 48 px (less on a small office) over 1.8 s and fade.
  // Each frame the labels are laid out newest first: a label starts above every tag and bubble of its desk (agents
  // within a desk's width), and an older one it would touch is pushed up above it. Nothing rises into the HUD or a
  // bubble or tag further up: a label stops under it, and one pushed into it drops. Labels that land together start
  // 3 frames apart; at most 3 per agent in the air, 2 more wait, the rest drop. They ride the agent's room position
  // (no walk bob), so a walker carries its label and the camera never drags it; near an edge they slide in. Not shown
  // while Team covers the office, the tab is hidden or it's night. Reduced motion: a brief static label, still stacked.
  const FLOAT_MAX = 3, FLOAT_WAIT = 2, FLOAT_MS = 1800, floats = [], floatQ = {};
  const RISE = [[0, -10], [.15, 4], [.25, 0], [.8, 40], [1, 48]]; // [progress, px up]: each segment eases out
  const rise = p => { if (p <= 0) return RISE[0][1]; for (let i = 1; i < RISE.length; i++) { const [p1, y1] = RISE[i], [p0, y0] = RISE[i - 1]; if (p <= p1) { const u = (p - p0) / (p1 - p0); return y0 + (y1 - y0) * (1 - (1 - u) * (1 - u)); } } return RISE.at(-1)[1]; };
  let floatNext = 0, floatLoop = false;
  function floatFind(id, text, kind, after) {
    if (after?.then) return void after.then(() => floatFind(id, text, kind)); // a payout's chip leaves first
    const a = A.get(id), el = sprites[id], w = G.world;
    if (!a?.pos || !el || open || document.hidden || $('s3-layer').hidden || $('s3-layer').classList.contains('night') || w?.getState().room !== 'office') return;
    if (floats.filter(f => f.id === id).length >= FLOAT_MAX) { const q = floatQ[id] || (floatQ[id] = []); if (q.length < FLOAT_WAIT) q.push([text, kind]); return; }
    const f = {id, x: a.pos.x, y: a.pos.y, off: 0, box: document.createElement('div')};
    f.box.className = 's3-float'; f.box.innerHTML = `<span class="${kind || 'find'}">${esc(text)}</span>`;
    $('s3-layer').appendChild(f.box); floats.push(f); f.w = f.box.firstChild.offsetWidth * 1.1; f.h = f.box.firstChild.offsetHeight; // f.w has room for the pop's overshoot
    f.at = Math.max(performance.now(), floatNext); floatNext = f.at + 50; // offset: 3 frames apart
    f.done = () => { if (!f.box.isConnected) return; f.box.remove(); floats.splice(floats.indexOf(f), 1); const n = floatQ[id]?.shift(); if (n) floatFind(id, ...n); };
    if (calm) setTimeout(f.done, 1400);
    else f.box.firstChild.animate([{transform: 'scale(.7)', opacity: 0}, {transform: 'scale(1.1)', opacity: 1, offset: .15}, {transform: 'scale(1)', opacity: 1, offset: .25},
      {opacity: 1, offset: .8}, {opacity: 0}], {duration: FLOAT_MS, delay: f.at - performance.now(), fill: 'backwards', easing: 'ease-out'}).finished.then(f.done, f.done);
    floatFrame(true);
  }
  function floatFrame(now) { // lays the labels out and follows the room on screen (scroll, resize) while any is up
    if (now !== true) { if (!floats.length) { floatLoop = false; return; } requestAnimationFrame(floatFrame); }
    else if (!floatLoop) { floatLoop = true; requestAnimationFrame(floatFrame); }
    const rect = G.world.roomRect(), k = rect.width / window.CantinaWorld.allRooms.find(r => r.id === 'office').width, t = performance.now(), sc = calm ? 0 : Math.max(.5, Math.min(1, k / 3));
    const obs = [], hud = document.querySelector('.hud')?.getBoundingClientRect(), placed = [];
    for (const a of A.list()) { const el = sprites[a.id]; if (el && a.pos) for (const n of [el, ...el.querySelectorAll('.s3-tag,.s3-bubble')]) { const r = n.getBoundingClientRect(); if (r.width) obs.push([r, a.pos.x, a.pos.y]); } }
    if (hud?.height) obs.push([hud, -1e4, -1e4]);
    for (let i = floats.length - 1; i >= 0; i--) { // newest first: it takes the spot over the desk, older ones move up
      const f = floats[i], p = A.get(f.id)?.pos; if (p) { f.x = p.x; f.y = p.y; } // a walker carries its label
      const cx = Math.max(f.w / 2 + 4, Math.min(innerWidth - f.w / 2 - 4, rect.left + f.x * k)), l = cx - f.w / 2 - 2, r = cx + f.w / 2 + 2, ay = rect.top + f.y * k;
      const desk = ([, x, y]) => Math.abs(x - f.x) <= 64 && Math.abs(y - f.y) <= 24, over = ([b]) => b.left < r && b.right > l;
      for (const o of obs) if (desk(o) && over(o)) f.off = Math.max(f.off, ay - o[0].top + 3); // above the desk's tags and bubbles, and never sinks back
      const floor = ay - f.off;
      let ceil = -Infinity; for (const o of obs) if (!desk(o) && over(o) && o[0].bottom <= floor) ceil = Math.max(ceil, o[0].bottom + 2);
      let y = floor - rise((t - f.at) / FLOAT_MS) * sc, pushed = false;
      for (let j = 0; j < placed.length; j++) { const q = placed[j]; if (q.l < r && q.r > l && y > q.top - 2 && y - f.h < q.bottom + 2) { y = q.top - 2; pushed = true; j = -1; } }
      if (y - f.h < ceil) { y = ceil + f.h; if (pushed && !f.drop) { f.drop = true; if (calm) f.done(); else f.box.animate([{opacity: 1}, {opacity: 0}], 100).finished.then(f.done, f.done); } }
      if (!f.drop) placed.push({l, r, top: y - f.h, bottom: y});
      f.box.style.transform = `translate(${Math.round(cx)}px,${Math.round(y)}px)`;
    }
  }
  window.Stage3Float = floatFind;
  // Penalties also show as a small toast in the office, in the game's own toast style.
  C.on(p => G.toast(`${p.who}: ${p.title.toLowerCase()} · −${p.rep} rep`, 'bad'));

  // ---------- idle life (motion #8): idle and done agents breathe a pixel, blink and glance, each on its own rhythm ----------
  // Frames are swapped inside the avatar's own <svg>, so the redraws' string diffs (setHTML, morph) never see them and the state animations
  // (working, thinking, waiting, sad) are untouched. A redraw starts from the plain frame; the observer restores ours before paint.
  const LIFE = {}, lifeReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function lifeOf(id, now, floor) {
    const a = A.get(id), rest = a && a.status === 'resting';
    let L = LIFE[id];
    // Seeded from the roster index, golden-ratio spaced, so no two agents breathe or blink as one block.
    if (!L) { const s = (A.list().indexOf(a) + 1) * 0.618 % 1; L = LIFE[id] = {s, blink: now + 300 + s * 2400, until: 0, glance: 0}; }
    // A blink every 2–4 s (slower and longer when out of focus). Glances turn on a blink, like a head turn, and the next blink turns back.
    if (now >= L.blink) {
      L.until = now + (rest ? 260 : 140); L.blink = now + (2000 + Math.random() * 2000) * (rest ? 1.5 : 1);
      L.glance = L.glance || rest || lifeReduced || Math.random() > 0.35 ? 0 : Math.random() < 0.5 ? 1 : -1;
    }
    const still = !(floor && a && (a.path?.length || a.crouch));
    if (!still) L.glance = 0; // never while walking on the floor: facing belongs to the walk
    // Breath: held frames, a 2.6–3.5 s period per agent (1.6× when resting), the body down for the last 45% of it.
    const P = (2600 + L.s * 900) * (rest ? 1.6 : 1), ph = (now / P + L.s) % 1;
    // next: when this agent's frame can next change (blink starts or ends, breath turns), for the life timer.
    const next = Math.min(now < L.until ? L.until : L.blink, now + ((ph < 0.55 ? 0.55 : 1) - ph) * P);
    return {blink: now < L.until, breath: !lifeReduced && still && ph > 0.55, glance: still ? L.glance : 0, next};
  }
  // Driven by a timer set for the soonest blink, breath or glance change, not by frames; the observer below catches
  // redraws, and the floor tick catches walks starting or ending (a glance never shows while walking).
  let lifeT = 0, lifeDue = Infinity;
  function idleLife() {
    const now = performance.now(); let due = Infinity;
    for (const el of document.querySelectorAll(open ? '#s3-side .s3-av, #s3-main .s3-av' : '#s3-layer .s3-av')) {
      const done = el.classList.contains('st-done'), svg = el.firstElementChild;
      if (!(done || el.classList.contains('st-idle')) || !svg) continue;
      const host = el.closest('[data-chat],[data-pane],[data-go]'), id = host && (host.dataset.chat || host.dataset.pane || (host.dataset.go || '').split(':')[1]);
      if (!id || !A.get(id)) continue;
      const mood = done ? 'happy' : 'idle', L = lifeOf(id, now, !open), key = `${mood}${+L.breath}${+L.blink}${L.glance}`;
      due = Math.min(due, L.next);
      if ((svg.__life || mood + '000') === key) continue; // kept on the svg: a new state swaps in a plain one
      svg.__life = key;
      // A glance looks ahead (eyes a pixel forward) or turns and looks back (mirrored); the floor's .flip still applies on top.
      svg.innerHTML = window.Avatars.rects(id, {mood: L.blink ? 'blink' : mood, breath: L.breath, look: L.glance ? 1 : 0})
        .map(([x, y, w, h, c]) => `<rect x="${L.glance < 0 ? 16 - x - w : x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('');
    }
    if (due !== lifeDue) { clearTimeout(lifeT); lifeDue = due; if (due < Infinity) lifeT = setTimeout(() => { lifeDue = Infinity; idleLife(); }, Math.max(0, due - now) + 1); }
  }
  // While anyone walks or crouches on the floor, run it every frame as before (glances clear on the first step).
  let lifeWalk = false; // and once more as the last one stops, so a breath held off by the walk comes back at once
  window.Loop.add(function lifeLoop() { const w = !open && A.list().some(a => a.path?.length || a.crouch); if (w || lifeWalk) idleLife(); lifeWalk = w; return false; });
  const lifeWatch = new MutationObserver(idleLife);
  ['s3-side', 's3-main', 's3-layer'].forEach(id => lifeWatch.observe($(id), {childList: true, subtree: true}));

  // ---------- roster ----------
  function renderSide() {
    const s = G.live(), w = G.wallet ? G.wallet() : s, sel = (k, id) => view.kind === k && (id === undefined || view.id === id) ? 'sel' : ''; // w: the HUD's wallet
    const rows = A.list().map(a => `<button class="s3-row ${sel('agent', a.id)} ${a.q ? 'need' : ''}" data-go="agent:${a.id}">${avatar(a)}<span class="txt"><span class="nm">${esc(a.name)}</span><span class="sub">${esc(A.phrase(a))}</span></span></button>`).join('');
    const next = A.hireable()[0], r = next && A.roster[next];
    const rules = A.RULES.filter(x => A.crew().rules.all?.[x.k]).length;
    morph($('s3-side'), `<button class="s3-back" data-office>← Office</button><div class="s3-h">Team</div>${rows}
      ${r ? `<button class="s3-row ghost" data-hire="${next}" ${s.cash < r.price ? 'disabled' : ''}><span class="s3-av plus">+</span><span class="txt"><span class="nm">Hire ${esc(r.name)}</span><span class="sub">${money(r.price)}${s.cash < r.price ? ' · not enough cash' : ''}</span></span></button>` : ''}
      <button class="s3-row ghost ${sel('rules')}" data-go="rules:all"><span class="s3-av plus">§</span><span class="txt"><span class="nm">AGENTS.md</span><span class="sub">${rules} of ${A.RULES.length} rules on</span></span></button>
      <div class="s3-foot">${w.rep}/60 rep to Elite · ${money(w.cash)}</div>`);
  }

  // ---------- one agent's timeline ----------
  function renderMain() {
    const main = $('s3-main'); main.__html = null;
    if (view.kind === 'rules') { main.innerHTML = rulesView(); return; }
    const a = A.get(view.id) || A.list()[0]; view.id = a.id;
    main.innerHTML = `<section class="s3-pane" data-pane="${a.id}"><header data-ph></header><div class="s3-msgs" data-msgs></div>
      <div class="s3-composer"><input data-input="${a.id}" autocomplete="off" placeholder="Tell ${esc(a.name)} what to do…" aria-label="Message ${esc(a.name)}"><div class="s3-hint" data-hint></div></div></section>`;
    update();
    main.querySelector('[data-input]').focus();
  }
  function head(a) {
    const g = a.status === 'resting' || a.q ? A.phrase(a) : a.task && a.task.finished !== true ? A.gistOf(a.task) : '';
    return `${avatar(a)}<div class="who"><b>${esc(a.name)}</b><span>${esc(g || (a.id === 'nib' ? 'Co-lead' : 'Agent'))}</span></div>${A.live(a) || a.status === 'queued' ? `<button class="s3-link" data-stop="${a.id}">Stop</button>` : ''}`;
  }
  const STEP = new Set(['tool', 'rule', 'typing', 'sys']);
  function timeline(a) {
    const out = [], log = a.log;
    for (let i = 0; i < log.length; i++) {
      const m = log[i];
      if (STEP.has(m.kind)) {
        const start = i, steps = [];
        while (i < log.length && STEP.has(log[i].kind)) { if (log[i].kind !== 'sys') steps.push(log[i]); i++; }
        i--;
        if (!steps.length) continue;
        // Notes the agent wrote for you (rule) stay visible; the mechanical steps fold away.
        const notes = steps.filter(x => x.kind === 'rule').map(x => `<div class="m-say m-note-plain">${esc(x.text)}</div>`).join('');
        const tools = steps.filter(x => x.kind !== 'rule');
        const key = a.id + ':' + log[start].id, isOpen = openSteps.has(key);
        if (tools.length) out.push(`<div class="m-steps ${isOpen ? 'open' : ''}"><button class="s3-link" data-steps="${key}">${isOpen ? '▾' : '▸'} ${tools.length} step${tools.length > 1 ? 's' : ''}</button>${isOpen ? `<div class="list">${tools.map(x => `<div>${esc(x.text)}</div>`).join('')}</div>` : ''}</div>`);
        out.push(notes);
        continue;
      }
      out.push(msg(a, m));
    }
    if (a.q) out.push(`<div class="m-card ask"><b>${esc(a.q.text)}</b><div class="opts">${a.q.opts.map((o, i) => `<button data-ans="${a.id}:${i}" class="${i === 0 ? 'primary' : ''}">${esc(o.label)}</button>`).join('')}</div></div>`);
    else if (A.live(a) || a.status === 'queued') out.push(`<div class="m-now">${esc(A.phrase(a))}</div>`);
    return out.join('');
  }
  function fixBtn(a, m) {
    const r = m.fix && A.RULES.find(x => x.k === m.fix);
    return r && !A.rule(a, r.k) ? `<button class="s3-link" data-fix="${r.k}">Add to AGENTS.md: “${esc(r.text)}”</button>` : '';
  }
  function msg(a, m) {
    switch (m.kind) {
      case 'user': return `<div class="m-user">${esc(m.text)}</div>`;
      case 'say': return `<div class="m-say ${m.pending ? 'pending' : ''}">${esc(m.text)}</div>`;
      case 'win': return `<div class="m-win">✓ ${esc(m.text)}</div>`;
      case 'good': return `<div class="m-say">${esc(m.text)}</div>`;
      case 'bad': return `<div class="m-say muted">${esc(m.text)}</div>`;
      case 'note': return `<div class="m-say muted">${esc(m.text)}${fixBtn(a, m)}</div>`;
      case 'ask': return '';
      case 'refuse': return `<div class="m-card"><b>Didn't start</b>${esc(m.text)}</div>`;
      case 'pen': return `<div class="m-card pen"><b>${esc(m.title || 'Penalty')}</b>${esc(m.text)}${fixBtn(a, m)}</div>`;
      case 'brief': { const b = m.task || {}; return `<div class="m-task">${esc(b.label)} · stops when ${esc(b.stop)}${b.budget != null ? ` · budget ${money(b.budget)}` : ''}</div>`; }
      case 'done': { const s = m.stats || {};
        if (!s.accepted && !s.pens && !s.spent) return `<div class="m-task done">${/^Stopped/.test(m.reason || '') ? 'Stopped' : 'Done'} · ${esc(m.text)}</div>`;
        return `<div class="m-task done">${/^Stopped/.test(m.reason || '') ? 'Stopped' : 'Done'} · ${s.accepted} bug${s.accepted === 1 ? '' : 's'} · ${money(s.earned)}${s.pens ? ` · ${s.pens} penalt${s.pens === 1 ? 'y' : 'ies'}` : ''}${s.spent ? ` · spent ${money(s.spent)}` : ''}</div>`; }
      default: return '';
    }
  }
  function update() {
    renderSide(); renderToggle();
    if (!open || view.kind === 'rules') return;
    const el = document.querySelector('#s3-main [data-pane]'), a = el && A.get(el.dataset.pane); if (!a) return;
    morph(el.querySelector('[data-ph]'), head(a));
    const box = el.querySelector('[data-msgs]'), key = a.ver + ':' + (a.q ? 1 : 0) + ':' + A.phrase(a) + ':' + openSteps.size;
    if (box.__key !== key) {
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.innerHTML = timeline(a); if (atBottom || !box.__key) box.scrollTop = box.scrollHeight; box.__key = key;
    }
    stage(a, box);
  }

  // ---------- #7 Staging: dim the timeline around a decision ----------
  // A decision is the agent's open question, or its newest penalty if that one's AGENTS.md fix is still off, until you
  // add the rule, click elsewhere, or the timeline moves on (you speak, a win, the task ends). An older penalty is
  // never staged instead: it may be scrolled out of sight. A ban notice belongs to the penalty before it. Only the card gets
  // .s3-decide; the dim is CSS (:has(.s3-decide)), so it lifts whatever removes the card: an answer, a re-render,
  // another agent, the rules page, closing Team. The entrance plays once per decision, never on re-renders.
  const entered = new Map(), passed = new Set(), ENTER_MS = 700, MOVED_ON = new Set(['user', 'win', 'done', 'brief', 'refuse']);
  function decision(a) {
    if (a.q) return {key: a.id + ':q' + (a.log.findLast(m => m.kind === 'ask')?.id ?? '')};
    const pens = a.log.filter(m => m.kind === 'pen'), n = pens.findLastIndex(m => m.title !== 'Banned');
    const p = pens[n], key = p && a.id + ':p' + p.id;
    if (!p || !A.RULES.some(r => r.k === p.fix) || A.rule(a, p.fix) || passed.has(key) || a.log.slice(a.log.indexOf(p) + 1).some(m => MOVED_ON.has(m.kind))) return null;
    return {key, n}; // n: penalty cards render one per 'pen' entry, in log order
  }
  function stage(a, box) {
    const d = decision(a);
    let card = d && (d.n == null ? box.querySelector('.m-card.ask') : box.querySelectorAll('.m-card.pen')[d.n]);
    if (card && d.n != null && !card.querySelector('[data-fix]')) card = null;
    box.querySelectorAll('.s3-decide').forEach(c => { if (c !== card) c.classList.remove('s3-decide'); });
    if (!card) return;
    const pane = box.parentNode;
    if (!pane.querySelector('.s3-dim')) { const dim = document.createElement('div'); dim.className = 's3-dim'; dim.setAttribute('aria-hidden', 'true'); pane.prepend(dim); getComputedStyle(dim).opacity; } // settle at 0 first, so it fades in
    card.classList.add('s3-decide'); card.dataset.decide = d.key;
    const now = document.timeline.currentTime, first = !entered.has(d.key);
    if (first) entered.set(d.key, now);
    if (now - entered.get(d.key) < ENTER_MS && !card.classList.contains('s3-enter')) {
      card.querySelectorAll('.opts button,[data-fix]').forEach((b, j) => b.style.setProperty('--j', j)); // buttons 3 frames apart
      card.classList.add('s3-enter');
      // The first entrance starts on its first painted frame. A card re-rendered mid-entrance is pinned to that
      // start, so it carries on from the same point instead of replaying.
      const mine = () => card.getAnimations({subtree: true}).filter(an => /^(s3-decide-in|decide-btn)$/.test(an.animationName));
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => { const t = mine()[0]?.startTime; if (t != null) entered.set(d.key, t); }));
      else mine().forEach(an => { an.startTime = entered.get(d.key); });
    }
  }
  // A penalty's fix is an offer: a click or tap anywhere else in Team passes on it. Scrolling doesn't: a touch scroll
  // never clicks, and a press on a scrollbar is skipped. A question keeps waiting for its answer.
  document.addEventListener('click', e => {
    const c = document.querySelector('#s3-main .s3-decide'), t = e.target;
    if (!c || !t.closest('#s3-view') || c.contains(t) || !/:p\d+$/.test(c.dataset.decide)) return;
    if (t.scrollHeight > t.clientHeight && e.offsetX >= t.clientWidth || t.scrollWidth > t.clientWidth && e.offsetY >= t.clientHeight) return;
    passed.add(c.dataset.decide); c.classList.remove('s3-decide');
  }, true);
  // Under the message bar: how the game read it, plus the one warning that matters most.
  function hint(id) {
    const a = A.get(id), input = document.querySelector(`[data-input="${id}"]`), out = document.querySelector('[data-hint]');
    if (!input || !out) return;
    const text = input.value.trim();
    if (!text) return void (out.innerHTML = '');
    if (A.isQuestion(text)) return void (out.innerHTML = 'Question · ' + esc(a.name) + ' will answer');
    const t = A.parseLocal(text);
    if (t.job === 'none') return void (out.innerHTML = A.model().ok ? '' : 'Not a task the game recognizes');
    const w = A.lint(a, t)[0];
    out.innerHTML = `${esc(A.label(t))}${t.until ? ' · until ' + esc(A.stopLabel(t)) : ''}${A.live(a) ? ' · replaces the current task' : ''}${w ? `<span class="warn">${esc(w)}</span>` : ''}`;
  }
  function rulesView() {
    const rules = A.crew().rules;
    const rows = A.RULES.map(r => { const on = !!rules.all?.[r.k]; return `<label class="rule"><input type="checkbox" data-rule="${r.k}" ${on ? 'checked' : ''}><span>${esc(r.text)}<small class="${on ? '' : 'without'}">${on ? esc(r.cost) : 'Without it: ' + esc(r.without)}</small></span></label>`; }).join('');
    const oos = D.ALL_TARGETS.map(t => `${t.name}: ${C.outOfScope(t.id).map(id => t.rooms.find(x => x[0] === id)[1]).join(', ')}${A.crew().strikes[t.id] ? ` (${A.crew().strikes[t.id]}/${C.BAN_AT} strikes)` : ''}${C.banned(t.id) ? ' · banned' : ''}`).join(' · ');
    return `<div class="s3-doc"><h2>AGENTS.md</h2><p class="muted">Every agent reads this before every step. Each rule switches on one thing they'd otherwise skip.</p>${rows}<p class="muted small">Off limits · ${esc(oos)}</p></div>`;
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('button,input[type=checkbox]'); if (!el) return;
    const d = el.dataset;
    if (el.id === 's3-toggle') return setOpen(!open);
    if (d.chat) { view = {kind: 'agent', id: d.chat}; return setOpen(true); }
    if (!el.closest('#s3-view')) return;
    if ('office' in d) return setOpen(false);
    if (d.go) { const [kind, id] = d.go.split(':'); view = {kind, id}; renderMain(); }
    else if (d.ans) { const [id, i] = d.ans.split(':'); A.answer(id, +i); }
    else if (d.stop) A.stop(d.stop);
    else if (d.steps) { openSteps.has(d.steps) ? openSteps.delete(d.steps) : openSteps.add(d.steps); }
    else if (d.fix) { A.setRule('all', d.fix, true); G.toast('Added to AGENTS.md', 'good'); }
    else if (d.rule) { A.setRule('all', d.rule, el.checked); renderMain(); }
    else if (d.hire) { if (A.hire(d.hire)) { view = {kind: 'agent', id: d.hire}; renderMain(); } }
    update();
  });
  function sendFrom(id) { const i = document.querySelector(`[data-input="${id}"]`); if (!i) return; if (!i.value.trim()) { i.value = ''; return; } A.send(id, i.value); i.value = ''; hint(id); i.focus(); }
  document.addEventListener('input', e => { if (e.target.dataset?.input) hint(e.target.dataset.input); });
  // While the team view is open it owns the keyboard, so typing never walks you around the office.
  window.addEventListener('keydown', e => {
    if (!open || document.querySelector('#modal[open], #settings-dialog[open]')) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); return setOpen(false); }
    if (e.key === 'Enter' && e.target.dataset?.input) { e.preventDefault(); sendFrom(e.target.dataset.input); }
  }, true);
  window.addEventListener('keyup', e => { if (open) e.stopPropagation(); }, true);

  let pending = false, lastRefresh = 0;
  A.onChange(() => {
    if (pending) return; pending = true;
    // The floor layer sleeps between moves, so it's redrawn here too (it writes only what changed) and wakes the loop if it now has motion.
    requestAnimationFrame(() => { pending = false; update(); if (drawLayer()) window.Loop.wake(); if (Date.now() - lastRefresh > 800) { lastRefresh = Date.now(); G.hud(); } });
  });
  addEventListener('first-office:wallet', renderSide); // the footer moves with the HUD's wallet, as pay chips land
  renderSide(); renderToggle();
  window.Stage3UI = {open: id => { view = {kind: 'agent', id: id || 'nib'}; setOpen(true); }, close: () => setOpen(false), isOpen: () => open};
});
