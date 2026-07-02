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
