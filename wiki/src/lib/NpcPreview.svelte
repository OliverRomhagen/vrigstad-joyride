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

<figure>
  <div class="frame">
    <div class="scene" {@attach scene} role="img" aria-label="{label} in 3D: drag to look around"></div>
    {#if !ready && !failed}
      <p class="loading-3d" role="status">Fetching {label}…</p>
    {/if}
  </div>
  <figcaption>{failed ? "The 3D model didn't load." : 'As the game draws them. Drag to look around.'}</figcaption>
</figure>

<style>
figure {
  margin: 0;
}
.frame {
  position: relative;
}
/* no touch-action here: on a phone a finger moving up or down scrolls the page past the model (game-look.ts) */
.scene {
  overflow: hidden;
  aspect-ratio: 4 / 5; /* a standing person */
  max-height: 60vh;
  border-radius: 8px;
  /* the sky at the top of the page, behind the model */
  background: linear-gradient(var(--sky-2), var(--sky-1));
}
/* the infobox lies across the page from here down (routes/[...slug]) */
@media (width <= 68.75em) {
  .scene {
    aspect-ratio: 4 / 3;
  }
}
/* the canvas is the scene's own, added when it starts */
.scene :global(canvas) {
  width: 100%;
  height: 100%;
  display: block;
}
figcaption {
  font-size: 0.875rem;
  color: var(--muted);
  margin: 8px 4px 0;
}
</style>
