<script lang="ts">
// One setting in the settings panel: its label, a slider or a switch, and its line of help. The store comes from the
// panel's context (./context.ts).
import { type Setting, SettingKind } from '../settings.svelte';
import { getSettings } from './context';

let { setting }: { setting: Setting } = $props();
const settings = $derived.by(getSettings());
</script>

<li class={{ off: !settings.isAvailable(setting) }}>
  <label for="setting-{setting.id}">
    <span class="label">{setting.label}</span>
    {#if setting.kind === SettingKind.RANGE}
      <!-- saved when the slider is let go, not on every step of a drag: the game is paused meanwhile -->
      <input
        id="setting-{setting.id}"
        type="range"
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={settings.get(setting)}
        aria-describedby="setting-{setting.id}-help"
        onchange={e => settings.set(setting, e.currentTarget.valueAsNumber)}
      >
    {:else}
      <input
        id="setting-{setting.id}"
        type="checkbox"
        role="switch"
        bind:checked={() => settings.get(setting), on => settings.set(setting, on)}
        aria-checked={settings.get(setting)}
        aria-describedby="setting-{setting.id}-help"
        disabled={!settings.isAvailable(setting)}
      >
    {/if}
  </label>
  <p class="help" id="setting-{setting.id}-help">{setting.help}</p>
</li>

<style>
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
  color: var(--dim);
  font-size: 12px;
}
input[type="range"] {
  flex: 1;
  max-width: 140px;
  margin: 0;
  accent-color: var(--gold);
}
/* a switch: a track with a knob, gold when on */
input[type="checkbox"] {
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
input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ink);
}
input[type="checkbox"]:checked {
  background: var(--gold);
}
input[type="checkbox"]:checked::after {
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
@media (prefers-reduced-motion: no-preference) {
  input[type="checkbox"],
  input[type="checkbox"]::after {
    transition:
      transform 160ms ease-out,
      background-color 160ms ease-out;
  }
}
</style>
