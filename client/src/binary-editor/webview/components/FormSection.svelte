<script lang="ts">
    import type { Diagnostic, NodeId, Row } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { ViewModel } from "../state/view-model";
    import { splitForm, organizeGroups } from "../state/form-groups";
    import Tabs from "./primitives/Tabs.svelte";
    import Field from "./Field.svelte";
    import Self from "./FormSection.svelte";

    // depth: the group-nesting level this FormSection renders. depth=1 is the first level
    // of groups inside a detail form (sits under the horizontal section tabs) -> vertical tabs.
    // depth=2 -> horizontal tabs. depth>2 -> always headed sections (hard cap at 2 tab levels).
    const { nodeId, bridge, vm, version, onedit, byNode, depth = 1 }:
        { nodeId: NodeId; bridge: Bridge; vm: ViewModel; version: number;
          onedit: (id: string, v: number | string) => void;
          byNode: Map<string, Diagnostic[]>;
          depth?: number } = $props();

    let rows = $state<Row[]>([]);
    $effect(() => {
        void version; // dependency: a bump re-fetches after the cache is cleared
        let cancelled = false;
        // Form groups are small; 1000 covers every real record. A windowed fetch for pathological cases is deferred.
        bridge.requestChildren(nodeId, 0, 1000).then((w) => { if (!cancelled) rows = w.rows; });
        return () => { cancelled = true; };
    });

    const { fields, groups } = $derived(splitForm(rows));

    // Hard cap at 2 tab levels: depth > 2 always renders headed sections so nested tabs
    // never stack more than two deep (vertical then horizontal, then sections).
    const org = $derived(depth <= 2 ? organizeGroups(groups, depth) : { mode: "sections" as const });

    // Active tab id for the tabs path. Defaults to the first group's id; clamped if the
    // group list changes (e.g. a different entity is selected and a prior tab is gone).
    let activeTabId = $state<string>("");
    $effect(() => {
        const ids = groups.map((g) => g.id);
        if (ids.length === 0) {
            activeTabId = "";
        } else if (!ids.includes(activeTabId)) {
            // Clamp: either no active tab or the active tab is no longer in the group list.
            activeTabId = ids[0]!;
        }
        // If the active id is still among the ids, keep it (tab navigation survives re-fetches).
    });
</script>
<div class="form">
    {#each fields as row (row.id)}
        <Field {row} {onedit} diagnostics={byNode.get(row.id)} />
    {/each}
    {#if org.mode === "tabs"}
        {@const tabItems = groups.map((g) => ({ id: g.id, label: g.name }))}
        {@const activeGroup = groups.find((g) => g.id === activeTabId)}
        <div class="group-tabs-wrap {org.orientation}">
            <Tabs tabs={tabItems} active={activeTabId} orientation={org.orientation}
                  ariaLabel="Form groups" onselect={(id) => { activeTabId = id; }} />
            {#if activeGroup}
                <div class="group-tab-content">
                    <Self nodeId={activeGroup.id} {bridge} {vm} {version} {onedit} {byNode} depth={depth + 1} />
                </div>
            {/if}
        </div>
    {:else}
        {#each groups as group (group.id)}
            <div class="subgroup">
                <h4 class="subgroup-title">{group.name}</h4>
                <Self nodeId={group.id} {bridge} {vm} {version} {onedit} {byNode} depth={depth + 1} />
            </div>
        {/each}
    {/if}
</div>
