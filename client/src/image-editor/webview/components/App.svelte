<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView } from "../messages";
    import type { Background } from "../render/indexed-to-rgba";
    import { createPlayback, tick, type PlaybackState } from "../render/playback";
    import { layoutSequences } from "../render/compass-layout";
    import { DEFAULT_INIT_TIMEOUT_MS, installInitTimeout } from "../../../webview-utils";
    import CompassRose from "./CompassRose.svelte";
    import CycleGrid from "./CycleGrid.svelte";
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

    let playback = $state<PlaybackState | null>(null);
    // eslint-disable-next-line prefer-const -- reassigned via onZoomChange in the ViewControls markup
    let zoom = $state(1);
    // eslint-disable-next-line prefer-const -- reassigned via onBackgroundChange in the ViewControls markup
    let background = $state<Background>("transparent");
    // eslint-disable-next-line prefer-const -- reassigned via onToggleOffsetMarker in the ViewControls markup
    let showOffsetMarker = $state(false);

    $effect(() => {
        return bridge.onMessage((m) => {
            if (m.type === "init") {
                view = m.view;
                errorMessage = undefined;
            } else if (m.type === "error") {
                errorMessage = m.message;
            }
        });
    });

    $effect(() => {
        return installInitTimeout({
            ms: DEFAULT_INIT_TIMEOUT_MS,
            isResolved: () => view !== null,
            onTimeout: () => {
                initTimedOut = true;
            },
        });
    });

    // The whole rose steps on ONE shared timeline: a single requestAnimationFrame loop advances one
    // `playback.frame` that every tile reads, rather than each tile keeping its own timer. This effect
    // reads only `view` synchronously (the null-check), never `playback` - the per-tick frame writes
    // inside `tick` happen asynchronously and so never re-trigger (and restart) this effect.
    $effect(() => {
        if (!view) return;
        const frameCount = Math.max(0, ...view.sequences.map((seq) => seq.frameRefs.length));
        playback = createPlayback({ frameCount, fps: view.meta.fps ?? 10 });

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
                No response from the host within {DEFAULT_INIT_TIMEOUT_MS / 1000}s - the file did not open. Check the
                "BGforge MLS" output channel.
            </p>
        </div>
    {:else}
        <p class="placeholder">Loading...</p>
    {/if}
{:else}
    {@const layout = layoutSequences(view)}
    <!-- Stage (the player) fills the main area; view/metadata/playback stack in a column on the right;
         the save/import bar spans the bottom. -->
    <div class="editor-layout">
        <div class="stage">
            {#if playback}
                {#if layout.mode === "compass"}
                    <CompassRose {view} frame={playback.frame} {zoom} {background} {showOffsetMarker} />
                {:else}
                    <CycleGrid {view} frame={playback.frame} {zoom} {background} {showOffsetMarker} />
                {/if}
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
            <MetaControls {view} {bridge} />
            {#if playback}
                <PlaybackControls state={playback} onChange={(next) => (playback = next)} />
            {/if}
        </aside>
    </div>
    <Toolbar {view} {bridge} />
{/if}
