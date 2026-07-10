import { nextIdSeed } from "./dialog-edit-common";
import type { DialogModel } from "./dialog-model";
import type { NodeMsgIds } from "./dialog-ssl-serialize";

/**
 * A new option needing an id: no source `callRange` (it never existed in the .ssl) and literal text that is
 * not already an `@<id>` ref. Excluding `@N` keeps allocation idempotent and composition-order-safe -
 * `allocateNodeIds` rewrites a new node's options to `@<id>` first, so `allocateOptionIds` must not re-claim
 * them - and lets a user reference an existing message by typing `@150` without minting a duplicate id.
 */
function isNewOption(choice: { callRange?: unknown; text?: string }): boolean {
    const t = (choice.text ?? "").trim();
    return choice.callRange === undefined && t !== "" && !/^@\d+$/.test(t);
}

/** A new node: no source `procRange` (it never existed in the .ssl). */
function isNewNode(state: { procRange?: unknown }): boolean {
    return state.procRange === undefined;
}

/**
 * Assign a fresh `.msg` id to every new SSL option (mutating each new option's `text` to `@<id>`), and return
 * the id->text map of entries to append. Ids start at `max(existing numeric id) + 1` and increase, so a save
 * that adds N options never collides with an on-disk id or with another new option. `existingMessages` is the
 * on-disk message set (the source of the current max), read where the save runs.
 */
export function allocateOptionIds(
    model: DialogModel,
    existingMessages: Record<string, string>,
): Record<string, string> {
    let next = nextIdSeed(existingMessages);
    const created: Record<string, string> = {};
    for (const root of model.roots) {
        for (const state of root.states) {
            for (const choice of state.choices) {
                if (!isNewOption(choice)) continue;
                const id = String(next++);
                created[id] = choice.text!;
                choice.text = `@${id}`;
            }
        }
    }
    return created;
}

/**
 * Allocate ids for every NEW node's reply line and options (mutating their `text` to `@<id>`), returning a
 * per-node id map (for the procedure serializer) and the id->text entries to append to the `.msg`. Ids start at
 * `max(existing numeric id) + 1`. A new node with no reply text gets `reply: undefined`. Textless options are
 * skipped. Allocation is idempotent on `@<id>` text: a reply or option that already carries a ref keeps it and
 * mints nothing - so a DUPLICATED node (which shares the source node's `@N` strings, like D) reuses those ids
 * rather than minting bogus new ones, and a re-run never double-allocates.
 *
 * An EXISTING node (a `procRange`, adopted from a parse) also gets its reply allocated when the SOURCE has no
 * Reply statement and the user typed the line: after a from-scratch scaffold the webview adopts the re-parse,
 * so the node the user keeps editing is source-present with an EMPTY reply - the typed literal needs an `@N`
 * for the writer to splice `Reply(@N);` into the procedure (replyOps). Gated on `replylessInSource` (the
 * ORIGINAL parse's reply being empty), so a node whose source text is a non-`@N` literal for any other reason
 * is never rewritten.
 */
export function allocateNodeIds(
    model: DialogModel,
    existingMessages: Record<string, string>,
    replylessInSource?: ReadonlySet<string>,
): { ids: Map<string, NodeMsgIds>; newMessages: Record<string, string> } {
    let next = nextIdSeed(existingMessages);
    const ids = new Map<string, NodeMsgIds>();
    const newMessages: Record<string, string> = {};
    for (const root of model.roots) {
        for (const state of root.states) {
            const literalReply = state.text.trim() !== "" && !/^@\d+$/.test(state.text.trim());
            if (!isNewNode(state)) {
                if (literalReply && !state.textKind && !state.derivedFrom && replylessInSource?.has(state.id)) {
                    const id = next++;
                    newMessages[String(id)] = state.text;
                    state.text = `@${id}`;
                }
                continue;
            }
            const nodeIds: NodeMsgIds = { reply: undefined, options: {} };
            if (literalReply) {
                const id = next++;
                nodeIds.reply = id;
                newMessages[String(id)] = state.text;
                state.text = `@${id}`;
            }
            for (const c of state.choices) {
                if (!isNewOption(c)) continue; // existing (callRange), textless, or already-@N (shared) option
                const id = next++;
                nodeIds.options[c.id] = id;
                newMessages[String(id)] = c.text!;
                c.text = `@${id}`;
            }
            ids.set(state.id, nodeIds);
        }
    }
    return { ids, newMessages };
}
