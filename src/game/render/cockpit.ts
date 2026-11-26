// The driver's view (#473, lab: cockpit): the camera in the driver's seat of the car you drive, over a simple interior
// that every car shares, scaled to its cabin. The models are solid shells with no interiors yet, their glass an opaque
// envelope over the body, so while you sit in your own car its glass is hidden and its body clipped above the belt line
// between the windscreen and the rear window; the interior builds the cabin's frame there. Reads the car and the view, never changes them.
import * as THREE from 'three';
import type { GameState, ViewState } from '../state';
import type { RenderedCar } from './car-meshes';
import { BODY_NODE } from './vehicle-registry';

/** The car's cabin in its body's frame (m; -z is forward, +y up, x to the right): its glass from the belt line to the roof. */
interface Cabin {
  halfW: number;
  belt: number;
  roof: number;
  front: number; // the windscreen's foot
  rear: number;
}

/** the driver's eye: this far left of the middle at most, and this far under the roof (m); Swedish cars are left-hand drive */
const EYE_SIDE_M = 0.37;
const EYE_UNDER_ROOF_M = 0.2;
/** ... and at least this far over the belt line, this far behind the windscreen's foot (m) */
const EYE_OVER_BELT_M = 0.25;
const EYE_BEHIND_SCREEN_M = 1.0;
/** the body is clipped this far over the belt line, so the cut hides under the window sills (m) */
const CLIP_OVER_BELT_M = 0.01;
/** the camera's near plane inside the car, close enough for the wheel (m); the normal one is restored when you leave */
const NEAR_INSIDE_M = 0.05;
/** the steering wheel's radius, and how far it turns at full lock (rad) */
const WHEEL_R_M = 0.19;
const WHEEL_LOCK_RAD = 1.6;
/** it stands this far in front of the eye and over the belt line, its top leaning this far forward (m, rad): clear of the dashboard */
const WHEEL_AHEAD_M = 0.42;
const WHEEL_OVER_BELT_M = 0.04;
const WHEEL_TILT_RAD = 0.4;
/** in the driver's seat, the mouse and drag pitch the view from the normal pitch, and the view keeps within these (rad) */
const PITCH_REST_RAD = 0.34;
const PITCH_MIN_RAD = -0.6;
const PITCH_MAX_RAD = 0.5;
/** at rest the eye looks this far down from level, so the dials show over the bottom of the screen (rad) */
const LOOK_DOWN_RAD = 0.09;

/** the dials: the speedometer's top (km/h), and how far the turbo gauge reads from the throttle alone (0..1, 1 on boost) */
const SPEEDO_MAX_KMH = 200;
const TURBO_ON_THROTTLE = 0.35;
/** the dial panel's canvas (px) and its size on the instrument hood (m) */
const DIALS_W_PX = 512;
const DIALS_H_PX = 160;
const DIALS_W_M = 0.36;
/** a needle sweeps this far from its rest, from lower left to lower right (rad) */
const NEEDLE_SWEEP_RAD = (270 * Math.PI) / 180;

const DASH = '#141516';
const SEAT = '#3b3530';
const HEADLINER = '#b9b3a6';
const PILLAR = '#1d1f20';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();

// whether `now` wears another colour than `was`; a material without one (the simple car's paint is in its geometry) never does
const recoloured = (now: THREE.Material, was: THREE.Material | undefined) => {
  const a = (now as { color?: THREE.Color }).color,
    b = (was as { color?: THREE.Color } | undefined)?.color;
  return !!a && !!b && !a.equals(b);
};

/** What the driver's view reads from the rest of the game. */
export interface CockpitDeps {
  camera: THREE.PerspectiveCamera;
  game: Pick<GameState, 'inCar' | 'pcar'>;
  view: Pick<ViewState, 'lookOff' | 'camPitch'>;
  profiles: Readonly<Record<string, CarProfile>>; // the simple cars' side profiles (models.ts' PROFILES)
  renderer: Pick<THREE.WebGLRenderer, 'localClippingEnabled'>; // clips your own car's body at the belt line
  doc: Pick<Document, 'createElement'>; // the dials' canvas
  readonly hour: number; // the clock on the dashboard: the day cycle's hour (DayClock.hour)
  repaint(car: RenderedCar): void; // gives the model its car's paint again (VehicleVisuals.paint), after a respray inside
}

/** The part of a simple car's side profile the cabin is read from: its glass, as (z, y) points, and the glass's width (m). */
interface CarProfile {
  glass: readonly (readonly number[])[];
  gw: number;
}

/** The cabin of a loaded model, from its glass meshes, in the frame of `body` (the part that rides the springs). */
function modelCabin(body: THREE.Object3D): Cabin | null {
  const glass: THREE.Mesh[] = [];
  body.traverse(o => {
    if (o instanceof THREE.Mesh && o.name.startsWith('glass')) glass.push(o);
  });
  if (!glass.length) return null;
  body.updateWorldMatrix(true, true);
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const all = new THREE.Box3();
  for (const g of glass) {
    g.geometry.computeBoundingBox();
    // one transform from the glass's frame to the body's: a box moved twice, through a turned world, comes out too big
    all.union(_box.copy(g.geometry.boundingBox!).applyMatrix4(_m.multiplyMatrices(toBody, g.matrixWorld)));
  }
  return {
    halfW: Math.max(-all.min.x, all.max.x),
    belt: all.min.y,
    roof: all.max.y,
    front: all.min.z,
    rear: all.max.z,
  };
}

/** The cabin of a simple car, from its side profile. */
function profileCabin(p: CarProfile | undefined): Cabin | null {
  if (!p) return null;
  const zs = p.glass.map(([z]) => z);
  const ys = p.glass.map(([, y]) => y);
  return {
    halfW: p.gw / 2,
    belt: Math.min(...ys),
    roof: Math.max(...ys),
    front: Math.min(...zs),
    rear: Math.max(...zs),
  };
}

/** Where the driver's eye is in a cabin. */
function eyeIn(cabin: Cabin) {
  return new THREE.Vector3(
    -Math.min(EYE_SIDE_M, cabin.halfW * 0.45),
    Math.max(cabin.belt + EYE_OVER_BELT_M, cabin.roof - EYE_UNDER_ROOF_M),
    Math.min(cabin.front + EYE_BEHIND_SCREEN_M, (cabin.front + cabin.rear) / 2),
  );
}

/** A box of the given size, its middle at (x, y, z). */
function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A slim post from `a` to `b`: an A-pillar's inside. */
function post(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, thickM: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(thickM, thickM, a.distanceTo(b)), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b); // before it has a parent, so `b` is in the interior's frame
  return m;
}

/** A needle's angle on its dial for `value` of `max`, clockwise from straight up (rad): from -135° at 0 to 135° at max. */
export const needleAngle = (value: number, max: number) =>
  (Math.min(Math.max(value / max, 0), 1) - 0.5) * NEEDLE_SWEEP_RAD;

/** The dial panel: the speedometer (km/h), the turbo gauge (0..1) and a clock (hours), white on black. */
function drawDials(ctx: CanvasRenderingContext2D, kmh: number, turbo: number, hour: number) {
  ctx.fillStyle = '#0b0c0d';
  ctx.fillRect(0, 0, DIALS_W_PX, DIALS_H_PX);
  const dial = (cx: number, r: number, label: string, marks: number, needles: [angle: number, length: number][]) => {
    ctx.strokeStyle = '#d9d4c4';
    ctx.fillStyle = '#d9d4c4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, 80, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < marks; i++) {
      const a = marks === 12 ? (i / 12) * Math.PI * 2 : needleAngle(i, marks - 1);
      const [sx, sy] = [Math.sin(a), -Math.cos(a)];
      ctx.beginPath();
      ctx.moveTo(cx + sx * r * 0.78, 80 + sy * r * 0.78);
      ctx.lineTo(cx + sx * r * 0.92, 80 + sy * r * 0.92);
      ctx.stroke();
    }
    ctx.font = `${Math.round(r * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, 80 + r * 0.55);
    ctx.strokeStyle = '#ff7a2f';
    for (const [a, length] of needles) {
      ctx.lineWidth = length < 0.7 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(cx, 80);
      ctx.lineTo(cx + Math.sin(a) * r * length, 80 - Math.cos(a) * r * length);
      ctx.stroke();
    }
  };
  dial(115, 70, 'TURBO', 5, [[needleAngle(turbo, 1), 0.85]]);
  dial(256, 76, 'km/h', 11, [[needleAngle(kmh, SPEEDO_MAX_KMH), 0.85]]);
  const minutes = hour * 60;
  dial(397, 70, '', 12, [
    [(minutes / 720) * Math.PI * 2, 0.55],
    [((minutes % 60) / 60) * Math.PI * 2, 0.85],
  ]);
}

/**
 * The interior for one cabin: the dashboard, steering wheel, seats and floor below the belt line, and above it the
 * frame the clipped body no longer draws: window sills, pillars and the headliner. `spin` turns the wheel.
 */
function buildInterior(cabin: Cabin, eye: THREE.Vector3, doc: Pick<Document, 'createElement'>) {
  const { halfW, belt, roof, front, rear } = cabin;
  const lit = [DASH, SEAT, HEADLINER, PILLAR].map(c => new THREE.MeshLambertMaterial({ color: c }));
  const [dash, seat, headliner, pillar] = lit;
  const canvas = doc.createElement('canvas');
  canvas.width = DIALS_W_PX;
  canvas.height = DIALS_H_PX;
  const dialsTex = new THREE.CanvasTexture(canvas);
  dialsTex.colorSpace = THREE.SRGBColorSpace;
  const dialsMat = new THREE.MeshBasicMaterial({ map: dialsTex }); // unlit: the dials glow, as at night
  const mats: THREE.Material[] = [...lit, dialsMat];
  const g = new THREE.Group();
  const w = halfW * 2 - 0.04;
  const length = rear - front;
  const middle = (front + rear) / 2;
  g.add(box(dash, w, 0.3, 0.55, 0, belt - 0.11, front + 0.22)); // its top a little over the belt line, against the windscreen
  // the hood over the dials, in front of the driver and ahead of the wheel, and the dials on its face, tilted up to the eye
  g.add(box(dash, 0.42, 0.14, 0.22, eye.x, belt + 0.06, front + 0.33));
  const dials = new THREE.Mesh(new THREE.PlaneGeometry(DIALS_W_M, (DIALS_W_M * DIALS_H_PX) / DIALS_W_PX), dialsMat);
  dials.position.set(eye.x, belt + 0.06, front + 0.46); // clear of the hood's face, whose top it leans towards
  dials.rotation.x = -0.25;
  g.add(dials);
  g.add(box(dash, w, 0.03, length, 0, belt - 0.55, middle)); // the floor, over the hollow under the cut
  g.add(box(headliner, w, 0.03, 0.4, 0, belt - 0.02, rear - 0.2)); // the parcel shelf under the rear window
  for (const s of [-1, 1]) g.add(box(pillar, 0.1, 0.04, length, s * (halfW - 0.05), belt + 0.01, middle)); // the sills
  const seatX = Math.abs(eye.x);
  for (const x of [-seatX, seatX]) {
    g.add(box(seat, 0.5, 0.62, 0.12, x, eye.y - 0.42, eye.z + 0.28)); // backrest, behind the head
    g.add(box(seat, 0.5, 0.12, 0.5, x, eye.y - 0.75, eye.z - 0.05)); // cushion
  }
  // the headliner under the roof, from where the windscreen meets it to the rear window
  const lineFront = front + (roof - belt) * 0.9;
  g.add(box(headliner, w, 0.03, Math.max(0.2, rear - lineFront - 0.1), 0, roof - 0.04, (lineFront + rear - 0.1) / 2));
  for (const s of [-1, 1]) {
    const foot = new THREE.Vector3(s * (halfW - 0.05), belt, front + 0.02);
    const top = new THREE.Vector3(s * (halfW - 0.1), roof - 0.04, lineFront);
    g.add(post(pillar, foot, top, 0.08));
    g.add(box(pillar, 0.08, roof - belt, 0.1, s * (halfW - 0.06), (belt + roof) / 2, eye.z + 0.35)); // B-pillar
    g.add(
      post(
        pillar,
        new THREE.Vector3(s * (halfW - 0.06), belt, rear - 0.05),
        new THREE.Vector3(s * (halfW - 0.1), roof - 0.04, rear - 0.3),
        0.22,
      ),
    ); // C-pillar
  }
  // the steering wheel: a tilt that leans its top forward, and inside it a spin that turns with the steering
  const tilt = new THREE.Group();
  tilt.position.set(eye.x, belt + WHEEL_OVER_BELT_M, eye.z - WHEEL_AHEAD_M);
  tilt.rotation.x = -WHEEL_TILT_RAD;
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R_M, 0.022, 8, 28), pillar));
  spin.add(box(pillar, WHEEL_R_M * 2, 0.04, 0.03, 0, 0, 0)); // the spokes, left to right
  spin.add(box(pillar, 0.04, WHEEL_R_M, 0.03, 0, -WHEEL_R_M / 2, 0)); // and down
  spin.add(box(dash, 0.1, 0.1, 0.05, 0, 0, 0.01)); // the hub
  tilt.add(spin);
  g.add(tilt);
  return { group: g, spin, mats, dials: canvas.getContext('2d'), dialsTex };
}

/** The driver's view: `toggle` switches it, `update` puts the camera in the seat while you drive and it's on. */
export class Cockpit {
  private readonly g: CockpitDeps;
  private on = false;
  private car: RenderedCar | null = null;
  private body: THREE.Object3D | null = null; // what the interior rides on: the model's sprung body, or the simple car
  private interior: ReturnType<typeof buildInterior> | null = null;
  private readonly eye = new THREE.Vector3();
  private readonly hiddenGlass: THREE.Object3D[] = [];
  private readonly clipped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = []; // and their own materials
  // in the body's frame, what of the body is cut away: what is over the belt line, behind the windscreen's foot and ahead of
  // the rear window, all three, so the bonnet and the boot lid stay where they rise over the belt line (most cars' do)
  private readonly cabinPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
  private readonly clips = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]; // the same in the world, every frame
  private normalNear = 0;
  private shown = ''; // what the dials show, so they're drawn again only when it changes

  constructor(g: CockpitDeps) {
    this.g = g;
    g.renderer.localClippingEnabled = true; // only materials with clipping planes pay for it: your own car's, inside
  }

  /** Whether the camera is in the driver's seat now. */
  get inside() {
    return this.car !== null;
  }

  toggle = () => {
    if (this.g.game.inCar) this.on = !this.on;
  };

  /** After the camera rig: in the driver's seat, puts the camera there instead. */
  update() {
    const { game } = this.g;
    const car = this.on && game.inCar && game.pcar ? (game.pcar as RenderedCar) : null;
    const body = car && this.visibleBody(car);
    if (!car || !body) {
      this.leave();
      return;
    }
    if (car !== this.car || body !== this.body) {
      this.leave();
      this.enter(car, body);
    }
    if (this.car) this.place(car, body); // else no cabin to sit in: the view stays behind the car
  }

  // the part of the car that shows and rides its springs: the loaded model's, else the simple car
  private visibleBody(car: RenderedCar): THREE.Object3D | null {
    const model = car.mesh.getObjectByName(BODY_NODE);
    let shown = model?.parent ?? null; // the sprung group the model's body sits in (vehicle-visuals.ts)
    for (let o = shown; o && o !== car.mesh; o = o.parent) if (!o.visible) shown = null;
    return shown ?? car.body;
  }

  private enter(car: RenderedCar, body: THREE.Object3D) {
    const cabin = body === car.body ? profileCabin(this.g.profiles[car.type]) : modelCabin(body);
    if (!cabin) return;
    this.eye.copy(eyeIn(cabin));
    this.interior = buildInterior(cabin, this.eye, this.g.doc);
    this.shown = '';
    body.add(this.interior.group);
    body.traverse(o => {
      if (o instanceof THREE.Mesh && o.name.startsWith('glass') && o.visible) {
        o.visible = false;
        this.hiddenGlass.push(o);
      }
    });
    // the body, clipped through materials of its own, so other cars that share them keep their roofs
    const [belt, screen, rearWindow] = this.cabinPlanes; // each keeps what lies on its normal's side
    belt.set(new THREE.Vector3(0, -1, 0), cabin.belt + CLIP_OVER_BELT_M);
    screen.set(new THREE.Vector3(0, 0, -1), cabin.front);
    rearWindow.set(new THREE.Vector3(0, 0, 1), -cabin.rear);
    const painted = (o: THREE.Object3D) => o === car.body || o.name === BODY_NODE || o.name.startsWith(BODY_NODE + '_');
    body.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !painted(o)) return;
      this.clipped.push({ mesh: o, material: o.material });
      const own = (m: THREE.Material) =>
        Object.assign(m.clone(), { clippingPlanes: this.clips, clipIntersection: true }); // cut only where all three agree
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
    const { camera } = this.g;
    this.normalNear = camera.near;
    camera.near = NEAR_INSIDE_M;
    camera.updateProjectionMatrix();
    this.car = car;
    this.body = body;
  }

  private leave() {
    if (!this.car) return;
    for (const o of this.hiddenGlass) o.visible = true;
    this.hiddenGlass.length = 0;
    let resprayed = false; // inside, a respray goes onto the clipped clones: the materials put back still wear the old paint
    for (const { mesh, material } of this.clipped) {
      const was = [material].flat();
      [mesh.material].flat().forEach((m, i) => {
        resprayed ||= recoloured(m, was[i]);
        m.dispose();
      });
      mesh.material = material;
    }
    this.clipped.length = 0;
    if (resprayed) this.g.repaint(this.car);
    if (this.interior) {
      this.interior.group.removeFromParent();
      this.interior.group.traverse(o => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of this.interior.mats) m.dispose();
      this.interior.dialsTex.dispose();
      this.interior = null;
    }
    const { camera } = this.g;
    camera.near = this.normalNear;
    camera.updateProjectionMatrix();
    this.car = null;
    this.body = null;
  }

  // the speed and the turbo as the HUD rounds them, and the clock to the minute: a redraw only when one of them changes
  private drawDials(car: RenderedCar) {
    const { dials, dialsTex } = this.interior!;
    const kmh = Math.round(Math.abs(car.v) * 3.6);
    const turbo = car.boost > 0 ? 1 : Math.round(Math.max(0, car.thr) * TURBO_ON_THROTTLE * 20) / 20;
    const hour = Math.floor(this.g.hour * 60) / 60;
    const now = `${kmh} ${turbo} ${hour}`;
    if (!dials || now === this.shown) return;
    this.shown = now;
    drawDials(dials, kmh, turbo, hour);
    dialsTex.needsUpdate = true;
  }

  private place(car: RenderedCar, body: THREE.Object3D) {
    const { camera, view } = this.g;
    if (this.interior) {
      this.interior.spin.rotation.z = -car.st * WHEEL_LOCK_RAD; // st > 0 steers right: clockwise
      this.drawDials(car);
    }
    body.updateWorldMatrix(true, false);
    for (let i = 0; i < 3; i++) this.clips[i].copy(this.cabinPlanes[i]).applyMatrix4(body.matrixWorld);
    camera.position.copy(this.eye).applyMatrix4(body.matrixWorld);
    const pitch = Math.min(PITCH_MAX_RAD, Math.max(PITCH_MIN_RAD, PITCH_REST_RAD - view.camPitch - LOOK_DOWN_RAD));
    _e.set(pitch, -view.lookOff, 0);
    body.getWorldQuaternion(camera.quaternion).multiply(_q.setFromEuler(_e));
  }
}
