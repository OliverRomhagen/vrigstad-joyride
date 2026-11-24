<!-- The game's 3D map of Vrigstad (map.html, built from src/map/), embedded from where it is served next to the wiki.
     With a focus it opens close in over that spot, with a pin. -->
<script lang="ts">
import { on } from 'svelte/events';
import { MAP_URL } from './site';

let {
  focus,
  label = 'Vrigstad',
  shape = 'wide',
}: {
  focus?: [number, number];
  label?: string;
  /** `wide` in a page's text, `tall` as a page of its own, `box` at the top of an infobox, inside the box's frame */
  shape?: 'wide' | 'tall' | 'box';
} = $props();

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
// On a touch screen the map takes every finger that lands on it, so a page with a map in its text couldn't be scrolled past
// it: there the map waits under a button until you ask for it (the styles show the button for a coarse pointer only).
let inUse = $state(false);
let frameEl: HTMLIFrameElement | undefined;
// the button goes away with the tap: the focus it had moves on to the map, not back to the top of the page
const useMap = () => {
  inUse = true;
  frameEl?.focus();
};
const load = (frame: HTMLIFrameElement) => {
  frameEl = frame;
  const target = src;
  loaded = false;
  inUse = false;
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

<div class={['map-embed', shape]}>
  <iframe {@attach load} title="3D map: {label}"></iframe>
  {#if !loaded}
    <p class="loading-3d" role="status">Unfolding the map…</p>
  {:else if !inUse}
    <button type="button" class="use" onclick={useMap}><span>Tap to move the map</span></button>
  {/if}
  <a class="open" href={full} target="_blank" rel="external noopener">Open full screen ↗</a>
</div>

<style>
.map-embed {
  position: relative;
  margin: 16px 0 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  background: var(--panel);
}
.tall {
  aspect-ratio: auto;
  height: min(75vh, 720px);
}
.box {
  margin: 0;
  aspect-ratio: 1;
  border-radius: 8px;
  border: 0;
}
/* the infobox lies across the page from here down (routes/[...slug]): a wide map, and a low one on a phone, so the page's
     text starts on the first screen */
@media (width <= 68.75em) {
  .box {
    aspect-ratio: 16 / 10;
  }
}
@media (width <= 47.5em) {
  .box {
    aspect-ratio: 2;
  }
}
iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
/* over the whole map, for a finger only: the first tap takes it away, and until then a swipe scrolls the page */
.use {
  display: none;
  position: absolute;
  inset: 0;
  width: 100%;
  align-items: flex-end;
  justify-content: center;
  padding: 0 0 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.use span,
.open {
  font: 0.875rem var(--body);
  background: #000a;
  color: var(--cream);
  padding: 4px 10px;
  border-radius: 6px;
}
@media (pointer: coarse) {
  .use {
    display: flex;
  }
}
/* top left: the map's tools are top right, and its OpenStreetMap credit bottom right */
.open {
  position: absolute;
  left: 10px;
  top: 10px;
  text-decoration: none;
}
</style>
