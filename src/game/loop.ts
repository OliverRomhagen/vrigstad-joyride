// The main loop: every frame it reads the controls, moves the player (or their car), steps traffic, pedestrians, cats
// and the police, places the camera, updates the HUD and renders. Also the Start button and fitting the canvas.
// DOM over the canvas. Moved from src/game/main.ts (#177); main.ts passes in the modules it steps.
import type * as THREE from 'three';
import { clamp } from '../world/math';
import type { Car, Fleet, TrafficCar } from './cars';
import { type Emoting, stepEmote } from './emotes';
import { CRASH_COOL_S, type Health, impactSpeed, regen, runOverHurt } from './health';
import type { Input } from './input';
import type { Places } from './places';
import { hop, type PlayerState, ride, walk } from './player';
import type { Wanted } from './police';
import type { CameraRig } from './render/camera-rig';
import type { Person } from './render/models';
import type { PlayerPose } from './render/player-pose';
import type { ToonStyle } from './render/toon-style';
import { bodyRadius, nearestOnSpine, PERSON_RADIUS_M } from './sim/car-body';
import type { GameState, ViewState } from './state';

type Point = { x: number; z: number };
const _onCar = { x: 0, z: 0 }; // nearestOnSpine writes here: no allocation per car per frame
const SIGN_S = 0.25; // the street sign, the prompt and the speed plate redraw this often (s)
const BLINK_S = 0.22; // the police lights change colour this often (s)
const START_LINE = 'Find a car and press E to take it. Occupied cars always get you a wanted star.';

/** What the loop steps and reads. The getters are read every frame. */
export interface GameLoopDeps {
  $(id: string): HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  coarse: boolean;
  half: number; // half the playable square (m)
  game: GameState;
  view: ViewState;
  player: PlayerState & Emoting & { mesh: Person };
  pose: Pick<PlayerPose, 'walk' | 'emote'>; // the player's arms and legs
  health: Health;
  input: Pick<Input, 'keys' | 'joy' | 'lockMouse'>;
  places: Pick<Places, 'inside'>;
  wanted: Pick<Wanted, 'update'>;
  cars: readonly Car[];
  startCam: readonly [yaw: number, pitch: number];
  barMat: THREE.MeshBasicMaterial; // the police light bars
  barColours: readonly [blue: THREE.Color, red: THREE.Color];
  cameraRig: Pick<CameraRig, 'update'>;
  readonly toasting: boolean;
  inWater(x: number, z: number): boolean;
  collide(o: Point, r: number): unknown;
  groundAt(x: number, z: number): number;
  drive: Fleet['drive'];
  updateTraffic: Fleet['updateTraffic'];
  knockedOut(): void;
  hurtPlayer(n: number): void;
  shake(dmg: number): void;
  toast(msg: string, secs?: number): void;
  hideTitleCard(): void; // when titleCardT runs out
  // stepped every frame, in this order
  updateTrisslott(dt: number): void;
  updatePlaces(dt: number): void; // spins the places' gems
  updateDriftFx(c: Car | null): void;
  updateVehicles(T: Point, dt: number): void;
  updateSmoke(dt: number, T: Point): void;
  updateBanknotes(dt: number): void; // from låt det regna and a big trisslott win
  updateConfetti(dt: number): void; // from a trisslott win
  updateNpcs(T: Point, dt: number): void;
  updateCats(T: Point, dt: number): void;
  updateDrivers(T: Point, dt: number): void;
  updateBodies(T: Point, dt: number): void; // after every car has moved this frame
  updateDaylight(dt: number): void; // the time of day: before the camera, which places the sun along its direction
  drawHearts(dt: number): void;
  updateHud(dt: number): void;
  drawMini(T: Point & { h: number }): void;
  // a few times a second
  updateSign(T: Point): void;
  catRideLines(): void;
  closeMenuIfLeft(): void;
  updatePrompt(): void;
  drawHealth(): void;
  timeFrame(workStart: number): void; // after drawing: the frame's work began at workStart (ms, performance.now)
}

/** Runs the game: `start` begins the frames, `startGame` is the Start button. */
export class GameLoop {
  private readonly g: GameLoopDeps;
  private last = performance.now();
  private runOverAt = -9; // the player's own cooldown for being run over, apart from the cars' crash cooldowns
  private signT = 0;
  private blinkT = 0;
  private laterLine: string | null = null;
  private style: Pick<ToonStyle, 'render'> | null = null;
  /** the police lights' phase, so the minimap blinks with them */
  blink = false;

  constructor(g: GameLoopDeps) {
    this.g = g;
  }

  /** Draws every later frame through a style: ?lab=toon's (#206), once its code has loaded. */
  drawThrough(style: Pick<ToonStyle, 'render'>) {
    this.style = style;
  }

  /** Whether frames are drawn through a style. */
  get styled() {
    return this.style !== null;
  }

  // a line that waits for the toast and any title card to clear, so it doesn't cut off what was just said
  sayLater = (line: string) => {
    this.laterLine = line;
  };

  start() {
    const { canvas } = this.g;
    addEventListener('resize', this.resize);
    if (window.ResizeObserver) new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    requestAnimationFrame(this.frame);
  }

  startGame = (e: MouseEvent) => {
    const { $, game, view, canvas, coarse, input, startCam, toast } = this.g;
    game.started = true;
    $('intro').hidden = true;
    view.camYaw = startCam[0];
    view.camPitch = startCam[1];
    canvas.focus();
    if ((e as PointerEvent).pointerType ? (e as PointerEvent).pointerType === 'mouse' : !coarse) input.lockMouse(); // by how Start was pressed: a tap on a touchscreen laptop shouldn't lock
    toast(START_LINE, 5);
  };

  private resize = () => {
    const { canvas, renderer, camera } = this.g,
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  private frame = (now: number) => {
    const g = this.g,
      {
        game,
        view,
        player,
        health,
        places,
        cars,
        input: { keys, joy },
      } = g;
    requestAnimationFrame(this.frame);
    const workStart = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    const mx = game.started ? clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joy.x, -1, 1) : 0,
      my = game.started ? clamp((keys.up ? 1 : 0) - (keys.down ? 1 : 0) + joy.y, -1, 1) : 0;
    game.clockS += dt;
    if (game.started) regen(health, dt);
    if (health.hp <= 0) g.knockedOut(); // here, not where the hit lands: that can be halfway through moving the car
    if (game.titleCardT > 0) {
      game.titleCardT -= dt;
      if (game.titleCardT <= 0) g.hideTitleCard();
    }
    if (game.ramCool > 0) game.ramCool -= dt;
    g.updateTrisslott(dt);
    g.updatePlaces(dt);

    const jump = game.jumpQ;
    game.jumpQ = false;
    if (game.inCar && game.pcar) {
      g.drive(game.pcar, my, mx, !!keys.brake, dt, true);
      ride(player, game.pcar);
      player.emote = null;
    } else {
      walk(
        player,
        dt,
        mx,
        my,
        view.camYaw,
        {
          run: !!keys.run || joy.on,
          wet: g.inWater(player.x, player.z),
          still: game.titleCardT > 0 || !!places.inside,
        },
        g.half,
      );
      g.collide(player, 0.5);
      if (!places.inside)
        for (const c of cars) {
          if (Math.abs(player.x - c.x) > c.T.lengthM || Math.abs(player.z - c.z) > c.T.lengthM) continue;
          nearestOnSpine(c, player.x, player.z, _onCar);
          const dx = player.x - _onCar.x,
            dz = player.z - _onCar.z,
            d = Math.hypot(dx, dz),
            apart = bodyRadius(c) + PERSON_RADIUS_M;
          if (d < apart && d > 0.01) {
            player.x += (dx / d) * (apart - d);
            player.z += (dz / d) * (apart - d);
            const a = c.mode === 'ai' ? c.h : c.vh,
              n = runOverHurt(impactSpeed(Math.sin(a) * c.v, -Math.cos(a) * c.v, -dx / d, -dz / d)); // the car's speed towards you
            if (n > 0 && game.clockS - this.runOverAt >= CRASH_COOL_S) {
              this.runOverAt = game.clockS;
              g.hurtPlayer(n);
              g.shake(n);
              if (health.hp <= 0) break;
            }
          }
        }
      const wetNow = g.inWater(player.x, player.z); // after this frame's move: take-off and wading depth follow where the player stands now
      hop(player, dt, jump && !wetNow && !places.inside && game.titleCardT <= 0); // on foot, Space and the touch Brake button jump
      // moving, jumping, Gripen! or Däckad! and a safehouse end an emote at once (#296)
      stepEmote(player, dt, player.speed > 0 || player.y > 0 || game.titleCardT > 0 || !!places.inside);
      const e = player.emote,
        at = e ? g.pose.emote(e.id, e.t) : g.pose.walk(player.phase, player.y > 0),
        lift = player.y + at.lift,
        m = player.mesh;
      m.blob.position.y = 0.06 - lift; // the blob shadow stays flat on the ground
      m.blob.rotation.x = -at.lean;
      m.position.set(player.x, g.groundAt(player.x, player.z) - (wetNow ? 0.95 : 0) + lift, player.z);
      m.rotation.set(at.lean, -player.h + at.twist, 0, 'YXZ'); // heading last, so the lean is forward whichever way you face
    }
    g.updateDriftFx(game.inCar ? game.pcar : null);
    const T = game.inCar && game.pcar ? game.pcar : player;
    g.updateVehicles(T, dt);
    g.updateSmoke(dt, T);
    g.updateBanknotes(dt);
    g.updateConfetti(dt);
    for (const c of cars) if (c.mode === 'ai') g.updateTraffic(c as TrafficCar, dt); // spawnTraffic gives every 'ai' car its place on the road
    g.updateNpcs(T, dt);
    g.updateCats(T, dt);
    if (g.wanted.update(dt, T, player.speed)) {
      this.blinkT += dt;
      if (this.blinkT > BLINK_S) {
        this.blinkT = 0;
        this.blink = !this.blink;
        g.barMat.color.copy(g.barColours[this.blink ? 1 : 0]);
      }
    }
    g.updateDrivers(T, dt);
    g.updateBodies(T, dt);

    g.updateDaylight(dt);
    g.cameraRig.update(T, now, dt);

    // HUD
    g.drawHearts(dt);
    g.updateHud(dt);
    if (!g.toasting && this.laterLine && game.titleCardT <= 0) {
      g.toast(this.laterLine, 3);
      this.laterLine = null;
    }
    this.signT -= dt;
    if (this.signT <= 0) {
      this.signT = SIGN_S;
      g.updateSign(T);
      g.catRideLines();
      g.closeMenuIfLeft();
      g.updatePrompt();
      g.drawHealth();
    }
    g.drawMini(T);
    if (this.style) this.style.render(g.scene, g.camera);
    else g.renderer.render(g.scene, g.camera);
    g.timeFrame(workStart);
  };
}
