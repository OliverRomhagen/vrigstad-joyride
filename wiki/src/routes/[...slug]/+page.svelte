<script lang="ts">
import Head from '#lib/Head.svelte';
import Infobox from '#lib/kinds/Infobox.svelte';
import PageHead from '#lib/PageHead.svelte';
import { resolve } from '$app/paths';

let { data } = $props();
const entry = $derived(data.entry);
</script>

<Head title={entry.title} description={entry.summary} />

<nav class="crumbs" aria-label="Breadcrumb">
  <a href={resolve('/')}>Wiki</a>
  {#if data.section}
    <span aria-hidden="true">/</span><span>{data.section}</span>
  {/if}
</nav>

<article class={{ 'has-box': data.hasInfobox }}>
  <div class="head"><PageHead label={data.label} title={entry.title} summary={entry.summary} tags={entry.tags} /></div>

  {#if data.hasInfobox}
    <div class="box"><Infobox {entry} /></div>
  {/if}

  <div class="prose">
    {#if data.Page}
      <data.Page />
    {/if}
    <!-- the game's own numbers, read from its code when the wiki was built: after the prose, each under its own heading
         (docs/README.md). A table's headings, rows and cells never change in the page, so their each blocks have no key:
         nothing in a table is sure to be unique. -->
    {#each data.tables as t (t.title)}
      <section>
        <h2>{t.title}</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                {#each t.head as heading}
                  <th>{heading}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each t.rows as [name, ...cells]}
                <tr>
                  <th scope="row">{name}</th>
                  {#each cells as cell}
                    <td>{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if t.note}
          <p class="muted">{t.note}</p>
        {/if}
      </section>
    {/each}
  </div>
</article>

{#if data.backlinks.length}
  <aside class="backlinks">
    <h2>Linked from</h2>
    <ul>
      {#each data.backlinks as b (b.slug)}
        <li><a href={resolve('/[...slug]', { slug: b.slug })}>{b.title}</a></li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
.crumbs {
  font-size: 0.875rem;
  color: var(--cream); /* the muted grey reads at only 4:1 this near the sky */
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
/* cream too: on a phone the crumbs sit higher, where the gold reads at only 4.3:1 */
.crumbs a {
  color: var(--cream);
}

/* a page with an infobox: the box beside the prose, as on any wiki; across the page above it on a narrower screen */
.has-box {
  display: grid;
  grid-template: "head head" auto "prose box" 1fr / minmax(0, 1fr) 18.75rem;
  gap: 0 36px;
  align-items: start;
}
.head {
  grid-area: head;
}
.box {
  grid-area: box;
}
.has-box .prose {
  grid-area: prose;
}
/* the prose is the page's Markdown, a component of its own */
.has-box .prose > :global(:first-child) {
  margin-top: 0;
}
@media (width <= 68.75em) {
  .has-box {
    grid-template: "head" auto "box" auto "prose" 1fr / minmax(0, 1fr);
  }
  .box {
    margin-bottom: 24px;
    max-width: 68ch;
  }
}

.backlinks {
  margin-top: 48px;
  padding: 12px 16px;
  background: var(--panel);
  border-radius: 10px;
  max-width: 68ch;
}
.backlinks h2 {
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin: 0 0 4px;
}
.backlinks ul {
  margin: 0;
  padding-left: 18px;
}
</style>
