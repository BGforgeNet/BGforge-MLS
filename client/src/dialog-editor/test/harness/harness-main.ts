// Run the PRODUCTION webview entry (main.ts): mount the root App.svelte and post the "ready"
// handshake. App holds the posted model in a Svelte $state proxy and passes that proxy down to
// DialogGraph - the exact path the live webview takes. The render drivers deliver the model through
// the real `window.postMessage` channel App listens on (see render.mts) with no host attached
// (postToHost no-ops), while edit-roundtrip.mts injects acquireVsCodeApi so the ready/emit protocol
// runs against the fake host too. Mounting DialogGraph with a raw object (the old harness) skipped
// all of that and gave false-positive screenshots while the live editor was stuck on "Parsing
// dialog...".
import "../../webview/main";

import { initTokenizerFromBytes } from "../../webview/highlight/tokenize";
import grammarWasm from "../../../../../grammars/weidu-baf/tree-sitter-baf.wasm";
import highlightsScm from "../../../../../grammars/weidu-baf/queries/highlights.scm";
import runtimeWasm from "web-tree-sitter/web-tree-sitter.wasm";

// The BAF tokenizer's wasm is embedded in this bundle rather than fetched, because the harness has no
// host: the production path takes the two URIs from webview.asWebviewUri(), which only exists inside a
// real VS Code webview. This is a DELIBERATE divergence and the reason the live drive cannot be skipped -
// the harness never exercises the CSP or the fetch, which are the parts most likely to break (this repo
// has prior form: code-server's webview silently dropping resources raw Chromium accepts).
//
// Deliberately NOT awaited before mounting: production cannot await it either (the URIs only arrive after
// the webview is up), so the fields must render flat and then re-colour when the wasm lands. Kicking this
// off after mount keeps the harness on that same late-arrival path instead of a friendlier one that would
// hide a broken re-render.
void initTokenizerFromBytes(runtimeWasm, grammarWasm, highlightsScm);
