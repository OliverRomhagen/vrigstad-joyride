import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarBody } from '../../../../src/game/sim/car-body';
import {
  type PersonBody,
  PHYSICS_STEP_S,
  PhysicsWorld,
  type PropPose,
  type PropSpec,
} from '../../../../src/game/sim/physics-world';
import { physicsCast } from '../../../../src/game/sim/shot-physics';
import {
  aimShot,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotHit,
  ShotStep,
  type ShotWorld,
  sight,
  stepShot,
  WEAPONS,
  WeaponId,
} from '../../../../src/game/sim/shots';
import { BuildingKind } from '../../../../src/world/data';
import { makeWorld, square } from '../../world/fixture';

beforeAll(() => RAPIER.init());

const PICKADOLL = WEAPONS.findIndex(w => w.id === WeaponId.PICKADOLL);

// flat ground, sampled every 5 m over a 200 m square
const flat = {
  samples: 41,
  sampleCoord: (i: number) => -100 + i * 5,
  sampleHeight: () => 0,
  heightAt: () => 0,
};
const mailbox = (x: number, z: number): PropSpec => ({
  x,
  z,
  baseY: 0,
  rotationY: 0,
  widthM: 0.34,
  depthM: 0.2,
  heightM: 1.3,
  massKg: 12,
});
// a car heading north at (x, z): the game's heading h points a car at (sin h, -cos h)
const car = (x: number, z: number): CarBody => ({ x, z, h: 0, T: { lengthM: 4.8, widthM: 1.75 } });
const person = (x: number, z: number, scale = 1): PersonBody => ({ x, z, scale });

// a world with a house whose south wall is at z = -25, between x = -5 and 5; the player stands at the origin
function setUp(o: { people?: PersonBody[]; cars?: CarBody[]; props?: PropSpec[] } = {}) {
  const data = makeWorld({ b: [{ p: square(-5, -35, 10), h: 5, k: BuildingKind.OTHER }] });
  const physics = new PhysicsWorld(RAPIER, { data, heightfield: flat, props: o.props ?? [] });
  const people = o.people ?? [],
    cars = o.cars ?? [];
  const player = { x: 0, z: 0 };
  let firedFrom: CarBody | null = null;
  physics.follow(cars, player, player);
  physics.followPeople(people, player);
  physics.step(PHYSICS_STEP_S); // ray casts see what a step has put in place
  const world: ShotWorld = {
    groundAt: () => 0,
    collide: () => false, // only Rapier's walls, so a hit on one shows the ray cast found it
    people,
    cars,
  };
  world.cast = physicsCast(physics, world, () => firedFrom);
  return {
    physics,
    world,
    fireFrom(c: CarBody | null) {
      firedFrom = c;
    },
  };
}

// a shot fired north from (x, z), level, with no spread
function shot(x = 0, z = 0): Shot {
  return {
    x,
    y: MUZZLE_M,
    z,
    ...aimShot(WEAPONS[PICKADOLL], 0, 0),
    ageS: 0,
    weapon: PICKADOLL,
    bounced: 0,
    lifeS: 0,
    lying: false,
  };
}

function fly(s: Shot, w: ShotWorld): ShotHit {
  const out = newHit();
  for (let i = 0; i < 600; i++) {
    const step = stepShot(s, 1 / 60, w, out);
    if (step === ShotStep.GONE) throw new Error('out of range');
    if (step === ShotStep.HIT) return out;
  }
  throw new Error('still flying after 10 s');
}

describe('shots through the physics world', () => {
  it('hits the person in the way, by their index in the world, on the near side of them', () => {
    const { physics, world } = setUp({ people: [person(30, 0), person(0, -20)] });
    const hit = fly(shot(), world);
    expect(hit.kind).toBe('person');
    expect(hit.target).toBe(1);
    expect(hit.z).toBeGreaterThan(-20); // the capsule's south side, 0.3 m or so before their middle
    expect(hit.z).toBeLessThan(-19.5);
    physics.dispose();
  });

  it("hits a house's wall where Rapier has it", () => {
    const { physics, world } = setUp();
    const hit = fly(shot(), world);
    expect(hit.kind).toBe('wall');
    expect(hit.z).toBeCloseTo(-25, 1);
    expect(hit.nz).toBeCloseTo(1, 2); // the south wall faces south, back at the shooter
    physics.dispose();
  });

  it('passes through the player who fires it, and through the car it is fired from', () => {
    const own = car(0, 0),
      other = car(0, -20);
    const { physics, world, fireFrom } = setUp({ cars: [own, other] });
    fireFrom(own);
    world.cars = [other]; // the weapons leave the car you sit in out of their list, too
    const hit = fly(shot(0, 0), world);
    expect(hit.kind).toBe('car');
    expect(hit.target).toBe(0);
    expect(hit.z).toBeGreaterThan(-20); // its rear, not its middle
    physics.dispose();
  });

  it('leaves out people who are down, and people too far from the player', () => {
    const lying = { ...person(0, -20), down: true };
    const { physics, world } = setUp({ people: [lying, person(0, -300)] });
    expect(physics.people).toBe(0);
    expect(fly(shot(), world).kind).toBe('wall');
    physics.dispose();
  });

  it('meets a mailbox near the player, which no car has been near, and a knock sends it over', () => {
    const { physics, world } = setUp({ props: [mailbox(0, -20), mailbox(0, -60)] });
    expect(physics.joined).toEqual([0]); // 20 m from the player joins, anchored; 60 m doesn't
    const hit = fly(shot(), world);
    expect(hit.kind).toBe('prop');
    expect(hit.target).toBe(0);
    physics.knockProp(hit.target, hit.x, hit.y, hit.z, 0, 12, -40);
    for (let i = 0; i < 30; i++) physics.step(PHYSICS_STEP_S);
    const pose: PropPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    expect(physics.isLoose(0)).toBe(true);
    expect(physics.propPose(0, pose).z).toBeLessThan(-20.5); // pushed north, the way the shot flew
    physics.dispose();
  });

  it('stops a shot at the ground as drawn, where Rapier’s coarser ground would let it through', () => {
    const { physics, world } = setUp();
    world.groundAt = () => 0.5; // a curb, which Rapier's ground doesn't have
    const s = shot();
    s.vy = -5;
    const hit = fly(s, world);
    expect(hit.kind).toBe('ground');
    expect(hit.y).toBe(0.5);
    physics.dispose();
  });

  it('finds what the line of sight meets with one ray cast', () => {
    const { physics, world } = setUp({ people: [person(0, -20)] });
    const out = newHit();
    expect(sight(0, 1.2, 0, 0, 0, -1, 0.5, 160, world, out)).toBe(true);
    expect(out.kind).toBe('person');
    expect(out.dz).toBeCloseTo(-1, 6);
    physics.dispose();
  });

  it('passes through someone knocked down this frame, before their capsule leaves', () => {
    const near = person(0, -10);
    const { physics, world } = setUp({ people: [near, person(0, -20)] });
    near.down = true; // the first pellet of a spread knocked them over; followPeople hasn't run since
    const hit = fly(shot(), world);
    expect(hit.kind).toBe('person');
    expect(hit.target).toBe(1);
    physics.dispose();
  });

  it('casts safely right after a body leaves, before the next step', () => {
    const p = person(0, -20);
    const { physics, world } = setUp({ people: [p] });
    p.x = 500; // walks out of reach: their body is removed, and no step runs before the next shot
    physics.followPeople([p], { x: 0, z: 0 });
    expect(physics.people).toBe(0);
    expect(fly(shot(), world).kind).not.toBe('person');
    physics.dispose();
  });

  it('passes through a car the weapons have left out of their list', () => {
    const other = car(0, -20);
    const { physics, world } = setUp({ cars: [other] });
    world.cars = []; // say, the car you just got out of, still in the physics world this frame
    expect(fly(shot(), world).kind).toBe('wall');
    physics.dispose();
  });

  it('gives the far end of the line of sight when the ray cast meets nothing', () => {
    const { physics, world } = setUp();
    const out = newHit();
    expect(sight(0, 1.2, 0, 0, 1, 0, 0.5, 50, world, out)).toBe(false); // straight up
    expect(out.y).toBeCloseTo(51.2, 6);
    physics.dispose();
  });
});
