import { mount } from "svelte";
import App from "./components/App.svelte";
import { installFatalErrorHandler } from "../../webview-utils";
import { TILE_SIZES } from "../../ie-resources/tile-sizes";
import type { WebviewToHost } from "./messages";

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

// @ts-expect-error -- acquireVsCodeApi is injected by the VSCode webview runtime
const vscode: VsCodeApi = acquireVsCodeApi();

const target = document.querySelector("#app");

// Installed before mounting so a throw during the initial render is reported to the host (output channel +
// toast) and shown in the panel, instead of leaving a silently blank webview.
installFatalErrorHandler({
    vscode,
    label: "Image gallery",
    render: (detail) => {
        if (target) target.textContent = detail;
    },
});

if (target) {
    mount(App, {
        target,
        props: { post: (message: WebviewToHost) => vscode.postMessage(message), ladder: TILE_SIZES },
    });
}

// The serializer that restores this panel after a window reload reads exactly what is stored here, so which
// corpus the panel was showing has to be persisted the moment the host says.
globalThis.addEventListener("message", (event: MessageEvent<{ type?: string; source?: string }>) => {
    if (event.data.type === "init") vscode.setState({ source: event.data.source });
});

vscode.postMessage({ type: "ready" } satisfies WebviewToHost);
