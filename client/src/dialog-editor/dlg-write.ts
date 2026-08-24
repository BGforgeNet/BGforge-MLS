/**
 * Writes string-reference edits back into a compiled dialog.
 *
 * The edit is applied to the file's OWN parsed content rather than rebuilt from the editor's model: a DLG
 * record carries fields the dialog model has no place for - journal entries, interrupt and quest flags - and
 * regenerating from the model would drop every one of them silently. Everything untouched is carried through.
 */

import { buildDlg, toDlgBuildInput, DlgTransitionFlag, type DlgBuildInput } from "@bgforge/binary";
import type { DlgTextEdit } from "../../../shared/dialog-dlg-edit";

/** The transition a reply position addresses: states own a consecutive run of the transition table. */
function transitionIndex(input: DlgBuildInput, edit: DlgTextEdit, choiceIndex: number): number {
    const state = input.states[edit.stateIndex]!;
    if (choiceIndex < 0 || choiceIndex >= state.transitionCount) {
        throw new Error(`applyDlgTextEdits: state ${edit.stateIndex} has no reply ${choiceIndex}`);
    }
    return state.firstTransition + choiceIndex;
}

/**
 * `bytes` with each edit applied, as a whole rebuilt file. The layout is `buildDlg`'s, not the original's, so
 * a file whose text block was ordered differently comes back byte-different while holding the same content.
 */
export function applyDlgTextEdits(bytes: Uint8Array, edits: readonly DlgTextEdit[]): Uint8Array {
    const input = toDlgBuildInput(bytes);
    if (edits.length === 0) return buildDlg(input);

    // Copied because the parsed records are the reader's, and an edit must not reach back into them.
    const states = input.states.map((state) => ({ ...state }));
    const transitions = input.transitions.map((transition) => ({ ...transition, flags: [...transition.flags] }));
    const edited: DlgBuildInput = { ...input, states, transitions };

    for (const edit of edits) {
        if (states[edit.stateIndex] === undefined) {
            throw new Error(`applyDlgTextEdits: no state ${edit.stateIndex} in this dialog`);
        }
        if (edit.choiceIndex === undefined) {
            states[edit.stateIndex]!.text = edit.strref;
            continue;
        }
        const transition = transitions[transitionIndex(edited, edit, edit.choiceIndex)]!;
        transition.text = edit.strref;
        // The strref is only read when the flag says the reply has text, so a reply that had none needs it
        // set - otherwise the number is stored and ignored.
        if (!transition.flags.includes(DlgTransitionFlag.Text)) transition.flags.push(DlgTransitionFlag.Text);
    }
    return buildDlg(edited);
}
