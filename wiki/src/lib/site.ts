import { resolve } from '$app/paths';

// The wiki is built into dist/wiki/, next to the game and its map, so the game is one level up from the wiki's own base path
// (/vrigstad-joyride/wiki/ → /vrigstad-joyride/, a PR preview's pr-preview/pr-<n>/wiki/ → its own game). In `npm run dev` the
// game is its own dev server (the root's `npm run dev`).
export const GAME_URL = import.meta.env.DEV ? 'http://localhost:5173/' : resolve('/').replace(/wiki\/$/, '');
export const MAP_URL = `${GAME_URL}map.html`;
