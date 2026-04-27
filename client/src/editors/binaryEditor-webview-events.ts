import {
    formatEditableNumberValue,
    parseEditableNumberValue,
    sanitizeEditableNumberValue,
    sanitizeEditableStringValue,
    type StringFieldCharset,
} from "./binaryEditor-formatting";

interface VsCodeApi {
    postMessage(message: unknown): void;
}

interface EventContext {
    readonly treeEl: Element;
    readonly vscode: VsCodeApi;
    readonly clearFieldError: (fieldRef: string) => void;
}

function handleStepButton(stepButton: HTMLButtonElement, ctx: EventContext): void {
    const fieldId = stepButton.dataset.field;
    const fieldPath = stepButton.dataset.fieldPath;
    const delta = Number.parseInt(stepButton.dataset.delta ?? "0", 10);
    if (!fieldId || !fieldPath || Number.isNaN(delta)) {
        return;
    }
    const input = ctx.treeEl.querySelector<HTMLInputElement>(
        `.field[data-path="${CSS.escape(fieldPath)}"] input.field-input`,
    );
    if (!input) {
        return;
    }
    const numericFormat = input.dataset.numericFormat === "hex32" ? "hex32" : "decimal";
    const currentValue = parseEditableNumberValue(input.value, numericFormat, input.dataset.valueType);
    if (Number.isNaN(currentValue)) {
        return;
    }
    const nextValue = currentValue + delta;
    input.value = formatEditableNumberValue(nextValue, numericFormat);
    ctx.clearFieldError(fieldPath);
    ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value: nextValue });
}

function handleGroupHeaderClick(groupHeader: HTMLElement, ensureChildrenLoaded: (nodeId: string) => void): void {
    const nodeId = groupHeader.dataset.nodeId;
    if (!nodeId) {
        return;
    }
    const groupEl = groupHeader.parentElement;
    const willExpand = !groupEl?.classList.contains("expanded");
    groupEl?.classList.toggle("expanded");
    if (willExpand) {
        ensureChildrenLoaded(nodeId);
    }
}

function toggleFlagCheckbox(checkbox: HTMLElement, ctx: EventContext): void {
    const fieldId = checkbox.dataset.field;
    const fieldPath = checkbox.dataset.fieldPath;
    if (!fieldId || !fieldPath) {
        return;
    }

    checkbox.classList.toggle("checked");
    checkbox.setAttribute("aria-checked", checkbox.classList.contains("checked") ? "true" : "false");

    const container = checkbox.closest(".field-flags");
    if (!container) {
        return;
    }

    let value = 0;
    container.querySelectorAll<HTMLElement>(".flag-checkbox").forEach((entry) => {
        if (entry.classList.contains("checked")) {
            value |= Number.parseInt(entry.dataset.bit ?? "0", 10);
        }
    });

    ctx.clearFieldError(fieldPath);
    ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value });
}

function handleFlagClick(target: HTMLElement, ctx: EventContext): void {
    const flagLabel = target.closest<HTMLElement>(".flag-label");
    if (flagLabel) {
        const checkbox = flagLabel.querySelector<HTMLElement>(".flag-checkbox");
        if (checkbox) {
            toggleFlagCheckbox(checkbox, ctx);
        }
        return;
    }

    const checkbox = target.closest<HTMLElement>(".flag-checkbox");
    if (checkbox) {
        toggleFlagCheckbox(checkbox, ctx);
    }
}

export function setupTreeEventListeners(ctx: EventContext, ensureChildrenLoaded: (nodeId: string) => void): void {
    const { treeEl } = ctx;

    treeEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;

        const stepButton = target.closest<HTMLButtonElement>(".field-step");
        if (stepButton) {
            event.preventDefault();
            handleStepButton(stepButton, ctx);
            return;
        }

        const groupHeader = target.closest<HTMLElement>(".group-header");
        if (groupHeader) {
            handleGroupHeaderClick(groupHeader, ensureChildrenLoaded);
            return;
        }

        event.preventDefault();
        handleFlagClick(target, ctx);
    });

    treeEl.addEventListener("input", (event) => {
        const target = event.target as HTMLElement;
        if (!(target instanceof HTMLInputElement) || !target.matches("input.field-input")) {
            return;
        }

        if (target.dataset.valueType === "string") {
            // Live keystroke sanitization mirrors the host-side validator.
            // Both the byte budget and the charset come down from the host on
            // the field's render payload — the webview never invents them.
            const maxBytes = Number.parseInt(target.dataset.maxBytes ?? "", 10);
            const charset: StringFieldCharset =
                target.dataset.stringCharset === "ascii-printable" ? "ascii-printable" : "utf8";
            if (Number.isFinite(maxBytes) && maxBytes > 0) {
                const sanitized = sanitizeEditableStringValue(target.value, maxBytes, charset);
                if (sanitized !== target.value) {
                    const cursor = target.selectionStart;
                    target.value = sanitized;
                    if (cursor !== null) {
                        const next = Math.min(cursor, sanitized.length);
                        target.setSelectionRange(next, next);
                    }
                }
            }
            return;
        }

        const numericFormat = target.dataset.numericFormat === "hex32" ? "hex32" : "decimal";
        const sanitized = sanitizeEditableNumberValue(target.value, numericFormat);
        if (sanitized !== target.value) {
            target.value = sanitized;
        }
    });

    treeEl.addEventListener("change", (event) => {
        const target = event.target as HTMLElement;
        if (target instanceof HTMLInputElement && target.matches("input.field-input")) {
            const fieldId = target.dataset.field;
            const fieldPath = target.dataset.fieldPath;
            if (!fieldId || !fieldPath) {
                return;
            }
            if (target.dataset.valueType === "string") {
                ctx.clearFieldError(fieldPath);
                ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value: target.value });
                return;
            }
            const value = parseEditableNumberValue(
                target.value,
                target.dataset.numericFormat === "hex32" ? "hex32" : "decimal",
                target.dataset.valueType,
            );
            if (Number.isNaN(value)) {
                return;
            }
            ctx.clearFieldError(fieldPath);
            ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value });
            return;
        }

        if (target instanceof HTMLSelectElement && target.matches("select.field-input")) {
            const fieldId = target.dataset.field;
            const fieldPath = target.dataset.fieldPath;
            if (!fieldId || !fieldPath) {
                return;
            }
            const value = Number.parseInt(target.value, 10);
            ctx.clearFieldError(fieldPath);
            ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value });
        }
    });

    treeEl.addEventListener("keydown", (event) => {
        const keyboardEvent = event as KeyboardEvent;
        const target = keyboardEvent.target as HTMLElement;
        if (
            target.classList.contains("flag-checkbox") &&
            (keyboardEvent.key === " " || keyboardEvent.key === "Enter")
        ) {
            keyboardEvent.preventDefault();
            toggleFlagCheckbox(target, ctx);
            return;
        }

        if (target instanceof HTMLInputElement && target.matches("input.field-input")) {
            if (keyboardEvent.key !== "ArrowUp" && keyboardEvent.key !== "ArrowDown") {
                return;
            }
            keyboardEvent.preventDefault();
            const fieldId = target.dataset.field;
            const fieldPath = target.dataset.fieldPath;
            if (!fieldId || !fieldPath) {
                return;
            }
            const numericFormat = target.dataset.numericFormat === "hex32" ? "hex32" : "decimal";
            const currentValue = parseEditableNumberValue(target.value, numericFormat, target.dataset.valueType);
            if (Number.isNaN(currentValue)) {
                return;
            }
            const delta = keyboardEvent.key === "ArrowUp" ? 1 : -1;
            const nextValue = currentValue + delta;
            target.value = formatEditableNumberValue(nextValue, numericFormat);
            ctx.clearFieldError(fieldPath);
            ctx.vscode.postMessage({ type: "edit", fieldId, fieldPath, value: nextValue });
        }
    });
}

export function setupSidebarButtons(
    vscode: VsCodeApi,
    expandAllBtn: HTMLElement | null,
    collapseAllBtn: HTMLElement | null,
    dumpJsonBtn: HTMLElement | null,
    loadJsonBtn: HTMLElement | null,
    treeEl: Element,
    state: { expandAllActive: boolean },
    expandLoadedGroupsAndQueueChildren: () => void,
): void {
    expandAllBtn?.addEventListener("click", () => {
        state.expandAllActive = true;
        expandLoadedGroupsAndQueueChildren();
    });

    collapseAllBtn?.addEventListener("click", () => {
        state.expandAllActive = false;
        treeEl.querySelectorAll<HTMLElement>(".group").forEach((groupEl) => groupEl.classList.remove("expanded"));
    });

    dumpJsonBtn?.addEventListener("click", () => {
        vscode.postMessage({ type: "dumpJson" });
    });

    loadJsonBtn?.addEventListener("click", () => {
        vscode.postMessage({ type: "loadJson" });
    });
}
