import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// The look follows the "Kraftig" (bold) cel shading of the art direction lab (v20).
// Light per quarter of MeshToonMaterial's ramp, which it samples at `dot * 0.5 + 0.5` (dot of normal and light
// direction): facing away, turning away, turning towards and facing the light. 0-255.
export const TOON_LEVELS = [9, 45, 132, 255] as const;
// Without roughness and metalness, a car's materials only differ by colour. Each finish gets its own ramp instead,
// picked from the material's name (the GLB exports name them) or its metalness.
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
// PCF shadow blur in shadow-map texels: none, so cast shadows end as hard as the light bands
export const TOON_SHADOW_RADIUS = 0;
const OUTLINE_THICKNESS = 0.0045; // clip-space units: OutlineEffect scales by depth, so outlines keep their width on screen
const OUTLINE_RGB = [0.06, 0.05, 0.04]; // linear RGB, as OutlineEffect takes it
// Ink lines along the hard creases of inked objects (cars): edges where faces meet at more than this angle
const INK_CREASE_DEG = 34;
const INK_COLOR = 0x10151c;
const INK_OPACITY = 0.67;
const INK_INFLATE = 1.002; // lines sit just outside the surface, so they don't z-fight with it
const CONTACT_SHADOW_PX = 64;
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
const shadowOf = (light: THREE.Light) => (light instanceof THREE.DirectionalLight ? light.shadow : null);
const isOpaque = (material: MeshMaterial) =>
  Array.isArray(material) ? material.every((m) => !m.transparent) : !material.transparent;

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

/** The contact shadow under cars and people in the toon style: a flat ellipse with a hard rim, not a soft blob. */
export function toonContactShadow(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CONTACT_SHADOW_PX;
  const context = canvas.getContext('2d');
  if (context) {
    const mid = CONTACT_SHADOW_PX / 2;
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(mid, mid, mid * 0.86, 0, Math.PI * 2);
    context.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

// OutlineEffect ignores instance transforms, so instanced meshes (trees) get their own inverted hull: a back-face
// copy that shares the instances and is pushed out along the normal in clip space, the way OutlineEffect does it.
function hullMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(OUTLINE_RGB[0], OUTLINE_RGB[1], OUTLINE_RGB[2]),
    side: THREE.BackSide,
    toneMapped: false,
  });
  material.userData.outlineParameters = { visible: false };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: OUTLINE_THICKNESS };
    shader.vertexShader = 'uniform float outlineThickness;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        vec4 hullDirection = projectionMatrix * vec4( normalize( normalMatrix * mat3( instanceMatrix ) * normal ), 0.0 );
        gl_Position.xy += normalize( hullDirection.xy ) * outlineThickness * gl_Position.w;
      #endif`,
    );
  };
  return material;
}

/**
 * Draws the scene cel-shaded (#206). For the length of a frame it swaps every lit material for a MeshToonMaterial
 * copy, shifts light from the fill to the sun, and then puts everything back, so game code keeps owning, animating
 * and disposing its own materials and lights. What a material is made of (maps, vertex colours, sides) is copied
 * once; what the game animates (colour, emissive, opacity) is copied every frame.
 * Ink lines are the one lasting change: meshes under an object flagged with INK_FLAG get a line child, once.
 */
export class ToonStyle {
  private readonly gradients = new Map<Finish, THREE.DataTexture>();
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
  private readonly hulled = new WeakSet<THREE.InstancedMesh>();
  private hull: THREE.MeshBasicMaterial | null = null;
  private readonly swapped: THREE.Mesh[] = [];
  private readonly originals: MeshMaterial[] = [];
  private readonly lights: THREE.Light[] = [];
  private readonly intensities: number[] = [];
  private readonly radii: number[] = [];
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
    else if (object instanceof THREE.DirectionalLight) this.scaleLight(object, TOON_SUN_SCALE, TOON_SHADOW_RADIUS);
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh && this.outline) this.addHull(object);
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
      for (let i = 0; i < this.lights.length; i++) {
        const light = this.lights[i];
        light.intensity = this.intensities[i];
        const shadow = shadowOf(light);
        if (shadow) shadow.radius = this.radii[i];
      }
      this.swapped.length = 0;
      this.originals.length = 0;
      this.lights.length = 0;
      this.intensities.length = 0;
      this.radii.length = 0;
    }
  }

  private addHull(mesh: THREE.InstancedMesh) {
    if (this.hulled.has(mesh)) return;
    this.hulled.add(mesh);
    if (Array.isArray(mesh.material) || !isLit(mesh.material) || mesh.material.transparent) return;
    this.hull ??= hullMaterial();
    const hull = new THREE.InstancedMesh(mesh.geometry, this.hull, mesh.count);
    hull.instanceMatrix = mesh.instanceMatrix; // shared, so the hulls follow the instances
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    hull.boundingSphere = mesh.boundingSphere; // and are culled with them
    hull.raycast = () => {};
    mesh.add(hull);
  }

  private scaleLight(light: THREE.Light, scale: number, shadowRadius?: number) {
    this.lights.push(light);
    this.intensities.push(light.intensity);
    const shadow = shadowOf(light);
    this.radii.push(shadow ? shadow.radius : 0);
    light.intensity *= scale;
    if (shadow && shadowRadius !== undefined) shadow.radius = shadowRadius;
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

  private gradientFor(finish: Finish): THREE.DataTexture {
    let gradient = this.gradients.get(finish);
    if (!gradient) {
      gradient = toonGradient(FINISH_LEVELS[finish]);
      this.gradients.set(finish, gradient);
    }
    return gradient;
  }

  private createToon(source: LitMaterial, instanced: boolean): THREE.MeshToonMaterial {
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
