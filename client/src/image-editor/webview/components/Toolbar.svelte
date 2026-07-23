<script lang="ts">
    import { tick } from "svelte";
    import type { Bridge } from "../state/bridge";
    import type { AnimationView, SaveAsTarget } from "../messages";
    import type { SourceFormat } from "@bgforge/image";

    const { view, bridge }: { view: AnimationView; bridge: Bridge } = $props();

    // "Save as" is an ACTION menu: picking an entry immediately runs the save (auto-named next to
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

    // Hand-rolled menu, not a native <select>: a native select's popup always highlights its current
    // value, so the "Save as..." placeholder shows pre-selected the moment it opens. This menu opens
    // with nothing highlighted, and (toolbar sits at the bottom) drops upward.
    let saveAsOpen = $state(false);
    // eslint-disable-next-line prefer-const -- assigned via bind:this in the markup
    let saveAsRoot = $state<HTMLDivElement>();

    function menuItems(): HTMLButtonElement[] {
        return saveAsRoot ? [...saveAsRoot.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
    }
    function focusTrigger(): void {
        saveAsRoot?.querySelector<HTMLButtonElement>(".saveas-trigger")?.focus();
    }

    function openSaveAs(focusFirst: boolean): void {
        saveAsOpen = true;
        // Keyboard open (ArrowDown) moves focus into the menu; mouse open leaves nothing highlighted.
        if (focusFirst) void tick().then(() => menuItems()[0]?.focus());
    }
    function closeSaveAs(refocus: boolean): void {
        saveAsOpen = false;
        if (refocus) focusTrigger();
    }

    function chooseSaveAs(option: SaveAsOption): void {
        closeSaveAs(false);
        if (option.paletteMode) {
            bridge.send({ type: "saveAs", target: option.target, paletteMode: option.paletteMode });
        } else {
            bridge.send({ type: "saveAs", target: option.target });
        }
    }

    function onTriggerKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            openSaveAs(true);
        }
    }
    function onItemKeydown(event: KeyboardEvent): void {
        const items = menuItems();
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") {
            event.preventDefault();
            closeSaveAs(true);
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            items[Math.min(idx + 1, items.length - 1)]?.focus();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            items[Math.max(idx - 1, 0)]?.focus();
        } else if (event.key === "Tab") {
            closeSaveAs(false);
        }
    }
    function onWindowPointerDown(event: PointerEvent): void {
        if (saveAsOpen && saveAsRoot && !saveAsRoot.contains(event.target as Node)) closeSaveAs(false);
    }

    // eslint-disable-next-line prefer-const -- reassigned via the import-mode <select>'s onchange in the markup
    let importMode = $state<"replace" | "append">("replace");

    function handleSave(): void {
        bridge.send({ type: "save" });
    }
    function handleImport(): void {
        bridge.send({ type: "import", mode: importMode });
    }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="toolbar">
    <button type="button" onclick={handleSave} title={`Save in place as ${view.sourceFormat.toUpperCase()}`}>
        Save
    </button>
    <div class="saveas" bind:this={saveAsRoot}>
        <button
            type="button"
            class="saveas-trigger"
            aria-haspopup="menu"
            aria-expanded={saveAsOpen}
            onclick={() => (saveAsOpen ? closeSaveAs(false) : openSaveAs(false))}
            onkeydown={onTriggerKeydown}
        >
            Save as...
        </button>
        {#if saveAsOpen}
            <div class="saveas-menu" role="menu">
                {#each saveAsOptions as option (option.value)}
                    <button
                        type="button"
                        role="menuitem"
                        class="saveas-item"
                        onclick={() => chooseSaveAs(option)}
                        onkeydown={onItemKeydown}
                    >
                        {option.label}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
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
