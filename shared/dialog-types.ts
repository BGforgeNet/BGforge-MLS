/**
 * Shared data model types for dialog tree parsing.
 * Two dialects: Fallout SSL (SSLDialog*) and WeiDU D (DDialog*).
 * Server-side parsers populate these and the client webview previews consume them.
 * Single source of truth for both sides — eliminates client/server type drift.
 */

// ---------------------------------------------------------------------------
// Fallout SSL dialog types
// ---------------------------------------------------------------------------

/** SSL dialog option/message type names emitted by Fallout's dialog API. */
export type SSLDialogOptionType =
    | "NOption"
    | "NLowOption"
    | "GOption"
    | "GLowOption"
    | "BOption"
    | "BLowOption"
    | "NMessage"
    | "GMessage"
    | "BMessage";

export interface SSLDialogReply {
    msgId: number | string;
    line: number;
    /** Raw conditional expression text, when the reply is wrapped in `if (...)`. */
    conditional?: string;
}

export interface SSLDialogOption {
    msgId: number | string;
    target: string;
    /** Skill check level, when the option is a skilled (G/B) variant. */
    skill?: number;
    type: SSLDialogOptionType;
    line: number;
}

export interface SSLDialogNode {
    name: string;
    line: number;
    replies: SSLDialogReply[];
    options: SSLDialogOption[];
    /** Direct `call Node*` transitions. */
    callTargets: string[];
}

export interface SSLDialogData {
    nodes: SSLDialogNode[];
    entryPoints: string[];
    /** Translation messages keyed by index. Populated by the client before rendering; not set by the server. */
    messages?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// WeiDU D dialog types
// ---------------------------------------------------------------------------

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
