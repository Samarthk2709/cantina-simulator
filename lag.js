/* Lag log: finds when the office gets slow and what was running. Always on and cheap.
   - Every frame of the shared loop (loop.js) is timed, and so is each tick in it, by name.
   - Long tasks (main thread blocked 50 ms+) are caught by the browser's PerformanceObserver.
   - Hot paths count their calls: Lag.count('render'), Lag.count('drawWindow'), ...
   Every 5 s, if the window had a slow frame or a long task, one line goes to the console and to the server
   (POST /api/lag, appended to data/lag.log). Lag.report() prints the last 50 windows; Lag.now() the current one. */
(function () {
  'use strict';
  const SLOW_FRAME = 50, WINDOW_MS = 5000, KEEP = 50;
  let w = fresh(), sent = [], last = performance.now();
  const hist = [];
  function fresh() { return { t0: Date.now(), frames: 0, awake: 0, gaps: 0, jank: 0, worstGap: 0, slow: 0, worst: 0, worstTicks: null, ticks: {}, longTasks: 0, longMs: 0, scripts: {}, counts: {} }; }
  const Lag = {
    // loop.js reports each frame: total ms, and ms per tick name.
    // gap: ms since the previous frame when the loop kept running (null after a sleep). Over 50 ms = a visible hitch,
    // whatever caused it (our ticks, layout, paint, GC, other code).
    frame(ms, ticks, gap) {
      w.frames++;
      if (gap != null) { w.gaps++; w.awake += gap; if (gap > SLOW_FRAME) w.jank++; if (gap > w.worstGap) w.worstGap = gap; }
      for (const k in ticks) w.ticks[k] = (w.ticks[k] || 0) + ticks[k];
      if (ms >= SLOW_FRAME) { w.slow++; if (ms > w.worst) { w.worst = ms; w.worstTicks = ticks; } }
    },
    count(k) { w.counts[k] = (w.counts[k] || 0) + 1; },
    now: () => w,
    report() { console.table(hist.map(h => ({ at: new Date(h.t0).toLocaleTimeString(), fps: h.fps, hitches: h.jank, worstGap: h.worstGap, slow: h.slow, worst: h.worst, longTasks: h.longTasks, top: h.top, counts: JSON.stringify(h.counts) }))); return hist; },
  };
  window.Lag = Lag;
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) { w.longTasks++; w.longMs += e.duration; } }).observe({ type: 'longtask', buffered: false });
  } catch {}
  // Chrome 123+: long animation frames name the scripts that ran in them.
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) for (const sc of e.scripts || []) { const k = (sc.sourceFunctionName || sc.invoker || '?') + ' ' + String(sc.sourceURL || '').split('/').pop(); w.scripts[k] = (w.scripts[k] || 0) + sc.duration; } }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {}
  function round(o) { const r = {}; for (const k in o) r[k] = Math.round(o[k] * 10) / 10; return r; }
  function flush() {
    const now = performance.now(), secs = (now - last) / 1000; last = now;
    if (document.hidden) { w = fresh(); return; }
    const top = Object.entries(w.ticks).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(', ');
    const g = window.Stage2?.state?.(), A = window.Stage3Agents;
    const h = {
      t0: w.t0, fps: w.awake ? Math.round(w.gaps / (w.awake / 1000)) : null, jank: w.jank, worstGap: Math.round(w.worstGap), scripts: Object.entries(w.scripts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(', '), slow: w.slow, worst: Math.round(w.worst), worstTicks: w.worstTicks && round(w.worstTicks), longTasks: w.longTasks, longMs: Math.round(w.longMs), top, counts: w.counts,
      dom: (w.jank || w.slow || w.longTasks) ? document.getElementsByTagName('*').length : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      chapter: g ? (g.stage === 3 ? 3 : 2) : null, day: g?.day, agents: A ? A.list().length : 0, busy: A ? A.busy() : 0, window: window.Stage2?.ui?.().win || null, team: document.body.classList.contains('s3-agents-open'),
    };
    hist.push(h); if (hist.length > KEEP) hist.shift();
    if (h.jank || h.slow || h.longTasks) {
      console.warn(`[lag] ${h.jank} hitch(es), worst gap ${h.worstGap} ms, fps ${h.fps ?? 'idle'} · ${h.slow} slow tick frame(s) worst ${h.worst} ms · ${h.longTasks} long task(s) ${h.longMs} ms · ticks: ${top || 'n/a'}${h.scripts ? ' · scripts: ' + h.scripts : ''} · calls ${JSON.stringify(h.counts)}`);
      sent.push(h);
    }
    w = fresh();
  }
  function send() {
    if (!sent.length) return;
    const body = JSON.stringify({ page: location.pathname, ua: navigator.userAgent.slice(0, 120), rows: sent.splice(0, 20) });
    try { navigator.sendBeacon ? navigator.sendBeacon('/api/lag', new Blob([body], { type: 'application/json' })) : fetch('/api/lag', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }); } catch {}
  }
  setInterval(() => { flush(); send(); }, WINDOW_MS);
  addEventListener('pagehide', () => { flush(); send(); });
})();
