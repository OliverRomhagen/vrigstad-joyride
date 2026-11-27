import { error } from '@sveltejs/kit';
import { GAME_TABLES } from '#lib/game-tables';
import { lore } from '#lib/lore';
import { hasInfobox, kindLabel } from '#lib/lore-index';
import { folderOf, sectionOf } from '#lib/sections';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => lore.all.map(e => ({ slug: e.slug }));

export const load: PageServerLoad = ({ params }) => {
  const entry = lore.get(params.slug);
  if (!entry) error(404, `No page at ${params.slug}`);
  const folder = folderOf(entry.slug);
  return {
    entry,
    // worked out here: the lore index is server only, and the page gets plain data
    label: kindLabel(entry),
    hasInfobox: hasInfobox(entry),
    section: folder ? sectionOf(folder).label : undefined,
    tables: entry.tables.map(id => GAME_TABLES[id]()),
    backlinks: lore.backlinks(entry.slug).map(({ slug, title }) => ({ slug, title })),
  };
};
