// Smoke test for the wiki, as built into dist/wiki/ next to the game: BASE_PATH=/wiki npm run build --prefix wiki, after the
// game's own build. The prerender already checks every page's markup and links; this checks what only a browser shows.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

// The wiki is its own build, so a local run of the game's tests doesn't need it: without one built for /wiki (a build
// with no BASE_PATH is for the root, and its pages ask the server for the wrong files here) the test is skipped. CI
// builds it (e2e.yml) and never skips.
const HOME = 'dist/wiki/index.html';
const builtForWiki = existsSync(HOME) && readFileSync(HOME, 'utf8').includes('assets: "/wiki"');
test.skip(
  !process.env.CI && !builtForWiki,
  'the wiki is not built for /wiki: BASE_PATH=/wiki npm run build --prefix wiki',
);

test('wiki: the menu leads to a place with its map and to a character in 3D, with no console errors', async ({
  page,
}, info) => {
  const errors = watchErrors(page);
  // a 3D model that fails only warns, and its caption says so: collect the warnings too
  page.on('console', m => {
    if (m.type() === 'warning' && m.text().startsWith('Wiki:')) errors.push(m.text());
  });
  // a phone's width, where the sidebar is a drawer behind the Menu button
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/wiki/');
  await expect(page.locator('h1')).toContainText('Vrigstad');

  // The test server has no page at /wiki/places/torget (GitHub Pages serves torget.html there), so a link that works
  // was followed by the wiki's own router: the page has hydrated. The drawer only opens once it has, too.
  const drawer = page.locator('#wiki-drawer');
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(async () => {
    // a click that worked leaves the button behind the open drawer: don't wait there for a second one
    if (!(await drawer.isVisible())) await menu.click({ timeout: 2000 });
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass();
  // Pages are found by their file's name, and what they say is read from the page: a title or a position edited in
  // docs/lore/ doesn't run these tests (e2e.yml skips a PR of only .md files), so it mustn't be able to fail them.
  const openPage = async path => {
    const link = drawer.locator(`a[href$="${path}"]`);
    const title = await link.textContent();
    await link.click();
    await expect(page.locator('h1')).toHaveText(title);
    await expect(drawer).toBeHidden();
    return title;
  };
  await openPage('places/torget');

  // a place: a link that starts the game there, and the game's map in a frame, over the place (not always the spot the
  // game starts at: a page can give a `start` of its own), as its "Open full screen" link opens it
  await expect(page.getByRole('link', { name: 'Drive here' })).toHaveAttribute('href', /^\/\?at=-?[\d.]+,-?[\d.]+$/);
  const fullMap = await page.getByRole('link', { name: 'Open full screen' }).getAttribute('href');
  expect(fullMap).toMatch(/^\/map\.html\?focus=-?[\d.]+,-?[\d.]+$/);
  await expect(page.locator('.map-embed [role=status]')).toHaveCount(0); // the map's page has loaded in the frame
  expect(page.frames().map(frame => new URL(frame.url()).pathname + new URL(frame.url()).search)).toContain(
    `${fullMap}&embed`,
  );
  await page.screenshot({ path: info.outputPath('wiki-place.png') });

  // a character: the game's own model, drawn on a canvas
  await menu.click();
  const name = await openPage('characters/plat-pelle');
  const scene = page.getByRole('img', { name: `${name} in 3D: drag to look around` });
  await expect(scene.locator('canvas')).toBeVisible();
  await expect(page.locator('figure [role=status]')).toHaveCount(0); // the model stands in the scene
  await page.screenshot({ path: info.outputPath('wiki-character.png') });

  expect(errors).toEqual([]);
});
