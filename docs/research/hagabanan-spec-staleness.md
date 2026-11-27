# Which parts of the Hagabanan spec are stale on today's main?

Research for [#621](https://github.com/OliverRomhagen/vrigstad-joyride/issues/621), checking [#117 "Drive cross at Hagabanan"](https://github.com/OliverRomhagen/vrigstad-joyride/issues/117).

- The spec was verified at `9ed6332` (20 Nov 2026). This compares it with `origin/main` at **`5fa9500`** (27 Nov 2026), 83 commits later.
- Every `file:line` below is on `5fa9500` unless it says otherwise.
- Sources: the code itself, `git log 9ed6332..5fa9500`, `data/raw/osm.json` and `data/vrigstad.json` read with Python, and `gh issue view` for issue states. No game code was changed.

## Answer in short

The world is still the same centred 2200 m square, built from the same raw data, so **the OSM and terrain facts in §1 still hold**, and so does the core of part 1 (`size`/`n` → bounds). What is stale is **where the code lives** and **how many places read the square**. Most of that comes from the module split (#310, #312), rivers and bridges (#374, #378), Skroten (#346, #390), street furniture (#303), the tunables registry (#371) and standing on cars (#452).

The changes that matter most for the PRs:

1. **`src/game/main.ts` is no longer `@ts-nocheck`.** Only `src/map/main.ts` is. So typecheck finds a removed `size`/`n` in the game. The `S`/`HALF` locals still have to be found with grep.
2. **The square has about 8 new readers since 9ed6332:**
   - the cut grid inside `Heightfield` (`(samples − 1)²`), and the UVs in `TerrainMesh`;
   - `WaterBodies.onWorldEdge`;
   - the furniture placer's `halfSizeM`;
   - `GameLoop.half`;
   - `addTrees(…, HALF)`;
   - the map's `?focus` check and contour drawing;
   - a smoke-test bound, "6 × 6 cells";
   - unit-test fixtures with `half = 1100`.
3. **`groundAt` is no longer a plain max.** It is `floorAt` (Skroten), which *replaces* the ground. If there is no floor, it is `roads.groundAt`, where a bridge `deckAt` *replaces* the terrain. Only then does it take the max with the streetscape. The track has to join that max step, after both replacing steps.
4. **Driving numbers belong in the tunables registry** (`DRIVING` + `src/game/sim/car-tunables.ts`), not in loose constants. The speed cap is `topSpeedOf(c) × T.off`, not `T.max × T.off`. Grip is `DRIVING.GRIP × gripShare(c.mods)` at `cars.ts:498`.
5. **Standing on cars (#452) and airtime meet.**
   - `carTopAt` and the player's `floor` are measured from the ground under the car.
   - The car's blob shadow is a child of its mesh.
   - The chase camera follows `groundAt` plus the player's `floor`/`y`.

   All of these would need the car's `air`.
6. **A raceway that stays class 3 does more harm than §1 says.** On top of traffic, ribbons and full speed:
   - `Fleet.parkOne` parks cars on class 2 and 3 roads;
   - the streetscape treats class ≤ 3 as carriageway, with kerbs and parking;
   - bridges and water channels treat it as a street.
7. **Re-fetching `data/raw/` brings in more than Hagabanan.**
   - `fetch.sh` gained six node queries for street furniture (#303) since `osm.json` was last fetched (12 and 20 Nov).
   - The bbox appears **22 times** in it.

   So a refresh also adds street lamps, cabinets and other furniture nodes all over the village.
8. Small things:
   - The test hook moved to `src/game/test-hook.ts`.
   - `crash()` moved to `src/game/crashes.ts`.
   - `localStorage` can't be used in a sim module. That is `tsconfig.sim.json`, and it affects `laps.ts`.
   - #280, #238, #263, #297 and #177 are closed.

## Table: §1 "Verified state"

| # | Claim in #117 | Status | Evidence on `5fa9500` | What the spec should say instead |
|---|---|---|---|---|
| 1.1 | OSM: way 57870791 `sports_centre`, 88 nodes, x 1144–1686, z 292–657 | **still true** | `data/raw/osm.json`: 88 nodes, x 1144–1686, z 292–657. The file last changed at `1ce111c` (20 Nov), which is an ancestor of `9ed6332`. | — |
| 1.2 | Way 57870408 `raceway`, 71 nodes, x 1151–1375, z 310–610 | **still true (data unchanged)**. One nit: projected with `process.py`'s constants it is z **312–614**. | same file; node 3 == the last node (`True`) | Say z 312–614, or say how the numbers were projected. |
| 1.3 | Åkarevägen, way 57834348, `highway=track`, (939, 483) → (1232, 478) | **still true** | 6 nodes, x 939–1232. It is in `vrigstad.json` up to the clip at x 1100, as class 4. | — |
| 1.4 | Closed loop 1725 m + 98 m spur; never crosses itself; close sections at 2.6 m; no buildings mapped inside | **still true**, since the raw data is unchanged since before 9ed6332 | `git log 9ed6332..5fa9500 -- data/raw/` is empty | — |
| 1.5 | "Overpass base 2026-11-12" (intro) | **wrong already at 9ed6332** | `osm.json` `osm3s.timestamp_osm_base` = `2026-11-19T00:07:47Z`, at both commits | Base 2026-11-19 (refetched in #237, `1ce111c`). |
| 1.6 | Heights: 223.8–236 m, `Heightfield` measures from the lowest sample | **still true**. `Heightfield` now also takes an optional `cut` (river channels, #374). | `src/world/heightfield.ts:62-83` (`minDm`), `:14-29` (`TerrainCut`) | Add: the game builds two heightfields, `baseGround = new Heightfield(D)` and `heightfield = new Heightfield(D, { cut: waterBodies })` (`src/game/main.ts:103-104`). Both read `size`/`n`. |
| 1.7 | Elevation tile `terrarium/12/2212/1247` reaches x ≈ 1582 | **still true** | `tools/fetch.sh:34`; the tile's east edge, lon 14.5020, is x ≈ 1585 | — |
| 1.8 | `process.py`: `S = 2200`, `N = 89`, clip at ±1100 | **still true**; the lines moved | `tools/process.py:5-7` (`S`, `HALF`, `N`), `:96` `inside`, `:100` `clip_poly`, `:120` `clip_seg`, `:137` `clip_line`, `:625` `out = {'size': S, 'n': N, …}` | Also clipped by `inside()` now: street-furniture nodes (`:376-378`, `:440`, `:475`) and the building-centroid assert (`:518-520`). The four-bounds change has to cover these too. |
| 1.9 | `fetch.sh` east lon 14.4956 (x ≈ 1200); whole ways come back | **still true, but bigger** | `tools/fetch.sh:8-29`: **22** query lines, each with `(57.3455,14.4556,57.3655,14.4956)`. The 6 lines added in #303 (`street_lamp`, `bench`, `waste_basket`, `bus_stop`, `picnic_table`, `street_cabinet`) are **not in** today's `osm.json` (0 `street_lamp`, 0 `street_cabinet`). | Change the bbox in all 22 lines, or pull it into one variable. Say that a refresh also brings in the furniture nodes the queries gained since the last fetch, across the whole village. That is a bigger data diff, and the furniture placer will place things differently. |
| 1.10 | The whole track is outside the playable square | **still true** | `data/vrigstad.json`: `size` 2200, `n` 89 | — |
| 1.11 | "What assumes a centred square" (the list) | **stale: incomplete, and every location moved** | see the next table | Replace it with the full list below. |
| 1.12 | `process.py` maps `raceway` to `RoadClass.SERVICE` | **still true**; the effects are wider than stated | `tools/process.py:396-398` (`'raceway': 3`); `src/world/data.ts:151` (`SERVICE: 3`) | A class-3 raceway would also: get **parked cars**, since `Fleet.parkOne` takes `r.c === 2 \|\| 3` (`src/game/cars.ts:295`); count as carriageway for the streetscape, with kerbs and parking (`src/world/streetscape-rules.ts:298`, `src/world/streetscape.ts:215`); become a `road-slab` bridge if it crossed water (`src/world/bridges.ts:78`); and be kept as a street by the water channels (`src/world/water-shapes.ts:452`). So §2.3 matters even more. |
| 1.13 | `drive()` counts road by `nearestRoad(…).d < 0.6` | **still true** | `src/game/cars.ts:438` | — |
| 1.14 | Cars have no vertical state; `Car` is x / z / heading | **still true** (no `y`/`vy` on `Car`). `Car` has many more fields now. | `src/game/cars.ts:70-102` | `Car` now also carries `mods`, `owned`, `saleKr`, `limiterOff`, `color` and others; `newCar` is at `:105`. |
| 1.15 | Mesh at `groundAt`, minus 0.55 m in water | **still true; moved** | `src/game/render/car-meshes.ts:58` (`CarMeshes.placeCar`) | Point at `render/car-meshes.ts`. |
| 1.16 | #222's body motion "only tilts the body" | **inaccurate (then and now)** | `src/game/render/body-motion.ts:103` sets `node.position.y = heave`, and `:63` reads the ride height from `mesh.position.y` | It rolls, pitches **and heaves**, and it reads the ride height from the mesh. So adding `air` to the mesh's y would feed the springs unless body motion is paused, as §6.2 says. |
| 1.17 | Player on foot: `y` / `vy`, `GRAVITY_MS2 = 16` in `player.ts` (`hop`) | **still true, with more**: `PlayerState` gained `floor` (#452) | `src/game/player.ts:16`, `:33-36`, `hop` at `:121` | The player also has `floor`, the height of a car's top they stand on (`standOn` `:160`, `carTopAt` `:147`, `carry` `:227`). See "New on main" below. |
| 1.18 | Off-road: speed cap `T.max × T.off` | **stale formula** | `src/game/cars.ts:485-486`: `max = (c.wet ? 2.5 : top * (road ? 1 : c.T.off)) * (boost ? TURBO_TOP : 1) * topSpeedShare(c.dmg)`, with `top = topSpeedOf(c)` (`src/game/sim/upgrades.ts:39-42`: engine tune, EPA limiter switch) | Cap = `topSpeedOf(c) × T.off`. Dirt changes only the `road ? 1 : T.off` factor. |
| 1.19 | #299 gives the crosser `off = 0.95` | **#299 still open**; no bike in `VEHICLE_SPECS` | `gh issue view 299`: OPEN; `src/game/sim/vehicle-spec.ts` lists `off` 0.5, 0.5, 0.7, 1, 0.6… | Unchanged. |
| 1.20 | `treeSpots`: `roadClearanceM`, draws from `rnd()` | **still true**. The spec's "draws stay in the same order" needs care. | `src/world/trees.ts:21-40`: two draws per try, and a **third (scale) only for a kept spot** (`:35-36`) | An `exclude` that rejects a spot which would have been kept skips that spot's scale draw, and every later tree shifts. To keep the village's trees: draw the scale before testing `exclude`, or test `exclude` only after the draw. The map calls `treeSpots` without `roads` (`src/map/main.ts:253`), so its spots differ from the game's anyway. |
| 1.21 | Related: #238 adds `deckAt` to `groundAt` | **merged (#378), but inside `RoadNetwork.groundAt`**, not in the page's `groundAt` | `src/world/roads.ts:142-145` (a deck replaces the ground and returns first); `src/world/bridges.ts:224` | See §5 below. |
| 1.22 | Related: #280 moves the scene to `src/game/render/`, no PR yet | **done** (#310 `cd1f9d5`; #280 closed) | `src/game/render/ground-texture.ts`, `src/game/render/world-meshes.ts:33` `addTerrain` | Drop the conflict warning in §10. Part 1 edits `render/ground-texture.ts`, `render/world-meshes.ts` and `hud.ts`. |
| 1.23 | Related: #77 doesn't exist yet | **issue exists, not done** | #77 "Save progress locally" OPEN; `src/game/pause-menu.ts:2` keeps settings in `localStorage` until #77 | Say "saves (#77) aren't built yet". Follow `PauseMenu`'s injected-`storage` pattern (`src/game/main.ts:371-372`). |
| 1.24 | Related: #207 is cel shading | **merged** as the opt-in `?lab=toon` (`69818e3`) | `src/game/main.ts:166` `toon = lab.on('toon')`; `src/game/render/ink-edges.ts` | Ink for the track and club only applies under `?lab=toon`. |
| 1.25 | §4.3: ponds "with #263 they'd get its surface" | **#263 closed** (water look in #374) | `src/world/water-shapes.ts:204` `WaterBodies` (levels, shores, channel cut), `src/world/mesh/water-surface.ts` | A pond from the layout file only gets levels, shores and reeds if it is in `D.w` before `new WaterBodies(D, baseGround)` (`src/game/main.ts:103`, `src/map/main.ts`). Painting it is not enough. |

## Table: files, functions, fields and constants named in §2–§7

| § | Named in #117 | Status | Evidence on `5fa9500` | What the spec should say instead |
|---|---|---|---|---|
| 2.1 | `WorldData.size`, `.n` | **still there** | `src/world/data.ts:122-128` | — |
| 2.1 | "`main.ts` and `src/map/main.ts` are `@ts-nocheck`, so grep" | **stale** | only `src/map/main.ts:1` has `// @ts-nocheck`. `src/game/main.ts` is typed (`:85-91`). | Typecheck catches `D.size` in the game. Grep `src/map/main.ts` for `S`, `N`, `HALF`, and grep everywhere for `HALF` and `half`, which are locals and deps. |
| 2.1 | `tools/fetch.sh` 14.4956 → 14.5036 | still valid | see 1.9 | All 22 lines. |
| 2.2 | `Heightfield` `size` / `half` / `samples` / `sampleCoord` | **still there**; `size` and `half` are `private` | `src/world/heightfield.ts:50-52`, `:63-65`, `sampleCoord` `:128`, `heightAt` `:102-115` | Also square: `sampleHeight` (`:121`), `baseAt` (`:133`), `cutHeight` (`:144`), `applyCut` (`:172`), and the cut's `fineIndex` sized `(samples − 1)²` (`:80`), indexed `j * (n − 1) + i`. `cellDetail`/`fineHeight` (`:86-95`) take cell indices that need `nx`/`nz`. `TerrainCut.detail()` gets square cells. |
| 2.2 | `TerrainMesh` (n × n, skirt walks the edges) | **still there, more involved** | `src/world/mesh/terrain.ts:25-190`. The square comes from `half = at(n − 1)`, `size = 2 * half` (`:35-36`). It now also builds **refined blocks** (`refined[]`, `BLOCK_CELLS`) where the cut refines cells, and computes **UVs from world x/z** with `(x + half) / size` (`:86-87`). The skirt splits per refined cell (`:113-`). | The `nx × nz` change also covers the refined blocks, the UVs (which map x and z onto the ground texture separately, so the texture becomes non-square), and the skirt's refined steps. |
| 2.2 | Ground canvas in both pages: `K = CW / S`, `P = v => (v + HALF) * K` | **moved (game)**, unchanged (map) | game: `src/game/render/ground-texture.ts:36-43` (`S`, `CW`, `K`, a square canvas), `:185` `P`, `:186-190` `trace`, `:212-221` `bakeTreeShadows`. Map: `src/map/main.ts:130-136`. | Also in the map: `contours()` uses `S / (N − 1) * K` and `N` (`src/map/main.ts:143-148`). |
| 2.2 | HUD minimap `P`, `K` | **moved into `Hud` deps** | `src/game/hud.ts:17-19` (`ground`, `P`, `K`), `drawMini` `:157`. Wired at `src/game/main.ts:391`. | `drawMini` also draws `paintBridgeRoads` in world metres (`:158-161`), which needs no change. |
| 2.2 | `walk(…, HALF)` | **still there; called from `GameLoop`** | `src/game/player.ts:89-107` (`half`, `EDGE_M = 2` at `:23`); the call is at `src/game/loop.ts:183-194` with `g.half` (`:32`), passed `half: HALF` at `src/game/main.ts:419` | Add `GameLoop`'s `half` dep. |
| 2.2 | `Fleet` (`half`) | **still there; more readers** | `FleetDeps.half` `src/game/cars.ts:170`; `parkOne` `:291`, `:307`; `drive` `:428`, `:522-523` (clamp) | — |
| 2.2 | `CatColony` (`half`) | **still there** | `src/game/cats.ts:196`, `:457` / `:486-487`, `:674` / `:816-817` | — |
| 2.2 | Tree cells `(v + HALF) / TREE_CELL_M` | **moved** | `src/game/render/world-meshes.ts:685-732` `addTrees(…, HALF)`, `TREE_CELL_M = 400`, `cellOf`. Cells go in a `Map<string>`, so a rectangle works as it is. Only the offset uses `HALF`. | Pass `x0`/`z0`, or drop the offset. Street furniture uses its own 400 m cells with no offset (`src/world/mesh/street-furniture.ts:213-233`). |
| 2.2 | `?at=` unchanged | **still true** | `src/game/main.ts:349-350`, no bounds check (`walk` clamps) | — |
| 2.2 | The map camera's bounds take the rectangle | **no such bounds** | `src/map/main.ts:66-87`: OrbitControls with target `(0, centerY, 0)`, `minDistance`/`maxDistance`, fixed `VIEW_OFFSET`/`TOP_OFFSET`. Nothing clamps a pan. | Drop that line. What does read `HALF` in the map is the **`?focus` check** (`src/map/main.ts:76-77`): a spot with \|x\| > HALF is a bad link. It needs the rectangle, or the wiki's place pages for Hagabanan get the plain overview. |
| 2.2 | Unit tests (Heightfield fixture, TerrainMesh, process.py clip) | still valid | fixtures build `{ size, n, elev }`: `tests/unit/world/fixture.ts:5`, `:28`; `tests/unit/world/streetscape.test.ts`; `tests/unit/world/data.test.ts:25` (`elev` length `n * n`); `tests/unit/tools/process.test.ts:270-271` (clip at 1100) | List these fixtures as changed sites too. |
| 2.3 | `process.py` writes raceway to `rc`, never to `r` | still valid, and more needed | see 1.12 | — |
| 4.1 | `data.ts` `RaceTrack`, `rc?` | new; no conflict | `WorldData` optional fields are now `pa`, `ps`, `x`, `kb`, `t`, `fu` (`src/world/data.ts:135-147`) | `rc` is still free. Add it the same way (`if rc: out['rc'] = …`, `tools/process.py:626-632`). |
| 4.2 | `src/world/race-track.ts`, `RaceTrackIndex(base: Pick<Heightfield,'heightAt'>)` | still valid | `tsconfig.sim.json` covers `src/world`, without DOM | — |
| 4.3 | `src/world/mesh/hagabanan-mesh.ts`, materials from the page, `dispose()` | still valid | `src/world/mesh/` convention, e.g. `terrain.ts`, `bridge-mesh.ts` | — |
| 4.3 | Ground paint: the club's area is grass | **already so** | `tools/process.py:401` `LEIS = {…'sports_centre': 3…}` (land class 3 = grass) | It is painted grass already once inside the bounds. Only gravel and verges are new. |
| 4.3 | `treeSpots` takes `exclude?` | still valid; see 1.20 for the draw order | `src/world/trees.ts:6-15` | — |
| 4.4 | `groundAt` = `max(roads.groundAt, street surface, track ?? −∞)` | **stale composition** | `src/game/main.ts:151-152`: `floorAt(x,z) ?? max(roads.groundAt(x,z), streetIndex.surfaceAt(x,z))`. `floorAt` (Skroten's workshop floor, `:165`) **replaces**, and `roads.groundAt` lets a bridge deck **replace** the terrain (`src/world/roads.ts:142-145`). | Add the track inside the max: `floorAt ?? max(roads.groundAt, street, track.surfaceAt ?? −∞)`. Say that floor and deck are replacing overrides, not raise-only overlays. |
| 4.4 | `drive()` takes `surfaceOf`; `DIRT_SHARE`, `DIRT_GRIP` | **needs the tunables registry** | AGENTS.md "Code style": driving numbers go in `DRIVING` + `src/game/sim/car-tunables.ts`; `DRIVING` is at `src/game/cars.ts:24-44` | Put `DIRT_SHARE` and `DIRT_GRIP` in `DRIVING` with registry entries (`driving.dirt-share`, `driving.dirt-grip`). Then `?tune=` and `tune set` reach them. |
| 4.4 | Grip "if `drive()` has no single grip number" | **there is one** | `src/game/cars.ts:498-503`: `full = DRIVING.GRIP * gripShare(c.mods)`. Lateral slip only exists for `canDrift` (the player): `:504-514`. Police and others have `vh = h`. | Scale `full` on dirt. The factor then changes only how the player slides; police don't slide. |
| 4.4 | Police drive off-road; traffic never enters | still true | police use `drive()`; traffic follows roads (`advance`) | But **parked cars** would appear on a class-3 raceway (`cars.ts:295`). |
| 4.4 | Hook `state().hagabanan` | **hook moved** | `src/game/test-hook.ts:70` `installTestHook`, `state()` at `:160-221`; subsystems report through helpers (`bridgeState()`, `waterState()`, `furnitureState()`) | Add a `hagabananState()` helper and a dep on `TestHookDeps` (`:18-67`). |
| 5 | #238 `deckAt` stays first; no bridge near Hagabanan | **true** | 6 bridges, all at x −507…101 (`vrigstad.json` `r[].br`) | `deckAt` sits in `RoadNetwork.groundAt`, not in the page. |
| 5 | Club buildings via `addFootprint`, like the kiosk | **better API now** | `src/world/buildings.ts:151` `addFootprint`, `:159` **`addSolid`** (collides, but isn't counted as a house by crowds and cats), `addBarrier`, `stopColliding`; kiosk at `src/game/main.ts:311`; Skroten uses `addSolid` (`:164`) | Real club buildings: `addFootprint`. The start gate, fences and the tvätthall's posts: `addSolid`. |
| 6.1 | `src/game/cars.ts` sim, `Car` gains `air`/`vy`/`airT`; `newCar` | still the place | `src/game/cars.ts:70-150`, no three.js (`:2`) | — |
| 6.1 | `FleetDeps` gains `groundAt`, `canLaunch` | **`FleetDeps` reshaped (#302)** | `src/game/cars.ts:166-186`: `roads` is now `Pick<RoadNetwork, 'lines' \| 'junctions' \| 'driveable' \| 'nearestRoad'>`, plus `canPark` and `rammed` | Still no `groundAt` in it. Add it as `Pick<…>`-style callbacks like `canPark`. |
| 6.1 | `crash(c, null, impact)` | **moved** | `FleetDeps.crash` (`cars.ts:183`), called at `:532` and `:556`; implemented in `src/game/crashes.ts:66` (`Crashes.crash`) | Same signature, new file. |
| 6.1 | `CAR_G_MS2`, `LAUNCH_MIN_MS`, `AIR_DRAG`, `AIR_STEER_SHARE`, `SOFT/HARD_LAND_MS` | **tunables rule** | AGENTS.md | Put them in `DRIVING` (or a new `AIR` object) with registry entries. |
| 6.1 | "all existing `cars.test.ts` cases unchanged" | valid | `tests/unit/game/cars.test.ts` | — |
| 6.2 | `placeCar` adds `air` | valid; moved | `src/game/render/car-meshes.ts:50-58` | — |
| 6.2 | The blob shadow stays on the ground | **needs work** | the blob is a **child of the car mesh** (`car-meshes.ts:33`, `:82`), so it rises with the mesh | Lower the blob by `air` inside the mesh, as cats do for theirs (`src/game/cats.ts:603`). |
| 6.2 | Dust puffs from the drift particles | valid | `src/game/render/drift-fx.ts` (`DriftFx`, at `groundAt`) | Smoke from a damaged car (`render/car-damage.ts`, `groundAt`) would also stay on the ground while the car flies. |
| 6.3 | Hook: `air`, `vy`, `airT` on the player's car | hook moved | `src/game/test-hook.ts:198` already has `carAt: {x, z, h}` | Add them next to `carAt`. |
| 7 | `src/game/laps.ts` plain data; best laps in `localStorage` | **conflicts with `tsconfig.sim.json`** | a new `src/game/*.ts` is sim by default, with no DOM lib (`tsconfig.sim.json`; AGENTS.md "page module") | Keep `laps.ts` pure. Inject storage the way `PauseMenu` gets `storage` (`src/game/main.ts:372`). The lap panel is a **page module**: list it in `fallow.toml` `page`, `biome.jsonc` and `tsconfig.sim.json` `exclude` (`tests/unit/zones.test.ts`). |
| 7 | HUD "`hud.ts` style" | valid | `src/game/hud.ts` (`class Hud`, DOM over the canvas); also `menu.ts`, `pause-menu.ts`, `kiosk-cat-menus.ts`, `prompt.ts` | Svelte is only in `wiki/` so far. |
| 7 | Smoke `__joyride.state().laps` | hook moved | `src/game/test-hook.ts` | One page load at 640 × 360 per test (AGENTS.md "Tests", #353). Fit the gate, drive and jump steps into one load. |
| 10 | Part 1 conflicts with #280; part 2 vs #177; part 3 rebases on #302 / #297 | **all merged or closed** | #280, #177, #297 closed; #302 merged (`7b3f7c7`) | Drop these ordering notes. |

## New readers of a centred square since 9ed6332

Each item names the change that added it:

| Reader | Where | Reads |
|---|---|---|
| River cut grid in `Heightfield` (#374) | `src/world/heightfield.ts:80`, `:133-160`, `:172-255` | `size`, `half`, `samples`, `(samples − 1)²` cells |
| `TerrainMesh` refined blocks and world-space UVs (#374) | `src/world/mesh/terrain.ts:35-36`, `:86-87` | `half = sampleCoord(n − 1)`, `size = 2 · half` |
| `WaterBodies.onWorldEdge` (#374) | `src/world/water-shapes.ts:208`, `:218`, `:521-527` | `data.size / 2` |
| Second `Heightfield` (`baseGround`) for water and bridges (#374, #378) | `src/game/main.ts:103-107` | `size`, `n` |
| Furniture placer edge keep (#303) | `src/world/furniture/placer.ts:253`, `:269`, `:464` | `data.size / 2` |
| `GameLoop.half` → `walk` (#312) | `src/game/loop.ts:32`, `:194`; `src/game/main.ts:419` | `HALF` |
| `addTrees(…, HALF)` (#310) | `src/game/render/world-meshes.ts:690`, `:732` | `HALF` |
| `GroundTexture` (#310) | `src/game/render/ground-texture.ts:36-43`, `:185` | `D.size`, a square canvas |
| Map `?focus` check (#485) | `src/map/main.ts:76-77` | `HALF` |
| Map contours | `src/map/main.ts:143-148` | `S`, `N` (also at 9ed6332, but not listed in #117) |
| Smoke test bound | `tests/e2e/smoke.spec.js:174` | "the 2200 m world spans 6 × 6 cells" |
| Unit fixtures | `tests/unit/game/player.test.ts:23`, `tests/unit/game/cats.test.ts:28` (`half = 1100`); `tests/unit/world/fixture.ts:5`, `:28`; `tests/unit/world/data.test.ts:25` | `half`, `size`, `n` |

Not readers, though they look like it: `bridges.ts`, `streetscape.ts` and `water-shapes.ts` `half` fields that are road or channel half-widths; street-furniture cells (`Math.floor(p.x / CELL_M)`, no offset); and `Fleet`/`CatColony` (already listed in #117).

## New on main that the spec should account for

- **Standing on cars (#452, `2d2a867`).**
  - The player has `floor` (`src/game/player.ts:30-36`), set by `standOn` (`:160`) from `carTopAt(c, x, z)` (`:147`). That is the car's `T.roofM`/`T.deckM` **above the ground under the car**.
  - `carry` (`:227`) moves you with the car. `loop.ts:242` places your mesh at `groundAt + lift`.
  - The camera rig eases after `floor` and `y` (`src/game/render/camera-rig.ts:61-72`).
  - With part 3, a player standing on an airborne car needs `floor` to include `air`. The spec should say whether you ride the jump or are thrown off. One option: an airborne car can't be stood on, and you fall to the ground.
  - Cats riding an EPA's flak use `groundAt` under the car (`src/game/cats.ts:595`) and need the same.
- **Chase camera and airtime.** `CameraRig.update` aims at `groundAt(T) + rise` (`camera-rig.ts:72`). A flying car would leave the camera's target on the ground. Pass the car's `air` the way the player's `floor`/`y` are passed.
- **Cockpit view (#474, `6860b07`, `?lab=cockpit`).** The camera rides the model's sprung `body` node (`src/game/render/cockpit.ts:88-101`, `:264`, `:294`). So it follows `air` once `placeCar` adds it. The pitch towards the velocity would tilt the driver's view too. Decide whether that is wanted, or whether the cockpit levels out.
- **Skroten (#346, #390).**
  - Its yard is wired through `floorAt` (`src/game/main.ts:151`, `:165`) and `addSolid`.
  - There is a minimap marker (`hud.ts`, `kind === 'skrot'`).
  - The fleet now has `saleKr` cars on a lot.

  None of this is near Hagabanan. But it is the model for "a place with its own floor and solids", and `floorAt` is the existing replacing override.
- **Tunables registry (#371, #381) and dev console (#354, #382, #394, #576, #582).** New numbers that affect driving go in the registry. The console's `go` command takes places from `src/game/places.ts:123-140`. A `go hagabanan` place (the start gate) would be cheap and useful for the smoke step and for players.
- **Lab experiments (#323, #500).** Each part could ship behind `?lab=hagabanan` first: the world growth can't, but the track, airtime and laps can. AGENTS.md "Lab experiments" says how. The spec doesn't say whether parts 2–4 are lab or straight to everyone.
- **Pause menu (#521).** Lap timing should stop while `game.paused` is set (`src/game/state.ts`).
- **Toon style (#207, `?lab=toon`).** House walls are banded by angle (#415), with board seams (#420) and window frames (#422). The klubbstuga ("red timber house") should reuse the house materials (`src/game/render/house-materials.ts`) rather than invent new ones.
- **Street furniture (#303, #306)** places lamps, benches and bins along the road network, by road context (`src/world/furniture/placer.ts`). It reads `data.size` for its edge keep (`:464`). A raceway left in `r` could get furniture rules applied, which is another reason it must not become a road. This wasn't traced rule by rule.

## Method

- `git fetch origin main`. Branch from `origin/main` (`5fa9500`). `git log 9ed6332..origin/main`: 83 commits.
- Grep `src/`, `tests/` and `tools/` for `size`, `.n`, `HALF`, `half`, `S =`, `N =`, `K =`, `P =`, `TREE_CELL`, `1100` and `2200`. Then read each hit.
- Read `src/world/heightfield.ts`, `src/world/mesh/terrain.ts`, `src/game/render/ground-texture.ts`, `src/game/hud.ts`, `src/game/cars.ts` (`Car`, `FleetDeps`, `parkOne`, `drive`), `src/game/player.ts`, `src/game/loop.ts`, `src/game/main.ts` (`groundAt`, wiring), `src/map/main.ts`, `src/world/trees.ts`, `src/world/buildings.ts`, `src/game/test-hook.ts`, `tools/process.py` and `tools/fetch.sh`.
- Parse `data/raw/osm.json` and `data/vrigstad.json` with Python (`-I`), using `process.py`'s projection constants.
- Check issue states with `gh issue view`.
