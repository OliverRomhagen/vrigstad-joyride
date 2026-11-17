import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RoadClass } from '../../../../src/world/data';
import { RoadRibbons } from '../../../../src/world/mesh/road-ribbons';
import { RoadNetwork, roadLiftM } from '../../../../src/world/roads';
import { makeWorld } from '../fixture';

const TERRAIN_M = 2;
const terrainAt = (heightM: number) => ({ heightAt: () => heightM });
// a primary road along z = 0, from x = -40 to 40
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [-40, 0, 40, 0] };
const ROAD_COLOURS = [0x101010, 0x202020, 0x303030, 0x404040, 0x505050, 0x606060] as const;

describe('RoadRibbons', () => {
  const asphalt = new THREE.Texture();
  const roads = new RoadNetwork(makeWorld({ r: [MAIN_ROAD] }), terrainAt(TERRAIN_M));
  const ribbons = new RoadRibbons(roads, terrainAt(TERRAIN_M), { asphalt, roadColours: ROAD_COLOURS, centreLineColour: 0xffffff });

  it('tints the asphalt it is given on the road, and not on the centre line', () => {
    expect(ribbons.meshes).toHaveLength(2);
    const [road, centreLine] = ribbons.meshes;
    expect((road.material as THREE.MeshLambertMaterial).map).toBe(asphalt);
    expect((centreLine.material as THREE.MeshLambertMaterial).map).toBeNull();
  });

  it('lifts the road its class height over the terrain', () => {
    const pos = ribbons.meshes[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(TERRAIN_M + roadLiftM(RoadClass.PRIMARY), 5);
  });

  it('leaves the asphalt to its owner on dispose', () => {
    let freed = false;
    asphalt.addEventListener('dispose', () => {
      freed = true;
    });
    ribbons.dispose();
    expect(freed).toBe(false);
  });
});
