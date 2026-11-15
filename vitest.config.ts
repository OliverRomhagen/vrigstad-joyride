import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is src/ and whose single-file plugin the tests don't need.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
});
