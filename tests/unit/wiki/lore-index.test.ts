import { describe, expect, it } from 'vitest';
import { type LoreFile, LoreIndex, parseEntry } from '../../../wiki/src/lib/lore-index';

const rules = { models: new Set(['plat-pelle', 'cat']), tables: new Set(['kiosk']) };
const file = (slug: string, meta: Record<string, unknown>, source = ''): LoreFile => ({ slug, meta, source });

const index = new LoreIndex(
  [
    file(
      'places/torget',
      { title: 'Torget', kind: 'place', position: [-9, 30], tags: ['spawn'] },
      'To [the lake](slattsjon.md).',
    ),
    file(
      'places/slattsjon',
      { title: 'Slättsjön', kind: 'place', position: [-433, -835], start: [-411, -761] },
      'Back to [Torget](torget.md#kiosk).',
    ),
    file('characters/plat-pelle', { title: 'Plåt-Pelle', kind: 'character', model: 'plat-pelle' }),
    file('about', { title: 'About the wiki' }),
  ],
  rules,
);

describe('parseEntry', () => {
  it('types an entry by its kind, and treats one without a kind as a note', () => {
    expect(index.get('places/torget')).toMatchObject({ kind: 'place', position: [-9, 30], tags: ['spawn'] });
    expect(index.get('places/slattsjon')).toMatchObject({ kind: 'place', start: [-411, -761] });
    expect(index.get('characters/plat-pelle')).toMatchObject({ kind: 'character', model: 'plat-pelle' });
    expect(parseEntry(file('wildlife/cats', { title: 'Cats', kind: 'animal', model: 'cat' }), rules)).toMatchObject({
      kind: 'animal',
      model: 'cat',
    });
    expect(index.get('about')).toMatchObject({ kind: 'note', title: 'About the wiki', tags: [], tables: [] });
    expect(parseEntry(file('kiosk', { title: 'Kiosken', tables: ['kiosk'] }), rules)).toMatchObject({
      tables: ['kiosk'],
    });
  });

  it('refuses frontmatter its kind cannot use, naming the file', () => {
    expect(() => parseEntry(file('x', { title: 'X', kind: 'dialogue' }), rules)).toThrow(
      'docs/lore/x.md: unknown kind "dialogue"',
    );
    expect(() => parseEntry(file('x', { title: 'X', kind: 'place', position: [1] }), rules)).toThrow(
      '`position` should be [x, z]',
    );
    expect(() => parseEntry(file('x', { title: 'X', kind: 'place', start: [1, 'a'] }), rules)).toThrow(
      '`start` should be [x, z]',
    );
    expect(() => parseEntry(file('x', { title: 'X', kind: 'character', model: 'nobody' }), rules)).toThrow(
      'no 3D model "nobody"',
    );
    expect(() => parseEntry(file('x', { title: 'X', tags: 'spawn' }), rules)).toThrow('`tags` should be a list');
    expect(() => parseEntry(file('x', { title: 'X', tables: ['menu'] }), rules)).toThrow('no game table "menu"');
    expect(() => parseEntry(file('x', { title: 'X', tables: ['kiosk', 'kiosk'] }), rules)).toThrow('listed twice');
    expect(() => parseEntry(file('x', { title: 'X', kind: 'place', postion: [1, 2] }), rules)).toThrow(
      "docs/lore/x.md: `postion` isn't a key for kind place",
    );
    expect(() => parseEntry(file('x', { title: 'X', kind: 'place', model: 'cat' }), rules)).toThrow(
      "`model` isn't a key for kind place",
    );
    expect(() => parseEntry(file('x', { title: 'X', start: [1, 2] }), rules)).toThrow(
      "`start` isn't a key for kind note",
    );
    expect(() => parseEntry(file('x', { title: 'X', kind: 'place', start: [1, 2] }), rules)).toThrow(
      '`start` needs a `position`',
    );
    expect(() => parseEntry(file('x', { title: 7 }), rules)).toThrow('`title` should be text');
    expect(() => parseEntry(file('x', {}, '# A heading\n'), rules)).toThrow('docs/lore/x.md: needs a `title`');
  });
});

describe('LoreIndex', () => {
  it('finds entries by kind and by folder, sorted by title in Swedish order', () => {
    expect(index.find({ kind: 'place' }).map(e => e.slug)).toEqual(['places/slattsjon', 'places/torget']);
    expect(index.find({ kind: 'character' }).map(e => e.slug)).toEqual(['characters/plat-pelle']);
    expect(index.find({ folder: 'characters' }).map(e => e.title)).toEqual(['Plåt-Pelle']);
  });

  it('works out backlinks from the relative .md links, anchors and all', () => {
    expect(index.backlinks('places/torget').map(e => e.slug)).toEqual(['places/slattsjon']);
    expect(index.backlinks('places/slattsjon').map(e => e.slug)).toEqual(['places/torget']);
    expect(index.backlinks('about')).toEqual([]);
  });

  it('groups entries in the sections the sidebar shows, a folder it does not name last', () => {
    expect(index.sections().map(s => [s.label, s.entries.length])).toEqual([
      ['Places', 2],
      ['People', 1],
      ['More', 1],
    ]);
  });
});
