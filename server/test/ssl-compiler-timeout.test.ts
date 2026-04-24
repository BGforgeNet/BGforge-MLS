/**
 * Unit tests for ssl_compiler.ts timeout behaviour.
 * The compiler module forks a child process; a wall-clock timeout must kill
 * the child and resolve with an error result when the process hangs.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock child_process.fork so we control the child lifecycle.
const mockFork = vi.fn();
vi.mock("child_process", () => ({
    fork: (...args: unknown[]) => mockFork(...args),
}));

// Mock fs.existsSync so isSslcAvailable() returns true.
vi.mock("node:fs", () => ({
    default: {
        existsSync: () => true,
    },
    existsSync: () => true,
}));

// Mock common.ts logging (conlog) and user-messages to avoid LSP connection setup.
vi.mock("../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock("../src/user-messages", () => ({
    showWarning: vi.fn(),
}));

import { ssl_compile } from "../src/sslc/ssl_compiler";

/** Build a fake child-process emitter that never emits "close" on its own. */
function makeSuspendedChild(): EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
} {
    const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn(() => {
        child.killed = true;
        // Simulate the OS delivering a "close" after kill, as Node does.
        setImmediate(() => child.emit("close", null));
    });
    return child;
}

describe("ssl_compile timeout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("resolves with returnCode 1 and timeout message when process hangs past timeoutMs", async () => {
        const child = makeSuspendedChild();
        mockFork.mockReturnValue(child);

        const result = await ssl_compile({
            cwd: "/tmp",
            inputFileName: "test.ssl",
            outputFileName: "test.int",
            options: "",
            headersDir: "",
            interactive: false,
            timeoutMs: 50,
        });

        expect(result.returnCode).toBe(1);
        expect(result.stderr).toMatch(/timed out/i);
        expect(child.kill).toHaveBeenCalled();
    }, 2000 /* wall-clock cap on the test itself */);

    it("resolves normally when process finishes before timeout", async () => {
        const child = makeSuspendedChild();
        mockFork.mockReturnValue(child);

        const compilePromise = ssl_compile({
            cwd: "/tmp",
            inputFileName: "test.ssl",
            outputFileName: "test.int",
            options: "",
            headersDir: "",
            interactive: false,
            timeoutMs: 5000,
        });

        // Emit success immediately.
        child.emit("close", 0);

        const result = await compilePromise;
        expect(result.returnCode).toBe(0);
        expect(child.kill).not.toHaveBeenCalled();
    });
});
