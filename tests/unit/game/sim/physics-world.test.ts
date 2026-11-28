import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarBody } from '../../../../src/game/sim/car-body';
import {
  PHYSICS_STEP_S,
  PhysicsWorld,
  type PhysicsWorldOptions,
  type PropPose,
  type PropSpec,
} from '../../../../src/game/sim/physics-world';
import { BuildingKind } from '../../../../src/world/data';
import { makeWorld, square } from '../../world/fixture';

beforeAll(() => RAPIER.init());

// A terrain as the heightfield hands it to its mesh: samples every 5 m over a 200 m square, no refined cells. Between
// samples the mesh is flat triangles, so `heightAt` is exact only where the ground is a plane.
function field(heightAt: (x: number, z: number) => number): PhysicsWorldOptions['heightfield'] {
  const half = 100,
    step = 5,
    coord = (i: number) => -half + i * step;
  return {
    samples: (half * 2) / step + 1,
    sampleCoord: coord,
    sampleHeight: (i, j) => heightAt(coord(i), coord(j)),
    heightAt,
  };
}
// ground that slopes both ways, so a grid listed the wrong way round shows
const sloped = field((x, z) => 0.1 * x + 0.02 * z);
const flat = field(() => 0);
// hills a few metres high and tens of metres apart, as in the village
const bumpy = field((x, z) => 3 * Math.sin(x / 13) + 2 * Math.cos(z / 7));
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
// a Volvo-sized car heading east along z = `z`: the game's heading h points a car at (sin h, -cos h)
const car = (x: number, z = 0): CarBody => ({ x, z, h: Math.PI / 2, T: { lengthM: 4.8, widthM: 1.75 } });
const pose = (): PropPose => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
const world = (heightfield: PhysicsWorldOptions['heightfield'], props: PropSpec[] = []) =>
  new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield, props });
// drives a car east from x 0 at `speed` (m/s) for 1.5 s at `fps`, along z = `z`; returns how far the mailbox at (10, 0) went
function drive(speed: number, z = 0, fps = 60) {
  const w = world(flat, [mailbox(10, 0)]),
    c = car(0, z);
  for (let t = 0; t < 1.5; t += 1 / fps) {
    c.x += speed / fps;
    w.follow([c], null, c);
    w.step(1 / fps);
  }
  const p = w.propPose(0, pose());
  w.dispose();
  return Math.hypot(p.x - 10, p.z);
}

describe('PhysicsWorld', () => {
  it('lays the ground where the terrain is, both ways round', () => {
    const w = world(sloped);
    for (const [x, z] of [
      [60, -40],
      [-30, 70],
      [0, 0],
    ]) {
      const down = w.castRay(x, 100, z, 0, -1, 0, 500);
      expect(down, `at (${x}, ${z})`).not.toBeNull();
      expect(100 - (down ?? 0), `at (${x}, ${z})`).toBeCloseTo(sloped.heightAt(x, z), 2);
    }
    w.dispose();
  });

  it("stands a building's walls up from its outline", () => {
    const data = makeWorld({ b: [{ p: square(20, -5, 10), h: 5, k: BuildingKind.OTHER }] });
    const w = new PhysicsWorld(RAPIER, { data, heightfield: flat, props: [] });
    // from the west, 2 m up, towards the wall at x 20
    expect(w.castRay(0, 2, 0, 1, 0, 0, 100)).toBeCloseTo(20, 2);
    // over the roof's edge, nothing
    expect(w.castRay(0, 8, 0, 1, 0, 0, 100)).toBeNull();
    w.dispose();
  });

  it('leaves the props out of the world until a car drives near, not the player', () => {
    const w = world(bumpy, [mailbox(10, 0), mailbox(60, 0)]);
    for (let i = 0; i < 30; i++) w.step(PHYSICS_STEP_S);
    w.follow([], { x: 0, z: 0 }, { x: 0, z: 0 });
    expect(w.joined).toEqual([]);
    const c = car(-1);
    w.follow([c], null, c); // a car that has just come into the world hasn't moved yet
    c.x += 1;
    w.follow([c], null, c);
    expect(w.joined).toEqual([0]); // 10 m away, not the one 60 m away
    w.dispose();
  });

  it('anchors a prop that joins on uneven ground where it stands, until something knocks it', () => {
    // 25 mailboxes on a 3 m grid round a car that drives in and stops, none in its way, turned every which way
    const props = Array.from({ length: 25 }, (_, i) => {
      const x = 20 + (i % 5) * 3,
        z = 4 + Math.floor(i / 5) * 3;
      return { ...mailbox(x, z), baseY: bumpy.heightAt(x, z), rotationY: i };
    });
    const w = world(bumpy, props),
      c = car(15);
    for (let i = 0; i < 10; i++) {
      c.x += 0.5;
      w.follow([c], null, c);
      w.step(PHYSICS_STEP_S);
    }
    for (let i = 0; i < 180; i++) w.step(PHYSICS_STEP_S);
    expect(w.joined.length).toBeGreaterThan(10);
    expect(w.loosened).toEqual([]);
    expect(w.awakeProps).toBe(0);
    w.dispose();
  });

  it('sends a mailbox flying when a car drives through it', () => {
    const w = world(flat, [mailbox(10, 0)]);
    const c = car(0);
    // 15 m/s, about 54 km/h, for a second
    for (let i = 0; i < 60; i++) {
      c.x += 15 * PHYSICS_STEP_S;
      w.follow([c], null, c);
      w.step(PHYSICS_STEP_S);
    }
    const p = w.propPose(0, pose());
    expect(Math.hypot(p.x - 10, p.z)).toBeGreaterThan(2); // knocked metres from where it stood
    expect(Math.abs(p.qw)).toBeLessThan(0.99); // and turned over
    expect(w.loosened).toEqual([0]);
    w.dispose();
  });

  it.each([
    [8, 0],
    [25, 0],
    [45, 0],
    [8, 0.6],
    [25, 0.6],
    [45, 0.6],
  ])(
    "knocks a mailbox away at %d m/s, %d m off the car's middle, rather than letting the car pass through it",
    (speed, off) => {
      expect(drive(speed, off)).toBeGreaterThan(1);
    },
  );

  it("knocks a mailbox about as far at 20 fps as at 60, a frame's move spread over its steps", () => {
    // 20 fps: the loop caps a frame at 0.05 s (src/game/loop.ts), three steps
    const at60 = drive(15),
      at20 = drive(15, 0, 20);
    expect(at20).toBeGreaterThan(at60 * 0.6);
    expect(at20).toBeLessThan(at60 * 1.6);
  });

  it('lets the player walk past a mailbox, and push one that is already down', () => {
    const w = world(flat, [mailbox(10, 0)]),
      c = car(0);
    for (let i = 0; i < 6; i++) {
      c.x += 0.5;
      w.follow([c], { x: 9.3, z: 0 }, { x: 9.3, z: 0 }); // the car brings it into the world; the player stands touching it
      w.step(PHYSICS_STEP_S);
    }
    expect(w.joined).toEqual([0]);
    expect(w.loosened).toEqual([]);
    w.dispose();
  });

  it("jumps a car that is put somewhere far, so it doesn't sweep across the village and launch what it touches", () => {
    const w = world(flat, [mailbox(10, 0)]),
      c = car(-60);
    w.follow([c], null, c);
    w.step(PHYSICS_STEP_S);
    c.x = 50; // a respawn: past the mailbox, in one frame
    w.follow([c], null, c);
    w.step(PHYSICS_STEP_S);
    expect(w.loosened).toEqual([]);
    w.dispose();
  });

  it('puts a knocked mailbox back on its stand 90 s after the knock, once the player is far from it', () => {
    const w = world(flat, [mailbox(10, 0)]),
      c = car(0);
    for (let i = 0; i < 60; i++) {
      c.x += 15 * PHYSICS_STEP_S;
      w.follow([c], null, c);
      w.step(PHYSICS_STEP_S);
    }
    expect(w.loosened).toEqual([0]);
    // the car is put 500 m away at once, out of sight of both where the mailbox lies and where it stood
    c.x = 500;
    w.follow([c], null, c);
    const seconds = (s: number) => {
      for (let i = 0; i < s * 60; i++) w.step(PHYSICS_STEP_S);
    };
    seconds(84); // 85 s since the start, 84 and a bit since the knock: still down
    expect(w.loosened).toEqual([0]);
    seconds(7); // 91 s since the knock: back, anchored where it stood
    expect(w.loosened).toEqual([]);
    expect(w.isLoose(0)).toBe(false);
    const p = w.propPose(0, pose());
    expect([p.x, p.y, p.z]).toEqual([10, expect.closeTo(0.65, 5), 0]);
    w.dispose();
  });

  it('leaves a knocked mailbox down while the player is near where it lies, or where it stood', () => {
    for (const viewer of [
      { x: 10, z: 0 }, // at its stand
      { x: 60, z: 0 }, // past where it lies, 75 m from its stand
    ]) {
      const w = world(flat, [mailbox(10, 0)]),
        c = car(0);
      for (let i = 0; i < 60; i++) {
        c.x += 15 * PHYSICS_STEP_S;
        w.follow([c], null, viewer);
        w.step(PHYSICS_STEP_S);
      }
      c.x = 500;
      w.follow([c], null, viewer);
      for (let i = 0; i < 120 * 60; i++) w.step(PHYSICS_STEP_S);
      expect(w.loosened, `with the player at (${viewer.x}, ${viewer.z})`).toEqual([0]);
      w.dispose();
    }
  });

  it("gives a prop more boxes on the same body, turned with it: a lamp's arm", () => {
    // a 6 m pole at (10, 0) facing +x (rotationY π/2), with a 1.2 m arm at the top reaching towards +x
    const lamp: PropSpec = {
      ...mailbox(10, 0),
      rotationY: Math.PI / 2,
      widthM: 0.2,
      depthM: 0.2,
      heightM: 6,
      parts: [{ x: 0, y: 2.85, z: 0.6, hx: 0.15, hy: 0.15, hz: 0.6, massKg: 18 }],
    };
    const w = world(flat, [lamp]),
      c = car(4, 8); // drives along z = 8, far enough not to touch it, near enough to bring it into the world
    c.x += 1;
    w.follow([c], null, c);
    c.x += 1;
    w.follow([c], null, c);
    w.step(PHYSICS_STEP_S);
    expect(w.joined).toEqual([0]);
    // straight down onto the arm, 1 m out from the pole along +x: it is there, 5.7 to 6 m up
    expect(10 - (w.castRay(11, 10, 0, 0, -1, 0, 20) ?? 0)).toBeCloseTo(6, 2);
    // and not on the other side
    expect(10 - (w.castRay(9, 10, 0, 0, -1, 0, 20) ?? 0)).toBeCloseTo(0, 2);
    w.dispose();
  });

  it('runs fixed steps, catching up a long frame but no more than four steps at once', () => {
    const w = world(flat);
    expect(w.step(PHYSICS_STEP_S / 2)).toBe(0);
    expect(w.step(PHYSICS_STEP_S / 2)).toBe(1);
    expect(w.step(1)).toBe(4);
    expect(w.steps).toBe(5);
    w.dispose();
  });
});
