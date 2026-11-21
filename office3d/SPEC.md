# First Office 3D — redesign spec (loop 2)

Owner direction (2026-11-21): a clean, smooth, high-quality 3D game. The **world** should approach the
environment quality of the GTA 6 interior references (lighting, materials, set dressing, density).
The **character does not need to be lifelike**: an original, stylised robot / humanoid-robot is wanted,
but it must still look high quality with detailed features (panel lines, bevels, materials, emissive eyes etc.).
Everything should look **smooth and clean: no film grain, no noise, no chromatic aberration, no dithering
speckle, no shimmering/aliasing**. The game must stay original (no GTA/Rockstar names, characters, assets).

## 1. Station interactions (required)
Pressing E at any station makes the character physically use it before/while its window opens:
walk/turn to the station's use-spot, then a station-specific animation that loops while the window is open,
and a short exit animation when the window closes. It does not need 1:1 contact accuracy; it must read clearly.
- Founder workstation (hunt): pull chair, sit, type on keyboard, glance between monitors.
- Ops center (contract): sit or lean, headset/phone gesture, scroll/click.
- Ledger vault (stats): crouch, turn the safe dial / open door, flip ledger.
- Training bench (training): stand at whiteboard, write / point at pattern book.
- Agent forge (forge): stand at workbench, tinker with tool (hands moving, small sparks ok).
- HQ goal board (hq): stand facing board, point/tap at it, arms-crossed review.
- GPU rig (rig): open rack door / inspect, tap on rack screen.
- Agent terminals, lounge, any other usable station: sit + type, or sit back on sofa.
Animations may be authored clips or procedural bone animation. Each must be distinct.

## 2. Performance & resource budgets (hard gates)
Measured on this Mac Mini, Chrome (GPU, Metal), 1920x1080, default quality (no `?q=` param).

| Metric | Budget |
|---|---|
| FPS, scripted tour (walk every station + every interaction anim + camera orbits), 5th-percentile frame | **>= 25 fps (frame time <= 40 ms)** |
| FPS, same tour, average | >= 50 fps |
| Any single frame after loading (excluding the first 2 s) | <= 100 ms |
| JS heap used (performance.memory.usedJSHeapSize), steady state | <= 250 MB |
| JS heap growth over a 3-minute play loop (leak check) | <= 20 MB |
| Estimated GPU memory (textures + geometry, from renderer.info + texture dims) | <= 400 MB |
| Draw calls per frame (renderer.info.render.calls), worst view | <= 400 |
| Triangles per frame, worst view | <= 1.5 M |
| Total transfer for the 3D page (sum of response bytes) | <= 60 MB (gzip/compressed where possible) |
| Time from navigation to first 3D frame (local server) | <= 8 s |
| Max texture size | 2048 px (4096 only for 1-2 hero atlases) |
| Shadow-casting lights | <= 4 |
| Console errors / WebGL warnings | 0 |

Accessibility of hardware:
- Quality tiers `low / medium / high` (+ optional `ultra`), chosen automatically and stepped down at runtime
  if fps stays under 30. `?q=low` at 1280x720 must reach >= 30 fps average with CPU throttled 4x (CDP
  Emulation.setCPUThrottlingRate) — a proxy for weaker laptops.
- devicePixelRatio capped (<= 1.5 on high, 1 on medium/low).
- A real loading screen with progress while 3D loads (never flash the old 2D office); if WebGL2 is missing or 3D
  fails, fall back to 2D with a short notice. Handle webglcontextlost/restored.
- Pause rendering when the tab is hidden.

## 3. Test hooks (the reviewer's harness depends on these; keep them stable)
`window.Office3D`:
- `ready` (bool), `shots()`, `shot(name)` — as today.
- `stations()` → array of usable station ids in the room.
- `interact(id)` → walks/teleports to the station and starts its interaction; returns a Promise resolved once the
  interaction animation is playing. `leave()` ends it (exit anim).
- `stats()` → `{ fps, frameMs, calls, triangles, textures, geometries, gpuMB, quality, pixelRatio }`.
- `quality(q)` setter as today.

## 4. Visual review rubric (reviewer)
Score 1-10 vs the 30 refs in work/gta6-reference/indoor (world) and vs high-quality stylised 3D games (character):
1 Lighting/GI, 2 Materials, 3 Set dressing, 4 Character quality (stylised robot bar: clean modelling, detail,
materials, appeal, animation), 5 Interaction animations (clarity, distinctness, smoothness), 6 Image cleanliness
(no grain/noise/aliasing/banding, smooth), 7 Overall cohesion.
Approval: every visual score >= 8 AND every budget in section 2 passes.
