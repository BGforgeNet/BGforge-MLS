<script lang="ts">
    import { tick as svelteTick, untrack } from "svelte";
    import type { Bridge } from "../state/bridge";
    import {
        framePixels,
        type AnimationView,
        type SavePlanView,
        type SaveRequestView,
        type SaveAsSetupView,
        type CreatureOption,
    } from "../messages";
    import { checkerboardCss, GREEN, type Background } from "../render/indexed-to-rgba";
    import {
        createPlayback,
        cycleFrameIndex,
        IDLE_PLAYBACK,
        setFrame,
        tick,
        timelineFrameCount,
        type PlaybackState,
    } from "../render/playback";
    import {
        defaultLayoutMode,
        directionBlocks,
        drawnSequences,
        firstDrawnBlock,
        ieRoseTiles,
        layoutSequences,
        type GridTile,
        type LayoutMode,
        type RoseTile,
    } from "../render/compass-layout";
    import { analyzeCycleGrid } from "../render/cycle-grouping";
    import { ieGroups } from "@bgforge/animation/group-labels";
    import { describeAnimationName } from "../render/naming";
    import { animationFacts } from "../render/animation-facts";
    import { DEFAULT_TILE_BOX, spriteFillRatio, tileBoxPx } from "../render/anchor";
    import {
        autoZoom,
        fitZoomByMeasuring,
        focusScroll,
        spriteScaleRatio,
        zoomSubject,
        ZOOM_MAX,
        ZOOM_MIN,
    } from "../render/tile";
    import { framesToRequest, seedLoadedPixels } from "../render/frame-loading";
    import { DEFAULT_INIT_TIMEOUT_MS, installInitTimeout, type InitWait } from "../../../webview-utils";
    import BetaNotice from "../../../webview-ui/BetaNotice.svelte";
    import CompassRose from "./CompassRose.svelte";
    import CycleGrid from "./CycleGrid.svelte";
    import CycleLayoutControls from "./CycleLayoutControls.svelte";
    import LayoutModeControls from "./LayoutModeControls.svelte";
    import SaveAsDialog from "./SaveAsDialog.svelte";
    import CreatureControls from "./CreatureControls.svelte";
    import SetControls from "./SetControls.svelte";
    import MetaControls from "./MetaControls.svelte";
    import PlaybackControls from "./PlaybackControls.svelte";
    import Toolbar from "./Toolbar.svelte";
    import ViewControls from "./ViewControls.svelte";

    const {
        bridge,
        viewState,
        showSet,
        showSetChoice,
        idle,
        showNotice,
    }: {
        bridge: Bridge;
        viewState?: { get: () => unknown; set: (state: unknown) => void };
        /**
         * Whether the set's own controls belong on screen. False where the surrounding surface has moved
         * the reader on to something else - the gallery's file tab - and the set is still drawn only
         * because nothing has replaced it yet.
         */
        showSet?: boolean;
        /**
         * Whether choosing the SET belongs in this column. False where the surface around it carries its
         * own set picker, which would otherwise be the same choice offered twice.
         */
        showSetChoice?: boolean;
        /**
         * Whether nothing is chosen YET, as opposed to something being on its way.
         *
         * The surface draws its whole self either way - controls, stage and toolbar keep their places from
         * the moment the tab opens, so choosing a set moves nothing the reader was using to choose with.
         * Without this the two states are indistinguishable from here and an empty tab reads as a hang:
         * the loading placeholder below is for a set that IS coming.
         */
        idle?: boolean;
        /** Whether this surface draws the beta notice. False inside the gallery, whose own top bar carries it. */
        showNotice?: boolean;
    } = $props();

    /**
     * The open document, as the host sent it. Raw, not deep: this is a wire payload that is only ever
     * REPLACED - an init, a refresh, a palette swap - never written into, so per-field reactivity buys
     * nothing and costs a proxy trap plus a signal read on every access to its 256-entry palette and its
     * frame table. The pixel loop reads the palette per pixel, which turned those traps into the dominant
     * cost of playback.
     */
    let view = $state.raw<AnimationView | null>(null);
    let errorMessage = $state<string | undefined>();
    /**
     * The install's creatures, once asked for; the resref currently drawn in, if any.
     *
     * Raw: a host payload replaced wholesale, and an install ships thousands of them.
     */
    let creatures = $state.raw<CreatureOption[]>([]);
    let activeCreature = $state<string | undefined>();
    /**
     * The Save As dialog: whether it is up, the defaults the host answered with, and its plan for the
     * chosen layout. Both payloads raw for the same reason as the view above - host payloads, replaced,
     * never written into.
     */
    let saveAsOpen = $state(false);
    let saveAsSetup = $state.raw<SaveAsSetupView | undefined>();
    let savePlan = $state.raw<SavePlanView | undefined>();
    let saveFolder = $state.raw<string | undefined>();
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

    /**
     * The transport's state. Raw: every transition returns a NEW state (render/playback.ts), so nothing
     * writes into it - and the frame index is read once per tile per step, where a proxy trap is a cost
     * paid at the frame rate.
     */
    let playback = $state.raw<PlaybackState | null>(null);
    // eslint-disable-next-line prefer-const -- reassigned via onZoomChange in the ViewControls markup
    // Two independent scales. `layoutScale` sizes the CELL GRID and is fitted to the stage automatically;
    // `zoom` scales the ART inside those cells, so raising it grows sprites in place rather than growing
    // the whole layout off the stage, which is what left a small creature unreadable.
    let layoutScale = $state(1);
    // Whatever it is last set to: by Auto, by a preset, by the slider, or by a freshly opened animation.
    // Nothing else writes it, which is what makes it survive a change of action or sequence.
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
    let groupSeededView: AnimationView | undefined;

    // Stage layout (rose vs grid). A fresh open shows the default the file's structure implies; the
    // selector writes `layoutChoice`, which then wins for the webview's lifetime.
    const facingLayout = $derived(view ? layoutSequences(view) : null);
    // The set's declared band width where the install states one, so a wide-band animation is not read as
    // twice as many stances at half the facings; a file opened on its own has only its block structure.
    const ieRose = $derived(view ? directionBlocks(view, view.set?.bands) : undefined);
    const roseAvailable = $derived(facingLayout?.mode === "compass" || ieRose !== undefined);
    const defaultMode: LayoutMode = $derived(defaultLayoutMode(facingLayout, ieRose));
    // Seeded from the interpretation's block size, so the flat grid falls into rows=sequences x
    // columns=directions with whichever stride the file actually uses.
    const cycleAnalysis = $derived(view ? analyzeCycleGrid(view.sequences.length, ieRose?.scheme) : undefined);
    // Decoded filename meaning (critter/avatar naming schemes) - shown in a banner when a scheme
    // matches. The block scheme and count go in too: some name families are only readable under one of
    // them, and none of them reads a file that packs several blocks, whose meaning is per block.
    const nameMeaning = $derived(
        view
            ? describeAnimationName({ ...view, scheme: ieRose?.scheme, blocks: ieRose?.groups.length })
            : undefined,
    );
    // The structural facts beside that meaning: direction count, whether the file stores them all, how
    // many files were combined, and the family the install declares. Read off the same resolved block
    // reading the rose uses, so the header and the stage cannot disagree about the scheme.
    const facts = $derived(view ? animationFacts({ view, blocks: ieRose }) : []);

    /**
     * Open the set's Save As dialog, asking the host for the name and id defaults it opens on.
     *
     * Asked on every open, because the answer is the OPEN SET's own stem and a free id beside its own -
     * both change with the set. The dialog decides for itself whether to seed from the answer, so a
     * reader's own typing survives reopening while a change of set does not.
     */
    function openSaveAs(): void {
        bridge.send({ type: "beginSaveAs" });
        saveAsOpen = true;
    }
    $effect(() => {
        const v = view;
        if (!v || v === columnsSeededView) return;
        columnsSeededView = v;
        cycleColumns = cycleAnalysis?.multiSequence ? cycleAnalysis.suggestedColumns : 0;
    });
    // eslint-disable-next-line prefer-const -- reassigned via onModeChange in the LayoutModeControls markup
    let layoutChoice = $state<LayoutMode | undefined>();
    const layoutMode = $derived.by((): LayoutMode => {
        const choice = layoutChoice ?? defaultMode;
        // A sticky "rose" choice can outlive rose-ability (e.g. an import replaced the animation).
        return choice === "rose" && !roseAvailable ? "grid" : choice;
    });
    // IE rose only: which direction block the rose shows. Clamped, not reset, when the view shrinks.
    // eslint-disable-next-line prefer-const -- reassigned via onGroupChange in the LayoutModeControls markup
    let roseGroup = $state(0);
    const roseGroupCount = $derived(facingLayout?.mode === "compass" ? 0 : (ieRose?.groups.length ?? 0));
    // The scheme's own reading of this file's blocks, where one matched: what names them below, and what
    // says which of them the scheme addresses no sequence to.
    const roseBlockNames = $derived(
        view && roseGroupCount > 1
            ? ieGroups(view.basename, roseGroupCount, ieRose?.scheme, view.set?.section)
            : undefined,
    );
    // Which block a newly opened animation lands on: the first that draws, not block 0 (firstDrawnBlock).
    const firstDrawnGroup = $derived(view && ieRose ? firstDrawnBlock(view, ieRose, roseBlockNames) : 0);
    $effect(() => {
        const v = view;
        const seed = firstDrawnGroup;
        if (!v || v === groupSeededView) return;
        groupSeededView = v;
        roseGroup = seed;
    });
    /**
     * Which band is on the stage.
     *
     * A SET answers this from its stance picker, which spans the set's files and so already names the
     * band - a second control here would be the same choice asked twice, and the two could disagree. A
     * lone file has no such list, so it keeps its own block picker below.
     */
    const setDrivesBand = $derived(view?.set !== undefined);
    const drawnBand = $derived(view?.set?.band ?? roseGroup);
    /** Whether the open stance is its band drawn back to front - a get-up shares the dying band. */
    const reversed = $derived(view?.set?.reversed === true);
    const offeredGroupCount = $derived(setDrivesBand ? 0 : roseGroupCount);
    const clampedRoseGroup = $derived(Math.min(drawnBand, Math.max(0, roseGroupCount - 1)));
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
    // What is ON SCREEN: the transport is sized against these and frames are fetched for these, never for
    // the file's whole cycle list (compass-layout.drawnSequences).
    const drawnCycles = $derived(drawnSequences(layoutMode, roseTiles, gridTiles));
    // The scale at which the art exactly fills the base tile: what Auto asks for, what a freshly opened
    // animation is drawn at, and the point past which the tile has to grow to keep holding it.
    const fillRatio = $derived(view ? spriteFillRatio(view) : 1);
    /**
     * How many layout fits are searching. Counted, not flagged: a fit still unwinding must not clear the
     * one that replaced it. What a fit in flight does to the tile is `spriteScaleRatio`'s (render/tile.ts).
     */
    let fitsRunning = $state(0);
    // How large the reader is drawing the art relative to the cell the fit chose.
    const spriteRatio = $derived(spriteScaleRatio({ zoom, layoutScale, fillRatio, fitting: fitsRunning > 0 }));
    // One tile per ANIMATION - art centred in it at whatever scale it is drawn - so no switch of action or
    // sequence moves the tile, the anchor, or the picture's place in it. Past the fitted size the box
    // grows with the art, which is what spreads the tiles apart instead of letting sprites overlap.
    const tileBox = $derived(view ? tileBoxPx(view, spriteRatio) : DEFAULT_TILE_BOX);

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
            } else if (m.type === "creatures") {
                creatures = m.entries;
            } else if (m.type === "saveAsSetup") {
                saveAsSetup = m.setup;
            } else if (m.type === "savePlan") {
                savePlan = m.plan;
            } else if (m.type === "saveFolder") {
                // Only a folder that was actually picked lands: a dismissed picker leaves the one already
                // chosen alone rather than clearing it and disabling Save under the reader.
                if (m.path !== undefined) saveFolder = m.path;
            } else if (m.type === "palette") {
                // A whole replacement rather than an in-place palette write: the tiles read `view`, and a
                // mutation through the old object would not re-render them. Indexed views only - a BAM v2
                // has no palette to swap, and the host never offers one for it.
                if (view !== null && view.colorModel === "indexed") {
                    view = { ...view, palette: m.palette };
                    activeCreature = m.creature;
                }
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
    const tileCount = $derived(drawnCycles.length);
    const tilesAwaitingPixels = $derived.by(() => {
        if (!playback) return 0;
        const frame = playback.frame;
        return drawnCycles.filter((sequence) => {
            const ref = sequence.frameRefs[cycleFrameIndex(sequence.frameRefs.length, frame, reversed)];
            return ref !== undefined && !loadedPixels.has(ref);
        }).length;
    });

    // The open carries only each cycle's first frame, so this is what fills in the rest as playback
    // advances.
    $effect(() => {
        if (!playback) return;
        const wanted = framesToRequest(drawnCycles, playback.frame, requestedFrames, reversed);
        if (wanted.length > 0) bridge.send({ type: "requestFrames", indices: wanted });
    });

    // The whole rose steps on ONE shared timeline: a single requestAnimationFrame loop advances one
    // `playback.frame` that every tile reads, rather than each tile keeping its own timer. This effect
    // reads only `view` synchronously (the null-check), never `playback` - the per-tick frame writes
    // inside `tick` happen asynchronously and so never re-trigger (and restart) this effect.
    $effect(() => {
        if (!view) return;
        const frameCount = untrack(() => timelineFrameCount(drawnCycles));
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

    // Picking another direction block or layout changes what is drawn but not what is loaded, so the
    // transport is RESIZED rather than rebuilt: rebuilding it here would stop playback and rewind to
    // frame 0 every time the reader looked at another block.
    $effect(() => {
        const frameCount = timelineFrameCount(drawnCycles);
        untrack(() => {
            if (!playback || playback.frameCount === frameCount) return;
            playback = setFrame({ ...playback, frameCount }, playback.frame);
        });
    });

    /**
     * Two fits, on different triggers.
     *
     * The GRID is fitted whenever the arrangement changes - another direction block, or the other layout -
     * because that changes how many tiles are on the stage and nothing else can keep them on it. The
     * SPRITE is fitted only when a different animation opens: switching action or sequence leaves the
     * reader's zoom exactly where they left it, which is the whole point of a tile that does not move.
     *
     * The two are independent because a tile's size is the box times the layout scale and a canvas is
     * absolutely positioned inside it (animation-tiles.css) - so the sprite scale cannot change the
     * footprint the grid fit is measuring. Neither reads `playback`, so a per-frame write cannot
     * re-trigger them.
     */
    let zoomedSubject: string | undefined;
    let fittedArrangement: string | undefined;
    $effect(() => {
        const v = view;
        if (!v) return;
        const subject = zoomSubject(v);
        const arrangement = `${subject}#${drawnBand}@${layoutMode}`;
        if (arrangement !== fittedArrangement) void applyAutoZoom(v, subject, arrangement);
    });

    /**
     * Put the stage back on the art whenever the layout RESIZES.
     *
     * Scaled past the size its whole wheel fits at, a creature's layout is many times the stage, and the
     * stage stays wherever it was - which for a fresh rose is the origin, where a compass rose has nothing:
     * the reader gets blank space beside a sliver of one tile, and every stance looks alike there. Centring
     * the first tile keeps one whole facing on screen, so changing stance visibly changes the picture.
     *
     * Keyed on what MOVES the tiles - the animation, the band, the layout, and both scales - so a reader who
     * has scrolled somewhere keeps their position until one of those changes it out from under them anyway.
     */
    let centredFor: string | undefined;
    $effect(() => {
        const key = `${view?.basename ?? ""}#${drawnBand}@${layoutMode}:${zoom}:${layoutScale}`;
        const el = stageEl;
        if (!el || key === centredFor) return;
        centredFor = key;
        void svelteTick().then(() => {
            // The FIRST tile, whichever layout drew it: the rose orders its cells by the block's own slots,
            // so this is the same facing across a change of stance.
            const tile = el.querySelector(".frame-tile");
            if (!(tile instanceof HTMLElement)) return;
            // Measured against the STAGE's own scroll box, never the tile's offsetParent (a rose cell is
            // absolutely positioned, so every tile reports offset 0 inside it) and never the content
            // element's width (a rose wider than the stage is flex-shrunk while its cells overflow it).
            const box = tile.getBoundingClientRect();
            const stage = el.getBoundingClientRect();
            const at = focusScroll({
                focus: {
                    left: box.left - stage.left + el.scrollLeft,
                    top: box.top - stage.top + el.scrollTop,
                    width: box.width,
                    height: box.height,
                },
                viewport: { width: el.clientWidth, height: el.clientHeight },
                content: { width: el.scrollWidth, height: el.scrollHeight },
            });
            el.scrollLeft = at.left;
            el.scrollTop = at.top;
        });
    });
    async function applyAutoZoom(v: AnimationView, subject: string, arrangement: string): Promise<void> {
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
        fittedArrangement = arrangement;
        // Both callbacks go inert once the arrangement has moved on - a block or layout change replaces it
        // without replacing the view - so a search still unwinding cannot write a scale chosen for a
        // picture that has left the stage.
        const current = (): boolean => view === v && fittedArrangement === arrangement;
        // Claimed here rather than at entry: the caller re-enters until `fittedArrangement` is set, which
        // is only above, so a write before that point re-triggers the effect that made it and the runtime
        // kills the whole webview on the update-depth guard.
        fitsRunning++;
        try {
            const fitted = await fitZoomByMeasuring(
                ZOOM_MAX,
                ZOOM_MIN,
                async (next) => {
                    if (!current()) return;
                    layoutScale = next;
                    await svelteTick();
                },
                () => {
                    if (!current()) return true;
                    const now = content.getBoundingClientRect();
                    return now.width <= availW && now.height <= availH;
                },
            );
            if (!current() || subject === zoomedSubject) return;
            zoomedSubject = subject;
            zoom = autoZoom(fillRatio, fitted);
        } finally {
            fitsRunning--;
        }
    }
</script>

{#if errorMessage}
    <div class="error-state">
        <h2>Could not open file</h2>
        <p>{errorMessage}</p>
    </div>
{:else if !view && idle !== true}
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
    {#if showNotice !== false}
        <div class="bb-notice-bar"><BetaNotice /></div>
    {/if}
    <!-- Shown for every view, not only the ones whose name decodes: this sits ABOVE the stage, so a
         banner that came and went took 27px of stage height with it - and the stage's height is what the
         tile fit measures, so switching to a stance whose filename happens to decode resized every tile
         under the reader. The meaning is the part that varies; the file is always known. -->
    {#if view}
        <header class="name-banner">
            <span class="name-banner-file">{view.basename}</span>
            {#if nameMeaning}
                <span class="name-banner-meaning">{nameMeaning}</span>
            {/if}
            <!-- The structural facts, last and to the right: what the file IS, where the meaning above it
                 is what it depicts. Each one is a property the picture does not show - a combined base and
                 eastern twin is indistinguishable from a file that stored all eight facings itself. -->
            <span class="name-banner-facts">
                {#each facts as fact (fact.id)}
                    <span class="name-banner-fact" title={fact.title}>{fact.label}</span>
                {/each}
            </span>
        </header>
    {/if}
    <!-- Stage (the player) fills the main area; view/metadata/playback stack in a column on the right;
         the save/import bar spans the bottom. -->
    <div class="editor-layout">
        <div class="stage" bind:this={stageEl} style:--tile-bg={tileBackground}>
            {#if view && playback}
                {#if layoutMode === "rose"}
                    <CompassRose
                        {view}
                        {loadedPixels}
                        tiles={roseTiles}
                        frame={playback.frame}
                        {layoutScale}
                        spriteScale={zoom}
                        {tileBox}
                        {showOffsetMarker}
                    />
                {:else}
                    <CycleGrid
                        {view}
                        {loadedPixels}
                        tiles={gridTiles}
                        frame={playback.frame}
                        {layoutScale}
                        spriteScale={zoom}
                        {tileBox}
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
            {#if !view}
                <!-- The empty state says what belongs here rather than leaving the stage blank, and it
                     sits INSIDE the stage so the controls beside it keep their width and position. -->
                <p class="stage-empty">Choose an animation set to draw it here.</p>
            {/if}
        </div>
        <aside class="controls-column">
            {#if showSet !== false}
                <!-- First in the column: it selects WHAT is shown, where everything below it selects how. -->
                <SetControls
                    set={view?.set ?? null}
                    showChoice={showSetChoice !== false}
                    onArmourChange={(level) => bridge.send({ type: "selectSetArmour", level })}
                    onStanceChange={(key) => bridge.send({ type: "selectSetStance", key })}
                    onPickSet={() => bridge.send({ type: "pickSet" })}
                />
            {/if}
            <ViewControls
                {zoom}
                fillZoom={autoZoom(fillRatio, layoutScale)}
                {background}
                {showOffsetMarker}
                onZoomChange={(z) => (zoom = z)}
                onBackgroundChange={(b) => (background = b)}
                onToggleOffsetMarker={() => (showOffsetMarker = !showOffsetMarker)}
                {viewState}
            />
            {#if roseAvailable || !view}
                <LayoutModeControls
                    mode={layoutMode}
                    onModeChange={(m) => (layoutChoice = m)}
                    groupCount={offeredGroupCount}
                    group={clampedRoseGroup}
                    groupBlocks={roseBlockNames}
                    scheme={ieRose?.scheme}
                    onGroupChange={(g) => (roseGroup = g)}
                />
            {/if}
            {#if !view || (view.colorModel === "indexed" && view.sourceFormat !== "frm")}
                <CreatureControls
                    {creatures}
                    active={activeCreature}
                    onrequest={() => bridge.send({ type: "requestCreatures" })}
                    onchoose={(resref) => bridge.send({ type: "setCreature", resref })}
                />
            {/if}
            <MetaControls {view} {bridge} />
            <!-- Still gated on the model, unlike its neighbours: this one comes and goes with the LAYOUT
                 even when a set is loaded (grid mode, many cycles), so drawing it while idle would add a
                 control the loaded surface does not have - moving the column the other way. -->
            {#if view && layoutMode === "grid" && cycleAnalysis?.multiSequence}
                <CycleLayoutControls
                    cycleCount={view.sequences.length}
                    analysis={cycleAnalysis}
                    columns={cycleColumns}
                    onColumnsChange={(c) => (cycleColumns = c)}
                />
            {/if}
            <PlaybackControls state={playback ?? IDLE_PLAYBACK} onChange={(next) => (playback = next)} />
        </aside>
    </div>
    <Toolbar {view} {bridge} onSaveAs={openSaveAs} />
    <!-- A modal rather than a panel in the column: every set-scoped write asks for a destination and
         several ask for a naming family, a container and an id besides, so this is a decision rather than
         a setting to leave sitting beside the picture. -->
    {#if view?.set}
        <SaveAsDialog
            bind:open={saveAsOpen}
            set={view.set}
            setup={saveAsSetup}
            plan={savePlan}
            folder={saveFolder}
            onPlan={(request: SaveRequestView) => bridge.send({ type: "planSave", request })}
            onRun={(request: SaveRequestView) => bridge.send({ type: "runSave", request })}
            onChooseFolder={() => bridge.send({ type: "chooseSaveFolder" })}
        />
    {/if}
{/if}
