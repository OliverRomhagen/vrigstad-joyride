// Smoke test for the wiki, as built into dist/wiki/ next to the game: BASE_PATH=/wiki npm run build --prefix wiki, after the
// game's own build. The prerender already checks every page's markup and links; this checks what only a browser shows.
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchErrors } from './render-helpers.js';

// The wiki is its own build, so a local run of the game's tests doesn't need it. CI builds it (e2e.yml) and never skips.
test.skip(
  !process.env.CI && !existsSync('dist/wiki/index.html'),
  'the wiki is not built: BASE_PATH=/wiki npm run build --prefix wiki',
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
    await menu.click();
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass();
  await drawer.getByRole('link', { name: 'Torget' }).click();
  await expect(page.locator('h1')).toHaveText('Torget');
  await expect(drawer).toBeHidden();

  // a place: the game's map in a frame, over the place, and a link that starts the game there
  await expect(page.getByRole('link', { name: 'Drive here' })).toHaveAttribute('href', '/?at=-9,30');
  await expect(page.locator('.map-embed [role=status]')).toHaveCount(0); // the map's page has loaded in the frame
  expect(page.frames().map(frame => new URL(frame.url()).pathname + new URL(frame.url()).search)).toContain(
    '/map.html?focus=-9,30&embed',
  );
  await page.screenshot({ path: info.outputPath('wiki-place.png') });

  // a character: the game's own model, drawn on a canvas
  await menu.click();
  await drawer.getByRole('link', { name: 'Plåt-Pelle' }).click();
  await expect(page.locator('h1')).toHaveText('Plåt-Pelle');
  const scene = page.getByRole('img', { name: 'Plåt-Pelle in 3D: drag to look around' });
  await expect(scene.locator('canvas')).toBeVisible();
  await expect(page.locator('figure [role=status]')).toHaveCount(0); // the model stands in the scene
  await page.screenshot({ path: info.outputPath('wiki-character.png') });

  expect(errors).toEqual([]);
});
