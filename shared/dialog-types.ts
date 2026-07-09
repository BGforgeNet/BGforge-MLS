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
    /** True iff the enclosing `if` gates this reply ALONE - its then-branch holds exactly one statement (this
     * reply), so editing the condition affects nothing else. The only condition-editable shape. Set by the parser. */
    ifPure?: boolean;
}

export interface SSLDialogOption {
    msgId: number | string;
    target: string;
    /** Skill check level, when the option is a skilled (G/B) variant. */
    skill?: number;
    type: SSLDialogOptionType;
    line: number;
    /** Raw conditional expression text - EVERY enclosing `if` up to the procedure body, conjoined. Drives
     * edit-gating (`conditional === undefined` means unconditional) and the conditional badge. */
    conditional?: string;
    /** Display condition scoped to the option's own state: `conditional` minus the enclosing `if`s that also
     * gate the state (the ones that become `state.trigger` via the first Reply). Undefined when the option's
     * only gate IS the state gate. Used for the tree's `[if]` chip so the state's condition is not re-shown on
     * every child option. See `dialog-nested-flatten-bug-class`. */
    scopedConditional?: string;
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
    /** True iff the enclosing `if` gates this option ALONE - its then-branch holds exactly one statement (this
     * option), so editing the condition affects nothing else. The only condition-editable shape. Set by the parser. */
    ifPure?: boolean;
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

/**
 * One item in a recursive dialog block (the `structured` tier). The block mirrors the procedure's
 * statement nesting faithfully, unlike the flat `replies`/`options` projection which collapses it.
 * Leaf items reference the owning node's flat arrays by source-order index (so the block carries
 * STRUCTURE while the flat arrays carry the per-item DATA - one source of truth, no duplication):
 * `line` -> `replies[replyIndex]`, `choice` -> `options[optionIndex]`, `transition` ->
 * `callTransitions[transitionIndex]`. `opaque` is a preserved non-dialog statement (side-effect /
 * assignment). `group` is a nested `if`/`else` whose branches are themselves blocks (recursion).
 */
export type SSLDialogBlockItem =
    | { kind: "line"; replyIndex: number }
    | { kind: "choice"; optionIndex: number }
    | { kind: "transition"; transitionIndex: number }
    | { kind: "opaque"; text: string; textRange: { start: number; end: number } }
    | SSLDialogGroup;

/** A nested `if (cond) then <block> [else <block>]` inside a structured node's body. */
export interface SSLDialogGroup {
    kind: "group";
    /** The `if` condition text, parentheses included. */
    condition: string;
    /** Byte span of the condition expression (parens included). Retained for parity with bundle branches; the
     * structured tier is display-only this slice, so it is informational rather than an edit anchor. */
    conditionRange?: { start: number; end: number };
    thenBlock: SSLDialogBlockItem[];
    elseBlock?: SSLDialogBlockItem[];
}

export type SSLDialogBlock = SSLDialogBlockItem[];

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
     * True when the node is NOT plain- or bundle-faithful but its body IS representable as a recursive block:
     * a mix of dialog calls, `call` transitions, preservable simple statements, and arbitrarily nested `if`/
     * `else` groups, with no loop/switch/return-branching. Such nodes are rendered faithfully (nested groups,
     * each condition shown once at its level) but are structurally READ-ONLY this slice - a nested condition
     * cannot round-trip to a single `if` wrapper. Mutually exclusive with `faithful`/`bundleFaithful`. Set by
     * the parser. See memory `dialog-nested-flatten-bug-class`.
     */
    structured?: boolean;
    /** The recursive block mirroring the procedure body. Set by the parser only when `structured`. */
    block?: SSLDialogBlock;
    /**
     * True when the node is none of faithful/bundleFaithful/structured - its body has control flow the block
     * model cannot represent (loop, switch, computed branching), so the flat `replies`/`options` projection is
     * an APPROXIMATION (only the first reply line is shown; conditions are the conjoined enclosing-`if` path but
     * non-`if` gating is invisible). Drives an "approximate - see source" signal so the flattening is loud, not
     * silent. Set by the parser.
     */
    approximate?: boolean;
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
     * Byte span of the WHOLE forward-declaration statement (`procedure <name>;`), when one exists. A node
     * DELETE splices this out so the file is not left with an orphan declaration for the removed procedure.
     * Distinct from `forwardDeclRange` (name token only, for rename). Set by the parser.
     */
    forwardDeclStmtRange?: { start: number; end: number };
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
    /**
     * Each `force_dialog_start(Node)` / `start_dialog_at_node(Node)` call reached from outside talk_p_proc (timers,
     * map-enter handlers), with the target-identifier span. A node rename rewrites these so the out-of-band entry
     * does not dangle at the old name. Only plain-identifier targets are captured. Set by the parser.
     */
    outOfBandCalls?: Array<{ name: string; targetRange: { start: number; end: number } }>;
    /**
     * Every `procedure` name defined in the file (except `talk_p_proc`), whether or not it projects to a dialog
     * node. The model only carries projected nodes, but new-node id allocation (`nextSslNodeId`) must avoid ALL
     * existing procedures - an empty or side-effect-only `NodeNNN` proc is unprojected yet a real name to dodge,
     * or the scaffold/add-node splice would emit a duplicate `procedure`. Set by the parser.
     */
    procNames?: string[];
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
    /** Byte span of the target identifier (the `goTo(<id>)` / `extern(file, <id>)` argument) in the source,
     * for a token-splice retarget without reflowing the transition. Set by the TD source parser. */
    targetRange?: { start: number; end: number };
    /**
     * Byte range of this transition's node in the original source (the whole
     * `IF ... THEN ...` / `++ ... + ...` construct). Set by the parser; used by the
     * per-field surgical edit to splice just this transition without reflowing siblings.
     *
     * For TD (statement-form replies) this spans the whole `reply(...); [action(...);] goTo(...);` statement
     * GROUP - from the `reply(` statement through the target statement - so a remove/insert operates on the
     * complete player option, not a lone call. Set by the TD source parser.
     */
    range?: { start: number; end: number };
    /**
     * TD only: byte span of the transition's target-producing call itself - `goTo(<id>)` / `exit()` /
     * `extern(...)`. A terminal-flip (an inbound option redirected to exit when its target node is deleted)
     * replaces this span with `exit()`, keeping the `reply(...)` intact. Set by the TD source parser for both
     * forms: a standalone statement-form call (`goTo(t);`) spans the whole call, and a chained `reply(m).goTo(t)`
     * spans just its trailing `.goTo(t)` method call (from the method name, excluding the leading `.`).
     */
    targetCallRange?: { start: number; end: number };
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
     * TD only: byte span of the state function's NAME identifier token (`function <name>`), for a rename that
     * rewrites the definition name. Set by the TD source parser; absent on tree-sitter-parsed `.d` states.
     */
    nameRange?: { start: number; end: number };
    /**
     * TD only: byte span of the entry `if (...)` statement that wraps this state function AND holds nothing else
     * (the state-gate pattern, e.g. `if (Global(...)) { function stateNNN() {...} }`). A node DELETE splices this
     * whole `if` out instead of just the function span, so removing the state does not leave a dead empty gate.
     * Set by the TD source parser only when the function is the sole meaningful statement of the `if` then-block
     * and the `if` has no `else`; absent otherwise (an unwrapped state, or one sharing its gate with siblings).
     */
    enclosingIfRange?: { start: number; end: number };
    /**
     * TD only: byte span of this state's ambient forward declaration statement (`declare function <name>(): void;`),
     * when the file carries one. A node DELETE splices it out so no dangling declaration is left for the removed
     * state. Set by the TD source parser; absent when the state has no forward declaration.
     */
    forwardDeclStmtRange?: { start: number; end: number };
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
     * Every SAY text of a multisay state (`SAY @a = @b = @c`), in source order, each with its own byte
     * range. A single-text state has a one-element list. `sayText` keeps the first text for the collapsed
     * display line; `sayTexts` carries all of them so the writer and inspector round-trip the whole SAY
     * instead of truncating to the first (the pre-existing multisay-truncation fix). Set by the parser.
     */
    sayTexts?: Array<{ text: string; range: { start: number; end: number } }>;
    /**
     * Set when this state was expanded from a higher-level construct (CHAIN, INTERJECT,
     * EXTEND) rather than authored as a standalone state block. Names the construct, for
     * display. Such states have no `range`, so the editor treats them as read-only - there
     * is no source span to splice an edit back into.
     */
    derivedFrom?: "CHAIN" | "INTERJECT" | "EXTEND";
    /**
     * `false` when the state's body holds a construct the flat transition list cannot round-trip - a conditional
     * branch INSIDE the body (an inner `if`, whose gate/`else` transitions the list would drop on save). The
     * D-family editability gate treats a `faithful === false` state as read-only, so an edit can never silently
     * drop the else or the inner condition (the same decouple-editor-safety-from-parser-completeness tier the SSL
     * family carries as `SSLDialogNode.faithful`). Absent (editable) for a plain unconditional state. Set by the
     * TD source parser; the tree-sitter `.d` parser leaves it unset (its own faithfulness handling is separate).
     */
    faithful?: boolean;
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

/**
 * TD only: a reference to a state function from OUTSIDE its own body - either a state-list element in an
 * `append`/`begin`/`appendEarly` call, or a `goTo(<id>)` target inside an entry/extend block's arrow body.
 * These are not model choices (which are handled by the retarget path), so the writer rewrites them directly
 * on rename and prunes/redirects them on delete.
 */
export interface TDStateRef {
    /** The referenced state's identifier text. */
    name: string;
    /** Byte span of the identifier token (rewritten on rename). */
    range: { start: number; end: number };
    /** `list`: a state-list element (append/begin), removed wholesale with its separator on delete. `entry`: a
     *  `goTo(...)` target in an entry/extend block, redirected to `exit()` on delete. */
    kind: "list" | "entry";
    /** Byte span of the enclosing `goTo(...)` call (for the `exit()` redirect). Set only for `kind: "entry"`. */
    callRange?: { start: number; end: number };
}

/** TD only: the source anchors a structural edit needs beyond per-state spans - state-list membership and the
 *  insertion points for a brand-new state's function declaration and its state-list entry. */
export interface TDWiring {
    refs: TDStateRef[];
    /** Insert point for a new state's function id in the PRIMARY state list: the offset just before the closing
     *  `]`/`)`, plus the separator to prepend (", " when the list already has elements, else ""). Absent when
     *  the file declares no append/begin list. */
    listInsert?: { offset: number; separator: string };
    /** Byte offset to insert a NEW `function` declaration: the start of the primary wiring statement. Absent when
     *  the file has no append/begin call. */
    newFnAnchor?: number;
}

export interface DDialogData {
    blocks: DDialogBlock[];
    states: DDialogState[];
    /** Translation messages keyed by index. Populated by the client before rendering; not set by the server. */
    messages?: Record<string, string>;
    /** TD only: state-list wiring + new-state insertion anchors (see `TDWiring`). Set by the TD source parser;
     *  absent for tree-sitter-parsed `.d`. */
    tdWiring?: TDWiring;
}
