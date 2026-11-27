<!-- Shown inside the wiki's frame when a page isn't there or fails to load, such as a link followed after a deploy removed
     its page. An address typed wrong gets the host's own 404 instead: GitHub Pages serves only the site root's 404.html. -->
<script lang="ts">
import Head from '#lib/Head.svelte';
import PageHead from '#lib/PageHead.svelte';
import { resolve } from '$app/paths';
import { page } from '$app/state';

const missing = $derived(page.status === 404);
</script>

<Head title={missing ? 'No such page' : 'Something went wrong'} />

<article>
  <PageHead
    label={String(page.status)}
    title={missing ? 'Wrong turn' : 'Engine trouble'}
    summary={missing ? 'There is no page at this address.' : 'This page failed to load. Try it again in a moment.'}
  />
  <p><a class="button" href={resolve('/')}>Back to the wiki</a></p>
</article>
