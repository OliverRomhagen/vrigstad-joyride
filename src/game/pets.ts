// Your pets: P (or the Pets button) calls them, sends them home or sets them free.
// Moved from src/game/main.ts (#177); main.ts passes in the menu and what the pets read from the rest of the game.
import type { Cat, CatColony } from './cats';
import { type Commands, UsageError } from './commands';

type Point = { x: number; z: number };
/** A pet you own, as its menu sees it. */
export interface Pet {
  name: string;
  home: boolean;
  rename(name: string): string;
  call(): void;
  sendHome(): void;
  free(): void;
}
/** A menu item: [key, label]; the 'no' item is last and gets Esc. */
export type MenuItem = [key: string, label: string];

/** What the pets read from the rest of the game. The getter is read when used, so main.ts can declare it later. */
export interface PetsDeps {
  colony: Pick<CatColony, 'owned' | 'home' | 'rename' | 'call' | 'sendHome' | 'setFree' | 'spawnNear' | 'adopt'>;
  button: { hidden: boolean | 'until-found' }; // the Pets button (`hidden` as the DOM types it): shown while you own a pet. main.ts hands it in until it moves into the HUD (rule 4)
  openMenu(kind: string, title: string, items: MenuItem[], pick: (k: string) => void): void;
  openRename(p: Pet): void; // the menu with a text field for the new name
  esc(t: string): string; // escapes a name for the menu's HTML
  readonly caller: Point; // where a called pet comes to: you, or the car you drive
  readonly inCar: boolean; // the adopt command waits until you're out: a cat made by the car would land inside it
  showHeart(cat: Cat): void; // over a newly adopted cat
}

/** The pets you own, and their menu. */
export class Pets {
  private readonly g: PetsDeps;

  constructor(g: PetsDeps) {
    this.g = g;
  }

  // One entry per pet you own; only the cat so far. Another kind of pet adds its own entry here, and the menu then lists them first.
  list(): Pet[] {
    const { colony } = this.g;
    return colony.owned
      ? [
          {
            name: colony.owned.name,
            home: colony.home,
            rename: n => colony.rename(n),
            call: () => colony.call(this.g.caller),
            sendHome: () => colony.sendHome(),
            free: () => colony.setFree(),
          },
        ]
      : [];
  }

  open() {
    const { openMenu, esc } = this.g,
      ps = this.list();
    if (!ps.length) return;
    if (ps.length === 1) {
      this.openPet(ps[0]);
      return;
    }
    openMenu(
      'pets',
      '”Dina djur”',
      [...ps.map((p, i): MenuItem => ['p' + i, esc(p.name) + (p.home ? ' (hemma)' : '')]), ['no', 'Stäng']],
      k => {
        if (k !== 'no') this.openPet(ps[+k.slice(1)]);
      },
    );
  }

  private openPet(p: Pet) {
    const { openMenu, esc } = this.g;
    openMenu(
      'pets',
      '”' + esc(p.name) + (p.home ? ' ä hemma.”' : '”'),
      [
        p.home ? ['call', 'Ropa hit'] : ['home', 'Skicka hem'],
        ['name', 'Byt namn'],
        ['free', 'Släpp fri'],
        ['no', 'Stäng'],
      ],
      k => {
        if (k === 'call') p.call();
        else if (k === 'home') p.sendHome();
        else if (k === 'name') this.g.openRename(p);
        else if (k === 'free')
          openMenu(
            'pets',
            '”Ska du släppa ' + esc(p.name) + ' fri? Dä går inte å ångra.”',
            [
              ['yes', 'Ja, släpp fri'],
              ['no', 'Nä'],
            ],
            c => {
              if (c === 'yes') {
                p.free();
                this.draw();
              }
            },
          );
      },
    );
  }

  draw() {
    this.g.button.hidden = !this.g.colony.owned;
  }

  /** The dev console's `adopt <pet>`: a new random pet of that kind, right by you. Another kind of pet adds its entry here. */
  registerCommands(commands: Pick<Commands, 'register'>) {
    const adopt = new Map([['cat', () => this.adoptCat()]]);
    commands.register('adopt', {
      usage: '<' + [...adopt.keys()].join(' | ') + '>',
      help: 'adopt a new random pet of that kind',
      run: a => {
        const f = a[0] && adopt.get(a[0].toLowerCase());
        if (!f) throw new UsageError(a[0] ? 'No pet called ' + a[0] + '.' : '');
        return f();
      },
    });
  }

  private adoptCat() {
    const { colony, inCar, caller, showHeart } = this.g;
    if (colony.owned) return 'You already have a cat, ' + colony.owned.name + '. Set it free first (P).';
    if (inCar) return 'Get out of the car first.';
    const cat = colony.spawnNear(caller); // out of the car, the caller is you
    colony.adopt(cat);
    showHeart(cat);
    this.draw();
    return 'Adopted a cat.';
  }
}
