// The test hook: read-only state for the smoke tests (tests/e2e), so they do not have to read pixels. Keep it read-only.
// Moved from src/game/main.ts (#177).
import type { StreetscapeLayout } from '../world/streetscape';
import type { Car } from './cars';
import type { Health } from './health';
import type { PlayerState } from './player';
import type { Sky } from './render/sky';
import type { GameState, ViewState } from './state';

/** What the smoke tests can read. The getters are read when a test asks. */
export interface TestHookDeps {
  game: GameState;
  view: ViewState;
  player: PlayerState;
  health: Health;
  cars: readonly Car[];
  labs: readonly string[]; // the lab experiments switched on
  readonly ragdolls: number | null; // people knocked over right now, null without ?lab=ragdoll
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
  nearestCar(): Car | null;
}

/** Puts the hook on `window.__joyride`. */
export function installTestHook(g: TestHookDeps) {
  const { game, view, player, health, cars, vehicleVisuals, bodyMotion, skyDome, street } = g;
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
        streetscape: streetscapeState(),
      };
    },
  };
}
