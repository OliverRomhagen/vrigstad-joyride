import * as THREE from 'three';
import { expect, test } from 'vitest';
import { steadyShadowCentre } from '../../../../src/game/render/sun-shadow';

const SUN = new THREE.Vector3(-0.55, 0.75, 0.37).normalize(); // the game's sun at its default hour (render/stage.ts)
const TEXEL_M = 220 / 2048; // the game's shadow box over its map

/** Where `p` falls in the shadow image of a box centred on `centre`, in texels: three's own lookAt, as the shadow uses. */
function inShadowImage(p: THREE.Vector3, centre: THREE.Vector3, sun = SUN) {
  const cam = new THREE.OrthographicCamera();
  cam.position.copy(centre).addScaledVector(sun, 400);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const local = p.clone().applyMatrix4(cam.matrixWorldInverse);
  return [local.x / TEXEL_M, local.y / TEXEL_M];
}

test('the box moves in whole texels of its own image, so the world keeps its place on the pixels', () => {
  const from = new THREE.Vector3(3.3, 1, -7.1),
    world = new THREE.Vector3(20, 0, 15); // any fixed point in the world
  for (const [x, y, z] of [
    [12.345, 3.2, -87.65],
    [-410.07, 11.9, 633.3],
  ]) {
    const to = steadyShadowCentre(new THREE.Vector3(), from, { x, y, z }, SUN, TEXEL_M) as THREE.Vector3,
      [a0, b0] = inShadowImage(world, from),
      [a1, b1] = inShadowImage(world, to);
    expect(Math.abs(a1 - a0 - Math.round(a1 - a0))).toBeLessThan(1e-6);
    expect(Math.abs(b1 - b0 - Math.round(b1 - b0))).toBeLessThan(1e-6);
  }
});

test('it stays within half a texel of the focus across the image, and takes its depth along the sun', () => {
  const focus = new THREE.Vector3(37.71, 4.4, -12.93),
    c = steadyShadowCentre(new THREE.Vector3(), new THREE.Vector3(), focus, SUN, TEXEL_M) as THREE.Vector3,
    [a, b] = inShadowImage(focus, c);
  expect(Math.abs(a)).toBeLessThanOrEqual(0.5 + 1e-9);
  expect(Math.abs(b)).toBeLessThanOrEqual(0.5 + 1e-9);
  expect(c.dot(SUN)).toBeCloseTo(focus.dot(SUN), 9);
});

test('driving a few centimetres leaves the box where it is', () => {
  const box = new THREE.Vector3(),
    world = new THREE.Vector3(0, 0, 0),
    steps = new Set<string>();
  for (let x = 0; x < 1; x += 0.01) {
    steadyShadowCentre(box, box, { x, y: 0, z: 0 }, SUN, TEXEL_M);
    steps.add(
      inShadowImage(world, box)
        .map(v => Math.round(v * 1000))
        .join(),
    );
  }
  expect(steps.size).toBeLessThan(20); // 100 positions over a metre share about one box position per texel (~11 cm)
});

test('a turning sun barely slides the shadow under a player standing still, even far from Torget', () => {
  const player = new THREE.Vector3(800, 0, -600),
    box = player.clone(),
    sun = SUN.clone(),
    turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.0046 / 60); // the day's pace, a frame at 60 fps
  const start = inShadowImage(player, box, sun);
  for (let frame = 0; frame < 60; frame++) {
    sun.applyQuaternion(turn);
    steadyShadowCentre(box, box, player, sun, TEXEL_M);
  }
  const end = inShadowImage(player, box, sun);
  // a grid fixed to the world's origin would slide ~34 texels in this second, 1 km out
  expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(1);
});
