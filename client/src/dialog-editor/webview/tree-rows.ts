/**
 * The tree outline's flat row projection.
 *
 * The outline renders a bounded window of rows rather than the whole conversation, and a window needs a
 * linear list to slice - so the recursive nesting is flattened here, once, into the exact row sequence the
 * view draws.
 */
import type { ConvBlock, ConvReply, ConvState } from "./conversation-tree";

/**
 * Fields every row carries.
 *
 * `depth` is the conversation nesting level, which the view turns into an indent: a state indents by
 * `depth * 2`, and the rows belonging to it by one half-notch more. `key` identifies the row for the keyed
 * `{#each}` the outline renders - stable across re-projections so a row keeps its DOM node, and unique across
 * the whole list, since a repeat would silently drop rows.
 */
interface RowBase {
    key: string;
    depth: number;
}

/** One rendered row of the outline. */
export type FlatRow =
    | (RowBase & { kind: "state"; state: ConvState })
    /** A continuation SAY line of a multisay state; line 1 sits on the state row itself. */
    | (RowBase & { kind: "sayCont"; stateId: string; line: string })
    /**
     * A branch's opening NPC line with its own [if]/[else] gate.
     *
     * One row kind for both sources - a bundle node's `branches` and a structured node's block `line` items -
     * because the view draws them identically; normalising here keeps the renderer from carrying two copies.
     */
    | (RowBase & {
          kind: "branchLine";
          ownerId: string;
          npc: string;
          condition?: string;
          isElse: boolean;
          branchKey?: string;
      })
    /**
     * A player option.
     *
     * `ownerId` is the state it belongs to - the row acts on that state, and the option alone is not enough.
     * `index`/`count` are its position in the list the reorder menu moves it within. `branchReadonly` marks an
     * option owned by a bundle or structured node: selectable and inspectable, but structurally frozen.
     */
    | (RowBase & {
          kind: "reply";
          reply: ConvReply;
          ownerId: string;
          index: number;
          count: number;
          branchReadonly: boolean;
      })
    /** Trailing "+ option" affordance, so a dead-end line can gain its first option. */
    | (RowBase & { kind: "addOption"; stateId: string });

/**
 * The level a row is announced at, or undefined for a row that carries no `treeitem` role.
 *
 * An option sits one level below the state that owns it, and the state an option leads to is emitted at the
 * SAME level as that option - the two read as siblings under their common parent, which is how the outline
 * indents them. One home for the rule, because `ariaPositions` has to group by exactly the levels the view
 * renders.
 */
export function rowAriaLevel(row: FlatRow): number | undefined {
    if (row.kind === "state") return row.depth + 1;
    if (row.kind === "reply") return row.depth + 2;
    return undefined;
}

/**
 * `aria-posinset` and `aria-setsize` for every treeitem row, keyed by row key.
 *
 * Both attributes describe the set of nodes at ONE level under ONE parent, which is the whole reason a
 * virtualized tree owes them: the DOM holds a window, so assistive tech cannot count the set itself. The
 * whole row list's length is not that number - it counts rows carrying no treeitem role at all, and it
 * announces a deeply nested option as one of thousands rather than one of its siblings.
 */
export function ariaPositions(rows: readonly FlatRow[]): Map<string, { pos: number; size: number }> {
    // Sibling sets, in row order, keyed by parent row and level. A row's parent is the nearest preceding
    // treeitem at a lower level, which the ancestor stack tracks as the walk goes.
    const sets = new Map<string, string[]>();
    const ancestors: { level: number; key: string }[] = [];
    for (const row of rows) {
        const level = rowAriaLevel(row);
        if (level === undefined) continue;
        while ((ancestors.at(-1)?.level ?? 0) >= level) ancestors.pop();
        // NUL separates the two parts so a parent key ending in digits cannot collide with a deeper level.
        const setKey = `${ancestors.at(-1)?.key ?? ""}\0${level}`;
        const members = sets.get(setKey);
        if (members) members.push(row.key);
        else sets.set(setKey, [row.key]);
        ancestors.push({ level, key: row.key });
    }

    const positions = new Map<string, { pos: number; size: number }>();
    for (const members of sets.values()) {
        for (const [index, key] of members.entries()) positions.set(key, { pos: index + 1, size: members.length });
    }
    return positions;
}

/**
 * An option's key identity: its id plus the SHAPE of its target, and for a `state` target the destination's
 * id.
 *
 * The target belongs in the key because a live re-parse can flip it - a `state` target becomes `external`
 * when its destination node vanishes from a mid-edit parse. Keyed on the id alone, the view reuses the row in
 * place and re-runs its deriveds against the now-stale target in the same reactive flush, which threw and
 * aborted the flush, wedging the tree until the panel was reopened. A changed key tears the row down instead.
 */
function replyIdentity(reply: ConvReply): string {
    return reply.target.kind === "state" ? `${reply.id}@${reply.target.node.id}` : `${reply.id}#${reply.target.kind}`;
}

/**
 * Every row the outline draws, in render order.
 *
 * `collapsed` hides a state's subtree; `editableStateIds` decides which states get a trailing "+ option" row.
 */
export function flattenRows(
    roots: readonly ConvState[],
    collapsed: ReadonlySet<string>,
    editableStateIds: ReadonlySet<string>,
): FlatRow[] {
    const rows: FlatRow[] = [];
    // Recursive, one frame per nesting level, matching `buildConversationTree`'s own `expand`. Making this
    // iterative would not raise the depth the outline survives while the builder that feeds it stays
    // recursive, and the builder's limit is far above the deepest real dialog.
    const walk = (state: ConvState, depth: number): void => {
        rows.push({ key: `s:${state.id}`, kind: "state", depth, state });
        if (collapsed.has(state.id)) return;
        for (const [index, line] of (state.sayLines ?? []).entries()) {
            rows.push({ key: `y:${state.id}:${index}`, kind: "sayCont", depth, stateId: state.id, line });
        }
        // One emitter for both arms below: an option row is followed by its target's sub-tree wherever the
        // option came from, so branch options and flat options must not drift apart.
        const emitReply = (reply: ConvReply, index: number, count: number, branchReadonly: boolean): void => {
            rows.push({
                key: `r:${state.id}:${replyIdentity(reply)}`,
                kind: "reply",
                depth,
                reply,
                ownerId: state.id,
                index,
                count,
                branchReadonly,
            });
            if (reply.target.kind === "state") walk(reply.target.node, depth + 1);
        };
        // Branch lines are keyed by position within their owner, not by `branchKey`: an unconditional
        // top-level line has none, so two of them under one state would collide on a shared fallback.
        let branchLineSeq = 0;

        if (state.block) {
            // A group contributes no row of its own: its gate rides on the branch lines and options inside it,
            // so the then-block is walked first and the else-block straight after, in source order.
            const emitBlock = (block: ConvBlock): void => {
                for (const [index, item] of block.entries()) {
                    if (item.kind === "line") {
                        rows.push({
                            key: `b:${state.id}:${branchLineSeq++}`,
                            kind: "branchLine",
                            depth,
                            ownerId: state.id,
                            npc: item.npc,
                            condition: item.condition,
                            isElse: item.isElse ?? false,
                            branchKey: item.branchKey,
                        });
                    } else if (item.kind === "reply") {
                        // Position is within the BLOCK, which also holds line and group items - matching what
                        // the reorder menu was given before, so an option's menu acts on the same neighbours.
                        emitReply(item.reply, index, block.length, true);
                    } else {
                        emitBlock(item.thenBlock);
                        if (item.elseBlock) emitBlock(item.elseBlock);
                    }
                }
            };
            // The node's opening line is drawn on the state row itself, so the block skips it here.
            emitBlock(state.block[0]?.kind === "line" ? state.block.slice(1) : state.block);
            return;
        }

        if (state.branches) {
            // A bundle node's options live inside its branches, so it offers no trailing "+ option".
            for (const branch of state.branches) {
                rows.push({
                    key: `b:${state.id}:${branchLineSeq++}`,
                    kind: "branchLine",
                    depth,
                    ownerId: state.id,
                    npc: branch.npc,
                    condition: branch.condition,
                    isElse: branch.kind === "else",
                    branchKey: branch.branchKey,
                });
                for (const [index, reply] of branch.replies.entries()) {
                    emitReply(reply, index, branch.replies.length, true);
                }
            }
            return;
        }

        for (const [index, reply] of state.replies.entries()) {
            emitReply(reply, index, state.replies.length, false);
        }
        if (editableStateIds.has(state.id))
            rows.push({ key: `a:${state.id}`, kind: "addOption", depth, stateId: state.id });
    };
    for (const state of roots) walk(state, 0);
    return rows;
}
