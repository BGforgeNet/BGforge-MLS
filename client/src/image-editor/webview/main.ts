import { mount } from "svelte";
import App from "./components/App.svelte";
import { Bridge } from "./state/bridge";
import { installFatalErrorHandler } from "../../webview-utils";
import type { WebviewToHost } from "./messages";

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

// @ts-expect-error -- acquireVsCodeApi is injected by the VSCode webview runtime
const vscode: VsCodeApi = acquireVsCodeApi();

const target = document.querySelector("#app");

// Install the fatal-error handler before mounting so a throw during the initial render is reported to the host
// (output channel + toast) and shown in the panel, instead of leaving a silently blank webview.
installFatalErrorHandler({
    vscode,
    label: "Animation editor",
    render: (detail) => {
        if (target) target.textContent = detail;
    },
});

const bridge = new Bridge((m: WebviewToHost) => vscode.postMessage(m));
// acquireVsCodeApi() may be called only once per webview, so the persisted-state accessor the
// player's ViewControls needs (zoom/background survive a reload) is threaded down from here.
const viewState = { get: () => vscode.getState(), set: (state: unknown) => vscode.setState(state) };

if (target) mount(App, { target, props: { bridge, viewState } });

vscode.postMessage({ type: "ready" } satisfies WebviewToHost);
