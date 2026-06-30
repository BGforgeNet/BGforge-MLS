/**
 * Shared data model types for dialog tree parsing.
 * Two dialects: Fallout SSL (SSLDialog*) and WeiDU D (DDialog*).
 * Server-side parsers populate these and the client webview previews consume them.
 * Single source of truth for both sides - eliminates client/server type drift.
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
    /**
     * Set when the message id is not a fixed integer literal: `computed` (a variable
     * or expression - the displayed line is approximate, the real id is runtime) or
     * `random` (a `random(...)` call - one of several lines shown at runtime). Absent
     * for a plain numeric id. Drives the computed/random honesty badges.
     */
    msgKind?: "computed" | "random";
    /** Byte span of the enclosing `if` condition expression (the `cond` field, parens included). Set by the parser when conditional. */
    condRange?: { start: number; end: number };
    /** Byte span of the whole enclosing `if` statement. Set by the parser when conditional. Drives unwrap. */
    ifRange?: { start: number; end: number };
    /** True iff the enclosing `if`'s then-branch holds exactly one dialog call - the only condition-editable shape. Set by the parser. */
    ifSingleCall?: boolean;
}

export interface SSLDialogOption {
    msgId: number | string;
    target: string;
    /** Skill check level, when the option is a skilled (G/B) variant. */
    skill?: number;
    type: SSLDialogOptionType;
    line: number;
    /** Raw conditional expression text, when the option is wrapped in `if (...)`. */
    conditional?: string;
    /** See `SSLDialogReply.msgKind`: `computed`/`random` when the id is not a fixed literal. */
    msgKind?: "computed" | "random";
    /** Byte span of the whole option call `NOption(...)` in the source (used by reorder). Set by the parser. */
    callRange?: { start: number; end: number };
    /** Byte span of the option's target-Node argument in the source (used by retarget). Set by the parser. */
    targetRange?: { start: number; end: number };
    /** Byte span of the whole option STATEMENT `NOption(...);` incl. the trailing `;` (used by remove). */
    stmtRange?: { start: number; end: number };
    /** Byte span of the enclosing `if` condition expression (the `cond` field, parens included). Set by the parser when conditional. */
    condRange?: { start: number; end: number };
    /** Byte span of the whole enclosing `if` statement. Set by the parser when conditional. Drives unwrap. */
    ifRange?: { start: number; end: number };
    /** True iff the enclosing `if`'s then-branch holds exactly one dialog call - the only condition-editable shape. Set by the parser. */
    ifSingleCall?: boolean;
}

/**
 * One branch of a bundle node's top-level `if`/`else`. `kind` is "if" (a `then` branch, with its
 * `condition` text including the parentheses) or "else" (no condition). `replyIndices`/`optionIndices`
 * index into the owning `SSLDialogNode.replies`/`options` (source order). `opaque` holds the branch's
 * non-dialog statements (side-effects) to preserve byte-exact: their source text and span.
 */
export interface SSLDialogBranch {
    kind: "if" | "else";
    condition?: string;
    /** Byte span of the `if` condition expression (parens included), for editing. Absent for an `else` branch. */
    conditionRange?: { start: number; end: number };
    /** Splice point for a NEW option inside this branch body: end of the branch's last statement + that
     * line's indent. For an empty branch, just inside the block. Set by the parser. */
    insertAnchor?: { offset: number; indent: string };
    /** Byte span of the whole `if` statement (for deleting a sibling/sole if). Set on `if` branches. */
    stmtRange?: { start: number; end: number };
    /** Byte span from the `else` keyword through the else-block `end` (for deleting just the else). Set on `else` branches. */
    elseClauseRange?: { start: number; end: number };
    /** Offset right after the then-block's closing `end` (thenBody.endIndex), where ` else begin...end` is appended.
     * Set on `if` branches with a block then-body. */
    thenBlockEnd?: number;
    replyIndices: number[];
    optionIndices: number[];
    opaque: { text: string; textRange: { start: number; end: number } }[];
}

export interface SSLDialogNode {
    name: string;
    line: number;
    replies: SSLDialogReply[];
    options: SSLDialogOption[];
    /** Direct `call Node*` transitions. */
    callTargets: string[];
    /**
     * State-mutating void builtins this node's procedure calls (e.g. `set_global_var`,
     * `give_xp`) - the node does something the dialog text does not show. Set by the SSL
     * parser when given the side-effect function set; absent/empty when none are detected
     * or the set was not supplied. Display/debug void fns (`display_msg`, `float_msg`, ...)
     * are deliberately excluded upstream so the side-effect badge does not fire on every
     * node that merely shows text. Drives the `side-effect` honesty badge.
     */
    sideEffects?: string[];
    /**
     * True when the procedure body is faithfully representable - a flat sequence of recognized
     * dialog calls plus single-level `if (cond)` wrappers, with no `else`, nested `if`, loop,
     * assignment, or non-dialog call. Only faithful nodes can be edited structurally and written
     * back without loss; anything else stays structurally read-only. Conservative: when in doubt,
     * not faithful. Set by the SSL parser.
     */
    faithful?: boolean;
    /**
     * True when the node is NOT plain-faithful but IS a single-level `if/else` bundle: its body is only
     * top-level single-level `if`s whose branches hold dialog calls/transitions plus preservable simple
     * statements (assignments, side-effect calls), with no nested `if`, `else if`, or loop. Such nodes
     * support in-place edits (retarget, text) with their conditions and side-effects preserved byte-exact.
     * Mutually exclusive with `faithful`. Set by the SSL parser.
     */
    bundleFaithful?: boolean;
    /** Ordered branches of a bundle node's `if`/`else`. Set by the parser only when `bundleFaithful`. */
    branches?: SSLDialogBranch[];
    /**
     * Where a newly-added option call is spliced in: `offset` is the end of the node's last body
     * statement, `indent` the leading whitespace of that statement's line, so the inserted call lines up.
     * Set by the parser for every node (the option count can be zero).
     */
    insertAnchor?: { offset: number; indent: string };
    /** Byte span of the whole `procedure <name> ... end` block (used to delete the node). Set by the parser. */
    procRange?: { start: number; end: number };
    /** Byte span of the `procedure <name>` identifier token (used to rename the node). Set by the parser. */
    nameRange?: { start: number; end: number };
    /**
     * Byte span of the name token in this procedure's forward declaration (`procedure <name>;`), when one
     * exists. Rename rewrites it alongside `nameRange` so the file is not left with a stale forward decl.
     * Absent when the procedure has no forward declaration. Set by the parser.
     */
    forwardDeclRange?: { start: number; end: number };
    /**
     * One entry per `call <target>;` statement out of this node (NOT deduped - a node may call the same target
     * more than once, e.g. one call per if-branch), carrying each statement's byte span (used to remove the call
     * when its target node is deleted). `callTargets` holds the deduped names; this holds the per-site spans.
     * Set by the parser. `targetRange` is the span of the target identifier token (for rename/delete-by-call);
     * absent when the target is a call_expr rather than a plain identifier. `topLevel` is true when the call_stmt
     * is a direct procedure-body statement (not nested in an if/block), so it can be removed without leaving a
     * dangling conditional.
     */
    callTransitions?: Array<{
        name: string;
        stmtRange: { start: number; end: number };
        targetRange?: { start: number; end: number };
        topLevel: boolean;
    }>;
}

export interface SSLDialogData {
    nodes: SSLDialogNode[];
    entryPoints: string[];
    /** Translation messages keyed by index. Populated by the client before rendering; not set by the server. */
    messages?: Record<string, string>;
    /** Byte offset just before `talk_p_proc` (where a newly-added node's procedure is spliced in). Set by the parser. */
    newProcAnchor?: number;
    /**
     * Each `call <entry>;` in talk_p_proc: its whole-statement span, target identifier span, and whether it is a
     * direct talk_p_proc body statement (safely removable without leaving a dangling conditional). Set by the parser.
     */
    entryCalls?: Array<{
        name: string;
        stmtRange: { start: number; end: number };
        targetRange: { start: number; end: number };
        topLevel: boolean;
    }>;
    /** Byte offset where a NEW entry call is spliced into talk_p_proc (end of its last body statement). Set by the parser. */
    entryCallAnchor?: number;
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
    /**
     * Byte range of this transition's node in the original source (the whole
     * `IF ... THEN ...` / `++ ... + ...` construct). Set by the parser; used by the
     * per-field surgical edit to splice just this transition without reflowing siblings.
     */
    range?: { start: number; end: number };
}

export interface DDialogState {
    label: string;
    line: number;
    sayText: string;
    trigger?: string;
    speaker?: string;
    weight?: number;
    transitions: DDialogTransition[];
    blockLabel?: string;
    /**
     * Dialog file that owns this state (the block's target file). Unlike `speaker`,
     * which CHAIN `== ~file~` lines reassign to the switched actor, this stays the
     * owning dialog so the editor can group every state under its real dialog root.
     */
    blockFile?: string;
    /**
     * Byte range of this state's node in the original source text (startIndex
     * inclusive, endIndex exclusive). Set by the parser; absent on synthetic states
     * (e.g. CHAIN-flattened) that have no direct single-node representation.
     * Used by the surgical edit engine to splice changed states back in-place.
     */
    range?: { start: number; end: number };
    /**
     * Byte ranges of the state's SAY value node and trigger node, for per-field surgical
     * edits (splice just the changed field, leaving the rest of the state byte-identical).
     * `sayRange` covers the value after `SAY` (e.g. `@1`); `triggerRange` covers the
     * trigger string including its `~ ~` delimiters. Set by the parser; absent on synthetic
     * (derived) states.
     */
    sayRange?: { start: number; end: number };
    triggerRange?: { start: number; end: number };
    /**
     * Set when this state was expanded from a higher-level construct (CHAIN, INTERJECT,
     * EXTEND) rather than authored as a standalone state block. Names the construct, for
     * display. Such states have no `range`, so the editor treats them as read-only - there
     * is no source span to splice an edit back into.
     */
    derivedFrom?: "CHAIN" | "INTERJECT" | "EXTEND";
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
