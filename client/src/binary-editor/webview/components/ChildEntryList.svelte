<script lang="ts">
    // An owner-scoped child collection rendered as an editable mini-list inside an entry's detail (e.g. a MAP
    // object's nested inventory). Each child entry is a row with a remove (x); clicking a row expands its full
    // form (quantity + the nested item's fields) via the same FormSection the auto-form uses. The header carries
    // the add affordance. Add/remove route through the generic owner-scoped addChild / removeChild ops, keyed by
    // the child's 0-based position among the owner's matching entry groups.
    import type { Diagnostic, LayoutChildList, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import FormSection from "./FormSection.svelte";
    import Icon from "./Icon.svelte";

    const { ownerId, childList, bridge, version, onedit, byNode }: {
        ownerId: NodeId;
        childList: LayoutChildList;
        bridge: Bridge;
        version: number;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
    } = $props();

    let entries = $state<Row[]>([]);
    // eslint-disable-next-line prefer-const -- reassigned by the row toggle and the validity guard
    let selectedId = $state<NodeId | undefined>();

    $effect(() => {
        void version; // a bump re-fetches after a structure op rebuilds the model
        let cancelled = false;
        // Inventories are small (a handful of items); 1000 covers every real owner.
        bridge.requestChildren(ownerId, 0, 1000).then((w) => {
            if (cancelled) return;
            entries = w.rows.filter((r) => r.name.startsWith(childList.entryPrefix));
            // Drop a selection whose entry no longer exists (e.g. it was just removed).
            if (selectedId !== undefined && !entries.some((e) => e.id === selectedId)) selectedId = undefined;
        });
        return () => { cancelled = true; };
    });

    const rowLabel = (r: Row): string => r.summary ?? r.name;
    const addEntry = (): void =>
        bridge.structureOp({ op: "addChild", entryId: ownerId, childSection: childList.childSection });
    const removeEntry = (index: number): void =>
        bridge.structureOp({ op: "removeChild", entryId: ownerId, childSection: childList.childSection, childIndex: index });
    const toggle = (id: NodeId): void => { selectedId = selectedId === id ? undefined : id; };
</script>
<div class="child-list">
    <div class="child-list-head">
        <span class="child-list-title">{childList.title}</span>
        <button class="child-list-add" onclick={addEntry}><Icon name="add" /> {childList.addLabel}</button>
    </div>
    {#if entries.length === 0}
        <p class="child-list-empty">Empty</p>
    {:else}
        <div class="child-list-rows">
            {#each entries as entry, i (entry.id)}
                <div class="child-row" class:selected={entry.id === selectedId}>
                    <button class="child-row-label" onclick={() => toggle(entry.id)}
                            aria-expanded={entry.id === selectedId}>
                        <Icon name={entry.id === selectedId ? "chevron-down" : "chevron-right"} />
                        <span>{rowLabel(entry)}</span>
                    </button>
                    <button class="child-row-remove" aria-label="Remove {childList.title} entry" title="Remove"
                            onclick={() => removeEntry(i)}><Icon name="close" /></button>
                </div>
                {#if entry.id === selectedId}
                    <div class="child-row-detail">
                        <FormSection nodeId={entry.id} {bridge} {version} {onedit} {byNode} />
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
