<script lang="ts">
    import type { Background } from "../render/indexed-to-rgba";

    const BACKGROUND_OPTIONS: { value: Background; label: string }[] = [
        { value: "transparent", label: "Transparent" },
        { value: "checkered", label: "Checkered" },
        { value: "green", label: "Green" },
    ];
    const ZOOM_OPTIONS = [1, 2, 3, 4, 6, 8];

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
        if (typeof persisted.zoom === "number") onZoomChange(persisted.zoom);
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
        <select value={zoom} onchange={(e) => handleZoomChange(Number(e.currentTarget.value))} aria-label="Zoom level">
            {#each ZOOM_OPTIONS as z (z)}
                <option value={z}>{z}x</option>
            {/each}
        </select>
    </label>
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
                    title={opt.label}
                >
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>
    <label class="view-field view-checkbox">
        <input type="checkbox" checked={showOffsetMarker} onchange={onToggleOffsetMarker} />
        <span class="view-label">Offset marker</span>
    </label>
</div>
