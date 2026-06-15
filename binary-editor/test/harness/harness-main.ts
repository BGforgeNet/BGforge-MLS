// Browser side of the standalone harness: the REAL webview App.svelte + Bridge, with the bridge transport pointed at
// a Playwright-exposed Node function (window.__hostUp) instead of vscode.postMessage. The framework-agnostic core
// (dispatch) runs in Node (render.mts) - mirroring the production split where the webview renders in a browser and
// the editor core runs in a worker_threads host. All webview <-> host messages are JSON-safe.
import { mount } from "svelte";
import App from "../../../client/src/binary-editor/webview/components/App.svelte";
import { Bridge } from "../../../client/src/binary-editor/webview/state/bridge";
import type { WebviewToHost } from "../../../client/src/binary-editor/webview/messages";

declare global {
    interface Window {
        __hostUp: (m: WebviewToHost) => void;
    }
}

const bridge = new Bridge((m: WebviewToHost) => window.__hostUp(m));
const target = document.querySelector("#app");
if (target) mount(App, { target, props: { bridge } });

// Kick off once App's window 'message' listener (attached in an effect) is live.
setTimeout(() => window.__hostUp({ type: "ready" }), 0);
