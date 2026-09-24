# Cantina Simulator — game design

Build a staged security company simulator. Initially local; published to the user-authorized personal Vercel account on September 23, 2026. See README.md for the production target and verification.

Core interactions: title screen; sparse 60/40 diagram/log split; one manual action at the start; outputs and connectors appear after activity; milestones freeze time and expose an explicit funding action; funding unlocks a new stage and a short stage introduction; headcount and compute use up/down recurring-budget controls; scarce inputs are highlighted; the graph expands only as systems become available.

Cantina styling verified at cantina.xyz (redirects to cantina.security): official cream globe and wordmark SVGs, deep navy surfaces, rust-red accent, Overused Grotesk body and Space Grotesk headings. Use the downloaded official assets in dist/assets.

Stages:
1. Solo researcher: HUNT, fixed compute, discovery and valid output. Earn the first bounty.
2. Human validation: cash/payroll, adjustable engineer count, fewer false positives. Raise seed funding.
3. AI research: adjustable compute and researchers; a harness that improves continuously. Unlock growth.
4. Publicity: adjustable marketers, higher bounty revenue. Reach the final milestone.

No card grid, upgrade store, hero, five-stat strip, or repeated explanatory copy. Core controls live inside graph nodes. Definitions go in on-demand explanations. One milestone and a chronological log occupy the right panel.

Verify staged visibility, each control, pause/funding transitions, valid/critical relationships, budget limits, saved progress, full progression and mobile layout.

## Marginal percentages and balance update
- Show the actual percentage effect of one more/less allocation beneath each arrow, recalculated from current resources. Tooltips identify the affected output; impossible reductions show an em dash.
- Preserve the sparse graph, staged systems, current saves and existing Vercel target. Tune diminishing returns and recurring costs to make balanced spending more important without introducing new systems.
- Characterize the old 237-day balanced strategy; have two Luna agents review balance and play through the updated browser UI. Verify marginal arithmetic, viable progression, overspending/recovery and responsive layout; deploy and verify the installed static files.

Completed: dynamic marginal percentages; nonlinear production and costs; $10k/$25k funding; one-month cost reserve for expansion. Existing saves retained. 20 tests, Luna strategy simulations and full browser victory, responsive checks and live production smoke passed. Release `dpl_8VuRthBaSJ13K9hUKDLMSV1XkFHW`; eight live assets matched source hashes.

## Audit fixes — September 24
Fix all four findings: exclusive tab ownership with v3 save migration; cash exhaustion pauses with allocations retained and an explicit solo recovery option; notify every cash-exhaustion event; fixed simulation substeps independent of speed. Preserve balance and old-save import. Add targeted regressions, reproduce browser multi-tab and insolvency flows, obtain Astra medium review, deploy to established personal Vercel target, and verify live assets and UI.

Completed September 24: all four fixes, 34 passing checks and Astra medium browser retests. Deployed release `dpl_Gp6N28zEtWTB3Ak4RBxZWMpnL8uf`; all nine live assets matched tested source. Production migration, repeat reload and duplicate-tab blocking passed with existing progress intact.
