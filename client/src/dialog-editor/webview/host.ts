/**
 * Single channel to the extension host. `acquireVsCodeApi()` may be called only
 * once per webview, so it is acquired here and shared. In the render harness (no
 * VS Code runtime) it is absent, and posting is a no-op.
 */

import type { VsCodeApi } from "../../webview-utils";

let api: VsCodeApi | undefined;
try {
    api = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
} catch {
    api = undefined;
}

/** True when running inside the VS Code webview host (vs the standalone harness). */
export function hasHost(): boolean {
    return api !== undefined;
}

export function postToHost(msg: unknown): void {
    api?.postMessage(msg);
}
