/**
 * Pure edit-gating helpers for the dialog Inspector. Kept out of the Svelte component so the
 * rules that decide whether a text field may be edited are unit-testable (the component itself
 * has no unit-test seam).
 */

/** Parse a bare `@N` line to its numeric id, or null for a literal / non-`@N` text. */
export function msgRef(text: string | undefined): string | null {
    const m = /^@(\d+)$/.exec((text ?? "").trim());
    return m ? m[1]! : null;
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
 */
export function textFieldLocked(opts: {
    text: string | undefined;
    messages: Record<string, string> | undefined;
    ssl: boolean;
    textRO: boolean;
}): boolean {
    const { text, messages, ssl, textRO } = opts;
    if (textRO) return true;
    if (!ssl) return false;
    const ref = msgRef(text);
    return ref === null || messages?.[ref] === undefined;
}
