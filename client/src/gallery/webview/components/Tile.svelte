<script lang="ts">
    import { type GalleryTile } from "../messages";

    interface Props {
        tile: GalleryTile;
        dataUri: string | undefined;
        size: number;
        onOpen: (id: string) => void;
    }

    const { tile, dataUri, size, onOpen }: Props = $props();
</script>

<!-- A button, not a div: the tile IS the open control, so it must be reachable and activatable by keyboard
     like any other. -->
<button class="tile" style="width: {size + 16}px" title={tile.label} onclick={() => onOpen(tile.id)}>
    <span class="thumb" style="width: {size}px; height: {size}px">
        {#if dataUri}
            <img src={dataUri} alt="" />
        {/if}
    </span>
    <span class="label">{tile.label}</span>
</button>
