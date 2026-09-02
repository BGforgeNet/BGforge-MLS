/**
 * Carrying a host message across Playwright's `evaluate` boundary into the harness page.
 *
 * Production sends an animation's frames as one `ArrayBuffer` - VS Code's webview transport
 * recreates it - but Playwright's own argument serialization does not, and hands the page an empty
 * object instead. The frames then decode to nothing and every tile renders black, which reads as a
 * rendering bug in the editor rather than as a harness limit. So the buffer crosses THIS hop as a
 * plain number array and becomes an ArrayBuffer again inside the page, leaving the App's own message
 * boundary identical to production's.
 */
import type { AnimationView, HostToWebview } from "../../../client/src/image-editor/webview/messages";

export type HarnessWireMessage = { type: "init"; view: AnimationView; pixelBytes: number[] } | HostToWebview;

export function toHarnessWire(m: HostToWebview): HarnessWireMessage {
    if (m.type !== "init") return m;
    return { ...m, pixelBytes: [...new Uint8Array(m.view.pixels)] };
}

/** Runs INSIDE the page: rebuilds the ArrayBuffer and posts the message the App expects. */
export function postHarnessWire(m: HarnessWireMessage): void {
    const message =
        m.type === "init" && "pixelBytes" in m
            ? { type: "init", view: { ...m.view, pixels: new Uint8Array(m.pixelBytes).buffer } }
            : m;
    window.postMessage(message, "*");
}
