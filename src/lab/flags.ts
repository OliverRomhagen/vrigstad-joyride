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
    id: 'cockpit',
    name: "Driver's view",
    cost: "A small download; in the driver's seat (V in a car), a simple interior of a few dozen meshes",
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
 * A query string with one parameter set, or taken out with null. Every other parameter stays exactly as it was written
 * (`?dev` stays `?dev`, `at=1,2` keeps its comma), which URLSearchParams would rewrite; only an empty part (`?a&&b`)
 * goes. The value is written as given, so it must need no encoding. A parameter that repeats ends up once, where the
 * first one was; a new one goes last. With nothing left the answer is ''.
 */
export function withParam(search: string, name: string, value: string | null): string {
  let placed = false;
  const parts = search
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .flatMap(part => {
      if (!new URLSearchParams(part).has(name)) return [part];
      if (placed || value === null) return [];
      placed = true;
      return [`${name}=${value}`];
    });
  if (!placed && value !== null) parts.push(`${name}=${value}`);
  return parts.length ? '?' + parts.join('&') : '';
}

/**
 * A query string with one experiment switched on or off, to load the page with (see withParam for what stays). The
 * experiments that are on end up in one `lab` parameter; ids that aren't experiments are dropped, as parseLabFlags
 * ignores them. With nothing on the parameter goes.
 */
export function withLabFlag(search: string, id: LabId, on: boolean): string {
  const ids = new Set(parseLabFlags(search));
  if (on) ids.add(id);
  else ids.delete(id);
  const lab = LAB_EXPERIMENTS.map(e => e.id).filter(i => ids.has(i));
  return withParam(search, 'lab', lab.length ? lab.join(',') : null);
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
