// The capture hook for the teaser and poster rig (tools/trailer): with ?capture, the game's internals go on window.__G so
// the rig can stage shots, and window.__cam, when the rig sets it, places the camera just before each frame is drawn.
// Unlike the test hook it writes to the game. It replaces splicing hooks into main.ts's text, which broke whenever code
// moved out of it (#177): a name that moves now fails the typecheck instead of the rig.
import type * as THREE from 'three';
import type { GameState } from './state';

type Point = { x: number; z: number };
type CaptureWindow = { __G?: unknown; __cam?: ((camera: THREE.PerspectiveCamera, target: Point) => void) | null };

/** What the rig reads and drives. tools/trailer/inpage.js and shots.js use these names. */
export interface CaptureHookDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  game: GameState;
  player: Point;
  [name: string]: unknown;
}

/** Installs the hook when the page's query has `capture`; otherwise does nothing. */
export function installCaptureHook(g: CaptureHookDeps, search: string) {
  if (!new URLSearchParams(search).has('capture')) return;
  const win = window as unknown as CaptureWindow,
    { renderer, camera, game, player } = g,
    render = renderer.render.bind(renderer);
  // after the game has placed its camera, so the rig's camera wins; the target is what the game's camera follows (loop.ts)
  renderer.render = (scene, cam) => {
    win.__cam?.(camera, game.inCar && game.pcar ? game.pcar : player);
    render(scene, cam);
  };
  win.__G = g;
}
