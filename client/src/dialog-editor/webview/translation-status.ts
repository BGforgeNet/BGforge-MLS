/**
 * Translation-resolution status for the open dialog.
 *
 * The dialog model's `messages` come from the server's shared translation resolver (getMessages ->
 * resolveTraFileKey): a `@tra` first-line directive, else an `auto_tra` basename match under the
 * configured `.bgforge.yml` `translation.directory` (default `tra`). A nested `tra/<language>/` layout
 * (e.g. BG1NPC) does NOT auto-resolve - the basename key never matches the language-subdir path - so
 * `getMessages` returns nothing and every `@N` renders as its raw ref. That failure is otherwise silent;
 * this count drives the editor's banner that tells the author how to point the tra path.
 */
import { msgRef } from "./inspector-edit";
import type { DialogModel } from "../../../../shared/dialog-model";

/**
 * How many `@N` refs (NPC lines and option text) the model could not resolve to real message text.
 *
 * Only a BARE `@N` counts (a literal line is not a ref). A just-added state/option needs no special case:
 * until save allocates its `@N` its text is empty or a literal (so `msgRef` is null and it is not counted),
 * and once allocated the entry is in `messages` (so it resolves). Do NOT gate on `isPendingState`/procRange
 * here - `procRange` is an SSL-only span, absent on every WeiDU D state, so a procRange gate would skip all
 * D states and the count would always be zero for D.
 */
export function unresolvedRefCount(model: DialogModel): number {
    const messages = model.messages ?? {};
    let count = 0;
    for (const root of model.roots) {
        for (const s of root.states) {
            for (const text of [s.text, ...s.choices.map((c) => c.text)]) {
                const key = msgRef(text);
                if (key !== null && messages[key] === undefined) count++;
            }
        }
    }
    return count;
}
