<script lang="ts">
    import {
        resolveText,
        type DialogChoice,
        type DialogFormat,
        type DialogState,
        type DialogTarget,
    } from "../../../../shared/dialog-model";

    // The detail panel for the selected state. For an editable format (WeiDU D) it is the
    // edit surface: content fields (SAY, trigger, weight, reply/condition/action) mutate the
    // passed `state`/`messages` directly (reactive editModel proxies, so the card re-renders
    // without a relayout) and structural changes go through `actions`. For a view-only format
    // (Fallout SSL) it is a read-only, SSL-native presentation - SSL is derived from script
    // and has no surgical write-back yet, so editing is disabled and the WeiDU vocabulary
    // (trigger/weight/`DO ~...~`) is replaced or dropped.
    let { state, messages, stateIds, actions, format, editable, structuralEditable }: {
        state: DialogState;
        messages: Record<string, string> | undefined;
        stateIds: string[];
        format: DialogFormat;
        editable: boolean;
        // Per-node structural editability. For D it tracks `editable`; for SSL it is true only on
        // a faithful node, which gains the Tier 1 structural ops (retarget + reorder) while the
        // rest of the D edit surface (rename, add/remove option, condition/action, duplicate/delete)
        // stays read-only - those are D-only or later SSL tiers the save path can't persist yet.
        structuralEditable: boolean;
        actions: {
            rename: (newId: string) => void;
            addReply: () => void;
            removeReply: (choiceId: string) => void;
            moveReply: (choiceId: string, dir: -1 | 1) => void;
            setTarget: (choiceId: string, target: DialogTarget) => void;
            deleteState: () => void;
            duplicateState: () => void;
        };
    } = $props();

    // A bare `@N` line is backed by a .tra entry: edit that entry so localization is
    // preserved (the project decision). A literal line is edited in place.
    function refOf(text: string | undefined): string | null {
        const m = /^@(\d+)$/.exec((text ?? "").trim());
        return m ? m[1]! : null;
    }
    function setSay(v: string): void {
        const ref = refOf(state.text);
        if (ref !== null && messages) messages[ref] = v;
        else state.text = v;
    }
    function setReply(c: DialogChoice, v: string): void {
        const ref = refOf(c.text);
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

    // For SSL a text field is editable only when it is backed by a resolvable @N message
    // (the .msg line the edit writes to). A textless/continue option or a computed id has no
    // line to edit, and SSL save only rewrites the .msg - editing it would set an in-memory
    // literal that silently vanishes on save - so it stays read-only. D persists literal text
    // via the .d splice, so it has no such gate.
    function textLocked(text: string | undefined): boolean {
        return textRO || (ssl && refOf(text) === null);
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
            Text edits save to the <b>.msg</b>. You can <b>retarget</b> and <b>reorder</b> options here -
            they write back to the <b>.ssl</b>. Other structural changes (add/remove options,
            conditions) still need the source.
        </div>
    {:else if ssl}
        <div class="ronote">
            Text edits save to the <b>.msg</b>. The dialog structure (options, targets,
            conditions) is read-only - this node is not simple enough to edit safely from the graph;
            edit the <b>.ssl</b> source for that.
        </div>
    {/if}

    <div class="ik">{ssl ? "Node" : readOnly ? "State label (read-only)" : "State label (jump target)"}</div>
    <input class="iv code" value={state.id} disabled={readOnly} onchange={(e) => actions.rename(e.currentTarget.value)} />

    <div class="ik">{ssl ? "Reply line" : "NPC line"}</div>
    <textarea class="iv" rows="2" use:autosize={resolveText(state.text, messages)} disabled={textLocked(state.text)} value={resolveText(state.text, messages)} oninput={(e) => setSay(e.currentTarget.value)}></textarea>

    {#if ssl}
        <!-- SSL: the node's reply condition (its enclosing `if`) and the state-mutating
             builtins it calls. Both read-only; "weight" and the per-choice `DO` action are
             WeiDU D concepts that have no SSL equivalent and are omitted. -->
        <div class="ik">Condition</div>
        <input class="iv code" disabled value={state.trigger ?? ""} placeholder="(unconditional)" />
        {#if state.sideEffects?.length}
            <div class="ik">Side effects</div>
            <div class="iv sfx">{state.sideEffects.join(", ")}</div>
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
        {#if !readOnly}<button class="add" onclick={actions.addReply}>+ reply</button>{/if}
    </div>

    {#each state.choices as c, i (c.id)}
        <div class="trow">
            <div class="trhead">
                <span class="tnum">#{i + 1}</span>
                {#if structuralEditable || !readOnly}
                    <span class="trbtns">
                        <!-- Reorder is a Tier 1 op available to any structurally-editable node (D
                             or faithful SSL). Remove is a D-only / later-tier op, so it stays
                             gated on the full edit surface (`!readOnly`). -->
                        {#if structuralEditable}
                            <button title="Move up" disabled={i === 0} onclick={() => actions.moveReply(c.id, -1)}>&#9650;</button>
                            <button title="Move down" disabled={i === state.choices.length - 1} onclick={() => actions.moveReply(c.id, 1)}>&#9660;</button>
                        {/if}
                        {#if !readOnly}
                            <button title="Remove" class="del" onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                        {/if}
                    </span>
                {/if}
            </div>
            <textarea class="iv reply" rows="1" use:autosize={resolveText(c.text, messages)} disabled={textLocked(c.text)} placeholder="(no reply - NPC continue)" value={resolveText(c.text, messages)} oninput={(e) => setReply(c, e.currentTarget.value)}></textarea>
            <textarea class="iv code cond" rows="1" use:autosize={c.condition ?? ""} disabled={readOnly} placeholder={ssl ? "condition" : "condition (IF ~...~)"} value={c.condition ?? ""} oninput={(e) => (c.condition = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
            {#if !ssl}
                <textarea class="iv code act" rows="1" use:autosize={c.action ?? ""} disabled={readOnly} placeholder="action (DO ~...~)" value={c.action ?? ""} oninput={(e) => (c.action = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
            {/if}
            <!-- Retarget is a Tier 1 op: enabled for any structurally-editable node (D or faithful SSL). -->
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
    {/each}

    {#if !readOnly}
        <div class="stateops">
            <button onclick={actions.duplicateState}>Duplicate state</button>
            <button class="del" onclick={actions.deleteState}>Delete state</button>
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
    .iv.act {
        color: #c084fc;
    }
    .iv.tgt {
        color: #cbd5e1;
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
</style>
