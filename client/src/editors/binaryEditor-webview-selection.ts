/**
 * Webview-side single-selection state. Owns the visual `.selected` class on
 * the highlighted row and posts a `selectionChanged` message to the host on
 * every change so VSCode commands can resolve the active selection.
 */

import type { BinaryEditorNode } from "./binaryEditor-messages";

interface VsCodeApi {
    postMessage(message: unknown): void;
}

interface SelectionContext {
    readonly treeEl: Element;
    readonly vscode: VsCodeApi;
    readonly getNode: (nodeId: string) => BinaryEditorNode | undefined;
    readonly getSelectedId: () => string | undefined;
    readonly setSelectedId: (id: string | undefined) => void;
}

function findRowFromTarget(target: HTMLElement | null): HTMLElement | undefined {
    if (!target) return undefined;
    const row = target.closest<HTMLElement>(".field, .group-header");
    return row ?? undefined;
}

function nodeIdOfRow(row: HTMLElement): string | undefined {
    return row.dataset.nodeId;
}

function clearVisualSelection(treeEl: Element): void {
    treeEl
        .querySelectorAll<HTMLElement>(".group-header.selected, .field.selected")
        .forEach((el) => el.classList.remove("selected"));
}

function rowForNodeId(treeEl: Element, nodeId: string): HTMLElement | null {
    return treeEl.querySelector<HTMLElement>(
        `.group-header[data-node-id="${CSS.escape(nodeId)}"], .field[data-node-id="${CSS.escape(nodeId)}"]`,
    );
}

function postSelection(ctx: SelectionContext, nodeId: string | undefined): void {
    if (!nodeId) {
        ctx.vscode.postMessage({ type: "selectionChanged", selection: undefined });
        return;
    }
    const node = ctx.getNode(nodeId);
    if (!node) {
        ctx.vscode.postMessage({ type: "selectionChanged", selection: undefined });
        return;
    }
    ctx.vscode.postMessage({
        type: "selectionChanged",
        selection: {
            nodeId: node.id,
            ...(node.addable ? { addable: true, arrayPath: node.arrayPath } : {}),
            ...(node.removable ? { removable: true, entryPath: node.entryPath } : {}),
        },
    });
}

function selectRow(ctx: SelectionContext, row: HTMLElement): void {
    const nodeId = nodeIdOfRow(row);
    if (!nodeId || nodeId === ctx.getSelectedId()) return;

    clearVisualSelection(ctx.treeEl);
    row.classList.add("selected");
    ctx.setSelectedId(nodeId);
    postSelection(ctx, nodeId);
}

export function setupSelection(ctx: SelectionContext): void {
    ctx.treeEl.addEventListener("click", (event) => {
        const row = findRowFromTarget(event.target as HTMLElement | null);
        if (row) selectRow(ctx, row);
    });

    // Right-click selects too, so the host's selection tracker matches the
    // row VSCode is about to open the native webview context menu over.
    // We don't preventDefault — the menu still opens via `data-vscode-context`
    // attributes the renderer puts on each row.
    ctx.treeEl.addEventListener("contextmenu", (event) => {
        const row = findRowFromTarget(event.target as HTMLElement | null);
        if (row) selectRow(ctx, row);
    });
}

/**
 * Re-apply the selection class after the tree re-renders (init / children
 * load / undo refresh). The webview's selection id is preserved across
 * re-renders, but the DOM elements are recreated.
 */
export function reapplyVisualSelection(treeEl: Element, selectedNodeId: string | undefined): void {
    clearVisualSelection(treeEl);
    if (!selectedNodeId) return;
    rowForNodeId(treeEl, selectedNodeId)?.classList.add("selected");
}
