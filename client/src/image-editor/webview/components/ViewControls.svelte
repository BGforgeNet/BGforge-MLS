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
        /** The scale at which the drawn animation exactly fills its cell - what the Fill button sets. */
        fillZoom: number;
        background: Background;
        showOffsetMarker: boolean;
        onZoomChange: (zoom: number) => void;
        onBackgroundChange: (background: Background) => void;
        onToggleOffsetMarker: () => void;
        viewState?: { get: () => unknown; set: (state: unknown) => void };
    } = $props();

    /**
     * The scale at which the sprite exactly fills its cell, which is above the ladder's top wherever the
     * cell has room to spare - a small creature's cell is floored at a size several times its art. So the
     * slider's top is the fill point rather than a constant: a control that cannot represent the value it
     * is showing would snap the reader's own choice back on the next drag.
     */
    const fill = $derived(Math.max(ZOOM_MIN, fillZoom));
    const zoomCeiling = $derived(Math.max(ZOOM_MAX, fill));
    const isFill = $derived(Math.abs(zoom - fill) < 0.001);

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
            class:active={isFill}
            aria-pressed={isFill}
            title="Largest scale at which the whole animation still fits its tile - off the pixel-exact ladder"
            onclick={() => handleZoomChange(fill)}
        >
            Fill
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
