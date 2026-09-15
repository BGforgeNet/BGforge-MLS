import type { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { galleryWorkerPort } from "../src/gallery/worker-port";

/**
 * A stand-in carrying only the surface the port uses, and reporting exits the way `node:worker_threads` does -
 * which is the whole point of these two cases: `terminate()` exits with code 1, the same code a crash reports.
 *
 * The cast is the seam: the port takes a `Worker` but touches four of its members, and a real one would need a
 * spawned thread to exercise a code path that is entirely about which exits are reported.
 */
function fakeWorker(): { worker: Worker; exit: (code: number) => void } {
    const handlers = new Map<string, ((arg: unknown) => void)[]>();
    const worker = {
        on(event: string, cb: (arg: unknown) => void): void {
            handlers.set(event, [...(handlers.get(event) ?? []), cb]);
        },
        postMessage(): void {},
        terminate: async (): Promise<number> => 1,
    } as unknown as Worker;
    return {
        worker,
        exit: (code) => {
            for (const cb of handlers.get("exit") ?? []) cb(code);
        },
    };
}

describe("galleryWorkerPort", () => {
    it("reports an exit nobody asked for", () => {
        const { worker, exit } = fakeWorker();
        const errors: string[] = [];
        galleryWorkerPort(worker).onError((err) => errors.push(err.message));

        exit(1);

        expect(errors).toEqual([expect.stringContaining("code 1")]);
    });

    it("stays silent when the exit is the one disposal asked for", () => {
        // `terminate()` exits with code 1, so the code alone cannot tell teardown from a crash. Closing a
        // gallery panel would otherwise raise an error toast every single time.
        const { worker, exit } = fakeWorker();
        const errors: string[] = [];
        const port = galleryWorkerPort(worker);
        port.onError((err) => errors.push(err.message));

        port.dispose();
        exit(1);

        expect(errors).toEqual([]);
    });
});
