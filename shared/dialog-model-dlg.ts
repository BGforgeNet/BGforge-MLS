/**
 * DLG -> DialogModel adapter.
 *
 * A DLG is the compiled form of what a `.d` file describes, so it produces the same model D does and renders
 * through the same graph rather than getting a parallel one of its own. The differences are all absences:
 * states have indices instead of labels, spoken text is a strref rather than inline, and there is no source
 * text - hence no byte ranges. A line is therefore changed by repointing its strref rather than by editing
 * text, and each state and reply carries its file position so the writer can rebuild the file from the model.
 *
 * The input is declared structurally rather than imported from `@bgforge/binary`, which `shared/` does not
 * depend on and should not start to; `@bgforge/binary`'s `Dlg` satisfies it, pinned by a test.
 */

import type { DialogChoice, DialogModel, DialogState, DialogTarget } from "./dialog-model";

export interface DlgModelState {
    /** Strref of the actor's line. */
    text: number;
    firstTransition: number;
    transitionCount: number;
    /** Index into `stateTriggers`, or -1 when the state is ungated. */
    triggerIndex: number;
}

export interface DlgModelTransition {
    text: number;
    journalText: number;
    triggerIndex: number;
    actionIndex: number;
    nextDialog: string;
    nextState: number;
    hasText: boolean;
    hasTrigger: boolean;
    hasAction: boolean;
    hasJournalEntry: boolean;
    terminatesDialog: boolean;
}

export interface DlgModelInput {
    states: DlgModelState[];
    transitions: DlgModelTransition[];
    stateTriggers: string[];
    transitionTriggers: string[];
    actions: string[];
    /** The dialog's own resource name, which is how a transition's target is recognised as internal. */
    resref: string;
}

/** Resrefs are fixed-width and NUL-padded on the wire; compare on the name, not the padding. */
export function resrefName(raw: string): string {
    return raw.split("\u0000")[0]!.trim().toUpperCase();
}

/**
 * A strref becomes the same `@N` reference the renderer already resolves for `.msg` and `.tra`, so DLG text
 * reaches the view through one resolution path rather than a second one. The tlk lookup happens where a game
 * is open; with no game the ref renders as-is.
 */
function strrefText(strref: number): string {
    return `@${strref}`;
}

function targetOf(transition: DlgModelTransition, ownResref: string): DialogTarget {
    if (transition.terminatesDialog) return { kind: "exit" };
    const next = resrefName(transition.nextDialog);
    // WeiDU writes the owning dialog's own resref even for a jump inside the same file, so an internal jump
    // is "same resref", not "no resref".
    if (next === "" || next === ownResref) return { kind: "state", stateId: String(transition.nextState) };
    // Another dialog's state: the target is not in this model, so it stays unresolved and carries both halves
    // of the address, which is what the view needs to show where the conversation goes.
    return { kind: "external", label: `${next}:${transition.nextState}`, resolved: false };
}

function choiceFrom(
    transition: DlgModelTransition,
    index: number,
    input: DlgModelInput,
    ownResref: string,
): DialogChoice {
    // Every optional field is gated by its flag bit. An unset one still holds a stored value - commonly -1,
    // which would index the last entry of the table if read without checking the bit.
    const condition = transition.hasTrigger ? input.transitionTriggers[transition.triggerIndex] : undefined;
    const action = transition.hasAction ? input.actions[transition.actionIndex] : undefined;
    return {
        id: `#${index}`,
        dlgTransition: index,
        ...(transition.hasText ? { text: strrefText(transition.text) } : {}),
        ...(condition !== undefined ? { condition } : {}),
        ...(action !== undefined ? { action } : {}),
        target: targetOf(transition, ownResref),
    };
}

function stateFrom(state: DlgModelState, index: number, input: DlgModelInput, ownResref: string): DialogState {
    // A state owns the consecutive transition range [first, first + count).
    const owned = input.transitions.slice(state.firstTransition, state.firstTransition + state.transitionCount);
    const trigger = state.triggerIndex >= 0 ? input.stateTriggers[state.triggerIndex] : undefined;
    return {
        // States are addressed by position - the binary holds no labels, and inventing them is exactly the
        // fidelity risk that keeps the decompiler off this path. The position is ALSO carried explicitly in
        // `dlgIndex`, because the id has to survive a tree holding more than one dialog.
        id: String(index),
        dlgIndex: index,
        dlgResref: ownResref,
        text: strrefText(state.text),
        ...(trigger !== undefined ? { trigger } : {}),
        choices: owned.map((t, i) => ({
            ...choiceFrom(t, state.firstTransition + i, input, ownResref),
            id: `${index}#${i}`,
        })),
    };
}

export function modelFromDlg(input: DlgModelInput): DialogModel {
    const ownResref = resrefName(input.resref);
    return {
        sourceLang: "dlg",
        // Not blanket-editable: that flag means "every state, freely", the D family's contract, and drives
        // the inspector's banner. A DLG is decided per node instead - see `nodeEditable`.
        editable: false,
        roots: [
            {
                id: `dialog:${ownResref}`,
                label: ownResref,
                kind: "dialog",
                states: input.states.map((s, i) => stateFrom(s, i, input, ownResref)),
            },
        ],
    };
}
