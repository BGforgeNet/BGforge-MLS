/**
 * The structural-edit surface DialogGraph exposes to the inspector (and its own context menus): every
 * mutation that is not a direct field write on the reactive model goes through one of these. One shared
 * contract type so the builder (DialogGraph.svelte `actions`) and the consumer (Inspector.svelte `actions`
 * prop) cannot drift - they previously each carried their own structurally-matching inline type literal.
 */

import type { DialogReaction, DialogTarget } from "../../../../shared/dialog-model";

export interface DialogActions {
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
