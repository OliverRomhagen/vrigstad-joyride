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

- Each page is one HTML file (CSS and DOM) and one script. The game's, `src/game/main.ts`, creates the modules in `src/game/` and connects them (#177); the map's, `src/map/main.ts`, is still one big script, moved as-is with `// @ts-nocheck`. Each page builds to a single HTML file, with its fonts and models beside it (#44).
- three.js is imported from npm (`three`, `three/addons/...`) and bundled into each page (#47). Both pages keep the colour and light maths of r128, which the look was tuned with: `ColorManagement` is off and light intensities are scaled by π (`LEGACY_LIGHT`), both in `src/world/three-legacy.ts`, which both pages import. Moving to managed colour and retuning is #150.
- ISO 800 grain (`src/game/presentation/`) is an opt-in monochrome DOM layer over the whole game, HUD and menus included. `?grain=on` (or `iso800`) enables it; otherwise nothing is allocated. One seeded 256 px texture jumps between precomputed offsets: 12 times a second while the camera moves, 4 while it is still (`main.ts` passes a moving flag from `cameraMoved()` after the camera rig places the camera, with a small tolerance because the chase camera eases in). The effect has no three.js dependency or loop of its own. Reduced motion keeps it static, and `dispose()` removes it, the integration point for settings (#78).
- The game's shared state is plain data in `src/game/state.ts` (#294): `GameState` (`started`, `inCar`, `pcar`, ...) for the game itself and `ViewState` for the camera, one object each, made in `main.ts`, which hands the modules the fields they need through their `*Deps`. What a module owns stays in that module (`cars` in the fleet, `stars` in the police); the loop's own counters are in `src/game/loop.ts`. The game runs one `requestAnimationFrame` loop there that steps input, simulation, rendering and HUD updates in turn; separating the simulation from the rendering is #49.
- `src/world/` (#48) holds the world's data and queries, with no three.js outside `mesh/` and `three-legacy.ts`: the data's types and class codes, the height lookup, the seeded random stream, building shapes and tree spots, which both pages use, and the roads, water and building footprints with their spatial queries (`nearestRoad`, `groundAt`, `inWater`, `collide`), which only the game uses so far. `src/world/mesh/` builds the terrain, the building shells, the game's road ribbons, the streetscape and the bridges (below) from them. Each page keeps its own look: its ground texture, colours, house details and tree models.
- Time of day (#99) is already split along the target lines: `src/world/sun.ts` gives the sun's direction over Vrigstad, `src/game/day-cycle.ts` is a plain-data clock (05:00 to 19:00, then a short blend into the next morning, so there is no night) and the light levels it gives, and `src/game/render/daylight.ts` applies those to the lights, sky dome and fog.
- The sky is one dome (`src/game/render/sky.ts`): the blue gradient, the sun's glow and procedural fair-weather clouds in a single shader, so the clouds add no draw call. Each pixel meets a gently curved cloud layer about 1.8 km up and reads a deterministic, periodic noise field there (`src/world/clouds.ts`), so the clouds stay put in the world, drift with the wind by time rather than frames, and pass with parallax. The same field in TypeScript says once a frame whether the sun is behind a cloud, and the sun's intensity eases down while it is. The clouds take their colours from the dome's sun, horizon and zenith colours and their light from the shared sun direction, so whatever drives the daylight drives them too.

### Streetscape (#187)

Sidewalks, curbs, verges, junction corners, lowered curbs, crossings, parking and street trees, from OSM where OSM says and from documented rules where it doesn't.

```
data/vrigstad.json ──► streetscape-rules.ts ──► StreetSides per road (sidewalk, curb, verge, parking per side + evidence)
   (+ streetscape-overrides.ts)                      │
                                   streetscape.ts ◄──┘  layout: strips, corners, openings, triangles, lots, tree spots
                                     │        │
              mesh/sidewalk-mesh.ts ─┤        ├─ StreetscapeIndex.surfaceAt: the walkable height (the game's groundAt)
              mesh/parking-mesh.ts  ─┘        └─ the map paints the same layout's outlines
```

- `polyline.ts` is the sampling both `RoadRibbons` and the streetscape use, so a curb starts on its ribbon's edge vertex, bit for bit.
- `streetscape-rules.ts`, `streetscape.ts` and `polyline.ts` are pure (no three.js); the mesh builders batch one surface and one markings mesh per 250 m chunk.
- Every feature carries its **evidence**: `mapped` (an OSM tag or object says it exists and where), `derived` (OSM says it exists; defaults fill the geometry), `inferred` (a rule guessed it: a street in the centre or a residential area). The evidence is computed at runtime, never stored in the JSON, so retuning the rules needs no data rebuild. `?debug=streetscape` tints by it, and `npm run data:report` sums it.
- A missing OSM tag means unknown, never "no". Explicit tags beat inference; overrides (by OSM way id, empty by default) beat both, but fixing OSM is the better fix.
- Choices hash the OSM way id (`fnv1a` in `random.ts`), never data order or the game's `rnd()`.

### Street furniture (#144)

- `src/world/furniture/` decides where street lamps, benches and waste bins stand; `src/world/mesh/street-furniture.ts` models and draws them. Placement knows each kind's footprint (`definitions.ts`), never its model; the models know nothing about OSM.
- **Source priority:** OSM objects (`fu` in the JSON) stand where mapped and are never moved; overrides (`overrides.ts`, empty by default) add, remove or move by id; then rules fill in, and their objects are labelled `procedural`. A generated object never duplicates a mapped one of its kind, and a road with two or more mapped lamps gets no generated ones.
- **Context per road** (`context.ts`): the streetscape's profile (`centre`, `residential`, `outskirts`) decides it, so streets aren't classified twice; lit paths (`lit=yes`) are `path`, and Torget's own outline is `torget`. Lamp spacing, benches and bins follow the context: each rule module names its numbers (`lamps.ts`, `seats.ts`, `bins.ts`), on the shared queries and checks in `placer.ts`, and `placement.ts` runs them in order.
- **Checks** keep every generated object out of carriageways, buildings, water, parking lots, crossing openings, other furniture and the game's places (safehouse doors, the kiosk's lucka), and off steep ground.
- **Deterministic:** every choice hashes a stable id (the OSM way id and piece), never the game's `rnd()` or data order, so furniture shifts no other roll. Ids are stable too: an override names one.
- **Drawing:** one `InstancedMesh` per model body and per lamp glass in each 400 m cell, as the trees are, so the main and shadow passes cull whole cells; set once, at `groundAt`. The lamp glass is one shared material, and `lampEmitters()` gives each lamp's light position, both for the night (#99). No collision yet: cars and people pass through furniture. `?debug=furniture` tints by source, and `npm run data:report` sums it.

### Water: lakes, rivers in their channels, shores (#263)

```
data/vrigstad.json ──► water-shapes.ts: WaterBodies (levels, widths, banks) ◄── the uncut Heightfield
                            │ implements TerrainCut
                            ▼
                     Heightfield({ cut }) ── heightAt, groundAt, inWater: everything stands on the cut ground
                            │
     mesh/terrain.ts (refined cells) · mesh/water-surface.ts · shore.ts ──► mesh/shore-props.ts, ground paint
```

- **One method cuts the ground.** `WaterBodies` (pure) is the only thing that changes terrain heights. It implements `TerrainCut`; `Heightfield` asks it once which 25 m cells it touches and stores the cut there on a finer grid (24, 12 or 6 sub-samples a side: streams, rivers and steep or road-side shores, gentle shores), each cell on the coarsest of those grids, halving, that holds the cut within 5 cm. `heightAt` interpolates those samples with the grid's own diagonal, and `TerrainMesh` draws exactly them, the refined cells in 200 m blocks the camera culls, so the mesh and every height query agree. A refined edge shared with a plain cell stays a straight line between its corners, and one shared with another refined cell carries the cut at the points both have, so there are no cracks. Without a cut, `Heightfield` behaves bit for bit as before. The map's exaggeration multiplies the cut ground, so its channels are doubled too.
- **Construction order** (both pages): `base = new Heightfield(D)` → `bodies = new WaterBodies(D, base)` → `heightfield = new Heightfield(D, { exaggeration, cut: bodies })`; everything else is built on `heightfield`, except the bridge decks: `new BridgeIndex(D, base)` (the map passes its exaggerated uncut ground).
- **Rivers and streams** (`ww`) are joined end to start into courses and sampled every 2 m. A course runs downstream: OSM's direction, unless its end lies clearly higher than its start. Its **level** is the highest that stays a recess below the uncut ground (1.0 m for rivers, 0.55 m for streams, easing to a lake's 0.35 m within 40 m of one), climbing at most 1.5 % along the flow (the 25 m grid carries metres of noise along the river; a level that never rose would cut metres deep through every bump), held at a lake's level inside it and falling at most 2 % to meet it. The cross-section: a bed `bed` below the level at the centre line rising to the waterline at the half width, then a bank rising at its slope until it meets the ground, rounded where it does. Width (±12 %) and bank steepness (±30 %) wander along the course from a hash of its key.
- **Lakes** are level planes. A lake's level is 0.35 m below the low tenth of its shore's ground, and no higher than the ground where an outlet leaves it or the level of a river flowing in. The bed falls from the shore to a shelf 1.2 m under the level; past the shore a bank rises at its slope until it meets the ground. Where the shore's ground is lower than the water, it is raised just enough to hold it, fading out by 10 m. The world's edge, where the map cuts a lake, isn't a shore. Islands are rings like the shore. This replaces #263's terrain-conforming surface: the grid's heights vary by metres inside each lake, so a surface following them tilts visibly, while a level plane with a locally cut shore reads as a lake.
- **What the cut leaves alone:** roads (to their edge plus 2.5 m for streets, 1.5 m for paths) and buildings (1.5 m), easing into the bank over the next few metres. A road across a river stays at its height, so until the bridges (#238) exist, a crossing is an embankment the channel runs into, with the water hidden under the road. Nothing beyond 12 m from the water's edge is touched.
- **Water queries:** `levelAt(x, z)` is a lake's level inside its rings or a course's within its half width. The game's `Water.inWater` is true where that level stands above the cut ground, never on a bridge deck (`decks`); a road crossing without a bridge keeps its ground above the water, so it stays dry by the same test. Without the cut ground (the map's streetscape, tools), any road over water counts as a crossing. so what is wet is what you see under water. Streams are water now, at their own width. Wading and slowdowns are unchanged. The map's streetscape reads the same cut ground (its own, divided by the exaggeration), so the two pages agree on what is wet.
- **Surfaces** (`mesh/water-surface.ts`): a plane per lake, cut into squares from 32 m down to 4 m near the shore, and a ribbon per river run that tucks 0.9 m into the banks. Both carry `shore`, the distance from the waterline, and `flowUv`, along and across the flow (x and z on lakes). Each mesh sits at its own centre. **Material** (`mesh/water-material.ts`): a `MeshLambertMaterial` extended with `onBeforeCompile`, so fog, shadows and the scene's lights work as on everything else: three bands from the shore (edge, shallows, deep) whose edges wobble with the ripples, two procedural ripple layers drifting downstream or with a light wind, a tint towards the fog's horizon colour at grazing angles, and small hard glints on the sun's path (the shared `SUN_DIR`). No textures, render targets or extra passes; coarse devices and the map get one ripple layer and no glints. The colours are tokens in `water-palette.ts`, the season swap point (#114). Water meshes carry `userData.keepMaterial` so the cel-shaded style (#206) leaves them alone; `WaterMaterial.toon` hardens the bands instead.
- **Shores** (`shore.ts`, pure): every lake ring and river bank is cut into 8 m stretches, typed by the cut bank's steepness and what stands near: stony (steep, or by a road or building), sandy (gentle lake shore, in runs), reedy (gentle, in runs), grassy. Reeds and stones are placed from a hash of the stretch, never `rnd()`, and drawn instanced per 400 m cell (`mesh/shore-props.ts`); the game's ground texture paints bare earth on the banks and sand or gravel along those stretches. Trees and shrubs behind the banks are #250's.
- **Bridges (#238):** this is the one channel #238 asked for, along whole rivers rather than local cuts under each bridge. A bridge road keeps no ground, so the channel runs on under its deck. A road that ends at a bridge keeps its ground square to its end and on under the abutment's seat (2 m for streets, 0.8 m for paths), then eases into the bank, so the bank meets the abutment. The deck follows the uncut `base`, so it spans the channel at the approaches' height.

### Bridges (#238)

- **Found from OSM only:** `tools/process.py` writes `br` (`layer`, `bicycle=designated`) on every highway piece tagged `bridge=*`; `layer` confirms grade separation and is never read as a height. `BridgeIndex` (`src/world/bridges.ts`, pure) joins pieces that share an end node, class and layer into one bridge and picks an archetype: `road-slab` for a road, `path-steel` for a cycle path or a path over 10 m, `path-timber` otherwise. Six bridges on today's data.
- **One deck height:** the base terrain (before anything is cut into it), plus the road lift, plus a crest `rise · 4t(1 − t)` along the bridge, capped at a 5 % grade for roads and 8 % for paths. It is zero at both ends, so the deck meets its approaches exactly. `RoadRibbons` takes it as `heightOf` (sampling bridge roads every metre), `RoadNetwork.groundAt` returns `deckAt` within a deck's footprint, and `BridgeMesh` sweeps its parts relative to it, so the ribbon, the ground and the structure agree.
- **The deck is the ground** within its footprint: there is no layer under a bridge to stand on. Road bridges have walkways a curb above the carriageway (`walkOffsetM` puts pedestrians on them); on footbridges they walk the path's centre line, as on every path. The railings collide: `BridgeIndex.collide` pushes cars, people, cats and ragdolls out from them as walls do, through `BuildingIndex.addBarrier`, so they never become footprints. A car fits between a road bridge's railings but stops at the end of a footbridge.
- **The structure** (`mesh/bridge-mesh.ts`) is boxes swept along the deck, one vertex-coloured body and one railing mesh per bridge, in coordinates local to its middle: slab, walkways and edge beams; steel girders and a deck plate; timber beams and boards. Undersides are darkened. On a road bridge the ribbon is the driving surface in the game, and the deck's top sits under it; the map, with no ribbons, draws the carriageway itself (`top: true`). A footbridge gets no ribbon (`RoadRibbons`' `skip`): its steel plate or timber boards are the walking surface, at `deckAt`'s height, in both pages. The streetscape leaves bridge roads bare: their decks carry their own walkways.
- **Over the channels:** each end rests on an abutment (`groundAt`, the cut ground) from the deck's underside down into the bank; the deck's underside is darkened. Both pages leave bridge roads out of their ground paint, so the channel bed shows under the deck. The water stays at least 0.45 m under every structure on today's data (`bridge-channels-real.test.ts`).
- Dimensions, materials, heights and railings are inferred (OSM maps none of them here); `state().bridges` lists each bridge's archetype, width and evidence.

### The wiki (`wiki/`)

- A SvelteKit app, with its own `package.json`, built after the game into `dist/wiki/`, so one deploy serves both. Its pages are the Markdown files in `docs/lore/` (mdsvex), each checked against its kind by `wiki/src/lib/lore-index.ts` when the index is built. Two pages are the game's own code: the garage draws Skroten from `src/game/skroten-yard.ts` and `render/skroten.ts` with the game's car models, and the map page embeds `map.html?focus=x,z&embed`.
- **Prerendered in full, not only server-rendered.** Every route is written to static HTML at build time (`prerender = true` in the root layout, `adapter-static`), and nothing runs on a server: GitHub Pages serves files. A page's text, links and frame are in its HTML before any script runs, so it reads without JavaScript and search engines see it. The 3D scenes start in the browser, from attachments. The marketing site, which will be another part of the same site, follows the same rule. So a route that needs a server, or a layout that renders differently in the browser than in the prerender, is a bug: decide what to draw from the route (`page.route.id`), not by comparing `page.url.pathname` with `resolve()`, which gives relative paths (`./garage`) while prerendering, so the two never match there.
- **A scene is a class in a `.ts` file, not code in a component.** `wiki/src/lib/game-look.ts` has the `Stage` every 3D scene stands on (the game's renderer settings and lights, a camera you drag, the size, one loop, and `dispose`); the garage's scene is `GarageScene` (`garage-scene.ts`), and its component, `Skroten.svelte`, only starts it from an attachment and hands it the page's state. A scene honours `prefers-reduced-motion` through `Stage.still`: nothing turns or drives by itself then. A scene inside a page's text lets a finger scroll the page past it.
- **Styles live with their component**, in its `<style>`, which Svelte keeps to that component. `wiki/src/lib/wiki.css` holds only what every page shares: the colour and font tokens, the page's ground, headings, prose and tables, and a few classes more than one component uses. Text sizes are in `rem`. A kind of page (`place`, `character`, …) is defined once, in `KINDS` in `lore-index.ts`, with a branch for its infobox in `kinds/Infobox.svelte`.
- Without scripts a page still reads, and a phone shows the sidebar in the page in place of the Menu button; the 3D scenes, the map and the garage need scripts.
- It reads the game's code through aliases (`#game/`, `#world/`, `#data/`, `#fonts/` in `wiki/vite.config.ts` and `wiki/tsconfig.json`), and Fallow's `wiki` zone lets it import the world, the rules, the rendering and the fonts, never the game's page code. The world, rule, rendering and font code can't import the wiki; page code in `src/` has no rule, so it isn't checked there, and doesn't import it either.

This was the right shape for a prototype. It stops scaling once several people add features at the same time, which is happening now.

## Target

```
pipeline (Python, unchanged) ──► data/vrigstad.json (imported, so it's inlined in single-file builds)
                                        │
src/
  world/      shared: heightfield, terrain, roads, buildings, water, trees,
              spatial queries (nearestRoad, inWater, collide)
  game/
    sim/      pure TS game state + rules: player, vehicles, traffic, police,
              wanted level, pedestrians. step(state, input, dt). No three.js, no DOM.
    render/   three.js scene and the game's ground texture; syncs meshes
              from sim state each frame
    input/    keyboard, touch, gamepad ──► intents and commands
    audio/    reacts to sim events
    loop.ts   fixed-timestep sim, interpolated render
    store.svelte.ts   HUD state the UI reads
  ui/         Svelte components: HUD, intro, menus, touch controls
  map/        map page: world/ + its own ground texture + orbit camera
              + Svelte legend
tests/
  unit/       Vitest, against world/ and game/sim/
  e2e/        Playwright smoke tests against the built pages
```

### Data flow in the game

```
 Input devices ──► input/ ──► intents, commands
                                   │
                                   ▼
               ┌──────── sim.step(state, input, dt) ────────┐  fixed 60 Hz
               │  state: plain objects     events: caught,  │
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
- **Events, not calls, between sim, render, UI and audio.** The sim says "a star was added"; the UI shows a toast, audio plays a siren, render flashes the lights. New features plug in without editing the sim.

### Commands in, events out

The direction the boundaries above add up to: a small, deterministic sim core with two doors. **Commands** go in, **events** come out, and everything else is a client of those two: input, UI, audio, render, the network, dev tools and tests.

```
 keys, touch, gamepad ─┐                                  ┌─► audio, HUD, render
 the console, panels  ─┼─► commands ─► sim.step ─► events ┼─► the Log, achievements, stats
 links, scripts, tests ┤    (hooks: Log,                  └─► the network (#1)
 the network (#1)     ─┘     Record for replays)
```

- **A command is a named thing that can happen**: `enter`, `buy trisslott`, `stars 3`, and `tune set vehicle.volvo.top-speed 45` (#357). Players, dev tools and tests all go through the same registry (`docs/console.md`, which follows a few commands through it, #354), with access (`player` or `dev`) and the source on each call. A command only calls its module's rule. Player actions move there in #366.
- **Input still becomes intents** (rule 3): what is held every frame (`throttle`, `steer`, `brake`) stays an intent, and what happens once (pressing E to get into a car) becomes a command. Today a command runs between frames; once the sim steps on a fixed timestep (#49), a command that changes sim state queues an intent for the next step (#361).
- **An event is a named thing that happened**, in the past tense: `caught`, `star-added`, `knocked-over`. One typed bus in sim code delivers them after the step that raised them (after the frame, until #49), so a listener never changes that step. A listener gets its own off switch, like the console's hooks. The bus comes in #367.
- **A feature is a plugin**: its commands, its event listeners, its hooks and its panel, installed and taken out as one. Cats, pets, the trisslott and lab experiments (#323) fit that shape; so would mods, later, without a new design.
- **Content is a registry**: places, cars and shop items are lists that commands read (a `choice` argument). A new place then completes in the console and works with `go`, without wiring of its own.
- **Overlays are panels** in one host, the console's (`docs/console.md`, "Panels and plugins"), so the kiosk and cat menus and a future phone ask one owner for the cursor (#335).

Why: once #49 and #361 land, replays and multiplayer need only the commands in, each stamped with its step, and a deterministic step (the seeded `rnd()` of rule 5). Key remapping and accessibility become another mapping. A tutorial waits for a command, and a test runs one. A new reaction to something (a siren, a line, an achievement) is a listener, not an edit to the module where it happens.

This is a direction, not a rewrite: code moves when it is touched for another reason, or in the tickets above.

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
| Wiki | SvelteKit, mdsvex, fully prerendered | `wiki/`; #375 |
| Deploy | GitHub Actions ──► Pages | #45 |
| Data pipeline | Python stdlib | unchanged; #60 for later options |

## Decisions

Short records so settled questions stay settled. Add one when you make a choice someone might reasonably question later.

- **Stay on three.js; no game engine.** Phaser is 2D. Babylon.js, PlayCanvas and Godot were considered; see #58 for the trade-offs and when to revisit.
- **Svelte for DOM UI, not for the scene.** Declarative scene graphs (Threlte) don't suit a hot game loop. They might suit the map viewer.
- **Supersedes #23's npm-free approach.** The module split in #23 still applies; the concatenating Python build doesn't. The project chose to grow, and types, tests and a UI layer need a bundler.
- **Still ships as one `index.html`, for now.** `vite-plugin-singlefile` inlines the scripts, styles and images per page, so the game stays a single HTML file. The fonts stay files beside it, so a browser downloads only the weights a page draws with (`vite.config.ts`), and so do the models in `media/`. Switch to normal multi-file output when models and audio make caching worth it (see #44).
- **Modes are state machines.** Player, wanted level, police AI and app flow become explicit typed state machines in `sim/`, hand-rolled first, with XState only if quests need more (#63).
- **World meshes are returned, never added to a scene.** Each `src/world/mesh/` builder is a class that hands back its `Object3D`s and frees what it made in `dispose()`; the page adds them. So the game keeps `scene.add(...)`, and the map can mount the same objects in Threlte (#118). Each page passes its look (materials, colours, details) as options and callbacks.
- **HUD stays DOM; in-world UI uses canvas textures.** HTML-in-canvas (#56) replaces the canvas textures once browsers support it.
- **No physics engine yet.** Collisions are hand-rolled. Rapier is the candidate when crashes (#40) need more (#54).
- **One command registry, and modules own their commands (#218).** `src/game/commands.ts` is sim code; the console box is page code over it. A command reads typed arguments and calls its module's API; logging, access, recording and multiplayer go in hooks around every run, not in the commands. See [docs/console.md](docs/console.md).
- **Lab experiments are written where their code belongs, off by default (#227, #323).** An experiment's code goes where it would live once it graduates (a module in `src/game/` or `src/game/sim/`, `src/game/render/`, `src/world/`, or a page module), in its own files where possible, so the architecture checks apply from its first commit. In `src/lab/`, the ragdolls (#253) met those checks only when they graduated, and splitting their rules from their drawing then was most of the work. `src/lab/flags.ts` lists the experiments, each with an English name and what it costs; `?lab=<id>,<id>` switches them on, and later the settings menu (#78) and the console (#218) set the same flags. The game reads them once, at page load, so a change there takes a reload until experiments can start and stop while it runs. Gameplay asks the flags, never the URL. The flags are page code, which sim and render code can't import, so each gate is a `lab.on('<id>')` check where page code wires the experiment in, and sim and render code get it as a constant or a callback when they're built. An experiment may change the rules, but only behind its flag. Its code is loaded with a dynamic `import()` behind the check, so with the flag off it doesn't run; while the page is built as one file it still ships in that file, and with multi-file output it becomes its own chunk. It's imported statically only when it must apply before the page draws, such as a font. Graduating deletes its entry and turns each gate into ordinary wiring; dropping one deletes its files too.
- **No ECS yet.** Plain arrays per entity kind; revisit with miniplex when entity kinds multiply (#55).

## Coordinates and data

Metres; origin 57.3555° N, 14.4756° E; x east, z south, y up; the world spans −1100..1100 on x and z.

`data/vrigstad.json`:

| Key | Content |
|---|---|
| `size`, `n` | World side in metres (2200) and elevation grid size (89 × 89, 25 m spacing) |
| `elev` | Row-major heights in **decimetres** |
| `b` | Buildings: `p` flat `[x, z, x, z, ...]` footprint, `h` height (guessed), `k` kind |
| `r` | Roads: `c` class, `n` street name, `p` polyline; optional `i` OSM way id, `j` piece number when clipping split the way, `s` service/footway use, `sf` surface, `w` width, `lt` lit (1 yes, 2 no), and per side [left, right] of the way's own direction: `sw` sidewalk state, `sww` width, `ssf` surface, `pk` street parking, `po` its orientation |
| `w` | Water polygons |
| `ww` | Waterways: `k` kind, `p` polyline |
| `l` | Land use: `k` class, `p` polygon |
| `labels` | Named places: `t` text, `x`, `z`, `k` kind |
| `pa` | Parking areas on the ground: `i` OSM id, `p` outline, `h` holes, `sf` surface, `k` kind, `cap` capacity (optional key) |
| `ps` | Parking spaces mapped as polygons: `i`, `p` (optional key) |
| `x` | Crossing nodes: `i`, `x`, `z`, `k` kind, `kb` kerb, `r`/`v` the road and vertex it sits on (optional key) |
| `kb` | Kerb nodes that are not crossings: `i`, `x`, `z`, `kb` (optional key) |
| `t` | Mapped trees, flat `[x, z, ...]`, tree rows sampled every 8 m (optional key) |
| `fu` | Mapped street furniture: `i` OSM id, `k` kind (`FurnitureCode`: street lamp, bench, waste basket, bus stop), `x`, `z`, `d` a bench's `direction` in degrees from north (optional key); bus stops are context only, never drawn |

Class codes are assigned in `tools/process.py`; `src/world/data.ts` types the file and names them (`RoadClass`, `LandUse`, `BuildingKind`, `WaterwayKind`, and the streetscape's `RoadUse`, `SideState`, `Surface`, `StreetParking`, `ParkingOrientation`, `ParkingKind`, `CrossingKind`, `Kerb`, and `FurnitureCode`). Change both together. Raw OSM tags never reach the JSON: everything is reduced to these codes, and 0 always means "not mapped".
