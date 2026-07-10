// Run the PRODUCTION webview entry (main.ts): mount the root App.svelte and post the "ready"
// handshake. App holds the posted model in a Svelte $state proxy and passes that proxy down to
// DialogGraph - the exact path the live webview takes. The render drivers deliver the model through
// the real `window.postMessage` channel App listens on (see render.mts) with no host attached
// (postToHost no-ops), while edit-roundtrip.mts injects acquireVsCodeApi so the ready/emit protocol
// runs against the fake host too. Mounting DialogGraph with a raw object (the old harness) skipped
// all of that and gave false-positive screenshots while the live editor was stuck on "Parsing
// dialog...".
import "../../webview/main";
