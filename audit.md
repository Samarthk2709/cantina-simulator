# Cantina game bug audit

**Fix status, September 24:** All four findings have implementation and regression coverage. Cash exhaustion now pauses with allocations retained and an explicit recovery choice; every event is logged. Fixed 0.2-day simulation steps produce identical speed-independent outcomes. Exclusive tab ownership and v3 migration prevent stale/old tabs from overwriting current saves. All 34 checks passed, including six engine regressions that fail against the original release. Two Astra medium agents verified the corrected browser flows. The report below preserves the original reproduction evidence. Published as `dpl_Gp6N28zEtWTB3Ak4RBxZWMpnL8uf`; all nine live assets match tested source, and production migration, reload and duplicate-tab blocking passed. Deployment details are in README.md.

Read-only audit of the deployed percentage/balance release, September 23, 2026. Two `gpt-6-astra` agents at `medium` reasoning each read the code and tested the app through browser controls on isolated local origins. The parent independently reviewed controls and reproduced engine findings. A third reviewer could not be created because the session hit its agent limit; the parent covered that scope. No production code, tests, user saves, or deployment were changed.

The live `engine.js`, `app.js`, `index.html`, and `style.css` all matched the audited local files byte-for-byte. All 20 existing tests pass; the findings below reveal missing coverage.

## Screenshot diagnosis

The screenshot itself records “Cash ran out” on March 4. `dist/engine.js:25` sets engineers, researchers, and marketers to zero and compute to one as soon as cash becomes negative. The simulation then keeps running, so later cash can be positive while the staff remain gone. This explains the screenshot's $1,300 cash / zero engineers / +$446 net combination. It is not a numeric display rounding issue.

Bankruptcy is an implemented game rule. Its misleading description and silent state changes are defects described below; merely allowing an unprofitable staffing choice is not classified as a bug.

## 1. P1 — A stale tab silently overwrites newer progress

**Browser confirmed by Astra persistence reviewer.** `dist/app.js:3` reads local storage once; `app.js:6` unconditionally overwrites it. `app.js:43–44` saves on lifecycle events and every two seconds, including while paused, without coordinating tabs.

Reproduction: open a second tab at the paused first funded stage (5 valids, no engineers, $5,000). Progress the first tab to 30 valids / 2 engineers and claim seed funding into Stage 3. Close it. Let the stale paused tab autosave, then reopen the game. It restores Stage 2, 5 valids, zero engineers and $5,000. The new stage, funding and 25 valids are lost with no warning.

**Recommended correction:** coordinate a single writer or use explicit save revisions and run IDs to reject stale writes. An intentional restart must remain distinguishable from an old snapshot.

## 2. P2 — Bankruptcy permanently deletes allocations while calling them “paused”

**Browser and Node confirmed by Astra economy reviewer.** `dist/engine.js:25`; supporting explanation at `dist/app.js:41`.

Reproduction: collect the first $5,000 bounty; pause; hire five engineers; select 16×; run. The game permits the allocation ($4,486/mo, −$2,876 net/month). Around 50–51 simulated days later, cash exhaustion clears the staff. The game keeps running without an interrupt, and recovering cash does not restore the team. Reload preserves zero engineers. The sole log says budgets are “paused,” although no suspended allocation is retained.

**Recommended correction:** make the loss explicit and conspicuous. Either accurately describe dismissal/return of resources, or implement an actual suspension that retains allocations. Auto-pausing at the event would give the player a chance to understand and rebalance.

## 3. P2 — A second bankruptcy can delete rehired staff without any log

**Node runtime confirmed independently by reviewer and parent, using legal game actions from a fresh run. Browser confirmation incomplete.** `dist/engine.js:25` only logs when `insolvent` is false; that flag clears only above $1,000 cash.

Reproduction: hire two engineers and reach seed. Claim seed and hire researchers until the reserve check refuses more. Run to bankruptcy at day 107.2. Recover to $900 and hire one researcher, an accepted allocation. The next bankruptcy at day 282.8 deletes that researcher. There is still only one bankruptcy entry, from day 107.2. Cash never exceeded $1,000 during this legitimate rebuild, so the second loss is suppressed.

**Recommended correction:** identify each distinct active-budget-to-shutdown transition, or reset the event latch when paid allocations resume. The arbitrary cash threshold should not suppress another loss notification.

## 4. P2 — Simulation speed changes bankruptcy outcomes

**Node runtime confirmed by parent; exact paired browser replay not performed.** `dist/engine.js:24–25` processes all production/bounties for a tick before subtracting that tick's payroll, then tests insolvency. `dist/app.js:44` passes larger game-day steps at higher speed.

Reproduction from real engine actions:

```js
const G = require('./dist/engine.js');
const s = G.fresh();
s.started = true; s.paused = false;
for (let i = 0; i < 13; i++) G.hunt(s);
G.claim(s); s.paused = false;
for (let i = 0; i < 5; i++) G.adjust(s, 'engineers', 1);
for (let i = 0; i < 236; i++) G.step(s, .2);
const slow = structuredClone(s), fast = structuredClone(s);
for (let i = 0; i < 16; i++) G.step(slow, .2);
G.step(fast, 3.2);
```

Both branches start at day 47.2 with $341.95, five engineers and 25 valids, and advance exactly 3.2 game days. Sixteen normal 1× slices end at $0, zero engineers and 26 valids. One nominal 16× slice ends at $63.44, five engineers and 27 valids. Thus speed affects game state, not only the wall-clock pace. This does not claim the five-engineer strategy survives indefinitely: it is unprofitable at either speed. The confirmed defect is the divergent forced-shutdown decision at the same simulation time.

**Recommended correction:** run the economy in consistent simulation substeps or process financial events chronologically, independent of display speed. Add an equivalence test around low-cash and milestone boundaries.

## Verification limits

- Browser-confirmed: first bankruptcy and saved allocation loss; duplicate-tab progress loss; intro and pending-milestone reloads; restart cancel/confirm; first two funding transitions and basic controls.
- Engine-confirmed: repeated bankruptcy notification suppression and speed-dependent shutdown.
- Existing 20 engine tests passed without changes. No malformed-save or security findings are asserted.
- The economy review's browser connection became unavailable after its primary reproduction/reload checks, so its second-loss finding remained Node-only. The persistence review finished its browser checks normally.
- Long OS sleep, storage quota failures, and an exact side-by-side browser timing comparison were not tested.

Detailed reviewer evidence: `work/astra-audit/economy.md` and `work/astra-audit/persistence.md` in the task workspace. Prompts were saved before dispatch in the same directory.
