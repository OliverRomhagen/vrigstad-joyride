<!-- A character from the game in 3D, as the game draws them, turning slowly; drag to look around. -->
<script lang="ts">
import type { Object3D } from 'three';

let { load, label }: { load: () => Promise<Object3D>; label: string } = $props();
let failed = $state(false);
let ready = $state(false); // the model stands in the scene

// an attachment: runs in the browser once the element exists (never while prerendering), and its cleanup runs when it goes
function scene(host: HTMLDivElement) {
  let stop = () => {};
  let unmounted = false;
  // the component is reused from one character's page to the next: start each model's load afresh
  ready = false;
  failed = false;
  Promise.all([import('./game-look'), load()])
    .then(([{ startPreview }, model]) => {
      if (unmounted) return;
      stop = startPreview(host, model);
      ready = true;
    })
    .catch(err => {
      console.warn('Wiki: the 3D preview failed', err);
      if (!unmounted) failed = true; // a late failure of the page before doesn't speak for this one
    });
  return () => {
    unmounted = true;
    stop();
  };
}
</script>

<figure class="npc-preview">
  <div class="scene-frame">
    <div class="npc-scene" {@attach scene} role="img" aria-label="{label} in 3D: drag to look around"></div>
    {#if !ready && !failed}<p class="loading-3d" role="status">Fetching {label}…</p>{/if}
  </div>
  <figcaption>{failed ? "The 3D model didn't load." : 'As the game draws them. Drag to look around.'}</figcaption>
</figure>
