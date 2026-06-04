import { mount } from "svelte";
import App from "./components/App.svelte";
import { Bridge } from "./state/bridge";
import type { WebviewToHost } from "./messages";

// @ts-expect-error -- acquireVsCodeApi is injected by the VSCode webview runtime
const vscode = acquireVsCodeApi();
const bridge = new Bridge((m: WebviewToHost) => vscode.postMessage(m));

const target = document.querySelector("#app");
if (target) mount(App, { target, props: { bridge } });

vscode.postMessage({ type: "ready" } satisfies WebviewToHost);
