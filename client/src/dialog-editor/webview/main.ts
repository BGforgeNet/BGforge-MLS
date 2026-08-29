import { mount } from "svelte";
import App from "./App.svelte";
import { postToHost } from "./host";
import { SLOW_FRAME_MS, installFatalErrorHandler, observeSlowFrames } from "../../webview-utils";
import { initTextmate } from "./highlight/textmate";
import type { IRawGrammar } from "vscode-textmate";
import onigWasm from "vscode-oniguruma/release/onig.wasm";
import bafGrammarJson from "../../../../syntaxes/weidu-baf.tmLanguage.json";
import sslGrammarJson from "../../../../syntaxes/fallout-ssl.tmLanguage.json";
import docstringGrammarJson from "../../../../syntaxes/bgforge-mls-docstring.tmLanguage.json";
import tsExprGrammarJson from "../../../../syntaxes/dialog-tsexpr.tmLanguage.json";

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

// Report the webview's own stalls to the host. Layout and re-render of a large dialog run here, on a thread
// the host cannot see into, so without this a frozen panel is something a user notices and nothing records.
// Never disconnected: the observer lives as long as the webview, and the webview dies with its panel.
observeSlowFrames(SLOW_FRAME_MS, (ms) => postToHost({ type: "slowFrame", ms }));

if (target) {
    mount(App, { target });
    // Tell the host the webview is ready to receive the model.
    postToHost({ type: "ready" });

    // Bring the TextMate tokenizer up AFTER mount, and deliberately without awaiting it: it colours the
    // condition/action fields as a progressive enhancement, so it must never gate first paint or blank the
    // panel if it fails. One engine (vscode-textmate + oniguruma) runs every dialog language's grammar; the
    // editor colours all of them through these same grammars, so the webview is parity by construction.
    // onig.wasm is embedded via the esbuild binary loader and the grammar JSONs via the default json loader
    // (all in-bundle, nothing fetched), so the CSP needs only 'wasm-unsafe-eval' to compile the regex engine
    // and no connect-src. tokenize() returns [] until this resolves; fields render flat until then, then
    // re-colour. The SSL grammar's include chain reaches the docstring grammar, so it is registered too (a
    // docstring never appears in a condition, but the grammar can reference it). The .json files ARE compiled
    // TextMate grammars, but resolveJsonModule infers a structural literal type that does not unify with
    // IRawGrammar's index-signature interfaces; the Registry consumes them unchanged, so cast at this boundary.
    void initTextmate(
        onigWasm,
        [
            { scopeName: "source.weidu-baf", grammar: bafGrammarJson as unknown as IRawGrammar },
            { scopeName: "source.fallout-ssl", grammar: sslGrammarJson as unknown as IRawGrammar },
            { scopeName: "source.bgforge-mls-docstring", grammar: docstringGrammarJson as unknown as IRawGrammar },
            { scopeName: "source.dialog-tsexpr", grammar: tsExprGrammarJson as unknown as IRawGrammar },
        ],
        { baf: "source.weidu-baf", ssl: "source.fallout-ssl", ts: "source.dialog-tsexpr" },
    );
}
