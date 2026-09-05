<script lang="ts">
    import type { AnimationView } from "../../../image-editor/webview/messages";
    import CompassRose from "../../../image-editor/webview/components/CompassRose.svelte";
    import CycleGrid from "../../../image-editor/webview/components/CycleGrid.svelte";
    import { type RoseTile, roseTilesForSlots } from "../../../image-editor/webview/render/compass-layout";
    import { seedLoadedPixels } from "../../../image-editor/webview/render/frame-loading";
    import { type SetDetail } from "../messages";

    interface Props {
        detail: SetDetail;
        /** The animation for the selected stance, once the host has answered for it. */
        animation: AnimationView | undefined;
        stance: number;
        onStance: (stance: number) => void;
        onArmour: (armour: number) => void;
        onBack: () => void;
        onOpenResref: (resref: string) => void;
        /** Hand the whole set to the animation editor, which is where it can be edited and saved. */
        onOpenSet: (id: number) => void;
    }

    const { detail, animation, stance, onStance, onArmour, onBack, onOpenResref, onOpenSet }: Props = $props();

    /**
     * Tile size, and the width past which a rose stops fitting.
     *
     * A rose lays its tiles out at true compass angles, so its box is a multiple of the tile - and a large
     * creature's frames are several hundred pixels each. Past this the page falls back to the flat grid the
     * image editor already offers for the same reason, rather than drawing a rose that overflows the panel.
     */
    const TILE_BASE = 96;
    const ROSE_MAX_TILE = 220;
    /** Breathing room around a grid cell's sprite, so neighbours cannot touch. */
    const TILE_GAP = 12;

    const selected = $derived(detail.stances[stance]);

    /**
     * Frame pixels, by frame index.
     *
     * The whole stance arrives in one message, so there is nothing to fetch on demand here - unlike the
     * image editor, which opens on one frame per cycle and fills the rest in as playback reaches them.
     */
    const loadedPixels = $derived(
        animation === undefined ? new Map<number, Uint8Array>() : seedLoadedPixels(animation),
    );

    /**
     * The stance's cycles as rose tiles.
     *
     * Built from the band the HOST resolved rather than from the file's own cycle order: which cycles form
     * one stance follows the animation's declared type, which a lone file does not state.
     */
    const tiles = $derived<RoseTile[]>(
        animation === undefined || selected === undefined ? [] : roseTilesForSlots(animation, selected.slots),
    );

    /** The largest frame this stance draws - what decides whether a rose still fits. */
    const widest = $derived(
        animation === undefined ? 0 : Math.max(0, ...animation.frames.map((frame) => Math.max(frame.width, frame.height))),
    );
    const roseFits = $derived(widest > 0 && widest <= ROSE_MAX_TILE);

    /**
     * Cell size for the grid fallback.
     *
     * Sized to the frames rather than fixed: the fallback exists BECAUSE the creature is large, so a cell
     * at the rose's tile size is exactly the case where neighbours overlap and bury each other's labels.
     * The rose keeps the fixed size - its radius is a multiple of it, and growing that is what pushed the
     * layout past fitting in the first place.
     */
    const gridTile = $derived(Math.max(TILE_BASE, widest + TILE_GAP));

    /**
     * Scale for the grid fallback, so a stance's facings stay a readable row rather than a long scroll.
     *
     * A composed sprite is several hundred pixels a side, and a stance is up to nine of them - drawn at
     * true size the pane shows one facing and the reader has to scroll to compare. Capping the CELL at
     * the rose's own tile size keeps both layouts the same size on screen; the sprite scales with it,
     * since the cell footprint is `tileBase * zoom`.
     */
    const gridZoom = $derived(Math.min(1, ROSE_MAX_TILE / gridTile));

    /** Playback holds one frame index shared across every tile; each clamps to its own length. */
    let frame = $state(0);
    let playing = $state(true);
    const longest = $derived(Math.max(1, ...tiles.map((tile) => tile.seq.frameRefs.length)));

    $effect(() => {
        if (!playing || longest <= 1) return;
        // The engine plays BAM at a fixed rate; the model resolves it at parse rather than storing one.
        const fps = animation?.meta.fps ?? 15;
        const timer = setInterval(() => (frame = (frame + 1) % longest), 1000 / fps);
        return () => clearInterval(timer);
    });

    // Restart at the first frame when the stance changes, so a short stance does not open mid-way through.
    $effect(() => {
        void stance;
        frame = 0;
    });
</script>

<div class="setviewer">
    <div class="setviewerbar">
        <button type="button" class="setback" onclick={onBack}>
            <span class="codicon codicon-arrow-left" aria-hidden="true"></span>
            Animations
        </button>
        <span class="setviewertitle">{detail.title}</span>
        <span class="setviewerid">0x{detail.id.toString(16).padStart(4, "0")}</span>
        {#if detail.armours.length > 1}
            <label class="setarmour">
                <span>Armour</span>
                <select
                    value={String(detail.armour)}
                    onchange={(e) => onArmour(Number(e.currentTarget.value))}
                    aria-label="Armour level"
                >
                    {#each detail.armours as level (level)}
                        <option value={String(level)}>{level}</option>
                    {/each}
                </select>
            </label>
        {/if}
        <button
            type="button"
            class="setedit"
            title="Open every action of this set in the animation editor"
            onclick={() => onOpenSet(detail.id)}
        >
            <span class="codicon codicon-go-to-file" aria-hidden="true"></span>
            Open set in editor
        </button>
        {#if longest > 1}
            <button
                type="button"
                class="setplay"
                aria-pressed={playing}
                title={playing ? "Pause" : "Play"}
                onclick={() => (playing = !playing)}
            >
                <span class="codicon codicon-{playing ? 'debug-pause' : 'play'}" aria-hidden="true"></span>
            </button>
        {/if}
    </div>

    {#if detail.stances.length === 0}
        <p class="empty">{detail.note ?? "Nothing to draw for this animation."}</p>
    {:else}
        <div class="setviewerbody">
            <ul class="stancelist" role="listbox" aria-label="Stances">
                {#each detail.stances as row, i (`${row.resref}/${row.band}`)}
                    <li>
                        <button
                            type="button"
                            class="stancerow"
                            class:stanceactive={i === stance}
                            role="option"
                            aria-selected={i === stance}
                            onclick={() => onStance(i)}
                        >
                            <span class="stancename">{row.label}</span>
                            <span class="stancefacings">{row.slots.length}</span>
                        </button>
                    </li>
                {/each}
            </ul>

            <div class="stancepane">
                <div class="stancestage">
                {#if animation === undefined}
                    <p class="empty">Loading {selected?.label ?? "stance"}...</p>
                {:else if tiles.length === 0}
                    <p class="empty">This stance stores no drawable facings.</p>
                {:else if roseFits}
                    <CompassRose
                        view={animation}
                        {loadedPixels}
                        {tiles}
                        {frame}
                        zoom={1}
                        tileBase={TILE_BASE}
                    />
                {:else}
                    <!-- Too large to tile on a wheel: the same flat grid the image editor falls back to,
                         so an oversized creature is still fully visible rather than clipped. `columns={0}`
                         wraps instead of pinning a count - these tiles are one stance's facings in order,
                         not a sequences-by-directions matrix, and a fixed count sized for a large creature
                         runs off the panel edge. -->
                    <CycleGrid
                        view={animation}
                        {loadedPixels}
                        tiles={tiles.map((tile, index) => ({ seq: tile.seq, index, facing: tile.facing }))}
                        {frame}
                        zoom={gridZoom}
                        columns={0}
                        tileBase={gridTile}
                    />
                {/if}
                </div>
                {#if selected}
                    <p class="stancefile">
                        <span>{selected.resref}.BAM</span>
                        {#if selected.parts.length > 1}
                            <!-- Say the picture is assembled: otherwise the named file looks like the
                                 whole of it, and "Open in editor" then shows only a quarter. -->
                            <span
                                class="stanceparts"
                                title={selected.parts.map((part) => `${part}.BAM`).join(", ")}
                            >
                                composed of {selected.parts.length} files
                            </span>
                        {/if}
                        <button type="button" class="facetopen" onclick={() => onOpenResref(selected.resref)}>
                            Open in editor
                        </button>
                    </p>
                {/if}
            </div>
        </div>
    {/if}
</div>
