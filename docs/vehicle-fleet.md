# Complete Blender vehicle fleet

Select the parked Torget car with `?vehicle=volvo240`, `saab900`, `xc70`,
`xc70-police`, `impala1970`, `micra-k11` or `duett-epa`. Start and use the
normal movement/E controls. The HUD uses the model name. Without a query,
parked cars and traffic use Volvo 240, Saab 900, Duett EPA
and police XC70 visuals by archetype. The tractor stays procedural. Unknown IDs
use the default Volvo 240 at Torget. Civilian XC70, Impala and Micra remain explicit
URL choices; the original traffic distribution is unchanged.
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
an optional sixth asset-ID argument overriding the default archetype mapping.
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
no point lights/shadows are added for them. Coarse detailed meshes do not cast
additional shadows. The read-only game hook exposes the selected car's actual
loading/fallback/detail and wheel state for tests.

## Sources and regeneration

All models: Axel Tidehorn, CC BY 4.0. Original generators: MIT, explicitly
authorized by the author. See LICENSE. No photographs or third-party car meshes
are embedded. Reference images/manufacturer documents keep their original terms;
they are not included in this contribution. No manufacturer endorsement is implied.

Immutable sources in `https://github.com/AxelTidehorn/vrigstad-joyride/tree/<SHA>`:

| Models | Source revision | Editable master | Generator |
| --- | --- | --- | --- |
| Volvo 240 | ff6a0f187add7bd9b7ba052f28bd0d67e534c33a | experiments/volvo240/refinement/model.blend | experiments/volvo240/model.py, refine_forms.py, round2.py |
| Saab 900 | same Round 2 revision | experiments/saab900/build/model.blend | experiments/saab900/model.py, round2.py |
| Both XC70s | same Round 2 revision | experiments/xc70p2/build/model.blend | experiments/xc70p2/model.py, round2.py, variants.py |
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
Blender 4.3.2 authored the original exports. Delivered GLBs are meshopt-compressed
derivatives, not byte-identical copies. Re-export bytes can vary by version.

Measured full-model bounds (including trim), metres, X width × Y height × Z length:
240 1.830×1.433×4.820; Saab 1.750×1.420×4.680; XC70 2.020×1.563×4.743;
police 2.020×1.745×4.743; Impala 2.210×1.397×5.486;
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

The script runs `gltfpack -c -kn -km -noq` for each public GLB: meshopt compression,
retained named nodes/materials, no mesh simplification or vertex quantization.
Always start from the originals, never an already compressed derivative. The
loader and both Vitest asset/controller loaders configure MeshoptDecoder explicitly.
Normal startup keeps the procedural fallback if decoding fails.

| Delivery file | Original export in pinned source tree | Original bytes | Compressed bytes |
| --- | --- | ---: | ---: |
| volvo240.glb | experiments/volvo240/refinement/review-only.glb | 266208 | 136696 |
| saab900-t16.glb | experiments/saab900/build/saab900-t16.glb | 345828 | 155088 |
| xc70-civilian.glb | experiments/xc70p2/build/xc70-civilian.glb | 534248 | 213936 |
| xc70-police.glb | experiments/xc70p2/build/xc70-police.glb | 557692 | 223992 |
| impala1970.glb | experiments/impala1970/build/impala1970-hardtop.glb | 715264 | 378468 |
| micra-k11.glb | media/vehicles/micra-k11.glb | 369336 | 225556 |
| duett-p210-epa.glb | media/vehicles/duett-p210-epa.glb | 270612 | 151136 |

Total: 3,059,188 to 1,484,872 bytes (51.5% smaller).

Local original-vs-decoded comparisons verified all named model nodes, triangle
positions to 0.01 mm, material colours/emissive/roughness/metalness/opacity within
1e-6, transparency/sidedness, and wheel hub positions within 1e-6 m. Generated
primitive mesh names may change; authored nodes and material names are retained.
This is geometric verification, not human silhouette/livery approval.

Uniform inherited wheel scales are supported; bake nonuniform ancestor scales
in Blender before export. No model-specific collision changes are made.

## Delivery and checks

Vite copies the only tracked GLBs from `src/public` to `dist/media/vehicles`.
Relative URLs work under a GitHub Pages project/preview prefix. #167 has landed:
the built HTML files are no longer tracked, and E2E serves `dist` directly.
The current main Pages workflow still copies only HTML from `dist` plus root
`media`, so the feature retains an ignored root-asset bridge for that workflow.
The dependent CI/publishing PR copies the complete dist tree and removes the
bridge atomically; otherwise GLBs would be missing after a main deployment.
No second tracked model directory or root HTML is introduced.

Run `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`.
The production build, actual asset parsing, gameplay/fallback and WebGL checks
are automated; images are review artifacts, never pixel-diff tests.
The upstream preview workflow requires a branch in the upstream repository.
CI workflow additions are carried in a separate branch above the fleet feature;
its base contains the feature tests. Vehicle checks now run through the ordinary
Vitest unit workflow; there is no separate `test:vehicles` runner.
Source parsing and visual-controller regressions run in Vitest; E2E keeps game
load/enter/drive coverage and failed-asset fallback, without patching game source.
The existing assertions have been migrated to `tests/unit/vehicles/` after #164.
The controller is a class, following the current lifecycle-owner convention.

## Visual verification limits

Visible model attribution and `media/vehicles/NOTICE.txt` accompany both the root
compatibility build and the production/preview assets.

Geometric parsing is not reference approval. Round 2 retains the existing Saab
silhouette comparison against an uncertain brochure proxy (recorded IoU ~0.9154),
protected Volvo arch checks and shared XC70 export/pose checks. Impala and Micra
sources retain their source-specific reference/refinement evidence but explicitly
say human approval is pending. Duett final-pass measurements use wheel-anchored
photographs and perspective estimates, not a completed full silhouette IoU or
factory surface accuracy. All original reference registers/review reports remain
available in the pinned trees. This integration makes no new real-world visual
approval claim. Physical mobile/Safari performance, final silhouette/livery
approval and traffic placement decisions remain for human review.

Collision envelopes remain those of existing archetypes, not model-specific
body geometry. Large models can therefore visually overhang their collision
shape. Physics/collision calibration is a separate gameplay decision.
