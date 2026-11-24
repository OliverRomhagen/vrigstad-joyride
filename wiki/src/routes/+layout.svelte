<script lang="ts">
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

// the dialog follows page.state; its own Escape (cancel) goes back instead of closing it behind the history's back
function drawer(dialog: HTMLDialogElement) {
  // a window wider than a phone's shows the sidebar instead: the drawer's entry is left, whether the window grew while it
  // was open or Forward led back into it
  const wide = matchMedia('(min-width: 761px)');
  $effect(() => {
    if (menuOpen && wide.matches) closeMenu();
    else if (menuOpen && !dialog.open) dialog.showModal();
    else if (!menuOpen && dialog.open) dialog.close();
  });
  const leaveOnWide = () => {
    if (wide.matches && page.state.menu) closeMenu();
  };
  wide.addEventListener('change', leaveOnWide);
  return () => wide.removeEventListener('change', leaveOnWide);
}
</script>

{#snippet links()}
  {#each data.sections as g (g.folder)}
    <h2>{g.label}</h2>
    <ul>
      {#each g.entries as p (p.slug)}
        <li>
          <a href={resolve('/[...slug]', { slug: p.slug })} aria-current={here('/[...slug]', p.slug) ? 'page' : undefined}>{p.title}</a>
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
<div class="shell">
  <header class="top">
    <a class="brand" href={resolve('/')}><span>Vrigstad</span> <b>wiki</b></a>
    <button class="menu" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="wiki-drawer" onclick={openMenu}>Menu</button>
    <a class="play" rel="external" href={GAME_URL}>Play <span class="play-long">the game</span> →</a>
  </header>
  <nav class="side" aria-label="Wiki">{@render links()}</nav>
  <main>{@render children()}</main>
  <footer>
    Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. Vrigstad is a real village in
    Småland; the game and this wiki are made with affection for it.
  </footer>
</div>
<Nightfall />

<!-- a click on the backdrop lands on the dialog itself, outside the panel inside it -->
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
    <button class="drawer-close" onclick={closeMenu}>Close</button>
    {@render links()}
  </nav>
</dialog>
{/if}
