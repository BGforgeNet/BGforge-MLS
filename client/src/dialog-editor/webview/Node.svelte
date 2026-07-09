<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { choiceBadges, resolveText, stateBadges, stateHeadLabel, type DialogState } from "../../../../shared/dialog-model";
    import type { Reachability } from "../../../../shared/dialog-reachability";
    import Badge from "./Badge.svelte";
    import LowIntChip from "./LowIntChip.svelte";

    // Custom node component: Svelte Flow selects it by node `type`, so one component
    // covers the card / external-anchor / exit variants by branching on `type`.
    let { data, type }: {
        data: {
            state?: DialogState;
            /** Dialog file base name -> speaker fallback for the header (see stateHeadLabel). */
            sourceName?: string;
            label?: string;
            /** Tooltip for a synthetic terminal - the underlying SSL support node id (Node998/Node999). */
            title?: string;
            messages?: Record<string, string>;
            jumpTo?: { file: string; stateId: string };
            reachability?: Reachability;
            flagged?: boolean;
            /** This node's text (line or a reply) shares a .msg/.tra ref with another node. */
            sharedText?: boolean;
            /** Per-node FIELD editability (superset incl. faithful/bundle TSSL). Gates drag-to-retarget. */
            fieldEditable?: boolean;
        };
        type: string;
    } = $props();

</script>

{#if type === "card" && data.state}
    {@const sb = stateBadges(data.state)}
    <div class="card" class:derived={data.state.derivedFrom} class:orphan={data.reachability === "orphan"} class:flagged={data.flagged}>
        <Handle type="target" position={Position.Left} />
        <div class="hd">
            <span class="who">{stateHeadLabel(data.state, data.sourceName)}</span>
            <!-- For a derived state, show the construct name (CHAIN/...) as the badge label;
                 otherwise the badge's own short text. Full set is on hover. -->
            <Badge badges={sb} label={sb[0] === "derived" ? data.state.derivedFrom : undefined} />
            {#if data.reachability === "orphan"}<span class="rmark dead" title="Dead: no path reaches this state and nothing outside the file enters it">dead</span>{/if}
            {#if data.reachability === "external-entry"}<span class="rmark ext" title="Entered from outside this file (e.g. a cross-file EXTERN)">entry</span>{/if}
            {#if data.state.isEntry}<span class="rmark start" title="Conversation start node: reached from talk_p_proc. Read-only - edit the .ssl to change the dialog's entry wiring.">start</span>{/if}
            {#if data.sharedText}<span class="rmark shared" title="Shared text: this state's line or an option uses the same .msg/.tra entry as another state - editing it here changes the other one too.">shared</span>{/if}
            {#if data.state.weight != null}<span class="w">W{data.state.weight}</span>{/if}
        </div>
        <div class="bd">
            {resolveText(data.state.text, data.messages) || "(no line)"}
        </div>
        {#each data.state.choices as c (c.id)}
            {@const cb = choiceBadges(c)}
            <div class="opt" class:r-good={c.reaction === "good"} class:r-bad={c.reaction === "bad"} class:r-neutral={c.reaction === "neutral"}>
                <LowIntChip lowIq={c.lowIq} />
                {#if cb.length}<Badge badges={cb} small />{/if}
                <span class="otext"
                    >{resolveText(c.text, data.messages) ||
                        (c.target.kind === "exit" ? "(exit)" : "(continue)")}</span
                >
                <!-- A derived state's transitions can't be rewritten, and a non-faithful SSL node's
                     structure is read-only, so those output handles are non-connectable (no
                     drag-to-retarget). A faithful SSL node is structurally editable, so it connects. -->
                <Handle type="source" id={c.id} position={Position.Right} isConnectable={!data.state.derivedFrom && data.fieldEditable !== false} />
            </div>
        {/each}
    </div>
{:else if type === "external"}
    <div class="ext" class:jump={data.jumpTo} title={data.jumpTo ? "Open in its dialog tab" : data.label}>
        <Handle type="target" position={Position.Left} />&#8631; {data.label}{#if data.jumpTo}<span class="jhint"> &#8599;</span>{/if}
    </div>
{:else if type === "combat"}
    <!-- SSL Node998 terminal: an option that starts combat. Presented as a terminal, not a drawn node; the
         tooltip reveals the underlying support node (data.title = "Node998"). -->
    <div class="combat" title={data.title}><Handle type="target" position={Position.Left} />COMBAT</div>
{:else}
    <div class="exit" title={data.title}><Handle type="target" position={Position.Left} />EXIT</div>
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
        /* Extra left padding so the node name clears the target handle dot, which Svelte
           Flow centers on the left edge - at 8px the gap was ~2px and the pin tipped over
           the name's first character on short/badged cards. */
        padding: 3px 8px 3px 15px;
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
    /* Reachability markers (1C). `dead` is a prominent warning chip; `ext` (an EXTERN
       entry) is quiet text - both informational, not problems. The width guard is load-
       bearing: a marker must never grow enough to collapse the node name (the identity).
       An unstyled exotic glyph once fell back to a 127px-wide tofu and ate the whole header.
       `min-width: 0` is required for `max-width` to bind: a flex item defaults to
       `min-width: auto` (its content's min size), which otherwise overrides the cap. */
    .hd .rmark {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 48px;
        overflow: hidden;
        white-space: nowrap;
    }
    .hd .rmark.dead {
        color: #fca5a5;
        background: #2a1717;
        border: 1px solid #b91c1c;
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    .hd .rmark.ext {
        color: #8b96a6;
        font-size: 10px;
    }
    /* Conversation start node (reached from talk_p_proc). Read-only marker: green chip, distinct
       from the red `dead` and grey `ext` marks. Entry wiring is source-controlled - no toggle here. */
    .hd .rmark.start {
        color: #86efac;
        background: #16281b;
        border: 1px solid #22c55e;
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* Shared-text coupling marker: amber, "editing this text also changes another node". */
    .hd .rmark.shared {
        color: #fcd34d;
        background: #2c2610;
        border: 1px solid #b4801f;
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* A dead-island state: dashed red card so it stands out from live dialogue. */
    .card.orphan {
        border-color: #b91c1c;
        border-style: dashed;
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
    /* NPC line = blue (blue-300); player options = neutral grey (slate-300) by default, overridden to
       green/red by reaction below. NPC and player lines must never share a colour (they are the two
       sides of the conversation), and green/red stay reserved for good/bad options. */
    .bd {
        padding: 4px 8px 4px 15px;
        color: #93c5fd;
    }
    .opt {
        position: relative; /* so each row's source Handle (top:50%) centers on the ROW */
        border-top: 1px solid #313846;
        padding: 2px 8px 2px 15px;
        color: #cbd5e1;
        font-size: 9px;
        height: 20px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    /* Reaction is carried by the option text color (there is no longer a letter chip): good = green,
       bad = red, neutral = quiet grey - the same grey as the default, so a D transition (no reaction)
       reads identically to an SSL neutral option. */
    .opt.r-good .otext {
        color: #86efac;
    }
    .opt.r-bad .otext {
        color: #fca5a5;
    }
    .opt.r-neutral .otext {
        color: #cbd5e1;
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
    /* SSL Node998 combat terminal: same danger palette as exit, filled deeper red to read as the stronger action. */
    .combat {
        width: 90px;
        background: #3b1515;
        border: 1px solid #b91c1c;
        color: #fecaca;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        padding: 6px 8px;
        text-align: center;
    }
</style>
