// The line under the minimap that says where you stand (#637): your position, the way you face and the street, for a
// bug report or a playtest note. Hidden until `?debug=coords` or `coords on`; a tap or click copies the spot as a link
// with `?at=`. Page code: the formatting and the command are in src/game/sim/coords.ts.
import { withParam } from '../lab/flags';
import type { RoadNetwork } from '../world/roads';
import { atParam, type CoordsView, nearestStreet, spotLine, type Viewpoint } from './sim/coords';

const COPIED_S = 1.4; // the line says Copied this long (s)

export interface CoordsLineDeps {
  /** the button under the minimap, with a span for the spot and a small for the street */
  el: HTMLElement;
  roads: Pick<RoadNetwork, 'forEachSegmentNear' | 'lines'>;
  /** where you stand, or the car you drive does, and where the camera looks */
  where(): Viewpoint;
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>;
  /** undefined where the page can't write to the clipboard (not https, an old browser) */
  clipboard: Pick<Clipboard, 'writeText'> | undefined;
  shown: boolean;
}

/** The coordinates line: shows where you are when shown, and copies a link to the spot when pressed. */
export class CoordsLine implements CoordsView {
  private readonly d: CoordsLineDeps;
  private readonly spotEl: HTMLElement;
  private readonly streetEl: HTMLElement;
  private copying = false;

  constructor(d: CoordsLineDeps) {
    this.d = d;
    this.spotEl = d.el.querySelector('span') as HTMLElement;
    this.streetEl = d.el.querySelector('small') as HTMLElement;
    d.el.addEventListener('click', () => this.copy());
    this.shown = d.shown;
  }

  get shown() {
    return !this.d.el.hidden;
  }

  set shown(on: boolean) {
    this.d.el.hidden = !on;
    if (on) this.update();
  }

  /** The page's address, every parameter kept, with `?at=` for where you stand. */
  link(): string {
    const { origin, pathname, search, hash } = this.d.location;
    return origin + pathname + withParam(search, 'at', atParam(this.d.where())) + hash;
  }

  /** Redraws the line, writing to the page only what changed. */
  update() {
    if (!this.shown || this.copying) return;
    const s = this.d.where();
    this.write(spotLine(s), nearestStreet(this.d.roads, s.x, s.z));
  }

  private write(spot: string, street: string) {
    if (this.spotEl.textContent !== spot) this.spotEl.textContent = spot;
    if (this.streetEl.textContent !== street) this.streetEl.textContent = street;
  }

  private copy() {
    // give the keys back to the game: a focused button would take the next Space as another press
    this.d.el.blur();
    const done = (said: string) => {
      this.copying = true;
      this.write(said, '');
      setTimeout(() => {
        this.copying = false;
        this.update();
      }, COPIED_S * 1000);
    };
    const { clipboard } = this.d;
    if (!clipboard) return done('Can’t copy here: add ?dev and type coords in the console');
    clipboard.writeText(this.link()).then(
      () => done('Copied'),
      () => done('Can’t copy here: add ?dev and type coords in the console'),
    );
  }
}
