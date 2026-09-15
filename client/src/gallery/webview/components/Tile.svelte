<script lang="ts">
    import { type GalleryTile } from "../messages";

    interface Props {
        tile: GalleryTile;
        dataUri: string | undefined;
        /** The source is a creature animation, so its picture is one frame of several directions. */
        directional?: boolean;
        size: number;
        onOpen: (id: string) => void;
    }

    const { tile, dataUri, directional = false, size, onOpen }: Props = $props();
</script>

<!-- A button, not a div: the tile IS the open control, so it must be reachable and activatable by keyboard
     like any other. -->
<button class="tile" style="width: {size + 16}px" title={tile.label} onclick={() => onOpen(tile.id)}>
    <span class="thumb" style="width: {size}px; height: {size}px">
        {#if dataUri}
            <img src={dataUri} alt="" />
            <!-- Marks a picture that is deliberately ONE frame, so a creature animation does not read as a
                 still. On the picture rather than beside it: the tile's label track is fixed. -->
            {#if directional}
                <span class="rose" title="Creature animation: one frame of several directions"></span>
            {/if}
        {/if}
    </span>
    <span class="label">{tile.label}</span>
</button>
