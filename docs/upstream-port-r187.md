# Standalone photographic grain — r187 dependency preview

> **Review tuning (2026-11-13):** The `?grain=strong` setting is now **1.5** following visual review. Default/subtle remains 0.62 and off remains a true bypass. The earlier `strong.png` screenshot and performance figures below were captured at the previous strength **1.35**; they are historical evidence and must be regenerated before final visual signoff. No claim is made that they show the new 1.5 setting.

**Blocked by upstream [#143](https://github.com/OliverRomhagen/vrigstad-joyride/pull/143), then [#147](https://github.com/OliverRomhagen/vrigstad-joyride/pull/147). Both were reviewed and remain open/unmerged.** This is deliberately not a patch against current r128 main.

- Exact reviewed #143 head: `167fac9da8a73f368c9488c5d4c3cead481e6f80`.
- Exact reviewed #147 head / parent of this feature: `4a8be71bfe38aadcd5fdc07e6fe2df5aa5702be4`.
- Fork-only base: `review/upstream-pr147-4a8be71` (unchanged copy of that #147 head).
- Fork head: `contrib/photographic-grain-r187`. One focused feature commit above the dependency snapshot.
- Related upstream [#124](https://github.com/OliverRomhagen/vrigstad-joyride/issues/124) remains open; no closure claim.

No upstream PR/branch is modified or merged. Neither repository's main is changed. After #147 lands, refresh against its actual merged source, rebuild normally and repeat visual/CI checks before proposing upstream submission. If #147 changes while pending, this pinned preview does not silently inherit those changes.

## Architecture reviewed

#143 replaces Python string embedding with Vite imports, `src/game/main.ts`, `src/map/main.ts` and committed single-file production builds. #147 imports `three@0.187.0` from npm, keeps `ColorManagement.enabled=false` in the shared `three-legacy.ts`, scales legacy directional/hemisphere intensities by `LEGACY_LIGHT=Math.PI`, changes encoding properties to color spaces, uses PCFShadowMap and fixes instance bounds. Those migration files and decisions are preserved here. This does not include #150's separate managed-color/physical-unit retune.

New modules are strict typed TypeScript, formatted with Biome; the existing monolithic entry retains upstream's `@ts-nocheck`. There is no new runtime or package dependency. No hand-edited generated HTML, data, map, gameplay RNG or simulation change.

## Color path and r187 API adaptation

A direct rename of the old `WebGLMultisampleRenderTarget` / `.encoding` implementation is incorrect. r187 disables the renderer's tone mapping for ordinary render targets and renders them in its working color space. #147 intentionally keeps display-space fog and a custom sky that writes its display colors directly. Moving that scene wholesale into a conventional linear HDR target would change the fog/sky unless those materials were retuned.

This implementation instead renders the scene **once through the original native canvas path**, uses r187's `FramebufferTexture` and `renderer.copyFramebufferToTexture(texture)` to copy its completed pixels on the GPU, then draws one fullscreen finish. The canvas retains its original antialiasing/MSAA, ACES, sRGB conversion, encoded-fog convention and alpha blending. The RGBA8 copy has `NoColorSpace`, preventing hardware sRGB sampling decode; the finish ShaderMaterial has `toneMapped:false` and no encoding/tonemapping shader chunks. Thus those bytes are neither encoded nor tone-mapped a second time. No `outputEncoding`, texture `.encoding`, removed multisample-target class or WebGL1 path is introduced; r187 requires WebGL2.

Enabled cost is one GPU framebuffer copy, one extra RGBA8 texture and one fullscreen draw; no additional scene render, depth attachment or multisample offscreen target. At 960×540 the texture alone holds 2,073,600 bytes. Off bypasses the entire integration and allocates none of those resources. Texture disposal/recreation follows the actual drawing-buffer size on resize. This is not a CPU readback. The copied image is already 8-bit: it cannot recover highlight detail that upstream clipped before this effect.

Grain and grade candidates deliberately remain independent for review. Their `scene-finish.ts` files are identical. If both are selected, reconcile the two entry-point initializations and combine their uniforms/fragment function in **one** finish; do not instantiate or chain two copies. No duplicate post-processing passes are present in either candidate.

## Selected behavior and evidence

Adapted from fork `8d7198c` / the reviewed r128 extraction `61c979b`: fine monochrome, static framebuffer-space grain, no per-frame noise/time seed and no film, weather, sky, mist, Worker or WebGPU dependency. Default/subtle is 0.62, strong 1.35, numeric intensity clamps to 0–2; `?grain=off` and `?grain=0` bypass. DOM HUD/minimap/text stay outside the GL effect.

The actual r187 comparison below holds camera, simulation step, light, fog and seeded world constant. The separate unchanged #147 baseline and the zero-strength identity copy were visually reviewed alongside direct rendering. They retain the same apparent brightness, pale facades, sky/fog and antialiased edges. Subtle/strong add fine luminance noise without moving the UI. This is manual visual review, not a pixel-diff assertion or hardware/mobile signoff.

| Unchanged #147 | Identity through finish | Subtle | Strong |
| --- | --- | --- | --- |
| ![Baseline](review-r187/baseline-day.png) | ![Identity](review-r187/identity.png) | ![Subtle](review-r187/subtle.png) | ![Strong](review-r187/strong.png) |

## Entire rendering-integration measurement

Full-scene GPU timer queries bracket native scene rendering, the framebuffer copy and the final fullscreen draw. Every path is warmed; four rounds rotate path order. The same world and camera remain frozen. No reported disjoint samples. These are Chromium/SwiftShader timings in a contended software environment, not a representative GPU benchmark.

| Path | Median full GPU ms | Range ms | Draw calls | Triangles |
| --- | ---: | ---: | ---: | ---: |
| direct | 829.0 | 691.9–1244.2 | 327 | 196045 |
| identity | 907.6 | 792.9–1371.7 | 328 | 196047 |
| subtle | 739.2 | 678.4–1299.9 | 328 | 196047 |
| strong | 794.1 | 768.3–1428.2 | 328 | 196047 |

The overlapping ranges and counterintuitive lower subtle/strong medians do **not** establish a speedup or a reliable hardware percentage cost. The identity overhead includes the copy/pass integration, not just grain arithmetic. Raw samples are committed. The review harness loads subtle once and switches its actual uniform; direct bypasses that finish while retaining the initially allocated texture. Production off's zero-allocation path is checked separately by the effect smoke cases. Names in the capture/measurement arrays describe the shown harness mode; production URL state remains subtle.

Changed production files: `src/game/render/{scene-finish,photographic-grain}.ts`, focused render/resize/read-only-state wiring in `src/game/main.ts`, generated `index.html`. Tests: four bypass/intensity cases plus a drawing-buffer resize case, alongside the existing five smoke tests.

## Reproduce and remaining validation

```sh
npm ci
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
REVIEW_KIND=grain CHROMIUM_PATH=/usr/bin/chromium node tools/review-rendering.mjs
```

Capture tooling makes a disposable Vite build under `work/` with source transforms for fixed steps, camera, uniforms/fixtures and full-integration timer queries. Production hooks remain read-only. No assertion bodies, shaders, materials, shadow settings or ground texture resolution are suppressed during these captures. To repeat the separate unchanged reference, copy the review tool into a clean #147 snapshot and set `REVIEW_KIND=baseline`. The tool accepts `CHROMIUM_PATH`; by default it uses Playwright's installed Chromium. Attached images used system Chromium/SwiftShader at 960×540 with full production shadows/ground.

The ordinary local `npm run test:e2e -- --workers=1` was also launched; it encountered software-render timeouts, including in the disabled/native path. That local run is not declared green. Standard hosted CI status and exact test counts are recorded in the PR description once available. There is no reduced-render fixture in this contribution. Hardware/phone performance and human aesthetic acceptance remain open.
