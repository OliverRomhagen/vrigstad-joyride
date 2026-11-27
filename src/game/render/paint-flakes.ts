// The sparkle in a metallic paint (#76): tiny flakes under the lacquer, each tilted its own way, so a few catch the sun at any
// angle and glint as the car or the camera moves. The car models have no UVs, so the flakes are cells of the body's own space,
// worked out in the paint's shader: a patch on the model's material, which VehicleVisuals.paint puts on and takes off.
import * as THREE from 'three';
import { WORKSHOP_PAINTS } from '../sim/paint-jobs';
import { isPaintedPanel } from './vehicle-registry';

/** A metallic paint's finish: the scene has no environment map, so a real metal has nothing to reflect and draws black; a
 * little metalness and a low roughness give the sheen, from the sun's highlight (as #450 found). */
export const METALLIC_FINISH = { metalness: 0.35, roughness: 0.32 } as const;

const FLAKE_CELLS_PER_M = 90; // flakes about 1 cm across: under a pixel or two at the chase camera, so they glint rather than tile
const FLAKE_TILT = 0.6; // how far a flake turns from the panel's own normal: enough that some face the sun from any view
const GLINT_SHARPNESS = 600.0; // a flake is a tiny mirror: only one turned almost exactly between sun and eye lights up
const GLINT_STRENGTH = 0.2; // how bright a glint is, times the sun's colour
const GLINT_TINT = 0.9; // how far a glint takes the paint's hue: 0 is white, 1 the paint's own colour at full brightness
const SUNLIT_FADE = 0.15; // cos of the sun's angle over a panel below which its flakes fade out: none glint on the side away from it

const VERTEX_HEAD = '\nvarying vec3 vFlakeAt;';
const FRAGMENT_HEAD = `
varying vec3 vFlakeAt;
vec3 flakeHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}`;
// after the lights loop, where three's directLight still holds the sun, with its shadow already in its colour (stage.ts makes the
// game's one directional light, and the loop takes the directional lights last of the direct ones): each flake, tilted its own
// way, adds a glint where it mirrors the sun into the eye, and none in shadow or on the side facing away from it. It only ever adds
// light: tilting the paint's own normal instead turned the flakes facing away into dark specks, like rust
const FRAGMENT_FLAKE = `#include <lights_fragment_begin>
#if NUM_DIR_LIGHTS > 0
{
  vec3 tilt = flakeHash(floor(vFlakeAt * ${FLAKE_CELLS_PER_M.toFixed(1)})) * 2.0 - 1.0;
  vec3 flake = normalize(normal + tilt * ${FLAKE_TILT});
  vec3 halfway = normalize(directLight.direction + normalize(vViewPosition));
  float facing = smoothstep(0.0, ${SUNLIT_FADE.toFixed(2)}, dot(normal, directLight.direction));
  vec3 glint = mix(vec3(1.0), diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b), ${GLINT_TINT}); // warm in the paint's own hue, as real flakes are
  reflectedLight.directSpecular += glint * directLight.color * facing * ${GLINT_STRENGTH.toFixed(1)} * pow(max(dot(flake, halfway), 0.0), ${GLINT_SHARPNESS.toFixed(1)});
}
#endif`;

// one patch for every flaked material, so they share one program
function patchFlakes(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlakeAt = position;'); // the body's own space: flakes stay on the car
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`)
    .replace('#include <lights_fragment_begin>', FRAGMENT_FLAKE);
}
const flakesKey = () => 'paint-flakes';

/** Puts the flakes in a model's paint, or takes them out (`on` false); a material the patch already matches is left alone. */
export function setFlakes(material: THREE.MeshStandardMaterial, on: boolean) {
  if ((material.onBeforeCompile === patchFlakes) === on) return;
  material.onBeforeCompile = on ? patchFlakes : THREE.Material.prototype.onBeforeCompile;
  material.customProgramCacheKey = on ? flakesKey : THREE.Material.prototype.customProgramCacheKey;
  material.needsUpdate = true;
}

/** What the warm-up needs: the renderer that compiles, and the scene and camera it draws with, so the lights and fog match. */
export interface FlakeWarmerDeps {
  renderer: Pick<THREE.WebGLRenderer, 'compileAsync'>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  standInGeo(type: string, paint: string): THREE.BufferGeometry; // the stand-in's body in that paint (models.ts carGeo)
  standInMat(paint: string): THREE.Material | THREE.Material[]; // and its materials (models.ts carMatFor)
}

/**
 * Compiles the flakes' shader before a metallic paint is first drawn, when his special paints are offered: compiled on the first
 * draw, it stalls that frame. A flaked copy of the car's own body material, and the stand-in's metallic material, compile in
 * the background; one copy of each kind is kept, as three frees a compiled program once no material uses it.
 */
export class FlakeWarmer {
  private readonly g: FlakeWarmerDeps;
  private readonly kept = new Map<string, THREE.Material>(); // by what decides the program: the material's type, maps and the geometry's attributes
  private standInWarm = false; // every stand-in shares one metallic material and the same attributes: one program

  constructor(g: FlakeWarmerDeps) {
    this.g = g;
  }

  /** Compiles what a metallic paint on this car would draw with: `body` is the car's mesh, with its model's body if loaded. */
  warm(type: string, body: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    body.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !isPaintedPanel(node.name)) return;
      for (const m of [node.material].flat()) {
        if (
          !(m instanceof THREE.MeshStandardMaterial) ||
          m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
        )
          continue;
        const { attributes } = node.geometry,
          maps = [
            m.map,
            m.normalMap,
            m.roughnessMap,
            m.metalnessMap,
            m.aoMap,
            m.emissiveMap,
            m.alphaMap,
            m.bumpMap,
            m.lightMap,
          ],
          key = [
            m.type,
            m.vertexColors,
            m.alphaTest > 0,
            m.flatShading,
            m.transparent,
            m.side,
            ...maps.map(Boolean),
            attributes.color?.itemSize ?? 0,
            !!attributes.uv,
            !!attributes.tangent,
          ].join();
        if (this.kept.has(key)) continue;
        const copy = m.clone();
        setFlakes(copy, true);
        this.kept.set(key, copy);
        meshes.push(new THREE.Mesh(node.geometry, copy));
      }
    });
    if (!this.standInWarm)
      for (const { paint, metallic } of WORKSHOP_PAINTS)
        if (metallic) meshes.push(new THREE.Mesh(this.g.standInGeo(type, paint), this.g.standInMat(paint)));
    this.standInWarm = true;
    if (!meshes.length) return;
    const group = new THREE.Group();
    group.add(...meshes);
    const failed = (err: unknown) => console.warn('Paint flakes: warm-up failed', err); // the paint still compiles when first drawn
    try {
      this.g.renderer.compileAsync(group, this.g.camera, this.g.scene).catch(failed);
    } catch (err) {
      failed(err); // compileAsync starts compiling before it hands back its promise: a lost context throws here, not in it
    }
  }
}
