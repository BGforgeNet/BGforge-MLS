// Run the PRODUCTION webview entry (main.ts): mount the root App.svelte, post the "ready"
// handshake, and bring the BAF tokenizer up. App holds the posted model in a Svelte $state proxy and passes
// that proxy down to DialogGraph - the exact path the live webview takes. The render drivers deliver the
// model through the real `window.postMessage` channel App listens on (see render.mts) with no host attached
// (postToHost no-ops), while edit-roundtrip.mts injects acquireVsCodeApi so the ready/emit protocol runs
// against the fake host too. Mounting DialogGraph with a raw object (the old harness) skipped all of that and
// gave false-positive screenshots while the live editor was stuck on "Parsing dialog...".
//
// main.ts embeds and initialises the tokenizer itself (grammar/runtime wasm + highlight query bundled via
// the shared web-tree-sitter loaders), so importing it is all the harness needs - it exercises the real
// production init, not a parallel copy. The one thing the harness still cannot cover is the CSP and (absent)
// wasm fetch, because its file:// page's policy is not enforced (see build.mts); that is the live drive's job.
import "../../webview/main";
