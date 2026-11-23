// The water on the real map (data/vrigstad.json): the channels, the lakes and what they must leave alone.
import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import { BridgeIndex } from '../../../src/world/bridges';
import { ROAD_WIDTH_M, type WorldData } from '../../../src/world/data';
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

describe('the water on the real map', () => {
  it('finds the four lakes and joins the waterways into courses', () => {
    expect(bodies.lakes).toHaveLength(4);
    // Vrigstadsån runs as one course from the north-east edge, through two lakes, to the south-west
    const longest = bodies.courses.reduce((a, c) => (c.s[c.s.length - 1] > a.s[a.s.length - 1] ? c : a));
    expect(longest.s[longest.s.length - 1]).toBeGreaterThan(5000);
    expect(new Set(Array.from(longest.lake).filter(l => l >= 0)).size).toBe(2);
  });

  it('gives every course a continuous level, equal to a lake where it meets one', () => {
    for (const c of bodies.courses)
      for (let k = 1; k < c.x.length; k++) {
        const ds = c.s[k] - c.s[k - 1];
        // it falls with the ground, never in a step: no steeper than a few centimetres a metre
        expect(Math.abs(c.level[k] - c.level[k - 1])).toBeLessThanOrEqual(0.035 * ds + 1e-9);
        if (c.lake[k] >= 0) expect(c.level[k]).toBe(bodies.lakes[c.lake[k]].level);
      }
  });

  it('sets rivers and streams into their banks: the water lies below the ground beside it', () => {
    let checked = 0;
    let below = 0;
    for (const c of bodies.courses)
      for (let k = 0; k < c.x.length; k += 5) {
        if (c.lake[k] >= 0 || bodies.keepWeight(c.x[k], c.z[k]) < 1) continue;
        // the bed under the water is under its level, and the ground 3 m past the waterline well above it
        expect(ground.heightAt(c.x[k], c.z[k])).toBeLessThan(c.level[k]);
        const tx = c.x[Math.min(k + 1, c.x.length - 1)] - c.x[Math.max(k - 1, 0)];
        const tz = c.z[Math.min(k + 1, c.z.length - 1)] - c.z[Math.max(k - 1, 0)];
        const l = Math.hypot(tx, tz);
        for (const side of [-1, 1]) {
          const x = c.x[k] - (tz / l) * side * (c.half[k] + 3);
          const z = c.z[k] + (tx / l) * side * (c.half[k] + 3);
          if (bodies.lakeAt(x, z) >= 0 || !Number.isNaN(bodies.levelAt(x, z))) continue;
          checked++;
          if (ground.heightAt(x, z) > c.level[k] + 0.4) below++;
        }
      }
    expect(checked).toBeGreaterThan(1000);
    expect(below / checked).toBeGreaterThan(0.95);
  });

  it('cuts banks no deeper than a few metres, and raises a shore by under a metre', () => {
    let deepest = 0;
    let highest = 0;
    for (const c of bodies.courses)
      for (let k = 0; k < c.x.length; k += 3)
        for (const off of [-8, -4, 0, 4, 8]) {
          const x = c.x[k] + off;
          const z = c.z[k] - off;
          // under the water the bed may lie deeper: only the banks you see count
          if (Number.isNaN(bodies.levelAt(x, z)))
            deepest = Math.max(deepest, base.heightAt(x, z) - ground.heightAt(x, z));
          highest = Math.max(highest, ground.heightAt(x, z) - base.heightAt(x, z));
        }
    expect(deepest).toBeLessThan(4.5);
    expect(highest).toBeLessThan(1);
  });

  it('leaves every road but the bridges at its height, across its width', () => {
    for (const r of D.r) {
      if (r.br) continue; // the channel runs on under a deck (#238)
      const half = ROAD_WIDTH_M[r.c] / 2;
      for (let i = 2; i < r.p.length; i += 2) {
        const [ax, az, bx, bz] = [r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1]];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const [nx, nz] = [-(bz - az) / len, (bx - ax) / len];
        for (let t = 0; t <= 1; t += 0.25)
          for (const o of [-half, 0, half]) {
            const x = ax + (bx - ax) * t + nx * o;
            const z = az + (bz - az) * t + nz * o;
            // to a few centimetres: the cut grid's sub-samples are 2 m apart, and a path beside a steep bank may fall between them
            expect(Math.abs(ground.heightAt(x, z) - base.heightAt(x, z))).toBeLessThan(0.1);
          }
      }
    }
  });

  it('leaves every building on the ground it stood on', () => {
    for (const b of D.b)
      for (let i = 0; i < b.p.length; i += 2)
        expect(Math.abs(ground.heightAt(b.p[i], b.p[i + 1]) - base.heightAt(b.p[i], b.p[i + 1]))).toBeLessThan(0.05);
  });

  it('is wet in the channel and dry on the banks above it', () => {
    let wet = 0;
    let dry = 0;
    let checked = 0;
    for (const c of bodies.courses)
      for (let k = 1; k < c.x.length - 1; k += 10) {
        if (c.lake[k] >= 0 || bodies.keepWeight(c.x[k], c.z[k]) < 1 || bridges.onDeck(c.x[k], c.z[k])) continue;
        checked++;
        if (water.inWater(c.x[k], c.z[k])) wet++;
        const tx = c.x[k + 1] - c.x[k - 1];
        const tz = c.z[k + 1] - c.z[k - 1];
        const l = Math.hypot(tx, tz);
        const o = c.half[k] + 3;
        if (
          !water.inWater(c.x[k] - (tz / l) * o, c.z[k] + (tx / l) * o) &&
          !water.inWater(c.x[k] + (tz / l) * o, c.z[k] - (tx / l) * o)
        )
          dry++;
      }
    expect(wet).toBe(checked);
    expect(dry / checked).toBeGreaterThan(0.95);
  });
});
