// What the game's Svelte components share through context, scoped to the tree that sets it rather than kept in a
// module that anything can import. The page hands each value to the root it mounts, which sets it here.
import { createContext } from 'svelte';
import type { Settings } from '../settings.svelte';

/** The player's settings, for the controls inside the settings panel: a function, so they follow the panel's prop. */
export const [getSettings, setSettings] = createContext<() => Settings>();
