/* First Office avatars: one construction for the whole cast, after Grok Bot's avatar system.
   Every bot is the same rounded body with a dark visor and two big eyes; characters differ only by
   colour and one accessory, so each reads at 16 px. The founder (you) is the human version of the shape.
   Art is 16×21 pixels, origin top-left; feet sit on the bottom row. Used by Stage 1, the office, the team
   view, the dock and the endings, as canvas rects or SVG. */
(function (root) {
  'use strict';
  const INK = '#120f26', VISOR = '#0d2f33', EYE = '#7ff0d8', AMBER = '#ffcf7a', RED = '#f97066';
  const CAST = {
    nib:  {name: 'Nib',  body: '#d8d0b8', shade: '#a79f86', acc: 'antenna'},
    pip:  {name: 'Pip',  body: '#6cc28a', shade: '#3f8f5a', acc: 'sprout'},
    moss: {name: 'Moss', body: '#d0705f', shade: '#9a4a3e', acc: 'phones'},
    rook: {name: 'Rook', body: '#a68ad8', shade: '#7560ad', acc: 'tower'},
    wren: {name: 'Wren', body: '#e8b54a', shade: '#b88a10', acc: 'tuft'},
    you:  {name: 'You',  body: '#f1e6c8', shade: '#c9bd9c', acc: 'human', skin: '#e9b88f', hair: '#3b2416', trim: '#c4572b'},
  };
  const W = 16, H = 21;

  // The shared body: rows 4–17, corners rounded, a shade down the right side and along the bottom.
  function body(c) {
    return [
      [3, 4, 10, 1, INK], [2, 5, 1, 1, INK], [13, 5, 1, 1, INK], [1, 6, 1, 10, INK], [14, 6, 1, 10, INK], [2, 16, 1, 1, INK], [13, 16, 1, 1, INK], [3, 17, 10, 1, INK],
      [3, 5, 10, 1, c.body], [2, 6, 12, 10, c.body], [3, 16, 10, 1, c.body],
      [13, 6, 1, 10, c.shade], [3, 16, 10, 1, c.shade], [12, 15, 1, 1, c.shade],
    ];
  }
  // Arms are nubs; feet step for walking.
  const limbs = (c, step) => [
    [0, 10, 1, 4, INK], [15, 10, 1, 4, INK],
    ...(step % 2 ? [[4, 18, 3, 2, INK], [9, 18, 3, 3, INK]] : step ? [[4, 18, 3, 3, INK], [9, 18, 3, 2, INK]] : [[4, 18, 3, 3, INK], [9, 18, 3, 3, INK]]),
  ];
  function visor(c, mood) {
    // The founder: a face in the same frame, hair as a fringe, and the founder's red scarf.
    if (c.acc === 'human') return [[3, 6, 10, 8, c.skin], [3, 5, 10, 2, c.hair], [3, 7, 1, 3, c.hair], [12, 7, 1, 3, c.hair], [5, 7, 3, 1, c.hair], [2, 14, 12, 2, c.trim], [11, 15, 2, 1, '#9a3a1e']];
    return [[4, 7, 8, 7, INK], [5, 8, 6, 5, VISOR], [11, 15, 1, 1, EYE]];
  }
  // Eyes carry the mood: idle, blink, talk, think, happy, sad, ask, sleep, off.
  function eyes(c, mood, f) {
    const human = c.acc === 'human', col = human ? '#1b1b24' : EYE;
    if (mood === 'off') return [];
    if (human) {
      const mouth = mood === 'happy' ? [[6, 12, 4, 1, '#9a4a3e'], [5, 11, 1, 1, '#9a4a3e'], [10, 11, 1, 1, '#9a4a3e']] : mood === 'sad' ? [[6, 12, 4, 1, '#9a4a3e']] : mood === 'talk' && f % 2 ? [[7, 12, 2, 1, '#9a4a3e']] : [[7, 12, 2, 1, '#c98a6a']];
      if (mood === 'blink' || mood === 'sleep' || mood === 'happy') return [[5, 10, 2, 1, col], [9, 10, 2, 1, col]].concat(mouth);
      return [[5, 9, 2, 2, col], [9, 9, 2, 2, col], [5, 9, 1, 1, '#4a4a5a'], [9, 9, 1, 1, '#4a4a5a']].concat(mouth);
    }
    switch (mood) {
      case 'blink': return [[6, 11, 1, 1, col], [9, 11, 1, 1, col]];
      case 'sleep': return [[6, 11, 2, 1, col], [9, 11, 2, 1, col]];
      case 'happy': return [[5, 10, 1, 1, col], [6, 9, 1, 1, col], [7, 10, 1, 1, col], [8, 10, 1, 1, col], [9, 9, 1, 1, col], [10, 10, 1, 1, col]];
      case 'think': return [[7, 8, 2, 2, col], [10, 8, 1, 2, col]];
      case 'sad': return [[5, 10, 2, 1, RED], [9, 10, 2, 1, RED], [6, 11, 1, 1, RED], [9, 11, 1, 1, RED]];
      case 'ask': return [[5, 8, 2, 3, AMBER], [9, 8, 2, 3, AMBER]];
      case 'talk': return [[6, 9, 1, 2, col], [9, 9, 1, 2, col]].concat(f % 2 ? [[7, 12, 2, 1, col]] : []);
      default: return [[6, 9, 1, 3, col], [9, 9, 1, 3, col]];
    }
  }
  // One accessory each, above the head. lit: Nib's bulb glows when thinking (the Stage 1 lamp).
  function accessory(c, lit) {
    switch (c.acc) {
      case 'antenna': return [[7, 1, 1, 3, INK], [6, 0, 3, 1, lit ? AMBER : '#5a4a2a'], [6, 1, 1, 1, lit ? AMBER : '#5a4a2a'], [8, 1, 1, 1, lit ? AMBER : '#5a4a2a']];
      case 'sprout': return [[7, 1, 1, 3, '#2c6b42'], [5, 1, 2, 1, '#8dd6a7'], [6, 2, 1, 1, '#8dd6a7'], [8, 0, 2, 1, '#8dd6a7'], [8, 1, 1, 1, '#8dd6a7']];
      case 'phones': return [[3, 2, 10, 1, '#e8e2d0'], [2, 3, 1, 2, '#e8e2d0'], [13, 3, 1, 2, '#e8e2d0'], [0, 6, 2, 5, '#e8e2d0'], [14, 6, 2, 5, '#e8e2d0'], [0, 7, 1, 3, '#8a8470'], [15, 7, 1, 3, '#8a8470']];
      case 'tower': return [[3, 2, 2, 2, c.shade], [7, 2, 2, 2, c.shade], [11, 2, 2, 2, c.shade], [3, 3, 10, 1, c.shade]];
      case 'tuft': return [[7, 2, 2, 2, c.shade], [6, 1, 1, 2, c.shade], [9, 0, 1, 2, c.shade], [8, 1, 1, 1, c.shade]];
      case 'human': return [[4, 3, 8, 1, c.hair], [3, 4, 10, 1, c.hair]];
      default: return [];
    }
  }
  // The founder: the same 16×21 footprint and outline, but a head on a body, so you read as the human.
  // The look (skin, hair style and colour, shirt, pants, accessory) comes from setLook (customize.js), or o.outfit for a preview.
  const LOOK0 = {skin: '#e9b88f', hair: 'fringe', hairColor: '#3b2416', shirt: '#f1e6c8', pants: '#2a3550', acc: 'scarf'};
  let LOOK = LOOK0, lookId = 0;
  const hex = /^#[0-9a-f]{6}$/i;
  function setLook(l) { l = l || {}; LOOK = {}; for (const k in LOOK0) LOOK[k] = typeof l[k] === 'string' && (k === 'hair' || k === 'acc' || hex.test(l[k])) ? l[k] : LOOK0[k]; lookId++; }
  const dark = (h, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * (k || 0.75)).toString(16).padStart(2, '0')).join('');
  // Hair styles: [front, back] rects, without colour.
  const FRINGE = [[3, 3, 10, 2], [3, 5, 1, 2], [12, 5, 1, 2], [9, 5, 2, 1]], BACK = [[3, 3, 10, 7], [4, 10, 8, 1]];
  const HAIR = {
    fringe: [FRINGE, BACK],
    short: [[[3, 3, 10, 1], [3, 4, 1, 2], [12, 4, 1, 2]], [[3, 3, 10, 5]]],
    long: [FRINGE.concat([[2, 4, 1, 8], [13, 4, 1, 8], [3, 5, 1, 6], [12, 5, 1, 6]]), [[3, 3, 10, 9], [2, 4, 1, 8], [13, 4, 1, 8]]],
    spiky: [[[3, 3, 10, 1], [3, 4, 2, 1], [7, 4, 2, 1], [11, 4, 2, 1], [4, 0, 2, 2], [7, 0, 2, 2], [10, 0, 2, 2]], BACK.concat([[4, 0, 2, 2], [7, 0, 2, 2], [10, 0, 2, 2]])],
    bun: [FRINGE.concat([[6, 0, 4, 2]]), BACK.concat([[6, 0, 4, 2]])],
    bald: [[], []],
  };
  const HOODS = {hoodie: '#5a6578', gold: '#e8b54a'};
  // Accessories, drawn last: front rects and back rects.
  function wear(acc, back, J) {
    const T = '#c4572b';
    switch (acc) {
      case 'scarf': return back ? [[3, 12, 10, 2, T]] : [[3, 12, 10, 2, T], [9, 14, 2, 2, T]];
      case 'glasses': { const F = '#4a5a7a'; return back ? [[3, 6, 1, 1, F], [12, 6, 1, 1, F]] : [[4, 5, 8, 1, F], [4, 6, 1, 2, F], [7, 6, 2, 1, F], [11, 6, 1, 2, F]]; }
      case 'shades': return back ? [[3, 6, 1, 1, INK], [12, 6, 1, 1, INK]] : [[3, 6, 1, 1, INK], [12, 6, 1, 1, INK], [4, 6, 8, 2, INK], [5, 6, 1, 1, '#5a6a8a'], [9, 6, 1, 1, '#5a6a8a']];
      case 'cap': { const C = '#c84230'; return back ? [[4, 1, 8, 1, C], [3, 2, 10, 3, C], [6, 4, 4, 1, dark(C)]] : [[4, 1, 8, 1, C], [3, 2, 10, 2, C], [5, 2, 2, 1, '#e06a55'], [2, 4, 12, 1, dark(C)]]; }
      case 'phones': { const B = '#d8dee8', P = '#2ec4a6'; return [[3, 0, 10, 1, B], [2, 1, 1, 3, B], [13, 1, 1, 3, B], [1, 4, 2, 4, P], [13, 4, 2, 4, P]]; }
      case 'hoodie': case 'gold': return back ? [[4, 1, 8, 1, INK], [4, 2, 8, 1, J], [3, 3, 10, 8, J]] : [[4, 1, 8, 1, INK], [4, 2, 8, 1, J], [3, 3, 10, 1, J], [3, 4, 1, 6, J], [12, 4, 1, 6, J], [6, 13, 1, 2, '#e8e2d0'], [9, 13, 1, 2, '#e8e2d0']];
      default: return [];
    }
  }
  function human(c, o) {
    const L = o.outfit ? Object.assign({}, LOOK0, o.outfit) : LOOK, mood = o.mood || 'idle', skin = L.skin, hc = L.hairColor;
    const J = HOODS[L.acc] || L.shirt, JS = dark(J), P = L.pants, out = [];
    // head
    out.push([4, 1, 8, 1, INK], [3, 2, 1, 1, INK], [12, 2, 1, 1, INK], [2, 3, 1, 7, INK], [13, 3, 1, 7, INK], [3, 10, 1, 1, INK], [12, 10, 1, 1, INK], [4, 11, 8, 1, INK]);
    out.push([4, 2, 8, 1, L.hair === 'bald' ? skin : hc], [3, 3, 10, 7, skin], [4, 10, 8, 1, skin]);
    const covered = L.acc === 'cap' || HOODS[L.acc]; // a cap or hood hides what pokes out on top
    for (const [x, y, w, h] of (HAIR[L.hair] || HAIR.fringe)[o.back ? 1 : 0]) if (!(covered && y < 2)) out.push([x, y, w, h, hc]);
    if (!o.back) {
      const e = '#1b1b24', m = '#9a4a3e';
      if (mood === 'blink' || mood === 'sleep') out.push([5, 7, 2, 1, e], [9, 7, 2, 1, e]);
      else if (mood === 'happy') out.push([5, 7, 2, 1, e], [9, 7, 2, 1, e], [6, 9, 4, 1, m], [5, 8, 1, 1, m], [10, 8, 1, 1, m]);
      else out.push([5, 6, 2, 2, e], [9, 6, 2, 2, e], [7, 9, 2, 1, mood === 'talk' && (o.f || 0) % 2 ? m : '#c98a6a']);
    }
    // body: shirt over pants
    out.push([3, 12, 10, 1, INK], [2, 13, 1, 6, INK], [13, 13, 1, 6, INK]);
    out.push([3, 13, 10, 4, J], [12, 13, 1, 4, JS], [3, 17, 10, 2, P], [12, 17, 1, 2, dark(P)], [7, 18, 2, 1, INK]);
    out.push([1, 13, 1, 4, INK], [14, 13, 1, 4, INK]);
    const st = o.step || 0;
    out.push(...(st % 2 ? [[4, 19, 3, 1, INK], [9, 19, 3, 2, INK]] : st ? [[4, 19, 3, 2, INK], [9, 19, 3, 1, INK]] : [[4, 19, 3, 2, INK], [9, 19, 3, 2, INK]]));
    out.push(...wear(L.acc, o.back, J));
    return out;
  }

  // All rects for one frame. o: {mood, step, f, lit, back, outfit (the founder's look, for previews)}
  function rects(id, o) {
    o = o || {};
    const c = CAST[id] || CAST.nib, mood = o.mood || 'idle';
    if (c.acc === 'human') return human(c, o);
    // Walking away: the founder shows the back of their head; bots show a plain back panel.
    if (o.back) return [].concat(accessory(c, false), body(c), limbs(c, o.step || 0), c.acc === 'human' ? [[3, 5, 10, 9, c.hair], [2, 14, 12, 2, c.trim]] : [[5, 8, 6, 4, c.shade]]);
    return breathe([].concat(accessory(c, o.lit || mood === 'think'), body(c), limbs(c, o.step || 0), visor(c, mood), glance(eyes(c, mood, o.f || 0), o.look)), o.breath);
  }
  // Idle life (motion #8): look (±1) moves the eyes a pixel that way, only if they still fit inside the visor;
  // breath drops everything above the feet one art pixel and leaves the feet planted. Whole art pixels only.
  const glance = (r, d) => d && r.every(([x, , w]) => x + d >= 5 && x + w + d <= 11) ? r.map(([x, y, w, h, col]) => [x + d, y, w, h, col]) : r;
  const breathe = (r, on) => on ? r.map(([x, y, w, h, col]) => [x, y < 18 ? y + 1 : y, w, h, col]) : r;
  function svg(id, o) {
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" aria-hidden="true">${rects(id, o).map(([x, y, w, h, col]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`).join('')}</svg>`;
  }
  // Draw at (x, y) = the point between the feet, px = size of one art pixel. flip mirrors left/right.
  // sx/sy squash and stretch from the feet: each rect is still snapped to whole screen pixels, so it stays crisp.
  function draw(g, id, x, y, px, o) {
    o = o || {};
    const qx = px * (o.sx || 1), qy = px * (o.sy || 1);
    const ox = x - W / 2 * qx, oy = y - H * qy - (o.bob || 0);
    for (const [rx, ry, w, h, col] of rects(id, o)) {
      g.fillStyle = col;
      const X = o.flip ? W - rx - w : rx;
      g.fillRect(Math.round(ox + X * qx), Math.round(oy + ry * qy), Math.ceil(w * qx), Math.ceil(h * qy));
    }
  }
  // Squash & stretch hop, as held frames [ms, lift, width, height] in art pixels, so every pose is a whole-pixel sprite:
  // squash (the wind-up), stretch up, hang, stretch down, squash on landing, overshoot, rest. nib.js and meet.html read them here; crew.css s3-hop repeats them for the waiting loop.
  const HOP = [[0, 0, 16, 21], [50, 0, 17, 20], [100, 0, 18, 18], [150, 0, 19, 17], [200, 3, 14, 24], [250, 5, 14, 24], [300, 6, 15, 23], [350, 7, 15, 22], [400, 8, 16, 22],
    [450, 9, 16, 21], [550, 8, 16, 22], [600, 6, 15, 23], [640, 3, 15, 23], [670, 1, 15, 23], [700, 0, 19, 17], [800, 0, 17, 20], [850, 0, 15, 22], [950, 0, 16, 21]];
  // The pose ms into a hop, or null once it's over (or right away under reduced motion: the final pose is standing still).
  function hop(ms) {
    if (!(ms >= 0 && ms < 950) || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return null;
    let f = HOP[0]; for (const k of HOP) if (ms >= k[0]) f = k;
    return {y: f[1], sx: f[2] / W, sy: f[3] / H};
  }
  const api = {CAST, W, H, rects, svg, draw, hop, setLook, LOOK0, get look() { return Object.assign({}, LOOK); }, get lookId() { return lookId; }};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Avatars = api;
})(typeof window !== 'undefined' ? window : null);
