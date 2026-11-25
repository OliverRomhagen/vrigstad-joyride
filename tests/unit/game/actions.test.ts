import { describe, expect, it } from 'vitest';
import { Actions, type ActionsDeps } from '../../../src/game/actions';
import type { Car } from '../../../src/game/cars';
import type { Cat } from '../../../src/game/cats';
import { Commands } from '../../../src/game/commands';
import { FINE_PER_STAR_KR } from '../../../src/game/economy';
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
    inside?: Place | null;
    cat?: Cat | null;
    menuOpen?: boolean;
    skroten?: boolean;
    owner?: boolean;
    kr?: number;
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
  // every command E runs, as a hook sees it: its name and where it came from
  const commands = new Commands(),
    ran: string[] = [];
  commands.use((call, next) => {
    ran.push(call.name + ' from ' + call.source);
    return next();
  });
  const health = { hp: 7, calm: 0, god: false },
    wallet = { kr: o.kr ?? 0 };
  const g: ActionsDeps = {
    game,
    view,
    player,
    cars: o.cars ?? [],
    places: { inside: o.inside ?? null, list: o.places ?? [] },
    wanted,
    health,
    wallet,
    commands,
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
    openSkroten: () => {
      if (!o.skroten) return false;
      calls.push('skroten');
      return true;
    },
    nearOwner: () => !!o.owner,
    talkToOwner: () => void calls.push('owner'),
    offerCar: c => void calls.push('offer ' + c.saleKr),
    collide: () => {},
    placeCar: () => {},
    rnd: () => o.roll ?? 0.9,
    pick: a => a[0],
    toast: m => void calls.push('toast ' + m),
    carName: c => c.T.name,
    spokenName: () => undefined,
    driverOut: () => void calls.push('driverOut'),
    replaceTaken: () => void calls.push('traffic'),
    drawStolen: () => void calls.push('stolen ' + game.stolen),
    drawHealth: () => {},
    titleCard: (t, msg) => {
      calls.push('title card ' + t);
      screens.push(msg);
    },
    sayLater: l => void calls.push('later ' + l),
    pickLine: a => a[0],
  };
  return {
    a: new Actions(g),
    deps: g,
    commands,
    ran,
    calls,
    screens,
    game,
    view,
    player,
    mesh,
    wanted,
    health,
    wallet,
  };
}

describe('Actions.action', () => {
  it('does nothing before Start or under the title card', () => {
    const t = actions({ cars: [parked()] });
    t.game.started = false;
    t.a.action();
    t.game.started = true;
    t.game.titleCardT = 1;
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

  it("on Skroten's ring, E in the car asks Skroten instead of getting you out", () => {
    const c = parked(),
      t = actions({ cars: [c], skroten: true });
    t.a.action();
    t.a.action();
    expect(t.game.inCar).toBe(true);
    expect(t.calls.at(-1)).toBe('skroten');
  });

  it('E on foot next to Plåt-Pelle talks to him, when he is nearer than any car', () => {
    const t = actions({ cars: [parked()], owner: true });
    t.a.action();
    expect(t.game.inCar).toBe(false);
    expect(t.calls).toEqual(['owner']);
  });

  it("asks Plåt-Pelle his price for a car on Skroten's lot instead of stealing it", () => {
    const c = parked({ saleKr: 2000 }),
      t = actions({ cars: [c] });
    t.a.action();
    expect(t.calls).toEqual(['offer 2000']);
    expect(t.game.inCar).toBe(false);
    expect(c.owned).toBe(false);
  });

  it("gets you back into the car you got out of before a nearer car on Skroten's lot", () => {
    const forSale = parked({ x: 0.9, saleKr: 2000 }),
      yours = parked({ x: -2, mode: 'idle', owned: true }),
      t = actions({ cars: [forSale, yours] });
    t.a.action();
    expect(t.calls).not.toContain('offer 2000');
    expect(t.game.pcar).toBe(yours);
  });

  it('takes the nearer car over the one you got out of, away from the lot', () => {
    const other = parked({ x: 0.9 }),
      yours = parked({ x: -2, mode: 'idle', owned: true }),
      t = actions({ cars: [other, yours] });
    expect(t.a.nearestCar()).toBe(other);
    t.a.action();
    expect(t.game.pcar).toBe(other);
  });

  it("offers the nearer car on Skroten's lot over a wreck, or a car you bought and haven't driven", () => {
    for (const other of [parked({ x: -2, mode: 'idle', owned: true, dmg: 999 }), parked({ x: -2, owned: true })]) {
      const t = actions({ cars: [parked({ x: 0.9, saleKr: 2000 }), other] });
      t.a.action();
      expect(t.calls).toEqual(['offer 2000']);
    }
  });

  it('gets you out when Skroten makes no offer: off its ring, or refused', () => {
    const c = parked(),
      t = actions({ cars: [c], skroten: false });
    t.a.action();
    t.a.action();
    expect(t.game.inCar).toBe(false);
  });

  it('calls the police when a neighbour sees you take a car', () => {
    const t = actions({ cars: [parked()], roll: 0.1 });
    t.a.action();
    expect(t.calls[0]).toBe(
      'star ”Oj, nu ä länsman efter mä!” A neighbour saw you take the Volvo and called the police.',
    );
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

describe('enter and exit as commands', () => {
  it('E at a car only picks the command: a hook sees enter, then exit, from input', () => {
    const t = actions({ cars: [parked()] });
    t.a.action();
    expect(t.game.inCar).toBe(true);
    t.a.action();
    expect(t.game.inCar).toBe(false);
    expect(t.ran).toEqual(['enter from input', 'exit from input']);
  });

  it('E runs no command for what is not getting in or out of a car', () => {
    const t = actions({ cars: [parked({ saleKr: 2000 })] });
    t.a.action(); // Plåt-Pelle's price
    actions().a.action(); // nothing in reach
    const onRing = actions({ cars: [parked()], skroten: true });
    onRing.a.action();
    onRing.a.action(); // Skroten's offer
    expect(t.ran).toEqual([]);
    expect(onRing.ran).toEqual(['enter from input']);
  });

  it('a hook that refuses the command keeps you on foot', () => {
    const t = actions({ cars: [parked()] });
    t.commands.use(call => 'No ' + call.name + ' here.');
    t.a.action();
    expect(t.game.inCar).toBe(false);
  });

  it('enter gets you into the car in reach without a key, as taking it by E does', () => {
    const c = parked(),
      t = actions({ cars: [c] });
    expect(t.commands.run('enter', 'test')).toBe('You are in the Volvo.');
    expect(t.game.pcar).toBe(c);
    expect(c.owned).toBe(true);
    expect(t.calls).toEqual(['toast You took the Volvo. Nobody noticed.', 'stolen 1']);
    expect(t.commands.run('enter', 'test')).toBe('You are already in the Volvo.');
    expect(t.ran).toEqual(['enter from test', 'enter from test']);
  });

  it('enter says why not: no car, a car for sale, inside a house, or the game not running', () => {
    expect(actions().commands.run('enter')).toBe('No car in reach.');
    const lot = actions({ cars: [parked({ saleKr: 2000 })] });
    expect(lot.commands.run('enter')).toBe('The Volvo is for sale at Skroten.');
    expect(lot.calls).toEqual([]); // the price is what E asks, not what enter does
    const home = actions({ cars: [parked()], inside: { kind: 'safe', name: 'Storgatan', x: 0, z: 0 } });
    expect(home.commands.run('enter')).toBe('You are inside a house.');
    const waiting = actions({ cars: [parked()] });
    waiting.game.started = false;
    expect(waiting.commands.run('enter')).toBe('Not now: the game is not running.');
    waiting.game.started = true;
    waiting.game.titleCardT = 1;
    expect(waiting.commands.run('exit')).toBe('Not now: the game is not running.');
    for (const t of [lot, home, waiting]) expect(t.game.inCar).toBe(false);
  });

  it('exit gets you out, and says so when you are on foot or too fast', () => {
    const c = parked(),
      t = actions({ cars: [c] });
    expect(t.commands.run('exit')).toBe('You are not in a car.');
    t.commands.run('enter');
    c.v = 20;
    expect(t.commands.run('exit')).toBe('Slow down before you get out.');
    expect(t.calls.at(-1)).toBe('toast Slow down before you get out.');
    expect(t.game.inCar).toBe(true);
    c.v = 0;
    expect(t.commands.run('exit')).toBe('You got out of the Volvo.');
    expect(t.game.inCar).toBe(false);
    expect(c.mode).toBe('idle');
  });

  it("exit gets you out on Skroten's ring too: the offer is what E asks first", () => {
    const t = actions({ cars: [parked()], skroten: true });
    t.commands.run('enter');
    expect(t.commands.run('exit')).toBe('You got out of the Volvo.');
    expect(t.calls).not.toContain('skroten');
  });

  it('both take no words, run outside dev mode and explain themselves', () => {
    const t = actions();
    expect(t.commands.run('enter now')).toBe('Too many words. Usage: enter');
    expect(t.commands.run('help exit')).toBe(
      'exit: get out of the car you drive\nWhat E does in a car, once it is slow enough.\nExamples:\n  exit',
    );
    const players = new Commands({ allowed: access => access === 'player' });
    new Actions({ ...t.deps, commands: players });
    expect(players.names()).toEqual(['enter', 'exit', 'help']);
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
    expect(t.calls.at(-1)).toBe('title card Gripen!');
  });

  it('busted fines you by the stars you had, never more than you have', () => {
    const t = actions({ kr: 1000 });
    t.a.busted(3);
    expect(t.wallet.kr).toBe(1000 - 3 * FINE_PER_STAR_KR);
    expect(t.screens.at(-1)).toBe('Busted. The police fine you 300 riksdaler and drop you off at Torget.');
    const poor = actions({ kr: 0 });
    poor.a.busted(3);
    expect(poor.wallet.kr).toBe(0);
    expect(poor.screens.at(-1)).toBe('Busted. The police drop you off at Torget.');
  });

  it('a knock-out with stars is Gripen!, without them Däckad! and a line after', () => {
    const chased = actions({ stars: 2 });
    chased.a.knockedOut();
    expect(chased.wanted.stars).toBe(0);
    expect(chased.calls).toEqual(['clear', 'title card Gripen!']);

    const t = actions();
    t.a.knockedOut();
    expect(t.calls).toEqual(['title card Däckad!', 'later ”Va hände? Ja minns ingenting.”']);
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
