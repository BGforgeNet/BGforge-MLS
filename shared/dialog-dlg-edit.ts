/**
 * Addressing and model-level edits for a compiled dialog.
 *
 * A DLG stores a NUMBER pointing into the game's string table rather than text, so changing what a line says
 * means pointing it at a different entry. These helpers say WHICH record a selection means and produce the
 * edited model; turning that model back into bytes is the writer's job (`dlg-write.ts`), which is deliberately
 * the only thing that touches records - one writer, so flag and table handling cannot drift between paths.
 *
 * Pure and dependency-free, so it is unit-testable and `shared/` stays clear of the binary reader.
 */

import type { DialogModel, DialogState } from "./dialog-model";

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
 * A copy of `model` with the addressed line pointed at `strref`. The pick path runs through the model rather
 * than editing records directly, so one writer produces every DLG this editor saves - a second record-level
 * path would drift from it on flags and table indices, which is exactly where a silent corruption hides.
 */
export function setDlgLineText(
    model: DialogModel,
    ownResref: string,
    address: { stateIndex: number; choiceIndex?: number },
    strref: number,
): DialogModel {
    const copy = structuredClone(model) as DialogModel;
    const state = ownStatesByIndex(copy, ownResref).get(address.stateIndex);
    if (!state) throw new Error(`setDlgLineText: no state ${address.stateIndex} in ${ownResref}`);
    if (address.choiceIndex === undefined) {
        state.text = `@${strref}`;
        return copy;
    }
    const choice = state.choices[address.choiceIndex];
    if (!choice) {
        throw new Error(`setDlgLineText: state ${address.stateIndex} has no reply ${address.choiceIndex}`);
    }
    choice.text = `@${strref}`;
    return copy;
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
