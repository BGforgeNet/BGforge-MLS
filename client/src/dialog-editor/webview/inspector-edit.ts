/**
 * Pure edit-gating helpers for the dialog Inspector. Kept out of the Svelte component so the
 * rules that decide whether a text field may be edited are unit-testable (the component itself
 * has no unit-test seam).
 */

import type { DialogChoice, DialogMessages, DialogState } from "../../../../shared/dialog-model";

/** Parse a bare `@N` line to its numeric id, or null for a literal / non-`@N` text. */
export function msgRef(text: string | undefined): string | null {
    const m = /^@(\d+)$/.exec((text ?? "").trim());
    return m ? m[1]! : null;
}

/**
 * The single text write-back path for every display line - the tree's inline NPC/option edits and the
 * Inspector's NPC/option fields alike. A resolvable `@N` line writes the new text to its `.msg`/`.tra` entry
 * (localization preserved - the project decision); anything else (a literal, or a just-added item still
 * pending its `@id`) updates the value's own `text` field in place. `target` is the DialogState or
 * DialogChoice that owns the text. (Was copy-pasted at four sites - see coding.md *Share, don't duplicate*.)
 */
export function writeText(target: { text?: string }, messages: DialogMessages | undefined, value: string): void {
    // A `.msg`/`.tra` entry is single-line by format, but the inspector's NPC/option fields are textareas, so
    // Enter (or a multi-line paste) can put a newline into the value. Fold every CR/LF/CRLF to ONE space so the
    // stored line never breaks the file (BUG D). Newlines only - NOT a trim: writeText runs on every keystroke,
    // and trimming would strip a trailing space the moment the user types it. Enter-to-commit on the fields
    // keeps a stray newline from arising in the first place; this is the write-side guard for a paste.
    const single = value.replaceAll(/\r\n?|\n/g, " ");
    const ref = msgRef(target.text);
    if (ref !== null && messages) messages[ref] = single;
    else target.text = single;
}

/**
 * A choice the user just added (pending insert) - it has no source span of any kind yet: no SSL `callRange`
 * or `stmtRange` (an existing option), no `callSites` (a `call` transition), and no WeiDU D `sourceRange`
 * (an existing D option). Its text field must stay editable so the user can type the initial line;
 * `allocateOptionIds` turns it into an `@id` at save.
 */
export function isPendingChoice(c: DialogChoice): boolean {
    // `sourceRange` is D's span (the SSL fields are always absent for D): without it an existing D option would
    // read as pending, which makes textFieldLocked treat it as `isNew` (always editable) - so a D option backed
    // by an UNRESOLVED @tra ref would wrongly stay editable instead of locking, exactly the drop the D gate now
    // guards. Gate on `sourceRange` so that can't happen. A spliced option never lingers span-less in the copy: the
    // webview adopts the host's re-parse after every splice, which assigns the real span.
    return (
        c.callRange === undefined && c.stmtRange === undefined && !c.callSites?.length && c.sourceRange === undefined
    );
}

/** A state the user just added (pending insert): no source span yet - neither SSL `procRange` nor D `sourceRange`. */
export function isPendingState(s: DialogState): boolean {
    return s.procRange === undefined && s.sourceRange === undefined;
}

/**
 * Whether a node's NPC line has no `.msg` entry yet but may be authored fresh - the `isNew` input to
 * `textFieldLocked` for the node-level reply field. True for a just-added (pending) node, AND for a faithful
 * SSL node adopted from source that carries no Reply (`replyless`): once a pending node is spliced and the
 * webview adopts the re-parse it gains a `procRange` (so `isPendingState` flips false), but its reply is still
 * empty and the save path will allocate an `@N` + splice `Reply(@N)` - so the line must stay editable for the
 * user to type it. Keying on `replyless` (set at parse from the empty source reply) rather than `text === ""`
 * keeps it editable through typing, when `text` has become an unsaved literal.
 */
export function npcLineAuthorable(s: DialogState): boolean {
    return isPendingState(s) || s.replyless === true;
}

/**
 * Whether a dialog text field (NPC line or player reply) must render read-only.
 *
 * - A read-only state (`textRO`) locks everything.
 * - A PENDING-NEW field (`isNew`) - a just-added option or node - has no `.msg`/`.tra` entry yet by
 *   definition, so it stays editable for the user to type the initial line (allocated an `@id` at save).
 *   Without this, add-option / add-node are unusable. A read-only state (`textRO`) still wins over it.
 * - A LITERAL line (no `@N`): WeiDU D persists it via the `.d` splice (editable); SSL save only rewrites
 *   `.msg` entries, so an SSL literal has nowhere to write and is locked.
 * - A bare `@N` line: editable only when its `.msg`/`.tra` entry actually LOADED (there is a line to
 *   rewrite). An `@N` whose entry never loaded (translation dir misconfigured, or indexing not done) has
 *   nowhere to write, so an edit would be silently dropped on save - lock it for BOTH families and fail
 *   visibly (a disabled field) rather than accept an edit that vanishes (BUG E: the D family previously
 *   left it editable, so the tab read "saved" while nothing reached disk). An entry that resolved to an
 *   empty string is still a real entry and stays editable.
 */
export function textFieldLocked(opts: {
    text: string | undefined;
    messages: Record<string, string> | undefined;
    ssl: boolean;
    textRO: boolean;
    isNew?: boolean;
    dlg?: boolean;
}): boolean {
    const { text, messages, ssl, textRO, isNew, dlg } = opts;
    if (textRO) return true;
    // A compiled dialog stores a number pointing into the game's string table, so it has nowhere to put prose
    // typed here - changing what a line says means pointing it at a different entry (see the reason below).
    if (dlg) return true;
    if (isNew) return false;
    const ref = msgRef(text);
    if (ref === null) return ssl; // literal: SSL can't persist it (locked); D splices it into the .d (editable)
    return messages?.[ref] === undefined; // @N: editable iff its entry loaded, for D and SSL alike
}

// -----------------------------------------------------------------------------
// Disabled-reason helpers
//
// Every disabled control in the Inspector/Tree carries a concrete, actionable tooltip explaining WHY the edit
// is unavailable and where to make it instead - never a bare disabled control. These pure helpers are the
// single source of that wording so the same gate reads identically everywhere (and stays unit-testable). Each
// returns "" when the control is in fact editable (the caller can then fall back to an action tooltip).
// -----------------------------------------------------------------------------

/**
 * Why a compiled dialog's line cannot be typed into. It is not read-only - the line can be pointed at a
 * different entry - so the wording names the action rather than saying the dialog is locked.
 */
export const DLG_TEXT_LOCK_REASON =
    "A compiled dialog refers to the game's string table rather than holding text, so this line cannot be " +
    'typed into. Use "Change string..." to point it at a different entry.';

/** Read-only because the state is derived (CHAIN/INTERJECT/EXTEND) or the whole dialog is view-only. */
export function stateReadOnlyReason(derivedFrom?: string): string {
    if (derivedFrom)
        return `This state is generated from a ${derivedFrom} block and has no standalone source to edit here - change it in the ${derivedFrom} source.`;
    return "This dialog is open read-only.";
}

/**
 * Why structural editing (rename, retarget, reorder, add/remove option, reaction, low-INT) is unavailable.
 * Call only when the control is disabled (i.e. structuralEditable is false); returns "" if it is actually
 * editable. `editable` is the whole-file flag (D); `ssl` selects Fallout-SSL wording.
 */
export function structuralLockReason(state: DialogState, ssl: boolean, editable: boolean): string {
    if (state.derivedFrom) return stateReadOnlyReason(state.derivedFrom);
    if (!ssl) return editable ? "" : stateReadOnlyReason();
    // SSL: structuralEditable is true only on a faithful/bundle node, so a disabled control here means the
    // node is structured (nested), approximate (loop/switch), or otherwise not round-trippable on save.
    if (state.approximate)
        return "This node uses control flow the editor can't model (a loop or switch), so its structure is read-only - edit the source file.";
    if (state.structured)
        // The structured tier is entered by a nested if/else OR by a preserved non-dialog statement (a var set,
        // a side-effect call) the graph keeps byte-exact but can't model - so the reason names both, not if/else
        // alone (which misdescribed a node gated only by a trailing set_*_var).
        return "This node mixes dialog with structure the graph can't rewrite safely (a nested if/else, or a non-dialog statement like a variable set), so its structure is read-only - edit the source file.";
    return "This node isn't simple enough to edit structurally from the graph - edit the source file.";
}

/**
 * Why a text field (NPC line or option text) is locked, mirroring `textFieldLocked`. Returns "" when editable.
 * `derivedFrom` is the owning state's, for the derived-state wording.
 */
export function textLockReason(opts: {
    text: string | undefined;
    messages: Record<string, string> | undefined;
    ssl: boolean;
    textRO: boolean;
    isNew?: boolean;
    derivedFrom?: string;
    dlg?: boolean;
}): string {
    if (!textFieldLocked(opts)) return "";
    const { text, ssl, textRO, derivedFrom, dlg } = opts;
    if (textRO) return stateReadOnlyReason(derivedFrom);
    if (dlg) return DLG_TEXT_LOCK_REASON;
    const ref = msgRef(text);
    if (ref === null)
        // Only reachable for SSL (a D literal is editable): a literal/computed SSL line has no .msg entry.
        return "This line has no plain @N message id (it's a literal or computed value), so there's no .msg entry to edit here - change it in the source file.";
    // An unresolved @N ref, for either family. The backing file differs: SSL reads .msg, the D family reads .tra.
    const kind = ssl ? "message" : "string";
    const file = ssl ? ".msg" : ".tra";
    return `This line's @${ref} ${kind} isn't loaded, so there's no entry to edit. Point mls.translation.directory in .bgforge.yml at the folder holding this ${file} (or edit the ${file} directly).`;
}

/**
 * The ONE decision for whether a dialog text field (a node's NPC line, or an option's reply text) may be edited,
 * returning the lock AND its reason together. Both views - the Inspector's fields and the tree's inline edits -
 * call this instead of each assembling the `isNew` "authorable" proxy at the call site: that per-site assembly
 * was where the wrong proxy (`isPendingState`, which flips false the moment a new node is adopted from a
 * re-parse) locked a just-added node's still-empty NPC line (the +State bug). Centralizing the authorable/`@N`
 * decision makes any text field, either view, decide it identically.
 *
 * The `authorable` proxy differs by owner and is resolved here: an option keys on `isPendingChoice`, a node's
 * NPC line on `npcLineAuthorable` (pending OR a faithful reply-less node whose Reply the save path allocates).
 * `textRO` is the caller's, NOT re-derived here: the Inspector locks only a derived state's text, while the tree
 * additionally locks a non-field-editable D-family state - a separate policy question (whether the D/TD writer
 * persists a `.tra` edit on an unfaithful state) this decision does not adjudicate. Composes the primitives
 * above rather than re-deriving, so it can never disagree with them; a `null` choice selects the NPC line.
 */
export function textEditability(opts: {
    state: DialogState;
    choice: DialogChoice | null;
    messages: DialogMessages | undefined;
    ssl: boolean;
    textRO: boolean;
    /** The dialog is a compiled `.dlg`: its lines are string-table references, not editable prose. */
    dlg?: boolean;
}): { editable: boolean; reason: string } {
    const { state, choice, messages, ssl, textRO, dlg } = opts;
    const text = (choice ?? state).text;
    const isNew = choice ? isPendingChoice(choice) : npcLineAuthorable(state);
    const base = { text, messages, ssl, textRO, isNew, dlg };
    const locked = textFieldLocked(base);
    return { editable: !locked, reason: locked ? textLockReason({ ...base, derivedFrom: state.derivedFrom }) : "" };
}

/**
 * Editability of ONE SAY line of a WeiDU D multisay state (`SAY @a = @b = @c`), given its raw text - the same
 * lock+reason decision `textEditability` returns, but for a continuation line addressed by value rather than by
 * owner. A continuation line is always existing source (never a pending item), so `isNew` is false: it is gated
 * exactly like any other line by the @N-resolvability / literal rules. `textRO` locks every line (a derived
 * state); `derivedFrom` selects the read-only wording. Composes the same primitives, so it can't disagree.
 */
export function sayLineEditability(opts: {
    text: string | undefined;
    messages: DialogMessages | undefined;
    ssl: boolean;
    textRO: boolean;
    derivedFrom?: string;
}): { editable: boolean; reason: string } {
    const { text, messages, ssl, textRO, derivedFrom } = opts;
    const base = { text, messages, ssl, textRO, isNew: false };
    const locked = textFieldLocked(base);
    return { editable: !locked, reason: locked ? textLockReason({ ...base, derivedFrom }) : "" };
}

/**
 * Why an option's condition field is read-only. Returns "" when editable. `editable` is the whole-file flag
 * (D); for SSL the per-option `conditionEditable` decides, and the reason distinguishes a read-only node
 * structure from a condition shared across several options.
 */
export function conditionLockReason(state: DialogState, choice: DialogChoice, ssl: boolean, editable: boolean): string {
    if (!ssl) return editable && !state.derivedFrom ? "" : stateReadOnlyReason(state.derivedFrom);
    if (choice.conditionEditable !== false) return "";
    if (state.approximate || state.structured)
        return "This node's structure is read-only - its nested/composite condition can't round-trip to a single if, so edit it in the source file.";
    return "This condition gates more than just this option - a reply line, another option, or a side-effect shares the same if, so the graph can't edit it. Change it in the source file.";
}

/** Why a faithful SSL option's Remove is disabled: it sits in its own `if` the save path won't rewrite. */
export function optionRemoveLockReason(): string {
    return "This option sits inside an `if` the graph won't rewrite on save - remove it in the source file.";
}
