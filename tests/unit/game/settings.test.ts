import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SETTINGS_KEY,
  SETTINGS,
  SETTINGS_KEY,
  Settings,
  type SettingsStorage,
} from '../../../src/game/settings.svelte';

/** A storage that holds saved entries, as localStorage would: this store's, and the first pause menu's if given. */
function storage(saved?: unknown, legacy?: unknown): SettingsStorage & { saved: Map<string, string> } {
  const map = new Map<string, string>(),
    put = (key: string, v: unknown) => map.set(key, typeof v === 'string' ? v : JSON.stringify(v));
  if (saved !== undefined) put(SETTINGS_KEY, saved);
  if (legacy !== undefined) put(LEGACY_SETTINGS_KEY, legacy);
  return { saved: map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('Settings', () => {
  it('starts from the defaults with no storage, or nothing saved', () => {
    for (const s of [new Settings(null), new Settings(storage())]) {
      expect(s.get(SETTINGS.LOOK_SPEED)).toBe(1);
      expect(s.get(SETTINGS.INVERT_LOOK)).toBe(false);
      expect(s.get(SETTINGS.CEL_SHADED)).toBe(true);
      expect(s.get(SETTINGS.OUTLINES)).toBe(true);
      expect(s.reloadPending).toBe(false);
    }
  });

  it('reads what was saved, and nothing it does not understand', () => {
    expect(new Settings(storage({ version: 1, values: { outlines: false } })).get(SETTINGS.OUTLINES)).toBe(false);
    for (const broken of [
      '{not json',
      { version: 2, values: { outlines: false } }, // a later shape
      { version: 1, values: { outlines: 'no' } }, // not a boolean
      { version: 1, values: null },
    ])
      expect(new Settings(storage(broken)).get(SETTINGS.OUTLINES)).toBe(true);
    const unknown = new Settings(storage({ version: 1, values: { 'not-a-setting': false, outlines: false } }));
    expect(unknown.get(SETTINGS.OUTLINES)).toBe(false); // the rest still read
  });

  it('reads a look speed only as a number, held inside its range', () => {
    const speed = (v: unknown) =>
      new Settings(storage({ version: 1, values: { 'look-speed': v } })).get(SETTINGS.LOOK_SPEED);
    expect(speed(1.5)).toBe(1.5);
    expect(speed(99)).toBe(3);
    expect(speed(0)).toBe(0.25);
    for (const v of [null, '', false, [], '2', Number.NaN]) expect(speed(v)).toBe(1); // Number() would make most of these 0
  });

  it('reads what the first pause menu saved, while nothing is saved under the new entry', () => {
    const old = new Settings(storage(undefined, { lookSpeed: 2, invertY: true }));
    expect(old.get(SETTINGS.LOOK_SPEED)).toBe(2);
    expect(old.get(SETTINGS.INVERT_LOOK)).toBe(true);
    expect(new Settings(storage(undefined, { lookSpeed: null, invertY: 'yes' })).get(SETTINGS.LOOK_SPEED)).toBe(1);
    const both = new Settings(storage({ version: 1, values: { 'look-speed': 0.5 } }, { lookSpeed: 2 }));
    expect(both.get(SETTINGS.LOOK_SPEED)).toBe(0.5); // the new entry wins
  });

  it('saves a change, and the next page load reads it back', () => {
    const saved = storage(),
      first = new Settings(saved);
    first.set(SETTINGS.OUTLINES, false);
    first.set(SETTINGS.LOOK_SPEED, 1.75);
    expect(JSON.parse(saved.saved.get(SETTINGS_KEY) ?? '')).toEqual({
      version: 1,
      values: { 'look-speed': 1.75, 'invert-look': false, 'cel-shaded': true, outlines: false },
    });
    const next = new Settings(saved);
    expect(next.get(SETTINGS.OUTLINES)).toBe(false);
    expect(next.get(SETTINGS.LOOK_SPEED)).toBe(1.75);
  });

  it('holds a slider inside its range, and drops a value it cannot use', () => {
    const settings = new Settings(null);
    settings.set(SETTINGS.LOOK_SPEED, 10);
    expect(settings.get(SETTINGS.LOOK_SPEED)).toBe(3);
    settings.set(SETTINGS.LOOK_SPEED, Number.NaN); // what an empty number input gives
    expect(settings.get(SETTINGS.LOOK_SPEED)).toBe(3);
  });

  it('tells the game when a setting changes, and only then', () => {
    const settings = new Settings(null),
      outlines = vi.fn();
    settings.watch(SETTINGS.OUTLINES, outlines);
    settings.set(SETTINGS.OUTLINES, true); // already on
    settings.set(SETTINGS.CEL_SHADED, false); // another setting
    expect(outlines).not.toHaveBeenCalled();
    settings.set(SETTINGS.OUTLINES, false);
    expect(outlines).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('asks for a reload only while a setting read at load differs from what the page loaded with', () => {
    const settings = new Settings(null);
    settings.set(SETTINGS.OUTLINES, false); // applies live
    settings.set(SETTINGS.LOOK_SPEED, 2);
    expect(settings.reloadPending).toBe(false);
    settings.set(SETTINGS.CEL_SHADED, false);
    expect(settings.reloadPending).toBe(true);
    settings.set(SETTINGS.CEL_SHADED, true); // back to what the page has
    expect(settings.reloadPending).toBe(false);
  });

  it('makes Outlines unavailable while the cel-shaded style, whose ink it is, is off', () => {
    const settings = new Settings(null);
    expect(settings.isAvailable(SETTINGS.OUTLINES)).toBe(true);
    expect(settings.isAvailable(SETTINGS.CEL_SHADED)).toBe(true); // requires nothing
    settings.set(SETTINGS.CEL_SHADED, false);
    expect(settings.isAvailable(SETTINGS.OUTLINES)).toBe(false);
  });

  it('keeps going when the browser refuses to read or to save', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
      refused: SettingsStorage = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
      settings = new Settings(refused);
    expect(settings.get(SETTINGS.LOOK_SPEED)).toBe(1);
    settings.set(SETTINGS.OUTLINES, false);
    expect(settings.get(SETTINGS.OUTLINES)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
