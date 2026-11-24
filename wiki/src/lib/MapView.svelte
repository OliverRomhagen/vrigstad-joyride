<!-- The game's 3D map of Vrigstad (map.html, built from src/map/), embedded from where it is served next to the wiki.
     With a focus it opens close in over that spot, with a pin. -->
<script lang="ts">
import { on } from 'svelte/events';
import { MAP_URL } from './site';

let {
  focus,
  label = 'Vrigstad',
  tall = false,
}: { focus?: [number, number]; label?: string; tall?: boolean } = $props();

// the full map, focused on the place if there is one; the frame asks for the map's compact look on top (?embed), which only
// the frame gets: full screen, the map's own tools and legend are back
const full = $derived(MAP_URL + (focus ? `?focus=${focus[0]},${focus[1]}` : ''));
const src = $derived(focus ? `${full}&embed` : full);

// the frame gets its address in the browser: the map is the game's page, not one of the wiki's, and the prerender crawler
// would follow a `src` in the markup and fail on it. Setting `src` once the frame is in the page would add an entry to the
// tab's history, so Back would first go back inside the frame: replace() loads it without one. It waits until the frame is
// near the screen, as loading="lazy" would. `src` is read here, not in the callback, so the attachment runs again for a new
// place: going from one place's page to another's reuses this frame.
let loaded = $state(false); // the map's page has loaded in the frame; it draws its first frame right after
const load = (frame: HTMLIFrameElement) => {
  const target = src;
  loaded = false;
  const shown = () => (loaded = true);
  let stopListening = () => {};
  const near = new IntersectionObserver(
    ([seen]) => {
      if (!seen.isIntersecting) return;
      near.disconnect();
      // listened for only now: a frame with no address yet fires its own load for about:blank
      stopListening = on(frame, 'load', shown, { once: true });
      frame.contentWindow?.location.replace(target);
    },
    { rootMargin: '200px' },
  );
  near.observe(frame);
  return () => {
    near.disconnect();
    stopListening();
  };
};
</script>

<div class={['map-embed', { tall }]}>
  <iframe {@attach load} title="3D map: {label}"></iframe>
  {#if !loaded}<p class="loading-3d" role="status">Unfolding the map…</p>{/if}
  <a class="map-open" href={full} target="_blank" rel="external noopener">Open full screen ↗</a>
</div>
