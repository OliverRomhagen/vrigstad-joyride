// The test hook: read-only state for the smoke tests (tests/e2e), so they do not have to read pixels. Keep it read-only.
// Moved from src/game/main.ts (#177).

import type { BridgeIndex } from '../world/bridges';
import { FURNITURE } from '../world/furniture/definitions';
import type { FurnitureLayout } from '../world/furniture/placement';
import type { ShoreLayout } from '../world/shore';
import type { StreetscapeLayout } from '../world/streetscape';
import type { WaterBodies } from '../world/water-shapes';
import type { Car } from './cars';
import type { Health } from './health';
import type { PlayerState } from './player';
import type { Sky } from './render/sky';
import type { SunStreaks } from './render/sun-streaks';
import type { GameState, ViewState } from './state';

/** What the smoke tests can read. The getters are read when a test asks. */
export interface TestHookDeps {
  game: GameState;
  view: ViewState;
  player: PlayerState;
  health: Health;
  cars: readonly Car[];
  labs: readonly string[]; // the lab experiments switched on
  readonly ragdolls: number; // people knocked over right now
  readonly stars: number;
  readonly cats: number;
  readonly ownCat: boolean;
  readonly displayCar: Car | null; // the car parked by Torget at the start, ?vehicle= picks it
  // what the car's model and springs are doing
  vehicleVisuals: { state(car: Car): unknown };
  bodyMotion: { state(car: Car): unknown };
  skyDome: Pick<Sky, 'state'>;
  street: { layout: StreetscapeLayout; meshes: readonly unknown[]; tris: number; ms: number };
  debugStreetscape: boolean;
  bridges: {
    index: Pick<BridgeIndex, 'bridges' | 'deckAt'>;
    draw: { meshes: readonly unknown[]; triangles: number; ms: number };
    groundAt(x: number, z: number): number;
  };
  furniture: { layout: FurnitureLayout; draw: { meshes: readonly unknown[]; triangles: number }; ms: number };
  debugFurniture: boolean;
  water: {
    bodies: Pick<WaterBodies, 'lakes' | 'courses' | 'levelAt'>;
    surface: { meshes: readonly unknown[]; triangles: number };
    props: { meshes: readonly unknown[]; triangles: number };
    shore: ShoreLayout;
    terrainTriangles: number;
    refinedCells: number;
    buildMs: number;
    inWater(x: number, z: number): boolean;
    hAt(x: number, z: number): number;
  };
  nearestCar(): Car | null;
  readonly kr: number; // in your wallet
  readonly banknotes: number; // in the air or on the ground
  readonly confetti: number; // confetti pieces still falling
  readonly devcon: boolean; // the dev console is open
  build: string; // the commit the page was built from (vite.config.ts)
  readonly fps: boolean; // the console's frame times show
  readonly day: { readonly hour: number; readonly night: number; readonly sunLight: number }; // the clock (src/game/day-cycle.ts) and the sun's share of its light
  sunStreaks: Pick<SunStreaks, 'state'> | null; // null with ?sunrays=off
}

/** Puts the hook on `window.__joyride`. */
export function installTestHook(g: TestHookDeps) {
  const { game, view, player, health, cars, vehicleVisuals, bodyMotion, skyDome, street } = g;
  function furnitureState() {
    const { layout, draw, ms } = g.furniture;
    const count = (key: 'kind' | 'source', value: string) => layout.placements.filter(p => p[key] === value).length;
    return {
      total: layout.placements.length,
      byKind: Object.fromEntries(Object.keys(FURNITURE).map(k => [k, count('kind', k)])),
      bySource: {
        osm: count('source', 'osm'),
        override: count('source', 'override'),
        procedural: count('source', 'procedural'),
      },
      meshes: draw.meshes.length,
      triangles: draw.triangles,
      buildMs: Math.round(ms),
      debug: g.debugFurniture,
    };
  }
  function streetscapeState() {
    const L = street.layout,
      m = L.sidewalkM,
      r = (v: number) => Math.round(v);
    return {
      sidewalkM: { mapped: r(m.mapped), derived: r(m.derived), inferred: r(m.inferred) },
      parkingAreas: L.lots.length,
      crossings: L.crossings,
      streetTrees: {
        mapped: L.trees.filter(t => t.source === 'mapped').length,
        inferred: L.trees.filter(t => t.source === 'inferred').length,
      },
      meshes: street.meshes.length,
      triangles: street.tris,
      buildMs: Math.round(street.ms),
      debug: g.debugStreetscape,
    };
  }
  function waterState() {
    const w = g.water,
      level = w.bodies.levelAt(player.x, player.z),
      count = (type: string) => w.shore.stretches.filter(s => s.type === type).length;
    return {
      lakes: w.bodies.lakes.length,
      courses: w.bodies.courses.length,
      meshes: w.surface.meshes.length + w.props.meshes.length,
      triangles: w.surface.triangles,
      propTriangles: w.props.triangles,
      terrainTriangles: w.terrainTriangles,
      refinedCells: w.refinedCells,
      reeds: w.shore.reeds.length / 4,
      stones: w.shore.stones.length / 4,
      shore: { stony: count('stony'), reedy: count('reedy'), sandy: count('sandy'), grassy: count('grassy') },
      buildMs: Math.round(w.buildMs),
      // at the player: the water's level there (null on dry land), the ground, and whether the game calls it wet
      level: Number.isNaN(level) ? null : level,
      ground: w.hAt(player.x, player.z),
      wet: w.inWater(player.x, player.z),
    };
  }
  function bridgeState() {
    const { index, draw, groundAt } = g.bridges;
    const byArchetype: Record<string, number> = { 'road-slab': 0, 'path-steel': 0, 'path-timber': 0 };
    for (const b of index.bridges) byArchetype[b.archetype]++;
    const deck = index.deckAt(player.x, player.z);
    return {
      count: index.bridges.length,
      byArchetype,
      list: index.bridges.map(b => ({
        key: b.key,
        archetype: b.archetype,
        spanM: Math.round(b.spanM * 10) / 10,
        widthM: Math.round(b.halfWidthM * 20) / 10,
        riseM: Math.round(b.riseM * 100) / 100,
        source: b.source,
      })),
      onDeck: deck !== null,
      deckY: deck,
      groundY: groundAt(player.x, player.z),
      meshes: draw.meshes.length,
      triangles: draw.triangles,
      buildMs: Math.round(draw.ms),
    };
  }
  (window as unknown as { __joyride: unknown }).__joyride = {
    state: () => {
      const n = g.nearestCar(),
        displayCar = g.displayCar;
      return {
        started: game.started,
        lab: g.labs,
        ragdolls: g.ragdolls,
        x: player.x,
        z: player.z,
        y: player.y,
        yaw: view.camYaw,
        zoom: view.zoom,
        inCar: game.inCar,
        car: game.pcar ? game.pcar.type : null,
        near: n ? n.mode : null,
        speed: game.pcar ? game.pcar.v : 0,
        drift: game.pcar ? game.pcar.drift : 0,
        boost: game.pcar ? game.pcar.boost : 0,
        charge: game.pcar ? game.pcar.charge : 0,
        loose: game.pcar ? game.pcar.loose : 0,
        flickDir: game.pcar ? game.pcar.flickDir : 0,
        flickHeld: game.pcar ? game.pcar.flickHeld : 0,
        stars: g.stars,
        cats: g.cats,
        treats: game.treats,
        kr: g.kr,
        banknotes: g.banknotes,
        confetti: g.confetti,
        devcon: g.devcon,
        build: g.build,
        fps: g.fps,
        hp: health.hp,
        carDmg: game.pcar ? game.pcar.dmg : null,
        ownCat: g.ownCat,
        vehicle: displayCar ? vehicleVisuals.state(displayCar) : null,
        nearSelectedVehicle: n === displayCar,
        activeVehicle: game.pcar ? vehicleVisuals.state(game.pcar) : null,
        body: game.pcar ? bodyMotion.state(game.pcar) : null,
        wheelbase: (game.pcar || displayCar)?.T.handling.wheelbaseM ?? 0,
        traffic: cars.filter(c => c.mode === 'ai').map(c => ({ type: c.type, vehicle: vehicleVisuals.state(c) })),
        clouds: skyDome.state(),
        hour: g.day.hour,
        night: g.day.night,
        sunLight: g.day.sunLight,
        sunStreaks: g.sunStreaks?.state() ?? null,
        streetscape: streetscapeState(),
        furniture: furnitureState(),
        water: waterState(),
        bridges: bridgeState(),
      };
    },
  };
}
