// The people and animals a page can show in 3D, by the `model` in its frontmatter. Each is built by the game's own code,
// loaded on demand, so a page that shows none doesn't load three.js.
import type { Object3D } from 'three';

export const NPC_MODELS: Record<string, () => Promise<Object3D>> = {
  'plat-pelle': () => import('#game/render/skroten').then(m => m.platPelle()),
  // the black cat with a white bib, the one coat with a chest and muzzle of its own
  cat: () =>
    Promise.all([import('#game/cats'), import('#game/render/models')]).then(([{ CAT_COLS, catMesh }, models]) =>
      catMesh(CAT_COLS.find(c => c.length === 3) ?? CAT_COLS[0], models),
    ),
};
