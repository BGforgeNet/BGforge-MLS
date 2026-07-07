/**
 * Resolve a state by id, preferring the ACTIVE root.
 *
 * State ids are unique within a dialog (root) but NOT across roots: a WeiDU D file can hold several DLGs
 * (roots) that reuse the same state label, and CHAIN/INTERJECT expansion can even repeat an id within a
 * root. The editor's tree/graph and its selection all operate on the active tab, so a lookup must resolve
 * within the active root first. A first-match-across-all-roots search returned the wrong instance for a
 * duplicated id, which made "Set target" act on a state that does not own the choice - the target silently
 * never changed and selection jumped to the wrong state. Falls back to the other roots only when the id is
 * genuinely absent from the active root.
 */
import type { DialogRoot, DialogState } from "../../../../shared/dialog-model";

export function findStateInRoots(
    roots: DialogRoot[],
    activeRootId: string | undefined,
    stateId: string,
): DialogState | null {
    const active = roots.find((r) => r.id === activeRootId);
    const inActive = active?.states.find((x) => x.id === stateId);
    if (inActive) return inActive;
    for (const r of roots) {
        const s = r.states.find((x) => x.id === stateId);
        if (s) return s;
    }
    return null;
}

/**
 * Distinct state ids of one root, first-occurrence order preserved.
 *
 * A root can carry the same state label more than once (two CHAIN blocks with the same terminal label; see
 * the duplicate-id note above). The GOTO-target dropdown renders these ids as a keyed `{#each}`, so a raw
 * `states.map(s => s.id)` with a repeat produces a duplicate Svelte key (svelte.dev/e/each_key_duplicate) and
 * a render error. A jump target is addressed by label, so listing each distinct label once is both correct
 * and what the dropdown needs.
 */
export function distinctStateIds(states: DialogState[]): string[] {
    return [...new Set(states.map((s) => s.id))];
}

/**
 * Re-resolve a previously-selected option's id against a freshly-parsed state, for the "adopt the faithful
 * re-parse but keep the selection" path (DialogGraph.adoptModel).
 *
 * An EXISTING option keeps its positional id across the parse, so it resolves directly. A JUST-ADDED option
 * does not: the webview names it `<node>#reply` while pending, but once spliced and re-parsed it becomes the
 * positional `<node>#opt<N>` the parser assigns - a different string. The host reports each such item's
 * allocated `@N` text in `allocations` (keyed by the OLD pending id), so we match the pending option to its
 * re-parsed self by that `@N`. Returns null when neither resolves (e.g. the option was removed in the source),
 * so the caller can fall back to a whole-state selection.
 */
export function remapChoiceId(
    keptChoiceId: string,
    state: DialogState,
    allocations: Record<string, string> | undefined,
): string | null {
    if (state.choices.some((c) => c.id === keptChoiceId)) return keptChoiceId;
    const ref = allocations?.[keptChoiceId];
    if (ref === undefined) return null;
    return state.choices.find((c) => c.text === ref)?.id ?? null;
}
