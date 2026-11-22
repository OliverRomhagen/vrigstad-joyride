import '../three-legacy';
import * as THREE from 'three';
import { type Bridge, type BridgeArchetype, type BridgeIndex, EDGE_BEAM_M, WALKWAY_CURB_M } from '../bridges';
import { mitreAt, pointAtArc, resample } from '../polyline';
import { hash01 } from '../random';

// The bridges' structure (#238): deck, edge beams or girders, walkways and railings, as one vertex-coloured body and
// one railing mesh per bridge. Every part is a box swept along the deck, its heights relative to the driving surface
// BridgeIndex works out, so the structure follows the same crest and cross-fall as the ribbon on top.

// sRGB tokens: restrained concrete, weathered timber, painted steel (#225's palette family)
const COLOURS = {
  concrete: 0xa9a398,
  edgeBeam: 0xbdb7aa,
  walkway: 0xb3ada1,
  steelDark: 0x6e7471,
  steelGreen: 0x4f5e4e,
  steelDeck: 0x8c8980,
  timber: 0x8a6a4a,
  boards: 0x9c7b57,
} as const;
type Token = keyof typeof COLOURS;
/** undersides are darkened, so the deck's thickness and its shadow read from the side */
const UNDERSIDE_SHADE = 0.6;

/** the parts are swept every this many metres, so the crest is smooth (m) */
const SWEEP_STEP_M = 1;
/** railings start and end this far inside the deck's ends (m) */
const RAILING_INSET_M = 0.3;

// ---------- cross-sections (game-design values, all inferred: OSM maps none of this here) ----------
const SLAB_DEPTH_M = 0.7;
/** the ribbon is the driving surface in the game; the deck's own top sits this far under it (m) */
const UNDER_RIBBON_M = 0.05;
const EDGE_BEAM_UP_M = 0.15;
const STEEL_PLATE_M = 0.12;
const STEEL_GIRDER_M = 0.45;
const STEEL_GIRDER_W_M = 0.15;
const STEEL_GIRDER_UP_M = 0.1;
const TIMBER_BOARDS_M = 0.08;
const TIMBER_BEAM_M = 0.3;
const TIMBER_BEAM_W_M = 0.2;

interface Railing {
  /** from the centre line (m) */
  offsetM: number;
  /** where the posts stand, above the driving surface (m) */
  footM: number;
  heightM: number;
  postEveryM: number;
  postM: number;
  railM: number;
  /** mid rails, as fractions of the height */
  mids: number[];
  colour: Token;
}

/** A box swept along the deck: from `o0` to `o1` across (m, right positive), `y0` to `y1` over the driving surface. */
interface Part {
  o0: number;
  o1: number;
  y0: number;
  y1: number;
  colour: Token;
}

function crossSection(b: Bridge, top: boolean): { parts: Part[]; railing: Railing } {
  const h = b.halfWidthM;
  const kind: BridgeArchetype = b.archetype;
  if (kind === 'road-slab') {
    const c = b.carriageM / 2;
    const w = c + b.walkwayM;
    const beamTop = WALKWAY_CURB_M + EDGE_BEAM_UP_M;
    const parts: Part[] = [
      { o0: -h, o1: h, y0: -SLAB_DEPTH_M, y1: -UNDER_RIBBON_M, colour: 'concrete' },
      { o0: -w, o1: -c, y0: -UNDER_RIBBON_M, y1: WALKWAY_CURB_M, colour: 'walkway' },
      { o0: c, o1: w, y0: -UNDER_RIBBON_M, y1: WALKWAY_CURB_M, colour: 'walkway' },
      { o0: -h, o1: -w, y0: -UNDER_RIBBON_M, y1: beamTop, colour: 'edgeBeam' },
      { o0: w, o1: h, y0: -UNDER_RIBBON_M, y1: beamTop, colour: 'edgeBeam' },
    ];
    // the map has no ribbons: its deck draws the carriageway itself, in concrete, so it reads as a structure there
    if (top) parts.push({ o0: -c, o1: c, y0: -UNDER_RIBBON_M, y1: 0, colour: 'walkway' });
    return {
      parts,
      railing: {
        offsetM: h - EDGE_BEAM_M / 2,
        footM: beamTop,
        heightM: WALKWAY_CURB_M + 1.1 - beamTop,
        postEveryM: 2,
        postM: 0.08,
        railM: 0.06,
        mids: [0.5],
        colour: 'steelDark',
      },
    };
  }
  const surface = top ? 0 : -0.03;
  if (kind === 'path-steel') {
    const g = h - STEEL_GIRDER_W_M;
    // the only cosmetic choice: which of the two steel paints, from the bridge's key
    const paint: Token = hash01(b.key, 'paint') < 0.5 ? 'steelGreen' : 'steelDark';
    return {
      parts: [
        { o0: -g, o1: g, y0: -STEEL_PLATE_M, y1: surface, colour: 'steelDeck' },
        { o0: -h, o1: -g, y0: -STEEL_GIRDER_M, y1: STEEL_GIRDER_UP_M, colour: paint },
        { o0: g, o1: h, y0: -STEEL_GIRDER_M, y1: STEEL_GIRDER_UP_M, colour: paint },
      ],
      railing: {
        offsetM: h - STEEL_GIRDER_W_M / 2,
        footM: STEEL_GIRDER_UP_M,
        // a cycle bridge's 3 m deck gets the higher railing
        heightM: (b.halfWidthM >= 1.5 ? 1.3 : 1.2) - STEEL_GIRDER_UP_M,
        postEveryM: 1.5,
        postM: 0.07,
        railM: 0.05,
        mids: [0.35, 0.7],
        colour: paint,
      },
    };
  }
  const beam = h - 0.35;
  return {
    parts: [
      { o0: -h, o1: h, y0: -TIMBER_BOARDS_M, y1: surface, colour: 'boards' },
      {
        o0: -beam - TIMBER_BEAM_W_M / 2,
        o1: -beam + TIMBER_BEAM_W_M / 2,
        y0: -TIMBER_BEAM_M,
        y1: -TIMBER_BOARDS_M,
        colour: 'timber',
      },
      {
        o0: beam - TIMBER_BEAM_W_M / 2,
        o1: beam + TIMBER_BEAM_W_M / 2,
        y0: -TIMBER_BEAM_M,
        y1: -TIMBER_BOARDS_M,
        colour: 'timber',
      },
    ],
    railing: {
      offsetM: h - 0.05,
      footM: surface,
      heightM: 1,
      postEveryM: 1.5,
      postM: 0.1,
      railM: 0.08,
      mids: [0.5],
      colour: 'timber',
    },
  };
}

export interface BridgeMeshOptions {
  /** vertex-coloured materials, the page's: it styles and frees them */
  materials: { body: THREE.Material; railing: THREE.Material };
  /** draw the driving surface too: the map, which has no road ribbons */
  top: boolean;
}

type V3 = [number, number, number];

/** Collects triangles with a colour each, wound to face away from the centre of the prism they belong to. */
class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();

  /** A quad a-b-c-d, flipped if needed so its normal points along `out`. */
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, colour: Token, shade = 1) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2];
    const [p, q] = dot >= 0 ? [b, d] : [d, b];
    this.c.set(COLOURS[colour]).convertSRGBToLinear().multiplyScalar(shade);
    for (const v of [a, p, c, a, c, q]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /**
   * A convex prism from four bottom and four top corners, in order round it. `faces` picks which to emit: the sides
   * 0–3 (side k runs from corner k to k + 1), 4 the top and 5 the bottom, darkened as an underside.
   */
  prism(bottom: V3[], topC: V3[], faces: readonly number[], colour: Token) {
    const cx = (bottom[0][0] + bottom[1][0] + bottom[2][0] + bottom[3][0]) / 4;
    const cz = (bottom[0][2] + bottom[1][2] + bottom[2][2] + bottom[3][2]) / 4;
    for (const f of faces) {
      if (f === 4) this.quad(topC[0], topC[1], topC[2], topC[3], [0, 1, 0], colour);
      else if (f === 5) this.quad(bottom[0], bottom[1], bottom[2], bottom[3], [0, -1, 0], colour, UNDERSIDE_SHADE);
      else {
        const k = (f + 1) % 4;
        const out: V3 = [(bottom[f][0] + bottom[k][0]) / 2 - cx, 0, (bottom[f][2] + bottom[k][2]) / 2 - cz];
        this.quad(bottom[f], bottom[k], topC[k], topC[f], out, colour);
      }
    }
  }

  mesh(material: THREE.Material, origin: V3) {
    const g = new THREE.BufferGeometry();
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] -= origin[0];
      this.pos[i + 1] -= origin[1];
      this.pos[i + 2] -= origin[2];
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.position.set(...origin);
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    return m;
  }
}

/**
 * Every bridge's structure, in coordinates local to its centre: a body mesh (deck, beams, walkways) that casts and
 * receives shadows, and a railing mesh that casts them. Adds nothing to a scene; `dispose()` frees the geometry it
 * made, and the materials stay the page's.
 */
export class BridgeMesh {
  readonly meshes: THREE.Mesh[] = [];
  readonly triangles: number = 0;

  constructor(index: Pick<BridgeIndex, 'bridges' | 'surfaceAt'>, { materials, top }: BridgeMeshOptions) {
    for (const b of index.bridges) {
      const { parts, railing } = crossSection(b, top);
      const q = resample(b.p, SWEEP_STEP_M);
      const s: number[] = [0];
      for (let i = 1; i < q.length; i++) s.push(s[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
      const frames = q.map((p, i) => {
        const m = mitreAt(q, i);
        const k = Number.isNaN(m.scale) ? 1 : m.scale;
        return { x: p[0], z: p[1], nx: m.nx * k, nz: m.nz * k, s: s[i] };
      });
      // a point `o` across at frame f, `dy` over the driving surface there
      const at = (f: (typeof frames)[number], o: number, dy: number): V3 => {
        const x = f.x + f.nx * o;
        const z = f.z + f.nz * o;
        return [x, index.surfaceAt(b, x, z, f.s) + dy, z];
      };

      const body = new Soup();
      for (const part of parts)
        for (let i = 1; i < frames.length; i++) {
          const [f0, f1] = [frames[i - 1], frames[i]];
          // corners in order round the prism: start left, end left, end right, start right
          const corner = (dy: number): V3[] => [
            at(f0, part.o0, dy),
            at(f1, part.o0, dy),
            at(f1, part.o1, dy),
            at(f0, part.o1, dy),
          ];
          const faces = [0, 2, 4, 5];
          if (i === frames.length - 1) faces.push(1);
          if (i === 1) faces.push(3);
          body.prism(corner(part.y0), corner(part.y1), faces, part.colour);
        }

      const rails = new Soup();
      const r = railing;
      for (const side of [-1, 1]) {
        const o = side * r.offsetM;
        // posts, evenly spaced between the insets
        const run = b.spanM - 2 * RAILING_INSET_M;
        const posts = Math.max(1, Math.round(run / r.postEveryM));
        for (let k = 0; k <= posts; k++) {
          const sk = RAILING_INSET_M + (run * k) / posts;
          const pt = pointAtArc(b.p, b.arcs, sk);
          const f = { x: pt.x, z: pt.z, nx: -pt.tz, nz: pt.tx, s: sk };
          const h = r.postM / 2;
          const c = (dy: number): V3[] =>
            [
              [-h, -h],
              [h, -h],
              [h, h],
              [-h, h],
            ].map(([a, t]) => {
              const p = at(f, o + a, 0);
              return [p[0] + pt.tx * t, at(f, o, dy)[1], p[2] + pt.tz * t];
            });
          rails.prism(c(r.footM), c(r.footM + r.heightM), [0, 1, 2, 3, 4], r.colour);
        }
        // the top rail and the mid rails, swept between the insets
        const inside = frames.filter(f => f.s > RAILING_INSET_M && f.s < b.spanM - RAILING_INSET_M);
        const ends = [RAILING_INSET_M, b.spanM - RAILING_INSET_M].map(sk => {
          const pt = pointAtArc(b.p, b.arcs, sk);
          return { x: pt.x, z: pt.z, nx: -pt.tz, nz: pt.tx, s: sk };
        });
        const path = [ends[0], ...inside, ends[1]];
        for (const level of [...r.mids, 1]) {
          const y1 = r.footM + r.heightM * level;
          const y0 = y1 - r.railM;
          for (let i = 1; i < path.length; i++) {
            const [f0, f1] = [path[i - 1], path[i]];
            const corner = (dy: number): V3[] => [
              at(f0, o - r.railM / 2, dy),
              at(f1, o - r.railM / 2, dy),
              at(f1, o + r.railM / 2, dy),
              at(f0, o + r.railM / 2, dy),
            ];
            const faces = [0, 2, 4, 5];
            if (i === path.length - 1) faces.push(1);
            if (i === 1) faces.push(3);
            rails.prism(corner(y0), corner(y1), faces, r.colour);
          }
        }
      }

      const mid = pointAtArc(b.p, b.arcs, b.spanM / 2);
      const origin: V3 = [mid.x, index.surfaceAt(b, mid.x, mid.z, b.spanM / 2), mid.z];
      const bodyMesh = body.mesh(materials.body, origin);
      bodyMesh.castShadow = bodyMesh.receiveShadow = true;
      bodyMesh.name = 'bridge-body:' + b.key;
      const railMesh = rails.mesh(materials.railing, origin);
      railMesh.castShadow = true;
      railMesh.name = 'bridge-railing:' + b.key;
      this.meshes.push(bodyMesh, railMesh);
      this.triangles += (body.pos.length + rails.pos.length) / 9;
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
  }
}
