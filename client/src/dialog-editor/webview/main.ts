import { mount } from "svelte";
import App from "./App.svelte";
import { postToHost } from "./host";

const target = document.getElementById("app");
if (target) {
    mount(App, { target });
    // Tell the host the webview is ready to receive the model.
    postToHost({ type: "ready" });
}
