<script lang="ts">
// The settings in the pause menu (#78), under a heading per group. The page mounts it with the settings store, which
// it puts in context for the controls below (./context.ts); a setting the game reads only at load offers a reload
// once it's changed.
import RotateCw from '@lucide/svelte/icons/rotate-cw';
import { SETTING_GROUPS, SETTINGS, type Settings } from '../settings.svelte';
import { setSettings } from './context';
import SettingControl from './SettingControl.svelte';

const { settings, reload }: { settings: Settings; reload: () => void } = $props();
setSettings(() => settings); // a function, not the store, so the controls follow the prop if it ever changes

// the settings never change while the page runs, so this is plain data, not state
const groups = Object.values(SETTING_GROUPS).map(group => ({
  group,
  settings: Object.values(SETTINGS).filter(s => s.group.id === group.id),
}));
const names = new Intl.ListFormat('en', { type: 'conjunction' });
// "Cel-shaded style", or "A and B": the settings waiting for a reload, named in the note
const waiting = $derived(names.format(settings.waitingForReload.map(s => s.label)));
</script>

{#each groups as { group, settings: list } (group.id)}
  <section aria-labelledby="settings-{group.id}">
    <h3 id="settings-{group.id}">{group.label}</h3>
    <ul>
      {#each list as setting (setting.id)}
        <SettingControl {setting} />
      {/each}
    </ul>
  </section>
{/each}
{#if settings.reloadPending}
  <p class="note" id="settings-reload-note">{waiting}: applies when the page reloads, and the game starts over.</p>
  <button type="button" class="reload" aria-describedby="settings-reload-note" onclick={reload}>
    <RotateCw size={14} aria-hidden="true" />
    Reload to apply
  </button>
{/if}

<style>
section {
  margin-top: 14px;
}
h3 {
  margin: 0 0 6px;
  color: var(--gold);
  font: 600 13px var(--display);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}
.note {
  margin: 14px 0 0;
  color: var(--dim);
  font-size: 12px;
}
.reload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 12px;
  border: 1px solid var(--gold);
  border-radius: 4px;
  background: transparent;
  color: var(--gold);
  cursor: pointer;
  font: 600 13px var(--display);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.reload:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
@media (hover: hover) {
  .reload:hover {
    background: rgba(242, 194, 48, 0.12);
  }
}
</style>
