// Banknotes that flutter down around you: låt det regna (L), and the big trisslott win.
// main.ts passes in the scene, the ground, a random stream and the reduced-motion query.
import * as THREE from 'three';
import type { PointXZ } from '../../world/buildings';

const N = 48,
  CALM_N = 12,
  R_M = 4.5; // notes in the pool; how many with reduced motion; how far around you they fall (m)
const TOP_M = 2.5,
  TOP_SPREAD_M = 2.5; // they start 2.5–5 m above the ground
const FALL_MS = 0.9,
  FALL_SPREAD_MS = 0.6; // and fall at 0.9–1.5 m/s, swaying: down in 2–5 s
const LIE_S = 3,
  FADE_S = 0.8; // s a note lies on the ground, then fades out

type Note = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
  lieT: number; // s on the ground; below 0 while it falls
  vy: number; // m/s down
  sway: number; // m/s sideways
  phase: number; // radians along the sway
  sx: number; // tumble, radians/s about each axis
  sy: number;
  sz: number;
};

/** What the notes read from the rest of the game. */
export interface BanknotesDeps {
  scene: THREE.Scene;
  doc: Pick<Document, 'createElement'>;
  groundAt(x: number, z: number): number;
  rnd(): number; // their own stream, so they don't shift the world's rolls
  calmMotion: Pick<MediaQueryList, 'matches'>; // fewer notes with reduced motion
}

/** A ring of notes: `drop` throws a shower of them, `update` lets them fall, lie and fade. */
export class Banknotes {
  private readonly g: BanknotesDeps;
  private readonly notes: Note[];
  private next = 0;

  constructor(g: BanknotesDeps) {
    this.g = g;
    const geo = new THREE.PlaneGeometry(0.4, 0.2),
      map = this.texture();
    this.notes = Array.from({ length: N }, () => {
      const note = Object.assign(
        new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
        ),
        { lieT: 0, vy: 0, sway: 0, phase: 0, sx: 0, sy: 0, sz: 0 },
      );
      note.visible = false;
      g.scene.add(note);
      return note;
    });
  }

  /** Notes in the air or on the ground. */
  get live() {
    return this.notes.filter(note => note.visible).length;
  }

  // a blue 100-krona note
  private texture() {
    const cv = this.g.doc.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#6f82c2';
    c.fillRect(0, 0, 128, 64);
    c.strokeStyle = '#dfe4f4';
    c.lineWidth = 4;
    c.strokeRect(6, 6, 116, 52);
    c.fillStyle = '#4c5d9e';
    c.beginPath();
    c.arc(38, 32, 16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#eef1fa';
    c.font = 'bold 22px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('100', 88, 33);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** A shower of notes around a spot. */
  drop(around: PointXZ) {
    const { groundAt, rnd, calmMotion } = this.g,
      n = calmMotion.matches ? CALM_N : N;
    for (let i = 0; i < n; i++) {
      const note = this.notes[this.next]!;
      this.next = (this.next + 1) % N; // a ring: the oldest note goes first
      const a = rnd() * Math.PI * 2,
        d = Math.sqrt(rnd()) * R_M, // sqrt: evenly over the disc
        x = around.x + Math.sin(a) * d,
        z = around.z + Math.cos(a) * d;
      note.position.set(x, groundAt(x, z) + TOP_M + rnd() * TOP_SPREAD_M, z);
      note.rotation.set(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3);
      note.vy = FALL_MS + rnd() * FALL_SPREAD_MS;
      note.sway = 0.4 + rnd() * 0.5;
      note.phase = rnd() * 6.3;
      note.sx = (rnd() - 0.5) * 6;
      note.sy = (rnd() - 0.5) * 4;
      note.sz = (rnd() - 0.5) * 6;
      note.lieT = -1;
      note.material.opacity = 1;
      note.visible = true;
    }
  }

  update(dt: number) {
    const { groundAt } = this.g;
    for (const note of this.notes) {
      if (!note.visible) continue;
      if (note.lieT < 0) {
        note.phase += dt * 2.2;
        note.position.x += Math.cos(note.phase) * note.sway * dt;
        note.position.z += Math.sin(note.phase * 0.7) * note.sway * dt;
        note.position.y -= note.vy * dt;
        note.rotation.x += note.sx * dt;
        note.rotation.y += note.sy * dt;
        note.rotation.z += note.sz * dt;
        const g = groundAt(note.position.x, note.position.z) + 0.02;
        if (note.position.y <= g) {
          note.position.y = g;
          note.rotation.set(-Math.PI / 2, 0, note.rotation.z); // lands flat, turned whichever way it fell
          note.lieT = 0;
        }
      } else {
        note.lieT += dt;
        const f = note.lieT - LIE_S;
        if (f >= FADE_S) note.visible = false;
        else note.material.opacity = f > 0 ? 1 - f / FADE_S : 1;
      }
    }
  }
}
