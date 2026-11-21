// Dev console commands (#218): one registry that each module adds its own commands to. Pure: no DOM, no three.js.
// The console in devconsole.ts reads a line, runs it here and shows what comes back.

export interface Command {
  /** the arguments, for help: `<amount>` */
  usage?: string;
  /** one line for help */
  help: string;
  /** Runs the command with the words after its name; returns the line to show. Throw a UsageError for bad arguments. */
  run(args: string[]): string;
}

/** Thrown by a command for arguments it can't use; the console shows its usage line. */
export class UsageError extends Error {}

/** Commands by name. `help` is built in and lists the rest. */
export class Commands {
  private readonly list = new Map<string, Command>();

  constructor() {
    this.register('help', { help: 'list the commands', run: () => this.help() });
  }

  register(name: string, cmd: Command) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('command names are lower-case words: ' + name);
    if (this.list.has(name)) throw new Error('command already registered: ' + name);
    this.list.set(name, cmd);
  }

  names(): string[] {
    return [...this.list.keys()].sort();
  }

  /** Runs one typed line; returns what to show, or '' for an empty line. */
  run(line: string): string {
    const [name, ...args] = line.trim().split(/\s+/).filter(Boolean);
    if (!name) return '';
    const cmd = this.list.get(name.toLowerCase());
    if (!cmd) return `Unknown command: ${name}. Type help for the list.`;
    try {
      return cmd.run(args);
    } catch (err) {
      if (err instanceof UsageError)
        return `${err.message ? err.message + ' ' : ''}Usage: ${name.toLowerCase()} ${cmd.usage ?? ''}`.trimEnd();
      throw err;
    }
  }

  private help(): string {
    return this.names()
      .map(n => {
        const c = this.list.get(n) as Command;
        return `${n}${c.usage ? ' ' + c.usage : ''}: ${c.help}`;
      })
      .join('\n');
  }
}

/** A whole number of kronor, negative allowed; a UsageError for anything else. */
export function parseKr(s: string | undefined): number {
  if (s === undefined || !/^[+-]?\d{1,9}$/.test(s)) throw new UsageError();
  return Number(s);
}
