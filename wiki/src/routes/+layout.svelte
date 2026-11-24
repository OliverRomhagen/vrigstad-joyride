<script lang="ts">
import { MediaQuery } from 'svelte/reactivity';
import Nightfall from '#lib/Nightfall.svelte';
import { GAME_URL } from '#lib/site';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import '#lib/wiki.css';
// the game's own self-hosted Barlow (#389), so the wiki asks no third party for its fonts either; a browser downloads only
// the weights it draws with, here Barlow Condensed's 600 and 700
import '#fonts/barlow';

let { data, children } = $props();

// by route, not by path: while prerendering, SvelteKit's paths are relative ('./garage'), so a page's pathname never equals
// resolve()'s, and the HTML would get the wrong frame and no aria-current until the page hydrates
const here = (route: string, slug?: string) =>
  page.route.id === route && (slug === undefined || page.params.slug === slug);

// On a phone the sidebar is a drawer over the page. Opening it is a shallow history entry (page.state.menu), so going back,
// a swipe or the browser's button, closes it and leaves you on the page, as on any app; every way of closing it goes back.
const menuOpen = $derived(page.state.menu === true);
// the page's own address, #anchor and all, so a reload with the drawer open lands where you were
const openMenu = () => goto(page.url.hash, { state: { menu: true }, shallow: true });
const closeMenu = () => history.back();
// a window wider than a phone's shows the sidebar instead: the same width as in the styles below. Read in the browser only
// (the drawer's effect), never while prerendering, where no width is known.
const wide = new MediaQuery('width > 47.5em');

// the dialog follows page.state; its own Escape (cancel) goes back instead of closing it behind the history's back
function drawer(dialog: HTMLDialogElement) {
  $effect(() => {
    // in a wide window the drawer's entry is left, whether the window grew while it was open or Forward led back into it
    if (menuOpen && wide.current) closeMenu();
    else if (menuOpen && !dialog.open) dialog.showModal();
    else if (!menuOpen && dialog.open) dialog.close();
  });
}
</script>

<svelte:head>
  <!-- without scripts the Menu button can't open the drawer: a phone shows the sidebar in the page instead -->
  <noscript>
    <style>
    /* each class twice: to outweigh the component's own rule for a phone, which hides the sidebar */
    .side.side.side {
      display: block;
    }
    .menu.menu.menu {
      display: none;
    }
    </style>
  </noscript>
</svelte:head>

{#snippet links()}
  {#each data.sections as g (g.folder)}
    <h2>{g.label}</h2>
    <ul>
      {#each g.entries as p (p.slug)}
        <li>
          <a
            href={resolve('/[...slug]', { slug: p.slug })}
            aria-current={here('/[...slug]', p.slug) ? 'page' : undefined}
            >{p.title}</a
          >
        </li>
      {/each}
    </ul>
  {/each}
  <h2>From the game</h2>
  <ul>
    <li><a href={resolve('/map')} aria-current={here('/map') ? 'page' : undefined}>The map</a></li>
    <li><a href={resolve('/garage')}>The garage</a></li>
  </ul>
{/snippet}

{#if here('/garage')}
  <!-- the garage is a scene that fills the window: no wiki frame around it -->
  {@render children()}
{:else}
  <a class="skip" href="#main">Skip to the page</a>
  <div class="shell">
    <header class="top">
      <a class="brand" href={resolve('/')}><span>Vrigstad</span> <b>wiki</b></a>
      <button
        type="button"
        class="menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls="wiki-drawer"
        onclick={openMenu}
      >
        Menu
      </button>
      <a class="play" rel="external" href={GAME_URL}>Play <span class="play-long">the game</span> →</a>
    </header>
    <nav class="side" aria-label="Wiki">{@render links()}</nav>
    <!-- tabindex: so the skip link can move the keyboard's focus here -->
    <main id="main" tabindex="-1">{@render children()}</main>
    <footer>
      Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. Vrigstad is a real
      village in Småland; the game and this wiki are made with affection for it.
    </footer>
  </div>
  <Nightfall />

  <!-- a click on the backdrop lands on the dialog itself, outside the panel inside it -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard closes the dialog with Escape (oncancel) and its Close button -->
  <dialog
    id="wiki-drawer"
    class="drawer"
    aria-label="Wiki"
    {@attach drawer}
    oncancel={e => {
      e.preventDefault();
      closeMenu();
    }}
    onclick={e => e.target === e.currentTarget && closeMenu()}
  >
    <!-- data-sveltekit-replacestate: a link in the drawer takes the drawer's place in the history, so going back from the
       next page doesn't open the drawer again -->
    <nav class="drawer-panel" aria-label="Wiki" data-sveltekit-replacestate>
      <button type="button" class="drawer-close" onclick={closeMenu}>Close</button>
      {@render links()}
    </nav>
  </dialog>
{/if}

<style>
/* the first thing the Tab key reaches: past the header and the sidebar to the page, shown only while it has the focus */
.skip {
  position: absolute;
  left: 16px;
  top: -4rem;
  z-index: 1;
  font: 600 1.125rem var(--font);
  text-transform: uppercase;
  color: var(--road);
  background: var(--gold);
  padding: 8px 14px;
  border-radius: 6px;
  text-decoration: none;
}
.skip:focus {
  top: 12px;
}

.shell {
  display: grid;
  grid-template: "top top" auto "side main" 1fr "foot foot" auto / 13.75rem minmax(0, 1fr);
  gap: 0 40px;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 16px;
}
.top {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 0 48px;
}
/* the phone's menu button; the sidebar is always there on a wider screen */
.menu {
  display: none;
  font: 600 1.125rem var(--font);
  text-transform: uppercase;
  color: var(--cream);
  background: #1d1f2499;
  border: 1px solid var(--hairline);
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.brand {
  font: 700 1.75rem / 1 var(--font);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--cream);
  text-decoration: none;
  white-space: nowrap;
}
.brand span {
  color: var(--road);
}
/* "wiki" as a small dark sign on the sky: cream straight on the orange reads at only 2.2:1 */
.brand b {
  font-weight: inherit;
  color: var(--cream);
  background: var(--road);
  padding: 2px 7px 1px;
  border-radius: 4px;
  margin-left: 2px;
}
.play {
  margin-left: auto;
  font: 600 1.125rem var(--font);
  text-transform: uppercase;
  color: var(--road);
  background: var(--gold);
  padding: 8px 14px;
  border-radius: 6px;
  text-decoration: none;
}
.play:hover {
  filter: brightness(1.08);
}

.side {
  grid-area: side;
  font-size: 1.0625rem;
}
:is(.side, .drawer) h2 {
  font: 600 0.875rem var(--font);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin: 24px 0 6px;
}
.side h2:first-child {
  margin-top: 0;
}
:is(.side, .drawer) ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
:is(.side, .drawer) a {
  display: block;
  padding: 3px 10px;
  margin-left: -10px;
  color: var(--cream);
  text-decoration: none;
}
.side a:hover {
  color: var(--gold);
}
/* the page you're on: gold, with a gold edge like a road's centre line, and no block behind it */
:is(.side, .drawer) a[aria-current="page"] {
  color: var(--gold);
  font-weight: 600;
  box-shadow: inset 3px 0 var(--gold);
}

main {
  grid-area: main;
  min-width: 0;
  padding-bottom: 64px;
}
/* it takes the focus from the skip link only to hand it on: no ring round the whole page */
main:focus {
  outline: none;
}
footer {
  grid-area: foot;
  border-top: 1px solid var(--line);
  padding: 16px 0 32px;
  font-size: 0.875rem;
  color: var(--muted);
}

/* a phone: the same width as `wide` in the script above */
@media (width <= 47.5em) {
  .shell {
    grid-template: "top" auto "side" auto "main" 1fr "foot" auto / minmax(0, 1fr);
  }
  /* a narrow header mustn't push the page wider than the screen: the brand gives way first */
  .top {
    gap: 8px;
    padding-bottom: 24px;
  }
  .brand {
    font-size: 1.375rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-block: 4px; /* room for the "wiki" sign's own padding, which overflow: hidden would cut */
  }
  .menu,
  .play {
    flex-shrink: 0;
    white-space: nowrap;
    padding: 7px 10px;
  }
  .menu {
    display: block;
  }
  .play-long {
    display: none;
  }
  /* the drawer (below) takes the sidebar's place */
  .side {
    display: none;
  }
}

/* ---------- the phone's menu: a drawer from the right, over the page ---------- */
.drawer {
  margin: 0 0 0 auto;
  width: min(20rem, 86vw);
  height: 100dvh;
  max-height: none;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--line);
  background: var(--panel);
  color: var(--cream);
  overscroll-behavior: contain;
}
.drawer[open] {
  animation: drawer-in 0.2s ease-out;
}
.drawer::backdrop {
  background: #0009;
}
@keyframes drawer-in {
  from {
    translate: 100% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer[open] {
    animation: none;
  }
}
/* the page behind an open drawer stays put */
:global(html:has(.drawer[open])) {
  overflow: hidden;
}
.drawer-panel {
  min-height: 100%;
  padding: 16px 20px 32px;
  font-size: 1.0625rem;
}
.drawer-close {
  display: block;
  margin-left: auto;
  font: 600 1.125rem var(--font);
  text-transform: uppercase;
  color: var(--cream);
  background: none;
  border: 1px solid var(--hairline);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
/* a finger needs more room than a pointer */
.drawer a {
  padding-block: 9px;
}
</style>
