<script lang="ts">
    import type { Diagnostic, OpenResult, SectionDescriptor } from "@bgforge/binary-editor";
    import type { Bridge } from "../state/bridge";
    import type { HostToWebview } from "../messages";
    import { ViewModel } from "../state/view-model";
    import { diagnosticsByNode, bannerSummary } from "../state/diagnostics";
    import SectionTabs from "./SectionTabs.svelte";
    import FormSection from "./FormSection.svelte";
    import ListSection from "./ListSection.svelte";

    const { bridge }: { bridge: Bridge } = $props();

    let open = $state<OpenResult | undefined>();
    let diagnostics = $state<Diagnostic[]>([]);
    let version = $state(0);
    let vm = $state<ViewModel | undefined>();
    let activeId = $state<string | undefined>();

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
    function add() { const np = vm?.addEntryNamePath(); if (np) bridge.addEntry(np); }
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
        <button onclick={() => bridge.dumpJson()}>Dump JSON</button>
        <button onclick={() => bridge.loadJson()}>Load JSON</button>
    </div>
    {#if diagnostics.length > 0}
        <div class="banner warning">
            <span class="banner-summary">{summary}</span>
            <ul class="banner-list">
                {#each diagnostics as d (d.nodeId + d.message)}
                    <li>{d.message}</li>
                {/each}
            </ul>
        </div>
    {/if}
    <SectionTabs sections={open.layout.sections} {activeId} onselect={selectSection} />
    {#if active && vm}
        {#if active.kind === "list"}
            <ListSection nodeId={active.nodeId} {bridge} {vm} {version} onadd={add} onedit={edit} {byNode} />
        {:else}
            <FormSection nodeId={active.nodeId} {bridge} {vm} {version} onedit={edit} {byNode} />
        {/if}
    {/if}
{/if}
