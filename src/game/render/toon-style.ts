import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// Light bands by how squarely a surface faces a light (the dot of its normal and the light direction, -1..1).
// Below the first band a surface is unlit. Each band's light is about Lambert's average over its range,
// so the toon world comes out about as bright as the default one.
export const TOON_BANDS = [
  { fromDot: 0, light: 0.3 },
  { fromDot: 0.4, light: 0.85 },
] as const;
const GRADIENT_TEXELS = 16;
const OUTLINE_THICKNESS = 0.0045; // clip-space units: OutlineEffect scales by depth, so outlines keep their width on screen
const OUTLINE_RGB = [0.06, 0.05, 0.04]; // linear RGB, as OutlineEffect takes it

type LitMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
type MeshMaterial = THREE.Material | THREE.Material[];
type Renderer = Pick<THREE.WebGLRenderer, 'render'>;
type SceneRenderer = { render(scene: THREE.Scene, camera: THREE.Camera): void };

const isLit = (material: THREE.Material): material is LitMaterial =>
  material instanceof THREE.MeshLambertMaterial ||
  material instanceof THREE.MeshPhongMaterial ||
  material instanceof THREE.MeshStandardMaterial;

/** The 1-pixel-high light ramp MeshToonMaterial samples at `dot * 0.5 + 0.5`. */
export function toonGradient(): THREE.DataTexture {
  const data = new Uint8Array(GRADIENT_TEXELS * 4);
  for (let i = 0; i < GRADIENT_TEXELS; i++) {
    const dot = ((i + 0.5) / GRADIENT_TEXELS) * 2 - 1;
    let light = 0;
    for (const band of TOON_BANDS) if (dot >= band.fromDot) light = band.light;
    data.fill(Math.round(light * 255), i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, GRADIENT_TEXELS, 1);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draws the scene cel-shaded (#206). For the length of a frame it swaps every lit material for a MeshToonMaterial
 * copy and then puts the originals back, so game code keeps owning, animating and disposing its own materials.
 * What a material is made of (maps, vertex colours, sides) is copied once; what the game animates (colour,
 * emissive, opacity) is copied every frame.
 */
export class ToonStyle {
  private readonly gradient = toonGradient();
  // instanced meshes get their own copies, with no outline: OutlineEffect ignores instance transforms
  private readonly toons = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();
  private readonly instancedToons = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();
  private readonly toonArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly instancedToonArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly swapped: THREE.Mesh[] = [];
  private readonly originals: MeshMaterial[] = [];
  private readonly swapIn = (object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material: MeshMaterial = object.material;
    const toon = this.toonFor(material, object instanceof THREE.InstancedMesh);
    if (toon === material) return;
    this.swapped.push(object);
    this.originals.push(material);
    object.material = toon;
  };

  constructor(
    private readonly renderer: Renderer,
    private readonly outline: SceneRenderer | null = null,
  ) {}

  get outlines(): boolean {
    return this.outline !== null;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    scene.traverse(this.swapIn);
    try {
      (this.outline ?? this.renderer).render(scene, camera);
    } finally {
      for (let i = 0; i < this.swapped.length; i++) this.swapped[i].material = this.originals[i];
      this.swapped.length = 0;
      this.originals.length = 0;
    }
  }

  private toonFor(material: MeshMaterial, instanced: boolean): MeshMaterial {
    if (!Array.isArray(material)) return this.toonForOne(material, instanced);
    const arrays = instanced ? this.instancedToonArrays : this.toonArrays;
    let toons = arrays.get(material);
    if (!toons) {
      toons = material.map((m) => this.toonForOne(m, instanced));
      arrays.set(material, toons);
    } else for (let i = 0; i < material.length; i++) this.toonForOne(material[i], instanced); // keeps them in sync
    return toons;
  }

  private toonForOne(material: THREE.Material, instanced: boolean): THREE.Material {
    if (!isLit(material)) {
      // unlit and custom materials (sky, blob shadows, sparks) stay as they are, without outlines
      if (this.outline && !material.userData.outlineParameters)
        material.userData.outlineParameters = { visible: false };
      return material;
    }
    const toons = instanced ? this.instancedToons : this.toons;
    let toon = toons.get(material);
    if (!toon) {
      toon = this.createToon(material, instanced);
      toons.set(material, toon);
    }
    toon.color.copy(material.color);
    toon.emissive.copy(material.emissive);
    toon.emissiveIntensity = material.emissiveIntensity;
    toon.opacity = material.opacity;
    toon.visible = material.visible;
    return toon;
  }

  private createToon(source: LitMaterial, instanced: boolean): THREE.MeshToonMaterial {
    const toon = new THREE.MeshToonMaterial({
      name: source.name,
      gradientMap: this.gradient,
      map: source.map,
      alphaMap: source.alphaMap,
      normalMap: source.normalMap,
      emissiveMap: source.emissiveMap,
      vertexColors: source.vertexColors,
      side: source.side,
      transparent: source.transparent,
      alphaTest: source.alphaTest,
      depthWrite: source.depthWrite,
      depthTest: source.depthTest,
      polygonOffset: source.polygonOffset,
      polygonOffsetFactor: source.polygonOffsetFactor,
      polygonOffsetUnits: source.polygonOffsetUnits,
      fog: source.fog,
    });
    if (instanced || source.transparent) toon.userData.outlineParameters = { visible: false };
    source.addEventListener('dispose', () => toon.dispose());
    return toon;
  }
}

/** The toon style with outlines (desktop) or without (phones, where outlines would double the draw calls). */
export function createToonStyle(renderer: THREE.WebGLRenderer, outlines: boolean): ToonStyle {
  const effect = outlines
    ? new OutlineEffect(renderer, {
        defaultThickness: OUTLINE_THICKNESS,
        defaultColor: OUTLINE_RGB,
        defaultKeepAlive: true, // the toon materials live for the page, so keep their outline materials too
      })
    : null;
  return new ToonStyle(renderer, effect);
}
