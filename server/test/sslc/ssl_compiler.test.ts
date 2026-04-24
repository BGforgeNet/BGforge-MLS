/**
 * Unit tests for sslc/ssl_compiler.ts - built-in SSL compiler using WASM.
 * Tests fork-based compilation with mock child processes.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import fs from "node:fs";

const mockShowWarning = vi.fn();

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        window: {
            showWarningMessage: (...args: unknown[]) => mockShowWarning(...args),
        },
    }),
}));

/** Creates a mock ChildProcess with stdout/stderr as EventEmitters */
function createMockProcess() {
    const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = vi.fn(() => {
        proc.killed = true;
        // Simulate OS behavior: killed process emits close with null code
        proc.emit("close", null);
    });
    return proc;
}

const mockFork = vi.fn();

vi.mock("child_process", () => ({
    fork: (...args: unknown[]) => mockFork(...args),
}));

import { ssl_compile, isSslcAvailable } from "../../src/sslc/ssl_compiler";

describe("ssl_compile", () => {
    const existsSyncSpy = vi.spyOn(fs, "existsSync");

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: compiler module exists
        existsSyncSpy.mockReturnValue(true);
    });

    const baseOpts = {
        cwd: "/tmp/build",
        inputFileName: "script.ssl",
        outputFileName: "script.int",
        options: "",
        headersDir: "",
        interactive: false,
    };

    describe("successful compilation", () => {
        it("resolves with returnCode 0 on success", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            proc.stdout.emit("data", Buffer.from("Compiling..."));
            proc.emit("close", 0);

            const result = await promise;
            expect(result.returnCode).toBe(0);
            expect(result.stdout).toBe("Compiling...");
            expect(result.stderr).toBe("");
        });
    });

    describe("failed compilation", () => {
        it("resolves with non-zero returnCode on failure", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            proc.stderr.emit("data", Buffer.from("Error: syntax error"));
            proc.emit("close", 1);

            const result = await promise;
            expect(result.returnCode).toBe(1);
            expect(result.stderr).toBe("Error: syntax error");
        });
    });

    describe("null exit code", () => {
        it("treats null exit code as error (returnCode 1)", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            // null exit code means the process was killed
            proc.emit("close", null);

            const result = await promise;
            expect(result.returnCode).toBe(1);
        });
    });

    describe("fork throws synchronously", () => {
        it("returns error result instead of crashing", async () => {
            mockFork.mockImplementation(() => {
                throw new Error("spawn EINVAL");
            });

            const result = await ssl_compile(baseOpts);
            expect(result.returnCode).toBe(1);
            expect(result.stderr).toBe("spawn EINVAL");
        });
    });

    describe("fork error event", () => {
        it("rejects when fork emits error event", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            // Simulate fork failure (e.g., ENOENT - module not found)
            proc.emit("error", new Error("ENOENT: no such file or directory"));
            // After error, close is also emitted with null code
            proc.emit("close", null);

            const result = await promise;
            // Should resolve (via close handler) rather than hanging forever
            expect(result.returnCode).toBe(1);
        });
    });

    describe("-I flag conflict warning", () => {
        it("strips user -I flags and warns in interactive mode", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const opts = {
                ...baseOpts,
                options: "-O2 -I/custom/path -q",
                headersDir: "/headers/dir/h_files.h",
                interactive: true,
            };

            const promise = ssl_compile(opts);
            proc.emit("close", 0);
            await promise;

            expect(mockShowWarning).toHaveBeenCalledWith(
                expect.stringContaining("-I switch is used but it will be ignored"),
            );

            // Verify -I was stripped from args and replaced with headersDir
            const forkArgs = mockFork.mock.calls[0]![1] as string[];
            const userIFlags = forkArgs.filter((s: string) => s === "-I/custom/path");
            expect(userIFlags).toHaveLength(0);

            // Should have the auto-generated -I flag from headersDir
            const autoIFlags = forkArgs.filter((s: string) => s.startsWith("-I"));
            expect(autoIFlags).toHaveLength(1);
        });

        it("does not warn when interactive is false", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const opts = {
                ...baseOpts,
                options: "-I/custom/path",
                headersDir: "/headers/dir/h_files.h",
                interactive: false,
            };

            const promise = ssl_compile(opts);
            proc.emit("close", 0);
            await promise;

            expect(mockShowWarning).not.toHaveBeenCalled();
        });
    });

    describe("command args construction", () => {
        it("appends input and output filenames", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);
            proc.emit("close", 0);
            await promise;

            const forkArgs = mockFork.mock.calls[0]![1] as string[];
            expect(forkArgs).toContain("script.ssl");
            expect(forkArgs).toContain("-o");
            expect(forkArgs).toContain("script.int");
        });

        it("includes headersDir as -I flag", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const opts = {
                ...baseOpts,
                headersDir: "/my/headers/include.h",
            };

            const promise = ssl_compile(opts);
            proc.emit("close", 0);
            await promise;

            const forkArgs = mockFork.mock.calls[0]![1] as string[];
            const iFlag = forkArgs.find((s: string) => s.startsWith("-I"));
            expect(iFlag).toBeDefined();
            expect(iFlag).toContain("headers");
        });

        it("splits and trims options string", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const opts = {
                ...baseOpts,
                options: "  -O2  -q  -p  ",
            };

            const promise = ssl_compile(opts);
            proc.emit("close", 0);
            await promise;

            const forkArgs = mockFork.mock.calls[0]![1] as string[];
            expect(forkArgs).toContain("-O2");
            expect(forkArgs).toContain("-q");
            expect(forkArgs).toContain("-p");
        });

        it("handles empty options string", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);
            proc.emit("close", 0);
            await promise;

            const forkArgs = mockFork.mock.calls[0]![1] as string[];
            // Should only have input, -o, output (no empty strings from split)
            expect(forkArgs).toContain("script.ssl");
            expect(forkArgs).not.toContain("");
        });

        it("sets correct fork options (silent, empty env, no execArgv)", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);
            proc.emit("close", 0);
            await promise;

            const forkOpts = mockFork.mock.calls[0]![2] as Record<string, unknown>;
            expect(forkOpts.silent).toBe(true);
            expect(forkOpts.execArgv).toEqual([]);
            expect(forkOpts.env).toBeUndefined();
            expect(forkOpts.cwd).toBe("/tmp/build");
        });
    });

    describe("signal cancellation", () => {
        it("kills the child process when signal is aborted", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);
            const controller = new AbortController();

            const promise = ssl_compile({ ...baseOpts, signal: controller.signal });

            controller.abort();
            const result = await promise;

            expect(proc.kill).toHaveBeenCalled();
            expect(result.returnCode).toBe(1);
        });

        it("does not kill the process when signal is not aborted", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);
            const controller = new AbortController();

            const promise = ssl_compile({ ...baseOpts, signal: controller.signal });
            proc.emit("close", 0);
            const result = await promise;

            expect(proc.kill).not.toHaveBeenCalled();
            expect(result.returnCode).toBe(0);
        });

        it("handles already-aborted signal before fork", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);
            const controller = new AbortController();
            controller.abort();

            const promise = ssl_compile({ ...baseOpts, signal: controller.signal });
            const result = await promise;

            expect(proc.kill).toHaveBeenCalled();
            expect(result.returnCode).toBe(1);
        });
    });

    describe("compiler not available", () => {
        it("returns error when compiler module is missing", async () => {
            existsSyncSpy.mockReturnValue(false);

            const result = await ssl_compile(baseOpts);

            expect(result.returnCode).toBe(1);
            expect(result.stderr).toContain("Built-in SSL compiler not available");
            expect(mockFork).not.toHaveBeenCalled();
        });

        it("isSslcAvailable returns false when module is missing", () => {
            existsSyncSpy.mockReturnValue(false);
            expect(isSslcAvailable()).toBe(false);
        });

        it("isSslcAvailable returns true when module exists", () => {
            existsSyncSpy.mockReturnValue(true);
            expect(isSslcAvailable()).toBe(true);
        });
    });

    describe("stdout/stderr collection", () => {
        it("collects multiple stdout chunks", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            proc.stdout.emit("data", Buffer.from("Line 1\n"));
            proc.stdout.emit("data", Buffer.from("Line 2\n"));
            proc.emit("close", 0);

            const result = await promise;
            expect(result.stdout).toBe("Line 1\nLine 2\n");
        });

        it("collects multiple stderr chunks", async () => {
            const proc = createMockProcess();
            mockFork.mockReturnValue(proc);

            const promise = ssl_compile(baseOpts);

            proc.stderr.emit("data", Buffer.from("Warning 1\n"));
            proc.stderr.emit("data", Buffer.from("Warning 2\n"));
            proc.emit("close", 1);

            const result = await promise;
            expect(result.stderr).toBe("Warning 1\nWarning 2\n");
        });
    });
});
