<script lang="ts">
    import { columnsFor, gridWindow, ladderSize } from "../grid-window";
    import { type GalleryTile } from "../messages";
    import Tile from "./Tile.svelte";

    interface Props {
        tiles: GalleryTile[];
        thumbnails: Map<string, string | undefined>;
        tileSize: number;
        ladder: readonly number[];
        onOpen: (id: string) => void;
        onNeed: (ids: string[], size: number) => void;
    }

    const { tiles, thumbnails, tileSize, ladder, onOpen, onNeed }: Props = $props();

    /** Rows kept beyond the viewport, so a scroll of one row does not arrive at an empty band. */
    const OVERSCAN = 2;
    const TILE_BOX = $derived(tileSize + 16);
    const ROW_HEIGHT = $derived(tileSize + 40);

    let scroller: HTMLElement | undefined = $state();
    let scrollTop = $state(0);
    let viewportHeight = $state(600);
    let viewportWidth = $state(800);

    const columns = $derived(columnsFor(viewportWidth, TILE_BOX));
    const mounted = $derived(
        gridWindow({
            total: tiles.length,
            columns,
            rowHeight: ROW_HEIGHT,
            scrollTop,
            viewportHeight,
            overscan: OVERSCAN,
        }),
    );
    const size = $derived(ladderSize(tileSize, globalThis.devicePixelRatio ?? 1, ladder));

    function measure(): void {
        if (!scroller) return;
        scrollTop = scroller.scrollTop;
        viewportHeight = scroller.clientHeight;
        viewportWidth = scroller.clientWidth;
    }

    // Ask only for what is mounted, and only for what has not been asked for yet - the host caches per
    // item+stamp, but a request still costs a message and a worker turn.
    $effect(() => {
        const wanted = tiles.slice(mounted.start, mounted.end).map((t) => t.id).filter((id) =>
            !thumbnails.has(id)
        );
        if (wanted.length > 0) onNeed(wanted, size);
    });

    $effect(() => {
        if (!scroller) return;
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scroller);
        return () => observer.disconnect();
    });
</script>

<div class="scroller" bind:this={scroller} onscroll={measure}>
    {#if tiles.length === 0}
        <p class="empty">Nothing to show.</p>
    {:else}
        <div class="spacer" style="height: {mounted.totalHeight}px">
            {#each Array.from({ length: mounted.lastRow - mounted.firstRow }, (_, i) => mounted.firstRow + i) as row (row)}
                <div class="row" style="top: {row * ROW_HEIGHT}px; height: {ROW_HEIGHT}px">
                    {#each tiles.slice(row * columns, row * columns + columns) as tile (tile.id)}
                        <Tile {tile} dataUri={thumbnails.get(tile.id)} size={tileSize} {onOpen} />
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>
