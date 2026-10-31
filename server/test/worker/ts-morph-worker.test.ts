/**
 * Tests for worker/ts-morph-worker.ts - the shared ts-morph worker's serial message loop.
 *
 * A request that fails outside its handler's own refusal path must still be answered under its id, and must
 * not stall the requests queued behind it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPostMessage = vi.fn();
const listeners: Array<(request: unknown) => void> = [];
vi.mock("node:worker_threads", () => ({
    parentPort: {
        on: (_event: string, listener: (request: unknown) => void) => listeners.push(listener),
        postMessage: (...args: unknown[]) => mockPostMessage(...args),
    },
}));

const mockHandleCompile = vi.fn();
vi.mock("../../src/tssl/compile-worker", () => ({
    handleCompile: (...args: unknown[]) => mockHandleCompile(...args),
}));

const mockRunTranspile = vi.fn();
vi.mock("../../src/transpile/transpile-worker", () => ({
    runTranspile: (...args: unknown[]) => mockRunTranspile(...args),
}));

const compileRequest = (id: number) => ({
    id,
    kind: "compile",
    text: "",
    filepath: "/project/a.tssl",
    intPath: null,
    sslPath: null,
    level: 0,
    shortCircuit: false,
});

async function loadWorker(): Promise<(request: unknown) => void> {
    vi.resetModules();
    listeners.length = 0;
    await import("../../src/worker/ts-morph-worker");
    const listener = listeners[0];
    if (!listener) throw new Error("ts-morph-worker registered no message listener");
    return listener;
}

describe("ts-morph worker message loop", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("answers a request whose handler throws with a failure under its id, and keeps serving", async () => {
        mockHandleCompile.mockRejectedValueOnce(new Error("project state corrupted")).mockResolvedValueOnce({ id: 2 });
        const onMessage = await loadWorker();

        onMessage(compileRequest(1));
        onMessage(compileRequest(2));

        await vi.waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(2));
        expect(mockPostMessage.mock.calls).toEqual([
            [{ id: 1, failure: { message: "Internal error: project state corrupted" } }],
            [{ id: 2 }],
        ]);
    });

    it("answers with a failure when the response cannot be posted, and keeps serving", async () => {
        mockHandleCompile.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
        mockPostMessage.mockImplementationOnce(() => {
            throw new Error("could not be cloned");
        });
        const onMessage = await loadWorker();

        onMessage(compileRequest(1));
        onMessage(compileRequest(2));

        await vi.waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(3));
        expect(mockPostMessage.mock.calls).toEqual([
            [{ id: 1 }],
            [{ id: 1, failure: { message: "Internal error: could not be cloned" } }],
            [{ id: 2 }],
        ]);
    });
});
