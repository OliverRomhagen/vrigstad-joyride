<script lang="ts">
import { resolve } from '$app/paths';

let { data } = $props();
</script>

<svelte:head>
  <title>Vrigstad wiki</title>
  <meta name="description" content="The places and people of Vrigstad Joyride, a driving game set in a real village in Småland." />
</svelte:head>

<section class="hero">
  <!-- a village sign, as you drive in -->
  <p class="road-sign" lang="sv">Vrigstad</p>
  <h1>The Vrigstad wiki</h1>
  <p class="summary">
    The places and people of Vrigstad Joyride, a driving game set in a real village in Småland, where nothing ever happens until
    you take a car.
  </p>
</section>

{#each data.sections as s (s.folder)}
  <section class="home-section">
    <h2>{s.label}</h2>
    <ul class="cards">
      {#each s.entries as d (d.slug)}
        <li>
          <a href={resolve('/[...slug]', { slug: d.slug })}>
            <strong>{d.title}</strong>
            {#if d.summary}<span>{d.summary}</span>{/if}
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<section class="home-section">
  <h2>From the game</h2>
  <ul class="cards">
    <li>
      <a href={resolve('/map')}>
        <strong>The map</strong>
        <span>Vrigstad in 3D, built from the same data the game drives on.</span>
      </a>
    </li>
    <li>
      <a href={resolve('/garage')}>
        <strong>The garage</strong>
        <span>Every car in the game on Plåt-Pelle's ring, with the numbers it drives by.</span>
      </a>
    </li>
  </ul>
</section>
