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

import type { DialogChoice, DialogModel, DialogRoot, DialogState, DialogTarget } from "./dialog-model";

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

/** A state's id across the whole tree: its dialog and its number, since numbers repeat between files. */
export function dlgStateId(resref: string, index: number): string {
    return `${resref}:${index}`;
}

/** The address back out of an id. Null for anything not in that form - a state the user just added. */
export function parseDlgStateId(id: string): { resref: string; index: number } | null {
    const match = /^([^:]+):(\d+)$/.exec(id);
    return match ? { resref: match[1]!.toUpperCase(), index: Number(match[2]) } : null;
}

/**
 * Where a reply leads. A jump into a state the model HOLDS becomes a real state target, whichever file that
 * is - which is what lets a conversation that leaves and comes back close up as one graph. Anything else
 * stays external: there is no node to point at, so the view shows the address instead. `present` decides
 * which, so resolution is a property of what was loaded rather than of the format. It is asked about the
 * state, not just the file: a mod that replaces a dialog with a shorter one leaves jumps past the end behind,
 * and resolving one would put an edge in the tree with no node on its far side.
 */
function targetOf(transition: DlgModelTransition, ownResref: string, present: Present): DialogTarget {
    if (transition.terminatesDialog) return { kind: "exit" };
    // WeiDU writes the owning dialog's own resref even for a jump inside the same file, so an internal jump
    // is "same resref", not "no resref".
    const next = resrefName(transition.nextDialog) || ownResref;
    if (present(next, transition.nextState)) return { kind: "state", stateId: dlgStateId(next, transition.nextState) };
    return { kind: "external", label: `${next}:${transition.nextState}`, resolved: false };
}

/** Whether the tree holds a given state, and so whether a jump to it can be drawn as an edge. */
type Present = (resref: string, stateIndex: number) => boolean;

function choiceFrom(
    transition: DlgModelTransition,
    index: number,
    input: DlgModelInput,
    ownResref: string,
    present: Present,
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
        target: targetOf(transition, ownResref, present),
    };
}

function stateFrom(
    state: DlgModelState,
    index: number,
    input: DlgModelInput,
    ownResref: string,
    present: Present,
): DialogState {
    // A state owns the consecutive transition range [first, first + count).
    const owned = input.transitions.slice(state.firstTransition, state.firstTransition + state.transitionCount);
    const trigger = state.triggerIndex >= 0 ? input.stateTriggers[state.triggerIndex] : undefined;
    return {
        // States are addressed by position - the binary holds no labels, and inventing them is exactly the
        // fidelity risk that keeps the decompiler off this path. The id qualifies that position by dialog,
        // because a tree can hold several; `dlgIndex` carries the raw number the file uses.
        id: dlgStateId(ownResref, index),
        dlgIndex: index,
        dlgResref: ownResref,
        // A dialog file IS its speaker, and the header otherwise falls back to the model's `sourceName` -
        // which would put the name of the file being EDITED on a neighbouring dialog's states.
        speaker: ownResref,
        text: strrefText(state.text),
        ...(trigger !== undefined ? { trigger } : {}),
        choices: owned.map((t, i) => ({
            ...choiceFrom(t, state.firstTransition + i, input, ownResref, present),
            id: `${ownResref}:${index}#${i}`,
        })),
    };
}

function rootFrom(input: DlgModelInput, present: Present, external: boolean): DialogRoot {
    const ownResref = resrefName(input.resref);
    return {
        id: `dialog:${ownResref}`,
        label: ownResref,
        kind: "dialog",
        states: input.states.map((s, i) => stateFrom(s, i, input, ownResref, present)),
        ...(external ? { external: true } : {}),
    };
}

/**
 * One tree spanning several dialogs: the file being edited first, then every other dialog loaded alongside
 * it. Conversations routinely hand off to another file and hand back, so drawing only the opened file cuts
 * the graph exactly where the interesting edges are; with the neighbours present, a jump out and a jump back
 * resolve to nodes and the round trip closes. The others are marked external - they are context, not the
 * thing being written.
 */
export function modelFromDlgs(main: DlgModelInput, others: DlgModelInput[]): DialogModel {
    const loaded = new Map<string, number>();
    for (const input of [main, ...others]) loaded.set(resrefName(input.resref), input.states.length);
    const present: Present = (resref, stateIndex) => {
        const count = loaded.get(resref);
        return count !== undefined && stateIndex >= 0 && stateIndex < count;
    };
    return {
        sourceLang: "dlg",
        // Not blanket-editable: that flag means "every state, freely", the D family's contract, and drives
        // the inspector's banner. A DLG is decided per node instead - see `nodeEditable`.
        editable: false,
        // Set here rather than left to the host, as the other families do: with several dialogs in one tree
        // this is what says WHICH of them is being written, and `nodeEditable` reads it.
        sourceName: resrefName(main.resref),
        roots: [rootFrom(main, present, false), ...others.map((o) => rootFrom(o, present, true))],
    };
}

export function modelFromDlg(input: DlgModelInput): DialogModel {
    return modelFromDlgs(input, []);
}
