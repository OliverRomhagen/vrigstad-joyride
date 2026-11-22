import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The fonts (src/fonts/barlow.ts) stay files beside the page instead of being inlined like every other asset: a browser
// downloads only the weights a page draws with, while inlined it would download every weight, in both formats.
// Listed after viteSingleFile and enforced post like it, so it runs after the config hook that inlines everything.
function fontFilesBesideThePage(): Plugin {
  return {
    name: 'font-files-beside-the-page',
    enforce: 'post',
    config(config) {
      config.build ??= {};
      config.build.assetsInlineLimit = file => !/\.woff2?$/.test(file);
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
