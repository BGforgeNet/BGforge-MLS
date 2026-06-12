<script lang="ts">
    // Generic renderer for a format's declarative layout. Untabbed variants render their rows directly; tabbed
    // variants render a primary tab strip (and a secondary strip for subtabs) using the in-house Tabs
    // primitive, with the active tab's rows below. Each row is a set of panels, each panel a stack of blocks.
    // Empty tabs/rows (e.g. a MAP elevation absent from this file) are pruned. Field rows are pre-resolved in
    // `layout.fields`.
    import type { Diagnostic, LayoutRow, NodeId, ResolvedLayout, ResolvedTab } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import Tabs, { type TabItem } from "./primitives/Tabs.svelte";
    import FieldsBlock from "./blocks/FieldsBlock.svelte";
    import FlagColumns from "./blocks/FlagColumns.svelte";
    import FlagGroups from "./blocks/FlagGroups.svelte";
    import MatrixBlock from "./blocks/MatrixBlock.svelte";
    import GridBlock from "./blocks/GridBlock.svelte";
    import ListBlock from "./blocks/ListBlock.svelte";
    import SpellbookBlock from "./blocks/SpellbookBlock.svelte";
    import RawBlock from "./blocks/RawBlock.svelte";

    // bridge/version/selection are only needed by `list` blocks (variable-length sections render via the
    // live windowed getChildren path); form-only layouts (PRO/EFF) ignore them.
    const { layout, onedit, byNode, showOffsets = false, bridge, version, selection }: {
        layout: ResolvedLayout;
        onedit: (id: string, v: number | string) => void;
        byNode: Map<string, Diagnostic[]>;
        showOffsets?: boolean;
        bridge: Bridge;
        version: number;
        selection: NodeId | undefined;
    } = $props();

    const rootStyle = $derived(`max-width:${layout.maxContentWidthPx ?? 900}px`);

    // A `list` block targeting a section absent from this file (e.g. a MAP with no local variables, or fewer
    // than three elevations) produces no content. Prune its panel - and any row left with only such panels -
    // so absent optional sections leave no empty titled box. Non-list blocks always count as content.
    function blockHasContent(block: LayoutRow["panels"][number]["blocks"][number]): boolean {
        return block.kind !== "list" || layout.sections[block.sectionKey] !== undefined;
    }
    const panelHasContent = (panel: LayoutRow["panels"][number]): boolean => panel.blocks.some((b) => blockHasContent(b));
    const rowHasContent = (row: LayoutRow): boolean => row.panels.some((p) => panelHasContent(p));
    const tabRows = (tab: ResolvedTab): LayoutRow[] => tab.rows ?? (tab.tabs ?? []).flatMap((st) => st.rows ?? []);
    const tabHasContent = (tab: ResolvedTab): boolean => tabRows(tab).some((r) => rowHasContent(r));
    const toItem = (t: ResolvedTab): TabItem => ({ id: t.id, label: t.count !== undefined ? `${t.label} (${t.count})` : t.label, icon: t.icon });

    // Active top-level tab and (for tabs with subtabs) active subtab. State persists across edits; the
    // find-with-fallback keeps a stale id (e.g. after opening a different file) from breaking rendering.
    let activeTabId = $state<string | undefined>();
    let activeSubByTab = $state<Record<string, string>>({});
    function selectTab(id: string): void {
        activeTabId = id;
    }
    function selectSub(id: string): void {
        if (activeTab) activeSubByTab = { ...activeSubByTab, [activeTab.id]: id };
    }

    const visibleTabs = $derived((layout.tabs ?? []).filter((t) => tabHasContent(t)));
    const activeTab = $derived(visibleTabs.find((t) => t.id === activeTabId) ?? visibleTabs[0]);
    const visibleSubs = $derived((activeTab?.tabs ?? []).filter((st) => (st.rows ?? []).some((r) => rowHasContent(r))));
    const activeSub = $derived(
        activeTab?.tabs ? (visibleSubs.find((st) => st.id === activeSubByTab[activeTab.id]) ?? visibleSubs[0]) : undefined,
    );
    const bodyRows = $derived(activeTab?.tabs ? (activeSub?.rows ?? []) : (activeTab?.rows ?? layout.rows ?? []));
</script>
<div class="layout-root" style={rootStyle}>
    {#if layout.tabs}
        <Tabs variant="primary" ariaLabel="Sections" tabs={visibleTabs.map((t) => toItem(t))}
              active={activeTab?.id ?? ""} onselect={selectTab} />
        {#if activeTab?.tabs}
            <Tabs variant="secondary" ariaLabel={activeTab.label} tabs={visibleSubs.map((t) => toItem(t))}
                  active={activeSub?.id ?? ""} onselect={selectSub} />
        {/if}
        {@render rowsView(bodyRows)}
    {:else if layout.rows}
        {@render rowsView(layout.rows)}
    {/if}
</div>

{#snippet rowsView(rows: LayoutRow[])}
    {#each rows as row, ri (ri)}
        {#if rowHasContent(row)}
        <div class="layout-row">
            {#each row.panels as panel, pi (pi)}
                {#if panelHasContent(panel)}
                <div class="panel" class:panel-fit={panel.fit} style={panel.widthPx ? `width:${panel.widthPx}px` : ""}>
                    {#if panel.title}<h3>{panel.title}</h3>{/if}
                    <div class="panel-blocks" class:stack={panel.stack}
                         style={panel.colGapPx ? `gap:${panel.colGapPx}px` : ""}>
                        {#each panel.blocks as block, bi (bi)}
                            {#if block.kind === "fields"}
                                <FieldsBlock fieldRefs={block.fields} columns={block.columns} joins={block.joins}
                                             labelWidthCh={block.labelWidthCh}
                                             fields={layout.fields} {onedit} {byNode} {showOffsets} />
                            {:else if block.kind === "group"}
                                <!-- Boxed, labelled subgroup: a fieldset (flag-group box chrome) wrapping a
                                     nested fields block. Used to nest a cluster (e.g. CRE Class) in a panel. -->
                                <fieldset class="flag-group">
                                    <legend>{block.label}</legend>
                                    <FieldsBlock fieldRefs={block.fields} columns={block.columns} joins={block.joins}
                                                 fields={layout.fields} {onedit} {byNode} {showOffsets} />
                                </fieldset>
                            {:else if block.kind === "flags"}
                                <!-- Box the flag group unless it is the sole block of a titled panel (then the
                                     panel border + h3 already is its group box - boxing again double-borders). -->
                                <FlagColumns field={block.field} columns={block.columns}
                                             descriptions={block.descriptions} labels={block.labels}
                                             spread={block.spread}
                                             boxed={!(panel.blocks.length === 1 && panel.title !== undefined)}
                                             fields={layout.fields} {onedit} />
                            {:else if block.kind === "flagGroups"}
                                <FlagGroups columns={block.columns} bulkSelect={block.bulkSelect}
                                            fields={layout.fields} {onedit} />
                            {:else if block.kind === "matrix"}
                                <MatrixBlock valueColumns={block.valueColumns} groups={block.groups}
                                             columnWidthPx={block.columnWidthPx} fields={layout.fields}
                                             {onedit} showBytes={showOffsets} />
                            {:else if block.kind === "grid"}
                                <GridBlock columns={block.columns} items={block.items}
                                           fields={layout.fields} {onedit} showBytes={showOffsets} />
                            {:else if block.kind === "list"}
                                <ListBlock sectionKey={block.sectionKey} section={layout.sections[block.sectionKey]}
                                           render={block.render} detailVariant={block.detailVariant}
                                           detailVariantFallbacks={block.detailVariantFallbacks}
                                           childList={block.childList} labels={layout.labels}
                                           {bridge} {version} {selection}
                                           {onedit} {byNode} {showOffsets} />
                            {:else if block.kind === "spellbook"}
                                <SpellbookBlock {bridge} {version} {onedit} />
                            {:else}
                                <RawBlock />
                            {/if}
                        {/each}
                    </div>
                </div>
                {/if}
            {/each}
        </div>
        {/if}
    {/each}
{/snippet}
