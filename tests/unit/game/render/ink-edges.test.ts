import * as THREE from 'three';
import { expect, test } from 'vitest';
import { inkEdges } from '../../../../src/game/render/ink-edges';

type P = [number, number, number];
/** A non-indexed geometry from quads, each four corners in order round its edge, as the house shells are built. */
function quads(...qs: [P, P, P, P][]) {
  const pos: number[] = [];
  for (const q of qs) for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
/** The line segments as [x0, y0, z0, x1, y1, z1] rows, each end rounded to the centimetre. */
function segments(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'),
    out: number[][] = [];
  for (let i = 0; i < p.count; i += 2)
    out.push(
      [p.getX(i), p.getY(i), p.getZ(i), p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)].map(
        v => Math.round(v * 100) / 100,
      ),
    );
  return out;
}
const lowestY = (s: number[]) => Math.min(s[1], s[4]);
const level = (s: number[]) => Math.abs(s[1] - s[4]) < 1e-6;

test('a closed box keeps all twelve edges, and no line across a face', () => {
  expect(segments(inkEdges(new THREE.BoxGeometry(2, 2, 2), 34))).toHaveLength(12);
});

test('a wall with no floor keeps its top and sides, and loses its foot, which the ground buries (#413)', () => {
  // a 4 m wall from the ground at y = 0 to y = 3, open at the bottom like the house shells
  const s = segments(
    inkEdges(
      quads([
        [0, 0, 0],
        [4, 0, 0],
        [4, 3, 0],
        [0, 3, 0],
      ]),
      34,
    ),
  );
  expect(s).toHaveLength(3);
  expect(s.filter(e => level(e) && lowestY(e) === 0)).toHaveLength(0);
  expect(s.filter(e => level(e) && lowestY(e) === 3)).toHaveLength(1);
});

test('a ledge keeps the edge where it meets the wall, and its open foot goes', () => {
  // a plinth: its front face from the ground to 0.5 m, 0.1 m out from a wall at z = 0, and its top back to the wall
  const s = segments(
    inkEdges(
      quads(
        [
          [0, 0, 0.1],
          [4, 0, 0.1],
          [4, 0.5, 0.1],
          [0, 0.5, 0.1],
        ],
        [
          [0, 0.5, 0.1],
          [4, 0.5, 0.1],
          [4, 0.5, 0],
          [0, 0.5, 0],
        ],
      ),
      34,
    ),
  );
  expect(s.some(e => level(e) && e[1] === 0.5 && e[2] === 0 && e[5] === 0)).toBe(true); // the inner edge, against the wall
  expect(s.some(e => level(e) && e[1] === 0.5 && e[2] === 0.1)).toBe(true); // the front crease
  expect(s.some(e => level(e) && lowestY(e) === 0)).toBe(false); // the foot, in the ground
});

test('the same corners in an indexed geometry give the same lines', () => {
  const box = new THREE.BoxGeometry(1, 2, 3);
  expect(segments(inkEdges(box, 34)).length).toBe(segments(inkEdges(box.toNonIndexed(), 34)).length);
});

test('two faces in one plane get no line between them, however each is wound', () => {
  // a roof and its overhang: one plane, the overhang's corners in the other order, as a DoubleSide mesh allows
  const roof: [P, P, P, P] = [
      [0, 3, 0],
      [4, 3, 0],
      [4, 4, -2],
      [0, 4, -2],
    ],
    overhang: [P, P, P, P] = [
      [0, 3, 0],
      [4, 3, 0],
      [4, 2.8, 0.4],
      [0, 2.8, 0.4],
    ]; // runs along the shared edge the same way
  const s = segments(inkEdges(quads(roof, overhang), 34));
  expect(s.some(e => level(e) && e[1] === 3)).toBe(false);
});
