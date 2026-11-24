<script lang="ts">
import Character from '#lib/kinds/Character.svelte';
import Place from '#lib/kinds/Place.svelte';
import PageHead from '#lib/PageHead.svelte';
import { resolve } from '$app/paths';

let { data } = $props();
const entry = $derived(data.entry);

// what the kind's infobox has to show: a place where it is, a character their model
const place = $derived(entry.kind === 'place' && entry.position ? entry.position : undefined);
const start = $derived(entry.kind === 'place' ? entry.start : undefined);
const model = $derived(entry.kind === 'character' || entry.kind === 'animal' ? entry.model : undefined);
const KIND_LABELS = { place: 'Place', character: 'Character', animal: 'Animal', note: undefined } as const;
</script>

<svelte:head>
  <title>{entry.title} · Vrigstad wiki</title>
  {#if entry.summary}<meta name="description" content={entry.summary} />{/if}
</svelte:head>

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve('/')}>Wiki</a>
  {#if data.section}<span aria-hidden="true">/</span><span>{data.section}</span>{/if}
</nav>

<article class={['page', { 'has-box': place || model }]}>
  <PageHead label={KIND_LABELS[entry.kind]} title={entry.title} summary={entry.summary} tags={entry.tags} />

  {#if place}
    <aside class="infobox" aria-label="{entry.title} at a glance"><Place title={entry.title} position={place} {start} /></aside>
  {:else if model}
    <aside class="infobox" aria-label="{entry.title} at a glance"><Character title={entry.title} {model} /></aside>
  {/if}

  <div class="prose">
    {#if data.Page}<data.Page />{/if}
    <!-- the game's own numbers, read from its code when the wiki was built -->
    {#each data.tables as t (t.title)}
    <section class="game-table">
      <h2>{t.title}</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>{#each t.head as h, i (i)}<th>{h}</th>{/each}</tr></thead>
          <tbody>
            {#each t.rows as row, r (r)}
              <tr>
                {#each row as cell, i (i)}
                  {#if i === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td>{/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if t.note}<p class="muted">{t.note}</p>{/if}
    </section>
    {/each}
  </div>
</article>

{#if data.backlinks.length}
  <aside class="backlinks">
    <h2>Linked from</h2>
    <ul>
      {#each data.backlinks as b (b.slug)}<li><a href={resolve('/[...slug]', { slug: b.slug })}>{b.title}</a></li>{/each}
    </ul>
  </aside>
{/if}
