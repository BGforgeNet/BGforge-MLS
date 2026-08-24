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

/**
 * Where a selected line lives in the file: a state's own line, or one of its replies by position. `choiceId`
 * null addresses the state itself. Null when the selection has no record to address - a state the user just
 * added, or a reply id this state does not hold. Kept here rather than in the graph component so the three
 * ways it can refuse are testable; `Number(state.id)` cannot serve, since a dialog-qualified id parses to NaN
 * and NaN reaches the writer as state 0.
 */
export function dlgAddress(
    state: DialogState,
    choiceId: string | null,
): { stateIndex: number; choiceIndex?: number } | null {
    if (state.dlgIndex === undefined) return null;
    if (choiceId === null) return { stateIndex: state.dlgIndex };
    const choiceIndex = state.choices.findIndex((c) => c.id === choiceId);
    return choiceIndex === -1 ? null : { stateIndex: state.dlgIndex, choiceIndex };
}

/**
 * The states this file owns, keyed by their position in its state table. A tree may also hold states pulled
 * in from other dialogs, so the flattened list is not the state table and its positions are not indices; a
 * foreign state is dropped here rather than written into the wrong file.
 */
function ownStatesByIndex(model: DialogModel, ownResref: string): Map<number, DialogState> {
    const own = new Map<number, DialogState>();
    for (const root of model.roots) {
        for (const state of root.states) {
            if (state.dlgResref !== ownResref || state.dlgIndex === undefined) continue;
            own.set(state.dlgIndex, state);
        }
    }
    return own;
}

const STRUCTURE_CHANGED = "dlgTextEdits: the dialog's structure changed, which this path cannot write";

/**
 * The string-reference changes between `original` and `edited` for the dialog `ownResref` names, in file
 * order (each state's own line before its replies). Throws when the edit is one this path cannot express,
 * rather than dropping it: a silently ignored edit reads to the user as a save that worked.
 */
export function dlgTextEdits(original: DialogModel, edited: DialogModel, ownResref: string): DlgTextEdit[] {
    if (original.sourceLang !== "dlg" || edited.sourceLang !== "dlg") {
        throw new Error("dlgTextEdits: both models must come from a compiled dlg");
    }
    const before = ownStatesByIndex(original, ownResref);
    const after = ownStatesByIndex(edited, ownResref);
    if (before.size !== after.size) throw new Error(STRUCTURE_CHANGED);

    const edits: DlgTextEdit[] = [];
    for (const stateIndex of [...before.keys()].sort((a, b) => a - b)) {
        const originalState = before.get(stateIndex)!;
        const editedState = after.get(stateIndex);
        if (!editedState || originalState.choices.length !== editedState.choices.length) {
            throw new Error(STRUCTURE_CHANGED);
        }
        if (editedState.text !== originalState.text) {
            edits.push({ stateIndex, strref: strrefOf(editedState.text, `state ${stateIndex}`) });
        }
        // A reply is addressed by its position within its state, which is what the writer turns back into a
        // transition index - the state owns a consecutive run of the table.
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
