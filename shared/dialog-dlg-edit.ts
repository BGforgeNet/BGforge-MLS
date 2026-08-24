/**
 * What changed between a compiled dialog's model and an edited copy of it, as edits the DLG writer can apply.
 *
 * The other families splice source text; a DLG has none, so an edit is a change to a record's fields instead.
 * Only the string references are editable: a DLG stores a number pointing into the game's string table, so
 * changing what a line SAYS means pointing it at a different entry, not writing new prose (that would mean
 * editing `dialog.tlk`, which is a different operation on a different file).
 *
 * Pure and structural, so it is unit-testable and carries no dependency on the binary reader; the caller maps
 * a state index and reply position onto the file's own state/transition tables.
 */

import type { DialogModel, DialogState } from "./dialog-model";

/** One string reference to rewrite. `choiceIndex` absent means the state's own line. */
export interface DlgTextEdit {
    readonly stateIndex: number;
    /** Position of the reply within its state, as the model lists them. */
    readonly choiceIndex?: number;
    readonly strref: number;
}

/** Model text for a compiled dialog is always `@<strref>`; anything else cannot be stored. */
function strrefOf(text: string | undefined, where: string): number {
    const match = /^@(\d+)$/.exec((text ?? "").trim());
    if (!match) {
        throw new Error(
            `dlgTextEdits: ${where} must be a string reference from the game's table, not ${JSON.stringify(text)}`,
        );
    }
    return Number(match[1]);
}

function statesOf(model: DialogModel): DialogState[] {
    return model.roots.flatMap((root) => root.states);
}

/**
 * The string-reference changes between `original` and `edited`, in document order (each state's own line
 * before its replies). Throws when the edit is one this path cannot express, rather than dropping it: a
 * silently ignored edit reads to the user as a save that worked.
 */
export function dlgTextEdits(original: DialogModel, edited: DialogModel): DlgTextEdit[] {
    if (original.sourceLang !== "dlg" || edited.sourceLang !== "dlg") {
        throw new Error("dlgTextEdits: both models must come from a compiled dlg");
    }
    const before = statesOf(original);
    const after = statesOf(edited);
    if (before.length !== after.length) {
        throw new Error("dlgTextEdits: the dialog's structure changed, which this path cannot write");
    }

    const edits: DlgTextEdit[] = [];
    for (const [stateIndex, originalState] of before.entries()) {
        const editedState = after[stateIndex]!;
        if (originalState.choices.length !== editedState.choices.length) {
            throw new Error("dlgTextEdits: the dialog's structure changed, which this path cannot write");
        }
        if (editedState.text !== originalState.text) {
            edits.push({ stateIndex, strref: strrefOf(editedState.text, `state ${stateIndex}`) });
        }
        for (const [choiceIndex, originalChoice] of originalState.choices.entries()) {
            const editedChoice = editedState.choices[choiceIndex]!;
            if (editedChoice.text === originalChoice.text) continue;
            edits.push({
                stateIndex,
                choiceIndex,
                strref: strrefOf(editedChoice.text, `state ${stateIndex} reply ${choiceIndex}`),
            });
        }
    }
    return edits;
}
