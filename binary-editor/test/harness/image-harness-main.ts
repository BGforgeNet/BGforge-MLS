// Browser side of the animation-editor harness: the REAL webview App.svelte + Bridge, with the bridge
// transport pointed at a Playwright-exposed Node function (window.__hostUpImage) instead of
// vscode.postMessage. Mirrors harness-main.ts (the binary-editor harness entry); a distinct global
// function name avoids a declaration-merge conflict between the two harnesses' differently-shaped
// WebviewToHost types when both entries are type-checked together under one tsconfig.
import { mount } from "svelte";
import App from "../../../client/src/image-editor/webview/components/App.svelte";
import { Bridge } from "../../../client/src/image-editor/webview/state/bridge";
import type { WebviewToHost } from "../../../client/src/image-editor/webview/messages";

declare global {
    interface Window {
        __hostUpImage: (m: WebviewToHost) => void;
    }
}

const bridge = new Bridge((m: WebviewToHost) => window.__hostUpImage(m));
const target = document.querySelector("#app");
if (target) mount(App, { target, props: { bridge } });

// Kick off once App's window 'message' listener (attached in an effect) is live.
setTimeout(() => window.__hostUpImage({ type: "ready" }), 0);
