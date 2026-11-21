import { describe, expect, it } from 'vitest';
import type { Cat } from '../../../src/game/cats';
import { type MenuItem, type Pet, Pets, type PetsDeps } from '../../../src/game/pets';

// A colony stub that records what the menu asks of it, and a menu that records what it shows.
function pets(owned: boolean) {
  const calls: string[] = [],
    menus: { title: string; items: MenuItem[]; pick: (k: string) => void }[] = [],
    renames: Pet[] = [];
  const colony = {
    owned: owned ? ({ name: 'Kisse' } as Cat) : null,
    home: false,
    rename: (n: string) => n,
    call: (T: { x: number; z: number }) => {
      calls.push('call ' + T.x);
    },
    sendHome: () => {
      calls.push('home');
    },
    setFree: () => {
      calls.push('free');
      colony.owned = null;
    },
  };
  const button = { hidden: true };
  const deps: PetsDeps = {
    colony,
    button,
    openMenu: (_kind, title, items, pick) => {
      menus.push({ title, items, pick });
    },
    openRename: p => {
      renames.push(p);
    },
    esc: t => t.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    caller: { x: 7, z: 0 },
  };
  return { p: new Pets(deps), colony, button, calls, menus, renames };
}

describe('Pets', () => {
  it('lists nothing and opens no menu while you own no pet', () => {
    const { p, menus } = pets(false);
    expect(p.list()).toEqual([]);
    p.open();
    expect(menus).toEqual([]);
  });

  it('opens your one pet straight away, with Ropa hit only once it is home', () => {
    const { p, colony, menus } = pets(true);
    p.open();
    expect(menus[0].title).toBe('”Kisse”');
    expect(menus[0].items.map(([k]) => k)).toEqual(['home', 'name', 'free', 'no']);
    colony.home = true;
    p.open();
    expect(menus[1].title).toBe('”Kisse ä hemma.”');
    expect(menus[1].items[0]).toEqual(['call', 'Ropa hit']);
  });

  it('calls a pet to the caller and sends it home', () => {
    const { p, colony, calls, menus } = pets(true);
    p.open();
    menus[0].pick('home');
    colony.home = true;
    p.open();
    menus[1].pick('call');
    expect(calls).toEqual(['home', 'call 7']);
  });

  it('asks before setting a pet free, and hides the Pets button after', () => {
    const { p, button, calls, menus } = pets(true);
    p.draw();
    expect(button.hidden).toBe(false);
    p.open();
    menus[0].pick('free');
    expect(menus[1].items.map(([k]) => k)).toEqual(['yes', 'no']);
    menus[1].pick('no');
    expect(calls).toEqual([]);
    menus[1].pick('yes');
    expect(calls).toEqual(['free']);
    expect(button.hidden).toBe(true);
  });

  it('escapes the name in the menu title', () => {
    const { p, colony, menus } = pets(true);
    colony.owned!.name = '<b>';
    p.open();
    expect(menus[0].title).toBe('”&lt;b&gt;”');
  });

  it('hands renaming to the menu with the text field', () => {
    const { p, menus, renames } = pets(true);
    p.open();
    menus[0].pick('name');
    expect(renames.map(r => r.name)).toEqual(['Kisse']);
  });
});
