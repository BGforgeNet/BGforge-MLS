/**
 * Tests for fallout-ssl/compile-worker.ts - the worker thread's message loop.
 *
 * A request the worker cannot run must still be answered under its id, so the server's side fails it at
 * once instead of waiting out its hang timeout with nothing reported.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPostMessage = vi.fn();
const listeners: Array<(request: unknown) => void> = [];
vi.mock("worker_threads", () => ({
    parentPort: {
        on: (_event: string, listener: (request: unknown) => void) => listeners.push(listener),
        postMessage: (...args: unknown[]) => mockPostMessage(...args),
    },
}));

const mockInitParser = vi.fn();
const mockGetParser = vi.fn();
vi.mock("@bgforge/shared/parsers/fallout-ssl", () => ({
    initParser: () => mockInitParser(),
    getParser: () => mockGetParser(),
}));

const mockCompileSource = vi.fn();
vi.mock("@bgforge/ssl", () => ({
    compileSource: (...args: unknown[]) => mockCompileSource(...args),
}));

const request = {
    id: 7,
    text: "procedure start begin end",
    filepath: "/project/test.ssl",
    dstPath: "/project/test.int",
    includeDirs: [],
    defines: {},
    level: 0,
    shortCircuit: false,
    noWarnings: false,
};

const failureFor = (message: string) => ({
    id: 7,
    errors: [{ uri: "file:///project/test.ssl", line: 1, columnStart: 0, columnEnd: 0, message }],
    warnings: [],
});

async function loadWorker(): Promise<(request: unknown) => void> {
    vi.resetModules();
    listeners.length = 0;
    await import("../../src/fallout-ssl/compile-worker");
    const listener = listeners[0];
    if (!listener) throw new Error("compile-worker registered no message listener");
    return listener;
}

describe("fallout-ssl compile worker", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("answers with an error under the request's id when the grammar fails to load", async () => {
        mockInitParser.mockRejectedValue(new Error("tree-sitter-ssl.wasm not found"));
        const onMessage = await loadWorker();

        onMessage(request);

        await vi.waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(1));
        expect(mockPostMessage).toHaveBeenCalledWith(
            failureFor("The SSL compiler failed to run: tree-sitter-ssl.wasm not found"),
        );
    });

    it("answers with an error under the request's id when the compile throws", async () => {
        mockInitParser.mockResolvedValue(undefined);
        mockGetParser.mockReturnValue({});
        mockCompileSource.mockImplementation(() => {
            throw new Error("internal compiler fault");
        });
        const onMessage = await loadWorker();

        onMessage(request);

        await vi.waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(1));
        expect(mockPostMessage).toHaveBeenCalledWith(
            failureFor("The SSL compiler failed to run: internal compiler fault"),
        );
    });
});
