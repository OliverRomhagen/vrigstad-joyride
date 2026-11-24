<!-- A page's header: what kind of page it is, its title, its summary and its tags. -->
<script lang="ts">
let {
  label,
  title,
  summary,
  tags = [],
}: { label?: string; title: string; summary?: string; tags?: string[] } = $props();
</script>

<header>
  {#if label}
    <p class="kind">{label}</p>
  {/if}
  <h1>{title}</h1>
  {#if summary}
    <p class="summary">{summary}</p>
  {/if}
  {#if tags.length}
    <!-- labels, not links: the wiki has no page per tag -->
    <ul class="tags" aria-label="Tags">
      {#each tags as tag (tag)}
        <li>{tag}</li>
      {/each}
    </ul>
  {/if}
</header>

<style>
header {
  margin-bottom: 20px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font: 600 0.8125rem var(--font);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.tags li {
  padding: 1px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
</style>
