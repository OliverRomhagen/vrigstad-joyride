<script lang="ts">
import Head from '#lib/Head.svelte';
import MapView from '#lib/MapView.svelte';
import PageHead from '#lib/PageHead.svelte';
</script>

<Head title="The map" description="Vrigstad in 3D, built from OpenStreetMap and elevation data." />

<article>
  <PageHead
    label="From the game"
    title="The map"
    summary="Vrigstad in 3D, built from OpenStreetMap and elevation data. Drag to turn it, scroll to zoom."
  />
  <MapView shape="tall" />
  <div class="prose">
    <p>
      This is the game's own map page, built from the same world data the game drives on. Each place in the wiki with a
      position opens it over that spot.
    </p>
  </div>
</article>
