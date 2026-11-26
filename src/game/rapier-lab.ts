// ?lab=rapier (#54, docs/rapier-trial.md): loads Rapier and runs its world beside the game's own collisions. Rapier
// comes as a file of its own, vendor/rapier.mjs beside the page (vite.config.ts), fetched only when the flag is on: an
// ordinary import would put its 1.65 MB inside every player's page, flag or no flag.
import type * as THREE from 'three';
import type { WorldData } from '../world/data';
import type { FurnitureKind } from '../world/furniture/definitions';
import { FURNITURE } from '../world/furniture/definitions';
import type { FurniturePlacement } from '../world/furniture/placement';
import type { Heightfield } from '../world/heightfield';
import type { StreetFurniture } from '../world/mesh/street-furniture';
import { PhysicsProps } from './render/physics-props';
import type { CarBody } from './sim/car-body';
import { PhysicsWorld, type PropSpec, type Rapier } from './sim/physics-world';

/** what a car can knock over, and what each weighs (kg) */
const PROP_MASS_KG: Partial<Record<FurnitureKind, number>> = {
  mailbox: 12,
  'mailbox-stand': 40,
  'wheelie-bin': 25,
  'waste-bin': 15,
};

export interface RapierLabDeps {
  scene: THREE.Scene;
  data: WorldData;
  heightfield: Pick<Heightfield, 'heightAt'>;
  half: number;
  placements: readonly FurniturePlacement[];
  furniture: Pick<StreetFurniture, 'detach'>;
  cars: readonly CarBody[];
  player: { x: number; z: number };
  inCar(): boolean;
  /** runs a function every frame, after the cars and the player have moved */
  addStep(step: (dt: number) => void): void;
}

/** What the trial measured, for the test hook and the PR's numbers. */
export interface RapierLabState {
  /** from asking for the file until Rapier was ready (ms) */
  loadMs: number;
  /** building the world: the ground, the walls and the props (ms) */
  buildMs: number;
  props: number;
  /** the props a car or the player has come near, which Rapier simulates */
  readonly joined: number;
  readonly awake: number;
  /** the last frame's physics steps (ms) */
  readonly stepMs: number;
}

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
    const def = FURNITURE[p.kind];
    placements.push(p);
    specs.push({
      x: p.x,
      z: p.z,
      rotationY: p.rotationY,
      widthM: def.widthM * p.scale,
      depthM: def.depthM * p.scale,
      heightM: def.heightM * p.scale,
      massKg,
    });
  }
  const t1 = performance.now();
  const world = new PhysicsWorld(R, { data: g.data, heightfield: g.heightfield, half: g.half, props: specs });
  const buildMs = performance.now() - t1;
  const draw = new PhysicsProps({
    scene: g.scene,
    furniture: g.furniture,
    world,
    placements,
    heights: specs.map(s => s.heightM),
  });
  const now = () => performance.now();
  g.addStep(dt => {
    world.follow(g.cars, g.inCar() ? null : g.player);
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
    get awake() {
      return world.awakeProps;
    },
    get stepMs() {
      return world.stepMs;
    },
  };
}
