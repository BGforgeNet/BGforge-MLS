/**
 * Unit tests for the server's side of the TSSL compile worker.
 *
 * A live drive only ever shows the happy path: one worker, started once, answering. What is worth
 * pinning here is what happens when it does not answer - a worker that dies must not leave a compile
 * waiting forever, and must not poison every compile after it - and that a refusal survives the trip:
 * it crosses as plain data and has to arrive as the positioned error the caller reports from.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranspileError } from "../../../transpilers/common/transpile-error";

// Declared inside `vi.hoisted` because `vi.mock` is lifted above the file's own declarations, so a
// class defined at top level does not exist yet when the factory below runs.
const { FakeWorker } = vi.hoisted(() => {
    /** Stands in for a real worker thread: records what was posted, and lets a test fire its events. */
    class Fake {
        static instances: Fake[] = [];
        readonly posted: { id: number; text?: string; intPath?: string | null; sslPath?: string | null }[] = [];
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

        postMessage(message: { id: number; text?: string; intPath?: string | null; sslPath?: string | null }): void {
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

import { conlog } from "../../src/logger";
import { compileOnWorker, prewarmTsslCompileWorker, stopTsslCompileWorker } from "../../src/tssl/compile-worker-client";

const REQUEST = {
    text: "function start() {}\n",
    filepath: "/project/test.tssl",
    intPath: "/project/test.int",
    sslPath: null,
    level: 1 as const,
    shortCircuit: false,
};

/** The worker the client is currently talking to. */
const current = () => FakeWorker.instances.at(-1)!;

describe("TSSL compile worker client", () => {
    beforeEach(async () => {
        await stopTsslCompileWorker();
        FakeWorker.instances.length = 0;
    });

    it("resolves once the worker reports the files were written", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        current().emit("message", { id: current().posted[0]!.id });

        await expect(pending).resolves.toBe(true);
    });

    // A newer compile of the same document displaces this one. That is not a failure - rejecting would
    // put an error on a document whose newer compile is about to report for itself.
    it("resolves false when the caller's signal aborts, without rejecting", async () => {
        const controller = new AbortController();
        const pending = compileOnWorker({ ...REQUEST }, controller.signal);
        controller.abort();

        await expect(pending).resolves.toBe(false);
    });

    it("resolves false immediately when handed an already-aborted signal", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(compileOnWorker({ ...REQUEST }, controller.signal)).resolves.toBe(false);
    });

    // A worker that DIES rejects through its exit handler; one that simply never answers has no event
    // to hang the rejection on, so the compile would wait forever without this.
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
            expect(() => current().emit("message", { id: current().posted[0]!.id })).not.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });

    // A structured clone drops class identity, so the location the caller reports from has to be
    // rebuilt on this side rather than forwarded.
    it("rebuilds a refusal as the positioned error it was thrown as", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        current().emit("message", {
            id: current().posted[0]!.id,
            failure: { message: "unknown identifier 'nope'", file: "/project/test.tssl", line: 3 },
        });

        await expect(pending).rejects.toBeInstanceOf(TranspileError);
        await expect(pending).rejects.toMatchObject({
            message: "unknown identifier 'nope'",
            location: { file: "/project/test.tssl", line: 3 },
        });
    });

    it("keeps one worker across compiles rather than starting one per request", async () => {
        // Starting a worker means building the ts-morph project again, which costs more than every
        // compile after the first one does.
        const first = compileOnWorker({ ...REQUEST });
        const second = compileOnWorker({ ...REQUEST });
        const posted = [...current().posted];
        for (const message of posted) current().emit("message", { id: message.id });
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
        current().emit("message", { id: current().posted[0]!.id });

        await expect(retry).resolves.toBe(true);
        expect(FakeWorker.instances).toHaveLength(2);
    });

    // The worker is otherwise started by the first compile, which then pays ts-morph module eval and
    // lib binding inside the author's request - measured at 249 ms and 132 ms of a 698 ms first compile.
    // The prewarm moves both onto a thread nobody is waiting on.
    describe("prewarm", () => {
        it("compiles a throwaway entry that pulls no module and writes no file", () => {
            prewarmTsslCompileWorker();

            expect(FakeWorker.instances).toHaveLength(1);
            expect(current().posted).toHaveLength(1);
            const [request] = current().posted;
            // Both null, so the prewarm leaves nothing behind on disk; no import, because the point is
            // the lib set, and the author's own dependencies cannot be resolved from here anyway.
            expect(request!.intPath).toBeNull();
            expect(request!.sslPath).toBeNull();
            expect(request!.text).not.toContain("import");
        });

        it("does not start a second worker or repeat the compile when called again", () => {
            prewarmTsslCompileWorker();
            prewarmTsslCompileWorker();

            expect(FakeWorker.instances).toHaveLength(1);
            expect(current().posted).toHaveLength(1);
        });

        // Nobody asked for this compile, so a refusal is not the author's to see - but it is not
        // swallowed silently either, or a worker that cannot start looks like a slow first compile.
        it("logs a refusal of its own compile rather than surfacing it", async () => {
            prewarmTsslCompileWorker();
            current().emit("message", {
                id: current().posted[0]!.id,
                failure: { message: "prewarm went wrong" },
            });
            await vi.waitFor(() => expect(conlog).toHaveBeenCalledWith(expect.stringMatching(/prewarm went wrong/)));
        });
    });

    it("fails an in-flight compile on shutdown rather than blocking it", async () => {
        const pending = compileOnWorker({ ...REQUEST });
        const worker = current();

        await stopTsslCompileWorker();

        await expect(pending).rejects.toThrow(/shut down/);
        expect(worker.terminated).toBe(true);
    });
});
