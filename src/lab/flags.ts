// Lab flags: which opt-in experiments are switched on (#227).
// Gameplay asks a LabFlags, never the URL or storage, so the menu (#78) and the console (#218) can set the same flags.
// The game reads them once, at page load, so until experiments can start and stop while it runs, a change takes a reload.
import { choice, command, optional, toggle } from '../game/command-args';
import type { Commands } from '../game/commands';
import { withParams } from '../game/devconsole';

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
  {
    id: 'grain',
    name: 'ISO 800 film grain',
    cost: 'A full-screen layer blended over the game and the HUD, its texture shifting 4 to 12 times a second',
  },
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

  /**
   * `lab` lists the experiments; `lab toon` switches one on or off (or `lab toon on`) and reloads with the new `?lab=`,
   * since the game reads the flags once, at page load.
   */
  registerCommands(commands: Pick<Commands, 'register'>, loc: Pick<Location, 'search'>) {
    const ids = LAB_EXPERIMENTS.map(e => e.id);
    commands.register(
      'lab',
      command({
        help: 'list the lab experiments, or switch one on or off and reload',
        examples: ['lab', 'lab toon', 'lab cockpit off'],
        args: [optional(choice('experiment', ids)), optional(toggle('state'))],
        run: ({ experiment, state }) => {
          if (!experiment)
            return [
              ...LAB_EXPERIMENTS.map(e => `${this.on(e.id) ? 'on ' : 'off'}  ${e.id}: ${e.name}. ${e.cost}`),
              'More settings, such as clouds and the time of day: type url.',
            ].join('\n');
          const on = state ?? !this.on(experiment);
          if (on === this.on(experiment)) return `${experiment} is already ${on ? 'on' : 'off'}.`;
          const next = ids.filter(id => (id === experiment ? on : this.on(id)));
          loc.search = withParams(loc.search, ['lab=' + next.join(',')]); // navigates: the page reloads with it
          return `Reloading with ${experiment} ${on ? 'on' : 'off'} …`;
        },
      }),
    );
  }
}
