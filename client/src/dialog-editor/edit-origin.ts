/**
 * Tracks self-originated document changes so the provider does not re-project the graph in response to its own
 * WorkspaceEdits, while still re-projecting on genuine external text edits (someone typing in a "Reopen with Text"
 * split). A counter of pending self-edits: markSelfEdit() before each applyEdit; shouldReproject() consumes one
 * pending self-edit per change event and returns false for it, true otherwise.
 *
 * Accepted limitation for slice 1: an external edit that races a pending self-edit is mis-attributed as self
 * (one dropped re-project). Rare in the opt-in graph workflow; revisit with document-version matching if it bites.
 */
export class EchoGuard {
    private pendingSelfEdits = 0;

    markSelfEdit(): void {
        this.pendingSelfEdits++;
    }

    shouldReproject(): boolean {
        if (this.pendingSelfEdits > 0) {
            this.pendingSelfEdits--;
            return false;
        }
        return true;
    }
}
