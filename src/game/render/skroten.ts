// Skroten's yard in the scene (#76): gravel, a fence of mismatched sheet metal topped with barbed wire, the gate with its sign, the hut,
// the containers, the cars and the scrap heaps, the arrow signs by the road, and Plåt-Pelle, who turns to watch you come.
// The layout comes from skroten-yard.ts; the static parts are baked into one mesh, so the yard costs a handful of draw calls.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import type { BoxPart } from '../box-part';
import {
  type Carport,
  CONTAINERS,
  floorAt,
  HUT,
  OWNER_UV,
  PROP_SIZE,
  RAMP_M,
  SALE_SIGN,
  WORKSHOP_DOOR,
  type Workshop,
  type WorkshopProp,
  YARD,
  YARD_GATE,
  YARD_TURN,
  type YardCar,
  type YardCarModel,
  type YardLayout,
  yardFloorAt,
  yardToWorld,
} from '../skroten-yard';
import { boxGeo, carGeo, mergeGeo, type Person, paintMat, personParts } from './models';
import { BODY_NODE, CIVILIAN_CAR_TYPES, VEHICLES } from './vehicle-registry';

const PANEL_M = 3; // a sheet of the fence, and the gap between its posts
const SELLS_MIN_W_M = 1.5; // the SÄLJER BILAR board is left out where the fence leaves it less room than this
const FENCE_COLOURS = ['#8b8f91', '#9a6a4a', '#6f7c86', '#a3a7a3', '#7e4a30', '#86847a'];
const WIRE_HEIGHTS_M = [2.45, 2.65, 2.85];
const SCRAP_COLOURS = ['#7d3a24', '#8f4f2c', '#6b6f6f', '#9a9a92', '#5c4434', '#a0522d', '#4f5a63'];
const RUST = '#8a4a2a', // the boards
  POST = '#5b4a3a',
  WIRE = '#2e2e2e',
  TYRE = '#1c1c1c',
  CREAM = '#e8e2d2';
const GATE_SIGN_Y_M = 4.6;
const GATE_POST_U_M = YARD.gateHalf + 0.6; // the gate's posts stand this far either side of its middle
const SALE_BOARD = { h: 1.7, y: 2 } as const; // the TILL SALU board's height and the height of its middle (m); its width is SALE_SIGN.w
const OWNER_SEES_M = 30; // he turns to face you inside this distance
const OWNER_TURN_K = 3; // how quickly he turns, per second
const CAR_DETAIL_M = 150, // the cars wear the game's car models inside this distance of the yard's middle, on a computer
  CAR_LOAD_M = 300; // and the models start loading when you come this close
const WRECK_SINK_M = 0.12; // a wreck's flat tyres
const STACK_SQUASH = 0.8; // a wreck with another on top is pressed this low
const YARD_TEX_PX = 1024; // the dirty asphalt's width in pixels, over the yard's width
const CONTAINER_H_M = 2.6;
// the workshop as it stands: one storey of pale brick with a dark blue clad wing, a brown band under the eaves, and a cream gabled hall
// with a rusty roof rising behind
const HALL_H_M = 6, // the walls, from the floor at the door
  HALL_MIN_H_M = 3.8, // and at least this over the floor where it is highest
  HALL_WALL_M = 0.25,
  GABLE_RISE_M = 2.6, // the gabled hall's ridge over the walls' top
  CLAD_RIB_M = 0.5,
  BRICK = '#cfc8b8',
  CLAD = '#2f3b52',
  FASCIA = '#6b3a2a',
  GABLE_CREAM = '#d8c48a',
  RUST_ROOF = '#6e3f28',
  FLAT_ROOF = '#4a4c4e',
  CONCRETE = '#8e8b84',
  WINDOW_EVERY_M = 3.6;
// the carport: wooden walls and posts under a long gabled roof of rusty sheet
const SHED_WALL_M = 3.4,
  SHED_RISE_M = 2,
  WOOD = '#6b4a32';

/** What the yard's meshes read from the rest of the game. */
export interface SkrotenMeshDeps {
  scene: THREE.Scene;
  heightAt(x: number, z: number): number;
  layout: YardLayout;
  coarse: boolean; // a phone: the cars keep their simple shapes, the models cost too many triangles, and nothing casts a shadow
  /** A car model's loaded scene, shared with the cars on the road (VehicleVisuals.template); read, never changed. */
  carModel(definition: { id: string; url: string }): Promise<THREE.Object3D>;
}

/** The yard and Plåt-Pelle; `update` turns him towards you. */
export class SkrotenMeshes {
  private readonly owner: Person;
  private ownerH = 0;
  private readonly middle = yardToWorld(0, YARD.depth / 2);
  private farCars: THREE.Mesh | null = null; // the detailed cars' simple shapes, until the models load and while you are far
  private nearCars: THREE.Group | null = null;
  private loadNear: (() => void) | null = null; // starts loading the models, once

  constructor(g: SkrotenMeshDeps) {
    const { scene, heightAt, layout } = g,
      rnd = makeRnd(911), // the heaps' and fence's looks: their own stream
      pieces: THREE.BufferGeometry[] = [],
      groundY = (u: number, v: number) => {
        const p = yardToWorld(u, v);
        return heightAt(p.x, p.z);
      },
      // what a car or a prop stands on: the workshop's or the carport's floor, else the ground
      standY = (u: number, v: number) => {
        const p = yardToWorld(u, v);
        return yardFloorAt(layout, p.x, p.z, heightAt) ?? heightAt(p.x, p.z);
      };
    // places a coloured geometry at (u, y, v) of the yard's frame, turned and tilted
    const put = (
      geo: THREE.BufferGeometry,
      u: number,
      y: number,
      v: number,
      turn = 0,
      tilt = 0,
      into = pieces,
      pitch = 0,
      squash = 1,
    ) => {
      into.push(geo.clone().applyMatrix4(placing(u, y, v, turn, tilt, pitch, squash)));
    };

    // the fence, panel by panel, each on the ground under it
    for (const f of layout.fence) {
      const len = Math.hypot(f.u1 - f.u0, f.v1 - f.v0),
        n = Math.max(1, Math.round(len / PANEL_M)),
        step = len / n,
        turn = -Math.atan2(f.v1 - f.v0, f.u1 - f.u0);
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          u = f.u0 + (f.u1 - f.u0) * t,
          v = f.v0 + (f.v1 - f.v0) * t,
          y = groundY(u, v);
        put(boxGeo([[0.12, 3, 0.12, 0, 1.5, 0, POST]]), u, y, v, turn);
        if (i === n) break;
        const mu = f.u0 + (f.u1 - f.u0) * (t + 0.5 / n),
          mv = f.v0 + (f.v1 - f.v0) * (t + 0.5 / n),
          my = groundY(mu, mv),
          h = 2 + rnd() * 0.3;
        put(
          boxGeo([
            [step + 0.02, h, 0.05, 0, h / 2, 0, FENCE_COLOURS[Math.floor(rnd() * FENCE_COLOURS.length)]],
            ...WIRE_HEIGHTS_M.map(wy => [step, 0.025, 0.025, 0, wy, 0, WIRE] as BoxPart),
          ]),
          mu,
          my,
          mv,
          turn,
          (rnd() - 0.5) * 0.03,
        );
      }
    }

    // dirty asphalt over the yard, out to the road, and back to the fence's furthest corner, following the ground
    const uEast = Math.max(...layout.fence.flatMap(f => [f.u0, f.u1])),
      vBack = Math.max(...layout.fence.flatMap(f => [f.v0, f.v1]));
    const gravel = new THREE.MeshLambertMaterial({
      map: dirtyAsphalt(YARD_TEX_PX, Math.round((YARD_TEX_PX * (vBack + 5.5)) / (uEast - YARD.uMin))),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const ground = (u0: number, u1: number, v0: number, v1: number) => {
      const geo = new THREE.PlaneGeometry(u1 - u0, v1 - v0, Math.ceil((u1 - u0) / 3), Math.ceil((v1 - v0) / 3));
      geo.rotateX(-Math.PI / 2).translate((u0 + u1) / 2, 0, (v0 + v1) / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, groundY(pos.getX(i), pos.getZ(i)) + 0.05);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, gravel);
      m.receiveShadow = true;
      return m;
    };

    // the hut by the gate: windows to the road, the door towards the ring
    put(
      boxGeo([
        [HUT.w, 0.3, HUT.d, 0, 0.15, 0, '#3a3a36'],
        [HUT.w, 2.4, HUT.d, 0, 1.5, 0, '#6d8a77'],
        [HUT.w + 0.4, 0.15, HUT.d + 0.4, 0, 2.78, 0, '#3b3b3b'],
        [1.4, 0.9, 0.06, -1.6, 1.7, -HUT.d / 2 - 0.02, '#26323a'],
        [1.4, 0.9, 0.06, 1.2, 1.7, -HUT.d / 2 - 0.02, '#26323a'],
        [0.06, 2, 0.95, HUT.w / 2 + 0.02, 1.3, 0.3, '#4a3a2a'],
        [0.1, 0.1, 0.1, HUT.w / 2 + 0.07, 1.3, 0.65, '#c8c8c0'],
      ]),
      HUT.u,
      groundY(HUT.u, HUT.v),
      HUT.v,
    );

    // two containers, and a third across them
    const { u: cu, v: cv, w: cw, d: cd } = CONTAINERS,
      cy = groundY(cu, cv);
    put(boxGeo(container(cw, cd, '#9b3b2a')), cu, cy, cv - cd / 2);
    put(boxGeo(container(cw, cd, '#2f5a7a')), cu, cy, cv + cd / 2, Math.PI);
    put(boxGeo(container(cw, cd, '#5a6b3a')), cu - 0.4, cy + CONTAINER_H_M, cv, Math.PI / 2 + 0.08);

    // the cars: flat tyres and faded paint, and in the back row one car on another. Those standing alone wear the game's car models
    // near the yard (loadCars), and their simple shapes until then and from afar; stacked cars and tractors keep the simple shapes.
    const detailed = g.coarse ? [] : layout.yardCars.filter(w => w.stack === 0 && w.model !== 'traktor'),
      farPieces: THREE.BufferGeometry[] = [];
    let lowerTop = 0;
    for (const w of layout.yardCars) {
      const geo = carGeo(simpleType(w.model), w.colour),
        y = standY(w.u, w.v) - WRECK_SINK_M, // all wrecks: the cars for sale are fleet cars
        squash = w.stack === 1 ? STACK_SQUASH : 1;
      if (w.stack === 1) {
        geo.computeBoundingBox();
        lowerTop = geo.boundingBox!.max.y * STACK_SQUASH - 0.08; // the next car lies on this one's caved-in roof
      }
      put(
        geo,
        w.u,
        y + (w.stack === 2 ? lowerTop : 0),
        w.v,
        w.turn,
        w.tilt,
        detailed.includes(w) ? farPieces : pieces,
        w.pitch,
        squash,
      );
    }

    // the wheel off the broken tractor, lying flat beside it
    if (layout.looseWheel) {
      const { u, v } = layout.looseWheel;
      put(
        mergeGeo([
          [new THREE.CylinderGeometry(0.8, 0.8, 0.45, 20), TYRE],
          [new THREE.CylinderGeometry(0.42, 0.42, 0.47, 12), '#8a2f2a'],
        ]),
        u,
        groundY(u, v) + 0.22,
        v,
        0,
        0.06,
      );
    }

    // the heaps: a mound of sheet, beams and engine blocks over a solid core of rust, higher in the middle
    for (const h of layout.heaps) {
      const y0 = groundY(h.u, h.v),
        core = new THREE.ConeGeometry(h.r * 0.95, h.r * 0.62, 9, 2),
        cp = core.attributes.position;
      for (let i = 0; i < cp.count; i++) if (cp.getY(i) < h.r * 0.3) cp.setX(i, cp.getX(i) * (0.9 + rnd() * 0.2)); // a lumpy edge
      put(mergeGeo([[core, '#4b3a2c']]), h.u, y0 + h.r * 0.31 - 0.08, h.v, rnd() * Math.PI);
      for (let i = 0; i < h.r * 18; i++) {
        const a = rnd() * Math.PI * 2,
          d = Math.sqrt(rnd()) * h.r,
          w = 0.3 + rnd() * 1.5,
          t = 0.15 + rnd() * 0.5,
          l = 0.3 + rnd() * 1.2,
          y = (1 - d / h.r) * h.r * 0.55 + rnd() * 0.3;
        put(
          boxGeo([[w, t, l, 0, 0, 0, SCRAP_COLOURS[Math.floor(rnd() * SCRAP_COLOURS.length)]]]),
          h.u + Math.sin(a) * d,
          y0 + y,
          h.v + Math.cos(a) * d,
          rnd() * Math.PI,
          (rnd() - 0.5) * 1.2,
        );
      }
    }

    // stacks of old tyres
    const tyre = mergeGeo([[new THREE.CylinderGeometry(0.38, 0.38, 0.24, 14), TYRE]]);
    for (const t of layout.tyres) {
      const y0 = groundY(t.u, t.v);
      for (let i = 0; i < t.n; i++)
        put(
          tyre,
          t.u + (rnd() - 0.5) * 0.08,
          y0 + 0.12 + i * 0.25,
          t.v + (rnd() - 0.5) * 0.08,
          0,
          (rnd() - 0.5) * 0.08,
        );
    }

    // the gate's posts, and the posts of the arrow signs
    for (const u of [-GATE_POST_U_M, GATE_POST_U_M])
      put(boxGeo([[0.3, GATE_SIGN_Y_M + 0.7, 0.3, 0, (GATE_SIGN_Y_M + 0.7) / 2, 0, POST]]), u, groundY(u, 0), 0);
    for (const s of layout.signs) // behind the board, whose front faces the drivers coming towards the yard
      put(boxGeo([[0.1, 2.6, 0.1, 0, 1.3, 0, '#9a9a92']]), s.u + s.facing * 0.1, groundY(s.u, s.v), s.v);

    // inside the workshop, on its floor: the bench, shelves, the tyre rack and the lift's posts
    for (const pr of layout.workshop?.props ?? []) put(boxGeo(propParts(pr)), pr.u, standY(pr.u, pr.v), pr.v, pr.turn);

    const yard = new THREE.Group();
    yard.position.set(YARD_GATE.x, 0, YARD_GATE.z);
    yard.rotation.y = YARD_TURN;
    const baked = new THREE.Mesh(bake(pieces), paintMat);
    baked.castShadow = baked.receiveShadow = true;
    yard.add(baked, ground(YARD.uMin, uEast, -5.5, vBack));

    // the boards: SKROTEN over the gate, BILAR KÖPES on the fence west of it and SÄLJER BILAR east of it, and an arrow sign either way
    // along the road
    const gate = board(2 * GATE_POST_U_M + 0.7, 1.5, 'SKROTEN', null); // across both posts, fixed to their road side
    gate.position.set(0, groundY(0, 0) + GATE_SIGN_Y_M, -0.2);
    const buys = board(4, 1, 'BILAR KÖPES', null);
    buys.position.set(-22, groundY(-22, 0) + 1.3, -0.08);
    // the fence east of the gate runs to the workshop, as long as the hall leaves it: the board sits in its middle, and fits it
    const eastRun = layout.fence.find(f => f.v0 === 0 && f.v1 === 0 && f.u0 === YARD.gateHalf),
      eastEnd = eastRun?.u1 ?? YARD.uMax,
      sellsW = Math.min(4, eastEnd - YARD.gateHalf - 1),
      sellsU = (YARD.gateHalf + eastEnd) / 2;
    gate.rotation.y = buys.rotation.y = Math.PI; // their fronts face the road
    yard.add(gate, buys);
    if (sellsW >= SELLS_MIN_W_M) {
      // left out if a data refresh ever brings the hall within a few metres of the gate
      const sells = board(sellsW, 1, 'SÄLJER BILAR', null);
      sells.position.set(sellsU, groundY(sellsU, 0) + 1.3, -0.08);
      sells.rotation.y = Math.PI;
      yard.add(sells);
    }
    // TILL SALU on two posts in front of the cars for sale, facing the yard
    const sale = saleSign();
    sale.position.set(SALE_SIGN.u, groundY(SALE_SIGN.u, SALE_SIGN.v), SALE_SIGN.v);
    sale.rotation.y = Math.PI;
    yard.add(sale);
    for (const s of layout.signs) {
      const b = board(2.4, 1, 'SKROTEN', s.facing);
      b.position.set(s.u, groundY(s.u, s.v) + 2.2, s.v);
      b.rotation.y = -s.facing * (Math.PI / 2); // faces the drivers coming towards the yard
      yard.add(b);
    }
    if (farPieces.length) {
      this.farCars = new THREE.Mesh(bake(farPieces), paintMat);
      this.farCars.castShadow = this.farCars.receiveShadow = true;
      yard.add(this.farCars);
      this.loadNear = () => void this.loadCars(detailed, yard, standY, g.carModel);
    }
    const built: THREE.Object3D[] = [yard];
    if (layout.workshop) built.push(hallMeshes(heightAt, layout.workshop));
    if (layout.carport) built.push(carportMeshes(heightAt, layout.carport));
    // on a phone nothing here casts a shadow, as the cars on the road don't (VehicleVisuals); the yard's models are skipped there anyway
    if (g.coarse)
      for (const b of built)
        b.traverse(o => {
          o.castShadow = false;
        });
    scene.add(...built);

    const owner = platPelle();
    const at = yardToWorld(OWNER_UV.u, OWNER_UV.v);
    owner.position.set(at.x, heightAt(at.x, at.z), at.z);
    const road = yardToWorld(OWNER_UV.u, OWNER_UV.v - 1);
    this.ownerH = Math.atan2(road.x - at.x, at.z - road.z); // looks towards the road until you come
    owner.rotation.y = -this.ownerH;
    scene.add(owner);
    this.owner = owner;
  }

  // the game's car models for the cars standing alone: one model loaded per kind, its paint and the rest each drawn as one instanced
  // mesh, so the paint takes each wreck's colour. A model that fails to load leaves the simple shapes up.
  private async loadCars(
    list: YardCar[],
    parent: THREE.Group,
    standY: (u: number, v: number) => number,
    carModel: SkrotenMeshDeps['carModel'],
  ) {
    const group = new THREE.Group(),
      byModel = new Map<YardCarModel, YardCar[]>(),
      paint = new THREE.MeshLambertMaterial({ vertexColors: true }),
      colour = new THREE.Color();
    for (const w of list) byModel.set(w.model, [...(byModel.get(w.model) ?? []), w]);
    try {
      await Promise.all(
        [...byModel].map(async ([id, yardCars]) => {
          const def = VEHICLES.find(v => v.id === id);
          if (!def) throw new Error('no model ' + id);
          const parts = flatten((await carModel(def)).clone(true)); // flatten updates its matrices: leave the shared one be
          // every one a wreck (the cars for sale are fleet cars): its paint patched with rust and dirtier low down
          const body = new THREE.InstancedMesh(rusted(parts.paint), paint, yardCars.length),
            trim = new THREE.InstancedMesh(parts.rest, paintMat, yardCars.length);
          yardCars.forEach((w, i) => {
            const m = placing(w.u, standY(w.u, w.v) - WRECK_SINK_M, w.v, w.turn, w.tilt, w.pitch);
            body.setMatrixAt(i, m);
            trim.setMatrixAt(i, m);
            body.setColorAt(i, colour.set(w.colour).convertSRGBToLinear());
          });
          body.castShadow = trim.castShadow = body.receiveShadow = trim.receiveShadow = true;
          group.add(body, trim);
        }),
      );
    } catch (e) {
      console.warn('Skroten: the cars keep their simple shapes:', e);
      return;
    }
    group.visible = false; // update shows it when you are near
    parent.add(group);
    this.nearCars = group;
  }

  /** Turns Plåt-Pelle towards you while you are near. */
  update(dt: number, you: { x: number; z: number }) {
    const fromMiddle = Math.hypot(you.x - this.middle.x, you.z - this.middle.z);
    if (this.loadNear && fromMiddle < CAR_LOAD_M) {
      this.loadNear();
      this.loadNear = null;
    }
    if (this.nearCars && this.farCars) {
      const near = fromMiddle < CAR_DETAIL_M;
      this.nearCars.visible = near;
      this.farCars.visible = !near;
    }
    const n = this.owner,
      dx = you.x - n.position.x,
      dz = you.z - n.position.z;
    if (Math.hypot(dx, dz) > OWNER_SEES_M) return;
    let d = Math.atan2(dx, -dz) - this.ownerH;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.ownerH += d * Math.min(1, dt * OWNER_TURN_K);
    n.rotation.y = -this.ownerH;
  }
}

/** Plåt-Pelle: blue overalls, a red cap with a peak, and a grey beard. Standing at the origin, facing −z. */
function platPelle(): Person {
  // a real shadow, unlike the pedestrians: he stands still, close up, among things that all cast one, and it's 3 draw calls
  const owner = personParts('#2f4f7f', '#2f4f7f', '#b8322a', false, true);
  owner.add(
    new THREE.Mesh(
      boxGeo([
        [0.29, 0.04, 0.16, 0, 1.74, -0.21, '#b8322a'],
        [0.27, 0.12, 0.06, 0, 1.52, -0.15, '#b9b4aa'],
      ]),
      paintMat,
    ),
  );
  return owner;
}

// the matrix that places a model at (x, y, z), turned about y, then tilted about its length
const _q = new THREE.Quaternion(),
  _e = new THREE.Euler(0, 0, 0, 'YXZ'),
  _scale = new THREE.Vector3();
function placing(x: number, y: number, z: number, turn = 0, tilt = 0, pitch = 0, squash = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    _q.setFromEuler(_e.set(pitch, turn, tilt)),
    _scale.set(1, squash, 1),
  );
}

// the simple shape a wreck's model falls back to: its kind of car in models.ts
function simpleType(m: YardCarModel) {
  return CIVILIAN_CAR_TYPES.get(m) ?? 'volvo';
}

// a model's paint (white, for the instance colour) with patches of rust and a dirty lower body: rust is the colour the paint is multiplied
// by where a little noise over the model's surface rises above a threshold, so every wreck rusts in the same places but in its own paint
function rusted(paint: THREE.BufferGeometry) {
  const g = paint.clone(),
    pos = g.attributes.position!,
    col = g.attributes.color!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i),
      n = Math.sin(x * 4.1 + Math.sin(z * 3.3)) * Math.sin(z * 3.7 + y * 5.3) * Math.sin(y * 4.9 + x * 2.1 + z * 1.3),
      low = y < 0.6 ? 0.72 : 1; // road dirt along the sills
    if (n > 0.22) col.setXYZ(i, 0.95 * low, 0.5 * low, 0.3 * low);
    else col.setXYZ(i, 0.85 * low, 0.83 * low, 0.8 * low); // faded
  }
  return g;
}

// the yard's asphalt, worn and dirty: specks, patches of dirt and gravel, oil stains and tyre tracks, w × h pixels over the whole yard
function dirtyAsphalt(w: number, h: number) {
  const rnd = makeRnd(77),
    cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!,
    blot = (x: number, y: number, r: number, colour: string, alpha: number) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, colour);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = alpha;
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
      c.fill();
    };
  c.fillStyle = '#4e4c48';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    c.globalAlpha = 0.25 + rnd() * 0.3;
    c.fillStyle = rnd() < 0.5 ? '#3c3a37' : '#66635c';
    c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 70; i++) blot(rnd() * w, rnd() * h, 20 + rnd() * 70, '#6b5a43', 0.35 + rnd() * 0.3); // dirt
  for (let i = 0; i < 25; i++) blot(rnd() * w, rnd() * h, 15 + rnd() * 40, '#7d7566', 0.3); // spilt gravel
  for (let i = 0; i < 45; i++) blot(rnd() * w, rnd() * h, 4 + rnd() * 11, '#1e1d1b', 0.4 + rnd() * 0.25); // oil
  c.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x0 = rnd() * w,
      y0 = rnd() * h,
      x1 = rnd() * w,
      y1 = rnd() * h,
      mx = rnd() * w,
      my = rnd() * h;
    c.globalAlpha = 0.18;
    c.strokeStyle = '#2b2a27';
    c.lineWidth = 5;
    for (const off of [0, 14]) {
      c.beginPath();
      c.moveTo(x0 + off, y0);
      c.quadraticCurveTo(mx + off, my, x1 + off, y1);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// an sRGB colour darkened by k
function shade(hex: string, k: number) {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

// a shipping container, length w along x and width d along z, standing on y = 0: corrugated sides, corner posts and rails, and at +x
// its double doors with their four locking bars
function container(w: number, d: number, colour: string): BoxPart[] {
  const h = CONTAINER_H_M,
    rib = shade(colour, 0.78),
    frame = shade(colour, 0.55),
    steel = '#8c8f90',
    parts: BoxPart[] = [[w - 0.1, h - 0.1, d - 0.1, 0, h / 2, 0, colour]];
  for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.28)
    for (const s of [-1, 1]) parts.push([0.13, h - 0.35, 0.05, x, h / 2, s * (d / 2 - 0.03), rib]);
  for (let x = -w / 2 + 0.4; x < w / 2 - 0.3; x += 0.3) parts.push([0.12, 0.05, d - 0.3, x, h - 0.03, 0, rib]); // the roof's ribs, across it
  for (let y = 0.4; y < h - 0.3; y += 0.35) parts.push([0.05, 0.12, d - 0.3, -w / 2 - 0.01, y, 0, rib]);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) parts.push([0.16, h, 0.16, sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08), frame]);
  for (const y of [0.08, h - 0.08]) {
    for (const sz of [-1, 1]) parts.push([w, 0.16, 0.14, 0, y, sz * (d / 2 - 0.07), frame]);
    for (const sx of [-1, 1]) parts.push([0.14, 0.16, d, sx * (w / 2 - 0.07), y, 0, frame]);
  }
  parts.push(
    [0.04, h - 0.3, d - 0.3, w / 2 - 0.01, h / 2, 0, rib],
    [0.05, h - 0.3, 0.03, w / 2 + 0.01, h / 2, 0, frame],
  );
  for (const k of [-0.75, -0.35, 0.35, 0.75]) {
    parts.push([0.05, h - 0.2, 0.05, w / 2 + 0.04, h / 2, (k * d) / 2, steel]);
    parts.push([0.14, 0.05, 0.05, w / 2 + 0.08, 1.2, (k * d) / 2, steel]);
  }
  return parts;
}

// a workshop prop, standing on y = 0, its length along x
function propParts(p: WorkshopProp): BoxPart[] {
  const { w, d, h } = PROP_SIZE[p.kind];
  if (p.kind === 'bench')
    return [
      [w, 0.06, d, 0, h, 0, '#7a5a3a'],
      [w - 0.1, 0.04, d - 0.1, 0, 0.25, 0, '#5b4a3a'],
      ...[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => [0.07, h, 0.07, sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.08), '#3f4244'] as BoxPart),
      ),
      [0.25, 0.18, 0.15, w / 2 - 0.4, h + 0.12, 0, '#2f4f7f'], // a vice
      [w, 0.9, 0.04, 0, h + 0.75, -d / 2 + 0.02, '#a8a090'], // the tool board on the wall
    ];
  if (p.kind === 'shelf') {
    const parts: BoxPart[] = [];
    for (const sx of [-1, 1]) parts.push([0.06, h, d, sx * (w / 2 - 0.03), h / 2, 0, '#3a6ea5']);
    for (let y = 0.15; y < h; y += 0.5) {
      parts.push([w, 0.04, d, 0, y, 0, '#9a9a92']);
      parts.push([0.5, 0.3, 0.4, -0.6 + ((y * 7) % 1.2), y + 0.17, 0, y % 1 < 0.5 ? '#8a6a3a' : '#7d3a24']); // boxes and cans
    }
    return parts;
  }
  if (p.kind === 'rack') {
    const parts: BoxPart[] = [];
    for (const sx of [-1, 0, 1]) parts.push([0.06, h, d, (sx * (w - 0.06)) / 2, h / 2, 0, '#c8372d']);
    for (const y of [0.2, 1.1]) {
      parts.push([w, 0.05, d, 0, y, 0, '#5a5d5f']);
      for (let x = -w / 2 + 0.35; x < w / 2 - 0.2; x += 0.28) parts.push([0.22, 0.62, 0.62, x, y + 0.34, 0, '#1c1c1c']);
    }
    return parts;
  }
  // a lift post, yellow, with its arm reaching in under the car
  return [
    [w, h, d, 0, h / 2, 0, '#d9b628'],
    [w + 0.2, 0.06, d + 0.2, 0, 0.03, 0, '#3f4244'],
    [0.12, 0.1, 1.2, 0, 0.45, 0, '#3f4244'],
  ];
}

// triangles of flat colour with their own normals, gathered into one geometry
class Surfaces {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _k = new THREE.Color();
  /** A triangle, seen from the side its corners run counter-clockwise; `both` adds its back too. */
  tri(a: number[], b: number[], c: number[], hex: string, both = false) {
    const k = this._k.set(hex).convertSRGBToLinear(), // colour management is off (three-legacy), as in mergeGeo
      n = this._a
        .set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!)
        .cross(this._b.set(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!))
        .normalize();
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.nor.push(n.x, n.y, n.z);
      this.col.push(k.r, k.g, k.b);
    }
    if (both) this.tri(a, c, b, hex);
  }
  quad(a: number[], b: number[], c: number[], d: number[], hex: string, both = false) {
    this.tri(a, b, c, hex, both);
    this.tri(a, c, d, hex, both);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

type WallT = Workshop['doorWall'];
// a box along wall w from s0 to s1 metres, between heights y0 and y1, `out` metres out from its line and `thick` deep
function wallBox(w: WallT, s0: number, s1: number, y0: number, y1: number, out: number, thick: number, c: string) {
  const s = (s0 + s1) / 2;
  return boxGeo([[s1 - s0, y1 - y0, thick, 0, (y0 + y1) / 2, 0, c]]).applyMatrix4(
    placing(w.x0 + w.ux * s + w.nx * out, 0, w.z0 + w.uz * s + w.nz * out, -Math.atan2(w.uz, w.ux)),
  );
}
const lowestUnder = (p: readonly number[], heightAt: SkrotenMeshDeps['heightAt']) => {
  let lo = Infinity;
  for (let i = 0; i < p.length; i += 2) lo = Math.min(lo, heightAt(p[i]!, p[i + 1]!));
  return lo;
};

// the workshop in world coordinates: brick walls and the clad wing, windows and doors to the road and the yard, the garage door's opening
// with its door rolled up inside, a flat roof with the gabled hall on it, and a concrete floor
function hallMeshes(heightAt: SkrotenMeshDeps['heightAt'], ws: Workshop) {
  const pieces: THREE.BufferGeometry[] = [],
    p = ws.outline,
    level = (x: number, z: number) => ws.floor.a + ws.floor.bx * x + ws.floor.cz * z,
    lo = lowestUnder(p, heightAt),
    base = lo - 0.5,
    xs = p.filter((_, i) => i % 2 === 0),
    zs = p.filter((_, i) => i % 2 === 1),
    [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
    wingX = x0 + (x1 - x0) * 0.25; // walls west of this are the clad wing
  const { doorWall: dw, doorFrom, doorTo } = ws,
    doorMid = (doorFrom + doorTo) / 2,
    doorFoot = level(dw.x0 + dw.ux * doorMid, dw.z0 + dw.uz * doorMid),
    doorTop = doorFoot + WORKSHOP_DOOR.h;
  let highest = -Infinity;
  for (let i = 0; i < p.length; i += 2) highest = Math.max(highest, level(p[i]!, p[i + 1]!));
  const top = Math.max(doorFoot + HALL_H_M, highest + HALL_MIN_H_M); // the walls' level top
  for (const w of ws.walls) {
    const clad = Math.max(w.x0, w.x0 + w.ux * w.len) < wingX,
      colour = clad ? CLAD : BRICK,
      spans: [number, number][] =
        w === dw
          ? [
              [-HALL_WALL_M / 2, doorFrom],
              [doorTo, w.len + HALL_WALL_M / 2],
            ]
          : [[-HALL_WALL_M / 2, w.len + HALL_WALL_M / 2]];
    for (const [s0, s1] of spans) pieces.push(wallBox(w, s0, s1, base, top, 0, HALL_WALL_M, colour));
    pieces.push(wallBox(w, -0.2, w.len + 0.2, top - 0.45, top + 0.05, 0.1, 0.12, FASCIA)); // the band under the eaves
    if (clad)
      for (let s = CLAD_RIB_M / 2; s < w.len; s += CLAD_RIB_M)
        if (w !== dw || s < doorFrom - 0.1 || s > doorTo + 0.1)
          pieces.push(wallBox(w, s - 0.03, s + 0.03, base, top - 0.45, HALL_WALL_M / 2 + 0.02, 0.04, '#26303f'));
    // windows towards the road and the yard, white frames round dark glass; a door every so often on the road side
    if (w.nz < -0.7 || w === dw) {
      const n = Math.floor(w.len / WINDOW_EVERY_M);
      for (let i = 0; i < n; i++) {
        const s = (w.len * (i + 0.5)) / n,
          y = Math.max(level(w.x0 + w.ux * s, w.z0 + w.uz * s), heightAt(w.x0 + w.ux * s, w.z0 + w.uz * s));
        if (w === dw && s > doorFrom - 1.2 && s < doorTo + 1.2) continue;
        if (w.nz < -0.7 && i % 4 === 2) {
          pieces.push(wallBox(w, s - 0.55, s + 0.55, y, y + 2.15, HALL_WALL_M / 2, 0.06, '#f1efe8'));
          pieces.push(wallBox(w, s - 0.45, s + 0.45, y, y + 2.05, HALL_WALL_M / 2 + 0.02, 0.06, '#5a3a2a'));
          continue;
        }
        pieces.push(wallBox(w, s - 0.7, s + 0.7, y + 0.95, y + 2.25, HALL_WALL_M / 2, 0.06, '#f1efe8'));
        pieces.push(wallBox(w, s - 0.6, s + 0.6, y + 1.05, y + 2.15, HALL_WALL_M / 2 + 0.02, 0.06, '#26323a'));
      }
    }
  }
  pieces.push(wallBox(dw, doorFrom, doorTo, doorTop, top, 0, HALL_WALL_M, CLAD)); // over the door
  pieces.push(wallBox(dw, doorFrom - 0.15, doorFrom, doorFoot - 0.3, doorTop, 0.05, HALL_WALL_M + 0.12, '#3a3c3e')); // its frame
  pieces.push(wallBox(dw, doorTo, doorTo + 0.15, doorFoot - 0.3, doorTop, 0.05, HALL_WALL_M + 0.12, '#3a3c3e'));
  pieces.push(
    wallBox(dw, doorFrom - 0.15, doorTo + 0.15, doorTop, doorTop + 0.15, 0.05, HALL_WALL_M + 0.12, '#3a3c3e'),
  );
  pieces.push(wallBox(dw, doorFrom, doorTo, doorTop - 0.5, doorTop, -0.35, 0.45, '#4a4d50')); // rolled up inside, under the lintel

  // the flat roof, seen from above and from inside, the even floor (main.ts stands everyone on it), and the ramp down from the door
  const sf = new Surfaces(),
    flat: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) flat.push(new THREE.Vector2(p[i]!, p[i + 1]!));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flat, [])) {
    const P = (k: number) => [flat[k]!.x, top, flat[k]!.y],
      F = (k: number) => [flat[k]!.x, level(flat[k]!.x, flat[k]!.y), flat[k]!.y];
    sf.tri(P(a!), P(b!), P(c!), FLAT_ROOF, true);
    sf.tri(F(a!), F(b!), F(c!), CONCRETE, true);
  }
  const ramp = (s: number, out: number) => {
    const x = dw.x0 + dw.ux * s + dw.nx * out,
      z = dw.z0 + dw.uz * s + dw.nz * out;
    return [x, (floorAt(ws, x, z, heightAt) ?? heightAt(x, z)) + 0.02, z];
  };
  for (let out = 0; out < RAMP_M - 0.01; out += RAMP_M / 4)
    sf.quad(
      ramp(doorFrom, out),
      ramp(doorTo, out),
      ramp(doorTo, out + RAMP_M / 4),
      ramp(doorFrom, out + RAMP_M / 4),
      CONCRETE,
      true,
    );
  // the gabled hall on the roof: cream gable ends, rusty roof planes, its ridge along x
  const gx0 = x0 + (x1 - x0) * 0.3,
    gx1 = x1 - (x1 - x0) * 0.2,
    gz0 = z0 + (z1 - z0) * 0.35,
    gz1 = z1 - (z1 - z0) * 0.1,
    gm = (gz0 + gz1) / 2,
    ridge = top + GABLE_RISE_M;
  sf.quad([gx0, top, gz0], [gx0, ridge, gm], [gx1, ridge, gm], [gx1, top, gz0], RUST_ROOF, true);
  sf.quad([gx0, top, gz1], [gx1, top, gz1], [gx1, ridge, gm], [gx0, ridge, gm], RUST_ROOF, true);
  sf.tri([gx0, top, gz0], [gx0, top, gz1], [gx0, ridge, gm], GABLE_CREAM, true);
  sf.tri([gx1, top, gz0], [gx1, top, gz1], [gx1, ridge, gm], GABLE_CREAM, true);
  pieces.push(sf.geometry());
  const m = new THREE.Mesh(bake(pieces), paintMat);
  m.castShadow = m.receiveShadow = true;
  // a SKROTEN sign over the windows on the road side
  const g = new THREE.Group(),
    road = ws.walls.reduce((best, w) => (w.nz < -0.9 && w.len > (best?.len ?? 0) ? w : best), null as WallT | null);
  g.add(m);
  if (road) {
    const sign = board(7, 1.1, 'SKROTEN', null),
      s = road.len * 0.3;
    sign.position.set(road.x0 + road.ux * s + road.nx * 0.3, top - 1.05, road.z0 + road.uz * s + road.nz * 0.3);
    sign.rotation.y = Math.atan2(road.nx, road.nz); // its front, +z, faces out from the wall
    g.add(sign);
  }
  return g;
}

// the carport in world coordinates, built up from its even floor so it has the same headroom at both ends of the slope: wooden walls on
// three sides, posts along the open front, the long gabled roof over its ridge, a concrete floor and a ramp along the front
function carportMeshes(heightAt: SkrotenMeshDeps['heightAt'], cp: Carport) {
  const pieces: THREE.BufferGeometry[] = [],
    base = lowestUnder(cp.outline, heightAt) - 0.5,
    fl = (x: number, z: number) => cp.floor.a + cp.floor.bx * x + cp.floor.cz * z,
    f = cp.front,
    sf = new Surfaces(),
    depth = Math.max(...cp.walls.filter(w => w !== f && Math.abs(w.nx * f.nx + w.nz * f.nz) < 0.3).map(w => w.len)),
    // a point `s` along the front and `d` in from it, `y` over the floor there
    a = (s: number, d: number, y: number) => {
      const x = f.x0 + f.ux * s - f.nx * d,
        z = f.z0 + f.uz * s - f.nz * d;
      return [x, fl(x, z) + y, z];
    };
  // the walls: planks from below the ground up to the eaves, which follow the floor
  for (const w of cp.walls) {
    if (w === f) continue;
    const x1 = w.x0 + w.ux * w.len,
      z1 = w.z0 + w.uz * w.len,
      bottom = (x: number, z: number) => [x, base, z],
      top = (x: number, z: number) => [x, fl(x, z) + SHED_WALL_M, z];
    sf.quad(bottom(w.x0, w.z0), bottom(x1, z1), top(x1, z1), top(w.x0, w.z0), WOOD, true);
  }
  for (const q of cp.posts) {
    const t = fl(q.x, q.z) + SHED_WALL_M;
    pieces.push(
      boxGeo([[0.25, t - base, 0.25, 0, (t + base) / 2, 0, WOOD]]).applyMatrix4(
        placing(q.x, 0, q.z, -Math.atan2(f.uz, f.ux)),
      ),
    );
  }
  // the beam over the bays, the roof from both eaves up to the ridge, overhanging a little, and the gable ends
  const over = 0.5,
    eave = SHED_WALL_M - 0.15,
    ridge = SHED_WALL_M + SHED_RISE_M;
  sf.quad(
    a(-0.2, 0.2, SHED_WALL_M - 0.35),
    a(f.len + 0.2, 0.2, SHED_WALL_M - 0.35),
    a(f.len + 0.2, 0.2, SHED_WALL_M),
    a(-0.2, 0.2, SHED_WALL_M),
    '#5a3d29',
    true,
  );
  sf.quad(
    a(-over, -over, eave),
    a(f.len + over, -over, eave),
    a(f.len + over, depth / 2, ridge),
    a(-over, depth / 2, ridge),
    RUST_ROOF,
    true,
  );
  sf.quad(
    a(-over, depth / 2, ridge),
    a(f.len + over, depth / 2, ridge),
    a(f.len + over, depth + over, eave),
    a(-over, depth + over, eave),
    RUST_ROOF,
    true,
  );
  for (const s of [0, f.len])
    sf.tri(a(s, 0, SHED_WALL_M), a(s, depth, SHED_WALL_M), a(s, depth / 2, ridge), WOOD, true);
  // the floor, and the ramp down from the front to the yard
  const flat: THREE.Vector2[] = [];
  for (let i = 0; i < cp.outline.length; i += 2) flat.push(new THREE.Vector2(cp.outline[i]!, cp.outline[i + 1]!));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) {
    const F = (n: number) => [flat[n]!.x, fl(flat[n]!.x, flat[n]!.y), flat[n]!.y];
    sf.tri(F(i!), F(j!), F(k!), CONCRETE, true);
  }
  const ramp = (s: number, out: number) => {
    const x = f.x0 + f.ux * s + f.nx * out,
      z = f.z0 + f.uz * s + f.nz * out;
    return [x, (floorAt(cp, x, z, heightAt) ?? heightAt(x, z)) + 0.02, z];
  };
  const steps = Math.ceil(f.len / 3);
  for (let i = 0; i < steps; i++)
    for (let out = 0; out < RAMP_M - 0.01; out += RAMP_M / 4) {
      const s0 = (f.len * i) / steps,
        s1 = (f.len * (i + 1)) / steps;
      sf.quad(ramp(s0, out), ramp(s1, out), ramp(s1, out + RAMP_M / 4), ramp(s0, out + RAMP_M / 4), CONCRETE, true);
    }
  pieces.push(sf.geometry());
  const m = new THREE.Mesh(bake(pieces), paintMat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// the model's meshes in one geometry each for its paint (white, for the instance colour) and the rest (its materials' colours)
function flatten(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const body = root.getObjectByName(BODY_NODE),
    paint: THREE.BufferGeometry[] = [],
    rest: THREE.BufferGeometry[] = [],
    v = new THREE.Vector3(),
    nm = new THREE.Matrix3(),
    white = new THREE.Color(1, 1, 1);
  const under = (n: THREE.Object3D, a: THREE.Object3D) => {
    for (let o: THREE.Object3D | null = n; o; o = o.parent) if (o === a) return true;
    return false;
  };
  root.traverse(n => {
    if (!(n instanceof THREE.Mesh)) return;
    const isPaint = !!body && under(n, body) && (n === body || n.name.startsWith(BODY_NODE + '_')), // as VehicleVisuals.paint picks it
      src = n.geometry as THREE.BufferGeometry,
      idx = src.index,
      P = src.attributes.position!,
      N = src.attributes.normal,
      count = idx ? idx.count : P.count,
      pos = new Float32Array(count * 3),
      nor = new Float32Array(count * 3),
      col = new Float32Array(count * 3),
      mats = (Array.isArray(n.material) ? n.material : [n.material]) as THREE.MeshStandardMaterial[],
      groups = src.groups.length ? src.groups : [{ start: 0, count, materialIndex: 0 }];
    nm.getNormalMatrix(n.matrixWorld);
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i; // read through the accessors: the models' attributes are quantized
      v.fromBufferAttribute(P, k)
        .applyMatrix4(n.matrixWorld)
        .toArray(pos, i * 3);
      if (N)
        v.fromBufferAttribute(N, k)
          .applyMatrix3(nm)
          .normalize()
          .toArray(nor, i * 3);
    }
    for (const gr of groups) {
      const c = isPaint ? white : (mats[gr.materialIndex ?? 0]?.color ?? white);
      for (let i = gr.start; i < Math.min(count, gr.start + gr.count); i++) c.toArray(col, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!N) g.computeVertexNormals();
    (isPaint ? paint : rest).push(g);
  });
  return { paint: bake(paint), rest: bake(rest) };
}

// one geometry from coloured, non-indexed pieces with the same attributes
function bake(pieces: THREE.BufferGeometry[]) {
  const names = ['position', 'normal', 'color'] as const,
    out = new THREE.BufferGeometry();
  for (const name of names) {
    const arrays = pieces.map(p => p.attributes[name]!.array as Float32Array),
      all = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      all.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(all, 3));
  }
  for (const p of pieces) p.dispose();
  return out;
}

// the TILL SALU sign standing on y = 0, its front to +z: a big board on two posts
function saleSign() {
  const g = new THREE.Group(),
    { h, y } = SALE_BOARD,
    { w } = SALE_SIGN,
    sign = board(w, h, 'TILL SALU', null),
    posts = new THREE.Mesh(
      boxGeo([
        [0.14, y + h / 2, 0.14, -w / 2 + 0.35, (y + h / 2) / 2, -0.1, POST],
        [0.14, y + h / 2, 0.14, w / 2 - 0.35, (y + h / 2) / 2, -0.1, POST],
      ]),
      paintMat,
    );
  sign.position.y = y;
  posts.castShadow = true;
  g.add(posts, sign);
  return g;
}

// a rusty board with white lettering on its front (+z), and an arrow under the text when `arrow` is given (1 right, -1 left)
function board(w: number, h: number, text: string, arrow: 1 | -1 | null) {
  const cv = document.createElement('canvas'),
    px = 64; // canvas pixels per metre
  cv.width = Math.round(w * px);
  cv.height = Math.round(h * px);
  const c = cv.getContext('2d')!,
    W = cv.width,
    H = cv.height;
  c.fillStyle = RUST;
  c.fillRect(0, 0, W, H);
  c.strokeStyle = CREAM;
  c.lineWidth = 4;
  c.strokeRect(5, 5, W - 10, H - 10);
  c.fillStyle = CREAM;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let fontPx = Math.round(H * (arrow ? 0.36 : 0.55));
  c.font = 'bold ' + fontPx + 'px sans-serif';
  const fits = (W - 24) / c.measureText(text).width; // the text is shrunk to fit inside the frame, with a margin
  if (fits < 1) {
    fontPx = Math.floor(fontPx * fits);
    c.font = 'bold ' + fontPx + 'px sans-serif';
  }
  c.fillText(text, W / 2, arrow ? H * 0.32 : H * 0.54);
  if (arrow) {
    const y = H * 0.7,
      half = W * 0.28,
      tip = W / 2 + arrow * half;
    c.lineWidth = H * 0.1;
    c.beginPath();
    c.moveTo(W / 2 - arrow * half, y);
    c.lineTo(tip - arrow * H * 0.12, y);
    c.stroke();
    c.beginPath();
    c.moveTo(tip, y);
    c.lineTo(tip - arrow * H * 0.2, y - H * 0.16);
    c.lineTo(tip - arrow * H * 0.2, y + H * 0.16);
    c.closePath();
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // one material, so one draw call: every face but the front reads the canvas's plain rust corner, outside the frame
  const geo = new THREE.BoxGeometry(w, h, 0.08),
    uv = geo.attributes.uv!,
    FRONT = 4, // BoxGeometry's faces: +x, -x, +y, -y, +z, -z, four corners each
    corner = 1 / Math.max(W, H);
  for (let i = 0; i < uv.count; i++) if (Math.floor(i / 4) !== FRONT) uv.setXY(i, corner, corner);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  m.castShadow = true;
  return m;
}
