import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { mdsvex } from 'mdsvex';
import { defineConfig } from 'vite';

// the live wiki's address: docs/ links the wiki's own pages (not its Markdown ones) by it
const LIVE_WIKI = 'https://oliverromhagen.github.io/vrigstad-joyride/wiki/';

export default defineConfig({
  plugins: [
    mdsvex({
      extensions: ['.md', '.svx'],
      heading_ids: true, // ids as GitHub makes them, so the #anchors in docs/ work in both places
      templates: { default: '/src/lib/Page.svelte' },
      // docs/ links pages as files ([Torget](../places/torget.md)), so the links also work on GitHub; the wiki's route
      // for a page is its path without .md, so the same relative link works here once the extension goes. A page that
      // isn't in docs/ (the map) is linked by its address on the live wiki, which GitHub can follow too; here it
      // becomes a path under the wiki's own base path, so a preview links to its own map and the prerender checks it.
      rewrite: (url, { type }) => {
        if (type !== 'link') return undefined;
        if (url.startsWith(LIVE_WIKI)) return `${process.env.BASE_PATH ?? ''}/${url.slice(LIVE_WIKI.length)}`;
        if (/^[a-z]+:|^\/\//i.test(url)) return undefined;
        if (url.startsWith('/'))
          throw new Error(
            `docs/: the link ${url} goes nowhere on GitHub; link a wiki page as ${LIVE_WIKI}${url.slice(1)}`,
          );
        return url.replace(/\.md(?=$|#)/, '');
      },
    }),
    sveltekit({
      // into the game's dist/, so one deploy serves both: the game at the root, the wiki in wiki/. Build the game first, its build
      // empties dist/.
      adapter: adapter({ pages: '../dist/wiki', assets: '../dist/wiki' }),
      extensions: ['.svelte', '.md', '.svx'],
      // served next to the game on GitHub Pages: BASE_PATH=/vrigstad-joyride/wiki npm run build
      paths: { base: (process.env.BASE_PATH ?? '') as '' },
      prerender: { handleHttpError: 'fail' },
    }),
  ],
  // the pages are ../docs, and the infoboxes and tables read the game's own code from ../src
  // 5174: the game's own dev server has 5173, and the wiki's map embed and links point at it
  server: { fs: { allow: ['..'] }, port: 5174, strictPort: true },
  resolve: {
    // the game's own code, which the infoboxes and tables show, its world code, data and fonts: one path to each, so a move in src/ or
    // data/ is an edit here and in tsconfig.json (for tsc and Fallow), and for #game/ also in the root's vitest.config.ts
    // and tsconfig.tests.json. A Vite alias, as SvelteKit's `alias` is deprecated and a subpath import can't leave wiki/
    alias: [
      { find: /^#game\//, replacement: fileURLToPath(new URL('../src/game/', import.meta.url)) },
      { find: /^#world\//, replacement: fileURLToPath(new URL('../src/world/', import.meta.url)) },
      { find: /^#data\//, replacement: fileURLToPath(new URL('../data/', import.meta.url)) },
      { find: /^#fonts\//, replacement: fileURLToPath(new URL('../src/fonts/', import.meta.url)) },
    ],
  },
});
