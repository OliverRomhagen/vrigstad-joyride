<!-- The marketing page (#170): what the game is, its teaser, a getaway to poke at on the real map, and the way in. It has
     its own header and footer, not the wiki's (+layout.svelte), and its own look (landing.css). -->
<script lang="ts">
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import BookOpen from '@lucide/svelte/icons/book-open';
import Cat from '@lucide/svelte/icons/cat';
import House from '@lucide/svelte/icons/house';
import MapIcon from '@lucide/svelte/icons/map';
import MapPin from '@lucide/svelte/icons/map-pin';
import Play from '@lucide/svelte/icons/play';
import Siren from '@lucide/svelte/icons/siren';
import Smartphone from '@lucide/svelte/icons/smartphone';
import Tractor from '@lucide/svelte/icons/tractor';
import BrandIcon from '#lib/landing/BrandIcon.svelte';
import Getaway from '#lib/landing/Getaway.svelte';
import { DISCORD_URL, GAME_URL, MAP_URL, SOURCE_URL } from '#lib/site';
import { resolve } from '$app/paths';
import '#lib/landing/landing.css';

let { data } = $props();

// the poster and the teaser are on the live site: only the deploy copies media/ next to the pages, so a preview and
// `npm run dev` have none of their own
const MEDIA = 'https://oliverromhagen.github.io/vrigstad-joyride/media/';

const FEATURES = [
  {
    icon: MapPin,
    title: 'The real Vrigstad',
    text: 'Every building, road, field and lake comes from OpenStreetMap and real elevation data. Drive past the church, round Slättsjön, up Gästgivaregatan.',
  },
  {
    icon: Siren,
    title: 'Police with patience',
    text: 'Up to three stars, one police car each. Lose them for 18 seconds and they go back to their coffee.',
  },
  {
    icon: House,
    title: 'Safehouses',
    text: 'Three houses around the village. Get inside with no police within 60 m, lie low for a minute, and the stars are gone.',
  },
  {
    icon: Tractor,
    title: 'The EPA-traktor',
    text: 'A car legally limited to 30 km/h, a Swedish rural classic. Perfect for getaways, if nobody is chasing you.',
  },
  {
    icon: Cat,
    title: 'Cats',
    text: "They live around the village. Some let you pet them. Some don't. A treat helps.",
  },
  {
    icon: Smartphone,
    title: 'Plays on your phone',
    text: 'No install, no account. Open the link, press Start. A stick and buttons appear on touch screens.',
  },
];

// three stars on the hero and the page gets blue lights; a fourth click calms it down
const HINTS = [
  'Go on. Raise your wanted level.',
  'Somebody saw that.',
  'They are calling it in.',
  'Well, now you have done it. Click once more to calm down.',
];
let heroStars = $state(0);
</script>

<svelte:head>
  <title>Vrigstad Joyride</title>
  <meta
    name="description"
    content="An open-world driving game set in the real village of Vrigstad, Sweden. Borrow a Volvo 240 and outrun the police. Free in your browser."
  >
  <meta property="og:title" content="Vrigstad Joyride: nothing ever happens here">
  <meta
    property="og:description"
    content="Every building and real street in Vrigstad, one borrowed Volvo 240. Free in your browser."
  >
  <meta property="og:image" content="{MEDIA}poster.png">
  <meta name="theme-color" content="#34495a">
</svelte:head>

<div class={['landing', { sirens: heroStars === 3 }]}>
  <header class="hero">
    <div class="wrap">
      <nav aria-label="Site">
        <a class="sign" href="#top" id="top">Vrigstad Joyride<small>Sävsjö kommun</small></a>
        <div class="links">
          <a href="#getaway" class="wide">Getaway</a>
          <a href={resolve('/')}>Wiki</a>
          <a href={MAP_URL} rel="external" class="wide">3D map</a>
          <a href={DISCORD_URL} class="icon" aria-label="Discord"><BrandIcon name="discord" /></a>
          <a href={SOURCE_URL} class="icon" aria-label="Source on GitHub"><BrandIcon name="github" /></a>
        </div>
      </nav>
      <div class="title">
        <p class="kicker">Småland, Sweden · 57.3555° N</p>
        <h1>Vrigstad <span>Joyride</span></h1>
        <p class="tagline">Nothing ever happens here</p>
        <hr>
        <p class="facts">{data.buildings} buildings<i>·</i>every real street<i>·</i>one borrowed Volvo 240</p>
        <div class="cta">
          <a class="btn go" href={GAME_URL} rel="external"
            ><Play size="1em" strokeWidth={2.5} /> Play free in your browser</a
          >
          <a class="btn" href="#getaway"><ArrowDown size="1em" strokeWidth={2.5} /> Try a getaway first</a>
        </div>
        <button
          class="wanted"
          type="button"
          aria-label="Wanted level, {heroStars} of 3 stars. Click to change it."
          onclick={() => (heroStars = (heroStars + 1) % 4)}
        >
          {#each [0, 1, 2] as i (i)}
            <b class={{ on: i < heroStars }}>★</b>
          {/each}
        </button>
        <span class="hint" aria-live="polite">{HINTS[heroStars]}</span>
      </div>
    </div>
  </header>

  <main>
    <section id="trailer">
      <div class="wrap">
        <p class="kicker">The teaser · turn the sound on</p>
        <h2>Fifty seconds of <em>Småland</em></h2>
        <div class="screen">
          <!-- svelte-ignore a11y_media_has_caption -->
          <!-- biome-ignore lint/a11y/useMediaCaption: the teaser has no speech, only synthesised music and engines (tools/trailer/synth.js); its label describes what it shows -->
          <video
            controls
            playsinline
            preload="metadata"
            src="{MEDIA}teaser.mp4#t=0.5"
            aria-label="Teaser trailer: the village from the air, a red Volvo 240 chased by three police cars, an EPA-traktor at 30 km/h, and the title card"
          ></video>
        </div>
      </div>
    </section>

    <section id="getaway">
      <div class="wrap">
        <p class="kicker">Getaway · the real map</p>
        <h2>You just took <em>a Volvo 240</em></h2>
        <p class="lede">
          The owner saw. Stay 170 m clear of every police car for 18 seconds and they give up. Get rammed and you're
          <i lang="sv">gripen</i>. This is the real street map of Vrigstad, from OpenStreetMap.
        </p>
        <div class="stage"><Getaway /></div>
        <p class="note">Off-road is slower.</p>
      </div>
    </section>

    <section id="features">
      <div class="wrap">
        <p class="kicker">What's in it</p>
        <h2>A whole village, <em>one square kilometre at a time</em></h2>
        <div class="stats">
          <div>{data.buildings}<small>Buildings</small></div>
          <div>{data.streets}<small>Named streets</small></div>
          <div>2.2 km<small>Square of Småland</small></div>
          <div>0 kr<small>To play</small></div>
        </div>
        <ul class="grid">
          {#each FEATURES as f (f.title)}
            <li>
              <f.icon size="1.75rem" strokeWidth={2} aria-hidden="true" />
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          {/each}
        </ul>
      </div>
    </section>

    <section class="finale">
      <div class="wrap">
        <p class="kicker">Vrigstad is waiting</p>
        <h2>Something is about<br>to <em>happen here</em></h2>
        <div class="cta">
          <a class="btn go" href={GAME_URL} rel="external"><Play size="1em" strokeWidth={2.5} /> Play now</a>
          <a class="btn" href={MAP_URL} rel="external"><MapIcon size="1em" strokeWidth={2.5} /> Explore the 3D map</a>
          <a class="btn" href={resolve('/')}><BookOpen size="1em" strokeWidth={2.5} /> Read the wiki</a>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap credits">
      <span
        >Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL). Elevation:
        Mapzen terrain tiles.</span
      >
      <span
        >Made with love for Vrigstad · <a href={DISCORD_URL}>Discord</a> · <a href={SOURCE_URL}>GitHub</a> ·
        <a href="{SOURCE_URL}/issues/new/choose">Got an idea?</a></span
      >
    </div>
  </footer>
</div>

<style>
section {
  padding: clamp(64px, 10vw, 120px) 0;
}

/* ---------- hero ---------- */
.hero {
  position: relative;
  min-height: 100svh;
  display: grid;
  overflow: hidden;
  background: linear-gradient(180deg, var(--sky-top) 0%, var(--sky) 46%, #4b5250 70%, var(--road) 100%);
}
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(17, 20, 19, 0.15) 0%,
    rgba(17, 20, 19, 0) 35%,
    rgba(17, 20, 19, 0.75) 75%,
    var(--road) 100%
  );
}
.hero .wrap {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  padding-block: 24px 40px;
}
nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.links {
  display: flex;
  align-items: center;
  gap: 22px;
  font: 600 1rem var(--font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.links a {
  color: var(--ink);
  text-decoration: none;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
}
.links a:hover {
  color: var(--gold);
}
.links .icon {
  display: inline-grid;
  font-size: 1.375rem;
  /* the tap target is bigger than the mark: 44px, as a finger needs */
  padding: 11px;
  margin: -11px;
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.5));
}

/* the title is the hero; the catchphrase sits under it, smaller, as on a film poster */
.title {
  margin: auto 0;
  text-align: center;
}
.title h1 {
  font-size: clamp(4.5rem, min(18vw, 19vh), 12.5rem);
  line-height: 0.86;
}
.title h1 span {
  display: block;
  color: var(--gold);
}
.tagline {
  font: 600 clamp(1.25rem, 3vw, 2rem) / 1.1 var(--font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: clamp(14px, 2.5vh, 22px) 0 0;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}
.title hr {
  width: 120px;
  border: 0;
  border-top: 6px solid var(--gold);
  margin: clamp(16px, 3vh, 28px) auto;
}
.facts {
  font: 700 clamp(0.9375rem, 2.2vw, 1.375rem) var(--font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin: 0;
}
.facts i {
  color: var(--gold);
  font-style: normal;
  padding: 0 0.5em;
}
.cta {
  display: flex;
  gap: 14px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: clamp(18px, 3vh, 30px);
}
.wanted {
  display: inline-flex;
  gap: 4px;
  margin-top: clamp(14px, 2.5vh, 26px);
  padding: 4px 12px 6px;
  background: var(--plate);
  border-radius: 4px;
  border: 0;
  cursor: pointer;
  font-size: 1.875rem;
  line-height: 1;
  color: rgba(244, 241, 230, 0.35);
}
.wanted b {
  font-weight: 400;
  transition:
    color 0.15s,
    transform 0.15s;
}
.wanted b.on {
  color: var(--gold);
  transform: scale(1.12);
}
.hint {
  display: block;
  font-size: 0.8125rem;
  color: var(--dim);
  margin-top: 6px;
}
/* Three stars on the hero: blue lights at the window's edges. The two sides flash 2.5 times a second together, under WCAG
   2.3.1's three, and hold still with reduced motion. */
.sirens::before,
.sirens::after {
  content: "";
  position: fixed;
  top: 0;
  bottom: 0;
  width: 26vw;
  pointer-events: none;
  z-index: 50;
  animation: siren 0.8s steps(2) infinite;
}
.sirens::before {
  left: 0;
  background: linear-gradient(90deg, rgba(31, 95, 168, 0.55), transparent);
}
.sirens::after {
  right: 0;
  background: linear-gradient(-90deg, rgba(31, 95, 168, 0.55), transparent);
  animation-delay: 0.4s;
}
@keyframes siren {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sirens::before,
  .sirens::after {
    animation: none;
    opacity: 0.5;
  }
  .wanted b {
    transition: none;
  }
}

/* ---------- teaser ---------- */
#trailer {
  padding-top: 24px;
}
.screen {
  margin-top: 28px;
  border-radius: 6px;
  overflow: hidden;
  border: 3px solid var(--plate);
  background: #000;
  aspect-ratio: 16 / 9;
}
.screen video {
  display: block;
  width: 100%;
  height: 100%;
}

/* ---------- getaway ---------- */
#getaway {
  background: var(--asphalt);
}
.stage {
  margin-top: 28px;
}
.note {
  color: var(--dim);
  font-size: 0.875rem;
  margin: 12px 0 0;
}

/* ---------- features ---------- */
.stats {
  display: flex;
  gap: clamp(24px, 6vw, 72px);
  flex-wrap: wrap;
  margin-top: 36px;
}
.stats div {
  font: 700 clamp(2.75rem, 7vw, 4.5rem) / 1 var(--font);
  font-variant-numeric: tabular-nums;
}
.stats small {
  display: block;
  font: 600 0.875rem var(--font);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--dim);
  margin-top: 6px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
}
.grid li {
  background: var(--road);
  padding: 26px 24px 28px;
  color: var(--gold);
}
.grid h3 {
  font-size: 1.625rem;
  margin: 12px 0 8px;
  color: var(--ink);
}
.grid p {
  margin: 0;
  color: var(--dim);
  font-size: 1rem;
}

/* ---------- finale and footer ---------- */
.finale {
  text-align: center;
  background: linear-gradient(180deg, var(--road), #2a3330);
}
.finale h2 {
  font-size: clamp(3rem, 10vw, 6.875rem);
}
.finale .cta {
  margin-top: 36px;
}
footer {
  padding: 32px 0 calc(32px + env(safe-area-inset-bottom, 0px));
  color: var(--dim);
  font-size: 0.875rem;
  border-top: 1px solid var(--line);
}
.credits {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .links {
    gap: 16px;
    font-size: 0.875rem;
  }
  .links .wide {
    display: none;
  }
}
</style>
