import { readFileSync } from 'node:fs';
import type { Mesh } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import { modelCrackGeometry } from '../../../../src/game/render/model-cracks';

test('the Saab round-3 wraparound windscreen stays entirely in the front crack group', async () => {
  const bytes = readFileSync('src/public/media/vehicles/saab900-t16.glb');
  const { scene } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(new Uint8Array(bytes).buffer, '');
  const glass = scene.getObjectByName('glass_envelope') as Mesh;
  const cracks = modelCrackGeometry(glass.geometry);
  const positions = cracks.attributes.position!;
  const sides = cracks.groups.find(g => g.materialIndex === 1)!;
  let windscreenCorners = 0;
  for (let i = sides.start; i < sides.start + sides.count; i++) if (positions.getZ(i) < -0.6) windscreenCorners++;
  expect(windscreenCorners).toBe(0); // at light damage the side group is hidden
  expect(sides.count).toBeGreaterThan(0); // door windows retain their own damage level
  cracks.dispose();
});
