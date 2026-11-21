// Skroten's yard in the scene (#76): gravel, a fence of mismatched sheet metal topped with barbed wire, the gate with its sign, the hut,
// the containers, the wrecks and the scrap heaps, the arrow signs by the road, and Skrot-Nisse, who turns to watch you come.
// The layout comes from skroten-yard.ts; the static parts are baked into one mesh, so the yard costs a handful of draw calls.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import { CONTAINERS, HUT, NISSE_UV, YARD, YARD_GATE, YARD_TURN, type YardLayout, yardToWorld } from '../skroten-yard';
import { boxGeo, carGeo, mergeGeo, type Person, paintMat, personParts } from './models';

const PANEL_M = 3; // a sheet of the fence, and the gap between its posts
const FENCE_COLOURS = ['#8b8f91', '#9a6a4a', '#6f7c86', '#a3a7a3', '#7e4a30', '#86847a'];
const WIRE_HEIGHTS_M = [2.45, 2.65, 2.85];
const SCRAP_COLOURS = ['#7d3a24', '#8f4f2c', '#6b6f6f', '#9a9a92', '#5c4434', '#a0522d', '#4f5a63'];
const RUST = '#8a4a2a',
  POST = '#5b4a3a',
  WIRE = '#2e2e2e',
  TYRE = '#1c1c1c',
  CREAM = '#e8e2d2';
const GATE_SIGN_Y_M = 4.6;
const NISSE_SEES_M = 30; // he turns to face you inside this distance
const NISSE_TURN_K = 3; // how quickly he turns, per second

/** What the yard's meshes read from the rest of the game. */
export interface SkrotenMeshDeps {
  scene: THREE.Scene;
  heightAt(x: number, z: number): number;
  layout: YardLayout;
}

/** The yard and Skrot-Nisse; `update` turns him towards you. */
export class SkrotenMeshes {
  private readonly nisse: Person;
  private nisseH = 0;

  constructor(g: SkrotenMeshDeps) {
    const { scene, heightAt, layout } = g,
      rnd = makeRnd(911), // the heaps' and fence's looks: their own stream
      pieces: THREE.BufferGeometry[] = [],
      groundY = (u: number, v: number) => {
        const p = yardToWorld(u, v);
        return heightAt(p.x, p.z);
      };
    // places a coloured geometry at (u, y, v) of the yard's frame, turned and tilted
    const put = (geo: THREE.BufferGeometry, u: number, y: number, v: number, turn = 0, tilt = 0, squash = 1) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(u, y, v),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, turn, tilt, 'YXZ')),
        new THREE.Vector3(1, squash, 1),
      );
      pieces.push(geo.clone().applyMatrix4(m));
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
            ...WIRE_HEIGHTS_M.map(
              wy => [step, 0.025, 0.025, 0, wy, 0, WIRE] as [number, number, number, number, number, number, string],
            ),
          ]),
          mu,
          my,
          mv,
          turn,
          (rnd() - 0.5) * 0.03,
        );
      }
    }

    // gravel over the yard, and the drive out to the road, following the ground
    const gravel = new THREE.MeshLambertMaterial({
      color: 0x6b6253,
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
    const box = (w: number, h: number, d: number, c: string, end: string) =>
      boxGeo([
        [w, h, d, 0, h / 2, 0, c],
        [0.05, h - 0.2, d - 0.2, w / 2 + 0.02, h / 2, 0, end],
      ]);
    const { u: cu, v: cv, w: cw, d: cd } = CONTAINERS,
      cy = groundY(cu, cv);
    put(box(cw, 2.6, cd, '#9b3b2a', '#7a2c20'), cu, cy, cv - cd / 2);
    put(box(cw, 2.6, cd, '#2f5a7a', '#24485f'), cu, cy, cv + cd / 2);
    put(box(cw, 2.6, cd, '#5a6b3a', '#47552e'), cu - 0.4, cy + 2.6, cv, Math.PI / 2 + 0.08);

    // the wrecks: flat tyres, faded paint, now and then a crushed one on top
    for (const w of layout.wrecks)
      put(
        carGeo(w.type, w.colour),
        w.u,
        groundY(w.u, w.v) - 0.12 + (w.onTop ? 1.32 : 0),
        w.v,
        w.turn,
        w.tilt,
        w.onTop ? 0.55 : 1,
      );

    // the heaps: a mound of sheet, beams and engine blocks, higher in the middle
    for (const h of layout.heaps) {
      const y0 = groundY(h.u, h.v);
      for (let i = 0; i < h.r * 14; i++) {
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
    for (const u of [-YARD.gateHalf - 0.6, YARD.gateHalf + 0.6])
      put(boxGeo([[0.3, GATE_SIGN_Y_M + 0.7, 0.3, 0, (GATE_SIGN_Y_M + 0.7) / 2, 0, POST]]), u, groundY(u, 0), 0);
    for (const s of layout.signs) put(boxGeo([[0.1, 2.6, 0.1, 0, 1.3, 0, '#9a9a92']]), s.u, groundY(s.u, s.v), s.v);

    const yard = new THREE.Group();
    yard.position.set(YARD_GATE.x, 0, YARD_GATE.z);
    yard.rotation.y = YARD_TURN;
    const baked = new THREE.Mesh(bake(pieces), paintMat);
    baked.castShadow = baked.receiveShadow = true;
    yard.add(baked, ground(-YARD.halfU, YARD.halfU, 0, YARD.depth), ground(-YARD.gateHalf, YARD.gateHalf, -5.5, 0));

    // the boards: SKROTEN over the gate, BILAR KÖPES on the fence, and an arrow sign either way along the road
    const gate = board(12, 1.5, 'SKROTEN', null);
    gate.position.set(0, groundY(0, 0) + GATE_SIGN_Y_M, 0);
    const buys = board(4, 1, 'BILAR KÖPES', null);
    buys.position.set(-22, groundY(-22, 0) + 1.3, -0.08);
    gate.rotation.y = buys.rotation.y = Math.PI; // their fronts face the road
    yard.add(gate, buys);
    for (const s of layout.signs) {
      const b = board(2.4, 1, 'SKROTEN', s.facing);
      b.position.set(s.u, groundY(s.u, s.v) + 2.2, s.v);
      b.rotation.y = -s.facing * (Math.PI / 2); // faces the drivers coming towards the yard
      yard.add(b);
    }
    scene.add(yard);

    // Skrot-Nisse: blue overalls, a red cap with a peak, and a grey beard
    const nisse = personParts('#2f4f7f', '#2f4f7f', '#b8322a');
    nisse.add(
      new THREE.Mesh(
        boxGeo([
          [0.29, 0.04, 0.16, 0, 1.74, -0.21, '#b8322a'],
          [0.27, 0.12, 0.06, 0, 1.52, -0.15, '#b9b4aa'],
        ]),
        paintMat,
      ),
    );
    const at = yardToWorld(NISSE_UV.u, NISSE_UV.v);
    nisse.position.set(at.x, heightAt(at.x, at.z), at.z);
    const road = yardToWorld(NISSE_UV.u, NISSE_UV.v - 1);
    this.nisseH = Math.atan2(road.x - at.x, at.z - road.z); // looks towards the road until you come
    nisse.rotation.y = -this.nisseH;
    scene.add(nisse);
    this.nisse = nisse;
  }

  /** Turns Skrot-Nisse towards you while you are near. */
  update(dt: number, you: { x: number; z: number }) {
    const n = this.nisse,
      dx = you.x - n.position.x,
      dz = you.z - n.position.z;
    if (Math.hypot(dx, dz) > NISSE_SEES_M) return;
    let d = Math.atan2(dx, -dz) - this.nisseH;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.nisseH += d * Math.min(1, dt * NISSE_TURN_K);
    n.rotation.y = -this.nisseH;
  }
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
  c.font = 'bold ' + Math.round(H * (arrow ? 0.36 : 0.55)) + 'px sans-serif';
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
  const plain = new THREE.MeshLambertMaterial({ color: new THREE.Color(RUST).convertSRGBToLinear() }),
    front = new THREE.MeshLambertMaterial({ map: tex }),
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [plain, plain, plain, plain, front, plain]);
  m.castShadow = true;
  return m;
}
