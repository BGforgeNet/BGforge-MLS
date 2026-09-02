/**
 * Builders for the DialogModel shapes the dialog-editor suites feed to `buildConversationTree`.
 *
 * One home for the four of them: the suites that describe a dialog (conversation-tree, tree-rows,
 * tree-search) all need the same terse spelling, and a field added to `DialogState` or `DialogChoice`
 * should reach every one of them in a single edit.
 */
import type { DialogChoice, DialogRoot, DialogState, DialogTarget } from "../../shared/dialog-model";

export function st(id: string, text: string, choices: DialogChoice[], extra: Partial<DialogState> = {}): DialogState {
    return { id, speaker: "NPC", text, choices, ...extra };
}

export function ch(id: string, target: DialogTarget, extra: Partial<DialogChoice> = {}): DialogChoice {
    return { id, target, ...extra };
}

export function root(states: DialogState[]): DialogRoot {
    return { id: "dialog:NPC", label: "NPC", kind: "dialog", states };
}

/** The cross-file jump resolver a suite passes when no test in it exercises a cross-file target. */
export const noJump = (): undefined => undefined;
