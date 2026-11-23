// The E prompt (what pressing E would do here), the safehouse plate with its lying-low timer, and the speed plate.
// DOM over the canvas. Moved from src/game/main.ts (#177); main.ts passes in what the prompt asks about.
import type { Car } from './cars';
import type { Cat } from './cats';
import { fmtKr, lotPrice } from './economy';
import { wrecked } from './health';
import type { Place } from './places';
import { tooFastToGetOut } from './player';
import type { GameState } from './state';

/** What the prompt reads from the rest of the game. The getters are read every time it is drawn. */
export interface ActionPromptDeps {
  $(id: string): HTMLElement;
  game: Pick<GameState, 'started' | 'inCar' | 'pcar' | 'treats'>;
  places: { readonly inside: Place | null };
  wanted: { readonly stars: number; readonly hideLeft: number };
  readonly menuOpen: boolean; // a menu covers the prompt
  coarse: boolean; // a touch screen: no "Get out" prompt, the E button says it
  nearPlace(): Place | null;
  skrotenBuys(): boolean; // the car you drive stands on Skroten's ring, and Skroten would buy it
  skrotenLift(): number | null; // the car you drive stands on the workshop's lift: what Plåt-Pelle asks to mend it (0 for a whole car); null when he wouldn't work on it
  nearOwner(): boolean; // you stand on foot next to Plåt-Pelle
  nearCat(): Cat | null;
  nearestCar(): Car | null;
  catFirst(kt: Cat | null, pl: Place | null): boolean;
  carName(c: Car): string;
  esc(t: string): string; // escapes a name for HTML
}

/** Redraws the prompt and the plates; the loop calls `update` a few times a second. */
export class ActionPrompt {
  private readonly g: ActionPromptDeps;

  constructor(g: ActionPromptDeps) {
    this.g = g;
  }

  update() {
    const {
      $,
      game,
      places,
      wanted,
      coarse,
      nearPlace,
      skrotenBuys,
      skrotenLift,
      nearOwner,
      nearCat,
      nearestCar,
      catFirst,
      carName,
      esc,
    } = this.g;
    const pr = $('prompt'),
      pl = game.started && !places.inside ? nearPlace() : null,
      kt = game.started ? nearCat() : null,
      c = game.started && !game.inCar && !places.inside ? nearestCar() : null,
      liftKr = game.inCar ? skrotenLift() : null;
    $('hide').hidden = !places.inside;
    if (places.inside) {
      $('hide').innerHTML = wanted.stars
        ? 'Lying low<b>' +
          Math.floor(Math.ceil(Math.max(0, wanted.hideLeft)) / 60) +
          ':' +
          String(Math.ceil(Math.max(0, wanted.hideLeft)) % 60).padStart(2, '0') +
          '</b>'
        : 'Safehouse · ' + places.inside.name;
      pr.hidden = false;
      pr.innerHTML = '<kbd>E</kbd>Go outside';
    } else if (kt && catFirst(kt, pl)) {
      pr.hidden = this.g.menuOpen;
      pr.innerHTML =
        '<kbd>E</kbd>' +
        (kt.owned ? 'Hang out with ' + esc(kt.name) : 'Pet the cat' + (game.treats ? ' (offer a treat)' : ''));
    } else if (pl) {
      pr.hidden = this.g.menuOpen;
      pr.innerHTML = '<kbd>E</kbd>' + (pl.kind === 'safe' ? 'Go inside the safehouse' : 'Handla i kiosken');
    } else if (game.started && nearOwner()) {
      pr.hidden = this.g.menuOpen;
      pr.innerHTML = '<kbd>E</kbd>Talk to Plåt-Pelle';
    } else if (game.inCar && game.pcar && skrotenBuys()) {
      pr.hidden = this.g.menuOpen || tooFastToGetOut(game.pcar);
      pr.innerHTML = '<kbd>E</kbd>Sell the ' + carName(game.pcar) + ' at Skroten';
    } else if (game.inCar && game.pcar && liftKr !== null) {
      pr.hidden = this.g.menuOpen || tooFastToGetOut(game.pcar);
      pr.innerHTML = liftKr
        ? '<kbd>E</kbd>Repair the ' + carName(game.pcar) + ' · ' + fmtKr(liftKr)
        : '<kbd>E</kbd>Upgrade the ' + carName(game.pcar);
    } else if (game.inCar && game.pcar && !coarse) {
      pr.hidden = tooFastToGetOut(game.pcar);
      pr.innerHTML = '<kbd>E</kbd>Get out';
    } else if (c?.saleKr) {
      const kr = lotPrice(c.saleKr, c.dmg); // like the sell prompt, none when Plåt-Pelle would refuse: with stars, or for a wreck
      pr.hidden = this.g.menuOpen || !!wanted.stars || kr === null;
      if (kr !== null) pr.innerHTML = '<kbd>E</kbd>Buy the ' + carName(c) + ' · ' + fmtKr(kr);
    } else if (c) {
      pr.hidden = false;
      pr.innerHTML =
        '<kbd>E</kbd>' + (c.owned ? 'Get in the ' : 'Steal the ') + carName(c) + (wrecked(c) ? ' (wrecked)' : '');
    } else pr.hidden = true;
    const bl = game.inCar ? 'Brake' : 'Jump';
    if ($('p-brake').textContent !== bl) $('p-brake').textContent = bl;
    $('speed').hidden = !game.inCar;
    if (game.inCar && game.pcar) {
      $('kmh').textContent = String(Math.round(Math.abs(game.pcar.v) * 3.6));
      $('carname').textContent = carName(game.pcar) + (wrecked(game.pcar) ? ' · wrecked' : '');
    }
  }
}
