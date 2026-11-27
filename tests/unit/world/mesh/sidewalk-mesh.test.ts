import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Surface } from '../../../../src/world/data';
import { SidewalkMesh } from '../../../../src/world/mesh/sidewalk-mesh';
import { Part, type Soup } from '../../../../src/world/streetscape';

const soup = (): Soup => ({ pos: [], part: [], src: [], surface: [], tone: [] });
/** One road-level triangle at (x, z), on `surface`. */
function patch(x: number, z: number, surface: Surface): Soup {
  return { pos: [x, 0, z, x + 1, 0, z, x, 0, z + 1], part: [Part.ROAD], src: [0], surface: [surface], tone: [0] };
}

describe('SidewalkMesh road patches (#399)', () => {
  it('draw with the ribbons’ material and the colour of their own surface, never black', () => {
    const ribbon = new THREE.MeshLambertMaterial({ vertexColors: true }),
      paving = new THREE.Color(0.3, 0.2, 0.1),
      asphalt = new THREE.Color(0.05, 0.05, 0.05),
      roadPatches = [soup(), soup(), patch(10, 20, Surface.PAVING), soup(), soup(), soup()];
    const mesh = new SidewalkMesh(
      { surface: soup(), markings: soup(), roadPatches },
      {
        surface: new THREE.MeshLambertMaterial(),
        markings: new THREE.MeshLambertMaterial(),
        roadMaterials: [undefined, undefined, ribbon],
        roadColour: s => (s === Surface.PAVING ? paving : asphalt),
      },
    );
    const [m] = mesh.meshes.filter(x => x.material === ribbon);
    const col = m.geometry.getAttribute('color'),
      uv = m.geometry.getAttribute('uv');
    expect(col.count).toBe(3);
    for (let i = 0; i < 3; i++)
      expect([col.getX(i), col.getY(i), col.getZ(i)]).toEqual([0.3, 0.2, 0.1].map(Math.fround));
    expect(uv.getX(0)).toBeCloseTo(10 / 4, 5); // the ribbons' world-space tiling
    expect(uv.getY(0)).toBeCloseTo(20 / 4, 5);
  });
});
