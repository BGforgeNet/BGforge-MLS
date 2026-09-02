<script lang="ts">
    import { tick as svelteTick } from "svelte";
    import type { Bridge } from "../state/bridge";
    import { framePixels, type AnimationView } from "../messages";
    import { checkerboardCss, GREEN, type Background } from "../render/indexed-to-rgba";
    import { createPlayback, tick, type PlaybackState } from "../render/playback";
    import { ieRoseTiles, layoutSequences, type GridTile, type LayoutMode, type RoseTile } from "../render/compass-layout";
    import { interpretIeDirections } from "@bgforge/image/ie-direction";
    import { analyzeCycleGrid, ieGroupLabels } from "../render/cycle-grouping";
    import { describeAnimationName } from "../render/naming";
    import { tileSizePx } from "../render/anchor";
    import { autoZoomLevel, TILE_BASE_PX } from "../render/tile";
    import { framesToRequest, seedLoadedPixels } from "../render/frame-loading";
    import { DEFAULT_INIT_TIMEOUT_MS, installInitTimeout, type InitWait } from "../../../webview-utils";
    import CompassRose from "./CompassRose.svelte";
    import CycleGrid from "./CycleGrid.svelte";
    import CycleLayoutControls from "./CycleLayoutControls.svelte";
    import LayoutModeControls from "./LayoutModeControls.svelte";
    import MetaControls from "./MetaControls.svelte";
    import PlaybackControls from "./PlaybackControls.svelte";
    import Toolbar from "./Toolbar.svelte";
    import ViewControls from "./ViewControls.svelte";

    const {
        bridge,
        viewState,
    }: {
        bridge: Bridge;
        viewState?: { get: () => unknown; set: (state: unknown) => void };
    } = $props();

    let view = $state<AnimationView | null>(null);
    let errorMessage = $state<string | undefined>();
    // If the host never posts "init" (a dropped/failed open), surface it rather than sit on
    // "Loading..." forever. Timer mechanics shared with the binary/dialog editors' App.svelte
    // via installInitTimeout (webview-utils.ts).
    let initTimedOut = $state(false);
    let initWait: InitWait | undefined;
    /** Pixels delivered so far, by frame index. Replaced wholesale per batch (see the message handler). */
    let loadedPixels = $state(new Map<number, Uint8Array>());
    /**
     * Frame indices already asked for, so a re-render never re-requests one in flight.
     *
     * Deliberately unbounded - no deadline, no retry. An index is never removed, so a reply that never
     * arrived would strand its frame; the panel is registered without `retainContextWhenHidden`, so the
     * only way to miss one is a post to a hidden webview, and showing it again reloads this bundle and
     * reseeds both maps from a fresh `init`.
     */
    let requestedFrames = new Set<number>();

    let playback = $state<PlaybackState | null>(null);
    // eslint-disable-next-line prefer-const -- reassigned via onZoomChange in the ViewControls markup
    let zoom = $state(1);
    // eslint-disable-next-line prefer-const -- reassigned via onBackgroundChange in the ViewControls markup
    let background = $state<Background>("transparent");
    // Backdrop is PER TILE (each frame keeps its own checkered/green square), delivered as a CSS
    // variable the tiles read (.frame-tile-bg) instead of a prop threaded through every layout
    // component. The tile backdrops layer UNDER every sprite via z-index - see styles.css.
    const tileBackground = $derived(
        background === "checkered" ? checkerboardCss() : background === "green" ? GREEN : undefined,
    );
    // eslint-disable-next-line prefer-const -- reassigned via onToggleOffsetMarker in the ViewControls markup
    let showOffsetMarker = $state(false);
    // eslint-disable-next-line prefer-const -- assigned via bind:this in the markup
    let stageEl = $state<HTMLDivElement>();
    // Manual cycle-grid column count (0 = auto-wrap). Seeded per-view from the multi-sequence heuristic
    // (many cycles -> lay out as rows=sequences x columns=directions), then user-overridable.
    let cycleColumns = $state(0);
    let columnsSeededView: AnimationView | undefined;
    const cycleAnalysis = $derived(view ? analyzeCycleGrid(view.sequences.length) : undefined);
    // One tile footprint for the whole animation: stretched (never zoomed out) to fit the largest
    // anchored frame, so oversized sprites (e.g. talking heads) stay inside their tile.
    const tileBase = $derived(view ? tileSizePx(view) : TILE_BASE_PX);
    // Decoded filename meaning (critter/avatar naming schemes) - shown in a banner when a scheme matches.
    const nameMeaning = $derived(view ? describeAnimationName(view) : undefined);
    $effect(() => {
        const v = view;
        if (!v || v === columnsSeededView) return;
        columnsSeededView = v;
        cycleColumns = cycleAnalysis?.multiSequence ? cycleAnalysis.suggestedColumns : 0;
    });

    // Stage layout (rose vs grid). The default derives from tagged compass facings (FRM) or from
    // meta.directionLayout === "ie8" - which the BAM parser resolves via the same fingerprint the
    // interpretation uses - so a fresh open shows the detected choice; the selector writes
    // `layoutChoice`, which then wins for the webview's lifetime.
    const facingLayout = $derived(view ? layoutSequences(view) : null);
    const ieRose = $derived(view ? interpretIeDirections(view.sequences, view.frames.length) : undefined);
    const roseAvailable = $derived(facingLayout?.mode === "compass" || ieRose !== undefined);
    const defaultLayoutMode: LayoutMode = $derived(
        facingLayout?.mode === "compass" || (ieRose && view?.meta.directionLayout === "ie8") ? "rose" : "grid",
    );
    // eslint-disable-next-line prefer-const -- reassigned via onModeChange in the LayoutModeControls markup
    let layoutChoice = $state<LayoutMode | undefined>();
    const layoutMode = $derived.by((): LayoutMode => {
        const choice = layoutChoice ?? defaultLayoutMode;
        // A sticky "rose" choice can outlive rose-ability (e.g. an import replaced the animation).
        return choice === "rose" && !roseAvailable ? "grid" : choice;
    });
    // IE rose only: which direction block the rose shows. Clamped, not reset, when the view shrinks.
    // eslint-disable-next-line prefer-const -- reassigned via onGroupChange in the LayoutModeControls markup
    let roseGroup = $state(0);
    const roseGroupCount = $derived(facingLayout?.mode === "compass" ? 0 : (ieRose?.groups.length ?? 0));
    const roseGroupLabels = $derived(
        view && roseGroupCount > 1 ? ieGroupLabels(view.basename, roseGroupCount) : undefined,
    );
    const clampedRoseGroup = $derived(Math.min(roseGroup, Math.max(0, roseGroupCount - 1)));
    const roseTiles = $derived.by((): RoseTile[] => {
        if (!view) return [];
        if (facingLayout?.mode === "compass") return facingLayout.tiles;
        return ieRose ? ieRoseTiles(view, ieRose, clampedRoseGroup) : [];
    });
    const gridTiles = $derived.by((): GridTile[] => {
        if (!view) return [];
        // The grid branch keeps layoutSequences' special cases (single-orientation FRM collapse); a
        // compass-capable view forced to grid shows every sequence, labeled by its facing.
        if (facingLayout?.mode === "grid") return facingLayout.tiles;
        return view.sequences.map((seq, index) => ({ seq, index }));
    });

    $effect(() => {
        return bridge.onMessage((m) => {
            // Any word from the host restarts the deadline: it bounds SILENCE, not slowness, and a
            // large animation legitimately takes longer than the whole budget to arrive.
            // `loading` needs no branch of its own - arriving IS its whole effect, above.
            initWait?.bump();
            if (m.type === "init") {
                view = m.view;
                // A refresh replaces the document's frames, so anything cached is stale.
                loadedPixels = seedLoadedPixels(m.view);
                requestedFrames = new Set(loadedPixels.keys());
                errorMessage = undefined;
            } else if (m.type === "frames") {
                const next = new Map(loadedPixels);
                for (const [at, index] of m.indices.entries()) {
                    const frame = m.frames[at];
                    const bytes = frame && framePixels(m.pixels, frame);
                    if (bytes) next.set(index, bytes);
                }
                // One reassignment per batch, never per frame: $state does not proxy a Map, so the
                // view only re-renders on the replacement.
                loadedPixels = next;
            } else if (m.type === "error") {
                errorMessage = m.message;
            }
        });
    });

    $effect(() => {
        const wait = installInitTimeout({
            ms: DEFAULT_INIT_TIMEOUT_MS,
            isResolved: () => view !== null,
            onTimeout: () => {
                initTimedOut = true;
            },
        });
        initWait = wait;
        return wait.cancel;
    });

    // Progress over the tiles ON SCREEN, not over every frame in the file: with lazy delivery the
    // file's own total never reaches 100% unless the user plays every cycle through, which would read
    // as a load that never finishes.
    const tileCount = $derived(view?.sequences.length ?? 0);
    const tilesAwaitingPixels = $derived.by(() => {
        if (!view || !playback) return 0;
        const frame = playback.frame;
        return view.sequences.filter((sequence) => {
            const ref = sequence.frameRefs[Math.min(frame, sequence.frameRefs.length - 1)];
            return ref !== undefined && !loadedPixels.has(ref);
        }).length;
    });

    // The open carries only each cycle's first frame, so this is what fills in the rest as playback
    // advances.
    $effect(() => {
        if (!view || !playback) return;
        const wanted = framesToRequest(view.sequences, playback.frame, requestedFrames);
        if (wanted.length > 0) bridge.send({ type: "requestFrames", indices: wanted });
    });

    // The whole rose steps on ONE shared timeline: a single requestAnimationFrame loop advances one
    // `playback.frame` that every tile reads, rather than each tile keeping its own timer. This effect
    // reads only `view` synchronously (the null-check), never `playback` - the per-tick frame writes
    // inside `tick` happen asynchronously and so never re-trigger (and restart) this effect.
    $effect(() => {
        if (!view) return;
        const frameCount = Math.max(0, ...view.sequences.map((seq) => seq.frameRefs.length));
        playback = createPlayback({ frameCount, fps: view.meta.fps ?? 0 });

        let raf: number;
        let lastTime: number | undefined;
        // `leftover` carries the sub-frame remainder between ticks: a ~16ms rAF delta floors to 0 whole
        // frames at any realistic fps, so discarding it (resetting the clock each tick) would stall
        // playback entirely - the bug that made Play do nothing. See playback.tick.
        let leftover = 0;
        const onFrame = (now: number): void => {
            if (lastTime !== undefined && playback) {
                const stepped = tick(playback, leftover + (now - lastTime));
                playback = stepped.state;
                leftover = stepped.leftoverMs;
            }
            lastTime = now;
            raf = requestAnimationFrame(onFrame);
        };
        raf = requestAnimationFrame(onFrame);

        return () => cancelAnimationFrame(raf);
    });

    // Auto-zoom on open: size for the largest FRAME (sprite legibility), bounded so the whole composite
    // layout still fits the stage - see autoZoomLevel in render/tile.ts. Runs once per opened view, and
    // only while zoom is still the default 1 - a restored or user-chosen zoom is left alone. Reads only
    // `view`, never `playback`, so a per-frame playback write can't re-trigger it.
    const AUTO_ZOOM_CAP = 4; // top zoom preset - see ViewControls ZOOM_MAX
    let autoZoomedView: AnimationView | undefined;
    $effect(() => {
        const v = view;
        if (v && v !== autoZoomedView) void applyAutoZoom(v);
    });
    async function applyAutoZoom(v: AnimationView): Promise<void> {
        // Wait for the stage content to render and for ViewControls' persisted-zoom hydration to settle.
        await svelteTick();
        if (view !== v || !stageEl) return;
        const content = stageEl.firstElementChild;
        // The stage's own padding is part of clientWidth/Height but not available to content.
        const stageStyle = getComputedStyle(stageEl);
        const availW = stageEl.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
        const availH = stageEl.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
        // Not laid out yet (e.g. opened in a hidden tab): leave unmarked so a later view can retry.
        if (!(content instanceof HTMLElement) || availW <= 0 || availH <= 0) return;
        autoZoomedView = v;
        if (zoom !== 1) return; // a persisted or user-chosen zoom wins
        const box = content.getBoundingClientRect(); // measured at zoom 1; both dims scale with zoom
        const z = autoZoomLevel({
            maxFrameW: Math.max(0, ...v.frames.map((f) => f.width)),
            maxFrameH: Math.max(0, ...v.frames.map((f) => f.height)),
            contentW: box.width,
            contentH: box.height,
            availW,
            availH,
            cap: AUTO_ZOOM_CAP,
        });
        if (z !== 1) zoom = z;
    }
</script>

{#if errorMessage}
    <div class="error-state">
        <h2>Could not open file</h2>
        <p>{errorMessage}</p>
    </div>
{:else if !view}
    {#if initTimedOut}
        <div class="error-state">
            <h2>No response from the host</h2>
            <p>
                Nothing from the host for {DEFAULT_INIT_TIMEOUT_MS / 1000}s. Check the "BGforge MLS" output channel.
            </p>
        </div>
    {:else}
        <p class="placeholder">Loading...</p>
    {/if}
{:else}
    {#if nameMeaning}
        <header class="name-banner">
            <span class="name-banner-file">{view.basename}</span>
            <span class="name-banner-meaning">{nameMeaning}</span>
        </header>
    {/if}
    <!-- Stage (the player) fills the main area; view/metadata/playback stack in a column on the right;
         the save/import bar spans the bottom. -->
    <div class="editor-layout">
        <div class="stage" bind:this={stageEl} style:--tile-bg={tileBackground}>
            {#if playback}
                {#if layoutMode === "rose"}
                    <CompassRose
                        {view}
                        {loadedPixels}
                        tiles={roseTiles}
                        frame={playback.frame}
                        {zoom}
                        {tileBase}
                        {showOffsetMarker}
                    />
                {:else}
                    <CycleGrid
                        {view}
                        {loadedPixels}
                        tiles={gridTiles}
                        frame={playback.frame}
                        {zoom}
                        {tileBase}
                        {showOffsetMarker}
                        columns={cycleColumns}
                    />
                {/if}
            {/if}
            {#if tilesAwaitingPixels > 0}
                <p class="frame-progress" aria-live="polite">
                    Loading frames {tileCount - tilesAwaitingPixels}/{tileCount}
                </p>
            {/if}
        </div>
        <aside class="controls-column">
            <ViewControls
                {zoom}
                {background}
                {showOffsetMarker}
                onZoomChange={(z) => (zoom = z)}
                onBackgroundChange={(b) => (background = b)}
                onToggleOffsetMarker={() => (showOffsetMarker = !showOffsetMarker)}
                {viewState}
            />
            {#if roseAvailable}
                <LayoutModeControls
                    mode={layoutMode}
                    onModeChange={(m) => (layoutChoice = m)}
                    groupCount={roseGroupCount}
                    group={clampedRoseGroup}
                    groupLabels={roseGroupLabels}
                    onGroupChange={(g) => (roseGroup = g)}
                />
            {/if}
            <MetaControls {view} {bridge} />
            {#if layoutMode === "grid" && cycleAnalysis?.multiSequence}
                <CycleLayoutControls
                    cycleCount={view.sequences.length}
                    suggestedColumns={cycleAnalysis.suggestedColumns}
                    columns={cycleColumns}
                    onColumnsChange={(c) => (cycleColumns = c)}
                />
            {/if}
            {#if playback}
                <PlaybackControls state={playback} onChange={(next) => (playback = next)} />
            {/if}
        </aside>
    </div>
    <Toolbar {view} {bridge} />
{/if}
