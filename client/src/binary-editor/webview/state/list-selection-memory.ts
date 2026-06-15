import type { NodeId } from "@bgforge/binary-editor";

// Per-webview memory of the last-selected entry in each master-detail list section, keyed by the layout-stable
// sectionKey. A tab's list (e.g. CRE/ITM effects) unmounts when its tab is hidden, so the selection lives here
// instead of in ListSection's own state - returning to the tab restores the prior pick rather than resetting to
// nothing. Cleared on `init`; reopening the editor spawns a fresh webview with fresh module state, so this map
// only carries within a single open file, which is exactly the "until reopen" lifetime requested.
const lastSelected = new Map<string, NodeId>();

export function rememberSelection(sectionKey: string, id: NodeId): void {
    lastSelected.set(sectionKey, id);
}

export function recallSelection(sectionKey: string): NodeId | undefined {
    return lastSelected.get(sectionKey);
}

export function clearSelectionMemory(): void {
    lastSelected.clear();
}
