import { mount } from "svelte";
import App from "./App.svelte";
import { postToHost } from "./host";
import { installFatalErrorHandler } from "../../webview-utils";
import { initTokenizerFromBytes } from "./highlight/tokenize";
import grammarWasm from "../../../../grammars/weidu-baf/tree-sitter-baf.wasm";
import highlightsScm from "../../../../grammars/weidu-baf/queries/highlights.scm";
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm";

const target = document.getElementById("app");

// Install the fatal-error handler before mounting so a throw during the initial render is reported to the
// host (output channel + toast) and shown in the panel, instead of leaving a silently blank webview.
// postToHost is the dialog webview's only channel to the host (see ./host); it already no-ops when no
// vscode host is present (e.g. the render harness), which installFatalErrorHandler's vscode.postMessage
// call relies on.
installFatalErrorHandler({
    vscode: { postMessage: (m) => postToHost(m) },
    label: "Dialog editor",
    render: (detail) => {
        if (target) target.textContent = detail;
    },
});

if (target) {
    mount(App, { target });
    // Tell the host the webview is ready to receive the model.
    postToHost({ type: "ready" });

    // Bring the BAF syntax tokenizer up AFTER mount, and deliberately without awaiting it: it colours the
    // condition/action fields as a progressive enhancement, so it must never gate first paint or blank the
    // panel if it fails. The grammar/runtime wasm and the highlight query are embedded in this bundle
    // (esbuild binary/text loaders - see scripts/build-webviews.mjs) rather than fetched, so there is no
    // asWebviewUri round-trip and the CSP needs no connect-src, only 'wasm-unsafe-eval' to compile the
    // grammar. tokenizeBaf returns [] until this resolves; the fields render flat until then, then re-colour.
    void initTokenizerFromBytes(runtimeWasm, grammarWasm, highlightsScm);
}
