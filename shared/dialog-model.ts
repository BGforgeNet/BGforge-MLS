/**
 * Format-neutral dialog model (IR).
 *
 * The dialog editor renders and edits this model; format-specific vocabulary
 * (WeiDU D `CHAIN`/`EXTERN`, Fallout SSL `NOption`/`Reply`) lives only in the
 * adapters that map a parser's output into it. See
 * `docs/superpowers/specs/2026-06-18-dialog-editor-design.md`.
 */

import { sslNameKey } from "./fallout-ssl-names";
import type {
    DDialogData,
    DDialogState,
    DDialogTarget,
    SSLDialogBlock,
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOptionType,
    TDWiring,
} from "./dialog-types";

/** The source language a dialog model was parsed from - the single discriminant on `DialogModel`. */
export type SourceLang = "d" | "ssl" | "td" | "tssl";

/** The target-language family a source language renders as (D-family vs SSL-family conventions). */
export type RenderFamily = "weidu-d" | "fallout-ssl";

/**
 * Derive the render family from the source language. Render/convention gates call this instead of reading a
 * stored `format` field, so the family can never drift from the source language (it is computed, not stored),
 * and adding a fifth language turns every `switch (m.sourceLang)` into a compile error via the `never` guard.
 */
export function renderFamily(lang: SourceLang): RenderFamily {
    switch (lang) {
        case "d":
        case "td":
            return "weidu-d";
        case "ssl":
        case "tssl":
            return "fallout-ssl";
        default: {
            const exhaustiveCheck: never = lang;
            return exhaustiveCheck;
        }
    }
}

/** Resolved translation-string entries keyed by id (the .msg/.tra id space both formats share). */
export type DialogMessages = Record<string, string>;

export interface DialogModel {
    sourceLang: SourceLang;
    /**
     * Blanket-editable flag: true only for WeiDU D, where every state is freely editable. SSL, TD, and TSSL
     * leave this false and gate editing PER NODE via `nodeEditable` (faithful/bundleFaithful) - they are
     * editable, just not blanket-editable. This drives the inspector's `readOnly`, so it is load-bearing,
     * not a "supports editing at all" flag; UI that needs that broader meaning must also check `sourceLang`.
     * See `shared/dialog-editability.ts`.
     */
    editable: boolean;
    /**
     * Dialog file base name (no extension), e.g. `tribec7` for `tribec7.ssl`. Set by the host from the
     * document URI, not the adapter. Used as the speaker label for Fallout SSL (one script is one NPC, so
     * the file name IS the speaker) and as a fallback speaker for a D state that carries none. See
     * `stateHeadLabel`.
     */
    sourceName?: string;
    roots: DialogRoot[];
    /** Resolved message strings keyed by id; populated downstream, not by the adapter. */
    messages?: DialogMessages;
    /**
     * SSL only: byte offset just before `talk_p_proc`, where a newly-added node's procedure is spliced in.
     * Set by the SSL adapter; absent for D and when the source has no talk_p_proc.
     */
    newProcAnchor?: number;
    /**
     * SSL only: ids of the dialog entry nodes (the nodes `talk_p_proc` / `force_dialog_start` reach). Set by
     * the SSL adapter; used to refuse deleting an entry node (which would orphan the conversation). Absent for D.
     */
    entryIds?: string[];
    /**
     * SSL only: each `call <entry>;` in talk_p_proc - whole-statement span, target identifier span, and whether
     * it is a direct talk_p_proc body statement (safely removable without leaving a dangling conditional). Set by
     * the SSL adapter; absent for D. Shape matches `SSLDialogData.entryCalls` exactly so callers share one type.
     */
    entryCalls?: Array<{
        name: string;
        stmtRange: { start: number; end: number };
        targetRange: { start: number; end: number };
        topLevel: boolean;
    }>;
    /**
     * SSL only: byte offset where a new entry call is spliced into talk_p_proc (end of its last body statement).
     * Set by the SSL adapter; absent for D and when the source has no talk_p_proc.
     */
    entryCallAnchor?: number;
    /**
     * SSL only: each `force_dialog_start(Node)` / `start_dialog_at_node(Node)` call reached from outside talk_p_proc,
     * with the target-identifier span. The SSL splicer rewrites these on rename so an out-of-band entry does not
     * dangle at the old name. Set by the SSL adapter from `SSLDialogData.outOfBandCalls`; absent for D.
     */
    outOfBandCalls?: Array<{ name: string; targetRange: { start: number; end: number } }>;
    /**
     * SSL only: every `procedure` name in the file (projected as a dialog node or not). New-node id allocation
     * (`nextSslNodeId`) unions this with the projected node ids so a freshly-minted `NodeNNN` never collides with
     * an existing procedure - including an empty/side-effect-only one the model does not carry. Set by the SSL
     * adapter from `SSLDialogData.procNames`; absent for D.
     */
    existingProcNames?: string[];
    /**
     * TD only: state-list wiring (append/begin membership) plus the insertion anchors for a new state's function
     * declaration and its state-list entry. Set by the WeiDU D adapter from `DDialogData.tdWiring` (the TD source
     * parser populates it); absent for plain `.d`, SSL, and TSSL. The TD splicer reads it for add/remove/rename.
     */
    tdWiring?: TDWiring;
}

export type DialogRootKind = "dialog" | "patch";

export interface DialogRoot {
    id: string;
    label: string;
    kind: DialogRootKind;
    states: DialogState[];
}

/**
 * A light-grouped branch of a bundle node, for render. `kind` "if" carries the `condition` text (parens
 * included) shown as a faint chip; "else" has none. `replies` are the branch's NPC lines (resolved text).
 * `choiceIds` reference this state's flat `choices` (the player options in this branch). `opaque` holds the
 * preserved non-dialog statement texts shown in the collapsed logic drawer. Set by the SSL adapter.
 */
export interface DialogBranch {
    kind: "if" | "else";
    condition?: string;
    /** SSL only: byte span of the `if` condition (parens included), for editing. Absent for `else`. Set by the adapter. */
    conditionRange?: { start: number; end: number };
    /** SSL only: splice point for a new option inside this branch body. Set by the adapter. */
    insertAnchor?: { offset: number; indent: string };
    /** SSL only: byte span of the whole `if` statement (for deleting a sibling/sole if). Set on `if` branches by the adapter. */
    stmtRange?: { start: number; end: number };
    /** SSL only: byte span from the `else` keyword through the else-block `end` (for deleting just the else). Set on `else` branches by the adapter. */
    elseClauseRange?: { start: number; end: number };
    /** SSL only: offset right after the then-block's closing `end`, where ` else begin...end` is appended. Set on `if` branches with a block then-body by the adapter. */
    thenBlockEnd?: number;
    replies: { text: string; textKind?: "computed" | "random" }[];
    choiceIds: string[];
    opaque: string[];
}

/**
 * One item in a recursive dialog block (the `structured` tier - see `SSLDialogBlock`). The adapter resolves
 * the SSL block's index references into this presentation-ready form: `line` carries the NPC line text,
 * `choice` references a `DialogState.choices` entry by id (both options and `call` transitions become choices),
 * `group` is a nested `if`/`else`. `opaque` (side-effect statements) is preserved for completeness but the tree
 * does not render it (side-effects surface via the node-level badge). Recursive via `group`.
 */
export type DialogBlockItem =
    | { kind: "line"; text: string; textKind?: "computed" | "random" }
    | { kind: "choice"; choiceId: string }
    | { kind: "opaque"; text: string }
    | { kind: "group"; condition: string; thenBlock: DialogBlock; elseBlock?: DialogBlock };

export type DialogBlock = DialogBlockItem[];

/**
 * The unified dialog-state IR every backend (Fallout SSL, TSSL, WeiDU D, TD) maps into. It is deliberately ONE
 * wide interface with many backend-specific optional fields (each tagged "SSL only" / "TD only" / etc. below)
 * rather than a discriminated union on `sourceLang`: the generic edit operations (`renameState`/`deleteState`/
 * `addReply` in dialog-edit-ops, the reachability/selection/projection passes) operate across all four backends
 * uniformly, and a union would force every one of them to narrow (and cast) per format at each use site. The
 * cost is that a reader must know which optional-field subset applies to the model in hand - the per-field "who
 * sets this" comments are that map. The per-language WRITERS re-impose the invariants a union would encode, so
 * an out-of-family field is simply never read for the wrong backend.
 */
export interface DialogState {
    id: string;
    speaker?: string;
    /** NPC line - resolved text, or a message ref (`@N` / numeric id) pending inlining. */
    text: string;
    /**
     * Set when `text` is a runtime-built message id rather than a fixed literal:
     * `computed` (a variable/expression) or `random` (a `random(...)` call). Populated
     * by the SSL adapter; absent for D (which uses resolvable `@N`/`#N` refs). Drives the
     * computed/random honesty badges.
     */
    textKind?: "computed" | "random";
    trigger?: string;
    weight?: number;
    choices: DialogChoice[];
    /**
     * Byte range of the corresponding state node in the original source text.
     * Set by the WeiDU D adapter; absent on synthetic states (e.g. CHAIN-flattened)
     * and on non-D formats. Edits (including id rename) must NOT modify this field -
     * it is the stable key that maps an edited state back to its original text span.
     */
    sourceRange?: { start: number; end: number };
    /**
     * Byte ranges of the SAY value node and trigger node within the source, for per-field
     * surgical write-back (splice only the changed field). Set by the WeiDU D adapter;
     * absent on synthetic/derived states and non-D formats. Like `sourceRange`, edits must
     * not modify these - they key an edited field back to its original span.
     */
    sayRange?: { start: number; end: number };
    triggerRange?: { start: number; end: number };
    /**
     * Every SAY alternate of a multisay state (`SAY a = b = c`), in source order, including the first.
     * The flat `text` field carries only the first alternate for display, so a write-back that re-emits the
     * SAY value from `text` alone would drop the rest on save; the WeiDU D writer re-joins these with ` = `
     * (with `text` supplying the first, so an edit to the NPC line is reflected). Set by the WeiDU D adapter;
     * a single-text state leaves it absent (a one-element list would be equivalent).
     */
    sayTexts?: string[];
    /**
     * Set when this state was expanded from a higher-level construct (WeiDU CHAIN /
     * INTERJECT / EXTEND, etc.) rather than authored as a standalone, independently
     * addressable state. Names the construct, for display. A derived state has no
     * `sourceRange`, so the editor renders it read-only and labels it by speaker/line
     * rather than its synthesized id - there is no source span to write an edit back to.
     */
    derivedFrom?: string;
    /**
     * Names of state-mutating builtins this node runs beyond showing its line (SSL only;
     * see `SSLDialogNode.sideEffects`). The D adapter leaves this absent - a D transition's
     * `DO ~...~` action is carried per-choice in `DialogChoice.action` instead. Drives the
     * node-level `side-effect` badge.
     */
    sideEffects?: string[];
    /**
     * SSL only: true when the node's procedure is faithfully representable, so its structure
     * can be edited and written back without loss (see `SSLDialogNode.faithful`). The webview
     * gates per-node structural editing on this. Absent for D, whose states are always
     * structurally editable when not derived.
     */
    faithful?: boolean;
    /**
     * SSL-native only: true when a faithful node has NO Reply in source AND carries the node-level `insertAnchor`
     * `replyOps` splices into - the exact precondition under which the save path allocates an `@N` and splices
     * `Reply(@N)` (see dialog-ssl-ids.ts `replylessInSource` / replyOps). The webview keeps the empty NPC line
     * editable via this flag - `text === ""` alone can't, because typing the first line turns `text` into a
     * literal before save and would otherwise re-lock the field mid-typing. Absent once the node has a reply
     * (the next parse projects the `@N` and the resolvable-`@N` path takes over), for D, and for TSSL (whose
     * parser sets no node-level `insertAnchor`, so `replyOps` cannot splice a reply-add - unlocking it would
     * silently drop the edit).
     */
    replyless?: boolean;
    /**
     * SSL only: where a newly-added option call is spliced in (the end of the node's last body statement,
     * plus its line indentation). Set by the SSL adapter; absent for D and synthetic states.
     */
    insertAnchor?: { offset: number; indent: string };
    /**
     * SSL only: byte span of the whole `procedure <name> ... end` block (used to delete the node). Set by
     * the SSL adapter; absent for D and for a NEW node (no source procedure - the "no procRange = pending
     * insert" marker, mirroring D's absent `sourceRange`).
     */
    procRange?: { start: number; end: number };
    /**
     * SSL/TD: byte span of the node's name identifier token (SSL `procedure <name>`, TD `function <name>`), used
     * to rename the node. Set by the SSL adapter from `SSLDialogNode.nameRange` and by the WeiDU D adapter from a
     * TD state's `nameRange`; absent for tree-sitter `.d` and for new (not-yet-spliced) nodes.
     */
    nameRange?: { start: number; end: number };
    /**
     * TD only: byte span of the entry `if (...)` that wraps this state function and holds nothing else (the
     * state-gate pattern). A node DELETE splices this whole `if` out instead of just the function span, so the
     * removal does not leave a dead empty gate. Set by the WeiDU D adapter from a TD state's `enclosingIfRange`;
     * absent for tree-sitter `.d`, SSL, unwrapped states, and states sharing a gate with siblings.
     */
    enclosingIfRange?: { start: number; end: number };
    /**
     * SSL only: byte span of the name token in this node's forward declaration (`procedure <name>;`), when
     * one exists. Rename rewrites it alongside `nameRange`. Set by the SSL adapter from
     * `SSLDialogNode.forwardDeclRange`; absent for D, for new nodes, and for procedures with no forward decl.
     */
    forwardDeclRange?: { start: number; end: number };
    /**
     * SSL/TD: byte span of the WHOLE forward-declaration statement (SSL `procedure <name>;`, TD
     * `declare function <name>(): void;`). A node DELETE splices it out so the file is not left with an orphan
     * declaration. Set by the SSL adapter from `SSLDialogNode.forwardDeclStmtRange` and by the WeiDU D adapter
     * from a TD state's `forwardDeclStmtRange`; absent for tree-sitter `.d`, new nodes, and states with no forward decl.
     */
    forwardDeclStmtRange?: { start: number; end: number };
    /**
     * SSL only: true when this node is a dialog entry point (directly called by talk_p_proc or
     * force_dialog_start). Set by the SSL adapter from `SSLDialogData.entryPoints`; absent for D.
     */
    isEntry?: boolean;
    /**
     * Set by `renameState` when an existing node's id changes (later task); read by the SSL splicer to
     * find the original source procedure name to rewrite. Never set by the adapter - only the rename
     * operation writes this field. Absent until a rename has occurred.
     */
    renamedFrom?: string;
    /** SSL only: byte span of the first reply's enclosing `if` condition expression (for edit-text). Set by the SSL adapter. */
    condRange?: { start: number; end: number };
    /** SSL only: byte span of the first reply's enclosing `if` statement (for unwrap). Set by the SSL adapter. */
    ifRange?: { start: number; end: number };
    /**
     * SSL only: whether this state's trigger condition may be edited/added/removed from the graph - true when
     * the first reply is unconditional OR sits in a single-call `if`. Set by the SSL adapter.
     */
    conditionEditable?: boolean;
    /** SSL only: true when this node is a single-level if/else bundle (see SSLDialogNode.bundleFaithful). */
    bundleFaithful?: boolean;
    /** SSL only: ordered branches for light-grouped render; absent on non-bundle nodes. Set by the SSL adapter. */
    branches?: DialogBranch[];
    /** SSL only: true when this node renders as a recursive block (see SSLDialogNode.structured). Read-only structure. */
    structured?: boolean;
    /** SSL only: recursive block mirroring the procedure body; set by the adapter only when `structured`. */
    block?: DialogBlock;
    /** SSL only: true when the flat projection is an approximation (see SSLDialogNode.approximate). Drives an "approximate - see source" signal. */
    approximate?: boolean;
}

export type DialogReaction = "neutral" | "good" | "bad";

export interface DialogChoice {
    id: string;
    /** Player reply text or message ref; absent for a direct (call/goto) transition. */
    text?: string;
    /** As `DialogState.textKind`, for this option's text (SSL-populated). */
    textKind?: "computed" | "random";
    condition?: string;
    action?: string;
    target: DialogTarget;
    reaction?: DialogReaction;
    /**
     * SSL only: true when the option is a low-INT variant (`NLowOption`/`GLowOption`/`BLowOption`),
     * shown only to a low-intelligence PC. Set by the SSL adapter; absent for D and for non-Low options.
     */
    lowIq?: boolean;
    /** SSL skill/IQ gate level, when present. */
    skill?: number;
    /**
     * Byte range of this transition's node in the original source. Set by the WeiDU D
     * adapter; used by the per-field surgical edit to splice just this transition.
     */
    sourceRange?: { start: number; end: number };
    /**
     * SSL only: byte span of the whole option call `NOption(...)` (used by reorder). Set by the SSL
     * adapter; absent for D, which uses `sourceRange` for its whole-transition span.
     */
    callRange?: { start: number; end: number };
    /**
     * Byte span of the transition's target token, for a token-splice retarget: SSL's target-Node
     * argument, TD's `goTo(<id>)` argument, and plain D's `GOTO label` / `+ label` state label
     * (absent for EXIT/EXTERN/COPY_TRANS targets, whose retarget changes the clause shape).
     */
    targetRange?: { start: number; end: number };
    /**
     * TD only: byte span of the transition's target-producing call `goTo(<id>)`/`exit()`/`extern(...)`, used to
     * flip an inbound option to `exit()` when its target node is deleted (the reply is kept). Set by the WeiDU D
     * adapter from `DDialogTransition.targetCallRange` for both statement and chain forms; absent for plain `.d` and SSL.
     */
    targetCallRange?: { start: number; end: number };
    /** SSL only: byte span of the whole option statement `NOption(...);` incl. `;` (used by remove). */
    stmtRange?: { start: number; end: number };
    /**
     * SSL only: every `call <target>;` statement this call-choice represents. callTargets is deduped to one
     * call-choice per unique target, but a node may call the same target several times (e.g. one call per
     * if-branch), so all the sites are grouped here - rename rewrites every `targetRange` and delete removes
     * every top-level `stmtRange`. A non-empty list is what marks a choice as a `call` transition (one with
     * no `callRange`). Each site carries the whole-statement span (incl. `;`, for delete), the target
     * identifier span (for rename; absent when the target is a call_expr rather than a plain identifier), and
     * `topLevel` (true when the call is a direct procedure-body statement, so it can be removed without
     * leaving a dangling conditional). Set by the SSL adapter from `SSLDialogNode.callTransitions`; absent for
     * option choices and D formats.
     */
    callSites?: Array<{
        stmtRange: { start: number; end: number };
        targetRange?: { start: number; end: number };
        topLevel: boolean;
    }>;
    /** SSL only: byte span of the enclosing `if` condition expression (for edit-text). Set by the SSL adapter. */
    condRange?: { start: number; end: number };
    /** SSL only: byte span of the whole enclosing `if` statement (for unwrap). Set by the SSL adapter. */
    ifRange?: { start: number; end: number };
    /**
     * SSL only: whether this option's condition may be edited/added/removed from the graph - true when the
     * option is unconditional OR sits in a PURE `if` that gates it alone (`ifPure`: the then-branch holds only
     * this option). A gate shared with a Reply, sibling option, or side-effect is false - editing it would
     * re-time those too, so its condition stays source-only. Set by the SSL adapter; the inspector gates on it.
     */
    conditionEditable?: boolean;
}

export type DialogTarget =
    | { kind: "state"; stateId: string }
    | { kind: "external"; label: string; resolved: boolean }
    | { kind: "exit" };

/**
 * Fallout SSL convention (SSL only): the reserved support nodes are terminal targets, not conversation nodes.
 * `Node999` is the end/leave node (an option that reaches it ends the dialog - rendered as **Exit**); `Node998`
 * is the combat node (rendered as **Combat**). The dialog editor presents an option targeting either as a
 * terminal chip and does NOT draw the node itself, while keeping the faithful `state -> Node99x` target on the
 * model so the source `call`/option round-trips unchanged (a presentation convention, not a model rewrite - see
 * the data/presentation boundary). The chip carries the underlying id as a tooltip. Numeric siblings of
 * `RESERVED_SSL_NODE_NUMS` in dialog-edit-ops.ts (998/999), kept as string ids here for the presentation layer.
 */
export const SSL_TERMINAL_NODES: Record<string, "exit" | "combat"> = { Node999: "exit", Node998: "combat" };

/**
 * Lookup for `sslTerminalKind`, keyed the way SSL compares procedure names. A Map, not an object index, so a
 * state whose id collides with an `Object.prototype` member (`"toString"`, `"constructor"`) cannot be
 * mis-read as a terminal.
 */
const SSL_TERMINAL_BY_NAME = new Map(
    Object.entries(SSL_TERMINAL_NODES).map(([name, kind]) => [sslNameKey(name), kind] as const),
);

/**
 * The terminal kind for an SSL state id, or undefined if it is a normal node. Matched case-insensitively
 * because the engine binds the name that way and the corpus spells it both ways - 22 references to these two
 * sinks read `NOde999` or `node998`, and an exact match would draw each as an ordinary node rather than a
 * terminal chip. Callers still gate on `renderFamily(sourceLang) === "fallout-ssl"` - an SSL convention.
 */
export function sslTerminalKind(id: string): "exit" | "combat" | undefined {
    return SSL_TERMINAL_BY_NAME.get(sslNameKey(id));
}

// --- Display helpers (used by the webview renderer) ------------------------

/**
 * Resolve `@N` translation-string refs to their text for display. The raw `@N`
 * is kept on the model (it is the authored value and the binding the editor
 * writes back to the `.tra`); resolution happens only at render time. An
 * unresolved ref is left as `@N` so a missing string is visible, not blank.
 *
 * The match is intentionally UNANCHORED and global (unlike the anchored `^@(\d+)$`
 * that `bareMsgId` and the id parsers use): this resolves EVERY embedded ref in a
 * display line, not only a line that is exactly one bare ref, so a line mixing text
 * and refs still renders. It is display-only, so a rare literal containing `@N` that
 * happens to collide with a live id is a cosmetic over-resolve, never a saved edit.
 */
export function resolveText(text: string | undefined, messages?: Record<string, string>): string {
    if (!text) return text ?? "";
    if (!messages) return text;
    return text.replaceAll(/@(\d+)/g, (whole, n: string) => messages[n] ?? whole);
}

/**
 * Header label for a state, shown identically on the graph card, the tree row, and the inspector title.
 * "<speaker> - <id>" when a speaker is known, else just the id. The speaker is the state's own `speaker`
 * (a WeiDU D character name) when present, else the dialog file's base name (`sourceName`): a Fallout SSL
 * script is one NPC, so the file name IS the speaker there, and a D state with no explicit speaker falls
 * back to it too. A derived state (CHAIN/INTERJECT/EXTEND) keeps the "<speaker> <@ref>" form because its
 * synthesized id is not source-addressable (searching the file for it finds nothing).
 */
export function stateHeadLabel(state: DialogState, sourceName?: string): string {
    const speaker = state.speaker ?? sourceName;
    if (!state.derivedFrom) return speaker ? `${speaker} - ${state.id}` : state.id;
    const m = /^@(\d+)$/.exec((state.text ?? "").trim());
    const ref = m ? `@${m[1]}` : state.id;
    return speaker ? `${speaker} ${ref}` : ref;
}

// --- Honest-projection badges (1B) -----------------------------------------

/**
 * The badge vocabulary, rendered identically for D and SSL. A badge marks a node
 * the author cannot fully trust as authored/editable source. Each is derived purely
 * from IR fields (see stateBadges/choiceBadges) - never guessed.
 */
export type DialogBadge =
    | "derived"
    | "approximate"
    | "unresolved-external"
    | "computed"
    | "random"
    | "conditional"
    | "side-effect";

// Display priority, highest first: the top badge shows inline on the card, the rest
// move to hover/inspector (see the 1B spec's badge-density decision).
const BADGE_PRIORITY: readonly DialogBadge[] = [
    "derived",
    // `approximate` ranks high: it warns the whole shown tree is a lossy simplification of this node, which
    // subsumes the finer per-item badges below it (a reader must see it before trusting anything in the node).
    "approximate",
    "unresolved-external",
    "computed",
    "random",
    "conditional",
    "side-effect",
];

function orderBadges(present: Set<DialogBadge>): DialogBadge[] {
    return BADGE_PRIORITY.filter((b) => present.has(b));
}

/** Trust/editability badges for a state, ordered by display priority. */
export function stateBadges(state: DialogState): DialogBadge[] {
    const present = new Set<DialogBadge>();
    if (state.derivedFrom) present.add("derived");
    if (state.approximate) present.add("approximate");
    if (state.textKind) present.add(state.textKind);
    if (state.trigger) present.add("conditional");
    if (state.sideEffects?.length) present.add("side-effect");
    return orderBadges(present);
}

/**
 * Trust/editability badges for a single player choice/transition.
 *
 * `side-effect` here fires on a D `DO ~...~` action, an unambiguous per-choice signal.
 * SSL side-effects are node-level instead (a `Node` procedure calling `set_global_var`/
 * `give_xp`/etc.) and ride on `DialogState.sideEffects` via `stateBadges` - classified
 * from the function data's void-return signal, minus a display/debug allowlist, rather
 * than a hardcoded list. So SSL contributes no choice-level `side-effect`.
 */
export function choiceBadges(choice: DialogChoice): DialogBadge[] {
    const present = new Set<DialogBadge>();
    if (choice.target.kind === "external" && !choice.target.resolved) present.add("unresolved-external");
    if (choice.textKind) present.add(choice.textKind);
    if (choice.condition) present.add("conditional");
    if (choice.action) present.add("side-effect");
    return orderBadges(present);
}

/**
 * Whether a node carries any trust/projection badge - on itself or on a choice. The
 * spotlight overlay (1B) highlights flagged nodes and dims fully-authored ones, so this
 * is its per-node predicate. Pure projection over the IR; the renderer reads it, nothing
 * mutates the model.
 */
export function isFlaggedNode(state: DialogState): boolean {
    return stateBadges(state).length > 0 || state.choices.some((c) => choiceBadges(c).length > 0);
}

// --- WeiDU D adapter -------------------------------------------------------

function targetFromD(t: DDialogTarget): DialogTarget {
    switch (t.kind) {
        case "goto":
            return { kind: "state", stateId: t.label };
        case "exit":
            return { kind: "exit" };
        case "extern":
            // Cross-file target. `%var%` filenames are unresolvable in a single file.
            return { kind: "external", label: `${t.file}:${t.label}`, resolved: !t.file.includes("%") };
        case "copy_trans":
            return { kind: "external", label: `COPY_TRANS ${t.file}:${t.label}`, resolved: false };
        default: {
            // Exhaustiveness: a new DDialogTarget kind must be mapped explicitly.
            const exhaustiveCheck: never = t;
            return exhaustiveCheck;
        }
    }
}

/**
 * Same-file EXTERN/COPY_TRANS references live on an `external` target as an opaque label - `targetFromD` encodes
 * them "file:state" (or "COPY_TRANS file:state"). When a state is renamed, a reference to it from ANOTHER dialogue
 * in the SAME .d file (`EXTERN ~thisResref~ <id>`) must have its state part rewritten, or the saved file dangles
 * at the old name. Returns the rewritten label, or null when the target does not reference `oldId` in `file`.
 * The file part (its tilde delimiters and spelling) is preserved; only the state identifier is swapped. Files are
 * matched after tilde-stripping so a genuinely cross-file EXTERN that merely shares the state name is left alone.
 */
export function rewriteSameFileExternRef(label: string, file: string, oldId: string, newId: string): string | null {
    const prefix = label.startsWith("COPY_TRANS ") ? "COPY_TRANS " : "";
    const rest = label.slice(prefix.length);
    const colon = rest.indexOf(":");
    if (colon === -1) return null;
    const refFile = rest.slice(0, colon).replaceAll("~", "");
    const refState = rest.slice(colon + 1);
    if (refState !== oldId || refFile !== file.replaceAll("~", "")) return null;
    return `${prefix}${rest.slice(0, colon)}:${newId}`;
}

function stateFromD(s: DDialogState): DialogState {
    return {
        id: s.label,
        speaker: s.speaker,
        text: s.sayText,
        trigger: s.trigger,
        weight: s.weight,
        choices: s.transitions.map((tr, i) => ({
            id: `${s.label}#${i}`,
            text: tr.replyText,
            condition: tr.trigger,
            action: tr.action,
            target: targetFromD(tr.target),
            sourceRange: tr.range,
            targetRange: tr.targetRange,
            targetCallRange: tr.targetCallRange,
        })),
        sourceRange: s.range,
        nameRange: s.nameRange,
        enclosingIfRange: s.enclosingIfRange,
        forwardDeclStmtRange: s.forwardDeclStmtRange,
        sayRange: s.sayRange,
        triggerRange: s.triggerRange,
        // Carry every SAY alternate so a multisay state round-trips; a single-text state leaves it absent.
        sayTexts: s.sayTexts && s.sayTexts.length > 1 ? s.sayTexts.map((t) => t.text) : undefined,
        derivedFrom: s.derivedFrom,
        // D-family faithfulness: false when the parser saw a body construct the transition list can't round-trip
        // (an inner `if`/`else`), so the editability gate renders the state read-only. Absent = editable.
        faithful: s.faithful,
    };
}

export function modelFromD(data: DDialogData): DialogModel {
    // Structural blocks (begin/append/chain/extend/interject) author content;
    // modify/replace blocks patch external dialogs and render as patch roots.
    // States are grouped into roots by owning dialog file (below). TODO(phase-2+):
    // states without a block label all fall to one default-file root, so a file mixing
    // begin blocks for several different dialog files still lumps those together.
    const patchRoots: DialogRoot[] = data.blocks
        .filter((b) => b.kind === "modify" || b.kind === "replace")
        .map((b, i) => ({
            id: `patch#${i}`,
            label: b.actionName ? `${b.actionName} ${b.file}` : `PATCH ${b.file}`,
            kind: "patch" as const,
            states: [],
        }));

    // Group states under their owning dialog file so a file that appends to several
    // dialogs (or multiple chains/interjects targeting the same dialog) renders one
    // root per real dialog rather than lumping everything under the first block.
    // The parser tags each state with `blockFile` (the owning dialog, distinct from
    // the per-line CHAIN speaker); fall back to the first begin/append file only for
    // states a parser path left untagged.
    const defaultFile = data.blocks.find((b) => b.kind === "begin" || b.kind === "append")?.file ?? "dialog";
    const stateFile = (s: DDialogState): string => s.blockFile ?? defaultFile;

    const byFile = new Map<string, DialogState[]>();
    for (const s of data.states) {
        const file = stateFile(s);
        const arr = byFile.get(file) ?? byFile.set(file, []).get(file)!;
        arr.push(stateFromD(s));
    }
    const dialogRoots: DialogRoot[] = [...byFile].map(([file, states]) => ({
        id: `dialog:${file}`,
        label: file,
        kind: "dialog" as const,
        states,
    }));

    return {
        sourceLang: "d",
        editable: true,
        roots: [...dialogRoots, ...patchRoots],
        messages: data.messages,
        ...(data.tdWiring ? { tdWiring: data.tdWiring } : {}),
    };
}

// --- Fallout SSL adapter (editing gated per node, not view-only; see shared/dialog-editability.ts) ---

const REACTION_BY_PREFIX: Record<string, DialogReaction> = { N: "neutral", G: "good", B: "bad" };

function reactionFromType(type: SSLDialogOptionType): DialogReaction | undefined {
    return REACTION_BY_PREFIX[type.charAt(0)];
}

/**
 * An SSL reply/option references a `.msg` line by numeric id. Emit it as the same `@N` ref
 * the renderer resolves (`resolveText`), so SSL and D share one resolution path - a bare id
 * rendered as a raw "100". A non-numeric id is a computed/runtime expression (a variable, a
 * `random(...)` call) with no fixed line, so it stays literal (and carries a computed/random
 * badge instead).
 */
function sslMsgText(msgId: number | string): string {
    return typeof msgId === "number" ? `@${msgId}` : String(msgId);
}

/**
 * Resolve a structured node's SSL block (index references) into the presentation-ready DialogBlock the tree
 * renders: `line` -> the reply's display text, `choice`/`transition` -> the DialogChoice id stateFromSSL
 * assigns (options are `#opt<index-in-options>`; a `call` transition is `#call<index-in-callTargets>`, deduped),
 * `group` recurses. `opaque` carries the preserved statement text (the tree ignores it; kept for completeness).
 */
function blockFromSSL(node: SSLDialogNode, block: SSLDialogBlock): DialogBlock {
    return block.map((it): DialogBlockItem => {
        switch (it.kind) {
            case "line": {
                const r = node.replies[it.replyIndex]!;
                return { kind: "line", text: sslMsgText(r.msgId), ...(r.msgKind ? { textKind: r.msgKind } : {}) };
            }
            case "choice":
                return { kind: "choice", choiceId: `${node.name}#opt${it.optionIndex}` };
            case "transition": {
                // The block indexes callTransitions (per-site, not deduped); the call-choice id uses the deduped
                // callTargets index. Resolve the site's target name to that choice.
                const name = node.callTransitions?.[it.transitionIndex]?.name;
                return { kind: "choice", choiceId: `${node.name}#call${name ? node.callTargets.indexOf(name) : -1}` };
            }
            case "opaque":
                return { kind: "opaque", text: it.text };
            case "group":
                return {
                    kind: "group",
                    condition: it.condition,
                    thenBlock: blockFromSSL(node, it.thenBlock),
                    ...(it.elseBlock ? { elseBlock: blockFromSSL(node, it.elseBlock) } : {}),
                };
            default: {
                // Exhaustive: SSLDialogBlockItem's kinds are all handled above. The `never` binding turns a
                // future unhandled kind into a compile error, and the throw satisfies array-callback-return.
                const unhandled: never = it;
                throw new Error(`unhandled block item: ${JSON.stringify(unhandled)}`);
            }
        }
    });
}

function stateFromSSL(node: SSLDialogNode): DialogState {
    const choices: DialogChoice[] = [];
    // A structured or approximate node is structurally READ-ONLY this slice (a nested/composite gate cannot
    // round-trip to a single `if` wrapper - see dialog-nested-flatten-bug-class). Force every condition
    // non-editable regardless of the per-option ifPure, so the inspector shows source-only conditions.
    const readOnlyStructure = node.structured === true || node.approximate === true;

    node.options.forEach((opt, i) => {
        choices.push({
            id: `${node.name}#opt${i}`,
            text: sslMsgText(opt.msgId),
            textKind: opt.msgKind,
            // Display the state-scoped condition (own `if`s only) so the state's gate is not re-shown on each
            // child option; edit-gating below still keys off the raw full `conditional`.
            condition: opt.scopedConditional,
            // A message option (empty target) ends the conversation; an option target is a node.
            target: opt.target ? { kind: "state", stateId: opt.target } : { kind: "exit" },
            reaction: reactionFromType(opt.type),
            // The `Low` in NLowOption/GLowOption/BLowOption marks a low-INT-only variant; reactionFromType
            // reads only the first letter, so carry the low-IQ dimension separately or it is lost.
            lowIq: opt.type.includes("Low") || undefined,
            skill: opt.skill,
            callRange: opt.callRange,
            targetRange: opt.targetRange,
            stmtRange: opt.stmtRange,
            condRange: opt.condRange,
            ifRange: opt.ifRange,
            conditionEditable: readOnlyStructure ? false : opt.conditional === undefined || opt.ifPure === true,
        });
    });

    node.callTargets.forEach((t, i) => {
        choices.push({
            id: `${node.name}#call${i}`,
            target: { kind: "state", stateId: t },
        });
    });

    // Group every call site under its matching call-choice (one choice per unique target, no callRange). A node
    // can call the same target several times; collecting all sites lets delete-eligibility tell a node reached
    // by a `call` from one reached only by options, and lets rename/delete touch every call statement.
    node.callTransitions?.forEach((ct) => {
        const c = choices.find(
            (ch) => ch.target.kind === "state" && ch.target.stateId === ct.name && ch.callRange === undefined,
        );
        if (!c) return;
        (c.callSites ??= []).push({
            stmtRange: ct.stmtRange,
            ...(ct.targetRange ? { targetRange: ct.targetRange } : {}),
            topLevel: ct.topLevel,
        });
    });

    const branches: DialogBranch[] | undefined = node.branches?.map((b) => ({
        kind: b.kind,
        condition: b.condition,
        ...(b.conditionRange ? { conditionRange: b.conditionRange } : {}),
        ...(b.insertAnchor ? { insertAnchor: b.insertAnchor } : {}),
        ...(b.stmtRange ? { stmtRange: b.stmtRange } : {}),
        ...(b.elseClauseRange ? { elseClauseRange: b.elseClauseRange } : {}),
        ...(b.thenBlockEnd !== undefined ? { thenBlockEnd: b.thenBlockEnd } : {}),
        replies: b.replyIndices.map((ri) => {
            const r = node.replies[ri]!;
            return { text: sslMsgText(r.msgId), textKind: r.msgKind };
        }),
        // The option choice id stateFromSSL assigns is `${node.name}#opt${index-in-node.options}`, and the
        // branch optionIndices index node.options in source order - so these line up exactly.
        choiceIds: b.optionIndices.map((oi) => `${node.name}#opt${oi}`),
        opaque: b.opaque.map((o) => o.text),
    }));

    // A node can hold several (conditional) Reply lines; show the first as the line,
    // carrying its conditional. TODO(phase-5): surface alternate conditional lines.
    const firstReply = node.replies[0];
    return {
        id: node.name,
        text: firstReply ? sslMsgText(firstReply.msgId) : "",
        textKind: firstReply?.msgKind,
        trigger: firstReply?.conditional,
        condRange: firstReply?.condRange,
        ifRange: firstReply?.ifRange,
        conditionEditable: readOnlyStructure
            ? false
            : firstReply === undefined || firstReply.conditional === undefined || firstReply.ifPure === true,
        choices,
        sideEffects: node.sideEffects,
        faithful: node.faithful,
        // A faithful node with no Reply in source: its empty NPC line is authorable (the save path allocates an
        // @N and splices Reply). Gated on the exact precondition `replyOps` needs - faithful, no reply, AND a
        // node-level `insertAnchor` (the splice point). The SSL parser sets that anchor for every node; the TSSL
        // parser sets only branch anchors, so a reply-less TSSL node projects `replyless` false and its NPC line
        // stays locked (unlocking it would silently drop the edit, since `replyOps` bails without the anchor).
        // Approximate/structured nodes aren't faithful; bundle nodes carry `branches`, so the node-level NPC
        // field this flag gates is never rendered for them.
        ...(node.faithful && firstReply === undefined && node.insertAnchor !== undefined ? { replyless: true } : {}),
        bundleFaithful: node.bundleFaithful,
        ...(branches ? { branches } : {}),
        ...(node.structured ? { structured: true, block: blockFromSSL(node, node.block ?? []) } : {}),
        ...(node.approximate ? { approximate: true } : {}),
        insertAnchor: node.insertAnchor,
        procRange: node.procRange,
        nameRange: node.nameRange,
        forwardDeclRange: node.forwardDeclRange,
        forwardDeclStmtRange: node.forwardDeclStmtRange,
    };
}

export function modelFromSSL(data: SSLDialogData): DialogModel {
    const states = data.nodes.map(stateFromSSL);
    // Mark each state as an entry point when its id is in entryPoints (the nodes talk_p_proc calls directly).
    for (const state of states) {
        state.isEntry = data.entryPoints.includes(state.id);
    }
    return {
        sourceLang: "ssl",
        // Blanket-editable is false for SSL: editing is gated per node (faithful/bundleFaithful via
        // nodeEditable), not blanket like D. See the `editable` field doc on DialogModel above.
        editable: false,
        roots: states.length > 0 ? [{ id: "dialog", label: "dialog", kind: "dialog", states }] : [],
        messages: data.messages,
        newProcAnchor: data.newProcAnchor,
        entryIds: data.entryPoints,
        entryCalls: data.entryCalls,
        entryCallAnchor: data.entryCallAnchor,
        outOfBandCalls: data.outOfBandCalls,
        existingProcNames: data.procNames,
    };
}
