import { defineConfig } from '@playwright/test';

// Smoke tests run against the built pages (index.html, map.html) in the repo root, served the way GitHub Pages serves them.
const PORT = 8043;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,                 // headless WebGL (SwiftShader in CI) renders only a few frames a second
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,  // three.js and the fonts load from CDNs; do not fail a PR on one network blip
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure',
    // Software WebGL everywhere, so a local run takes the same render path as CI (which has no GPU).
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
