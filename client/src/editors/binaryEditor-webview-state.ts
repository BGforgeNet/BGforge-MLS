import type { BinaryEditorNode } from "./binaryEditor-messages";

interface WebviewState {
    readonly nodeById: Map<string, BinaryEditorNode>;
    readonly confirmedRawValues: Map<string, number | string>;
    readonly childrenLoaded: Set<string>;
    readonly loadingChildren: Set<string>;
    expandAllActive: boolean;
    selectedNodeId?: string;
}

export function createWebviewState(): WebviewState {
    return {
        nodeById: new Map(),
        confirmedRawValues: new Map(),
        childrenLoaded: new Set(),
        loadingChildren: new Set(),
        expandAllActive: false,
    };
}

export function resetState(state: WebviewState): void {
    state.nodeById.clear();
    state.confirmedRawValues.clear();
    state.childrenLoaded.clear();
    state.loadingChildren.clear();
    state.expandAllActive = false;
    state.selectedNodeId = undefined;
}

export function registerNode(state: WebviewState, node: BinaryEditorNode): void {
    state.nodeById.set(node.id, node);
    if (node.kind === "field" && node.fieldId && node.rawValue !== undefined) {
        state.confirmedRawValues.set(node.fieldId, node.rawValue);
    }
}
