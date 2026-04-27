/**
 * Tracks per-panel tree selection and which panel is currently active so
 * VSCode commands can resolve "what's selected right now?" without reaching
 * into the webview at command-invocation time.
 *
 * The webview owns the visual selection; on every change it posts a
 * selectionChanged message to the host, which feeds it here. View-state
 * changes from VSCode flow through `recordActive`. Commands consult
 * `getActiveSelection`.
 */

export interface BinaryEditorSelection {
    readonly nodeId: string;
    readonly addable?: boolean;
    readonly removable?: boolean;
    readonly arrayPath?: readonly string[];
    readonly entryPath?: readonly string[];
}

export class BinaryEditorSelectionTracker {
    private readonly panelSelections = new Map<string, BinaryEditorSelection>();
    private activePanelKey: string | undefined;

    recordSelection(panelKey: string, selection: BinaryEditorSelection | undefined): void {
        if (selection) {
            this.panelSelections.set(panelKey, selection);
        } else {
            this.panelSelections.delete(panelKey);
        }
    }

    recordActive(panelKey: string, active: boolean): void {
        if (active) {
            this.activePanelKey = panelKey;
            return;
        }
        if (this.activePanelKey === panelKey) {
            this.activePanelKey = undefined;
        }
    }

    getActiveSelection(): BinaryEditorSelection | undefined {
        if (this.activePanelKey === undefined) return undefined;
        return this.panelSelections.get(this.activePanelKey);
    }

    forgetPanel(panelKey: string): void {
        this.panelSelections.delete(panelKey);
        if (this.activePanelKey === panelKey) {
            this.activePanelKey = undefined;
        }
    }
}
