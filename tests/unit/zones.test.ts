import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The world and sim code that architecture rule 2 covers is listed three times: Fallow's zones (fallow.toml), Biome's
// rule-2 override (biome.jsonc) and the DOM-less tsc run (tsconfig.sim.json). Each tool needs its own list, so this
// fails when one changes and the others don't follow.

const SIM_ZONES = new Set(['world', 'world-mesh', 'sim']);

type Paths = { include: string[]; exclude: string[] };

// Drop // and /* */ comments and trailing commas outside strings, so JSON.parse reads a .jsonc file.
function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end - 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[\]}])/g, '$1'));
}

// `src/game/**` and `src/game` mean the same files to all three tools.
const normalize = (path: string) => path.replace(/^!/, '').replace(/\/\*\*$/, '');

// An include inside another include adds nothing (src/world/mesh in src/world).
function paths(include: string[], exclude: string[]): Paths {
  const roots = [...new Set(include.map(normalize))];
  return {
    include: roots.filter(p => !roots.some(r => r !== p && p.startsWith(`${r}/`))).sort(),
    exclude: [...new Set(exclude.map(normalize))].sort(),
  };
}

function fallowPaths(): Paths {
  const zones = readFileSync('fallow.toml', 'utf8')
    .split('[[boundaries.zones]]')
    .slice(1)
    .map(block => ({
      name: /^name = "([^"]+)"/m.exec(block)?.[1] ?? '',
      patterns: [...(/^patterns = \[(.*)\]/m.exec(block)?.[1].matchAll(/"([^"]+)"/g) ?? [])].map(m => m[1]),
    }));
  const include = zones.filter(z => SIM_ZONES.has(z.name)).flatMap(z => z.patterns);
  // A file belongs to the first zone that matches it, so another zone's pattern takes files out of the rule-2 code
  // when a rule-2 zone after it covers them and none before it already did.
  const covers = (zone: { patterns: string[] }, path: string) =>
    zone.patterns.some(p => normalize(path).startsWith(`${normalize(p)}/`));
  const exclude = zones.flatMap((zone, i) =>
    SIM_ZONES.has(zone.name)
      ? []
      : zone.patterns.filter(
          p =>
            zones.slice(i + 1).some(z => SIM_ZONES.has(z.name) && covers(z, p)) &&
            !zones.slice(0, i).some(z => SIM_ZONES.has(z.name) && covers(z, p)),
        ),
  );
  return paths(include, exclude);
}

function biomePaths(): Paths {
  const config = parseJsonc(readFileSync('biome.jsonc', 'utf8')) as {
    overrides: { includes: string[]; plugins?: string[] }[];
  };
  const rule2 = config.overrides.filter(o => o.plugins?.includes('./tools/biome/no-dom-listeners.grit'));
  expect(rule2).toHaveLength(1);
  const { includes } = rule2[0];
  return paths(
    includes.filter(p => !p.startsWith('!')),
    includes.filter(p => p.startsWith('!')),
  );
}

function tscPaths(): Paths {
  const config = parseJsonc(readFileSync('tsconfig.sim.json', 'utf8')) as { include: string[]; exclude: string[] };
  return paths(config.include, config.exclude);
}

describe('the rule-2 paths', () => {
  it('cover the world and the game', () => {
    expect(fallowPaths().include).toEqual(['src/game', 'src/world']);
  });

  it('are the same in fallow.toml and biome.jsonc', () => {
    expect(biomePaths()).toEqual(fallowPaths());
  });

  it('are the same in fallow.toml and tsconfig.sim.json', () => {
    expect(tscPaths()).toEqual(fallowPaths());
  });
});
