// The menu plate: small menus on one plate over the game (the kiosk's one lucka, a cat, your pets, naming a pet).
// Number keys / Esc, or tap; walking away closes it. DOM over the canvas.
// Moved from src/game/main.ts (#177); main.ts passes in what the plate reads from the rest of the game.
import type { Input } from './input';
import type { MenuItem, Pet } from './pets';

/** What the menu plate reads from the rest of the game. The getters are read when used, so main.ts can declare those later. */
export interface MenuPlateDeps {
  kmenu: HTMLElement; // the plate
  canvas: Pick<HTMLElement, 'focus'>; // focus goes back to the game after a tapped choice
  doc: Pick<Document, 'exitPointerLock' | 'createElement'>;
  readonly input: Pick<Input, 'locked' | 'lockMouse'>;
  readonly hasPets: boolean; // P opens your pets only once you have one
  openPets: () => void;
  toast: (msg: string, secs?: number) => void;
  readonly consoleRelock: boolean; // the dev console freed the cursor and takes it back on close: a menu opened over it takes that over
  closeConsole: () => void;
}

/** The one menu that can be open at a time: what it shows, what a choice does, and what keeps it open. */
export class MenuPlate {
  private readonly g: MenuPlateDeps;
  private relock = false; // a menu needs the cursor: free it while the menu is open, and take it back after
  private menuPick: ((k: string) => void) | null = null; // what a choice does
  private menuStay: (() => boolean) | null = null; // what keeps the menu open (checked 4 times a second; none: stays open)
  private nameIn: HTMLInputElement | null = null;
  private kind: string | null = null;

  constructor(g: MenuPlateDeps) {
    this.g = g;
    g.kmenu.addEventListener('click', e => {
      const b = (e.target as Element).closest('button');
      if (b) {
        this.menuChoose(b.dataset.k!);
        g.canvas.focus();
      }
    });
  }

  /** Which menu is open: 'kiosk', 'cat', 'adopt', 'pets', or null. */
  get menuKind() {
    return this.kind;
  }

  // items are [key, label]; the 'no' item is last and gets Esc
  openMenu = (
    kind: string,
    title: string,
    items: MenuItem[],
    pick: (k: string) => void,
    stay: (() => boolean) | null = null,
  ) => {
    const { kmenu, input, doc } = this.g;
    this.nameIn = null;
    kmenu.innerHTML =
      '<p id="kmenu-t">' +
      title +
      '</p>' +
      items
        .map(
          ([k, label], i) =>
            '<button type="button" data-k="' +
            k +
            '"><kbd>' +
            (k === 'no' ? 'Esc' : k === 'ok' ? 'Enter' : i + 1) +
            '</kbd>' +
            label +
            '</button>',
        )
        .join('');
    this.kind = kind;
    this.menuPick = pick;
    this.menuStay = stay;
    if (kmenu.hidden) {
      this.relock = input.locked() || this.g.consoleRelock;
      if (input.locked()) doc.exitPointerLock();
    }
    kmenu.hidden = false;
    this.g.closeConsole(); // after the plate shows, so the console doesn't take the cursor back
  };
  closeMenu = () => {
    const { kmenu, input } = this.g;
    kmenu.hidden = true;
    this.nameIn = null;
    this.kind = this.menuPick = this.menuStay = null;
    if (this.relock) {
      this.relock = false;
      input.lockMouse();
    }
  };
  // a choice can open the next menu (a pet's "are you sure?"): then the menu stays up, and the cursor stays free
  menuChoose(k: string) {
    const pick = this.menuPick;
    this.menuPick = null;
    if (pick) pick(k);
    if (!this.menuPick) this.closeMenu();
  }
  /** Closes the menu once what keeps it open (walking away, a cat bolting) no longer holds. */
  closeIfLeft() {
    if (this.menuStay && !this.menuStay()) this.closeMenu();
  }

  // naming a pet: a text field in the menu; Enter saves, Esc cancels, and game keys don't fire while you type
  openRename = (p: Pet) => {
    const { kmenu, doc, toast } = this.g;
    this.openMenu(
      'pets',
      '”Va ska ' + esc(p.name) + ' heta?”',
      [
        ['ok', 'Spara'],
        ['no', 'Avbryt'],
      ],
      k => {
        const n = this.nameIn!.value;
        this.nameIn = null;
        if (k === 'ok' && n.trim()) toast('”' + p.rename(n) + '. Dä ä ett fint namn, dä.”', 2.5);
      },
    );
    const nameIn = doc.createElement('input');
    this.nameIn = nameIn;
    nameIn.type = 'text';
    nameIn.value = p.name;
    nameIn.setAttribute('aria-label', 'Name');
    nameIn.autocomplete = 'off';
    nameIn.spellcheck = false;
    kmenu.querySelector('p')!.after(nameIn);
    nameIn.focus();
    nameIn.select();
  };

  // the menus see each key first: typing a pet's name, the menu's number keys and Esc, P for your pets
  menuKey = (e: KeyboardEvent) => {
    const { kmenu, canvas, hasPets, openPets } = this.g,
      { nameIn } = this;
    if (nameIn && e.target === nameIn) {
      if (e.isComposing) return true;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') {
        e.preventDefault();
        this.menuChoose(e.code === 'Escape' ? 'no' : 'ok');
        canvas.focus();
      }
      return true;
    } // typing a name
    if (!kmenu.hidden) {
      const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code),
        b = n && kmenu.querySelectorAll('button')[+n[1] - 1];
      if (e.code === 'Escape' || (b && b.dataset.k !== 'no')) {
        e.preventDefault();
        this.menuChoose(e.code === 'Escape' ? 'no' : b!.dataset.k!);
        return true;
      }
      if (
        (e.code === 'Enter' || e.code === 'NumpadEnter') &&
        !kmenu.contains(e.target as Node) &&
        kmenu.querySelector('[data-k="ok"]')
      ) {
        e.preventDefault();
        this.menuChoose('ok');
        return true;
      }
    } // Enter is labelled on Spara, so it saves wherever focus is
    if (e.code === 'KeyP' && !e.repeat && hasPets) {
      if (this.kind === 'pets') this.closeMenu();
      else openPets();
      return true;
    }
    return kmenu.contains(e.target as Node); // Enter / Space on a focused menu button: let the button's own click handle it
  };
}

/** Escapes text, such as a pet's name, for the menu's HTML. */
export const esc = (t: string) => t.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
