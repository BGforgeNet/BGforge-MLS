import type { HostToWebview, WebviewToHost } from "../messages";
import { isHostMessage } from "../../../webview-utils";

/**
 * Thin postMessage wrapper for the animation-editor webview. Unlike the binary editor's Bridge, the
 * image protocol has no request/response correlation (no requestId), so there is nothing to track:
 * `send` fires a message up to the host, and `onMessage` lets the caller install its own listener.
 */
export class Bridge {
    private readonly post: (m: WebviewToHost) => void;
    private readonly subscribe: (cb: (m: HostToWebview) => void) => () => void;

    /**
     * `subscribe` is injectable because this protocol is spoken on two surfaces: the editor tab owns its
     * whole webview and reads the window's messages directly, while the gallery multiplexes this protocol
     * with its own over one channel and hands in a subscribe that unwraps only the animation half.
     */
    constructor(post: (m: WebviewToHost) => void, subscribe?: (cb: (m: HostToWebview) => void) => () => void) {
        this.post = post;
        this.subscribe = subscribe ?? windowMessages;
    }

    send(m: WebviewToHost): void {
        this.post(m);
    }

    /** Subscribes to host-to-webview messages. Returns an unsubscribe function for the caller's
     *  effect cleanup. */
    onMessage(cb: (m: HostToWebview) => void): () => void {
        return this.subscribe(cb);
    }
}

/** The default: every host message the webview's own window receives, unwrapped from the raw MessageEvent. */
function windowMessages(cb: (m: HostToWebview) => void): () => void {
    const listener = (event: MessageEvent<HostToWebview>) => {
        if (isHostMessage(event)) cb(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
}
