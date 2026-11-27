// The wiki's content, read from docs/lore/: the places and people of Vrigstad, for players. The rest of docs/ is internal, for
// the people who make the game, and isn't published. Server only: the prerender reads it, and pages get what their load returns.
import { GAME_TABLES } from './game-tables';
import { type LoreFile, LoreIndex } from './lore-index';
import { NPC_MODELS } from './npc-models';

const ROOT = '../../../docs/lore/';
const metas = import.meta.glob<Record<string, unknown> | undefined>('../../../docs/lore/**/*.md', {
  eager: true,
  query: '?metadata',
  import: 'default',
});
const sources = import.meta.glob<string>('../../../docs/lore/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const files: LoreFile[] = Object.keys(sources).map(file => ({
  slug: file.slice(ROOT.length, -'.md'.length),
  meta: metas[file] ?? {},
  source: sources[file],
}));

export const lore = new LoreIndex(files, {
  models: new Set(Object.keys(NPC_MODELS)),
  tables: new Set(Object.keys(GAME_TABLES)),
});
