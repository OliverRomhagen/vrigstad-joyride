<!-- Skroten, the scrapyard from #346, as a scene: the game's own yard (skroten-yard.ts) and meshes (render/skroten.ts), and
     the car you look at standing on Plåt-Pelle's ring. He talks from behind the camera, so the car has the stage. `index`
     picks the car from VEHICLES; a new one drives in as the old one drives out. -->
<script lang="ts">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BODY_NODE, VEHICLES } from '#game/render/vehicle-registry';
import { RING_UV, yardLayout, yardToWorld } from '#game/skroten-yard';
import { col } from '#world/three-legacy';
import { GAME_URL } from './site';

let {
  footprints,
  index,
  paint,
  margins,
  carShown,
  carFailed,
  sceneFailed,
}: {
  footprints: { p: number[] }[];
  index: number;
  paint?: string;
  /** how much of the window the page's header covers at the top and its card at the bottom (px): the scene is framed in between */
  margins: { top: number; bottom: number };
  /** the picked car stands on the ring */
  carShown: () => void;
  /** the picked car's model didn't load; picking it again tries again */
  carFailed: () => void;
  /** the scene itself didn't start, so no car will show until the page reloads */
  sceneFailed: () => void;
} = $props();

const SWAP_S = 0.9; // how long a car takes to drive off the ring, and the next one to drive on
const SWAP_M = 14; // how far along the yard they drive
const TURN_RAD_S = 0.12; // the ring turns the car slowly, so you see it from all sides without dragging
const HORIZON = '#d9a27a'; // the fog: sRGB, as the game's (three applies fog after the colour space conversion)
const CAR_R_M = 3; // half the width round the car on the ring that the camera keeps in frame
const CAR_HALF_H_M = 1.5; // half the height it keeps in frame: the car and the ground just around it
const MAX_DIST_M = 26; // how far you can zoom out, unless the window needs more to fit the car
const ZOOM_OUT = 1.4; // and then this much past the fitted distance
const VIEW_MIN = 0.35; // the share of the window's height the scene keeps however tall the header and card are

let showCar: ((i: number) => void) | undefined;
let repaint: ((color: string | undefined) => void) | undefined;
let reframe: ((m: { top: number; bottom: number }) => void) | undefined;

// these hand the picked car, the paint and the page's margins to the scene once it runs; until then start() reads them
// itself. Read the prop before the call: `f?.(x)` skips x while f is unset, and the effect would never track it. showCar,
// repaint and reframe read no state, and showCar tells the page how the car loads through the callbacks, after the load.
$effect(() => {
  const i = index;
  showCar?.(i);
});
$effect(() => {
  const p = paint;
  repaint?.(p);
});
$effect(() => {
  const m = { top: margins.top, bottom: margins.bottom };
  reframe?.(m);
});

// an attachment: runs in the browser once the element exists, and its cleanup runs when the element goes (never while
// prerendering). It reads no state, so it runs once; start() runs after the imports, outside any effect.
function scene(host: HTMLDivElement) {
  let stop = () => {};
  let unmounted = false;
  // render/skroten.ts draws textures on a canvas when it loads, so it is imported on demand
  // both imports load at once (one .then for render/skroten, so Fallow can see SkrotenMeshes used)
  const look = import('./game-look');
  import('#game/render/skroten')
    .then(async ({ SkrotenMeshes }) => {
      const lookModule = await look;
      if (unmounted) return; // left the page before the imports finished: nothing to start, nothing to dispose
      stop = start(host, SkrotenMeshes, lookModule);
    })
    .catch(err => {
      // such as a chunk gone after a deploy: say so, rather than "loading" for ever
      console.warn('Wiki: the garage failed to start', err);
      if (!unmounted) sceneFailed();
    });
  return () => {
    unmounted = true;
    stop();
  };
}

function start(
  host: HTMLDivElement,
  SkrotenMeshes: typeof import('#game/render/skroten').SkrotenMeshes,
  { gameRenderer, addGameLights, GRASS }: typeof import('./game-look'),
) {
  // the registry's paths (media/vehicles/…) are the game's: load the models from the game, served next to the wiki, so they
  // aren't a second copy in the wiki and are cached from playing. render/skroten.ts loads the yard's cars through three's shared
  // loading manager, so the paths are mapped there. It stays set when the garage closes: a yard car may still be loading, and
  // the mapping is the same for every visit.
  THREE.DefaultLoadingManager.setURLModifier(url => (url.startsWith('media/vehicles/') ? GAME_URL + url : url));
  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = gameRenderer(host, coarse);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 60, 220);
  const ring = yardToWorld(RING_UV.u, RING_UV.v);
  addGameLights(scene, { x: ring.x, y: 0, z: ring.z }, 45);

  // the land around the yard, flat: the wiki doesn't load the terrain
  const land = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshLambertMaterial({ color: col(GRASS) }));
  land.rotation.x = -Math.PI / 2;
  land.position.set(ring.x, -0.03, ring.z);
  land.receiveShadow = true;
  scene.add(land);

  const flat = () => 0;
  // every car model, fetched and parsed once and shared by the yard and the ring, as VehicleVisuals.template does in the
  // game; each user clones it. A failed load is forgotten, so asking for that car again tries again.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const models = new Map<string, Promise<THREE.Group>>();
  const carModel = (def: { id: string; url: string }) => {
    let model = models.get(def.id);
    if (!model) {
      model = loader.loadAsync(def.url).then(
        gltf => gltf.scene,
        err => {
          models.delete(def.id);
          throw err;
        },
      );
      models.set(def.id, model);
    }
    return model;
  };
  // the yard sets its own shadows, as in the game (none cast on a phone). Plåt-Pelle stands beside the ring, where he would
  // take the stage from the car: he is left out, and talks from behind the camera (the page's bubble)
  const yard = new SkrotenMeshes({
    scene,
    heightAt: flat,
    layout: yardLayout(footprints, flat),
    coarse,
    carModel,
    showOwner: false,
  });

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const from = yardToWorld(5.5, 2.5);
  camera.position.set(from.x, 2.3, from.z);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(ring.x, 0.8, ring.z);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxPolarAngle = Math.PI * 0.47;

  // ---------- the car on the ring ----------
  const ringCars = new Map<string, Promise<THREE.Group>>();
  const owned = new Set<THREE.Material>();
  const along = (() => {
    const a = yardToWorld(1, RING_UV.v);
    return new THREE.Vector3(a.x - ring.x, 0, a.z - ring.z).normalize();
  })();
  type Swap = { car: THREE.Group; from: number; to: number; t: number };
  let current: THREE.Group | undefined;
  let currentIndex = -1;
  let swaps: Swap[] = [];
  let wanted = -1;
  // set when the garage closes: a car still loading then is left out of the scene, and the page isn't told
  let stopped = false;
  let paintNow: string | undefined;
  const offsetOf = (s: Swap) => {
    const e = s.t < 0.5 ? 2 * s.t * s.t : 1 - (-2 * s.t + 2) ** 2 / 2; // ease in and out
    return s.from + (s.to - s.from) * e;
  };

  // the ring's own copy of each car, made once, so a car driving out can be taken over where it is (showCar)
  const load = (i: number) => {
    const def = VEHICLES[i];
    let car = ringCars.get(def.id);
    if (!car) {
      car = carModel(def).then(
        model => {
          const g = new THREE.Group();
          g.add(model.clone(true)); // shares the geometry and materials; repaint clones the materials it changes
          g.traverse(o => {
            if (!(o instanceof THREE.Mesh)) return;
            o.castShadow = !coarse; // as the yard's and the road's cars: none cast on a phone
            o.receiveShadow = true;
          });
          return g;
        },
        err => {
          ringCars.delete(def.id); // so picking the car again tries again
          throw err;
        },
      );
      ringCars.set(def.id, car);
    }
    return car;
  };

  repaint = color => {
    paintNow = color;
    // the paint is for the picked car: while it loads, the car still on the ring keeps its own, and showCar paints the new one
    if (currentIndex !== wanted || VEHICLES[currentIndex]?.police) return;
    const body = current?.getObjectByName(BODY_NODE);
    if (!body || !color) return;
    body.traverse(node => {
      if (!(node instanceof THREE.Mesh) || (node !== body && !node.name.startsWith(`${BODY_NODE}_`))) return;
      const recolor = (m: THREE.MeshStandardMaterial) => {
        const own = owned.has(m) ? m : m.clone();
        owned.add(own);
        own.color.set(color).convertSRGBToLinear();
        return own;
      };
      node.material = Array.isArray(node.material) ? node.material.map(recolor) : recolor(node.material);
    });
  };

  showCar = async i => {
    if (i === wanted) return;
    const first = wanted < 0;
    // the shorter way round the ring, so wrapping from the last car to the first still drives in from the right side
    const n = VEHICLES.length;
    const forward = (i - wanted + n) % n <= n / 2;
    wanted = i;
    let car: THREE.Group;
    try {
      car = await load(i);
    } catch {
      if (i === wanted && !stopped) carFailed();
      return;
    }
    if (stopped || i !== wanted) return; // the garage closed, or another pick came, while this one loaded
    // picked back the car still on the ring before the other one came: it stays, or it would both leave and arrive
    if (car === current) {
      carShown();
      return;
    }
    // the models are cached, so this car may still be driving out from a moment ago: take it over where it is
    const prior = swaps.find(s => s.car === car);
    swaps = swaps.filter(s => s.car !== car);
    const startOffset = prior ? offsetOf(prior) : forward ? -SWAP_M : SWAP_M;
    if (current) {
      const arriving = swaps.find(s => s.car === current); // still driving in: leave from where it is
      swaps = swaps.filter(s => s.car !== current);
      swaps.push({ car: current, from: arriving ? offsetOf(arriving) : 0, to: forward ? SWAP_M : -SWAP_M, t: 0 });
    }
    current = car;
    currentIndex = i;
    car.rotation.y = -0.6; // nose towards the gate, where you stand
    scene.add(car);
    swaps.push({ car, from: first ? 0 : startOffset, to: 0, t: first ? 1 : 0 });
    repaint?.(paintNow);
    carShown();
  };
  showCar(index);
  repaint(paint);

  // ---------- the frame ----------
  const timer = new THREE.Timer();
  const you = { x: 0, z: 0 };
  let frame = 0;
  // the part of the window between the header and the card: the scene's middle is drawn in the middle of it
  let marginsNow = margins;
  const clear = (h: number) => {
    const top = Math.min(marginsNow.top, h * (1 - VIEW_MIN));
    const bottom = Math.min(marginsNow.bottom, h * (1 - VIEW_MIN) - top);
    return { top, bottom, h: h - top - bottom };
  };
  // the header or card changed height (a font loaded, a name wrapped): move the image to the new clear part, and back off if
  // the car no longer fits in it, keeping your zoom otherwise
  reframe = m => {
    marginsNow = m;
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    fitCamera(w, h, true);
    const view = clear(h);
    camera.setViewOffset(w, h, 0, (view.bottom - view.top) / 2, w, h);
    camera.updateProjectionMatrix();
  };
  // fits what to show in that part, keeping the angle you look from: on each resize, so a window of any shape shows it all.
  // With `backOffOnly`, it only moves the camera back, and only when it is too close
  const fitCamera = (w: number, h: number, backOffOnly = false) => {
    const view = clear(h);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // far enough to fit it across the window, and up and down in the clear part
    const across = CAR_R_M / (tanHalf * (w / h));
    const upDown = CAR_HALF_H_M / ((tanHalf * view.h) / h);
    const dist = Math.max(controls.minDistance, across, upDown);
    controls.maxDistance = Math.max(MAX_DIST_M, dist * ZOOM_OUT);
    const offset = camera.position.clone().sub(controls.target);
    if (backOffOnly && offset.length() >= dist) return;
    const dir = offset.normalize();
    controls.target.set(ring.x, 0.8, ring.z);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
  };
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // a narrow screen backs off, so the car still fits across
    camera.fov = w < h ? 58 : 42;
    fitCamera(w, h);
    reframe?.(marginsNow);
    controls.update();
    // setSize clears the canvas: draw again now, before the browser paints, or the page's background flashes through
    renderer.render(scene, camera);
  };
  const fit = new ResizeObserver(resize);
  fit.observe(host);
  const loop = () => {
    frame = requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    for (const s of swaps) {
      s.t = Math.min(1, s.t + dt / SWAP_S);
      const off = offsetOf(s);
      s.car.position.set(ring.x + along.x * off, 0, ring.z + along.z * off);
      if (s.t === 1 && s.to !== 0) scene.remove(s.car);
    }
    swaps = swaps.filter(s => s.t < 1);
    if (current && !swaps.some(s => s.car === current)) current.rotation.y += TURN_RAD_S * dt;
    you.x = camera.position.x;
    you.z = camera.position.z;
    yard.update(dt, you); // swaps the yard's cars for their models once you are near
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    fit.disconnect();
    controls.dispose();
    timer.dispose();
    renderer.dispose();
    // dispose() keeps the WebGL context, and browsers allow only a few: going back and forth to the garage would use them up
    renderer.forceContextLoss();
    renderer.domElement.remove();
    showCar = repaint = reframe = undefined;
  };
}
</script>

<div class="skroten-scene" {@attach scene} aria-label="Skroten, the scrapyard, in 3D: drag to look around" role="img"></div>
