// The pickadoll lab (#17, ?lab=pickadoll): a proof of concept for trying weapons and hits side by side. You have every
// weapon from the start; Q changes the weapon, G what a hit does, and the mouse button, X or the Fire button fires, on
// foot and from a car. The rules are in ./sim/shots.ts and the drawing in ./render/shot-fx.ts; this file reads the
// controls, shows the two HUD buttons and decides what each hit does to the world. A page module: it uses the DOM.
import { clamp } from '../world/math';
import type { Rnd } from '../world/random';
import type { Npc } from './pedestrians';
import type { PlayerState } from './player';
import type { Ragdolls } from './ragdolls';
import type { RenderedCar } from './render/car-meshes';
import { GEGGA, type ShotFx } from './render/shot-fx';
import {
  aimShot,
  assistYaw,
  HIT_FLAVOURS,
  type HitFlavour,
  landing,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotHit,
  type ShotWorld,
  stepShot,
  WEAPONS,
} from './sim/shots';
import type { GameState, ViewState } from './state';

// aiming with the camera you already have: looking level with the default camera fires level, a lower camera fires up at
// the walls, a higher one down at the street
const AIM_LEVEL_PITCH = 0.34, // the camera pitch (rad) that fires level
  AIM_PITCH_K = 0.75, // rad of aim per rad of camera pitch
  AIM_UP_MAX = 0.35,
  AIM_DOWN_MAX = 0.6;
const AIM_EVERY = 3; // the aim mark is worked out every this many frames
// the soft lock on a touch screen, where there is no fine aim: the shot turns to the nearest target near where you look
const ASSIST_CONE_RAD = 0.3,
  ASSIST_CONE_CAR_RAD = 0.6, // wider from a car: both thumbs are busy driving
  ASSIST_RANGE_M = 45;
const SHOTS_MAX = 128; // in the air at once
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
const BLAST_DROPS = 7; // a blast of gegga leaves this many more splats around the hit

type Point = { x: number; z: number };

export interface PickadollDeps {
  win: Pick<Window, 'addEventListener'>;
  canvas: HTMLCanvasElement;
  $(id: string): HTMLElement;
  coarse: boolean;
  game: Pick<GameState, 'started' | 'inCar' | 'pcar' | 'titleCardT'>;
  view: Pick<ViewState, 'camYaw' | 'camPitch'>;
  player: PlayerState;
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
}

/** The lab's weapons: built once, stepped every frame. */
export class Pickadoll {
  private readonly g: PickadollDeps;
  private readonly shots: (Shot & { seed: number; flavour: HitFlavour })[] = [];
  private readonly dancers: { npc: Npc; leftS: number }[] = [];
  private readonly hit = newHit();
  private readonly aimHit = newHit();
  private readonly world: ShotWorld & { cars: RenderedCar[] };
  private readonly weaponButton: HTMLButtonElement;
  private readonly flavourButton: HTMLButtonElement;
  private weapon = 1; // the pickadoll
  private flavour = 0;
  private held = false; // the trigger is down
  private pulled = false; // and hasn't fired yet: a weapon that isn't automatic fires once per pull
  private coolS = 0;
  private frame = 0;
  private clockS = 0;
  private introS = INTRO_AFTER_S;
  /** shots fired and hits landed so far, for the test hook */
  fired = 0;
  hits = 0;

  constructor(g: PickadollDeps) {
    this.g = g;
    this.world = { groundAt: g.world.groundAt, collide: g.world.collide, people: g.crowd.npcs, cars: [] };
    const pull = () => {
      this.held = this.pulled = true;
    };
    const release = () => {
      this.held = false;
    };
    // the first click only takes the mouse; the ones after fire
    g.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button === 0 && g.mouseLocked()) pull();
    });
    g.canvas.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse') release();
    });
    g.win.addEventListener('blur', release);
    g.win.addEventListener('keydown', e => {
      if (!g.game.started || g.menuOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.('input, textarea')) return; // the dev console, naming a pet
      if (e.code === 'KeyX') pull();
      else if (e.code === 'KeyQ') this.nextWeapon();
      else if (e.code === 'KeyG') this.nextFlavour();
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
    g.$('pad').prepend(fire);
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
      splats: this.g.fx.splatted,
      weapon: WEAPONS[this.weapon].id,
      flavour: HIT_FLAVOURS[this.flavour].id,
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
            ? 'Lab: pickadoll. Fire fires; tap the weapon and the hit at the top to change them.'
            : 'Lab: pickadoll. Click or hold X to fire, Q changes the weapon, G what a hit does.',
          6,
        );
    }
    this.coolS -= dt;
    // every car but the one you sit in can be hit
    const cars = this.world.cars;
    cars.length = 0;
    for (const c of this.g.cars) if (c !== car) cars.push(c);

    const ready = game.started && !this.g.menuOpen && !this.g.inside && game.titleCardT <= 0;
    let yaw = view.camYaw;
    if (coarse)
      yaw = assistYaw(from.x, from.z, yaw, this.world, car ? ASSIST_CONE_CAR_RAD : ASSIST_CONE_RAD, ASSIST_RANGE_M);
    const pitch = clamp((AIM_LEVEL_PITCH - view.camPitch) * AIM_PITCH_K, -AIM_DOWN_MAX, AIM_UP_MAX);
    if (ready && this.coolS <= 0 && (weapon.auto ? this.held : this.pulled)) {
      this.pulled = false;
      this.coolS = weapon.coolS;
      this.fire(from, car, yaw, pitch);
    }
    if (!ready) this.pulled = false;

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i],
        hit = stepShot(s, dt, this.world, this.hit);
      if (!hit) continue;
      if (hit !== 'gone') this.land(s, hit);
      this.shots[i] = this.shots[this.shots.length - 1];
      this.shots.pop();
    }
    fx.drawShots(this.shots, this.colourOf);
    if (this.frame++ % AIM_EVERY === 0)
      fx.aim(ready ? landing(this.weapon, from.x, from.z, yaw, pitch, this.world, this.aimHit) : null);
    this.dance(dt);
  }

  private readonly colourOf = (s: { seed: number; flavour: HitFlavour }) =>
    s.flavour === 'gegga' ? GEGGA[Math.floor(s.seed * GEGGA.length)] : s.flavour === 'dans' ? DANCE_COLOUR : SCUFF;

  private fire(from: Point, car: RenderedCar | null, yaw: number, pitch: number) {
    const { rnd, player, world } = this.g,
      weapon = WEAPONS[this.weapon],
      flavour = HIT_FLAVOURS[this.flavour].id;
    if (!car) player.h = yaw; // you turn to face where you fire
    // a shot from a moving car keeps the car's speed
    const cvx = car ? Math.sin(car.vh) * car.v : 0,
      cvz = car ? -Math.cos(car.vh) * car.v : 0;
    for (let i = 0; i < weapon.pellets && this.shots.length < SHOTS_MAX; i++) {
      const v = aimShot(weapon, yaw, pitch, rnd() * 2 - 1, rnd() * 2 - 1);
      this.shots.push({
        x: from.x,
        y: world.groundAt(from.x, from.z) + MUZZLE_M,
        z: from.z,
        vx: v.vx + cvx,
        vy: v.vy,
        vz: v.vz + cvz,
        ageS: 0,
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
    this.hits++;
    const person = hit.kind === 'person' ? crowd.npcs[hit.target] : null,
      car = hit.kind === 'car' ? this.world.cars[hit.target] : null;
    if (person) this.hitPerson(person, s.flavour, hit.dx, hit.dz, hit.y, weapon.power, weapon.splatM, colour, s.seed);
    else if (car) this.hitCar(car, s.flavour, hit, weapon.power, weapon.splatM, colour, s.seed);
    else fx.splat(hit, s.flavour === 'gegga' ? weapon.splatM : weapon.splatM * 0.45, colour, s.seed);
    if (!weapon.blastM) return;
    for (const n of crowd.npcs) {
      const ex = n.x - hit.x,
        ez = n.z - hit.z,
        d = Math.hypot(ex, ez);
      if (n === person || n.down || d > weapon.blastM || d < 0.01) continue;
      this.hitPerson(n, s.flavour, ex / d, ez / d, hit.y + 1, weapon.power * 0.6, weapon.splatM, colour, rnd());
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
