/**
 * Resolve an external-stub label to the dialog tab + state it points at.
 *
 * A transition can leave the active dialog file two ways: a WeiDU `EXTERN`
 * (label shaped `~%file%~:state`) or a `goto` whose target state lives in
 * another file (label is just the bare state id). Both render as external
 * stubs; this turns a stub into a jump when the destination is one of the
 * dialog files this `.d` defines. A stub pointing at a dialog this file does
 * not touch stays dead (returns undefined).
 *
 * Shared by the graph (stub nodes) and the tree (external leaves) so the two
 * views resolve cross-file links identically.
 */
export interface JumpTarget {
    /** Owning root id (the tab to switch to). */
    file: string;
    /** State id within that root. */
    stateId: string;
}

/** `value` without the tildes at either end. A pattern for it (`/^~+|~+$/g`) retries a tilde run from every offset. */
function trimTildes(value: string): string {
    let start = 0;
    let end = value.length;
    while (start < end && value[start] === "~") start++;
    while (end > start && value[end - 1] === "~") end--;
    return value.slice(start, end);
}

export function resolveJumpTarget(
    label: string,
    stateToRoot: Map<string, string>,
    fileToRoot: Map<string, string>,
): JumpTarget | undefined {
    // A bare state id owned by some root (cross-file goto, or a label that is
    // itself a state in another file).
    const ownRoot = stateToRoot.get(label);
    if (ownRoot) return { file: ownRoot, stateId: label };

    // `file:state` - the file part has no colon (`%var%NAME`) but EXTERN wraps it
    // in tildes (`~%CORAN_JOINED%~:CoranRun`), while root labels carry none, so
    // strip the tildes before matching.
    const ci = label.indexOf(":");
    if (ci > 0) {
        const file = trimTildes(label.slice(0, ci));
        const state = label.slice(ci + 1);
        const rootId = fileToRoot.get(file);
        if (rootId && stateToRoot.get(state) === rootId) return { file: rootId, stateId: state };
    }
    return undefined;
}
