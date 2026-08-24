/**
 * Writes the editor's model back into a compiled dialog.
 *
 * Every write starts from the file's OWN parsed records, not from a blank slate: a DLG record carries fields
 * the dialog model has no place for - journal entries, interrupt and quest flags - and regenerating purely
 * from the model would drop each of them silently. A record the model can reach is overwritten field by
 * field; everything else is carried through.
 *
 * Indices are never patched, only re-emitted: states go out in order and each one's replies immediately
 * after it, so `firstTransition` and `transitionCount` fall out of the emission rather than being adjusted.
 * That removes the whole class of shift-arithmetic bugs - at the cost of requiring that an existing state
 * never move, which `writeDlgFromModel` checks rather than assumes.
 */

import { buildDlg, toDlgBuildInput, DlgTransitionFlag, type DlgBuildInput } from "@bgforge/binary";
import type { DialogChoice, DialogModel, DialogState } from "../../../shared/dialog-model";
import { parseDlgStateId, resrefName } from "../../../shared/dialog-model-dlg";

type StateRecord = DlgBuildInput["states"][number];
type TransitionRecord = DlgBuildInput["transitions"][number];

/** Resrefs are fixed-width and NUL-padded on the wire, which is how a new target is written. */
const RESREF_SIZE = 8;
const resrefBytes = (name: string): string => name.slice(0, RESREF_SIZE).padEnd(RESREF_SIZE, "\u0000");

/** Model text for a compiled dialog is always `@<strref>`; anything else has nowhere to be stored. */
function strrefOf(text: string, where: string): number {
    const match = /^@(\d+)$/.exec(text.trim());
    if (!match) {
        throw new Error(`writeDlgFromModel: ${where} must be a game string reference, not ${JSON.stringify(text)}`);
    }
    return Number(match[1]);
}

/**
 * The index `text` should have in `table`. An entry whose text is unchanged keeps its original index, so a
 * file nobody edited comes back with its tables exactly as they were; anything new is appended rather than
 * inserted, because inserting would renumber every entry above it. A superseded entry is left in place -
 * orphaned, harmless, and cheaper than a compaction pass that would renumber.
 */
function tableIndex(table: string[], originalIndex: number | undefined, text: string): number {
    if (originalIndex !== undefined && originalIndex >= 0 && table[originalIndex] === text) return originalIndex;
    const existing = table.indexOf(text);
    if (existing !== -1) return existing;
    table.push(text);
    return table.length - 1;
}

/** Where a reply points, as the pair of wire fields that say it. */
function targetFields(
    choice: DialogChoice,
    base: TransitionRecord | undefined,
    ownResref: string,
    checkLocalState: (stateId: string) => void,
): { nextDialog: string; nextState: number; terminates: boolean } {
    const target = choice.target;
    if (target.kind === "exit") {
        return { nextDialog: base?.nextDialog ?? resrefBytes(""), nextState: base?.nextState ?? 0, terminates: true };
    }
    if (target.kind === "state") {
        // The id IS the address - dialog and number - so a reply retargeted at another file's state writes
        // that file's resref, not ours. A local target is checked against what is actually being written.
        const parsed = parseDlgStateId(target.stateId);
        if (!parsed) throw new Error(`writeDlgFromModel: cannot store the target ${JSON.stringify(target.stateId)}`);
        if (parsed.resref === ownResref) checkLocalState(target.stateId);
        return { nextDialog: resrefBytes(parsed.resref), nextState: parsed.index, terminates: false };
    }
    // An external target renders as `RESREF:state`; that is the only form this writer can put back on the wire.
    const match = /^(\w{1,8}):(\d+)$/.exec(target.label);
    if (!match) {
        throw new Error(`writeDlgFromModel: cannot store the target ${JSON.stringify(target.label)}`);
    }
    return { nextDialog: resrefBytes(match[1]!.toUpperCase()), nextState: Number(match[2]), terminates: false };
}

/** Flags rebuilt from what this reply now carries, keeping every bit the model does not speak for. */
function flagsFor(choice: DialogChoice, base: TransitionRecord | undefined, terminates: boolean): string[] {
    const owned = new Set<string>([
        DlgTransitionFlag.Text,
        DlgTransitionFlag.Trigger,
        DlgTransitionFlag.Action,
        DlgTransitionFlag.TerminatesDialog,
    ]);
    const flags = (base?.flags ?? []).filter((f) => !owned.has(f));
    if (choice.text !== undefined) flags.push(DlgTransitionFlag.Text);
    if (choice.condition !== undefined) flags.push(DlgTransitionFlag.Trigger);
    if (choice.action !== undefined) flags.push(DlgTransitionFlag.Action);
    if (terminates) flags.push(DlgTransitionFlag.TerminatesDialog);
    return flags;
}

/**
 * The states this file owns, in the order they will be written. A state carrying another dialog's resref
 * belongs to a file we are not writing - the tree also holds the neighbours a conversation hands off to;
 * one carrying neither a resref nor an index is a state the user just added here.
 */
function ownStates(model: DialogModel, ownResref: string): DialogState[] {
    return model.roots
        .flatMap((root) => root.states)
        .filter((s) => s.dlgResref === ownResref || (s.dlgResref === undefined && s.dlgIndex === undefined));
}

/**
 * `bytes` rewritten to match `model`, as a whole rebuilt file. The layout is `buildDlg`'s rather than the
 * original's, so a file laid out unusually comes back byte-different while holding the same content.
 *
 * Throws rather than writing a file whose existing states have moved: every state index in this dialog is
 * also an address other dialogs and mod scripts hold, so renumbering is the one thing this must never do by
 * accident. A state is removed from play by detaching it, which leaves its record - and its index - alone.
 */
export function writeDlgFromModel(bytes: Uint8Array, model: DialogModel, ownResref: string): Uint8Array {
    const input = toDlgBuildInput(bytes);
    const stateTriggers = [...input.stateTriggers];
    const transitionTriggers = [...input.transitionTriggers];
    const actions = [...input.actions];

    // Resource names are case-insensitive to the game and a file on disk may be spelled either way, while
    // the model always uppercases; normalise once here rather than at each comparison.
    const own = resrefName(ownResref);
    const states = ownStates(model, own);
    // Every state the file holds must still be here. A state index is an address other dialogs and mod
    // scripts hold, so dropping one renumbers the rest - the very thing detaching exists to avoid. A model
    // that has lost one is a bug upstream, not an instruction to shorten the file.
    const kept = new Set(states.map((s) => s.dlgIndex).filter((i) => i !== undefined));
    if (kept.size !== input.states.length) {
        throw new Error(
            `writeDlgFromModel: ${input.states.length - kept.size} of ${input.states.length} states are missing ` +
                "from the model; detach a state rather than removing it",
        );
    }
    const ids = new Set(states.map((s) => s.id));
    const checkLocalState = (stateId: string): void => {
        if (!ids.has(stateId)) throw new Error(`writeDlgFromModel: no state ${JSON.stringify(stateId)} to point at`);
    };

    const outStates: StateRecord[] = [];
    const outTransitions: TransitionRecord[] = [];

    for (const state of states) {
        if (state.dlgIndex !== undefined && state.dlgIndex !== outStates.length) {
            throw new Error(
                `writeDlgFromModel: state ${state.dlgIndex} would be written at index ${outStates.length}; ` +
                    "an existing state may never change index",
            );
        }
        const base = state.dlgIndex === undefined ? undefined : input.states[state.dlgIndex];
        const firstTransition = outTransitions.length;

        for (const choice of state.choices) {
            const tBase = choice.dlgTransition === undefined ? undefined : input.transitions[choice.dlgTransition];
            const { nextDialog, nextState, terminates } = targetFields(choice, tBase, own, checkLocalState);
            outTransitions.push({
                ...(tBase ?? { journalText: -1 }),
                flags: flagsFor(choice, tBase, terminates),
                text: choice.text === undefined ? (tBase?.text ?? -1) : strrefOf(choice.text, `reply ${choice.id}`),
                triggerIndex:
                    choice.condition === undefined
                        ? -1
                        : tableIndex(transitionTriggers, tBase?.triggerIndex, choice.condition),
                actionIndex: choice.action === undefined ? -1 : tableIndex(actions, tBase?.actionIndex, choice.action),
                nextDialog,
                nextState,
            });
        }

        outStates.push({
            ...base,
            text: strrefOf(state.text, `state ${state.dlgIndex ?? outStates.length}`),
            firstTransition,
            transitionCount: state.choices.length,
            triggerIndex:
                state.trigger === undefined ? -1 : tableIndex(stateTriggers, base?.triggerIndex, state.trigger),
        });
    }

    return buildDlg({
        ...input,
        states: outStates,
        transitions: outTransitions,
        stateTriggers,
        transitionTriggers,
        actions,
    });
}
