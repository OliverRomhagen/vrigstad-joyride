<!-- A page's header: what kind of page it is, its title, its summary and its tags. -->
<script lang="ts">
let {
  label,
  title,
  summary,
  tags = [],
}: { label?: string; title: string; summary?: string; tags?: string[] } = $props();
</script>

<header class="page-head">
  {#if label}<p class="kind">{label}</p>{/if}
  <h1>{title}</h1>
  {#if summary}<p class="summary">{summary}</p>{/if}
  {#if tags.length}<p class="tags">{#each tags as t (t)}<span>#{t}</span>{/each}</p>{/if}
</header>
