import { formatEditableNumberValue } from "./binaryEditor-formatting";
import { getLoadableGroupIds, shouldRecursivelyLoadTree } from "./binaryEditor-lazyActions";
import type { BinaryEditorNode } from "./binaryEditor-messages";
import { setupTreeEventListeners, setupSidebarButtons } from "./binaryEditor-webview-events";
import { createAddEntryRow, createNodeElement, renderMessages } from "./binaryEditor-webview-rendering";
import { setupSelection, reapplyVisualSelection } from "./binaryEditor-webview-selection";
import {
    filterTree,
    setupSearchInput,
    setupGlobalKeyboardShortcuts,
    type SearchContext,
} from "./binaryEditor-webview-search";
import { createWebviewState, registerNode, resetState } from "./binaryEditor-webview-state";

/**
 * Binary editor webview script.
 * Receives a lazy tree model from the extension host, renders loaded nodes,
 * and requests children on demand when groups expand.
 */
(function () {
    // @ts-expect-error -- acquireVsCodeApi is injected by VSCode webview runtime
    const vscode = acquireVsCodeApi();

    interface InitMessage {
        type: "init";
        format: string;
        formatName: string;
        rootChildren: BinaryEditorNode[];
        warnings?: string[];
        errors?: string[];
        debug?: boolean;
    }

    // Mirrored from the extension's `bgforge.debug` setting via the init
    // message — the webview has no `vscode.workspace` API of its own. Gate
    // for `debugLog` so diagnostic console output stays quiet by default.
    let debugEnabled = false;
    function debugLog(message: string): void {
        if (debugEnabled) console.log(message);
    }

    interface ChildrenMessage {
        type: "children";
        nodeId: string;
        children: BinaryEditorNode[];
    }

    interface UpdateFieldMessage {
        type: "updateField";
        fieldId: string;
        fieldPath: string;
        displayValue: string;
        rawValue: number | string;
    }

    interface ValidationErrorMessage {
        type: "validationError";
        fieldId?: string;
        fieldPath: string;
        message: string;
    }

    type ExtensionToWebview = InitMessage | ChildrenMessage | UpdateFieldMessage | ValidationErrorMessage;

    const state = createWebviewState();

    const treeEl = document.querySelector(".tree")!;
    const errorsEl = document.querySelector(".errors-container");
    const warningsEl = document.querySelector(".warnings-container");
    const sidebarEl = document.querySelector<HTMLElement>(".sidebar");
    const searchInput = document.getElementById("search") as HTMLInputElement | null;
    const expandAllBtn = document.getElementById("expand-all");
    const collapseAllBtn = document.getElementById("collapse-all");
    const dumpJsonBtn = document.getElementById("dump-json");
    const loadJsonBtn = document.getElementById("load-json");
    let fatalErrorShown = false;

    // -- Error handling -------------------------------------------------------

    function showFatalError(message: string, error?: unknown): void {
        if (fatalErrorShown) {
            return;
        }
        fatalErrorShown = true;

        const detail = error instanceof Error ? `${message}\n${error.stack ?? error.message}` : message;
        console.error("Binary editor runtime error:", error ?? message);
        vscode.postMessage({
            type: "runtimeError",
            message,
            stack: error instanceof Error ? error.stack : undefined,
        });

        renderMessages(errorsEl, "errors", [detail]);
        treeEl.replaceChildren();
        sidebarEl?.classList.add("hidden");
    }

    globalThis.addEventListener("error", (event) => {
        showFatalError(event.message || "Unhandled binary editor error", event.error);
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        showFatalError(message || "Unhandled binary editor promise rejection", reason);
    });

    // -- Lazy loading ---------------------------------------------------------

    function ensureChildrenLoaded(nodeId: string): void {
        if (state.childrenLoaded.has(nodeId) || state.loadingChildren.has(nodeId)) {
            return;
        }
        state.loadingChildren.add(nodeId);
        vscode.postMessage({ type: "getChildren", nodeId });
    }

    function expandLoadedGroupsAndQueueChildren(nodes?: readonly BinaryEditorNode[]): void {
        const groups = (nodes ?? Array.from(state.nodeById.values())).filter(
            (node) => node.kind === "group" && node.expandable,
        );

        for (const group of groups) {
            const groupEl = treeEl.querySelector<HTMLElement>(`.group[data-node-id="${CSS.escape(group.id)}"]`);
            groupEl?.classList.add("expanded");
        }

        for (const nodeId of getLoadableGroupIds(groups, state.childrenLoaded, state.loadingChildren)) {
            ensureChildrenLoaded(nodeId);
        }
    }

    // -- Field updates --------------------------------------------------------

    function updateField(fieldId: string, displayValue: string, rawValue: number | string): void {
        const fieldEl = treeEl.querySelector<HTMLElement>(`.field[data-field-id="${CSS.escape(fieldId)}"]`);
        if (!fieldEl) {
            return;
        }

        state.confirmedRawValues.set(fieldId, rawValue);
        applyFieldValue(fieldEl, rawValue, displayValue);
    }

    function applyFieldValue(fieldEl: HTMLElement, rawValue: number | string, displayValue: string): void {
        const input = fieldEl.querySelector<HTMLInputElement>("input.field-input");
        if (input) {
            if (input.dataset.valueType === "string") {
                input.value = typeof rawValue === "string" ? rawValue : displayValue;
                return;
            }
            input.value = formatEditableNumberValue(
                Number(rawValue),
                input.dataset.numericFormat === "hex32" ? "hex32" : "decimal",
            );
            return;
        }

        const select = fieldEl.querySelector<HTMLSelectElement>("select");
        if (select) {
            select.value = String(rawValue);
            return;
        }

        const checkboxes = fieldEl.querySelectorAll<HTMLElement>(".flag-checkbox");
        if (checkboxes.length > 0) {
            const numericRaw = typeof rawValue === "number" ? rawValue : Number.parseInt(String(rawValue), 10) || 0;
            const zeroState = fieldEl.querySelector<HTMLElement>(".flag-zero-state");
            zeroState?.classList.toggle("hidden", numericRaw !== 0);
            checkboxes.forEach((checkbox) => {
                const bit = Number.parseInt(checkbox.dataset.bit ?? "0", 10);
                const checked = (numericRaw & bit) !== 0;
                checkbox.classList.toggle("checked", checked);
                checkbox.setAttribute("aria-checked", checked ? "true" : "false");
            });
            return;
        }

        const valueEl = fieldEl.querySelector<HTMLElement>(".field-value");
        if (valueEl) {
            valueEl.textContent = displayValue;
        }
    }

    function showFieldError(fieldRef: string, message: string): void {
        const fieldEl = treeEl.querySelector<HTMLElement>(
            `.field[data-field-id="${CSS.escape(fieldRef)}"], .field[data-path="${CSS.escape(fieldRef)}"]`,
        );
        const fieldId = fieldEl?.dataset.fieldId;
        const errorSelector = fieldId
            ? `.field-error[data-error-for="${CSS.escape(fieldId)}"]`
            : `.field-error[data-error-for="${CSS.escape(fieldRef)}"]`;
        const errorEl = treeEl.querySelector<HTMLElement>(errorSelector);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add("visible");
        }

        const confirmedRawValue = fieldId ? state.confirmedRawValues.get(fieldId) : undefined;
        if (fieldEl && confirmedRawValue !== undefined) {
            applyFieldValue(fieldEl, confirmedRawValue, String(confirmedRawValue));
        }
    }

    function clearFieldError(fieldRef: string): void {
        const fieldEl = treeEl.querySelector<HTMLElement>(
            `.field[data-field-id="${CSS.escape(fieldRef)}"], .field[data-path="${CSS.escape(fieldRef)}"]`,
        );
        const fieldId = fieldEl?.dataset.fieldId;
        const errorSelector = fieldId
            ? `.field-error[data-error-for="${CSS.escape(fieldId)}"]`
            : `.field-error[data-error-for="${CSS.escape(fieldRef)}"]`;
        const errorEl = treeEl.querySelector<HTMLElement>(errorSelector);
        if (!errorEl) {
            return;
        }
        errorEl.textContent = "";
        errorEl.classList.remove("visible");
    }

    // -- Tree rendering -------------------------------------------------------

    function renderRoot(message: InitMessage): void {
        // Preserve any active selection across re-renders (undo/redo flips
        // here too). The node id is stable across reparses for nodes that
        // weren't touched; if the prior selection's row was removed, the
        // re-apply call below silently no-ops.
        const previouslySelected = state.selectedNodeId;
        resetState(state);
        state.selectedNodeId = previouslySelected;
        renderMessages(errorsEl, "errors", message.errors);
        renderMessages(warningsEl, "warnings", message.warnings);
        treeEl.replaceChildren();
        sidebarEl?.classList.toggle("hidden", message.rootChildren.length === 0);

        const fragment = document.createDocumentFragment();
        for (const node of message.rootChildren) {
            registerNode(state, node);
            fragment.append(createNodeElement(node));
        }
        treeEl.append(fragment);

        for (const node of message.rootChildren) {
            if (node.kind === "group" && node.expanded) {
                ensureChildrenLoaded(node.id);
            }
        }

        if (searchInput?.value) {
            filterTree(searchInput.value, searchCtx);
        }

        reapplyVisualSelection(treeEl, state.selectedNodeId);
    }

    function renderChildren(nodeId: string, children: ChildrenMessage["children"]): void {
        debugLog(`[webview] renderChildren nodeId=${nodeId}, children.length=${children.length}`);
        const contentEl = treeEl.querySelector<HTMLElement>(
            `.group-content[data-parent-node-id="${CSS.escape(nodeId)}"]`,
        );
        if (!contentEl) {
            debugLog(`[webview] renderChildren: NO contentEl found for ${nodeId}`);
            state.loadingChildren.delete(nodeId);
            return;
        }
        debugLog(`[webview] renderChildren: contentEl had ${contentEl.children.length} children before replace`);

        contentEl.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (const child of children) {
            registerNode(state, child);
            fragment.append(createNodeElement(child));
        }
        contentEl.append(fragment);

        // The add-entry row is re-appended on every children-load because
        // replaceChildren above wipes it. Source of truth is the group's
        // current `addable` flag, which can flip across re-renders (undo/redo).
        const groupNode = state.nodeById.get(nodeId);
        if (groupNode?.addable && groupNode.arrayPath) {
            contentEl.append(createAddEntryRow(groupNode.arrayPath));
        }

        state.childrenLoaded.add(nodeId);
        state.loadingChildren.delete(nodeId);
        reapplyVisualSelection(treeEl, state.selectedNodeId);

        if (searchInput?.value) {
            filterTree(searchInput.value, searchCtx);
        }

        if (shouldRecursivelyLoadTree(state.expandAllActive, searchInput?.value ?? "")) {
            expandLoadedGroupsAndQueueChildren(children);
            return;
        }

        for (const child of children) {
            if (child.kind === "group" && child.expanded) {
                ensureChildrenLoaded(child.id);
            }
        }

        debugLog(`[webview] renderChildren done: contentEl now has ${contentEl.children.length} children`);
    }

    // -- Wiring ---------------------------------------------------------------

    const searchCtx: SearchContext = {
        treeEl,
        ensureChildrenLoaded,
        expandLoadedGroupsAndQueueChildren: () => expandLoadedGroupsAndQueueChildren(),
    };

    const eventCtx = { treeEl, vscode, clearFieldError };

    setupTreeEventListeners(eventCtx, ensureChildrenLoaded);
    setupSelection({
        treeEl,
        vscode,
        getNode: (id) => state.nodeById.get(id),
        getSelectedId: () => state.selectedNodeId,
        setSelectedId: (id) => {
            state.selectedNodeId = id;
        },
    });
    setupSidebarButtons(vscode, expandAllBtn, collapseAllBtn, dumpJsonBtn, loadJsonBtn, treeEl, state, () =>
        expandLoadedGroupsAndQueueChildren(),
    );

    if (searchInput) {
        setupSearchInput(searchInput, searchCtx);
    }
    setupGlobalKeyboardShortcuts(searchInput, searchCtx);

    // -- Message handler ------------------------------------------------------

    window.addEventListener("message", (event) => {
        // VSCode host-to-webview messages share the webview's own origin;
        // reject anything else (CodeQL js/missing-origin-check).
        if (event.origin !== globalThis.origin) {
            return;
        }
        const msg = event.data as ExtensionToWebview;
        switch (msg.type) {
            case "init":
                debugEnabled = msg.debug === true;
                renderRoot(msg);
                break;
            case "children":
                renderChildren(msg.nodeId, msg.children);
                break;
            case "updateField":
                updateField(msg.fieldId, msg.displayValue, msg.rawValue);
                break;
            case "validationError":
                showFieldError(msg.fieldId ?? msg.fieldPath, msg.message);
                break;
        }
    });

    vscode.postMessage({ type: "ready" });
})();
