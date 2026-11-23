import type { WorldData } from './data';
import { Heightfield } from './heightfield';
import type { NearestRoad, RoadNetwork } from './roads';
import { WaterBodies } from './water-shapes';

/** a road within this distance of its edge is a bridge over the water (m) */
const BRIDGE_REACH_M = 1;

export interface WaterOptions {
  /** the bodies the page built its terrain from; built here from the data when left out */
  bodies?: WaterBodies;
  /**
   * The cut ground, not exaggerated (the game's): where given, a point is wet only where the ground is under the
   * water's level, as you see it. Left out (tools, tests, the map's streetscape), the water's outline alone decides.
   */
  ground?: Pick<Heightfield, 'heightAt'>;
  /** the mapped bridges (#238): their decks are dry, and with `ground` nothing else needs a road exception */
  decks?: { onDeck(x: number, z: number): boolean };
}

/** Lakes, rivers and streams, for asking whether a point is in water. */
export class Water {
  readonly bodies: WaterBodies;
  private readonly roads: Pick<RoadNetwork, 'nearestRoad'>;
  private readonly ground: Pick<Heightfield, 'heightAt'> | null;
  private readonly decks: { onDeck(x: number, z: number): boolean } | null;
  private readonly near: NearestRoad = { d: 1e9, ri: -1 };

  constructor(data: WorldData, roads: Pick<RoadNetwork, 'nearestRoad'>, { bodies, ground, decks }: WaterOptions = {}) {
    this.decks = decks ?? null;
    this.roads = roads;
    this.bodies = bodies ?? new WaterBodies(data, new Heightfield(data));
    this.ground = ground ?? null;
  }

  /** True over a lake, a river or a stream where its level stands above the ground, never on a bridge deck. */
  inWater(x: number, z: number) {
    if (this.decks?.onDeck(x, z)) return false;
    // without the cut ground, any road over water counts as a crossing; with it, a road keeps its ground above the
    // water and the level test below says so, while the channel beside a deck is water
    if (!(this.ground && this.decks) && this.roads.nearestRoad(x, z, this.near).d < BRIDGE_REACH_M) return false;
    const level = this.bodies.levelAt(x, z);
    if (Number.isNaN(level)) return false;
    return !this.ground || this.ground.heightAt(x, z) < level;
  }
}
