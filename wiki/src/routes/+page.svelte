<script lang="ts">
import Head from '#lib/Head.svelte';
import { resolve } from '$app/paths';

let { data } = $props();
</script>

<Head description="The places and people of Vrigstad Joyride, a driving game set in a real village in Småland." />

<section class="hero">
  <!-- the header above is the page's name, the village's sign and "wiki": the heading says it again only to those who
       don't see it -->
  <h1 class="visually-hidden"><span lang="sv">Vrigstad</span> wiki</h1>
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
  </ul>
</section>

<style>
.hero {
  margin-bottom: 16px;
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
@media (hover: hover) {
  .cards a:hover {
    border-color: var(--gold);
  }
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
