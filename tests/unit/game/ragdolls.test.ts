import { describe, expect, it } from 'vitest';
import { LOST_MAX_S, type Npc } from '../../../src/game/pedestrians';
import { Ragdolls } from '../../../src/game/ragdolls';
import type { HitCar } from '../../../src/game/sim/ragdoll';

// Flat ground with no houses; your car drives north (towards -z) at 14 m/s, 2 m south of each person it hits.
const flat = { groundAt: () => 0, collide: () => false };
const person = (x = 0): Npc => ({ x, z: 0, h: 0, scale: 1, idle: 0 }) as Npc;

function setUp(coarse = false) {
  const npcs: Npc[] = [];
  const drive = { pcar: { x: 0, z: 2, v: 14, vh: 0 } as HitCar | null };
  let stars = 0;
  const ragdolls = new Ragdolls({
    world: flat,
    crowd: { npcs },
    coarse,
    get pcar() {
      return drive.pcar;
    },
    knockedDown: () => stars++,
  });
  // the crowd's side of a hit: it takes the person out of its hands when the hook says so
  const hit = (n: Npc, car: HitCar | null = drive.pcar) => {
    if (!npcs.includes(n)) npcs.push(n);
    const down = ragdolls.hit(n, car ?? { x: 0, z: 2 });
    if (down) n.down = true;
    return down;
  };
  return { ragdolls, npcs, drive, hit, stars: () => stars };
}

describe('Ragdolls', () => {
  it('knocks over a person your car hits at speed, and that costs a star', () => {
    const { ragdolls, hit, stars } = setUp();
    expect(hit(person())).toBe(true);
    expect(ragdolls.count).toBe(1);
    expect(stars()).toBe(1);
  });

  it('gives one star for everyone hit in the same crash, and another for a later one', () => {
    const { ragdolls, hit, stars } = setUp();
    hit(person(0));
    hit(person(0.5));
    expect(stars()).toBe(1);
    ragdolls.update(3.1);
    hit(person(-0.5));
    expect(stars()).toBe(2);
  });

  it('leaves people to be pushed aside by other cars, by a slow car, and when on foot', () => {
    const { ragdolls, drive, hit, stars } = setUp();
    expect(hit(person(), { x: 0, z: 2, v: 14, vh: 0 })).toBe(false); // not your car
    drive.pcar = { x: 0, z: 2, v: 2, vh: 0 };
    expect(hit(person())).toBe(false);
    drive.pcar = null;
    expect(hit(person())).toBe(false);
    expect(ragdolls.count).toBe(0);
    expect(stars()).toBe(0);
  });

  it('keeps at most 6 down at once, 3 on a touch screen', () => {
    for (const [coarse, max] of [
      [false, 6],
      [true, 3],
    ] as const) {
      const { ragdolls, hit } = setUp(coarse);
      for (let i = 0; i < 8; i++) hit(person(i * 0.1));
      expect(ragdolls.count).toBe(max);
    }
  });

  it('hands them back to the crowd once they are up, running back to their path', () => {
    const { ragdolls, hit } = setUp();
    const n = person();
    hit(n);
    for (let t = 0; t < 30 && ragdolls.count; t += 1 / 60) ragdolls.update(1 / 60);
    expect(ragdolls.count).toBe(0);
    expect(n.down).toBe(false);
    expect(n.lost).toBe(LOST_MAX_S);
    expect(n.z).toBeLessThan(-1); // thrown the way the car was going
  });

  it('forgets someone who despawns while down', () => {
    const { ragdolls, npcs, hit } = setUp();
    hit(person());
    npcs.length = 0;
    ragdolls.update(1 / 60);
    expect(ragdolls.count).toBe(0);
  });
});
