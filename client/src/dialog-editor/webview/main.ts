import { mount } from "svelte";
import App from "./App.svelte";
import { postToHost } from "./host";
import { installFatalErrorHandler } from "../../webview-utils";
import { initTokenizerFromBytes } from "./highlight/tokenize";
import { initSslTokenizer } from "./highlight/textmate";
import type { IRawGrammar } from "vscode-textmate";
import grammarWasm from "../../../../grammars/weidu-baf/tree-sitter-baf.wasm";
import highlightsScm from "../../../../grammars/weidu-baf/queries/highlights.scm";
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm";
import onigWasm from "vscode-oniguruma/release/onig.wasm";
import sslGrammarJson from "../../../../syntaxes/fallout-ssl.tmLanguage.json";
import docstringGrammarJson from "../../../../syntaxes/bgforge-mls-docstring.tmLanguage.json";

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

    // Bring the SSL TextMate tokenizer up the same way - after mount, not awaited, a progressive enhancement
    // that must never gate first paint. The editor colours SSL through this grammar, so running it in the
    // webview is parity by construction. onig.wasm is embedded via the esbuild binary loader and the two
    // grammar JSONs via the default json loader (both in-bundle, nothing fetched), so the CSP needs the same
    // 'wasm-unsafe-eval' as BAF and no connect-src. The include chain is source.fallout-ssl -> the docstring
    // grammar; both are registered so a docstring inside a condition still resolves (it never appears in one,
    // but the grammar can reference it). The .json files ARE compiled TextMate grammars, but resolveJsonModule
    // infers a structural literal type that does not unify with IRawGrammar's index-signature interfaces; the
    // Registry consumes them unchanged, so cast at this one boundary.
    void initSslTokenizer(onigWasm, [
        { scopeName: "source.fallout-ssl", grammar: sslGrammarJson as unknown as IRawGrammar },
        { scopeName: "source.bgforge-mls-docstring", grammar: docstringGrammarJson as unknown as IRawGrammar },
    ]);
}
