<!-- What a page puts in the document's head: its title, which SvelteKit also reads out after a navigation, its description,
     and the same two for a link shared elsewhere (Open Graph). -->
<script lang="ts">
const SITE = 'Vrigstad wiki';

let { title, description }: { title?: string; description?: string } = $props();
const full = $derived(title ? `${title} · ${SITE}` : SITE);
</script>

<svelte:head>
  <title>{full}</title>
  <meta property="og:title" content={title ?? SITE}>
  <meta property="og:site_name" content={SITE}>
  <meta property="og:type" content="article">
  {#if description}
    <meta name="description" content={description}>
    <meta property="og:description" content={description}>
  {/if}
</svelte:head>
