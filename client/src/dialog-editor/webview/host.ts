/**
 * Single channel to the extension host. `acquireVsCodeApi()` may be called only
 * once per webview, so it is acquired here and shared. In the render harness (no
 * VS Code runtime) it is absent, and posting is a no-op.
 */

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

let api: { postMessage(msg: unknown): void } | undefined;
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
