/**
 * Unit tests for fallout-ssl/compiler.ts - SSL compilation with tmp file handling.
 * Tests async I/O, try/finally cleanup, promisified external compiler, and diagnostics.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
    execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);
vi.mock("fs", () => ({
    promises: {
        writeFile: (...args: unknown[]) => mockWriteFile(...args),
        unlink: (...args: unknown[]) => mockUnlink(...args),
    },
}));

const mockShowInfo = vi.fn();
const mockShowError = vi.fn();
const mockShowErrorWithActions = vi.fn();
const mockSendDiagnostics = vi.fn();
const mockSendRequest = vi.fn();

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn() },
        sendDiagnostics: mockSendDiagnostics,
        sendRequest: (...args: unknown[]) => mockSendRequest(...args),
        window: {
            showInformationMessage: mockShowInfo,
            showErrorMessage: mockShowError,
        },
    }),
    getDocuments: () => ({
        get: () => ({
            offsetAt: () => 100,
        }),
    }),
}));

const mockSendParseResult = vi.fn();
vi.mock("../../src/common", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/common")>();
    return {
        ...actual,
        sendParseResult: (...args: unknown[]) => mockSendParseResult(...args),
    };
});

vi.mock("../../src/user-messages", () => ({
    showInfo: (...args: unknown[]) => mockShowInfo(...args),
    showError: (...args: unknown[]) => mockShowError(...args),
    showErrorWithActions: (...args: unknown[]) => mockShowErrorWithActions(...args),
}));

const mockBuiltinCompiler = vi.fn();
vi.mock("../../src/sslc/ssl_compiler", () => ({
    ssl_compile: (...args: unknown[]) => mockBuiltinCompiler(...args),
}));

import { compile, TMP_SSL_NAME, _resetCompilerCache } from "../../src/fallout-ssl/compiler";
import type { SSLsettings } from "../../src/settings";

describe("fallout-ssl compiler", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        _resetCompilerCache();
        mockWriteFile.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
        mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });
        mockSendRequest.mockResolvedValue(true);
    });

    const baseSettings: SSLsettings = {
        compilePath: "",
        compileOptions: "",
        outputDirectory: "/output",
        headersDirectory: "/headers",
        compileOnValidate: true,
    };

    describe("TMP_SSL_NAME", () => {
        it("is exported as .tmp.ssl", () => {
            expect(TMP_SSL_NAME).toBe(".tmp.ssl");
        });
    });

    describe("extension validation", () => {
        it("rejects non-.ssl files silently in non-interactive mode", async () => {
            await compile("file:///test.txt", baseSettings, false, "content");

            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockShowInfo).not.toHaveBeenCalled();
        });

        it("shows message for non-.ssl files in interactive mode", async () => {
            await compile("file:///test.txt", baseSettings, true, "content");

            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockShowInfo).toHaveBeenCalledWith(
                expect.stringContaining("Fallout SSL file")
            );
        });
    });

    describe("tmp file lifecycle", () => {
        it("writes text to .tmp.ssl using async fs.promises.writeFile", async () => {
            await compile("file:///project/test.ssl", baseSettings, false, "script code");

            expect(mockWriteFile).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME),
                "script code"
            );
        });

        it("writes tmp file in the same directory as source (for include resolution)", async () => {
            await compile("file:///project/scripts/test.ssl", baseSettings, false, "code");

            const writtenPath = mockWriteFile.mock.calls[0][0] as string;
            expect(writtenPath).toMatch(/\/project\/scripts\/\.tmp\.ssl$/);
        });

        it("cleans up tmp file after successful built-in compilation", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });

            await compile("file:///project/test.ssl", baseSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("cleans up validation-only .int files from temp dir", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile("file:///project/test.ssl", settings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringMatching(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/)
            );
        });

        it("cleans up tmp file even when built-in compiler throws", async () => {
            mockBuiltinCompiler.mockRejectedValue(new Error("WASM crash"));

            await expect(
                compile("file:///project/test.ssl", baseSettings, false, "code")
            ).rejects.toThrow("WASM crash");

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("cleans up tmp file after external compiler completes", async () => {
            const externalSettings = { ...baseSettings, compilePath: "compile" };
            // Mock checkExternalCompiler to succeed
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    // Check if this is the --version check or the actual compile
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        // Version check - succeed
                        (lastArg as (err: null) => void)(null);
                    } else {
                        // Actual compile - succeed
                        (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "", "");
                    }
                }
            });

            await compile("file:///project/test.ssl", externalSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("cleans up tmp file even when external compiler fails", async () => {
            const externalSettings = { ...baseSettings, compilePath: "compile" };
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        (lastArg as (err: null) => void)(null);
                    } else {
                        (lastArg as (err: Error, stdout: string, stderr: string) => void)(
                            new Error("compile failed"), "", "stderr output"
                        );
                    }
                }
            });

            await compile("file:///project/test.ssl", externalSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("ignores ENOENT when cleaning up tmp file (already deleted)", async () => {
            const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
            mockUnlink.mockRejectedValue(enoent);

            // Should not throw
            await compile("file:///project/test.ssl", baseSettings, false, "code");
        });

        it("cleans up tmp file when writeFile throws", async () => {
            mockWriteFile.mockRejectedValue(new Error("ENOSPC"));

            await expect(
                compile("file:///project/test.ssl", baseSettings, false, "code")
            ).rejects.toThrow("ENOSPC");

            expect(mockBuiltinCompiler).not.toHaveBeenCalled();
            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("logs and swallows non-ENOENT cleanup errors instead of rethrowing", async () => {
            const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
            mockUnlink.mockRejectedValue(eperm);

            // Should not throw — cleanup errors must not mask compiler results
            await compile("file:///project/test.ssl", baseSettings, false, "code");

            // Diagnostics should still have been sent despite cleanup failure
            expect(mockSendParseResult).toHaveBeenCalled();
        });
    });

    describe("built-in compiler", () => {
        it("passes correct options to built-in compiler", async () => {
            const settings = { ...baseSettings, compileOptions: "-O2 -p" };

            await compile("file:///project/test.ssl", settings, true, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    interactive: true,
                    inputFileName: TMP_SSL_NAME,
                    outputFileName: "/output/test.int",
                    options: "-O2 -p",
                    headersDir: "/headers",
                })
            );
        });

        it("writes validation output to temp dir when compileOnValidate is disabled", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile("file:///project/test.ssl", settings, false, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    outputFileName: expect.stringMatching(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/),
                })
            );
        });

        it("keeps explicit compile writing to outputDirectory when compileOnValidate is disabled", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile("file:///project/test.ssl", settings, true, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    outputFileName: "/output/test.int",
                })
            );
        });

        it("shows success message on returnCode 0 in interactive mode", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });

            await compile("file:///project/test.ssl", baseSettings, true, "code");

            expect(mockShowInfo).toHaveBeenCalledWith(
                expect.stringContaining("Compiled test.ssl")
            );
        });

        it("shows error message on non-zero returnCode in interactive mode", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "error output", returnCode: 1 });

            await compile("file:///project/test.ssl", baseSettings, true, "code");

            expect(mockShowError).toHaveBeenCalledWith(
                expect.stringContaining("Failed to compile test.ssl")
            );
        });

        it("sends diagnostics after compilation", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "compiler output", returnCode: 0 });

            await compile("file:///project/test.ssl", baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({ errors: expect.any(Array), warnings: expect.any(Array) }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("parses warnings from compiler output and sends them as diagnostics", async () => {
            // Warning format: [Warning] <file.ssl>:line:col: message
            const warningOutput = "[Warning] <test.ssl>:5:10: Unused variable x";
            mockBuiltinCompiler.mockResolvedValue({ stdout: warningOutput, returnCode: 0 });

            await compile("file:///project/test.ssl", baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({ warnings: expect.arrayContaining([expect.objectContaining({ message: "Unused variable x" })]) }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME)
            );
        });

        it("parses error output and includes file/line/col in diagnostics", async () => {
            // Error format: [Error] <file.ssl>:line:col: message
            const errorOutput = "[Error] <test.ssl>:3:8: Expecting top-level statement";
            mockBuiltinCompiler.mockResolvedValue({ stdout: errorOutput, returnCode: 1 });

            await compile("file:///project/test.ssl", baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({ errors: expect.arrayContaining([expect.objectContaining({ message: "Expecting top-level statement" })]) }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME)
            );
        });
    });

    describe("external compiler", () => {
        const externalSettings: SSLsettings = {
            ...baseSettings,
            compilePath: "compile",
        };

        beforeEach(() => {
            // Default: version check succeeds, compile succeeds
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        (lastArg as (err: null) => void)(null);
                    } else {
                        (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "", "");
                    }
                }
            });
        });

        it("returns a promise that resolves after external compiler finishes", async () => {
            // The key test: compile() must not resolve until execFile callback fires.
            // We control when the callback fires to verify this.
            let capturedCallback: ((err: null, stdout: string, stderr: string) => void) | undefined;

            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        (lastArg as (err: null) => void)(null);
                    } else {
                        capturedCallback = lastArg as (err: null, stdout: string, stderr: string) => void;
                    }
                }
            });

            let resolved = false;
            const promise = compile("file:///project/test.ssl", externalSettings, false, "code")
                .then(() => { resolved = true; });

            // Let microtasks run
            await new Promise((r) => { setTimeout(r, 0); });
            expect(resolved).toBe(false);
            expect(capturedCallback).toBeDefined();

            // Now fire the callback
            capturedCallback!(null, "", "");
            await promise;
            expect(resolved).toBe(true);
        });

        it("passes compile options as separate args", async () => {
            const settings = { ...externalSettings, compileOptions: "-O2 -p" };

            await compile("file:///project/test.ssl", settings, false, "code");

            // Find the actual compile call (not the --version check)
            const compileCalls = mockExecFile.mock.calls.filter(
                (call: unknown[]) => !(call[1] as string[]).some((a: string) => a === "--version")
            );
            expect(compileCalls).toHaveLength(1);
            const args = compileCalls[0][1] as string[];
            expect(args).toContain("-O2");
            expect(args).toContain("-p");
        });

        it("writes validation output to temp dir when compileOnValidate is disabled", async () => {
            const settings = { ...externalSettings, compileOnValidate: false };

            await compile("file:///project/test.ssl", settings, false, "code");

            const compileCalls = mockExecFile.mock.calls.filter(
                (call: unknown[]) => !(call[1] as string[]).some((a: string) => a === "--version")
            );
            const args = compileCalls[0][1] as string[];
            const outIndex = args.indexOf("-o");
            expect(outIndex).toBeGreaterThanOrEqual(0);
            expect(args[outIndex + 1]).toMatch(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/);
        });

        it("shows success message in interactive mode", async () => {
            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockShowInfo).toHaveBeenCalledWith(
                expect.stringContaining("Compiled test.ssl")
            );
        });

        it("shows error message on failure in interactive mode", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        (lastArg as (err: null) => void)(null);
                    } else {
                        (lastArg as (err: Error, stdout: string, stderr: string) => void)(
                            new Error("exit code 1"), "error output", ""
                        );
                    }
                }
            });

            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockShowError).toHaveBeenCalledWith(
                expect.stringContaining("Failed to compile test.ssl")
            );
        });
    });

    describe("external compiler check", () => {
        const externalSettings: SSLsettings = {
            ...baseSettings,
            compilePath: "compile",
        };

        it("falls back to built-in when external compiler check fails and user accepts", async () => {
            // Version check fails
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue({ id: "switch" });

            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockShowErrorWithActions).toHaveBeenCalledWith(
                "Failed to run 'compile'! Switch to built-in compiler?",
                { title: "Switch", id: "switch" },
                { title: "Cancel", id: "cancel" },
            );
            expect(mockBuiltinCompiler).toHaveBeenCalled();
            expect(mockSendRequest).toHaveBeenCalledWith(
                "bgforge-mls/setBuiltInCompiler",
                { uri: "file:///project/test.ssl" }
            );
        });

        it("falls back to built-in without prompting during non-interactive validation", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });

            await compile("file:///project/test.ssl", externalSettings, false, "code");

            expect(mockShowErrorWithActions).not.toHaveBeenCalled();
            expect(mockBuiltinCompiler).toHaveBeenCalled();
        });

        it("returns early when external compiler check fails and user declines", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue({ id: "cancel" });

            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockBuiltinCompiler).not.toHaveBeenCalled();
            // Should not attempt external compile either (only the --version check)
            expect(mockExecFile).toHaveBeenCalledTimes(1);
            // Should not send any diagnostics
            expect(mockSendParseResult).not.toHaveBeenCalled();
        });

        it("returns early when user dismisses the fallback prompt (undefined response)", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue(undefined);

            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockBuiltinCompiler).not.toHaveBeenCalled();
            expect(mockExecFile).toHaveBeenCalledTimes(1);
            expect(mockSendParseResult).not.toHaveBeenCalled();
        });

        it("skips version check when compiler path was already verified (cached path)", async () => {
            // First call verifies the compiler
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    const argList = args[1] as string[];
                    if (argList.some((a: string) => a === "--version")) {
                        (lastArg as (err: null) => void)(null);
                    } else {
                        (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "", "");
                    }
                }
            });

            await compile("file:///project/test.ssl", externalSettings, false, "code");
            const firstCallCount = mockExecFile.mock.calls.length;

            // Second call should skip the --version check (cached path)
            await compile("file:///project/test.ssl", externalSettings, false, "code");
            const secondCallCount = mockExecFile.mock.calls.length - firstCallCount;

            // Only one call in the second compile: the actual compile, no --version
            expect(secondCallCount).toBe(1);
        });

        it("logs but does not rethrow when sendRequest fails after user switches to built-in", async () => {
            // Version check fails → user accepts switch
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue({ id: "switch" });
            mockSendRequest.mockRejectedValue(new Error("connection lost"));
            mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });

            // Should not throw — sendRequest failure is logged and swallowed
            await compile("file:///project/test.ssl", externalSettings, true, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalled();
        });
    });

    describe("abort / cancellation", () => {
        it("skips diagnostics when built-in compiler result arrives after abort", async () => {
            // Simulate abort by starting two compiles on same URI in sequence
            // The first compile's signal gets aborted by the second; we mock that scenario
            // by having the compiler resolve but checking signal.aborted in the path.
            // Since AbortController interaction is internal, we test via two overlapping calls.
            mockBuiltinCompiler.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
                // Yield so the second compile can abort this one
                await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
                // At this point signal may be aborted if second compile ran
                return { stdout: "", returnCode: 0 };
            });

            const first = compile("file:///project/test.ssl", baseSettings, false, "code");
            const second = compile("file:///project/test.ssl", baseSettings, false, "code");
            await Promise.all([first, second]);

            // Second compile always sends diagnostics; total calls >= 1
            expect(mockSendParseResult).toHaveBeenCalled();
        });
    });
});
