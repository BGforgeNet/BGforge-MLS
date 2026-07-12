<script lang="ts">
    import { writable } from "svelte/store";
    import {
        resolveText,
        sslTerminalKind,
        stateHeadLabel,
        type DialogBlock,
        type DialogBranch,
        type DialogChoice,
        type RenderFamily,
        type DialogState,
        type DialogTarget,
    } from "../../../../shared/dialog-model";
    import type { DialogActions } from "./dialog-actions";
    import {
        conditionLockReason,
        optionRemoveLockReason,
        sayLineEditability,
        stateReadOnlyReason,
        structuralLockReason,
        textEditability,
        writeText,
    } from "./inspector-edit";
    import type { CallerRow } from "./find-callers";
    import type { Reachability } from "../../../../shared/dialog-reachability";
    import { autosize } from "./autosize";

    // The detail panel for the selected state. For an editable format (WeiDU D) it is the
    // edit surface: content fields (SAY, trigger, weight, reply/condition/action) mutate the
    // passed `state`/`messages` directly (reactive editModel proxies, so the card re-renders
    // without a relayout) and structural changes go through `actions`. For a view-only format
    // (Fallout SSL) it is a read-only, SSL-native presentation - SSL is derived from script
    // and has no surgical write-back yet, so editing is disabled and the WeiDU vocabulary
    // (trigger/weight/`DO ~...~`) is replaced or dropped.
    let { state, messages, stateIds, actions, format, editable, structuralEditable, deletable, sourceName, callers, reachability, selectedChoiceId, highlightedBranchKey, onNavigate, onFocusOwnerState }: {
        state: DialogState;
        messages: Record<string, string> | undefined;
        stateIds: string[];
        /** When the user selects an individual option in the tree, its choice id - this panel scrolls to
            and focuses that option's field. Null when a whole state is selected. */
        selectedChoiceId?: string | null;
        /** The tree's highlighted if/else branch key (set by clicking a branch line), or null. For a
            structured node the matching branch section is tinted and scrolled into view. */
        highlightedBranchKey?: string | null;
        /** Dialog file base name -> speaker fallback for the title (see stateHeadLabel). */
        sourceName: string | undefined;
        /** Inbound references to this state (who reaches it), resolved to display rows. */
        callers: CallerRow[];
        /** Reachability class (from classifyReachability): distinguishes a genuine orphan (has inbound refs
            yet no path from an entry) from an entry point with no in-file inbound (external-entry / the dialog's
            own start). Drives the "Referenced by" note so a normal WeiDU-D / EXTERN entry is not called dead. */
        reachability?: Reachability;
        /** Select a state (a caller) - switches tab first if it lives in another dialog. */
        onNavigate: (stateId: string) => void;
        /** Leave the focused-option view and re-select the whole owner state (the breadcrumb's state crumb). */
        onFocusOwnerState: () => void;
        format: RenderFamily;
        editable: boolean;
        // Per-node editability (`nodeEditable`): field AND structural edits both round-trip to source - the two
        // coincide now, so this is the single gate (retarget, reorder, add/remove option, and the reaction/low-INT
        // and rename/duplicate ops the save path persists). A faithful SSL/TSSL node, a bundle, a locally-new node,
        // or a non-derived faithful D/TD state. Delete is gated separately by `deletable` below.
        structuralEditable: boolean;
        // Whether this node can be deleted (D: any non-derived; faithful SSL: only when every inbound
        // reference can be cleaned up on save - see DialogGraph canDelete / eligibleToDelete). Gates the
        // Delete button's visibility in BOTH family branches below.
        deletable: boolean;
        actions: DialogActions;
    } = $props();

    // A bare `@N` line is backed by a .tra entry: edit that entry so localization is
    // preserved (the project decision). A literal line is edited in place.
    function setSay(v: string): void {
        writeText(state, messages, v);
    }
    function setReply(c: DialogChoice, v: string): void {
        writeText(c, messages, v);
    }
    // Write ONE continuation line (index >= 1) of a multisay `SAY @a = @b = @c` state. Same write path as any
    // line: an @N line edits its .msg/.tra entry (the raw ref in sayTexts is unchanged, so the .d source keeps
    // `@a=@b=@c`); a literal line updates sayTexts[i] in place, which the writer's serializeSayValue re-joins.
    // Line 0 is the primary `text` field above - the writer reads `text` for it and `sayTexts[1..]` for the rest.
    function setSayLine(i: number, v: string): void {
        if (!state.sayTexts) return;
        const t = { text: state.sayTexts[i] };
        writeText(t, messages, v);
        state.sayTexts[i] = t.text ?? "";
    }

    // A `.msg`/`.tra` line is single-line, but these fields are <textarea>s (they wrap/autosize long lines for
    // reading). Enter commits (blur) rather than inserting a newline - parity with the tree's inline <input>,
    // and it keeps a stray newline from ever entering the value. Shift+Enter is left to the browser as an
    // escape hatch; writeText folds any newline out on write, so even that can't break the single-line entry.
    function commitOnEnter(e: KeyboardEvent): void {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
        }
    }

    function targetValue(t: DialogTarget): string {
        if (t.kind === "state") {
            // SSL: a Node998/Node999 target is presented as the Combat/Exit picker value, not a raw state id
            // (matching how the tree/graph render it), so the <select> shows COMBAT/EXIT selected.
            if (ssl) {
                const term = sslTerminalKind(t.stateId);
                if (term) return term; // "exit" | "combat"
            }
            return `state:${t.stateId}`;
        }
        if (t.kind === "exit") return "exit";
        return "ext";
    }
    function onTargetChange(c: DialogChoice, value: string): void {
        if (value === "exit") actions.setTarget(c.id, { kind: "exit" });
        // SSL Combat is the Node998 target (the save ensures the procedure exists); Exit stays the plain
        // terminal (NMessage), always valid without a support node. `ssl`-gated so a D dialog can never map to
        // Combat even if "combat" reached here (its <option> is SSL-only; this is the matching guard).
        else if (ssl && value === "combat") actions.setTarget(c.id, { kind: "state", stateId: "Node998" });
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

    // Text saves to the message file of the family (.msg for SSL, .tra for D) - a separate file from the
    // source, so it is named concretely; structure edits just say "the source file" (the one the user opened).
    const textFile = $derived(ssl ? ".msg" : ".tra");

    // Structure is read-only when the model can't be saved (SSL) or for a derived state
    // (CHAIN/INTERJECT/EXTEND link) with no standalone source span to write back to -
    // editing it would require rewriting the containing construct, which the save does not do.
    const readOnly = $derived(!editable || Boolean(state.derivedFrom));

    // Concrete, actionable reasons for the disabled controls, computed once per state (see inspector-edit.ts).
    // Every disabled control binds its `title` to the matching reason so a locked field always explains why.
    const structReason = $derived(structuralLockReason(state, ssl, editable));
    const roReason = $derived(stateReadOnlyReason(state.derivedFrom));

    // When the user selects an individual option in the tree, the Inspector FOCUSES that option: a breadcrumb
    // back to the owner state, then just that option's fields (rendered by the shared choiceRow snippet in
    // `labeled` mode) instead of the whole-state editor. Only flat options are tree-selectable (branch options
    // are read-only there), so this is scoped to a non-bundle state; `selectedChoiceId` then always names one
    // of `state.choices`. If the id doesn't resolve (e.g. stale after a delete), fall back to the full view.
    // A structured node (`block`) renders its options through a dedicated read-only summary, exactly like a
    // bundle node (`branches`); excluding both keeps a clicked option on a structured node out of the flat
    // "focused option" template (dashed disabled inputs with no explanation banner) and in its own read-only view.
    const focusedChoice = $derived(
        !state.branches && !state.block && selectedChoiceId
            ? state.choices.find((c) => c.id === selectedChoiceId)
            : undefined,
    );
    const focusedIndex = $derived(focusedChoice ? state.choices.findIndex((c) => c.id === selectedChoiceId) : -1);

    // The ONE text-field gate for this inspector, shared by the NPC line and every option row: it returns the
    // lock AND its reason together so the template never re-assembles `textFieldLocked`'s inputs (the seam where
    // the +State bug lived). `choice === null` selects the node's NPC line; a choice selects that option's text.
    // See textEditability in ./inspector-edit.ts for the SSL/@N/authorable rules; unit-tested there.
    function textEdit(choice: DialogChoice | null): { editable: boolean; reason: string } {
        // The inspector locks text only on a derived (no-own-source) state; a D-family literal otherwise stays
        // editable even when the STRUCTURE is read-only (a .tra edit is structure-independent - a typo in an
        // unfaithful TD state's line can still be fixed). SSL's own @N gate lives inside textEditability.
        return textEditability({ state, choice, messages, ssl, textRO: Boolean(state.derivedFrom) });
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

    type InspectorSection = { key: string; kind: "if" | "else" | "always"; condition?: string; npc?: string; choices: DialogChoice[] };
    // A STRUCTURED node's recursive block, flattened into read-only inspector sections: one per TOP-LEVEL if/else
    // branch (choices gated by that branch, nested ones flattened but keeping their own condition), plus an
    // "(always)" section for unconditional top-level options. The section keys match the tree's branch keys
    // (conversation-tree stampBranchKeys), so `highlightedBranchKey` tints the section for the clicked branch.
    const inspectorBranches = $derived.by((): InspectorSection[] => {
        const block = state.block;
        if (!block) return [];
        const byId = new Map(state.choices.map((c) => [c.id, c]));
        const collect = (b: DialogBlock): DialogChoice[] =>
            b.flatMap((it) => {
                if (it.kind === "choice") return byId.get(it.choiceId) ? [byId.get(it.choiceId)!] : [];
                if (it.kind === "group") return [...collect(it.thenBlock), ...(it.elseBlock ? collect(it.elseBlock) : [])];
                return [];
            });
        const firstLine = (b: DialogBlock): string | undefined => {
            const l = b.find((it) => it.kind === "line");
            return l ? resolveText(l.text, messages) : undefined;
        };
        const sections: InspectorSection[] = [];
        const always: DialogChoice[] = [];
        let gi = 0;
        for (const it of block) {
            if (it.kind === "choice") {
                const c = byId.get(it.choiceId);
                if (c) always.push(c);
            } else if (it.kind === "group") {
                sections.push({ key: `${state.id}#${gi}if`, kind: "if", condition: it.condition, npc: firstLine(it.thenBlock), choices: collect(it.thenBlock) });
                if (it.elseBlock)
                    sections.push({ key: `${state.id}#${gi}else`, kind: "else", condition: `not ${it.condition}`, npc: firstLine(it.elseBlock), choices: collect(it.elseBlock) });
                gi++;
            }
        }
        if (always.length > 0) sections.push({ key: "", kind: "always", choices: always });
        return sections;
    });
    // A section is highlighted when the clicked branch key falls within it (starts with the section's key), so
    // clicking a nested branch tints its containing top-level section. The "(always)" section (key "") never tints.
    function sectionHl(key: string): boolean {
        return Boolean(key && highlightedBranchKey && highlightedBranchKey.startsWith(key));
    }
    // Short target label for a read-only branch option (mirrors the tree's arrow chips).
    function targetLabel(t: DialogTarget): string {
        if (t.kind === "exit") return "EXIT";
        if (t.kind === "state") return t.stateId;
        if (t.kind === "external") return t.label;
        return "?";
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
    // Scroll the clicked branch's section into view (mirrors the option scroll above). Keyed on
    // highlightedBranchKey so it fires each time a different branch line is clicked.
    $effect(() => {
        if (!highlightedBranchKey) return;
        document
            .querySelector(`.inspector .binspbranch[data-bkey="${CSS.escape(highlightedBranchKey)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    });
</script>

<div class="inspector" class:ro={readOnly}>
    {#if focusedChoice}
        <!-- Focused-option view: a breadcrumb back to the owner state, then just this option's fields
             (rendered by the shared choiceRow snippet in `labeled` mode, below - so its edit-gating stays
             the single source of truth). The state crumb clears the option focus and returns to the
             whole-state editor. -->
        <div class="ih crumbs">
            <button class="crumb" title="Back to the whole state" onclick={onFocusOwnerState}>{stateHeadLabel(state, sourceName)}</button>
            <span class="crumbsep">&#8250;</span>
            <span class="crumbcur">option #{focusedIndex + 1}</span>
        </div>
    {:else}
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
            Text edits save to the <b>{textFile}</b>; each branch's <b>condition</b>, option <b>retarget</b>,
            and <b>add/remove/reorder</b> options write back to the <b>source file</b>.
            Branch side-effects are source-only - edit the <b>source file</b> for those.
        </div>
    {:else if ssl && structuralEditable}
        <div class="ronote">
            Text edits save to the <b>{textFile}</b>; structure - <b>rename</b>, <b>retarget</b>,
            <b>reorder</b>, add/remove options - writes back to the <b>source file</b>.
            A condition is editable here when it belongs to one option; a condition shared by
            several options is source-only (edit the <b>source file</b>).
        </div>
    {:else if ssl && state.approximate}
        <!-- Approximate node: the shown tree is not just read-only, it is LOSSY - control flow the editor can't
             model (loop/switch) means only the first line + a flattened option list are shown. Say so loudly. -->
        <div class="ronote">
            <b>Approximate view.</b> This node uses control flow (a loop or switch) the editor can't fully
            model, so the tree shown is a simplification - not everything here is represented. Read the
            <b>source file</b> for the full logic. Text edits still save to the <b>{textFile}</b>.
        </div>
    {:else if ssl}
        <div class="ronote">
            Text edits save to the <b>{textFile}</b>. The dialog structure (options, targets,
            conditions) is read-only - this node is not simple enough to edit safely from the graph;
            edit the <b>source file</b> for that.
        </div>
    {:else if !structuralEditable}
        <!-- D-family (D/TD) node the parser could not fully model (an inner if/else it can't round-trip), so its
             structure is read-only. Text still saves (a .tra edit is structure-independent). -->
        <div class="ronote">
            Text edits save to the <b>{textFile}</b>. The dialog <b>structure</b> is read-only - this state uses a
            conditional branch (an <code>if</code>/<code>else</code>) the editor can't fully model yet; edit the
            <b>source file</b> for that.
        </div>
    {/if}

    <!-- Read-only label only when the id input actually IS read-only (same condition as its `disabled` below):
         a structurally-editable node (D, or a faithful td/tssl node) can be renamed, so it is a jump target. -->
    <div class="ik">{ssl ? "State" : !structuralEditable && readOnly ? "State label (read-only)" : "State label (jump target)"}</div>
    <input class="iv code" value={state.id} disabled={!structuralEditable && readOnly} title={!structuralEditable && readOnly ? structReason : ""} onchange={(e) => actions.rename(e.currentTarget.value)} />

    {#if !state.branches && !state.block}
        <!-- A bundle/structured node shows its NPC line per branch below ([if]/[else] sections); the node-level
             reply field would duplicate it (and only the first branch's line), so omit it for branch nodes. -->
        <div class="ik">NPC line</div>
        {@const npc = textEdit(null)}
        <textarea class="iv npc" rows="2" use:autosize={resolveText(state.text, messages)} disabled={!npc.editable} title={npc.reason} value={resolveText(state.text, messages)} oninput={(e) => setSay(e.currentTarget.value)} onkeydown={commitOnEnter}></textarea>
        <!-- Continuation lines of a multisay `SAY @a = @b = @c` monologue (line 1 is the field above): the NPC
             speaks several lines before the player replies. Each edits like the primary line - an @N line writes
             its .msg/.tra entry, a literal writes the .d source (setSayLine). Absent for a single-say state. -->
        {#if state.sayTexts && state.sayTexts.length > 1}
            {#each state.sayTexts.slice(1) as _line, idx (idx)}
                {@const i = idx + 1}
                {@const sl = sayLineEditability({ text: state.sayTexts[i], messages, ssl, textRO: Boolean(state.derivedFrom), derivedFrom: state.derivedFrom })}
                <div class="ik">NPC line (cont. {i + 1})</div>
                <textarea class="iv npc" rows="1" use:autosize={resolveText(state.sayTexts[i], messages)} disabled={!sl.editable} title={sl.reason} value={resolveText(state.sayTexts[i], messages)} oninput={(e) => setSayLine(i, e.currentTarget.value)} onkeydown={commitOnEnter}></textarea>
            {/each}
        {/if}
    {/if}

    {#if ssl}
        <!-- SSL: the node's reply condition (its enclosing `if`) and the state-mutating
             builtins it calls. Both read-only; "weight" and the per-choice `DO` action are
             WeiDU D concepts that have no SSL equivalent and are omitted. -->
        {#if !state.branches && !state.block}
            <!-- For a bundle/structured node the condition is shown per branch (the [if]/[else] head) and
                 side-effects in each branch; the node-level fields would duplicate (first branch only), so
                 omit them for branch nodes. -->
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
                <input class="iv code" disabled={readOnly} title={readOnly ? roReason : ""} placeholder="(unconditional)" value={state.trigger ?? ""} oninput={(e) => (state.trigger = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)} />
            </div>
            <div class="wcol">
                <div class="ik">Weight</div>
                <input class="iv" type="number" disabled={readOnly} title={readOnly ? roReason : ""} placeholder="(default)" value={state.weight ?? ""} oninput={(e) => setWeight(e.currentTarget.value)} />
            </div>
        </div>
    {/if}

    <!-- Add lives as a trailing "+" at the END of the options list (below), so adding reads as "append to
         this list". Each option row carries its own delete (the row's x). Bundle nodes add per branch. -->
    <div class="ik">Options ({state.choices.length})</div>
    {/if}

    {#snippet choiceRow(c: DialogChoice, i: number, bi?: number, branchLen?: number, labeled?: boolean)}
        {@const oe = textEdit(c)}
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
                                <button title={i === 0 ? "Already first in this branch" : "Move up"} disabled={i === 0} onclick={() => actions.moveReplyInBranch(bi, c.id, -1)}>&#9650;</button>
                                <button title={branchLen === undefined || i >= branchLen - 1 ? "Already last in this branch" : "Move down"} disabled={branchLen === undefined || i >= branchLen - 1} onclick={() => actions.moveReplyInBranch(bi, c.id, 1)}>&#9660;</button>
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
                                <button title={i === 0 ? "Already the first option" : "Move up"} disabled={i === 0} onclick={() => actions.moveReply(c.id, -1)}>&#9650;</button>
                                <button title={i === state.choices.length - 1 ? "Already the last option" : "Move down"} disabled={i === state.choices.length - 1} onclick={() => actions.moveReply(c.id, 1)}>&#9660;</button>
                            {/if}
                            {#if !readOnly}
                                <button title="Remove" class="del" onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                            {:else if structuralEditable && !state.branches}
                                <!-- Faithful SSL/TSSL and every TD node: remove writes back to source. A conditional
                                     SSL/TSSL option sits in an `if` the save leaves alone, so its Remove is disabled
                                     with a reason; a TD option carries no per-option condition, so it is removable. -->
                                <button title={c.condition ? optionRemoveLockReason() : "Remove"} class="del" disabled={Boolean(c.condition)} onclick={() => actions.removeReply(c.id)}>&#10005;</button>
                            {/if}
                        {/if}
                    </span>
                {/if}
            </div>
            {#if labeled}<div class="ik">Option text</div>{/if}
            <textarea class="iv reply" rows="1" use:autosize={resolveText(c.text, messages)} disabled={!oe.editable} title={oe.reason} placeholder="(no option text - continue)" value={resolveText(c.text, messages)} oninput={(e) => setReply(c, e.currentTarget.value)} onkeydown={commitOnEnter}></textarea>
            <!-- Inside a bundle branch the condition is already shown once at the branch head
                 (the [if] chip), so the per-option condition field is omitted to avoid a
                 redundant disabled control on every row. Flat-path render is unchanged. -->
            {#if !state.branches}
                {#if labeled}<div class="ik">Condition</div>{/if}
                <!-- Read-only reason differs: a structured/approximate node's whole structure is read-only
                     (a nested/composite gate cannot round-trip), so the condition shown is the full conjoined
                     path; a faithful node's condition is read-only only when a multi-call `if` block shares it
                     across options. Word each accurately. -->
                <textarea class="iv code cond" class:locked={ssl && c.conditionEditable === false} rows="1" use:autosize={c.condition ?? ""} disabled={ssl ? !c.conditionEditable : readOnly} title={(ssl ? !c.conditionEditable : readOnly) ? conditionLockReason(state, c, ssl, editable) : ""} placeholder={ssl ? "(no condition)" : readOnly ? "(none)" : "condition (IF ~...~)"} value={c.condition ?? ""} oninput={(e) => (c.condition = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
                <!-- Per-option note only for the BUNDLE shared-condition case (there is no banner for it). For a
                     structured/approximate node the top-of-panel banner already says the whole structure is
                     read-only, so repeating it on all N option cards is just clutter - the dashed field carries
                     the signal, the banner the explanation. -->
                {#if ssl && c.conditionEditable === false && !state.structured && !state.approximate}
                    <div class="condnote">shared by other options - edit in <b>source file</b></div>
                {/if}
            {/if}
            {#if !ssl && !state.branches}
                {#if labeled}<div class="ik">Action</div>{/if}
                <textarea class="iv code act" rows="1" use:autosize={c.action ?? ""} disabled={readOnly} title={readOnly ? roReason : ""} placeholder={readOnly ? "(none)" : "action (DO ~...~)"} value={c.action ?? ""} oninput={(e) => (c.action = e.currentTarget.value.trim() === "" ? undefined : e.currentTarget.value)}></textarea>
            {/if}
            <!-- Retarget is a FIELD edit: enabled for any field-editable node (D, faithful/bundle SSL, and
                 faithful/bundle TSSL - whose target token round-trips to the .tssl source). -->
            {#if labeled}<div class="ik">Target</div>{/if}
            <select class="iv tgt" disabled={!structuralEditable} title={!structuralEditable ? structReason : ""} value={targetValue(c.target)} onchange={(e) => onTargetChange(c, e.currentTarget.value)}>
                {#if c.target.kind === "external"}
                    <option value="ext">&#8631; {c.target.label}</option>
                {/if}
                <option value="exit">EXIT</option>
                {#if ssl}<option value="combat">COMBAT</option>{/if}
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
                    <select class="iv rct" disabled={!structuralEditable} title={!structuralEditable ? structReason : ""} value={c.reaction} onchange={(e) => onReactionChange(c, e.currentTarget.value)}>
                        <option value="good">Good</option>
                        <option value="neutral">Neutral</option>
                        <option value="bad">Bad</option>
                    </select>
                    <label class="lowlbl">
                        <input type="checkbox" checked={Boolean(c.lowIq)} disabled={!structuralEditable} title={!structuralEditable ? structReason : ""} onchange={(e) => actions.setLowIq(c.id, e.currentTarget.checked)} />
                        Low INT
                    </label>
                </div>
            {/if}
        </div>
    {/snippet}

    {#if focusedChoice}
        {@render choiceRow(focusedChoice, focusedIndex, undefined, undefined, true)}
    {:else if state.branches}
        {#each state.branches as b, bi (bi)}
            {@const bcs = branchChoices(b)}
            <div class="branch">
                {#if b.kind === "else"}
                    <div class="branchhead">
                        <span class="branchlabel">[else]</span>
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
                        <span class="branchlabel">[if]</span>
                        <input
                            class="iv code branchcond"
                            value={b.condition ?? ""}
                            disabled={!structuralEditable}
                            title={!structuralEditable ? structReason : ""}
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
                    title={$newBranchCond.trim() === "" ? "Type a condition for the new if-branch first (an if without a condition isn't valid SSL)." : "Add if-branch"}
                    onclick={() => { actions.addBranch($newBranchCond.trim()); newBranchCond.set(""); }}
                >+ if</button>
            </div>
            <!-- Add an else-branch only when there is exactly one if-branch and no else yet.
                 The op enforces the same precondition; the button visibility keeps the UI consistent. -->
            {#if state.branches.length === 1 && state.branches[0]?.kind === "if"}
                <button class="add branchadd" onclick={actions.addElse}>+ else</button>
            {/if}
        {/if}
    {:else if ssl && state.block}
        <!-- Structured (read-only) node: options grouped into read-only [if]/[else] branch sections mirroring
             the tree's fork. The section for the branch clicked in the tree (highlightedBranchKey) is tinted and
             scrolled into view. Each option shows its text, target, and full condition - editing the structure
             means editing the .ssl (the top-of-panel banner says so). -->
        {#each inspectorBranches as br (br.key)}
            <div class="branch binspbranch" class:branchhl={sectionHl(br.key)} data-bkey={br.key}>
                <div class="branchhead">
                    <span class="branchlabel">{br.kind === "else" ? "[else]" : br.kind === "if" ? "[if]" : "(always)"}</span>
                    {#if br.condition}<span class="iv code binspcond">{br.condition}</span>{/if}
                </div>
                {#if br.npc}<div class="branchreply">{br.npc}</div>{/if}
                {#each br.choices as c (c.id)}
                    <div class="binsprow">
                        <span class="binsptext">{resolveText(c.text, messages) || "(continue)"}</span>
                        <span class="binsptgt">&#8594; {targetLabel(c.target)}</span>
                        {#if c.condition}<div class="iv code binspocond">{c.condition}</div>{/if}
                    </div>
                {/each}
            </div>
        {/each}
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
         rows navigate to the referencing state; the entry rows are informational. Whether zero references means
         "orphan" is NOT a raw count: classifyReachability decides it (see the note branches below). -->
    {#if !focusedChoice}
    <div class="ik">Referenced by ({callers.length})</div>
    {#if callers.length === 0}
        <!-- No in-file inbound reference. classifyReachability calls this external-entry (or the dialog's own
             entry state), never orphan: WeiDU D has no single entry point - every top-level state is engine-
             enterable - and an SSL banter state is entered by a cross-file EXTERN. A genuine orphan HAS inbound
             refs (below), so it can never land in this zero-caller branch. Matches the graph card's grey "entry"
             mark, not the red "dead" one. -->
        <div class="refnote">No in-file references{reachability === "external-entry"
            ? " - entered from outside this file (a cross-file EXTERN, the engine, or another mod)"
            : " - this is a dialog entry point"}, not an orphan.</div>
    {:else}
        {#if reachability === "orphan"}
            <!-- Genuinely disconnected: the reference(s) below exist, but no path from any entry point reaches
                 this state. Matches the graph card's red "dead" mark; this is the real orphan signal. -->
            <div class="refnote refnote-dead">Unreachable: no path from an entry point reaches this state despite the reference(s) below (a disconnected island).</div>
        {/if}
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
        <!-- Delete visibility follows the same `deletable` gate as the SSL branch below (one nodeDeletable
             predicate for both families) - the graph-side requestDeleteState re-checks it anyway, but a
             button that will only ever toast a refusal should not render. -->
        <div class="stateops">
            <button onclick={actions.duplicateState}>Duplicate state</button>
            {#if deletable}<button class="del" onclick={actions.deleteState}>Delete state</button>{/if}
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
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        color: var(--vscode-foreground);
    }
    .ih {
        color: var(--vscode-textLink-foreground);
        font-weight: 700;
        font-size: 11px;
        margin-bottom: 6px;
    }
    /* Breadcrumb header for the focused-option view: the owner-state crumb (a button that returns to the
       whole-state editor) + a separator + the current option. The crumb reuses the .ih heading accent. */
    .crumbs {
        display: flex;
        align-items: baseline;
        gap: 5px;
    }
    .crumb {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-weight: 700;
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
    }
    .crumb:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .crumbsep {
        color: var(--vscode-descriptionForeground);
    }
    .crumbcur {
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
    }
    .ronote {
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        border-radius: 4px;
        /* inputValidation-warningForeground (falls back to plain foreground), not editorWarning-foreground -
           the latter fails WCAG contrast against this warning background wash in light themes. */
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-size: 10px;
        line-height: 1.35;
        padding: 5px 7px;
        margin-bottom: 6px;
    }
    .ronote b {
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
    }
    /* Disabled fields (read-only SSL: target dropdown, reaction, state id, ...) get the same dashed border as
       the locked condition field below - a muted foreground alone is too subtle to read as "not editable" (a
       disabled <select> otherwise looks like an active dropdown, chevron and all). */
    .iv:disabled {
        /* A read-only field still exists to be READ, so keep its value at full input-foreground contrast.
           Do NOT dim the text: disabledForeground is VS Code's ~50%-alpha grey (~2.8:1 over the input
           background - fails WCAG AA 4.5:1), and opacity would bleed the selected-option `.choicesel` wash
           through the input's own background. The "not editable" affordance is carried entirely by the dashed
           border + not-allowed cursor below, so dimming the text is redundant as well as unreadable. */
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        cursor: not-allowed;
        border-style: dashed;
        border-color: var(--vscode-panel-border);
    }
    .ik {
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        text-transform: uppercase;
        margin-top: 8px;
        margin-bottom: 2px;
    }
    .iv {
        width: 100%;
        box-sizing: border-box;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
        padding: 3px 6px;
        color: var(--vscode-input-foreground, var(--vscode-foreground));
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
        color: var(--vscode-editorWarning-foreground);
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
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid var(--vscode-descriptionForeground);
        border-radius: 4px;
        padding: 4px 6px;
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    /* The option selected from the tree: a focus-accented left border marks it. Do NOT add a full-row
       background fill here: list-inactiveSelectionBackground equals input-background in some themes
       (bgforge-monokai: both #414339), so a fill paints the row the SAME colour as every field's own
       background - the field boxes, their borders, and the row all collapse into one grey blob and the form
       structure disappears (labels + values become bare text on grey). The left accent, the tree-row
       highlight, and the "option #N" crumb carry the selection without touching field backgrounds. */
    .trow.choicesel {
        border-left-color: var(--vscode-focusBorder);
    }
    .trhead {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .tnum {
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
    }
    .trbtns button,
    .add,
    .stateops button {
        background: var(--vscode-button-secondaryBackground, transparent);
        border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
        border-radius: 3px;
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
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
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        font-style: italic;
        padding: 2px 0;
    }
    /* The real orphan signal - a red, non-italic note matching the graph card's "dead" mark. errorForeground
       is theme-tuned for legibility on the editor/panel background (no wash here), so it clears contrast. */
    .refnote-dead {
        color: var(--vscode-errorForeground);
        font-style: normal;
        font-weight: 600;
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
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid var(--vscode-descriptionForeground);
        border-radius: 3px;
        color: var(--vscode-foreground);
        font-size: 10px;
        padding: 3px 6px;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ref:hover {
        border-color: var(--vscode-focusBorder);
        color: var(--vscode-foreground);
    }
    .ref.static {
        cursor: default;
        color: var(--vscode-descriptionForeground);
        border-left-color: var(--vscode-editorWarning-foreground);
    }
    /* NPC line = blue (charts-blue), matching the graph card and tree; player option text = the default
       foreground, overridden to green/red by the per-option reaction chip. */
    .iv.npc {
        color: var(--vscode-charts-blue);
    }
    .iv.reply {
        color: var(--vscode-foreground);
    }
    .iv.cond {
        color: var(--vscode-editorWarning-foreground);
    }
    /* A read-only SSL condition (a shared if-block, or the node-level one pending write-back):
       a dashed border plus a caption make the locked state legible on its own - the disabled
       dimming alone is too subtle on the amber code text, and the hover tooltip is not
       discoverable (a hover-only cue fails to explain why the field cannot be edited). */
    .iv.cond.locked {
        border-style: dashed;
        border-color: var(--vscode-panel-border);
    }
    .condnote {
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        margin-top: 1px;
        padding-left: 2px;
    }
    .condnote b {
        color: var(--vscode-foreground);
    }
    .iv.act {
        color: var(--vscode-charts-purple);
    }
    .iv.tgt {
        color: var(--vscode-foreground);
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
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        text-transform: uppercase;
    }
    .iv.rct {
        width: auto;
        padding: 2px 4px;
        color: var(--vscode-foreground);
    }
    .lowlbl {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--vscode-foreground);
        font-size: 10px;
        cursor: pointer;
        margin-left: auto;
    }
    .lowlbl input {
        margin: 0;
    }
    /* SSL side-effects: matches the header accent, distinct from the amber/purple/blue code fields around it.
       Read-only, so a plain box. */
    .iv.sfx {
        color: var(--vscode-textLink-foreground);
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
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
    }
    .branch {
        border: 1px solid var(--vscode-panel-border);
        border-left: 3px solid var(--vscode-descriptionForeground);
        border-radius: 4px;
        background: var(--vscode-editorWidget-background);
        margin: 8px 0;
        padding: 4px 7px 7px;
    }
    .branchhead {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        font-weight: 600;
        font-style: italic;
        margin: 2px 0 4px;
        display: flex;
        align-items: center;
    }
    .branchlabel {
        color: var(--vscode-descriptionForeground);
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
        color: var(--vscode-foreground);
        font-size: 11px;
        margin: 1px 0 4px;
    }
    /* Read-only branch sections for a STRUCTURED node (inspectorBranches): reuse .branch chrome; the section
       for the branch clicked in the tree (highlightedBranchKey) gets a focus accent + tint so it matches the
       tree's branch highlight. */
    .binspbranch.branchhl {
        border-left-color: var(--vscode-focusBorder);
        background: var(--vscode-list-inactiveSelectionBackground);
    }
    .binspcond {
        width: auto;
        min-width: 55%;
        font-size: 10px;
        padding: 1px 4px;
        color: var(--vscode-foreground);
    }
    .binsprow {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
        margin: 3px 0;
        padding-left: 6px;
        border-left: 1px solid var(--vscode-panel-border);
    }
    .binsptext {
        color: var(--vscode-foreground);
        font-size: 11px;
    }
    .binsptgt {
        color: var(--vscode-charts-blue);
        font-size: 10px;
        white-space: nowrap;
    }
    .binspocond {
        flex-basis: 100%;
        width: auto;
        font-size: 9px;
        color: var(--vscode-descriptionForeground);
        padding: 0 4px;
        margin-left: 6px;
    }
    .logic {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        margin-top: 2px;
    }
    .logic summary {
        cursor: pointer;
    }
    /* Raw side-effect source lines: same "affects game state" purple as the action [do] chip and the
       side-effect badge (Badge.svelte .b-fx), since there is no dedicated VS Code token for this hue. */
    .logicline {
        margin: 1px 0;
        color: var(--vscode-charts-purple);
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
        background: var(--vscode-button-secondaryBackground, transparent);
        border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
        border-radius: 3px;
        color: var(--vscode-errorForeground);
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
