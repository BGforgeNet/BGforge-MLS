<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { resolveText, type DialogState } from "../../../../shared/dialog-model";

    // Custom node component: Svelte Flow selects it by node `type`, so one component
    // covers the card / external-anchor / exit variants by branching on `type`.
    let { data, type }: {
        data: { state?: DialogState; label?: string; messages?: Record<string, string>; jumpTo?: { file: string; stateId: string } };
        type: string;
    } = $props();

    // A derived state (CHAIN/INTERJECT/EXTEND link) has no source label of its own - its
    // id is editor-synthesized (e.g. "DYEDCON4_2"). Showing that fabricated id is
    // misleading (searching the .d for it finds nothing), so label it by speaker + the
    // message ref instead (e.g. "%DYNAHEIR_BANTER% @109"), and badge the construct.
    function headLabel(state: DialogState): string {
        if (!state.derivedFrom) return `${state.speaker ?? "NPC"} - ${state.id}`;
        const m = /^@(\d+)$/.exec((state.text ?? "").trim());
        const ref = m ? `@${m[1]}` : state.id;
        return `${state.speaker ?? "NPC"} ${ref}`;
    }
</script>

{#if type === "card" && data.state}
    <div class="card" class:derived={data.state.derivedFrom}>
        <Handle type="target" position={Position.Left} />
        <div class="hd">
            <span class="who">{headLabel(data.state)}</span>
            {#if data.state.derivedFrom}<span class="badge" title="Read-only: expanded from a {data.state.derivedFrom} block">{data.state.derivedFrom}</span>{/if}
            {#if data.state.weight != null}<span class="w">W{data.state.weight}</span>{/if}
        </div>
        <div class="bd">
            {resolveText(data.state.text, data.messages) || "(no line)"}{#if data.state.trigger}<span class="cond"> [if]</span>{/if}
        </div>
        {#each data.state.choices as c (c.id)}
            <div class="opt">
                <span class="otext">{c.condition ? "[?] " : ""}{resolveText(c.text, data.messages) || (c.target.kind === "exit" ? "(exit)" : "(continue)")}</span>
                <!-- A derived state's transitions can't be rewritten, so its output handles
                     are non-connectable (no drag-to-retarget from a read-only state). -->
                <Handle type="source" id={c.id} position={Position.Right} isConnectable={!data.state.derivedFrom} />
            </div>
        {/each}
    </div>
{:else if type === "external"}
    <div class="ext" class:jump={data.jumpTo} title={data.jumpTo ? "Open in its dialog tab" : data.label}>
        <Handle type="target" position={Position.Left} />&#8631; {data.label}{#if data.jumpTo}<span class="jhint"> &#8599;</span>{/if}
    </div>
{:else}
    <div class="exit"><Handle type="target" position={Position.Left} />EXIT</div>
{/if}

<style>
    .card {
        width: 200px;
        background: #222831;
        border: 1px solid #3b82f6;
        border-radius: 8px;
        font-size: 11px;
        color: #e8eaed;
        overflow: hidden;
    }
    .hd {
        background: #1b2430;
        padding: 3px 8px;
        color: #22d3ee;
        font-size: 9px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 5px;
    }
    .hd .who {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .hd .w {
        color: #f0abfc;
        border: 1px solid #a21caf;
        border-radius: 3px;
        padding: 0 3px;
    }
    /* Derived (CHAIN/INTERJECT/EXTEND) states are read-only: a dashed, muted card and a
       construct badge mark them as not directly editable (the badge text, not color
       alone, carries the meaning). */
    .card.derived {
        border-style: dashed;
        border-color: #6b7280;
        background: #1d2026;
        opacity: 0.92;
    }
    .card.derived .hd {
        color: #9aa0a6;
    }
    .hd .badge {
        color: #cbd5e1;
        background: #374151;
        border: 1px solid #4b5563;
        border-radius: 3px;
        padding: 0 4px;
        font-size: 8px;
        letter-spacing: 0.04em;
    }
    .bd {
        padding: 4px 8px;
    }
    .bd .cond {
        color: #f59e0b;
    }
    .opt {
        position: relative; /* so each row's source Handle (top:50%) centers on the ROW */
        border-top: 1px solid #313846;
        padding: 2px 8px;
        color: #bfe66a;
        font-size: 9px;
        height: 20px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
    }
    /* One clipped preview line per reply; the full text is editable in the inspector. */
    .opt .otext {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .ext {
        width: 150px;
        background: #2a2620;
        border: 1px dashed #a16207;
        border-radius: 8px;
        color: #fbbf24;
        font-size: 9px;
        padding: 6px 8px;
    }
    /* A stub that resolves to another tab is clickable - signal it. */
    .ext.jump {
        cursor: pointer;
        border-style: solid;
        background: #33291a;
    }
    .ext.jump .jhint {
        color: #fcd34d;
        font-weight: 700;
    }
    .exit {
        width: 70px;
        background: #241c1c;
        border: 1px solid #7f1d1d;
        color: #fca5a5;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        padding: 6px 8px;
        text-align: center;
    }
</style>
