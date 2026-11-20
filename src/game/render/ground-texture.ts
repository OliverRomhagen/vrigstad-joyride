// The ground texture: land use, mottled grass, lawns, water, roads and footprints painted on one canvas, which the
// terrain wears and the minimap shows. The trees' shadows are baked in once they are placed.
// Moved from src/game/main.ts (#177).
import * as THREE from 'three';
import { ROAD_WIDTH_M as ROAD_W, type WorldData } from '../../world/data';
import { polygonArea as polyArea } from '../../world/polygon';

export const HOUSE_MIN_M2 = 40, HOUSE_MAX_M2 = 1500;   // footprints in this range count as homes and shops

/** What the ground texture reads from the renderer. */
export interface GroundTextureOptions {
  coarse: boolean; // a touch screen: the smaller texture
  maxTextureSize: number;
  maxAnisotropy: number;
}

/** The painted ground; `P` turns a world coordinate into canvas pixels, `K` is pixels per metre. */
export class GroundTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly K: number;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly half: number;

  constructor(D: WorldData, { coarse, maxTextureSize, maxAnisotropy }: GroundTextureOptions) {
    const S = D.size, CW = (coarse || maxTextureSize < 4096) ? 2048 : 4096, K = CW / S;
    this.half = S / 2;
    this.K = K;
    const tex2d = document.createElement('canvas'); tex2d.width = tex2d.height = CW;
    const ctx = tex2d.getContext('2d')!;
    this.canvas = tex2d;
    this.ctx = ctx;
    const trace = this.trace;
    (function paint() {
      const land = ['#a6c083', '#d9cf8b', '#b9b4a8', '#8fc072', '#93b77d', '#6f9a5e', '#7cc163'];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.fillStyle = '#9db87a'; ctx.fillRect(0, 0, CW, CW);
      const fillLand = (k: number) => { ctx.fillStyle = land[k]; ctx.beginPath(); for (const l of D.l) if (l.k === k) trace(l.p, true); ctx.fill(); };
      const GRASS = [0, 3];   // residential and grass/parks; farmland, industrial, cemetery, forest and pitches are filled over the mottling
      GRASS.forEach(fillLand);
      // mottled grass: its own generator, so the look doesn't shift the seeded rnd() sequence
      let ns = 7; const nr = () => (ns = ns * 48271 % 2147483647) / 2147483647;
      for (let i = 0; i < 2600; i++) { const cx = nr() * CW, cy = nr() * CW, r = (6 + nr() * 24) * K, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r), c = ['143,176,111', '169,196,134', '120,150,95', '179,201,141'][i % 4];
        g.addColorStop(0, 'rgba(' + c + ',.35)'); g.addColorStop(1, 'rgba(' + c + ',0)'); ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
      ctx.globalAlpha = 0.45;
      for (const c of ['#86a866', '#b0c88e', '#7c9d5c', '#c3cf98']) { ctx.fillStyle = c; for (let i = 0; i < 40000; i++) ctx.fillRect(nr() * CW, nr() * CW, 1 + nr() * 1.5, 1 + nr() * 1.5); }
      ctx.globalAlpha = 1;
      for (let k = 0; k < 7; k++) if (!GRASS.includes(k)) fillLand(k);
      ctx.strokeStyle = 'rgba(172,199,138,.55)'; ctx.lineWidth = 9 * K; ctx.beginPath();   // mown lawns around homes (not the church, barns or halls)
      for (const b of D.b) { const a = polyArea(b.p); if (b.k !== 1 && a >= HOUSE_MIN_M2 && a <= HOUSE_MAX_M2) trace(b.p, true); } ctx.stroke();
      ctx.strokeStyle = '#4f8fb8';
      for (const w of D.ww) { ctx.lineWidth = (w.k === 0 ? 6 : 2) * K; ctx.beginPath(); trace(w.p); ctx.stroke(); }
      ctx.fillStyle = '#4f8fb8';
      for (const w of D.w) { ctx.beginPath(); for (const ring of w) trace(ring, true); ctx.fill('evenodd'); }
      const fill = ['#55585a', '#5d6062', '#66696a', '#77776f', '#a08c6c', '#b8ab90'];
      for (const pass of [2, 1, 0]) for (const c of [5, 4, 3, 2, 1, 0]) {   // 2: soft outer edge of the verge, 1: gravel verge, 0: the road
        if (pass && c > 3) continue;
        ctx.strokeStyle = pass === 2 ? 'rgba(179,167,140,.35)' : pass ? '#b3a78c' : fill[c]; ctx.lineWidth = (ROAD_W[c] + (pass === 2 ? 4.4 : pass ? 2.4 : 0)) * K;
        ctx.beginPath(); for (const r of D.r) if (r.c === c) trace(r.p); ctx.stroke();
      }
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3 * K;   // contact shadow around every footprint
      ctx.fillStyle = '#8a8378'; ctx.beginPath(); for (const b of D.b) trace(b.p, true); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    })();
    const texture = new THREE.CanvasTexture(tex2d);
    texture.anisotropy = maxAnisotropy; texture.colorSpace = THREE.SRGBColorSpace;
    this.texture = texture;
  }

  P = (v: number) => (v + this.half) * this.K;
  private trace = (p: readonly number[], close?: boolean) => { const { ctx, P } = this; ctx.moveTo(P(p[0]), P(p[1])); for (let i = 2; i < p.length; i += 2) ctx.lineTo(P(p[i]), P(p[i + 1])); if (close) ctx.closePath(); };

  /** Bakes a soft shadow under every tree into the texture (the minimap shows them too); `spots` is x, z, scale per tree. */
  bakeTreeShadows(spots: readonly number[], blobTex: CanvasImageSource) {
    const { ctx, K, P } = this, N = spots.length / 3;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < N; i++) { const r = 3.4 * spots[i * 3 + 2] * K; ctx.drawImage(blobTex, P(spots[i * 3]) - r, P(spots[i * 3 + 1]) - r, r * 2, r * 2); }
    ctx.globalAlpha = 1; this.texture.needsUpdate = true;
  }
}
