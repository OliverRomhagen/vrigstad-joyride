import { describe, expect, it } from 'vitest';
import type { Cat } from '../../../src/game/cats';
import { HP_MAX, KORV_HP } from '../../../src/game/health';
import { KioskCatMenus, type KioskCatMenusDeps } from '../../../src/game/kiosk-cat-menus';
import type { MenuItem } from '../../../src/game/pets';
import { newGameState } from '../../../src/game/state';

// The menus with a stub plate: `open` holds the last menu opened, and `choose` picks from it.
function menus(o: { hp?: number; treats?: number } = {}) {
  const calls: string[] = [];
  let open: { kind: string; items: MenuItem[]; pick: (k: string) => void; stay?: (() => boolean) | null } | null = null;
  const game = { ...newGameState(), treats: o.treats ?? 0 },
    health = { hp: o.hp ?? 50, calm: 0 },
    player = { x: 0, z: 0 };
  const colony = {
    pet: () => true,
    adopt: () => void calls.push('adopt'),
    decline: () => void calls.push('decline'),
    treat: () => true,
    play: () => void calls.push('play'),
    sendHome: () => void calls.push('home'),
  };
  const g: KioskCatMenusDeps = {
    game,
    player,
    colony,
    health,
    openMenu: (kind, _title, items, pick, stay) => {
      open = { kind, items, pick, stay };
    },
    esc: t => t,
    toast: m => void calls.push('toast ' + m),
    scratch: () => void calls.push('scratch'),
    nearPlace: () => null,
    showHeart: () => void calls.push('heart'),
    drawPets: () => {},
    drawTreats: () => void calls.push('treats ' + game.treats),
    drawHealth: () => {},
  };
  const choose = (k: string) => open!.pick(k);
  return { m: new KioskCatMenus(g), calls, game, health, player, menu: () => open, choose };
}

describe('the kiosk', () => {
  it('sells treats a bag at a time, up to what fits in your pockets', () => {
    const t = menus({ treats: 7 });
    t.m.openKiosk();
    t.choose('treats');
    expect(t.game.treats).toBe(9);
    t.choose('treats');
    expect(t.game.treats).toBe(9);
    expect(t.calls.at(-1)).toBe('toast ”Nämen, du har ju fickera fulla redan!”');
  });

  it('heals you with a korv, unless you are full', () => {
    const t = menus({ hp: 50 });
    t.m.openKiosk();
    t.choose('korv');
    expect(t.health.hp).toBe(50 + KORV_HP);
    const full = menus({ hp: HP_MAX });
    full.m.openKiosk();
    full.choose('korv');
    expect(full.health.hp).toBe(HP_MAX);
  });

  it('scratches a trisslott', () => {
    const t = menus();
    t.m.openKiosk();
    t.choose('triss');
    expect(t.calls).toEqual(['scratch']);
  });
});

describe('the cat menus', () => {
  const cat = (o: Partial<Cat> = {}) => ({ x: 1, z: 0, name: 'Misse', state: 'sit', owned: false, ...o }) as Cat;

  it('asks whether a stray ready to adopt comes home with you', () => {
    const t = menus();
    t.m.petCat(cat());
    expect(t.menu()!.kind).toBe('adopt');
    t.choose('adopt');
    expect(t.calls).toEqual(['heart', 'adopt', 'heart']);
  });

  it('closes a cat menu once you walk away, or it bolts', () => {
    const t = menus(),
      k = cat();
    t.m.petCat(k);
    const stay = t.menu()!.stay!;
    expect(stay()).toBe(true);
    t.player.x = 9;
    expect(stay()).toBe(false);
    t.player.x = 0;
    k.state = 'flee';
    expect(stay()).toBe(false);
  });

  it('offers your own cat a treat only while you have one', () => {
    const none = menus();
    none.m.openOwnCat(cat({ owned: true }));
    expect(none.menu()!.items.map(([k]) => k)).toEqual(['pet', 'play', 'home', 'no']);
    const some = menus({ treats: 2 });
    some.m.openOwnCat(cat({ owned: true }));
    expect(some.menu()!.items.map(([k]) => k)).toEqual(['pet', 'treat', 'play', 'home', 'no']);
  });
});
