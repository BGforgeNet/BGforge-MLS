/**
 * Shared data model types for WeiDU D dialog tree parsing.
 * Used by the server dialog parser and the client dialog tree webview preview.
 * Single source of truth — both sides import from here.
 */

export type DDialogTarget =
    | { kind: "goto"; label: string }
    | { kind: "extern"; file: string; label: string }
    | { kind: "exit" }
    | { kind: "copy_trans"; file: string; label: string };

export interface DDialogTransition {
    line: number;
    replyText?: string;
    trigger?: string;
    action?: string;
    target: DDialogTarget;
}

export interface DDialogState {
    label: string;
    line: number;
    sayText: string;
    trigger?: string;
    speaker?: string;
    transitions: DDialogTransition[];
    blockLabel?: string;
}

/** Structural blocks produce dialog states. Modify blocks patch existing dialogs. */
export type DDialogBlockKind = "begin" | "append" | "chain" | "extend" | "interject" | "replace" | "modify";

export interface DDialogBlock {
    kind: DDialogBlockKind;
    file: string;
    line: number;
    label?: string;
    /** Display name for modify blocks (e.g. "ALTER_TRANS", "REPLACE_TRANS_TRIGGER") */
    actionName?: string;
    /** Human-readable summary for modify blocks */
    description?: string;
    /** State labels/numbers targeted by this block (for linking in modify blocks) */
    stateRefs?: string[];
}

export interface DDialogData {
    blocks: DDialogBlock[];
    states: DDialogState[];
    /** Translation messages keyed by index. Populated by the client before rendering; not set by the server. */
    messages?: Record<string, string>;
}
