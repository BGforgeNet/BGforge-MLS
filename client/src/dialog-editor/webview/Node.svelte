<script lang="ts">
    import { Handle, Position } from "@xyflow/svelte";
    import { choiceBadges, resolveText, stateBadges, stateHeadLabel, type DialogState } from "../../../../shared/dialog-model";
    import type { Reachability } from "../../../../shared/dialog-reachability";
    import Badge from "./Badge.svelte";
    import LowIntChip from "./LowIntChip.svelte";
    import { isPendingState } from "./inspector-edit";

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
            /** The format carries no source spans at all (a compiled DLG), so a missing one is not "new". */
            sourceless?: boolean;
            /** This card belongs to a neighbouring dialog drawn for context; this editor writes one file. */
            external?: boolean;
        };
        type: string;
    } = $props();

</script>

{#if type === "card" && data.state}
    {@const sb = stateBadges(data.state)}
    {@const pending = !data.sourceless && isPendingState(data.state)}
    <div class="card" class:derived={data.state.derivedFrom} class:orphan={data.reachability === "orphan"} class:flagged={data.flagged} class:pending class:foreign={data.external}>
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
            {#if pending}<span class="rmark unsaved" title="Unsaved draft: this node isn't in the source file yet - it lands on the next save.">unsaved</span>{/if}
            {#if data.external}<span class="rmark foreign" title="Another dialog: shown so this conversation's hand-offs are visible. This editor saves only the file it opened, so nothing here can be edited.">{data.state.dlgResref}</span>{/if}
            {#if data.state.weight != null}<span class="w">W{data.state.weight}</span>{/if}
        </div>
        <div class="bd">
            {resolveText(data.state.text, data.messages) || "(no line)"}
            <!-- A multisay monologue says several lines before the player replies; the card is the compact
                 overview, so show the first line + a count. All lines are visible in the tree and editable in
                 the inspector. -->
            {#if data.state.sayTexts && data.state.sayTexts.length > 1}<span class="saymore" title="This state says {data.state.sayTexts.length} lines in sequence - see all in the tree, edit each in the inspector.">+{data.state.sayTexts.length - 1} more</span>{/if}
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
        background: var(--vscode-editorWidget-background);
        /* focusBorder: an always-on accent framing every node card (not a real focus state) - the closest
           documented token for a persistent accent outline. */
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 8px;
        font-size: 11px;
        color: var(--vscode-foreground);
        overflow: hidden;
    }
    .hd {
        /* A slightly-recessed header strip atop the card, matching the toolbar/tab-strip treatment
           elsewhere in this webview. */
        background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
        /* Extra left padding so the node name clears the target handle dot, which Svelte
           Flow centers on the left edge - at 8px the gap was ~2px and the pin tipped over
           the name's first character on short/badged cards. */
        padding: 3px 8px 3px 15px;
        color: var(--vscode-textLink-foreground);
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
        color: var(--vscode-charts-purple);
        border: 1px solid var(--vscode-charts-purple);
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
        color: var(--vscode-errorForeground);
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 28, 0.15));
        border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    .hd .rmark.ext {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
    }
    /* Conversation start node (reached from talk_p_proc). Read-only marker: green chip, distinct
       from the red `dead` and grey `ext` marks. Entry wiring is source-controlled - no toggle here.
       No dedicated "success" background token exists, so the widget background stands in. */
    .hd .rmark.start {
        color: var(--vscode-charts-green);
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-charts-green);
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* Shared-text coupling marker: amber, "editing this text also changes another node". Text uses
       inputValidation-warningForeground (falls back to plain foreground) rather than editorWarning-
       foreground - the latter fails WCAG contrast against this warning background wash in light themes. */
    .hd .rmark.shared {
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* A state from a neighbouring dialog, drawn so a hand-off lands somewhere visible. Muted and dashed like
       the other read-only cards; the chip carries its file name, since that is the fact the reader needs. */
    .card.foreign {
        border-style: dashed;
        border-color: var(--vscode-descriptionForeground);
        opacity: 0.85;
    }
    .hd .rmark.foreign {
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-descriptionForeground);
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* A dead-island state: dashed red card so it stands out from live dialogue. */
    .card.orphan {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
        border-style: dashed;
    }
    /* Unsaved-draft card: a node in the optimistic model not yet in the source parse (a just-added node before
       the reparse adopts it). A dashed amber border + the "unsaved" badge mark it (the badge text, not colour
       alone, carries the meaning). */
    .card.pending {
        border-color: var(--vscode-editorWarning-foreground);
        border-style: dashed;
    }
    .hd .rmark.unsaved {
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border: 1px solid var(--vscode-editorWarning-foreground);
        border-radius: 3px;
        padding: 0 3px;
        font-size: 8px;
        font-weight: 700;
    }
    /* Derived (CHAIN/INTERJECT/EXTEND) states are read-only: a dashed, muted card and a
       construct badge mark them as not directly editable (the badge text, not color
       alone, carries the meaning). */
    .card.derived {
        border-style: dashed;
        border-color: var(--vscode-panel-border);
        background: var(--vscode-editorWidget-background);
        opacity: 0.92;
    }
    .card.derived .hd {
        color: var(--vscode-descriptionForeground);
    }
    /* NPC line = blue (charts-blue); player options = neutral default foreground by default, overridden to
       green/red by reaction below. NPC and player lines must never share a colour (they are the two
       sides of the conversation), and green/red stay reserved for good/bad options. */
    .bd {
        padding: 4px 8px 4px 15px;
        color: var(--vscode-charts-blue);
    }
    /* "+N more" chip marking a multisay monologue: the card shows the first line, this counts the rest. */
    .bd .saymore {
        margin-left: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 3px;
        padding: 0 3px;
        white-space: nowrap;
    }
    .opt {
        position: relative; /* so each row's source Handle (top:50%) centers on the ROW */
        border-top: 1px solid var(--vscode-panel-border);
        padding: 2px 8px 2px 15px;
        color: var(--vscode-foreground);
        font-size: 9px;
        height: 20px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    /* Reaction is carried by the option text color (there is no longer a letter chip): good = green,
       bad = red, neutral = the same default foreground, so a D transition (no reaction)
       reads identically to an SSL neutral option. Color-only is a deliberate tradeoff: a per-option chip
       was visual noise at this row density, and the value stays reachable without color perception via
       the inspector's reaction <select>, which presents it as text. */
    .opt.r-good .otext {
        color: var(--vscode-charts-green);
    }
    .opt.r-bad .otext {
        color: var(--vscode-errorForeground);
    }
    .opt.r-neutral .otext {
        color: var(--vscode-foreground);
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
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border: 1px dashed var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        border-radius: 8px;
        /* inputValidation-warningForeground (falls back to plain foreground), not editorWarning-foreground -
           the latter fails WCAG contrast against this warning background wash in light themes. */
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-size: 9px;
        padding: 6px 8px;
    }
    /* A stub that resolves to another tab is clickable - signal it (solid border, same warning wash). */
    .ext.jump {
        cursor: pointer;
        border-style: solid;
    }
    .ext.jump .jhint {
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-weight: 700;
    }
    .exit {
        width: 70px;
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 28, 0.15));
        border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
        color: var(--vscode-errorForeground);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        padding: 6px 8px;
        text-align: center;
    }
    /* SSL Node998 combat terminal: same danger palette as exit - VS Code exposes one error-validation
       background, so the "filled deeper red" distinction from the old fixed palette is not reproducible
       via theme tokens; the border still reads a hair stronger via the plain error-foreground border. */
    .combat {
        width: 90px;
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 28, 0.15));
        border: 1px solid var(--vscode-errorForeground);
        color: var(--vscode-errorForeground);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        padding: 6px 8px;
        text-align: center;
    }
</style>
