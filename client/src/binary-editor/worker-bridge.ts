import type { Request, Response } from "@bgforge/binary-editor";
import type { WorkerRequest, WorkerResponse } from "./worker-core";

/** Minimal transport the bridge needs - satisfied by a worker MessagePort or a test fake. */
export interface Port {
    postMessage(msg: WorkerRequest): void;
    onMessage(cb: (msg: WorkerResponse) => void): void;
    dispose(): void;
}

export class WorkerBridge {
    private nextId = 1;
    private readonly pending = new Map<number, (r: Response) => void>();
    private readonly port: Port;

    constructor(port: Port) {
        this.port = port;
        port.onMessage((msg) => {
            const resolve = this.pending.get(msg.id);
            if (resolve) {
                this.pending.delete(msg.id);
                resolve(msg.response);
            }
        });
    }

    send(request: Request): Promise<Response> {
        const id = this.nextId++;
        return new Promise<Response>((resolve) => {
            this.pending.set(id, resolve);
            this.port.postMessage({ id, request });
        });
    }

    // Deferred hardening: no timeout/reject path in this slice - the worker handler always
    // replies (including {type:"error"} on a throw). Add a timeout guard when needed.
    dispose(): void {
        this.pending.clear();
        this.port.dispose();
    }
}
