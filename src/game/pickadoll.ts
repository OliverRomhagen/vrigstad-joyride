// The pickadoll lab (#17, ?lab=pickadoll): a proof of concept for trying weapons and ammo side by side. You have every
// weapon from the start; Q changes the weapon, G its ammo, and the mouse button, X or the Fire button fires, on foot and
// from a car. The keys and buttons are controls it adds to the game's input (./input.ts). Changing the weapon, the ammo
// and keeping the aim are commands (`weapon`, `ammo`, `aim`: docs/console.md), which Q, G, C and the buttons run;
// firing and holding the aim are held input. The rules are in ./sim/shots.ts and ./sim/ammo.ts and the drawing in
// ./render/shot-fx.ts; this file reads the controls, shows the two HUD buttons and carries out each hit's effects on
// the world. A page module: it uses the DOM.
import { createElement, Egg, type IconNode, Music, Triangle, Zap } from 'lucide';
import { clamp, wrap } from '../world/math';
import type { Rnd } from '../world/random';
import { NO_FLAT } from './cars';
import { choice, command, optional, toggle } from './command-args';
import { type Commands, UsageError } from './commands';
import { damageCar } from './health';
import { type Control, type Input, MouseButton } from './input';
import type { Npc } from './pedestrians';
import type { PlayerState } from './player';
import type { Ragdolls } from './ragdolls';
import type { RenderedCar } from './render/car-meshes';
import type { Person } from './render/models';
import type { ShotFx } from './render/shot-fx';
import { AMMOS, type Ammo, AmmoId, accepts, ammoFor, EffectKind, effectOf, nextAmmo } from './sim/ammo';
import { pushBodyOut } from './sim/car-body';
import type { PhysicsWorld } from './sim/physics-world';
import { physicsCast } from './sim/shot-physics';
import {
  aimAtMoving,
  aimShot,
  assistTarget,
  blastPush,
  flightPath,
  HitKind,
  knockbackOf,
  MUZZLE_M,
  newHit,
  SHOTS_MAX,
  type Shot,
  type ShotHit,
  ShotStep,
  type ShotWorld,
  sight,
  slideCar,
  stepShot,
  WEAPONS,
  WeaponId,
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
// the weapon you start with
const START_WEAPON = WEAPONS.findIndex(w => w.id === WeaponId.PICKADOLL);
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
// the lab's keys: the code Input listens for, and the letter its button shows and announces
const LAB_KEYS = {
  FIRE: { code: 'KeyX', label: 'X' },
  AIM: { code: 'KeyC', label: 'C' },
  WEAPON: { code: 'KeyQ', label: 'Q' },
  AMMO: { code: 'KeyG', label: 'G' },
  HOLSTER: { code: 'KeyH', label: 'H' },
} as const;
// each ammo's icon, beside its name on the ammo button, so a glance tells which one is loaded: Lucide, as in the wiki
const AMMO_ICONS: Record<AmmoId, IconNode> = {
  [AmmoId.GEGGA]: Egg,
  [AmmoId.PANG]: Zap,
  [AmmoId.DANS]: Music,
  [AmmoId.FOTANGLAR]: Triangle,
};
// the lab's commands, by the name typed in the console: what its keys and buttons run
const LAB_COMMANDS = { AIM: 'aim', WEAPON: 'weapon', AMMO: 'ammo', HOLSTER: 'holster' } as const;
type LabCommand = (typeof LAB_COMMANDS)[keyof typeof LAB_COMMANDS];
// the soft lock on a touch screen, where there is no fine aim: the shot goes to the nearest person or car near where you look
const ASSIST_CONE_RAD = 0.3,
  ASSIST_CONE_CAR_RAD = 0.6, // wider from a car: both thumbs are busy driving
  ASSIST_RANGE_M = 45;
const PULL_KEEP_S = 0.12; // a click this long before the weapon is ready still fires when it is
// the first slot, with nothing in your hand: by the id the `weapon` command and the test hook use, and the name it shows
const HANDS = 'hands',
  HANDS_NAME = 'Hands';
const INTRO_AFTER_S = 5.5; // the lab's own line comes this long after Start, once the start line is gone
// with ?lab=rapier, a shot knocks street furniture over with the weapon's push (knockbackOf): the pickadoll's 40 N·s sends a
// 12 kg mailbox off at about 3 m/s
const KNOCKBACK_UP_SHARE = 0.3; // this share of the knockback goes upwards, so the prop tips rather than slides
// a throw (pang): a person hit is thrown over
const PANG_THROW_MS = 5, // a person leaves at this, plus PANG_THROW_MS_PER_NS for each N·s of the weapon's push
  PANG_THROW_MS_PER_NS = 0.0625,
  BLAST_SHARE = 0.6; // a blast reaches those around the hit with this share of its push and damage
const DANCE_SPIN_RADS = 7, // a dance: they spin this fast and hop
  DANCE_HOP_M = 0.22,
  DANCE_HOP_HZ = 3.2;
// throwing: hold to see the arc, let go to throw
const ARC_STEP_S = 1 / 20, // the arc has a dot this often along the flight
  ARC_POINTS = 64,
  ARC_RING_M = 0.7; // the ring where it lands, for a throwable with no blast
// the stance: the right arm comes up along the aim while you aim, hold the trigger or have just fired
const RAISED_S = 1.2, // the arm stays up this long after a shot
  WIND_UP_RAD = -0.9; // the arm goes back this far while you hold a throw
// the placeholder gun in the hand, by weapon: its length and thickness (m). No models yet
const GUN_M: Record<WeaponId, readonly [number, number]> = {
  [WeaponId.ARTPUFFRA]: [0.5, 0.04],
  [WeaponId.PICKADOLL]: [0.3, 0.08],
  [WeaponId.PEPPRAPUFFRA]: [0.4, 0.1],
  [WeaponId.HAGELBOSSA]: [0.65, 0.09],
  [WeaponId.POTATISKANON]: [0.85, 0.2],
  [WeaponId.MINIGUN]: [0.75, 0.17],
  [WeaponId.GULDARTPUFFRA]: [0.5, 0.05],
  [WeaponId.PUFFRA]: [0.28, 0.07],
  [WeaponId.LUFTGEVAR]: [0.95, 0.05],
  [WeaponId.ALGSTUDSARE]: [1.1, 0.07],
  [WeaponId.GRANAT]: [0.14, 0.14],
  [WeaponId.FOTANGLAR]: [0.12, 0.16],
};
const HIT_MARK_S = 0.1; // the crosshair's ticks stay this long after a hit on a person or a car, then fade (index.html)
// fotanglar: they lie where they land for a while (./sim/spikes.ts). Someone who steps on one hops on and walks
// slowly; a car that drives over one gets a flat tyre (Car.flat); you are hurt, unless you jump over
const FLAT_LINES = ['”PANG! Dä va däcket, dä.”', '”Punka! Klart dä skulle hända nu.”', '”Nu small dä i ett däck.”'],
  LIMP_S = 6, // someone who stepped on one limps this long,
  LIMP_SPEED = 0.35, // at this share of their speed,
  LIMP_HOP_M = 0.14, // hopping this high,
  LIMP_HOP_HZ = 2.4,
  SPIKE_HURT_HP = 6, // what stepping on one costs you,
  SPIKE_HURT_EVERY_S = 1; // at most this often

type Point = { x: number; z: number };

export interface PickadollDeps {
  input: Pick<Input, 'addControl'>;
  commands: Pick<Commands, 'register' | 'run'>; // the lab adds weapon, hit and aim, and its keys and buttons run them
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
  private readonly shots: (Shot & { seed: number; ammo: number })[] = []; // ammo: its index in AMMOS
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
  private readonly ammoButton: HTMLButtonElement;
  private readonly aimButton: HTMLButtonElement;
  private weapon = START_WEAPON;
  private chosenAmmo = 0; // the ammo picked last, in AMMOS; a weapon that doesn't fire it fires its own (ammo)
  private readonly trigger: Control; // held while the trigger is down
  private readonly aimHold: Control; // held while the right mouse button is
  private pulledS = -1; // s since a pull that hasn't fired yet, -1 for none: a weapon that isn't automatic fires once per pull
  private coolS = 0;
  private clockS = 0;
  private introS = INTRO_AFTER_S;
  private aimKept = false; // aiming was switched on with C or the Aim button
  // you start on Hands, the first slot: nothing in your hand, no crosshair, and the trigger and the aim do nothing yet
  // (a shove: #616). Q or the weapon button steps on from Hands through the weapons and back to it; H or the `holster`
  // command jumps between Hands and the weapon held last (this.weapon)
  private holstered = true;
  private aimK = 0; // 0 the game's camera, 1 over the shoulder
  private aimPitch = 0; // rad above level, while aiming
  private ready = false;
  private castThrough: PickadollDeps['physics'] = null; // the world this.world.cast asks
  private firedFrom: RenderedCar | null = null; // the car you sit in this frame, which your shots pass through
  // shots fired and hits landed so far, for the test hook (state)
  private fired = 0;
  private hits = 0;

  constructor(g: PickadollDeps) {
    this.g = g;
    this.world = { groundAt: g.world.groundAt, collide: g.world.collide, people: g.crowd.npcs, cars: [] };
    this.spikeWorld = { cars: g.cars, people: g.crowd.npcs, walker: null };
    // The controls, through the game's input: the left mouse button or X fires, the right one aims while held, C keeps
    // aiming on, Q changes the weapon (Hands among them), G its ammo, and H goes to Hands and back. A press of the trigger
    // is kept a moment (pulledS); on Hands it does nothing
    this.trigger = g.input.addControl({
      codes: [LAB_KEYS.FIRE.code],
      mouseButton: MouseButton.LEFT,
      press: () => {
        if (!this.holstered) this.pulledS = 0;
      },
    });
    this.aimHold = g.input.addControl({ mouseButton: MouseButton.RIGHT });
    g.input.addControl({ codes: [LAB_KEYS.AIM.code], press: () => this.runFromInput(LAB_COMMANDS.AIM) });
    g.input.addControl({ codes: [LAB_KEYS.WEAPON.code], press: () => this.runFromInput(LAB_COMMANDS.WEAPON) });
    g.input.addControl({ codes: [LAB_KEYS.AMMO.code], press: () => this.runFromInput(LAB_COMMANDS.AMMO) });
    g.input.addControl({ codes: [LAB_KEYS.HOLSTER.code], press: () => this.runFromInput(LAB_COMMANDS.HOLSTER) });
    const fire = document.createElement('button');
    fire.type = 'button';
    fire.id = 'p-fire';
    fire.textContent = 'Fire';
    fire.setAttribute('aria-keyshortcuts', LAB_KEYS.FIRE.label);
    this.trigger.hold(fire);
    const aim = document.createElement('button');
    aim.type = 'button';
    aim.id = 'p-aim';
    aim.textContent = 'Aim';
    aim.setAttribute('aria-pressed', 'false');
    aim.setAttribute('aria-keyshortcuts', LAB_KEYS.AIM.label);
    aim.addEventListener('click', () => this.runFromInput(LAB_COMMANDS.AIM));
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
    g.fx.holsterGun(true);
    this.weaponButton = this.hudButton(LAB_KEYS.WEAPON.label, LAB_COMMANDS.WEAPON);
    this.ammoButton = this.hudButton(LAB_KEYS.AMMO.label, LAB_COMMANDS.AMMO);
    this.drawHud();
    this.registerCommands(); // last: a command never reaches a lab that failed half-built
  }

  private hudButton(key: string, command: LabCommand) {
    const { $, canvas } = this.g,
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'plate lab-weapon';
    button.setAttribute('aria-keyshortcuts', key);
    button.addEventListener('click', () => {
      this.runFromInput(command);
      canvas.focus();
    });
    $('tr').append(button);
    return button;
  }

  private drawHud() {
    const label = (button: HTMLButtonElement, key: string, name: string, icon?: IconNode) => {
      const kbd = document.createElement('kbd');
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = key;
      button.replaceChildren(kbd, ...(icon ? [createElement(icon, { 'aria-hidden': 'true' })] : []), name);
    };
    label(this.weaponButton, LAB_KEYS.WEAPON.label, this.weaponName);
    this.weaponButton.setAttribute('aria-label', 'Weapon: ' + this.weaponName);
    this.ammoButton.setAttribute('aria-label', 'Ammo: ' + AMMOS[this.ammo].name);
    const [lengthM, thickM] = GUN_M[WEAPONS[this.weapon].id];
    this.g.fx.sizeGun(lengthM, thickM);
    label(this.ammoButton, LAB_KEYS.AMMO.label, AMMOS[this.ammo].name, AMMO_ICONS[AMMOS[this.ammo].id]);
  }

  // C and the Aim button switch aiming on until they switch it off
  private keepAim(on: boolean) {
    this.aimKept = on;
    this.aimButton.setAttribute('aria-pressed', String(on));
  }

  private pickWeapon(index: number) {
    this.weapon = index;
    this.holster(false); // changing the weapon takes it out
    this.coolS = Math.min(this.coolS, WEAPONS[this.weapon].coolS); // the wait left, at most the new weapon's own
    this.drawHud();
  }

  // what the weapon button and the console call what is in your hand
  private get weaponName() {
    return this.holstered ? HANDS_NAME : WEAPONS[this.weapon].name;
  }

  // to Hands, which also stops aiming and a throw held back, or back to the weapon held last
  private holster(away: boolean) {
    this.holstered = away;
    this.g.fx.holsterGun(away);
    this.drawHud();
    if (!away) return;
    this.keepAim(false);
    this.isWindingUp = false;
    this.pulledS = -1;
    this.raisedS = 0; // the arm a last shot raised goes down with it
  }

  // an ammo only its own weapon fires is never kept as the pick: the next weapon goes back to the ammo picked before
  private pickAmmo(index: number) {
    if (AMMOS[index].anyWeapon) this.chosenAmmo = index;
    this.drawHud();
  }

  // the ammo the weapon in your hand fires: the one picked last, if it fires that
  private get ammo() {
    return ammoFor(WEAPONS[this.weapon], this.chosenAmmo);
  }

  // weapon, ammo and aim: with no word each goes on to the next, which is what Q, G, C and the buttons run. Firing and
  // holding the aim are not commands: they are held, as throttle and steer are
  private registerCommands() {
    const { commands } = this.g;
    commands.register(
      LAB_COMMANDS.WEAPON,
      command({
        help: 'change to the next weapon, Hands among them, or to the one you name',
        examples: ['weapon', 'weapon ' + WeaponId.MINIGUN, 'weapon ' + HANDS],
        access: 'player',
        args: [optional(choice('weapon', [HANDS, ...WEAPONS.map(w => w.id)]))],
        run: ({ weapon }) => {
          if (weapon === HANDS) this.holster(true);
          else if (weapon !== undefined) this.pickWeapon(WEAPONS.findIndex(w => w.id === weapon));
          // the next in the cycle: from Hands the first weapon, and from the last weapon Hands again
          else if (this.holstered) this.pickWeapon(0);
          else if (this.weapon === WEAPONS.length - 1) this.holster(true);
          else this.pickWeapon(this.weapon + 1);
          return 'Weapon: ' + this.weaponName + '.';
        },
      }),
    );
    commands.register(
      LAB_COMMANDS.AMMO,
      command({
        help: "change the weapon's ammo to the next it fires, or to the one you name",
        examples: ['ammo', 'ammo dans'],
        access: 'player',
        args: [
          optional(
            choice(
              'ammo',
              AMMOS.map(a => a.id),
            ),
          ),
        ],
        run: ({ ammo }) => {
          const weapon = WEAPONS[this.weapon];
          if (ammo !== undefined && !accepts(weapon, ammo))
            throw new UsageError(
              weapon.name +
                ' fires ' +
                AMMOS.filter(a => accepts(weapon, a.id))
                  .map(a => a.name)
                  .join(', ') +
                ', not that.',
            );
          this.pickAmmo(ammo === undefined ? nextAmmo(weapon, this.ammo) : AMMOS.findIndex(a => a.id === ammo));
          return 'Ammo: ' + AMMOS[this.ammo].name + '.';
        },
      }),
    );
    commands.register(
      LAB_COMMANDS.AIM,
      command({
        help: 'keep aiming over the shoulder, or stop: switches when you say neither',
        examples: ['aim', 'aim off'],
        access: 'player',
        args: [optional(toggle('kept'))],
        run: ({ kept }) => {
          if (this.holstered && kept !== false) return 'Nothing to aim with: Q or H takes a weapon out.';
          this.keepAim(kept ?? !this.aimKept);
          return this.aimKept ? 'Aiming.' : 'Not aiming.';
        },
      }),
    );
    commands.register(
      LAB_COMMANDS.HOLSTER,
      command({
        help: 'go to Hands, or back to your last weapon with off; switches with neither',
        examples: ['holster', 'holster off'],
        access: 'player',
        args: [optional(toggle('away'))],
        run: ({ away }) => {
          this.holster(away ?? !this.holstered);
          return 'Weapon: ' + this.weaponName + '.';
        },
      }),
    );
  }

  // a key or a button runs its command through the registry, as a typed line does, so the hooks see it too. The line
  // that comes back is for the console: here the HUD shows what changed
  private runFromInput(command: LabCommand, word?: string) {
    this.g.commands.run(word ? command + ' ' + word : command, 'input');
  }

  /** What the test hook shows. */
  get state() {
    return {
      fired: this.fired,
      hits: this.hits,
      markedHits: this.markedHits,
      splats: this.g.fx.splatted,
      weapon: this.holstered ? HANDS : WEAPONS[this.weapon].id,
      ammo: AMMOS[this.ammo].id,
      aiming: this.aimK > 0.5,
      scoped: this.isScoped,
      holstered: this.holstered,
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
            ? 'Lab: pickadoll. Tap Hands at the top for a weapon, Fire fires, Aim aims; tap the weapon and the ammo to change them.'
            : 'Lab: pickadoll. Q or H takes a weapon out, click or X fires, right button or C aims, G changes the ammo, H puts it away.',
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
    const armed = ready && !this.holstered, // the weapon is out and can be used
      aiming = this.aiming;
    const pulling = this.trigger.held;
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
        armed &&
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
      onTarget = seen && (this.aimHit.kind === HitKind.PERSON || this.aimHit.kind === HitKind.CAR);
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
    this.crosshair.hidden = !armed;
    this.crosshair.classList.toggle('on', onTarget);
    this.markS -= dt;
    this.crosshair.classList.toggle('hit', this.markS > 0);
    // a click a moment before the weapon is ready still fires; an older one is dropped, so clicks never queue up
    if (this.pulledS >= 0) this.pulledS += dt;
    if (!armed || this.pulledS > PULL_KEEP_S + dt) this.pulledS = -1;
    // a throwable is held back while the trigger is down, with its arc showing, and thrown when you let go
    let thrown = false;
    if (weapon.thrown && armed && pulling && this.coolS <= 0) this.isWindingUp = true;
    else if (this.isWindingUp) {
      thrown = weapon.thrown && armed && !this.trigger.held;
      this.isWindingUp = false;
    }
    if (this.isWindingUp) {
      const flown = Object.assign(this.flown, muzzle);
      aimShot(weapon, yaw, pitch, 0, 0, flown);
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
    if (armed && this.coolS <= 0 && (weapon.thrown ? thrown : weapon.auto ? pulling : this.pulledS >= 0)) {
      this.pulledS = -1;
      this.coolS = Math.max(this.coolS, -dt) + weapon.coolS; // what this frame overshot comes off the next wait
      this.raisedS = RAISED_S;
      this.fire(car, yaw, pitch);
    }
    // the stance, drawn over the walk's arm swing: the right arm along the aim, or back for a throw
    this.raisedS -= dt;
    const arms = player.mesh.arms;
    if (arms && !car && armed) {
      if (this.isWindingUp) arms[1].rotation.x = WIND_UP_RAD;
      else if (aiming || this.raisedS > 0 || (pulling && !weapon.thrown)) arms[1].rotation.x = Math.PI / 2 + pitch;
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i],
        { x, y, z } = s, // where it was when the frame began
        step = stepShot(s, dt, this.world, this.hit);
      if (step === ShotStep.FLYING) continue;
      if (step === ShotStep.HIT) {
        const hit = this.hit;
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
    return this.ready && !this.holstered && !this.g.game.inCar && (this.aimHold.held || this.aimKept);
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
      lookX = Math.sin(yaw) * cp,
      lookY = Math.sin(this.aimPitch),
      lookZ = -Math.cos(yaw) * cp,
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
      fx.aimCamera(this.aimK, ex, ey, ez, ex + lookX, ey + lookY, ez + lookZ, fx.magnified(scope));
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
      const x = sx - lookX * back,
        z = sz - lookZ * back;
      if (this.clear(x, z) && sy - lookY * back > world.groundAt(x, z) + AIM_ROOM_M) break;
    }
    fx.aimCamera(
      this.aimK,
      sx - lookX * back,
      sy - lookY * back,
      sz - lookZ * back,
      sx + lookX,
      sy + lookY,
      sz + lookZ,
      AIM_ZOOM,
    );
  }

  // no wall within AIM_ROOM_M of (x, z)
  private clear(x: number, z: number) {
    this.probe.x = x;
    this.probe.z = z;
    return !this.g.world.collide(this.probe, AIM_ROOM_M);
  }

  private readonly colourOf = (s: { seed: number; ammo: number }) => {
    const { colours } = AMMOS[s.ammo];
    return colours[Math.floor(s.seed * colours.length)];
  };

  private fire(car: RenderedCar | null, yaw: number, pitch: number) {
    const { rnd, player } = this.g,
      weapon = WEAPONS[this.weapon],
      ammo = this.ammo;
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
        ammo,
      });
    }
    this.fired++;
  }

  // what a hit does: its ammo's effects, on who or what it landed on; a weapon with a blast then reaches everyone around it
  private land(s: Shot & { seed: number; ammo: number }, hit: ShotHit) {
    const { fx, crowd, rnd } = this.g,
      weapon = WEAPONS[s.weapon],
      ammo: Ammo = AMMOS[s.ammo],
      colour = this.colourOf(s),
      splat = effectOf(ammo, EffectKind.SPLAT),
      splatM = weapon.splatM * (splat?.sizeK ?? 0);
    if (hit.bounced && weapon.fuseS) return; // a grenade only bounces and lies until its fuse runs out
    this.hits++;
    if (effectOf(ammo, EffectKind.SPIKES)) {
      dropSpike(this.spikes, hit, this.g.world.groundAt, s.seed);
      fx.drawSpikes(this.spikes);
      return;
    }
    const person = hit.kind === HitKind.PERSON ? crowd.npcs[hit.target] : null,
      car = hit.kind === HitKind.CAR ? this.world.cars[hit.target] : null,
      knockbackNs = knockbackOf(weapon);
    if (person) this.hitPerson(person, ammo, hit.dx, hit.dz, hit.y, knockbackNs, weapon.splatM, colour, s.seed);
    else if (car) {
      this.hitCar(car, ammo, hit.dx, hit.dz, knockbackNs, weapon.damage);
      if (splat) fx.splatOn(car.mesh, hit, splatM, colour, s.seed);
    } else if (hit.kind === HitKind.PROP) {
      // knocked over, whatever the ammo, with no splat: a mark left in the air where it stood would hang there
      this.g.physics?.knockProp(
        hit.target,
        hit.x,
        hit.y,
        hit.z,
        hit.dx * knockbackNs,
        knockbackNs * KNOCKBACK_UP_SHARE,
        hit.dz * knockbackNs,
      );
    } else if (splat) fx.splat(hit, splatM, colour, s.seed);
    if (person || car) this.mark();
    if (!weapon.blastM) return;
    const { push } = this;
    for (const n of crowd.npcs) {
      if (n === person || n.down || !blastPush(hit.x, hit.z, weapon.blastM, n.x, n.z, push)) continue;
      this.hitPerson(n, ammo, push.dx, push.dz, hit.y + 1, knockbackNs * BLAST_SHARE, weapon.splatM, colour, rnd());
      this.mark();
    }
    for (const c of this.world.cars)
      if (c !== car && blastPush(hit.x, hit.z, weapon.blastM, c.x, c.z, push))
        this.hitCar(c, ammo, push.dx, push.dz, knockbackNs * BLAST_SHARE, weapon.damage * BLAST_SHARE);
    const spatter = effectOf(ammo, EffectKind.SPATTER);
    for (let i = 0; spatter && i < spatter.drops; i++) {
      const a = rnd() * Math.PI * 2,
        reach = weapon.blastM * (0.3 + rnd() * 0.7),
        x = hit.x + Math.cos(a) * reach,
        z = hit.z + Math.sin(a) * reach;
      fx.splat(
        { kind: HitKind.GROUND, x, y: this.g.world.groundAt(x, z), z, nx: 0, ny: 1, nz: 0 },
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

  // the ammo's effects on a person; (dx, dz): the way the hit pushes them, a unit vector along the ground
  private hitPerson(
    n: Npc,
    ammo: Ammo,
    dx: number,
    dz: number,
    y: number,
    knockbackNs: number,
    splatM: number,
    colour: string,
    turn: number,
  ) {
    const { fx, crowd, ragdolls } = this.g;
    for (const e of ammo.effects)
      switch (e.kind) {
        case EffectKind.SPLAT:
          if (e.onPeople) fx.splatOnPerson(n.mesh, dx, dz, y, splatM * e.sizeK, colour, turn);
          break;
        case EffectKind.STARE:
          crowd.stare(n, 0.1, e.s);
          break;
        case EffectKind.THROW:
          // too many down already: they are only knocked a step back
          if (!ragdolls.push(n, dx, dz, PANG_THROW_MS + knockbackNs * PANG_THROW_MS_PER_NS)) {
            n.x += dx * 0.5;
            n.z += dz * 0.5;
          }
          break;
        case EffectKind.DANCE:
          if (this.dancers.some(d => d.npc === n)) break;
          crowd.stare(n, 0.1, e.s); // stops them where they are
          this.dancers.push({ npc: n, leftS: e.s });
          break;
      }
  }

  // the cars a crash spares (crashes.ts): Plåt-Pelle's for sale, which also stand still, and the one you drive in god mode
  private spared(c: RenderedCar) {
    return c.saleKr > 0 || (this.g.god && c === this.g.game.pcar);
  }

  // the ammo's effects on a car: its damage, and a slide when the push beats its brakes
  private hitCar(c: RenderedCar, ammo: Ammo, dx: number, dz: number, knockbackNs: number, damage: number) {
    if (this.spared(c)) return;
    if (effectOf(ammo, EffectKind.DAMAGE)) damageCar(c, damage);
    if (!effectOf(ammo, EffectKind.SHOVE) || !slideCar(c, dx, dz, knockbackNs)) return;
    pushBodyOut(c, this.world.collide); // or shot by shot it would go through a wall, as a car shoved by a crash (cars.ts)
    this.g.placeCar(c);
  }

  // what the fotanglar on the ground do to who comes by
  private stepSpikes(dt: number) {
    const { game, player, crowd, fx, cars, rnd } = this.g,
      { spikes, limping, spikeWorld } = this;
    this.spikeHurtS -= dt;
    // you, on foot and on the ground: a jump clears them
    spikeWorld.walker = !game.inCar && player.y <= 0 ? player : null;
    const step = stepSpikes(spikes, dt, spikeWorld, this.spikeStep);
    // a car that rolls over one gets a flat tyre, the police's and your own too; one flat per car
    for (let n = 0; n < step.cars.length; n++) {
      const c = cars[step.cars[n]];
      if (c.flat !== NO_FLAT || this.spared(c)) continue;
      c.flat = step.wheels[n];
      if (c === game.pcar) this.g.toast(FLAT_LINES[Math.floor(rnd() * FLAT_LINES.length)] + ' A tyre is flat.', 3);
    }
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
