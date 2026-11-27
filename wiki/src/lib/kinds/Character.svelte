<!-- A character's or an animal's infobox: them in 3D, from the `model` in their frontmatter (npc-models.ts), which the lore
     index has already checked. -->
<script lang="ts">
import NpcPreview from '../NpcPreview.svelte';
import { NPC_MODELS } from '../npc-models';

let { title, model }: { title: string; model: string } = $props();
</script>

<NpcPreview load={NPC_MODELS[model]} label={title} />
