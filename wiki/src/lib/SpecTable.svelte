<script lang="ts">
import { VEHICLES } from '#game/render/vehicle-registry';
import { type CarType, VEHICLE_SPECS } from '#game/sim/vehicle-spec';
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
      <tr><th>Type</th><th>Models</th><th>Top speed</th><th>Pull from standstill</th><th>Off road</th><th>Paint</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.type)}
        <tr>
          <th scope="row">{r.name}<small>{r.type}</small></th>
          <td class="models">{r.models.join(', ') || 'procedural'}</td>
          <td class="num">{kmh(r.max)} km/h</td>
          <td class="num">{r.acc} m/s²</td>
          <td class="num">{Math.round(r.off * 100)} %</td>
          <td><span class="swatches">{#each r.cols as c, i (i)}<i style="background: {c}" title={c}></i>{/each}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
