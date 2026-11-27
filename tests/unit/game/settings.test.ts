import { describe, expect, it, vi } from 'vitest';
import { SETTINGS, SETTINGS_KEY, Settings, type SettingsStorage } from '../../../src/game/settings.svelte';

/** A storage that holds one saved entry, as localStorage would. */
function storage(saved?: unknown): SettingsStorage & { saved: Map<string, string> } {
  const map = new Map<string, string>();
  if (saved !== undefined) map.set(SETTINGS_KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  return { saved: map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('Settings', () => {
  it('starts from the defaults with no storage, or nothing saved', () => {
    for (const s of [new Settings(null), new Settings(storage())]) {
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

  it('saves a change, and the next page load reads it back', () => {
    const saved = storage(),
      first = new Settings(saved);
    first.set(SETTINGS.OUTLINES, false);
    expect(JSON.parse(saved.saved.get(SETTINGS_KEY) ?? '')).toEqual({
      version: 1,
      values: { 'cel-shaded': true, outlines: false },
    });
    expect(new Settings(saved).get(SETTINGS.OUTLINES)).toBe(false);
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

  it('keeps going when the browser refuses to save', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}),
      full: SettingsStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
      settings = new Settings(full);
    settings.set(SETTINGS.OUTLINES, false);
    expect(settings.get(SETTINGS.OUTLINES)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
