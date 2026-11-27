<!-- Wraps every Markdown page's prose (mdsvex's default template). The page around it, its header and its infobox, is the
     route's ([...slug]/+page.svelte), from the entry the lore index checked; mdsvex also passes the frontmatter in, unused here. -->
<script lang="ts">
import type { Snippet } from 'svelte';

let { children }: { children?: Snippet; [frontmatter: string]: unknown } = $props();
</script>

{@render children?.()}
