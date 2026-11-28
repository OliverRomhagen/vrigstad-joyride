// Ragdolls (#35): a pedestrian your car hits at speed flies, tumbles and lies still for a moment, then gets up and runs back
// to where they were walking, and someone calls the police. The physics is in ./sim/ragdoll.ts and the drawing in
// ./render/ragdoll-meshes.ts; this file decides who goes down and hands them back to the crowd.
import { makeRnd } from '../world/random';
import { LOST_MAX_S, type Npc } from './pedestrians';
import {
  type HitCar,
  knockOver,
  type Pusher,
  type Ragdoll,
  type RagdollWorld,
  ragdollCentre,
  STEP_S,
  stepRagdoll,
} from './sim/ragdoll';

const RAGDOLL_MAX = 6,
  RAGDOLL_MAX_COARSE = 3; // at most this many at once (six draw calls each); on a touch screen. More hits just push people aside
const MAX_STEPS = 4; // physics steps per frame at most, so a slow frame doesn't snowball
const CAR_PUSH_M = 1.6; // your car shoves a lying body within this radius of its middle (m)
const NO_PUSHERS: readonly Pusher[] = []; // on foot, nothing shoves the bodies; shared, so no frame allocates one
const STAR_COOL_S = 3; // everyone knocked over within this long (s) of a star counts as the same crash: one star, not one each

/** What the ragdolls read from the rest of the game. The getters are read when used. */
export interface RagdollDeps {
  world: RagdollWorld;
  crowd: { readonly npcs: readonly Npc[] };
  coarse: boolean;
  /** your car, when you drive one; only your car knocks people over */
  readonly pcar: HitCar | null;
  /** you knocked someone over and it costs you a star */
  knockedDown(): void;
}

/** One knocked-over pedestrian and the physics that moves them. */
export interface KnockedDown {
  npc: Npc;
  r: Ragdoll;
  /** the points before the last physics step (as r.pos) */
  was: number[];
  /** where to draw the points this frame: between `was` and r.pos by how far the frame is into the next step, so a body
   * moves on every frame, not only on the frames a step falls on (every other one on a 120 Hz screen) */
  shown: number[];
}

/** The pedestrians knocked over by your car. */
export class Ragdolls {
  /** the people down right now; the renderer draws these */
  readonly bodies: KnockedDown[] = [];
  private readonly g: RagdollDeps;
  private readonly max: number;
  private readonly rnd = makeRnd(3535); // own stream: how each one tumbles doesn't shift the game's rolls
  private readonly pushers: Pusher[] = [{ x: 0, z: 0, r: CAR_PUSH_M }];
  private acc = 0; // s of physics not stepped yet
  private starCool = 0; // s until a knock-down can give another star

  constructor(g: RagdollDeps) {
    this.g = g;
    this.max = g.coarse ? RAGDOLL_MAX_COARSE : RAGDOLL_MAX;
  }

  /** How many are down right now. */
  get count(): number {
    return this.bodies.length;
  }

  /** The crowd's hit hook: knocks n over if `car` is yours and fast enough, and there's room for one more. An arrow, so it can be passed on. */
  readonly hit = (n: Npc, car: { x: number; z: number }): boolean => {
    const pcar = this.g.pcar;
    if (car !== pcar || !pcar || this.bodies.length >= this.max) return false;
    const r = knockOver(n, pcar, this.g.world, this.rnd, n.scale);
    if (!r) return false;
    this.bodies.push({ npc: n, r, was: r.pos.slice(), shown: r.pos.slice() });
    if (this.starCool <= 0) {
      this.starCool = STAR_COOL_S;
      this.g.knockedDown();
    }
    return true;
  };

  /**
   * Knocks n over with a push that is no car: a shot (lab: pickadoll). The push goes (dx, dz), a unit vector along the
   * ground, at `speedMs`. No star: the caller decides what a hit costs. A stand-in until #342 gives a ragdoll a push of its own:
   * it throws them as a bumper would, from one step behind them.
   */
  readonly push = (n: Npc, dx: number, dz: number, speedMs: number): boolean => {
    if (n.down || this.bodies.length >= this.max) return false;
    const from = { x: n.x - dx, z: n.z - dz, v: speedMs, vh: Math.atan2(dx, -dz) };
    const r = knockOver(n, from, this.g.world, this.rnd, n.scale);
    if (!r) return false;
    n.down = true;
    this.bodies.push({ npc: n, r, was: r.pos.slice(), shown: r.pos.slice() });
    return true;
  };

  /** Steps the physics on a fixed timestep and hands back the ones that are up again. */
  update(dt: number): void {
    const { world, crowd, pcar } = this.g;
    if (this.starCool > 0) this.starCool -= dt;
    this.acc += dt;
    const steps = Math.min(MAX_STEPS, Math.floor(this.acc / STEP_S));
    this.acc = steps === MAX_STEPS ? 0 : this.acc - steps * STEP_S;
    const pushers = pcar ? this.pushers : NO_PUSHERS;
    if (pcar) {
      this.pushers[0].x = pcar.x;
      this.pushers[0].z = pcar.z;
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (!crowd.npcs.includes(b.npc)) {
        this.bodies.splice(i, 1); // despawned while down
        continue;
      }
      for (let s = 0; s < steps; s++) {
        copyInto(b.was, b.r.pos);
        stepRagdoll(b.r, world, pushers);
      }
      if (b.r.state === 'done') {
        standUp(b);
        this.bodies.splice(i, 1);
        continue;
      }
      blend(b, this.acc / STEP_S);
    }
  }
}

function copyInto(to: number[], from: readonly number[]) {
  for (let i = 0; i < from.length; i++) to[i] = from[i];
}

// not r.prev: the ground and the walls change that to set the speed, so it isn't always where the point was
function blend({ r, was, shown }: KnockedDown, alpha: number) {
  for (let i = 0; i < shown.length; i++) shown[i] = was[i] + (r.pos[i] - was[i]) * alpha;
}

// back to the crowd where they got up, running back to their path rather than snapping to it
function standUp({ npc, r }: KnockedDown) {
  const { x, z } = ragdollCentre(r);
  npc.x = x;
  npc.z = z;
  npc.h = r.h;
  npc.idle = 0;
  npc.down = false;
  npc.lost = LOST_MAX_S;
}
