import * as THREE from 'three';
import { HOUSE_SHELLS_MATERIAL } from './house-materials';
import { inkEdges } from './ink-edges';
import { INK_COLOR, INK_FLAG, INK_NO_FEET_FLAG } from './ink-flag';

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
  // the houses' shells (walls, roofs and trim): under a high sun every wall's dot is below 0.5, so the paint ramp gives
  // most walls one band and their corners vanish; six levels split them by how far each turns from the sun (#413). The
  // windows on the walls stay on the paint ramp: on this one, white frames are lit as the wall and sink into a pale one
  house: [9, 32, 72, 125, 185, 255],
} as const;
export type Finish = keyof typeof FINISH_LEVELS;
// Toon bands only shape direct light; the hemisphere fill is smooth and washes them out, so it gives way to the sun.
export const TOON_SUN_SCALE = 1.22;
export const TOON_FILL_SCALE = 0.4; // 0.52 in the lab; lower, so the walls turned from the sun fall a band darker (#413)
// Ink lines, as the lab draws them: along the edges where faces meet at more than this angle, so boxes and car
// panels get lines and smooth curves don't. Only under objects flagged with INK_FLAG: rigid things, not terrain,
// roads or trees.
const INK_CREASE_DEG = 34;
const INK_OPACITY = 0.67;
// Lines are drawn this fraction of their distance closer to the camera, along the line of sight: the same place on
// screen, but in front of the surface they sit on, so they don't flicker into it. It has to beat more than the depth
// buffer's step: a 1 px line covers pixel centres up to half a pixel off its edge, where the face beside it can be
// nearer than the line, and half a pixel is about 0.08% of the distance at 720p. At 0.0002 the lines lost a fifth to a
// third of their pixels, as dots along the corner boards and eaves. Every line within the pull of a surface shows
// through it, which is why the houses' buried feet get no line at all (INK_NO_FEET_FLAG), not a smaller pull.
// Scaling the lines about the mesh's origin instead moved them off meshes whose origin is far away, such as the
// village's shells (one mesh at Torget).
export const INK_PULL = 0.001;
// What the lines cost is drawing them: they were nearly all of what the style adds to a frame (#413). So the lines of
// a small thing (a car, a person, a sign: a bounding sphere under INK_SMALL_M) are drawn only this near the camera (m),
// where they are more than a pixel or two; and the lines of a mesh as wide as the village (its house shells) are cut
// into squares INK_CELL_M across, each its own object, so the ones behind the camera or off screen are culled.
/** How near the camera a small thing's ink is drawn (m): on desktop, and on a touch screen. */
export const INK_NEAR_M = 60,
  INK_NEAR_COARSE_M = 40;
const INK_SMALL_M = 20;
/** The size of the squares a wide mesh's ink is cut into (m). */
export const INK_CELL_M = 150;
const INK_SMALL_FLAG = 'inkSmall'; // on a line object's userData: its distance from the camera decides whether it's drawn

const _v = new THREE.Vector3();

// whether a mesh is inked: it or an object above it carries INK_FLAG
const underInkFlag = (object: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o.userData[INK_FLAG]) return true;
  return false;
};

/**
 * A mesh's ink lines as one geometry, or, for one wider than INK_CELL_M, cut into squares of that size by where each
 * segment's middle falls, so each square is culled on its own. Each piece has its bounding sphere.
 */
export function inkPieces(edges: THREE.BufferGeometry): THREE.BufferGeometry[] {
  edges.computeBoundingSphere();
  if ((edges.boundingSphere?.radius ?? 0) <= INK_CELL_M) return [edges];
  const pos = edges.getAttribute('position'),
    cells = new Map<string, number[]>();
  for (let i = 0; i + 1 < pos.count; i += 2) {
    const mx = (pos.getX(i) + pos.getX(i + 1)) / 2,
      mz = (pos.getZ(i) + pos.getZ(i + 1)) / 2,
      k = `${Math.floor(mx / INK_CELL_M)},${Math.floor(mz / INK_CELL_M)}`;
    let out = cells.get(k);
    if (!out) {
      out = [];
      cells.set(k, out);
    }
    out.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
  }
  edges.dispose();
  return [...cells.values()].map(out => {
    const piece = new THREE.BufferGeometry();
    piece.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    piece.computeBoundingSphere();
    return piece;
  });
}

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
  if (name === HOUSE_SHELLS_MATERIAL) return 'house'; // the window frames stay on the paint ramp, as the painted windows do (#413)
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
  private readonly inkGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry[]>();
  // apart, so a geometry two meshes share gets each its own lines, whichever is inked first
  private readonly footlessInkGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry[]>();
  // every mesh the style has looked at for ink, once: a mesh added later (a car's model, once it loads) is looked at
  // when it first turns up, and nothing is walked twice a frame
  private readonly inkChecked = new WeakSet<THREE.Mesh>();
  private readonly inkNearM: number;
  private readonly eye = new THREE.Vector3(); // the camera, this frame
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
  private addInk(object: THREE.Mesh) {
    if (!isOpaque(object.material)) return; // no lines across glass
    // read on the mesh itself, not inherited as INK_FLAG is: it says how this mesh is built
    const footless = !!object.userData[INK_NO_FEET_FLAG],
      cache = footless ? this.footlessInkGeometries : this.inkGeometries;
    let pieces = cache.get(object.geometry);
    if (!pieces) {
      pieces = inkPieces(
        footless ? inkEdges(object.geometry, INK_CREASE_DEG) : new THREE.EdgesGeometry(object.geometry, INK_CREASE_DEG),
      );
      cache.set(object.geometry, pieces);
      this.disposeWith(cache, object.geometry, pieces);
    }
    for (const piece of pieces) {
      const lines = new THREE.LineSegments(piece, this.inkMaterial);
      lines.renderOrder = 10;
      lines.raycast = () => {};
      if ((piece.boundingSphere?.radius ?? 0) < INK_SMALL_M) lines.userData[INK_SMALL_FLAG] = true;
      object.add(lines);
    }
  }
  private readonly swapIn = (object: THREE.Object3D) => {
    if (object.userData[INK_SMALL_FLAG]) {
      _v.setFromMatrixPosition(object.matrixWorld);
      object.visible = _v.distanceTo(this.eye) < this.inkNearM;
      return;
    }
    if (object instanceof THREE.Mesh && !this.inkChecked.has(object)) {
      this.inkChecked.add(object);
      if (underInkFlag(object)) this.addInk(object);
    }
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

  /** `coarse`: a touch screen, where a small thing's ink is drawn less far (INK_NEAR_COARSE_M). */
  constructor(
    private readonly renderer: Renderer,
    { coarse = false }: { coarse?: boolean } = {},
  ) {
    this.inkMaterial.onBeforeCompile = this.pullInk;
    this.inkNearM = coarse ? INK_NEAR_COARSE_M : INK_NEAR_M;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.eye.setFromMatrixPosition(camera.matrixWorld);
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
  private disposeWith(
    cache: WeakMap<THREE.BufferGeometry, THREE.BufferGeometry[]>,
    source: THREE.BufferGeometry,
    pieces: THREE.BufferGeometry[],
  ) {
    const dispose = () => {
      source.removeEventListener('dispose', dispose);
      cache.delete(source);
      for (const piece of pieces) piece.dispose();
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
      clippingPlanes: source.clippingPlanes,
      clipIntersection: source.clipIntersection,
      clipShadows: source.clipShadows,
    });
    // not a MeshToonMaterial property in three's types, but the renderer reads it off any material and the toon shader
    // has the define: faceted meshes (the shore stones) stay faceted
    (toon as THREE.MeshToonMaterial & { flatShading: boolean }).flatShading = source.flatShading;
    source.addEventListener('dispose', () => toon.dispose());
    return toon;
  }
}
