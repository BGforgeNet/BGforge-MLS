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

export class WorkerBridge {
    private nextId = 1;
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
        port.onError?.((err) => this.rejectAll(err));
    }

    send(request: Request): Promise<Response> {
        const id = this.nextId++;
        return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
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

/** Adapts a real worker_threads Worker to the Port the bridge needs. */
export function workerPort(worker: Worker): Port {
    return {
        postMessage: (msg) => worker.postMessage(msg),
        onMessage: (cb) => {
            worker.on("message", cb);
        },
        onError: (cb) => {
            worker.on("error", (err) => cb(err instanceof Error ? err : new Error(String(err))));
            // A non-zero exit code means the worker died unexpectedly (crash/OOM); code 0 is a clean
            // shutdown (e.g. our own terminate()) and needs no rejection beyond what dispose() already did.
            worker.on("exit", (code) => {
                if (code !== 0) cb(new Error(`Binary editor worker exited unexpectedly (code ${code})`));
            });
        },
        dispose: () => {
            void worker.terminate();
        },
    };
}
