import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The fonts (src/fonts/fonts.ts) stay files beside the page instead of being inlined like every other asset: a page
// loads only the family it draws with, so inlining them all would make every visitor download every candidate.
// Listed after viteSingleFile and enforced post like it, so it runs after the config hook that inlines everything.
function fontFilesBesideThePage(): Plugin {
  return {
    name: 'font-files-beside-the-page',
    enforce: 'post',
    config(config) {
      config.build ??= {};
      config.build.assetsInlineLimit = file => !file.endsWith('.woff2');
    },
  };
}

// The pages live in src/ (index.html is the game, map.html the map). Each page builds to one file in dist/, with
// everything but the fonts inlined, which CI deploys to GitHub Pages (.github/workflows/pages.yml).
export default defineConfig({
  root: 'src',
  // keep @license comments, so the bundled three.js keeps the MIT notice its licence asks for
  build: { outDir: '../dist', rolldownOptions: { output: { comments: { legal: true } } } },
  plugins: [viteSingleFile(), fontFilesBesideThePage()],
});
