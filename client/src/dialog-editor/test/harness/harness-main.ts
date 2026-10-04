// Run the PRODUCTION webview entry (main.ts): mount the root App.svelte, post the "ready"
// handshake, and bring the BAF tokenizer up. App holds the posted model in a Svelte $state proxy and passes
// that proxy down to DialogGraph - the exact path the live webview takes. The render drivers deliver the
// model through the real `window.postMessage` channel App listens on (see render.mts) with no host attached
// (postToHost no-ops), while edit-roundtrip.mts injects acquireVsCodeApi so the ready/emit protocol runs
// against the fake host too. Mounting DialogGraph with a raw object (the old harness) skipped all of that and
// gave false-positive screenshots while the live editor was stuck on "Parsing dialog...".
//
// main.ts initialises the tokenizer and the layout worker itself from the assets message, so importing it and
// posting that message (below) is all the harness needs - it exercises the real production init, not a
// parallel copy. What it cannot cover is the CSP and the host sending the assets, because its file:// page's
// policy is not enforced and it has no host (see build.mts); that is the live drive's job.
import "../../webview/main";
import elkWorker from "elk-worker-source";
import onigWasm from "vscode-oniguruma/release/onig.wasm";

// The panels post the graph worker and the regex wasm after "ready" (webview-host-html.ts postDialogAssets);
// this page has no host, so it embeds both and posts them to itself through the same message. Runs after
// main.ts (imports evaluate first), which is listening by then.
let binary = "";
for (let i = 0; i < onigWasm.length; i += 0x8000) binary += String.fromCharCode(...onigWasm.subarray(i, i + 0x8000));
window.postMessage({ type: "assets", elkWorker, onigWasm: btoa(binary) }, "*");
