// The lab garage's screen (#3, ?lab=garage): DOM over the canvas that draws Garage (garage.ts) and sends it what you pick.
// The camera circles the car meanwhile (render/camera-rig.ts), so the plates keep to the edges and leave the middle to it.
import { fmtKr, type Wallet } from './economy';
import { CAT_LABELS, GARAGE_TABS, type Garage, type GarageCat, type GarageTab } from './garage';
import { esc } from './menu';

/** What the garage's screen draws into and reads. */
export interface GarageHudDeps {
  root: HTMLElement; // #garage
  body: HTMLElement; // gets .in-garage, which hides the driving HUD
  garage: Garage;
  wallet: Wallet;
  carName(): string; // the car on the lift
}

const KEYS =
  '<span><kbd>← →</kbd>Tab</span><span><kbd>↑ ↓</kbd>Shelf</span><span><kbd>1–9</kbd>Pick</span><span><kbd>Enter</kbd>Betala</span><span><kbd>Esc</kbd>Nä, dä får va</span><span>Drag to look round</span>';

/** Draws the garage while it's open, and takes its clicks and keys. */
export class GarageHud {
  private readonly g: GarageHudDeps;
  private drawn = -1; // the Garage version drawn
  private drawnKr = -1;
  private wasOpen = false;

  constructor(g: GarageHudDeps) {
    this.g = g;
    g.root.addEventListener('click', this.click);
  }

  /** Every frame: shows or hides the screen, and draws it again when the garage or the wallet changed. */
  update() {
    const { garage, root, body, wallet } = this.g,
      open = garage.isOpen;
    if (open !== this.wasOpen) {
      root.hidden = !open;
      body.classList.toggle('in-garage', open);
      this.wasOpen = open;
      this.drawn = -1;
    }
    if (open && (this.drawn !== garage.version || this.drawnKr !== wallet.kr)) this.draw();
  }

  /** The garage sees each key first while it's open; true when it used it. */
  key = (e: KeyboardEvent): boolean => {
    const { garage } = this.g;
    if (!garage.isOpen) return false;
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code),
      onButton = e.target instanceof HTMLButtonElement;
    if (e.code === 'Escape' || e.code === 'KeyE') garage.close();
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') garage.stepTab(e.code === 'ArrowLeft' ? -1 : 1);
    else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') garage.stepCat(e.code === 'ArrowUp' ? -1 : 1);
    else if (n) garage.pick(Number(n[1]) - 1);
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton) garage.pay();
    else if (e.code === 'Backspace') garage.undo();
    else return false;
    e.preventDefault();
    this.update();
    return true;
  };

  private click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    if (!el || el.disabled) return;
    const { garage } = this.g,
      [act, arg] = el.dataset.act!.split(':');
    if (act === 'tab') garage.setTab(arg as GarageTab);
    else if (act === 'cat') garage.setCat(arg as GarageCat);
    else if (act === 'pick') garage.pick(Number(arg));
    else if (act === 'pay') garage.pay();
    else if (act === 'undo') garage.undo();
    else if (act === 'close') garage.close();
    this.update();
  };

  private draw() {
    const { garage, root, wallet, carName } = this.g,
      { jobs, kr } = garage.bill(),
      over = kr > wallet.kr;
    this.drawn = garage.version;
    this.drawnKr = wallet.kr;
    const tabs = GARAGE_TABS.map(t => {
      const n = t.cats.filter(c => garage.changed(c)).length;
      return `<button type="button" role="tab" data-act="tab:${t.id}" aria-selected="${t.id === garage.tab}">${t.label}<small>${n ? n + ' ●' : ''}</small></button>`;
    }).join('');
    const shelves = garage
      .cats()
      .map(
        c =>
          `<button type="button" class="g-row" data-act="cat:${c}" aria-pressed="${c === garage.cat}"><span class="g-name">${CAT_LABELS[c]}</span><span class="g-sub">${esc(garage.pickedName(c))}</span><span class="g-dot">${garage.changed(c) ? '●' : ''}</span></button>`,
      )
      .join('');
    const choices = garage
      .choices()
      .map(
        (ch, i) =>
          `<button type="button" class="g-part" data-act="pick:${i}" aria-pressed="${ch.picked}"${ch.locked ? ' disabled' : ''}><kbd>${i + 1}</kbd>${ch.swatch ? `<span class="g-swatch" style="background:${ch.swatch}" aria-hidden="true"></span>` : ''}<span class="g-txt"><span class="g-ttl">${esc(ch.name)}</span><span class="g-help">${esc(ch.help)}</span></span><span class="g-price">${ch.price}</span></button>`,
      )
      .join('');
    const stats = garage
      .stats()
      .map(s => {
        const lo = Math.min(s.fromShare, s.toShare) * 100,
          hi = Math.max(s.fromShare, s.toShare) * 100,
          changed = s.from !== s.to;
        return `<div class="g-stat"><span>${s.label}</span><div class="g-bar"><i style="width:${hi}%" class="${s.better ? 'up' : 'down'}"></i><i style="width:${lo}%"></i></div><span class="g-val">${s.from}${changed ? ` <em class="${s.better ? 'up' : 'down'}">→ ${s.to}</em>` : ''}</span></div>`;
      })
      .join('');
    const note = garage.note();
    root.innerHTML = `
<header class="g-top"><div class="g-sign">Skroten · Verkstan<small>Plåt-Pelle’s lift</small></div><div class="g-car plate"><b>${esc(carName())}</b></div><div class="g-kr plate">${fmtKr(wallet.kr)}</div></header>
<div class="g-tabs" role="tablist" aria-label="Verkstan">${tabs}</div>
<nav class="g-nav plate" aria-label="Shelves">${shelves}</nav>
<section class="g-parts plate" aria-label="Parts">
  <p class="g-pelle" aria-live="polite">Plåt-Pelle: ${esc(garage.line())}</p>
  <div class="g-list">${choices}</div>
  <div class="g-fill"></div>
  <div class="g-bill"><span>${jobs ? jobs + (jobs === 1 ? ' job on the bill' : ' jobs on the bill') : 'Nothing picked yet'}</span><b class="${over ? 'over' : ''}">${fmtKr(kr)}</b></div>
  <div class="g-actions"><button type="button" data-act="undo"${jobs ? '' : ' disabled'}>Ångra</button><button type="button" class="g-pay" data-act="pay"${!jobs || over ? ' disabled' : ''}>Betala &amp; montera</button></div>
  <button type="button" class="g-close" data-act="close">Nä, dä får va</button>
</section>
<section class="g-stats plate" aria-label="What it does to the car">${stats}${note ? `<p class="g-note"><kbd>T</kbd>${esc(note)}</p>` : ''}</section>
<div class="g-keys">${KEYS}</div>`;
  }
}
