<script lang="ts">
    import Checkbox from "../../../webview-ui/Checkbox.svelte";
    import type { Background } from "../render/indexed-to-rgba";
    // Continuous fractional zoom. The ladder lives beside the auto-zoom that has to respect it, so the
    // control and the automatic choice cannot disagree about the range - see render/tile.ts.
    import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, ZOOM_STEP } from "../render/tile";

    const BACKGROUND_OPTIONS: { value: Background; label: string }[] = [
        { value: "transparent", label: "Transparent" },
        { value: "checkered", label: "Checkered" },
        { value: "green", label: "Green" },
    ];

    function isPreset(preset: number): boolean {
        return Math.abs(zoom - preset) < 0.001;
    }

    function clampZoom(z: number): number {
        return Math.min(Math.max(z, ZOOM_MIN), zoomCeiling);
    }

    /** Persisted subset of the view choices, read/written through `vscode.getState()`/`setState()`. */
    interface PersistedViewState {
        zoom: number;
        background: Background;
    }

    const {
        zoom,
        fillZoom,
        background,
        showOffsetMarker,
        onZoomChange,
        onBackgroundChange,
        onToggleOffsetMarker,
        viewState,
    }: {
        zoom: number;
        /** The scale at which the drawn animation fills its tile - what the Auto button sets. */
        fillZoom: number;
        background: Background;
        showOffsetMarker: boolean;
        onZoomChange: (zoom: number) => void;
        onBackgroundChange: (background: Background) => void;
        onToggleOffsetMarker: () => void;
        viewState?: { get: () => unknown; set: (state: unknown) => void };
    } = $props();

    /**
     * The scale at which the sprite fills its tile, which is above the ladder's top for any creature small
     * against the tile it stands in. So the slider's top is the fill point rather than a constant: a
     * control that cannot represent the value it is showing would snap the reader's choice back on the
     * next drag.
     */
    const fill = $derived(Math.max(ZOOM_MIN, fillZoom));
    const zoomCeiling = $derived(Math.max(ZOOM_MAX, fill));
    const isAuto = $derived(Math.abs(zoom - fill) < 0.001);

    function isRecord(v: unknown): v is Record<string, unknown> {
        return typeof v === "object" && v !== null;
    }

    function isBackground(v: unknown): v is Background {
        return v === "transparent" || v === "checkered" || v === "green";
    }

    // Hydrate from persisted vscode state once on mount - an external-system read, not derived state -
    // so a reload or a hidden/re-shown panel keeps the last zoom/background choice.
    $effect(() => {
        const persisted = viewState?.get();
        if (!isRecord(persisted)) return;
        // The animation opening fits the sprite itself, so a restored zoom only holds until then; it is
        // the backdrop this is really keeping across a reload.
        if (typeof persisted.zoom === "number") onZoomChange(clampZoom(persisted.zoom));
        if (isBackground(persisted.background)) onBackgroundChange(persisted.background);
    });

    function persist(next: PersistedViewState): void {
        viewState?.set(next);
    }

    function handleZoomChange(next: number): void {
        onZoomChange(next);
        persist({ zoom: next, background });
    }

    function handleBackgroundChange(next: Background): void {
        onBackgroundChange(next);
        persist({ zoom, background: next });
    }
</script>

<div class="view-controls" role="group" aria-label="View options">
    <label class="view-field">
        <span class="view-label">Zoom</span>
        <input
            type="range"
            min={ZOOM_MIN}
            max={zoomCeiling}
            step={ZOOM_STEP}
            value={zoom}
            oninput={(e) => handleZoomChange(clampZoom(Number(e.currentTarget.value)))}
            aria-label="Zoom level"
        />
        <span class="view-value">{Math.round(zoom * 100)}%</span>
    </label>
    <div class="view-field zoom-presets" role="group" aria-label="Zoom presets">
        {#each ZOOM_PRESETS as preset (preset)}
            <button
                type="button"
                class="bg-option"
                class:active={isPreset(preset)}
                aria-pressed={isPreset(preset)}
                onclick={() => handleZoomChange(preset)}
            >
                {Math.round(preset * 100)}%
            </button>
        {/each}
        <button
            type="button"
            class="bg-option"
            class:active={isAuto}
            aria-pressed={isAuto}
            title="Largest scale at which the whole animation still fits its tile - what a view opens at, and what it returns to on every switch"
            onclick={() => handleZoomChange(fill)}
        >
            Auto
        </button>
    </div>
    <div class="view-field" role="radiogroup" aria-label="Background">
        <span class="view-label">Background</span>
        <div class="bg-options">
            {#each BACKGROUND_OPTIONS as opt (opt.value)}
                <button
                    type="button"
                    class="bg-option"
                    class:active={background === opt.value}
                    aria-pressed={background === opt.value}
                    onclick={() => handleBackgroundChange(opt.value)}
                >
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>
    <Checkbox
        label="Offset marker"
        checked={showOffsetMarker}
        onchange={onToggleOffsetMarker}
        title="Show a crosshair at each frame's anchor point - the offset origin the frame is positioned from in the preview"
    />
</div>
