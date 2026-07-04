<script lang="ts">
    import { writable } from "svelte/store";
    import {
        resolveText,
        stateHeadLabel,
        type DialogBranch,
        type DialogChoice,
        type DialogFormat,
        type DialogReaction,
        type DialogState,
        type DialogTarget,
    } from "../../../../shared/dialog-model";
    import { isPendingChoice, isPendingState, msgRef, textFieldLocked } from "./inspector-edit";
    import type { CallerRow } from "./find-callers";

    // The detail panel for the selected state. For an editable format (WeiDU D) it is the
    // edit surface: content fields (SAY, trigger, weight, reply/condition/action) mutate the
    // passed `state`/`messages` directly (reactive editModel proxies, so the card re-renders
    // without a relayout) and structural changes go through `actions`. For a view-only format
    // (Fallout SSL) it is a read-only, SSL-native presentation - SSL is derived from script
    // and has no surgical write-back yet, so editing is disabled and the WeiDU vocabulary
    // (trigger/weight/`DO ~...~`) is replaced or dropped.
    let { state, messages, stateIds, actions, format, editable, structuralEditable, deletable, sourceName, callers, selectedChoiceId, onNavigate }: {
        state: DialogState;
        messages: Record<string, string> | undefined;
        stateIds: string[];
        /** When the user selects an individual option in the tree, its choice id - this panel scrolls to
            and focuses that option's field. Null when a whole state is selected. */
        selectedChoiceId?: string | null;
        /** Dialog file base name -> speaker fallback for the title (see stateHeadLabel). */
        sourceName: string | undefined;
        /** Inbound references to this state (who reaches it), resolved to display rows. */
        callers: CallerRow[];
        /** Select a state (a caller) - switches tab first if it lives in another dialog. */
        onNavigate: (stateId: string) => void;
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
        actions: {
            rename: (newId: string) => void;
            addReply: () => void;
            removeReply: (choiceId: string) => void;
            moveReply: (choiceId: string, dir: -1 | 1) => void;
            setTarget: (choiceId: string, target: DialogTarget) => void;
            setReaction: (choiceId: string, reaction: DialogReaction) => void;
            setLowIq: (choiceId: string, on: boolean) => void;
            deleteState: () => void;
            duplicateState: () => void;
            addReplyToBranch: (branchIndex: number) => void;
            removeReplyInBranch: (branchIndex: number, choiceId: string) => void;
            moveReplyInBranch: (branchIndex: number, choiceId: string, dir: -1 | 1) => void;
            addBranch: (condition: string) => void;
            addElse: () => void;
            removeBranch: (branchIndex: number) => void;
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

    // Narrow the <select>'s raw string value to DialogReaction (rather than casting) - an
    // out-of-vocabulary value (should not occur; the <option>s are fixed) is a silent no-op.
    function onReactionChange(c: DialogChoice, value: string): void {
        if (value === "good" || value === "neutral" || value === "bad") actions.setReaction(c.id, value);
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

    // Inline condition input for adding a new if-branch. A plain `$state("")` local here
    // produced two build warnings in this component: the compiler flagged the ambiguity between
    // the `state` prop binding and the `$state` rune (a `$`-prefixed local named after a prop
    // is treated as a store subscription), leaving the variable non-reactive. A writable store
    // avoids those warnings while providing the same two-way reactive binding.
    const newBranchCond = writable("");

    // Resolve a branch's choice ids to their DialogChoice objects, preserving source order.
    function branchChoices(b: DialogBranch): DialogChoice[] {
        const byId = new Map(state.choices.map((c) => [c.id, c]));
        return b.choiceIds.map((id) => byId.get(id)).filter((c): c is DialogChoice => c !== undefined);
    }

    // When an option is selected in the tree, scroll its row into view here and highlight it (the highlight
    // is the `.choicesel` class on the row). Editing itself happens inline in the tree now, so this no longer
    // steals focus into the panel - it only reveals the matching row. Keyed on `selectedChoiceId` so it fires
    // on each new option pick. The row is found via `document` scoped to `.inspector` rather than a bind:this
    // ref for two reasons: a `$state` ref miscompiles to a store auto-subscription here (this component has a
    // `state` prop that shadows the rune - store_invalid_shape at runtime, the same reason the branch input
    // above uses `writable`), and a plain-`let` bind:this ref trips oxlint no-unassigned-vars (it can't see
    // the template assignment). Exactly one `.inspector` is mounted at a time (the shared siderail), so the
    // query is unambiguous.
    $effect(() => {
        if (!selectedChoiceId) return;
        document.querySelector(`.inspector .trow[data-cid="${CSS.escape(selectedChoiceId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
</script>

<div class="inspector" class:ro={readOnly}>
    <!-- SSL nodes carry no speaker, so fall back to the node id (as the cards do) rather than a
         meaningless "NPC" title; WeiDU D shows its real speaker name. -->
    <div class="ih">{stateHeadLabel(state, sourceName)}</div>

    {#if state.derivedFrom}
        <div class="ronote">
            Read-only - this state is expanded from a <b>{state.derivedFrom}</b> block. It has no
            standalone source to edit here; change it in the <b>{state.derivedFrom}</b> source directly.
        </div>
    {:else if ssl && structuralEditable && state.branches}
        <div class="ronote">
            Text edits save to the <b>.msg</b>; each branch's <b>condition</b>, option <b>retarget</b>,
            and <b>add/remove/reorder</b> options write back to the <b>.ssl</b>.
            Branch side-effects are source-only - edit the <b>.ssl</b> for those.
        </div>
    {:else if ssl && structuralEditable}
        <div class="ronote">
            Text edits save to the <b>.msg</b>; structure - <b>rename</b>, <b>retarget</b>,
            <b>reorder</b>, add/remove options - writes back to the <b>.ssl</b>.
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

    <div class="ik">{ssl ? "State" : readOnly ? "State label (read-only)" : "State label (jump target)"}</div>
    <input class="iv code" value={state.id} disabled={!structuralEditable && readOnly} onchange={(e) => actions.rename(e.currentTarget.value)} />

    {#if !state.branches}
        <!-- A bundle node shows its NPC line per branch below ("shown when ..." sections); the node-level
             reply field would duplicate it (and only the first branch's line), so omit it for bundle nodes. -->
        <div class="ik">NPC line</div>
        <textarea class="iv npc" rows="2" use:autosize={resolveText(state.text, messages)} disabled={textLocked(state.text, isPendingState(state))} value={resolveText(state.text, messages)} oninput={(e) => setSay(e.currentTarget.value)}></textarea>
    {/if}

    {#if ssl}
        <!-- SSL: the node's reply condition (its enclosing `if`) and the state-mutating
             builtins it calls. Both read-only; "weight" and the per-choice `DO` action are
             WeiDU D concepts that have no SSL equivalent and are omitted. -->
        {#if !state.branches}
            <!-- For a bundle node the condition is shown per branch ("shown when ...") and side-effects in
                 each branch's logic drawer; the node-level fields would duplicate (first branch only), so
                 omit them for bundle nodes. -->
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

    <!-- Add lives as a trailing "+" at the END of the options list (below), so adding reads as "append to
         this list". Each option row carries its own delete (the row's x). Bundle nodes add per branch. -->
    <div class="ik">Options ({state.choices.length})</div>

    {#snippet choiceRow(c, i, bi, branchLen)}
        <!-- data-cid + choicesel drive the tree's option selection: picking an option in the tree scrolls
             this row into view, highlights it, and focuses its text field. Only flat options (bi undefined)
             are selectable from the tree; branch options stay read-only there. -->
        <div class="trow" data-cid={c.id} class:choicesel={bi === undefined && c.id === selectedChoiceId}>
            <div class="trhead">
                <span class="tnum">#{i + 1}</span>
                {#if structuralEditable || !readOnly}
                    <span class="trbtns">
                        {#if bi !== undefined}
                            <!-- Branch-scoped controls: move bounds are branch-relative so the option
                                 cannot cross into an adjacent branch. Remove is unconditional at the
                                 branch level (branch conditions live at the branch head, not per-option). -->
                            {#if structuralEditable}
                                <button title="Move up" disabled={i === 0} onclick={() => actions.moveReplyInBranch(bi, c.id, -1)}>&#9650;</button>
                                <button title="Move down" disabled={branchLen === undefined || i >= branchLen - 1} onclick={() => actions.moveReplyInBranch(bi, c.id, 1)}>&#9660;</button>
                                <button title="Remove" class="del" onclick={() => actions.removeReplyInBranch(bi, c.id)}>&#10005;</button>
                            {/if}
                        {:else}
                            <!-- Flat-path controls (D or faithful non-bundle SSL): unchanged. -->
                            <!-- Reorder is available to any structurally-editable node (D or faithful SSL).
                                 Remove is available to D (full edit surface) and to a faithful SSL node's
                                 UNCONDITIONAL options. A conditional SSL option sits in an `if` wrapper the
                                 save path does not rewrite (Tier 3), so its Remove is shown DISABLED (not
                                 hidden) with a tooltip - the unavailable action stays visible and explained. -->
                            {#if structuralEditable && !state.branches}
                                <button title="Move up" disabled={i === 0} onclick={() => actions.moveReply(c.id, -1)}>&#9650;</button>
                                <button title="Move down" disabled={i === state.choices.length - 1} onclick={() => actions.moveReply(c.id, 1)}>&#9660;</button>
                            {/if}
                            {#if !readOnly}
                                <button title="Remove" class="del" onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                            {:else if ssl && structuralEditable && !state.branches}
                                <button title={c.condition ? "Conditional options are removed in the .ssl source" : "Remove"} class="del" disabled={Boolean(c.condition)} onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                            {/if}
                        {/if}
                    </span>
                {/if}
            </div>
            <textarea class="iv reply" rows="1" use:autosize={resolveText(c.text, messages)} disabled={textLocked(c.text, isPendingChoice(c))} placeholder="(no option text - continue)" value={resolveText(c.text, messages)} oninput={(e) => setReply(c, e.currentTarget.value)}></textarea>
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
            {#if ssl && c.reaction !== undefined}
                <!-- SSL only: reaction (N/G/B) and the low-INT variant are both carried in the
                     option's source macro name (NOption/GLowOption/...; dialog-ssl-serialize.ts) -
                     editing either rewrites that macro call in place on save. Not shown for D,
                     which has no reaction/low-INT concept. -->
                <div class="rctrow">
                    <span class="rctlbl">Reaction</span>
                    <select class="iv rct" disabled={!structuralEditable} value={c.reaction} onchange={(e) => onReactionChange(c, e.currentTarget.value)}>
                        <option value="good">Good</option>
                        <option value="neutral">Neutral</option>
                        <option value="bad">Bad</option>
                    </select>
                    <label class="lowlbl">
                        <input type="checkbox" checked={Boolean(c.lowIq)} disabled={!structuralEditable} onchange={(e) => actions.setLowIq(c.id, e.currentTarget.checked)} />
                        Low INT
                    </label>
                </div>
            {/if}
        </div>
    {/snippet}

    {#if state.branches}
        {#each state.branches as b, bi (bi)}
            {@const bcs = branchChoices(b)}
            <div class="branch">
                {#if b.kind === "else"}
                    <div class="branchhead">
                        <span>otherwise</span>
                        {#if structuralEditable}
                            <!-- Side-effect branches cannot be removed from the graph; the
                                 save path would have no way to cleanly splice out the opaque
                                 statements. Show the button disabled with an explanation so
                                 the unavailable action is visible and explained, not hidden. -->
                            <button
                                class="branchremove"
                                disabled={b.opaque.length > 0}
                                title={b.opaque.length > 0 ? "This branch runs side-effects; remove it in the .ssl source" : "Remove branch"}
                                onclick={() => actions.removeBranch(bi)}
                            >&#10005;</button>
                        {/if}
                    </div>
                {:else}
                    <div class="branchhead">
                        <span class="branchlabel">shown when</span>
                        <input
                            class="iv code branchcond"
                            value={b.condition ?? ""}
                            disabled={!structuralEditable}
                            placeholder="(condition)"
                            oninput={(e) => (b.condition = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}
                        />
                        {#if structuralEditable}
                            <button
                                class="branchremove"
                                disabled={b.opaque.length > 0}
                                title={b.opaque.length > 0 ? "This branch runs side-effects; remove it in the .ssl source" : "Remove branch"}
                                onclick={() => actions.removeBranch(bi)}
                            >&#10005;</button>
                        {/if}
                    </div>
                {/if}
                {#if b.replies.length > 0}
                    <div class="ik branchnpc">NPC</div>
                    {#each b.replies as r}
                        <div class="branchreply">{resolveText(r.text, messages) || "(no line)"}</div>
                    {/each}
                {/if}
                {#each bcs as c, bci (c.id)}
                    {@render choiceRow(c, bci, bi, bcs.length)}
                {/each}
                {#if structuralEditable && b.insertAnchor}
                    <button class="add branchadd" onclick={() => actions.addReplyToBranch(bi)}>+ option</button>
                {/if}
                {#if b.opaque.length > 0}
                    <details class="logic"><summary>side effects ({b.opaque.length})</summary>
                        {#each b.opaque as line}<pre class="logicline">{line}</pre>{/each}
                    </details>
                {/if}
            </div>
        {/each}
        {#if structuralEditable}
            <!-- Add a new if-branch: the condition is required (an if without a condition
                 is not valid SSL). The button is disabled until a non-empty condition is typed.
                 $newBranchCond is a writable store - see the declaration comment above. -->
            <div class="branchadd-row">
                <input
                    class="iv code branchcond"
                    bind:value={$newBranchCond}
                    placeholder="condition for new if branch"
                />
                <button
                    class="add"
                    disabled={$newBranchCond.trim() === ""}
                    onclick={() => { actions.addBranch($newBranchCond.trim()); newBranchCond.set(""); }}
                >+ if</button>
            </div>
            <!-- Add an else-branch only when there is exactly one if-branch and no else yet.
                 The op enforces the same precondition; the button visibility keeps the UI consistent. -->
            {#if state.branches.length === 1 && state.branches[0]?.kind === "if"}
                <button class="add branchadd" onclick={actions.addElse}>+ else</button>
            {/if}
        {/if}
    {:else}
        {#each state.choices as c, i (c.id)}
            {@render choiceRow(c, i)}
        {/each}
        {#if structuralEditable}
            <button class="add addrow" onclick={actions.addReply} title="Add an option">+</button>
        {/if}
    {/if}

    <!-- Reverse references (find-callers): what reaches this state - the cross-reference a modder needs
         before editing or renaming a node, which the raw-text workflow does with a project grep. Option/call
         rows navigate to the referencing state; the entry rows are informational. An empty list means the
         node is an orphan (nothing reaches it). -->
    <div class="ik">Referenced by ({callers.length})</div>
    {#if callers.length === 0}
        <div class="refnote">Nothing in this file reaches this state (an orphan / unreachable node).</div>
    {:else}
        <div class="refs">
            {#each callers as ref, i (i)}
                {#if ref.fromStateId}
                    <button class="ref" title="Go to {ref.fromStateId}" onclick={() => onNavigate(ref.fromStateId!)}>{ref.label}</button>
                {:else}
                    <div class="ref static" title="Reached from outside the dialog procedures">{ref.label}</div>
                {/if}
            {/each}
        </div>
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
        /* Fills the docked rail (DialogGraph.svelte `.siderail`), which owns the width cap and the
           scroll. Formerly a fixed 280px floating panel with a max-height reserved to clear the
           bottom-right minimap - obsolete now the inspector docks beside the canvas rather than
           floating over it. */
        width: 100%;
        box-sizing: border-box;
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
        border-left: 3px solid #64748b;
        border-radius: 4px;
        padding: 4px 6px;
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    /* The option selected from the tree: blue left accent + faint fill, matching the tree row's blue
       selection, so the same option reads as selected in both panels. */
    .trow.choicesel {
        border-left-color: #3b82f6;
        background: #18202f;
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
    /* Trailing "+" that appends an option to the end of the list - full-width and dashed so it reads as an
       add affordance at the bottom of the list rather than another option row. */
    .addrow {
        width: 100%;
        margin-top: 4px;
        border-style: dashed;
        font-size: 12px;
        line-height: 1.4;
    }
    /* Reverse-reference rows (find-callers). A referencing option/call is a clickable row that navigates to
       it; an entry row is static. Neutral grey accent for a normal ref, amber for an external entry. */
    .refnote {
        color: #9aa0a6;
        font-size: 10px;
        font-style: italic;
        padding: 2px 0;
    }
    .refs {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .ref {
        display: block;
        width: 100%;
        text-align: left;
        background: #21242b;
        border: 1px solid #2b303a;
        border-left: 3px solid #64748b;
        border-radius: 3px;
        color: #cbd5e1;
        font-size: 10px;
        padding: 3px 6px;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ref:hover {
        border-color: #3b82f6;
        color: #fff;
    }
    .ref.static {
        cursor: default;
        color: #9aa0a6;
        border-left-color: #f59e0b;
    }
    /* NPC line = blue (blue-300), matching the graph card and tree; player option text = neutral grey
       (slate-300), overridden to green/red by the per-option reaction chip. */
    .iv.npc {
        color: #93c5fd;
    }
    .iv.reply {
        color: #cbd5e1;
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
    /* Reaction (N/G/B) + low-INT toggle: one compact row, checkbox pinned to the right
       edge (matches .branchremove's margin-left: auto). */
    .rctrow {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        flex-wrap: wrap;
    }
    .rctlbl {
        color: #9aa0a6;
        font-size: 9px;
        text-transform: uppercase;
    }
    .iv.rct {
        width: auto;
        padding: 2px 4px;
        color: #cbd5e1;
    }
    .lowlbl {
        display: flex;
        align-items: center;
        gap: 4px;
        color: #cbd5e1;
        font-size: 10px;
        cursor: pointer;
        margin-left: auto;
    }
    .lowlbl input {
        margin: 0;
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
        border: 1px solid #3a3f44;
        border-left: 3px solid #5a6270;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.02);
        margin: 8px 0;
        padding: 4px 7px 7px;
    }
    .branchhead {
        color: #b9c0c8;
        font-size: 10px;
        font-weight: 600;
        font-style: italic;
        margin: 2px 0 4px;
        display: flex;
        align-items: center;
    }
    .branchlabel {
        color: #b9c0c8;
        font-size: 10px;
        font-style: italic;
        margin-right: 4px;
    }
    .branchcond {
        width: auto;
        min-width: 60%;
        font-size: 10px;
        padding: 1px 4px;
    }
    .branchnpc {
        margin-top: 2px;
    }
    .branchreply {
        color: #cbd5e1;
        font-size: 11px;
        margin: 1px 0 4px;
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
    /* "+ option" button inside a branch - a little top margin to separate from the last choice row. */
    .branchadd {
        margin-top: 5px;
    }
    /* Remove-branch button: compact destructive action pinned to the right of the branch head.
       Disabled (not hidden) when the branch has side-effects that cannot be spliced out safely. */
    .branchremove {
        background: #2b303a;
        border: 1px solid #7f1d1d;
        border-radius: 3px;
        color: #fca5a5;
        font-size: 9px;
        cursor: pointer;
        padding: 1px 5px;
        flex-shrink: 0;
        margin-left: auto;
    }
    .branchremove:disabled {
        opacity: 0.35;
        cursor: default;
    }
    /* Row that holds the new-branch condition input and the "+ if" button side by side. */
    .branchadd-row {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
    }
    .branchadd-row input {
        flex: 1;
        min-width: 0;
    }
    /* Dim the "+ if" button when no condition has been typed yet. */
    .add:disabled {
        opacity: 0.35;
        cursor: default;
    }
</style>
