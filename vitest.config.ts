import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is src/ and whose single-file plugin the tests don't need.
export default defineConfig({
  // one tsconfig for every file: a test that imports wiki/ code would otherwise be compiled with wiki/tsconfig.json,
  // whose `$app/tsconfig` exists only once the wiki's own packages are installed, which the unit job doesn't do
  tsconfig: 'tsconfig.tests.json',
  // the wiki's alias for the game's code (wiki/vite.config.ts), for tests of wiki code that reads them
  resolve: {
    alias: [{ find: /^#game\//, replacement: fileURLToPath(new URL('./src/game/', import.meta.url)) }],
  },
  // compiles the runes in .svelte.ts modules (src/game/settings.svelte.ts), as the pages' build does
  plugins: [svelte()],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
