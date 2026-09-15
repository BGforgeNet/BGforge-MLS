<script lang="ts">
    import { GALLERY_TABS, type GalleryTab, tabLabel } from "../tabs";

    interface Props {
        current: GalleryTab;
        onSelect: (tab: GalleryTab) => void;
    }

    const { current, onSelect }: Props = $props();
</script>

<!-- A tablist rather than plain buttons: the panel switches what the grid below shows, which is what a
     reader of the accessibility tree needs told. `aria-selected` carries the state, and the stylesheet keys
     the selected look off that same attribute, so the two cannot disagree. -->
<div class="tabs" role="tablist" aria-label="Gallery view">
    {#each GALLERY_TABS as tab (tab)}
        <button
            type="button"
            role="tab"
            aria-selected={tab === current}
            class="tab"
            onclick={() => onSelect(tab)}
        >
            {tabLabel(tab)}
        </button>
    {/each}
</div>

