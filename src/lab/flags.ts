// Lab flags: which opt-in experiments are switched on (#227).
// Gameplay asks a LabFlags, never the URL or storage, so the menu (#78) can set the same flags later.
// The game reads them once, at page load, so until experiments can start and stop while it runs, a change takes a reload:
// the console's `lab on <id>` (lab-commands.ts, #501) writes the URL with withLabFlag and reloads.

/** One experiment: its id in `?lab=`, an English name, and one line on what it costs. */
export interface LabExperiment {
  id: string;
  name: string;
  cost: string;
}

/**
 * Every experiment there is. Its code lives where it belongs, behind `lab.on('<id>')` checks in page code (#323), so
 * `git grep "lab.on('<id>')"` finds its gates: graduating it deletes them and its entry here, dropping it its code too.
 */
export const LAB_EXPERIMENTS = [
  { id: 'hello', name: 'Hello lab', cost: 'Nothing: logs one line, as the smallest example of a gate' },
  {
    id: 'toon',
    name: 'Cel-shaded style',
    cost: 'Every lit material swapped each frame, and an extra line draw per inked mesh, the village shells included',
  },
] as const satisfies readonly LabExperiment[];

export type LabId = (typeof LAB_EXPERIMENTS)[number]['id'];

const KNOWN = new Set<string>(LAB_EXPERIMENTS.map(e => e.id));

/** The known experiment ids in a query string's `lab` parameter (`?lab=voice,shout`); unknown ids are ignored. */
export function parseLabFlags(search: string): LabId[] {
  const on = new Set<LabId>();
  for (const value of new URLSearchParams(search).getAll('lab')) {
    for (const id of value.split(',')) {
      const trimmed = id.trim().toLowerCase();
      if (KNOWN.has(trimmed)) on.add(trimmed as LabId);
    }
  }
  return [...on];
}

/**
 * A query string with one experiment switched on or off, to load the page with. Every other parameter stays exactly as
 * it was written (`?dev` stays `?dev`, `at=1,2` keeps its comma), which URLSearchParams would rewrite. The experiments
 * that are on end up in one `lab` parameter, where the first one was, or last; ids that aren't experiments are dropped,
 * as parseLabFlags ignores them. With nothing on the parameter goes, and with nothing left the answer is ''.
 */
export function withLabFlag(search: string, id: LabId, on: boolean): string {
  const ids = new Set(parseLabFlags(search));
  if (on) ids.add(id);
  else ids.delete(id);
  const lab = LAB_EXPERIMENTS.map(e => e.id).filter(i => ids.has(i));
  let placed = false;
  const parts = search
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .flatMap(part => {
      if (!new URLSearchParams(part).has('lab')) return [part];
      if (placed || !lab.length) return [];
      placed = true;
      return ['lab=' + lab.join(',')];
    });
  if (!placed && lab.length) parts.push('lab=' + lab.join(','));
  return parts.length ? '?' + parts.join('&') : '';
}

/** The experiments switched on for this page load. Everything is off by default. */
export class LabFlags {
  private readonly ids: ReadonlySet<LabId>;

  constructor(ids: Iterable<LabId> = []) {
    this.ids = new Set(ids);
  }

  /** Flags from a query string, such as `location.search`. */
  static fromSearch(search: string): LabFlags {
    return new LabFlags(parseLabFlags(search));
  }

  on(id: LabId): boolean {
    return this.ids.has(id);
  }

  /** The ids switched on, in the order of LAB_EXPERIMENTS. */
  list(): LabId[] {
    return LAB_EXPERIMENTS.map(e => e.id).filter(id => this.ids.has(id));
  }
}
