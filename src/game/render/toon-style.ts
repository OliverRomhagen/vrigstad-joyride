import * as THREE from 'three';

// The look follows the "Kraftig" (bold) cel shading of the art direction lab (v20).
// Light per quarter of MeshToonMaterial's ramp, which it samples at `dot * 0.5 + 0.5` (dot of normal and light
// direction): facing away, turning away, turning towards and facing the light. 0-255.
export const TOON_LEVELS = [9, 45, 132, 255] as const;
// Without roughness and metalness, a car's materials only differ by colour. Each finish gets its own ramp instead,
// picked from the material's name (the GLB exports name them) or its metalness. The lab has one ramp for everything.
export const FINISH_LEVELS = {
  paint: TOON_LEVELS,
  rubber: [9, 26, 52, 82], // matte: little between lit and unlit
  metal: [30, 200, 70, 255], // chrome's stripes: a bright band before a dark one, as a reflection gives
  glass: [12, 28, 50, 165], // dark, with one hard highlight facing the sun
  lamp: [110, 130, 150, 180], // lenses barely shade, so they read as lamps from any side
} as const;
export type Finish = keyof typeof FINISH_LEVELS;
// Toon bands only shape direct light; the hemisphere fill is smooth and washes them out, so it gives way to the sun.
export const TOON_SUN_SCALE = 1.22;
export const TOON_FILL_SCALE = 0.52;
// Ink lines, as the lab draws them: along the edges where faces meet at more than this angle, so boxes and car
// panels get lines and smooth curves don't. Only under objects flagged with INK_FLAG: rigid things, not terrain,
// roads or trees.
const INK_CREASE_DEG = 34;
const INK_COLOR = 0x10151c;
const INK_OPACITY = 0.67;
// Lines are drawn this fraction of their distance closer to the camera, along the line of sight: the same place on
// screen, but in front of the surface they sit on and of the houses' corner boards, which are pulled forward with
// polygonOffset. Scaling the lines about the mesh's origin instead moved them off meshes whose origin is far away, such
// as the village's shells (one mesh at Torget).
export const INK_PULL = 0.001;
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';

type LitMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
type MeshMaterial = THREE.Material | THREE.Material[];
type Renderer = Pick<THREE.WebGLRenderer, 'render'>;

// a material with its own shader patch (the water) keeps it: a toon copy would draw it in its plain, often white, colour
const isLit = (material: THREE.Material): material is LitMaterial =>
  (material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshStandardMaterial) &&
  material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
const isOpaque = (material: MeshMaterial) =>
  Array.isArray(material) ? material.every(m => !m.transparent) : !material.transparent;

export function finishOf(material: THREE.Material): Finish {
  const name = material.name.toLowerCase();
  if (/glass|glazing|window/.test(name)) return 'glass';
  if (/lamp|lens|beam|indicator|reflector/.test(name)) return 'lamp';
  if (/rubber|tire|tyre|weatherstrip/.test(name)) return 'rubber';
  if (/chrome|alloy/.test(name) || (material instanceof THREE.MeshStandardMaterial && material.metalness >= 0.5))
    return 'metal';
  return 'paint';
}

/** A light ramp for MeshToonMaterial, one texel per level. It samples the red channel at `dot * 0.5 + 0.5`. */
export function toonGradient(levels: readonly number[] = TOON_LEVELS): THREE.DataTexture {
  const texture = new THREE.DataTexture(Uint8Array.from(levels), levels.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draws the scene cel-shaded (#206). For the length of a frame it swaps every lit material for a MeshToonMaterial
 * copy and shifts light from the fill to the sun, then puts everything back, so game code keeps owning, animating
 * and disposing its own materials and lights. What a material is made of (maps, vertex colours, sides) is copied
 * once; what the game animates (colour, emissive, opacity) is copied every frame.
 * Ink lines are the one lasting change: meshes under an object flagged with INK_FLAG get a line child, once.
 * Unlit and custom materials (sky, blob shadows, sparks, markers) are drawn as they are. A lit material with its own
 * shader patch (the water) keeps its material too, but is lit by the shifted lights like everything else.
 */
export class ToonStyle {
  private readonly gradients = new Map<Finish, THREE.DataTexture>();
  private readonly toons = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();
  private readonly toonArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly inkGeometries = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private readonly inked = new WeakSet<THREE.Mesh>();
  private readonly inkMaterial = new THREE.LineBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: INK_OPACITY,
    depthWrite: false,
  });
  private readonly pullInk = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\nmvPosition.xyz *= ${(1 - INK_PULL).toFixed(6)};\ngl_Position = projectionMatrix * mvPosition;`,
    );
  };
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
      this.disposeWith(object.geometry, edges);
    }
    const lines = new THREE.LineSegments(edges, this.inkMaterial);
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
    const toon = this.toonFor(material);
    if (toon === material) return;
    this.swapped.push(object);
    this.originals.push(material);
    object.material = toon;
  };

  constructor(private readonly renderer: Renderer) {
    this.inkMaterial.onBeforeCompile = this.pullInk;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    try {
      scene.traverse(this.swapIn); // inside the try: a throw halfway through the swap is put back too
      this.renderer.render(scene, camera);
    } finally {
      for (let i = 0; i < this.swapped.length; i++) this.swapped[i].material = this.originals[i];
      for (let i = 0; i < this.lights.length; i++) this.lights[i].intensity = this.intensities[i];
      this.swapped.length = 0;
      this.originals.length = 0;
      this.lights.length = 0;
      this.intensities.length = 0;
    }
  }

  /** Frees a geometry's ink lines with it, so line buffers don't build up as meshes come and go. */
  private disposeWith(source: THREE.BufferGeometry, edges: THREE.BufferGeometry) {
    const dispose = () => {
      source.removeEventListener('dispose', dispose);
      this.inkGeometries.delete(source);
      edges.dispose();
    };
    source.addEventListener('dispose', dispose);
  }

  private scaleLight(light: THREE.Light, scale: number) {
    this.lights.push(light);
    this.intensities.push(light.intensity);
    light.intensity *= scale;
  }

  private toonFor(material: MeshMaterial): MeshMaterial {
    if (!Array.isArray(material)) return this.toonForOne(material);
    let toons = this.toonArrays.get(material);
    if (!toons) {
      toons = material.map(m => this.toonForOne(m));
      this.toonArrays.set(material, toons);
    } else for (let i = 0; i < material.length; i++) toons[i] = this.toonForOne(material[i]); // keeps them in sync
    return toons;
  }

  private toonForOne(material: THREE.Material): THREE.Material {
    if (!isLit(material)) return material;
    let toon = this.toons.get(material);
    if (!toon) {
      toon = this.createToon(material);
      this.toons.set(material, toon);
    }
    toon.color.copy(material.color);
    toon.emissive.copy(material.emissive);
    toon.emissiveIntensity = material.emissiveIntensity;
    toon.opacity = material.opacity;
    toon.visible = material.visible;
    return toon;
  }

  private gradientFor(finish: Finish): THREE.DataTexture {
    let gradient = this.gradients.get(finish);
    if (!gradient) {
      gradient = toonGradient(FINISH_LEVELS[finish]);
      this.gradients.set(finish, gradient);
    }
    return gradient;
  }

  private createToon(source: LitMaterial): THREE.MeshToonMaterial {
    const toon = new THREE.MeshToonMaterial({
      name: source.name,
      gradientMap: this.gradientFor(finishOf(source)),
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
    // not a MeshToonMaterial property in three's types, but the renderer reads it off any material and the toon shader
    // has the define: faceted meshes (the shore stones) stay faceted
    (toon as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading = source.flatShading;
    source.addEventListener('dispose', () => toon.dispose());
    return toon;
  }
}
