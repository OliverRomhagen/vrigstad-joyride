// The camera: it circles the village behind the intro, follows you on foot, and swings in behind the car while you
// drive; a crash shakes it. The sun's shadow and the sky dome follow it.
// Moved from src/game/main.ts (#177); main.ts passes in the camera, the sun, the sky and the shared view state.
import type * as THREE from 'three';
import { clamp, wrap } from '../../world/math';
import type { GameState, ViewState } from '../state';
import type { Sky } from './sky';
import { SUN_DIR } from './stage';

type Point = { x: number; z: number };

// camera shake on a crash: a jolt that dies away, bigger for a harder hit; none with reduced motion
const SHAKE_S = 0.45,
  SHAKE_MIN_M = 0.08,
  SHAKE_MAX_M = 0.5,
  SHAKE_PER_DMG_M = 1 / 150; // s it lasts; camera offset (m) at the smallest and largest hit, and per point of car damage
const ZOOM_MIN = 0.6,
  ZOOM_MAX = 2; // camera zoom (#208), times the normal camera distance

/** What the camera reads from the rest of the game. The getters are read every frame. */
export interface CameraRigDeps {
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  skyDome: Sky;
  game: Pick<GameState, 'started' | 'inCar' | 'pcar'>;
  view: ViewState;
  readonly dragging: boolean; // looking around by touch: the view doesn't swing back ahead meanwhile
  readonly inside: boolean; // in a safehouse: the camera pulls back
  groundAt(x: number, z: number): number;
  heightAt(x: number, z: number): number; // the terrain, which the camera stays above
  rnd(): number; // the shake's own stream, shared with the smoke, since both roll every frame
  calmMotion: { readonly matches: boolean }; // prefers-reduced-motion
  readonly sunIntensity: number; // the sun's intensity for the time of day under a clear sky (Daylight.sunIntensity)
  readonly showroom?: boolean; // a garage menu is open (#3): the camera stays where you drag it round the car you drive
}
const SHOWROOM_DIST_M = 5.5, // close in: the workshop is narrow
  SHOWROOM_LOOK_M = -0.6, // aims under the car, which lifts it in the frame, above the menu plate at the bottom
  SHOWROOM_SIDE = -Math.PI / 2; // lookOff that puts the camera off the car's right side: its paint and rims side on

/** Places the camera every frame; `shake` jolts it after a crash. */
export class CameraRig {
  private readonly g: CameraRigDeps;
  private shakeT = 0;
  private shakeM = 0;
  private showing = false; // the garage's free camera was on last frame

  constructor(g: CameraRigDeps) {
    this.g = g;
  }

  shake = (dmg: number) => {
    if (this.g.calmMotion.matches) return;
    const m = Math.min(SHAKE_MAX_M, SHAKE_MIN_M + dmg * SHAKE_PER_DMG_M);
    if (this.shakeT <= 0 || m > this.shakeM) this.shakeM = m;
    this.shakeT = SHAKE_S;
  };

  /** Multiplies the camera distance by `factor` (above 1 is further out), within ZOOM_MIN..ZOOM_MAX. */
  zoom = (factor: number) => {
    this.g.view.zoom = clamp(this.g.view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  };

  /** Follows T, the player or the car they drive; `now` is the frame's time (ms), for the clouds. */
  update(T: Point, now: number, dt: number) {
    const { camera, sun, skyDome, game, view, groundAt, heightAt: hAt, rnd: dmgRnd } = this.g;
    let dist: number,
      lookY = 1.5, // m over the ground the camera aims at
      ty = groundAt(T.x, T.z);
    if (!game.started) {
      view.camYaw = wrap(view.camYaw + dt * 0.07);
      dist = 46;
      view.camPitch = 0.42;
    } else if (game.inCar && game.pcar && this.g.showroom) {
      // a free camera: it comes round to the car's right side as the garage opens, then dragging turns lookOff round
      // the parked car, and nothing swings it back while the garage is open
      if (!this.showing) view.lookOff = SHOWROOM_SIDE;
      view.camYaw += wrap(game.pcar.h + view.lookOff - view.camYaw) * Math.min(1, dt * 4);
      dist = SHOWROOM_DIST_M;
      lookY = SHOWROOM_LOOK_M;
      this.showing = true;
    } else if (game.inCar && game.pcar) {
      if (this.showing) view.lookOff = 0; // out of the garage: back behind the car now, not through the workshop's walls
      this.showing = false;
      view.lookIdle += dt;
      if (view.lookIdle > 1.2 && !this.g.dragging) view.lookOff *= 0.02 ** dt;
      view.camYaw += wrap(game.pcar.h - game.pcar.slip * 0.6 + view.lookOff - view.camYaw) * Math.min(1, dt * 4.5);
      dist = 10 + Math.abs(game.pcar.v) * 0.09;
    } else dist = this.g.inside ? 15 : 6.2;
    if (game.started) dist *= view.zoom;
    const cp = Math.cos(view.camPitch),
      cx = T.x - Math.sin(view.camYaw) * dist * cp,
      cz = T.z + Math.cos(view.camYaw) * dist * cp;
    camera.position.set(cx, Math.max(ty + 1.5 + dist * Math.sin(view.camPitch), hAt(cx, cz) + 0.8), cz);
    camera.lookAt(T.x, ty + lookY, T.z);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / SHAKE_S) ** 2 * this.shakeM * 2; // eases out, so the jolt fades instead of stopping dead
      camera.position.x += (dmgRnd() - 0.5) * k;
      camera.position.y += (dmgRnd() - 0.5) * k;
      camera.position.z += (dmgRnd() - 0.5) * k;
    }
    sun.target.position.set(T.x, ty, T.z);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 400);
    skyDome.update(camera.position, now / 1000, dt);
    sun.intensity = this.g.sunIntensity * skyDome.sunFactor; // also centres the dome; the time of day sets the base, a cloud in front of the sun takes some away
  }
}
