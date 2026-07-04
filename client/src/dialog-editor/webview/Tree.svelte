<script lang="ts">
    import type { ConversationTree, ConvState, ConvReply, ConvBranch } from "./conversation-tree";
    import Badge from "./Badge.svelte";
    import ReactionChip from "./ReactionChip.svelte";

    // Conversation-flow tree (built by conversation-tree.ts). Renders states and
    // their player replies as a nested outline; clicking a state selects it for the
    // shared Inspector, clicking a cross-file leaf jumps to that dialog's tab, and
    // clicking a "shown elsewhere" ref selects the expanded copy.
    let { tree, selectedId, selectedChoiceId, editingChoiceId, collapsed, editableStateIds, ssl, onSelect, onSelectReply, onBeginEditReply, onCommitEditReply, onCancelEditReply, onToggle, onJump, onContext, onReplyContext, onAddReply, onRemoveReply }: {
        tree: ConversationTree;
        selectedId?: string | null;
        /** The individually-selected option's choice id (within the selected state), or null when a whole
            state is selected. Highlights that option row. */
        selectedChoiceId?: string | null;
        /** The option currently being edited inline (its text renders as an input), or null. */
        editingChoiceId?: string | null;
        /** Ids of collapsed states (default expanded). Owned by the parent so the
            toolbar's expand-all / collapse-all can drive it. */
        collapsed: Set<string>;
        /** Ids of structurally-editable states (D, or a faithful non-derived SSL node). Only these
            get the inline add ("+") and remove ("x") affordances on their flat option list. */
        editableStateIds: Set<string>;
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
        onToggle: (stateId: string) => void;
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
    } = $props();

    let treeEl: HTMLDivElement | undefined = $state();

    // Scroll a state's row into view (a ref/jump may target a node far elsewhere in the
    // tree). No-op if the row is inside a collapsed branch and so not in the DOM.
    function reveal(id: string): void {
        treeEl?.querySelector(`[data-sid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    }
    // Reveal whatever is selected whenever selection changes: covers clicking a ref
    // leaf, a cross-file jump landing on a freshly-rendered tab, and selection driven
    // from the graph view.
    $effect(() => {
        if (selectedId) reveal(selectedId);
    });

    // Roving-tabindex keyboard navigation (WAI-ARIA tree pattern): exactly one state row is in the tab
    // order at a time; arrows move focus between rows and expand/collapse. Before this, each row was a
    // focusable div wrapping a focusable caret button (two tab stops per row, inconsistent) and the
    // arrow keys did nothing. Defaults the roving target to the selection, else the first root.
    let treeFocusId = $state<string>();
    $effect(() => {
        if (!treeFocusId || !treeEl?.querySelector(`[data-sid="${CSS.escape(treeFocusId)}"]`)) {
            treeFocusId = selectedId ?? tree.roots[0]?.id;
        }
    });

    // Visible state rows in DOM (top-to-bottom) order, for ArrowUp/Down movement.
    function visibleRows(): HTMLElement[] {
        return treeEl ? [...treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
    }
    function focusRow(id: string): void {
        treeFocusId = id;
        treeEl?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(id)}"]`)?.focus();
    }
    function focusRel(id: string, dir: 1 | -1): void {
        const rows = visibleRows();
        const i = rows.findIndex((r) => r.dataset.sid === id);
        const next = rows[i + dir];
        if (next?.dataset.sid) focusRow(next.dataset.sid);
    }
    function onRowKeydown(e: KeyboardEvent, st: ConvState): void {
        const hasKids = st.replies.length > 0 || (st.branches?.length ?? 0) > 0;
        const open = !collapsed.has(st.id);
        switch (e.key) {
            case "Enter":
            case " ":
                e.preventDefault();
                onSelect(st.id);
                break;
            case "ArrowDown":
                e.preventDefault();
                focusRel(st.id, 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                focusRel(st.id, -1);
                break;
            case "ArrowRight":
                // Collapsed with children: expand. Already open: move into the first child row.
                if (hasKids && !open) {
                    e.preventDefault();
                    onToggle(st.id);
                } else if (hasKids) {
                    e.preventDefault();
                    focusRel(st.id, 1);
                }
                break;
            case "ArrowLeft":
                // Open with children: collapse. (Parent navigation is left to ArrowUp.)
                if (hasKids && open) {
                    e.preventDefault();
                    onToggle(st.id);
                }
                break;
        }
    }

    // Inline option-text editing. The edited option renders an <input>; Enter and blur commit, Escape
    // cancels. Enter/Escape route THROUGH blur (they call the input's blur()), so there is exactly one
    // commit/cancel path and no Enter-then-blur double fire. `escaped` carries the Escape intent across to
    // the blur handler; only one option edits at a time (editingChoiceId is single), so one flag suffices.
    let escaped = false;
    function autofocusSelect(el: HTMLInputElement) {
        el.focus();
        el.select();
    }
    function onEditKeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            escaped = true;
            e.currentTarget.blur();
        }
    }
    function onEditBlur(stateId: string, choiceId: string, e: FocusEvent & { currentTarget: HTMLInputElement }): void {
        if (escaped) {
            escaped = false;
            onCancelEditReply();
            return;
        }
        onCommitEditReply(stateId, choiceId, e.currentTarget.value);
    }
    // Begin edit on double-click, or Enter/F2 while the option's text button is focused. A non-editable
    // option (locked SSL @N, read-only node) has no inline input, so the gesture is a no-op there.
    function onReplyTextKeydown(e: KeyboardEvent, ownerId: string, r: ConvReply): void {
        if (r.textEditable && (e.key === "F2" || e.key === "Enter")) {
            e.preventDefault();
            onBeginEditReply(ownerId, r.id);
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
    <div
        class="st"
        class:derived={st.derivedFrom}
        class:entry={st.isEntry}
        class:sel={st.id === selectedId}
        style="--lvl:{depth * 2}"
        data-sid={st.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={st.id === selectedId}
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
             The id is the source-addressable handle (jump/rename), useful but secondary to reading the
             conversation, so show it small and dimmed. SSL has no speaker (one script = one NPC), and the
             file name would just repeat on every row, so SSL rows show only the dimmed id. -->
        {#if st.speaker}<span class="who">{st.speaker}</span>{/if}
        <span class="sid" title="State id (jump/rename target)">{st.id}</span>
        {#if st.derivedFrom}<Badge badges={["derived"]} label={st.derivedFrom} small />{/if}
        {#if st.trigger}<span class="cond" title={st.trigger}>[if]</span>{/if}
        <!-- A bundle node's line lives per-branch (below); only a flat node shows its line here. -->
        {#if !st.branches}<span class="line" title={st.text}>{st.text || "(no line)"}</span>{/if}
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
        <span class="line" title={b.npc}>{b.npc || "(no line)"}</span>
    </div>
    {#each b.replies as r, i (r.id)}
        {@render replyRow(r, depth, ownerId, i, b.replies.length, true)}
    {/each}
{/snippet}

{#snippet replyRow(r: ConvReply, depth: number, ownerId: string, index: number, count: number, branchReadonly: boolean)}
    <div
        class="rep"
        class:repsel={ownerId === selectedId && r.id === selectedChoiceId}
        style="--lvl:{depth * 2 + 1}"
        oncontextmenu={branchReadonly
            ? undefined
            : (e) => (e.preventDefault(), onReplyContext(ownerId, r.id, index, count, e.clientX, e.clientY))}
    >
        <span class="rmark">&#8627;</span>
        <ReactionChip reaction={r.reaction} lowIq={r.lowIq} />
        {#if !branchReadonly && r.id === editingChoiceId && r.textEditable}
            <!-- Inline edit: the option's text as an input. Enter/blur commit, Escape cancels (both routed
                 through blur). Prefilled with the resolved line; a just-added option starts empty. -->
            <input
                class="rtext rtextedit"
                aria-label="Option text"
                use:autofocusSelect
                value={r.text}
                placeholder="(option text)"
                onkeydown={onEditKeydown}
                onblur={(e) => onEditBlur(ownerId, r.id, e)}
            />
        {:else}
            <!-- The option text is the selection/edit affordance: on a flat (non-branch) option it is a
                 <button> - single click selects it (highlight + inspector), double-click / Enter / F2 enters
                 inline edit; a read-only bundle-branch option stays a plain <span>. svelte:element keeps one
                 styled element for both and only wires the handlers for the button. -->
            <svelte:element
                this={branchReadonly ? "span" : "button"}
                role={branchReadonly ? undefined : "button"}
                class="rtext"
                class:rtextbtn={!branchReadonly}
                class:silent={!r.hasText}
                class:r-good={r.hasText && r.reaction === "good"}
                class:r-bad={r.hasText && r.reaction === "bad"}
                class:r-neutral={r.hasText && r.reaction === "neutral"}
                title={r.hasText ? r.text : undefined}
                onclick={branchReadonly ? undefined : () => onSelectReply(ownerId, r.id)}
                ondblclick={branchReadonly ? undefined : () => r.textEditable && onBeginEditReply(ownerId, r.id)}
                onkeydown={branchReadonly ? undefined : (e) => onReplyTextKeydown(e, ownerId, r)}
            >{r.hasText ? r.text || "(empty option)" : "(continue)"}</svelte:element>
        {/if}
        {#if r.condition}<span class="rcond" title={r.condition}>[if]</span>{/if}
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
        <span class="lf exit">EXIT</span>
    {:else if r.target.kind === "ref"}
        <button class="lf ref" title="Shown elsewhere - jump to it" onclick={() => (onSelect((r.target as { stateId: string }).stateId), reveal((r.target as { stateId: string }).stateId))}>
            &#8631; {(r.target as { stateId: string }).stateId}
        </button>
    {:else if r.target.kind === "external"}
        {@const t = r.target}
        {#if t.jump}
            <button class="lf jump" title="Open in its dialog tab" onclick={() => onJump(t.jump!.file, t.jump!.stateId)}>&#8599; {t.label}</button>
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
    /* The state id: a secondary, addressable handle (jump/rename). Dimmed and small so it does not compete
       with the conversation line, which is what the tree is for reading. */
    .sid {
        color: #64748b;
        font-size: 9px;
        white-space: nowrap;
    }
    .line {
        color: #93c5fd;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
    .rtext {
        color: #cbd5e1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* The flat-option text rendered as a <button>: reset to read as text while staying a real, focusable,
       keyboard-operable selection target. min-width:0 lets it shrink and ellipsize inside the flex row. */
    .rtextbtn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
        max-width: 100%;
    }
    .rtextbtn:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .rtextbtn:focus-visible {
        outline: 1px solid #3b82f6;
        outline-offset: 1px;
        border-radius: 2px;
    }
    /* Inline edit input: fills the option-text slot, blue-bordered to signal active editing. Negative
       vertical margin keeps the row height unchanged when the button swaps to the input. */
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
    /* Inline remove: hidden until the option row is hovered (or the button is focused for keyboard use),
       pushed to the far right of the row. Disabled (conditional SSL option) reads dim and non-interactive. */
    .delopt {
        margin-left: auto;
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
</style>
