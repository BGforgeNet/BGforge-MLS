import type { DialogModel } from "./dialog-model";

/** A new option is one with no source `callRange` (it never existed in the .ssl) and literal text. */
function isNewOption(choice: { callRange?: unknown; text?: string }): boolean {
    return choice.callRange === undefined && choice.text !== undefined && choice.text.trim() !== "";
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
    const numericIds = Object.keys(existingMessages)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isFinite(n));
    let next = (numericIds.length > 0 ? Math.max(...numericIds) : 0) + 1;
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
