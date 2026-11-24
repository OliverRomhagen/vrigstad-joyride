<!-- Every type of car the game has, with the numbers it drives by (src/game/sim/vehicle-spec.ts) and the paints it comes in. -->
<script lang="ts">
import { VEHICLES } from '#game/render/vehicle-registry';
import { type CarType, VEHICLE_SPECS } from '#game/sim/vehicle-spec';
import { colourName } from './colour-name';
import { kmh } from './units';

const rows = (Object.entries(VEHICLE_SPECS) as [CarType, (typeof VEHICLE_SPECS)[CarType]][]).map(([type, s]) => ({
  type,
  ...s,
  models: VEHICLES.filter(v => v.archetype === type).map(v => v.name),
}));
</script>

<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th>Type</th>
        <th>Models</th>
        <th>Top speed</th>
        <th>Pull from standstill</th>
        <th>Off road</th>
        <th>Paint</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.type)}
        <tr>
          <th scope="row">{r.name}</th>
          <td class="models">{r.models.join(', ') || '–'}</td>
          <td class="num">{kmh(r.max)} km/h</td>
          <td class="num">{r.acc} m/s²</td>
          <td class="num">{Math.round(r.off * 100)} %</td>
          <td>
            <ul class="swatches" aria-label="Paints">
              {#each r.cols as c (c)}
                <li style:background={c} title={colourName(c)}><span class="visually-hidden">{colourName(c)}</span></li>
              {/each}
            </ul>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
.models {
  white-space: normal;
  min-width: 10rem;
}
.num {
  font-variant-numeric: tabular-nums;
}
.swatches {
  display: flex;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.swatches li {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #fff3;
}
</style>
