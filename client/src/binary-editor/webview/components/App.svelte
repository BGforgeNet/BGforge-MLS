<script lang="ts">
    import type { Diagnostic, NodeId, OpenResult, SectionDescriptor } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { HostToWebview } from "../messages";
    import { ViewModel } from "../state/view-model";
    import { diagnosticsByNode, bannerSummary } from "../state/diagnostics";
    import SectionTabs from "./SectionTabs.svelte";
    import LayoutRenderer from "./LayoutRenderer.svelte";
    import FormSection from "./FormSection.svelte";
    import ListSection from "./ListSection.svelte";
    import InlineList from "./InlineList.svelte";
    import Checkbox from "./primitives/Checkbox.svelte";
    import Icon from "./Icon.svelte";

    const { bridge }: { bridge: Bridge } = $props();

    let open = $state<OpenResult | undefined>();
    let diagnostics = $state<Diagnostic[]>([]);
    let version = $state(0);
    let vm = $state<ViewModel | undefined>();
    let activeId = $state<string | undefined>();
    // NodeId the host asks the view to select after the latest edit/structure op (undefined = no change).
    let selection = $state<NodeId | undefined>();
    // Off by default: byte offsets are a developer affordance, not needed by end users.
    // eslint-disable-next-line prefer-const -- reassigned via the toolbar Checkbox onchange callback
    let showOffsets = $state(false);

    const active = $derived<SectionDescriptor | undefined>(
        open?.layout.sections.find((s) => s.id === activeId));
    const byNode = $derived(diagnosticsByNode(diagnostics));
    const summary = $derived(bannerSummary(diagnostics));

    $effect(() => {
        const onMsg = (event: MessageEvent<HostToWebview>) => {
            const m = event.data;
            if (bridge.handle(m)) return; // resolved a pending requestChildren
            if (m.type === "init") {
                open = m.open;
                vm = new ViewModel(m.open.layout);
                activeId = m.open.layout.sections[0]?.id;
                bridge.invalidate();
                version++;
            } else if (m.type === "diagnostics") {
                diagnostics = m.diagnostics;
            } else if (m.type === "changeSet") {
                diagnostics = m.changeSet.diagnostics;
                selection = m.selection;
                // The tabs path re-fetches rows through the bridge on the version bump, but the layout
                // renderer reads the resolved field snapshot directly - so patch each changed row into it
                // (matched by node id) to reflect edits. Without this, a layout edit never re-renders.
                const fields = open?.layout.layout?.fields;
                if (fields) {
                    for (const row of m.changeSet.changed) {
                        const ref = Object.keys(fields).find((k) => fields[k]?.id === row.id);
                        if (ref) fields[ref] = row;
                    }
                }
                bridge.invalidate();
                version++;
            } else if (m.type === "invalidated") {
                bridge.invalidate();
                version++;
            }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    });

    function selectSection(id: string) { vm?.selectSection(id); activeId = id; }
    const edit = (id: string, v: number | string) => bridge.editField(id, v);
    function add() { if (active) bridge.structureOp({ op: "add", sectionId: active.nodeId }); }
</script>

{#if !open}
    <p class="placeholder">Loading...</p>
{:else if open.errors.length > 0}
    <div class="error-state">
        <h2>Could not open file</h2>
        <p>{open.errors.join("; ")}</p>
    </div>
{:else}
    <div class="toolbar">
        <button class="toolbar-btn" onclick={() => bridge.dumpJson()}
                title="Export the current file contents as JSON to a new editor tab">
            <Icon name="export" /><span class="toolbar-btn-label">Dump JSON</span>
        </button>
        <button class="toolbar-btn" onclick={() => bridge.loadJson()}
                title="Import JSON from the active editor tab and apply it to the file">
            <Icon name="go-to-file" /><span class="toolbar-btn-label">Load JSON</span>
        </button>
        <Checkbox checked={showOffsets} label="Show bytes" onchange={(v) => { showOffsets = v; }} />
    </div>
    {#if diagnostics.length > 0}
        <div class="banner warning">
            <span class="banner-header">
                <Icon name="warning" /><span class="banner-summary">{summary}</span>
            </span>
            <ul class="banner-list">
                {#each diagnostics as d (d.nodeId + d.message)}
                    <li>{d.message}</li>
                {/each}
            </ul>
        </div>
    {/if}
    {#if open.layout.layout}
        <!-- Layout-schema formats (PRO) render as a single dense page via the generic LayoutRenderer;
             the legacy section-tabs + form/list path below is unchanged for every other format. -->
        <LayoutRenderer layout={open.layout.layout} onedit={edit} {byNode} {showOffsets} />
    {:else}
        <SectionTabs sections={open.layout.sections} {activeId} onselect={selectSection} />
        {#if active && vm}
            {#if active.kind === "list"}
                {#if active.render === "inline"}
                    <InlineList parentId={active.nodeId}
                                caps={{ canAdd: active.canAdd, canModify: active.canModify }}
                                {bridge} {version} {selection} onedit={edit} {showOffsets} />
                {:else}
                    <ListSection nodeId={active.nodeId}
                                caps={{ canAdd: active.canAdd, canModify: active.canModify }}
                                {bridge} {vm} {version} {selection} onadd={add} onedit={edit} {byNode} {showOffsets} />
                {/if}
            {:else}
                <FormSection nodeId={active.nodeId} {bridge} {vm} {version} onedit={edit} {byNode} {showOffsets} />
            {/if}
        {/if}
    {/if}
{/if}
