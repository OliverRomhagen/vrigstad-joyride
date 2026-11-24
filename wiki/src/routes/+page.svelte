<script lang="ts">
import Head from '#lib/Head.svelte';
import { resolve } from '$app/paths';

let { data } = $props();
</script>

<Head description="The places and people of Vrigstad Joyride, a driving game set in a real village in Småland." />

<section class="hero">
  <!-- the page's heading is a village sign, as you drive in; the header above already says "wiki" -->
  <h1><span class="road-sign" lang="sv">Vrigstad</span><span class="visually-hidden"> wiki</span></h1>
  <p class="summary">
    The places and people of Vrigstad Joyride, a driving game set in a real village in Småland, where nothing ever
    happens until you take a car.
  </p>
</section>

{#snippet card(href: string, title: string, summary?: string)}
  <li>
    <a {href}>
      <strong>{title}</strong>
      {#if summary}
        <span>{summary}</span>
      {/if}
    </a>
  </li>
{/snippet}

{#each data.sections as s (s.folder)}
  <section>
    <h2>{s.label}</h2>
    <ul class="cards">
      {#each s.entries as d (d.slug)}
        {@render card(resolve('/[...slug]', { slug: d.slug }), d.title, d.summary)}
      {/each}
    </ul>
  </section>
{/each}

<section>
  <h2>From the game</h2>
  <ul class="cards">
    {@render card(resolve('/map'), 'The map', 'Vrigstad in 3D, built from the same data the game drives on.')}
    {@render card(
      resolve('/garage'),
      'The garage',
      "Every car in the game on Plåt-Pelle's ring, with the numbers it drives by.",
    )}
  </ul>
</section>

<style>
.hero {
  margin-bottom: 16px;
}
.hero h1 {
  margin: 0 0 14px;
  font-size: inherit;
  text-transform: none;
}
/* the sign at the edge of the village: blue, a white border inside its edge, the name in white */
.road-sign {
  display: inline-block;
  padding: 6px 22px 4px;
  font: 700 clamp(1.75rem, 5vw, 2.375rem) / 1.1 var(--font);
  letter-spacing: 0.03em;
  color: #fff;
  background: var(--sign-blue);
  border-radius: 6px;
  box-shadow:
    inset 0 0 0 3px var(--sign-blue),
    inset 0 0 0 5px #fff,
    0 8px 24px #0005;
}
h2 {
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--gold);
  margin: 36px 0 10px;
}
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 14px;
}
.cards a {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--cream);
  text-decoration: none;
}
.cards a:hover {
  border-color: var(--gold);
}
.cards strong {
  font: 700 1.625rem var(--font);
  text-transform: uppercase;
}
.cards span {
  color: var(--muted);
  font-size: 1rem;
}
</style>
