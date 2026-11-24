// The game's look for the wiki's 3D scenes: its renderer settings and daytime lights (src/game/render/stage.ts), the stage
// every scene of the wiki's stands on, and a small scene around one model on a patch of grass that turns slowly.
// Browser only: import it on demand, from an attachment.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GAME_SHADOW_M, gameLights, SUN_DIR, setUpRenderer } from '#game/render/stage';
// importing three-legacy turns colour management off, as the game's colours expect
import { col } from '#world/three-legacy';

/** The game's daytime lights (render/stage.ts), the sun from the game's direction, its shadow covering `reach` m around `at`. */
export function addGameLights(scene: THREE.Scene, at: THREE.Vector3Like, reach: number) {
  const { hemi, sun } = gameLights();
  scene.add(hemi);
  sun.target.position.set(at.x, at.y, at.z);
  sun.position
    .copy(SUN_DIR)
    .multiplyScalar(reach * 3)
    .add(sun.target.position);
  Object.assign(sun.shadow.camera, {
    left: -reach,
    right: reach,
    top: reach,
    bottom: -reach,
    near: 0.5,
    far: reach * 6,
  });
  // the game's offset is about half a texel of its 220 m box; in a 6 m preview the same metres would lift a cat off its shadow
  sun.shadow.normalBias *= reach / GAME_SHADOW_M;
  scene.add(sun, sun.target);
}

/** The grass the wiki's scenes stand on: sRGB, as the game's colours. */
export const GRASS = 0x6b7a48;

/**
 * What every 3D scene of the wiki's shares: a renderer set up as the game's, drawing into `host`, a camera you turn by
 * dragging, the size following `host`, and one loop that stops when the scene is disposed. A scene adds its meshes and lights
 * to `scene` and sets `frame` and `resized` for what is its own.
 */
export class Stage {
  /** a touch screen: no antialiasing, and the scenes cast fewer shadows, as in the game */
  readonly coarse = matchMedia('(pointer: coarse)').matches;
  /** the visitor asked for less motion: nothing turns or drives by itself */
  readonly still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** you are dragging the scene round just now */
  dragging = false;
  /** you have dragged the scene round: what turned by itself stays still from then on, until a scene sets this back */
  hasDragged = false;
  /** Called every frame before it is drawn, with the seconds since the last one. */
  frame: (dt: number) => void = () => {};
  /** Called when `host` changes size, after the renderer and the camera's aspect have followed it. */
  resized: (width: number, height: number) => void = () => {};

  private readonly timer = new THREE.Timer();
  private readonly fit: ResizeObserver;
  private readonly seen: IntersectionObserver;
  private onScreen = true;
  private request = 0;

  constructor(
    private readonly host: HTMLElement,
    view: { fov: number; near: number; far: number },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.coarse, alpha: true });
    setUpRenderer(this.renderer, this.coarse);
    host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(view.fov, 1, view.near, view.far);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    // `start` comes with a finger or the pointer going down, before it has moved: a tap, or a finger that goes on to scroll
    // the page, isn't a drag. The camera moving while it is down is.
    this.controls.addEventListener('start', () => {
      this.dragging = true;
    });
    this.controls.addEventListener('change', () => {
      if (this.dragging) this.hasDragged = true;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
    });
    this.fit = new ResizeObserver(() => this.resize());
    this.fit.observe(host);
    // draw only while the scene is on screen
    this.seen = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
    });
    this.seen.observe(host);
  }

  /** Starts drawing: call it once the scene is built. */
  start() {
    const loop = () => {
      this.request = requestAnimationFrame(loop);
      this.timer.update();
      if (!this.onScreen) return;
      this.frame(Math.min(this.timer.getDelta(), 0.1));
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return; // hidden: a size of 0 would make the camera's aspect NaN
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.resized(width, height);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    // setSize clears the canvas: draw again now, before the browser paints, or the page's background flashes through
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.request);
    this.fit.disconnect();
    this.seen.disconnect();
    this.controls.dispose();
    this.timer.dispose();
    this.renderer.dispose();
    // dispose() keeps the WebGL context, and browsers allow only a few: going back and forth between pages would use them up
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

const TURN_RAD_S = 0.35; // the model turns slowly, so you see it from all sides without dragging
const PERSON_M = 1.83; // Plåt-Pelle's height, to the top of his cap: the camera's numbers below are set for him
const LENGTH_TO_HEIGHT = 1.4; // a long animal is framed as a person this many times its length would be

/** Starts the scene in `host` and returns what stops it. The camera frames the model, facing −z, by its height. */
export function startPreview(host: HTMLElement, model: THREE.Object3D): () => void {
  const turntable = new THREE.Group();
  turntable.add(model);
  // the model's own body, measured and casting the shadow: not its soft blob shadow, a see-through plane that would cast a
  // hard square of its own and add its width to the model's
  const body = new THREE.Box3();
  model.updateMatrixWorld(true);
  const part = new THREE.Box3();
  model.traverse(o => {
    if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).transparent) return;
    o.castShadow = true;
    // the mesh's own geometry: expandByObject would take in its children too, and the cat's shadow is a child of its body
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    body.union(part.copy(o.geometry.boundingBox as THREE.Box3).applyMatrix4(o.matrixWorld));
  });

  // Plåt-Pelle fills the frame at these numbers; anything else gets them scaled by its size: by its height, or by its length
  // for an animal that is longer than it is tall (a cat), so that it fills about as much of a phone's wider frame as a person
  const size = body.getSize(new THREE.Vector3());
  const k = Math.max(size.y, LENGTH_TO_HEIGHT * Math.max(size.x, size.z)) / PERSON_M || 1;
  const stage = new Stage(host, { fov: 35, near: 0.1 * k, far: 50 });
  const { scene, camera, controls } = stage;
  addGameLights(scene, { x: 0, y: 0, z: 0 }, 3);

  const grassGeo = new THREE.CircleGeometry(3, 40);
  const grassMat = new THREE.MeshLambertMaterial({ color: col(GRASS) });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass, turntable);

  camera.position.set(1.4 * k, 1.5 * k, -3.6 * k); // in front, a little to one side, at eye height
  controls.target.set(0, (0.95 / PERSON_M) * size.y, 0); // Plåt-Pelle's chest, at 0.95 m; the same share of a cat's height
  controls.minDistance = 1.6 * k;
  controls.maxDistance = 7 * k;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  if (stage.coarse) {
    // the model sits in the page's text on a phone: a finger moving up or down scrolls the page, as anywhere else on it, and
    // one moving sideways turns the model. So it turns round only, at the height the camera starts from, and doesn't zoom.
    stage.renderer.domElement.style.touchAction = 'pan-y';
    controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle();
    controls.enableZoom = false;
  }

  stage.frame = dt => {
    if (!stage.still && !stage.hasDragged) turntable.rotation.y += TURN_RAD_S * dt;
  };
  stage.start();

  return () => {
    stage.dispose();
    grassGeo.dispose();
    grassMat.dispose();
    // the model's materials and most of its geometry are the game's shared ones (render/models.ts caches them), so they stay;
    // what a builder makes fresh each call (Plåt-Pelle's cap and beard) is a few boxes, left to the garbage collector
  };
}
