import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The pages live in src/ (index.html is the game, map.html the map), because the repo root still holds
// the committed builds that GitHub Pages serves until #45. Each page builds to one self-contained file.
export default defineConfig({
  root: 'src',
  build: { outDir: '../dist' },
  plugins: [viteSingleFile()],
});
