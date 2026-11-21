# three.js: what changed after r176

Claude's training ends around three.js r176. This repo uses the version in `package.json` (`three` 0.187.0, r187). These are the changes from r177 on that a game on `WebGLRenderer` meets: lines that now warn, break or look different. When in doubt, check the installed source in `node_modules/three/src/`.

Adapted from `docs/engine-reference/web/threejs.md` in [Claude Code Game Studios](https://github.com/donchitos/claude-code-game-studios) (MIT; see `LICENSE`), which covers up to r186, verified there on 2026-10-29. **r187 is not covered yet:** add its changes from the [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) when someone checks them.

**Grades:** **[S]** sourced: read in the named primary source; **[J]** judgment.

## Renamed, removed or deprecated

| Release | Change | |
|---------|--------|---|
| r177 | `ColorManagement.fromWorkingColorSpace()` → `workingToColorSpace()`; `toWorkingColorSpace()` → `colorSpaceToWorking()` | **[S]** |
| r178 | `MultiplyBlending` and `SubtractiveBlending` need `material.premultipliedAlpha = true` | **[S]** |
| r179 | `Timer` is in core (`THREE.Timer`); no add-on import | **[S]** |
| r179 | `WebGLRenderer({ reverseDepthBuffer })` → `reversedDepthBuffer` | **[S]** |
| r180 | `RGBELoader` → `HDRLoader`; `RGBMLoader` removed | **[S]** |
| r181 | PBR materials look slightly different (indirect specular, energy conservation: rough materials a bit brighter) | **[S]** |
| r182 | `PCFSoftShadowMap` deprecated on `WebGLRenderer`: `PCFShadowMap` is now soft too | **[S]** |
| r183 | `Clock` deprecated: use `Timer` | **[S]** |
| r183 | `Sky`/`SkyMesh` legacy gamma removed (looks different, no parameter restores it) | **[S]** |
| r184 | `FileLoader.load()` and `ImageBitmapLoader.load()` return nothing: use the `onLoad` callback | **[S]** |
| r184 | `FBXLoader` turns +Z-up models to +Y-up itself: remove manual rotations | **[S]** |
| r184 | Background and environment rotation now follow object rotation | **[S]** |
| r185 | With `matrixAutoUpdate = false` and a hand-set `matrix`, also set `matrixWorldNeedsUpdate = true` | **[S]** |
| r185 | `SVGLoader.createShapes()` deprecated (call `toShapes()` on each shape path); `DRACOLoader.setDecoderConfig()`, `LWOLoader`, `VTKLoader` (r184) deprecated | **[S]** |
| r186 | `Object3D.dispose()` exists: a custom class with its own `dispose()` calls `super.dispose()` | **[S]** |
| r186 | `Source` → `TextureSource` | **[S]** |
| r186 | `Sky`'s `up` uniform removed (always +Y up) | **[S]** |

## In practice

- `renderer.shadowMap.type = PCFSoftShadowMap` logs a warning and uses `PCFShadowMap`. Write `PCFShadowMap` (as `src/game/main.ts` does) or `VSMShadowMap`. **[S]**
- `new THREE.Clock()` logs a deprecation warning. `Timer` is driven by hand: call `timer.update(timestamp)` once a frame (milliseconds, e.g. the animation-loop time), then `getDelta()` / `getElapsed()`, which return **seconds**. `timer.connect(document)` makes it skip the time the tab was hidden. **[S]** The game loop here computes its own clamped `dt` from `requestAnimationFrame` and uses neither.

```ts
const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((t) => {
  timer.update(t);
  step(Math.min(timer.getDelta(), 0.05));   // clamp, as the game loop does
  renderer.render(scene, camera);
});
```

## WebGPURenderer

Only relevant if the game moves to it (#57, `import * as THREE from 'three/webgpu'`); `WebGLRenderer` stays the default, since WebGPU isn't in every browser. **[J]** Changes that bite there: **[S]**

- r181: the `*Async()` methods (`renderAsync`, `computeAsync`, …) are deprecated; the renderer initialises inside `setAnimationLoop()`, or call `await renderer.init()` first.
- r182: `colorBufferType` → `outputBufferType`.
- r183: `PostProcessing` → `RenderPipeline`; `WebGLCubeRenderTarget` → `CubeRenderTarget`.
- r185: premultiplied alpha changed; use an opaque background or clear colour unless the canvas must blend with the page.
- r186: `PCFSoftShadowMap` removed; `LightProbeGrid` → `LightProbeGridWebGL`.

## Sources

1. https://github.com/mrdoob/three.js/wiki/Migration-Guide (sections 176 → 177 to 185 → 186)
2. https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js
3. https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js ; `src/core/Clock.js`
