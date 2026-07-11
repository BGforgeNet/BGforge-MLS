import { mount } from "svelte";
import App from "./App.svelte";
import { postToHost } from "./host";
import { installFatalErrorHandler } from "../../webview-utils";

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
}
