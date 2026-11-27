import { afterEach, describe, expect, it } from 'vitest';
import { type CaptureHookDeps, installCaptureHook } from '../../../src/game/capture-hook';

const win = globalThis as unknown as { window?: unknown; __cam?: unknown };
afterEach(() => {
  delete win.window;
});

describe('installCaptureHook', () => {
  it('refreshes what follows the camera after the rig moves it, and before the frame is drawn', () => {
    const calls: string[] = [];
    const w: { __cam?: () => void } = {};
    win.window = w;
    const renderer = { render: () => calls.push('render') },
      deps = {
        renderer,
        camera: {},
        game: { inCar: false, pcar: null },
        player: { x: 0, z: 0 },
        followCamera: () => calls.push('follow'),
      } as unknown as CaptureHookDeps;
    installCaptureHook(deps, '?capture');
    renderer.render();
    expect(calls).toEqual(['render']); // no rig camera yet: the game's own placement stands
    w.__cam = () => calls.push('cam');
    calls.length = 0;
    renderer.render();
    expect(calls).toEqual(['cam', 'follow', 'render']);
  });
});
