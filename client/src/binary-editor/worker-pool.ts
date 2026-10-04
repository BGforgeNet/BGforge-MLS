import { Worker } from "node:worker_threads";

/** How long a parked worker waits for the next open before it is ended. An idle worker holds tens of MB. */
const DEFAULT_IDLE_MS = 5 * 60_000;

/** The slice of `worker_threads.Worker` the pool drives; a test passes fakes. */
export interface PoolWorker {
    terminate(): Promise<number>;
    unref(): void;
    ref(): void;
}

/**
 * Keeps one warm binary-editor worker ready, so an open skips thread start and bundle load (most of a small
 * file's open time). Each document still gets a worker of its own: a crash or hang loses one document's session,
 * never every open one's. The spare is either pre-started after an open, or the worker of a document that
 * closed cleanly; it is ended after `idleMs` without an open.
 */
export class WorkerPool<W extends PoolWorker = Worker> {
    private spare: W | undefined;
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private readonly spawn: () => W;
    private readonly idleMs: number;

    constructor(spawn: () => W, idleMs = DEFAULT_IDLE_MS) {
        this.spawn = spawn;
        this.idleMs = idleMs;
    }

    /** A worker for a new document: the spare if one is parked, otherwise a fresh one. */
    acquire(): W {
        const worker = this.takeSpare() ?? this.spawn();
        worker.ref();
        return worker;
    }

    /** Start a spare if none is parked. Called after an open lands, so its startup never competes with that parse. */
    prestart(): void {
        if (this.disposed || this.spare) return;
        this.park(this.spawn());
    }

    /**
     * Hand back a document's worker. `reusable` only when its session is closed and nothing is in flight or ever
     * timed out; anything else is ended, since a worker that hung once may be hung still.
     */
    release(worker: W, reusable: boolean): void {
        if (!reusable || this.disposed || this.spare) {
            void worker.terminate();
            return;
        }
        this.park(worker);
    }

    dispose(): void {
        this.disposed = true;
        const spare = this.takeSpare();
        if (spare) void spare.terminate();
    }

    private park(worker: W): void {
        // Unref'd so an idle spare never keeps the host process alive on shutdown.
        worker.unref();
        this.spare = worker;
        this.idleTimer = setTimeout(() => {
            const idle = this.takeSpare();
            if (idle) void idle.terminate();
        }, this.idleMs);
        (this.idleTimer as { unref?: () => void }).unref?.();
    }

    private takeSpare(): W | undefined {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        const spare = this.spare;
        this.spare = undefined;
        return spare;
    }
}

/** The production pool: real threads running the built worker bundle at `script`. */
export function createWorkerPool(script: string): WorkerPool {
    return new WorkerPool(() => new Worker(script));
}
