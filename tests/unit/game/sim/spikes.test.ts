import { describe, expect, it } from 'vitest';
import { HitKind } from '../../../../src/game/sim/shots';
import {
  dropSpike,
  newSpikeStep,
  SPIKE_OFF_WALL_M,
  SPIKE_S,
  SPIKES_MAX,
  type Spike,
  type SpikeWorld,
  stepSpikes,
  tyreHit,
  wheelOver,
} from '../../../../src/game/sim/spikes';

const flat = () => 0;
const spike = (x = 0, z = 0): Spike => ({ x, y: 0, z, turn: 0, leftS: SPIKE_S });
const world = (over: Partial<SpikeWorld> = {}): SpikeWorld => ({ cars: [], people: [], walker: null, ...over });

describe('dropSpike', () => {
  it("lies on the ground where it fell, at the ground's height", () => {
    const spikes: Spike[] = [];
    dropSpike(spikes, { kind: HitKind.GROUND, x: 3, z: -4, nx: 0, nz: 0 }, (x, z) => x + z, 0.25);
    expect(spikes).toEqual([{ x: 3, y: -1, z: -4, turn: 0.25, leftS: SPIKE_S }]);
  });

  it('drops out from a wall or a car it hit, the way the surface faces', () => {
    const spikes: Spike[] = [];
    dropSpike(spikes, { kind: HitKind.WALL, x: 0, z: -20, nx: 0, nz: 1 }, flat, 0);
    dropSpike(spikes, { kind: HitKind.CAR, x: 5, z: 0, nx: -1, nz: 0 }, flat, 0);
    expect(spikes[0]).toMatchObject({ x: 0, z: -20 + SPIKE_OFF_WALL_M });
    expect(spikes[1]).toMatchObject({ x: 5 - SPIKE_OFF_WALL_M, z: 0 });
  });

  it('lets the oldest go when there are too many', () => {
    const spikes: Spike[] = [];
    for (let i = 0; i <= SPIKES_MAX; i++)
      dropSpike(spikes, { kind: HitKind.GROUND, x: i, z: 0, nx: 0, nz: 0 }, flat, 0);
    expect(spikes).toHaveLength(SPIKES_MAX);
    expect(spikes[0].x).toBe(1);
  });
});

describe('stepSpikes', () => {
  it('is used up by a car that rolls over it, and left alone by one that stands on it', () => {
    const spikes = [spike()],
      parked = { x: 0.5, z: 0, v: 0, h: 0 },
      out = newSpikeStep();
    stepSpikes(spikes, 0.1, world({ cars: [parked] }), out);
    expect(out).toMatchObject({ cars: [], changed: false });
    parked.v = -3; // reversing counts
    stepSpikes(spikes, 0.1, world({ cars: [{ x: 9, z: 9, v: 10, h: 0 }, parked] }), out);
    expect(out).toMatchObject({ cars: [1], wheels: [0], changed: true }); // the spike at the origin is on its left
    expect(spikes).toEqual([]);
  });

  it('is stepped on by everyone who comes by, but not by someone lying down', () => {
    const spikes = [spike()],
      people = [
        { x: 0.3, z: 0 },
        { x: 0, z: 0.2, down: true },
        { x: 2, z: 0 },
        { x: 0, z: -0.4 },
      ],
      out = stepSpikes(spikes, 0.1, world({ people }), newSpikeStep());
    expect(out.people).toEqual([0, 3]);
    expect(spikes).toHaveLength(1); // a foot doesn't use it up
  });

  it('catches you on foot, and not in a jump or a car', () => {
    const spikes = [spike()],
      out = newSpikeStep();
    expect(stepSpikes(spikes, 0.1, world({ walker: { x: 0.2, z: 0.2 } }), out).walker).toBe(true);
    expect(stepSpikes(spikes, 0.1, world({ walker: null }), out).walker).toBe(false);
    expect(stepSpikes(spikes, 0.1, world({ walker: { x: 3, z: 0 } }), out).walker).toBe(false);
  });

  it('catches nobody with a spike a car used up in the same step', () => {
    const out = stepSpikes(
      [spike()],
      0.1,
      world({ cars: [{ x: 0, z: 0, v: 5, h: 0 }], people: [{ x: 0, z: 0 }], walker: { x: 0, z: 0 } }),
      newSpikeStep(),
    );
    expect(out).toMatchObject({ cars: [0], people: [], walker: false });
  });

  it('is gone when its time is up', () => {
    const spikes = [spike(), { ...spike(5), leftS: 0.05 }],
      out = stepSpikes(spikes, 0.1, world({ walker: { x: 5, z: 0 } }), newSpikeStep());
    expect(spikes).toHaveLength(1);
    expect(out).toMatchObject({ changed: true, walker: false });
  });

  it('forgets what the step before found', () => {
    const spikes = [spike()],
      out = newSpikeStep();
    stepSpikes(spikes, 0.1, world({ people: [{ x: 0, z: 0 }], walker: { x: 0, z: 0 } }), out);
    stepSpikes(spikes, 0.1, world(), out);
    expect(out).toEqual(newSpikeStep());
  });
});

describe('tyreHit', () => {
  // a car facing north, its axles 1.5 m ahead of its centre and 1.4 m behind it
  const car = { x: 0, z: 0, h: 0, T: { handling: { wheelbaseM: 2.9, rearAxleM: 1.4 } } };

  it('names the tyre a low hit by an axle lands on', () => {
    expect(tyreHit(car, { x: -0.9, z: -1.5 }, 0.3)).toBe(0); // front left
    expect(tyreHit(car, { x: 0.9, z: 1.7 }, 0.4)).toBe(3); // rear right
  });

  it('is none for a hit on the body: too high, or between the axles', () => {
    expect(tyreHit(car, { x: -0.9, z: -1.5 }, 1)).toBeNull();
    expect(tyreHit(car, { x: -0.9, z: 0 }, 0.3)).toBeNull();
  });

  it("follows each car's own axles, as a tractor's with its rear axle far back", () => {
    const tractor = { ...car, T: { handling: { wheelbaseM: 2.2, rearAxleM: 1.7 } } }; // 0.5 m ahead, 1.7 m behind
    expect(tyreHit(tractor, { x: 0.9, z: -0.5 }, 0.3)).toBe(1);
    expect(tyreHit(tractor, { x: -0.9, z: 1.7 }, 0.7)).toBe(2);
    expect(tyreHit(tractor, { x: 0.9, z: -1.5 }, 0.3)).toBeNull();
  });
});

describe('wheelOver', () => {
  it('names the wheel on the side of the car the point is on', () => {
    const north = { x: 0, z: 0, h: 0 },
      east = { x: 0, z: 0, h: Math.PI / 2 };
    expect(wheelOver(north, { x: -0.8, z: -1.2 })).toBe(0); // front left
    expect(wheelOver(north, { x: 0.8, z: -1.2 })).toBe(1); // front right
    expect(wheelOver(north, { x: -0.8, z: 1.2 })).toBe(2); // rear left
    expect(wheelOver(north, { x: 0.8, z: 1.2 })).toBe(3); // rear right
    expect(wheelOver(east, { x: 1.2, z: 0.8 })).toBe(1); // facing east, south is on the right
  });
});
