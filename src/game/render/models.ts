// The low-poly models: merged box and extruded geometry, the procedural cars and tractor, people, and the soft blob shadow under them.
// Moved from src/game/main.ts (#177); main.ts hands these to the modules that build the cars, people, cats and places.
import * as THREE from 'three';
import { col } from '../../world/three-legacy';
import type { BoxPart } from '../box-part';
import { INK_FLAG } from './ink-flag';

/** One part of a model: a geometry and its sRGB colour; the colour attribute is left out when the parts have none. */
type Part = [geometry: THREE.BufferGeometry, colour?: string];
type Profile = {
  body: number[][];
  glass: number[][];
  roof: number[][];
  w: number;
  gw: number;
  wz: number[];
  len: number;
  extra?: (c: string) => BoxPart[];
};
/** A person's mesh: the legs (and the player's arms) swing as they walk. */
export type Person = THREE.Group & { legs: THREE.Mesh[]; blob: THREE.Mesh; arms?: THREE.Mesh[] };

// soft round shadow under cars, people and trees, so nothing looks pasted onto the ground
export const blobTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d')!,
    g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.9)');
  g.addColorStop(0.5, 'rgba(0,0,0,.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return cv;
})();
const blobMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: new THREE.CanvasTexture(blobTex),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
  }),
  blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function blob(parent: THREE.Object3D, w: number, l: number) {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.set(w, 1, l);
  m.position.y = 0.06;
  m.renderOrder = 3;
  parent.add(m);
  return m;
}

// one geometry from [geometry, sRGB colour] parts; the colour attribute is left out when the parts have no colour
export function mergeGeo(parts: Part[]) {
  const pos: number[] = [],
    nor: number[] = [],
    cs: number[] = [],
    c = new THREE.Color();
  for (const [g0, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0,
      a = g.attributes.position.array,
      n = g.attributes.normal.array;
    if (hex) c.set(hex).convertSRGBToLinear();
    for (let i = 0; i < a.length; i += 3) {
      pos.push(a[i], a[i + 1], a[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      if (hex) cs.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (cs.length) g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
  return g;
}
const boxPart = (p: BoxPart): Part => [new THREE.BoxGeometry(p[0], p[1], p[2]).translate(p[3], p[4], p[5]), p[6]]; // [sx, sy, sz, x, y, z, colour]
export const boxGeo = (parts: BoxPart[]) => mergeGeo(parts.map(boxPart));
// a side profile (z, y; the front is -z) extruded across the car, with rounded edges
function extrude(pts: number[][], width: number, bevel: number) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
  const depth = width - 2 * bevel,
    g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 3,
      curveSegments: 4,
    });
  return g.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0);
}
export const paintMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const carMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: col(0x555555) }); // glossy paint and glass
export const GLASS = '#26323a';
const TYRE = '#1c1c1c';
const lamps = (z: number): BoxPart[] => [
  [0.34, 0.16, 0.06, -0.6, 0.72, -z, '#fff6c8'],
  [0.34, 0.16, 0.06, 0.6, 0.72, -z, '#fff6c8'],
  [0.34, 0.16, 0.06, -0.6, 0.72, z, '#c8261c'],
  [0.34, 0.16, 0.06, 0.6, 0.72, z, '#c8261c'],
];
// car bodies: a bevelled side profile, round wheels and big black bumpers
const VOLVO_BODY = [
  [-2.4, 0.36],
  [2.4, 0.36],
  [2.4, 0.98],
  [-0.9, 0.98],
  [-2.4, 0.9],
];
export const PROFILES: Record<string, Profile> = {
  volvo: {
    body: VOLVO_BODY,
    glass: [
      [-0.9, 0.97],
      [2.1, 0.97],
      [1.95, 1.48],
      [-0.35, 1.48],
    ],
    roof: [
      [-0.35, 1.47],
      [1.95, 1.47],
      [1.93, 1.54],
      [-0.33, 1.54],
    ],
    w: 1.74,
    gw: 1.56,
    wz: [-1.5, 1.45],
    len: 4.8,
  },
  saab: {
    body: [
      [-2.3, 0.34],
      [2.3, 0.34],
      [2.3, 0.95],
      [-0.8, 0.92],
      [-2.3, 0.84],
    ],
    glass: [
      [-0.8, 0.91],
      [2.15, 0.91],
      [2.1, 1.02],
      [0.75, 1.4],
      [-0.3, 1.4],
    ],
    roof: [
      [-0.3, 1.39],
      [0.75, 1.39],
      [0.73, 1.45],
      [-0.28, 1.45],
    ],
    w: 1.7,
    gw: 1.5,
    wz: [-1.45, 1.35],
    len: 4.6,
  },
  epa: {
    body: VOLVO_BODY,
    glass: [
      [-1.1, 0.97],
      [0.4, 0.97],
      [0.35, 1.5],
      [-0.7, 1.5],
    ],
    roof: [
      [-0.7, 1.49],
      [0.35, 1.49],
      [0.33, 1.56],
      [-0.68, 1.56],
    ],
    w: 1.74,
    gw: 1.56,
    wz: [-1.5, 1.4],
    len: 4.8,
    extra: c => [
      [1.74, 0.3, 0.08, 0, 1.1, 2.3, c],
      [0.08, 0.3, 1.8, -0.83, 1.1, 1.4, c],
      [0.08, 0.3, 1.8, 0.83, 1.1, 1.4, c],
      [0.5, 0.44, 0.05, 0, 1.2, 2.37, '#ff7a1a'],
    ],
  },
};
PROFILES.polis = Object.assign({}, PROFILES.volvo, {
  extra: (): BoxPart[] => [
    [1.78, 0.2, 3.2, 0, 0.7, 0.2, '#1f4fa3'],
    [1.79, 0.08, 3.2, 0, 0.56, 0.2, '#f2d21f'],
  ],
});
const tyreGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 16).rotateZ(Math.PI / 2),
  hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10).rotateZ(Math.PI / 2);
export const TRACTOR_CAB = {
  glass: [
    [0.05, 1.38],
    [1.45, 1.38],
    [1.45, 2.62],
    [0.25, 2.62],
    [0.05, 2.3],
  ],
  gw: 1.35,
};
// tractor: big rear wheels, small front wheels, a sloped bonnet and a glass cab (same size as the old box model)
function softTractor(c: string) {
  const parts: Part[] = [
    [
      extrude(
        [
          [-2.15, 0.78],
          [0.35, 0.78],
          [0.35, 1.52],
          [-1.85, 1.52],
          [-2.15, 1.3],
        ],
        0.95,
        0.08,
      ),
      c,
    ],
    [extrude(TRACTOR_CAB.glass, TRACTOR_CAB.gw, 0.05), GLASS],
    [
      extrude(
        [
          [-0.02, 2.6],
          [1.52, 2.6],
          [1.52, 2.72],
          [-0.02, 2.72],
        ],
        1.45,
        0.04,
      ),
      c,
    ],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8).translate(0.3, 1.85, -1.6), '#333'],
  ];
  for (const x of [-1, 1]) {
    parts.push(
      [new THREE.CylinderGeometry(0.8, 0.8, 0.5, 20).rotateZ(Math.PI / 2).translate(x * 0.95, 0.8, 0.9), TYRE],
      [new THREE.CylinderGeometry(0.42, 0.42, 0.52, 12).rotateZ(Math.PI / 2).translate(x * 0.95, 0.8, 0.9), c],
      [new THREE.CylinderGeometry(0.45, 0.45, 0.32, 16).rotateZ(Math.PI / 2).translate(x * 0.75, 0.45, -1.5), TYRE],
      [new THREE.CylinderGeometry(0.22, 0.22, 0.34, 10).rotateZ(Math.PI / 2).translate(x * 0.75, 0.45, -1.5), c],
    );
  }
  return mergeGeo(parts);
}
function softCar(t: string, c: string) {
  if (t === 'traktor') return softTractor(c);
  const P = PROFILES[t];
  const parts: Part[] = [
    [extrude(P.body, P.w, 0.07), c],
    [extrude(P.glass, P.gw, 0.05), GLASS],
    [extrude(P.roof, P.gw + 0.04, 0.03), c],
  ];
  for (const x of [-0.8, 0.8])
    for (const z of P.wz)
      parts.push([tyreGeo.clone().translate(x, 0.32, z), TYRE], [hubGeo.clone().translate(x, 0.32, z), '#a3a39e']);
  for (const z of [-1, 1]) parts.push(boxPart([P.w + 0.1, 0.17, 0.18, 0, 0.5, z * (P.len / 2 + 0.05), '#2b2b2b']));
  for (const p of [...lamps(P.len / 2 + 0.07), ...(P.extra ? P.extra(c) : [])]) parts.push(boxPart(p));
  return mergeGeo(parts);
}
export const geoCache: Record<string, THREE.BufferGeometry> = {};
// the geometry under `key`, made the first time it is asked for
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  geoCache[key] ||= make();
  return geoCache[key];
};
export const carGeo = (t: string, c: string) => cached(t + c, () => softCar(t, c));
export const BAR_BLUE = col(0x2f6bff),
  BAR_RED = col(0xff3b30);
export const barMat = new THREE.MeshBasicMaterial({ color: BAR_BLUE.clone() }),
  barGeo = new THREE.BoxGeometry(1.1, 0.16, 0.3);
export function personParts(shirt: string, pants: string, hair?: string | null, arms?: boolean) {
  // arms: separate meshes that swing from the shoulder (two more draw calls, so only the player has them)
  hair = hair || '#5a4632';
  const bk = shirt + hair + (arms ? '+arms' : ''),
    body = cached(bk, () =>
      boxGeo(
        (
          [
            [0.5, 0.65, 0.28, 0, 1.13, 0, shirt],
            [0.27, 0.27, 0.27, 0, 1.62, 0, '#e2b796'],
            [0.29, 0.1, 0.29, 0, 1.78, 0, hair],
          ] as BoxPart[]
        ).concat(
          arms
            ? []
            : [
                [0.14, 0.6, 0.16, -0.33, 1.12, 0, shirt],
                [0.14, 0.6, 0.16, 0.33, 1.12, 0, shirt],
              ],
        ),
      ),
    );
  const leg = cached(pants, () => boxGeo([[0.19, 0.8, 0.21, 0, -0.4, 0, pants]]));
  const g = new THREE.Group() as Person,
    b = new THREE.Mesh(body, paintMat),
    l = new THREE.Mesh(leg, paintMat),
    r = new THREE.Mesh(leg, paintMat);
  l.position.set(-0.13, 0.8, 0);
  r.position.set(0.13, 0.8, 0);
  b.castShadow = l.castShadow = r.castShadow = true;
  g.add(b, l, r);
  g.legs = [l, r];
  g.blob = blob(g, 0.9, 0.9);
  g.userData[INK_FLAG] = true; // inked in the toon style, like the cars and houses
  if (arms) {
    const ag = cached('arm' + shirt, () => boxGeo([[0.14, 0.6, 0.16, 0, -0.3, 0, shirt]]));
    g.arms = [-0.33, 0.33].map(x => {
      const a = new THREE.Mesh(ag, paintMat);
      a.position.set(x, 1.42, 0);
      a.castShadow = true;
      g.add(a);
      return a;
    });
  }
  return g;
}
