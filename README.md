# First Office · Stages 1–3

Stages 1–3 of the [roadmap](../../work/ROADMAP.md) as one game: one server, one address, one save.

1. **Meet Nib** (`meet.html`). The dark room, the lamp, Nib. Accepting the job fades into the office.
2. **First job together** (`/`). 20 bugs and 1 critical in the office. Nib already knows your name from Stage 1.
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

Everything respects `prefers-reduced-motion`: final states are instant, and only blinks remain.

The founder doesn't wind up: you control it, so it reacts on the frame you press. Fades, blinks, the lamp flicker and bar fills aren't motion, so the rules don't apply to them.

## Files

| File | Role |
|---|---|
| `server.cjs` | Static files, `/api/nib/*` (Stage 1 chat), `/api/agents/*` (briefs and lines), quotas, same-origin and localhost checks |
| `nib-chat.cjs` | Nib's Stage 1 prompt and validator (copied from `cantina-game/nib/nib.cjs`) |
| `meet.html` | Stage 1 |
| `talk.js`, `iris.js`, `buttons.js` | Shared motion helpers: typed speech (#11), the chapter iris (#17), button press and nudges (#14, #15) |
| `index.html`, `game.js`, `nib.js`, `style.css`, `original/` | The office (Stage 2 rebuild), with Stage 3 hooks |
| `data.js`, `engine.js` | Rules. `stage`, `won3`, agent finds (`guess(…, by)`), `penalize` |
| `avatars.js` | The whole cast (Nib, Pip, Moss, Rook, Wren and you) as one pixel-avatar set. It's used by Stage 1, the office, the team view, the dock and the endings. Contact sheet: `tests/avatars-sheet.html`, rendered in `evidence/avatars-sheet.png` |
| `stage3/scope.js` | Out-of-scope rooms, strikes and bans, crew save, `seed()` for the chapter jump |
| `stage3/harness.js` | Agents: brief parsing, sanitize/preflight, job routines, tools, stop conditions, movement, narration |
| `stage3/crew.js`, `stage3/crew.css` | Agent sprites, the Office/Agents switch, the Codex-style Agents view, AGENTS.md |

**Vitals box** (top left, or V): bugs today, crits, cash and focus; click for today's and lifetime totals and per-day charts. "Today" is the current game day, measured against the end-of-day snapshot `engine.sleep()` adds to `s.days` (last 60 days).

Saves (localStorage on this address): `first-office-nib-v1` (Stage 1 memory), `first-office-game-v1` (office), `first-office-crew-v1` (agents and rules).

## Verify

```sh
node --test outputs/first-office/tests/engine.cjs      # rules
node outputs/first-office/tests/pacing.cjs             # Stage 2 balance
NODE_PATH=<dir with playwright> node outputs/first-office/tests/browser.cjs   # Stage 2 playthrough → chapter 3 button (server running)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/flow.cjs      # Stage 1 → office → chapter 3 agents (model blocked)
NODE_PATH=<dir with playwright> node outputs/first-office/tests/stage3-play.cjs   # plays chapter 3 to Elite at 10× (model blocked)
```

`stage3-play` reached Elite on day 9–10 in six of six runs after Parcelly was added (earlier: day 8–10 in four runs): 30–60 s at 10×, about 5–10 minutes at normal speed. Each run had 2–5 penalties before the rules went on.

Verified 2026-10-25: all five pass. Gemma was also checked live in Stage 3: it parsed briefs, sanitize and auto-pick worked, and spend approval asked first. Live Gemma replies sometimes get numbers slightly wrong in chat. Game numbers come from code, never from the model.

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
- **One change to the published renderer:** `original/world.js` has a single hook that draws the founder with `avatars.js` when it's loaded. Otherwise it falls back to the original sprite.

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
