<script lang="ts">
// The graphics settings, folded under Start on the intro card (#78). Reads and sets the settings store; a setting
// the game reads only at load offers a reload once it's changed.
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import { SETTINGS, type Settings } from '../settings.svelte';

let { settings, reload }: { settings: Settings; reload: () => void } = $props();
</script>

<details class="graphics">
  <summary>
    <SlidersHorizontal size={16} aria-hidden="true" />
    <span>Graphics</span>
    <ChevronDown class="chevron" size={16} aria-hidden="true" />
  </summary>
  <ul>
    {#each Object.values(SETTINGS) as setting (setting.id)}
      <li class={{ off: !settings.isAvailable(setting) }}>
        <label>
          <span class="label">{setting.label}</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.get(setting)}
            aria-checked={settings.get(setting)}
            aria-describedby="setting-{setting.id}-help"
            disabled={!settings.isAvailable(setting)}
            onchange={e => settings.set(setting, e.currentTarget.checked)}
          >
        </label>
        <p class="help" id="setting-{setting.id}-help">{setting.help}</p>
      </li>
    {/each}
  </ul>
  {#if settings.reloadPending}
    <button type="button" class="reload" onclick={reload}>Reload to apply</button>
  {/if}
</details>

<style>
.graphics {
  margin-top: 12px;
  font-size: 13px;
}
summary {
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px 0;
  color: var(--dim);
  cursor: pointer;
  list-style: none;
  font: 600 13px var(--display);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.graphics[open] summary {
  color: var(--ink);
}
.graphics[open] summary :global(.chevron) {
  transform: rotate(180deg);
}
ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}
label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  cursor: pointer;
}
.label {
  font-weight: 600;
}
.help {
  margin: 2px 0 0;
  max-width: 34em;
  color: var(--dim);
  font-size: 12px;
}
/* a switch: a track with a knob, gold when on */
input {
  appearance: none;
  flex: none;
  position: relative;
  width: 36px;
  height: 20px;
  margin: 0;
  border-radius: 10px;
  background: rgba(244, 241, 230, 0.22);
  cursor: pointer;
}
input::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ink);
}
input:checked {
  background: var(--gold);
}
input:checked::after {
  transform: translateX(16px);
  background: #1a1a14;
}
input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
/* a setting that does nothing while the one it requires is off */
.off {
  opacity: 0.45;
}
.off label,
.off input {
  cursor: default;
}
.reload {
  margin-top: 12px;
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
  summary:hover {
    color: var(--ink);
  }
  .reload:hover {
    background: rgba(242, 194, 48, 0.12);
  }
}
@media (prefers-reduced-motion: no-preference) {
  summary :global(.chevron),
  input,
  input::after {
    transition:
      transform 160ms ease-out,
      background-color 160ms ease-out;
  }
}
</style>
