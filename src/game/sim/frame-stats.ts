// Frame timings for the fps overlay (#356, from #257): a ring of the last frames, so it can show drops that an average fps
// hides. Plain numbers, no DOM, so the tests can feed it made-up frames.

export const FRAMES_KEPT = 360; // frames remembered: 3 s at 120 Hz
const FPS_WINDOW_MS = 1000; // fps counts the frames in this long
const WORST_WINDOW_MS = 2000; // the slowest frame is looked for in this long

/** The last FRAMES_KEPT frames: when each ended, how long it took (ms) and how much of that was our own work (ms). */
export class FrameStats {
  private readonly at = new Float64Array(FRAMES_KEPT);
  private readonly ms = new Float32Array(FRAMES_KEPT);
  private readonly work = new Float32Array(FRAMES_KEPT);
  private head = 0; // where the next frame goes
  private count = 0;

  /** Records a frame that ended at `now` (ms, performance.now), took `frameMs` since the last one, and spent `workMs` in our code. */
  push(now: number, frameMs: number, workMs: number): void {
    this.at[this.head] = now;
    this.ms[this.head] = frameMs;
    this.work[this.head] = workMs;
    this.head = (this.head + 1) % FRAMES_KEPT;
    this.count = Math.min(this.count + 1, FRAMES_KEPT);
  }

  /** Frames ended in the last FPS_WINDOW_MS before `now`. */
  fps(now: number): number {
    let n = 0;
    this.each(FPS_WINDOW_MS, now, () => n++);
    return (n * 1000) / FPS_WINDOW_MS;
  }

  /** The longest frame (ms) in the last WORST_WINDOW_MS before `now`; 0 with none. */
  worst(now: number): number {
    let w = 0;
    this.each(WORST_WINDOW_MS, now, i => {
      w = Math.max(w, this.ms[i]);
    });
    return w;
  }

  /** The average work per frame (ms) in the last FPS_WINDOW_MS before `now`; 0 with none. */
  workMs(now: number): number {
    let sum = 0,
      n = 0;
    this.each(FPS_WINDOW_MS, now, i => {
      sum += this.work[i];
      n++;
    });
    return n ? sum / n : 0;
  }

  /** The frame time (ms) `back` frames ago: 0 is the newest. 0 past what is kept. */
  frameMs(back: number): number {
    return back < this.count ? this.ms[(this.head - 1 - back + FRAMES_KEPT) % FRAMES_KEPT] : 0;
  }

  // the kept frames that ended within `windowMs` before `now`, newest first
  private each(windowMs: number, now: number, f: (i: number) => void) {
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - 1 - k + FRAMES_KEPT) % FRAMES_KEPT;
      if (this.at[i] <= now - windowMs) break;
      f(i);
    }
  }
}
