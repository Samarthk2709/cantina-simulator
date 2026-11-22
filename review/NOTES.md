# Reviewer notes (persistent across rounds)

Harness: `node review/review3d.cjs --round N [--loop 180] [--no-low] [--no-shots] [--no-leak]`
Output: review/out/<N>/report.{json,md}, shots/*.png (+ _loading-1s.png, _low-gameplay.png), stations/<id>/{mid,f0..f3,exit}.png
Glitch tooling (SPEC 1b, added 2026-11-21): review/clip.cjs, wired into review3d.cjs (default on; --no-clip, --only-clip, --dense ids|all|none, --clip-loop MS).
- Samples ~5k robot skinned vertices (via SkinnedMesh.getVertexPosition, part = dominant bone) every ~100 ms during a walk past furniture + every station (enter/loop/exit phases) and tests them against Office3D.colliders() boxes (tol 1.5 cm, 3 cm for `contact` surfaces) and the floor y=0. Checks the camera against colliders and against the robot (<12 cm). Also reports a pose-pop metric (max local motion in the robot frame between samples; >~3 m/s is suspect), foot slide during the loop and lowest point per phase.
- Without the colliders() hook it falls back to scene-mesh bounding boxes: ADVISORY only, gate = MISSING HOOK. Office3D.robot is currently a function returning {mesh,bones}; SPEC wants an Object3D, so the hook is flagged.
- Dense frames: stations/<id>/dense/*.jpg + dense-sheet.jpg (enter -> loop -> exit, ~every 200 ms incl. screenshot latency).
- Contact sheets of shots and stations: review/contact.sh <round>.
Visual glitch checklist per round, for every shot and frame sequence: interpenetration (sofa, chair, desk, safe, rack, walls, props) | floating feet or props | foot sliding | pose pops/snaps, T/A-pose flash | camera inside geometry or robot | z-fighting/flicker | black/missing textures or screens | objects poking through walls.

Method notes:
- Default path = plain `/` with navigator.webdriver forced false, 1920x1080, DPR 1, no `?q=`.
- Draw calls / triangles = per GAME frame summed over every renderer.render() (shadow maps, prepass, GTAO, reflection, main, post), via info.autoReset=false over ~0.7 s. Table also shows the biggest single render() pass. three.js stats() that resets per render() would under-report, so harness number is authoritative.
- GPU MB: prefer stats().gpuMB; harness estimate = unique scene textures w*h*bpp*1.33(mips) + geometry buffers + ~6 half-float full-res composer RTs.
- Console: counts errors + WebGL/shader warnings; the game's own `[lag]` warnings are logged separately, not counted.
- Contention: `ps` count of other automated Chrome before/after; also check loadavg.

## Round 0 (2026-11-21, baseline) — REJECT
Builder was mid-edit during the run (smoke run 10 min earlier had a 6144x1350 texture, round 0 had max 2048; stats() hook appeared during the low-tier phase). 1 other automated Chrome appeared by the end -> perf slightly suspect.
Budgets: p5 29.9 PASS | avg 51.3 PASS (marginal) | worst frame 200 ms FAIL | heap 53 MB PASS | leak -1.1 MB/180s PASS | GPU est 615 MB FAIL (stats().gpuMB=513 in low tier) | draw calls 6578/frame (biggest pass ~1700) FAIL | tris 2.85 M FAIL | transfer 34 MB PASS | first frame 3.5 s PASS | max tex 2048 PASS | shadow lights 4 PASS (dir 2048 + 3 spot 1024) | console 0 PASS | low tier 43 fps PASS | hooks ready/stations/interact/leave/stats MISSING (stats appeared late).
Scene: 34 lights, 285 textures (505 MB est), 988 geometries, ~1000 separate meshes.
Rubric: Lighting 6 | Materials 6 | Set dressing 7 | Character 2 | Interaction anims 1 | Cleanliness 4 | Cohesion 5.
Key visual findings:
- Player is a realistic human in denim jacket (founder3.glb) — SPEC wants an original stylised robot. Hard fail on 4.
- No station interaction at all; desk-* shots hide the player.
- GradeShader (office3d.js ~l.438-453) adds animated film grain (grain 0.03) and chromatic aberration (RGB offset) — both explicitly banned. Grain visible on rug at 2x crop.
- Large parts of room crushed near-black (wide-west, portrait background); ceiling reads as flat dark mass.
- Skyline through windows = flat low-detail blocks; "Paint Haven" branded spray cans (desk-forge) — Poly Haven pun, minor.
- Positives: dense credible clutter, glossy floor reflections, window-blind light patterns, neon sign, desk-hunt close-up is the best shot.

## Round 1 (2026-11-21, builder commit cbd571c) — REJECT (visual), all budgets PASS; counts as IMPROVEMENT (SPEC 5)
Contention: no automated Chrome; but the user's desktop Chrome helpers used ~110-120% CPU during the run -> perf numbers slightly pessimistic.
Budgets: p5 29.9 PASS (0 frames >40 ms, so margin is real; 60/30 vsync quantised) | avg 52.4 PASS (thin) | worst frame 33.5 ms PASS (was 200) | heap 58 MB | leak +1.2 MB/180s | gpuMB 349 (stats) / 348 est PASS (was 615) | calls 381 wide-west PASS (was 6578) | tris 0.85 M wide-ne PASS (was 2.85 M) | transfer 21 MB | first frame 3.55 s | max tex 2048 | shadows 4 | console 0 | low tier 60 fps (stats calls 169) | all hooks present, interact() resolves for all 9 stations.
Grade shader: grain + CA removed (grain uniform left unused, harmless). SMAA on.
Rubric: Lighting 6 (=) | Materials 6 (=) | Set dressing 7 (=) | Character 6 (+4) | Interaction 5 (+4) | Cleanliness 7 (+3) | Cohesion 6 (+1).
Findings:
- FO-1 robot: original, clean, appealing white/red toy-bot with emissive face screen, FO-1 chest plate. But built from plain capsules/spheres; few panel lines/bevels, blocky claw hands, flat plastic material without wear/roughness variation; reads toy-like next to the semi-real room.
- Interactions: 9 distinct, all moving (PSNR f0-f2 25-39 dB). Good: lounge (sit back, arm on sofa), rig (reach to rack), forge (hands at printer), hunt/contract (seated typing). Problems: training robot faces AWAY from the pattern-book whiteboard and points at empty wall near coffee bar (heading flipped); hq robot faces the black TV/goal screen, which renders unlit/black (no goal content), gesture tiny; stats crouches at an unlit black box — safe/dial/ledger not readable; amplitudes small (contract/terminals near-static); no sparks at forge; exit shots: lounge camera clips inside robot arm, rig camera inside the head.
- World unchanged: back-right half (stats/rig/terminals) still near-black; ceiling a flat dark mass; skyline blocky; bloom blows out on lounge exit lamp.

### Round 1 glitch re-check (2026-11-21, round 1 frames + clip prototype on current WIP build)
Visual, round 1 frames:
- lounge loop: the robot's hips and legs are sunk into the sofa seat cushion. The zig-zag cushion passes through its torso and right arm. One foot pokes out under the coffee table.
- hunt loop: the robot sits in front of the chair, not in it. The chair armrest crosses through its thigh/hip, and the chair back sits beside its right shoulder.
- stats loop: the head/visor presses into the side of the safe. The left hand and forearm sink into the safe front, and the dial is not visible.
- lounge exit: camera inside the robot's arm (full-frame close-up). rig exit: camera at or inside the head.
- hq: the goal screen renders black (counts as a 'black screen' glitch under 1b).
Automated (clipproto2, current WIP build; advisory boxes, no colliders hook):
- Robot below the floor: lounge loop -12.4 cm, stats loop -8.4 cm, contract loop -4.2 cm, hunt loop -2.4 cm; enter/exit transitions reach -14 cm (feet go through the floor while sitting or crouching). Idle -0.5 cm (OK); walk -2.1 cm (feet dip slightly in the stride).
- Foot sliding during static loops: terminals rAn 4.4 cm, contract rAn 4.0 cm, hq lAn 3.2 cm.
- Pose-pop suspects: training exit 6.4 m/s (rF2), rig exit 6.2 m/s (lWr), forge exit 5.2 m/s. Likely snapping on leave().
- Camera inside the 'rig' collider box: training exit, terminals enter.
Dense frames, current WIP build (clipproto/stations/*/dense-sheet.jpg):
- lounge exit: the camera passes through the pegboard wall, with about 5 frames that are full-screen pegboard. The camera is also within a few cm of the head during the sit-down.
- hunt enter: the robot stands next to the chair, then appears seated within about 2 frames. Possible snap into the sit pose. Needs a slower capture to confirm.

## Round 2 (2026-11-21, commit 977a8cb) — REJECT; counts as IMPROVEMENT (SPEC 5)
Runs: out/2 (full: perf, leak, low tier, dense all; clip v1), out/2c (only-clip with the tightened test v2). Environment clean: no automated Chrome, desktop Chrome idle, load 1.5-2.8.
Budgets (out/2): p5 59.9 | avg 60.0 | worst 16.8 ms | heap 58 MB | leak +0.7 MB/180s | gpuMB 329 | calls 369 (wide-west) | tris 0.73 M | transfer 18.4 MB | first frame 3.05 s | max tex 2048 | shadows 4 | console 0 | low tier 60 fps | hooks all ok incl. robot (Object3D) + colliders(). The fps rise from round 1 (52 avg) is partly because round 1 had desktop-Chrome contention.
Clip v1 (builder proxies only): 0/0, PASS (matches the builder's claim). I didn't trust it, so I probed it:
- colliders() has NO wall/room-shell proxies, NO swivel-chair proxies (moving furniture), no desk-lamp proxy. 44 mesh refs are detached (stale matrices). 437 entries are unnamed 'prop'/'mesh'.
Harness tightened (clip v2, now default):
- room-shell check from the floor collider (walls are missing from the hook).
- INDEPENDENT geometry check: robot bone volumes (bone-local AABBs shrunk 1.5 cm) vs live scene-mesh vertices, including moving furniture.
- camera rays via three's Raycaster: geometry within 25 cm in front of the lens; robot head/chest occluded by opaque geometry for >= 3 samples.
- self-test (tools/selftest-clip.cjs): injected box + mesh both detected.
Clip v2 on round 2 (out/2c), FAIL:
- training exit: camera 12 cm from a mesh, robot hidden behind it (0.21 m from lens) ~1 s. Visible as a black slab over half the frame in the dense frames.
- terminals enter: geometry 8 cm in front of the lens; dense frames show a rack/desk close-up, then the robot head filling the frame.
- contract enter: camera 13 cm from forge geometry; robot hidden behind part_mat (the pegboard) for ~1 s while walking in.
- hunt exit: right ankle 4.3 cm into the moving chair (part_mat). rig: left wrist 2.8 cm into the rack (exit), 1.9 cm into the terminals desk (enter). rig enter: lens 23 cm from geometry (minor).
Visual glitch checklist (by eye):
- lounge sofa sit is now clean (sits on the cushion, feet on the floor).
- hunt chair sit is clean (seated in the chair, chair pulled in).
- stats: crouch with the ledger in hand, hand on the dial, door opens; reads well.
- walk-side shot: the camera is blocked by a monitor and the robot is hidden (shot framing bug).
- terminals station framing: a blank grey whiteboard fills about a third of the frame.
- The head seam reads like a crack.
- No T-pose, z-fight, black screens or missing textures seen. HQ board lit with content.
- Pop metric suspects: hunt loop rF2 4.75 m/s, contract loop rFi 5.1 m/s (57 cm in ~120 ms). Not visible in dense frames at ~200 ms; unconfirmed.
- Foot "slide" of 11.8 cm at hunt/contract is the chair pull-in moving the seated robot (expected, not a glitch).
Rubric: Lighting 7 (+1) | Materials 6 (=) | Set dressing 7 (=) | Character 7 (+1) | Interaction 7 (+2) | Cleanliness 7 (=) | Cohesion 7 (+1).

## Round 3 (2026-11-21, commit 6682cf2) — REJECT; IMPROVEMENT under SPEC 5 (strict clip/camera gate fixed, Materials +1)
Runs: out/3 (full harness, clean env: 0 automated Chrome, desktop Chrome 0% CPU, load ~2) and out/3b (only-clip with test v3).
Budgets: p5 59.9 | avg 60 | worst 16.8 ms | heap 80 MB (was 58) | leak +1.0 MB | gpu 335 | calls 370 | tris 0.74 M | transfer 18.5 MB | first frame 3.6 s | low tier 60 | console 0 | hooks ok.
Clip v2 (out/3): 0 hits for proxies, live geometry and camera. Self-test still detects injected overlaps (geom 5, box 3). colliders() quality fixed: 4 walls, 0 unnamed, 0 detached refs.
Harness v3 (added this round): the clip sampler now also runs over every standard shot() view (ignoring the first 400 ms after the teleport).
- out/3b finds 1 hit: shot 'lounge' left wrist 1.7 cm into sofa_arm_left (tolerance 1.5). This makes the clip gate FAIL by a small margin.
- Pop metric is ~3.0-3.4 m/s at hunt/contract loops (typing); nothing is visible in the dense frames.
Visual checklist:
- lounge loop: arms held straight out almost horizontally along the sofa back, which reads as a T-pose. Unnatural; the main glitch this round.
- Camera very close to the robot on entry: lounge enter (robot fills the frame for about 5 frames), rig enter (head fills the frame, dark wall covers half the screen), training exit (head fills the frame). Robot-distance rule needed (>= 0.9 m).
- Robot: new boxy torso with pauldrons and a chest plate. A blown specular hotspot on the right pauldron (walking shot) and a headlamp bloom.
- hunt/contract chair sit is clean (chair pulled in, typing). stats, HQ, forge, training and terminals read well. No z-fighting, black boards, T-pose flash or camera-in-geometry seen.
- World: still dark and murky in wide views; skyline through the windows is still blocky and low-detail; grime and decals barely read at 1080p.
Rubric: Lighting 7 (=) | Materials 7 (+1) | Set dressing 7 (=) | Character 7 (=) | Interaction 7 (=, lounge pose + close cameras) | Cleanliness 7 (=) | Cohesion 7 (=).

## Round 4 (2026-11-21, commit b312a12, includes the builder's post-b5 rim-light change) — REJECT; IMPROVEMENT under SPEC 5 (Cleanliness +1; shot-lounge wrist hit from 3b fixed)
Run out/4: full harness, clean environment (0 automated Chrome, desktop Chrome 0%, load ~2). Every gate passes, including clip v3 over all shot views. Self-test still detects injected overlaps (5/3).
Budgets: p5 59.9 | avg 60 | worst 16.8 ms | heap 80 MB | leak +0.13 MB | gpu 335 | calls 371 | tris 0.76 M | transfer 18.5 MB | first frame 3.3 s | low tier 60 | console 0.
Lounge arm (tools/probe-lounge.cjs; bones sampled every 0.5 s through the loop):
- Settled pose: left arm drop is 6-8 deg below horizontal, NOT the 42 deg the builder claims.
- Left wrist y=0.87 vs sofa_back top y=0.78, so the hand hovers ~9 cm ABOVE the backrest (z 10.29 is over the back box).
- In the stills the arm sticks straight out sideways at shoulder height: a one-sided T-pose that rests on nothing. The floating forearm is a 1b glitch.
- The waypoint motion swings the hand up behind the head (wrist y 1.23) before settling.
- Right hand on the thigh is fine. Seat, legs and feet are fine.
- Gap in the harness: the clip test cannot catch 'meant to touch but floating'. Candidate rule for next round: for contact poses, the wrist must be within 3 cm of a contact-flagged surface.
Visual checklist (other stations): no clipping, camera distance now good at lounge/rig/training entry, no blown highlights, no z-fighting or black boards. Rig/terminals/hunt/contract/stats/HQ/forge read cleanly.
World: a little brighter, but wide views are still dim and low-contrast vs refs. Added clutter and grime are barely noticeable. Skyline better but still flat at window distance.
Rubric: Lighting 7 (=) | Materials 7 (=) | Set dressing 7 (=) | Character 7 (=; V torso + helmet nicer, still toy-like and primitive limbs) | Interaction 7 (=; lounge arm) | Cleanliness 8 (+1) | Cohesion 7 (=).

### Contact gate added (2026-11-21, prototyped on b312a12, run out/4c --only-clip)
- clip.cjs CONTACTS table = the reviewer's reading of SPEC section 1 intended contacts per station.
  - feet on floor (each foot; median over the settled loop), seat on chair/sofa (hold), lounge left arm on sofa back/arm (hold).
  - hands on keyboard/board/rack/dial/bench ('tap': must come within 3 cm at least once in a ~3 s loop window).
  - Gate fails if any gap is > 3 cm.
- Also fixed in the harness: colliders are now re-read live from the hook every ~0.5 s. Before, they were cloned at install, so moving chairs and the safe door were stale.
  - Hits on MOVING boxes are reported as ADVISORY: world AABBs of rotated chair parts are loose (73 such hits, while the exact live-geometry check finds 0).
  - Samples where the robot is hidden (desk-* close-ups) are skipped.
Results on b312a12: 19/21 contacts pass. FAIL hq 'taps goal board' 7.7 cm (finger never reaches the screen) and rig 'taps rack/screen' 5.5 cm.
- Tap results vary between runs: hunt/contract hands were 7.2/5.4 cm in one run and 0 in the next. They depend on the sample window, so treat a borderline tap as real only when it fails twice.
Non-moving penetration hits with live colliders: shot:lounge forearms 3.1 cm into sofa_back (limit 3.0 on a contact surface); forge enter right hand 1.7 cm in a circuit-board trim.
CORRECTION to the round 4 lounge finding: the left forearm/elbow DOES touch the sofa_back top (gap 0, even 3 cm in). Only the wrist rises ~9 cm, and the shoulder-to-wrist drop is just 6-8 deg. So it is an unnatural near-horizontal pose, not a fully floating arm. The pose complaint stands; 'rests on nothing' was too strong.

## Round 5 (2026-11-21, commit 42b0be1) — REJECT; IMPROVEMENT under SPEC 5 (Lighting +1, Interaction +1)
Runs: out/5 (full harness, clean environment: 0 automated Chrome, desktop Chrome 0%, load ~1.5) and out/5b (second clip/contact pass plus the new FLAG AUDIT).
Every gate passes in both runs. Contact gate 21/21 both times; worst tap gaps in the second pass were hunt 2.2 cm and stats 1.7 cm, still under 3.
Budgets: p5 59.9 | avg 60 | worst 16.8 ms | heap 83 MB | leak -0.3 MB | gpu 339 | calls 371 | tris 0.78 M | transfer 18.5 MB | first frame 3.4 s | low tier 60 | console 0.
Flag audit (new in the harness: penetration measured at the strict 1.5 cm tolerance, ignoring contact flags):
- 63 samples sit 1.5-3 cm into contact-flagged surfaces. Max 2.6 cm: sofa back/forearm, chair seat/hips at hunt exit, chair back 1.9 cm.
- Hard surfaces: forge enter right hand 2.4 cm into the walnut benchtop; hunt desk 1.7 cm; HQ panel 1.5 cm.
- So the new flags (chair backs, whole rack, whole HQ display) excuse at most ~1 cm extra. Nothing large is hidden, and the independent live-geometry check is still 0. Not gating, but the forge benchtop 2.4 cm should be fixed.
Lounge: the settled pose is natural now (forearms along the backrest, elbows bent, feet planted). The loop has a 'shrug' gesture with both hands up, which reads fine.
- Sofa at 0.6 height: reads as a low loveseat; the scanned Chesterfield's rolled arms and tufting look vertically squashed under close inspection. Minor proportion issue; prefer a uniform scale or a low-sofa asset.
Visual checklist: no clipping, floating, T-pose, camera clipping, z-fighting or black boards seen across shots and all 9 dense sequences.
- New: the floor grime decals read as stray black hairline scribbles on the glossy floor (wide-ne, walking, portrait). Visual noise.
Look: lighting is clearly better: warm key, readable mid-tones, closer to refs 07/13. Robot limb armour and shin guards help, but it is still a blocky toy silhouette next to the semi-real room. Wide views still have open, empty floor areas.
Rubric: Lighting 8 (+1) | Materials 7 (=) | Set dressing 7 (=) | Character 7 (=) | Interaction 8 (+1) | Cleanliness 8 (=) | Cohesion 7 (=).

## Round 6 (2026-11-21, commit 2f5ea78) — REJECT; IMPROVEMENT under SPEC 5 (Materials +1)
Run out/6: full harness, clean environment (0 automated Chrome, desktop Chrome 0%, load ~1.8). Every gate passes.
Budgets: p5 59.9 | avg 60 | worst 16.8 ms | heap 91 MB | leak +1.6 MB | gpu 339 | calls 375 | tris 0.97 M (+190k) | transfer 18.2 MB | first frame 3.45 s | low tier 60 | console 0.
Clip, live geometry, camera, contact (21/21): all 0 fails.
Flag audit: 62 samples. Max 2.6 cm forearm into sofa_back (lounge shot), 1.9 cm hips into the chair cushion, forge walnut 1.8 cm (was 2.4), HQ panel 1.5.
- My audit counts 62, not the builder's 53. It counts per part/object, and all hits are within the 3 cm flag allowance.
Forge entry repeated 6x from different start views (tools/repeat-station.cjs, strict tolerance, flags ignored for the geometry check): 0 hits in all 6. Not reproduced.
Visual:
- New leather sofa: natural proportions, good.
- Floor scuffs are soft now; the scribbles are gone.
- Printer station, credenza, prints and shelves add life near the walls. The wide views still have open, empty floor zones and are less dense than refs 10/16/20.
- No clipping, floating or camera glitches in the 9 dense sequences.
Robot:
- Rear fins/vent slots on the back of the head read as a medieval knight's helmet grille from behind (gameplay, training shots). The view is mostly from behind, so this matters.
- From the front, the brow hood plus the screen face reads as a cap brim over a CRT/TV head. Mild.
- Weathering is barely visible at 1080p.
Originality: a TV/screen-face boxy white/orange robot is a generic trope. I see no specific franchise character resemblance (not Wall-E/EVE, Baymax, Astro Boy, Mega Man, Portal, Fallout robots, etc.). The FO-1 decals and orange/ivory palette are distinctive. OK.
Rubric: Lighting 8 (=) | Materials 8 (+1) | Set dressing 7 (=) | Character 7 (=) | Interaction 8 (=) | Cleanliness 8 (=) | Cohesion 7 (=).
Remaining to approve: Set dressing, Character, Cohesion (all 7).

## Round 7 (2026-11-21, commit 1332149) — REJECT (Set dressing 7); IMPROVEMENT under SPEC 5 (Character +1, Cohesion +1)
Run out/7: full harness, clean environment (0 automated Chrome, desktop Chrome ~1%, load 1.5). Every gate passes.
Budgets: p5 59.5 | avg 60 | worst 16.8 ms | heap 97 MB | leak -0.5 MB | gpu 341 | calls 386/400 (thin) | tris 1.18 M/1.5 M | transfer 18.2 MB | first frame 3.45 s | low tier 60 | console 0.
Clip, live geometry, camera, contact 21/21: all 0 fails.
Flag audit: 81 samples (builder says 74). Worst: hips 2.8 cm into the hunt chair seat (exit), sofa back 2.6, contract chair seat 2.4 (enter).
- In the dense hunt/contract frames the hips sit in a leather cushion and nothing pokes through. NOT a visible glitch, but it is 2 mm from the 3 cm allowance.
Path check (new tools/path-clearance.cjs):
- All 9 interact() calls resolve in 2-4.4 s.
- Closest obstacles on the paths are the stations' own chairs/sofa (7 cm, expected when sitting). No new prop is the nearest obstacle on any path; HQ is the tightest at 26 cm to its own credenza.
- So the new props do not block paths.
Visual:
- New head: smooth domed skull, wrap visor, right-side sensor pod plus antenna. Clean and appealing; it reads well from the back too.
- Desaturated paint, cavity grime and edge chips now sit in the room's palette. Cohesion is better.
- Originality: a dome head with a visor reads astronaut/VR-headset-like (a generic trope). No specific franchise character resemblance. OK.
- Set dressing reads RANDOM rather than lived-in:
  - whiteboard trolley standing edge-on in open floor (wide-west foreground, walking shot);
  - three bins (2 metal cans + wicker) clumped around the armchair/coffee-table group (gameplay, portrait, walking);
  - loose yellow crate and cable protector in the middle of the floor (wide-west).
  - It looks scattered and blocks sightlines, though not walking paths.
- No clipping, floating, pops or camera glitches in the 9 dense sequences.
Rubric: Lighting 8 (=) | Materials 8 (=) | Set dressing 7 (=) | Character 8 (+1) | Interaction 8 (=) | Cleanliness 8 (=) | Cohesion 8 (+1).
Only Set dressing blocks approval.

## Round 8 (2026-11-21, commit c299146) — APPROVE (first approval); IMPROVEMENT under SPEC 5 (Set dressing +1)
Run out/8: full harness, clean environment (0 automated Chrome, desktop Chrome 0%, load ~1.9). Every gate passes.
Budgets: p5 59.9 | avg 60 | worst 16.8 ms | heap 95 MB | leak -0.6 MB | gpu 339 | calls 350 (was 386) | tris 1.11 M | transfer 18.2 MB | first frame 3.4 s | low tier 60 | console 0.
Clip, live geometry, camera: 0. Contact 21/21.
Flag audit: 28 samples (builder says 32), max 2.6 cm (sofa back forearm, lounge shot; unchanged since r5 and not visible). Hunt-exit seat sink is no longer the worst.
Path clearance (tools/path-clearance.cjs): identical to r7 (2-4.4 s; nearest obstacles are the stations' own furniture). Props do not block paths.
Shadow batching check:
- tools/shadow-audit.cjs: 49 casting / 142 non-casting meshes.
- Floor-standing non-casters: two desk-side bins (h 0.42 m, at hunt 7.8,4.4 and contract 1.8,2.9) and one 0.43 m object by the hunt desk (bag) at 5.9,4.6. They sit in the desk's shadow and are not noticeable.
- No flat geometry casts.
- Side-by-side r7 vs r8 (wide, desk-forge): furniture, armchair, desk and stool contact shadows are unchanged. No missing or wrong shadows visible.
- Minor polish: let the bins cast or give them a baked contact blob.
Visual:
- Reading corner (rug, angled armchairs, round table, floor lamp) reads intentional.
- The trolley sits against the east wall; floor clutter is cleared.
- The room now reads lived-in and deliberate.
- No clipping, floating, pops or camera glitches in the dense sequences.
- Robot unchanged from r7: original, no franchise resemblance.
Rubric: Lighting 8 | Materials 8 | Set dressing 8 (+1) | Character 8 | Interaction 8 | Cleanliness 8 | Cohesion 8. All >= 8 with all gates passing -> APPROVE per SPEC 4/5.
Caveat: the scores are at the threshold, not above it. Remaining polish if more rounds happen:
- bin shadows
- the lounge-shot forearm sink of 2.6 cm (within the flag allowance)
- draw-call margin of 50
- more density/variety to approach refs 10/16/20
