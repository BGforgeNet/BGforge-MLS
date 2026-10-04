import type { Worker } from "node:worker_threads";
import type { Request, Response } from "@bgforge/binary-editor";
import type { WorkerRequest, WorkerResponse } from "./worker-core";

/** Minimal transport the bridge needs - satisfied by a worker MessagePort or a test fake. */
export interface Port {
    postMessage(msg: WorkerRequest): void;
    onMessage(cb: (msg: WorkerResponse) => void): void;
    /**
     * Register a handler for the transport's fatal channel - a worker crash, OOM, or unexpected
     * exit. Optional so lightweight in-process fakes need not implement it; the real `workerPort`
     * wires it to `worker.on("error"|"exit")`. When it fires, the bridge rejects every pending send.
     */
    onError?(cb: (err: Error) => void): void;
    /** Stop delivering to this bridge. Detaches only: the transport may outlive the bridge (a recycled worker). */
    dispose(): void;
}

/** Default per-request reply deadline. A worker crash, OOM, infinite parse loop, or terminate()
 *  mid-flight otherwise leaves the awaiting promise pending forever (e.g. SAVE via getBytes); this
 *  bounds the wait and turns a silent hang into an actionable rejection. */
const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
    resolve: (r: Response) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Request ids are unique across bridges, not per bridge: a recycled worker may still answer its previous bridge's
 *  last request after a new bridge took it over, and that reply must not match a request of the new one. */
let nextRequestId = 1;

export class WorkerBridge {
    /** Cleared for good by a timeout or a transport failure: the worker may be wedged, so it is never reused. */
    private sound = true;
    private readonly pending = new Map<number, Pending>();
    private readonly port: Port;
    private readonly timeoutMs: number;

    constructor(port: Port, options: { timeoutMs?: number } = {}) {
        this.port = port;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        port.onMessage((msg) => {
            const entry = this.pending.get(msg.id);
            if (entry) {
                this.pending.delete(msg.id);
                clearTimeout(entry.timer);
                entry.resolve(msg.response);
            }
        });
        // A fatal transport event (crash/exit) can never produce a per-id reply, so reject everything
        // that is still waiting rather than let those promises hang.
        port.onError?.((err) => {
            this.sound = false;
            this.rejectAll(err);
        });
    }

    /** Whether the worker behind this bridge can serve another document: nothing in flight, nothing ever lost. */
    get reusable(): boolean {
        return this.sound && this.pending.size === 0;
    }

    send(request: Request): Promise<Response> {
        const id = nextRequestId++;
        return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
                    this.sound = false;
                    reject(
                        new Error(
                            `Binary editor worker did not respond within ${this.timeoutMs}ms (request: ${request.type})`,
                        ),
                    );
                }
            }, this.timeoutMs);
            // Don't let a pending timer keep the host process alive on shutdown.
            (timer as { unref?: () => void }).unref?.();
            this.pending.set(id, { resolve, reject, timer });
            this.port.postMessage({ id, request });
        });
    }

    private rejectAll(err: Error): void {
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(err);
        }
        this.pending.clear();
    }

    dispose(): void {
        // Reject anything still in flight so an awaiting caller (e.g. a save) sees an error rather
        // than a forever-pending promise when the document/editor is torn down mid-request.
        this.rejectAll(new Error("Binary editor worker was disposed before replying"));
        this.port.dispose();
    }
}

/** Adapts a real worker_threads Worker to the Port the bridge needs. Ending the worker is its owner's job (the
 *  pool), not the port's: `dispose` only detaches, so the worker can serve a later document. */
export function workerPort(worker: Worker): Port {
    const detach: (() => void)[] = [];
    return {
        postMessage: (msg) => worker.postMessage(msg),
        onMessage: (cb) => {
            worker.on("message", cb);
            detach.push(() => worker.off("message", cb));
        },
        onError: (cb) => {
            const onError = (err: unknown): void => cb(err instanceof Error ? err : new Error(String(err)));
            // A non-zero exit code means the worker died unexpectedly (crash/OOM); code 0 is a clean
            // shutdown (e.g. our own terminate()) and needs no rejection beyond what dispose() already did.
            const onExit = (code: number): void => {
                if (code !== 0) cb(new Error(`Binary editor worker exited unexpectedly (code ${code})`));
            };
            worker.on("error", onError);
            worker.on("exit", onExit);
            detach.push(
                () => worker.off("error", onError),
                () => worker.off("exit", onExit),
            );
        },
        dispose: () => {
            for (const off of detach.splice(0)) off();
        },
    };
}
