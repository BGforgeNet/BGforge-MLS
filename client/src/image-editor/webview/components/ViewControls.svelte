<script lang="ts">
    import type { Background } from "../render/indexed-to-rgba";

    const BACKGROUND_OPTIONS: { value: Background; label: string }[] = [
        { value: "transparent", label: "Transparent" },
        { value: "checkered", label: "Checkered" },
        { value: "green", label: "Green" },
    ];
    // Continuous fractional zoom, 50% - 400%. Step 0.05 = 5% increments.
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 4;
    const ZOOM_STEP = 0.05;
    const ZOOM_PRESETS = [0.5, 1, 2, 4]; // 50% / 100% / 200% / 400% - one-click common levels

    function isPreset(preset: number): boolean {
        return Math.abs(zoom - preset) < 0.001;
    }

    function clampZoom(z: number): number {
        return Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);
    }

    /** Persisted subset of the view choices, read/written through `vscode.getState()`/`setState()`. */
    interface PersistedViewState {
        zoom: number;
        background: Background;
    }

    const {
        zoom,
        background,
        showOffsetMarker,
        onZoomChange,
        onBackgroundChange,
        onToggleOffsetMarker,
        viewState,
    }: {
        zoom: number;
        background: Background;
        showOffsetMarker: boolean;
        onZoomChange: (zoom: number) => void;
        onBackgroundChange: (background: Background) => void;
        onToggleOffsetMarker: () => void;
        viewState?: { get: () => unknown; set: (state: unknown) => void };
    } = $props();

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
            max={ZOOM_MAX}
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
    <label
        class="view-field view-checkbox"
        title="Show a crosshair at each frame's anchor point - the offset origin the frame is positioned from in the preview"
    >
        <input type="checkbox" checked={showOffsetMarker} onchange={onToggleOffsetMarker} />
        <span class="view-label">Offset marker</span>
    </label>
</div>
