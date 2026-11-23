// Lab flags: which opt-in experiments are switched on (#227).
// Gameplay asks a LabFlags, never the URL or storage, so the menu (#78) and the console (#218) can set the same flags later.
// The game reads them once, at page load, so until experiments can start and stop while it runs, a change takes a reload.

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
    id: 'multiplayer',
    name: 'Two-tab multiplayer',
    cost: 'Nothing to download: shows the players of other tabs of this browser (?room= names the room), or with &net=webrtc a friend you swap invite codes with',
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
