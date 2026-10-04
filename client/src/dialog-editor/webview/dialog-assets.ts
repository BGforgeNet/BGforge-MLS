import { DEFAULT_INIT_TIMEOUT_MS, isHostMessage } from "../../webview-utils";

/**
 * The two large payloads the dialog webview needs, posted by the host after "ready" instead of embedded in the
 * bundle: compiling ~2 MB of embedded text and wasm cost the panel about half its boot, and neither is needed
 * for first paint - the graph worker only once the Graph view lays out, the regex engine only to colour code
 * fields. `onigWasm` is base64 because a typed array crossing a webview's postMessage is not reliable on every
 * host, where a string is.
 */
export interface DialogAssets {
    /** elkjs's layout worker script, run as a blob: worker (a webview resource URL is cross-origin to the page). */
    readonly elkWorker: string;
    /** vscode-oniguruma's onig.wasm, base64. */
    readonly onigWasm: string;
}

export interface DialogAssetsMessage extends DialogAssets {
    readonly type: "assets";
}

export function isDialogAssetsMessage(data: unknown): data is DialogAssetsMessage {
    if (typeof data !== "object" || data === null) return false;
    const m = data as Record<string, unknown>;
    return m.type === "assets" && typeof m.elkWorker === "string" && typeof m.onigWasm === "string";
}

export function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
    return bytes;
}

/** The part of `window` the receiver listens through. */
export interface MessageTarget {
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/**
 * Resolves with the first `assets` message `target` receives from the host. Rejects after `timeoutMs` without
 * one, so a host that never sends them shows up as a layout or colouring failure rather than a graph that waits
 * forever.
 */
export function receiveDialogAssets(
    target: MessageTarget = globalThis,
    timeoutMs = DEFAULT_INIT_TIMEOUT_MS,
): Promise<DialogAssets> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            target.removeEventListener("message", onMessage);
            reject(new Error(`the editor host sent no layout/colouring assets within ${timeoutMs / 1000}s`));
        }, timeoutMs);
        function onMessage(event: MessageEvent): void {
            if (!isHostMessage(event) || !isDialogAssetsMessage(event.data)) return;
            clearTimeout(timer);
            target.removeEventListener("message", onMessage);
            resolve(event.data);
        }
        target.addEventListener("message", onMessage);
    });
}

let pending: Promise<DialogAssets> | undefined;

/** The page's assets: listening starts on the first call, which main.ts makes before it sends "ready". */
export function dialogAssets(): Promise<DialogAssets> {
    pending ??= receiveDialogAssets();
    return pending;
}
