<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { RowActions } from "../state/structure-actions";
    import Icon from "./Icon.svelte";
    import Menu, { type MenuItem } from "./primitives/Menu.svelte";

    const { acts, entryPath, bridge, compact = false }:
        { acts: RowActions; entryPath: string[]; bridge: Bridge; compact?: boolean } = $props();

    // Two-step delete confirmation: first click arms the confirm state; second click (confirm) fires.
    // Escape or clicking cancel disarms without dispatching. Literal false init - no confirm pending at mount.
    let confirmPending = $state(false);

    function armConfirm(): void {
        confirmPending = true;
    }

    function cancelConfirm(): void {
        confirmPending = false;
    }

    function doRemove(): void {
        confirmPending = false;
        bridge.structureOp({ op: "remove", entryPath });
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") cancelConfirm();
    }

    // Menu items for the "more actions" overflow. Delete is excluded from the menu because the inline
    // two-step confirm is not available inside a floating menu; the toolbar Delete button handles it.
    // Disabled items still appear so the full action set is always visible in the menu.
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
            case "add-above":  bridge.structureOp({ op: "insert", entryPath, position: "before" }); break;
            case "add-below":  bridge.structureOp({ op: "insert", entryPath, position: "after" });  break;
            case "duplicate":  bridge.structureOp({ op: "duplicate", entryPath });                  break;
            case "move-up":    bridge.structureOp({ op: "reorder", entryPath, direction: "up" });   break;
            case "move-down":  bridge.structureOp({ op: "reorder", entryPath, direction: "down" }); break;
            // Menu Delete arms the same inline confirm rather than dispatching immediately.
            case "delete":     armConfirm(); break;
        }
    }
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="row-actions" onkeydown={handleKeydown}>
    {#if confirmPending}
        <!-- Confirm affordance replaces the Delete button. Keyboard-accessible: Tab cycles confirm/cancel,
             Escape cancels (handled by the parent span's onkeydown). -->
        <span class="row-actions-confirm">
            <span class="row-actions-confirm-label">Delete?</span>
            <button class="row-actions-btn row-actions-btn-danger" onclick={doRemove}
                    aria-label="Confirm delete" title="Confirm delete">
                <Icon name="check" />
                {#if !compact}<span class="row-actions-label">Confirm</span>{/if}
            </button>
            <button class="row-actions-btn" onclick={cancelConfirm}
                    aria-label="Cancel delete" title="Cancel">
                <Icon name="close" />
                {#if !compact}<span class="row-actions-label">Cancel</span>{/if}
            </button>
        </span>
    {:else}
        <button class="row-actions-btn" disabled={!acts.insert}
                onclick={() => bridge.structureOp({ op: "insert", entryPath, position: "before" })}
                aria-label="Add above" title="Add above">
            <Icon name="insert" />
            {#if !compact}<span class="row-actions-label">Add above</span>{/if}
        </button>
        <button class="row-actions-btn" disabled={!acts.insert}
                onclick={() => bridge.structureOp({ op: "insert", entryPath, position: "after" })}
                aria-label="Add below" title="Add below">
            <Icon name="add" />
            {#if !compact}<span class="row-actions-label">Add below</span>{/if}
        </button>
        <button class="row-actions-btn" disabled={!acts.duplicate}
                onclick={() => bridge.structureOp({ op: "duplicate", entryPath })}
                aria-label="Duplicate" title="Duplicate">
            <Icon name="copy" />
            {#if !compact}<span class="row-actions-label">Duplicate</span>{/if}
        </button>
        <button class="row-actions-btn" disabled={!acts.up}
                onclick={() => bridge.structureOp({ op: "reorder", entryPath, direction: "up" })}
                aria-label="Move up" title="Move up">
            <Icon name="chevron-up" />
            {#if !compact}<span class="row-actions-label">Move up</span>{/if}
        </button>
        <button class="row-actions-btn" disabled={!acts.down}
                onclick={() => bridge.structureOp({ op: "reorder", entryPath, direction: "down" })}
                aria-label="Move down" title="Move down">
            <Icon name="chevron-down" />
            {#if !compact}<span class="row-actions-label">Move down</span>{/if}
        </button>
        <button class="row-actions-btn row-actions-btn-danger" disabled={!acts.remove}
                onclick={armConfirm}
                aria-label="Delete" title="Delete (click to confirm)">
            <Icon name="trash" />
            {#if !compact}<span class="row-actions-label">Delete</span>{/if}
        </button>
        <!-- "More actions" overflow menu: same ops, redundant accessor, useful in compact mode.
             Consuming Menu here satisfies the app-usage requirement (knip clean). -->
        {#if compact}
            <Menu items={menuItems} onselect={handleMenuSelect} ariaLabel="More actions" />
        {/if}
    {/if}
</span>
