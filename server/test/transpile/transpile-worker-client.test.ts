/**
 * Unit tests for the server's side of the transpile worker.
 *
 * The thread is replaced, so what is pinned here is the client's own behaviour rather than the
 * transpilers': that a refusal crosses as plain data and arrives as the positioned `TranspileError`
 * the caller reports from, that a worker which dies leaves nothing waiting forever and does not poison
 * the requests after it, and that the pre-warm actually stands a worker up before anything is asked of
 * it - which is the whole reason the ~400 ms of thread and ts-morph setup is not inside the author's
 * first save.
 *
 * `transpile-worker.test.ts` covers the work itself, against the in-process transpilers as oracle.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranspileError } from "../../../transpilers/common/transpile-error";

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

import {
    parseOnWorker,
    prewarmTranspileWorker,
    stopTranspileWorker,
    transpileOnWorker,
} from "../../src/transpile/transpile-worker-client";

const REQUEST = { kind: "td" as const, filepath: "/project/dialog.td", text: "export default begin();\n" };
const RESULT = { output: "// generated\n", warnings: [], sourceMap: [] };

/** The worker the client is currently talking to. */
const current = () => FakeWorker.instances.at(-1)!;

describe("transpile worker client", () => {
    beforeEach(async () => {
        await stopTranspileWorker();
        FakeWorker.instances.length = 0;
    });

    it("resolves with what the worker transpiled", async () => {
        const pending = transpileOnWorker({ ...REQUEST });
        current().emit("message", { id: current().posted[0]!.id, result: RESULT });

        await expect(pending).resolves.toEqual(RESULT);
    });

    it("resolves a dialog parse with the model the worker returned", async () => {
        const parsed = { states: [], nodes: [] };
        const pending = parseOnWorker({ ...REQUEST, kind: "parse-td" });
        current().emit("message", { id: current().posted[0]!.id, parsed });

        await expect(pending).resolves.toEqual(parsed);
    });

    // The refusal crosses as plain data, so this is where its position would be lost if the client
    // forwarded the message instead of rebuilding the error the caller narrows on.
    it("rebuilds a refusal as a positioned TranspileError", async () => {
        const pending = transpileOnWorker({ ...REQUEST });
        current().emit("message", {
            id: current().posted[0]!.id,
            failure: {
                message: "alterTrans() names a state that was never begun",
                file: "/project/dialog.td",
                line: 3,
            },
        });

        // Captured rather than asserted inside a `catch`: an expect in a catch never runs once the
        // code stops throwing, so it would go quiet exactly when this regressed.
        const refusal = await pending.catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(TranspileError);
        expect(refusal).toMatchObject({ location: { file: "/project/dialog.td", line: 3 } });
    });

    it("fails everything in flight when the worker dies, rather than leaving it hanging", async () => {
        const pending = transpileOnWorker({ ...REQUEST });
        current().emit("error", new Error("worker exploded"));

        await expect(pending).rejects.toThrow(/worker exploded/);
    });

    // A dead worker must not poison the requests after it: the reference is dropped, so the next one
    // starts a fresh thread rather than posting into the corpse.
    it("starts a fresh worker after one dies", async () => {
        const first = transpileOnWorker({ ...REQUEST });
        const died = current();
        died.emit("error", new Error("worker exploded"));
        await expect(first).rejects.toThrow();

        const second = transpileOnWorker({ ...REQUEST });
        expect(current()).not.toBe(died);
        current().emit("message", { id: current().posted[0]!.id, result: RESULT });

        await expect(second).resolves.toEqual(RESULT);
    });

    it("reports an unexpected exit to whatever was waiting", async () => {
        const pending = transpileOnWorker({ ...REQUEST });
        current().emit("exit", 1);

        await expect(pending).rejects.toThrow(/stopped unexpectedly \(exit 1\)/);
    });

    // The point of the pre-warm: a worker exists before any request, so the setup cost is not inside
    // the first transpile. Without it the first request is what constructs the thread.
    it("stands a worker up before anything is asked of it, and unrefs it", () => {
        expect(FakeWorker.instances).toHaveLength(0);

        prewarmTranspileWorker();

        expect(FakeWorker.instances).toHaveLength(1);
        expect(current().unrefCalled).toBe(true);
        expect(current().posted).toEqual([]);
    });

    it("reuses the pre-warmed worker rather than starting a second", async () => {
        prewarmTranspileWorker();
        const warmed = current();

        const pending = transpileOnWorker({ ...REQUEST });

        expect(FakeWorker.instances).toHaveLength(1);
        expect(current()).toBe(warmed);
        current().emit("message", { id: current().posted[0]!.id, result: RESULT });
        await expect(pending).resolves.toEqual(RESULT);
    });

    it("terminates the worker on shutdown so a transpile cannot hold it open", async () => {
        prewarmTranspileWorker();
        const warmed = current();

        await stopTranspileWorker();

        expect(warmed.terminated).toBe(true);
    });
});
