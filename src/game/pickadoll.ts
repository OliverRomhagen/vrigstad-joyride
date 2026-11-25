// The pickadoll lab (#17, ?lab=pickadoll): a proof of concept for trying weapons and hits side by side. You have every
// weapon from the start; Q changes the weapon, G what a hit does, and the mouse button, X or the Fire button fires, on
// foot and from a car. The rules are in ./sim/shots.ts and the drawing in ./render/shot-fx.ts; this file reads the
// controls, shows the two HUD buttons and decides what each hit does to the world. A page module: it uses the DOM.
import { clamp, wrap } from '../world/math';
import type { Rnd } from '../world/random';
import type { Npc } from './pedestrians';
import type { PlayerState } from './player';
import type { Ragdolls } from './ragdolls';
import type { RenderedCar } from './render/car-meshes';
import type { Person } from './render/models';
import { GEGGA, type ShotFx } from './render/shot-fx';
import {
  aimAt,
  aimShot,
  assistTarget,
  flightPath,
  HIT_FLAVOURS,
  type HitFlavour,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotHit,
  type ShotWorld,
  sight,
  stepShot,
  WEAPONS,
} from './sim/shots';
import type { GameState, ViewState } from './state';

// aiming: a crosshair fixed on screen, a little above your head, and shots go to what is under it, as in any shooter.
// The shot still leaves from you, not from the camera, so something close beside you can be in its way
const CROSSHAIR_NDC_Y = 0.3, // how far above the middle of the screen, as a share of half its height; #lab-crosshair's top is the same point
  SIGHT_M = 160; // the line of sight looks this far past you
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
const SHOTS_MAX = 256; // in the air at once
const PULL_KEEP_S = 0.12; // a click this long before the weapon is ready still fires when it is
const INTRO_AFTER_S = 5.5; // the lab's own line comes this long after Start, once the start line is gone
// pang: a hit throws people and shoves cars
const PANG_THROW_MS = 5, // a person leaves at this, plus PANG_THROW_PER_POWER_MS for each point of the weapon's power
  PANG_THROW_PER_POWER_MS = 2.5,
  PANG_CAR_SHOVE_M = 0.14, // a parked car slides this far per point of power
  PANG_CAR_DMG = 2, // and takes this much damage per point of power
  CAR_DMG_MAX = 100;
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
const GUN_M: Record<string, readonly [number, number]> = {
  artpuffra: [0.5, 0.04],
  pickadoll: [0.3, 0.08],
  pepprapuffra: [0.4, 0.1],
  hagelbossa: [0.65, 0.09],
  potatiskanon: [0.85, 0.2],
  minigun: [0.75, 0.17],
  guldartpuffra: [0.5, 0.05],
  granat: [0.14, 0.14],
  fotanglar: [0.12, 0.16],
};
const HIT_MARK_S = 0.1; // the crosshair's ticks stay this long after a hit on a person or a car, then fade (index.html)
const BLAST_DROPS = 7; // a blast of gegga leaves this many more splats around the hit
// fotanglar: they lie where they land for a while. Someone who steps on one hops on and walks slowly; a car that
// drives over one has a puncture and limps; you are hurt, unless you jump over
const SPIKES_MAX = 140, // on the ground at once; the oldest go first
  SPIKE_S = 60, // one lies this long
  SPIKE_STEP_M = 0.55, // a foot within this of one steps on it
  SPIKE_WHEEL_M = 1.3, // a car's middle within this of one drives over it
  SPIKE_CAR_MIN_MS = 1, // a car standing on one is fine until it rolls
  PUNCTURE_DMG = 80, // a puncture is this much damage at least: the car limps (health.ts, LIMP_AT)
  LIMP_S = 6, // someone who stepped on one limps this long,
  LIMP_SPEED = 0.35, // at this share of their speed,
  LIMP_HOP_M = 0.14, // hopping this high,
  LIMP_HOP_HZ = 2.4,
  SPIKE_HURT_HP = 6, // what stepping on one costs you,
  SPIKE_HURT_EVERY_S = 1, // at most this often
  SPIKE_OFF_WALL_M = 0.3; // one that hits a wall or a car drops this far out from it

type Point = { x: number; z: number };

export interface PickadollDeps {
  win: Pick<Window, 'addEventListener'>;
  canvas: HTMLCanvasElement;
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
  mouseLocked(): boolean;
  toast(msg: string, secs?: number): void;
  hurtPlayer(n: number): void;
}

/** The lab's weapons: built once, stepped every frame. */
export class Pickadoll {
  private readonly g: PickadollDeps;
  private readonly shots: (Shot & { seed: number; flavour: HitFlavour })[] = [];
  private readonly dancers: { npc: Npc; leftS: number }[] = [];
  private readonly spikes: { x: number; y: number; z: number; turn: number; leftS: number }[] = [];
  private readonly limping: { npc: Npc; leftS: number; speed: number }[] = [];
  private spikeHurtS = 0; // s until a fotangel can hurt you again
  private readonly arc: number[] = [];
  private readonly arcEnd = newHit();
  private wound = false; // a throw is held back, its arc showing
  private raisedS = 0; // s the arm stays up
  private markS = 0; // s the crosshair's hit ticks stay on
  private marked = 0; // hits on a person or a car, for the test hook
  private readonly hit = newHit();
  private readonly aimHit = newHit();
  private readonly line = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1 };
  private readonly aim = { yaw: 0, pitch: 0 };
  private readonly probe = { x: 0, z: 0 };
  private readonly crosshair: HTMLElement;
  private readonly world: ShotWorld & { cars: RenderedCar[] };
  private readonly weaponButton: HTMLButtonElement;
  private readonly flavourButton: HTMLButtonElement;
  private weapon = 1; // the pickadoll
  private flavour = 0;
  private held = false; // the trigger is down
  private pulledS = -1; // s since a pull that hasn't fired yet, -1 for none: a weapon that isn't automatic fires once per pull
  private coolS = 0;
  private clockS = 0;
  private introS = INTRO_AFTER_S;
  private aimHeld = false; // the right mouse button is down
  private aimKept = false; // aiming was switched on with C or the Aim button
  private aimK = 0; // 0 the game's camera, 1 over the shoulder
  private aimPitch = 0; // rad above level, while aiming
  private ready = false;
  /** shots fired and hits landed so far, for the test hook */
  fired = 0;
  hits = 0;

  constructor(g: PickadollDeps) {
    this.g = g;
    this.world = { groundAt: g.world.groundAt, collide: g.world.collide, people: g.crowd.npcs, cars: [] };
    const pull = () => {
      this.held = true;
      this.pulledS = 0;
    };
    const release = () => {
      this.held = false;
    };
    // the first click only takes the mouse; the ones after fire
    g.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button === 0 && g.mouseLocked()) pull();
    });
    g.canvas.addEventListener('pointerup', e => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 2) this.aimHeld = false;
      else release();
    });
    g.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button === 2 && g.mouseLocked()) this.aimHeld = true;
    });
    g.canvas.addEventListener('contextmenu', e => e.preventDefault()); // the right button aims
    g.win.addEventListener('blur', () => {
      release();
      this.aimHeld = false;
    });
    g.win.addEventListener('keydown', e => {
      if (!g.game.started || g.menuOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.('input, textarea')) return; // the dev console, naming a pet
      if (e.code === 'KeyX') pull();
      else if (e.code === 'KeyQ') this.nextWeapon();
      else if (e.code === 'KeyG') this.nextFlavour();
      else if (e.code === 'KeyC') this.aimKept = !this.aimKept;
    });
    g.win.addEventListener('keyup', e => {
      if (e.code === 'KeyX') release();
    });
    const fire = document.createElement('button');
    fire.type = 'button';
    fire.id = 'p-fire';
    fire.textContent = 'Fire';
    fire.addEventListener('pointerdown', pull);
    fire.addEventListener('pointerup', release);
    fire.addEventListener('pointercancel', release);
    const aim = document.createElement('button');
    aim.type = 'button';
    aim.id = 'p-aim';
    aim.textContent = 'Aim';
    aim.addEventListener('click', () => {
      this.aimKept = !this.aimKept;
      aim.setAttribute('aria-pressed', String(this.aimKept));
    });
    g.$('pad').prepend(fire, aim);
    this.crosshair = document.createElement('div');
    this.crosshair.id = 'lab-crosshair';
    this.crosshair.hidden = true;
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
    const [lengthM, thickM] = GUN_M[WEAPONS[this.weapon].id];
    this.g.fx.sizeGun(lengthM, thickM);
    label(this.flavourButton, 'G', HIT_FLAVOURS[this.flavour].name);
  }

  private nextWeapon() {
    this.weapon = (this.weapon + 1) % WEAPONS.length;
    this.coolS = 0;
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
      marked: this.marked,
      splats: this.g.fx.splatted,
      weapon: WEAPONS[this.weapon].id,
      flavour: HIT_FLAVOURS[this.flavour].id,
      aiming: this.aimK > 0.5,
      spikes: this.spikes.length,
      limping: this.limping.length,
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

    const ready = game.started && !this.g.menuOpen && !this.g.inside && game.titleCardT <= 0;
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
    this.crosshair.style.top = 50 - crossY * 50 + '%';
    if (aiming) {
      player.h = view.camYaw; // you face where you aim, and walk sideways
      player.mesh.rotation.y = -player.h;
    }
    // what is under the crosshair: the line of sight from the camera, looked along from where it passes you
    const line = fx.sightLine(crossY, this.line),
      muzzleY = this.g.world.groundAt(from.x, from.z) + MUZZLE_M,
      pastM = Math.hypot(from.x - line.x, muzzleY - line.y, from.z - line.z),
      seen = sight(line.x, line.y, line.z, line.dx, line.dy, line.dz, pastM, pastM + SIGHT_M, this.world, this.aimHit);
    let tx = this.aimHit.x,
      ty = this.aimHit.y,
      tz = this.aimHit.z,
      onTarget = seen && (this.aimHit.kind === 'person' || this.aimHit.kind === 'car');
    if (coarse && !onTarget) {
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
    const { yaw, pitch } = aimAt(weapon.speedMs, from.x, muzzleY, from.z, tx, ty, tz, this.aim);
    this.crosshair.hidden = !ready;
    this.crosshair.classList.toggle('on', onTarget);
    this.markS -= dt;
    this.crosshair.classList.toggle('hit', this.markS > 0);
    // a click a moment before the weapon is ready still fires; an older one is dropped, so clicks never queue up
    if (this.pulledS >= 0) this.pulledS += dt;
    if (!ready || this.pulledS > PULL_KEEP_S + dt) this.pulledS = -1;
    // a throwable is held back while the trigger is down, with its arc showing, and thrown when you let go
    let thrown = false;
    if (weapon.thrown && ready && this.held && this.coolS <= 0) this.wound = true;
    else if (this.wound) {
      thrown = weapon.thrown && ready && !this.held;
      this.wound = false;
    }
    if (this.wound) {
      const side = this.aimK * AIM_MUZZLE_SIDE_M,
        flown = {
          x: from.x + Math.cos(yaw) * side,
          y: muzzleY,
          z: from.z + Math.sin(yaw) * side,
          ...aimShot(weapon, yaw, pitch),
          ageS: 0,
          bounced: 0,
          lifeS: 0,
          lying: false,
          weapon: this.weapon,
        };
      fx.drawArc(
        this.arc,
        flightPath(flown, this.world, ARC_STEP_S, ARC_POINTS, this.arc, this.arcEnd),
        weapon.blastM || ARC_RING_M,
      );
    } else fx.drawArc(this.arc, 0, 0);
    if (ready && this.coolS <= 0 && (weapon.thrown ? thrown : weapon.auto ? this.held : this.pulledS >= 0)) {
      this.pulledS = -1;
      this.coolS = weapon.coolS;
      this.raisedS = RAISED_S;
      this.fire(from, car, yaw, pitch);
    }
    // the stance, drawn over the walk's arm swing: the right arm along the aim, or back for a throw
    this.raisedS -= dt;
    const arms = player.mesh.arms;
    if (arms && !car && ready) {
      if (this.wound) arms[1].rotation.x = WIND_UP_RAD;
      else if (aiming || this.raisedS > 0 || (this.held && !weapon.thrown)) arms[1].rotation.x = Math.PI / 2 + pitch;
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i],
        hit = stepShot(s, dt, this.world, this.hit);
      if (!hit) continue;
      if (hit !== 'gone') {
        this.land(s, hit);
        if (hit.bounced) continue; // it flies on
      }
      this.shots[i] = this.shots[this.shots.length - 1];
      this.shots.pop();
    }
    fx.drawShots(this.shots, this.colourOf, this.radiusOf);
    this.dance(dt);
    this.stepSpikes(dt);
  }

  private readonly radiusOf = (s: Shot) => WEAPONS[s.weapon].shotM;

  // on foot only: from a car you aim with the car's own camera
  private get aiming() {
    return this.ready && !this.g.game.inCar && (this.aimHeld || this.aimKept);
  }

  /** The look while aiming: true when it took the mouse or the drag, so the game's camera doesn't. */
  aimLook(dx: number, dy: number): boolean {
    if (!this.aiming) return false;
    const { view } = this.g;
    view.camYaw = wrap(view.camYaw + dx * LOOK_YAW_K * AIM_LOOK_K);
    this.aimPitch = clamp(this.aimPitch - dy * LOOK_PITCH_K * AIM_LOOK_K, -AIM_PITCH_MAX, AIM_PITCH_MAX);
    return true;
  }

  /** After the game's camera is placed: moves it over your shoulder while you aim, and back when you stop. */
  aimCamera() {
    if (this.aimK <= 0) {
      this.g.fx.aimCamera(0, 0, 0, 0, 0, 0, 0, 1);
      return;
    }
    const { player, view, world, fx } = this.g,
      yaw = view.camYaw,
      cp = Math.cos(this.aimPitch),
      fx_ = Math.sin(yaw) * cp,
      fy = Math.sin(this.aimPitch),
      fz = -Math.cos(yaw) * cp,
      ground = world.groundAt(player.x, player.z);
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

  private fire(from: Point, car: RenderedCar | null, yaw: number, pitch: number) {
    const { rnd, player, world } = this.g,
      weapon = WEAPONS[this.weapon],
      flavour = HIT_FLAVOURS[this.flavour].id;
    if (!car) player.h = yaw; // you turn to face where you fire
    const side = this.aimK * AIM_MUZZLE_SIDE_M;
    // a shot from a moving car keeps the car's speed
    const cvx = car ? Math.sin(car.vh) * car.v : 0,
      cvz = car ? -Math.cos(car.vh) * car.v : 0;
    for (let i = 0; i < weapon.pellets && this.shots.length < SHOTS_MAX; i++) {
      const v = aimShot(weapon, yaw, pitch, rnd() * 2 - 1, rnd() * 2 - 1);
      this.shots.push({
        x: from.x + Math.cos(yaw) * side,
        y: world.groundAt(from.x, from.z) + MUZZLE_M,
        z: from.z + Math.sin(yaw) * side,
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
      // on the ground where it fell; off a wall or a car, just out from it
      const out = hit.kind === 'ground' ? 0 : SPIKE_OFF_WALL_M,
        x = hit.x + hit.nx * out,
        z = hit.z + hit.nz * out;
      if (this.spikes.length >= SPIKES_MAX) this.spikes.shift();
      this.spikes.push({ x, y: this.g.world.groundAt(x, z), z, turn: s.seed, leftS: SPIKE_S });
      fx.drawSpikes(this.spikes);
      return;
    }
    const person = hit.kind === 'person' ? crowd.npcs[hit.target] : null,
      car = hit.kind === 'car' ? this.world.cars[hit.target] : null;
    if (person) this.hitPerson(person, s.flavour, hit.dx, hit.dz, hit.y, weapon.power, weapon.splatM, colour, s.seed);
    else if (car) this.hitCar(car, s.flavour, hit, weapon.power, weapon.splatM, colour, s.seed);
    else fx.splat(hit, s.flavour === 'gegga' ? weapon.splatM : weapon.splatM * 0.45, colour, s.seed);
    if (person || car) this.mark();
    if (!weapon.blastM) return;
    for (const n of crowd.npcs) {
      const ex = n.x - hit.x,
        ez = n.z - hit.z,
        d = Math.hypot(ex, ez);
      if (n === person || n.down || d > weapon.blastM || d < 0.01) continue;
      this.hitPerson(n, s.flavour, ex / d, ez / d, hit.y + 1, weapon.power * 0.6, weapon.splatM, colour, rnd());
      this.mark();
    }
    if (s.flavour === 'pang')
      for (const c of this.world.cars) {
        const ex = c.x - hit.x,
          ez = c.z - hit.z,
          d = Math.hypot(ex, ez);
        if (c !== car && d < weapon.blastM && d > 0.01) this.shoveCar(c, ex / d, ez / d, weapon.power * 0.6);
      }
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
    this.marked++;
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

  private shoveCar(c: RenderedCar, dx: number, dz: number, power: number) {
    c.dmg = Math.min(CAR_DMG_MAX, c.dmg + power * PANG_CAR_DMG);
    if (c.mode !== 'parked') return; // a car that drives is where its driving puts it
    c.x += dx * power * PANG_CAR_SHOVE_M;
    c.z += dz * power * PANG_CAR_SHOVE_M;
    this.g.placeCar(c);
  }

  // what the fotanglar on the ground do to who comes by
  private stepSpikes(dt: number) {
    const { game, player, crowd, fx } = this.g,
      { spikes, limping } = this;
    let changed = false;
    this.spikeHurtS -= dt;
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i];
      s.leftS -= dt;
      let used = s.leftS <= 0;
      // a car that rolls over it has a puncture, the police's and your own too
      if (!used)
        for (const c of this.g.cars)
          if (Math.abs(c.v) > SPIKE_CAR_MIN_MS && Math.hypot(c.x - s.x, c.z - s.z) < SPIKE_WHEEL_M) {
            c.dmg = Math.max(c.dmg, PUNCTURE_DMG);
            used = true;
            break;
          }
      if (!used)
        for (const n of crowd.npcs)
          if (!n.down && Math.hypot(n.x - s.x, n.z - s.z) < SPIKE_STEP_M && !limping.some(l => l.npc === n)) {
            limping.push({ npc: n, leftS: LIMP_S, speed: n.speed });
            n.speed *= LIMP_SPEED;
          }
      // you, on foot and on the ground: a jump clears them
      if (
        !used &&
        !game.inCar &&
        player.y <= 0 &&
        this.spikeHurtS <= 0 &&
        Math.hypot(player.x - s.x, player.z - s.z) < SPIKE_STEP_M
      ) {
        this.spikeHurtS = SPIKE_HURT_EVERY_S;
        this.g.hurtPlayer(SPIKE_HURT_HP);
        this.g.toast('”Aj! Fotanglar!”', 2);
      }
      if (used) {
        spikes.splice(i, 1);
        changed = true;
      }
    }
    if (changed) fx.drawSpikes(spikes);
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
