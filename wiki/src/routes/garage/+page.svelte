<script lang="ts">
import { onMount } from 'svelte';
import { VEHICLES } from '#game/render/vehicle-registry';
import { type CarType, VEHICLE_SPECS } from '#game/sim/vehicle-spec';
import type { Clock } from '#lib/clock';
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
let papersOpen = $state(false);
// how far the header reaches down and the card up, so the scene is framed between them: their heights, bound so this
// follows them, and their offsets from the window's edges, measured, as wiki.css sets those by the window's width (the card's
// padding changes at the same breakpoint, so its height changes too and this measures again)
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
  if (e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'Escape') papersOpen = false;
}
</script>

<svelte:head><title>The garage · Skroten · Vrigstad wiki</title></svelte:head>
<svelte:window onkeydown={steer} />

<div class="skroten">
  <Skroten
    footprints={data.footprints}
    {index}
    paint={paints[car.id]}
    {margins}
    carShown={() => (status = 'ready')}
    carFailed={() => (status = 'failed')}
    sceneFailed={() => (status = 'down')}
  />

  <header class="sk-top" bind:this={topEl} bind:offsetHeight={topHeight}>
    <a class="sk-back" href={resolve('/')}>← Wiki</a>
    <div class="sk-sign">
      <strong>Skroten</strong>
      <span>Plåt-Pelles garage · Stockarydsvägen</span>
    </div>
    <button class="sk-papers" onclick={() => (papersOpen = !papersOpen)} aria-expanded={papersOpen}>
      {papersOpen ? 'Stäng' : 'Papperna'}
    </button>
  </header>

  {#if saying}
    {#key saying.n}
      <p class="sk-says" lang="sv" bind:this={bubble}><a href={resolve('/[...slug]', { slug: 'characters/plat-pelle' })}>Plåt-Pelle</a> ”{saying.line}”</p>
    {/key}
  {/if}

  <section class="sk-card" bind:this={cardEl} bind:offsetHeight={cardHeight}>
    <button class="sk-step" onclick={() => step(-1)} aria-label="Previous car">‹</button>
    <div class="sk-info">
      <p class="kind">{index + 1} / {cars.length} på ringen</p>
      <h1 aria-live="polite">{car.name}</h1>
      <p class="sk-spoken" lang="sv">“{car.spokenName}” · drives as the {car.spec.name}</p>
      <dl class="sk-stats">
        <div><dt>Top speed</dt><dd><i style="--v: {car.spec.max / most.max}"></i>{kmh(car.spec.max)} km/h</dd></div>
        <div><dt>Pull</dt><dd><i style="--v: {car.spec.acc / most.acc}"></i>{car.spec.acc} m/s²</dd></div>
        <div><dt>Off road</dt><dd><i style="--v: {car.spec.off}"></i>{Math.round(car.spec.off * 100)} %</dd></div>
      </dl>
      {#if car.police}
        <p class="muted">Police livery. Plåt-Pelle won't buy this one.</p>
      {:else}
        <span class="swatches pick">
          {#each car.spec.cols as c, i (i)}
            <button style="background: {c}" title="Paint it {c}" aria-label="Paint it {c}" aria-pressed={paints[car.id] === c} onclick={() => (paints[car.id] = c)}></button>
          {/each}
        </span>
      {/if}
    </div>
    <button class="sk-step" onclick={() => step(1)} aria-label="Next car">›</button>
    <!-- the wiki's footer isn't drawn here, and the hall and carport are OSM outlines (AGENTS.md, Data and coordinates) -->
    <p class="sk-credit">
      Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Car models by Axel
      Tidehorn, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
    </p>
  </section>

  {#if status === 'loading'}
    <p class="sk-loading">Opening the gate…</p>
  {:else if status === 'failed'}
    <p class="sk-loading" role="alert">
      Plåt-Pelle can't find the keys to this one. Try another car.
      <!-- in dev the models come from the game's own dev server (site.ts), the likeliest reason they don't load -->
      {#if import.meta.env.DEV}<small>Dev: is the game's dev server running? <code>npm run dev</code> in the repo root (port 5173).</small>{/if}
    </p>
  {:else if status === 'down'}
    <p class="sk-loading" role="alert">The gate is stuck. Reload the page to try again.</p>
  {/if}

  {#if papersOpen}
    <aside class="sk-drawer">
      <h2>Papperna</h2>
      <p class="muted">The numbers the game drives each car type by, read from <code>src/game/sim/vehicle-spec.ts</code>.</p>
      <SpecTable />
      <p class="credit">Car models by Axel Tidehorn, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Skroten and Plåt-Pelle from <a href="https://github.com/OliverRomhagen/vrigstad-joyride/pull/346">#346</a>.</p>
    </aside>
  {/if}
</div>
