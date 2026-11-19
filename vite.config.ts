import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The commit a page is built from, shown by ?debug and in the test hook, so a bug report or a preview screenshot says which build it was.
function buildStamp(): string {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unknown'; }
}

// The pages live in src/ (index.html is the game, map.html the map). Each page builds to one self-contained file in dist/,
// which CI deploys to GitHub Pages (.github/workflows/pages.yml).
export default defineConfig({
  root: 'src',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  // keep @license comments, so the bundled three.js keeps the MIT notice its licence asks for
  build: { outDir: '../dist', rolldownOptions: { output: { comments: { legal: true } } } },
  plugins: [viteSingleFile()],
});
