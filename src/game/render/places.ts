// The places in the scene: a ring on the ground and a spinning gem over each one, a yellow door on each safehouse, the kiosk building on Torget,
// and Skroten's ring, wide enough for a car (its yard is render/skroten.ts).
// Moved from src/game/main.ts (#177); main.ts passes in the scene, the height lookup and the shared box geometry and paint.
import * as THREE from 'three';
import { type Door, KIOSK, type Places } from '../places';
import { INK_FLAG } from './toon-style';

const SAFE_COLOUR = 0x4fd27a,
  KIOSK_COLOUR = 0xf2c230,
  SKROT_COLOUR = 0xd2692f; // sRGB
const SKROT_RING_SCALE = 3; // Skroten's ring is this much wider than the others, round a car
const GEM_SPIN = 1.6; // rad/s
const WHITE = '#e8e2d2',
  RED = '#c8372d',
  YELLOW = '#f2c230';

/** One box of a model: size, position and colour, as `boxGeo` in models.ts takes it. */
type BoxPart = [sx: number, sy: number, sz: number, x: number, y: number, z: number, colour: string];

/** What the places' meshes read from the rest of the game. */
export interface PlaceMeshDeps {
  scene: THREE.Scene;
  places: Pick<Places, 'list' | 'doors'>;
  heightAt(x: number, z: number): number;
  col(c: number): THREE.Color; // an sRGB colour in linear space
  boxGeo(parts: BoxPart[]): THREE.BufferGeometry;
  paintMat: THREE.Material; // vertex colours
  glass: string;
}

/** The meshes of the places; `update` spins the gems. */
export class PlaceMeshes {
  private readonly gems: THREE.Mesh[] = [];

  constructor(g: PlaceMeshDeps) {
    const { scene, heightAt, boxGeo, paintMat } = g;
    const ringGeo = new THREE.RingGeometry(0.95, 1.25, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const gemGeo = new THREE.OctahedronGeometry(0.42);
    let doorI = 0;
    for (const p of g.places.list) {
      // each building goes in just before its ring and gem
      if (p.kind === 'safe') scene.add(door(g.places.doors[doorI++], heightAt, boxGeo, paintMat));
      else if (p.kind === 'kiosk') scene.add(kiosk(heightAt, boxGeo, paintMat, g.glass));
      const mat = new THREE.MeshBasicMaterial({
        color: g.col(p.kind === 'safe' ? SAFE_COLOUR : p.kind === 'kiosk' ? KIOSK_COLOUR : SKROT_COLOUR),
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const y = heightAt(p.x, p.z),
        ring = new THREE.Mesh(ringGeo, mat),
        gem = new THREE.Mesh(gemGeo, mat);
      ring.position.set(p.x, y + 0.4, p.z);
      if (p.kind === 'skrot') ring.scale.setScalar(SKROT_RING_SCALE);
      gem.position.set(p.x, y + 3.6, p.z);
      scene.add(ring, gem);
      this.gems.push(gem);
    }
  }

  update(dt: number) {
    for (const gem of this.gems) gem.rotation.y += dt * GEM_SPIN;
  }
}

function door(d: Door, heightAt: PlaceMeshDeps['heightAt'], boxGeo: PlaceMeshDeps['boxGeo'], paintMat: THREE.Material) {
  const m = new THREE.Mesh(
    boxGeo([
      [1.4, 2.35, 0.1, 0, 1.17, 0, YELLOW],
      [1.05, 2.1, 0.16, 0, 1.05, 0, '#2f5a41'],
      [0.1, 0.1, 0.24, 0.36, 1.05, 0, YELLOW],
    ]),
    paintMat,
  );
  m.position.set(d.mx, heightAt(d.mx, d.mz), d.mz);
  m.rotation.y = Math.atan2(d.nx, d.nz);
  m.userData[INK_FLAG] = true;
  return m;
}

function kiosk(
  heightAt: PlaceMeshDeps['heightAt'],
  boxGeo: PlaceMeshDeps['boxGeo'],
  paintMat: THREE.Material,
  glass: string,
) {
  const { x, z } = KIOSK;
  const m = new THREE.Mesh(
    boxGeo([
      [3, 2.3, 2.2, 0, 1.15, 0, WHITE],
      [3.5, 0.18, 3, 0, 2.39, 0.25, RED],
      [1.9, 0.9, 0.06, 0, 1.55, 1.1, glass],
      [2.2, 0.1, 0.5, 0, 1.05, 1.3, '#7a4a3c'],
      [2.4, 0.5, 0.1, 0, 2.75, 1.2, YELLOW],
      [0.5, 2.3, 0.04, -1.25, 1.15, 1.1, RED],
      [0.5, 2.3, 0.04, 1.25, 1.15, 1.1, RED],
    ]),
    paintMat,
  );
  m.position.set(x, heightAt(x, z), z);
  m.castShadow = true;
  m.userData[INK_FLAG] = true;
  return m;
}
