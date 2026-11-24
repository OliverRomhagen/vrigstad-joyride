// The wiki's content: each Markdown file in docs/lore/ is an entry of one kind, its frontmatter checked against that kind
// when the index is built, so a typo fails the build instead of a page. Read-only: the files are the content, and an entry's
// id is its slug (its path in docs/lore/ without .md), which is also its route. No three.js, no DOM, no Vite: lore.ts reads
// the files and builds the index; tests build one by hand.
import { posix } from 'node:path';
import { folderOf, sectionOf } from './sections';

type Base = {
  slug: string;
  title: string;
  summary?: string;
  tags: string[];
  /** the game's tables the page shows after its prose, by their ids in wiki/src/lib/game-tables.ts */
  tables: string[];
  /** the slugs this entry links to */
  links: string[];
};
/**
 * A place in Vrigstad: `position` is where it is in the game, in metres from Torget (x east, z south), and the map's pin.
 * `start` is where "Drive here" puts you, when that isn't the position: a lake's position is in the water.
 */
export type Place = Base & { kind: 'place'; position?: [number, number]; start?: [number, number] };
/** A person: `model` names their 3D model (wiki/src/lib/npc-models.ts). What they say stays in the game's code. */
export type Character = Base & { kind: 'character'; model?: string };
/** An animal of Vrigstad's: `model` names its 3D model, as a character's does. */
export type Animal = Base & { kind: 'animal'; model?: string };
/** Prose with nothing kind-specific: what an entry without a `kind` is. */
export type Note = Base & { kind: 'note' };
export type Entry = Place | Character | Animal | Note;
export type Kind = Entry['kind'];

/** One file as read from docs/lore/: its slug, its frontmatter (untyped YAML) and its Markdown source. */
export type LoreFile = { slug: string; meta: Record<string, unknown>; source: string };

/** What the frontmatter is checked against that the index can't know itself. */
export type LoreRules = { models: ReadonlySet<string>; tables: ReadonlySet<string> };

const KINDS: readonly Kind[] = ['place', 'character', 'animal', 'note'];
/** The frontmatter keys every kind takes, and those each kind adds: any other key is a typo or belongs to another kind. */
const BASE_KEYS = ['kind', 'title', 'summary', 'tags', 'tables'];
const KIND_KEYS: Record<Kind, readonly string[]> = {
  place: ['position', 'start'],
  character: ['model'],
  animal: ['model'],
  note: [],
};

class LoreError extends Error {
  constructor(slug: string, problem: string) {
    super(`docs/lore/${slug}.md: ${problem}`);
  }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

function optionalString(file: LoreFile, key: string): string | undefined {
  const v = file.meta[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new LoreError(file.slug, `\`${key}\` should be text`);
  return v;
}

function requiredString(file: LoreFile, key: string): string {
  const v = optionalString(file, key);
  if (v === undefined) throw new LoreError(file.slug, `needs a \`${key}\``);
  return v;
}

/** A point in the game, [x, z] in metres. */
function optionalPoint(file: LoreFile, key: string): [number, number] | undefined {
  const p = file.meta[key];
  if (p === undefined) return undefined;
  if (!(Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n))))
    throw new LoreError(file.slug, `\`${key}\` should be [x, z] in metres`);
  return p as [number, number];
}

function strings(file: LoreFile, key: string): string[] {
  const v = file.meta[key];
  if (v === undefined) return [];
  if (!isStrings(v)) throw new LoreError(file.slug, `\`${key}\` should be a list of text`);
  return v;
}

/** The relative .md links of a page, as the slugs they point to. */
function linksOf(slug: string, source: string): string[] {
  const out = new Set<string>();
  for (const [, url] of source.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(url)) continue;
    out.add(posix.normalize(posix.join(posix.dirname(slug), url)).slice(0, -'.md'.length));
  }
  return [...out];
}

/** A file as an entry of its kind; throws, naming the file, on frontmatter its kind can't use. */
export function parseEntry(file: LoreFile, rules: LoreRules): Entry {
  const { slug, meta, source } = file;
  const kind = meta.kind ?? 'note';
  if (typeof kind !== 'string' || !KINDS.includes(kind as Kind))
    throw new LoreError(
      slug,
      `unknown kind "${String(kind)}"; the wiki knows ${KINDS.join(', ')} (wiki/src/lib/lore-index.ts)`,
    );
  const known = [...BASE_KEYS, ...KIND_KEYS[kind as Kind]];
  for (const key of Object.keys(meta))
    if (!known.includes(key))
      throw new LoreError(
        slug,
        `\`${key}\` isn't a key for kind ${kind}; it takes ${known.map(k => `\`${k}\``).join(', ')}`,
      );
  const base: Base = {
    slug,
    // always from the frontmatter: the page's header shows it as the page's one h1
    title: requiredString(file, 'title'),
    summary: optionalString(file, 'summary'),
    tags: strings(file, 'tags'),
    tables: strings(file, 'tables'),
    links: linksOf(slug, source),
  };
  for (const [i, id] of base.tables.entries()) {
    if (!rules.tables.has(id)) throw new LoreError(slug, `no game table "${id}" in wiki/src/lib/game-tables.ts`);
    if (base.tables.indexOf(id) !== i) throw new LoreError(slug, `the game table "${id}" is listed twice`);
  }
  switch (kind as Kind) {
    case 'place': {
      const position = optionalPoint(file, 'position');
      const start = optionalPoint(file, 'start');
      // the infobox, and with it "Drive here", shows only for a place with a position
      if (start && !position) throw new LoreError(slug, '`start` needs a `position`, the place it starts you near');
      return { ...base, kind: 'place', position, start };
    }
    case 'character':
    case 'animal': {
      const model = optionalString(file, 'model');
      if (model !== undefined && !rules.models.has(model))
        throw new LoreError(slug, `no 3D model "${model}" in wiki/src/lib/npc-models.ts`);
      return { ...base, kind: kind as 'character' | 'animal', model }; // the switch has checked it
    }
    case 'note':
      return { ...base, kind: 'note' };
  }
}

/** The lore, built once from its files and then queried. */
export class LoreIndex {
  private readonly entries: readonly Entry[];
  private readonly bySlug: ReadonlyMap<string, Entry>;

  constructor(files: readonly LoreFile[], rules: LoreRules) {
    this.entries = files.map(f => parseEntry(f, rules)).sort((a, b) => a.title.localeCompare(b.title, 'sv'));
    this.bySlug = new Map(this.entries.map(e => [e.slug, e]));
  }

  /** Every entry, by title. */
  get all(): readonly Entry[] {
    return this.entries;
  }

  get(slug: string): Entry | undefined {
    return this.bySlug.get(slug);
  }

  /** The entries of a kind and, optionally, of a section's folder (`places`), by title. */
  find<K extends Kind>(query: { kind: K; folder?: string }): Extract<Entry, { kind: K }>[];
  find(query?: { folder?: string }): Entry[];
  find(query: { kind?: Kind; folder?: string } = {}): Entry[] {
    return this.entries.filter(
      e =>
        (query.kind === undefined || e.kind === query.kind) &&
        (query.folder === undefined || folderOf(e.slug) === query.folder),
    );
  }

  /** The entries that link to this one: links are one-way in Markdown, so the wiki works out the other direction. */
  backlinks(slug: string): Entry[] {
    return this.entries.filter(e => e.links.includes(slug));
  }

  /** The entries by section, in the sidebar's order (sections.ts). */
  sections(): { folder: string; label: string; entries: Entry[] }[] {
    const folders = [...new Set(this.entries.map(e => folderOf(e.slug)))];
    return folders
      .map(folder => ({ folder, ...sectionOf(folder), entries: this.find({ folder }) }))
      .sort((a, b) => a.rank - b.rank || a.folder.localeCompare(b.folder))
      .map(({ folder, label, entries }) => ({ folder, label, entries }));
  }
}
