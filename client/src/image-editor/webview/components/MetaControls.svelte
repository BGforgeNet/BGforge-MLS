<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView } from "../messages";
    import type { DirectionLayout } from "@bgforge/image";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    const DIRECTION_LAYOUT_OPTIONS: { value: DirectionLayout; label: string }[] = [
        { value: "frm6", label: "FRM6 (6 directions)" },
        { value: "ie8", label: "IE8 (8 directions)" },
        { value: "non-directional", label: "Non-directional" },
    ];

    function isDirectionLayout(v: string): v is DirectionLayout {
        return v === "frm6" || v === "ie8" || v === "non-directional";
    }
</script>

<div class="meta-controls" role="group" aria-label="Metadata">
    {#if view.sourceFormat === "frm"}
        <label class="meta-field">
            <span class="meta-label">FPS</span>
            <input
                type="number"
                min="1"
                max="60"
                step="1"
                value={view.meta.fps ?? 10}
                onchange={(e) => {
                    const next = Number(e.currentTarget.value);
                    if (Number.isFinite(next) && next > 0) bridge.send({ type: "editMeta", patch: { fps: next } });
                }}
                aria-label="Frames per second"
            />
        </label>
        <label class="meta-field" title="Marks the action frame in playback">
            <span class="meta-label">Action frame</span>
            <input
                type="number"
                min="0"
                step="1"
                value={view.meta.actionFrame ?? 0}
                onchange={(e) => {
                    const next = Number(e.currentTarget.value);
                    if (Number.isFinite(next) && next >= 0) {
                        bridge.send({ type: "editMeta", patch: { actionFrame: next } });
                    }
                }}
                aria-label="Action frame"
            />
        </label>
        <label
            class="meta-field meta-checkbox"
            title={view.hasSidecarPal
                ? "Render with the sidecar .pal palette instead of the default Fallout palette"
                : "Disabled: no sidecar .pal file found next to this .frm"}
        >
            <input
                type="checkbox"
                checked={view.externalPaletteActive}
                disabled={!view.hasSidecarPal}
                onchange={(e) => bridge.send({ type: "setExternalPalette", enabled: e.currentTarget.checked })}
            />
            <span class="meta-label">Use external palette</span>
        </label>
    {:else}
        <label
            class="meta-field"
            title="Palette index drawn as transparent - pixels with this index show the background instead of a colour"
        >
            <span class="meta-label">Transparent index</span>
            <input
                type="number"
                min="0"
                max="255"
                step="1"
                value={view.meta.transparentIndex ?? 0}
                onchange={(e) => {
                    const next = Number(e.currentTarget.value);
                    if (Number.isFinite(next) && next >= 0 && next <= 255) {
                        bridge.send({ type: "editMeta", patch: { transparentIndex: next } });
                    }
                }}
                aria-label="Transparent palette index"
            />
        </label>
        <label
            class="meta-field"
            title="Declared direction layout, saved with the animation (kept in PNG-directory manifests). BAM cycles carry no direction info, so you declare it here; 'IE8' also opens the preview in the compass-rose layout."
        >
            <span class="meta-label">Direction layout</span>
            <select
                value={view.meta.directionLayout ?? "non-directional"}
                onchange={(e) => {
                    const next = e.currentTarget.value;
                    if (isDirectionLayout(next)) bridge.send({ type: "editMeta", patch: { directionLayout: next } });
                }}
                aria-label="Direction layout"
            >
                {#each DIRECTION_LAYOUT_OPTIONS as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                {/each}
            </select>
        </label>
    {/if}
</div>
