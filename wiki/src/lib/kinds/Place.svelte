<!-- A place's infobox: the 3D map focused on it, where it is, and a link to drive there. -->
<script lang="ts">
import MapView from '../MapView.svelte';
import { GAME_URL } from '../site';

let { title, position, start }: { title: string; position: [number, number]; start?: [number, number] } = $props();
// "Drive here" uses the game's ?at=x,z, which puts you there on foot: at `start` when the place has one, as a lake's
// position is in the water
const at = $derived(start ?? position);
</script>

<MapView focus={position} label={title} />
<dl class="facts">
  <div>
    <dt>In the game</dt>
    <dd>x {position[0]} m, z {position[1]} m</dd>
  </div>
</dl>
<a class="button" rel="external" href="{GAME_URL}?at={at[0]},{at[1]}">Drive here →</a>
