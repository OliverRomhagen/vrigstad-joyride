// The registry of gameplay numbers (#217): each one has a key (`driving.grip`), a unit, a range and a line of help, and
// can be read, set and reset while the game runs. Gameplay doesn't look numbers up here: it reads the plain objects the
// entries point at (`DRIVING.GRIP`), so the hot path stays a property read. Tests, `?tune=` and the console (#357) set
// them through here. Pure: no DOM, no three.js.

/** What a tunable is, for help, completion and range checks. */
export interface TunableSpec {
  /** what it's measured in: `m/s`, `m/s²`, `s`, `1/s`, `rad`, `share` */
  unit: string;
  min: number;
  max: number;
  /** one line: what changing it does */
  help: string;
}

/** One registered number. */
export interface Tunable extends TunableSpec {
  readonly key: string;
  /** the value it had when it was registered */
  readonly defaultValue: number;
  get(): number;
  set(value: number): void;
  /** puts the default back, for a number whose default isn't one value (`set(defaultValue)` otherwise) */
  reset?(): void;
}

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** What `entry` shows of a tunable: everything but the way in, so a caller can't skip the range check. */
export type TunableInfo = Omit<Tunable, 'get' | 'set' | 'reset'>;

/** The registry; the game makes one and every area adds its numbers to it. */
export class Tunables {
  private readonly byKey = new Map<string, Tunable>();

  /** Adds a number reached through get and set; its current value becomes its default. */
  add(key: string, spec: TunableSpec, get: () => number, set: (value: number) => void, reset?: () => void): void {
    if (!KEY.test(key)) throw new Error('tunable keys are dotted lower camel case: ' + key);
    if (this.byKey.has(key)) throw new Error('tunable already registered: ' + key);
    const defaultValue = get();
    if (!(spec.min <= defaultValue && defaultValue <= spec.max))
      throw new Error(`${key}: default ${defaultValue} is outside ${spec.min}..${spec.max}`);
    this.byKey.set(key, { ...spec, key, defaultValue, get, set, ...(reset && { reset }) });
  }

  /**
   * Adds fields of a plain object under `prefix`, each by the name given in `specs`:
   * `addFields('driving', DRIVING, { GRIP: { name: 'grip', unit: '1/s', … } })` registers `driving.grip`.
   */
  addFields<O extends Record<string, unknown>>(
    prefix: string,
    obj: O,
    specs: { [K in keyof O]?: TunableSpec & { name: string } },
  ): void {
    for (const field of Object.keys(specs) as (keyof O & string)[]) {
      const spec = specs[field];
      if (!spec || typeof obj[field] !== 'number') throw new Error(`${prefix}: ${field} is not a number`);
      const { name, ...rest } = spec;
      this.add(
        `${prefix}.${name}`,
        rest,
        () => obj[field] as number,
        v => {
          (obj as Record<string, unknown>)[field] = v;
        },
      );
    }
  }

  /** Every key, sorted. */
  keys(): string[] {
    return [...this.byKey.keys()].sort();
  }

  /** What a key is (unit, range, help, default), or undefined. */
  entry(key: string): TunableInfo | undefined {
    const t = this.byKey.get(key);
    if (!t) return undefined;
    const { get: _get, set: _set, reset: _reset, ...info } = t;
    return info;
  }

  get(key: string): number {
    return this.need(key).get();
  }

  /** Sets a number; a RangeError for an unknown key, a value that isn't a number, or one outside its range. */
  set(key: string, value: number): void {
    const t = this.need(key);
    if (!Number.isFinite(value)) throw new RangeError(`${key} must be a number`);
    if (value < t.min || value > t.max) throw new RangeError(`${key} is from ${t.min} to ${t.max} ${t.unit}`);
    t.set(value);
  }

  /** Puts one number back to its default, or every number when no key is given. */
  reset(key?: string): void {
    for (const t of key === undefined ? this.byKey.values() : [this.need(key)])
      if (t.reset) t.reset();
      else t.set(t.defaultValue);
  }

  /**
   * Applies overrides written `key:value,key:value`, as `?tune=` gives them. Returns a line for each one it couldn't
   * use, and applies the rest.
   */
  override(list: string): string[] {
    const errors: string[] = [];
    for (const item of list.split(',')) {
      if (!item.trim()) continue;
      const [key, value, extra] = item.split(':').map(s => s.trim());
      try {
        if (value === undefined || value === '' || extra !== undefined)
          throw new RangeError(`${item}: write key:value`);
        this.set(key, Number(value));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return errors;
  }

  private need(key: string): Tunable {
    const t = this.byKey.get(key);
    if (!t) throw new RangeError('No tunable called ' + key);
    return t;
  }
}
