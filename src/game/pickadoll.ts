// The pickadoll lab (#17, ?lab=pickadoll): a proof of concept for trying weapons and hits side by side. You have every
// weapon from the start; Q changes the weapon, G what a hit does, and the mouse button, X or the Fire button fires, on
// foot and from a car. The keys and buttons are controls it adds to the game's input (./input.ts). The rules are in ./sim/shots.ts and the drawing in ./render/shot-fx.ts; this file reads the
// controls, shows the two HUD buttons and decides what each hit does to the world. A page module: it uses the DOM.
import { clamp, wrap } from '../world/math';
import type { Rnd } from '../world/random';
import { damageCar, LIMP_AT } from './health';
import { type Control, type Input, MouseButton } from './input';
import type { Npc } from './pedestrians';
import type { PlayerState } from './player';
import type { Ragdolls } from './ragdolls';
import type { RenderedCar } from './render/car-meshes';
import type { Person } from './render/models';
import { GEGGA, type ShotFx } from './render/shot-fx';
import type { PhysicsWorld } from './sim/physics-world';
import { physicsCast } from './sim/shot-physics';
import {
  aimAtMoving,
  aimShot,
  assistTarget,
  blastPush,
  flightPath,
  HIT_FLAVOURS,
  type HitFlavour,
  MUZZLE_M,
  newHit,
  SHOTS_MAX,
  type Shot,
  type ShotHit,
  type ShotWorld,
  sight,
  stepShot,
  WEAPONS,
} from './sim/shots';
import { dropSpike, newSpikeStep, type Spike, type SpikeWorld, stepSpikes } from './sim/spikes';
import type { GameState, ViewState } from './state';

// aiming: a crosshair fixed on screen, a little above your head, and shots go to what is under it, as in any shooter.
// The shot still leaves from you, not from the camera, so something close beside you can be in its way
const CROSSHAIR_NDC_Y = 0.3, // how far above the middle of the screen, as a share of half its height; #lab-crosshair's top is the same point
  SIGHT_M = 160; // the line of sight looks this far past you
// a weapon with a scope: aiming looks through it, from your eye, and the line of sight reaches further
const SCOPE_EYE_M = 1.6, // the eye, above your feet
  SCOPE_FWD_M = 0.3, // the camera sits this far ahead of your middle, clear of your own head
  SCOPE_CLEAR_M = 1.1, // and keeps this far back from a wall ahead: the camera draws nothing nearer than 0.8 m (stage.ts)
  SCOPE_SIGHT_M = 420,
  SCOPE_ON_K = 0.6; // the scope's edge and cross show, and you are hidden, from this far into the aim
const TARGET_UP_M = 1; // the soft lock aims this far above its target's feet
// hold to aim (the right mouse button, C, or the Aim button): the camera tucks in over your right shoulder and turns
// about it, so you can look nearly straight up and down, the crosshair sits in the middle, and you face where you aim
const AIM_BACK_M = 3, // the camera sits this far behind your shoulder
  AIM_SIDE_M = 0.6, // and this far to the right of your middle
  AIM_UP_M = 1.6, // at this height above your feet
  AIM_PITCH_MAX = 1.25, // rad up or down from level
  AIM_LOOK_K = 0.7, // the look is this much slower while aiming, for finer aim
  AIM_IN_PER_S = 14, // how fast the camera goes over to the shoulder and back (1/s)
  AIM_ZOOM = 0.9, // the field of view while aiming, times the usual
  AIM_ROOM_M = 0.25, // the camera keeps this far from walls
  AIM_MUZZLE_SIDE_M = 0.3, // while aiming, shots leave from your right side, nearer the camera's line
  LOOK_YAW_K = 0.006, // rad per pixel of look, as the game's own camera
  LOOK_PITCH_K = 0.004;
// the soft lock on a touch screen, where there is no fine aim: the shot goes to the nearest person or car near where you look
const ASSIST_CONE_RAD = 0.3,
  ASSIST_CONE_CAR_RAD = 0.6, // wider from a car: both thumbs are busy driving
  ASSIST_RANGE_M = 45;
const PULL_KEEP_S = 0.12; // a click this long before the weapon is ready still fires when it is
const INTRO_AFTER_S = 5.5; // the lab's own line comes this long after Start, once the start line is gone
// with ?lab=rapier, a shot knocks street furniture over: this hard for each point of the weapon's power (N·s), so the
// pickadoll's sends a 12 kg mailbox off at about 3 m/s
const KNOCK_NS_PER_POWER = 40,
  KNOCK_UP = 0.3; // and this much of it upwards, so the prop tips rather than slides
// pang: a hit throws people and shoves cars
const PANG_THROW_MS = 5, // a person leaves at this, plus PANG_THROW_PER_POWER_MS for each point of the weapon's power
  PANG_THROW_PER_POWER_MS = 2.5,
  PANG_CAR_SHOVE_M = 0.14, // a parked car slides this far per point of power
  PANG_CAR_DMG = 2; // and takes this much damage per point of power
const SCUFF = '#2b2b2b'; // the mark a pang hit leaves
const STARE_S = 2.5; // someone hit by gegga stops and looks at you this long
const DANCE_S = 6,
  DANCE_SPIN_RADS = 7,
  DANCE_HOP_M = 0.22,
  DANCE_HOP_HZ = 3.2,
  DANCE_COLOUR = '#ff5fd2';
// throwing: hold to see the arc, let go to throw
const ARC_STEP_S = 1 / 20, // the arc has a dot this often along the flight
  ARC_POINTS = 64,
  ARC_RING_M = 0.7; // the ring where it lands, for a throwable with no blast
// the stance: the right arm comes up along the aim while you aim, hold the trigger or have just fired
const RAISED_S = 1.2, // the arm stays up this long after a shot
  WIND_UP_RAD = -0.9; // the arm goes back this far while you hold a throw
// the placeholder gun in the hand, by weapon: its length and thickness (m). No models yet
const GUN_M: Record<(typeof WEAPONS)[number]['id'], readonly [number, number]> = {
  artpuffra: [0.5, 0.04],
  pickadoll: [0.3, 0.08],
  pepprapuffra: [0.4, 0.1],
  hagelbossa: [0.65, 0.09],
  potatiskanon: [0.85, 0.2],
  minigun: [0.75, 0.17],
  guldartpuffra: [0.5, 0.05],
  puffra: [0.28, 0.07],
  luftgevar: [0.95, 0.05],
  algstudsare: [1.1, 0.07],
  granat: [0.14, 0.14],
  fotanglar: [0.12, 0.16],
};
const HIT_MARK_S = 0.1; // the crosshair's ticks stay this long after a hit on a person or a car, then fade (index.html)
const BLAST_DROPS = 7; // a blast of gegga leaves this many more splats around the hit
// fotanglar: they lie where they land for a while (./sim/spikes.ts). Someone who steps on one hops on and walks
// slowly; a car that drives over one has a puncture and limps; you are hurt, unless you jump over
const PUNCTURE_DMG = LIMP_AT + 30, // a puncture is this much damage at least: well past where a car starts to limp
  LIMP_S = 6, // someone who stepped on one limps this long,
  LIMP_SPEED = 0.35, // at this share of their speed,
  LIMP_HOP_M = 0.14, // hopping this high,
  LIMP_HOP_HZ = 2.4,
  SPIKE_HURT_HP = 6, // what stepping on one costs you,
  SPIKE_HURT_EVERY_S = 1; // at most this often

type Point = { x: number; z: number };

export interface PickadollDeps {
  input: Pick<Input, 'addControl'>;
  canvas: Pick<HTMLCanvasElement, 'focus' | 'after'>;
  $(id: string): HTMLElement;
  coarse: boolean;
  game: Pick<GameState, 'started' | 'inCar' | 'pcar' | 'titleCardT'>;
  view: Pick<ViewState, 'camYaw' | 'camPitch'>;
  calmMotion: { readonly matches: boolean }; // prefers-reduced-motion: the camera changes place at once
  player: PlayerState & { mesh: Person };
  world: Pick<ShotWorld, 'groundAt' | 'collide'>;
  crowd: { readonly npcs: Npc[]; stare(o: Point, r: number, s: number): boolean };
  cars: readonly RenderedCar[];
  ragdolls: Pick<Ragdolls, 'push'>;
  placeCar(c: RenderedCar): void;
  fx: ShotFx;
  rnd: Rnd; // its own stream: the spread and the colours
  readonly menuOpen: boolean;
  readonly inside: boolean; // in a safehouse
  toast(msg: string, secs?: number): void;
  hurtPlayer(n: number): void;
  /** ?lab=rapier's world once it has loaded, whose ray casts then find what a shot hits; null without it */
  readonly physics: Pick<PhysicsWorld, 'castSegment' | 'knockProp'> | null;
  readonly god: boolean; // god mode: the car you drive takes no damage, as in a crash
}

/** The lab's weapons: built once, stepped every frame. */
export class Pickadoll {
  private readonly g: PickadollDeps;
  private readonly shots: (Shot & { seed: number; flavour: HitFlavour })[] = [];
  private readonly dancers: { npc: Npc; leftS: number }[] = [];
  private readonly spikes: Spike[] = [];
  private readonly spikeWorld: { -readonly [K in keyof SpikeWorld]: SpikeWorld[K] };
  private readonly spikeStep = newSpikeStep();
  private readonly push = { dx: 0, dz: -1 };
  private startedFrames = 0; // frames since Start, up to 2
  private readonly limping: { npc: Npc; leftS: number; speed: number }[] = [];
  private spikeHurtS = 0; // s until a fotangel can hurt you again
  private readonly arc: number[] = [];
  private readonly arcEnd = newHit();
  private isWindingUp = false; // a throw is held back, its arc showing
  private raisedS = 0; // s the arm stays up
  private markS = 0; // s the crosshair's hit ticks stay on
  private markedHits = 0; // hits on a person or a car, for the test hook
  private readonly hit = newHit();
  private readonly aimHit = newHit();
  private readonly line = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1 };
  private readonly aim = { yaw: 0, pitch: 0 };
  private readonly probe = { x: 0, z: 0 };
  private readonly muzzle = { x: 0, y: 0, z: 0 }; // where a shot leaves from this frame
  private carVx = 0; // the speed of the car you fire from, which its shots keep (m/s); 0 on foot
  private carVz = 0;
  private crossY = -1; // where the crosshair was last put
  private readonly flown: Shot = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ageS: 0,
    weapon: 0,
    bounced: 0,
    lifeS: 0,
    lying: false,
  }; // the throw's arc is this one, flown ahead
  private readonly crosshair: HTMLElement;
  private readonly scope: HTMLElement; // the scope's dark edge and cross, over the view
  private isScoped = false; // looking through the scope: its edge shows and you are hidden
  private readonly world: ShotWorld & { cars: RenderedCar[] };
  private readonly weaponButton: HTMLButtonElement;
  private readonly flavourButton: HTMLButtonElement;
  private readonly aimButton: HTMLButtonElement;
  private weapon = 1; // the pickadoll
  private flavour = 0;
  private readonly trigger: Control; // held while the trigger is down
  private readonly aimHold: Control; // held while the right mouse button is
  private pulledS = -1; // s since a pull that hasn't fired yet, -1 for none: a weapon that isn't automatic fires once per pull
  private coolS = 0;
  private clockS = 0;
  private introS = INTRO_AFTER_S;
  private aimKept = false; // aiming was switched on with C or the Aim button
  private aimK = 0; // 0 the game's camera, 1 over the shoulder
  private aimPitch = 0; // rad above level, while aiming
  private ready = false;
  private castThrough: PickadollDeps['physics'] = null; // the world this.world.cast asks
  private firedFrom: RenderedCar | null = null; // the car you sit in this frame, which your shots pass through
  /** shots fired and hits landed so far, for the test hook */
  fired = 0;
  hits = 0;

  constructor(g: PickadollDeps) {
    this.g = g;
    this.world = { groundAt: g.world.groundAt, collide: g.world.collide, people: g.crowd.npcs, cars: [] };
    this.spikeWorld = { cars: g.cars, people: g.crowd.npcs, walker: null };
    // The controls, through the game's input: the left mouse button or X fires, the right one aims while held, C keeps
    // aiming on, Q changes the weapon and G the hit. A press of the trigger is kept a moment (pulledS)
    this.trigger = g.input.addControl({
      codes: ['KeyX'],
      mouseButton: MouseButton.LEFT,
      press: () => {
        this.pulledS = 0;
      },
    });
    this.aimHold = g.input.addControl({ mouseButton: MouseButton.RIGHT });
    g.input.addControl({ codes: ['KeyC'], press: () => this.keepAim(!this.aimKept) });
    g.input.addControl({ codes: ['KeyQ'], press: () => this.nextWeapon() });
    g.input.addControl({ codes: ['KeyG'], press: () => this.nextFlavour() });
    const fire = document.createElement('button');
    fire.type = 'button';
    fire.id = 'p-fire';
    fire.textContent = 'Fire';
    fire.setAttribute('aria-keyshortcuts', 'X');
    this.trigger.hold(fire);
    const aim = document.createElement('button');
    aim.type = 'button';
    aim.id = 'p-aim';
    aim.textContent = 'Aim';
    aim.setAttribute('aria-pressed', 'false');
    aim.setAttribute('aria-keyshortcuts', 'C');
    aim.addEventListener('click', () => this.keepAim(!this.aimKept));
    this.aimButton = aim;
    g.$('pad').prepend(fire, aim);
    g.$('pad').classList.add('lab'); // four buttons: index.html stacks them on a narrow phone
    this.crosshair = document.createElement('div');
    this.crosshair.id = 'lab-crosshair';
    this.crosshair.hidden = true;
    this.scope = document.createElement('div');
    this.scope.id = 'lab-scope';
    g.canvas.after(this.scope); // over the view and under the HUD, which stays readable
    g.$('stage').append(this.crosshair);
    if (g.player.mesh.arms) g.fx.giveGun(g.player.mesh.arms[1]);
    this.weaponButton = this.hudButton('Q', () => this.nextWeapon());
    this.flavourButton = this.hudButton('G', () => this.nextFlavour());
    this.drawHud();
  }

  private hudButton(key: string, press: () => void) {
    const { $, canvas } = this.g,
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'plate lab-weapon';
    button.setAttribute('aria-keyshortcuts', key);
    button.addEventListener('click', () => {
      press();
      canvas.focus();
    });
    $('tr').append(button);
    return button;
  }

  private drawHud() {
    const label = (button: HTMLButtonElement, key: string, name: string) => {
      const kbd = document.createElement('kbd');
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = key;
      button.replaceChildren(kbd, name);
    };
    label(this.weaponButton, 'Q', WEAPONS[this.weapon].name);
    this.weaponButton.setAttribute('aria-label', 'Weapon: ' + WEAPONS[this.weapon].name);
    this.flavourButton.setAttribute('aria-label', 'Hit: ' + HIT_FLAVOURS[this.flavour].name);
    const [lengthM, thickM] = GUN_M[WEAPONS[this.weapon].id];
    this.g.fx.sizeGun(lengthM, thickM);
    label(this.flavourButton, 'G', HIT_FLAVOURS[this.flavour].name);
  }

  // C and the Aim button switch aiming on until they switch it off
  private keepAim(on: boolean) {
    this.aimKept = on;
    this.aimButton.setAttribute('aria-pressed', String(on));
  }

  private nextWeapon() {
    this.weapon = (this.weapon + 1) % WEAPONS.length;
    this.coolS = Math.min(this.coolS, WEAPONS[this.weapon].coolS); // the wait left, at most the new weapon's own
    this.drawHud();
  }

  private nextFlavour() {
    this.flavour = (this.flavour + 1) % HIT_FLAVOURS.length;
    this.drawHud();
  }

  /** What the test hook shows. */
  get state() {
    return {
      fired: this.fired,
      hits: this.hits,
      markedHits: this.markedHits,
      splats: this.g.fx.splatted,
      weapon: WEAPONS[this.weapon].id,
      flavour: HIT_FLAVOURS[this.flavour].id,
      aiming: this.aimK > 0.5,
      scoped: this.isScoped,
      spikes: this.spikes.length,
      limping: this.limping.length,
      throughPhysics: !!this.world.cast, // ?lab=rapier's ray casts find the hits
    };
  }

  /** Every frame, after the crowd has moved: fires, moves the shots, lands the hits and draws them. */
  update(dt: number) {
    const { game, view, player, fx, coarse } = this.g,
      weapon = WEAPONS[this.weapon],
      car = game.inCar ? (game.pcar as RenderedCar | null) : null,
      from: Point = car ?? player;
    this.clockS += dt;
    // after the start line has had its time
    if (game.started && this.introS > 0) {
      this.introS -= dt;
      if (this.introS <= 0)
        this.g.toast(
          coarse
            ? 'Lab: pickadoll. Fire fires, Aim aims; tap the weapon and the hit at the top to change them.'
            : 'Lab: pickadoll. Click or X fires, right button or C aims, Q changes the weapon, G the hit.',
          6,
        );
    }
    this.coolS -= dt;
    // every car but the one you sit in can be hit
    const cars = this.world.cars;
    cars.length = 0;
    for (const c of this.g.cars) if (c !== car) cars.push(c);
    this.firedFrom = car;
    const { physics } = this.g;
    if (physics !== this.castThrough) {
      this.castThrough = physics;
      this.world.cast = physics ? physicsCast(physics, this.world, () => this.firedFrom) : undefined;
    }

    // The line of sight is read from the camera as the last frame left it. On the first frame after Start that is
    // still the intro's, circling far off, so the lab waits one frame
    this.startedFrames = game.started ? Math.min(2, this.startedFrames + 1) : 0;
    const ready = this.startedFrames > 1 && !this.g.menuOpen && !this.g.inside && game.titleCardT <= 0;
    this.ready = ready;
    const aiming = this.aiming;
    // going over to the shoulder: the crosshair moves to the middle of the screen with the camera
    if (aiming && this.aimK === 0) this.aimPitch = clamp(Math.asin(this.line.dy), -AIM_PITCH_MAX, AIM_PITCH_MAX); // keep looking where you looked
    this.aimK = this.g.calmMotion.matches
      ? aiming
        ? 1
        : 0
      : clamp(this.aimK + (aiming ? 1 : -1) * AIM_IN_PER_S * dt, 0, 1);
    const crossY = CROSSHAIR_NDC_Y * (1 - this.aimK);
    if (crossY !== this.crossY) {
      this.crossY = crossY;
      this.crosshair.style.top = 50 - crossY * 50 + '%';
    }
    if (aiming) {
      player.h = view.camYaw; // you face where you aim, and walk sideways
      player.mesh.rotation.y = -player.h;
    }
    // what is under the crosshair: the line of sight from the camera, looked along from where it passes you
    // The muzzle: at your right side while you aim (you face the way the camera looks then), and up with you in a
    // jump. The aim is worked out from it, not from your middle, or a shot would pass beside what is under the crosshair
    const side = this.aimK * AIM_MUZZLE_SIDE_M,
      muzzle = this.muzzle;
    muzzle.x = from.x + Math.cos(view.camYaw) * side;
    muzzle.z = from.z + Math.sin(view.camYaw) * side;
    muzzle.y = this.g.world.groundAt(from.x, from.z) + (car ? 0 : Math.max(0, player.y)) + MUZZLE_M;
    const line = fx.sightLine(crossY, this.line),
      pastM = Math.hypot(muzzle.x - line.x, muzzle.y - line.y, muzzle.z - line.z),
      seen =
        ready &&
        sight(
          line.x,
          line.y,
          line.z,
          line.dx,
          line.dy,
          line.dz,
          pastM,
          pastM + (this.isScoped ? SCOPE_SIGHT_M : SIGHT_M),
          this.world,
          this.aimHit,
        );
    let tx = this.aimHit.x,
      ty = this.aimHit.y,
      tz = this.aimHit.z,
      onTarget = seen && (this.aimHit.kind === 'person' || this.aimHit.kind === 'car');
    // not through a scope: its view is far narrower than the cone, and the shot would go to someone you can't see
    if (coarse && !onTarget && !this.isScoped) {
      const t = assistTarget(
        from.x,
        from.z,
        view.camYaw,
        this.world,
        car ? ASSIST_CONE_CAR_RAD : ASSIST_CONE_RAD,
        ASSIST_RANGE_M,
      );
      if (t) {
        tx = t.x;
        tz = t.z;
        ty = this.g.world.groundAt(tx, tz) + TARGET_UP_M;
        onTarget = true;
      }
    }
    // a shot from a moving car keeps the car's speed, and the aim allows for it, so it still lands under the crosshair
    this.carVx = car ? Math.sin(car.vh) * car.v : 0;
    this.carVz = car ? -Math.cos(car.vh) * car.v : 0;
    const { yaw, pitch } = aimAtMoving(
      weapon.speedMs,
      muzzle.x,
      muzzle.y,
      muzzle.z,
      tx,
      ty,
      tz,
      this.carVx,
      this.carVz,
      this.aim,
    );
    this.crosshair.hidden = !ready;
    this.crosshair.classList.toggle('on', onTarget);
    this.markS -= dt;
    this.crosshair.classList.toggle('hit', this.markS > 0);
    // a click a moment before the weapon is ready still fires; an older one is dropped, so clicks never queue up
    if (this.pulledS >= 0) this.pulledS += dt;
    if (!ready || this.pulledS > PULL_KEEP_S + dt) this.pulledS = -1;
    // a throwable is held back while the trigger is down, with its arc showing, and thrown when you let go
    let thrown = false;
    if (weapon.thrown && ready && this.trigger.held && this.coolS <= 0) this.isWindingUp = true;
    else if (this.isWindingUp) {
      thrown = weapon.thrown && ready && !this.trigger.held;
      this.isWindingUp = false;
    }
    if (this.isWindingUp) {
      const flown = Object.assign(this.flown, muzzle, aimShot(weapon, yaw, pitch));
      flown.vx += this.carVx;
      flown.vz += this.carVz;
      flown.ageS = flown.lifeS = flown.bounced = 0;
      flown.lying = false;
      flown.weapon = this.weapon;
      fx.drawArc(
        this.arc,
        flightPath(flown, this.world, ARC_STEP_S, ARC_POINTS, this.arc, this.arcEnd),
        weapon.blastM || ARC_RING_M,
      );
    } else fx.drawArc(this.arc, 0, 0);
    if (ready && this.coolS <= 0 && (weapon.thrown ? thrown : weapon.auto ? this.trigger.held : this.pulledS >= 0)) {
      this.pulledS = -1;
      this.coolS = Math.max(this.coolS, -dt) + weapon.coolS; // what this frame overshot comes off the next wait
      this.raisedS = RAISED_S;
      this.fire(car, yaw, pitch);
    }
    // the stance, drawn over the walk's arm swing: the right arm along the aim, or back for a throw
    this.raisedS -= dt;
    const arms = player.mesh.arms;
    if (arms && !car && ready) {
      if (this.isWindingUp) arms[1].rotation.x = WIND_UP_RAD;
      else if (aiming || this.raisedS > 0 || (this.trigger.held && !weapon.thrown))
        arms[1].rotation.x = Math.PI / 2 + pitch;
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i],
        { x, y, z } = s, // where it was when the frame began
        hit = stepShot(s, dt, this.world, this.hit);
      if (!hit) continue;
      if (hit !== 'gone') {
        this.land(s, hit);
        if (hit.bounced) continue; // it flies on
        const tracerM = WEAPONS[s.weapon].tracerM;
        if (tracerM) fx.endStreak(x, y, z, hit.x, hit.y, hit.z, tracerM);
      }
      this.shots[i] = this.shots[this.shots.length - 1];
      this.shots.pop();
    }
    fx.drawShots(this.shots, this.colourOf, this.radiusOf, this.tracerOf, dt);
    this.dance(dt);
    this.stepSpikes(dt);
  }

  private readonly radiusOf = (s: Shot) => WEAPONS[s.weapon].shotM;
  private readonly tracerOf = (s: Shot) => WEAPONS[s.weapon].tracerM;

  // on foot only: from a car you aim with the car's own camera
  private get aiming() {
    return this.ready && !this.g.game.inCar && (this.aimHold.held || this.aimKept);
  }

  /** The look while aiming: true when it took the mouse or the drag, so the game's camera doesn't. */
  aimLook(dx: number, dy: number): boolean {
    if (!this.aiming) return false;
    const { view, fx } = this.g,
      scope = WEAPONS[this.weapon].scope,
      // through a scope the look slows with the view, so the picture moves as far for the same move of the hand
      k = AIM_LOOK_K * (scope ? fx.magnified(scope) : 1);
    view.camYaw = wrap(view.camYaw + dx * LOOK_YAW_K * k);
    this.aimPitch = clamp(this.aimPitch - dy * LOOK_PITCH_K * k, -AIM_PITCH_MAX, AIM_PITCH_MAX);
    return true;
  }

  /** After the game's camera is placed: moves it over your shoulder while you aim, and back when you stop. */
  aimCamera() {
    const { player, view, world, fx, game } = this.g,
      scope = WEAPONS[this.weapon].scope,
      isScoped = scope > 0 && this.aimK > SCOPE_ON_K;
    if (isScoped !== this.isScoped) {
      this.isScoped = isScoped;
      this.scope.classList.toggle('on', isScoped);
      // through the scope you see from your own eye, so you are not in the picture
      player.mesh.visible = !isScoped && !game.inCar && !this.g.inside;
    }
    if (this.aimK <= 0) {
      fx.aimCamera(0, 0, 0, 0, 0, 0, 0, 1);
      return;
    }
    const yaw = view.camYaw,
      cp = Math.cos(this.aimPitch),
      fx_ = Math.sin(yaw) * cp,
      fy = Math.sin(this.aimPitch),
      fz = -Math.cos(yaw) * cp,
      ground = world.groundAt(player.x, player.z);
    if (scope) {
      // forward of your middle, but back from a wall you stand against: nearer than the camera draws, the wall would
      // be cut away and you would look into the house
      let fwd = SCOPE_FWD_M;
      for (let d = 0; d < SCOPE_CLEAR_M; d += 0.15)
        if (!this.clear(player.x + Math.sin(yaw) * (SCOPE_FWD_M + d), player.z - Math.cos(yaw) * (SCOPE_FWD_M + d))) {
          fwd = SCOPE_FWD_M + d - SCOPE_CLEAR_M;
          break;
        }
      const ex = player.x + Math.sin(yaw) * fwd,
        ey = ground + player.y + SCOPE_EYE_M,
        ez = player.z - Math.cos(yaw) * fwd;
      fx.aimCamera(this.aimK, ex, ey, ez, ex + fx_, ey + fy, ez + fz, fx.magnified(scope));
      return;
    }
    // the shoulder, pulled in when a wall is beside you
    let side = AIM_SIDE_M;
    for (; side > 0; side -= 0.2)
      if (this.clear(player.x + Math.cos(yaw) * side, player.z + Math.sin(yaw) * side)) break;
    side = Math.max(0, side);
    const sx = player.x + Math.cos(yaw) * side,
      sy = ground + player.y + AIM_UP_M,
      sz = player.z + Math.sin(yaw) * side;
    // back from the shoulder as far as there is room: not into a wall, not under the ground
    let back = AIM_BACK_M;
    for (; back > 0.3; back -= 0.25) {
      const x = sx - fx_ * back,
        z = sz - fz * back;
      if (this.clear(x, z) && sy - fy * back > world.groundAt(x, z) + AIM_ROOM_M) break;
    }
    fx.aimCamera(this.aimK, sx - fx_ * back, sy - fy * back, sz - fz * back, sx + fx_, sy + fy, sz + fz, AIM_ZOOM);
  }

  // no wall within AIM_ROOM_M of (x, z)
  private clear(x: number, z: number) {
    this.probe.x = x;
    this.probe.z = z;
    return !this.g.world.collide(this.probe, AIM_ROOM_M);
  }

  private readonly colourOf = (s: { seed: number; flavour: HitFlavour }) =>
    s.flavour === 'gegga' ? GEGGA[Math.floor(s.seed * GEGGA.length)] : s.flavour === 'dans' ? DANCE_COLOUR : SCUFF;

  private fire(car: RenderedCar | null, yaw: number, pitch: number) {
    const { rnd, player } = this.g,
      weapon = WEAPONS[this.weapon],
      flavour = HIT_FLAVOURS[this.flavour].id;
    if (!car) player.h = yaw; // you turn to face where you fire
    // a shot from a moving car keeps the car's speed
    const cvx = this.carVx,
      cvz = this.carVz;
    for (let i = 0; i < weapon.pellets && this.shots.length < SHOTS_MAX; i++) {
      const v = aimShot(weapon, yaw, pitch, rnd() * 2 - 1, rnd() * 2 - 1);
      this.shots.push({
        ...this.muzzle,
        vx: v.vx + cvx,
        vy: v.vy,
        vz: v.vz + cvz,
        ageS: 0,
        bounced: 0,
        lifeS: 0,
        lying: false,
        weapon: this.weapon,
        seed: rnd(),
        flavour,
      });
    }
    this.fired++;
  }

  // what a hit does, by its flavour; a weapon with a blast then reaches everyone around it
  private land(s: Shot & { seed: number; flavour: HitFlavour }, hit: ShotHit) {
    const { fx, crowd, rnd } = this.g,
      weapon = WEAPONS[s.weapon],
      colour = this.colourOf(s);
    if (hit.bounced && weapon.fuseS) return; // a grenade only bounces and lies until its fuse runs out
    this.hits++;
    if (weapon.zone === 'spikes') {
      dropSpike(this.spikes, hit, this.g.world.groundAt, s.seed);
      fx.drawSpikes(this.spikes);
      return;
    }
    const person = hit.kind === 'person' ? crowd.npcs[hit.target] : null,
      car = hit.kind === 'car' ? this.world.cars[hit.target] : null;
    if (person) this.hitPerson(person, s.flavour, hit.dx, hit.dz, hit.y, weapon.power, weapon.splatM, colour, s.seed);
    else if (car) this.hitCar(car, s.flavour, hit, weapon.power, weapon.splatM, colour, s.seed);
    else if (hit.kind === 'prop') {
      // knocked over, with no splat: a mark left in the air where it stood would hang there
      const k = weapon.power * KNOCK_NS_PER_POWER;
      this.g.physics?.knockProp(hit.target, hit.x, hit.y, hit.z, hit.dx * k, k * KNOCK_UP, hit.dz * k);
    } else fx.splat(hit, s.flavour === 'gegga' ? weapon.splatM : weapon.splatM * 0.45, colour, s.seed);
    if (person || car) this.mark();
    if (!weapon.blastM) return;
    const { push } = this;
    for (const n of crowd.npcs) {
      if (n === person || n.down || !blastPush(hit.x, hit.z, weapon.blastM, n.x, n.z, push)) continue;
      this.hitPerson(n, s.flavour, push.dx, push.dz, hit.y + 1, weapon.power * 0.6, weapon.splatM, colour, rnd());
      this.mark();
    }
    if (s.flavour === 'pang')
      for (const c of this.world.cars)
        if (c !== car && blastPush(hit.x, hit.z, weapon.blastM, c.x, c.z, push))
          this.shoveCar(c, push.dx, push.dz, weapon.power * 0.6);
    if (s.flavour === 'gegga')
      for (let i = 0; i < BLAST_DROPS; i++) {
        const a = rnd() * Math.PI * 2,
          reach = weapon.blastM * (0.3 + rnd() * 0.7),
          x = hit.x + Math.cos(a) * reach,
          z = hit.z + Math.sin(a) * reach;
        fx.splat(
          { kind: 'ground', x, y: this.g.world.groundAt(x, z), z, nx: 0, ny: 1, nz: 0 },
          weapon.splatM * (0.2 + rnd() * 0.3),
          colour,
          rnd(),
        );
      }
  }

  // tells you a shot landed on someone or something that counts, however far off it was
  private mark() {
    this.markedHits++;
    this.markS = HIT_MARK_S;
  }

  // (dx, dz): the way the hit pushes them, a unit vector along the ground
  private hitPerson(
    n: Npc,
    flavour: HitFlavour,
    dx: number,
    dz: number,
    y: number,
    power: number,
    splatM: number,
    colour: string,
    turn: number,
  ) {
    const { fx, crowd, ragdolls } = this.g;
    if (flavour === 'gegga') {
      fx.splatOnPerson(n.mesh, dx, dz, y, splatM, colour, turn);
      crowd.stare(n, 0.1, STARE_S);
    } else if (flavour === 'pang') {
      // too many down already: they are only knocked a step back
      if (!ragdolls.push(n, dx, dz, PANG_THROW_MS + power * PANG_THROW_PER_POWER_MS)) {
        n.x += dx * 0.5;
        n.z += dz * 0.5;
      }
    } else if (!this.dancers.some(d => d.npc === n)) {
      crowd.stare(n, 0.1, DANCE_S); // stops them where they are
      this.dancers.push({ npc: n, leftS: DANCE_S });
    }
  }

  private hitCar(
    c: RenderedCar,
    flavour: HitFlavour,
    hit: ShotHit,
    power: number,
    splatM: number,
    colour: string,
    turn: number,
  ) {
    if (flavour === 'pang') this.shoveCar(c, hit.dx, hit.dz, power);
    this.g.fx.splatOn(c.mesh, hit, flavour === 'gegga' ? splatM : splatM * 0.45, colour, turn);
  }

  // the cars a crash spares (crashes.ts): Plåt-Pelle's for sale, which also stand still, and the one you drive in god mode
  private spared(c: RenderedCar) {
    return c.saleKr > 0 || (this.g.god && c === this.g.game.pcar);
  }

  private shoveCar(c: RenderedCar, dx: number, dz: number, power: number) {
    if (this.spared(c)) return;
    damageCar(c, power * PANG_CAR_DMG);
    if (c.mode !== 'parked') return; // a car that drives is where its driving puts it
    c.x += dx * power * PANG_CAR_SHOVE_M;
    c.z += dz * power * PANG_CAR_SHOVE_M;
    this.g.placeCar(c);
  }

  // what the fotanglar on the ground do to who comes by
  private stepSpikes(dt: number) {
    const { game, player, crowd, fx, cars } = this.g,
      { spikes, limping, spikeWorld } = this;
    this.spikeHurtS -= dt;
    // you, on foot and on the ground: a jump clears them
    spikeWorld.walker = !game.inCar && player.y <= 0 ? player : null;
    const step = stepSpikes(spikes, dt, spikeWorld, this.spikeStep);
    // a car that rolls over one has a puncture, the police's and your own too
    for (const i of step.cars) if (!this.spared(cars[i])) damageCar(cars[i], PUNCTURE_DMG - cars[i].dmg);
    for (const i of step.people) {
      const n = crowd.npcs[i];
      if (limping.some(l => l.npc === n)) continue;
      limping.push({ npc: n, leftS: LIMP_S, speed: n.speed });
      n.speed *= LIMP_SPEED;
    }
    if (step.walker && this.spikeHurtS <= 0) {
      this.spikeHurtS = SPIKE_HURT_EVERY_S;
      this.g.hurtPlayer(SPIKE_HURT_HP);
      this.g.toast('”Aj! Fotanglar!”', 2);
    }
    if (step.changed) fx.drawSpikes(spikes);
    // limping is drawn over the crowd's own pose: a hop on one foot, and their speed back when it wears off
    for (let i = limping.length - 1; i >= 0; i--) {
      const l = limping[i];
      l.leftS -= dt;
      if (l.leftS <= 0 || !crowd.npcs.includes(l.npc)) {
        l.npc.speed = l.speed;
        limping.splice(i, 1);
        continue;
      }
      if (l.npc.down) continue;
      l.npc.mesh.position.y += Math.abs(Math.sin(this.clockS * Math.PI * LIMP_HOP_HZ)) * LIMP_HOP_M;
      l.npc.mesh.legs[0].rotation.x = -1.1; // one foot held up
    }
  }

  // dancing is drawn over the crowd's own pose: they spin and hop where they stand
  private dance(dt: number) {
    for (let i = this.dancers.length - 1; i >= 0; i--) {
      const d = this.dancers[i];
      d.leftS -= dt;
      if (d.leftS <= 0 || d.npc.down || !this.g.crowd.npcs.includes(d.npc)) {
        this.dancers.splice(i, 1);
        continue;
      }
      const mesh = d.npc.mesh;
      mesh.rotation.y = this.clockS * DANCE_SPIN_RADS;
      mesh.position.y += Math.abs(Math.sin(this.clockS * Math.PI * DANCE_HOP_HZ)) * DANCE_HOP_M;
    }
  }
}
