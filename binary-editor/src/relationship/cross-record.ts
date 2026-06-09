import type { Diagnostic } from "../types";
import type { Model } from "../model";
import { findGroup, childGroups, fieldsByKey, fieldNumber } from "./model-helpers";

/** CRE spell-memorization-info entries slice [firstMemorizedSpellIndex, +memorizedSpellCount) into the
 *  Memorized Spells list. A slice running past the list end (or starting past it) is a dangling reference:
 *  warn on the count field and offer to clamp the count so the slice fits. */
export function creMeminfoRefConstraint(model: Model): Diagnostic[] {
    const memGroup = findGroup(model, "Memorized Spells");
    const infoGroup = findGroup(model, "Spell Memorization Info");
    if (!memGroup || !infoGroup) return [];
    const listLen = childGroups(model, memGroup).length;
    const diags: Diagnostic[] = [];
    for (const entry of childGroups(model, infoGroup)) {
        const f = fieldsByKey(model, entry);
        const startField = f.get("firstmemorizedspellindex");
        const countField = f.get("memorizedspellcount");
        if (!startField || !countField) continue;
        const start = fieldNumber(startField);
        const count = fieldNumber(countField);
        if (start === undefined || count === undefined || count <= 0) continue;
        if (start >= 0 && start + count <= listLen) continue; // in range
        const clamped = Math.max(0, listLen - Math.max(0, start));
        diags.push({
            nodeId: countField.id,
            severity: "warning",
            message: `Memorized-spell slice [${start}, ${start + count}) runs past the Memorized Spells list (${listLen}).`,
            quickFix: { label: "Clamp count to fit", edits: [{ nodeId: countField.id, value: clamped }] },
        });
    }
    return diags;
}
