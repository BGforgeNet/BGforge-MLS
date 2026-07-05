<script lang="ts">
    import { tick } from "svelte";
    import type { ConversationTree, ConvState, ConvReply, ConvBranch } from "./conversation-tree";
    import Badge from "./Badge.svelte";
    import LowIntChip from "./LowIntChip.svelte";

    // Conversation-flow tree (built by conversation-tree.ts). Renders states and
    // their player replies as a nested outline; clicking a state selects it for the
    // shared Inspector, clicking a cross-file leaf jumps to that dialog's tab, and
    // clicking a "shown elsewhere" ref selects the expanded copy.
    let { tree, selectedId, selectedChoiceId, editingChoiceId, editingStateId, collapsed, editableStateIds, deletableStateIds, ssl, onSelect, onSelectReply, onBeginEditReply, onCommitEditReply, onCancelEditReply, onBeginEditState, onCommitEditState, onCancelEditState, onToggle, onExpand, onGoToSource, onJump, onContext, onReplyContext, onAddReply, onRemoveReply, onAddChildNode, onDeleteState }: {
        tree: ConversationTree;
        selectedId?: string | null;
        /** The individually-selected option's choice id (within the selected state), or null when a whole
            state is selected. Highlights that option row. */
        selectedChoiceId?: string | null;
        /** The option currently being edited inline (its text renders as an input), or null. */
        editingChoiceId?: string | null;
        /** The state whose NPC line is being edited inline (its line renders as an input), or null. */
        editingStateId?: string | null;
        /** Ids of collapsed states (default expanded). Owned by the parent so the
            toolbar's expand-all / collapse-all can drive it. */
        collapsed: Set<string>;
        /** Ids of structurally-editable states (D, or a faithful non-derived SSL node). Only these
            get the inline option add ("+")/remove ("x") and the node add-child ("+")/delete ("-"). */
        editableStateIds: Set<string>;
        /** Ids of states that can be deleted now (no un-cleanable inbound refs). The node "-" is enabled
            for these and shown disabled (with a tooltip) for other editable states. */
        deletableStateIds: Set<string>;
        /** True for a Fallout SSL dialogue: a conditional option's remove is shown disabled, because
            the save path does not rewrite its `if` wrapper (mirrors the inspector). */
        ssl: boolean;
        onSelect: (stateId: string) => void;
        /** Select an individual option: highlights it and reveals it in the docked Inspector. */
        onSelectReply: (stateId: string, choiceId: string) => void;
        /** Enter inline text edit on an option (double-click / Enter / F2). */
        onBeginEditReply: (stateId: string, choiceId: string) => void;
        /** Commit an inline edit with the new text. */
        onCommitEditReply: (stateId: string, choiceId: string, value: string) => void;
        /** Abandon an inline edit (Escape). */
        onCancelEditReply: () => void;
        /** Enter inline edit on a state's NPC line (double-click the line / F2 on the row). */
        onBeginEditState: (stateId: string) => void;
        /** Commit an inline NPC-line edit with the new text. */
        onCommitEditState: (stateId: string, value: string) => void;
        /** Abandon an inline NPC-line edit (Escape). */
        onCancelEditState: () => void;
        onToggle: (stateId: string) => void;
        /** Un-collapse the given states so a reveal target inside a collapsed branch becomes visible. */
        onExpand: (stateIds: string[]) => void;
        /** Go to the source line for a byte offset (F4) - opens the .ssl/.d text editor at that position. */
        onGoToSource: (sourceOffset: number) => void;
        onJump: (file: string, stateId: string) => void;
        /** Right-click on a state row, at viewport coords - opens the parent's menu. */
        onContext: (stateId: string, x: number, y: number) => void;
        /** Right-click on a reply row: owner state id, choice id, its index and the
            owner's reply count (for move-up/down bounds), and viewport coords. */
        onReplyContext: (stateId: string, choiceId: string, index: number, count: number, x: number, y: number) => void;
        /** Inline "+": append an option to the state's flat option list. */
        onAddReply: (stateId: string) => void;
        /** Inline "x": remove an option from the state's flat option list. */
        onRemoveReply: (stateId: string, choiceId: string) => void;
        /** Node "+": add a connected child state (new option here -> new NPC state). */
        onAddChildNode: (stateId: string) => void;
        /** Node "-": delete this state (guarded/confirmed by the parent). */
        onDeleteState: (stateId: string) => void;
    } = $props();

    let treeEl: HTMLDivElement | undefined = $state();

    // Ancestor state ids on the path to a target's first (expanded) occurrence in the tree, or null if it is
    // not an expanded node here (only a ref, or cross-file). Walks the conversation nesting - flat replies
    // and branch replies alike - so reveal() can un-collapse exactly the branches hiding the target.
    function ancestorsOf(targetId: string): string[] | null {
        const childrenOf = (s: ConvState): ConvState[] => {
            const kids: ConvState[] = [];
            if (s.branches) for (const b of s.branches) for (const r of b.replies) if (r.target.kind === "state") kids.push(r.target.node);
            for (const r of s.replies) if (r.target.kind === "state") kids.push(r.target.node);
            return kids;
        };
        const find = (s: ConvState, acc: string[]): string[] | null => {
            if (s.id === targetId) return acc;
            const next = [...acc, s.id];
            for (const k of childrenOf(s)) {
                const p = find(k, next);
                if (p) return p;
            }
            return null;
        };
        for (const root of tree.roots) {
            const p = find(root, []);
            if (p) return p;
        }
        return null;
    }
    // Scroll a state's row into view (a ref/jump may target a node far elsewhere in the tree). If the target
    // sits inside a collapsed branch it is absent from the DOM, so first un-collapse its ancestors (via the
    // parent) and scroll after the re-render - otherwise a "shown elsewhere" jump silently does nothing.
    function reveal(id: string): void {
        const collapsedAncestors = ancestorsOf(id)?.filter((a) => collapsed.has(a)) ?? [];
        if (collapsedAncestors.length > 0) {
            onExpand(collapsedAncestors);
            void tick().then(() => treeEl?.querySelector(`[data-sid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
        } else {
            treeEl?.querySelector(`[data-sid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
        }
    }
    // Reveal whatever is selected whenever selection changes: covers clicking a ref
    // leaf, a cross-file jump landing on a freshly-rendered tab, and selection driven
    // from the graph view.
    $effect(() => {
        if (selectedId) reveal(selectedId);
    });

    // Roving-tabindex keyboard navigation (WAI-ARIA tree pattern): exactly one row - a state row OR a
    // selectable option row - is in the tab order at a time. ArrowUp/Down move selection between visible rows
    // (see onRowKeydown / onReplyRowKeydown), ArrowLeft/Right expand/collapse a state. `treeFocusId` holds the
    // roving row's id, which is a state's data-sid or an option's data-choice (disjoint id spaces). Defaults
    // to the selection, else the first root.
    let treeFocusId = $state<string>();
    $effect(() => {
        if (!treeFocusId || !treeEl?.querySelector(`[data-sid="${CSS.escape(treeFocusId)}"], [data-choice="${CSS.escape(treeFocusId)}"]`)) {
            treeFocusId = selectedId ?? tree.roots[0]?.id;
        }
    });

    // Visible navigation targets in DOM (top-to-bottom) order, for ArrowUp/Down movement. Both state rows
    // (data-sid) and selectable option rows (data-owner + data-choice) are `[role=treeitem]`; a read-only
    // bundle-branch option row has no role and so is skipped. They interleave exactly as they read on screen
    // - Down off a state steps into its first option, Down off the last option steps to the next state.
    // Collapsed rows' children are absent from the DOM, so this naturally walks only what is on screen.
    function navTargets(): HTMLElement[] {
        return treeEl ? [...treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
    }
    // Move SELECTION (not just focus) to a target: focus it and select it so the docked inspector follows the
    // keyboard, matching a click. A state row selects via onSelect; an option row via onSelectReply.
    function selectNav(el: HTMLElement): void {
        const { sid, owner, choice } = el.dataset;
        if (owner && choice) onSelectReply(owner, choice);
        else if (sid) onSelect(sid);
    }
    // ArrowUp/Down step to the previous/next target and select it. .focus() scrolls the target into view, so
    // the arrows move focus instead of scrolling the panel (the browser default when focus sits on a control
    // - e.g. an option's text button - that does not itself handle the arrows).
    function moveNav(current: HTMLElement, dir: 1 | -1): void {
        const rows = navTargets();
        const i = rows.indexOf(current);
        const next = rows[i + dir];
        if (next) {
            next.focus();
            selectNav(next);
        }
    }
    function onRowKeydown(e: KeyboardEvent, st: ConvState): void {
        const hasKids = st.replies.length > 0 || (st.branches?.length ?? 0) > 0;
        const open = !collapsed.has(st.id);
        switch (e.key) {
            case " ":
                e.preventDefault();
                onSelect(st.id);
                break;
            case "Enter":
            case "F2":
            case "e":
            case "E":
                // Enter/F2/E edit this state's NPC line inline (parity with double-clicking the line). Only a
                // flat, text-editable state has an inline-editable line; a bundle node (line lives per-branch)
                // or a locked node has none, so Enter falls back to select there and F2/E are a no-op.
                if (!st.branches && st.textEditable) {
                    e.preventDefault();
                    onBeginEditState(st.id);
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    onSelect(st.id);
                }
                break;
            case "F4":
                // Go to this state's source line in the .ssl/.d text editor. Absent for a synthetic/derived
                // or pending-new state (no source span) - then a no-op.
                if (st.sourceOffset != null) {
                    e.preventDefault();
                    onGoToSource(st.sourceOffset);
                }
                break;
            case "ArrowDown":
                e.preventDefault();
                moveNav(e.currentTarget as HTMLElement, 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                moveNav(e.currentTarget as HTMLElement, -1);
                break;
            case "ArrowRight":
                // Expand a collapsed row with children.
                if (hasKids && !open) {
                    e.preventDefault();
                    onToggle(st.id);
                }
                break;
            case "ArrowLeft":
                // Collapse an open row with children.
                if (hasKids && open) {
                    e.preventDefault();
                    onToggle(st.id);
                }
                break;
        }
    }

    // Hover tooltip for a conversation line. `label` (the state id, e.g. NodeXXX) is ALWAYS shown - it is the
    // id we dropped from the inline row, surfaced here on the text the writer hovers. `text` (the full line)
    // is appended ONLY when the line is actually clipped (rendered width exceeds the box) - a line that fits
    // would just echo the visible text. Re-checks on resize, since clipping depends on the available width.
    // Option text passes no label (an option has no NodeXXX), so it stays label-less: tooltip only when clipped.
    function clipTitle(el: HTMLElement, param: { text?: string; label?: string }) {
        let current = param;
        function sync(): void {
            const { text, label } = current;
            const clipped = el.scrollWidth > el.clientWidth;
            const parts = [label, clipped && text ? text : undefined].filter(Boolean);
            if (parts.length > 0) el.title = parts.join(" - ");
            else el.removeAttribute("title");
        }
        const ro = new ResizeObserver(sync);
        ro.observe(el);
        sync();
        return {
            update(next: { text?: string; label?: string }): void {
                current = next;
                sync();
            },
            destroy(): void {
                ro.disconnect();
            },
        };
    }

    // Inline option-text editing. The edited option renders an <input>; Enter and blur commit, Escape
    // cancels. Enter/Escape route THROUGH blur (they call the input's blur()), so there is exactly one
    // commit/cancel path and no Enter-then-blur double fire. `escaped` carries the Escape intent across to
    // the blur handler; only one option edits at a time (editingChoiceId is single), so one flag suffices.
    let escaped = false;
    // Set when the edit ends via Enter/Escape (a keyboard commit) rather than a click-away blur: it tells
    // the blur handler to hand focus back to the just-edited row/option so Up/Down keep working. A
    // click-away commit leaves focus wherever the pointer put it.
    let keyboardCommit = false;
    // After a keyboard-committed inline edit, the input blurs to <body> and the arrow keys stop working
    // (nothing focused handles them). Once the edit's input unmounts (editingChoiceId/editingStateId cleared
    // by the parent), return focus to that option's button / state row so keyboard nav resumes where it left.
    let refocusChoiceId = $state<string>();
    let refocusStateId = $state<string>();
    $effect(() => {
        if (refocusChoiceId != null && editingChoiceId == null) {
            const id = refocusChoiceId;
            refocusChoiceId = undefined;
            treeEl?.querySelector<HTMLElement>(`.rep[data-choice="${CSS.escape(id)}"]`)?.focus();
        }
        if (refocusStateId != null && editingStateId == null) {
            const id = refocusStateId;
            refocusStateId = undefined;
            treeEl?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(id)}"]`)?.focus();
        }
    });
    function autofocusSelect(el: HTMLInputElement) {
        el.focus();
        el.select();
    }
    function onEditKeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        if (e.key === "Enter") {
            e.preventDefault();
            keyboardCommit = true;
            e.currentTarget.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            escaped = true;
            keyboardCommit = true;
            e.currentTarget.blur();
        }
    }
    function onEditBlur(stateId: string, choiceId: string, e: FocusEvent & { currentTarget: HTMLInputElement }): void {
        const refocus = keyboardCommit;
        keyboardCommit = false;
        if (escaped) {
            escaped = false;
            onCancelEditReply();
        } else {
            onCommitEditReply(stateId, choiceId, e.currentTarget.value);
        }
        if (refocus) refocusChoiceId = choiceId;
    }
    // NPC-line inline edit blur - the state counterpart of onEditBlur. Shares onEditKeydown and the single
    // `escaped`/`keyboardCommit` flags (only one inline edit, state OR option, is ever active at once).
    function onStateEditBlur(stateId: string, e: FocusEvent & { currentTarget: HTMLInputElement }): void {
        const refocus = keyboardCommit;
        keyboardCommit = false;
        if (escaped) {
            escaped = false;
            onCancelEditState();
        } else {
            onCommitEditState(stateId, e.currentTarget.value);
        }
        if (refocus) refocusStateId = stateId;
    }
    // "Take" an option's transition: go to its destination state, the same as clicking the option's target
    // link. A nested/ref state selects and reveals (reveal un-collapses its branch); a cross-file target jumps
    // to that dialog tab. A terminal (exit/combat) has no destination, so it is a no-op.
    function takeTransition(r: ConvReply): void {
        const t = r.target;
        if (t.kind === "state") {
            onSelect(t.node.id);
            reveal(t.node.id);
        } else if (t.kind === "ref") {
            onSelect(t.stateId);
            reveal(t.stateId);
        } else if (t.kind === "external" && t.jump) {
            onJump(t.jump.file, t.jump.stateId);
        }
    }
    // Keyboard on a focused option ROW, mirroring onRowKeydown for states: Space selects the option;
    // Enter/F2/E begin inline edit (Enter falls back to select when the option is not editable - a locked
    // SSL @N / read-only node has no inline input); G takes the transition (go to the target, like clicking
    // its link); ArrowUp/Down move to the neighbouring row. Double-click also edits (see the row markup).
    function onReplyRowKeydown(e: KeyboardEvent, ownerId: string, r: ConvReply): void {
        switch (e.key) {
            case " ":
                e.preventDefault();
                onSelectReply(ownerId, r.id);
                break;
            case "Enter":
            case "F2":
            case "e":
            case "E":
                e.preventDefault();
                if (r.textEditable) onBeginEditReply(ownerId, r.id);
                else if (e.key === "Enter") onSelectReply(ownerId, r.id);
                break;
            case "g":
            case "G":
                e.preventDefault();
                takeTransition(r);
                break;
            case "F4":
                // Go to this option's source statement in the .ssl/.d text editor. Absent for a pending
                // option (no source span yet) - then a no-op.
                if (r.sourceOffset != null) {
                    e.preventDefault();
                    onGoToSource(r.sourceOffset);
                }
                break;
            case "ArrowDown":
                e.preventDefault();
                moveNav(e.currentTarget as HTMLElement, 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                moveNav(e.currentTarget as HTMLElement, -1);
                break;
        }
    }
    // Enter/F2/E on the focused NPC-line button begins inline edit (the button only renders when editable).
    // stopPropagation keeps the row's own keydown (Enter=select, F2/E=edit) from double-firing.
    function onLineKeydown(e: KeyboardEvent, stateId: string): void {
        if (e.key === "F2" || e.key === "Enter" || e.key === "e" || e.key === "E") {
            e.preventDefault();
            e.stopPropagation();
            onBeginEditState(stateId);
        }
    }
</script>

<div class="tree" role="tree" aria-label="Conversation tree" bind:this={treeEl}>
    {#each tree.roots as st (st.id)}
        {@render stateBlock(st, 0)}
    {/each}
</div>

{#snippet stateBlock(st: ConvState, depth: number)}
    {@const hasChildren = st.replies.length > 0 || (st.branches?.length ?? 0) > 0}
    <!-- When an individual option of this state is selected (selectedChoiceId set), the option row carries the
         selection highlight (.rep.repsel) and the Inspector focuses that option - so the owner node is NOT
         highlighted here: only the option reads as selected. The node lights up only for a whole-state select. -->
    <div
        class="st"
        class:derived={st.derivedFrom}
        class:entry={st.isEntry}
        class:sel={st.id === selectedId && !selectedChoiceId}
        style="--lvl:{depth * 2}"
        data-sid={st.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={st.id === selectedId && !selectedChoiceId}
        aria-expanded={hasChildren ? !collapsed.has(st.id) : undefined}
        tabindex={st.id === treeFocusId ? 0 : -1}
        onclick={() => onSelect(st.id)}
        onfocus={() => (treeFocusId = st.id)}
        oncontextmenu={(e) => (e.preventDefault(), onContext(st.id, e.clientX, e.clientY))}
        onkeydown={(e) => onRowKeydown(e, st)}
    >
        {#if hasChildren}
            <button
                class="caret"
                class:closed={collapsed.has(st.id)}
                title={collapsed.has(st.id) ? "Expand" : "Collapse"}
                tabindex={-1}
                aria-hidden="true"
                onclick={(e) => (e.stopPropagation(), onToggle(st.id))}>&#9656;</button
            >
        {:else}
            <span class="caret leafdot">&bull;</span>
        {/if}
        <!-- WeiDU D shows the real speaker name (a character; it varies across a multi-speaker dialog).
             The state id is the source-addressable handle (jump/rename) but secondary to reading the
             conversation - and for SSL it is a noisy auto-generated NodeXXX repeated on every row - so it is
             not shown inline; the id is the row's hover tooltip (title={st.id}) instead. -->
        {#if st.speaker}<span class="who">{st.speaker}</span>{/if}
        {#if st.derivedFrom}<Badge badges={["derived"]} label={st.derivedFrom} small />{/if}
        {#if st.trigger}<span class="cond" title={st.trigger}>[if]</span>{/if}
        <!-- A bundle node's line lives per-branch (below); only a flat node shows its line here. That flat
             line is inline-editable (double-click it, or F2 on the row) when its text is editable - mirroring
             option text: it swaps to an <input> while editing (Enter/blur commit, Escape cancels). A locked
             line (unresolvable SSL @N, or a read-only/derived node) stays a plain, non-editing span. The
             input's own click/dblclick/keydown are stopped from bubbling so cursor placement, word-select, and
             typing (Space especially) act on the field, not the row (select / F2 / arrow-nav). -->
        {#if !st.branches}
            {#if st.id === editingStateId && st.textEditable}
                <input
                    class="line lineedit"
                    aria-label="NPC line"
                    use:autofocusSelect
                    value={st.text}
                    placeholder="(NPC line)"
                    onclick={(e) => e.stopPropagation()}
                    ondblclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => (e.stopPropagation(), onEditKeydown(e))}
                    onblur={(e) => onStateEditBlur(st.id, e)}
                />
            {:else if st.textEditable}
                <!-- Editable line: a <button> (like the option text) so it is a real, keyboard-operable edit
                     target - click selects the state (bubbling stopped to avoid a double-select), double-click
                     or Enter/F2 begins inline edit. Its keydown is stopped so the row's Enter=select / F2 do
                     not also fire. -->
                <button
                    class="line linebtn"
                    use:clipTitle={{ label: st.id, text: st.text }}
                    onclick={(e) => (e.stopPropagation(), onSelect(st.id))}
                    ondblclick={(e) => (e.stopPropagation(), onBeginEditState(st.id))}
                    onkeydown={(e) => onLineKeydown(e, st.id)}
                >{st.text || "(no line)"}</button>
            {:else}
                <span class="line" use:clipTitle={{ label: st.id, text: st.text }}>{st.text || "(no line)"}</span>
            {/if}
        {/if}
        <!-- Node add/delete (hover-revealed) on an editable state: "+" grows a connected child node, "-"
             deletes this state. Delete is shown disabled with a tooltip when the state can't be removed
             (a dialog entry, reached by a call, or referenced from non-editable code). -->
        {#if editableStateIds.has(st.id)}
            {@const canDel = deletableStateIds.has(st.id)}
            <span class="nodeops">
                <!-- Add-child grows a flat option, so (like the tree's "+ option") it is offered only on
                     non-bundle states; a bundle node's options live in its if/else branches. Delete applies
                     to any editable state. -->
                {#if !st.branches}
                    <button
                        class="nodebtn addnode"
                        title="Add a follow-up node (a new option leading to a new state)"
                        onclick={(e) => (e.stopPropagation(), onAddChildNode(st.id))}>+</button
                    >
                {/if}
                <button
                    class="nodebtn delnode"
                    title={canDel
                        ? "Delete this state"
                        : "This state can't be deleted (a dialog entry, reached by a call, or referenced from non-editable code)"}
                    disabled={!canDel}
                    onclick={(e) => (e.stopPropagation(), onDeleteState(st.id))}>-</button
                >
            </span>
        {/if}
    </div>
    {#if !collapsed.has(st.id)}
        {#if st.branches}
            {#each st.branches as b, bi (bi)}
                {@render branchBlock(b, depth, st.id)}
            {/each}
        {:else}
            {#each st.replies as r, i (r.id)}
                {@render replyRow(r, depth, st.id, i, st.replies.length, false)}
            {/each}
            <!-- Trailing "+" that appends an option to this state's list (editable states only). Shown even
                 with zero replies, so a dead-end line can gain its first player option. Indented to the reply
                 column so it reads as "append to this list". -->
            {#if editableStateIds.has(st.id)}
                <div class="addopt" style="--lvl:{depth * 2 + 1}">
                    <button class="addbtn" title="Add an option" onclick={(e) => (e.stopPropagation(), onAddReply(st.id))}>+ option</button>
                </div>
            {/if}
        {/if}
    {/if}
{/snippet}

{#snippet branchBlock(b: ConvBranch, depth: number, ownerId: string)}
    <div class="branchhdr" style="--lvl:{depth * 2 + 1}">
        <span class="bwhen">{b.kind === "if" ? "shown when" : "otherwise"}</span>
        {#if b.kind === "if"}<span class="bcond" title={b.condition}>{b.condition}</span>{/if}
    </div>
    <div class="brep" style="--lvl:{depth * 2 + 1}">
        <span class="line" use:clipTitle={{ label: ownerId, text: b.npc }}>{b.npc || "(no line)"}</span>
    </div>
    {#each b.replies as r, i (r.id)}
        {@render replyRow(r, depth, ownerId, i, b.replies.length, true)}
    {/each}
{/snippet}

{#snippet replyRow(r: ConvReply, depth: number, ownerId: string, index: number, count: number, branchReadonly: boolean)}
    <!-- The whole option row is the selection/focus/nav unit (mirroring a state row): a click anywhere on it
         selects the option, double-click / F2 edits its text, ArrowUp/Down move to the neighbouring row. It
         is a treeitem so it can hold the inner controls (target jump, remove) without a nested-button clash.
         A read-only bundle-branch option row is inert - no role/tabindex/handlers - and its text is a plain
         span. The inner controls (leaf jump, remove, the edit input) stop click/keydown from bubbling so they
         act on themselves, not the row. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- roving tabindex on a treeitem IS the WAI-ARIA tree
         pattern (same as the state rows); Svelte's heuristic wrongly treats treeitem as non-interactive. -->
    <div
        class="rep"
        class:reprow={!branchReadonly}
        class:repsel={ownerId === selectedId && r.id === selectedChoiceId}
        style="--lvl:{depth * 2 + 1}"
        data-owner={branchReadonly ? undefined : ownerId}
        data-choice={branchReadonly ? undefined : r.id}
        role={branchReadonly ? undefined : "treeitem"}
        aria-level={branchReadonly ? undefined : depth + 2}
        aria-selected={branchReadonly ? undefined : ownerId === selectedId && r.id === selectedChoiceId}
        tabindex={branchReadonly ? undefined : r.id === treeFocusId ? 0 : -1}
        onclick={branchReadonly ? undefined : () => onSelectReply(ownerId, r.id)}
        ondblclick={branchReadonly ? undefined : () => r.textEditable && onBeginEditReply(ownerId, r.id)}
        onfocus={branchReadonly ? undefined : () => (treeFocusId = r.id)}
        onkeydown={branchReadonly ? undefined : (e) => onReplyRowKeydown(e, ownerId, r)}
        oncontextmenu={branchReadonly
            ? undefined
            : (e) => (e.preventDefault(), onReplyContext(ownerId, r.id, index, count, e.clientX, e.clientY))}
    >
        <span class="rmark">&#8627;</span>
        <LowIntChip lowIq={r.lowIq} />
        <!-- Condition gate sits to the LEFT of the option text (matching the state row's trigger [if], which
             precedes the NPC line): the [if] reads as a precondition on the option before you read the text.
             The action [do] stays to the RIGHT of the text - it fires when the option is chosen, so it reads
             in flow order (text -> [do] -> target). -->
        {#if r.condition}<span class="rcond" title={r.condition}>[if]</span>{/if}
        {#if !branchReadonly && r.id === editingChoiceId && r.textEditable}
            <!-- Inline edit: the option's text as an input. Enter/blur commit, Escape cancels (both routed
                 through blur). Its click/dblclick/keydown are stopped so cursor placement, word-select and
                 typing (arrows, Space) act on the field, not the row's select / edit / nav. -->
            <input
                class="rtext rtextedit"
                aria-label="Option text"
                use:autofocusSelect
                value={r.text}
                placeholder="(option text)"
                onclick={(e) => e.stopPropagation()}
                ondblclick={(e) => e.stopPropagation()}
                onkeydown={(e) => (e.stopPropagation(), onEditKeydown(e))}
                onblur={(e) => onEditBlur(ownerId, r.id, e)}
            />
        {:else}
            <!-- Static option text: the row owns click-to-select and dblclick/F2-to-edit, so this is a plain
                 span carrying the reaction colour and the clip-aware tooltip. -->
            <span
                class="rtext"
                class:silent={!r.hasText}
                class:r-good={r.hasText && r.reaction === "good"}
                class:r-bad={r.hasText && r.reaction === "bad"}
                class:r-neutral={r.hasText && r.reaction === "neutral"}
                use:clipTitle={{ text: r.hasText ? r.text : undefined }}
            >{r.hasText ? r.text || "(empty option)" : "(continue)"}</span>
        {/if}
        {#if r.action}<span class="ract" title={r.action}>[do]</span>{/if}
        {@render leaf(r)}
        <!-- Inline remove (hover-revealed) on an editable state's flat option. A conditional SSL option is
             shown disabled with a tooltip - its `if` wrapper is not rewritten on save (mirrors the inspector). -->
        {#if !branchReadonly && editableStateIds.has(ownerId)}
            {@const blocked = ssl && Boolean(r.condition)}
            <button
                class="delopt"
                title={blocked ? "Conditional options are removed in the .ssl source" : "Remove option"}
                disabled={blocked}
                onclick={(e) => (e.stopPropagation(), onRemoveReply(ownerId, r.id))}>&#10005;</button
            >
        {/if}
    </div>
    {#if r.target.kind === "state"}
        {@render stateBlock(r.target.node, depth + 1)}
    {/if}
{/snippet}

{#snippet leaf(r: ConvReply)}
    {#if r.target.kind === "exit"}
        {@const t = r.target}
        <span class="lf exit" title={t.nodeId}>EXIT</span>
    {:else if r.target.kind === "combat"}
        {@const t = r.target}
        <span class="lf combat" title={t.nodeId}>COMBAT</span>
    {:else if r.target.kind === "ref"}
        <button class="lf ref" title="Shown elsewhere - jump to it" onclick={(e) => (e.stopPropagation(), onSelect((r.target as { stateId: string }).stateId), reveal((r.target as { stateId: string }).stateId))}>
            &#8631; {(r.target as { stateId: string }).stateId}
        </button>
    {:else if r.target.kind === "external"}
        {@const t = r.target}
        {#if t.jump}
            <button class="lf jump" title="Open in its dialog tab" onclick={(e) => (e.stopPropagation(), onJump(t.jump!.file, t.jump!.stateId))}>&#8599; {t.label}</button>
        {:else}
            <span class="lf ext" title={t.label}>&#8599; {t.label}</span>
        {/if}
    {/if}
{/snippet}

<style>
    .tree {
        font-size: 12px;
        color: #e8eaed;
        padding: 8px 8px 40px;
        user-select: none;
    }
    /* Indent both state and reply rows by their depth; replies sit one notch in
       from their NPC line, child states one notch in from their reply. */
    .st,
    .rep {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        border-radius: 4px;
        line-height: 1.4;
    }
    /* Visual nesting level (--lvl): a state is at 2*depth, its replies at 2*depth+1,
       a reply's child state at 2*(depth+1) - so each step right is one half-turn and
       a child state always sits deeper than the reply that leads to it. */
    .st {
        padding-left: calc(var(--lvl) * 14px + 8px);
        cursor: pointer;
        border: 1px solid transparent;
    }
    .st:hover {
        background: #20242c;
    }
    .st.sel {
        background: #1f2a44;
        border-color: #3b82f6;
    }
    .st.entry .who {
        color: #5eead4;
    }
    .st.derived {
        opacity: 0.92;
    }
    .st.derived .who {
        color: #9aa0a6;
    }
    .rep {
        padding-left: calc(var(--lvl) * 14px + 8px);
    }
    /* A selectable option row (not a read-only bundle-branch row) is clickable and keyboard-focusable like a
       state row: pointer cursor, a hover fill, and a focus ring. Placed before .repsel so the selected fill
       wins over hover (source order, matching .st:hover / .st.sel). */
    .reprow {
        cursor: pointer;
    }
    .reprow:hover {
        background: #20242c;
    }
    .reprow:focus-visible {
        outline: 1px solid #3b82f6;
        outline-offset: -1px;
        border-radius: 4px;
    }
    /* Selected option row: same fill as a selected state (.st.sel) plus an inset left accent, so it reads
       as selected without an outer border that would shift the row. */
    .rep.repsel {
        background: #1f2a44;
        border-radius: 4px;
        box-shadow: inset 2px 0 0 #3b82f6;
    }
    .caret {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 10px;
        padding: 0;
        width: 12px;
        transition: transform 0.1s;
        transform: rotate(90deg);
    }
    .caret.closed {
        transform: rotate(0deg);
    }
    .caret.leafdot {
        color: #475569;
        cursor: default;
        transform: none;
    }
    .who {
        color: #22d3ee;
        font-weight: 700;
        font-size: 10px;
        white-space: nowrap;
    }
    .line {
        color: #93c5fd;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* Editable NPC line rendered as a <button>: reset to read as the
       plain line while staying a focusable, keyboard-operable edit target. Keeps .line's blue text + ellipsis. */
    .line.linebtn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        color: #93c5fd;
        text-align: left;
        cursor: pointer;
        min-width: 0;
        max-width: 100%;
    }
    .line.linebtn:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .line.linebtn:focus-visible {
        outline: 1px solid #3b82f6;
        outline-offset: 1px;
        border-radius: 2px;
    }
    /* Inline NPC-line edit input: fills the line slot, blue-bordered to signal active editing (mirrors the
       option edit's .rtextedit). Overrides .line's dimmed blue text and ellipsis clipping. */
    .line.lineedit {
        flex: 1 1 auto;
        min-width: 0;
        max-width: 420px;
        margin: -1px 0;
        padding: 0 4px;
        font: inherit;
        color: #e8eaed;
        background: #0f1420;
        border: 1px solid #3b82f6;
        border-radius: 3px;
        outline: none;
    }
    /* Bundle (if/else) branch grouping: a faint "shown when ... / otherwise" header above
       each branch's own NPC line and replies, mirroring the inspector's light grouping. */
    .branchhdr {
        padding-left: calc(var(--lvl) * 14px + 8px);
        font-size: 9px;
        font-style: italic;
        line-height: 1.6;
        display: flex;
        gap: 5px;
        align-items: baseline;
    }
    .bwhen {
        color: #8b93a1;
    }
    .bcond {
        color: #f59e0b;
        font-family: var(--vscode-editor-font-family, monospace);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .brep {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        padding-left: calc(var(--lvl) * 14px + 8px);
        line-height: 1.4;
    }
    .rmark {
        color: #475569;
    }
    /* Option text. min-width:0 lets it shrink and ellipsize inside the flex row; the row itself (.reprow) is
       the focusable selection target now, not this span. */
    .rtext {
        color: #cbd5e1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    /* Inline edit input: fills the option-text slot, blue-bordered to signal active editing. Negative
       vertical margin keeps the row height unchanged when the text swaps to the input. */
    .rtextedit {
        flex: 1 1 auto;
        min-width: 0;
        max-width: 420px;
        margin: -1px 0;
        padding: 0 4px;
        font: inherit;
        color: #e8eaed;
        background: #0f1420;
        border: 1px solid #3b82f6;
        border-radius: 3px;
        outline: none;
    }
    .rtext.silent {
        color: #64748b;
        font-style: italic;
    }
    /* Reaction text color mirrors the graph card (good green, bad red, neutral quiet) so the same
       reply reads the same way in both views. `.silent` (a continue, no reaction) still wins above. */
    .rtext.r-good {
        color: #86efac;
    }
    .rtext.r-bad {
        color: #fca5a5;
    }
    .rtext.r-neutral {
        color: #cbd5e1;
    }
    .cond,
    .rcond {
        color: #f59e0b;
        font-size: 9px;
    }
    .ract {
        color: #c084fc;
        font-size: 9px;
    }
    .lf {
        font-size: 10px;
        border-radius: 3px;
        padding: 0 4px;
        white-space: nowrap;
    }
    .lf.exit {
        color: #fca5a5;
        border: 1px solid #7f1d1d;
    }
    .lf.combat {
        color: #fecaca;
        border: 1px solid #b91c1c;
        background: #3b1515;
    }
    span.lf.ext {
        color: #fbbf24;
        border: 1px dashed #a16207;
    }
    button.lf {
        background: none;
        cursor: pointer;
        font-family: inherit;
    }
    button.lf.ref {
        color: #93c5fd;
        border: 1px solid #1e3a5f;
    }
    button.lf.jump {
        color: #fcd34d;
        border: 1px solid #a16207;
        background: #33291a;
    }
    button.lf.ref:hover,
    button.lf.jump:hover {
        filter: brightness(1.2);
    }
    /* Trailing "+ option" row: dashed, muted, reading as an append affordance at the end of a state's
       option list rather than another option. Mirrors the inspector's dashed add row at tree scale. */
    .addopt {
        padding: 1px 6px;
        /* Indent to the same reply column as this state's options (matches .rep) so the "+ option"
           reads as "append to THIS list" rather than an ambiguous top-level add. */
        padding-left: calc(var(--lvl) * 14px + 8px);
    }
    .addbtn {
        background: none;
        border: 1px dashed #3a4152;
        border-radius: 4px;
        color: #64748b;
        cursor: pointer;
        font-family: inherit;
        font-size: 10px;
        line-height: 1.4;
        padding: 0 8px;
    }
    .addbtn:hover {
        border-color: #4b5563;
        color: #93a2b8;
        background: #20242c;
    }
    /* Inline remove: hidden until the option row is hovered (or the button is focused for keyboard use). Sits
       inline at the end of the row's content (left-aligned, right after the target), not pushed to the far
       right. Disabled (conditional SSL option) reads dim and non-interactive. */
    .delopt {
        background: none;
        border: none;
        color: #b45; /* muted red, quiet until hover */
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        padding: 0 2px;
        visibility: hidden;
    }
    .rep:hover .delopt,
    .delopt:focus-visible {
        visibility: visible;
    }
    .delopt:hover:not(:disabled) {
        color: #fca5a5;
    }
    .delopt:disabled {
        color: #6b7280;
        cursor: default;
    }
    /* Node add-child ("+") / delete ("-"): hover-revealed at the right of a state row, mirroring the
       option "x". Pushed right by margin-left:auto; the pair sits together. */
    .nodeops {
        margin-left: auto;
        display: inline-flex;
        gap: 2px;
        visibility: hidden;
    }
    .st:hover .nodeops,
    .nodeops:focus-within {
        visibility: visible;
    }
    .nodebtn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        padding: 0 3px;
    }
    .addnode {
        color: #86efac; /* green: additive */
    }
    .addnode:hover {
        color: #bbf7d0;
    }
    .delnode {
        color: #b45; /* muted red, matches the option remove */
    }
    .delnode:hover:not(:disabled) {
        color: #fca5a5;
    }
    .delnode:disabled {
        color: #6b7280;
        cursor: default;
    }
</style>
