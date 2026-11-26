// ?lab=rapier (#54, docs/rapier-trial.md): loads Rapier and runs its world beside the game's own collisions. Rapier
// comes as a file of its own, vendor/rapier.mjs beside the page (vite.config.ts), fetched only when the flag is on: an
// ordinary import would put its 1.65 MB inside every player's page, flag or no flag.
import * as THREE from 'three';
import type { WorldData } from '../world/data';
import type { FurnitureKind, FurnitureModelId } from '../world/furniture/definitions';
import type { FurniturePlacement } from '../world/furniture/placement';
import { FURNITURE_MODELS, type StreetFurniture } from '../world/mesh/street-furniture';
import { PhysicsProps } from './render/physics-props';
import type { CarBody } from './sim/car-body';
import { PhysicsWorld, type PhysicsWorldOptions, type PropSpec, type Rapier } from './sim/physics-world';

/** what a car can knock over, and what each weighs (kg) */
const PROP_MASS_KG: Partial<Record<FurnitureKind, number>> = {
  mailbox: 12,
  'mailbox-stand': 40,
  'wheelie-bin': 25,
  'waste-bin': 15,
  'street-lamp': 120, // a steel pole, which on a real road is built to break away from its foot when a car hits it
};
/** a street lamp collides as its pole, this thick (m): the model's box would reach out to the end of its arm */
const LAMP_POLE_M = 0.2;

export interface RapierLabDeps {
  scene: THREE.Scene;
  data: WorldData;
  heightfield: PhysicsWorldOptions['heightfield'];
  /** the ground the furniture is drawn on: curbs, road lifts and floors included */
  groundAt(x: number, z: number): number;
  placements: readonly FurniturePlacement[];
  furniture: Pick<StreetFurniture, 'detach' | 'reattach'>;
  cars: readonly CarBody[];
  player: { x: number; z: number };
  inCar(): boolean;
  /** the car the player drives, while in one */
  playerCar(): { x: number; z: number } | null;
  /** runs a function once every frame, after the cars and the player have moved */
  addFrameUpdate(update: (dt: number) => void): void;
}

/** What the trial measured, for the test hook and the PR's numbers. */
export interface RapierLabState {
  /** from asking for the file until Rapier was ready (ms) */
  loadMs: number;
  /** building the world: the ground, the walls and the props (ms) */
  buildMs: number;
  props: number;
  /** the props a car has come near, which Rapier holds */
  readonly joined: number;
  /** the props knocked loose, each drawn on its own from then on */
  readonly loose: number;
  readonly awake: number;
  /** the last frame's physics steps (ms) */
  readonly stepMs: number;
  /** the steps run since the world was built */
  readonly steps: number;
}

/** A model's size: across, front to back and up from its foot (m), from its own geometry, as a stand's width depends on its boxes. */
const modelSize = (() => {
  const sizes = new Map<FurnitureModelId, { widthM: number; depthM: number; heightM: number }>();
  return (id: FurnitureModelId) => {
    let size = sizes.get(id);
    if (!size) {
      const model = FURNITURE_MODELS[id](),
        box = new THREE.Box3().setFromBufferAttribute(model.body.getAttribute('position') as THREE.BufferAttribute);
      size = { widthM: box.max.x - box.min.x, depthM: box.max.z - box.min.z, heightM: box.max.y };
      model.body.dispose();
      model.glass?.dispose();
      sizes.set(id, size);
    }
    return size;
  };
})();

export async function startRapierLab(g: RapierLabDeps): Promise<RapierLabState> {
  const t0 = performance.now();
  const url = new URL('vendor/rapier.mjs', document.baseURI).href;
  const R = ((await import(/* @vite-ignore */ url)) as { default: Rapier }).default;
  await R.init();
  const loadMs = performance.now() - t0;

  const placements: FurniturePlacement[] = [],
    specs: PropSpec[] = [];
  for (const p of g.placements) {
    const massKg = PROP_MASS_KG[p.kind];
    if (massKg === undefined) continue;
    const model = modelSize(p.modelId),
      size = p.kind === 'street-lamp' ? { ...model, widthM: LAMP_POLE_M, depthM: LAMP_POLE_M } : model;
    placements.push(p);
    specs.push({
      x: p.x,
      z: p.z,
      rotationY: p.rotationY,
      baseY: g.groundAt(p.x, p.z),
      widthM: size.widthM * p.scale,
      depthM: size.depthM * p.scale,
      heightM: size.heightM * p.scale,
      massKg,
    });
  }
  const t1 = performance.now();
  const world = new PhysicsWorld(R, { data: g.data, heightfield: g.heightfield, props: specs });
  const buildMs = performance.now() - t1;
  const draw = new PhysicsProps({
    scene: g.scene,
    furniture: g.furniture,
    world,
    placements,
    heights: specs.map(s => s.heightM),
  });
  const now = () => performance.now();
  g.addFrameUpdate(dt => {
    world.follow(g.cars, g.inCar() ? null : g.player, g.playerCar() ?? g.player);
    world.step(dt, now);
    draw.update();
  });
  console.info(
    `Lab: rapier ready in ${Math.round(loadMs)} ms, its world built in ${Math.round(buildMs)} ms, ${specs.length} props`,
  );
  return {
    loadMs,
    buildMs,
    props: specs.length,
    get joined() {
      return world.joined.length;
    },
    get loose() {
      return world.loosened.length;
    },
    get awake() {
      return world.awakeProps;
    },
    get stepMs() {
      return world.stepMs;
    },
    get steps() {
      return world.steps;
    },
  };
}
