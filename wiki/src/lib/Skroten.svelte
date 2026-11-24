<!-- Skroten, the scrapyard from #346, in 3D (garage-scene.ts): `index` picks the car on the ring from VEHICLES, `paint` its
     colour, and `margins` say how much of the window the page covers. -->
<script lang="ts">
import type { GarageScene, Margins } from './garage-scene';

let {
  footprints,
  index,
  paint,
  margins,
  carShown,
  carFailed,
  sceneFailed,
}: {
  footprints: { p: number[] }[];
  index: number;
  paint?: string;
  margins: Margins;
  /** the picked car stands on the ring */
  carShown: () => void;
  /** the picked car's model didn't load; picking it again tries again */
  carFailed: () => void;
  /** the scene itself didn't start, so no car will show until the page reloads */
  sceneFailed: () => void;
} = $props();

// the scene, once its code has loaded and it runs. The effects below hand it the picked car, the paint and the margins:
// each runs when the scene arrives, and again when its prop changes.
let scene: GarageScene | undefined = $state.raw();
$effect(() => {
  scene?.showCar(index);
});
$effect(() => {
  scene?.repaint(paint);
});
$effect(() => {
  scene?.reframe({ top: margins.top, bottom: margins.bottom });
});

// an attachment: runs in the browser once the element exists, and its cleanup runs when the element goes (never while
// prerendering). It reads no state before the import, so it runs once.
function start(host: HTMLDivElement) {
  let made: GarageScene | undefined;
  let unmounted = false;
  import('./garage-scene')
    .then(({ GarageScene }) => {
      if (unmounted) return; // left the page before the import finished: nothing to start, nothing to dispose
      made = new GarageScene({ host, footprints, carShown: () => carShown(), carFailed: () => carFailed() });
      scene = made;
    })
    .catch(err => {
      // such as a chunk gone after a deploy, or no WebGL: say so, rather than "loading" for ever
      console.warn('Wiki: the garage failed to start', err);
      if (!unmounted) sceneFailed();
    });
  return () => {
    unmounted = true;
    made?.dispose();
    scene = undefined;
  };
}
</script>

<div
  class="skroten-scene"
  {@attach start}
  role="img"
  aria-label="Skroten, the scrapyard, in 3D: drag to look around"
></div>

<style>
/* the whole window, behind the page's header and card; a finger on it turns the scene (the page doesn't scroll) */
.skroten-scene {
  position: absolute;
  inset: 0;
  touch-action: none;
}
/* the canvas is the scene's own, added when it starts */
.skroten-scene :global(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.skroten-scene :global(canvas:active) {
  cursor: grabbing;
}
</style>
