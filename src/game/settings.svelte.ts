// The player's settings (#78): what each one is, and a store that keeps their values, saves them in the browser and
// tells the game when one changes. The pause menu reads and sets the store (src/game/ui/); the game reads it when it
// builds what a setting decides, and listens for the ones it can change while it runs. Page code: it uses localStorage.

/** How a setting is changed: a switch, or a slider between two numbers. */
export const SettingKind = { TOGGLE: 'toggle', RANGE: 'range' } as const;

/** The headings the menu shows the settings under, in order. */
export const SETTING_GROUPS = {
  CONTROLS: { id: 'controls', label: 'Controls' },
  GRAPHICS: { id: 'graphics', label: 'Graphics' },
} as const;

type SettingGroup = (typeof SETTING_GROUPS)[keyof typeof SETTING_GROUPS];

interface SettingBase {
  /** As people type and read it, and as it's saved: kebab-case. */
  readonly id: string;
  readonly label: string;
  /** One line on what it changes, shown under the label. */
  readonly help: string;
  readonly group: SettingGroup;
  /** The game reads it only as the page loads, so a change takes a reload (what it decides is built once, at load). */
  readonly needsReload: boolean;
  /** The id of a setting this one only does anything under: the menu disables it while that one is off. */
  readonly requires?: string;
}

interface ToggleDef extends SettingBase {
  readonly kind: typeof SettingKind.TOGGLE;
  readonly default: boolean;
}

interface RangeDef extends SettingBase {
  readonly kind: typeof SettingKind.RANGE;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** A setting the player can change. */
export type SettingDef = ToggleDef | RangeDef;

const CEL_SHADED = {
  id: 'cel-shaded',
  kind: SettingKind.TOGGLE,
  label: 'Cel-shaded style',
  help: 'Flat bands of light, house details and 3D window frames. Off: the plain look, which is a little lighter to draw.',
  group: SETTING_GROUPS.GRAPHICS,
  default: true,
  needsReload: true, // the houses are built for one look or the other
} as const satisfies SettingDef;

/** Every setting there is, in the order the menu shows them. */
export const SETTINGS = {
  LOOK_SPEED: {
    id: 'look-speed',
    kind: SettingKind.RANGE,
    label: 'Look speed',
    help: 'How fast the mouse, or a drag, turns the camera.',
    group: SETTING_GROUPS.CONTROLS,
    default: 1, // × the speed the camera was tuned for
    min: 0.25,
    max: 3,
    step: 0.05,
    needsReload: false,
  },
  INVERT_LOOK: {
    id: 'invert-look',
    kind: SettingKind.TOGGLE,
    label: 'Invert look up/down',
    help: 'Moving the mouse or a finger up looks down, as in a flight game.',
    group: SETTING_GROUPS.CONTROLS,
    default: false,
    needsReload: false,
  },
  CEL_SHADED,
  OUTLINES: {
    id: 'outlines',
    kind: SettingKind.TOGGLE,
    label: 'Outlines',
    help: 'Ink lines along the edges of houses, cars and people, in the cel-shaded style.',
    group: SETTING_GROUPS.GRAPHICS,
    default: true,
    needsReload: false,
    requires: CEL_SHADED.id, // the ink is the cel-shaded style's
  },
} as const satisfies Record<string, SettingDef>;

export type Setting = (typeof SETTINGS)[keyof typeof SETTINGS];
type SettingId = Setting['id'];
/** What a setting holds: a number for a slider, on or off for a switch. */
export type SettingValue<S extends SettingDef> = S extends RangeDef ? number : boolean;
type Values = { [S in Setting as S['id']]: SettingValue<S> };

/** Where the values are saved: one entry, versioned, so a later change of shape can read or drop an old one. */
export const SETTINGS_KEY = 'vrigstad-joyride.settings';
const VERSION = 1;
/** Where the first pause menu (#521) saved look speed and invert, before this store: read once nothing is saved here. */
export const LEGACY_SETTINGS_KEY = 'joyride.settings';

/** What the store needs of localStorage, so a test can pass a stub. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The settings' values: read from `storage` once, saved there on every change. A value it can't read (no storage,
 * a broken or older entry, an unknown setting, a number out of range) falls back to the default or is held inside
 * the range, and a failed save only warns: settings never stop the game.
 */
export class Settings {
  private readonly values = $state<Values>(defaults());
  // what each value was when the page loaded, which is what the game built with
  private readonly loaded: Values;
  // a plain Map, not a SvelteMap: no one renders from it, the game only calls it
  private readonly listeners = new Map<SettingId, ((value: boolean | number) => void)[]>();

  constructor(private readonly storage: SettingsStorage | null) {
    for (const [id, value] of Object.entries(read(storage))) {
      const setting = byId(id),
        valid = setting && accept(setting, value);
      if (setting && valid !== undefined) this.write(setting, valid);
    }
    this.loaded = $state.snapshot(this.values);
  }

  get<S extends Setting>(setting: S): SettingValue<S> {
    return this.values[setting.id] as SettingValue<S>;
  }

  /** Sets a value, held inside a slider's range, saves it and tells whoever watches it. A value that can't be used is dropped. */
  set<S extends Setting>(setting: S, value: SettingValue<S>) {
    const valid = accept(setting, value);
    if (valid === undefined || this.values[setting.id] === valid) return;
    this.write(setting, valid);
    this.save();
    for (const listener of this.listeners.get(setting.id) ?? []) listener(valid);
  }

  /** Whether a setting does anything: the one it requires, if any, is on. */
  isAvailable(setting: SettingDef): boolean {
    return !setting.requires || this.values[setting.requires as SettingId] !== false;
  }

  /** Calls `listener` with the new value whenever `setting` changes; for a setting the game can change while it runs. */
  watch<S extends Setting>(setting: S, listener: (value: SettingValue<S>) => void) {
    const list = this.listeners.get(setting.id) ?? [];
    list.push(listener as (value: boolean | number) => void); // the id it is kept under says which of the two it gets
    this.listeners.set(setting.id, list);
  }

  /** The settings that only apply on a reload and differ from what the page loaded with, in the menu's order. */
  get waitingForReload(): Setting[] {
    return Object.values(SETTINGS).filter(s => s.needsReload && this.values[s.id] !== this.loaded[s.id]);
  }

  /** Whether any setting waits for a reload. */
  get reloadPending(): boolean {
    return this.waitingForReload.length > 0;
  }

  private write(setting: Setting, value: boolean | number) {
    (this.values as Record<SettingId, boolean | number>)[setting.id] = value;
  }

  private save() {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify({ version: VERSION, values: this.values }));
    } catch (err) {
      console.warn('Settings: not saved', err);
    }
  }
}

function defaults(): Values {
  return Object.fromEntries(Object.values(SETTINGS).map(s => [s.id, s.default])) as Values;
}

const byId = (id: string): Setting | undefined => Object.values(SETTINGS).find(s => s.id === id);

// the value as the setting can hold it: a slider's number inside its range, a switch's boolean; undefined for anything else
function accept(setting: SettingDef, value: unknown): boolean | number | undefined {
  if (setting.kind === SettingKind.TOGGLE) return typeof value === 'boolean' ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined; // not Number(): null or '' would read as 0
  return Math.min(setting.max, Math.max(setting.min, value));
}

// the saved values, by id: from an entry of this version, with the first pause menu's entry filling the ids it lacks
// (an entry saved before look speed moved here holds only the graphics); nothing from anything else
function read(storage: SettingsStorage | null): Record<string, unknown> {
  try {
    const saved = parse(storage?.getItem(SETTINGS_KEY)),
      legacy = parse(storage?.getItem(LEGACY_SETTINGS_KEY)),
      values = saved?.version === VERSION && saved.values && typeof saved.values === 'object' ? saved.values : null;
    if (saved && !values) return {}; // a later or broken shape: the defaults, rather than half of what it says
    const old = legacy ? { [SETTINGS.LOOK_SPEED.id]: legacy.lookSpeed, [SETTINGS.INVERT_LOOK.id]: legacy.invertY } : {};
    return { ...old, ...values };
  } catch {
    return {}; // storage can be blocked (private modes, embeds): the defaults still work
  }
}

function parse(raw: string | null | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
