/**
 * The gallery's transport to its worker.
 *
 * Deliberately not `binary-editor/worker-bridge`'s `WorkerBridge`: that correlates one request to one awaited
 * promise, which does not fit this protocol. A v2 thumbnail's first reply is a request for its pages, and
 * results are pushed to the webview as they arrive rather than awaited by a caller - so what the gallery
 * needs is a typed stream, not a request/response pair.
 */
import type { Worker } from "node:worker_threads";
import { type GalleryRequest, type GalleryResponse } from "./worker-core";

/** Minimal transport - satisfied by a real worker or by an in-process fake. */
export interface GalleryPort {
    postMessage(request: GalleryRequest): void;
    onMessage(cb: (response: GalleryResponse) => void): void;
    /** The transport's fatal channel: a crash, OOM, or unexpected exit, none of which produce a reply. */
    onError(cb: (err: Error) => void): void;
    dispose(): void;
}

export function galleryWorkerPort(worker: Worker): GalleryPort {
    // `terminate()` exits with code 1 - the same code a crash reports - so the exit code cannot tell our own
    // teardown from a real death. Without this flag, closing a gallery panel raised an error toast every time.
    let disposing = false;
    return {
        postMessage: (request) => worker.postMessage(request),
        onMessage: (cb) => {
            worker.on("message", cb);
        },
        onError: (cb) => {
            worker.on("error", (err) => cb(err instanceof Error ? err : new Error(String(err))));
            worker.on("exit", (code) => {
                if (!disposing && code !== 0) cb(new Error(`Gallery worker exited unexpectedly (code ${code})`));
            });
        },
        dispose: () => {
            disposing = true;
            void worker.terminate();
        },
    };
}
