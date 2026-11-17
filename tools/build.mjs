// Builds the game (index.html) and the map (map.html) into dist/, one page at a time:
// vite-plugin-singlefile cannot inline a build with several pages.
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

process.chdir(fileURLToPath(new URL('..', import.meta.url))); // Vite and the paths below resolve from the repo root
const pages = ['index.html', 'map.html'];
for (const [i, page] of pages.entries()) {
  await build({ build: { rollupOptions: { input: `src/${page}` }, emptyOutDir: i === 0 } });
}
