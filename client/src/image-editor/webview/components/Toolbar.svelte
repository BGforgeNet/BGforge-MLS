<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView, ImportKind, SaveAsTarget } from "../messages";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    const SAVE_AS_OPTIONS: { value: SaveAsTarget; label: string }[] = [
        { value: "frm", label: "FRM" },
        { value: "bam", label: "BAM" },
        { value: "apng", label: "APNG" },
        { value: "png-directory", label: "PNG directory" },
    ];
    const IMPORT_KIND_OPTIONS: { value: ImportKind; label: string }[] = [
        { value: "png-directory", label: "PNG directory" },
        { value: "apng", label: "APNG" },
    ];

    // eslint-disable-next-line prefer-const -- reassigned via the target <select>'s onchange in the markup
    let saveTarget = $state<SaveAsTarget>("frm");
    // eslint-disable-next-line prefer-const -- reassigned via the palette-mode <select>'s onchange in the markup
    let paletteMode = $state<"sidecar" | "nearest">("sidecar");
    // eslint-disable-next-line prefer-const -- reassigned via the import-kind <select>'s onchange in the markup
    let importKind = $state<ImportKind>("png-directory");
    // eslint-disable-next-line prefer-const -- reassigned via the import-mode <select>'s onchange in the markup
    let importMode = $state<"replace" | "append">("replace");

    function isSaveAsTarget(v: string): v is SaveAsTarget {
        return v === "frm" || v === "bam" || v === "apng" || v === "png-directory";
    }

    function isImportKind(v: string): v is ImportKind {
        return v === "png-directory" || v === "apng";
    }

    // "nearest" (palette remap) only applies when converting TOWARD FRM's single fixed palette;
    // every other target keeps the source palette as-is, so paletteMode is FRM-only on the wire.
    function handleSaveAs(): void {
        if (saveTarget === "frm") {
            bridge.send({ type: "saveAs", target: "frm", paletteMode });
        } else {
            bridge.send({ type: "saveAs", target: saveTarget });
        }
    }

    function handleImport(): void {
        bridge.send({ type: "import", kind: importKind, mode: importMode });
    }
</script>

<div class="toolbar">
    <div class="toolbar-group" role="group" aria-label={`Save ${view.basename} as`}>
        <span class="toolbar-label">Save as</span>
        <select
            value={saveTarget}
            onchange={(e) => {
                const next = e.currentTarget.value;
                if (isSaveAsTarget(next)) saveTarget = next;
            }}
            aria-label="Save as target"
        >
            {#each SAVE_AS_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
            {/each}
        </select>
        {#if saveTarget === "frm"}
            <select
                value={paletteMode}
                onchange={(e) => {
                    const next = e.currentTarget.value;
                    if (next === "sidecar" || next === "nearest") paletteMode = next;
                }}
                aria-label="Palette mode"
            >
                <option value="sidecar">Sidecar palette</option>
                <option value="nearest">Nearest match</option>
            </select>
        {/if}
        <button type="button" onclick={handleSaveAs}>Save As</button>
    </div>
    <div class="toolbar-group" role="group" aria-label="Import">
        <span class="toolbar-label">Import</span>
        <select
            value={importKind}
            onchange={(e) => {
                const next = e.currentTarget.value;
                if (isImportKind(next)) importKind = next;
            }}
            aria-label="Import kind"
        >
            {#each IMPORT_KIND_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
            {/each}
        </select>
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
        <button type="button" onclick={handleImport}>Import</button>
    </div>
</div>
