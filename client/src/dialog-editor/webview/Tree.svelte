<script lang="ts">
    import type { ConversationTree, ConvState, ConvReply, ConvBranch } from "./conversation-tree";
    import Badge from "./Badge.svelte";

    // Conversation-flow tree (built by conversation-tree.ts). Renders states and
    // their player replies as a nested outline; clicking a state selects it for the
    // shared Inspector, clicking a cross-file leaf jumps to that dialog's tab, and
    // clicking a "shown elsewhere" ref selects the expanded copy.
    let { tree, selectedId, collapsed, onSelect, onToggle, onJump, onContext, onReplyContext }: {
        tree: ConversationTree;
        selectedId?: string | null;
        /** Ids of collapsed states (default expanded). Owned by the parent so the
            toolbar's expand-all / collapse-all can drive it. */
        collapsed: Set<string>;
        onSelect: (stateId: string) => void;
        onToggle: (stateId: string) => void;
        onJump: (file: string, stateId: string) => void;
        /** Right-click on a state row, at viewport coords - opens the parent's menu. */
        onContext: (stateId: string, x: number, y: number) => void;
        /** Right-click on a reply row: owner state id, choice id, its index and the
            owner's reply count (for move-up/down bounds), and viewport coords. */
        onReplyContext: (stateId: string, choiceId: string, index: number, count: number, x: number, y: number) => void;
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
        <!-- WeiDU D shows the speaker name; SSL has none, so show the node id (as the cards do) instead of a
             meaningless "NPC" on every line. -->
        <span class="who">{st.speaker ?? st.id}</span>
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
        style="--lvl:{depth * 2 + 1}"
        oncontextmenu={branchReadonly
            ? undefined
            : (e) => (e.preventDefault(), onReplyContext(ownerId, r.id, index, count, e.clientX, e.clientY))}
    >
        <span class="rmark">&#8627;</span>
        <span class="rtext" class:silent={!r.hasText} title={r.hasText ? r.text : undefined}>{r.hasText ? r.text || "(empty reply)" : "(continue)"}</span>
        {#if r.condition}<span class="rcond" title={r.condition}>[if]</span>{/if}
        {#if r.action}<span class="ract" title={r.action}>[do]</span>{/if}
        {@render leaf(r)}
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
        color: #e8eaed;
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
        color: #bfe66a;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rtext.silent {
        color: #64748b;
        font-style: italic;
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
</style>
