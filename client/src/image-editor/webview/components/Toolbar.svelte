<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView } from "../messages";
    import type { SourceFormat } from "@bgforge/image";
    import { buildSaveAsOptions } from "../save-as-options";
    import Menu from "../../../webview-ui/Menu.svelte";

    // Null while nothing is loaded: the bar keeps its place so choosing a set moves nothing above it.
    // Its buttons still press - each sends a message the host has no open document to act on - rather
    // than being greyed out, which is the shape the surface asked for.
    const {
        view,
        bridge,
        onSaveAs,
    }: { view: AnimationView | null; bridge: Bridge; onSaveAs: () => void } = $props();

    // "Save as" is two controls, because the two documents ask different amounts. A single FILE gets a
    // menu: every entry is a one-click write with nothing further to ask. A SET gets a button that opens a
    // dialog: every set-scoped write goes into a folder the reader chooses and several need a naming
    // family, a container and an id besides, so a menu of them would be a list that all opens the same
    // questions. "Import" stays a menu on both, its two entries differing only in where the cycles land.
    const isSet = $derived(view?.set !== undefined);
    const saveAsOptions = $derived(buildSaveAsOptions(view?.sourceFormat ?? null));

    // Plain "Save" writes the source format back in place, so its tooltip names that format the same
    // way the "Save as" entries do - an upper-cased tag would read "BAMV2" and "BAMC".
    const SOURCE_FORMAT_LABEL = {
        frm: "FRM",
        bam: "BAM v1",
        bamc: "BAMC v1 (compressed)",
        bamv2: "BAM v2",
    } as const satisfies Record<SourceFormat, string>;

    // A set's Save is not one file in one format: it writes back the members the reader has changed, each
    // in the encoding it was read in, so naming the open member's format here would describe the wrong
    // thing - and the "Save as" entries beside it now say "every file of this set".
    const saveTitle = $derived.by(() => {
        if (view === null) return "Save in place";
        if (view.set !== undefined) return "Save the members you have changed back into the game";
        return `Save in place as ${SOURCE_FORMAT_LABEL[view.sourceFormat]}`;
    });

    // Import brings in an exported folder's cycles, either replacing every current cycle or appending to
    // them. One folder, two shapes: a single animation's directory applies to what is open, an exported
    // SET applies across every member it names.
    const IMPORT_ITEMS = [
        {
            value: "replace",
            label: "Replace all cycles...",
            title: "Replace every cycle from an exported folder (a PNG directory, or a whole exported set)",
        },
        {
            value: "append",
            label: "Append cycles...",
            title: "Add an exported folder's cycles after the existing ones",
        },
    ];

    function handleSave(): void {
        bridge.send({ type: "save" });
    }

    function chooseSaveAs(value: string): void {
        const option = saveAsOptions.find((o) => o.value === value);
        if (option === undefined) return;
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
    <button type="button" onclick={handleSave} title={saveTitle}>
        Save
    </button>
    {#if isSet}
        <button type="button" onclick={onSaveAs} title="Write every file of this set somewhere else">
            Save as...
        </button>
    {:else}
        <Menu
            ariaLabel="Save as"
            side="top"
            items={saveAsOptions.map((o) => ({ id: o.value, label: o.label, ...(o.title ? { title: o.title } : {}) }))}
            onselect={chooseSaveAs}
        >
            {#snippet trigger()}Save as...{/snippet}
        </Menu>
    {/if}
    <Menu
        ariaLabel="Import an exported folder"
        side="top"
        items={IMPORT_ITEMS.map((i) => ({ id: i.value, label: i.label, title: i.title }))}
        onselect={chooseImport}
    >
        {#snippet trigger()}Import...{/snippet}
    </Menu>
</div>
