/**
 * Addressing and model-level edits for a compiled dialog.
 *
 * A DLG stores a NUMBER pointing into the game's string table rather than text, so changing what a line says
 * means pointing it at a different entry. These helpers say WHICH record a selection means and produce the
 * edited model; turning that model back into bytes is the writer's job (`dlg-write.ts`), which is deliberately
 * the only thing that touches records - one writer, so flag and table handling cannot drift between paths.
 *
 * Pure, so it is unit-testable and `shared/` stays clear of the binary reader.
 */

import type { DialogModel, DialogState } from "./dialog-model";
import { resrefName, strrefText } from "./dialog-model-dlg";

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
    const copy = structuredClone(model);
    const state = ownStatesByIndex(copy, ownResref).get(address.stateIndex);
    if (!state) throw new Error(`setDlgLineText: no state ${address.stateIndex} in ${ownResref}`);
    if (address.choiceIndex === undefined) {
        state.text = strrefText(strref);
        return copy;
    }
    const choice = state.choices[address.choiceIndex];
    if (!choice) {
        throw new Error(`setDlgLineText: state ${address.stateIndex} has no reply ${address.choiceIndex}`);
    }
    choice.text = strrefText(strref);
    return copy;
}

/**
 * The states this file owns, keyed by their position in its state table. A tree may also hold states pulled
 * in from other dialogs, so the flattened list is not the state table and its positions are not indices; a
 * foreign state is dropped here rather than written into the wrong file.
 */
function ownStatesByIndex(model: DialogModel, rawResref: string): Map<number, DialogState> {
    // Resource names are case-insensitive to the game and a file on disk may be spelled either way, while
    // the model always uppercases.
    const ownResref = resrefName(rawResref);
    const own = new Map<number, DialogState>();
    for (const root of model.roots) {
        for (const state of root.states) {
            if (state.dlgResref !== ownResref || state.dlgIndex === undefined) continue;
            own.set(state.dlgIndex, state);
        }
    }
    return own;
}

/** A reply this dialog holds, addressed the way the writer addresses one. */
export interface DlgReplyRef {
    readonly stateIndex: number;
    readonly choiceIndex: number;
}

/**
 * Detach a state: every reply in THIS dialog that led to it ends the conversation instead, and the state
 * itself stays exactly where it was.
 *
 * Detaching rather than deleting is the whole point. A state's number is its position, and other dialogs -
 * and WeiDU mod scripts, which address states by number at install time and cannot be seen from here at all -
 * hold that number as an address. Removing the record would renumber every state above it and silently
 * redirect all of them. So the record stays, its number stays, and only the local routing changes; a jump
 * from another file still arrives, which is why this is a detachment and must be described as one.
 *
 * Returns the replies it changed, so the user can be shown precisely what this did to states they did not
 * select.
 */
export function detachDlgState(
    model: DialogModel,
    ownResref: string,
    stateIndex: number,
): { model: DialogModel; cut: DlgReplyRef[] } {
    const copy = structuredClone(model);
    const own = ownStatesByIndex(copy, ownResref);
    const target = own.get(stateIndex);
    if (!target) throw new Error(`detachDlgState: no state ${stateIndex} in ${ownResref}`);

    const cut: DlgReplyRef[] = [];
    for (const [index, state] of [...own.entries()].sort((a, b) => a[0] - b[0])) {
        for (const [choiceIndex, choice] of state.choices.entries()) {
            if (choice.target.kind !== "state" || choice.target.stateId !== target.id) continue;
            choice.target = { kind: "exit" };
            cut.push({ stateIndex: index, choiceIndex });
        }
    }
    return { model: copy, cut };
}
