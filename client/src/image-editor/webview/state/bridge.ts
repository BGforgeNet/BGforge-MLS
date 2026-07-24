import type { HostToWebview, WebviewToHost } from "../messages";

/**
 * Thin postMessage wrapper for the animation-editor webview. Unlike the binary editor's Bridge, the
 * image protocol has no request/response correlation (no requestId), so there is nothing to track:
 * `send` fires a message up to the host, and `onMessage` lets the caller install its own listener.
 */
export class Bridge {
    private readonly post: (m: WebviewToHost) => void;

    constructor(post: (m: WebviewToHost) => void) {
        this.post = post;
    }

    send(m: WebviewToHost): void {
        this.post(m);
    }

    /** Subscribes to host-to-webview messages, unwrapping the raw MessageEvent. Returns an
     *  unsubscribe function for the caller's effect cleanup. */
    onMessage(cb: (m: HostToWebview) => void): () => void {
        const listener = (event: MessageEvent<HostToWebview>) => cb(event.data);
        window.addEventListener("message", listener);
        return () => window.removeEventListener("message", listener);
    }
}
