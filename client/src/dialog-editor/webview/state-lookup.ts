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
