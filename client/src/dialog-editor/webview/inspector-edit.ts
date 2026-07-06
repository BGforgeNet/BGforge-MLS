/**
 * Pure edit-gating helpers for the dialog Inspector. Kept out of the Svelte component so the
 * rules that decide whether a text field may be edited are unit-testable (the component itself
 * has no unit-test seam).
 */

import type { DialogChoice, DialogState } from "../../../../shared/dialog-model";

/** Parse a bare `@N` line to its numeric id, or null for a literal / non-`@N` text. */
export function msgRef(text: string | undefined): string | null {
    const m = /^@(\d+)$/.exec((text ?? "").trim());
    return m ? m[1]! : null;
}

/**
 * A choice the user just added (pending insert) - it has no source span of any kind yet: no `callRange`
 * or `stmtRange` (an existing option), and no `callSites` (a `call` transition). Its text field must
 * stay editable so the user can type the initial line; `allocateOptionIds` turns it into an `@id` at save.
 */
export function isPendingChoice(c: DialogChoice): boolean {
    // A `committed` option was already spliced to source and now carries a resolvable `@N` (the reconcile
    // merged its .msg text), so it is no longer pending - it locks/unlocks like any existing `@N` option.
    return !c.committed && c.callRange === undefined && c.stmtRange === undefined && !c.callSites?.length;
}

/** A state the user just added (pending insert): no source procedure yet (no `procRange`). */
export function isPendingState(s: DialogState): boolean {
    return !s.committed && s.procRange === undefined;
}

/**
 * Whether a dialog text field (NPC line or player reply) must render read-only.
 *
 * - A read-only state (`textRO`) locks everything.
 * - WeiDU D persists literal text via the `.d` splice, so a D field is otherwise always editable.
 * - Fallout SSL save only rewrites RESOLVABLE `.msg` entries: a literal (no `@N`) or an `@N` whose
 *   `.msg` line never loaded (translation dir misconfigured, or indexing not done) has nowhere to
 *   write, so an edit would be silently dropped on save. Lock it instead - fail visibly (a disabled
 *   field) rather than accept an edit that vanishes. An entry that resolved to an empty string is
 *   still a real entry and stays editable.
 * - A PENDING-NEW field (`isNew`) - a just-added option or node - has no `.msg` entry yet by definition,
 *   so it stays editable for the user to type the initial line (allocated an `@id` at save). Without this,
 *   add-option / add-node are unusable for SSL. A read-only state (`textRO`) still wins over it.
 */
export function textFieldLocked(opts: {
    text: string | undefined;
    messages: Record<string, string> | undefined;
    ssl: boolean;
    textRO: boolean;
    isNew?: boolean;
}): boolean {
    const { text, messages, ssl, textRO, isNew } = opts;
    if (textRO) return true;
    if (!ssl) return false;
    if (isNew) return false;
    const ref = msgRef(text);
    return ref === null || messages?.[ref] === undefined;
}

// -----------------------------------------------------------------------------
// Disabled-reason helpers
//
// Every disabled control in the Inspector/Tree carries a concrete, actionable tooltip explaining WHY the edit
// is unavailable and where to make it instead - never a bare disabled control. These pure helpers are the
// single source of that wording so the same gate reads identically everywhere (and stays unit-testable). Each
// returns "" when the control is in fact editable (the caller can then fall back to an action tooltip).
// -----------------------------------------------------------------------------

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
        return "This node uses control flow the editor can't model (a loop or switch), so its structure is read-only - edit the .ssl source.";
    if (state.structured)
        return "This node nests if/else conditions the graph can't rewrite safely, so its structure is read-only - edit the .ssl source.";
    return "This node isn't simple enough to edit structurally from the graph - edit the .ssl source.";
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
}): string {
    if (!textFieldLocked(opts)) return "";
    const { text, ssl, textRO, derivedFrom } = opts;
    if (textRO) return stateReadOnlyReason(derivedFrom);
    if (!ssl) return ""; // unreachable: a locked non-SSL field is always textRO
    const ref = msgRef(text);
    if (ref === null)
        return "This line has no plain @N message id (it's a literal or computed value), so there's no .msg entry to edit here - change it in the .ssl source.";
    return `This line's @${ref} message isn't loaded, so there's no entry to edit. Point translation.directory in .bgforge.yml at the folder holding this .msg (or edit the .msg directly).`;
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
        return "This node's structure is read-only - its nested/composite condition can't round-trip to a single if, so edit it in the .ssl source.";
    return "This condition gates more than just this option - a reply line, another option, or a side-effect shares the same if, so the graph can't edit it. Change it in the .ssl source.";
}

/** Why a faithful SSL option's Remove is disabled: it sits in its own `if` the save path won't rewrite. */
export function optionRemoveLockReason(): string {
    return "This option sits inside an `if` the graph won't rewrite on save - remove it in the .ssl source.";
}
