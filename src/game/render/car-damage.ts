// Car damage you can see: cracked glass, worse at each crackLevel, and smoke from the bonnet, grey past half damage and
// black when nearly wrecked. Moved from src/game/main.ts (#177); main.ts passes in what the effects read from the rest of the game.
import * as THREE from 'three';
import '../../world/three-legacy'; // before SMOKE_COLS: with colour management on, col() would convert twice
import { makeRnd } from '../../world/random';
import { crackLevel, smokeLevel } from '../health';
import type { RenderedCar } from './car-meshes';
import type { VehicleVisuals } from './vehicle-visuals';

const col = (c: number) => new THREE.Color(c).convertSRGBToLinear();

/** A car as the damage effects see it: the crack meshes they have added, and the smoke still owed (puffs). */
type DamagedCar = RenderedCar & { crack?: number; crackMesh?: THREE.Mesh; modelCrack?: THREE.Mesh[]; smokeT?: number };
/** The side profile of a car's glass: x is the car's z (front is -z), y is height (m); gw is its width (m). */
type GlassProfile = { glass: readonly (readonly number[])[]; gw: number };
type Puff = THREE.Sprite & { age: number };

/** What the damage effects read from the rest of the game. */
export interface CarDamageFxDeps {
  scene: THREE.Scene;
  groundAt: (x: number, z: number) => number;
  profiles: Record<string, GlassProfile>; // by car type, but the tractor
  tractorCab: GlassProfile;
  vehicleVisuals: VehicleVisuals;
  rnd: () => number; // main.ts's own stream for the shake and the smoke puffs, which roll every frame
  cars: readonly DamagedCar[];
}

// cracked glass: a crack texture laid over the windscreen and rear window (material 0) and the side windows (material 1), worse at each crackLevel
const CRACK_OUT_M = 0.06; // how far the cracks sit outside the glass profile, past its bevel
function crackTex(dense: boolean) {
  const S = 256,
    cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!,
    r = makeRnd(dense ? 81 : 80);
  g.lineCap = 'round';
  for (let hit = 0; hit < (dense ? 4 : 1); hit++) {
    // each hit: a star of jagged rays, and broken rings round its centre
    const cx = S * (0.3 + r() * 0.4),
      cy = S * (0.3 + r() * 0.4),
      rays = dense ? 14 : 9;
    g.strokeStyle = 'rgba(235,240,245,.9)';
    g.lineWidth = dense ? 2.4 : 2;
    for (let i = 0; i < rays; i++) {
      let a = (i / rays) * Math.PI * 2 + r() * 0.4,
        x = cx,
        y = cy;
      const L = S * (0.25 + r() * (dense ? 0.5 : 0.3));
      g.beginPath();
      g.moveTo(x, y);
      for (let d = 0; d < L; d += 14) {
        a += (r() - 0.5) * 0.5;
        x += Math.cos(a) * 14;
        y += Math.sin(a) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.lineWidth = 1.5;
    for (let k = 1; k <= (dense ? 3 : 2); k++) {
      const R = k * S * 0.06 * (1 + r() * 0.5);
      for (let i = 0; i < rays; i++)
        if (r() < 0.7) {
          const a = (i / rays) * Math.PI * 2;
          g.beginPath();
          g.arc(cx, cy, R * (0.9 + r() * 0.2), a, a + ((Math.PI * 2) / rays) * 0.8);
          g.stroke();
        }
    }
    g.fillStyle = 'rgba(235,240,245,.55)';
    g.beginPath();
    g.arc(cx, cy, dense ? 7 : 5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const crackMat = (d: boolean) =>
  new THREE.MeshBasicMaterial({
    map: crackTex(d),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
// by crack level: the materials for the panes facing forwards or backwards, and for the rest. Made with the CarDamageFx, not at import,
// since the textures are drawn on a canvas: the module can then be imported without a DOM (#297)
function crackMaterials() {
  const off = new THREE.MeshBasicMaterial({ visible: false }),
    light = crackMat(false),
    heavy = crackMat(true);
  return [null, [light, off], [heavy, light], [heavy, heavy]];
}
const CRACK_REAR: Record<string, number> = { saab: 2 }; // index of the glass profile's point where the rear window starts (default 1); the Saab's is its hatch
// a car model (#176) cracks its own glass: each of its glass_ parts, with texture coordinates added, split like crackGeo into the panes
// that face forwards or backwards (material 0) and the rest (material 1); the models' glass has no texture coordinates of its own
const MODEL_GLASS_FLAT = 0.94; // glass whose normal is closer to straight up than this (about 20°) gets no cracks: a raked windscreen still does
const _ga = new THREE.Vector3(),
  _gb = new THREE.Vector3(),
  _gc = new THREE.Vector3();

// smoke from the bonnet, grey past half damage and black when nearly wrecked
const SMOKE_N = 48,
  SMOKE_S = 1.8,
  SMOKE_NEAR_M = 140,
  SMOKE_RATE = [0, 8, 12]; // puffs in the pool; s each lasts; only cars this close smoke; puffs/s by smoke level
const SMOKE_COLS = [null, col(0x7c7c78), col(0x2a2826)];
function smokeTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!,
    r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

/** The cracks in every car's glass, and the smoke from the bonnets of the damaged cars near the camera. */
export class CarDamageFx {
  private readonly g: CarDamageFxDeps;
  private readonly crackGeoCache: Record<string, THREE.BufferGeometry> = {};
  private readonly modelCrackGeos = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  private readonly puffs: Puff[];
  private puffI = 0;
  private readonly crackMats = crackMaterials();

  constructor(g: CarDamageFxDeps) {
    this.g = g;
    const smokeTex = smokeTexture();
    const puffs = Array.from({ length: SMOKE_N }, () => {
      const p = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }),
      ) as Puff;
      p.visible = false;
      p.age = 0;
      g.scene.add(p);
      return p;
    });
    this.puffs = puffs;
  }

  private crackGeo(t: string) {
    const { crackGeoCache } = this,
      { profiles, tractorCab } = this.g;
    if (crackGeoCache[t]) return crackGeoCache[t];
    const P = t === 'traktor' ? tractorCab : profiles[t],
      G = P.glass,
      n = G.length,
      pos: number[] = [],
      uv: number[] = [];
    const cx = G.reduce((a, p) => a + p[0], 0) / n,
      cy = G.reduce((a, p) => a + p[1], 0) / n; // profile x is the car's z (front is -z), profile y is height
    const pane = (p: readonly number[], q: readonly number[]) => {
      // a quad across the car over the profile edge p–q, pushed out away from the middle of the glass
      let nx = q[1] - p[1],
        ny = p[0] - q[0];
      const L = Math.hypot(nx, ny);
      nx /= L;
      ny /= L;
      if (nx * ((p[0] + q[0]) / 2 - cx) + ny * ((p[1] + q[1]) / 2 - cy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const e = (a: readonly number[], b: readonly number[], k: number) => [
          a[0] + (b[0] - a[0]) * k + nx * CRACK_OUT_M,
          a[1] + (b[1] - a[1]) * k + ny * CRACK_OUT_M,
        ],
        A = e(p, q, 0.08),
        B = e(p, q, 0.92),
        w = P.gw / 2 - 0.1;
      pos.push(-w, A[1], A[0], w, A[1], A[0], w, B[1], B[0], -w, A[1], A[0], w, B[1], B[0], -w, B[1], B[0]);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };
    const ri = CRACK_REAR[t] || 1;
    pane(G[n - 1], G[0]);
    pane(G[ri], G[ri + 1]);
    const front = pos.length / 3;
    const S = G.map(p => [cx + (p[0] - cx) * 0.88, cy + (p[1] - cy) * 0.88]); // side windows: the profile shrunk a little, so the cracks stay off the pillars
    const x0 = Math.min(...S.map(p => p[0])),
      x1 = Math.max(...S.map(p => p[0])),
      y0 = Math.min(...S.map(p => p[1])),
      y1 = Math.max(...S.map(p => p[1]));
    const tri = THREE.ShapeUtils.triangulateShape(
      S.map(p => new THREE.Vector2(p[0], p[1])),
      [],
    );
    for (const side of [-1, 1])
      for (const f of tri)
        for (const i of f) {
          pos.push(side * (P.gw / 2 + 0.015), S[i][1], S[i][0]);
          uv.push((S[i][0] - x0) / (x1 - x0), (S[i][1] - y0) / (y1 - y0));
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.addGroup(0, front, 0);
    g.addGroup(front, pos.length / 3 - front, 1);
    crackGeoCache[t] = g;
    return g;
  }
  private modelCrackGeo(src: THREE.BufferGeometry) {
    const { modelCrackGeos } = this;
    let g = modelCrackGeos.get(src);
    if (g) return g;
    const s = src.index ? src.toNonIndexed() : src,
      P = s.attributes.position,
      pos: number[][] = [[], []],
      uv: number[][] = [[], []];
    s.computeBoundingBox();
    const { min: m, max: M } = s.boundingBox!,
      w = M.x - m.x,
      h = M.y - m.y,
      l = M.z - m.z;
    for (let i = 0; i < P.count; i += 3) {
      _ga.fromBufferAttribute(P, i);
      _gb.fromBufferAttribute(P, i + 1);
      _gc.fromBufferAttribute(P, i + 2);
      const n = _gc.sub(_gb).cross(_gb.clone().sub(_ga)).normalize();
      if (Math.abs(n.y) > MODEL_GLASS_FLAT) continue; // the glass's flat top, hidden under the roof
      const k = Math.abs(n.z) > Math.abs(n.x) ? 0 : 1; // the models face -z
      for (let j = 0; j < 3; j++) {
        _ga.fromBufferAttribute(P, i + j);
        pos[k].push(_ga.x, _ga.y, _ga.z);
        uv[k].push(k ? (_ga.z - m.z) / l : (_ga.x - m.x) / w, (_ga.y - m.y) / h);
      }
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...pos[0], ...pos[1]], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv[0], ...uv[1]], 2));
    g.addGroup(0, pos[0].length / 3, 0);
    g.addGroup(pos[0].length / 3, pos[1].length / 3, 1);
    modelCrackGeos.set(src, g);
    return g;
  }
  // the procedural cracks go on the procedural body, so they hide with it when the model shows; the model, which loads later, gets its own
  private crackGlass(c: DamagedCar) {
    const { vehicleVisuals } = this.g;
    const lv = crackLevel(c.dmg);
    if (!lv) return;
    if (c.crack !== lv) {
      if (!c.crackMesh) {
        c.crackMesh = new THREE.Mesh(this.crackGeo(c.type), this.crackMats[lv]!);
        c.body.add(c.crackMesh);
      }
      c.crackMesh.material = this.crackMats[lv]!;
      if (c.modelCrack) for (const m of c.modelCrack) m.material = this.crackMats[lv]!;
      c.crack = lv;
    }
    if (!c.modelCrack && vehicleVisuals.loaded(c) && c.mesh.getObjectByName('glass_envelope')) {
      const glass: THREE.Mesh[] = [];
      c.mesh.traverse(o => {
        if (o instanceof THREE.Mesh && o.name.startsWith('glass_')) glass.push(o);
      });
      c.modelCrack = glass.map(gl => {
        const m = new THREE.Mesh(this.modelCrackGeo(gl.geometry), this.crackMats[lv]!);
        gl.add(m);
        return m;
      });
    }
  }

  /** T is where the camera looks: only the cars near it smoke. */
  updateSmoke(dt: number, T: { x: number; z: number }) {
    const { cars, vehicleVisuals, groundAt, rnd: dmgRnd } = this.g,
      { puffs } = this;
    for (const c of cars) {
      const cl = crackLevel(c.dmg);
      if (cl && (c.crack !== cl || (!c.modelCrack && vehicleVisuals.loaded(c)))) this.crackGlass(c); // after a crash, and once its model loads; one that failed never does
      const lv = smokeLevel(c.dmg);
      if (!lv || c.wet || Math.abs(c.x - T.x) > SMOKE_NEAR_M || Math.abs(c.z - T.z) > SMOKE_NEAR_M) continue;
      c.smokeT = (c.smokeT || 0) + dt * SMOKE_RATE[lv];
      for (; c.smokeT >= 1; c.smokeT--) {
        const p = puffs[this.puffI];
        this.puffI = (this.puffI + 1) % SMOKE_N; // a ring: the oldest puff goes first
        const fwd = c.type === 'traktor' ? 1.4 : 1.7,
          x = c.x + Math.sin(c.h) * fwd + (dmgRnd() - 0.5) * 0.5,
          z = c.z - Math.cos(c.h) * fwd + (dmgRnd() - 0.5) * 0.5;
        p.position.set(x, groundAt(x, z) + 1.1, z);
        p.age = 0;
        p.visible = true;
        p.material.color.copy(SMOKE_COLS[lv]!);
      }
    }
    for (const p of puffs) {
      if (!p.visible) continue;
      p.age += dt;
      const t = p.age / SMOKE_S;
      if (t >= 1) {
        p.visible = false;
        continue;
      }
      p.position.y += dt * 1.3;
      p.scale.setScalar(0.6 + t * 2.4);
      p.material.opacity = 0.75 * (1 - t);
    }
  }
}
