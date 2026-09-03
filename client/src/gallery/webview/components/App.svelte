<script lang="ts">
    import { filterTiles } from "../grid-window";
    import { type GalleryTile, type HostToWebview, type WebviewToHost } from "../messages";
    import Grid from "./Grid.svelte";
    import Toolbar from "./Toolbar.svelte";

    interface Props {
        post: (message: WebviewToHost) => void;
        /** The sizes the host can encode at. Passed in so the ladder has one definition, on the host side. */
        ladder: readonly number[];
        tileSize?: number;
    }

    const { post, ladder, tileSize = 64 }: Props = $props();

    let title = $state("resources");
    let items: GalleryTile[] = $state([]);
    let note: string | undefined = $state();
    let query = $state("");
    /**
     * Every item the host has answered for, including the ones it could not draw - hence the `undefined`
     * VALUE rather than an absent key. A plain "is it missing" check would re-request an item that has
     * already been tried and failed, once per scroll past it.
     */
    let thumbnails: Map<string, string | undefined> = $state(new Map());
    let loaded = $state(false);

    const shown = $derived(filterTiles(items, query));

    function onMessage(event: MessageEvent<HostToWebview>): void {
        const message = event.data;
        if (message.type === "init") {
            title = message.title;
            items = message.items;
            note = message.note;
            loaded = true;
            return;
        }
        // Replaced, not mutated: mutating a Map in place does not go through the reactive proxy, so the tile
        // waiting on this picture would never re-render - a bug that only shows up in the live panel.
        thumbnails = new Map([...thumbnails, [message.id, message.dataUri]]);
    }

    $effect(() => {
        globalThis.addEventListener("message", onMessage);
        return () => globalThis.removeEventListener("message", onMessage);
    });
</script>

<div class="gallery">
    <Toolbar {query} shown={shown.length} total={items.length} {title} onQuery={(v) => (query = v)} />
    {#if loaded && items.length === 0}
        <p class="empty">{note ?? "No drawable resources here."}</p>
    {:else}
        <Grid
            tiles={shown}
            {thumbnails}
            {tileSize}
            {ladder}
            onOpen={(id) => post({ type: "open", id })}
            onNeed={(ids, size) => post({ type: "requestThumbnails", ids, size })}
        />
    {/if}
</div>
