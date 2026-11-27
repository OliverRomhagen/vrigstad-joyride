<!-- The getaway on the marketing page: the canvas, the HUD over it, and the start and end cards. The chase itself is in
     getaway.ts; this only shows what it writes into `hud`. -->
<script lang="ts">
import { MAX_STARS } from '#game/police';
import { GAME_URL } from '#lib/site';
import type { WorldData } from '#world/data';
import { CAR_NAME, createGetaway, type GetawayHud } from './getaway';

const hud: GetawayHud = $state({
  phase: 'ready',
  stars: 0,
  evading: false,
  kmh: 0,
  time: '0:00',
  street: 'Torget',
  lasted: '',
});
let getaway = $state<ReturnType<typeof createGetaway>>();

// the map is 200 kB of data: fetched once the page is in the browser, so the hero doesn't wait for it
function setUp(canvas: HTMLCanvasElement) {
  let gone = false;
  import('#data/vrigstad.json')
    .then(m => {
      // the JSON's inferred types are wider than WorldData's (a land use is any number, not one of its codes)
      if (!gone) getaway = createGetaway(canvas, m.default as unknown as WorldData, hud);
    })
    .catch(err => console.warn('Getaway: the map failed to load', err));
  return () => {
    gone = true;
    getaway?.destroy();
  };
}

const focus = (el: HTMLElement) => el.focus({ preventScroll: true });
</script>

<div class={['chase', { running: hud.phase === 'running' }]}>
  <canvas
    tabindex="0"
    aria-label="Top-down chase on the map of Vrigstad. Steer with the arrow keys or WASD, or hold the pointer where you want to drive."
    {@attach setUp}
  ></canvas>
  <div class="hud">
    <div class="sign">{hud.street}<small>Vrigstad</small></div>
    <div>
      <div
        class={['plate', 'stars', { evading: hud.evading }]}
        role="img"
        aria-label="Wanted level, {hud.stars} of {MAX_STARS} stars"
      >
        <b>{'★'.repeat(hud.stars)}</b>{'☆'.repeat(MAX_STARS - hud.stars)}
      </div>
      <div class="time">{hud.time}</div>
    </div>
  </div>
  <div class="plate speed"><b class="kmh" data-testid="kmh">{hud.kmh}</b><span class="unit">km/h</span></div>
  {#if hud.phase === 'ready'}
    <div class="overlay">
      <div>
        <h3>Start the engine</h3>
        <p>
          Hold the mouse or your finger where you want to go, or drive with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd
          ><kbd>D</kbd> / arrow keys.
        </p>
        <div class="row">
          <button class="btn go" type="button" disabled={!getaway} onclick={() => getaway?.start()}>Drive</button>
        </div>
      </div>
    </div>
  {:else if hud.phase !== 'running'}
    <div class="overlay">
      <div>
        {#if hud.phase === 'caught'}
          <h3 class="busted" lang="sv">Gripen!</h3>
          <p>Caught after {hud.lasted} in a {CAR_NAME}. They'll drive you back to Torget.</p>
        {:else}
          <h3 class="free">You lost them.</h3>
          <p>
            {hud.lasted} in a {CAR_NAME}, and the police went back to their coffee. In the game, they'd still remember
            your face.
          </p>
        {/if}
        <div class="row">
          <button class="btn go" type="button" onclick={() => getaway?.start()} {@attach focus}>Again</button>
          <a class="btn" href={GAME_URL}>Play the real thing</a>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
.chase {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  background: #9db87a;
  border: 3px solid var(--plate);
}
canvas {
  display: block;
  width: 100%;
  height: clamp(360px, 60vh, 560px);
  cursor: crosshair;
}
canvas:focus-visible {
  outline: 3px solid var(--sign);
  outline-offset: -3px;
}
/* only while driving: otherwise a swipe on it scrolls the page */
.running canvas {
  touch-action: none;
}
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px;
  gap: 8px;
}
.plate {
  background: var(--plate);
  border-radius: 4px;
  padding: 4px 10px;
}
.stars {
  font-size: 1.5rem;
  line-height: 1;
  letter-spacing: 3px;
  color: rgba(244, 241, 230, 0.35);
  padding: 3px 10px 5px;
}
.stars b {
  color: var(--gold);
  font-weight: 400;
}
.stars.evading b {
  animation: blink 0.6s steps(2) infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
@media (prefers-reduced-motion: reduce) {
  .stars.evading b {
    animation: none;
    opacity: 0.5;
  }
}
.time {
  font: 600 0.9375rem var(--font);
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  margin-top: 6px;
  text-align: right;
}
.speed {
  position: absolute;
  right: 12px;
  bottom: 12px;
  text-align: right;
  padding: 4px 12px 6px;
}
.kmh {
  font: 700 2.125rem / 1 var(--font);
  font-variant-numeric: tabular-nums;
}
.unit {
  font-size: 0.8125rem;
  color: var(--dim);
  margin-left: 4px;
}
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 24px;
  background: rgba(17, 20, 19, 0.62);
}
.overlay h3 {
  font-size: clamp(2.75rem, 9vw, 6rem);
  margin: 0;
}
.overlay h3.busted {
  color: var(--alarm);
}
.overlay h3.free {
  color: var(--gold);
}
.overlay p {
  margin: 10px auto 20px;
  max-width: 30em;
}
.row {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
kbd {
  font: 600 0.8125rem var(--body);
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 0 5px;
}
</style>
