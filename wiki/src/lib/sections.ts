// What each folder of docs/lore/ is called on the wiki, in the sidebar's order; another folder is shown under its own name.
const SECTIONS: Record<string, string> = { places: 'Places', characters: 'People', wildlife: 'Wildlife' };

const ORDER = Object.keys(SECTIONS);

/** The section a page's folder belongs to: its name, and its place in the sidebar (a folder not listed comes after). */
export const sectionOf = (folder: string) => ({
  label: SECTIONS[folder] ?? (folder || 'More'),
  rank: ORDER.includes(folder) ? ORDER.indexOf(folder) : ORDER.length,
});

/** The folder of a page's slug in docs/lore/: `places` for `places/torget`, empty for a page at the top. */
export const folderOf = (slug: string) => slug.split('/').slice(0, -1).join('/');
