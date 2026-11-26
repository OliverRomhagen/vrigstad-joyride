<!-- An entry's infobox, by its kind: what the lore index's `hasInfobox` says it has to show. A new kind in lore-index.ts gets
     its branch here, or this file fails to compile. -->
<script lang="ts">
import type { Entry } from '../lore-index';
import Character from './Character.svelte';
import Place from './Place.svelte';

let { entry }: { entry: Entry } = $props();

// a note has no infobox. It takes only 'note': a kind added to lore-index.ts with no branch below fails to compile here.
const noInfobox = (_kind: 'note') => '';
</script>

<aside aria-label="{entry.title} at a glance">
  {#if entry.kind === 'place'}
    {#if entry.position}
      <Place title={entry.title} position={entry.position} start={entry.start} />
    {/if}
  {:else if entry.kind === 'character' || entry.kind === 'animal'}
    {#if entry.model}
      <Character title={entry.title} model={entry.model} />
    {/if}
  {:else}
    {noInfobox(entry.kind)}
  {/if}
</aside>

<style>
aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
}
</style>
