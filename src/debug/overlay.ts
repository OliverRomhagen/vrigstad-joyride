// The debug overlay (?debug; part of #53): frame times as a graph, fps and the slowest recent frame, what the renderer drew,
// the build, and any uncaught errors in a red box, since a phone has no devtools to show them.
// The console (#218) will switch the same overlay with its `fps` command.
import { FrameStats } from './frame-stats';

const TEXT_EVERY_MS = 250;           // the numbers change this often, so they can be read
const GRAPH_FRAMES = 120;            // bars in the graph, one per frame
const GRAPH_MAX_MS = 50;             // a frame this long fills the graph's height
const BUDGET_60_MS = 1000 / 60, BUDGET_30_MS = 1000 / 30;
const ERRORS_KEPT = 5;

/** The part of three's `renderer.info` the overlay reads. */
export interface RenderInfo {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

const CSS = `
#debug { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 50;
  pointer-events: none; font: 500 11px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #e8f0e0; font-variant-numeric: tabular-nums;
  display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: min(92vw, 420px); }
#debug-stats { background: rgba(10, 14, 12, .72); border-radius: 4px; padding: 4px 6px; white-space: pre; }
#debug-graph { display: block; width: 120px; height: 36px; margin-bottom: 3px; }
#debug-errors { background: rgba(150, 20, 20, .9); color: #fff; border-radius: 4px; padding: 4px 8px; white-space: pre-wrap; word-break: break-word; }
#debug-errors:empty { display: none; }
`;

/** Formats an uncaught error event, or a rejection's reason, as one line. */
export function errorLine(e: { message?: string; filename?: string; lineno?: number; reason?: unknown }): string {
  if ('reason' in e) { const r = e.reason; return 'Unhandled rejection: ' + (r instanceof Error ? r.message : String(r)); }
  const file = e.filename ? e.filename.split('/').pop() : '';
  return (e.message || 'Error') + (file ? ' (' + file + (e.lineno ? ':' + e.lineno : '') + ')' : '');
}

/** The overlay. Build it early, so it catches errors from the rest of the start-up, and call `frame` once per frame. */
export class DebugOverlay {
  readonly stats = new FrameStats();
  private readonly text: HTMLElement;
  private readonly errorsEl: HTMLElement;
  private readonly graph: CanvasRenderingContext2D | null;
  private readonly errors: { line: string; n: number }[] = [];
  private readonly build: string;
  private last = -1;       // when the previous frame ended (ms)
  private textAt = 0;      // when the numbers were last written (ms)

  constructor(parent: HTMLElement, build: string, target: Window = window) {
    this.build = build;
    const doc = parent.ownerDocument, style = doc.createElement('style'), root = doc.createElement('div'), stats = doc.createElement('div');
    style.textContent = CSS;
    root.id = 'debug'; stats.id = 'debug-stats';
    const graph = doc.createElement('canvas');
    graph.id = 'debug-graph'; graph.width = GRAPH_FRAMES * 2; graph.height = 72;
    this.graph = graph.getContext('2d');
    this.text = doc.createElement('div');
    this.errorsEl = doc.createElement('div'); this.errorsEl.id = 'debug-errors';
    stats.append(graph, this.text); root.append(stats, this.errorsEl);
    doc.head.append(style); parent.append(root);
    this.text.textContent = 'build ' + build;
    target.addEventListener('error', e => this.error(errorLine(e)));
    target.addEventListener('unhandledrejection', e => this.error(errorLine(e)));
  }

  /** Records the frame that ends now (ms, performance.now) after `workMs` of our own work, and redraws. */
  frame(now: number, workMs: number, info: RenderInfo): void {
    if (this.last >= 0) this.stats.push(now, now - this.last, workMs);
    this.last = now;
    this.drawGraph();
    if (now - this.textAt < TEXT_EVERY_MS) return;
    this.textAt = now;
    const s = this.stats, r = info.render, m = info.memory;
    this.text.textContent = Math.round(s.fps(now)) + ' fps · worst ' + s.worst(now).toFixed(1) + ' ms · work ' + s.workMs(now).toFixed(1) + ' ms\n'
      + r.calls + ' calls · ' + (r.triangles / 1000).toFixed(0) + 'k tris · ' + m.geometries + ' geo · ' + m.textures + ' tex\n'
      + 'build ' + this.build;
  }

  /** Shows an error line; a repeat counts up instead of filling the box. */
  error(line: string): void {
    const seen = this.errors.find(e => e.line === line);
    if (seen) seen.n++;
    else { this.errors.push({ line, n: 1 }); if (this.errors.length > ERRORS_KEPT) this.errors.shift(); }
    this.errorsEl.textContent = this.errors.map(e => (e.n > 1 ? e.n + '× ' : '') + e.line).join('\n');
  }

  // one bar per frame, newest on the right, with lines at the 60 and 30 fps budgets
  private drawGraph() {
    const g = this.graph;
    if (!g) return;
    const w = g.canvas.width, h = g.canvas.height, bw = w / GRAPH_FRAMES, y = (ms: number) => h - Math.min(1, ms / GRAPH_MAX_MS) * h;
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < GRAPH_FRAMES; k++) {
      const ms = this.stats.frameMs(k);
      if (!ms) break;
      g.fillStyle = ms <= BUDGET_60_MS + 1 ? '#7fc97f' : ms <= BUDGET_30_MS + 1 ? '#f0c050' : '#f05a4a';
      g.fillRect(w - (k + 1) * bw, y(ms), bw, h - y(ms));
    }
    g.fillStyle = 'rgba(255, 255, 255, .45)';
    g.fillRect(0, Math.round(y(BUDGET_60_MS)), w, 1); g.fillRect(0, Math.round(y(BUDGET_30_MS)), w, 1);
  }
}
