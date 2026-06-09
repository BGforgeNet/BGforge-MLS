<script lang="ts">
    import type { Diagnostic, NodeId, OpenResult } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { HostToWebview } from "../messages";
    import { diagnosticsByNode, bannerSummary } from "../state/diagnostics";
    import LayoutRenderer from "./LayoutRenderer.svelte";
    import Checkbox from "./primitives/Checkbox.svelte";
    import Icon from "./Icon.svelte";

    const { bridge }: { bridge: Bridge } = $props();

    let open = $state<OpenResult | undefined>();
    let diagnostics = $state<Diagnostic[]>([]);
    let version = $state(0);
    // NodeId the host asks the view to select after the latest edit/structure op (undefined = no change).
    let selection = $state<NodeId | undefined>();
    // Off by default: byte offsets are a developer affordance, not needed by end users.
    // eslint-disable-next-line prefer-const -- reassigned via the toolbar Checkbox onchange callback
    let showOffsets = $state(false);

    const byNode = $derived(diagnosticsByNode(diagnostics));
    const summary = $derived(bannerSummary(diagnostics));
    // Warning/error present -> warning styling; otherwise an info-only banner (orphan/unreferenced notes).
    const bannerSeverity = $derived(
        diagnostics.some((d) => d.severity === "warning" || d.severity === "error") ? "warning" : "info",
    );

    $effect(() => {
        const onMsg = (event: MessageEvent<HostToWebview>) => {
            const m = event.data;
            if (bridge.handle(m)) return; // resolved a pending requestChildren
            if (m.type === "init") {
                open = m.open;
                bridge.invalidate();
                version++;
            } else if (m.type === "diagnostics") {
                diagnostics = m.diagnostics;
            } else if (m.type === "changeSet") {
                diagnostics = m.changeSet.diagnostics;
                selection = m.selection;
                // The layout renderer reads the resolved field snapshot directly, so patch each changed row
                // into it (matched by node id) to reflect edits. Without this, a layout edit never re-renders.
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
        <LayoutRenderer layout={open.layout.layout} onedit={edit} {byNode} {showOffsets}
                        {bridge} {version} {selection} />
    {:else}
        <!-- A successfully parsed file always resolves a layout; this only shows if a format ships an adapter
             with no layout schema (a developer error caught here rather than rendering a blank page). -->
        <p class="placeholder">No layout is available for this format.</p>
    {/if}
{/if}
