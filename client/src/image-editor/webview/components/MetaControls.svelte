<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView } from "../messages";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    // No direction-layout control here: meta.directionLayout is RESOLVED at parse (the IE stride-8
    // fingerprint) and a BAM has no on-disk field for it, so a manual edit would silently not survive
    // save/reopen. The user-facing layout knob is the ephemeral Rose/Grid selector (LayoutModeControls).
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
        <!-- Absent, not disabled, for a true-colour document: the format has no palette, so a
             greyed-out control would still offer an edit that could never be represented. -->
        {#if view.colorModel === "indexed"}
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
        {/if}
    {:else if view.colorModel === "indexed"}
        <!-- A transparent INDEX is a palette concept: BAM v2 carries real per-pixel alpha instead,
             so there is no index to nominate and the control has nothing to act on. -->
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
    {/if}
</div>
