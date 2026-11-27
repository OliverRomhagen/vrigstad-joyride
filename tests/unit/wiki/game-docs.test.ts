import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The wiki's contract with the game: every value of the game's that wiki/src/lib/game-tables.ts shows players has a doc
// comment (/** … */) right above its own declaration, saying what it is and in what unit. The comment is for the people who
// change the value; the wiki's text for players stays in game-tables.ts, and the two needn't say the same thing.
// Read as text rather than parsed: each value is declared on its own line, so the comment above it is easy to find.

const TABLES = 'wiki/src/lib/game-tables.ts';

/** The names game-tables.ts imports from the game, with the file each comes from. */
function gameImports(): { name: string; file: string }[] {
  const source = readFileSync(TABLES, 'utf8');
  return [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'#game\/([^']+)'/g)].flatMap(([, names, path]) =>
    names
      .split(',')
      .map(n => n.trim())
      .filter(n => n && !n.startsWith('type '))
      .map(n => n.split(/\s+as\s+/)[0]) // `KORV_KR as K` is KORV_KR in the game
      .map(name => ({ name, file: `src/game/${path}.ts` })),
  );
}

/** The doc comment right above `export const|function|class name`, or undefined when there's none. */
function docOf(file: string, name: string): string | undefined {
  const source = readFileSync(file, 'utf8');
  const at = new RegExp(`^export (?:const|function|class) ${name}\\b`, 'm').exec(source);
  if (!at) return undefined;
  const before = source.slice(0, at.index).trimEnd();
  if (!before.endsWith('*/')) return undefined;
  // the block comment that ends right above it: a plain /* … */ there isn't a doc comment, even with one further up
  const start = before.lastIndexOf('/*');
  return before.startsWith('/**', start) ? before.slice(start) : undefined;
}

describe("the game's values the wiki shows", () => {
  const imports = gameImports();

  it('are read from the game, every import of it in the form this test reads', () => {
    expect(imports.map(i => i.name)).toContain('TRISS_PLAN');
    // an import this test can't read (import * as, a default, a relative path into src/game) would go unchecked: refuse it
    const source = readFileSync(TABLES, 'utf8');
    expect(source.match(/from\s*['"]#game\//g)?.length).toBe(
      source.match(/import\s*(?:type\s*)?\{[^}]+\}\s*from\s*'#game\//g)?.length,
    );
    expect(source).not.toMatch(/['"](?:\.\.\/)+src\/game\//);
  });

  it.each(imports)('$name has a doc comment in $file', ({ name, file }) => {
    expect(docOf(file, name), `add a /** … */ comment above ${name} in ${file}: what it is, and its unit`).toMatch(
      /^\/\*\*[\s\S]*\w[\s\S]*\*\/$/,
    );
  });
});
