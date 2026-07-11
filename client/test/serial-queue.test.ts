import { describe, expect, it } from "vitest";
import { SerialQueue } from "../src/dialog-editor/serial-queue";

/** A manually-resolvable promise, so ordering is asserted deterministically without sleeps. */
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("SerialQueue", () => {
    it("runs tasks strictly one at a time - a later task starts only after the earlier one settles", async () => {
        // The dialog editor applies each webview edit as an async WorkspaceEdit (parse round-trip, then splice).
        // Two edits fired back-to-back must not run concurrently, or their WorkspaceEdits race the same document
        // and VS Code rejects the second with "applySplices: overlapping ops".
        const order: string[] = [];
        const gate = deferred();
        const q = new SerialQueue();

        q.enqueue(async () => {
            order.push("1:start");
            await gate.promise;
            order.push("1:end");
        });
        q.enqueue(async () => {
            order.push("2:start");
        });

        // Task 1 has begun (up to its await); task 2 must not have started while task 1 is in flight.
        await Promise.resolve();
        expect(order).toEqual(["1:start"]);

        gate.resolve();
        await q.drain();
        expect(order).toEqual(["1:start", "1:end", "2:start"]);
    });

    it("isolates a rejecting task: the error goes to onError, the queue keeps running, nothing escapes unhandled", async () => {
        const order: string[] = [];
        const errors: unknown[] = [];
        const q = new SerialQueue();

        q.enqueue(
            async () => {
                throw new Error("boom");
            },
            (e) => errors.push(e),
        );
        q.enqueue(async () => {
            order.push("after");
        });

        await q.drain();
        expect(order).toEqual(["after"]);
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe("boom");
    });
});
