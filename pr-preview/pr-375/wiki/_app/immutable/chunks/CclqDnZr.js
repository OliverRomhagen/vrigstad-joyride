import{H as e,W as t,b as n,vt as r,x as i}from"./BHHUk4vM.js";import{t as a}from"./Twu__2AI.js";var o=new Set([`$$slots`,`$$events`,`$$legacy`]),s=t(`<h1 id="complete-blender-vehicle-fleet">Complete Blender vehicle fleet</h1><p>Select the parked Torget car with <code>?vehicle=volvo240</code>, <code>saab900</code>, <code>xc70</code>, <code>xc70-police</code>, <code>impala1970</code>, <code>micra-k11</code> or <code>duett-epa</code>. Start and use the
normal movement/E controls. The HUD uses the model name. Without a query,
parked cars and traffic pick a model for their type from <code>VEHICLE_VARIANTS</code>:
a Volvo is a Volvo 240 or an Impala, a Saab a Saab 900, XC70 or Micra, an EPA
a Duett and police a police XC70. The pick uses its own seeded stream, so the
original traffic distribution and the rest of the world's rolls are unchanged.
The tractor stays procedural. Unknown IDs use the default Volvo 240 at Torget.
Models do not define dynamics: mappings reuse
Volvo/Saab/passenger-car, police and EPA simulation. They are not calibrated
real-world handling specifications. No experimental drivetrain is included.</p><h2 id="registry-and-lifecycle">Registry and lifecycle</h2><p><code>src/game/render/vehicle-registry.ts</code> declares stable IDs, names, paths, archetypes,
wheel radius/base and default archetype mappings. Register a new model there and
provide its GLB under <code>src/public/media/vehicles</code>. All exports use metres, +Y up,
-Z forward and the shared body/wheel node names. Immutable provenance lives below. <code>npm test</code> checks all real files through Three's GLTFLoader and validates
wheel locations and plausible bounds.</p><p><code>VehicleVisuals</code> owns rendering state independently from simulation. Call <code>attach(car,id,fallback,color)</code> after adding a car, <code>sync(car)</code> after positioning it, <code>update(focus,dt)</code> once per frame and <code>dispose(car)</code> on removal. <code>addCar</code> accepts
an optional sixth asset-ID argument overriding the variant pick.
Names and short Swedish spoken names are read through <code>vehicleVisuals.definition(car)</code>;
they are not stored on simulation car objects. No new input or physics rules are introduced.</p><p>Loading is lazy inside the 120 m/8 desktop or 3 coarse-device detail budget.
Templates and geometry/materials are cached and shared; instance transforms are
cloned. Civilian bodies receive the same single seeded colour choice as their
procedural fallback after asynchronous loading; police livery is preserved. <code>paint(car,color)</code> clones only that
instance's civilian body materials; police livery is protected. Owned material
clones are disposed with the visual; shared cached resources live for the page.
Failures are reported as <code>failed</code>, retain the procedural fallback and never
pretend the detailed asset loaded. Failed instances do not occupy detail slots.
Removed cars ignore pending asynchronous work.</p><p>Wheel travel derives from rendered movement, using -Z forward and metre units;
front steering derives from heading/distance and verified wheelbase. Teleports
larger than 20 m do not spin wheels. Police beacons use existing emissive meshes;
no point lights/shadows are added for them. Coarse detailed meshes do not cast
additional shadows. The read-only game hook exposes the selected car's actual
loading/fallback/detail and wheel state for tests.</p><h2 id="sources-and-regeneration">Sources and regeneration</h2><p>All models: Axel Tidehorn, CC BY 4.0. Original generators: MIT, explicitly
authorized by the author. See LICENSE. No photographs or third-party car meshes
are embedded. Reference images/manufacturer documents keep their original terms;
they are not included in this contribution. No manufacturer endorsement is implied.</p><p>Immutable sources in <code>https://github.com/AxelTidehorn/vrigstad-joyride/tree/&lt;SHA&gt;</code>:</p><table><thead><tr><th>Models</th><th>Source revision</th><th>Editable master</th><th>Generator</th></tr></thead><tbody><tr><td>Volvo 240</td><td>ff6a0f187add7bd9b7ba052f28bd0d67e534c33a</td><td>experiments/volvo240/refinement/model.blend</td><td>experiments/volvo240/model.py, refine_forms.py, round2.py</td></tr><tr><td>Saab 900</td><td>same Round 2 revision</td><td>experiments/saab900/build/model.blend</td><td>experiments/saab900/model.py, round2.py</td></tr><tr><td>Both XC70s</td><td>same Round 2 revision</td><td>experiments/xc70p2/build/model.blend</td><td>experiments/xc70p2/model.py, round2.py, variants.py</td></tr><tr><td>Impala</td><td>46fa31e9094ab6e1e30f2b542de83383f85fb7c7</td><td>experiments/impala1970/build/model.blend</td><td>experiments/impala1970/model.py</td></tr><tr><td>Micra</td><td>5c84a173f3bbd8206f067ec18594cecdaf5476b5</td><td>experiments/micra1995/build/model.blend</td><td>experiments/micra1995/model.py</td></tr><tr><td>Duett</td><td>2be04e605ad20f9ffc5dbe097a493bd6a3991e6f</td><td>experiments/duettp210/build/model.blend</td><td>experiments/duettp210/model.py</td></tr></tbody></table><p>Download the pinned source tree; do not regenerate from an earlier blockout.
The source experiment READMEs document external Blender Modeler helpers and
source generation. Existing editable masters can be exported with Blender's
GLB exporter: metres, Y-up, apply modifiers, visible objects only, preserve node
names and wheel hub pivots. XC70 variants share one master; <code>variants.py</code> changes
paint/equipment visibility rather than authoring a second body. Source geometry
must pass the original experiment's topology/pose gates before replacing an export.
Blender 4.3.2 authored the original exports. Delivered GLBs are meshopt-compressed
derivatives, not byte-identical copies. Re-export bytes can vary by version.</p><p>Measured full-model bounds (including trim), metres, X width × Y height × Z length:
240 1.830×1.433×4.820; Saab 1.750×1.420×4.680; XC70 2.020×1.563×4.743;
police 2.020×1.745×4.743; Impala 2.210×1.397×5.486;
Micra 1.790×1.430×3.698; Duett 1.680×1.750×4.100.
Hub wheelbases are 2.650, 2.517, 2.763, 2.763, 3.0226, 2.360 and 2.600 m.</p><h2 id="compression">Compression</h2><p><code>gltfpack</code> is pinned to 1.3.0 in the dev dependencies. The runtime uses the
MeshoptDecoder already shipped with Three.js; no new runtime package is needed.
Prepare a separate directory containing the original pinned exports under the
filenames below, then run:</p><pre class="twinkleplop language-sh" data-language="sh"><code><span class="l"><span class="tok identifier">npm</span> <span class="tok identifier">ci</span></span>
<span class="l"><span class="tok identifier">npm</span> <span class="tok identifier">run</span> <span class="tok identifier">compress</span>:<span class="tok identifier">vehicles</span> <span class="tok operator">--</span> <span class="tok operator">/</span><span class="tok identifier">path</span><span class="tok operator">/</span><span class="tok identifier">to</span><span class="tok operator">/</span><span class="tok identifier">original</span><span class="tok operator">-</span><span class="tok identifier">exports</span></span>
<span class="l"><span class="tok identifier">npm</span> <span class="tok builtin">test</span></span>
<span class="l"><span class="tok identifier">npm</span> <span class="tok identifier">run</span> <span class="tok identifier">build</span></span></code></pre><p>The script runs <code>gltfpack -c -kn -km -noq</code> for each public GLB: meshopt compression,
retained named nodes/materials, no mesh simplification or vertex quantization.
Always start from the originals, never an already compressed derivative. The
loader and both Vitest asset/controller loaders configure MeshoptDecoder explicitly.
Normal startup keeps the procedural fallback if decoding fails.</p><table><thead><tr><th>Delivery file</th><th>Original export in pinned source tree</th><th align="right">Original bytes</th><th align="right">Compressed bytes</th></tr></thead><tbody><tr><td>volvo240.glb</td><td>experiments/volvo240/refinement/review-only.glb</td><td align="right">266208</td><td align="right">136696</td></tr><tr><td>saab900-t16.glb</td><td>experiments/saab900/build/saab900-t16.glb</td><td align="right">345828</td><td align="right">155088</td></tr><tr><td>xc70-civilian.glb</td><td>experiments/xc70p2/build/xc70-civilian.glb</td><td align="right">534248</td><td align="right">213936</td></tr><tr><td>xc70-police.glb</td><td>experiments/xc70p2/build/xc70-police.glb</td><td align="right">557692</td><td align="right">223992</td></tr><tr><td>impala1970.glb</td><td>experiments/impala1970/build/impala1970-hardtop.glb</td><td align="right">715264</td><td align="right">378468</td></tr><tr><td>micra-k11.glb</td><td>media/vehicles/micra-k11.glb</td><td align="right">369336</td><td align="right">225556</td></tr><tr><td>duett-p210-epa.glb</td><td>media/vehicles/duett-p210-epa.glb</td><td align="right">270612</td><td align="right">151136</td></tr></tbody></table><p>Total: 3,059,188 to 1,484,872 bytes (51.5% smaller).</p><p>Local original-vs-decoded comparisons verified all named model nodes, triangle
positions to 0.01 mm, material colours/emissive/roughness/metalness/opacity within
1e-6, transparency/sidedness, and wheel hub positions within 1e-6 m. Generated
primitive mesh names may change; authored nodes and material names are retained.
This is geometric verification, not human silhouette/livery approval.</p><p>Uniform inherited wheel scales are supported; bake nonuniform ancestor scales
in Blender before export. No model-specific collision changes are made.</p><h2 id="delivery-and-checks">Delivery and checks</h2><p>Vite copies the only tracked GLBs from <code>src/public</code> to <code>dist/media/vehicles</code>.
Relative URLs work under a GitHub Pages project/preview prefix. #167 has landed:
the built HTML files are no longer tracked, and E2E serves <code>dist</code> directly.
The fleet's Pages workflow publishes root teaser media followed by the entire <code>dist</code> tree, so production and preview both ship the Vite public assets.
There is no root GLB compatibility copy, second tracked model directory or root HTML.</p><p>Run <code>npm run check</code>, <code>npm test</code>, <code>npm run build</code>, <code>npm run test:e2e</code>.
The production build, actual asset parsing, gameplay/fallback and WebGL checks
are automated; images are review artifacts, never pixel-diff tests.
The upstream preview workflow requires a branch in the upstream repository.
Optional manual CI dispatch is carried in a separate branch above the fleet feature;
its base contains the feature tests. Vehicle checks now run through the ordinary
Vitest unit workflow; there is no separate <code>test:vehicles</code> runner.
Source parsing and visual-controller regressions run in Vitest; E2E keeps game
load/enter/drive coverage and failed-asset fallback, without patching game source.
The existing assertions have been migrated to <code>tests/unit/vehicles/</code> after #164.
The controller is a class, following the current lifecycle-owner convention.</p><h2 id="visual-verification-limits">Visual verification limits</h2><p>Visible model attribution and <code>media/vehicles/NOTICE.txt</code> accompany the production
and preview assets.</p><p>Geometric parsing is not reference approval. Round 2 retains the existing Saab
silhouette comparison against an uncertain brochure proxy (recorded IoU ~0.9154),
protected Volvo arch checks and shared XC70 export/pose checks. Impala and Micra
sources retain their source-specific reference/refinement evidence but explicitly
say human approval is pending. Duett final-pass measurements use wheel-anchored
photographs and perspective estimates, not a completed full silhouette IoU or
factory surface accuracy. All original reference registers/review reports remain
available in the pinned trees. This integration makes no new real-world visual
approval claim. Physical mobile/Safari performance, final silhouette/livery
approval and traffic placement decisions remain for human review.</p><p>Collision envelopes remain those of existing archetypes, not model-specific
body geometry. Large models can therefore visually overhang their collision
shape. Physics/collision calibration is a separate gameplay decision.</p>`,1);function c(t,c){let l=n(c,o);a(t,i(()=>l,{children:(t,n)=>{var i=s();r(27),e(t,i)},$$slots:{default:!0}}))}export{c as default};