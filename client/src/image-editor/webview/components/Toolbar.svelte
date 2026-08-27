<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView, SaveAsTarget } from "../messages";
    import type { SourceFormat } from "@bgforge/image";
    import ActionMenu from "./ActionMenu.svelte";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    // "Save as" and "Import" are both ActionMenu dropdowns: picking an entry immediately runs the action
    // (host-side, auto-named next to the source). Every save format is offered EXCEPT the source's own
    // exact format - plain "Save" already writes that in place. FRM is split by palette mode (sidecar
    // writes a .pal, nearest remaps to the default Fallout palette). THREE different formats share the
    // .bam extension - v1, compressed v1 (BAMC) and v2 - so every label carries its version, and each is
    // its own target (a re-encode overwrites <base>.bam, which is intended).
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
        const bamUncompressed: SaveAsOption[] =
            source === "bam" ? [] : [{ value: "bam", label: "BAM v1", target: "bam" }];
        const bamCompressed: SaveAsOption[] =
            source === "bamc" ? [] : [{ value: "bamc", label: "BAMC v1 (compressed)", target: "bamc" }];
        // BAM v2 keeps true colour and per-pixel alpha, but writes its frames into separate
        // MOSxxxx.PVRZ files - the host asks which page number to start at when it needs new ones.
        const bamV2: SaveAsOption[] = source === "bamv2" ? [] : [{ value: "bamv2", label: "BAM v2", target: "bamv2" }];
        return [
            ...frmVariants,
            ...bamUncompressed,
            ...bamCompressed,
            ...bamV2,
            { value: "apng", label: "APNG", target: "apng" },
            { value: "png-directory", label: "PNG directory", target: "png-directory" },
        ];
    }

    const saveAsOptions = $derived(buildSaveAsOptions(view.sourceFormat));

    // Plain "Save" writes the source format back in place, so its tooltip names that format the same
    // way the "Save as" entries do - an upper-cased tag would read "BAMV2" and "BAMC".
    const SOURCE_FORMAT_LABEL = {
        frm: "FRM",
        bam: "BAM v1",
        bamc: "BAMC v1 (compressed)",
        bamv2: "BAM v2",
    } as const satisfies Record<SourceFormat, string>;

    // Import brings in a PNG directory's cycles, either replacing every current cycle or appending to them.
    const IMPORT_ITEMS = [
        {
            value: "replace",
            label: "Replace all cycles...",
            title: "Replace every cycle with an imported PNG directory (its folder or manifest.json)",
        },
        {
            value: "append",
            label: "Append cycles...",
            title: "Add an imported PNG directory's cycles after the existing ones",
        },
    ];

    function handleSave(): void {
        bridge.send({ type: "save" });
    }

    function chooseSaveAs(value: string): void {
        const option = saveAsOptions.find((o) => o.value === value);
        if (!option) return;
        if (option.paletteMode) {
            bridge.send({ type: "saveAs", target: option.target, paletteMode: option.paletteMode });
        } else {
            bridge.send({ type: "saveAs", target: option.target });
        }
    }

    function chooseImport(value: string): void {
        if (value === "replace" || value === "append") bridge.send({ type: "import", mode: value });
    }
</script>

<div class="toolbar">
    <button type="button" onclick={handleSave} title={`Save in place as ${SOURCE_FORMAT_LABEL[view.sourceFormat]}`}>
        Save
    </button>
    <ActionMenu
        label="Save as..."
        ariaLabel="Save as"
        items={saveAsOptions.map((o) => ({ value: o.value, label: o.label }))}
        onselect={chooseSaveAs}
    />
    <ActionMenu
        label="Import PNG directory..."
        ariaLabel="Import PNG directory"
        items={IMPORT_ITEMS}
        onselect={chooseImport}
    />
</div>
