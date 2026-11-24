<!-- A place's infobox: the 3D map focused on it, where it is, and a link to drive there. -->
<script lang="ts">
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import MapView from '../MapView.svelte';
import { GAME_URL } from '../site';
import { whereabouts } from '../whereabouts';

let { title, position, start }: { title: string; position: [number, number]; start?: [number, number] } = $props();
// "Drive here" uses the game's ?at=x,z, which puts you there on foot: at `start` when the place has one, as a lake's
// position is in the water
const at = $derived(start ?? position);
</script>

<MapView focus={position} label={title} shape="box" />
<dl>
  <div>
    <dt>Where</dt>
    <dd>{whereabouts(position)}</dd>
  </div>
</dl>
<a class="button" rel="external" href="{GAME_URL}?at={at[0]},{at[1]}"
  >Drive here <ArrowRight size="1em" strokeWidth={2.5} /></a
>

<style>
dl {
  margin: 0;
  padding: 0 4px;
  font-size: 0.9375rem;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
dt {
  font: 600 0.875rem var(--font);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
dd {
  margin: 0;
  text-align: right;
}
</style>
