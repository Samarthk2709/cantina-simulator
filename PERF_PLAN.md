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
