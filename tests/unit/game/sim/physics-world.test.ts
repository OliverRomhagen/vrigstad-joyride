import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarBody } from '../../../../src/game/sim/car-body';
import { PHYSICS_STEP_S, PhysicsWorld, type PropPose, type PropSpec } from '../../../../src/game/sim/physics-world';
import { BuildingKind } from '../../../../src/world/data';
import { makeWorld, square } from '../../world/fixture';

beforeAll(() => RAPIER.init());

// a small world: 200 m square, with ground that slopes both ways, so a grid listed the wrong way round shows
const HALF = 100;
const sloped = { heightAt: (x: number, z: number) => 0.1 * x + 0.02 * z };
const flat = { heightAt: () => 0 };
// hills a few metres high and tens of metres apart, as in the village
const bumpy = { heightAt: (x: number, z: number) => 3 * Math.sin(x / 13) + 2 * Math.cos(z / 7) };
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
// a Volvo-sized car heading east: the game's heading h points a car at (sin h, -cos h)
const car = (x: number): CarBody => ({ x, z: 0, h: Math.PI / 2, T: { lengthM: 4.8, widthM: 1.75 } });
const pose = (): PropPose => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });

describe('PhysicsWorld', () => {
  it('lays the ground where the heightfield says, both ways round', () => {
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: sloped, half: HALF, props: [] });
    for (const [x, z] of [
      [60, -40],
      [-30, 70],
      [0, 0],
    ]) {
      const down = w.castRay(x, 100, z, 0, -1, 0, 500);
      expect(down, `at (${x}, ${z})`).not.toBeNull();
      expect(100 - (down ?? 0), `at (${x}, ${z})`).toBeCloseTo(sloped.heightAt(x, z), 1);
    }
    w.dispose();
  });

  it("stands a building's walls up from its outline", () => {
    const data = makeWorld({ b: [{ p: square(20, -5, 10), h: 5, k: BuildingKind.OTHER }] });
    const w = new PhysicsWorld(RAPIER, { data, heightfield: flat, half: HALF, props: [] });
    // from the west, 2 m up, towards the wall at x 20
    expect(w.castRay(0, 2, 0, 1, 0, 0, 100)).toBeCloseTo(20, 2);
    // over the roof's edge, nothing
    expect(w.castRay(0, 8, 0, 1, 0, 0, 100)).toBeNull();
    w.dispose();
  });

  it('leaves the props out of the world until a car or the player comes near', () => {
    const props = [mailbox(10, 0), mailbox(60, 0)];
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: bumpy, half: HALF, props });
    for (let i = 0; i < 30; i++) w.step(PHYSICS_STEP_S);
    expect(w.joined).toEqual([]);
    w.follow([], { x: 0, z: 0 });
    expect(w.joined).toEqual([0]); // 10 m away, not the one 60 m away
    w.dispose();
  });

  it('anchors a prop that joins on uneven ground where it stands, until something touches it', () => {
    // 25 mailboxes on a 3 m grid round the player, none where the player stands, turned every which way, all within
    // PROP_JOIN_M (12 m)
    const props = Array.from({ length: 25 }, (_, i) => ({
      ...mailbox(-4.5 + (i % 5) * 3, -4.5 + Math.floor(i / 5) * 3),
      baseY: bumpy.heightAt(-4.5 + (i % 5) * 3, -4.5 + Math.floor(i / 5) * 3),
      rotationY: i,
    }));
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: bumpy, half: HALF, props });
    w.follow([], { x: 0, z: 0 });
    expect(w.joined).toHaveLength(25);
    for (let i = 0; i < 180; i++) w.step(PHYSICS_STEP_S);
    expect(w.awakeProps).toBe(0);
    for (let i = 0; i < 25; i++) expect(w.isLoose(i), `prop ${i}`).toBe(false);
    w.dispose();
  });

  it('sends a mailbox flying when a car drives through it', () => {
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: flat, half: HALF, props: [mailbox(10, 0)] });
    const c = car(0);
    // 15 m/s, about 54 km/h, for a second
    for (let i = 0; i < 60; i++) {
      c.x += 15 * PHYSICS_STEP_S;
      w.follow([c], null);
      w.step(PHYSICS_STEP_S);
    }
    const p = w.propPose(0, pose());
    expect(Math.hypot(p.x - 10, p.z)).toBeGreaterThan(2); // knocked metres from where it stood
    expect(Math.abs(p.qw)).toBeLessThan(0.99); // and turned over
    expect(w.isLoose(0)).toBe(true);
    w.dispose();
  });

  it("knocks a mailbox about as far at 15 fps as at 60, a frame's move spread over its steps", () => {
    const thrown = (fps: number) => {
      const w = new PhysicsWorld(RAPIER, {
        data: makeWorld({}),
        heightfield: flat,
        half: HALF,
        props: [mailbox(10, 0)],
      });
      const c = car(0);
      for (let t = 0; t < 1.5; t += 1 / fps) {
        c.x += 15 / fps;
        w.follow([c], null);
        w.step(1 / fps);
      }
      const p = w.propPose(0, pose());
      w.dispose();
      return Math.hypot(p.x - 10, p.z);
    };
    const at60 = thrown(60),
      at15 = thrown(15);
    expect(at15).toBeGreaterThan(at60 * 0.6);
    expect(at15).toBeLessThan(at60 * 1.6);
  });

  it('runs fixed steps, catching up a long frame but no more than four steps at once', () => {
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: flat, half: HALF, props: [] });
    expect(w.step(PHYSICS_STEP_S / 2)).toBe(0);
    expect(w.step(PHYSICS_STEP_S / 2)).toBe(1);
    expect(w.step(1)).toBe(4);
    w.dispose();
  });
});
