# Architecture

How Vrigstad Joyride is put together: where it is today, where it's going, and why. Conventions for day-to-day work are in [AGENTS.md](AGENTS.md). The migration is tracked in [#61](https://github.com/OliverRomhagen/vrigstad-joyride/issues/61).

## Today

```
tools/fetch.sh ──► data/raw/ (osm.json, tile.png)
                       │
tools/process.py ──────┴──► data/vrigstad.json
                                   │
Vite (tools/build.mjs) ── imports it ──► index.html  (from src/index.html + src/game/main.ts)
                                      └─► map.html    (from src/map.html + src/map/main.ts)
```

- Each page is one HTML file (CSS and DOM) and one big script, moved as-is into `main.ts` with `// @ts-nocheck`. Each builds to a single self-contained file (#44).
- three.js is imported from npm (`three`, `three/addons/...`) and bundled into each page (#47). Both pages keep the colour and light maths of r128, which the look was tuned with: `ColorManagement` is off and light intensities are scaled by π (`LEGACY_LIGHT`), both in `src/world/three-legacy.ts`, which both pages import. Moving to managed colour and retuning is #150.
- The game keeps all state in module-level variables (`cars`, `player`, `stars`, `inCar`, ...) and runs one `requestAnimationFrame` loop that mixes input, simulation, rendering and HUD updates.
- The map and the game each have their own copy of the terrain, buildings and trees code.

This was the right shape for a prototype. It stops scaling once several people add features at the same time, which is happening now.

## Target

```
pipeline (Python, unchanged) ──► data/vrigstad.json (imported, so it's inlined in single-file builds)
                                        │
src/
  world/      shared: heightfield, terrain, roads, buildings, water, trees,
              ground texture, spatial queries (nearestRoad, inWater, collide)
  game/
    sim/      pure TS game state + rules: player, vehicles, traffic, police,
              wanted level, pedestrians. step(state, input, dt). No three.js, no DOM.
    render/   three.js scene; syncs meshes from sim state each frame
    input/    keyboard, touch, gamepad ──► Input intents
    audio/    reacts to sim events
    loop.ts   fixed-timestep sim, interpolated render
    store.svelte.ts   HUD state the UI reads
  ui/         Svelte components: HUD, intro, menus, touch controls
  map/        map page: world/ + orbit camera + Svelte legend
tests/
  unit/       Vitest, against world/ and game/sim/
  e2e/        Playwright smoke tests against the built pages
```

### Data flow in the game

```
 Input devices ──► input/ ──► Input intents
                                   │
                                   ▼
               ┌──────── sim.step(state, input, dt) ────────┐  fixed 60 Hz
               │  state: plain objects     events: busted,  │
               │                           star-added, ...  │
               └──────┬───────────────────────────┬─────────┘
                      │ read only                 │
                      ▼                           ▼
              render/ (three.js)          store ──► ui/ (Svelte HUD)
                                          audio/
```

### Why these boundaries

- **world/ is shared** so the game and the map can't drift apart, and so data-heavy work (mesh building, spatial indexes) is done once and tested once.
- **sim/ has no three.js** so game rules can be unit-tested in Node, run at a fixed timestep (same feel at any framerate), and later run on a server or in a worker for multiplayer (#1).
- **The UI only reads a store** so Svelte's reactivity never touches the hot loop. The game writes HUD values when they change (speed throttled to ~10 Hz), not every frame.
- **Events, not calls, between systems.** The sim says "a star was added"; the UI shows a toast, audio plays a siren, render flashes the lights. New features plug in without editing the sim.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite, multi-page | #44 |
| Language | TypeScript, strict | #44 |
| 3D | three.js, current, from npm | #47 |
| DOM UI | Svelte 5 | #51; HUD and menus only |
| Unit tests | Vitest | #52 |
| Smoke tests | Playwright | #43 |
| Lint/format | Biome | #46 |
| Deploy | GitHub Actions ──► Pages | #45 |
| Data pipeline | Python stdlib | unchanged; #60 for later options |

## Decisions

Short records so settled questions stay settled. Add one when you make a choice someone might reasonably question later.

- **Stay on three.js; no game engine.** Phaser is 2D. Babylon.js, PlayCanvas and Godot were considered; see #58 for the trade-offs and when to revisit.
- **Svelte for DOM UI, not for the scene.** Declarative scene graphs (Threlte) don't suit a hot game loop. They might suit the map viewer.
- **Supersedes #23's npm-free approach.** The module split in #23 still applies; the concatenating Python build doesn't. The project chose to grow, and types, tests and a UI layer need a bundler.
- **Still ships as one `index.html`, for now.** `vite-plugin-singlefile` inlines everything per page, so the game stays a single self-contained file. Switch to normal multi-file output when models and audio make caching worth it (see #44).
- **Modes are state machines.** Player, wanted level, police AI and app flow become explicit typed state machines in `sim/`, hand-rolled first, with XState only if quests need more (#63).
- **HUD stays DOM; in-world UI uses canvas textures.** HTML-in-canvas (#56) replaces the canvas textures once browsers support it.
- **No physics engine yet.** Collisions are hand-rolled. Rapier is the candidate when crashes (#40) need more (#54).
- **No ECS yet.** Plain arrays per system; revisit with miniplex when entity kinds multiply (#55).

## Coordinates and data

Metres; origin 57.3555° N, 14.4756° E; x east, z south, y up; the world spans −1100..1100 on x and z.

`data/vrigstad.json`:

| Key | Content |
|---|---|
| `size`, `n` | World side in metres (2200) and elevation grid size (89 × 89, 25 m spacing) |
| `elev` | Row-major heights in **decimetres** |
| `b` | Buildings: `p` flat `[x, z, x, z, ...]` footprint, `h` height (guessed), `k` kind |
| `r` | Roads: `c` class, `n` street name, `p` polyline |
| `w` | Water polygons |
| `ww` | Waterways: `k` kind, `p` polyline |
| `l` | Land use: `k` class, `p` polygon |
| `labels` | Named places: `t` text, `x`, `z`, `k` kind |

Class codes are defined in `tools/process.py`. Move them into a shared typed module once the code is TypeScript.
