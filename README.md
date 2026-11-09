# First Office · Stages 1–3

Stages 1–3 of the [roadmap](../../work/ROADMAP.md) as one game: one server, one address, one save.

1. **Meet Nib** (`meet.html`). The dark room, the lamp, Nib. Accepting the job fades into the office.
2. **First job together** (`/`). 5 bugs and 1 critical in the office. Nib already knows your name from Stage 1.
3. **Hire help** (same page). The Stage 2 ending, or the goal button once the first job is done, starts chapter 3. The same save continues: same money, rep and tools, plus Pip and Moss. The goal is Elite (60 rep) with at least 5 bugs from agents. A fifth program, **Parcelly**, opens only in chapter 3, so the team always has fresh work.

## Run

```sh
node outputs/first-office/server.cjs
```

Open **http://localhost:55188/**. A new browser starts at Stage 1. The server reads `DEEPINFRA_API_KEY` from `./.env` or `../cantina-game/.env`, and the key never reaches the browser. Without a key, Nib's Stage 1 lines use a local llama-server on :8088 if one is running, otherwise scripted lines, and agents use scripted lines. Change the port with `FIRST_OFFICE_PORT`.

**Menu → Chapters** replays Stage 1, restarts the first job, or jumps to chapter 3 with a finished first job (for testing).

## What Stage 3 changed from the prototype

The prototype (`work/stage3/`) ran on Codex's old Stage 2. It's now built on the Stage 2 rebuild, and it fixes the playtest failures from Oct 22:

| Problem in the playtest | Now |
|---|---|
| "Why were there no bugs?" started a new task | Questions always go to chat |
| "hunt for mo bugs" became "stop after 0 more" | A stop at 0, or one that's already met, is dropped, with a note saying so |
| No way to say "pick for me" | `auto` and `current` programs. With no program named, the agent stays on its last one or picks the one with the most work no teammate is on |
| Tasks with nothing to do started and ended instantly | A check before starting. If it fails, the agent says why and suggests a fix ("ChatterBox is picked clean. Northwind Bank has 8 left") |
| Chat couldn't explain past tasks | Each finished task keeps its reason, and replies see it |

## The team view (2026-10-25, after Grok Bot)

Modeled on [Grok Bot's design](https://x.ai/news/designing-grok-bot): a roster instead of dashboards, in our palette.

- **One way in:** a **Team** button in the HUD, which shows how many are working or need you. **← Office** takes you back.
- **Roster:** each agent shows its name and what it's doing in a few words ("Hunting in Payments", "Writing up the race condition", "Needs you · Buy Tracer for $900?", "Out of focus · back tomorrow"). The avatar's motion shows its state: it bobs while working, sways while thinking, hops when it needs you, shakes after a penalty, and stays still when idle or done. There are no status dots.
- **Task title:** when you brief an agent, Gemma writes a short title for the task ("Researching rig upgrades"). The game writes one if the model is offline.
- **Timeline:** one per agent. Tool steps fold into "▸ 12 steps". Results (✓ bug · program · grade · $) and penalties stay visible.
- **Cards only for decisions.** Spending shows **Allow once / Always allow up to $1,000 / Don't**, and waits with no timer. Each penalty card has a one-tap fix: "Add to AGENTS.md: …".
- **Removed:** the all-agents grid, Context panels, per-agent rule files, example chips, speed/pause/reset, the attention meter, the model label and the red penalty banner. The office shows each agent's phrase in its bubble, Nib's too.

Agents get **their own focus each day** at your prices (map 15, find 30, wrong line 8, prove 15). When it runs out they rest until you sleep, so good rules mean more bugs per day. Agents never teach Nib: that stays your job. Agent finds skip the teaching step and go straight to a report. Scope penalties apply to you too in chapter 3.

## Playtest fixes (2026-11-05, Pablo)

- **Coffee and Sleep are pointed out.** A bouncing arrow and ring sit on the button when focus first runs low, and again whenever an action fails for focus (`pointTo` in game.js).
- **Sleep costs a real minute.** The night counts down for 60 s (`sleepMs`); coffee stays the instant, limited option (2 cups a day). A reload mid-sleep shows the rest of the wait (`fo.restUntil` in localStorage). Away nights skip the wait. Tests shorten it with `Stage2.sleepMs(ms)`.
- **One new thing at a time.** The first bounty only brings Coffee, Sleep and the ledger. The Shop opens at the 2nd bug, the Goal board at the 3rd (or when you buy the Tracer).

## Motion rules (2026-10-26)

From [ugoki.ai's reel](https://www.instagram.com/reel/De-LYA1xhDV/). Every animation follows them. Tokens are in `style.css` (`--stagger`, `--wind`, `--settle`).

1. **Anticipation:** pull back about 6 frames (100 ms) before moving. Toasts, Nib's bubble, new dock buttons, the stamp, Stage 1's goal card and chips, and the waiting hop all do it. Nib and agents crouch a pixel and lean back before they start walking.
2. **Offset:** things that arrive together start 3 frames (50 ms) apart. This covers new dock buttons, Stage 1's chips and goal rows, the avatar loops in the roster, and the agents' walk bobs.
3. **Motion blur:** only fast movers blur, and only while they're moving: price-tag slams, pay chips, and windows in flight. Walking at 70 px/s is too slow to blur.

### Motion effects

Each was mocked up in `../../work/motion-ideas/` (`demo.html` plus a clip), built on its own `motion/*` branch and merged here.

| # | Effect | Where |
|---|---|---|
| 1 | Squash & stretch | The agents' waiting hop. Nib's happy hop when a bug is paid or a chain traced (on his dock portrait if a window covers him). Stage 1 Nib when you take the job |
| 2 | Hit-stop & shake | The price tag slams onto the paid row (map, Ops result) or the chain's CRITICAL tag. It holds the impact frame, then shakes with ink specks. CRITICAL gets the full effect with an amber flash |
| 3 | Rolling counters | Cash and rep count to new values, green on gains and red on losses |
| 4 | Pay chips | "+$X" arcs from the tag, or from the paying agent, to the wallet. The money lands with the chip. At most 4 fly at once; the rest queue |
| 5 | Windows from their button | Windows grow out of the button you clicked, rows staggered, and shrink back into it on close |
| 6 | Follow-through | Nib and agents lean a pixel on when they stop. Speech bubbles trail on a spring |
| 7 | Staging dim | The office or Team timeline dims behind decision cards (spend questions, penalty fixes, Nib's choices) |
| 8 | Idle life | Idle characters breathe a pixel, blink and glance, each on its own rhythm |
| 9 | Ghost drain | Spending focus leaves a pale chunk on the meter that drains a moment later |
| 10 | Dust | Pixel dust behind each footstep, and a burst when a character lands from a hop |
| 11 | Talking text | Nib's lines type out with pauses at punctuation; money, CRITICAL, grades and rep pop in amber. Click or Enter finishes a line (`talk.js`) |
| 12 | Lamps | Warm light pools at each station switch off one by one at sleep and back on in the morning |
| 13 | Camera punch-in | The office zooms ~7% toward a critical, a chain or the chapter goal, starting on the tag's impact. The HUD, dock and windows stay put |
| 14 | Tactile buttons | Buttons sink on press and spring back with a 1 px overshoot (`buttons.js`) |
| 15 | Attention nudges | The Team button and badged dock buttons wiggle every few seconds until opened (`buttons.js`) |
| 16 | Floating labels | "+1 bug", grade and rep, "CRITICAL chain" or "−N rep" rise above the agent. The pay chip carries the dollars |
| 17 | Pixel iris | A blocky circle closes onto Nib when leaving Stage 1 or changing chapters, then opens on the office (`iris.js`) |
| 18 | Penalty | A wrong line flashes red, holds 3 frames, shakes and gets a stamped ✗; a red "−8 focus" chip arcs into the focus meter, which flashes red, and Nib winces on his dock portrait. From the 2nd miss on the same bug the window shakes and a red vignette flashes, harder on the 3rd. "Send as-is" on a false find does the same with "−3 rep" into the rep counter. ~700 ms; reduced motion keeps only the colour flashes (`penalty()` in `game.js`) |

### UI polish (2026-11-05)

From [charles.unemployed's "20 ways" reel](https://www.instagram.com/reel/DfXKRDQRBS_/). Where each tip landed (`polish.js` plus small timing changes):

| Tip | Where |
|---|---|
| Ease-out entrances · popovers start at 0.95 · enter from / exit to the trigger · exits 20% shorter | The menu and modal dialogs scale up from 0.95 out of the button that opened them (200 ms) and shrink back toward it (160 ms), Esc included. The office window's shrink is 208 ms against its 260 ms grow. Toasts leave in 270 ms against a 340 ms entrance |
| Dropdowns at 150–250 ms | Dock group menus open in 200 ms (was 280) and close in 160 ms |
| Stagger list rows by 30 ms | Window rows (up to the 7th) and dock menu items |
| Scale to 0.97 on press | Every tactile button, the vitals box and the zoom toggle |
| Ease-in-out for moves | Toasts making room, the vitals box resizing, the dock mark sliding |
| Stretch moving knobs 12% · reuse the same layoutId | One cyan mark under the dock button of the open window. It slides to the next button and stretches 12% mid-move |
| Pulse to confirm success | A ring leaves the goal button when its count goes up |
| Overlap old and new states · crossfade icons with blur | The zoom toggle's label and its plus icon crossfade with a little blur |
| Masks for reveals | Toasts open from the middle out and close the same way |
| No bounce on everyday UI | Agent name tags and the hover lift lose their overshoot. Game moments (hops, stamps, window grows) keep theirs |
| Arcs · stagger details as they settle | Already there: pay chips arc, and vitals sections and window rows settle in turn |
| Don't tween while held · rubber band past bounds | Not used: the game has nothing to drag, and scrolling uses the browser's own overscroll |

Everything respects `prefers-reduced-motion`: final states are instant, and only blinks remain.

The founder doesn't wind up: you control it, so it reacts on the frame you press. Fades, blinks, the lamp flicker and bar fills aren't motion, so the rules don't apply to them.

## Files

| File | Role |
|---|---|
| `server.cjs` | Static files, `/api/nib/*` (Stage 1 chat), `/api/agents/*` (briefs and lines), `/api/auth/*`, `/api/game` and `/api/act` (the server's copy of each game), the leaderboard, quotas, same-origin and host checks. Exports `handler` |
| `auth.cjs` / `auth.js` | Accounts on the server (passwords, Google tokens, sessions) / the sign-in screen and account save sync in the page |
| `account.js` | The Account window: rename, password, Google link, other devices, data export, delete |
| `store.cjs` | Server storage: JSON files in `data/` locally, Upstash Redis when hosted |
| `sync.js` | Sends the page's engine actions to the server and resyncs if the copies disagree |
| `customize.js` | The character editor and its unlocks |
| `api/index.js`, `vercel.json`, `scripts/build-public.cjs`, `.vercelignore` | The Vercel deployment |
| `about.html`, `privacy.html`, `terms.html`, `legal.css` | Public pages, linked from the sign-in screen and the menu |
| `nib-chat.cjs` | Nib's Stage 1 prompt and validator (copied from `cantina-game/nib/nib.cjs`) |
| `meet.html` | Stage 1 |
| `polish.js` | UI polish: dialogs from their trigger, the sliding dock mark, the goal pulse, the zoom label crossfade. See **UI polish** |
| `loop.js` | The one animation loop. World, Nib, the camera lamps, the agent harness and the crew layer each `Loop.add(tick)`. A tick returns true while it needs frames; when none do, the loop sleeps until `Loop.wake()` or input. While awake it runs at the screen's rate (no cap). See **Performance** below |
| `log.js`, `scripts/sessions.cjs` | Session log: everything the player does and says, errors and API calls, sent to `/api/log` / the reader. See **Session log** |
| `lag.js` | Lag log: slow frames, long tasks and call counts, sent to `data/lag.log`. See **Lag log** below |
| `stations/fx.js`, `stations/<id>.js` | Animated office stations. `fx.js` is the hook world.js asks before drawing a station, plus events and the `?fx` picker; each station file holds three variants. See **Animated stations** |
| `talk.js`, `iris.js`, `buttons.js` | Shared motion helpers: typed speech (#11), the chapter iris (#17), button press and nudges (#14, #15) |
| `index.html`, `game.js`, `nib.js`, `style.css`, `original/` | The office (Stage 2 rebuild), with Stage 3 hooks |
| `data.js`, `engine.js` | Rules. `stage`, `won3`, agent finds (`guess(…, by)`), `penalize` |
| `avatars.js` | The whole cast (Nib, Pip, Moss, Rook, Wren and you) as one pixel-avatar set. It's used by Stage 1, the office, the team view, the dock and the endings. Contact sheet: `tests/avatars-sheet.html`, rendered in `evidence/avatars-sheet.png` |
| `customize.js` | Character customization: the editor, unlocks and the unlock toast. Sets your look on `avatars.js` (`Avatars.setLook`) |
| `stage3/scope.js` | Out-of-scope rooms, strikes and bans, crew save, `seed()` for the chapter jump |
| `stage3/harness.js` | Agents: brief parsing, sanitize/preflight, job routines, tools, stop conditions, movement, narration |
| `stage3/crew.js`, `stage3/crew.css` | Agent sprites, the Office/Agents switch, the Codex-style Agents view, AGENTS.md |

**Camera**: by default the view is zoomed in 1.75× and follows you, holding you at the centre until it reaches a wall, where it stops so the room keeps filling the screen (a room smaller than the screen is centred) (`world.setCamera({follow})`, eased over 450 ms). Outside the room, `drawHall` paints the building's hallway: a dim slate floor that pans with the room, a soft shadow at the walls, and a fade to dark. The button at the bottom right (or Z) zooms out to the whole office; the choice is saved as `first-office-view-v1`.

**Vitals box** (top left, or V): bugs today, crits, cash and focus; click for today's and lifetime totals and per-day charts. On screens 900px and wider the room keeps a left margin clear for it (`world.setInsets({left})`); open, it floats over the room only if the margin is too narrow. "Today" is the current game day, measured against the end-of-day snapshot `engine.sleep()` adds to `s.days` (last 60 days).

**Performance**: nothing redraws unless it changed. The world canvas redraws on movement, camera easing, its 8 fps sprite frame or an API call, with a 250 ms safety redraw. Nib's layer redraws on his own changes, and agent sprites write styles only when values change. Idle systems sleep on timers set to their next visible change (a blink, a sprite frame, a tool timer). Any new code that changes what a system shows must go through its API or call `Loop.wake()`. Numbers and method: `PERF_PLAN.md`.

Saves (localStorage on this address): `first-office-nib-v1` (Stage 1 memory), `first-office-game-v1` (office), `first-office-crew-v1` (agents and rules), `first-office-look-v1` (your look and earned unlocks).

## Animated stations (2026-10-30)

Each of the seven office stations moves on its own, reacts when you walk up, open it or get paid there, and reacts when a Stage 3 agent walks to it or works at it. One agent per station built three variants; a reviewer ranked them and sent issues back until all three passed. The top-ranked one ships:

| Station | Variant |
|---|---|
| Desk | A · Bug Squash: screensaver bug, wakes to code and a goal chart, pay squashes the bug and stacks a coin |
| Nib's bench | A · Pattern Book: the book flips through learned patterns, ribbons show precision, pay stamps a star |
| Ops | C · Split-flap board: contract codes flip, greets you by name, pay flips to $!!$ |
| Tools | C · Smithy: furnace and embers, trip-hammer anvil |
| GPU Rig | C · Rack robot: a gantry robot tends the cabinets and zips over to you |
| Ledger Vault | B · Ticker Ledger: adding machine with a reputation odometer and paper tape |
| HQ | C · Chain Lights: bulbs over the door, sparks meet at a chain-link icon |

- **Hook:** `world.js` asks `StationFX.draw` first; a variant draws with `k.base()` (the original art) and its own layers. Events: `open`, `near`, `leave`, `pay`, `float`, `agent-arrive`, `agent-start`, `agent-done`, `night`, `morning`.
- **Compare:** `?fx` shows a picker (A/B/C/off per station); `?fx=hunt:b` sets one. Choices persist in localStorage. Clips of all 21: `work/station-fx/`.
- **Cost:** about 0.06 ms of drawing per frame; the loop stays asleep when nothing is happening.
- **Limits:** agents never walk to Nib's bench or the Vault, so their agent reactions only show if a later change sends them there. The Vault mirrors every payout into its own `deposit` event so it reacts to all money.

## Verify

```sh
node --test outputs/first-office/tests/engine.cjs      # rules
node outputs/first-office/tests/pacing.cjs             # Stage 2 balance
NODE_PATH=<dir with playwright> node outputs/first-office/tests/browser.cjs   # Stage 2 playthrough → chapter 3 button (server running)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/flow.cjs      # Stage 1 → office → chapter 3 agents (model blocked)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/stage3-play.cjs   # plays chapter 3 to Elite at 10× (model blocked)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/customize.cjs # character editor, unlocks, your look in the office and chapter 3
NODE_PATH=<dir with playwright> node outputs/first-office/tests/perf.cjs --json out.json   # CPU, restyles, layouts, painted frames in 5 cases
node outputs/first-office/tests/perf-compare.cjs median.json run1.json run2.json --base perf/60fps/baseline.json   # median and % vs baseline
NODE_PATH=<dir with playwright> node outputs/first-office/tests/session-log.cjs   # session log: clicks, dialogue, AI calls, actions, errors, no passwords (server running)
node --test outputs/first-office/tests/ai-limit.cjs   # 30 AI messages / 90 calls an hour per player
node outputs/first-office/tests/abuse-eval.cjs        # live: 100 abuse prompts + 10 controls (about 330 calls, ~$0.02)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/memory.cjs    # heap, nodes and listeners over a long chapter 3 session
```

`stage3-play` reached Elite on day 9–10 in six of six runs after Parcelly was added (earlier: day 8–10 in four runs): 30–60 s at 10×, about 5–10 minutes at normal speed. Each run had 2–5 penalties before the rules went on.

Verified 2026-10-25: all five pass. Gemma was also checked live in Stage 3: it parsed briefs, sanitize and auto-pick worked, and spend approval asked first. Live Gemma replies sometimes get numbers slightly wrong in chat. Game numbers come from code, never from the model.

## Office touches (2026-10-31)

- **Shoving and personal space:** everyone keeps an ellipse of personal space (13 px across, 15 px deep), so nobody sinks into anybody. Walk into Nib or an agent, or let one walk into you, and they're pushed out of your way, never onto someone else, and sideways if a wall is behind them. Other characters that overlap each other ease apart half a pixel a step (`shoveBodies` in `original/world.js`, fed by `world.setBodies` in `game.js`). An agent leans with the shove for 240 ms, and a walking one carries on from where it lands. Only someone pinned against a wall stops you.
- **One depth for everyone:** whoever stands lower in the room is drawn in front. In chapter 3 the agents' layer also draws you and Nib (`body()` in `stage3/crew.js`, using `world.playerPose()` and `nib.pose()`, while `setPlayerHidden` and `setBodyHidden` keep the canvases from drawing them twice), with `z-index` set from each one's y. In chapter 2, Nib's canvas redraws you over Nib when you overlap and stand lower.
- **Names on hover:** agent and Nib name tags, and your "You" tag, show only while hovered or focused. The tag fades in and rises 4 px with a slight overshoot, and the sprite lifts a pixel and brightens. Under reduced motion it's a plain fade.
- **Vitals, three views:** mini (just the header), small (four rows) and big (today, lifetime, charts). Clicking the header folds the box to mini and back to whichever of small or big it was last; clicking the body switches small ↔ big. V and Esc still toggle small ↔ big, and the view is remembered.
- **Window descriptions:** each window opens with one line saying what it shows and what you do there (`lede()` in `game.js`).

## Review, 2026-10-31 (3 code reviewers, 3 playtesters)

Fixed:
- **Server:** dot paths (`.git`, `.gitignore`) are no longer served. Nib's Stage 1 chat counts against the model quota. Null or odd bodies get 400. Lag rows can't overwrite `at` or `page`. The leaderboard file falls back to `{}` if it holds anything else. Quiet IPs are pruned from the rate limiter.
- **Tabs:** an older tab no longer saves at takeover (that write rolled the newer tab back), never persists the crew once frozen, and closes open dialogs so Play here is clickable. Taking over works both ways.
- **Agents:** GPU slots are re-checked after an answer or ⌘↵. A brief being read counts as a task, so a second message can't drop it. A declined standing purchase ends. Standing orders that can't run today, or have no program left, wait until tomorrow instead of stalling, and "wherever there's work" re-picks its program each morning. A duplicate standing order or queued brief is ignored. A stalled queue restarts. Chain criticals count in agent pay and the standup. One fix button per rule. The 3 s save only runs when the crew changed. Nib gets at least 4 tries a night in chapter 3.
- **UI:** the chapter 3 Goal board shows the Elite goal. The leaderboard fits its window. The Rig shows agents at once. Unmapped off-limits rooms are tagged. On phones the vitals box sits below the HUD. The subtitle has contrast. The vitals count-up never goes below its start, and negative money reads "−$". Stage 1 no longer takes "I'm" as a name. Nib's "that's the one we needed" line is chapter 2 only.

Known, not fixed: two tasks in one brief (only the first runs); agent tags can overlap the dock; HUD cash trails the vitals box by about 1.5 s while a pay chip flies; a reload mid-night skips that morning's report; a double-click on a desk upgrade buys and returns it.

## Account management (2026-11-04)

Signed in, open **Menu → Account** (`account.js`, served by `/api/account*` in `server.cjs` → `auth.cjs`):
- **Username:** rename. The old name is freed and the leaderboard row follows.
- **Password:** change it, which needs the current one, or add one to a Google-only account. A change signs out every other device.
- **Google:** link it, which also works for recovery since there's no email reset, or unlink it. Unlinking needs a password on the account. A Google account links to only one First Office account.
- **Devices:** sign out everywhere except here. Sessions carry a version, so the cookie is `<id>.<version>.<expiry>.<hmac>`, and bumping the account's version ends the others. Old three-part cookies still count as version 0.
- **Your data:** `GET /api/account/export` downloads the account details, cloud save and game as JSON, never the password hash.
- **Delete:** type the username, and the password if there is one. This removes the account, the username and the Google link, the cloud save, the game and the leaderboard row, and this browser forgets them.
- **Tests:** `tests/account.cjs` covers each of these end to end, on its own port with temp data and a stand-in for Google.

## The official game: the server keeps the real save (2026-11-03)

When you're signed in, nobody can edit their score: the server owns the game.
- **How:** the page plays every action at once, so nothing waits on the network. Every 4 s `sync.js` sends the actions it played, by name: `engine.js` calls `E.record` for each mutating call on the live save, tagged with the agent context. The server replays them on its own copy with the same engine (`/api/act` → `E.act`). It answers with `E.digest` of its result. If that doesn't match the page's, or the server's copy moved on (another device), the page loads the server's copy and reloads.
- **Everything that changes the save is an engine action** (`E.ACTIONS`): hunting, teaching, Finds, the shop, the rig, sleeping, chains, plus the chapter 3 rules that used to live in the page. Scope, strikes and bans (`E.OUT_OF_SCOPE`, `E.banned`), agents' focus (`s.energy`, `E.asAgent`), hiring (`E.hire`), coffee runs (`E.coffeeRun`), the Elite win (`checkWin3`), starting chapter 3 (`E.startStage3`) and names or tutorial flags (`E.meta`, cosmetic). `stage3/scope.js` keeps only the crew save and the penalty log.
- **Server:** `GET /api/game` returns `{version, state}`. `POST /api/game/new` makes a run: `fresh` (the server picks the seed), `seed3` (chapter 3, ready-made), or `clear` (back to Stage 1). `POST /api/act` takes `{version, actions}` and returns `{version, digest}`, or `{conflict, version, state}`. Each request loads a fresh copy of the engine, because chapter 3 releases add slots to shared game data. Calendar releases run on the server's clock.
- **Leaderboard:** rows are written by the server from its own copy after each batch. `POST /api/leaderboard` returns 410.
- **Inputs:** `E.act` refuses anything but plain values, known agents and real programs, and prototype names. `tests/act-fuzz.cjs` sends 20,000 hostile actions and gets no throw and no corrupt numbers.
- **Tests:** `tests/official.cjs` covers a game the server makes; chapter 2 by hand and chapter 3 with agents at 10×, staying in step with no resync; an edited localStorage save replaced on load; an in-memory edit caught and reloaded; the board unaffected; posted scores refused (410); and a second device.
- **Limits:** this stops editing scores, not botting. A script could still play the actions well, and the answers are in `data.js`. Guests still play locally, off the board. Log lines the page writes outside actions are cosmetic and aren't replayed. Each sync round is 2 to 4 storage commands, so mind the Upstash free tier with many players.

## Deploy (Vercel)

### Public information and Google OAuth (2026-11-04)

- Public pages: `/about.html` describes the game without a login; `/privacy.html` and `/terms.html` document accounts, saves, public scores, AI processing, and contact/deletion requests. They share `legal.css`, load no game or authentication scripts, and are linked from both account screens and the game menu. The existing static build includes them automatically.
- Operator/support contact: `samarthk@cantina.security`. Keep these pages accurate when data practices or service providers change. There is no self-service account deletion; requests go to the operator.
- Google Cloud project: **First Office** (`first-office-513721`, under `spearbit.com`), External audience. OAuth web client: **First Office web**. Client ID: `950529825927-b096l52jskbbhqfklnkij1cgqk2ajlum.apps.googleusercontent.com`.
- JavaScript origins: `https://first-office-seven.vercel.app` and `http://localhost:55188`. Redirect URIs empty. No additional scopes added. No client secret is needed by the game. Billing was not enabled.
- Verified in Google Console: **External · In production**. No non-sensitive, sensitive, or restricted scopes were manually added. Branding uses `https://first-office-seven.vercel.app/about.html`, `/privacy.html`, and `/terms.html`, with `first-office-seven.vercel.app` authorized.
- The public pages and account/menu links were deployed and promoted on November 4, 2026: `first-office-acvarz9uy-samarthk-6445s-projects.vercel.app` (`dpl_5mreFfDVi665B8ziDCKsm5nyFJj8`). The public alias remains `https://first-office-seven.vercel.app`. Static build, JavaScript syntax, deployed file comparisons, and Chrome visual checks passed.
- `GOOGLE_CLIENT_ID` remains an independent deployment setting; creating this client does not by itself enable Google sign-in in the game. No client secret was copied or stored for this setup.

### Hosting

- **Target:** the existing project `first-office` (https://first-office-seven.vercel.app) in `samarthk-6445s-projects`, the scope of the Cantina login samarthk@cantina.security. This replaces the older office-27 web release, which was deployed from `outputs/cantina-game`.
- **How it runs:** `vercel.json` builds `public/` with `scripts/build-public.cjs`, which copies only browser files (HTML, JS, CSS, assets, `original/`, `stage3/`, `stations/`). Every `/api/*` request goes to `api/index.js`, which exports `server.cjs`'s `handler`. `.vercelignore` keeps `.env`, `data/`, tests, evidence and docs out of the upload.
- **Storage:** Upstash Redis through the Vercel Marketplace (`store.cjs` uses `KV_REST_API_URL` and `KV_REST_API_TOKEN`). Vercel's disk doesn't keep files between requests, so the store is required.
- **Env vars (production):** `DEEPINFRA_API_KEY` and `SESSION_SECRET` are set. `KV_REST_*` comes from the Upstash integration. `GOOGLE_CLIENT_ID` is optional.
- **Deploy:** run `vercel deploy --prod --yes --scope samarthk-6445s-projects` from `outputs/first-office`, which is linked through `.vercel/`, gitignored.
- **Live since 2026-11-02:** a preview, then production, were both checked end to end. Sign-up, a taken username, a wrong password, sign-in on a second browser with the save and look synced, and the leaderboard under the username all passed against Upstash. `server.cjs`, `.env`, `data/` and `.git/` return 404. POSTs accept an `https://` Origin, which the first deploy was missing. To call protected previews, use `vercel curl`, and pass bodies with `--data-raw`, because `-d` is the CLI's own debug flag.

## Session log (2026-11-04)

Every tab records what the player does, so you can replay a session and debug what went wrong (`log.js`, loaded first on both pages).

- **What's logged:** every click (element, its text, position), game shortcut keys and Enter/Esc in fields, changed toggles and selects, windows opened and closed, every engine action on the live save (with the agent who did it, and the engine's reason if it refused), what the player said to Nib and each agent, every line Nib and the agents said, how each brief was read into a task, each AI request and answer (`/api/nib/chat`, `/api/agents/*`), every `/api` call's status and time (sync conflicts flagged), JS errors with stacks, rejected promises, console errors and warnings, page loads, hides and leaves. Each batch carries the game's state (chapter, day, cash, rep, bugs, open window).
- **Never logged:** password fields, keys typed into text fields (only what was sent), auth and save request bodies.
- **Sessions:** one id per tab (`sessionStorage`, so it survives chapter reloads), plus a browser id (`localStorage`) that links a guest's sessions. The server adds the username when signed in.
- **Transport:** batched every 10 s, at 100 events, and on hide, via `sendBeacon` to `POST /api/log` (64 KB per batch, 150 events, 6 KB per event). Stored with `store.log`: locally `data/session_<id>.log` plus a `data/sessions.log` index; hosted, Redis lists capped at 20,000 events per session and deleted 30 days after the last write (the index too). Each batch costs 2–3 Upstash commands.
- **Read:** `node scripts/sessions.cjs` lists the latest sessions (`--all`, `--user NAME`); `node scripts/sessions.cjs <id>` prints one as a timeline (`--json` for raw). For the hosted game: `vercel env pull .env.vercel --environment production && node --env-file=.env.vercel scripts/sessions.cjs`.
- **Who can read it:** only holders of the storage credentials (the Vercel/Upstash team, or the local `data/` folder). The log is write-only from the game: `/api/log` accepts POSTs and answers `{ok: true}`, no endpoint returns logs, `data/` and `.cjs` files are never served, and the Vercel upload excludes `data/`. `tests/session-log.cjs` checks this. Don't add a read endpoint or dashboard without admin-only sign-in.
- **Add events:** `SessionLog.event(type, data)` from any page code.

## Lag log and one tab at a time (2026-10-31)

- **Lag log (`lag.js`):** the shared loop (`loop.js`) times every frame, and each tick by function name (`agentsFrame` = agents, `nibFrame` = Nib, `drawLayer` = agent sprites, `camTick`, the world, and so on). It also measures the gap between frames while the loop runs on: a gap over 50 ms is a hitch, whatever caused it. fps counts only the time the loop is awake. In Chrome, long animation frames name the scripts that ran. Long tasks (50 ms+) are caught with `PerformanceObserver`, and `render`, `drawWindow`, `save` and `agents.changed` count their calls. Every 5 s, a window with a hitch, a slow tick frame or a long task prints `[lag] …` in the console and is appended to `data/lag.log` through `POST /api/lag`. Each line has fps, the slowest frame and its per-tick split, the top ticks, call counts, DOM size, heap, chapter, day, the number of agents busy, and the open window. `Lag.report()` prints the last 50 windows; `Lag.now()` shows the current one.
- **Saves only on change:** `save()` skips identical writes (`seenAt` refreshes at most once a minute), and a save received from another tab isn't written back. Before this, two copies of the game answered each other's writes about 30 times a second; your lag log showed about 150 renders and saves per 5 s. That made cash and focus flicker between the two copies and caused the lag.
- **One tab:** two tabs used to run two copies of the agents, each overwriting the other's save. The bounty board's job, cash and focus flipped between the two, and every system ran twice. Now the newest tab wins (`BroadcastChannel('first-office')`). An older tab saves, stops, and shows "The game is open in another tab · Play here".

## Real time and the leaderboard (2026-10-30)

- **Away nights:** every save records the real time it was written (`s.seenAt`). If you open the game 8 or more real hours later, that night runs by itself once you've unlocked Sleep: "You were away 9h. Night 6 ran without you." Nib and the agents' standing orders work through it, and the morning report is waiting (`AWAY_NIGHT` in `game.js`). Game days still pass only when you sleep, so you can play for as long as you like.
- **Calendar releases (chapter 3):** for each real calendar day since your last visit (up to 3), a program ships an update with new findings, on top of the nightly one (`s.realDay`, plus `E.shipRelease`).
- **Leaderboard:** the menu or L opens it. There is one row per browser, keyed by a random id in `first-office-player-id`, showing name, rep, bugs, crits, earned, days and chapter. Click a column header to sort by it. The game posts a score on load, every morning, and when a job is won. `server.cjs` serves `GET /api/leaderboard`, which returns the top 100, and `POST /api/leaderboard`, which checks shape and size, allows 30 posts a minute per IP, and keeps 500 rows. Rows are stored in `data/leaderboard.json`, which is gitignored and not served. Scores are trusted from the browser, so this is a leaderboard for friends, not one that resists cheating. The server only answers on localhost, so other players need it hosted first: allow their host in the `Host` check and listen on `0.0.0.0`.

## Chapter 3 loop: releases, standup, overtime (2026-10-30)

- **Releases:** each night in chapter 3, one program you can take ships an update with 1–2 new findings, in rooms that are in scope and have fewer than 5 slots. Nib announces it in the morning. New slots are stored in `s.releases` and added back on load before `restore` filters ids (`shipRelease` and `addSlot` in `engine.js`). This keeps Elite reachable after the starting findings run out.
- **Standup:** on the first step of each new day, Nib's chat gets a card with one row per agent that did anything the day before: bugs, pay, penalties, wasted trips, and a one-tap AGENTS.md fix for the rule that would have helped. A name links to that agent so you can brief or queue its day (`standup()` and `a.today` in `stage3/harness.js`).
- **Overtime:** an agent that runs out of focus asks "Coffee run for $150? +40 focus", or rests until tomorrow. Each run on the same day costs $150 more, with at most 2 per agent per day. An unanswered offer lapses at the next morning.

## Team view: shortcuts, queue, standing orders (2026-10-30)

- **Keys:** ↑/↓ switch between agents (AGENTS.md is last), or Alt+↑/↓ while you're typing. Alt+1–9 jumps to an agent, / focuses the message bar, and Esc clears the bar, then goes back to the office. The keys are listed under the roster.
- **Queue:** a brief sent while an agent has a task waits in its queue, shown as Next/Then rows above the message bar, each with a ✕. When the task ends, the next one starts. ⌘↵ (or "now: …") drops the current task and starts the new one. Questions and "stop" always go through straight away, and a stopped task moves on to the queue.
- **Standing orders:** "every day", "daily", "from now on", "until I say stop" and similar make a task long-running (`FOREVER` in `stage3/harness.js`). When it runs out of work or reaches its stop condition, the agent rests ("Standing order · back tomorrow") and starts again the next morning with a fresh count, so "validate the tray every day" clears Nib's finds each morning. A brief sent during that rest runs first, then the order goes back to the end of the queue.

## Chapter 2 kept small (2026-10-30)

The first job has 8 things to do, and each one happens in one place. The **Goal** board (the goal button, or G) lists them:

| What | Where |
|---|---|
| Take a job | Desk |
| Open a room, click the buggy line | Desk |
| Tell Nib why it's a bug | Nib asks right after |
| Sleep: Nib hunts overnight | Sleep, top right |
| Prove or send Nib's finds | Finds (was Ops) |
| Coffee for focus | top right |
| Buy tools, like the Tracer | Shop (was Tools) |
| Chain two bugs into a critical | Goal board (was HQ) |

- **Hidden until chapter 3:** Nib's pattern book, the GPU rig, the ledger, and the desk upgrades. In chapter 2 Nib gets a fixed 4 tries a night (`CH2_TRIES` in `engine.js`). The dock is flat (Desk, Finds, Shop), and the cash button opens the Shop.
- **Fewer choices:** Finds has Prove and Send as-is (Toss is gone). The Tracer ($600, was $900) no longer needs the Debugger, and the Goal board has its Buy button right on the chain.
- **Chaining spelled out:** a chain room's note names its pair ("the information leak here + the missing access check in Messages = a critical"). At bug 3 Nib names the two rooms and the Tracer's price, and waits for "Got it". Once both bugs are filed, the objective says to buy the Tracer, and the goal button lights up. The board says what each chain still needs, with prices. The right chain answer no longer names a specific leak, so it fits whichever code version you found.
- `pacing.cjs` gives a median of day 3 (2–5), with Nib making about a third of the bugs.

## No report writing (2026-10-26)

You no longer write reports. A bug you find is filed and paid the moment you tell Nib why it's a bug:
- **Sharp explanation, or a class Nib has mastered:** S grade.
- **Shallow explanation:** B.
- **Nib's finds you prove:** A, plus the 25% proof bonus.
- **Nib's finds submitted as-is:** B, or C if Nib's precision is under 70%.

A leftover draft, for example one an agent gave up on, is one **File** click on the Ops desk. Agents still write their reports section by section, so AGENTS.md's honesty rule and overclaim penalties still apply to them. Balance is unchanged: `pacing.cjs` gives a median of day 6, and 40 of 40 runs win.

## Windows and popups (2026-10-25)

- **Centered windows:** whatever you interact with opens in the middle of the screen, compact, over a soft scrim. The title is one breadcrumb line of what you're on, e.g. `Desk › ChatterBox › Login › Hunt`.
- **Nib docks to the window:** while a window is open, Nib speaks from one strip docked on top of it, with choices and Next inline, instead of a bubble over your work. Opening a window puts keyboard focus on Nib's waiting line or the window, never the × button.
- **Redraws patch in place:** a window or dock redraw keeps every node still there and only patches what changed (`morph` in `game.js`), so the button under a resting cursor keeps its hover instead of blinking when agents or Nib change the save.
- **Dock groups (chapter 3; chapter 2's dock is flat):** Desk stands alone; Ops + HQ are **Jobs**, Tools + Rig are **Gear**, Nib + Ledger are **Books** (`GROUPS` in `game.js`). Hovering, focusing or tapping a group pops its menu up with each station's key; a group with only one station unlocked shows that station as a plain button. A group's badge adds up its stations' badges, and it shows the open station's name while that window is up. Station keys (H, O, C, B, R, T, I) still open windows directly.
- **Toasts:** they sit just above the dock and slide as the stack changes. On phones with a window open, they sit at the top instead, clear of the window's buttons.
- **Less text:**
  - Intro paragraphs, legends and fine print are cut down to a few words.
  - Bounty board programs are one row each.
  - Report sections are one row of three choices, with no duplicate paper preview.
  - The Menu drops Import Stage 1.

Screenshots: `evidence/popup-map.png`.

## Avatars (2026-10-25)

Redesigned after Grok Bot's avatar system:
- **Bots:** every bot shares one rounded body with a dark visor and two big eyes. Each one differs by colour and one accessory:
  - Nib: antenna whose bulb lights when thinking
  - Pip: sprout
  - Moss: headphones
  - Rook: castle top
  - Wren: feather tuft
- **You:** the human version, a head on a cream jacket with the founder's red scarf, and a back view when walking up.
- **Moods:** the eyes carry them (idle, blink, talk, think, happy, sad, ask, sleep).
- **Size:** all avatars are 16×21 pixels, one pixel per office pixel.
- **Changes to the published renderer:** `original/world.js` draws the founder with `avatars.js` when it's loaded (otherwise the original sprite), and asks `stations/fx.js` to draw each station (otherwise the original art).

## Review, 2026-10-25

Seven review agents tested each part of the game: Stage 1, the early and late Stage 2 game, the Team view, agent logic, the server and live AI, and the code. Everything they found has been fixed:

- **Server:** malformed URLs no longer crash it. The file blocklist is case-insensitive. Bad input gets 400 or 413.
- **Saves:** Stage 1's "Start over" clears the office too. Wiping a save can't be undone by a late write. Chapters 2 and 3 and Restart keep your names. Chapter 3 from a finished job keeps your real save.
- **Scope:** Nib's night shift, the tray, reports and chains all respect scope and bans.
- **Agents:**
  - No more infinite rewrite loop.
  - Agents don't take your own drafts.
  - Agent finds are labelled with the agent's name and paid like yours.
  - GPU slots hold after a reload or a new day, and a question waiting on you doesn't hold a slot.
  - Over-budget buys are refused up front.
  - The parser handles more phrasings.
- **UI:**
  - Clicks are never lost to a redraw.
  - Lines that need your answer close the Team view, so Nib can't freeze.
  - Walking doesn't stick after you open Team.
  - Nib is clickable.
  - "Stopped" and "Done" read correctly, and the header shows "Out of focus".
- **Content:** Parcelly was added after one test run ran out of findings at 57 rep.

## Known limits

- Hunting goes in a fixed order, so two agents on one program collide unless the claim rule is on (by design).
- Custom rules typed in your own words only work when they match one of the six known rules.
- Agents don't advance the day. Tray candidates still come from Nib's night shift.
- Stage 1 and the office are two pages on one server. The handoff is a fade to black.
- About 16 in-scope findings remain after a typical first job, so reaching Elite needs good reports and the chains (Tracer).

## Accounts (2026-11-01)

- **Sign-in is on by default.** Before either page starts, a card offers **Sign in** / **Create account** (username + password), **Sign in with Google** (only when the server has `GOOGLE_CLIENT_ID`), and **Play without an account** (local only, no leaderboard). A new Google account picks a username before playing. If the server can't be reached, the game runs locally with no gate.
- **Rules:** usernames are 3–16 of `a-z A-Z 0-9 _`, unique ignoring case, with a reserved list (admin, nib, pip, moss, …). Passwords need 8+ characters and are hashed with scrypt and a per-user salt. Sign-in and sign-up allow 10 tries a minute per IP; that limit lives in memory, so on Vercel each instance counts on its own (best effort).
- **Session:** an HttpOnly cookie holding the account id, signed with `SESSION_SECRET` (or a secret the server keeps in the store). The leaderboard row and the cloud save are keyed by the account id, and the board shows the username. `window.Auth.user` is `{ id, name, email, picture }` once signed in.
- **Storage (`auth.cjs`, through `store.cjs`):** `account:<id>`, `uname:<lowercase name>`, `google:<sub>`, `save:<hash>`, `secret`. Files in `data/` locally, Upstash Redis when hosted. Accounts from the earlier Google-only build (`data/users.json`, `data/saves/`) aren't carried over.
- **Routes:** `GET /api/auth/config|me`, `POST /api/auth/signup|login|username|google|logout`, `GET|POST /api/save`.
- **Deploy:** set `SESSION_SECRET` (32+ random characters) and the Redis vars (`KV_REST_API_URL` / `KV_REST_API_TOKEN`). `GOOGLE_CLIENT_ID` is optional.
- **Tests:** `node --test tests/auth.cjs` (hashing, username rules, bad logins, rate limit, sessions, Google tokens, saves) and `tests/login.cjs` (end to end on its own port and temp data). The older browser tests set `first-office-guest` so the gate stays closed.

## Character customization (2026-11-01)

Flow: sign in (or play as a guest) → pick your look → play. The first visit to either page opens the editor full-screen (`Customize.ensure()` in `meet.html` and `game.js` boot, after `Auth.ready`); **Menu → Customize character** reopens it (Esc cancels).

- **Options:** skin, hair (fringe, short, long, spiky, bun, bald), hair colour, shirt, pants, and one extra (none, scarf, glasses, hoodie, plus the locked ones). Live walking preview, plus happy, back and side poses. Randomize picks only unlocked items.
- **Unlocks** (read from `first-office-game-v1`; once earned they stay, even after a restart):

| Item | Needs |
|---|---|
| Cap | Find a critical (`crits ≥ 1`) |
| Headphones | Find 10 bugs |
| Sunglasses | Finish the first job (`won`) |
| Gold hoodie | Reach Elite (`rep ≥ 60`) |
| Neon hair | Finish chapter 3 (`won3`) |

  Locked items are greyed with a lock and their requirement, and can't be picked. In the office a toast says "New look unlocked: Cap" (checked every 3 s).
- **Drawing:** `Avatars.setLook(look)` sets the founder's look for every draw site (office canvas, `nib.js`, the chapter 3 layer); `o.outfit` overrides it for previews. Same 16×21 sprite, step frames, back view and flip. The body now has pants (rows 17–18); the old red scarf is the default extra. `crew.js` adds `Avatars.lookId` to its redraw key so a new look shows at once.
- **Save:** `first-office-look-v1` = `{look, earned}`. Tests that skip the editor pre-set it to `{"look":{}}` (the default look).

## AI limits and abuse tests (2026-11-04)

- **Per-player limit** (`spend` in `server.cjs`): 30 typed AI messages an hour (Nib chat, agent briefs, agent chat) and 90 model calls an hour including narration, per account (signed out: per IP). Kept in the store (Redis when hosted, with a 1 h TTL), so it holds across Vercel instances. An agent chat sent right after a brief with the same words counts once. Over the limit: 429 "You've used this hour's 30 AI messages. Try again in N min."; the page falls back to its scripted lines. The older in-memory quota (40/min, 800/day) still applies per server instance.
- **Scope:** Nib's and the agents' prompts allow only game talk; anything else (homework, code, real facts, real hacking, other personas, long text) gets a one-line in-character decline. Output caps (120–220 tokens, 22–45 words) and the existing validators still apply.
- **Abuse set:** `tests/abuse/prompts.jsonl`, 100 prompts in 10 categories (off-topic, real hacking, injection, prompt extraction, persona break, harmful, token abuse, disguised off-topic, game exploits, obfuscated), written by Codex (gpt-6.1-sol). Plus 10 normal-play controls in `controls.jsonl`. `node tests/abuse-eval.cjs` runs them live against Nib's chat and an agent (brief, then chat) and writes `results.jsonl`; `grades.jsonl` holds the graded run.
- **Result:** abuse 100/100 on Nib and 100/100 on agents. 8 Nib abuse replies were rejected by the validator, so the scripted line showed instead. Controls were 8/10 for Nib and 7/10 for agents. The misses are "I don't have that info" answers, because the eval gives the model empty game facts. Briefs turned 2 "free rig" prompts into `buy rig, budget 0`; the engine still charges or refuses, so nothing is free.
- **Cost:** about 460 input + 40 output tokens per call, at DeepInfra's $0.07/M in and $0.34/M out, comes to about $0.00005 per call. A player at the 90-call cap costs at most about $0.0045 an hour.
