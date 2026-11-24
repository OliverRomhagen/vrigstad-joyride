<script lang="ts">
import ArrowLeft from '@lucide/svelte/icons/arrow-left';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import FileText from '@lucide/svelte/icons/file-text';
import X from '@lucide/svelte/icons/x';
import { onMount } from 'svelte';
import { VEHICLES } from '#game/render/vehicle-registry';
import { type CarType, VEHICLE_SPECS } from '#game/sim/vehicle-spec';
import type { Clock } from '#lib/clock';
import { colourName } from '#lib/colour-name';
import Head from '#lib/Head.svelte';
import { PelleTalk } from '#lib/pelle-talk';
import Skroten from '#lib/Skroten.svelte';
import SpecTable from '#lib/SpecTable.svelte';
import { kmh } from '#lib/units';
import { resolve } from '$app/paths';

let { data } = $props();

const SAY_FOR_MS = 6500; // how long one of Plåt-Pelle's lines stays up
const LISTEN_MS = 500; // how often he gets the chance to speak

const cars = VEHICLES.map(v => ({ ...v, spec: VEHICLE_SPECS[v.archetype as CarType] }));
const most = {
  max: Math.max(...cars.map(c => c.spec.max)),
  acc: Math.max(...cars.map(c => c.spec.acc)),
};

let index = $state(0);
let paints = $state<Record<string, string | undefined>>({});
let papers = $state<HTMLDialogElement>();
// how far the header reaches down and the card up, so the scene is framed between them: their heights, bound so this
// follows them, and their offsets from the window's edges, measured, as the styles set those by the window's width (the
// card's padding changes at the same breakpoint, so its height changes too and this measures again)
let topEl = $state<HTMLElement>();
let cardEl = $state<HTMLElement>();
let topHeight = $state(0);
let cardHeight = $state(0);
const below = (el: HTMLElement) => (el.offsetParent?.clientHeight ?? 0) - el.offsetTop - el.offsetHeight;
const margins = $derived({
  top: topHeight + (topEl?.offsetTop ?? 0),
  bottom: cardHeight + (cardEl ? below(cardEl) : 0),
});
// loading until the first car stands on the ring; failed while the picked car's model won't load; down when the scene
// didn't start, which picking another car can't mend
let status = $state<'loading' | 'ready' | 'failed' | 'down'>('loading');
const car = $derived(cars[index]);

// Plåt-Pelle, and each car in a paint of its own, picked again on each visit: in the browser only, as the page is
// prerendered. Each paint is one the game paints that car with, so the swatches always show it (the model's own may not be).
const clock: Clock = { now: () => performance.now() };
let talk: PelleTalk | undefined;
let saying = $state<{ line: string; n: number }>();
let saidAt = 0;
let bubble = $state<HTMLElement>();
function say(line: string | undefined) {
  if (!line) return;
  saying = { line, n: (saying?.n ?? 0) + 1 };
  saidAt = clock.now();
}
onMount(() => {
  paints = Object.fromEntries(
    cars.filter(c => !c.police).map(c => [c.id, c.spec.cols[Math.floor(Math.random() * c.spec.cols.length)]]),
  );
  const pelle = new PelleTalk(data.pelleLines, clock, Math.random);
  talk = pelle;
  const listen = () => {
    if (document.hidden) return pelle.lookAway();
    if (status !== 'ready' || car.police) pelle.lookAway(); // nothing on the ring to stare at, or nothing he'd buy
    say(pelle.tick());
    // a line stays while the pointer or focus is on it, so its link doesn't vanish from under either
    if (saying && clock.now() - saidAt > SAY_FOR_MS && !bubble?.matches(':hover, :focus-within')) saying = undefined;
  };
  listen();
  const timer = setInterval(listen, LISTEN_MS);
  return () => clearInterval(timer);
});

function step(d: number) {
  index = (index + d + cars.length) % cars.length;
  say(talk?.picked());
  if (status === 'failed') status = 'loading'; // trying another car; a car already on the ring stays up meanwhile
}
function steer(e: KeyboardEvent) {
  // the papers lie over the ring while they're open: the arrows are theirs then, to scroll the table
  if (papers?.open || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
}
</script>

<Head
  title="The garage"
  description="Every car in Vrigstad Joyride on Plåt-Pelle's ring at Skroten, with the numbers it drives by."
/>
<svelte:window onkeydown={steer} />

<main>
  <Skroten
    footprints={data.footprints}
    {index}
    paint={paints[car.id]}
    {margins}
    shown={status === 'ready' || status === 'failed'}
    carShown={() => (status = 'ready')}
    carFailed={() => (status = 'failed')}
    sceneFailed={() => (status = 'down')}
  />

  <header bind:this={topEl} bind:offsetHeight={topHeight}>
    <a class="pane" href={resolve('/')}><ArrowLeft size="1em" strokeWidth={2.5} /> Wiki</a>
    <!-- the yard's gate sign, in Swedish as it hangs there: the page's heading -->
    <div class="sign" lang="sv">
      <h1>Skroten</h1>
      <p>Plåt-Pelles garage · Stockarydsvägen</p>
    </div>
    <button type="button" class="pane" aria-haspopup="dialog" onclick={() => papers?.showModal()}>
      <FileText size="1em" strokeWidth={2.5} /> The papers
    </button>
  </header>

  {#if saying}
    {#key saying.n}
      <p class="says" lang="sv" bind:this={bubble}>
        <a href={resolve('/[...slug]', { slug: 'characters/plat-pelle' })}>Plåt-Pelle</a> ”{saying.line}”
      </p>
    {/key}
  {/if}

  <section class="card" aria-label="The car on the ring" bind:this={cardEl} bind:offsetHeight={cardHeight}>
    <button type="button" class="step" onclick={() => step(-1)} aria-label="Previous car">
      <ChevronLeft size="1em" strokeWidth={3} />
    </button>
    {#snippet about(c: (typeof cars)[number], i: number)}
      <p class="kind">{i + 1} / {cars.length} on the ring</p>
      <h2>{c.name}</h2>
      <p class="spoken"><span lang="sv">“{c.spokenName}”</span> · drives as the {c.spec.name}</p>
      <dl>
        <div>
          <dt>Top speed</dt>
          <dd><i style:--v={c.spec.max / most.max}></i>{kmh(c.spec.max)} km/h</dd>
        </div>
        <div>
          <dt>Pull</dt>
          <dd><i style:--v={c.spec.acc / most.acc}></i>{c.spec.acc} m/s²</dd>
        </div>
        <div>
          <dt>Off road</dt>
          <dd><i style:--v={c.spec.off}></i>{Math.round(c.spec.off * 100)} %</dd>
        </div>
      </dl>
      {#if c.police}
        <p class="muted">Police livery. Plåt-Pelle won't buy this one.</p>
      {:else}
        <div class="paints">
          {#each c.spec.cols as paint (paint)}
            <button
              type="button"
              style:background={paint}
              title="Paint it {colourName(paint)}"
              aria-label="Paint it {colourName(paint)}"
              aria-pressed={paints[c.id] === paint}
              onclick={() => (paints[c.id] = paint)}
            ></button>
          {/each}
        </div>
      {/if}
    {/snippet}
    <!-- the card keeps one size whichever car is on the ring: every car's text lies in the same place, unseen and out of
         reach (inert), so the card is as tall as the tallest of them at any width, and only the picked car's shows -->
    <div class="info">
      <div>
        {@render about(car, index)}
        <!-- read out when the car changes, whichever button or key changed it -->
        <p class="visually-hidden" role="status">{car.name}, car {index + 1} of {cars.length}</p>
      </div>
      {#each cars as c, i (c.id)}
        {#if i !== index}
          <div class="unseen" inert>
            {@render about(c, i)}
          </div>
        {/if}
      {/each}
    </div>
    <button type="button" class="step" onclick={() => step(1)} aria-label="Next car">
      <ChevronRight size="1em" strokeWidth={3} />
    </button>
  </section>
  <!-- the wiki's footer isn't drawn here, and the hall and carport are OSM outlines, so their credit stays in sight
       (AGENTS.md, Data and coordinates): a quiet line along the window's foot, as on a map. The car models' credit is in
       the papers. -->
  <p class="credit">Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p>

  <!-- always in the page, so it can fade out as the yard fades in; once gone it is hidden from everyone -->
  <p class={['notice', 'wait', { gone: status !== 'loading' }]} role="status">Opening the gate…</p>
  {#if status === 'failed'}
    <p class="notice" role="alert">
      Plåt-Pelle can't find the keys to this one. Try another car.
      <!-- in dev the models come from the game's own dev server (site.ts), the likeliest reason they don't load -->
      {#if import.meta.env.DEV}
        <small>Dev: is the game's dev server running? <code>npm run dev</code> in the repo root (port 5173).</small>
      {/if}
    </p>
  {:else if status === 'down'}
    <p class="notice" role="alert">The gate is stuck. Reload the page to try again.</p>
  {/if}

  <!-- a click on the backdrop lands on the dialog itself, outside the panel inside it -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard closes the dialog with Escape, as any dialog, and its Close button -->
  <dialog
    class="papers"
    aria-labelledby="papers-title"
    bind:this={papers}
    onclick={e => e.target === e.currentTarget && papers?.close()}
  >
    <div class="papers-panel">
      <button type="button" class="pane" onclick={() => papers?.close()}>
        <X size="1em" strokeWidth={2.5} /> Close
      </button>
      <h2 id="papers-title">The papers</h2>
      <p class="muted">The numbers the game drives each type of car by.</p>
      <SpecTable />
      <p class="muted">
        Car models by Axel Tidehorn, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
      </p>
    </div>
  </dialog>
</main>

<style>
/* ---------- the garage: Skroten, the whole window ---------- */
main {
  position: fixed;
  inset: 0;
  overflow: hidden;
  /* the evening sky down to the horizon, then the grass, behind the scene until it draws */
  background: linear-gradient(180deg, var(--sky-2) 0%, var(--sky-1) 38%, #d9a27a 52%, #6b7a48 52.1%);
}
header {
  position: absolute;
  inset: 16px 16px auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}
header > * {
  pointer-events: auto;
}
/* a dark pane over the scene: the way back, and the papers */
.pane {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 600 1.125rem var(--font);
  text-transform: uppercase;
  color: var(--cream);
  background: var(--glass);
  border: 0;
  padding: 8px 14px 8px 11px; /* less on the icon's side, so the two sides look alike */
  white-space: nowrap;
  border-radius: 8px;
  box-shadow: var(--lift);
  text-decoration: none;
  cursor: pointer;
  backdrop-filter: blur(10px);
}
/* the yard's gate sign: cream boards, dark letters */
.sign {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--cream);
  color: var(--road);
  padding: 6px 18px 8px;
  border-radius: 4px;
  box-shadow:
    0 3px 0 #8a4a2a,
    0 10px 30px #0005;
  transform: rotate(-1.2deg);
}
.sign h1 {
  margin: 0;
  font: 700 clamp(1.625rem, 5vw, 2.5rem) / 1 var(--hand);
  letter-spacing: 0.06em;
}
.sign p {
  margin: 0;
  font: 600 0.8125rem var(--font);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #6b4a32;
}
.says {
  position: absolute;
  top: 96px;
  left: 50%;
  translate: -50% 0;
  max-width: min(35rem, calc(100% - 32px));
  margin: 0;
  padding: 10px 16px;
  background: #fffaf0d1; /* paper, with the yard just showing through it */
  color: var(--road);
  border-radius: 14px;
  font-size: 1rem;
  text-wrap: pretty;
  box-shadow:
    0 0 0 1px #ffffff40,
    0 1px 2px #0002,
    0 8px 24px #0003;
  backdrop-filter: blur(10px) saturate(1.3);
}
@media (prefers-reduced-motion: no-preference) {
  .says {
    animation: pop 0.35s ease-out;
  }
}
.says a {
  font: 700 1rem var(--font);
  text-transform: uppercase;
  color: #b8322a; /* his cap */
  text-decoration: none;
  margin-right: 4px;
}
@keyframes pop {
  from {
    opacity: 0;
    translate: -50% 6px;
  }
}
.card {
  position: absolute;
  left: 50%;
  bottom: 30px; /* over the credit */
  translate: -50% 0;
  width: min(40rem, calc(100% - 32px));
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  background: #1d1f24a6; /* smoked glass: the yard shows through, blurred, and the text still reads */
  border-radius: 16px;
  box-shadow: var(--lift);
  backdrop-filter: blur(16px) saturate(1.3);
}
.info {
  min-width: 0;
  text-align: center;
  display: grid;
  align-items: center;
}
/* every car's text in the one cell, so the cell is as big as the biggest */
.info > div {
  grid-area: 1 / 1;
  min-width: 0;
}
.unseen {
  visibility: hidden;
}
.info h2 {
  text-wrap: balance;
  font-size: clamp(1.75rem, 6vw, 2.75rem);
  text-transform: uppercase;
  margin: 2px 0 0;
}
.spoken {
  margin: 2px 0 10px;
  color: var(--muted);
  font-size: 1rem;
}
.step {
  display: grid;
  place-items: center;
  width: 48px;
  height: 64px;
  padding: 0;
  font-size: 2rem; /* the chevron's size */
  color: var(--road);
  background: var(--gold);
  border: 0;
  border-radius: 6px; /* the card's 16px less the 10px between them: the two corners run side by side */
  cursor: pointer;
}
@media (hover: hover) {
  .step:hover {
    filter: brightness(1.1);
  }
}
dl {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 0 0 10px;
  text-align: left;
}
dt {
  font: 600 0.8125rem var(--font);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
}
dd {
  margin: 2px 0 0;
  font-size: 0.9375rem;
  font-variant-numeric: tabular-nums;
}
/* a bar filled to --v, from 0 to 1 */
dd i {
  display: block;
  height: 6px;
  margin-bottom: 4px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--gold) calc(var(--v) * 100%), #ffffff1a 0);
}
.paints {
  display: flex;
  justify-content: center;
  gap: 8px;
}
/* 28px across: room for a finger */
.paints button {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #fff3;
  padding: 0;
  cursor: pointer;
}
.paints button[aria-pressed="true"] {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px var(--road);
}
.credit {
  position: absolute;
  inset: auto 0 6px;
  margin: 0;
  text-align: center;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--cream);
  text-shadow: 0 1px 2px #000c; /* it lies on the yard's gravel, light or dark as the camera turns */
}
.credit a {
  color: inherit;
}
/* a button gives a little under the finger, for those who haven't asked for less motion */
@media (prefers-reduced-motion: no-preference) {
  .pane,
  .step,
  .paints button {
    transition: scale 200ms ease-out;
  }
  :is(.pane, .step):active {
    scale: 0.97;
  }
  .paints button:active {
    scale: 0.92;
  }
}
/* a message over the scene, not a cover: the car buttons under it still work */
.notice {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center; /* the dev hint stays right under the message */
  gap: 8px;
  margin: 0;
  font: 600 1.5rem var(--font);
  text-transform: uppercase;
  color: var(--road);
  pointer-events: none;
}
/* the wait for the first car: said only if the wait is long enough to notice, and it fades as the yard fades in */
.gone {
  visibility: hidden;
  opacity: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .wait {
    animation: wait-in 300ms 500ms ease-out both;
  }
  .wait.gone {
    animation: none;
    transition:
      opacity 400ms ease-out,
      visibility 0s 400ms;
  }
}
@keyframes wait-in {
  from {
    opacity: 0;
  }
}
.notice small {
  font: 500 0.9375rem var(--font);
  text-transform: none;
}

/* ---------- the papers: a sheet from the right, over the yard ---------- */
.papers {
  margin: 0 0 0 auto;
  width: min(54rem, 100%);
  height: 100dvh;
  max-height: none;
  max-width: none;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--line);
  background: #1d1f24f2;
  color: var(--cream);
  box-shadow: -20px 0 40px #0006;
}
.papers::backdrop {
  background: #0006;
}
.papers-panel {
  min-height: 100%;
  padding: 16px 24px 24px;
}
.papers-panel .pane {
  display: flex;
  margin-left: auto;
}
.papers h2 {
  margin-top: 8px;
}

@media (width <= 35em) {
  .sign p {
    display: none;
  }
  /* three things share a phone's width: the panes give a little */
  header {
    gap: 8px;
  }
  .pane {
    font-size: 1rem;
    padding: 8px 10px 8px 8px;
  }
  .says {
    top: 84px;
    font-size: 0.9375rem;
  }
  .card {
    bottom: 28px;
    padding: 10px 6px;
  }
  .step {
    width: 36px;
    height: 52px;
    font-size: 1.625rem;
  }
  dl {
    gap: 6px;
  }
}
</style>
