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
