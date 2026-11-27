import * as THREE from 'three';
import { describe, expect, it, test } from 'vitest';
import {
  FRAME_TRIANGLES,
  frameGeometry,
  REFILL_STEP_M,
  WINDOW_STRIDE,
  WINDOW_TILE_M,
  WindowFrames,
  windowRun,
} from '../../../../src/game/render/window-frames';

/** Windows 1 m wide and 1.25 m tall facing south, one per x along z = 0, as addBuildings records them. */
function placements(...xs: number[]) {
  const a = new Float32Array(xs.length * WINDOW_STRIDE);
  for (const [i, x] of xs.entries()) a.set([x, 2, 0, 0, 1, 1.25], i * WINDOW_STRIDE);
  return a;
}

test('a window frame is a ring and a sill with ink rims: under 45 triangles, so hundreds of them stay cheap', () => {
  const g = frameGeometry();
  expect(g.getAttribute('position').count / 3).toBe(FRAME_TRIANGLES);
  expect(FRAME_TRIANGLES).toBeLessThanOrEqual(45);
  const c = g.getAttribute('color');
  const dark = Array.from({ length: c.count }, (_, i) => c.getX(i)).filter(r => r < 0.05).length;
  expect(dark).toBeGreaterThan(0); // the ink rims, in the vertex colours
  g.computeBoundingBox();
  expect(g.boundingBox!.min.z).toBeCloseTo(0); // it stands out from the wall, never into it
});

test('only the windows near the camera are drawn, in one instanced mesh', () => {
  const scene = new THREE.Scene(),
    frames = new WindowFrames(scene, placements(10, 50, 100, -70), { radiusM: 80 });
  frames.update(0, 0);
  expect(frames.mesh.count).toBe(3); // 10, 50 and -70 m; not 100, beyond the radius and the refill step
  expect(scene.children).toContain(frames.mesh);
  expect(frames.mesh.castShadow).toBe(false); // the shadow pass is the expensive part
  frames.update(100, 0);
  expect(frames.mesh.count).toBe(2); // 50 and 100; not 10, now 90 m off, nor -70
});

/** The x of every window frame drawn now. */
const drawnXs = (frames: WindowFrames) => {
  const m = new THREE.Matrix4();
  return Array.from({ length: frames.mesh.count }, (_, i) => {
    frames.mesh.getMatrixAt(i, m);
    return Math.round(m.elements[12]);
  });
};

test('every window within the radius has its frame, all the way along a drive', () => {
  const xs = Array.from({ length: 41 }, (_, i) => i * 10),
    frames = new WindowFrames(new THREE.Scene(), placements(...xs), { radiusM: 40 });
  for (let x = 0; x <= 400; x += 0.5) {
    frames.update(x, 0);
    const drawn = drawnXs(frames);
    for (const wx of xs) if (Math.abs(wx - x) <= 40) expect(drawn).toContain(wx);
  }
});

test('the list is refilled only after the camera has moved REFILL_STEP_M, not every frame', () => {
  const frames = new WindowFrames(new THREE.Scene(), placements(10, 50), { radiusM: 80 });
  frames.update(1, 1);
  const filled = frames.mesh.instanceMatrix.version;
  frames.update(2, 3);
  expect(frames.mesh.instanceMatrix.version).toBe(filled);
  frames.update(1 + REFILL_STEP_M, 1);
  expect(frames.mesh.instanceMatrix.version).toBeGreaterThan(filled);
});

test('a camera rocking across a grid line at Torget does not refill', () => {
  const frames = new WindowFrames(new THREE.Scene(), placements(10, 50), { radiusM: 80 });
  frames.update(0.1, 0.1);
  const filled = frames.mesh.instanceMatrix.version;
  for (let i = 0; i < 100; i++) frames.update(i % 2 ? 0.1 : -0.1, i % 2 ? 0.1 : -0.1);
  expect(frames.mesh.instanceMatrix.version).toBe(filled);
});

test('a window is placed where it was recorded, facing out of its wall, at its size', () => {
  const a = new Float32Array([5, 3, -7, Math.PI / 2, 1.2, 1.5]); // facing east
  const frames = new WindowFrames(new THREE.Scene(), a, { radiusM: 80 });
  frames.update(0, 0);
  const m = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  frames.mesh.getMatrixAt(0, m);
  m.decompose(p, q, s);
  expect(p.toArray()).toEqual([5, 3, -7]);
  expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).x).toBeCloseTo(1); // its front, +z, faces east
  expect([s.x, s.y, s.z].map(v => Math.round(v * 100) / 100)).toEqual([1.2, 1.5, 1]);
});

describe('where a wall gets its windows (#413)', () => {
  it('leaves a narrow wall bare and centres one window on a short one', () => {
    expect(windowRun(2.5, false)).toBeNull();
    const one = windowRun(4, false)!;
    expect(one.count).toBe(1);
    expect(one.start + one.tile / 2).toBeCloseTo(2); // in the middle
  });

  it('keeps a house window off its corners, spaced as the tile, and the run centred', () => {
    const run = windowRun(12, false)!;
    expect(run.count).toBe(3); // a window every ~3.2 m, not every 2.6 m (that gave 5)
    expect(run.start).toBeGreaterThanOrEqual(0.9);
    expect(run.start + run.count * run.tile).toBeCloseTo(12 - run.start); // as far from each corner
    expect(run.tile / WINDOW_TILE_M).toBeGreaterThan(0.85);
    expect(run.tile / WINDOW_TILE_M).toBeLessThan(1.2); // the window keeps about its size
  });

  it('gives a big building a regular grid closer to its corners, as blocks have', () => {
    const house = windowRun(20, false)!,
      block = windowRun(20, true)!;
    expect(block.start).toBeLessThan(house.start);
    expect(block.count).toBeGreaterThanOrEqual(house.count);
  });
});

test('the buffer has room for the busiest spot a refill can reach, not for every window', () => {
  const xs = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 4 }, (_, i) => 1000 + i)],
    frames = new WindowFrames(new THREE.Scene(), placements(...xs), { radiusM: 80 });
  expect(frames.capacity).toBe(10); // the ten at Torget; the four 1 km off are never in reach at the same time
  frames.update(0, 0);
  expect(frames.mesh.count).toBe(10);
  frames.update(1000, 0);
  expect(frames.mesh.count).toBe(4);
});
