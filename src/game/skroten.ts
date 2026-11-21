// Skroten buys the car you drive in (#76): drive onto its ring, press E, and Skrot-Nisse makes an offer by the car's model and damage.
// Not with the police after you, and never a police car. On foot you can talk to him. main.ts passes in the menu plate, the wallet and
// what happens to the car. No three.js or DOM here.
import type { Car } from './cars';
import { carPrice, earn, fmtKr, type Wallet } from './economy';
import type { MenuItem } from './pets';
import { NISSE_UV, yardToWorld } from './skroten-yard';
import type { GameState } from './state';

const NISSE = 'Skrot-Nisse: ';
const NISSE_AT = yardToWorld(NISSE_UV.u, NISSE_UV.v);
const TALK_M = 3; // how close you stand to talk to him
/** What he says when you talk to him on foot, one after the other. */
export const NISSE_LINES = [
  '”Tjena! Har du nån bil du vill bli av mä? Kör in den på ringen.”',
  '”Ja köper allt som rullar. Å dä mesta som inte gör dä.”',
  '”Polisbilar rör ja inte. Ja ä inte dum.”',
  '”Fråga inte var bilarna kommer ifrån, så frågar inte ja heller.”',
  '”Den där Volvon har stått här sen sjuttifem. Den blir aldrig klar.”',
];

/** What Skroten reads from the rest of the game. */
export interface SkrotenDeps {
  game: Pick<GameState, 'inCar' | 'pcar'>;
  player: { readonly x: number; readonly z: number };
  readonly stars: number;
  openMenu(
    kind: string,
    title: string,
    items: MenuItem[],
    pick: (k: string) => void,
    stay?: (() => boolean) | null,
  ): void;
  toast(msg: string, secs?: number): void;
  atSkroten(): boolean; // the car you drive stands on Skroten's ring
  modelId(c: Car): string | undefined; // the model the car wears, if it has one
  wallet: Wallet; // the HUD shows whatever it holds
  sellCar(c: Car): void; // puts you on foot beside the car, and takes the car away
}

/** Skroten's offer and the sale. */
export class Skroten {
  private readonly g: SkrotenDeps;
  private said = 0;

  constructor(g: SkrotenDeps) {
    this.g = g;
  }

  // what Skroten pays for c, or the reason it won't buy it
  private offer(c: Car): number | string {
    if (this.g.stars) return NISSE + '”Inte mä snuten i hälarna! Kom tebaks när du ä av mä dom.”';
    return carPrice(c.type, this.g.modelId(c), c.dmg) ?? NISSE + '”En polisbil? Ä du inte klok? Den rör ja inte.”';
  }

  /** You stand on foot next to Skrot-Nisse. */
  nearNisse() {
    const { game, player } = this.g;
    return !game.inCar && Math.hypot(player.x - NISSE_AT.x, player.z - NISSE_AT.z) < TALK_M;
  }

  /** E next to him: his next line, or a word about the police. */
  talk = () => {
    const { stars, toast } = this.g;
    if (stars) toast(NISSE + '”Försvinn! Du har ju snuten efter dej!”', 3);
    else toast(NISSE + NISSE_LINES[this.said++ % NISSE_LINES.length], 4);
  };

  /** E on the ring: Skroten's offer for the car you drive, on the menu plate. */
  open = () => {
    const { game, openMenu, toast, atSkroten } = this.g,
      c = game.pcar;
    if (!game.inCar || !c) return;
    const kr = this.offer(c);
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return;
    }
    openMenu(
      'skrot',
      NISSE + '”Den där? Ja ger dej ' + fmtKr(kr) + ' för den.”',
      [
        ['sell', 'Sälj <small>' + fmtKr(kr) + '</small>'],
        ['no', 'Nä, ja behåller den'],
      ],
      k => {
        if (k === 'sell') this.sell(c);
      },
      () => game.pcar === c && atSkroten(),
    );
  };

  // the offer is made again at the moment of sale: stars can come while the menu is open
  private sell(c: Car) {
    const { toast, wallet, sellCar } = this.g;
    const kr = this.offer(c);
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return;
    }
    sellCar(c);
    earn(wallet, kr);
    toast(NISSE + '”Affärer ä affärer. Ja frågar inte var den kommer ifrån.” +' + fmtKr(kr) + '.', 4);
  }
}
