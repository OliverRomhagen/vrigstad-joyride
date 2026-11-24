// The game's look for the wiki's 3D scenes: its renderer settings and daytime lights (src/game/render/stage.ts), and a small
// scene around one model on a patch of grass that turns slowly. Browser only: import it on demand, from an attachment.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GAME_SHADOW_M, gameLights, SUN_DIR, setUpRenderer } from '#game/render/stage';
// importing three-legacy turns colour management off, as the game's colours expect
import { col } from '#world/three-legacy';

/** A renderer set up as the game's, drawing into `host`. */
export function gameRenderer(host: HTMLElement, coarse: boolean) {
  const renderer = new THREE.WebGLRenderer({ antialias: !coarse, alpha: true });
  setUpRenderer(renderer, coarse);
  host.append(renderer.domElement);
  return renderer;
}

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

const TURN_RAD_S = 0.35; // the model turns slowly, so you see it from all sides without dragging
/** The grass the wiki's scenes stand on: sRGB, as the game's colours. */
export const GRASS = 0x6b7a48;

const PERSON_M = 1.83; // Plåt-Pelle's height, to the top of his cap: the camera's numbers below are set for him
const LENGTH_TO_HEIGHT = 1.4; // a long animal is framed as a person this many times its length would be

/** Starts the scene in `host` and returns what stops it. The camera frames the model, facing −z, by its height. */
export function startPreview(host: HTMLElement, model: THREE.Object3D): () => void {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = gameRenderer(host, coarse);
  const scene = new THREE.Scene();
  addGameLights(scene, { x: 0, y: 0, z: 0 }, 3);

  const grassGeo = new THREE.CircleGeometry(3, 40);
  const grassMat = new THREE.MeshLambertMaterial({ color: col(GRASS) });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

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
  scene.add(turntable);

  // Plåt-Pelle fills the frame at these numbers; anything else gets them scaled by its size: by its height, or by its length
  // for an animal that is longer than it is tall (a cat), so that it fills about as much of a phone's wider frame as a person
  const size = body.getSize(new THREE.Vector3());
  const k = Math.max(size.y, LENGTH_TO_HEIGHT * Math.max(size.x, size.z)) / PERSON_M || 1;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1 * k, 50);
  camera.position.set(1.4 * k, 1.5 * k, -3.6 * k); // in front, a little to one side, at eye height
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, (0.95 / PERSON_M) * size.y, 0); // Plåt-Pelle's chest, at 0.95 m; the same share of a cat's height
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.6 * k;
  controls.maxDistance = 7 * k;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  let dragging = false;
  controls.addEventListener('start', () => (dragging = true));
  controls.addEventListener('end', () => (dragging = false));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const fit = new ResizeObserver(resize);
  fit.observe(host);
  // draw only while the frame is on screen
  let onScreen = true;
  const seen = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
  seen.observe(host);

  const timer = new THREE.Timer();
  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    timer.update();
    if (!onScreen) return;
    const dt = Math.min(timer.getDelta(), 0.1);
    if (!dragging) turntable.rotation.y += TURN_RAD_S * dt;
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return () => {
    cancelAnimationFrame(frame);
    fit.disconnect();
    seen.disconnect();
    controls.dispose();
    timer.dispose();
    grassGeo.dispose();
    grassMat.dispose();
    // the model's materials and most of its geometry are the game's shared ones (render/models.ts caches them), so they stay;
    // what a builder makes fresh each call (Plåt-Pelle's cap and beard) is a few boxes, left to the garbage collector
    renderer.dispose();
    // dispose() keeps the WebGL context, and browsers allow only a few
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
