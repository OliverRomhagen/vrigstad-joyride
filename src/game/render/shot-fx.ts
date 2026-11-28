// Draws the shots (#17, lab: pickadoll): the shots in the air, the splats they leave on the ground, on walls, on cars
// and on people, and the mark where the next shot would land. The rules are in ../sim/shots.ts.
import * as THREE from 'three';
import { HitKind, SHOTS_MAX, type Shot, type ShotHit } from '../sim/shots';
import { SPIKES_MAX } from '../sim/spikes';

const SPLATS_MAX = 600,
  SPLATS_MAX_COARSE = 220; // splats on the ground and the walls; the oldest is painted over first. On a touch screen
const STUCK_MAX = 80,
  STUCK_MAX_COARSE = 36; // splats on cars and people, each its own mesh
const SPLAT_ORDER = 1, // splats are drawn after the walls and cars they sit on
  STUCK_ORDERS = 4096;
const LIFT_M = 0.03; // a splat sits this far off its surface, so the two don't flicker
const SHOT_R_M = 0.07;
const TRACER_THICK_M = 0.06, // a fast shot's streak: thicker than the shot, or it is thinner than a pixel a street away
  TRACER_COLOUR = '#fff1c2',
  STREAK_S = 0.07, // the last stretch of a fast shot's streak stays this long where it ended
  STREAKS_MAX = 24; // of those at once; the oldest goes first
// an impact: a shot is drawn where it was when the frame began, so the last place it is seen is up to a frame's flight
// short of what it hits. It is drawn on the surface instead for a moment, squashing flat, and its splat grows in
const IMPACT_S = 0.05,
  IMPACT_FLAT = 0.35, // the squashed ball's depth, as a share of its round one
  IMPACTS_MAX = 32, // at once; the oldest goes first
  POP_S = 0.08, // a new splat grows to its size in this long,
  POP_FROM = 0.6, // from this share of it
  POPS_MAX = 48;
// droplets: a few bits fly off where a shot stops, out from the surface and falling, and shrink away
const DROPS_PER_HIT = 5,
  DROPS_MAX = 120, // at once; the oldest goes first
  DROP_R_M = 0.025,
  DROP_S = [0.15, 0.25], // each lasts between these
  DROP_OUT_MS = [1.5, 3.5], // out from the surface, between these
  DROP_SIDE_MS = 2, // and along it, up to this
  DROP_GRAVITY_MS2 = 9.8;
const ARC_MAX = 64, // dots in a throw's arc
  ARC_DOT_M = 0.045;
const ARM_M = 0.6, // the player's arm, shoulder to hand (models.ts)
  ARM_HALF_THICK_M = 0.08,
  GUN_GRIP_M = 0.08; // the hand holds the gun this far in from its end
const SPIKE_M = 0.16;
const SLOPE_STEP_M = 0.5; // the ground's slope under a splat is read over this distance
const TEX_PX = 128;
// where a splat lands on a person: on the front, the back or a side of the body's box (m, as personParts builds it)
const BODY_HALF_DEPTH_M = 0.15,
  BODY_HALF_WIDTH_M = 0.26,
  BODY_LOW_M = 0.9,
  BODY_HIGH_M = 1.4,
  BODY_SPLAT_MAX_M = 0.2;
// a headshot's splat goes on the head's box instead (personParts in ./models.ts: 0.27 m, its middle 1.62 m up), and
// smaller, to fit a face
const HEAD_SPLAT_OUT_M = 0.14, // 5 mm off the head's faces (0.135), as the body's sit off the torso, and inside the hair's
  HEAD_LOW_M = 1.6, // no lower, or its lower edge hangs in the air under the chin: the model has no neck
  HEAD_HIGH_M = 1.7,
  HEAD_SPLAT_MAX_M = 0.12;

export interface ShotFxDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera; // the line of sight starts here, and aiming moves it
  coarse: boolean;
  groundAt(x: number, z: number): number;
  rnd(): number; // its own stream: the shape of the splat
  calmMotion: { readonly matches: boolean }; // prefers-reduced-motion: an impact doesn't squash, and a splat doesn't grow
}

/** A shot that landed, drawn on the surface it hit for a moment. */
interface Impact {
  at: THREE.Vector3;
  normal: THREE.Vector3;
  scale: number; // of the shot ball's geometry
  colour: THREE.Color;
  leftS: number;
}

/** A droplet in the air. */
interface Drop {
  at: THREE.Vector3;
  v: THREE.Vector3; // m/s
  colour: THREE.Color;
  lifeS: number;
  leftS: number;
}

/** A splat growing to its size: an instance of the splats' mesh, or a mesh of its own on a car or a person. */
interface Pop {
  index: number; // in the splats' mesh; -1 for `mesh`
  mesh: THREE.Mesh | null;
  at: THREE.Vector3;
  turn: THREE.Quaternion;
  full: THREE.Vector3; // its scale when grown
  leftS: number;
}

const _m = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _spin = new THREE.Quaternion(),
  _p = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _grow = new THREE.Vector3(), // sizeSplat's own, so a pop can be handed _s
  _c = new THREE.Color(),
  Z = new THREE.Vector3(0, 0, 1),
  UP = new THREE.Vector3(0, 1, 0);

/** Shots, splats and the aim mark. */
export class ShotFx {
  private readonly g: ShotFxDeps;
  private readonly shots: THREE.InstancedMesh;
  private readonly tracers: THREE.InstancedMesh;
  private readonly ended: { at: THREE.Matrix4; leftS: number }[] = []; // streaks of shots that have landed
  private nextEnded = 0;
  private readonly impacts: Impact[] = [];
  private nextImpact = 0;
  private readonly pops: Pop[] = [];
  private nextPop = 0;
  private readonly drops: Drop[] = [];
  private nextDrop = 0;
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly splats: THREE.InstancedMesh;
  private readonly spikes: THREE.InstancedMesh;
  private readonly arc: THREE.InstancedMesh;
  private readonly arcEnd: THREE.Mesh;
  private readonly gun: THREE.Mesh;
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly texture: THREE.CanvasTexture;
  private readonly stuckMats = new Map<string, THREE.Material>();
  private readonly colours = new Map<string, THREE.Color>();
  private readonly stuck: THREE.Mesh[] = [];
  private readonly stuckMax: number;
  private readonly fov: number; // the camera's usual field of view
  private next = 0; // the splat painted over next
  /** splats left so far, the painted-over ones included */
  splatted = 0;

  constructor(g: ShotFxDeps) {
    this.g = g;
    this.fov = g.camera.fov;
    this.texture = splatTexture(g.rnd);
    const max = g.coarse ? SPLATS_MAX_COARSE : SPLATS_MAX;
    this.stuckMax = g.coarse ? STUCK_MAX_COARSE : STUCK_MAX;
    this.shots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(SHOT_R_M, 8, 6),
      new THREE.MeshBasicMaterial(),
      SHOTS_MAX,
    );
    // a fast shot is a pale streak along its flight: a box, stretched
    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(TRACER_COLOUR).convertSRGBToLinear() }),
      SHOTS_MAX,
    );
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.scene.add(this.tracers);
    this.splats = new THREE.InstancedMesh(this.quad, this.splatMaterial(), max);
    // a fotangel: a small steel jack, four points whichever way it lies
    this.spikes = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(SPIKE_M),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#3a4046').convertSRGBToLinear() }),
      SPIKES_MAX,
    );
    this.spikes.count = 0;
    this.spikes.frustumCulled = false;
    this.spikes.castShadow = true;
    g.scene.add(this.spikes);
    // a throw's arc: pale dots, and a ring on the ground where it ends
    const pale = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
    this.arc = new THREE.InstancedMesh(new THREE.SphereGeometry(ARC_DOT_M, 6, 4), pale, ARC_MAX);
    this.arc.count = 0;
    this.arc.frustumCulled = false;
    this.arcEnd = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2), pale);
    this.arcEnd.visible = false;
    // a placeholder gun: one dark box, sized for the weapon held (no models yet)
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a2f33').convertSRGBToLinear() }),
    );
    this.gun.castShadow = true;
    g.scene.add(this.arc, this.arcEnd);
    this.dropMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(DROP_R_M, 0),
      new THREE.MeshBasicMaterial(),
      DROPS_MAX,
    );
    this.dropMesh.setColorAt(0, _c.set('#ffffff')); // the colour buffer, before the first frame compiles the material
    this.dropMesh.count = 0;
    this.dropMesh.visible = false; // none in the air: no draw call
    this.dropMesh.frustumCulled = false;
    this.dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.scene.add(this.dropMesh);
    for (const mesh of [this.shots, this.splats]) {
      mesh.setColorAt(0, _c.set('#ffffff')); // makes the colour buffer before the first frame compiles the material
      mesh.count = 0;
      mesh.frustumCulled = false; // the instances are all over the village
      mesh.renderOrder = SPLAT_ORDER;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.scene.add(mesh);
    }
  }

  // The game keeps colour management off (src/world/three-legacy.ts), so every colour here is converted by hand.
  // cut out, not blended: crisp edges, and no sorting against the glass and the water. Unlit: in full sun a lit splat
  // on the ground washed out to pastel, so the colour is drawn as it is (and glows a little at night)
  private splatMaterial(colour?: string) {
    return new THREE.MeshBasicMaterial({
      map: this.texture,
      color: new THREE.Color(colour ?? '#ffffff').convertSRGBToLinear(),
      alphaTest: 0.5,
      depthWrite: false, // splats that overlap are settled by the order they landed in, not by depth, where they would flicker
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  // a colour as the renderer wants it, worked out once: the shots in the air ask every frame
  private linear(colour: string) {
    let c = this.colours.get(colour);
    if (!c) {
      c = new THREE.Color(colour).convertSRGBToLinear();
      this.colours.set(colour, c);
    }
    return c;
  }

  /**
   * Draws the shots in the air; `colour` gives each its colour. One with a `tracerM` is drawn as a streak that long
   * behind it, along its flight, and no longer than it has flown.
   */
  drawShots<S extends Shot>(
    shots: readonly S[],
    colour: (s: S) => string,
    radiusM: (s: S) => number,
    tracerM: (s: S) => number,
    dt: number,
  ) {
    this.growSplats(dt);
    this.flyDrops(dt);
    const n = Math.min(shots.length, SHOTS_MAX);
    if (!n && !this.shots.count && !this.tracers.count) return; // nothing in the air, and nothing was: no buffers to send
    let balls = 0,
      streaks = 0;
    for (let i = 0; i < n; i++) {
      const s = shots[i],
        speed = Math.hypot(s.vx, s.vy, s.vz),
        long = speed > 0 ? Math.min(tracerM(s), speed * s.ageS) : 0;
      if (tracerM(s) > 0) {
        if (long <= 0) continue; // it has only just left
        _n.set(s.vx, s.vy, s.vz).divideScalar(speed);
        _q.setFromUnitVectors(Z, _n);
        _p.set(s.x, s.y, s.z).addScaledVector(_n, -long / 2);
        this.tracers.setMatrixAt(streaks++, _m.compose(_p, _q, _s.set(TRACER_THICK_M, TRACER_THICK_M, long)));
        continue;
      }
      const r = radiusM(s) / SHOT_R_M;
      this.shots.setMatrixAt(balls, _m.makeScale(r, r, r).setPosition(s.x, s.y + (s.lying ? radiusM(s) : 0), s.z));
      this.shots.setColorAt(balls++, this.linear(colour(s)));
    }
    // the shots that just landed, on the surface they hit: flattening against it, quick to start and slowing
    const calm = this.g.calmMotion.matches;
    for (const e of this.impacts) {
      if (e.leftS <= 0) continue;
      if (balls < SHOTS_MAX) {
        const t = 1 - e.leftS / IMPACT_S,
          flat = calm ? 1 : 1 - (1 - IMPACT_FLAT) * (1 - (1 - t) * (1 - t));
        _q.setFromUnitVectors(Z, e.normal);
        _p.copy(e.at).addScaledVector(e.normal, SHOT_R_M * e.scale * flat); // resting on the surface, not in it
        this.shots.setMatrixAt(balls, _m.compose(_p, _q, _s.set(e.scale, e.scale, e.scale * flat)));
        this.shots.setColorAt(balls++, e.colour);
      }
      e.leftS -= dt;
    }
    this.shots.count = balls;
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
    for (const e of this.ended) {
      if (e.leftS <= 0) continue;
      if (streaks < SHOTS_MAX) this.tracers.setMatrixAt(streaks++, e.at);
      e.leftS -= dt;
    }
    if (streaks || this.tracers.count) this.tracers.instanceMatrix.needsUpdate = true;
    this.tracers.count = streaks;
  }

  /**
   * A fast shot ended at (x, y, z), having come from (fromX, fromY, fromZ) this frame: the last `longM` metres of that
   * stretch stay as a streak for a moment. Without it a shot that lands within its first frame would never be seen.
   */
  endStreak(fromX: number, fromY: number, fromZ: number, x: number, y: number, z: number, longM: number) {
    _n.set(x - fromX, y - fromY, z - fromZ);
    const long = Math.min(longM, _n.length());
    if (long < 0.05) return;
    _n.normalize();
    if (this.ended.length < STREAKS_MAX) this.ended.push({ at: new THREE.Matrix4(), leftS: 0 });
    const e = this.ended[this.nextEnded];
    this.nextEnded = (this.nextEnded + 1) % STREAKS_MAX;
    _q.setFromUnitVectors(Z, _n);
    _p.set(x, y, z).addScaledVector(_n, -long / 2);
    e.at.compose(_p, _q, _s.set(TRACER_THICK_M, TRACER_THICK_M, long));
    e.leftS = STREAK_S;
    this.tracers.count = Math.max(this.tracers.count, 1); // so the next drawShots doesn't take the air for empty
  }

  /**
   * A shot of radius `radiusM` stopped on what `hit` says: it is drawn there for a moment, squashing against the surface,
   * so it is seen to arrive rather than to vanish a little short of it.
   */
  impact(hit: Pick<ShotHit, 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>, radiusM: number, colour: string) {
    if (this.impacts.length < IMPACTS_MAX)
      this.impacts.push({
        at: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        scale: 1,
        colour: new THREE.Color(),
        leftS: 0,
      });
    const e = this.impacts[this.nextImpact];
    this.nextImpact = (this.nextImpact + 1) % IMPACTS_MAX;
    e.at.set(hit.x, hit.y, hit.z);
    e.normal.set(hit.nx, hit.ny, hit.nz);
    if (e.normal.lengthSq() < 1e-6) e.normal.copy(UP);
    e.normal.normalize();
    e.scale = radiusM / SHOT_R_M;
    e.colour.copy(this.linear(colour));
    e.leftS = IMPACT_S;
    this.shots.count = Math.max(this.shots.count, 1); // so the next drawShots doesn't take the air for empty
  }

  /**
   * A few droplets fly off where a shot stopped: out from the surface `hit` faces and a little along it, falling, in
   * `colour`. None for someone who asked for less motion.
   */
  spray(hit: Pick<ShotHit, 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>, colour: string) {
    if (this.g.calmMotion.matches) return;
    const { rnd } = this.g;
    _n.set(hit.nx, hit.ny, hit.nz);
    if (_n.lengthSq() < 1e-6) _n.copy(UP);
    _n.normalize();
    for (let k = 0; k < DROPS_PER_HIT; k++) {
      if (this.drops.length < DROPS_MAX)
        this.drops.push({
          at: new THREE.Vector3(),
          v: new THREE.Vector3(),
          colour: new THREE.Color(),
          lifeS: 0,
          leftS: 0,
        });
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % DROPS_MAX;
      d.at.set(hit.x, hit.y, hit.z).addScaledVector(_n, DROP_R_M * 2);
      d.v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).multiplyScalar(DROP_SIDE_MS);
      d.v.addScaledVector(_n, DROP_OUT_MS[0] + rnd() * (DROP_OUT_MS[1] - DROP_OUT_MS[0]) - d.v.dot(_n));
      d.colour.copy(this.linear(colour));
      d.lifeS = d.leftS = DROP_S[0] + rnd() * (DROP_S[1] - DROP_S[0]);
    }
    this.dropMesh.visible = true;
  }

  private flyDrops(dt: number) {
    if (!this.dropMesh.visible) return;
    let n = 0;
    for (const d of this.drops) {
      if (d.leftS <= 0) continue;
      d.leftS -= dt;
      d.v.y -= DROP_GRAVITY_MS2 * dt;
      d.at.addScaledVector(d.v, dt);
      const k = Math.max(0, d.leftS / d.lifeS); // shrinks away as it goes
      this.dropMesh.setMatrixAt(n, _m.makeScale(k, k, k).setPosition(d.at));
      this.dropMesh.setColorAt(n++, d.colour);
    }
    this.dropMesh.count = n;
    this.dropMesh.visible = n > 0;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    if (this.dropMesh.instanceColor) this.dropMesh.instanceColor.needsUpdate = true;
  }

  // a splat just left starts small and grows to its size, quick at first: `index` in the splats' mesh, or a mesh of its own
  private pop(index: number, mesh: THREE.Mesh | null, at: THREE.Vector3, turn: THREE.Quaternion, full: THREE.Vector3) {
    if (this.g.calmMotion.matches) return;
    if (this.pops.length < POPS_MAX)
      this.pops.push({
        index: -1,
        mesh: null,
        at: new THREE.Vector3(),
        turn: new THREE.Quaternion(),
        full: new THREE.Vector3(),
        leftS: 0,
      });
    const e = this.pops[this.nextPop];
    this.nextPop = (this.nextPop + 1) % POPS_MAX;
    if (e.leftS > 0) this.sizeSplat(e, 1); // the oldest, still growing, is finished at once
    e.index = index;
    e.mesh = mesh;
    e.at.copy(at);
    e.turn.copy(turn);
    e.full.copy(full);
    e.leftS = POP_S;
    this.sizeSplat(e, POP_FROM);
  }

  private growSplats(dt: number) {
    for (const e of this.pops) {
      if (e.leftS <= 0) continue;
      e.leftS -= dt;
      const t = Math.min(1, 1 - e.leftS / POP_S);
      this.sizeSplat(e, e.leftS <= 0 ? 1 : POP_FROM + (1 - POP_FROM) * (1 - (1 - t) ** 3));
    }
  }

  // a growing splat at share k of its size
  private sizeSplat(e: Pop, k: number) {
    _grow.copy(e.full).multiplyScalar(k);
    if (e.mesh) {
      e.mesh.scale.copy(_grow);
      return;
    }
    this.splats.setMatrixAt(e.index, _m.compose(e.at, e.turn, _grow));
    this.splats.instanceMatrix.needsUpdate = true;
  }

  /**
   * Draws a throw's arc: `n` points, x, y, z after each other in `points`, as a dotted line, and a ring of `ringM`
   * metres on the ground where it ends. n = 0 hides it.
   */
  drawArc(points: readonly number[], n: number, ringM: number) {
    if (!n && !this.arc.count) return;
    const dots = Math.min(n, ARC_MAX);
    for (let i = 0; i < dots; i++)
      this.arc.setMatrixAt(i, _m.makeTranslation(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    this.arc.count = dots;
    this.arc.instanceMatrix.needsUpdate = true;
    this.arcEnd.visible = n > 0;
    if (n > 0) {
      this.arcEnd.position.set(points[(n - 1) * 3], points[(n - 1) * 3 + 1] + LIFT_M * 2, points[(n - 1) * 3 + 2]);
      this.arcEnd.scale.setScalar(ringM);
    }
  }

  /** Puts a placeholder gun in a hand: `arm` hangs from its shoulder, so the gun points the way the arm does. */
  giveGun(arm: THREE.Object3D) {
    arm.add(this.gun);
  }

  /** Puts the gun away, out of sight, or draws it again. */
  holsterGun(away: boolean) {
    this.gun.visible = !away;
  }

  /** The gun's length and thickness (m), for the weapon held. */
  sizeGun(lengthM: number, thickM: number) {
    this.gun.scale.set(thickM, lengthM, thickM);
    // on top of the hand when the arm is raised (the arm's -z is up then), so it shows over the arm from behind
    this.gun.position.set(0, -ARM_M - lengthM / 2 + GUN_GRIP_M * 2, -(ARM_HALF_THICK_M + thickM / 2));
  }

  /** Draws the fotanglar that lie on the ground. Call it when the list changes. */
  drawSpikes(spikes: readonly { x: number; y: number; z: number; turn: number }[]) {
    const n = Math.min(spikes.length, SPIKES_MAX);
    for (let i = 0; i < n; i++) {
      const s = spikes[i];
      _q.setFromAxisAngle(UP, s.turn * Math.PI * 2);
      this.spikes.setMatrixAt(i, _m.compose(_p.set(s.x, s.y + SPIKE_M * 0.6, s.z), _q, _s.set(1, 1, 1)));
    }
    this.spikes.count = n;
    this.spikes.instanceMatrix.needsUpdate = true;
  }

  /** Leaves a splat of radius `r` (m) where a shot hit the ground or a wall; `turn` (0..1) turns it, so no two look the same. */
  splat(hit: Pick<ShotHit, 'kind' | 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>, r: number, colour: string, turn: number) {
    _n.set(hit.nx, hit.ny, hit.nz);
    if (hit.kind === HitKind.GROUND) {
      const { groundAt } = this.g,
        d = SLOPE_STEP_M;
      _n.set(
        groundAt(hit.x - d, hit.z) - groundAt(hit.x + d, hit.z),
        2 * d,
        groundAt(hit.x, hit.z - d) - groundAt(hit.x, hit.z + d),
      ).normalize();
    }
    this.place(hit, r, turn);
    const i = this.next;
    this.next = (this.next + 1) % this.splats.instanceMatrix.count;
    this.splats.setMatrixAt(i, _m);
    this.splats.setColorAt(i, this.linear(colour));
    this.splats.count = Math.min(this.splats.count + 1, this.splats.instanceMatrix.count);
    this.splats.instanceMatrix.needsUpdate = true;
    if (this.splats.instanceColor) this.splats.instanceColor.needsUpdate = true;
    this.splatted++;
    this.pop(i, null, _p, _q, _s);
  }

  // _m: a quad of radius r at the hit, facing along _n and turned about it
  private place(at: { x: number; y: number; z: number }, r: number, turn: number) {
    _q.setFromUnitVectors(Z, _n).multiply(_spin.setFromAxisAngle(Z, turn * Math.PI * 2));
    _p.set(at.x, at.y, at.z).addScaledVector(_n, LIFT_M);
    _m.compose(_p, _q, _s.set(r * 2, r * 2, 1));
  }

  /** Leaves a splat on something that moves, a car's mesh: it goes where the car goes. */
  splatOn(
    target: THREE.Object3D,
    hit: Pick<ShotHit, 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>,
    r: number,
    colour: string,
    turn: number,
  ) {
    _n.set(hit.nx, hit.ny, hit.nz);
    this.place(hit, r, turn);
    const mesh = this.stick(colour);
    _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld();
    target.updateWorldMatrix(true, false);
    target.attach(mesh); // keeps it where it is in the world, as the target's child
    this.pop(-1, mesh, mesh.position, mesh.quaternion, mesh.scale);
  }

  /** Leaves a splat on a person's body, on the side the shot came from: (dx, dz) is the way the shot flew, `y` its height. */
  splatOnPerson(
    person: THREE.Object3D,
    dx: number,
    dz: number,
    y: number,
    r: number,
    colour: string,
    turn: number,
    isHead = false, // a headshot: on the head, not the body
  ) {
    person.updateWorldMatrix(true, false);
    // the way back to the shooter, in the person's own axes
    _n.set(-dx, 0, -dz).transformDirection(_m.copy(person.matrixWorld).invert());
    const up = THREE.MathUtils.clamp(
        _p.set(person.position.x, y, person.position.z).applyMatrix4(_m).y,
        isHead ? HEAD_LOW_M : BODY_LOW_M,
        isHead ? HEAD_HIGH_M : BODY_HIGH_M,
      ),
      halfDepth = isHead ? HEAD_SPLAT_OUT_M : BODY_HALF_DEPTH_M,
      halfWidth = isHead ? HEAD_SPLAT_OUT_M : BODY_HALF_WIDTH_M;
    const mesh = this.stick(colour);
    if (Math.abs(_n.z) >= Math.abs(_n.x)) {
      mesh.position.set(0, up, Math.sign(_n.z) * halfDepth);
      _n.set(0, 0, Math.sign(_n.z) || 1);
    } else {
      mesh.position.set(Math.sign(_n.x) * halfWidth, up, 0);
      _n.set(Math.sign(_n.x), 0, 0);
    }
    mesh.quaternion.setFromUnitVectors(Z, _n).multiply(_spin.setFromAxisAngle(Z, turn * Math.PI * 2));
    mesh.scale.setScalar(Math.min(r, isHead ? HEAD_SPLAT_MAX_M : BODY_SPLAT_MAX_M) * 2);
    person.add(mesh);
    this.pop(-1, mesh, mesh.position, mesh.quaternion, mesh.scale);
  }

  private shown(o: THREE.Object3D) {
    for (let p = o.parent; p; p = p.parent) if (p === this.g.scene) return true;
    return false;
  }

  // a splat mesh of its own, taking the oldest one's place when there are too many
  private stick(colour: string) {
    let material = this.stuckMats.get(colour);
    if (!material) {
      material = this.splatMaterial(colour);
      this.stuckMats.set(colour, material);
    }
    // those on a person or a car that has left the scene go first, so they hold neither a slot nor the dead mesh
    let kept = 0;
    for (const old of this.stuck) {
      if (this.shown(old)) this.stuck[kept++] = old;
      else old.removeFromParent();
    }
    this.stuck.length = kept;
    if (this.stuck.length >= this.stuckMax) this.stuck.shift()!.removeFromParent();
    const mesh = new THREE.Mesh(this.quad, material);
    mesh.renderOrder = SPLAT_ORDER + (this.splatted % STUCK_ORDERS) / STUCK_ORDERS; // a later one over an earlier one
    this.stuck.push(mesh);
    this.splatted++;
    return mesh;
  }

  /**
   * Moves the camera `k` of the way (0..1) from where the game put it to (x, y, z), looking at (lx, ly, lz), with the
   * field of view `zoom` times the usual at k = 1. Call it every frame, after the game's camera is placed; k = 0 only
   * puts the field of view back.
   */
  aimCamera(k: number, x: number, y: number, z: number, lx: number, ly: number, lz: number, zoom: number) {
    const { camera } = this.g,
      fov = this.fov * (1 + (zoom - 1) * k);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (k <= 0) return;
    _spin.setFromRotationMatrix(_m.lookAt(_p.set(x, y, z), _n.set(lx, ly, lz), UP));
    camera.position.lerp(_p, k);
    camera.quaternion.slerp(_spin, k);
  }

  /** The field of view through a scope that magnifies `times`, as a share of the usual: `zoom` for aimCamera. */
  magnified(times: number) {
    const half = THREE.MathUtils.degToRad(this.fov / 2);
    return Math.atan(Math.tan(half) / times) / half;
  }

  /**
   * The line of sight through a point on screen: `ndcY` is how far above the middle it is, as a share of half the
   * screen's height. Writes where it starts (the camera) and its direction, a unit vector, to `out`.
   */
  sightLine(ndcY: number, out: { x: number; y: number; z: number; dx: number; dy: number; dz: number }) {
    const { camera } = this.g;
    _p.set(0, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    out.x = camera.position.x;
    out.y = camera.position.y;
    out.z = camera.position.z;
    out.dx = _p.x;
    out.dy = _p.y;
    out.dz = _p.z;
    return out;
  }
}

// one splat shape, white on clear: a blob with lobes around it and a few drops flung further out
function splatTexture(rnd: () => number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_PX;
  const ctx = canvas.getContext('2d')!,
    mid = TEX_PX / 2;
  ctx.fillStyle = '#fff';
  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(mid, mid, TEX_PX * 0.24);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.4,
      reach = TEX_PX * (0.2 + rnd() * 0.13);
    dot(mid + Math.cos(a) * reach, mid + Math.sin(a) * reach, TEX_PX * (0.05 + rnd() * 0.07));
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2,
      reach = TEX_PX * (0.36 + rnd() * 0.1);
    dot(mid + Math.cos(a) * reach, mid + Math.sin(a) * reach, TEX_PX * (0.012 + rnd() * 0.025));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
