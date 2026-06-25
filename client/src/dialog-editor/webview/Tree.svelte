<script lang="ts">
    import type { ConversationTree, ConvState, ConvReply } from "./conversation-tree";

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
</script>

<div class="tree" bind:this={treeEl}>
    {#each tree.roots as st (st.id)}
        {@render stateBlock(st, 0)}
    {/each}
</div>

{#snippet stateBlock(st: ConvState, depth: number)}
    <div
        class="st"
        class:derived={st.derivedFrom}
        class:entry={st.isEntry}
        class:sel={st.id === selectedId}
        style="--lvl:{depth * 2}"
        data-sid={st.id}
        role="button"
        tabindex="0"
        onclick={() => onSelect(st.id)}
        oncontextmenu={(e) => (e.preventDefault(), onContext(st.id, e.clientX, e.clientY))}
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(st.id))}
    >
        {#if st.replies.length > 0}
            <button
                class="caret"
                class:closed={collapsed.has(st.id)}
                title={collapsed.has(st.id) ? "Expand" : "Collapse"}
                onclick={(e) => (e.stopPropagation(), onToggle(st.id))}>&#9656;</button
            >
        {:else}
            <span class="caret leafdot">&bull;</span>
        {/if}
        <span class="who">{st.speaker}</span>
        {#if st.derivedFrom}<span class="badge" title="Read-only: expanded from a {st.derivedFrom} block">{st.derivedFrom}</span>{/if}
        {#if st.trigger}<span class="cond" title={st.trigger}>[if]</span>{/if}
        <span class="line" title={st.text}>{st.text || "(no line)"}</span>
    </div>
    {#if !collapsed.has(st.id)}
        {#each st.replies as r, i (r.id)}
            {@render replyRow(r, depth, st.id, i, st.replies.length)}
        {/each}
    {/if}
{/snippet}

{#snippet replyRow(r: ConvReply, depth: number, ownerId: string, index: number, count: number)}
    <div
        class="rep"
        style="--lvl:{depth * 2 + 1}"
        oncontextmenu={(e) => (e.preventDefault(), onReplyContext(ownerId, r.id, index, count, e.clientX, e.clientY))}
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
    .badge {
        color: #cbd5e1;
        background: #374151;
        border: 1px solid #4b5563;
        border-radius: 3px;
        padding: 0 4px;
        font-size: 8px;
        letter-spacing: 0.04em;
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
