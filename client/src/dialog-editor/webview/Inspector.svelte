<script lang="ts">
    import {
        resolveText,
        type DialogBranch,
        type DialogChoice,
        type DialogFormat,
        type DialogState,
        type DialogTarget,
    } from "../../../../shared/dialog-model";
    import { isPendingChoice, isPendingState, msgRef, textFieldLocked } from "./inspector-edit";

    // The detail panel for the selected state. For an editable format (WeiDU D) it is the
    // edit surface: content fields (SAY, trigger, weight, reply/condition/action) mutate the
    // passed `state`/`messages` directly (reactive editModel proxies, so the card re-renders
    // without a relayout) and structural changes go through `actions`. For a view-only format
    // (Fallout SSL) it is a read-only, SSL-native presentation - SSL is derived from script
    // and has no surgical write-back yet, so editing is disabled and the WeiDU vocabulary
    // (trigger/weight/`DO ~...~`) is replaced or dropped.
    let { state, messages, stateIds, actions, format, editable, structuralEditable, deletable, entryRemovable }: {
        state: DialogState;
        messages: Record<string, string> | undefined;
        stateIds: string[];
        format: DialogFormat;
        editable: boolean;
        // Per-node structural editability. For D it tracks `editable`; for SSL it is true only on
        // a faithful node, which gains the structural ops the save path can persist (retarget, reorder,
        // add/remove unconditional option). Delete is gated separately by `deletable` below; the rest of
        // the D edit surface (rename, condition/action, duplicate) stays read-only for SSL - D-only or
        // later SSL tiers the save path can't persist yet.
        structuralEditable: boolean;
        // Whether this node can be deleted (D: any non-derived; faithful SSL: only when every inbound
        // reference can be cleaned up on save - see DialogGraph canDelete / eligibleToDelete). Surfaces
        // the SSL Delete button (Tier 3a); D's delete stays in the `!readOnly` ops block below.
        deletable: boolean;
        // Whether toggling off isEntry is safe for this node. True when the node is NOT currently
        // an entry (toggling on is always safe), or when its entry call is top-level (can be removed
        // without orphaning a conditional wrapper). False when the node IS an entry AND its entry call
        // is non-top-level - disabling the checkbox in that case.
        entryRemovable: boolean;
        actions: {
            rename: (newId: string) => void;
            addReply: () => void;
            removeReply: (choiceId: string) => void;
            moveReply: (choiceId: string, dir: -1 | 1) => void;
            setTarget: (choiceId: string, target: DialogTarget) => void;
            deleteState: () => void;
            duplicateState: () => void;
            setEntry: (on: boolean) => void;
        };
    } = $props();

    // A bare `@N` line is backed by a .tra entry: edit that entry so localization is
    // preserved (the project decision). A literal line is edited in place.
    function setSay(v: string): void {
        const ref = msgRef(state.text);
        if (ref !== null && messages) messages[ref] = v;
        else state.text = v;
    }
    function setReply(c: DialogChoice, v: string): void {
        const ref = msgRef(c.text);
        if (ref !== null && messages) messages[ref] = v;
        else c.text = v;
    }

    function targetValue(t: DialogTarget): string {
        if (t.kind === "state") return `state:${t.stateId}`;
        if (t.kind === "exit") return "exit";
        return "ext";
    }
    function onTargetChange(c: DialogChoice, value: string): void {
        if (value === "exit") actions.setTarget(c.id, { kind: "exit" });
        else if (value.startsWith("state:")) actions.setTarget(c.id, { kind: "state", stateId: value.slice("state:".length) });
        // "ext" keeps the existing external target; cross-file retargeting is a later phase.
    }

    function setWeight(v: string): void {
        const n = Number(v);
        state.weight = v.trim() === "" || !Number.isFinite(n) ? undefined : n;
    }

    // SSL is a full scripting language with no surgical write-back, so its detail panel is
    // a read-only SSL-native view (Reply / options / msg / side-effects), not the D editor.
    const ssl = $derived(format === "fallout-ssl");

    // Structure is read-only when the model can't be saved (SSL) or for a derived state
    // (CHAIN/INTERJECT/EXTEND link) with no standalone source span to write back to -
    // editing it would require rewriting the containing construct, which the save does not do.
    const readOnly = $derived(!editable || Boolean(state.derivedFrom));

    // Message text (the NPC line and player replies) persists for both formats - D to the
    // .tra, SSL to the .msg - so it stays editable even when the structure is read-only (SSL).
    // A derived state is still fully read-only (its line is owned by the source construct).
    const textRO = $derived(Boolean(state.derivedFrom) || (!editable && !ssl));

    // For SSL a text field is editable only when it is backed by a RESOLVABLE @N message - an @N
    // whose .msg line actually loaded into `messages` (the line the edit writes to). A literal, a
    // computed id, or an @N whose .msg never resolved (translation dir misconfigured / not indexed)
    // has no line to edit, and SSL save only rewrites the .msg - editing it would set an in-memory
    // literal that silently vanishes on save - so it stays read-only. D persists literal text via the
    // .d splice, so it has no such gate. A just-added (pending) option/node is the exception - it has no
    // .msg entry yet, so `isNew` keeps it editable for the user to type the initial line. (See
    // ./inspector-edit.ts; unit-tested there.)
    function textLocked(text: string | undefined, isNew = false): boolean {
        return textFieldLocked({ text, messages, ssl, textRO, isNew });
    }

    // Grow a textarea to fit its content so nothing hides behind an inner scrollbar. The
    // action parameter is the current display value: passing it makes `update` re-fit when
    // the value changes reactively (a new selection, or a live edit), not just on keystroke.
    function autosize(el: HTMLTextAreaElement) {
        const fit = (): void => {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
        };
        fit();
        el.addEventListener("input", fit);
        return { update: fit, destroy: () => el.removeEventListener("input", fit) };
    }

    // Resolve a branch's choice ids to their DialogChoice objects, preserving source order.
    function branchChoices(b: DialogBranch): DialogChoice[] {
        const byId = new Map(state.choices.map((c) => [c.id, c]));
        return b.choiceIds.map((id) => byId.get(id)).filter((c): c is DialogChoice => c !== undefined);
    }
</script>

<div class="inspector" class:ro={readOnly}>
    <div class="ih">{state.speaker ?? "NPC"}</div>

    {#if state.derivedFrom}
        <div class="ronote">
            Read-only - this state is expanded from a <b>{state.derivedFrom}</b> block. It has no
            standalone source to edit here; change it in the <b>{state.derivedFrom}</b> source directly.
        </div>
    {:else if ssl && structuralEditable}
        <div class="ronote">
            Text edits save to the <b>.msg</b>; structure - <b>rename</b>, <b>retarget</b>,
            <b>reorder</b>, add/remove options, entry status - writes back to the <b>.ssl</b>.
            A condition is editable here when it belongs to one option; a condition shared by
            several options is source-only (edit the <b>.ssl</b>).
        </div>
    {:else if ssl}
        <div class="ronote">
            Text edits save to the <b>.msg</b>. The dialog structure (options, targets,
            conditions) is read-only - this node is not simple enough to edit safely from the graph;
            edit the <b>.ssl</b> source for that.
        </div>
    {/if}

    <div class="ik">{ssl ? "Node" : readOnly ? "State label (read-only)" : "State label (jump target)"}</div>
    <input class="iv code" value={state.id} disabled={!structuralEditable && readOnly} onchange={(e) => actions.rename(e.currentTarget.value)} />

    <div class="ik">{ssl ? "Reply line" : "NPC line"}</div>
    <textarea class="iv" rows="2" use:autosize={resolveText(state.text, messages)} disabled={textLocked(state.text, isPendingState(state))} value={resolveText(state.text, messages)} oninput={(e) => setSay(e.currentTarget.value)}></textarea>

    {#if ssl}
        <!-- SSL: the node's reply condition (its enclosing `if`) and the state-mutating
             builtins it calls. Both read-only; "weight" and the per-choice `DO` action are
             WeiDU D concepts that have no SSL equivalent and are omitted. -->
        <div class="ik">Condition</div>
        <!-- Node-reply condition editing is a follow-up: the parser must capture the Reply
             statement span to support wrap/unwrap; the save path and verify must diff the
             reply condition. Disabled until then - the locked styling and tooltip explain why,
             and the same textarea control as the per-option conditions keeps the two uniform. -->
        <textarea class="iv code cond locked" rows="1" disabled use:autosize={state.trigger ?? ""} title="Node-level condition editing is not supported yet - edit the .ssl source" placeholder="(unconditional)" value={state.trigger ?? ""}></textarea>
        {#if state.sideEffects?.length}
            <div class="ik">Side effects</div>
            <div class="iv sfx">{state.sideEffects.join(", ")}</div>
        {/if}
        {#if structuralEditable}
            <div class="ik">Entry</div>
            <label class="entry-toggle">
                <input
                    type="checkbox"
                    checked={state.isEntry ?? false}
                    disabled={!entryRemovable}
                    onchange={(e) => actions.setEntry(e.currentTarget.checked)}
                />
                Dialog entry (talk_p_proc)
            </label>
        {/if}
    {:else}
        <div class="row2">
            <div>
                <div class="ik">Trigger</div>
                <input class="iv code" disabled={readOnly} value={state.trigger ?? ""} oninput={(e) => (state.trigger = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)} />
            </div>
            <div class="wcol">
                <div class="ik">Weight</div>
                <input class="iv" type="number" disabled={readOnly} value={state.weight ?? ""} oninput={(e) => setWeight(e.currentTarget.value)} />
            </div>
        </div>
    {/if}

    <div class="ik between">
        <span>{ssl ? "Options" : "Transitions"} ({state.choices.length})</span>
        {#if structuralEditable}<button class="add" onclick={actions.addReply}>{ssl ? "+ option" : "+ reply"}</button>{/if}
    </div>

    {#snippet choiceRow(c, i)}
        <div class="trow">
            <div class="trhead">
                <span class="tnum">#{i + 1}</span>
                {#if structuralEditable || !readOnly}
                    <span class="trbtns">
                        <!-- Reorder is available to any structurally-editable node (D or faithful SSL).
                             Remove is available to D (full edit surface) and to a faithful SSL node's
                             UNCONDITIONAL options. A conditional SSL option sits in an `if` wrapper the
                             save path does not rewrite (Tier 3), so its Remove is shown DISABLED (not
                             hidden) with a tooltip - the unavailable action stays visible and explained.
                             Both are suppressed inside bundle branches (within-branch structure is Tier 3b). -->
                        {#if structuralEditable && !state.branches}
                            <button title="Move up" disabled={i === 0} onclick={() => actions.moveReply(c.id, -1)}>&#9650;</button>
                            <button title="Move down" disabled={i === state.choices.length - 1} onclick={() => actions.moveReply(c.id, 1)}>&#9660;</button>
                        {/if}
                        {#if !readOnly}
                            <button title="Remove" class="del" onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                        {:else if ssl && structuralEditable && !state.branches}
                            <button title={c.condition ? "Conditional options are removed in the .ssl source" : "Remove"} class="del" disabled={Boolean(c.condition)} onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                        {/if}
                    </span>
                {/if}
            </div>
            <textarea class="iv reply" rows="1" use:autosize={resolveText(c.text, messages)} disabled={textLocked(c.text, isPendingChoice(c))} placeholder="(no reply - NPC continue)" value={resolveText(c.text, messages)} oninput={(e) => setReply(c, e.currentTarget.value)}></textarea>
            <!-- Inside a bundle branch the condition is already shown once at the branch head
                 ("shown when ..."), so the per-option condition field is omitted to avoid a
                 redundant disabled control on every row. Flat-path render is unchanged. -->
            {#if !state.branches}
                <textarea class="iv code cond" class:locked={ssl && c.conditionEditable === false} rows="1" use:autosize={c.condition ?? ""} disabled={ssl ? !c.conditionEditable : readOnly} title={ssl && c.conditionEditable === false ? "Condition shared by multiple options - edit the .ssl source" : ""} placeholder={ssl ? "(no condition)" : "condition (IF ~...~)"} value={c.condition ?? ""} oninput={(e) => (c.condition = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
                {#if ssl && c.conditionEditable === false}
                    <div class="condnote">shared by other options - edit in <b>.ssl</b></div>
                {/if}
            {/if}
            {#if !ssl && !state.branches}
                <textarea class="iv code act" rows="1" use:autosize={c.action ?? ""} disabled={readOnly} placeholder="action (DO ~...~)" value={c.action ?? ""} oninput={(e) => (c.action = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
            {/if}
            <!-- Retarget is enabled for any structurally-editable node (D, faithful SSL, or bundle SSL). -->
            <select class="iv tgt" disabled={!structuralEditable} value={targetValue(c.target)} onchange={(e) => onTargetChange(c, e.currentTarget.value)}>
                {#if c.target.kind === "external"}
                    <option value="ext">&#8631; {c.target.label}</option>
                {/if}
                <option value="exit">EXIT</option>
                {#each stateIds as id (id)}
                    <option value={`state:${id}`}>&#8594; {id}</option>
                {/each}
            </select>
        </div>
    {/snippet}

    {#if state.branches}
        {#each state.branches as b, bi (bi)}
            <div class="branch">
                <div class="branchhead">{b.kind === "else" ? "otherwise" : `shown when ${b.condition ?? ""}`}</div>
                {#each b.replies as r}
                    <div class="branchreply">{resolveText(r.text, messages) || "(no line)"}</div>
                {/each}
                {#each branchChoices(b) as c (c.id)}
                    {@render choiceRow(c, state.choices.indexOf(c))}
                {/each}
                {#if b.opaque.length > 0}
                    <details class="logic"><summary>logic ({b.opaque.length})</summary>
                        {#each b.opaque as line}<pre class="logicline">{line}</pre>{/each}
                    </details>
                {/if}
            </div>
        {/each}
    {:else}
        {#each state.choices as c, i (c.id)}
            {@render choiceRow(c, i)}
        {/each}
    {/if}

    {#if !readOnly}
        <div class="stateops">
            <button onclick={actions.duplicateState}>Duplicate state</button>
            <button class="del" onclick={actions.deleteState}>Delete state</button>
        </div>
    {:else if ssl && structuralEditable}
        <!-- A faithful SSL node: Duplicate clones the procedure (sharing the source's @N refs, like D) and
             is always offered. Delete is offered only when every inbound reference can be cleaned up on save
             (deletable) - its procedure is removed and inbound options redirect to a terminal NMessage. -->
        <div class="stateops">
            <button onclick={actions.duplicateState}>Duplicate state</button>
            {#if deletable}<button class="del" onclick={actions.deleteState}>Delete state</button>{/if}
        </div>
    {/if}
</div>

<style>
    .inspector {
        width: 280px;
        /* Auto-grows to fit content (textareas autosize), so normal states show with no
           scrollbar. The cap is a last-resort fallback for a pathologically tall state
           (many transitions): only then does it scroll, instead of running its bottom
           controls off-screen. border-box so the cap includes padding+border; the 96px
           leaves room for the panel's top offset (48px in tree mode) plus a bottom gap,
           in both the graph (top-right Panel) and tree (.tovl.tr) placements. */
        box-sizing: border-box;
        max-height: calc(100vh - 96px);
        overflow-y: auto;
        background: #21242b;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        color: #e8eaed;
    }
    .ih {
        color: #22d3ee;
        font-weight: 700;
        font-size: 11px;
        margin-bottom: 6px;
    }
    .ronote {
        background: #2a2620;
        border: 1px solid #a16207;
        border-radius: 4px;
        color: #fbbf24;
        font-size: 10px;
        line-height: 1.35;
        padding: 5px 7px;
        margin-bottom: 6px;
    }
    .ronote b {
        color: #fcd34d;
    }
    .iv:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .ik {
        color: #9aa0a6;
        font-size: 9px;
        text-transform: uppercase;
        margin-top: 8px;
        margin-bottom: 2px;
    }
    .ik.between {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .iv {
        width: 100%;
        box-sizing: border-box;
        background: #15171c;
        border: 1px solid #3a3f4b;
        border-radius: 4px;
        padding: 3px 6px;
        color: #e8eaed;
        font-family: inherit;
        font-size: 11px;
    }
    /* Height is driven by the autosize action so the full value is always visible;
       disable manual resize and the inner scrollbar that would otherwise appear. */
    textarea.iv {
        resize: none;
        overflow: hidden;
    }
    .iv.code {
        color: #f59e0b;
        font-family: monospace;
        font-size: 10px;
    }
    .row2 {
        display: flex;
        gap: 6px;
    }
    .row2 > div {
        flex: 1;
    }
    .row2 .wcol {
        flex: 0 0 64px;
    }
    .trow {
        border: 1px solid #313846;
        border-left: 3px solid #a3e635;
        border-radius: 4px;
        padding: 4px 6px;
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .trhead {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .tnum {
        color: #9aa0a6;
        font-size: 9px;
    }
    .trbtns button,
    .add,
    .stateops button {
        background: #2b303a;
        border: 1px solid #3a3f4b;
        border-radius: 3px;
        color: #cbd5e1;
        font-size: 10px;
        cursor: pointer;
        padding: 1px 5px;
    }
    .trbtns button:disabled {
        opacity: 0.35;
        cursor: default;
    }
    .iv.reply {
        color: #bfe66a;
    }
    .iv.cond {
        color: #f59e0b;
    }
    /* A read-only SSL condition (a shared if-block, or the node-level one pending write-back):
       a dashed border plus a caption make the locked state legible on its own - the disabled
       dimming alone is too subtle on the amber code text, and the hover tooltip is not
       discoverable (a hover-only cue fails to explain why the field cannot be edited). */
    .iv.cond.locked {
        border-style: dashed;
        border-color: #6b7280;
    }
    .condnote {
        color: #9aa0a6;
        font-size: 9px;
        margin-top: 1px;
        padding-left: 2px;
    }
    .condnote b {
        color: #cbd5e1;
    }
    .iv.act {
        color: #c084fc;
    }
    .iv.tgt {
        color: #cbd5e1;
    }
    /* SSL entry toggle: inline label + checkbox, matches the inspector's dim-on-disabled tone. */
    .entry-toggle {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: #e8eaed;
        cursor: pointer;
    }
    .entry-toggle input[type="checkbox"]:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .entry-toggle:has(input:disabled) {
        opacity: 0.5;
        cursor: not-allowed;
    }
    /* SSL side-effects: teal, matching the side-effect badge. Read-only, so a plain box. */
    .iv.sfx {
        color: #22d3ee;
        font-family: monospace;
        font-size: 10px;
        word-break: break-word;
    }
    .stateops {
        display: flex;
        gap: 6px;
        margin-top: 10px;
    }
    .stateops button {
        flex: 1;
        padding: 4px;
    }
    .del {
        color: #fca5a5;
        border-color: #7f1d1d;
    }
    .branch {
        border-left: 2px solid #3a3f44;
        margin: 6px 0 6px 2px;
        padding-left: 6px;
    }
    .branchhead {
        color: #9aa0a6;
        font-size: 10px;
        font-style: italic;
        margin: 2px 0;
    }
    .branchreply {
        color: #cbd5e1;
        font-size: 11px;
        margin: 1px 0;
    }
    .logic {
        color: #9aa0a6;
        font-size: 10px;
        margin-top: 2px;
    }
    .logic summary {
        cursor: pointer;
    }
    .logicline {
        margin: 1px 0;
        color: #c08;
        font-family: var(--vscode-editor-font-family, monospace);
        white-space: pre-wrap;
    }
</style>
