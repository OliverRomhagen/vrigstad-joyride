// Confetti over the game, for a winning trisslott: a 2D canvas laid over the screen, fired from party cannons in the bottom corners.
// UI only (DOM, no three.js); it draws nothing while no piece is left.

const CONFETTI_COLS = ['#f2c230', '#e5412d', '#3f7fd8', '#4fd27a', '#f07ac0', '#ffffff'];
const GRAVITY_PX_S2 = 900,
  DRAG_PER_S = 0.6; // pull down; how fast the air slows a piece (1/s)
const LIFE_S = 3.2,
  FADE_S = 0.6; // a piece lives this long, fading over the last FADE_S

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  w: number;
  h: number;
  col: string;
  age: number;
}

/** How many pieces a prize gets: 40 for a ticket back, about 300 for 10 000 kr. */
export const confettiCount = (kr: number) => Math.round(40 * Math.max(1, kr / 30) ** 0.35);

export class Confetti {
  private readonly ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rnd: () => number,
    private readonly calmMotion: Pick<MediaQueryList, 'matches'>, // none at all with reduced motion
  ) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  get live() {
    return this.pieces.length;
  }

  /** Confetti for a win of kr, more for a bigger one; nothing with reduced motion. */
  celebrate(kr: number) {
    if (!this.calmMotion.matches) this.burst(confettiCount(kr));
  }

  /** Fires n pieces, half from each bottom corner, up and in towards the middle. */
  burst(n: number) {
    const dpr = Math.min(2, devicePixelRatio || 1),
      W = innerWidth,
      H = innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = this.rnd,
      up = Math.sqrt(2 * GRAVITY_PX_S2 * H * 1.3); // with the drag, the fastest reach about 80 % of the way up the screen
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0,
        a = (0.18 + r() * 0.3) * Math.PI,
        v = up * (0.7 + r() * 0.55); // angle from straight up, inwards
      this.pieces.push({
        x: left ? 0 : W,
        y: H,
        vx: (left ? 1 : -1) * Math.sin(a) * v,
        vy: -Math.cos(a) * v,
        rot: r() * 6.3,
        spin: (r() - 0.5) * 14,
        w: 10 + r() * 8,
        h: 6 + r() * 5,
        col: CONFETTI_COLS[Math.floor(r() * CONFETTI_COLS.length)],
        age: 0,
      });
    }
    this.canvas.hidden = false;
  }

  update(dt: number) {
    if (!this.pieces.length) return;
    const ctx = this.ctx,
      H = innerHeight,
      k = Math.exp(-DRAG_PER_S * dt);
    ctx.clearRect(0, 0, innerWidth, H);
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      p.vx *= k;
      p.vy = p.vy * k + GRAVITY_PX_S2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.age >= LIFE_S || p.y > H + 20) {
        this.pieces.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, (LIFE_S - p.age) / FADE_S);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 1.7)); // the cos flips it like paper turning over
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!this.pieces.length) {
      ctx.clearRect(0, 0, innerWidth, H);
      this.canvas.hidden = true;
    }
  }
}
