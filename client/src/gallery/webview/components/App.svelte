<script lang="ts">
    import { matchesTag, resourceTags } from "../../resource-tags";
    import { filterTiles } from "../grid-window";
    import { type GalleryTile, type HostToWebview, type SetTile, type WebviewToHost } from "../messages";
    import { type GalleryTab, resolveTab, showTabStrip } from "../tabs";
    import { ANY_SELECTION, type FilterSelection, filterControls, filterSets } from "../set-filter";
    import Grid from "./Grid.svelte";
    import SetFilters from "./SetFilters.svelte";
    import SetPicker from "./SetPicker.svelte";
    import Tabs from "./Tabs.svelte";
    import Toolbar from "./Toolbar.svelte";
    // The animation surface itself, not a copy of it: this panel draws what the editor tab draws, with the
    // same components over the same protocol, and adds only the controls that choose what is on it.
    import AnimationApp from "../../../image-editor/webview/components/App.svelte";
    import { Bridge } from "../../../image-editor/webview/state/bridge";
    import type { HostToWebview as AnimationHostToWebview } from "../../../image-editor/webview/messages";

    interface Props {
        post: (message: WebviewToHost) => void;
        /** The sizes the host can encode at. Passed in so the ladder has one definition, on the host side. */
        ladder: readonly number[];
        tileSize?: number;
    }

    const { post, ladder, tileSize = 64 }: Props = $props();

    /**
     * What the stage is drawing, or `undefined` for nothing yet.
     *
     * Also the mount gate: the animation surface times out waiting for contents it was never going to be
     * sent, so it goes up when there is something to put on it and not before.
     */
    let showing: { set?: number; item?: string } | undefined = $state();
    /** Installed by the surface's own bridge, so a message can only be delivered once it is listening. */
    let deliverToViewer: ((message: AnimationHostToWebview) => void) | undefined;

    /**
     * The surface's end of its protocol, carried inside this panel's own.
     *
     * `ready` is posted from the subscribe rather than on mount: it is the message that asks the host for
     * the contents, and the host answers immediately, so it must not go out before there is something here
     * to receive the answer.
     */
    const viewerBridge = new Bridge(
        (message) => post({ type: "viewer", message }),
        (cb) => {
            deliverToViewer = cb;
            post({ type: "viewer", message: { type: "ready" } });
            return () => {
                if (deliverToViewer === cb) deliverToViewer = undefined;
            };
        },
    );

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
    /** How the animation list is narrowed. All ANY is where a panel opens: everything the install declares. */
    let filters: FilterSelection = $state({ ...ANY_SELECTION });
    /** The animation this panel was opened on, if any - kept for the note when the install has no such id. */
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
    const filterBar = $derived(filterControls(sets, filters));
    const shownSets = $derived(filterSets(sets, filters));
    const hasSets = $derived(sets.length > 0);

    const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

    function onMessage(event: MessageEvent<HostToWebview>): void {
        const message = event.data;
        if (message.type === "init") {
            title = message.title;
            items = message.items;
            sets = message.sets;
            note = message.note;
            focusSet = message.focusSet;
            // Back to ANY with the corpus: this is a new install's animations, and a race carried over from
            // the last one would narrow the list to nothing while every control still reads as a choice.
            filters = { ...ANY_SELECTION };
            // A restored panel can ask for a tab this source cannot fill; resolveTab decides, not the
            // stored value. A panel opened ON an animation asks for the sets tab.
            tab = resolveTab(message.focusSet === undefined ? tab : "sets", message.sets.length > 0);
            loaded = true;
            return;
        }
        if (message.type === "showing") {
            const mounted = showing !== undefined;
            showing = message.set === undefined && message.item === undefined ? undefined : message;
            // Only when the surface was ALREADY up: a first show mounts it, and its own bridge asks for
            // the contents as it subscribes. Asking twice would cost the whole view a second time.
            if (mounted && showing !== undefined) post({ type: "viewer", message: { type: "ready" } });
            return;
        }
        if (message.type === "viewer") {
            deliverToViewer?.(message.message);
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

<div class="gallery" class:showing={showing !== undefined}>
<div class="browse">
{#if showTabStrip(hasSets)}
    <Tabs current={tab} onSelect={(next) => (tab = next)} />
{/if}
{#if tab === "files"}
    <!-- The animations tab has no search box of its own: its picker carries the typing, so a second field
         filtering the same list would be two controls for one choice. -->
    <Toolbar
        {query}
        shown={shown.length}
        total={items.length}
        {title}
        onQuery={(v) => (query = v)}
        {tags}
        tag={activeTag}
        onTag={(v) => (tag = v)}
        {formats}
        {format}
        onFormat={(v) => (format = v)}
    />
{/if}
{#if tab === "sets"}
    <SetFilters
        controls={filterBar}
        onSelect={(family, value) => (filters = { ...filters, [family]: value })}
    />
    <SetPicker sets={shownSets} current={showing?.set} onChoose={(id) => post({ type: "showSet", id })} />
    {#if focusSet !== undefined && !sets.some((set) => set.id === focusSet)}
        <p class="facetnone">This install has no animation {hex(focusSet)}.</p>
    {/if}
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
{#if showing}
    <!-- Mounted once and kept: it holds the reader's zoom, background and layout choice, which a remount
         per selection would reset under them. A new selection reaches it as another `init`. -->
    <div class="stage-pane">
        <AnimationApp bridge={viewerBridge} />
    </div>
{/if}
</div>
