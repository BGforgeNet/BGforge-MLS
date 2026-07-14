/**
 * Find-in-tree: collect the conversation rows whose visible text (or node id) matches a query, in the order
 * they appear top-to-bottom in the outline, so a find-bar can walk them with next/prev. Dialogue text is
 * always searched; code-bearing text (triggers, conditions, actions) is opt-in via `includeCode` - see
 * `SearchOptions`.
 *
 * Pure and presentation-free (mirrors conversation-tree.ts): it reads the already-resolved display text off
 * the ConversationTree the tree view renders, so a match is exactly a visible row - no re-resolution, no
 * source access. Each match carries the same selection coordinates the tree's click handlers use, so
 * navigating a match reuses the existing select + reveal + scroll path.
 */
import { childStates, type ConvBlock, type ConvState, type ConversationTree } from "./conversation-tree";

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
    /** "dialogue" for a node id/NPC line/option-text match (produced regardless of `includeCode`); "code" for
        a trigger/condition/action match (produced only when `includeCode` is set). */
    kind: "dialogue" | "code";
}

export interface SearchOptions {
    /** Also hit-test code-bearing text - state triggers, choice conditions/actions, and branch conditions -
        alongside dialogue. Off by default: a condition renders as a heading, its text is code, not dialogue
        (see the module comment); this is the opt-in escape hatch for finding it anyway. */
    includeCode?: boolean;
}

function hit(haystack: string | undefined, needle: string): boolean {
    return haystack !== undefined && haystack.toLowerCase().includes(needle);
}

/**
 * Every match for `rawQuery`, in outline order. Empty for a blank query. Matches node ids, NPC line text
 * (flat, branch, and nested block), and player option text - the same content the tree shows. With
 * `opts.includeCode`, also matches state triggers, choice conditions/actions, and branch conditions; a row
 * matching in both dialogue and code yields one match (dialogue wins).
 */
export function collectMatches(tree: ConversationTree, rawQuery: string, opts?: SearchOptions): SearchMatch[] {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const includeCode = opts?.includeCode ?? false;
    const out: SearchMatch[] = [];
    // A state is fully expanded once (conversation-tree's first-expansion-wins), so the "state" targets form a
    // DAG and this walk terminates; `seen` is belt-and-suspenders against any future non-DAG shape.
    const seen = new Set<ConvState>();

    // A row's match kind: "dialogue" if its dialogue text hits, else "code" if `includeCode` and any of its
    // code-bearing text hits, else undefined (no match). Dialogue always wins so a row matching both never
    // yields two entries.
    const rowKind = (
        dialogue: string | undefined,
        ...code: (string | undefined)[]
    ): "dialogue" | "code" | undefined => {
        if (hit(dialogue, q)) return "dialogue";
        if (includeCode && code.some((c) => hit(c, q))) return "code";
        return undefined;
    };

    // A nested block (structured node): a top-level line (no branchKey) is the node's own line and selects the
    // state; a line inside an if/else carries a branchKey and selects that branch. A group's own condition is
    // stamped onto its thenBlock/elseBlock opening line (see conversation-tree.ts stampBranchKeys), so testing
    // the line's `condition` covers the branch-opening heading; the group node itself carries no separate row.
    const walkBlock = (block: ConvBlock, stateId: string): void => {
        for (const item of block) {
            if (item.kind === "line") {
                const k = rowKind(item.npc, item.condition);
                if (k) {
                    if (item.branchKey) out.push({ key: item.branchKey, stateId, branchKey: item.branchKey, kind: k });
                    else out.push({ key: stateId, stateId, kind: k });
                }
            } else if (item.kind === "reply") {
                const k = rowKind(item.reply.text, item.reply.condition, item.reply.action);
                if (k) out.push({ key: item.reply.id, stateId, choiceId: item.reply.id, kind: k });
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
        // The trigger is code-bearing (a condition, not dialogue), so it only widens the row's own id/text hit.
        const stateDialogue = hit(s.id, q) || (!s.branches && !s.block && hit(s.text, q));
        if (stateDialogue) out.push({ key: s.id, stateId: s.id, kind: "dialogue" });
        else if (includeCode && hit(s.trigger, q)) out.push({ key: s.id, stateId: s.id, kind: "code" });

        if (s.branches) {
            for (const b of s.branches) {
                const bk = rowKind(b.npc, b.condition);
                if (bk) out.push({ key: b.branchKey ?? s.id, stateId: s.id, branchKey: b.branchKey, kind: bk });
                for (const r of b.replies) {
                    const rk = rowKind(r.text, r.condition, r.action);
                    if (rk) out.push({ key: r.id, stateId: s.id, choiceId: r.id, kind: rk });
                }
            }
        } else if (s.block) {
            walkBlock(s.block, s.id);
        } else {
            for (const r of s.replies) {
                const rk = rowKind(r.text, r.condition, r.action);
                if (rk) out.push({ key: r.id, stateId: s.id, choiceId: r.id, kind: rk });
            }
        }

        // Recurse into child states (first-expansion `state` targets), in render order: flat/branch replies,
        // then block replies. Uses the shared `childStates` so matches follow the same visible layout every
        // tree walk (reveal, collapse-all) traverses.
        for (const k of childStates(s)) walkState(k);
    };

    for (const root of tree.roots) walkState(root);
    return out;
}
