import { describe, expect, it } from 'vitest';
import { Actions, type ActionsDeps } from '../../../src/game/actions';
import type { Car } from '../../../src/game/cars';
import type { Cat } from '../../../src/game/cats';
import { HP_MAX } from '../../../src/game/health';
import type { Place } from '../../../src/game/places';
import { HOME } from '../../../src/game/player';
import { newGameState, newViewState } from '../../../src/game/state';

// A parked car 2 m east of (0, 0), facing north; only the fields E reads and writes.
const parked = (o: Partial<Car> = {}) =>
  ({
    x: 2,
    z: 0,
    h: 0,
    vh: 0,
    v: 0,
    mode: 'parked',
    owned: false,
    type: 'volvo',
    T: { name: 'Volvo' },
    slip: 0,
    drift: 0,
    boost: 0,
    loose: 0,
    thr: 0,
    st: 0,
    ...o,
  }) as Car;

// You at (0, 0) next to whatever `cars` holds; `roll` is what rnd() returns. Calls record what E did, in order.
function actions(
  o: {
    cars?: Car[];
    roll?: number;
    stars?: number;
    place?: Place | null;
    places?: Place[];
    cat?: Cat | null;
    menuOpen?: boolean;
  } = {},
) {
  const calls: string[] = [],
    screens: string[] = [];
  const game = { ...newGameState(), started: true },
    view = newViewState(0, 0);
  const player = { x: 0, z: 0, y: 1, vy: 2, h: 0, speed: 0, phase: 0 },
    mesh = { visible: true };
  const wanted = {
    stars: o.stars ?? 0,
    police: [] as ActionsDeps['wanted']['police'],
    addStar: (msg?: string) => void calls.push('star ' + (msg ?? '')),
    clear: () => {
      wanted.stars = 0;
      calls.push('clear');
    },
  };
  const health = { hp: 7, calm: 0 };
  const g: ActionsDeps = {
    game,
    view,
    player,
    cars: o.cars ?? [],
    places: { inside: null, list: o.places ?? [] },
    wanted,
    health,
    menuOpen: () => !!o.menuOpen,
    showPlayer: v => {
      mesh.visible = v;
    },
    closeMenu: () => void calls.push('closeMenu'),
    nearPlace: () => o.place ?? null,
    enterHouse: p => void calls.push('enter ' + p.name),
    leaveHouse: () => {},
    nearCat: () => o.cat ?? null,
    catFirst: kt => !!kt,
    openOwnCat: () => void calls.push('ownCat'),
    petCat: () => void calls.push('pet'),
    openKiosk: () => void calls.push('kiosk'),
    collide: () => {},
    placeCar: () => {},
    rnd: () => o.roll ?? 0.9,
    pick: a => a[0],
    toast: m => void calls.push('toast ' + m),
    carName: c => c.T.name,
    spokenName: () => undefined,
    driverOut: () => void calls.push('driverOut'),
    spawnTraffic: () => void calls.push('traffic'),
    drawStolen: () => void calls.push('stolen ' + game.stolen),
    drawHealth: () => {},
    bigScreen: (t, msg) => {
      calls.push('big ' + t);
      screens.push(msg);
    },
    sayLater: l => void calls.push('later ' + l),
    pickLine: a => a[0],
  };
  return { a: new Actions(g), calls, screens, game, view, player, mesh, wanted, health };
}

describe('Actions.action', () => {
  it('does nothing before Start or under the big screen', () => {
    const t = actions({ cars: [parked()] });
    t.game.started = false;
    t.a.action();
    t.game.started = true;
    t.game.bigT = 1;
    t.a.action();
    expect(t.game.inCar).toBe(false);
  });

  it('closes an open menu first, then a cat, then a place', () => {
    const cat = { owned: true } as Cat,
      kiosk: Place = { kind: 'kiosk', name: 'Kiosken', x: 0, z: 0 },
      safe: Place = { kind: 'safe', name: 'Gästgivaregatan', x: 0, z: 0 };
    const t1 = actions({ menuOpen: true, cat });
    t1.a.action();
    expect(t1.calls).toEqual(['closeMenu']);
    const t2 = actions({ cat, place: kiosk });
    t2.a.action();
    expect(t2.calls).toEqual(['ownCat']);
    const t3 = actions({ cat: { owned: false } as Cat });
    t3.a.action();
    expect(t3.calls).toEqual(['pet']);
    const t4 = actions({ place: kiosk });
    t4.a.action();
    expect(t4.calls).toEqual(['kiosk']);
    const t5 = actions({ place: safe });
    t5.a.action();
    expect(t5.calls).toEqual(['enter Gästgivaregatan']);
  });

  it('gets you into a parked car, and counts it as stolen once', () => {
    const c = parked({ h: 1.2 }),
      t = actions({ cars: [c] });
    t.a.action();
    expect(t.game.inCar).toBe(true);
    expect(t.game.pcar).toBe(c);
    expect(c.mode).toBe('player');
    expect(c.vh).toBe(1.2);
    expect(t.view.camYaw).toBe(1.2);
    expect(t.mesh.visible).toBe(false);
    expect(t.player.y).toBe(0);
    expect(t.calls).toEqual(['toast You took the Volvo. Nobody noticed.', 'stolen 1']);

    t.a.action(); // out again
    t.a.action(); // and back in: already yours
    expect(t.game.stolen).toBe(1);
  });

  it('calls the police when a neighbour sees you take a car', () => {
    const t = actions({ cars: [parked()], roll: 0.1 });
    t.a.action();
    expect(t.calls[0]).toBe('star A neighbour saw you take the Volvo and called the police.');
  });

  it('pulls the driver out of a car on the road, who calls the police', () => {
    const t = actions({ cars: [parked({ mode: 'ai' })] });
    t.a.action();
    expect(t.calls).toEqual([
      'driverOut',
      'toast ”Hörru! Det där är min bil!” The driver calls the police.',
      'star ',
      'traffic',
      'stolen 1',
    ]);
  });

  it("won't let you out of a car that is going too fast", () => {
    const c = parked(),
      t = actions({ cars: [c] });
    t.a.action();
    c.v = 20;
    t.a.action();
    expect(t.game.inCar).toBe(true);
    c.v = 0;
    t.view.lookOff = 0.5;
    t.a.action();
    expect(t.game.inCar).toBe(false);
    expect(c.mode).toBe('idle');
    expect(t.view.lookOff).toBe(0);
    expect(t.view.camYaw).toBeCloseTo(0.5);
    expect(t.mesh.visible).toBe(true);
  });
});

describe('Actions after a chase or a crash', () => {
  it('busted puts you at Torget at full health under Gripen!', () => {
    const c = parked(),
      t = actions({ cars: [c] });
    t.a.action();
    t.a.busted();
    expect(t.game.inCar).toBe(false);
    expect(t.mesh.visible).toBe(true);
    expect([t.player.x, t.player.z]).toEqual([HOME.x, HOME.z]);
    expect(t.health.hp).toBe(HP_MAX);
    expect(t.calls.at(-1)).toBe('big Gripen!');
  });

  it('a knock-out with stars is Gripen!, without them Däckad! and a line after', () => {
    const chased = actions({ stars: 2 });
    chased.a.knockedOut();
    expect(chased.wanted.stars).toBe(0);
    expect(chased.calls).toEqual(['clear', 'big Gripen!']);

    const t = actions();
    t.a.knockedOut();
    expect(t.calls).toEqual(['big Däckad!', 'later ”Va hände? Ja minns ingenting.”']);
    expect(t.health.hp).toBe(HP_MAX);
    expect(t.screens.at(-1)).toBe('Knocked out. You come to at Torget.');
  });

  it('a knock-out wakes you at the nearest safehouse when it is nearer than Torget', () => {
    const safe: Place = { kind: 'safe', name: 'Storgatan', x: 1, z: 0 };
    const t = actions({ places: [safe, { kind: 'kiosk', name: 'Kiosken', x: 0, z: 0 }] });
    t.a.knockedOut();
    expect(t.screens.at(-1)).toBe('Knocked out. You come to at the safehouse on Storgatan.');
  });
});
