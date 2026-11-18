// HUD: toasts, wanted stars, the minimap and the street sign. DOM over the canvas.
// Moved from src/game/main.ts (#177); main.ts passes in what the HUD reads from the rest of the game.
import type { Label } from '../world/data';
import type { RoadNetwork } from '../world/roads';

const MR = 210;   // the minimap shows this far around the player (m)

type Point = { x: number; z: number };

/** What the HUD reads from the rest of the game. The getters are read when used, so main.ts can declare those later. */
export interface HudDeps {
  $(id: string): HTMLElement;
  ground: HTMLCanvasElement;             // the painted ground texture the minimap is cut from
  P(v: number): number;                  // world x or z (m) to a pixel on `ground`
  K: number;                             // pixels of `ground` per metre
  roads: Pick<RoadNetwork, 'nearestRoad' | 'lines'>;
  labels: readonly Label[];
  cars: readonly (Point & { mode: string })[];
  places: readonly (Point & { kind: string })[];
  readonly stars: number;
  readonly pcar: unknown;                // the player's car, which the minimap leaves out
  readonly blink: boolean;               // the police lights' phase, so the minimap blinks with them
}

/** The HUD drawn over the canvas: shows toasts, the wanted stars, the minimap and the street sign. */
export class Hud {
  private readonly g: HudDeps;
  private readonly mctx: CanvasRenderingContext2D;
  private readonly MW: number;   // minimap side (px)
  private toastT = 0;            // s until the toast hides

  constructor(g: HudDeps) {
    this.g = g;
    const mini = g.$('mini') as HTMLCanvasElement;
    this.mctx = mini.getContext('2d') as CanvasRenderingContext2D;
    this.MW = mini.width;
  }

  /** whether a toast is showing */
  get toasting() { return this.toastT > 0; }

  toast(msg: string, secs?: number, cls?: string) { const t = this.g.$('toast'); t.textContent = msg; t.className = 'plate' + (cls ? ' ' + cls : ''); t.hidden = false; t.style.opacity = '1'; this.toastT = secs || 3.5; }

  hideToast() { this.toastT = 0; this.g.$('toast').hidden = true; }

  /** Fades the toast out at the end of its time. */
  update(dt: number) { const { $ } = this.g; if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0.3) $('toast').style.opacity = '0'; if (this.toastT <= 0) $('toast').hidden = true; } }

  drawStars() { const el = this.g.$('stars'); el.textContent = '';
    for (let i = 0; i < 3; i++) { const s = document.createElement(i < this.g.stars ? 'b' : 'span'); s.textContent = '★'; el.appendChild(s); } }

  /** T is where the player (or their car) is, and its heading `h`. */
  drawMini(T: Point & { h: number }) {
    const { mctx, MW } = this, { ground, P, K, cars, pcar, blink, places } = this.g;
    mctx.fillStyle = '#6f9a5e'; mctx.fillRect(0, 0, MW, MW);
    mctx.drawImage(ground, P(T.x - MR), P(T.z - MR), MR * 2 * K, MR * 2 * K, 0, 0, MW, MW);
    const q = (v: number) => (v / MR * 0.5 + 0.5) * MW;
    for (const c of cars) { const dx = c.x - T.x, dz = c.z - T.z; if (c === pcar || Math.abs(dx) > MR || Math.abs(dz) > MR) continue;
      mctx.fillStyle = c.mode === 'police' ? (blink ? '#2f6bff' : '#ff3b30') : '#ffffff'; const s = c.mode === 'police' ? 12 : 6;
      mctx.fillRect(q(dx) - s / 2, q(dz) - s / 2, s, s); }
    mctx.lineWidth = 3; mctx.strokeStyle = '#1a1a14';
    for (const p of places) { let dx = p.x - T.x, dz = p.z - T.z; const L = Math.hypot(dx, dz), edge = MR * 0.88;
      if (L > edge) { if (p.kind !== 'safe') continue; dx *= edge / L; dz *= edge / L; }        // safehouses stay pinned to the rim so they can be found
      const x = q(dx), y = q(dz); mctx.beginPath();
      if (p.kind === 'safe') { mctx.moveTo(x, y - 12); mctx.lineTo(x + 11, y - 2); mctx.lineTo(x + 8, y - 2); mctx.lineTo(x + 8, y + 9); mctx.lineTo(x - 8, y + 9); mctx.lineTo(x - 8, y - 2); mctx.lineTo(x - 11, y - 2); mctx.closePath(); mctx.fillStyle = '#4fd27a'; }
      else { mctx.arc(x, y, 8, 0, Math.PI * 2); mctx.fillStyle = '#f2c230'; }
      mctx.stroke(); mctx.fill(); }
    mctx.save(); mctx.translate(MW / 2, MW / 2); mctx.rotate(T.h);
    mctx.fillStyle = '#f2c230'; mctx.strokeStyle = '#1a1a14'; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.moveTo(0, -15); mctx.lineTo(10, 11); mctx.lineTo(0, 5); mctx.lineTo(-10, 11); mctx.closePath(); mctx.stroke(); mctx.fill(); mctx.restore();
  }

  /** The street sign: the road under T, else the nearest place name, else Vrigstad. */
  updateSign(T: Point) {
    const { $, roads, labels } = this.g, n = roads.nearestRoad(T.x, T.z), R = roads.lines; let best: Label | null = null, bd = 130;
    for (const l of labels) { const d = Math.hypot(l.x - T.x, l.z - T.z); if (d < bd) { bd = d; best = l; } }
    $('street').textContent = n.ri >= 0 && n.d < 9 && R[n.ri].n ? R[n.ri].n : best && bd < 45 ? best.t : 'Vrigstad';
    $('near').textContent = best && $('street').textContent !== best.t ? 'near ' + best.t : '';
  }
}
