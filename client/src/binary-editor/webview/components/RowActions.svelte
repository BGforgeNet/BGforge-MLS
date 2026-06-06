<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { RowActions } from "../state/structure-actions";
    import Icon from "./Icon.svelte";
    import Menu, { type MenuItem } from "./primitives/Menu.svelte";

    const { acts, entryId, bridge, compact = false }:
        { acts: RowActions; entryId: string; bridge: Bridge; compact?: boolean } = $props();

    // Two-step delete confirmation: first click arms the confirm state; second click (confirm) fires.
    // Escape or clicking cancel disarms without dispatching. Literal false init - no confirm pending at mount.
    let confirmPending = $state(false);

    // ListSection reuses a SINGLE RowActions instance across selections - only the entryId prop changes
    // when the user picks a different entry. Svelte 5 does not reset local $state on prop change, so without
    // this effect an armed confirm would persist and Confirm would delete the NOW-selected entry (wrong-entry
    // data loss). entryId is a stable per-entry NodeId, so keying on it resets the confirm exactly when the
    // targeted entry changes.
    $effect(() => {
        void entryId; // reactive dependency: reset the pending confirm whenever the targeted entry changes
        confirmPending = false;
    });

    function armConfirm(): void {
        confirmPending = true;
    }

    function cancelConfirm(): void {
        confirmPending = false;
    }

    function doRemove(): void {
        confirmPending = false;
        bridge.structureOp({ op: "remove", entryId });
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape") cancelConfirm();
    }

    // Menu items for the compact-mode dropdown - the space-saving control that lists all six actions in a
    // tight inline row. Delete is included; selecting it arms the inline confirm (handleMenuSelect) rather
    // than dispatching, so removal stays gated. Disabled items still appear so the full action set is shown.
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
    {:else if compact}
        <!-- Compact (InlineList rows): the kebab dropdown is the space-saving control for a tight inline row.
             It is the ONLY control here - a single "More actions" affordance instead of six icon buttons.
             Menu "Delete" arms the inline confirm above (replacing the kebab) rather than dispatching, so
             confirm-on-delete still gates removal. This template reference also keeps Menu consumed by app
             code (knip clean). -->
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
                onclick={armConfirm}
                aria-label="Delete" title="Delete (click to confirm)">
            <Icon name="trash" />
            <span class="row-actions-label">Delete</span>
        </button>
    {/if}
</span>
