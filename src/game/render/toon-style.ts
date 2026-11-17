import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// The look follows the "Kraftig" (bold) cel shading of the art direction lab (v20).
// Light per quarter of MeshToonMaterial's ramp, which it samples at `dot * 0.5 + 0.5` (dot of normal and light
// direction): facing away, turning away, turning towards and facing the light. 0-255.
export const TOON_LEVELS = [9, 45, 132, 255] as const;
// Toon bands only shape direct light; the hemisphere fill is smooth and washes them out, so it gives way to the sun.
export const TOON_SUN_SCALE = 1.22;
export const TOON_FILL_SCALE = 0.52;
const OUTLINE_THICKNESS = 0.0045; // clip-space units: OutlineEffect scales by depth, so outlines keep their width on screen
const OUTLINE_RGB = [0.06, 0.05, 0.04]; // linear RGB, as OutlineEffect takes it
// Ink lines along the hard creases of inked objects (cars): edges where faces meet at more than this angle
const INK_CREASE_DEG = 34;
const INK_COLOR = 0x10151c;
const INK_OPACITY = 0.67;
const INK_INFLATE = 1.002; // lines sit just outside the surface, so they don't z-fight with it
/** Set on an object's userData to give every opaque mesh under it ink lines. */
export const INK_FLAG = 'toonInk';

type LitMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
type MeshMaterial = THREE.Material | THREE.Material[];
type Renderer = Pick<THREE.WebGLRenderer, 'render'>;
type SceneRenderer = { render(scene: THREE.Scene, camera: THREE.Camera): void };

const isLit = (material: THREE.Material): material is LitMaterial =>
  material instanceof THREE.MeshLambertMaterial ||
  material instanceof THREE.MeshPhongMaterial ||
  material instanceof THREE.MeshStandardMaterial;
const isOpaque = (material: MeshMaterial) =>
  Array.isArray(material) ? material.every((m) => !m.transparent) : !material.transparent;

/** The light ramp MeshToonMaterial samples, one texel per level. */
export function toonGradient(): THREE.DataTexture {
  const texture = new THREE.DataTexture(Uint8Array.from(TOON_LEVELS), TOON_LEVELS.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draws the scene cel-shaded (#206). For the length of a frame it swaps every lit material for a MeshToonMaterial
 * copy, shifts light from the fill to the sun, and then puts everything back, so game code keeps owning, animating
 * and disposing its own materials and lights. What a material is made of (maps, vertex colours, sides) is copied
 * once; what the game animates (colour, emissive, opacity) is copied every frame.
 * Ink lines are the one lasting change: meshes under an object flagged with INK_FLAG get a line child, once.
 */
export class ToonStyle {
  private readonly gradient = toonGradient();
  // instanced meshes get their own copies, with no outline: OutlineEffect ignores instance transforms
  private readonly toons = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();
  private readonly instancedToons = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();
  private readonly toonArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly instancedToonArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly inkGeometries = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private readonly inked = new WeakSet<THREE.Mesh>();
  private readonly inkMaterial = new THREE.LineBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: INK_OPACITY,
    depthWrite: false,
  });
  private readonly swapped: THREE.Mesh[] = [];
  private readonly originals: MeshMaterial[] = [];
  private readonly lights: THREE.Light[] = [];
  private readonly intensities: number[] = [];
  private readonly addInk = (object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh) || this.inked.has(object)) return;
    this.inked.add(object);
    if (!isOpaque(object.material)) return; // no lines across glass
    let edges = this.inkGeometries.get(object.geometry);
    if (!edges) {
      edges = new THREE.EdgesGeometry(object.geometry, INK_CREASE_DEG);
      this.inkGeometries.set(object.geometry, edges);
    }
    const lines = new THREE.LineSegments(edges, this.inkMaterial);
    lines.scale.setScalar(INK_INFLATE);
    lines.renderOrder = 10;
    lines.raycast = () => {};
    object.add(lines);
  };
  private readonly swapIn = (object: THREE.Object3D) => {
    if (object.userData[INK_FLAG]) object.traverse(this.addInk);
    if (object instanceof THREE.HemisphereLight) this.scaleLight(object, TOON_FILL_SCALE);
    else if (object instanceof THREE.DirectionalLight) this.scaleLight(object, TOON_SUN_SCALE);
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
      for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = this.intensities[i];
      this.swapped.length = 0;
      this.originals.length = 0;
      this.lights.length = 0;
      this.intensities.length = 0;
    }
  }

  private scaleLight(light: THREE.Light, scale: number) {
    this.lights.push(light);
    this.intensities.push(light.intensity);
    light.intensity *= scale;
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
