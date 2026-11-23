import * as THREE from 'three';

// Ink lines for the toon style (#206): three's EdgesGeometry, less the open edges that lie under their face. EdgesGeometry
// draws every edge only one triangle has, and the house shells, plinths and corner boards have no floor, so it drew their
// feet: lines at the lowest ground under a house, buried on a slope, which the lines' pull towards the camera then showed
// through the grass (#413). An open edge with its face above it is a foot; the rest, like a roof's or a ledge's, stays.

const PRECISION = 1e4; // positions closer than 0.1 mm are one corner, as EdgesGeometry rounds them
const ABOVE_M = 1e-3; // a face's third corner this much higher than both ends of an open edge makes that edge a foot

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _n = new THREE.Vector3();
const key = (v: THREE.Vector3) =>
  `${Math.round(v.x * PRECISION)},${Math.round(v.y * PRECISION)},${Math.round(v.z * PRECISION)}`;

type OpenEdge = { a: THREE.Vector3; b: THREE.Vector3; nx: number; ny: number; nz: number; apexY: number };

/** Line segments along the creases sharper than `creaseDeg` and the open edges that aren't a foot, for LineSegments. */
export function inkEdges(geometry: THREE.BufferGeometry, creaseDeg: number): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position'),
    index = geometry.getIndex(),
    count = index ? index.count : pos.count,
    cosCrease = Math.cos(THREE.MathUtils.DEG2RAD * creaseDeg),
    open = new Map<string, OpenEdge>(),
    out: number[] = [];
  const corner = (i: number) => (index ? index.getX(i) : i);
  for (let t = 0; t + 2 < count; t += 3) {
    _a.fromBufferAttribute(pos, corner(t));
    _b.fromBufferAttribute(pos, corner(t + 1));
    _c.fromBufferAttribute(pos, corner(t + 2));
    const tri = [_a.clone(), _b.clone(), _c.clone()],
      keys = tri.map(key);
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[2] === keys[0]) continue; // no area, no normal
    THREE.Triangle.getNormal(_a, _b, _c, _n);
    for (let j = 0; j < 3; j++) {
      const k0 = keys[j],
        k1 = keys[(j + 1) % 3],
        reversed = open.get(`${k1}_${k0}`),
        // the same way round, the two triangles are wound against each other (a DoubleSide mesh allows it): flip one normal
        other = reversed ?? open.get(`${k0}_${k1}`),
        side = reversed ? 1 : -1;
      if (other) {
        if (side * (other.nx * _n.x + other.ny * _n.y + other.nz * _n.z) <= cosCrease)
          out.push(...other.a.toArray(), ...other.b.toArray());
        open.delete(`${k1}_${k0}`);
        open.delete(`${k0}_${k1}`);
      } else
        open.set(`${k0}_${k1}`, {
          a: tri[j],
          b: tri[(j + 1) % 3],
          nx: _n.x,
          ny: _n.y,
          nz: _n.z,
          apexY: tri[(j + 2) % 3].y,
        });
    }
  }
  for (const e of open.values())
    if (e.apexY <= Math.max(e.a.y, e.b.y) + ABOVE_M) out.push(...e.a.toArray(), ...e.b.toArray());
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return lines;
}
