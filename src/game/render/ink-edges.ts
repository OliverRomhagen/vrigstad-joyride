import * as THREE from 'three';

// Ink lines for the toon style (#206) on a mesh built with no floor: three's EdgesGeometry, less the open edges that
// lie under their face. EdgesGeometry draws every edge only one triangle has, and the house shells, plinths and corner
// boards have no floor, so it drew their feet: lines at the lowest ground under a house, buried on a slope, which the
// lines' pull towards the camera then showed through the grass (#413). An open edge with its face above it is a foot;
// the rest, like a roof's or a ledge's, stays.

const PRECISION = 1e4; // positions closer than 0.1 mm are one corner, as EdgesGeometry rounds them
const ABOVE_M = 1e-3; // a face's third corner this much higher than both ends of an open edge makes that edge a foot

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _n = new THREE.Vector3();
const key = (v: THREE.Vector3) =>
  `${Math.round(v.x * PRECISION)},${Math.round(v.y * PRECISION)},${Math.round(v.z * PRECISION)}`;

// an edge seen once so far, by its corners' vertex indices: positions are read again only for the lines drawn
type OpenEdge = { i0: number; i1: number; nx: number; ny: number; nz: number; apexY: number };

/**
 * Line segments along the creases sharper than `creaseDeg` and the open edges, less the open edges that are a foot,
 * for LineSegments. Only for a mesh that stands in the ground with no floor (the house shells): on any other,
 * "above" is only the geometry's own y, and an open edge under its face may be in plain sight, as a car's window
 * seals are. Those get three's EdgesGeometry.
 */
export function inkEdges(geometry: THREE.BufferGeometry, creaseDeg: number): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position'),
    index = geometry.getIndex(),
    count = index ? index.count : pos.count,
    cosCrease = Math.cos(THREE.MathUtils.DEG2RAD * creaseDeg),
    open = new Map<string, OpenEdge>(),
    out: number[] = [];
  const corner = (i: number) => (index ? index.getX(i) : i);
  const pushLine = (i0: number, i1: number) => {
    _a.fromBufferAttribute(pos, i0);
    _b.fromBufferAttribute(pos, i1);
    out.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
  };
  const ids = [0, 0, 0],
    keys = ['', '', ''],
    ys = [0, 0, 0];
  for (let t = 0; t + 2 < count; t += 3) {
    for (let j = 0; j < 3; j++) ids[j] = corner(t + j);
    _a.fromBufferAttribute(pos, ids[0]);
    _b.fromBufferAttribute(pos, ids[1]);
    _c.fromBufferAttribute(pos, ids[2]);
    keys[0] = key(_a);
    keys[1] = key(_b);
    keys[2] = key(_c);
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[2] === keys[0]) continue; // no area, no normal
    ys[0] = _a.y;
    ys[1] = _b.y;
    ys[2] = _c.y;
    THREE.Triangle.getNormal(_a, _b, _c, _n);
    for (let j = 0; j < 3; j++) {
      const forward = `${keys[j]}_${keys[(j + 1) % 3]}`,
        backward = `${keys[(j + 1) % 3]}_${keys[j]}`,
        reversed = open.get(backward),
        // the same way round, the two triangles are wound against each other (a DoubleSide mesh allows it): flip one normal
        other = reversed ?? open.get(forward),
        side = reversed ? 1 : -1;
      if (other) {
        if (side * (other.nx * _n.x + other.ny * _n.y + other.nz * _n.z) <= cosCrease) pushLine(other.i0, other.i1);
        open.delete(backward);
        open.delete(forward);
      } else
        open.set(forward, {
          i0: ids[j],
          i1: ids[(j + 1) % 3],
          nx: _n.x,
          ny: _n.y,
          nz: _n.z,
          apexY: ys[(j + 2) % 3],
        });
    }
  }
  for (const e of open.values()) {
    const top = Math.max(pos.getY(e.i0), pos.getY(e.i1));
    if (e.apexY <= top + ABOVE_M) pushLine(e.i0, e.i1);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return lines;
}
