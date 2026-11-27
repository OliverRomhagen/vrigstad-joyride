// The compiled page components, loaded when a page is opened. Kept apart from lore.ts, which the server-only
// load reads, so the browser only gets the components it needs.
import type { Component } from 'svelte';

const components = import.meta.glob<{ default: Component }>('../../../docs/lore/**/*.md');

export const loadPage = (slug: string) => components[`../../../docs/lore/${slug}.md`]?.();
