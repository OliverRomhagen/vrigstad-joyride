# Complete Blender vehicle fleet

Select the parked Torget car with `?vehicle=volvo240`, `saab900`, `xc70`,
`xc70-police`, `impala1970`, `micra-k11` or `duett-epa`. Start and use the
normal movement/E controls. The HUD uses the model name. Without a query,
parked cars and traffic pick a model for their type from `VEHICLE_VARIANTS`:
a Volvo is a Volvo 240 or an Impala, a Saab a Saab 900, XC70 or Micra, an EPA
a Duett and police a police XC70. The pick uses its own seeded stream, so the
original traffic distribution and the rest of the world's rolls are unchanged.
The tractor stays procedural. Unknown IDs use the default Volvo 240 at Torget.
Models do not define dynamics: mappings reuse
Volvo/Saab/passenger-car, police and EPA simulation. They are not calibrated
real-world handling specifications. No experimental drivetrain is included.

## Registry and lifecycle

`src/game/render/vehicle-registry.ts` declares stable IDs, names, paths, archetypes,
wheel radius/base and default archetype mappings. Register a new model there and
provide its GLB under `src/public/media/vehicles`. All exports use metres, +Y up,
-Z forward and the shared body/wheel node names. Immutable provenance lives below.
`npm test` checks all real files through Three's GLTFLoader and validates
wheel locations and plausible bounds.

`VehicleVisuals` owns rendering state independently from simulation. Call
`attach(car,id,fallback,color)` after adding a car, `sync(car)` after positioning it,
`update(focus,dt)` once per frame and `dispose(car)` on removal. `addCar` accepts
an optional sixth asset-ID argument overriding the variant pick.
Names and short Swedish spoken names are read through `vehicleVisuals.definition(car)`;
they are not stored on simulation car objects. No new input or physics rules are introduced.

Loading is lazy inside the 120 m/8 desktop or 3 coarse-device detail budget.
Templates and geometry/materials are cached and shared; instance transforms are
cloned. Civilian bodies receive the same single seeded colour choice as their
procedural fallback after asynchronous loading; police livery is preserved.
`paint(car,color)` clones only that
instance's civilian body materials; police livery is protected. Owned material
clones are disposed with the visual; shared cached resources live for the page.
Failures are reported as `failed`, retain the procedural fallback and never
pretend the detailed asset loaded. Failed instances do not occupy detail slots.
Removed cars ignore pending asynchronous work.

Wheel travel derives from rendered movement, using -Z forward and metre units;
front steering derives from heading/distance and verified wheelbase. Teleports
larger than 20 m do not spin wheels. Police beacons use existing emissive meshes;
no point lights/shadows are added for them. On desktop, only a model's body, its
tyres and parts with at least 1 m² of surface cast shadows (#405): the merged
bumpers and trim do, lamps, grilles, rims, beacons and glass don't. Coarse detailed
meshes do not cast additional shadows. The read-only game hook exposes the selected car's actual
loading/fallback/detail and wheel state for tests.

## Sources and regeneration

All models: Axel Tidehorn, CC BY 4.0. Original generators: MIT, explicitly
authorized by the author. See LICENSE. No photographs or third-party car meshes
are embedded. Reference images/manufacturer documents keep their original terms;
they are not included in this contribution. No manufacturer endorsement is implied.

Immutable sources in `https://github.com/AxelTidehorn/vrigstad-joyride/tree/<SHA>`:

| Models | Source revision | Editable master | Generator |
| --- | --- | --- | --- |
| Volvo 240 | 79779a5f4b9a17d29ede88df67d2205d7b8366b2 | experiments/volvo240/refinement/model.blend | experiments/volvo240/model.py, refine_forms.py, round2.py, round3.py |
| Saab 900 | 6f8cbaf874a2c60823047cd7ded66e877aa07c7d | experiments/saab900/build/model.blend | experiments/saab900/model.py, round2.py, round3.py |
| Both XC70s | 5fe819de4e4d0500eb7f7fdac7c1fc000b12d193 | experiments/xc70p2/redraw/model.blend | experiments/xc70p2/redraw.py, shell.py, simplify.py, variants.py |
| Impala | 46fa31e9094ab6e1e30f2b542de83383f85fb7c7 | experiments/impala1970/build/model.blend | experiments/impala1970/model.py |
| Micra | 5c84a173f3bbd8206f067ec18594cecdaf5476b5 | experiments/micra1995/build/model.blend | experiments/micra1995/model.py |
| Duett | 2be04e605ad20f9ffc5dbe097a493bd6a3991e6f | experiments/duettp210/build/model.blend | experiments/duettp210/model.py |

Download the pinned source tree; do not regenerate from an earlier blockout.
The source experiment READMEs document external Blender Modeler helpers and
source generation. Existing editable masters can be exported with Blender's
GLB exporter: metres, Y-up, apply modifiers, visible objects only, preserve node
names and wheel hub pivots. XC70 variants share one master; `variants.py` changes
paint/equipment visibility rather than authoring a second body. Source geometry
must pass the original experiment's topology/pose gates before replacing an export.
Blender 4.3.2 authored the original exports; the Volvo 240's and the Saab 900's round 3
were edited and exported with Blender 5.3 (`experiments/volvo240/refinement/round3/README.md`,
`experiments/saab900/round3/README.md`), and both XC70s were redrawn from a multi-view drawing
with it (`experiments/xc70p2/redraw/README.md`).
Delivered GLBs are meshopt-compressed derivatives, not byte-identical copies. Re-export bytes can vary by version.

Measured full-model bounds (including trim), metres, X width × Y height × Z length:
240 1.830×1.433×4.820; Saab 1.750×1.420×4.688; XC70 2.009×1.547×4.720;
police 2.009×1.740×4.905 (with its bull bar); Impala 2.210×1.397×5.486;
Micra 1.790×1.430×3.698; Duett 1.680×1.750×4.100.
Hub wheelbases are 2.650, 2.517, 2.763, 2.763, 3.0226, 2.360 and 2.600 m.

## Compression

`gltfpack` is pinned to 1.3.0 in the dev dependencies. The runtime uses the
MeshoptDecoder already shipped with Three.js; no new runtime package is needed.
Prepare a separate directory containing the original pinned exports under the
filenames below, then run:

```sh
npm ci
npm run compress:vehicles -- /path/to/original-exports
npm test
npm run build
```

Before compressing, the script merges each export's static parts into one mesh per
material (`tools/vehicle-parts.ts`, #408): a mesh is a draw call, and most models
arrive as dozens of small parts that never move on their own. Only the body's own
children merge, into the body's space, so they still ride the suspension. Kept as
they are: the body (painted), `glass_*` (cracked), `body_*` (painted with the body),
the police beacons `lamp_blue_module*` and `lamp_police_grille*` (flashing), the
wheels and everything under them (spinning), and any part with attributes other than
position and normal. Merged parts are named `parts_<material>`. A model with nothing
left to merge, such as the Volvo 240 and Saab 900 (merged in their masters), passes through
unchanged. A Vitest asset test fails if a delivered model's body carries two static
parts of one material.

Then it runs `gltfpack -c -kn -km`, retaining named nodes and materials. Five models
keep `-noq`, without simplification or quantization. The two XC70 redraws use
`-si 0.5 -se 0.0005 -slb -vp 16 -vn 10 -vpf`: a half-triangle target bounded by
0.05% geometric error, locked border vertices, 16-bit position precision in float
attributes and 10-bit normals. Float positions preserve the named mesh hierarchy.
The editable masters and source pins remain unchanged. Both delivered XC70s stay
under 300 kB and 36,000 rendered triangles (wheel instances included); asset tests
check those budgets and the registry length against full-model bounds within 5 mm.
The redraws fall from 58,530 to 33,930 rendered triangles (civilian) and 59,826 to
35,120 (police), with draw calls unchanged at 26 and 32. Source reports of about
23,000 triangles count unique geometry rather than all rendered wheel instances.
Always start from the originals, never an already compressed derivative. The
loader and both Vitest asset/controller loaders configure MeshoptDecoder explicitly.
Normal startup keeps the procedural fallback if decoding fails.

| Delivery file | Original export in pinned source tree | Original bytes | Compressed bytes | Draw calls |
| --- | --- | ---: | ---: | ---: |
| volvo240.glb | experiments/volvo240/refinement/review-only.glb | 372772 | 183840 | 17 |
| saab900-t16.glb | experiments/saab900/build/saab900-t16.glb | 496088 | 242100 | 21 |
| xc70-civilian.glb | experiments/xc70p2/redraw/xc70-civilian.glb | 1593056 | 265096 | 26 |
| xc70-police.glb | experiments/xc70p2/redraw/xc70-police.glb | 1647056 | 281704 | 32 |
| impala1970.glb | experiments/impala1970/build/impala1970-hardtop.glb | 715264 | 374372 | 25 |
| micra-k11.glb | media/vehicles/micra-k11.glb | 369336 | 218028 | 15 |
| duett-p210-epa.glb | media/vehicles/duett-p210-epa.glb | 270612 | 148424 | 19 |

Total: 5,464,184 to 1,713,564 bytes (68.6% smaller). Draw calls per model are
its meshes as three.js draws them, wheels included. Before the merge they were
31 (the 240's round 2), 39 (the Saab's round 2), 82, 100 (the redrawn XC70s), 27, 24 and 25, in the
table's order: 173 fewer for all seven.
The Saab source README counts 13 unique
meshes as draw calls; the wheel nodes reuse meshes, so three.js draws 21. Its
4.688 m delivery length includes the satin-alloy trim at z ±2.344 m; the source
README's 4.66 m nose measurement uses a different extent. The registry uses the
full delivered length for the body hitbox.

For the unsimplified deliveries, local original-vs-decoded comparisons verified
all named model nodes, triangle positions to 0.01 mm, material
colours/emissive/roughness/metalness/opacity within
1e-6, transparency/sidedness, and wheel hub positions within 1e-6 m. The merge was
checked the same way against the previous deliveries: the same triangles per
material in world space to 0.01 mm, the same normal at every vertex, and the body
and wheel hubs unmoved. Generated primitive mesh names may change; authored nodes
and material names are retained, except the merged parts' names.
The simplified XC70 deliveries keep all four wheel hub positions and five police
beacons; full-model dimensions change by less than 0.03 mm. Before/after isolated
asset renders were inspected from the front, side and rear at 800 × 600. This is
geometric and screenshot verification, not physical-phone performance or final
human silhouette/livery approval.

Uniform inherited wheel scales are supported; bake nonuniform ancestor scales
in Blender before export.

## Delivery and checks

Vite copies the only tracked GLBs from `src/public` to `dist/media/vehicles`.
Relative URLs work under a GitHub Pages project/preview prefix. #167 has landed:
the built HTML files are no longer tracked, and E2E serves `dist` directly.
The fleet's Pages workflow publishes root teaser media followed by the entire
`dist` tree, so production and preview both ship the Vite public assets.
There is no root GLB compatibility copy, second tracked model directory or root HTML.

Run `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`.
The production build, actual asset parsing, gameplay/fallback and WebGL checks
are automated; images are review artifacts, never pixel-diff tests.
The upstream preview workflow requires a branch in the upstream repository.
Optional manual CI dispatch is carried in a separate branch above the fleet feature;
its base contains the feature tests. Vehicle checks now run through the ordinary
Vitest unit workflow; there is no separate `test:vehicles` runner.
Source parsing and visual-controller regressions run in Vitest; E2E keeps game
load/enter/drive coverage and failed-asset fallback, without patching game source.
The existing assertions have been migrated to `tests/unit/vehicles/` after #164.
The controller is a class, following the current lifecycle-owner convention.

## Visual verification limits

Visible model attribution and `media/vehicles/NOTICE.txt` accompany the production
and preview assets.

Geometric parsing is not reference approval. The Saab round 3 was checked against
the brochure side drawing scaled to its 2.517 m wheelbase and the photographs listed
in the pinned source, as recorded in `experiments/saab900/round3/README.md`. The
round-2 silhouette IoU does not verify the replacement geometry. Protected Volvo
arch checks and shared XC70 export/pose checks remain in their pinned sources. Impala and Micra
sources retain their source-specific reference/refinement evidence but explicitly
say human approval is pending. Duett final-pass measurements use wheel-anchored
photographs and perspective estimates, not a completed full silhouette IoU or
factory surface accuracy. All original reference registers/review reports remain
available in the pinned trees. This integration makes no new real-world visual
approval claim. Physical mobile/Safari performance, final silhouette/livery
approval and traffic placement decisions remain for human review.

The body hitbox reads the delivered length and specification width from the
vehicle registry; it is a capsule rather than an exact match to the body surface.
Wheels and `rearAxle` are measured from the model's origin, which is not always the
middle of its length: `bodyAhead` moves the hitbox to the middle (the civilian XC70
0.058 m back, the police XC70 0.035 m forward for its bull bar, the Duett 0.258 m back).
An asset test checks both the delivered length and that centre within 5 mm.
Physics/collision calibration remains a separate gameplay decision.
