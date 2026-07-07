/**
 * Find-in-tree: collect the conversation rows whose visible text (or node id) matches a query, in the order
 * they appear top-to-bottom in the outline, so a find-bar can walk them with next/prev.
 *
 * Pure and presentation-free (mirrors conversation-tree.ts): it reads the already-resolved display text off
 * the ConversationTree the tree view renders, so a match is exactly a visible row - no re-resolution, no
 * source access. Each match carries the same selection coordinates the tree's click handlers use, so
 * navigating a match reuses the existing select + reveal + scroll path.
 */
import type { ConvBlock, ConvState, ConversationTree } from "./conversation-tree";

export interface SearchMatch {
    /** Row key for the tree highlight: a state id (node/flat-line match), a choice id (option match), or a
        branch key (if/else branch-line match). The three namespaces never collide - a choice id is
        `<node>#opt*`/`#call*`, a branch key `<node>#*if`/`#*else`/`#branch*`, a state id has no `#`. */
    key: string;
    /** Owner state to select and reveal. */
    stateId: string;
    /** Set for an option match - selects the option (highlights it + focuses its Inspector field). */
    choiceId?: string;
    /** Set for an if/else branch-line match - selects the owner state and highlights that branch's run. */
    branchKey?: string;
}

function hit(haystack: string | undefined, needle: string): boolean {
    return haystack !== undefined && haystack.toLowerCase().includes(needle);
}

/**
 * Every match for `rawQuery`, in outline order. Empty for a blank query. Matches node ids, NPC line text
 * (flat, branch, and nested block), and player option text - the same content the tree shows.
 */
export function collectMatches(tree: ConversationTree, rawQuery: string): SearchMatch[] {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const out: SearchMatch[] = [];
    // A state is fully expanded once (conversation-tree's first-expansion-wins), so the "state" targets form a
    // DAG and this walk terminates; `seen` is belt-and-suspenders against any future non-DAG shape.
    const seen = new Set<ConvState>();

    // A nested block (structured node): a top-level line (no branchKey) is the node's own line and selects the
    // state; a line inside an if/else carries a branchKey and selects that branch. Groups only nest - the
    // condition itself is not a searchable line (it renders as a heading, its text is code, not dialogue).
    const walkBlock = (block: ConvBlock, stateId: string): void => {
        for (const item of block) {
            if (item.kind === "line") {
                if (hit(item.npc, q)) {
                    if (item.branchKey) out.push({ key: item.branchKey, stateId, branchKey: item.branchKey });
                    else out.push({ key: stateId, stateId });
                }
            } else if (item.kind === "reply") {
                if (hit(item.reply.text, q)) out.push({ key: item.reply.id, stateId, choiceId: item.reply.id });
            } else {
                walkBlock(item.thenBlock, stateId);
                if (item.elseBlock) walkBlock(item.elseBlock, stateId);
            }
        }
    };

    const walkState = (s: ConvState): void => {
        if (seen.has(s)) return;
        seen.add(s);

        // Node id, or the flat node's own line text, selects the whole state. Bundle/structured nodes keep
        // their line text in `branches`/`block` (matched below), so only match `text` for a plain flat node.
        if (hit(s.id, q) || (!s.branches && !s.block && hit(s.text, q))) out.push({ key: s.id, stateId: s.id });

        if (s.branches) {
            for (const b of s.branches) {
                if (hit(b.npc, q)) out.push({ key: b.branchKey ?? s.id, stateId: s.id, branchKey: b.branchKey });
                for (const r of b.replies) if (hit(r.text, q)) out.push({ key: r.id, stateId: s.id, choiceId: r.id });
            }
        } else if (s.block) {
            walkBlock(s.block, s.id);
        } else {
            for (const r of s.replies) if (hit(r.text, q)) out.push({ key: r.id, stateId: s.id, choiceId: r.id });
        }

        // Recurse into child states (first-expansion `state` targets), in render order: flat/branch replies,
        // then block replies. Mirrors Tree.svelte's ancestorsOf so matches follow the visible layout.
        const kids: ConvState[] = [];
        if (s.branches)
            for (const b of s.branches)
                for (const r of b.replies) if (r.target.kind === "state") kids.push(r.target.node);
        for (const r of s.replies) if (r.target.kind === "state") kids.push(r.target.node);
        if (s.block) collectBlockTargets(s.block, kids);
        for (const k of kids) walkState(k);
    };

    for (const root of tree.roots) walkState(root);
    return out;
}

/** Child states reached by a structured node's block replies, in block order (for the render-order recursion). */
function collectBlockTargets(block: ConvBlock, out: ConvState[]): void {
    for (const item of block) {
        if (item.kind === "reply") {
            if (item.reply.target.kind === "state") out.push(item.reply.target.node);
        } else if (item.kind === "group") {
            collectBlockTargets(item.thenBlock, out);
            if (item.elseBlock) collectBlockTargets(item.elseBlock, out);
        }
    }
}
