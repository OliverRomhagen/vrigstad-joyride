import { lore } from '#lib/lore';

// the sidebar and the home page: each section's entries, with only what a link to them needs
export const load = () => ({
  sections: lore.sections().map(({ folder, label, entries }) => ({
    folder,
    label,
    entries: entries.map(({ slug, title, summary }) => ({ slug, title, summary })),
  })),
});
