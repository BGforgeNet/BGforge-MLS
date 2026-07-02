/**
 * Format-neutral dialog model (IR).
 *
 * The dialog editor renders and edits this model; format-specific vocabulary
 * (WeiDU D `CHAIN`/`EXTERN`, Fallout SSL `NOption`/`Reply`) lives only in the
 * adapters that map a parser's output into it. See
 * `docs/superpowers/specs/2026-06-18-dialog-editor-design.md`.
 */

import type {
    DDialogData,
    DDialogState,
    DDialogTarget,
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOptionType,
} from "./dialog-types";

export type DialogFormat = "weidu-d" | "fallout-ssl";

/** Resolved translation-string entries keyed by id (the .msg/.tra id space both formats share). */
export type DialogMessages = Record<string, string>;

export interface DialogModel {
    format: DialogFormat;
    /** Whether this format's adapter can serialize edits back (D yes, SSL view-only in v1). */
    editable: boolean;
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
     * SSL only: byte span of the `procedure <name>` identifier token (used to rename the node). Set by the
     * SSL adapter from `SSLDialogNode.nameRange`; absent for D and for new (not-yet-spliced) nodes.
     */
    nameRange?: { start: number; end: number };
    /**
     * SSL only: byte span of the name token in this node's forward declaration (`procedure <name>;`), when
     * one exists. Rename rewrites it alongside `nameRange`. Set by the SSL adapter from
     * `SSLDialogNode.forwardDeclRange`; absent for D, for new nodes, and for procedures with no forward decl.
     */
    forwardDeclRange?: { start: number; end: number };
    /**
     * SSL only: byte span of the WHOLE forward-declaration statement (`procedure <name>;`). A node DELETE
     * splices it out so the file is not left with an orphan declaration. Set by the SSL adapter from
     * `SSLDialogNode.forwardDeclStmtRange`; absent for D, new nodes, and procedures with no forward decl.
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
    /**
     * Webview-only, transient: as `DialogChoice.committed`, for a just-added NODE. Marks a pending new node
     * (still without a `procRange`) as already spliced into the source so the next save does not re-emit its
     * procedure. Set only by the host reconcile path (dialog-edit-ops.ts `applyReconcile`), never by the adapter.
     */
    committed?: boolean;
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
     * SSL only: byte span of the whole option call `NOption(...)` (used by reorder) and of its
     * target-Node argument (used by retarget). Set by the SSL adapter; absent for D, which uses
     * `sourceRange` for its whole-transition span.
     */
    callRange?: { start: number; end: number };
    targetRange?: { start: number; end: number };
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
     * option is unconditional OR sits in a single-call `if` (ifSingleCall). A shared `if` block (2+ calls)
     * is false: its condition stays source-only. Set by the SSL adapter; the inspector gates the field on it.
     */
    conditionEditable?: boolean;
    /**
     * Webview-only, transient: set by the host's reconcile message after a just-added option was spliced into
     * the source and allocated its `@N` id. It marks a PENDING choice (still without a `callRange`/`stmtRange`
     * in the webview's working copy) as already committed to source, so the next save does not re-splice it as
     * new (which duplicates the option). Never set by the parser/adapter and never present on a re-projected
     * model - the re-parse gives the option a real source span instead. See dialog-edit-ops.ts `applyReconcile`.
     */
    committed?: boolean;
}

export type DialogTarget =
    | { kind: "state"; stateId: string }
    | { kind: "external"; label: string; resolved: boolean }
    | { kind: "exit" };

// --- Display helpers (used by the webview renderer) ------------------------

/**
 * Resolve `@N` translation-string refs to their text for display. The raw `@N`
 * is kept on the model (it is the authored value and the binding the editor
 * writes back to the `.tra`); resolution happens only at render time. An
 * unresolved ref is left as `@N` so a missing string is visible, not blank.
 */
export function resolveText(text: string | undefined, messages?: Record<string, string>): string {
    if (!text) return text ?? "";
    if (!messages) return text;
    return text.replaceAll(/@(\d+)/g, (whole, n: string) => messages[n] ?? whole);
}

// --- Honest-projection badges (1B) -----------------------------------------

/**
 * The badge vocabulary, rendered identically for D and SSL. A badge marks a node
 * the author cannot fully trust as authored/editable source. Each is derived purely
 * from IR fields (see stateBadges/choiceBadges) - never guessed.
 */
export type DialogBadge = "derived" | "unresolved-external" | "computed" | "random" | "conditional" | "side-effect";

// Display priority, highest first: the top badge shows inline on the card, the rest
// move to hover/inspector (see the 1B spec's badge-density decision).
const BADGE_PRIORITY: readonly DialogBadge[] = [
    "derived",
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
    }
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
        })),
        sourceRange: s.range,
        sayRange: s.sayRange,
        triggerRange: s.triggerRange,
        derivedFrom: s.derivedFrom,
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
        format: "weidu-d",
        editable: true,
        roots: [...dialogRoots, ...patchRoots],
        messages: data.messages,
    };
}

// --- Fallout SSL adapter (view-only) ---------------------------------------

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

function stateFromSSL(node: SSLDialogNode): DialogState {
    const choices: DialogChoice[] = [];

    node.options.forEach((opt, i) => {
        choices.push({
            id: `${node.name}#opt${i}`,
            text: sslMsgText(opt.msgId),
            textKind: opt.msgKind,
            condition: opt.conditional,
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
            conditionEditable: opt.conditional === undefined || opt.ifSingleCall === true,
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
        conditionEditable:
            firstReply === undefined || firstReply.conditional === undefined || firstReply.ifSingleCall === true,
        choices,
        sideEffects: node.sideEffects,
        faithful: node.faithful,
        bundleFaithful: node.bundleFaithful,
        ...(branches ? { branches } : {}),
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
        format: "fallout-ssl",
        editable: false,
        roots: states.length > 0 ? [{ id: "dialog", label: "dialog", kind: "dialog", states }] : [],
        messages: data.messages,
        newProcAnchor: data.newProcAnchor,
        entryIds: data.entryPoints,
        entryCalls: data.entryCalls,
        entryCallAnchor: data.entryCallAnchor,
    };
}
