import { describe, expect, it } from 'vitest';
import { debugOn, FRAMES_KEPT, FrameStats } from '../../../src/debug/frame-stats';
import { errorLine } from '../../../src/debug/overlay';

// Frames of `ms` each from t = 0, `n` of them, all with `work` ms of our own work; returns when the last one ended.
function run(s: FrameStats, n: number, ms: number, work = 2, from = 0): number {
  let t = from;
  for (let i = 0; i < n; i++) { t += ms; s.push(t, ms, work); }
  return t;
}

describe('debugOn', () => {
  it('is on for ?debug and ?debug=1, off without it or with ?debug=0', () => {
    expect(debugOn('?debug')).toBe(true);
    expect(debugOn('?lab=ragdoll&debug=1')).toBe(true);
    expect(debugOn('')).toBe(false);
    expect(debugOn('?debug=0')).toBe(false);
    expect(debugOn('?debugger')).toBe(false);
  });
});

describe('FrameStats', () => {
  it('counts the frames of the last second as fps', () => {
    const s = new FrameStats();
    const t = run(s, 120, 1000 / 60);
    expect(s.fps(t)).toBe(60);
  });

  it('shows one slow frame that the average hides, then forgets it after two seconds', () => {
    const s = new FrameStats();
    let t = run(s, 60, 10);
    t += 80; s.push(t, 80, 70);
    t = run(s, 60, 10, 2, t);
    expect(s.fps(t)).toBeGreaterThan(90);
    expect(s.worst(t)).toBe(80);
    t = run(s, 200, 10, 2, t);
    expect(s.worst(t)).toBe(10);
  });

  it('averages our own work per frame', () => {
    const s = new FrameStats();
    const t = run(s, 50, 20, 4);
    expect(s.workMs(t)).toBeCloseTo(4);
  });

  it('gives frame times newest first, and 0 past what it keeps', () => {
    const s = new FrameStats();
    s.push(10, 10, 1); s.push(30, 20, 1);
    expect(s.frameMs(0)).toBe(20);
    expect(s.frameMs(1)).toBe(10);
    expect(s.frameMs(2)).toBe(0);
    run(s, FRAMES_KEPT + 5, 5, 1, 30);
    expect(s.frameMs(FRAMES_KEPT - 1)).toBe(5);
    expect(s.frameMs(FRAMES_KEPT)).toBe(0);
  });

  it('is empty before the first frame', () => {
    const s = new FrameStats();
    expect([s.fps(0), s.worst(0), s.workMs(0)]).toEqual([0, 0, 0]);
  });
});

describe('errorLine', () => {
  it('names the file and line of an uncaught error', () => {
    expect(errorLine({ message: 'boom', filename: 'https://x.test/assets/index.html', lineno: 12 })).toBe('boom (index.html:12)');
  });

  it('says what a rejection was rejected with', () => {
    expect(errorLine({ reason: new Error('no glb') })).toBe('Unhandled rejection: no glb');
    expect(errorLine({ reason: 'timeout' })).toBe('Unhandled rejection: timeout');
  });
});
