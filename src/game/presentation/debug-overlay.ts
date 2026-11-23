// The dev overlay (#356, from the closed #257): the console's `fps` shows frame times as a graph, fps and the slowest
// recent frame, what the renderer drew and the build. Uncaught errors show in a red box whenever it exists (dev mode),
// since a phone has no devtools to show them; a tap on the box, or `errors clear`, empties it.
import { command, group, optional, toggle } from '../command-args';
import type { Commands } from '../commands';
import { FrameStats } from '../sim/frame-stats';

const TEXT_EVERY_MS = 250; // the numbers change this often, so they can be read
const GRAPH_FRAMES = 120; // bars in the graph, one per frame
const GRAPH_MAX_MS = 50; // a frame this long fills the graph's height
const BUDGET_60_MS = 1000 / 60,
  BUDGET_30_MS = 1000 / 30;
const ERRORS_KEPT = 5;
// the graph's bars, by the budget a frame kept, and its budget lines; a canvas can't read the page's CSS tokens
const BAR_60_FPS = '#7fc97f',
  BAR_30_FPS = '#f0c050',
  BAR_SLOWER = '#f05a4a',
  BUDGET_LINE = 'rgba(255, 255, 255, .45)';

/** The part of three's `renderer.info` the overlay reads. */
export interface RenderInfo {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

const CSS = `
/* the colours are the game page's tokens (src/index.html); the error box darkens --alarm so its small text reads */
#debug { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 50;
  pointer-events: none; font: 500 11px/1.35 ui-monospace, Menlo, Consolas, monospace; color: var(--ink); font-variant-numeric: tabular-nums;
  display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: min(92vw, 420px); }
#debug-stats { background: var(--hud); border-radius: 4px; padding: 4px 6px; white-space: pre; }
#debug-graph { display: block; width: 120px; height: 36px; margin-bottom: 3px; }
#debug-errors { pointer-events: auto; cursor: pointer; background: color-mix(in srgb, var(--alarm) 60%, black); color: var(--ink); border-radius: 4px; padding: 4px 8px; white-space: pre-wrap; word-break: break-word; }
#debug-errors:empty { display: none; }
/* a phone held upright has the minimap, hearts and stars across the top, and toasts under them: go below those */
@media (max-width: 600px) { #debug { top: calc(250px + env(safe-area-inset-top, 0px)); } }
/* a phone on its side has the toasts at 22% of very little height: drop the graph so the numbers end above them */
@media (max-height: 500px) and (min-width: 601px) { #debug-graph { display: none; } }
`;

/** Formats an uncaught error event, or a rejection's reason, as one line. */
export function errorLine(e: { message?: string; filename?: string; lineno?: number; reason?: unknown }): string {
  if ('reason' in e) {
    const r = e.reason;
    return 'Unhandled rejection: ' + (r instanceof Error ? r.message : describe(r));
  }
  const file = e.filename ? e.filename.split('/').pop() : '';
  return (e.message || 'Error') + (file ? ' (' + file + (e.lineno ? ':' + e.lineno : '') + ')' : '');
}

const REASON_MAX = 200; // characters of a rejection's reason, so one big object can't fill the screen

// a rejection's reason can be anything: String() makes a plain object "[object Object]", and JSON.stringify throws on a
// cycle or a BigInt, and says less than String() about an Event ({"isTrusted":true}) or an object of getters ({})
function describe(r: unknown): string {
  let s = String(r);
  if (typeof r === 'object' && r !== null)
    try {
      const json = JSON.stringify(r);
      if (json && json !== '{}' && json !== '{"isTrusted":true}') s = json;
    } catch {}
  return s.length > REASON_MAX ? s.slice(0, REASON_MAX - 1) + '…' : s;
}

/** The overlay. Build it early, so it catches errors from the rest of the start-up, and call `frame` once per frame. */
export class DebugOverlay {
  private readonly stats = new FrameStats();
  private readonly statsEl: HTMLElement;
  private readonly text: HTMLElement;
  private readonly errorsEl: HTMLElement;
  private readonly graph: CanvasRenderingContext2D | null;
  private readonly errors: { line: string; n: number }[] = [];
  private readonly build: string;
  private last = -1; // when the previous frame ended (ms); -1 while the stats are hidden
  private textAt = 0; // when the numbers were last written (ms)

  constructor(parent: HTMLElement, build: string, target: Window = window) {
    this.build = build;
    const doc = parent.ownerDocument,
      style = doc.createElement('style'),
      root = doc.createElement('div');
    style.textContent = CSS;
    root.id = 'debug';
    this.statsEl = doc.createElement('div');
    this.statsEl.id = 'debug-stats';
    this.statsEl.hidden = true;
    const graph = doc.createElement('canvas');
    graph.id = 'debug-graph';
    graph.width = GRAPH_FRAMES * 2;
    graph.height = 72;
    this.graph = graph.getContext('2d');
    this.text = doc.createElement('div');
    this.text.textContent = 'build ' + build;
    this.errorsEl = doc.createElement('div');
    this.errorsEl.id = 'debug-errors';
    this.statsEl.append(graph, this.text);
    root.append(this.statsEl, this.errorsEl);
    doc.head.append(style);
    parent.append(root);
    this.errorsEl.addEventListener('click', () => this.clearErrors());
    target.addEventListener('error', e => this.error(errorLine(e)));
    target.addEventListener('unhandledrejection', e => this.error(errorLine(e)));
  }

  /** Whether the frame times show. */
  get shown() {
    return !this.statsEl.hidden;
  }

  /** The dev console's `fps [on]`, which flips on its own, and `errors clear`. */
  registerCommands(commands: Pick<Commands, 'register'>) {
    commands.register(
      'fps',
      command({
        help: 'show frame times, what the renderer draws and the build',
        details:
          'Work is the time the game’s own code takes a frame: a slow frame with little work is the GPU or browser.',
        examples: ['fps', 'fps off'],
        args: [optional(toggle('on'))],
        run: ({ on }) => {
          this.statsEl.hidden = !(on ?? !this.shown);
          this.last = -1; // the time it was hidden isn't a frame
          return this.shown ? 'Frame times on.' : 'Frame times off.';
        },
      }),
    );
    commands.register(
      'errors',
      group({
        help: 'the red box of uncaught errors in dev mode',
        examples: ['errors clear'],
        subcommands: {
          clear: command({
            help: 'empty the red box of uncaught errors',
            examples: ['errors clear'],
            args: [],
            run: () => {
              this.clearErrors();
              return 'Errors cleared.';
            },
          }),
        },
      }),
    );
  }

  private clearErrors(): void {
    this.errors.length = 0;
    this.errorsEl.textContent = '';
  }

  /** Records the frame that ends now (ms, performance.now) after `workMs` of our own work, and redraws. */
  frame(now: number, workMs: number, info: RenderInfo): void {
    if (!this.shown) return;
    if (this.last >= 0) this.stats.push(now, now - this.last, workMs);
    this.last = now;
    this.drawGraph();
    if (now - this.textAt < TEXT_EVERY_MS) return;
    this.textAt = now;
    const s = this.stats,
      r = info.render,
      m = info.memory;
    this.text.textContent =
      `${Math.round(s.fps(now))} fps · worst ${s.worst(now).toFixed(1)} ms · work ${s.workMs(now).toFixed(1)} ms\n` +
      `${r.calls} calls · ${(r.triangles / 1000).toFixed(0)}k tris · ${m.geometries} geo · ${m.textures} tex\n` +
      `build ${this.build}`;
  }

  /** Shows an error line; a repeat counts up instead of filling the box. */
  private error(line: string): void {
    const seen = this.errors.find(e => e.line === line);
    if (seen) seen.n++;
    else {
      this.errors.push({ line, n: 1 });
      if (this.errors.length > ERRORS_KEPT) this.errors.shift();
    }
    this.errorsEl.textContent = this.errors.map(e => (e.n > 1 ? e.n + '× ' : '') + e.line).join('\n');
  }

  // one bar per frame, newest on the right, with lines at the 60 and 30 fps budgets
  private drawGraph() {
    const g = this.graph;
    if (!g) return;
    const w = g.canvas.width,
      h = g.canvas.height,
      bw = w / GRAPH_FRAMES,
      y = (ms: number) => h - Math.min(1, ms / GRAPH_MAX_MS) * h;
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < GRAPH_FRAMES; k++) {
      const ms = this.stats.frameMs(k);
      if (!ms) break;
      g.fillStyle = ms <= BUDGET_60_MS + 1 ? BAR_60_FPS : ms <= BUDGET_30_MS + 1 ? BAR_30_FPS : BAR_SLOWER;
      g.fillRect(w - (k + 1) * bw, y(ms), bw, h - y(ms));
    }
    g.fillStyle = BUDGET_LINE;
    g.fillRect(0, Math.round(y(BUDGET_60_MS)), w, 1);
    g.fillRect(0, Math.round(y(BUDGET_30_MS)), w, 1);
  }
}
