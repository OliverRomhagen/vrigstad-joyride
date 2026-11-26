import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The commit a page is built from, shown by the console's fps and in the test hook, so a bug report or a preview
// screenshot says which build it was. A PR's preview builds GitHub's temporary merge commit, which no one can look
// up, so its workflow passes the PR's head commit as BUILD_SHA.
function buildStamp(): string {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

// The fonts (src/fonts/barlow.ts) stay files beside the page instead of being inlined like every other asset: a browser
// downloads only the weights a page draws with, while inlined it would download every weight, in both formats.
// Listed after viteSingleFile and enforced post like it, so it runs after the config hook that inlines everything.
function fontsAsFiles(): Plugin {
  return {
    name: 'fonts-as-files',
    enforce: 'post',
    config(config) {
      config.build ??= {};
      config.build.assetsInlineLimit = file => !/\.woff2?$/.test(file);
    },
  };
}

// ?lab=rapier's physics engine (src/game/rapier-lab.ts) is a file of its own beside the pages, vendor/rapier.mjs, which
// the page imports by its address only when the flag is on. Imported the ordinary way it would be inlined into every
// page, flag or no flag: Rapier's ready-made build carries its WebAssembly inside it, 4.3 MB (1.65 MB compressed).
const RAPIER_FILE = 'vendor/rapier.mjs';
function rapierAsFile(): Plugin {
  const source = () => readFileSync(fileURLToPath(import.meta.resolve('@dimforge/rapier3d-compat')));
  return {
    name: 'rapier-as-file',
    configureServer(server) {
      server.middlewares.use(`/${RAPIER_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: RAPIER_FILE, source: source() });
    },
  };
}

// The pages live in src/ (index.html is the game, map.html the map). Each page builds to one file in dist/, with
// everything but the fonts and Rapier inlined, which CI deploys to GitHub Pages (.github/workflows/pages.yml).
export default defineConfig({
  root: 'src',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  // keep @license comments, so the bundled three.js keeps the MIT notice its licence asks for
  build: { outDir: '../dist', rolldownOptions: { output: { comments: { legal: true } } } },
  plugins: [viteSingleFile(), fontsAsFiles(), rapierAsFile()],
});
