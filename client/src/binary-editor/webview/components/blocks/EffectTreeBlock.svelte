<script lang="ts">
    // ITM/SPL abilities + effects as a two-level tree. The left column is a single VIRTUALIZED collapsible
    // list: a Global (equipping/casting) group plus one group per ability, each with its owned effects nested
    // beneath. The right column is a shared detail pane that edits whichever node is selected (an ability's
    // fields or an effect's fields) and carries the structure-op toolbar (RowActions) for that entry.
    //
    // The host computes ownership (projectEffectTree -> EffectTreeView) and ships node ids + indices; this
    // re-fetches on every version bump and applies the post-op host selection so the new/affected entry stays
    // active. The view holds the whole tree in memory, so virtualization is purely a render-window concern:
    // the groups are flattened (respecting collapse + the filter) into one fixed-height row array, and only the
    // rows in the viewport are mounted - so a 20-ability x 100-effect file renders a handful of DOM rows.
    import type { Diagnostic, DetailRow, EffectTreeEntry, EffectTreeGroup, EffectTreeView, NodeId } from "@bgforge/binary-editor";
    import type { Bridge } from "../../state/bridge";
    import { rowActions, type SectionCaps } from "../../state/structure-actions";
    import { visibleRange } from "../../../../virtual-window";
    import ListEntryDetail from "../ListEntryDetail.svelte";
    import RowActions from "../RowActions.svelte";
    import Icon from "../Icon.svelte";

    const { bridge, version, selection, onedit, byNode, abilityDetail, effectDetail, canModify, childSection, labels }: {
        bridge: Bridge;
        version: number;
        selection: NodeId | undefined;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        abilityDetail: DetailRow[];
        effectDetail: DetailRow[];
        canModify: boolean;
        childSection: string;
        // Display-label overrides the detail fragments reference (e.g. the ITM ability's shortened "Dice Thrown"
        // inside the Alternative box, the effect's "Stacking ID (ToBEx)") - the same map the list blocks pass.
        labels?: Record<string, string>;
    } = $props();

    let view = $state<EffectTreeView | undefined>();
    // eslint-disable-next-line prefer-const -- reassigned by row clicks / host selection
    let selected = $state<{ nodeId: NodeId; kind: "ability" | "effect" } | undefined>();
    // eslint-disable-next-line prefer-const -- reassigned by chevron clicks
    let collapsed = $state<Set<string>>(new Set());
    // eslint-disable-next-line prefer-const -- reassigned by the filter input
    let filterQuery = $state("");
    // eslint-disable-next-line prefer-const -- reassigned by the scroll handler / bind:clientHeight
    let scrollTop = $state(0);
    // eslint-disable-next-line prefer-const -- reassigned via bind:clientHeight
    let viewportHeight = $state(400);
    let lastAppliedSelection: NodeId | undefined;

    const rowHeight = 24;
    const overscan = 6;

    function kindOf(v: EffectTreeView, nodeId: NodeId): "ability" | "effect" | undefined {
        if (v.groups.some((g) => g.abilityNodeId === nodeId)) return "ability";
        const isEffect =
            v.groups.some((g) => g.effects.some((e) => e.nodeId === nodeId)) ||
            v.unassigned.some((e) => e.nodeId === nodeId);
        return isEffect ? "effect" : undefined;
    }

    $effect(() => {
        void version;
        const hostSel = selection;
        let cancelled = false;
        bridge.requestEffectTree().then((v) => {
            if (cancelled) return;
            view = v;
            if (hostSel !== undefined && hostSel !== lastAppliedSelection) {
                lastAppliedSelection = hostSel;
                const kind = kindOf(v, hostSel);
                if (kind) {
                    selected = { nodeId: hostSel, kind };
                    return;
                }
            }
            if (selected && !kindOf(v, selected.nodeId)) selected = undefined;
            if (!selected) {
                const firstEffect = v.groups.flatMap((g) => g.effects)[0];
                const firstAbility = v.groups.find((g) => g.abilityNodeId !== undefined);
                if (firstEffect) selected = { nodeId: firstEffect.nodeId, kind: "effect" };
                else if (firstAbility?.abilityNodeId) selected = { nodeId: firstAbility.abilityNodeId, kind: "ability" };
            }
        });
        return () => { cancelled = true; };
    });

    // Flattened render rows. A filter (case-insensitive, over effect labels) keeps only matching effects and
    // the headers that own them, and forces every group expanded so matches are visible regardless of collapse.
    type VRow =
        | { t: "head"; key: string; group: EffectTreeGroup }
        | { t: "unassigned"; key: string; count: number }
        | { t: "effect"; key: string; entry: EffectTreeEntry }
        | { t: "empty"; key: string };

    const query = $derived(filterQuery.trim().toLowerCase());
    const filtering = $derived(query !== "");

    const visualRows = $derived.by((): VRow[] => {
        if (!view) return [];
        const match = (s: string): boolean => query === "" || s.toLowerCase().includes(query);
        const rows: VRow[] = [];
        for (const g of view.groups) {
            const effs = filtering ? g.effects.filter((e) => match(e.label)) : g.effects;
            if (filtering && effs.length === 0) continue; // group has no matching effect
            rows.push({ t: "head", key: g.key, group: g });
            const isCollapsed = !filtering && collapsed.has(g.key);
            if (!isCollapsed) {
                if (effs.length === 0 && !filtering) rows.push({ t: "empty", key: g.key + ":empty" });
                for (const e of effs) rows.push({ t: "effect", key: e.nodeId, entry: e });
            }
        }
        const un = filtering ? view.unassigned.filter((e) => match(e.label)) : view.unassigned;
        if (un.length > 0) {
            rows.push({ t: "unassigned", key: "__unassigned", count: un.length });
            for (const e of un) rows.push({ t: "effect", key: e.nodeId, entry: e });
        }
        return rows;
    });

    const range = $derived(visibleRange({ scrollTop, viewportHeight, rowHeight, overscan, total: visualRows.length }));
    const windowRows = $derived(visualRows.slice(range.start, range.end));

    const isCollapsed = (key: string): boolean => !filtering && collapsed.has(key);
    const toggle = (key: string): void => {
        const next = new Set(collapsed);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        collapsed = next;
    };
    const collapseAll = (): void => { collapsed = new Set((view?.groups ?? []).map((g) => g.key)); };
    const expandAll = (): void => { collapsed = new Set(); };
    const selectAbility = (nodeId: NodeId): void => { selected = { nodeId, kind: "ability" }; };
    const selectEffect = (nodeId: NodeId): void => { selected = { nodeId, kind: "effect" }; };

    const addAbility = (): void => {
        if (view?.abilitiesNodeId) bridge.structureOp({ op: "add", sectionId: view.abilitiesNodeId });
    };
    const addEffect = (abilityNodeId: NodeId): void => {
        bridge.structureOp({ op: "addChild", entryId: abilityNodeId, childSection });
    };
    // A section-level effect add appends to the equipping/casting range, i.e. a new GLOBAL effect.
    const addGlobalEffect = (): void => {
        if (view?.effectsNodeId) bridge.structureOp({ op: "add", sectionId: view.effectsNodeId });
    };

    const acts = $derived.by(() => {
        const sel = selected;
        if (!view || !sel || !canModify) return;
        if (sel.kind === "ability") {
            const g = view.groups.find((gr) => gr.abilityNodeId === sel.nodeId);
            if (g?.index === undefined) return;
            const caps: SectionCaps = { canAdd: true, canModify: true, childAddSection: childSection };
            return rowActions(g.index, view.abilityCount, caps);
        }
        const all = [...view.groups.flatMap((g) => g.effects), ...view.unassigned];
        const e = all.find((en) => en.nodeId === sel.nodeId);
        if (!e) return;
        return rowActions(e.index, view.effectCount, { canAdd: true, canModify: true });
    });
</script>

<div class="master-detail eff-tree">
    <div class="master eff-tree-master">
        <div class="eff-tree-toolbar">
            {#if canModify && view?.abilitiesNodeId}
                <button class="eff-tree-toolbtn" onclick={addAbility}>+ ability</button>
            {/if}
            <span class="list-filter eff-tree-filter">
                <Icon name="search" />
                <input type="text" class="list-filter-input" placeholder="Filter effects..."
                       aria-label="Filter effects" bind:value={filterQuery} />
                {#if filterQuery}
                    <button class="list-filter-clear" aria-label="Clear filter" onclick={() => { filterQuery = ""; }}>
                        <Icon name="close" />
                    </button>
                {/if}
            </span>
            <button class="eff-tree-iconbtn" aria-label="Collapse all" title="Collapse all" onclick={collapseAll}>
                <Icon name="collapse-all" />
            </button>
            <button class="eff-tree-iconbtn" aria-label="Expand all" title="Expand all" onclick={expandAll}>
                <Icon name="expand-all" />
            </button>
        </div>
        {#if !view || view.empty}
            <p class="placeholder">No abilities or effects in this record.</p>
        {:else if visualRows.length === 0}
            <p class="placeholder list-filter-empty">No matching effects.</p>
        {:else}
            <div class="eff-tree-vlist" bind:clientHeight={viewportHeight}
                 onscroll={(e) => (scrollTop = (e.target as HTMLElement).scrollTop)}>
                <div class="eff-tree-spacer" style="height:{visualRows.length * rowHeight}px">
                    {#each windowRows as vr, k (vr.key)}
                        {@const top = (range.start + k) * rowHeight}
                        <div class="eff-tree-vrow" style="top:{top}px;height:{rowHeight}px">
                            {#if vr.t === "head"}
                                {@const g = vr.group}
                                <div class="eff-tree-head"
                                     class:eff-tree-selected={selected?.kind === "ability" && selected.nodeId === g.abilityNodeId}>
                                    <button class="eff-tree-chevron" aria-label={isCollapsed(g.key) ? "Expand" : "Collapse"}
                                            onclick={() => toggle(g.key)}>
                                        <Icon name={isCollapsed(g.key) ? "chevron-right" : "chevron-down"} />
                                    </button>
                                    {#if g.abilityNodeId !== undefined}
                                        {@const aid = g.abilityNodeId}
                                        <button class="eff-tree-head-label" onclick={() => selectAbility(aid)}>{g.label}</button>
                                        {#if g.levelRequired !== undefined}
                                            <span class="eff-tree-level" title="Level Required">L{g.levelRequired}</span>
                                        {/if}
                                        <span class="eff-tree-count">{g.effects.length}</span>
                                        {#if canModify}
                                            <button class="eff-tree-add" aria-label="Add effect to this ability"
                                                    title="Add effect to this ability" onclick={() => addEffect(aid)}>
                                                <Icon name="add" />
                                            </button>
                                        {/if}
                                    {:else}
                                        <span class="eff-tree-head-label eff-tree-global">{g.label}</span>
                                        <span class="eff-tree-count">{g.effects.length}</span>
                                        {#if canModify}
                                            <button class="eff-tree-add" aria-label="Add global effect"
                                                    title="Add global (equipping/casting) effect" onclick={addGlobalEffect}>
                                                <Icon name="add" />
                                            </button>
                                        {/if}
                                    {/if}
                                </div>
                            {:else if vr.t === "unassigned"}
                                <div class="eff-tree-head eff-tree-unassigned">
                                    <Icon name="warning" />
                                    <span class="eff-tree-head-label">Unassigned (owned by no range)</span>
                                    <span class="eff-tree-count">{vr.count}</span>
                                </div>
                            {:else if vr.t === "effect"}
                                <button class="eff-tree-effect"
                                        class:eff-tree-selected={selected?.kind === "effect" && selected.nodeId === vr.entry.nodeId}
                                        onclick={() => selectEffect(vr.entry.nodeId)}>
                                    <span class="eff-tree-effect-label">{vr.entry.label}</span>
                                </button>
                            {:else}
                                <div class="eff-tree-empty">(no effects)</div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
    <div class="detail">
        {#if selected}
            {#if acts}<RowActions {acts} entryId={selected.nodeId} {bridge} />{/if}
            <ListEntryDetail nodeId={selected.nodeId}
                             detailVariant={selected.kind === "ability" ? abilityDetail : effectDetail}
                             {labels} {bridge} {version} {onedit} {byNode} />
        {:else}
            <p class="placeholder">Select an ability or effect.</p>
        {/if}
    </div>
</div>
