# Performance plan: First Office

Chrome flagged the tab ("This tab is using extra resources"). Goal: use much less CPU, GPU and battery without dropping any feature, and without visible lag. Game speed stays the same because everything moves by `dt`, not by frame count.

## What's using the resources

Measured idle on a fresh save (in-app browser, 120 Hz display, DPR 2): **362 frames in 3 s**, and the world canvas (1280×800) redrawn on every one of them, even with nobody moving. A Stage 3 save with a team hired adds more loops on top.

| Source | File | Problem |
|---|---|---|
| World `frame()` | `original/world.js:1063` | Full canvas redraw every frame at display rate (120 fps on ProMotion). Re-runs label layout and `measureText` every frame. Sprite art only changes 8×/s (`f = t*8`). |
| Nib `frame()` | `nib.js:153` | Second full-viewport canvas, cleared and redrawn every frame. His art only changes 7×/s. |
| `camTick` | `game.js:757` | Third always-on rAF, just to check the camera. |
| Harness `frame()` | `stage3/harness.js:620` | Fourth always-on rAF (agent movement). |
| Crew `drawLayer()` | `stage3/crew.js:72` | Fifth rAF. Every frame per agent: writes `style.cssText` (left/top), builds HTML strings, `querySelector`, `offsetWidth`, `getAnimations()` → style recalc + layout every frame. |
| Crew `lifeLoop` | `stage3/crew.js:231` | Sixth rAF: `querySelectorAll` every frame for blinks/breaths that change every 1–3 s. |
| Timers | `buttons.js:98`, `game.js:1142`, `harness.js:711-712` | 250 ms nudge tick, 1 s position save to localStorage (even when standing still), 3 s persist. |
| CSS | `crew.css`, `original/style.css` | Infinite animations (bob, sway, hop, blink, reward glow) and a `backdrop-filter` dim layer keep the compositor busy. |

Root cause: six independent loops all run at the screen's refresh rate forever, and each redraws everything whether or not anything changed.

## Plan

### Phase 0: Baseline (do first)
- Add `tests/perf.cjs` (Playwright + Chrome DevTools Protocol `Performance.getMetrics`). It records script time, style recalcs, layouts, frames drawn and long tasks over 10 s in four cases: idle office, walking, Stage 3 with 4+ agents working, team view open.
- Add a Stage 3 save fixture so the heavy case can be reproduced.
- Record "before" numbers in this file.

### Phase 1: One loop instead of six
- New `loop.js`: a single `requestAnimationFrame` with subscribers. Each system's `tick(dt, now)` returns whether it still needs frames.
- When nothing needs frames the loop stops. It wakes on input, state change, a timer, or `visibilitychange`.
- Cap drawing at 60 fps (skip every other frame on 120 Hz screens). Movement stays `dt`-based, so walking speed doesn't change.
- Move world, Nib, camTick, harness, crew and lifeLoop onto it.

### Phase 2: Only redraw the world when something changed (`world.js`)
- Redraw only when: the player or a founder moves, the camera is easing, the animation frame index `f` changes (8×/s), labels/timers/floats/rings change, or the room or HQ tier changes. Idle drops from 120 redraws/s to about 8.
- Cache the label layout and `measureText` widths. Recompute only when the label set, nearby station or timer text changes.
- Safety net: force a full redraw at least every 250 ms, so a missed trigger can't leave the screen stale for long.

### Phase 3: Nib layer (`nib.js`)
- Same dirty rule: redraw on his frame index (7×/s), movement, bubble spring or dust.
- Clear and redraw only his bounding box (plus dust), not the whole viewport.
- Only call `positionBubble` (which reads layout) when Nib or the bubble actually moved.

### Phase 4: Crew floor layer (`stage3/crew.js`, `harness.js`)
- Position sprites with `transform: translate()` instead of `left`/`top`, and only write it when the rounded value changes.
- Rebuild a sprite's HTML only when its state or phrase changes, not every frame.
- Cache bubble sizes (already partly done). Drop the per-frame `getAnimations()` read: compute the hop landing time from the known 1.6 s loop and the agent's offset.
- `lifeLoop`: replace the rAF with a timer that wakes at the next blink or breath change. The `MutationObserver` already handles new nodes.
- Harness `step()` runs only while an agent is walking or winding up. `secondTick` moves to a 1 s interval.

### Phase 5: Timers and storage (`game.js`, `buttons.js`, `harness.js`)
- Position save: write on stop and on `pagehide`/`visibilitychange`, not every second.
- Nudge tick: driven by the `MutationObserver` plus one timer set to the next nudge time, not a 250 ms poll.
- Pause every interval while the tab is hidden.

### Phase 6: CSS and compositing
- Pause infinite animations when off screen or when the team view hides them (`animation-play-state` or a class on the hidden layer).
- Add `contain: layout paint` to `#s3-layer`, the HUD, the dock and the vitals box so their changes don't re-lay out the page.
- Replace the `backdrop-filter: saturate()` on `.s3-dim` with a plain translucent overlay (it looks almost the same and is much cheaper).
- Use `will-change: transform` only on sprites that are actually moving.

### Phase 7: Memory check
- Run 10 minutes of Stage 3 play with heap snapshots at the start and end. Look for growing `sprites`, `trails`, `DUST`, `LIFE`, toasts and the per-room background canvas cache (`bgs`, one per room×tier). Cap or free what grows.

## Targets
- Idle office: under 10 world redraws/s, about 1–2% main-thread CPU.
- Stage 3 busy: no style recalc or layout on frames where no agent moved. No frame over 16 ms.
- Chrome's "extra resources" prompt no longer shows after 10+ minutes of play.
- Walking, camera and agents look and feel the same (side-by-side screen recordings).

## Verification
- All existing tests pass: `tests/engine.cjs`, `flow.cjs`, `browser.cjs`, `pacing.cjs`, `stage3-play.cjs`.
- `tests/perf.cjs` before/after numbers recorded here.
- Screenshot diff against `evidence/` for each stage.
- Manual check at 60 Hz and 120 Hz, with and without reduced motion, on desktop and phone width.

## How to run the work
1. Phase 0, then Phase 1, on `main` (the shared loop is what every later phase builds on).
2. Phases 2, 3, 4 and 5+6 touch separate files, so they can go to parallel agents in their own worktrees and be merged after.
3. Phase 7, then verification, after the merge.

Main risk: a dirty flag that misses a trigger leaves something frozen on screen. The 250 ms forced redraw and the screenshot diffs cover that.

## Results (2026-10-28)

All phases are done and merged. Every test passes (`engine`, `pacing`, `browser`, `flow`, `stage3-play`), and an independent code review found no stalls or visual regressions; its two small timing findings were fixed. Method: `tests/perf.cjs`, headless Chrome at 1440×900, median of 3 runs (baseline: 2), 8 s per case. Raw data is in `perf/30fps/` (per-phase runs) and `perf/60fps/` (final vs baseline).

Units: task = main-thread ms per second, restyle and layout = per second, paint = frames per second with any canvas drawn, rAF = animation-frame callbacks per second.

### Per phase, cumulative (each row adds that phase to the ones above; % vs baseline)

These runs were at a 30 fps frame cap (laptop on battery), so they understate the gains on a real 60–120 Hz screen.

| After | Idle office: task · paint · rAF | Walking: task · layout | Ch3 team idle: task · restyle · rAF | Ch3 working: task · restyle · layout | Team view: task · restyle |
|---|---|---|---|---|---|
| Baseline | 26.9 · 30 · 90 | 48.3 · 23.6 | 53 · 34 · 181 | 71 · 66.5 · 18.4 | 55.3 · 63.3 |
| 1 One loop | −6% · 0% · −67% | −14% · 0% | −2% · +2% · −83% | +3% · +5% · +17% | +2% · 0% |
| 2 World redraws | −25% · 0% · −67% | −8% · 0% | −29% · +2% · −83% | −18% · −6% · −14% | −21% · −1% |
| 3 Nib layer | −45% · −70% · −67% | −24% · 0% | −28% · +3% · −83% | −15% · +4% · +17% | −27% · −1% |
| 4 Crew + harness | −42% · −70% · −67% | −4% · 0% | −40% · −79% · −83% | −30% · −33% · −62% | −34% · −46% |
| 5 Timers | −57% · −71% · −90% | −2% · 0% | −51% · −79% · −94% | −36% · −33% · −62% | −29% · −46% |
| 6 CSS | −58% · −70% · −90% | −5% · 0% | −52% · −80% · −94% | −37% · −32% · −61% | −31% · −46% |

Phases 1–3 show little on their own because the page only goes idle when every system can sleep. The big drops land when the last always-on loop stops (Phase 5's camera tick). Task time varies about ±20% between runs; the counts (paint, rAF, restyle, layout) are stable.

### Final vs baseline at 60 fps (same session, runs alternated)

After the phases, two follow-up fixes went in: the lamp layer moves by `transform` (walking with the follow camera no longer forces a layout every frame), and the review's two timing fixes.

| Case | Task ms/s | Script ms/s | Restyles/s | Layouts/s | Paint fps | rAF/s |
|---|---|---|---|---|---|---|
| Idle office | 58.6 → 16.3 (−72%) | 30.8 → 5.4 (−82%) | 0 → 0 | 0 → 0 | 60 → 9.1 (−85%) | 180 → 9.1 (−95%) |
| Walking | 83.8 → 60 (−28%) | 30.8 → 27.8 (−10%) | 53 → 52.9 | 47.2 → 0 (−100%) | 60 → 59.8 | 180 → 60 (−67%) |
| Ch3 team idle | 103 → 30.5 (−70%) | 54 → 10.4 (−81%) | 64.7 → 6.7 (−90%) | 5 → 4.7 | 60 → 10 (−83%) | 361 → 11 (−97%) |
| Ch3 team working | 139.5 → 80.2 (−43%) | 56.6 → 24.6 (−57%) | 124.2 → 111.6 (−10%) | 23.9 → 8 (−67%) | 60 → 38.3 (−36%) | 362 → 60.6 (−83%) |
| Team view open | 117 → 56.1 (−52%) | 50.3 → 15.2 (−70%) | 123.3 → 64.6 (−48%) | 14.5 → 9.5 (−34%) | 60 → 14.1 (−77%) | 372 → 40.6 (−89%) |

Walking and agents working still draw every frame, because something really is moving. Most of what's left while agents work is the CSS bob/sway/hop animations restyling each frame.

### Memory (Phase 7)

`tests/memory.cjs` plays chapter 3 at 10× (agents, nights and the team view). Over 5 minutes, about 50 minutes of game time, the JS heap after GC is flat at 4.2 → 4.7 MB, event listeners hold at 102, and DOM nodes only follow what's on the page. The page grows from 538 to 696 nodes as the team-view timelines fill up to the agent log's 480-entry cap, and that growth is already slowing. There is no leak.

An earlier version of the test seemed to show a leak: about 19 nodes a second and one listener every 8 s, on main as well. A heap-snapshot retainer trace pinned it on the test itself. Each `page.$('.nib-next')` element handle stayed pinned under "DevTools console" for the whole run. Each pinned button's click listener kept Nib's typing closure alive, and that closure kept every per-character `<span>` of his line. The test now clicks through `page.evaluate`. Use the same approach in any long-running Playwright test.
