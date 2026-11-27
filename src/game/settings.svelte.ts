// The player's settings (#78): what each one is, and a store that keeps their values, saves them in the browser and
// tells the game when one changes. The menus read and set the store (src/game/ui/); the game reads it when it builds
// what a setting decides, and listens for the ones it can change while it runs. Page code: it uses localStorage.

/** A setting the player can change. */
export interface SettingDef {
  /** As people type and read it, and as it's saved: kebab-case. */
  readonly id: string;
  readonly label: string;
  /** One line on what it changes, shown under the label. */
  readonly help: string;
  readonly default: boolean;
  /** The game reads it only as the page loads, so a change takes a reload (what it decides is built once, at load). */
  readonly needsReload: boolean;
  /** The id of a setting this one only does anything under: the menu disables it while that one is off. */
  readonly requires?: string;
}

const CEL_SHADED = {
  id: 'cel-shaded',
  label: 'Cel-shaded style',
  help: 'Flat bands of light, house details and 3D window frames. Off: the plain look, which is a little lighter to draw.',
  default: true,
  needsReload: true, // the houses are built for one look or the other
} as const satisfies SettingDef;

/** Every setting there is, in the order the menu shows them. */
export const SETTINGS = {
  CEL_SHADED,
  OUTLINES: {
    id: 'outlines',
    label: 'Outlines',
    help: 'Ink lines along the edges of houses, cars and people, in the cel-shaded style.',
    default: true,
    needsReload: false,
    requires: CEL_SHADED.id, // the ink is the cel-shaded style's
  },
} as const satisfies Record<string, SettingDef>;

export type Setting = (typeof SETTINGS)[keyof typeof SETTINGS];
type SettingId = Setting['id'];

/** Where the values are saved: one entry, versioned, so a later change of shape can read or drop an old one. */
export const SETTINGS_KEY = 'vrigstad-joyride.settings';
const VERSION = 1;

/** What the store needs of localStorage, so a test can pass a stub. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The settings' values: read from `storage` once, saved there on every change. A value it can't read (no storage,
 * a broken or older entry, an unknown setting) falls back to the default, and a failed save only warns: settings
 * never stop the game.
 */
export class Settings {
  private readonly values = $state<Record<SettingId, boolean>>(defaults());
  // what each value was when the page loaded, which is what the game built with
  private readonly loaded: Record<SettingId, boolean>;
  // a plain Map, not a SvelteMap: no one renders from it, the game only calls it
  private readonly listeners = new Map<SettingId, ((on: boolean) => void)[]>();

  constructor(private readonly storage: SettingsStorage | null) {
    for (const [id, on] of Object.entries(read(storage))) if (isId(id)) this.values[id] = on;
    this.loaded = $state.snapshot(this.values);
  }

  get(setting: Setting): boolean {
    return this.values[setting.id];
  }

  set(setting: Setting, on: boolean) {
    if (this.values[setting.id] === on) return;
    this.values[setting.id] = on;
    this.save();
    for (const listener of this.listeners.get(setting.id) ?? []) listener(on);
  }

  /** Whether a setting does anything: the one it requires, if any, is on. */
  isAvailable(setting: SettingDef): boolean {
    return !setting.requires || this.values[setting.requires as SettingId] !== false;
  }

  /** Calls `listener` with the new value whenever `setting` changes; for a setting the game can change while it runs. */
  watch(setting: Setting, listener: (on: boolean) => void) {
    const list = this.listeners.get(setting.id) ?? [];
    list.push(listener);
    this.listeners.set(setting.id, list);
  }

  /** Whether a setting that only applies on a reload differs from what the page loaded with. */
  get reloadPending(): boolean {
    return Object.values(SETTINGS).some(s => s.needsReload && this.values[s.id] !== this.loaded[s.id]);
  }

  private save() {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify({ version: VERSION, values: this.values }));
    } catch (err) {
      console.warn('Settings: not saved', err);
    }
  }
}

function defaults(): Record<SettingId, boolean> {
  return Object.fromEntries(Object.values(SETTINGS).map(s => [s.id, s.default])) as Record<SettingId, boolean>;
}

const isId = (id: string): id is SettingId => Object.values(SETTINGS).some(s => s.id === id);

// the saved values that are booleans, from an entry of this version; nothing from anything else
function read(storage: SettingsStorage | null): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object' || (saved as { version?: unknown }).version !== VERSION) return {};
    const values = (saved as { values?: unknown }).values;
    if (!values || typeof values !== 'object') return {};
    return Object.fromEntries(Object.entries(values).filter(([, on]) => typeof on === 'boolean'));
  } catch {
    return {};
  }
}
