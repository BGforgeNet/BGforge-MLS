/**
 * The structural-edit surface DialogGraph exposes to the inspector (and its own context menus): every
 * mutation that is not a direct field write on the reactive model goes through one of these. One shared
 * contract type so the builder (DialogGraph.svelte `actions`) and the consumer (Inspector.svelte `actions`
 * prop) cannot drift - they previously each carried their own structurally-matching inline type literal.
 */

import type { DialogReaction, DialogTarget } from "../../../../shared/dialog-model";

export interface DialogActions {
    /**
     * Ask the host to choose a game string for a line. Only a compiled dialog offers this: its text is a
     * reference into the game's string table, so it is picked rather than typed. `null` addresses the state's
     * own line, a choice id one of its replies.
     */
    pickString: (choiceId: string | null) => void;
    rename: (newId: string) => void;
    addReply: () => void;
    removeReply: (choiceId: string) => void;
    moveReply: (choiceId: string, dir: -1 | 1) => void;
    setTarget: (choiceId: string, target: DialogTarget) => void;
    setReaction: (choiceId: string, reaction: DialogReaction) => void;
    setLowIq: (choiceId: string, on: boolean) => void;
    deleteState: () => void;
    duplicateState: () => void;
    addReplyToBranch: (branchIndex: number) => void;
    removeReplyInBranch: (branchIndex: number, choiceId: string) => void;
    moveReplyInBranch: (branchIndex: number, choiceId: string, dir: -1 | 1) => void;
    addBranch: (condition: string) => void;
    addElse: () => void;
    removeBranch: (branchIndex: number) => void;
}
