// The bridges over the water's channels on the real map (#238 with #263): the channel runs on under each deck.
import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import { BridgeIndex } from '../../../src/world/bridges';
import type { WorldData } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import { RoadNetwork } from '../../../src/world/roads';
import { Water } from '../../../src/world/water';
import { WaterBodies } from '../../../src/world/water-shapes';

const D = data as unknown as WorldData;
const base = new Heightfield(D);
const bodies = new WaterBodies(D, base);
const ground = new Heightfield(D, { cut: bodies });
const bridges = new BridgeIndex(D, base);
const roads = new RoadNetwork(D, ground, bridges);
const water = new Water(D, roads, { bodies, ground, decks: bridges });
/** how deep each archetype's structure hangs under its driving surface (m), as bridge-mesh.ts builds it */
const DEPTH_M = { 'road-slab': 0.7, 'path-steel': 0.45, 'path-timber': 0.3 };
/** the water stays at least this far under every structure: the deck follows the approaches, so a stream whose level
 * stands high under a short footbridge sets the margin (b48401503, 0.50 m) */
const MIN_CLEARANCE_M = 0.45;

/** the point `s` m along bridge b, `d` m to its right */
function at(b: (typeof bridges.bridges)[number], s: number, d = 0) {
  const [a, z] = [b.p[0], b.p[b.p.length - 1]];
  const [dx, dz] = [(z[0] - a[0]) / b.spanM, (z[1] - a[1]) / b.spanM];
  return [a[0] + dx * s - dz * d, a[1] + dz * s + dx * d] as const;
}

describe('the mapped bridges over the cut channels', () => {
  it('stand over open water: the bed and the water stay clear of every deck', () => {
    for (const b of bridges.bridges) {
      let clearance = Infinity;
      let wet = 0;
      for (let s = 0; s <= b.spanM; s += 0.5) {
        const [x, z] = at(b, s);
        const soffit = bridges.surfaceAt(b, x, z, s) - DEPTH_M[b.archetype];
        const level = bodies.levelAt(x, z);
        if (!Number.isNaN(level)) {
          wet++;
          clearance = Math.min(clearance, soffit - level);
        }
      }
      expect(wet, b.key).toBeGreaterThan(0);
      expect(clearance, b.key).toBeGreaterThanOrEqual(MIN_CLEARANCE_M);
    }
  });

  it('cut the ground under each deck, and leave the approaches at their height', () => {
    for (const b of bridges.bridges) {
      let lowest = Infinity;
      for (let s = 0; s <= b.spanM; s += 0.5) {
        const [x, z] = at(b, s);
        lowest = Math.min(lowest, ground.heightAt(x, z) - base.heightAt(x, z));
      }
      expect(lowest, b.key).toBeLessThan(-0.3);
      for (const s of [-3, b.spanM + 3]) {
        const [x, z] = at(b, s);
        expect(Math.abs(ground.heightAt(x, z) - base.heightAt(x, z)), b.key).toBeLessThan(0.1);
      }
    }
  });

  it('are dry on the deck and wet in the channel beside it', () => {
    for (const b of bridges.bridges) {
      let beside = 0;
      for (let s = 0; s <= b.spanM; s += 0.5) {
        const [x, z] = at(b, s);
        expect(water.inWater(x, z), b.key).toBe(false);
        for (const side of [-1, 1]) {
          const [bx, bz] = at(b, s, side * (b.halfWidthM + 0.5));
          if (water.inWater(bx, bz)) beside++;
        }
      }
      expect(beside, b.key).toBeGreaterThan(0);
    }
  });

  it('give groundAt no step from the cut approach onto the deck and off again', () => {
    for (const b of bridges.bridges) {
      let last = Number.NaN;
      for (let s = -5; s <= b.spanM + 5; s += 0.1) {
        const g = roads.groundAt(...at(b, s));
        // at most the 6 cm between two classes' ribbon lifts (a driveway meeting b58102458's footway)
        if (!Number.isNaN(last)) expect(Math.abs(g - last), `${b.key} at ${s.toFixed(1)} m`).toBeLessThan(0.065);
        last = g;
      }
    }
  });

  it('need the uncut ground for the tilt of a car on a deck: the cut bank under it would tip the car over', () => {
    const n = { x: 0, y: 0, z: 0 };
    let steepest = 1;
    for (const b of bridges.bridges)
      for (let s = 0; s <= b.spanM; s += 0.5) {
        const [x, z] = at(b, s);
        // the page tilts cars by base.normalAt on a deck (src/game/main.ts): within a few degrees of level everywhere
        expect(base.normalAt(x, z, n).y, b.key).toBeGreaterThan(0.995);
        steepest = Math.min(steepest, ground.normalAt(x, z, n).y);
      }
    expect(steepest).toBeLessThan(0.8); // the cut ground there leans over 35°
  });
});
