// Placeholder browser-side webview script. Renders the worker-backed editor's rows as
// plain text and wires editable fields. Replaced wholesale in Plan 3 (Svelte webview).
import type { Row } from "@bgforge/binary-editor";
import type { HostToWebview, WebviewToHost } from "./messages";

// @ts-expect-error -- acquireVsCodeApi is injected by the VSCode webview runtime
const vscode = acquireVsCodeApi();

function post(message: WebviewToHost): void {
    vscode.postMessage(message);
}

function render(rows: Row[]): void {
    const app = document.querySelector("#app");
    if (!app) return;
    app.replaceChildren();
    for (const row of rows) {
        const line = document.createElement("div");
        line.style.paddingLeft = `${row.depth * 16}px`;
        const label = document.createElement("span");
        label.textContent = `${row.name}: `;
        line.append(label);
        if (row.kind === "field" && row.editable) {
            const input = document.createElement("input");
            input.value = row.displayValue ?? "";
            input.addEventListener("change", () => {
                post({ type: "editField", nodeId: row.id, value: input.value });
            });
            line.append(input);
        } else {
            const value = document.createElement("span");
            value.textContent = row.displayValue ?? "";
            line.append(value);
        }
        app.append(line);
    }
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
    const message = event.data;
    if (message.type === "init") {
        render(message.open.rootWindow);
    } else if (message.type === "changeSet") {
        render(message.changeSet.changed);
    } else if (message.type === "error") {
        const app = document.querySelector("#app");
        if (app) app.textContent = message.message;
    }
});

post({ type: "ready" });
