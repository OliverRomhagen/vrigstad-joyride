// Skroten buys the car you drive in (#76): drive onto its ring, press E, and it makes an offer by the car's model and damage.
// Not with the police after you, and never a police car. main.ts passes in the menu plate, the wallet and what happens to the car. No three.js or DOM here.
import type { Car } from './cars';
import { carPrice, fmtKr } from './economy';
import type { MenuItem } from './pets';
import type { GameState } from './state';

/** What Skroten reads from the rest of the game. */
export interface SkrotenDeps {
  game: Pick<GameState, 'inCar' | 'pcar'>;
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
  earn(kr: number): void; // adds to your wallet and redraws it
  sellCar(c: Car): void; // puts you on foot beside the car, and takes the car away
}

/** Skroten's offer and the sale. */
export class Skroten {
  private readonly g: SkrotenDeps;

  constructor(g: SkrotenDeps) {
    this.g = g;
  }

  // what Skroten pays for c, or the reason it won't buy it
  private offer(c: Car): number | string {
    if (this.g.stars) return '”Inte mä snuten i hälarna! Kom tebaks när du ä av mä dom.”';
    return carPrice(c.type, this.g.modelId(c), c.dmg) ?? '”En polisbil? Ä du inte klok? Den rör ja inte.”';
  }

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
      '”Den där? Ja ger dej ' + fmtKr(kr) + ' för den.”',
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
    const { toast, earn, sellCar } = this.g;
    const kr = this.offer(c);
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return;
    }
    sellCar(c);
    earn(kr);
    toast('”Affärer ä affärer. Ja frågar inte var den kommer ifrån.” +' + fmtKr(kr) + '.', 4);
  }
}
