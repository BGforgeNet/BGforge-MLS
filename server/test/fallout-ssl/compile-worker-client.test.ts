/**
 * Unit tests for the server's side of the SSL compile worker.
 *
 * A live drive only ever shows the happy path: one worker, started once, answering. What is worth
 * pinning here is what happens when it does not answer - a worker that dies must not leave a compile
 * waiting forever, and must not poison every compile after it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Declared inside `vi.hoisted` because `vi.mock` is lifted above the file's own declarations, so a
// class defined at top level does not exist yet when the factory below runs.
const { FakeWorker } = vi.hoisted(() => {
    /** Stands in for a real worker thread: records what was posted, and lets a test fire its events. */
    class Fake {
        static instances: Fake[] = [];
        readonly posted: { id: number }[] = [];
        terminated = false;
        unrefCalled = false;
        private readonly listeners = new Map<string, ((arg: unknown) => void)[]>();

        constructor() {
            Fake.instances.push(this);
        }

        on(event: string, listener: (arg: unknown) => void): this {
            this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
            return this;
        }

        emit(event: string, arg?: unknown): void {
            for (const listener of this.listeners.get(event) ?? []) listener(arg);
        }

        postMessage(message: { id: number }): void {
            this.posted.push(message);
        }

        unref(): void {
            this.unrefCalled = true;
        }

        terminate(): Promise<number> {
            this.terminated = true;
            return Promise.resolve(0);
        }
    }
    return { FakeWorker: Fake };
});

vi.mock("worker_threads", () => ({ Worker: FakeWorker }));
vi.mock("../../src/logger", () => ({ conlog: vi.fn() }));

import { compileOnWorker, stopCompileWorker } from "../../src/fallout-ssl/compile-worker-client";

const REQUEST = {
    text: "procedure start begin end\n",
    filepath: "/project/test.ssl",
    dstPath: "/out/test.int",
    includeDirs: [] as string[],
    defines: {},
    level: 1 as const,
    shortCircuit: false,
    noWarnings: false,
};

/** The worker the client is currently talking to. */
const current = () => FakeWorker.instances.at(-1)!;

describe("compile worker client", () => {
    beforeEach(async () => {
        await stopCompileWorker();
        FakeWorker.instances.length = 0;
    });

    it("answers a compile with what the worker reported", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        current().emit("message", {
            id: current().posted[0]!.id,
            errors: [{ line: 3, message: "boom" }],
            // Carried separately from the errors because a warning accompanies a compile that SUCCEEDED
            // just as readily as one that failed.
            warnings: [{ line: 9, message: "unknown escape" }],
        });

        await expect(pending).resolves.toEqual({
            errors: [{ line: 3, message: "boom" }],
            warnings: [{ line: 9, message: "unknown escape" }],
        });
    });

    it("keeps one worker across compiles rather than starting one per request", async () => {
        // Starting a worker means loading the grammar again, which costs more than most compiles.
        const first = compileOnWorker({ ...REQUEST });
        const second = compileOnWorker({ ...REQUEST });
        const posted = [...current().posted];
        for (const message of posted) current().emit("message", { id: message.id, errors: [], warnings: [] });
        await Promise.all([first, second]);

        expect(FakeWorker.instances).toHaveLength(1);
        // Replies are matched by id, so two compiles in flight cannot be told apart by arrival order.
        expect(posted[0]!.id).not.toBe(posted[1]!.id);
    });

    it("does not hold the server process open while it sits idle", () => {
        void compileOnWorker({ ...REQUEST }).catch(() => {});

        expect(current().unrefCalled).toBe(true);
    });

    it("fails the compiles in flight when the worker dies instead of leaving them hanging", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        current().emit("error", new Error("worker exploded"));

        await expect(pending).rejects.toThrow(/worker exploded/);
    });

    it("starts a fresh worker after one dies", async () => {
        const dead = compileOnWorker({ ...REQUEST });
        current().emit("error", new Error("worker exploded"));
        await expect(dead).rejects.toThrow();

        const retry = compileOnWorker({ ...REQUEST });
        current().emit("message", { id: current().posted[0]!.id, errors: [], warnings: [] });

        await expect(retry).resolves.toEqual({ errors: [], warnings: [] });
        expect(FakeWorker.instances).toHaveLength(2);
    });

    // A worker that DIES rejects through its exit handler; one WEDGED inside synchronous JS emits
    // nothing at all - no message, no error, no exit - so without a bound the compile never settles and
    // the document's diagnostics stay pinned with nothing reported anywhere. This runs on validate, as
    // the author types.
    it("rejects when the worker never answers", async () => {
        vi.useFakeTimers();
        try {
            const pending = compileOnWorker({ ...REQUEST });
            const settled = expect(pending).rejects.toThrow(/did not answer/);
            await vi.advanceTimersByTimeAsync(60_000);
            await settled;
        } finally {
            vi.useRealTimers();
        }
    });

    // The late answer arrives after nobody is waiting; it must not throw or resurrect the request.
    it("ignores an answer that arrives after the request timed out", async () => {
        vi.useFakeTimers();
        try {
            const pending = compileOnWorker({ ...REQUEST });
            const settled = expect(pending).rejects.toThrow(/did not answer/);
            await vi.advanceTimersByTimeAsync(60_000);
            await settled;
            expect(() =>
                current().emit("message", { id: current().posted[0]!.id, errors: [], warnings: [] }),
            ).not.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });

    it("fails an in-flight compile on shutdown rather than blocking it", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        const worker = current();

        await stopCompileWorker();

        await expect(pending).rejects.toThrow(/shut down/);
        expect(worker.terminated).toBe(true);
    });
});
