import { describe, expect, it } from 'vitest';
import { esc, MenuPlate, type MenuPlateDeps, menuOwnsKey } from '../../../src/game/menu';
import type { MenuItem, Pet } from '../../../src/game/pets';

// Node has no DOM, so the plate gets a stub that carries only what the plate touches: the buttons it writes into its HTML,
// the title it puts the name field after, and what it contains.
type Button = { dataset: { k: string } };
type Field = {
  value: string;
  type: string;
  autocomplete: string;
  spellcheck: boolean;
  focused: boolean;
  setAttribute(): void;
  focus(): void;
  select(): void;
};
function plate() {
  let buttons: Button[] = [],
    field: Field | null = null;
  const kmenu = {
    hidden: true,
    set innerHTML(html: string) {
      buttons = [...html.matchAll(/data-k="([^"]*)"/g)].map(m => ({ dataset: { k: m[1] } }));
      field = null;
    },
    querySelectorAll: () => buttons,
    querySelector: (sel: string) =>
      sel === 'p'
        ? {
            after(el: Field) {
              field = el;
            },
          }
        : (buttons.find(b => sel === '[data-k="' + b.dataset.k + '"]') ?? null),
    contains: (t: unknown) => t !== null && (t === field || buttons.includes(t as Button)),
    addEventListener() {},
  };
  const calls: string[] = [];
  const game = { locked: false, hasPets: false, consoleRelock: false };
  const deps: MenuPlateDeps = {
    kmenu: kmenu as unknown as HTMLElement,
    canvas: { focus: () => void calls.push('focus') },
    doc: {
      exitPointerLock: () => void calls.push('unlock'),
      createElement: (() => ({
        value: '',
        type: '',
        autocomplete: '',
        spellcheck: true,
        focused: false,
        setAttribute() {},
        focus() {
          this.focused = true;
        },
        select() {},
      })) as unknown as Document['createElement'],
    },
    input: { locked: () => game.locked, lockMouse: () => void calls.push('lock') },
    get hasPets() {
      return game.hasPets;
    },
    openPets: () => void calls.push('pets'),
    toast: msg => void calls.push('toast ' + msg),
    get consoleRelock() {
      return game.consoleRelock;
    },
    closeConsole: () => {
      game.consoleRelock = false;
    },
  };
  const menu = new MenuPlate(deps);
  return { menu, kmenu, calls, game, field: () => field };
}
function key(code: string, target: unknown = null) {
  const e = {
    code,
    target,
    repeat: false,
    isComposing: false,
    prevented: false,
    preventDefault: () => (e.prevented = true),
  };
  return e as unknown as KeyboardEvent & { prevented: boolean };
}
const YES_NO: MenuItem[] = [
  ['yes', 'Ja'],
  ['no', 'Nej'],
];
function pet(name: string) {
  const renamed: string[] = [];
  const p = {
    name,
    home: false,
    rename: (n: string) => {
      renamed.push(n);
      return n;
    },
    call() {},
    sendHome() {},
    free() {},
  } satisfies Pet;
  return { p, renamed };
}

describe('MenuPlate', () => {
  it('opens, picks a numbered item and closes', () => {
    const { menu, kmenu } = plate(),
      picked: string[] = [];
    menu.openMenu('cat', 'Katt', YES_NO, k => picked.push(k));
    expect(kmenu.hidden).toBe(false);
    expect(menu.menuKind).toBe('cat');
    const e = key('Digit1');
    expect(menu.menuKey(e)).toBe(true);
    expect(e.prevented).toBe(true);
    expect(picked).toEqual(['yes']);
    expect(kmenu.hidden).toBe(true);
    expect(menu.menuKind).toBe(null);
  });

  it('picks no on Esc, and not on the number of the no item', () => {
    const { menu } = plate(),
      picked: string[] = [];
    menu.openMenu('cat', 'Katt', YES_NO, k => picked.push(k));
    menu.menuKey(key('Digit2'));
    expect(picked).toEqual([]);
    menu.menuKey(key('Escape'));
    expect(picked).toEqual(['no']);
  });

  it('stays open, with the cursor free, when a choice opens the next menu', () => {
    const { menu, kmenu, calls, game } = plate(),
      picked: string[] = [];
    game.locked = true;
    menu.openMenu('pets', 'Dina djur', YES_NO, () => menu.openMenu('pets', 'Säker?', YES_NO, k => picked.push(k)));
    menu.menuKey(key('Digit1'));
    expect(kmenu.hidden).toBe(false);
    expect(calls).toEqual(['unlock']);
    menu.menuKey(key('Digit1'));
    expect(picked).toEqual(['yes']);
    expect(kmenu.hidden).toBe(true);
    expect(calls).toEqual(['unlock', 'lock']);
  });

  it('frees the pointer for a menu and takes it back only if the menu freed it', () => {
    const locked = plate();
    locked.game.locked = true;
    locked.menu.openMenu('cat', 'Katt', YES_NO, () => {});
    locked.menu.openMenu('cat', 'Katt igen', YES_NO, () => {}); // already open: doesn't free it twice
    locked.menu.closeMenu();
    expect(locked.calls).toEqual(['unlock', 'lock']);

    const free = plate();
    free.menu.openMenu('cat', 'Katt', YES_NO, () => {});
    free.menu.closeMenu();
    expect(free.calls).toEqual([]);
  });

  it('takes the cursor back on close when it opened over the dev console', () => {
    const t = plate();
    t.game.consoleRelock = true; // the console freed the cursor
    t.menu.openMenu('kiosk', 'Kiosken', YES_NO, () => {});
    expect(t.game.consoleRelock).toBe(false); // the console is closed
    t.menu.closeMenu();
    expect(t.calls).toEqual(['lock']);
  });

  it('closes once what keeps it open no longer holds', () => {
    const { menu, kmenu } = plate();
    let near = true;
    menu.openMenu(
      'kiosk',
      'Kiosken',
      YES_NO,
      () => {},
      () => near,
    );
    menu.closeIfLeft();
    expect(kmenu.hidden).toBe(false);
    near = false;
    menu.closeIfLeft();
    expect(kmenu.hidden).toBe(true);
  });

  it('saves a new name on Enter', () => {
    const { menu, kmenu, calls, field } = plate(),
      { p, renamed } = pet('Misse');
    menu.openRename(p);
    const nameIn = field()!;
    expect(nameIn.value).toBe('Misse');
    expect(nameIn.focused).toBe(true);
    nameIn.value = 'Sotis';
    expect(menu.menuKey(key('KeyS', nameIn))).toBe(true); // typing doesn't reach the game
    expect(renamed).toEqual([]);
    menu.menuKey(key('Enter', nameIn));
    expect(renamed).toEqual(['Sotis']);
    expect(kmenu.hidden).toBe(true);
    expect(calls).toContain('focus');
    expect(calls.some(c => c.startsWith('toast'))).toBe(true);
  });

  it('cancels a rename on Esc, and ignores a blank name', () => {
    const { menu, kmenu, calls, field } = plate(),
      { p, renamed } = pet('Misse');
    menu.openRename(p);
    field()!.value = 'Sotis';
    menu.menuKey(key('Escape', field()));
    expect(kmenu.hidden).toBe(true);
    menu.openRename(p);
    field()!.value = '   ';
    menu.menuKey(key('Enter', field()));
    expect(renamed).toEqual([]);
    expect(calls.some(c => c.startsWith('toast'))).toBe(false);
  });

  it('saves a rename on Enter while focus is in the game', () => {
    const { menu, kmenu, field } = plate(),
      { p, renamed } = pet('Misse');
    menu.openRename(p);
    field()!.value = 'Sotis';
    expect(menu.menuKey(key('Enter'))).toBe(true);
    expect(renamed).toEqual(['Sotis']);
    expect(kmenu.hidden).toBe(true);
  });

  it('toggles your pets on P once you have one', () => {
    const { menu, calls, game } = plate();
    expect(menu.menuKey(key('KeyP'))).toBe(false);
    game.hasPets = true;
    expect(menu.menuKey(key('KeyP'))).toBe(true);
    expect(calls).toEqual(['pets']);
    expect(menu.menuKey(Object.assign(key('KeyP'), { repeat: true }))).toBe(false); // holding P doesn't flicker the menu
    menu.openMenu('cat', 'Katt', YES_NO, () => {});
    menu.menuKey(key('KeyP'));
    expect(calls).toEqual(['pets', 'pets']); // from another menu, P opens your pets
    menu.openMenu('pets', 'Dina djur', YES_NO, () => {});
    menu.menuKey(key('KeyP'));
    expect(menu.menuKind).toBe(null);
  });
});

describe('menuOwnsKey', () => {
  it('names every key the plate uses, so a control can’t take one', () => {
    // a number key closes the menu it picks in, and its next repeat would press a control on it
    for (const code of ['Digit1', 'Digit9', 'Numpad1', 'Numpad9', 'Enter', 'NumpadEnter', 'Escape', 'KeyP'])
      expect(menuOwnsKey(code), code).toBe(true);
    for (const code of ['Digit0', 'Numpad0', 'KeyX', 'F1']) expect(menuOwnsKey(code), code).toBe(false); // no option 0
  });
});

describe('esc', () => {
  it('escapes HTML in a name', () => {
    expect(esc('<b>"Sotis" & co\'</b>')).toBe('&#60;b&#62;&#34;Sotis&#34; &#38; co&#39;&#60;/b&#62;');
  });
});
