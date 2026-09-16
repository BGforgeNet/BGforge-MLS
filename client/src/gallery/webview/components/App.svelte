<script lang="ts">
    import { matchesTag, resourceTags } from "../../resource-tags";
    import { filterTiles } from "../grid-window";
    import { type GalleryTile, type HostToWebview, type SetTile, type WebviewToHost } from "../messages";
    import { type GalleryTab, resolveTab, showTabStrip, viewerMounted } from "../tabs";
    import BetaNotice from "../../../webview-ui/BetaNotice.svelte";
    import { isHostMessage } from "../../../webview-utils";
    import Grid from "./Grid.svelte";
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
    /**
     * The host's resource list and its animation sets. Raw, not deep: both are wire payloads replaced
     * wholesale by `init`, and an install's list runs to five figures - deep state would put a proxy trap
     * and a signal read behind every field of every tile, which the filter chain below re-reads per
     * keystroke.
     */
    let items: GalleryTile[] = $state.raw([]);
    let sets: SetTile[] = $state.raw([]);
    let note: string | undefined = $state();
    /** Whether the empty list is empty for want of an open game, which the panel can offer to fix. */
    let noGameOpen = $state(false);
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
    const hasSets = $derived(sets.length > 0);

    const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

    function onMessage(event: MessageEvent<HostToWebview>): void {
        if (!isHostMessage(event)) return;
        const message = event.data;
        if (message.type === "init") {
            title = message.title;
            items = message.items;
            sets = message.sets;
            note = message.note;
            noGameOpen = message.noGameOpen === true;
            focusSet = message.focusSet;
            // A restored panel can ask for a tab this source cannot fill; resolveTab decides, not the
            // stored value. A panel opened ON an animation asks for the sets tab.
            tab = resolveTab(message.focusSet === undefined ? tab : "sets", message.sets.length > 0);
            loaded = true;
            return;
        }
        if (message.type === "showing") {
            // Whether the SURFACE is up, which is not the same as something being drawn on it: the sets
            // tab mounts it empty. Keyed on `showing` alone, the first choice on that tab looked like a
            // mount, the ready went unsent, and the host never answered with the contents - an idle
            // surface that stayed idle.
            const mounted = viewerMounted(tab, showing !== undefined);
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
<!-- Choosing what to draw is a bar across the top; everything below it is the animation editor as its own
     tab draws it. The controls keep their place and their width whatever is on the stage, so picking
     something moves nothing that the reader is still using to pick with. -->
<div class="controls">
<div class="bb-notice-bar"><BetaNotice /></div>
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
{:else}
    <!-- A fixture of this tab, not a state of it: drawn from the moment the tab opens and keeping its
         place afterwards, holding no value until one is chosen. The drawn surface's own column carries no
         set row here, so this is the one place a set is chosen. -->
    <SetPicker {sets} current={showing?.set} onChoose={(id) => post({ type: "showSet", id })} />
    {#if focusSet !== undefined && !sets.some((set) => set.id === focusSet)}
        <p class="facetnone">This install has no animation {hex(focusSet)}.</p>
    {/if}
{/if}
</div>
{#if tab === "files"}
    {#if loaded && items.length === 0}
        <!-- The empty state says what is missing; where the missing thing is an open game, it also supplies
             it, rather than naming a command the reader has to go and find. -->
        <p class="empty">{note ?? "No drawable resources here."}</p>
        {#if noGameOpen}
            <p class="empty-action">
                <button type="button" onclick={() => post({ type: "openGame" })}>Open game...</button>
            </p>
        {/if}
    {:else}
        <!-- The file grid stays reachable while something is drawn - it is how the next file is chosen -
             so it keeps a band of its own rather than being replaced by the stage. -->
        <div class="browse-grid">
            <Grid
                tiles={shown}
                {thumbnails}
                {directional}
                {tileSize}
                {ladder}
                onOpen={(id) => post({ type: "open", id })}
                onNeed={(ids, size) => post({ type: "requestThumbnails", ids, size })}
            />
        </div>
    {/if}
{/if}
{#if viewerMounted(tab, showing !== undefined)}
    <!-- Mounted once and kept: it holds the reader's zoom, background and layout choice, which a remount
         per selection would reset under them. A new selection reaches it as another `init`.

         Not gated on something being drawn: the sets tab IS this surface, so it draws its whole self from
         the moment the tab opens and the picker above it chooses what goes on the stage. Gating it left
         the tab bare until a set was chosen, which is the cut-down preview this panel exists not to be. -->
    <div class="stage-pane">
        <!-- The set's controls answer to the tab, not to what happens to be drawn: a reader who has moved
             to the file list is not choosing an animation set, and a set left on the stage behind them
             should not keep offering its own pickers there. -->
        <AnimationApp
            bridge={viewerBridge}
            showSet={tab === "sets"}
            showSetChoice={false}
            idle={showing === undefined}
            showNotice={false}
        />
    </div>
{/if}
</div>
