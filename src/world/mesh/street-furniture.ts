import '../three-legacy';
import * as THREE from 'three';
import type { FurnitureModelId, FurnitureSource } from '../furniture/definitions';
import type { FurniturePlacement } from '../furniture/placement';
import { SOURCE_TINTS } from './sidewalk-mesh';

// Street furniture as low-poly Swedish small-town models (#144): one InstancedMesh per model and map cell, set once
// and never updated. Models are built here from boxes and cylinders with a colour per part; placement never
// sees them. Origin on the ground; +z is a bench's front and the way a lamp's arm reaches.

/** A model: one vertex-coloured body, and the lamp glass apart so the night (#99) can light one shared material. */
export interface FurnitureModel {
  body: THREE.BufferGeometry;
  glass?: THREE.BufferGeometry;
}

// sRGB colours: painted steel, warm wood, park-bin green
const POLE = 0x3b4442;
const POLE_DARK = 0x2c3231;
const WOOD = 0x8a5a3a;
const BENCH_METAL = 0x2e3233;
const BIN = 0x2f4a3a;
const BIN_LID = 0x24382c;

type Part = [THREE.BufferGeometry, number];

/** One non-indexed geometry from parts, each with its own sRGB colour baked into a `color` attribute. */
function merge(parts: readonly Part[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const [g0, srgb] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    c.set(srgb).convertSRGBToLinear();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
    if (g !== g0) g0.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) =>
  new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z);
const cylinder = (rTop: number, rBottom: number, h: number, segments: number, y: number, open = false) =>
  new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open).translate(0, y + h / 2, 0);

/** A tapered pole with a single arm reaching over the road and a flat shoebox luminaire, `headScale` times the standard. */
function lamp(heightM: number, armM: number, headScale: number): FurnitureModel {
  const armTiltRad = -0.18; // the arm rises a little towards its end
  const armY = heightM - 0.25;
  return {
    body: merge([
      [cylinder(0.16, 0.18, 0.45, 8, 0), POLE_DARK], // foot
      [cylinder(0.055, 0.1, heightM - 0.45, 8, 0.45, true), POLE],
      [
        box(
          0.07,
          0.07,
          armM,
          0,
          armY + (Math.sin(-armTiltRad) * armM) / 2,
          (armM / 2) * Math.cos(armTiltRad),
          armTiltRad,
        ),
        POLE,
      ],
      [
        box(0.26 * headScale, 0.1 * headScale, 0.55 * headScale, 0, armY + Math.sin(-armTiltRad) * armM + 0.02, armM),
        POLE_DARK,
      ], // luminaire
    ]),
    glass: merge([
      [box(0.2 * headScale, 0.03, 0.45 * headScale, 0, armY + Math.sin(-armTiltRad) * armM - 0.045, armM), 0xf4ecd0],
    ]),
  };
}

const BACK_TILT = 0.1; // rad
/** the lower back slat's middle: the back leg's front face at its height (-0.24 + 0.025 - 0.195 tan BACK_TILT), plus half a slat */
const BACK_SLAT_Z = -0.24 + 0.025 - 0.195 * Math.tan(BACK_TILT) + 0.035 / 2;

/** Slatted wooden seat and back on dark painted metal ends, 1.8 × 0.6 × 0.8 m; it faces +z. */
function bench(): FurnitureModel {
  const parts: Part[] = [];
  for (const z of [-0.13, 0, 0.13]) parts.push([box(1.8, 0.04, 0.11, 0, 0.45, z), WOOD]);
  // the back leans back by BACK_TILT (rotateX by a negative angle tips the top towards -z), the slats on the legs' front
  for (const y of [0.6, 0.74])
    parts.push([box(1.8, 0.1, 0.035, 0, y, BACK_SLAT_Z - (y - 0.6) * Math.tan(BACK_TILT), -BACK_TILT), WOOD]);
  for (const x of [-0.78, 0.78]) {
    parts.push([box(0.05, 0.43, 0.05, x, 0.215, 0.2), BENCH_METAL]); // front leg
    parts.push([box(0.05, 0.8, 0.05, x, 0.405, -0.24, -BACK_TILT), BENCH_METAL]); // back leg and back support in one, tilted: lifted clear of the ground
    parts.push([box(0.05, 0.04, 0.5, x, 0.42, -0.02), BENCH_METAL]); // seat rail
  }
  return { body: merge(parts) };
}

/** A round park bin on a short post, about 0.45 × 0.8 m; the post is behind it (-z). */
function bin(): FurnitureModel {
  return {
    body: merge([
      [cylinder(0.025, 0.03, 0.85, 6, 0, true), POLE],
      [cylinder(0.2, 0.18, 0.55, 10, 0.25), BIN],
      [cylinder(0.215, 0.215, 0.05, 10, 0.8), BIN_LID],
    ]),
  };
}

// #305: what stands by the houses; each faces +z, the street
const WHEELIE = { green: 0x2f5d3a, black: 0x2a2c2d } as const;
const WHEEL = 0x1c1c1c;
// Swedish mailboxes: green, grey or black
const MAILBOX = { green: 0x2f4f3a, grey: 0x6b7069, black: 0x2a2b2c } as const;
const MAILBOX_COLOURS = Object.values(MAILBOX);
const MAILBOX_EDGE = 0x1e2120;
const WOOD_GREY = 0x7a6a58;
const CABINET = 0x7d8a80;
const CABINET_BASE = 0x4d5550;

/** A two-wheeled wheelie bin, lid hinged at the back by the wheels, about 0.6 × 0.72 × 1.05 m. */
function wheelieBin(colour: number): FurnitureModel {
  const axle = (x: number) =>
    new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8).rotateZ(Math.PI / 2).translate(x, 0.1, -0.25);
  return {
    body: merge([
      [box(0.56, 0.92, 0.66, 0, 0.5, 0.02), colour],
      [box(0.6, 0.05, 0.72, 0, 0.985, 0), colour], // the lid, overhanging a little
      [box(0.5, 0.04, 0.04, 0, 1.03, -0.33), WHEEL], // the handle
      [axle(-0.25), WHEEL],
      [axle(0.25), WHEEL],
    ]),
  };
}

/**
 * A Swedish mailbox: an upright rectangular box, taller than wide and wider than deep, with a lid that slopes down to the
 * front over the slot, about 0.34 × 0.4 × 0.2 m on top of a post at 0.85 m. Not the round-topped American tunnel.
 */
function mailboxParts(x: number, colour: number): Part[] {
  return [
    [box(0.34, 0.4, 0.2, x, 1.05, 0), colour],
    [box(0.36, 0.025, 0.24, x, 1.265, 0, 0.18), colour], // the lid, sloping to the front
    [box(0.3, 0.015, 0.005, x, 1.17, 0.1025), MAILBOX_EDGE], // the flap's edge across the front
  ];
}
function mailbox(colour: number): FurnitureModel {
  return { body: merge([[box(0.07, 0.86, 0.07, 0, 0.43, -0.02), WOOD_GREY], ...mailboxParts(0, colour)]) };
}

/** A wooden stand of `n` mailboxes side by side, at the road edge in the outskirts. */
function mailboxStand(n: number): FurnitureModel {
  const step = 0.4;
  const span = n * step;
  const parts: Part[] = [
    [box(0.08, 0.9, 0.08, -span / 2, 0.45, -0.06), WOOD_GREY],
    [box(0.08, 0.9, 0.08, span / 2, 0.45, -0.06), WOOD_GREY],
    [box(span + 0.08, 0.06, 0.26, 0, 0.84, 0), WOOD_GREY], // the shelf the boxes sit on
  ];
  for (let i = 0; i < n; i++)
    parts.push(...mailboxParts(-span / 2 + step * (i + 0.5), MAILBOX_COLOURS[i % MAILBOX_COLOURS.length]));
  return { body: merge(parts) };
}

/** A grey-green street cabinet on a dark plinth, about 0.8 × 0.4 × 1.2 m. */
function streetCabinet(): FurnitureModel {
  return {
    body: merge([
      [box(0.78, 0.12, 0.38, 0, 0.06, 0), CABINET_BASE],
      [box(0.76, 0.98, 0.36, 0, 0.61, 0), CABINET],
      [box(0.8, 0.08, 0.4, 0, 1.14, 0), CABINET], // the roof, overhanging a little
    ]),
  };
}

// #305: along the country roads
const POST_WHITE = 0xeeeeea,
  POST_BAND = 0x1d1e1f,
  REFLECTOR = 0xd8d4c8;
/** A white roadside post, about 1.05 m, with a black band near the top and a reflector on each side of it, facing along the
 * road, into the traffic either way (the post's +z faces the road). */
function roadsidePost(): FurnitureModel {
  return {
    body: merge([
      [box(0.1, 1.05, 0.1, 0, 0.525, 0), POST_WHITE],
      [box(0.105, 0.2, 0.105, 0, 0.82, 0), POST_BAND],
      [box(0.01, 0.1, 0.05, -0.057, 0.82, 0), REFLECTOR],
      [box(0.01, 0.1, 0.05, 0.057, 0.82, 0), REFLECTOR],
    ]),
  };
}

/** A wrapped round silage bale lying on its side, about 1.2 m across and long, its axis along x. */
function silageBale(wrap: number): FurnitureModel {
  return {
    body: merge([[new THREE.CylinderGeometry(0.6, 0.6, 1.2, 14).rotateZ(Math.PI / 2).translate(0, 0.6, 0), wrap]]),
  };
}

/** Every model by id; the registry is the seam where a GLB-backed model could later stand in (#59). */
export const FURNITURE_MODELS: Readonly<Record<FurnitureModelId, () => FurnitureModel>> = {
  'lamp-arm': () => lamp(6.5, 1.25, 1),
  'lamp-arm-short': () => lamp(5, 1, 0.8),
  'bench-wood': bench,
  'bin-green': bin,
  'wheelie-bin-green': () => wheelieBin(WHEELIE.green),
  'wheelie-bin-black': () => wheelieBin(WHEELIE.black),
  'mailbox-green': () => mailbox(MAILBOX.green),
  'mailbox-grey': () => mailbox(MAILBOX.grey),
  'mailbox-black': () => mailbox(MAILBOX.black),
  'mailbox-stand-3': () => mailboxStand(3),
  'mailbox-stand-4': () => mailboxStand(4),
  'mailbox-stand-5': () => mailboxStand(5),
  'mailbox-stand-6': () => mailboxStand(6),
  'street-cabinet': streetCabinet,
  'roadside-post': roadsidePost,
  'silage-bale-white': () => silageBale(0xe9ebe6),
  'silage-bale-green': () => silageBale(0x3d6545),
};

export interface StreetFurnitureOptions {
  /** the ground under (x, z), the same people stand on */
  groundAt(x: number, z: number): number;
  /** tint each object by its source (OSM green, override yellow, procedural red): the ?debug=furniture view */
  debugSources?: boolean;
}

const SOURCE_INDEX: Record<FurnitureSource, number> = { osm: 0, override: 1, procedural: 2 };
/** each model's instances are split into cells this big (m), so the main and shadow passes cull whole cells, as the trees do */
const CELL_M = 400;

/**
 * The meshes for a set of placements: one InstancedMesh per model body and per lamp glass in each CELL_M cell. Adds nothing to a scene;
 * dispose() frees every geometry and material made here.
 */
export class StreetFurniture {
  readonly meshes: THREE.InstancedMesh[] = [];
  /** the lamp glass, shared by every lamp, for the night (#99) to light */
  readonly materials: { body: THREE.MeshLambertMaterial; luminaire: THREE.MeshLambertMaterial };
  readonly triangles: number;

  constructor(placements: readonly FurniturePlacement[], { groundAt, debugSources = false }: StreetFurnitureOptions) {
    this.materials = {
      body: new THREE.MeshLambertMaterial({ vertexColors: true }),
      luminaire: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    // three bounds an InstancedMesh by all its instances: one for the whole world would never be culled
    const byCell = new Map<string, { id: FurnitureModelId; list: FurniturePlacement[] }>();
    for (const p of placements) {
      const key = `${p.modelId}|${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`;
      let cell = byCell.get(key);
      if (!cell) {
        cell = { id: p.modelId, list: [] };
        byCell.set(key, cell);
      }
      cell.list.push(p);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let triangles = 0;
    for (const { id, list } of byCell.values()) {
      const model = FURNITURE_MODELS[id]();
      const parts: [THREE.BufferGeometry, THREE.MeshLambertMaterial, boolean][] = [
        [model.body, this.materials.body, true],
      ];
      if (model.glass) parts.push([model.glass, this.materials.luminaire, false]);
      for (const [geometry, material, shadows] of parts) {
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        mesh.name = `furniture:${id}${shadows ? '' : ':glass'}`;
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.rotationY);
          mesh.setMatrixAt(i, m.compose(v.set(p.x, groundAt(p.x, p.z), p.z), q, s.setScalar(p.scale)));
          if (debugSources) mesh.setColorAt(i, tint.set(SOURCE_TINTS[SOURCE_INDEX[p.source]]).convertSRGBToLinear());
        });
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        mesh.matrixAutoUpdate = false;
        mesh.computeBoundingSphere(); // over this cell's instances
        triangles += (geometry.getAttribute('position').count / 3) * list.length;
        this.meshes.push(mesh);
      }
    }
    this.triangles = triangles;
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.materials.body.dispose();
    this.materials.luminaire.dispose();
  }
}
