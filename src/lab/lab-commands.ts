// The console's way to the lab flags (#501): `lab` lists the experiments, `lab on <id>` and `lab off <id>` switch one.
// The game reads the flags once, at page load, so a switch only writes the URL and loads the page again: LabFlags stays
// the one place gameplay asks. No DOM here: the page hands in its query string and how to reload. docs/console.md.
import { choice, command, group } from '../game/command-args';
import { type Commands, UsageError } from '../game/commands';
import { LAB_EXPERIMENTS, type LabFlags, type LabId, withLabFlag } from './flags';

export interface LabCommandsDeps {
  /** the flags this page load runs with */
  lab: Pick<LabFlags, 'on'>;
  /** the page's query string now: `location.search` */
  search(): string;
  /** loads the page again with this query string, '' for none */
  reload(search: string): void;
}

/** Adds `lab`, which lists the experiments, with `on` and `off` under it. */
export function registerLabCommands(commands: Pick<Commands, 'register'>, deps: LabCommandsDeps): void {
  const { lab } = deps;
  const state = (id: LabId) => (lab.on(id) ? 'on' : 'off');
  const example = LAB_EXPERIMENTS[0]?.id ?? 'id';

  const switchTo = (on: boolean) =>
    command({
      help: `switch an experiment ${on ? 'on' : 'off'}, and load the page again`,
      details: 'Every other parameter in the address stays as it is. What you were doing in the game is lost.',
      examples: [`lab ${on ? 'on' : 'off'} ${example}`],
      args: [choice('experiment', () => LAB_EXPERIMENTS.map(e => e.id))],
      run: ({ experiment }) => {
        if (lab.on(experiment) === on) return `${experiment} is already ${state(experiment)}.`;
        deps.reload(withLabFlag(deps.search(), experiment, on));
        return `${experiment} is ${on ? 'on' : 'off'}. Loading the page again…`;
      },
    });

  commands.register('lab', {
    ...group({
      help: 'list the lab experiments, or switch one on or off',
      details: 'Each line is an experiment: its id, whether it is on, its name and what switching it on costs.',
      examples: ['lab', `lab on ${example}`, `lab off ${example}`],
      subcommands: { on: switchTo(true), off: switchTo(false) },
    }),
    usage: '[on|off <experiment>]',
    // on its own it lists, where a plain group() only shows its usage line
    run: words => {
      if (words.length) throw new UsageError(`No subcommand called ${words[0]}.`);
      if (!LAB_EXPERIMENTS.length) return 'No experiments in the lab.';
      return LAB_EXPERIMENTS.map(e => `${e.id} [${state(e.id)}]: ${e.name}. Cost: ${e.cost}`).join('\n');
    },
  });
}
