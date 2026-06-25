import { mount } from "svelte";
import App from "../../webview/App.svelte";

// Mount the PRODUCTION root (App.svelte), not DialogGraph directly. App holds the
// posted model in a Svelte $state proxy and passes that proxy down to DialogGraph -
// the exact path the live webview takes. The render driver delivers the model through
// the real `window.postMessage` channel App listens on (see render.mts), so the harness
// exercises the $state-proxy clone, the message handshake, and the error/timeout states.
// Mounting DialogGraph with a raw object (the old harness) skipped all of that and gave
// false-positive screenshots while the live editor was stuck on "Parsing dialog...".
const target = document.getElementById("app");
if (target) {
    mount(App, { target });
}
