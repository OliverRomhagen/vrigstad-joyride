import { describe, expect, it } from 'vitest';
import { DMG_MAX } from '../../../src/game/health';
import { MAX_STARS, type PoliceCar, Wanted, type WantedDeps } from '../../../src/game/police';
import { makeRnd } from '../../../src/world/random';
import type { RoadNetwork } from '../../../src/world/roads';

// A road that is a single point 300 m east of the target at the origin, inside the 200–480 m spawn ring, so every police car spawns there.
// The police don't move unless a test moves them: `drive` only records what it was asked.
function wanted() {
  const rnd = makeRnd(1);
  const roads = {
    lines: [
      {
        p: [
          [300, 0],
          [300, 0],
        ],
        c: 0,
      },
    ],
    driveable: [0],
  } as unknown as Pick<RoadNetwork, 'lines' | 'driveable'>;
  const toasts: string[] = [],
    driven: { thr: number; steer: number; brake: boolean }[] = [];
  const world = { lyingLow: false, caught: 0, removed: 0, evading: false };
  const deps: WantedDeps = {
    roads,
    rnd,
    pick: a => a[Math.floor(rnd() * a.length)],
    spawnCar: (x, z, h): PoliceCar => ({ x, z, h, v: 0, rev: 0, stuck: 0, revSteer: 1, dmg: 0 }),
    removeCar: () => {
      world.removed++;
    },
    drive: (_c, thr, steer, brake) => {
      driven.push({ thr, steer, brake });
    },
    toast: msg => {
      toasts.push(msg);
    },
    drawStars: () => {},
    showEvading: on => {
      world.evading = on;
    },
    caught: () => {
      world.caught++;
    },
    get lyingLow() {
      return world.lyingLow;
    },
  };
  return { w: new Wanted(deps), toasts, driven, world };
}
const target = { x: 0, z: 0 };
// runs `secs` of frames at 10 ms, or until `stop`
function run(w: Wanted, secs: number, speed = 0, stop = () => false) {
  for (let t = 0; t < secs && !stop(); t += 0.01) w.update(0.01, target, speed);
}

describe('Wanted', () => {
  it('adds a star at a time, up to three, and toasts the reason', () => {
    const { w, toasts } = wanted();
    for (let i = 0; i < 5; i++) w.addStar(i === 0 ? 'Seen.' : undefined);
    expect(w.stars).toBe(MAX_STARS);
    expect(toasts).toEqual(['Seen.']);
  });

  it('sends one police car per star, out on the roads', () => {
    const { w } = wanted();
    expect(w.update(0.01, target, 0)).toBe(false);
    w.addStar();
    w.addStar();
    expect(w.update(0.01, target, 0)).toBe(true);
    expect(w.police).toHaveLength(2);
    expect(w.police[0]).toMatchObject({ x: 300, z: 0 });
  });

  it('loses the police after 18 s further than 170 m from all of them', () => {
    const { w, toasts, world } = wanted();
    w.addStar();
    run(w, 3);
    expect(world.evading).toBe(true);
    run(w, 14.9);
    expect(w.stars).toBe(1); // still wanted just before 18 s
    run(w, 1.2, 0, () => w.stars === 0);
    expect(w.stars).toBe(0);
    expect(w.police).toHaveLength(0);
    expect(world.removed).toBe(1);
    expect(world.evading).toBe(false);
    expect(toasts).toContain('You lost them.');
  });

  it('starts evading over when a police car comes within 170 m', () => {
    const { w } = wanted();
    w.addStar();
    run(w, 10);
    expect(w.evade).toBeGreaterThan(9);
    w.police[0].x = 100;
    w.update(0.01, target, 0);
    expect(w.evade).toBe(0);
  });

  it('gets you caught after 1.6 s with a police car on you while you are slow, not while you drive off', () => {
    const { w, world } = wanted();
    w.addStar();
    w.update(0.01, target, 0);
    w.police[0].x = 5;
    run(w, 1, 10);
    expect(w.bust).toBe(0);
    run(w, 1.5);
    expect(world.caught).toBe(0);
    run(w, 0.2, 0, () => world.caught > 0);
    expect(world.caught).toBe(1);
    expect(w.stars).toBe(0);
  });

  it('gives up while you lie low in a safehouse, even with a police car next to it', () => {
    const { w, toasts, world } = wanted();
    w.addStar();
    w.update(0.01, target, 0);
    w.police[0].x = 5;
    world.lyingLow = true;
    w.lieLow(2);
    run(w, 2.1, 0, () => w.stars === 0);
    expect(w.stars).toBe(0);
    expect(world.caught).toBe(0);
    expect(toasts).toContain('The police gave up. The coast is clear.');
  });

  it('says only that you lost them when the safehouse timer runs out in the same frame', () => {
    const { w, toasts, world } = wanted();
    w.addStar();
    w.update(0.01, target, 0); // the police car is 300 m away
    world.lyingLow = true;
    w.lieLow(0.005);
    w.evade = 18;
    w.update(0.01, target, 0);
    expect(w.stars).toBe(0);
    expect(toasts).toEqual(['You lost them.']);
  });

  it('backs a stuck police car out, then drives at you again', () => {
    const { w, driven } = wanted();
    w.addStar();
    w.update(0.01, target, 0);
    run(w, 1.2);
    expect(w.police[0].rev).toBeGreaterThan(0);
    expect(driven.at(-1)?.thr).toBe(-1);
    run(w, 1.3);
    expect(driven.at(-1)?.thr).toBeGreaterThan(0);
  });

  it('sends a new police car for a wrecked one, and the wreck neither chases nor keeps you from losing them', () => {
    const { w, driven } = wanted();
    w.addStar();
    w.update(0.01, target, 0);
    const wreck = w.police[0];
    wreck.dmg = DMG_MAX;
    wreck.x = 5; // wrecked right next to you
    w.update(0.01, target, 0);
    expect(w.police).toHaveLength(2);
    expect(driven.at(-2)).toEqual({ thr: 0, steer: 0, brake: false });
    run(w, 1, 0);
    expect(w.bust).toBe(0);
    expect(w.evade).toBeGreaterThan(0.9);
  });
});
