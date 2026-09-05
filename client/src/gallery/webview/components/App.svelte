<script lang="ts">
    import { matchesTag, resourceTags } from "../../resource-tags";
    import { filterTiles, ladderSize } from "../grid-window";
    import {
        type FacetState,
        type GalleryTile,
        type HostToWebview,
        type SetTile,
        type WebviewToHost,
    } from "../messages";
    import { type GalleryTab, resolveTab, showTabStrip } from "../tabs";
    import FacetBar from "./FacetBar.svelte";
    import Grid from "./Grid.svelte";
    import SetList from "./SetList.svelte";
    import Tabs from "./Tabs.svelte";
    import Toolbar from "./Toolbar.svelte";

    interface Props {
        post: (message: WebviewToHost) => void;
        /** The sizes the host can encode at. Passed in so the ladder has one definition, on the host side. */
        ladder: readonly number[];
        tileSize?: number;
    }

    const { post, ladder, tileSize = 64 }: Props = $props();

    /**
     * The preview's drawn size: the ladder's top step, since this is the one picture the animations tab is
     * about rather than one tile among hundreds.
     */
    const PREVIEW_PX = 128;

    let title = $state("resources");
    let items: GalleryTile[] = $state([]);
    let sets: SetTile[] = $state([]);
    let note: string | undefined = $state();
    let query = $state("");
    let tag = $state("");
    /** The chosen file format, or "" for every one. A separate axis from the tag: a type spans formats. */
    let format = $state("");
    let tab: GalleryTab = $state("files");
    /**
     * Every item the host has answered for, including the ones it could not draw - hence the `undefined`
     * VALUE rather than an absent key. A plain "is it missing" check would re-request an item that has
     * already been tried and failed, once per scroll past it.
     */
    let thumbnails: Map<string, string | undefined> = $state(new Map());
    /** Which answered items are creature animations, so a tile can say why its picture holds one frame. */
    let directional: Set<string> = $state(new Set());
    let facets: FacetState | undefined = $state();
    /** The animation this panel was opened on, if any: the sets tab marks its row. */
    let focusSet: number | undefined = $state();
    let loaded = $state(false);

    const inFormat = $derived(items.filter((tile) => format === "" || tile.ext === format));
    /**
     * Only the tags the chosen format contains: a filter offering a type with no files is a dead end, and
     * every type here belongs to one format - the item families to BAM, the area maps to BMP.
     */
    const tags = $derived(resourceTags(inFormat));
    /**
     * A tag the chosen format does not offer stops applying. Without this the select falls back to showing
     * its first option while the grid stays filtered by the old tag - an empty grid under a control reading
     * "All types".
     */
    const activeTag = $derived(tags.includes(tag) ? tag : "");
    const shown = $derived(
        filterTiles(inFormat, query).filter((tile) => matchesTag(tile.label, tile.ext, activeTag)),
    );
    /** The formats, on the same terms: one format alone is not a choice. */
    const formats = $derived([...new Set(items.map((tile) => tile.ext))].sort());
    /** The sets tab searches by the same box, over the label the tile shows. */
    const shownSets = $derived(
        sets.filter((set) => set.label.toLowerCase().includes(query.trim().toLowerCase())),
    );
    const hasSets = $derived(sets.length > 0);

    const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

    /**
     * The Files tile for the animation the facets resolve to.
     *
     * Found among the tiles the host already sent rather than requested by name: the thumbnail pump is keyed
     * by tile id, so going through the tile is what lets the preview reuse the same decode path - and the
     * archive's own spelling of the resref, which need not be the one the animation table gave.
     */
    const facetTile = $derived(
        facets?.resref === undefined
            ? undefined
            : items.find(
                  (tile) => tile.ext === "bam" && tile.label.toUpperCase() === facets?.resref?.toUpperCase(),
              ),
    );
    const previewSize = $derived(ladderSize(PREVIEW_PX, globalThis.devicePixelRatio ?? 1, ladder));

    // Ask once per file: the map holds an entry even for a picture that could not be drawn, so a second
    // request for the same failure never goes out.
    $effect(() => {
        const id = facetTile?.id;
        if (id !== undefined && !thumbnails.has(id)) post({ type: "requestThumbnails", ids: [id], size: previewSize });
    });

    function onMessage(event: MessageEvent<HostToWebview>): void {
        const message = event.data;
        if (message.type === "init") {
            title = message.title;
            items = message.items;
            sets = message.sets;
            note = message.note;
            focusSet = message.focusSet;
            // A restored panel can ask for a tab this source cannot fill; resolveTab decides, not the
            // stored value. A panel opened ON an animation asks for the sets tab.
            tab = resolveTab(message.focusSet === undefined ? tab : "sets", message.sets.length > 0);
            loaded = true;
            return;
        }
        if (message.type === "facets") {
            facets = message.state;
            return;
        }
        // Replaced, not mutated: mutating a Map in place does not go through the reactive proxy, so the tile
        // waiting on this picture would never re-render - a bug that only shows up in the live panel.
        thumbnails = new Map([...thumbnails, [message.id, message.dataUri]]);
        if (message.directional === true) directional = new Set([...directional, message.id]);
    }

    $effect(() => {
        globalThis.addEventListener("message", onMessage);
        return () => globalThis.removeEventListener("message", onMessage);
    });
</script>

<div class="gallery">
{#if showTabStrip(hasSets)}
    <Tabs current={tab} onSelect={(next) => (tab = next)} />
{/if}
<Toolbar
    {query}
    shown={tab === "files" ? shown.length : shownSets.length}
    total={tab === "files" ? items.length : sets.length}
    title={tab === "files" ? title : "animations"}
    onQuery={(v) => (query = v)}
    tags={tab === "files" ? tags : []}
    tag={activeTag}
    onTag={(v) => (tag = v)}
    formats={tab === "files" ? formats : []}
    {format}
    onFormat={(v) => (format = v)}
/>
{#if tab === "sets"}
    {#if facets}
        <FacetBar
            state={facets}
            onSelect={(family, value) => post({ type: "selectFacet", family, value })}
        />
        <div class="facetpreview" style="width: {PREVIEW_PX}px; height: {PREVIEW_PX}px">
            {#if facetTile && thumbnails.get(facetTile.id)}
                <img src={thumbnails.get(facetTile.id)} alt={`${facets.resref} frame`} />
                {#if directional.has(facetTile.id)}
                    <span class="rose" title="Creature animation: one frame of several directions"></span>
                {/if}
            {/if}
        </div>
        <p class="facetresult">
            {#if facets.resref}
                <span class="facetfile">{facets.resref}.BAM</span>
                <button
                    type="button"
                    class="facetopen"
                    onclick={() => facets?.resref && post({ type: "openResref", resref: facets.resref })}
                >
                    Open in editor
                </button>
            {:else}
                <span class="facetnone">{facets.unavailable}</span>
            {/if}
        </p>
    {/if}
    {#if focusSet !== undefined && !sets.some((set) => set.id === focusSet)}
        <p class="facetnone">This install has no animation {hex(focusSet)}.</p>
    {/if}
    <!-- A row opens the set in the animation editor. The panel draws no set of its own: a set is a
         document there, with the same controls, save path and backup as a single file. -->
    <SetList sets={shownSets} focus={focusSet} onOpen={(id) => post({ type: "openSetEditor", id })} />
{:else if loaded && items.length === 0}
    <p class="empty">{note ?? "No drawable resources here."}</p>
{:else}
    <Grid
        tiles={shown}
        {thumbnails}
        {directional}
        {tileSize}
        {ladder}
        onOpen={(id) => post({ type: "open", id })}
        onNeed={(ids, size) => post({ type: "requestThumbnails", ids, size })}
    />
{/if}
</div>
