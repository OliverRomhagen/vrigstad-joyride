// Skroten, the scrapyard from #346, as a scene: the game's own yard (skroten-yard.ts) and meshes (render/skroten.ts), and
// the car you look at standing on Plåt-Pelle's ring. He talks from behind the camera, so the car has the stage. A new car
// drives in as the old one drives out. Browser only: render/skroten.ts draws textures on a canvas when it loads, so import
// this on demand, from an attachment (Skroten.svelte).
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkrotenMeshes } from '#game/render/skroten';
import { BODY_NODE, VEHICLES } from '#game/render/vehicle-registry';
import { RING_UV, yardLayout, yardToWorld } from '#game/skroten-yard';
import { col } from '#world/three-legacy';
import { addGameLights, GRASS, Stage } from './game-look';
import { GAME_URL } from './site';

const SWAP_S = 0.9; // how long a car takes to drive off the ring, and the next one to drive on
const SWAP_M = 14; // how far along the yard they drive
const TURN_RAD_S = 0.12; // the ring turns the car slowly, so you see it from all sides without dragging
const HORIZON = '#d9a27a'; // the fog: sRGB, as the game's (three applies fog after the colour space conversion)
const CAR_R_M = 3; // half the width round the car on the ring that the camera keeps in frame
const CAR_HALF_H_M = 1.5; // half the height it keeps in frame: the car and the ground just around it
const MAX_DIST_M = 26; // how far you can zoom out, unless the window needs more to fit the car
const ZOOM_OUT = 1.4; // and then this much past the fitted distance
const VIEW_MIN = 0.35; // the share of the window's height the scene keeps however tall the header and card are
const LOOK_AT_M = 0.8; // the height above the ring the camera looks at
const ARRIVE_S = 1.4; // how long the camera takes to ease in on the first car, as the yard fades in
const ARRIVE_ZOOM = 0.93; // how wide it starts, as a share of its zoom once it has arrived

/** How much of the window the page's header covers at the top and its card at the bottom (px): the scene is framed in between. */
export type Margins = { top: number; bottom: number };

/** What the scene reads from the page. */
export interface GarageSceneDeps {
  host: HTMLElement;
  /** the outlines of Skroten's hall and carport, from the map's data */
  footprints: { p: number[] }[];
  /** the picked car stands on the ring */
  carShown(): void;
  /** the picked car's model didn't load; picking it again tries again */
  carFailed(): void;
}

type Swap = { car: THREE.Group; from: number; to: number; t: number };

const flat = () => 0; // the wiki doesn't load the terrain: the yard stands on level ground
const offsetOf = (s: Swap) => {
  const e = s.t < 0.5 ? 2 * s.t * s.t : 1 - (-2 * s.t + 2) ** 2 / 2; // ease in and out
  return s.from + (s.to - s.from) * e;
};

/** The yard and the car on its ring; `showCar`, `repaint` and `reframe` follow the page, `dispose` ends it. */
export class GarageScene {
  private readonly stage: Stage;
  private readonly ring = yardToWorld(RING_UV.u, RING_UV.v);
  /** the way the cars drive on and off the ring, along the yard */
  private readonly along: THREE.Vector3;
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // every car model, fetched and parsed once and shared by the yard and the ring, as VehicleVisuals.template does in the
  // game; each user clones it. A failed load is forgotten, so asking for that car again tries again.
  private readonly models = new Map<string, Promise<THREE.Group>>();
  // the ring's own copy of each car, made once, so a car driving out can be taken over where it is (showCar)
  private readonly ringCars = new Map<string, Promise<THREE.Group>>();
  /** the materials repaint has cloned, so a second coat reuses them */
  private readonly owned = new Set<THREE.Material>();
  private current: THREE.Group | undefined;
  private currentIndex = -1;
  private swaps: Swap[] = [];
  private wanted = -1;
  // set when the garage closes: a car still loading then is left out of the scene, and the page isn't told
  private stopped = false;
  private paint: string | undefined;
  private margins: Margins = { top: 0, bottom: 0 };
  /** how far the camera has eased in on the first car, 0 to 1; 1 before it starts too, when the yard isn't shown yet */
  private arrived = 1;

  constructor(private readonly g: GarageSceneDeps) {
    // the registry's paths (media/vehicles/…) are the game's: load the models from the game, served next to the wiki, so they
    // aren't a second copy in the wiki and are cached from playing. render/skroten.ts loads the yard's cars through three's shared
    // loading manager, so the paths are mapped there. It stays set when the garage closes: a yard car may still be loading, and
    // the mapping is the same for every visit.
    THREE.DefaultLoadingManager.setURLModifier(url => (url.startsWith('media/vehicles/') ? GAME_URL + url : url));
    const stage = new Stage(g.host, { fov: 42, near: 0.1, far: 600 });
    this.stage = stage;
    const { scene, camera, controls } = stage;
    const { ring } = this;
    scene.fog = new THREE.Fog(HORIZON, 60, 220);
    addGameLights(scene, { x: ring.x, y: 0, z: ring.z }, 45);

    // the land around the yard, flat
    const land = new THREE.Mesh(
      new THREE.CircleGeometry(400, 48),
      new THREE.MeshLambertMaterial({ color: col(GRASS) }),
    );
    land.rotation.x = -Math.PI / 2;
    land.position.set(ring.x, -0.03, ring.z);
    land.receiveShadow = true;
    scene.add(land);

    // the yard sets its own shadows, as in the game (none cast on a phone). Plåt-Pelle stands beside the ring, where he would
    // take the stage from the car: he is left out, and talks from behind the camera (the page's bubble)
    let yard: SkrotenMeshes;
    try {
      yard = new SkrotenMeshes({
        scene,
        heightAt: flat,
        layout: yardLayout(g.footprints, flat),
        coarse: stage.coarse,
        carModel: def => this.carModel(def),
        showOwner: false,
      });
    } catch (err) {
      // nobody gets this scene to dispose when its constructor throws: give the canvas and its WebGL context back here
      stage.dispose();
      throw err;
    }

    const from = yardToWorld(5.5, 2.5);
    camera.position.set(from.x, 2.3, from.z);
    controls.target.set(ring.x, LOOK_AT_M, ring.z);
    controls.minDistance = 4;
    controls.maxPolarAngle = Math.PI * 0.47;
    const a = yardToWorld(1, RING_UV.v);
    this.along = new THREE.Vector3(a.x - ring.x, 0, a.z - ring.z).normalize();

    const you = { x: 0, z: 0 };
    stage.frame = dt => {
      if (this.arrived < 1) {
        this.arrived = Math.min(1, this.arrived + dt / ARRIVE_S);
        // fast at first, then settling: the zoom alone, so your own dragging and the window's fit go on under it
        camera.zoom = ARRIVE_ZOOM + (1 - ARRIVE_ZOOM) * (1 - (1 - this.arrived) ** 3);
        camera.updateProjectionMatrix();
      }
      for (const s of this.swaps) {
        s.t = Math.min(1, s.t + dt / SWAP_S);
        const off = offsetOf(s);
        s.car.position.set(ring.x + this.along.x * off, 0, ring.z + this.along.z * off);
        if (s.t === 1 && s.to !== 0) scene.remove(s.car);
      }
      this.swaps = this.swaps.filter(s => s.t < 1);
      const arrived = this.current && !this.swaps.some(s => s.car === this.current);
      if (this.current && arrived && !stage.still && !stage.hasDragged) this.current.rotation.y += TURN_RAD_S * dt;
      you.x = camera.position.x;
      you.z = camera.position.z;
      yard.update(dt, you); // swaps the yard's cars for their models once you are near
    };
    stage.resized = (width, height) => {
      // a narrow screen backs off, so the car still fits across
      camera.fov = width < height ? 58 : 42;
      this.fitCamera(width, height);
      this.offsetView(width, height);
    };
    stage.start();
  }

  private carModel(def: { id: string; url: string }) {
    let model = this.models.get(def.id);
    if (!model) {
      model = this.loader.loadAsync(def.url).then(
        gltf => gltf.scene,
        err => {
          this.models.delete(def.id);
          throw err;
        },
      );
      this.models.set(def.id, model);
    }
    return model;
  }

  private ringCar(i: number) {
    const def = VEHICLES[i];
    let car = this.ringCars.get(def.id);
    if (!car) {
      car = this.carModel(def).then(
        model => {
          const group = new THREE.Group();
          group.add(model.clone(true)); // shares the geometry and materials; repaint clones the materials it changes
          group.traverse(o => {
            if (!(o instanceof THREE.Mesh)) return;
            o.castShadow = !this.stage.coarse; // as the yard's and the road's cars: none cast on a phone
            o.receiveShadow = true;
          });
          return group;
        },
        err => {
          this.ringCars.delete(def.id); // so picking the car again tries again
          throw err;
        },
      );
      this.ringCars.set(def.id, car);
    }
    return car;
  }

  /** Paints the picked car's body; with no colour it keeps the model's own. */
  repaint(color: string | undefined) {
    this.paint = color;
    // the paint is for the picked car: while it loads, the car still on the ring keeps its own, and showCar paints the new one
    if (this.currentIndex !== this.wanted || VEHICLES[this.currentIndex]?.police) return;
    const body = this.current?.getObjectByName(BODY_NODE);
    if (!body || !color) return;
    const recolor = (m: THREE.MeshStandardMaterial) => {
      const own = this.owned.has(m) ? m : m.clone();
      this.owned.add(own);
      own.color.set(color).convertSRGBToLinear();
      return own;
    };
    body.traverse(node => {
      if (!(node instanceof THREE.Mesh) || (node !== body && !node.name.startsWith(`${BODY_NODE}_`))) return;
      node.material = Array.isArray(node.material) ? node.material.map(recolor) : recolor(node.material);
    });
  }

  /** Puts car `i` of VEHICLES on the ring: it drives in as the one before drives out, and the page hears how it went. */
  async showCar(i: number) {
    if (i === this.wanted) return;
    const first = this.wanted < 0;
    // the shorter way round the ring, so wrapping from the last car to the first still drives in from the right side
    const n = VEHICLES.length;
    const forward = (i - this.wanted + n) % n <= n / 2;
    this.wanted = i;
    let car: THREE.Group;
    try {
      car = await this.ringCar(i);
    } catch {
      if (i === this.wanted && !this.stopped) this.g.carFailed();
      return;
    }
    if (this.stopped || i !== this.wanted) return; // the garage closed, or another pick came, while this one loaded
    // picked back the car still on the ring before the other one came: it stays, or it would both leave and arrive
    if (car === this.current) {
      this.g.carShown();
      return;
    }
    // with less motion asked for, a car is on the ring or off it, with no drive between
    const t = first || this.stage.still ? 1 : 0;
    // the models are cached, so this car may still be driving out from a moment ago: take it over where it is
    const prior = this.swaps.find(s => s.car === car);
    this.swaps = this.swaps.filter(s => s.car !== car);
    const startOffset = prior ? offsetOf(prior) : forward ? -SWAP_M : SWAP_M;
    const leaving = this.current;
    if (leaving) {
      const arriving = this.swaps.find(s => s.car === leaving); // still driving in: leave from where it is
      this.swaps = this.swaps.filter(s => s.car !== leaving);
      this.swaps.push({ car: leaving, from: arriving ? offsetOf(arriving) : 0, to: forward ? SWAP_M : -SWAP_M, t });
    }
    this.current = car;
    this.currentIndex = i;
    car.rotation.y = -0.6; // nose towards the gate, where you stand
    this.stage.scene.add(car);
    this.stage.hasDragged = false; // a new car turns on the ring again, until you drag it round yourself
    this.swaps.push({ car, from: first ? 0 : startOffset, to: 0, t });
    // the first car is what the yard fades in on (Skroten.svelte): the camera comes in on it meanwhile, unless less
    // motion is asked for
    if (first && !this.stage.still) {
      this.arrived = 0;
      this.stage.camera.zoom = ARRIVE_ZOOM;
      this.stage.camera.updateProjectionMatrix();
    }
    this.repaint(this.paint);
    this.g.carShown();
  }

  /**
   * The header or card changed height (a font loaded, a name wrapped): moves the image to the new clear part, and backs off
   * if the car no longer fits in it, keeping your zoom otherwise.
   */
  reframe(margins: Margins) {
    this.margins = margins;
    const { clientWidth: width, clientHeight: height } = this.g.host;
    if (!width || !height) return;
    this.fitCamera(width, height, true);
    this.offsetView(width, height);
    this.stage.camera.updateProjectionMatrix();
  }

  // the part of the window between the header and the card: the scene's middle is drawn in the middle of it
  private clear(height: number) {
    const top = Math.min(this.margins.top, height * (1 - VIEW_MIN));
    const bottom = Math.min(this.margins.bottom, height * (1 - VIEW_MIN) - top);
    return { top, bottom, height: height - top - bottom };
  }

  private offsetView(width: number, height: number) {
    const view = this.clear(height);
    this.stage.camera.setViewOffset(width, height, 0, (view.bottom - view.top) / 2, width, height);
  }

  // fits what to show in the clear part, keeping the angle you look from: on each resize, so a window of any shape shows it
  // all. With `backOffOnly`, it only moves the camera back, and only when it is too close
  private fitCamera(width: number, height: number, backOffOnly = false) {
    const { camera, controls } = this.stage;
    const view = this.clear(height);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // far enough to fit it across the window, and up and down in the clear part
    const across = CAR_R_M / (tanHalf * (width / height));
    const upDown = CAR_HALF_H_M / ((tanHalf * view.height) / height);
    const dist = Math.max(controls.minDistance, across, upDown);
    controls.maxDistance = Math.max(MAX_DIST_M, dist * ZOOM_OUT);
    const offset = camera.position.clone().sub(controls.target);
    if (backOffOnly && offset.length() >= dist) return;
    const dir = offset.normalize();
    controls.target.set(this.ring.x, LOOK_AT_M, this.ring.z);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
  }

  dispose() {
    this.stopped = true;
    this.stage.dispose();
  }
}
