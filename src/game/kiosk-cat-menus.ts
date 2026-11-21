// The kiosk's and the cats' menus, on the menu plate (src/game/menu.ts): what the kiosk sells, petting and adopting a stray, your own cat's menu.
// Moved from src/game/main.ts (#177); main.ts passes in the plate, the cats, your health and what the HUD draws. No three.js or DOM here.
import { type Cat, type CatColony, canTend } from './cats';
import { type Health, HP_MAX, heal, KORV_HP, RULLE_HP } from './health';
import type { MenuItem } from './pets';
import type { Place } from './places';
import type { GameState } from './state';

type Point = { x: number; z: number };
const TREAT_BAG = 3,
  TREAT_MAX = 9; // treats per bag from the kiosk; how many fit in your pockets

/** What the menus read from the rest of the game. */
export interface KioskCatMenusDeps {
  game: Pick<GameState, 'inCar' | 'treats'>;
  readonly player: Point;
  colony: Pick<CatColony, 'pet' | 'adopt' | 'decline' | 'treat' | 'play' | 'sendHome'>;
  health: Health;
  openMenu(
    kind: string,
    title: string,
    items: MenuItem[],
    pick: (k: string) => void,
    stay?: (() => boolean) | null,
  ): void;
  esc(t: string): string; // escapes a name for the menu's HTML
  toast(msg: string, secs?: number): void;
  scratch(): void; // a trisslott
  nearPlace(): Place | null;
  showHeart(k: Cat): void;
  drawPets(): void;
  drawTreats(): void;
  drawHealth(): void;
}

/** The kiosk's menu and the cats' menus. */
export class KioskCatMenus {
  private readonly g: KioskCatMenusDeps;

  constructor(g: KioskCatMenusDeps) {
    this.g = g;
  }

  // the kiosk's one lucka, on the menu plate
  openKiosk = () => {
    const { openMenu, toast, scratch, nearPlace } = this.g;
    openMenu(
      'kiosk',
      '”Va ska dä va?”',
      [
        ['triss', 'Trisslott'],
        ['treats', 'Kattgodis (3 st)'],
        ['korv', 'Korv me brö <small>+' + KORV_HP + ' health</small>'],
        ['vego', 'Vegokorv me brö'],
        ['rulle', 'Smålandsrulle <small>+' + RULLE_HP + ' health</small>'],
        ['no', 'Nä tack'],
      ],
      k => {
        if (k === 'triss') scratch();
        else if (k === 'treats') this.buyTreats();
        else if (k === 'korv') this.eat(KORV_HP, '”En korv me brö, tack.”', '”Varsågod. Senap å ketchup ä på disken.”');
        else if (k === 'vego')
          toast('”En vegokåv me brö, tack.”\n”Vegokåv? Nä vi ha ingen vegokåv! Den ligger i frysen.”', 4); // always sold out
        else if (k === 'rulle')
          this.eat(RULLE_HP, '”En smålandsrulle, tack.”', '”Varsågod, mos å räksallad å allt. Dä ä mat dä!”');
      },
      () => nearPlace()?.kind === 'kiosk',
    );
  };
  // food from the kiosk: free until there is money (#76)
  // \n puts each speaker on their own line in the toast: you order first, then the kiosk answers
  private eat(n: number, order: string, reply: string) {
    const { health, toast, drawHealth } = this.g;
    if (health.hp >= HP_MAX) {
      toast(order + '\n”Du ser ju mätt ut, du. Kom tebaks när du ä hungrig.”', 3);
      return;
    }
    heal(health, n);
    drawHealth();
    toast(order + '\n' + reply + ' +' + n + ' health.', 3.5);
  }
  private buyTreats() {
    const { game, toast, drawTreats } = this.g;
    if (game.treats >= TREAT_MAX) {
      toast('”Nämen, du har ju fickera fulla redan!”', 2.5);
      return;
    }
    game.treats = Math.min(TREAT_MAX, game.treats + TREAT_BAG);
    drawTreats();
    toast('”En påse kattgodis, varsågo. Kattera ä tôcka i dä.”', 4);
  }

  // a cat's menu stays open while canTend holds (src/game/cats.ts)
  private nearMenuCat = (k: Cat) => () => canTend(k, this.g.player, this.g.game.inCar);
  // a good pet that makes a cat ready to be adopted asks whether it comes home with you
  petCat = (k: Cat) => {
    const { colony, openMenu, showHeart, drawPets } = this.g;
    const ready = colony.pet(k);
    showHeart(k);
    if (ready)
      openMenu(
        'adopt',
        '”Ska du följa mä hem, kisse?”',
        [
          ['adopt', 'Ja, adoptera'],
          ['no', 'Nä, inte nu'],
        ],
        c => {
          if (c === 'adopt') {
            colony.adopt(k);
            showHeart(k);
          } else colony.decline(k);
          drawPets();
        },
        this.nearMenuCat(k),
      );
  };
  // your own cat: E opens its menu rather than petting it straight away; Ge godis shows only while you have treats
  openOwnCat = (k: Cat) => {
    const { game, colony, openMenu, esc, showHeart } = this.g;
    openMenu(
      'cat',
      '”' + esc(k.name) + '”',
      [
        ['pet', 'Klappa'],
        ...(game.treats ? [['treat', 'Ge godis'] as MenuItem] : []),
        ['play', 'Leka'],
        ['home', 'Skicka hem'],
        ['no', 'Stäng'],
      ],
      c => {
        if (c === 'pet') this.petCat(k);
        else if (c === 'treat') {
          if (colony.treat(k)) showHeart(k);
        } else if (c === 'play') colony.play(k);
        else if (c === 'home') colony.sendHome();
      },
      this.nearMenuCat(k),
    );
  };
}
