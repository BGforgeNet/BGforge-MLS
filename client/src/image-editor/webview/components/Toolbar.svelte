<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView, SaveAsTarget } from "../messages";
    import type { SourceFormat } from "@bgforge/image";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    // "Save as" is an ACTION dropdown: picking an entry immediately runs the save (auto-named next to
    // the source, host-side). FRM appears only as a target for a NON-FRM source, split by palette mode
    // (sidecar writes a .pal, nearest remaps to the default Fallout palette) - an FRM source already has
    // an FRM palette, so it needs neither, and in-place "Save" already covers same-format. Each format
    // is also skipped when it IS the source's own format (that is what the plain Save button does).
    interface SaveAsOption {
        value: string;
        label: string;
        target: SaveAsTarget;
        paletteMode?: "sidecar" | "nearest";
    }

    function buildSaveAsOptions(source: SourceFormat): SaveAsOption[] {
        const frmVariants: SaveAsOption[] =
            source === "frm"
                ? []
                : [
                      { value: "frm-sidecar", label: "FRM (sidecar palette)", target: "frm", paletteMode: "sidecar" },
                      { value: "frm-nearest", label: "FRM (nearest match)", target: "frm", paletteMode: "nearest" },
                  ];
        const bamVariant: SaveAsOption[] = source === "bam" ? [] : [{ value: "bam", label: "BAM", target: "bam" }];
        return [
            ...frmVariants,
            ...bamVariant,
            { value: "apng", label: "APNG", target: "apng" },
            { value: "png-directory", label: "PNG directory", target: "png-directory" },
        ];
    }

    const saveAsOptions = $derived(buildSaveAsOptions(view.sourceFormat));

    // Design choice: PNG-directory is the only import path (APNG is export/preview-only) - see the
    // "import" message note in ../messages.ts. With a single kind there is no kind selector.
    // eslint-disable-next-line prefer-const -- reassigned via the import-mode <select>'s onchange in the markup
    let importMode = $state<"replace" | "append">("replace");

    function handleSave(): void {
        bridge.send({ type: "save" });
    }

    function handleSaveAsSelect(event: Event): void {
        const select = event.currentTarget as HTMLSelectElement;
        const option = saveAsOptions.find((o) => o.value === select.value);
        select.value = ""; // reset to the "Save as..." placeholder so the same target can be picked again
        if (!option) return;
        if (option.paletteMode) {
            bridge.send({ type: "saveAs", target: option.target, paletteMode: option.paletteMode });
        } else {
            bridge.send({ type: "saveAs", target: option.target });
        }
    }

    function handleImport(): void {
        bridge.send({ type: "import", mode: importMode });
    }
</script>

<div class="toolbar">
    <button type="button" onclick={handleSave} title={`Save in place as ${view.sourceFormat.toUpperCase()}`}>
        Save
    </button>
    <select value="" onchange={handleSaveAsSelect} aria-label="Save as">
        <option value="" disabled selected>Save as...</option>
        {#each saveAsOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
        {/each}
    </select>
    <div class="toolbar-group" role="group" aria-label="Import">
        <span class="toolbar-label">Import</span>
        <select
            value={importMode}
            onchange={(e) => {
                const next = e.currentTarget.value;
                if (next === "replace" || next === "append") importMode = next;
            }}
            aria-label="Import mode"
        >
            <option value="replace">Replace</option>
            <option value="append">Append</option>
        </select>
        <button type="button" onclick={handleImport}>PNG directory...</button>
    </div>
</div>
