<script lang="ts">
    import type { Diagnostic, NodeId, OpenResult } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { HostToWebview } from "../messages";
    import { diagnosticsByNode, bannerSummary } from "../state/diagnostics";
    import { clearSelectionMemory } from "../state/list-selection-memory";
    import LayoutRenderer from "./LayoutRenderer.svelte";
    import Icon from "./Icon.svelte";

    const { bridge }: { bridge: Bridge } = $props();

    let open = $state<OpenResult | undefined>();
    let diagnostics = $state<Diagnostic[]>([]);
    let version = $state(0);
    // NodeId the host asks the view to select after the latest edit/structure op (undefined = no change).
    let selection = $state<NodeId | undefined>();
    // Last operation error that carried no pending request to reject (a failed edit/structure/spellbook op).
    // Shown in a dismissable banner so the failure is visible; cleared on the next successful change.
    let opError = $state<string | undefined>();

    const byNode = $derived(diagnosticsByNode(diagnostics));
    const summary = $derived(bannerSummary(diagnostics));
    // Warning/error present -> warning styling; otherwise an info-only banner (orphan/unreferenced notes).
    const bannerSeverity = $derived(
        diagnostics.some((d) => d.severity === "warning" || d.severity === "error") ? "warning" : "info",
    );

    $effect(() => {
        // Surface a failed op (no pending request carried it) in the dismissable error banner.
        bridge.onUnhandledError = (message: string) => {
            opError = message;
        };
        const onMsg = (event: MessageEvent<HostToWebview>) => {
            const m = event.data;
            if (bridge.handle(m)) return; // resolved a pending request, or surfaced an unmatched error
            if (m.type === "init") {
                open = m.open;
                clearSelectionMemory(); // a fresh file load drops any remembered per-section list selections
                opError = undefined;
                version++;
            } else if (m.type === "diagnostics") {
                diagnostics = m.diagnostics;
            } else if (m.type === "changeSet") {
                diagnostics = m.changeSet.diagnostics;
                opError = undefined; // a changeSet means the op succeeded - clear any prior failure
                // Undo/redo refresh via a changeSet with no selection - preserve the current selection then.
                if (m.selection !== undefined) selection = m.selection;
                // The layout renderer reads the resolved field snapshot directly, so patch each changed row
                // into it (matched by node id) to reflect edits. Without this, a layout edit never re-renders.
                const fields = open?.layout.layout?.fields;
                if (fields) {
                    for (const row of m.changeSet.changed) {
                        const ref = Object.keys(fields).find((k) => fields[k]?.id === row.id);
                        if (ref) fields[ref] = row;
                    }
                }
                // Refresh tab count badges (e.g. the Spells known/memorized total) after a structure op.
                const counts = m.changeSet.tabCounts;
                const tabs = open?.layout.layout?.tabs;
                if (counts && tabs) {
                    const patch = (ts: typeof tabs): void => {
                        for (const t of ts) {
                            if (t.id in counts) t.count = counts[t.id];
                            if (t.tabs) patch(t.tabs);
                        }
                    };
                    patch(tabs);
                }
                version++;
            } else if (m.type === "invalidated") {
                version++;
            }
        };
        window.addEventListener("message", onMsg);
        return () => {
            window.removeEventListener("message", onMsg);
            bridge.onUnhandledError = undefined;
        };
    });

    const edit = (id: string, v: number | string) => bridge.editField(id, v);
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
        <!-- JSON import/export are pushed to the right (toolbar-actions margin-left:auto) so they sit apart
             from the left-hand view options. -->
        <div class="toolbar-actions">
            <button class="toolbar-btn" onclick={() => bridge.dumpJson()}
                    title="Export the current file contents as JSON to a new editor tab">
                <Icon name="export" /><span class="toolbar-btn-label">Dump JSON</span>
            </button>
            <button class="toolbar-btn" onclick={() => bridge.loadJson()}
                    title="Import JSON from the active editor tab and apply it to the file">
                <Icon name="go-to-file" /><span class="toolbar-btn-label">Load JSON</span>
            </button>
        </div>
    </div>
    {#if open.warnings.length > 0}
        <!-- Parse-level warnings (e.g. a partially-decoded MAP whose object/script tail could not be fully
             decoded). Non-blocking: the editor still renders what DID decode, but the banner makes the partial
             state explicit instead of silently presenting fewer records. -->
        <div class="banner warning">
            <span class="banner-header">
                <Icon name="warning" /><span class="banner-summary">This file is only partially decoded</span>
            </span>
            <ul class="banner-list">
                {#each open.warnings as w (w)}
                    <li>{w}</li>
                {/each}
            </ul>
        </div>
    {/if}
    {#if opError}
        <!-- A failed edit/structure/spellbook op (no pending request carried it). Dismissable, and also cleared
             automatically by the next successful change. -->
        <div class="banner error">
            <span class="banner-header">
                <Icon name="error" /><span class="banner-summary">{opError}</span>
                <button class="banner-dismiss" onclick={() => (opError = undefined)} title="Dismiss">
                    <Icon name="close" />
                </button>
            </span>
        </div>
    {/if}
    {#if diagnostics.length > 0}
        <div class="banner {bannerSeverity}">
            <span class="banner-header">
                <Icon name={bannerSeverity} /><span class="banner-summary">{summary}</span>
            </span>
            <ul class="banner-list">
                {#each diagnostics as d (d.nodeId + d.message)}
                    <li>{d.message}</li>
                {/each}
            </ul>
        </div>
    {/if}
    {#if open.layout.layout}
        <!-- Every format renders as a single dense page via the generic LayoutRenderer; bridge/version/
             selection are forwarded for `list` blocks (variable-length sections use the windowed path). -->
        <LayoutRenderer layout={open.layout.layout} onedit={edit} {byNode}
                        {bridge} {version} {selection} />
    {:else}
        <!-- A successfully parsed file always resolves a layout; this only shows if a format ships an adapter
             with no layout schema (a developer error caught here rather than rendering a blank page). -->
        <p class="placeholder">No layout is available for this format.</p>
    {/if}
{/if}
