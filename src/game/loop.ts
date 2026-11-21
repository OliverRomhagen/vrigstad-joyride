// The main loop: every frame it reads the controls, moves the player (or their car), steps traffic, pedestrians, cats
// and the police, places the camera, updates the HUD and renders. Also the Start button and fitting the canvas.
// DOM over the canvas. Moved from src/game/main.ts (#177); main.ts passes in the modules it steps.
import type * as THREE from 'three';
import { clamp } from '../world/math';
import type { Car, Fleet, TrafficCar } from './cars';
import { CRASH_COOL_S, type Health, impactSpeed, regen, runOverHurt } from './health';
import type { Input } from './input';
import type { Places } from './places';
import { hop, type PlayerState, ride, walk } from './player';
import type { Wanted } from './police';
import type { CameraRig } from './render/camera-rig';
import type { Person } from './render/models';
import type { GameState, ViewState } from './state';

type Point = { x: number; z: number };
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
  player: PlayerState & { mesh: Person };
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
  drawHearts(dt: number): void;
  updateHud(dt: number): void;
  drawMini(T: Point & { h: number }): void;
  // a few times a second
  updateSign(T: Point): void;
  catRideLines(): void;
  closeMenuIfLeft(): void;
  updatePrompt(): void;
  drawHealth(): void;
}

/** Runs the game: `start` begins the frames, `startGame` is the Start button. */
export class GameLoop {
  private readonly g: GameLoopDeps;
  private last = performance.now();
  private runOverAt = -9; // the player's own cooldown for being run over, apart from the cars' crash cooldowns
  private signT = 0;
  private blinkT = 0;
  private laterLine: string | null = null;
  /** the police lights' phase, so the minimap blinks with them */
  blink = false;

  constructor(g: GameLoopDeps) {
    this.g = g;
  }

  // a line that waits for the toast and any big screen to clear, so it doesn't cut off what was just said
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
        $,
        game,
        view,
        player,
        health,
        places,
        cars,
        input: { keys, joy },
      } = g;
    requestAnimationFrame(this.frame);
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    const mx = game.started ? clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joy.x, -1, 1) : 0,
      my = game.started ? clamp((keys.up ? 1 : 0) - (keys.down ? 1 : 0) + joy.y, -1, 1) : 0;
    game.clockS += dt;
    if (game.started) regen(health, dt);
    if (health.hp <= 0) g.knockedOut(); // here, not where the hit lands: that can be halfway through moving the car
    if (game.bigT > 0) {
      game.bigT -= dt;
      if (game.bigT <= 0) $('big').hidden = true;
    }
    if (game.ramCool > 0) game.ramCool -= dt;
    g.updateTrisslott(dt);
    g.updatePlaces(dt);

    const jump = game.jumpQ;
    game.jumpQ = false;
    if (game.inCar && game.pcar) {
      g.drive(game.pcar, my, mx, !!keys.brake, dt, true);
      ride(player, game.pcar);
    } else {
      walk(
        player,
        dt,
        mx,
        my,
        view.camYaw,
        { run: !!keys.run || joy.on, wet: g.inWater(player.x, player.z), still: game.bigT > 0 || !!places.inside },
        g.half,
      );
      g.collide(player, 0.5);
      if (!places.inside)
        for (const c of cars) {
          const dx = player.x - c.x,
            dz = player.z - c.z,
            d = Math.hypot(dx, dz);
          if (d < 1.6 && d > 0.01) {
            player.x += (dx / d) * (1.6 - d);
            player.z += (dz / d) * (1.6 - d);
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
      hop(player, dt, jump && !wetNow && !places.inside && game.bigT <= 0); // on foot, Space and the touch Brake button jump
      // walking: arms swing against the legs and the body bobs; in the air: legs apart and both arms up
      const air = player.y > 0,
        sw = air ? 0.5 : Math.sin(player.phase) * 0.75,
        lift = player.y + (air ? 0 : Math.abs(Math.sin(player.phase)) * 0.05),
        m = player.mesh,
        arms = m.arms!;
      m.legs[0].rotation.x = sw;
      m.legs[1].rotation.x = -sw;
      arms[0].rotation.x = air ? 2.4 : -sw * 0.8;
      arms[1].rotation.x = air ? 2.4 : sw * 0.8;
      m.blob.position.y = 0.06 - lift; // the blob shadow stays on the ground
      m.position.set(player.x, g.groundAt(player.x, player.z) - (wetNow ? 0.95 : 0) + lift, player.z);
      m.rotation.y = -player.h;
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

    g.cameraRig.update(T, now, dt);

    // HUD
    g.drawHearts(dt);
    g.updateHud(dt);
    if (!g.toasting && this.laterLine && game.bigT <= 0) {
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
    g.renderer.render(g.scene, g.camera);
  };
}
