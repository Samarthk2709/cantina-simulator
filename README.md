# Cantina Simulator

A staged security company simulator with an expanding production diagram, milestones, a chronological log, and recurring-budget controls.

## Play

Public link: [cantina-simulator.vercel.app](https://cantina-simulator.vercel.app). No login is required.

Source: [Samarthk2709/cantina-simulator](https://github.com/Samarthk2709/cantina-simulator).

Serve locally from this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Visit http://127.0.0.1:4173. No installation, build, account, or network connection is needed after obtaining these files.

## Progression

1. **Solo researcher:** HUNT manually. Prove five bugs are valid and collect the first bounty.
2. **Human judgment:** Hire engineers with the ▲/▼ controls. They validate automatically and lower false positives. Reach seed funding.
3. **Better tools:** Increase compute and hire AI researchers. Compute finds more bugs and criticals; researchers continuously improve Apex.
4. **Publicity:** Hire marketers to increase bounty revenue. Complete the final milestone.

Milestones pause time until you explicitly collect funding. Each new stage introduces its controls and returns to 1×. Click output labels for explanations. The pause control freezes hunting and simulation; budget adjustments are allowed while paused. At 1×, one real second advances one game day. Monthly budgets are charged over 30 game days. Larger teams and fleets cost more per additional unit; expanding requires cash to cover one month of total costs. Production has diminishing returns, and publicity grows more slowly as it rises.

The percentages beneath ▲/▼ are recalculated from the actual effect of adding or removing one unit. Engineers show steady-state valid bugs/day; compute shows findings/day. Researchers show projected harness strength after 30 days, and marketers show projected bounty value after 30 days, using current growth rates. Hover an arrow for its metric; unavailable reductions show an em dash.

Validation and critical findings use deterministic fractional counters. The false positive figure is a projected rejection rate, not a historical ratio. Revenue projections assume steady-state throughput. If cash runs out, simulation pauses and retains your staff and GPUs. A persistent warning lets you review budgets or explicitly cancel paid allocations and continue solo. Each cash-exhaustion event is logged. Solo research and the original GPU then rebuild income. All speeds use fixed 0.2-day simulation steps, with fractional elapsed time retained in saves.

Progress saves locally every two seconds and after actions. An exclusive Web Lock allows only one active game tab per browser origin; another tab must wait for the owner to close and retry, loading the latest state. HTTPS or localhost and a browser with Web Locks support are required. The `cantina-simulator-v3` storage key imports the existing `cantina-simulator-v2` save once without deleting it. This isolates current progress from older game tabs that may still write v2. The state schema remains version 2. Closed-page progress and cloud sync are not included; background throttling may slow time. Refresh older open game tabs to use the fixes. Already-lost staff or overwritten historical progress cannot be reconstructed automatically.

## Branding and source

Official Cantina globe/wordmark SVGs and Space Grotesk / Overused Grotesk fonts were obtained from [Cantina’s live website](https://cantina.xyz) on September 22, 2026. Asset URLs:

- `https://www.cantina.security/_astro/cantina-logo-mark.ux2LAKV0_ZYdbTN.svg`
- `https://www.cantina.security/_astro/cantina-logo-wordmark.CUzIEN0l_2afbai.svg`
- `https://www.cantina.security/fonts/SpaceGrotesk-VF.woff2`
- `https://www.cantina.security/fonts/OverusedGrotesk-VF.woff2`

The game implementation is original. All security actions and company metrics are fictional simulations. It performs no real scanning, hiring, or payments. The static game is published to Vercel as a static site. Only the nine browser assets in `dist/` are published; local documentation, tests, and authentication files are not part of the site.

## Files and verification

`dist/engine.js` contains the simulation; `dist/app.js` contains controls and graph layout; `dist/save.js` owns locking, migration and persistence; HTML/CSS and brand assets are also in `dist/`. `plan.md` records the revised scope.

Run the checks from this directory:

```sh
node tests/engine.cjs
node tests/regressions.cjs
node tests/save.cjs
```

All 34 checks pass: 20 game checks, six new timing/insolvency regressions, and eight persistence checks. The six engine regressions fail against the pre-fix engine. Balanced progression still finishes in 508 simulated days without insolvency. Astra medium reviewers verified actual browser bankruptcy/recovery, repeat warnings, reload, tab exclusion and latest-state handoff. The parent also verified an actual old saved run migrated with its 30 valids, 2 engineers, cash and pending milestone intact. See `audit.md` for the findings and verification limits.

## Deployment

Production: [cantina-simulator.vercel.app](https://cantina-simulator.vercel.app). The September 24, 2026 release is `dpl_Gp6N28zEtWTB3Ak4RBxZWMpnL8uf`.

Deploy the `dist/` directory with Vercel; there is no build step or backend. Run the three test commands above first. Authenticate to the intended Vercel account and link the project before deploying:

```sh
cd dist
vercel whoami
vercel link
vercel deploy --prod
```

Local Vercel project links and credentials are excluded from Git. This repository does not configure automatic deployments.

Release verification: all 34 checks passed. Two Astra medium agents verified cash-exhaustion recovery, repeated warnings, retained staff after reload, tab exclusion and latest-state handoff through actual browser controls. Legacy-save migration preserved an existing 30-valid, two-engineer run and its pending milestone. Anonymous HTTPS requests returned 200 for all nine public assets, with SHA-256 hashes identical to the promoted source. Live production smoke preserved the existing paused run ($5,000, 2 engineers, 5 valids) across migration and a second reload; a duplicate tab was blocked. No browser console errors or warnings were observed. Speed equivalence was verified by deterministic engine regressions; actual browser back-forward-cache restoration was not conclusively verified.
