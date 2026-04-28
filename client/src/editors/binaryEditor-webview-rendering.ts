import type { BinaryEditorNode } from "./binaryEditor-messages";
import { formatEditableNumberValue } from "./binaryEditor-formatting";
// Webview bundle is browser-targeted; importing from the @bgforge/binary
// barrel pulls in zod and the full parser graph. Deep-imports the leaf
// helper instead so esbuild can tree-shake to a tiny bundle.
import { isFlagActive } from "../../../binary/src/flags";

export function createNodeElement(node: BinaryEditorNode): HTMLElement {
    return node.kind === "group" ? createGroupElement(node) : createFieldElement(node);
}

function createGroupElement(node: BinaryEditorNode): HTMLElement {
    const groupEl = document.createElement("div");
    groupEl.className = "group";
    if (node.expanded) {
        groupEl.classList.add("expanded");
    }
    groupEl.dataset.nodeId = node.id;

    const headerEl = document.createElement("div");
    headerEl.className = "group-header";
    headerEl.dataset.nodeId = node.id;
    if (node.addable) {
        // VSCode reads data-vscode-context on the right-clicked element; the
        // webviewSection value is matched against menus.webview/context
        // when-clauses in package.json. Addable group headers expose the
        // "binaryEditorAddableArray" section so the Add-entry menu item shows.
        // (dataset.vscodeContext serialises to data-vscode-context.)
        headerEl.dataset.vscodeContext = JSON.stringify({ webviewSection: "binaryEditorAddableArray" });
    }

    const nameEl = document.createElement("span");
    nameEl.className = "group-name";
    nameEl.textContent = node.name;
    headerEl.append(nameEl);

    const contentEl = document.createElement("div");
    contentEl.className = "group-content";
    contentEl.dataset.parentNodeId = node.id;

    // The add-entry row is owned by renderChildren — it has to re-append after
    // every lazy-load round-trip (which calls replaceChildren() on contentEl)
    // and the source-of-truth `addable` flag may change across re-renders
    // (undo/redo). Adding the row here would only put it on screen for the
    // microseconds before the first getChildren resolves.

    groupEl.append(headerEl, contentEl);
    return groupEl;
}

export function createAddEntryRow(arrayPath: readonly string[]): HTMLElement {
    const rowEl = document.createElement("div");
    rowEl.className = "entity-add-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "entity-add-button";
    button.dataset.arrayPath = JSON.stringify(arrayPath);
    button.textContent = "+ Add entry";
    rowEl.append(button);

    return rowEl;
}

function createRemoveEntryButton(entryPath: readonly string[]): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entity-remove-button";
    button.dataset.entryPath = JSON.stringify(entryPath);
    button.title = "Remove entry";
    button.setAttribute("aria-label", "Remove entry");
    button.textContent = "✕";
    return button;
}

function createFieldElement(node: BinaryEditorNode): HTMLElement {
    const fieldEl = document.createElement("div");
    fieldEl.className = "field";
    fieldEl.dataset.nodeId = node.id;
    if (node.fieldId) {
        fieldEl.dataset.fieldId = node.fieldId;
    }
    if (node.fieldPath) {
        fieldEl.dataset.path = node.fieldPath;
    }
    if (node.removable) {
        // See createGroupElement: removable entries expose the
        // "binaryEditorRemovableEntry" webviewSection so the Remove menu
        // item shows up in the native VSCode webview context menu.
        fieldEl.dataset.vscodeContext = JSON.stringify({ webviewSection: "binaryEditorRemovableEntry" });
    }

    const nameEl = document.createElement("span");
    nameEl.className = "field-name";
    nameEl.textContent = `${node.name}:`;
    fieldEl.append(nameEl);

    fieldEl.append(createFieldValueElement(node));

    const metaEl = document.createElement("span");
    metaEl.className = "field-meta";

    const offsetEl = document.createElement("span");
    offsetEl.className = "field-offset";
    offsetEl.textContent = `[${formatOffset(node.offset)}]`;
    metaEl.append(offsetEl);

    const typeEl = document.createElement("span");
    typeEl.className = "field-type";
    typeEl.textContent = node.valueType ?? "";
    metaEl.append(typeEl);

    // Append the remove button into .field-meta (col 3, row 1) so it sits
    // inline at the row's right edge. Appending it at the field level instead
    // would leave it unplaced in the 3-column subgrid and auto-flow drops it
    // to row 2 col 1 — visually below the row, not on it.
    if (node.removable && node.entryPath) {
        metaEl.append(createRemoveEntryButton(node.entryPath));
    }

    fieldEl.append(metaEl);

    const errorEl = document.createElement("span");
    errorEl.className = "field-error";
    if (node.fieldId) {
        errorEl.dataset.errorFor = node.fieldId;
    }
    fieldEl.append(errorEl);

    return fieldEl;
}

function createFieldValueElement(node: BinaryEditorNode): HTMLElement {
    const fieldId = node.fieldId ?? "";
    const fieldPath = node.fieldPath ?? "";
    const enumTable = node.enumOptions;
    const flagTable = node.flagOptions;

    if (node.editable && enumTable && node.valueType === "enum") {
        return createEnumSelect(fieldId, fieldPath, node, enumTable);
    }

    if (flagTable && node.valueType === "flags") {
        return createFlagsInput(fieldId, fieldPath, node, flagTable, node.editable === true);
    }

    if (node.editable && isNumericType(node.valueType ?? "")) {
        return createNumberInput(fieldId, fieldPath, node);
    }

    if (node.editable && node.valueType === "string") {
        return createStringInput(fieldId, fieldPath, node);
    }

    const valueEl = document.createElement("span");
    valueEl.className = `field-value ${getValueClass(node.valueType ?? "")}`.trim();
    valueEl.textContent = node.value ?? "";
    return valueEl;
}

function createStringInput(fieldId: string, fieldPath: string, node: BinaryEditorNode): HTMLElement {
    const initial = typeof node.rawValue === "string" ? node.rawValue : (node.value ?? "");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "field-input string";
    input.dataset.field = fieldId;
    input.dataset.fieldPath = fieldPath;
    input.dataset.valueType = "string";
    // Both attributes are sourced from the host (presentation schema +
    // parsed-field size), not invented by the webview — see binaryEditor-tree.
    if (typeof node.size === "number") {
        input.dataset.maxBytes = String(node.size);
    }
    if (node.stringCharset) {
        input.dataset.stringCharset = node.stringCharset;
    }
    input.value = initial;
    return input;
}

function createNumberInput(fieldId: string, fieldPath: string, node: BinaryEditorNode): HTMLElement {
    const raw = typeof node.rawValue === "number" ? node.rawValue : Number(node.value ?? 0);
    const numericFormat = node.numericFormat ?? "decimal";
    const container = document.createElement("span");
    container.className = `field-number-group ${numericFormat === "hex32" ? "hex" : "decimal"}`.trim();

    const decrement = document.createElement("button");
    decrement.type = "button";
    decrement.className = "field-step";
    decrement.dataset.field = fieldId;
    decrement.dataset.fieldPath = fieldPath;
    decrement.dataset.delta = "-1";
    decrement.textContent = "\u2212";

    const input = document.createElement("input");
    input.type = "text";
    input.className = `field-input number ${numericFormat === "hex32" ? "hex" : "decimal"}`.trim();
    input.dataset.field = fieldId;
    input.dataset.fieldPath = fieldPath;
    input.dataset.numericFormat = numericFormat;
    input.dataset.valueType = node.valueType ?? "";
    input.value = formatEditableNumberValue(Number.isNaN(raw) ? 0 : raw, numericFormat);

    const increment = document.createElement("button");
    increment.type = "button";
    increment.className = "field-step";
    increment.dataset.field = fieldId;
    increment.dataset.fieldPath = fieldPath;
    increment.dataset.delta = "1";
    increment.textContent = "+";

    if (numericFormat === "hex32") {
        const editor = document.createElement("span");
        editor.className = "field-number-editor";

        const prefix = document.createElement("span");
        prefix.className = "field-input-prefix";
        prefix.textContent = "0x";

        editor.append(prefix, input);
        container.append(editor, decrement, increment);
        return container;
    }

    container.append(input, decrement, increment);
    return container;
}

function createEnumSelect(
    fieldId: string,
    fieldPath: string,
    node: BinaryEditorNode,
    lookup: Record<number, string>,
): HTMLSelectElement {
    const raw = typeof node.rawValue === "number" ? node.rawValue : 0;
    const select = document.createElement("select");
    select.className = "field-input enum";
    select.dataset.field = fieldId;
    select.dataset.fieldPath = fieldPath;

    for (const [key, value] of Object.entries(lookup)) {
        const numericKey = Number(key);
        const option = document.createElement("option");
        option.value = String(numericKey);
        option.textContent = formatEnumDisplayValue(value, numericKey);
        option.selected = numericKey === raw;
        select.append(option);
    }

    return select;
}

function createFlagsInput(
    fieldId: string,
    fieldPath: string,
    node: BinaryEditorNode,
    flagDefs: Record<number, string>,
    editable: boolean,
): HTMLElement {
    const raw = typeof node.rawValue === "number" ? node.rawValue : 0;
    const container = document.createElement("span");
    container.className = `field-flags ${editable ? "editable" : "readonly"}`.trim();
    const zeroFlagLabel = flagDefs[0];

    if (editable && zeroFlagLabel !== undefined) {
        const zeroState = document.createElement("span");
        zeroState.className = "flag-zero-state";
        zeroState.dataset.zeroStateFor = fieldId;
        zeroState.textContent = zeroFlagLabel;
        zeroState.classList.toggle("hidden", raw !== 0);
        container.append(zeroState);
    }

    for (const [bit, name] of Object.entries(flagDefs)) {
        const bitValue = Number(bit);
        if (bitValue === 0) {
            continue;
        }

        const label = document.createElement("label");
        label.className = `flag-label ${editable ? "editable" : "readonly"}`.trim();

        const checkbox = document.createElement("span");
        checkbox.className = `flag-checkbox ${editable ? "editable" : "readonly"}`.trim();
        const activation = node.flagActivation?.[String(bitValue)] ?? (bitValue === 0 ? "equal" : "set");
        if (isFlagActive(raw, bitValue, activation)) {
            checkbox.classList.add("checked");
        }
        checkbox.setAttribute("role", "checkbox");
        checkbox.setAttribute("aria-checked", checkbox.classList.contains("checked") ? "true" : "false");
        checkbox.setAttribute("aria-disabled", editable ? "false" : "true");
        if (editable) {
            checkbox.setAttribute("tabindex", "0");
            checkbox.dataset.field = fieldId;
            checkbox.dataset.fieldPath = fieldPath;
            checkbox.dataset.bit = String(bitValue);
        }

        label.append(checkbox, document.createTextNode(name));
        container.append(label);
    }

    return container;
}

export function renderMessages(container: Element | null, className: string, messages?: string[]): void {
    if (!container) {
        return;
    }

    container.replaceChildren();
    if (!messages || messages.length === 0) {
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = className;
    for (const message of messages) {
        const line = document.createElement("div");
        line.textContent = message;
        wrapper.append(line);
    }
    container.append(wrapper);
}

function formatEnumDisplayValue(label: string, rawValue: number): string {
    return label === String(rawValue) ? label : `${label} (${rawValue})`;
}

function isNumericType(type: string): boolean {
    return type.includes("int") || type.includes("uint");
}

function getValueClass(type: string): string {
    if (type.includes("int") || type.includes("uint")) {
        return "number";
    }
    if (type === "enum") {
        return "enum";
    }
    return "";
}

function formatOffset(offset?: number): string {
    const numericOffset = typeof offset === "number" ? offset : 0;
    return `0x${numericOffset.toString(16).toUpperCase().padStart(4, "0")}`;
}
