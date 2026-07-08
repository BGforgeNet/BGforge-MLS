/**
 * WeiDU D-family (`.d` and `.td`) translation-string id allocator. Mints fresh `@N` ids for the reply/say
 * text of NEWLY-authored states and options so a save can splice `tra(N)` / `SAY @N` referencing them and
 * append the literal to the `.tra`. The SSL family has its own two-pass allocator (dialog-ssl-ids.ts); this is
 * the D-family counterpart, kept deliberately parallel (same `max(existing id)+1` seed, same idempotency on
 * already-`@N` text) so both mint ids the same way and persist via the same `.tra`/`.msg` side-write.
 */

import type { DialogModel } from "./dialog-model";

/**
 * A text needing a fresh id: a non-empty literal that is NOT already an `@<id>` ref. Excluding `@N` keeps
 * allocation idempotent (a re-run mints nothing) and lets a user reference an existing string by typing `@25`
 * without minting a duplicate id.
 */
function isNewText(text: string | undefined): boolean {
    const t = (text ?? "").trim();
    return t !== "" && !/^@\d+$/.test(t);
}

/** The first free id: `max(existing numeric id) + 1` (1 when the set is empty/non-numeric). */
function nextIdSeed(existingMessages: Record<string, string>): number {
    const ids = Object.keys(existingMessages)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isFinite(n));
    return (ids.length > 0 ? Math.max(...ids) : 0) + 1;
}

/**
 * Assign a fresh `.tra` id to every NEW state say and NEW option reply (mutating each new item's `text` to
 * `@<id>`), and return the id->text map of entries to append to the `.tra`. "New" means the item carries no
 * source span (`sourceRange === undefined`) and its text is a literal not already `@N` - so an EXISTING literal
 * say/reply (which has a span and round-trips as its source form) is left alone, and only content authored in
 * the editor is given a ref. A derived state (CHAIN/INTERJECT/EXTEND) is skipped: it has no span but is not
 * authored here. Ids start at `max(existing id) + 1` and increase in document order, so a save that adds N
 * items never collides with an on-disk id or another new item. `existingMessages` is the on-disk `.tra` set
 * (the source of the current max), read where the save runs.
 */
export function allocateDFamilyIds(
    model: DialogModel,
    existingMessages: Record<string, string>,
): Record<string, string> {
    let next = nextIdSeed(existingMessages);
    const created: Record<string, string> = {};
    for (const root of model.roots) {
        for (const state of root.states) {
            if (state.derivedFrom) continue;
            if (state.sourceRange === undefined && isNewText(state.text)) {
                const id = String(next++);
                created[id] = state.text;
                state.text = `@${id}`;
            }
            for (const c of state.choices) {
                if (c.sourceRange === undefined && isNewText(c.text)) {
                    const id = String(next++);
                    created[id] = c.text!;
                    c.text = `@${id}`;
                }
            }
        }
    }
    return created;
}
