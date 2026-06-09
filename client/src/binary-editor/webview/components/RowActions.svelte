<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { RowActions } from "../state/structure-actions";
    import Icon from "./Icon.svelte";
    import Menu, { type MenuItem } from "./primitives/Menu.svelte";

    const { acts, entryId, bridge, compact = false }:
        { acts: RowActions; entryId: string; bridge: Bridge; compact?: boolean } = $props();

    // Delete fires immediately - no confirm step. Removal is a single undoable edit (the host pushes it onto
    // the document undo stack), so a misclick is recovered with Ctrl+Z rather than gated behind a confirm.
    function doRemove(): void {
        bridge.structureOp({ op: "remove", entryId });
    }

    // Menu items for the compact-mode dropdown - the space-saving control that lists all six actions in a
    // tight inline row. Disabled items still appear so the full action set is shown.
    const menuItems = $derived<MenuItem[]>([
        { id: "add-above",  label: "Add above",  icon: "insert",     disabled: !acts.insert },
        { id: "add-below",  label: "Add below",  icon: "add",        disabled: !acts.insert },
        { id: "duplicate",  label: "Duplicate",  icon: "copy",       disabled: !acts.duplicate },
        { id: "move-up",    label: "Move up",    icon: "chevron-up", disabled: !acts.up },
        { id: "move-down",  label: "Move down",  icon: "chevron-down", disabled: !acts.down },
        { id: "delete",     label: "Delete",     icon: "trash",      disabled: !acts.remove, danger: true },
    ]);

    function handleMenuSelect(id: string): void {
        switch (id) {
            case "add-above":  bridge.structureOp({ op: "insert", entryId, position: "before" }); break;
            case "add-below":  bridge.structureOp({ op: "insert", entryId, position: "after" });  break;
            case "duplicate":  bridge.structureOp({ op: "duplicate", entryId });                  break;
            case "move-up":    bridge.structureOp({ op: "reorder", entryId, direction: "up" });   break;
            case "move-down":  bridge.structureOp({ op: "reorder", entryId, direction: "down" }); break;
            case "delete":     doRemove(); break;
        }
    }
</script>
<span class="row-actions">
    {#if compact}
        <!-- Compact (InlineList rows): the kebab dropdown is the space-saving control for a tight inline row.
             It is the ONLY control here - a single "More actions" affordance instead of six icon buttons.
             This template reference also keeps Menu consumed by app code (knip clean). -->
        <Menu items={menuItems} onselect={handleMenuSelect} ariaLabel="More actions" />
    {:else}
        <!-- Non-compact (detail-pane toolbar): six labeled icon buttons, no kebab (all actions are visible). -->
        <button class="row-actions-btn" disabled={!acts.insert}
                onclick={() => bridge.structureOp({ op: "insert", entryId, position: "before" })}
                aria-label="Add above" title="Add above">
            <Icon name="insert" />
            <span class="row-actions-label">Add above</span>
        </button>
        <button class="row-actions-btn" disabled={!acts.insert}
                onclick={() => bridge.structureOp({ op: "insert", entryId, position: "after" })}
                aria-label="Add below" title="Add below">
            <Icon name="add" />
            <span class="row-actions-label">Add below</span>
        </button>
        <button class="row-actions-btn" disabled={!acts.duplicate}
                onclick={() => bridge.structureOp({ op: "duplicate", entryId })}
                aria-label="Duplicate" title="Duplicate">
            <Icon name="copy" />
            <span class="row-actions-label">Duplicate</span>
        </button>
        <button class="row-actions-btn" disabled={!acts.up}
                onclick={() => bridge.structureOp({ op: "reorder", entryId, direction: "up" })}
                aria-label="Move up" title="Move up">
            <Icon name="chevron-up" />
            <span class="row-actions-label">Move up</span>
        </button>
        <button class="row-actions-btn" disabled={!acts.down}
                onclick={() => bridge.structureOp({ op: "reorder", entryId, direction: "down" })}
                aria-label="Move down" title="Move down">
            <Icon name="chevron-down" />
            <span class="row-actions-label">Move down</span>
        </button>
        <button class="row-actions-btn row-actions-btn-danger" disabled={!acts.remove}
                onclick={doRemove}
                aria-label="Delete" title="Delete (undo with Ctrl+Z)">
            <Icon name="trash" />
            <span class="row-actions-label">Delete</span>
        </button>
    {/if}
</span>
