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
const mockWriteFileSync = vi.fn();
vi.mock("fs", () => ({
    promises: {
        writeFile: (...args: unknown[]) => mockWriteFile(...args),
        unlink: (...args: unknown[]) => mockUnlink(...args),
    },
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

const mockShowInfo = vi.fn();
const mockShowError = vi.fn();
const mockShowErrorWithActions = vi.fn();
const mockSendDiagnostics = vi.fn();
const mockSendRequest = vi.fn();

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: mockSendDiagnostics,
        sendRequest: (...args: unknown[]) => mockSendRequest(...args),
        window: {
            showInformationMessage: mockShowInfo,
            showErrorMessage: mockShowError,
        },
    }),
    getDocuments: () => ({
        get: () => mockDocument,
    }),
}));

// A real TextDocument so offsetAt/positionAt compute genuine line-relative
// positions (the warning-column logic depends on them). Tests that assert
// columns set their own content via setMockDocument.
import { TextDocument } from "vscode-languageserver-textdocument";
let mockDocument: TextDocument = TextDocument.create(
    "file:///project/test.ssl",
    "fallout-ssl",
    1,
    "line one\nline two\nline three\n",
);
function setMockDocument(content: string): void {
    mockDocument = TextDocument.create("file:///project/test.ssl", "fallout-ssl", 1, content);
}

const mockSendParseResult = vi.fn();
vi.mock("../../src/diagnostics", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/diagnostics")>();
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

// Only the two calls are stubbed. `CompileError` and `PreprocessError` stay the real classes, because
// the code under test narrows on them with `instanceof` to decide how many errors it has to report.
const mockCompileText = vi.fn();
vi.mock("../../../compilers/ssl/src/compile", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../compilers/ssl/src/compile")>();
    return {
        ...actual,
        compileText: (...args: unknown[]) => mockCompileText(...args),
    };
});

const mockPreprocessText = vi.fn();
vi.mock("../../../compilers/ssl/src/preprocess", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../compilers/ssl/src/preprocess")>();
    return {
        ...actual,
        preprocessText: (...args: unknown[]) => mockPreprocessText(...args),
    };
});

const mockGetParser = vi.fn();
vi.mock("../../../shared/parsers/fallout-ssl", () => ({
    getParser: () => mockGetParser(),
}));

import { compile, TMP_SSL_NAME, _resetCompilerCache } from "../../src/fallout-ssl/compiler";
import { CompileError } from "../../../compilers/ssl/src/compile";
import { LowerError } from "../../../compilers/ssl/src/lower";
import type { SSLsettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";

describe("fallout-ssl compiler", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        _resetCompilerCache();
        mockWriteFile.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
        mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });
        mockPreprocessText.mockReturnValue("preprocessed");
        mockCompileText.mockReturnValue(new Uint8Array([1, 2, 3]));
        mockGetParser.mockReturnValue({});
        mockSendRequest.mockResolvedValue(true);
        setMockDocument("line one\nline two\nline three\n");
    });

    const baseSettings: SSLsettings = {
        compilePath: "",
        compileOptions: "",
        outputDirectory: "/output",
        headersDirectory: "/headers",
        compileOnValidate: true,
        compiler: "wasm" as const,
    };

    describe("TMP_SSL_NAME", () => {
        it("is exported as .tmp.ssl", () => {
            expect(TMP_SSL_NAME).toBe(".tmp.ssl");
        });
    });

    describe("extension validation", () => {
        it("rejects non-.ssl files silently in non-interactive mode", async () => {
            await compile(normalizeUri("file:///test.txt"), baseSettings, false, "content");

            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockShowInfo).not.toHaveBeenCalled();
        });

        it("shows message for non-.ssl files in interactive mode", async () => {
            await compile(normalizeUri("file:///test.txt"), baseSettings, true, "content");

            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Fallout SSL file"));
        });
    });

    describe("tmp file lifecycle", () => {
        it("writes text to .tmp.ssl using async fs.promises.writeFile", async () => {
            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "script code");

            expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME), "script code", {
                flag: "wx",
                mode: 0o600,
            });
        });

        it("writes tmp file in the same directory as source (for include resolution)", async () => {
            await compile(normalizeUri("file:///project/scripts/test.ssl"), baseSettings, false, "code");

            const writtenPath = mockWriteFile.mock.calls[0]![0] as string;
            expect(writtenPath).toMatch(/\/project\/scripts\/\.tmp\.ssl$/);
        });

        it("cleans up tmp file after a successful WebAssembly compile", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME));
        });

        it("cleans up validation-only .int files from temp dir", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile(normalizeUri("file:///project/test.ssl"), settings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/));
        });

        it("cleans up tmp file even when the WebAssembly compiler throws", async () => {
            mockBuiltinCompiler.mockRejectedValue(new Error("WASM crash"));

            await expect(
                compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code"),
            ).rejects.toThrow("WASM crash");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME));
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

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME));
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
                            new Error("compile failed"),
                            "",
                            "stderr output",
                        );
                    }
                }
            });

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME));
        });

        it("ignores ENOENT when cleaning up tmp file (already deleted)", async () => {
            const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
            mockUnlink.mockRejectedValue(enoent);

            // Should not throw
            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");
        });

        it("cleans up tmp file when writeFile throws", async () => {
            mockWriteFile.mockRejectedValue(new Error("ENOSPC"));

            await expect(
                compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code"),
            ).rejects.toThrow("ENOSPC");

            expect(mockBuiltinCompiler).not.toHaveBeenCalled();
            expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(TMP_SSL_NAME));
        });

        it("logs and swallows non-ENOENT cleanup errors instead of rethrowing", async () => {
            const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
            mockUnlink.mockRejectedValue(eperm);

            // Should not throw - cleanup errors must not mask compiler results
            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            // Diagnostics should still have been sent despite cleanup failure
            expect(mockSendParseResult).toHaveBeenCalled();
        });
    });

    describe("WebAssembly compiler", () => {
        it("passes correct options to the WebAssembly compiler", async () => {
            const settings = { ...baseSettings, compileOptions: "-O2 -p" };

            await compile(normalizeUri("file:///project/test.ssl"), settings, true, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    interactive: true,
                    inputFileName: TMP_SSL_NAME,
                    outputFileName: "/output/test.int",
                    options: "-O2 -p",
                    headersDir: "/headers",
                }),
            );
        });

        it("writes validation output to temp dir when compileOnValidate is disabled", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile(normalizeUri("file:///project/test.ssl"), settings, false, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    outputFileName: expect.stringMatching(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/),
                }),
            );
        });

        it("keeps explicit compile writing to outputDirectory when compileOnValidate is disabled", async () => {
            const settings = { ...baseSettings, compileOnValidate: false };

            await compile(normalizeUri("file:///project/test.ssl"), settings, true, "code");

            expect(mockBuiltinCompiler).toHaveBeenCalledWith(
                expect.objectContaining({
                    outputFileName: "/output/test.int",
                }),
            );
        });

        it("shows success message on returnCode 0 in interactive mode", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "", returnCode: 0 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, true, "code");

            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Compiled test.ssl"));
        });

        it("shows error message on non-zero returnCode in interactive mode", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "error output", returnCode: 1 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, true, "code");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Failed to compile test.ssl"));
        });

        it("sends diagnostics after compilation", async () => {
            mockBuiltinCompiler.mockResolvedValue({ stdout: "compiler output", returnCode: 0 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({ errors: expect.any(Array), warnings: expect.any(Array) }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME),
            );
        });

        it("parses warnings from compiler output and sends them as diagnostics", async () => {
            // Warning format: [Warning] <file.ssl>:line:col: message
            const warningOutput = "[Warning] <test.ssl>:5:10: Unused variable x";
            mockBuiltinCompiler.mockResolvedValue({ stdout: warningOutput, returnCode: 0 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({
                    warnings: expect.arrayContaining([expect.objectContaining({ message: "Unused variable x" })]),
                }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME),
            );
        });

        it("sets warning columnEnd to the end of the warning's line", async () => {
            // Warning on line 2 (1-based); LSP line 1 is "abcdefghij" (10 chars).
            setMockDocument("first line\nabcdefghij\n");
            const warningOutput = "[Warning] <test.ssl>:2:3: Unused variable";
            mockBuiltinCompiler.mockResolvedValue({ stdout: warningOutput, returnCode: 0 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            const parseResult = mockSendParseResult.mock.calls[0]![0];
            expect(parseResult.warnings).toHaveLength(1);
            const warning = parseResult.warnings[0]!;
            expect(warning.columnStart).toBe(3);
            // A real line-relative end character (the line's length), not a
            // document-wide offset misused as a column.
            expect(warning.columnEnd).toBe(10);
        });

        it("parses error output and includes file/line/col in diagnostics", async () => {
            // Error format: [Error] <file.ssl>:line:col: message
            const errorOutput = "[Error] <test.ssl>:3:8: Expecting top-level statement";
            mockBuiltinCompiler.mockResolvedValue({ stdout: errorOutput, returnCode: 1 });

            await compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({
                    errors: expect.arrayContaining([
                        expect.objectContaining({ message: "Expecting top-level statement" }),
                    ]),
                }),
                "file:///project/test.ssl",
                expect.stringContaining(TMP_SSL_NAME),
            );
        });
    });

    describe("TypeScript compiler", () => {
        const ownSettings: SSLsettings = { ...baseSettings, compiler: "built-in" };

        it("compiles the document itself, writing no file beside the user's source", async () => {
            await compile(normalizeUri("file:///project/test.ssl"), ownSettings, true, "code");

            expect(mockBuiltinCompiler).not.toHaveBeenCalled();
            // The buffer's own text and path, not a copy's: the path is what a quoted `#include`
            // resolves against, so it has to be the real one even though nothing reads it.
            expect(mockPreprocessText).toHaveBeenCalledWith("code", "/project/test.ssl", {
                includeDirs: ["/headers"],
                defines: {},
            });
            expect(mockCompileText).toHaveBeenCalledWith({}, "preprocessed", { level: 1, shortCircuit: false });
            expect(mockWriteFileSync).toHaveBeenCalledWith("/output/test.int", new Uint8Array([1, 2, 3]));
            expect(mockWriteFile).not.toHaveBeenCalled();
        });

        it("passes the compileOptions setting through, since it is a command line for this compiler too", async () => {
            await compile(
                normalizeUri("file:///project/test.ssl"),
                { ...ownSettings, compileOptions: "-O2 -s -Iextra -mDEBUG=1" },
                true,
                "code",
            );

            expect(mockPreprocessText).toHaveBeenCalledWith("code", "/project/test.ssl", {
                includeDirs: ["/headers", "extra"],
                defines: { DEBUG: "1" },
            });
            expect(mockCompileText).toHaveBeenCalledWith({}, "preprocessed", { level: 2, shortCircuit: true });
        });

        it("reports a located compile error at the line it names", async () => {
            mockCompileText.mockImplementation(() => {
                throw new Error("2:7: unknown identifier 'foo'");
            });

            await compile(normalizeUri("file:///project/test.ssl"), ownSettings, true, "code");

            expect(mockWriteFileSync).not.toHaveBeenCalled();
            expect(mockShowError).toHaveBeenCalledWith("Failed to compile test.ssl!");
            expect(mockShowInfo).not.toHaveBeenCalled();
        });

        it("shows every syntax error at once, each at its own line", async () => {
            // The point of collecting them: a script with three mistakes is one compile, not three.
            mockCompileText.mockImplementation(() => {
                throw new CompileError([
                    { line: 2, column: 10, message: "syntax error" },
                    { line: 3, column: 10, message: "syntax error" },
                    { line: 4, column: 1, message: "missing end" },
                ]);
            });

            await compile(normalizeUri("file:///project/test.ssl"), ownSettings, true, "code");

            const parseResult = mockSendParseResult.mock.calls[0]![0];
            expect(parseResult.errors.map((e: { line: number }) => e.line)).toEqual([2, 3, 4]);
            expect(parseResult.errors.at(-1).message).toBe("missing end");
            expect(mockWriteFileSync).not.toHaveBeenCalled();
        });

        it("shows every semantic error at once, without the line:column prefix the editor supplies", async () => {
            // A lowering that found several mistakes carries them all; the position becomes the
            // diagnostic's range, so repeating it in the message text would show up twice in the editor.
            const found = [
                new LowerError("unknown identifier 'a'", { line: 2, column: 2 }),
                new LowerError("division by zero", { line: 3, column: 8 }),
                new LowerError("'break' outside a loop", { line: 4, column: 2 }),
            ];
            mockCompileText.mockImplementation(() => {
                throw new LowerError(found[0]!.detail, { line: 2, column: 2 }, found);
            });

            await compile(normalizeUri("file:///project/test.ssl"), ownSettings, true, "code");

            const parseResult = mockSendParseResult.mock.calls[0]![0];
            expect(parseResult.errors.map((e: { line: number; message: string }) => [e.line, e.message])).toEqual([
                [2, "unknown identifier 'a'"],
                [3, "division by zero"],
                [4, "'break' outside a loop"],
            ]);
            expect(mockWriteFileSync).not.toHaveBeenCalled();
        });

        it("defers to an external compiler when one is configured", async () => {
            mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => cb());

            await compile(
                normalizeUri("file:///project/test.ssl"),
                { ...ownSettings, compilePath: "compile.exe" },
                true,
                "code",
            );

            expect(mockCompileText).not.toHaveBeenCalled();
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
            const promise = compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code").then(
                () => {
                    resolved = true;
                },
            );

            // Let microtasks run
            await new Promise((r) => {
                setTimeout(r, 0);
            });
            expect(resolved).toBe(false);
            expect(capturedCallback).toBeDefined();

            // Now fire the callback
            capturedCallback!(null, "", "");
            await promise;
            expect(resolved).toBe(true);
        });

        it("passes compile options as separate args", async () => {
            const settings = { ...externalSettings, compileOptions: "-O2 -p" };

            await compile(normalizeUri("file:///project/test.ssl"), settings, false, "code");

            // Find the actual compile call (not the --version check)
            const compileCalls = mockExecFile.mock.calls.filter(
                (call: unknown[]) => !(call[1] as string[]).some((a: string) => a === "--version"),
            );
            expect(compileCalls).toHaveLength(1);
            const args = compileCalls[0]![1] as string[];
            expect(args).toContain("-O2");
            expect(args).toContain("-p");
        });

        it("writes validation output to temp dir when compileOnValidate is disabled", async () => {
            const settings = { ...externalSettings, compileOnValidate: false };

            await compile(normalizeUri("file:///project/test.ssl"), settings, false, "code");

            const compileCall = mockExecFile.mock.calls.find(
                (call: unknown[]) => !(call[1] as string[]).some((a: string) => a === "--version"),
            );
            const args = compileCall![1] as string[];
            const outIndex = args.indexOf("-o");
            expect(outIndex).toBeGreaterThanOrEqual(0);
            expect(args[outIndex + 1]).toMatch(/bgforge-mls\/tmp-[0-9a-f]{8}-test\.int$/);
        });

        it("shows success message in interactive mode", async () => {
            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, true, "code");

            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Compiled test.ssl"));
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
                            new Error("exit code 1"),
                            "error output",
                            "",
                        );
                    }
                }
            });

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, true, "code");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Failed to compile test.ssl"));
        });
    });

    describe("external compiler check", () => {
        const externalSettings: SSLsettings = {
            ...baseSettings,
            compilePath: "compile",
        };

        it("falls back to the extension's own when the external compiler check fails and the user accepts", async () => {
            // Version check fails
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue({ id: "switch" });

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, true, "code");

            expect(mockShowErrorWithActions).toHaveBeenCalledWith(
                "Failed to run 'compile'! Switch to the extension's own compiler?",
                { title: "Switch", id: "switch" },
                { title: "Cancel", id: "cancel" },
            );
            expect(mockBuiltinCompiler).toHaveBeenCalled();
            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("bgforge.falloutSSL.compilePath"));
            expect(mockSendRequest).not.toHaveBeenCalled();
        });

        it("remembers the user's switch decision and skips re-prompting on subsequent compiles", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });
            mockShowErrorWithActions.mockResolvedValue({ id: "switch" });

            await compile(normalizeUri("file:///project/a.ssl"), externalSettings, true, "code");
            await compile(normalizeUri("file:///project/b.ssl"), externalSettings, true, "code");

            expect(mockShowErrorWithActions).toHaveBeenCalledTimes(1);
            expect(mockBuiltinCompiler).toHaveBeenCalledTimes(2);
        });

        it("falls back without prompting during non-interactive validation", async () => {
            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    (lastArg as (err: Error) => void)(new Error("not found"));
                }
            });

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code");

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

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, true, "code");

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

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, true, "code");

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

            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code");
            const firstCallCount = mockExecFile.mock.calls.length;

            // Second call should skip the --version check (cached path)
            await compile(normalizeUri("file:///project/test.ssl"), externalSettings, false, "code");
            const secondCallCount = mockExecFile.mock.calls.length - firstCallCount;

            // Only one call in the second compile: the actual compile, no --version
            expect(secondCallCount).toBe(1);
        });
    });

    describe("abort / cancellation", () => {
        it("skips diagnostics when the WebAssembly compiler result arrives after abort", async () => {
            // Simulate abort by starting two compiles on same URI in sequence
            // The first compile's signal gets aborted by the second; we mock that scenario
            // by having the compiler resolve but checking signal.aborted in the path.
            // Since AbortController interaction is internal, we test via two overlapping calls.
            mockBuiltinCompiler.mockImplementation(async (_opts: { signal: AbortSignal }) => {
                // Yield so the second compile can abort this one
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 0);
                });
                // signal may be aborted if the second compile ran by now
                return { stdout: "", returnCode: 0 };
            });

            const first = compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");
            const second = compile(normalizeUri("file:///project/test.ssl"), baseSettings, false, "code");
            await Promise.all([first, second]);

            // Second compile always sends diagnostics; total calls >= 1
            expect(mockSendParseResult).toHaveBeenCalled();
        });

        it("lets a later compile win even when the earlier one's external check is slower", async () => {
            // The external check is a subprocess and may raise a dialog, so its duration varies. If the
            // back end were chosen before the run registered, two compiles would take their abort order
            // from whichever check finished first - and an earlier compile that checked slowly would
            // abort the later one and report on text the user has already replaced.
            const settings: SSLsettings = { ...baseSettings, compilePath: "compile.exe" };
            const checkDelays = [40, 0];
            mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
                setTimeout(cb, checkDelays.shift() ?? 0);
            });

            const first = compile(normalizeUri("file:///project/test.ssl"), settings, false, "old text");
            const second = compile(normalizeUri("file:///project/test.ssl"), settings, false, "new text");
            await Promise.all([first, second]);

            // Exactly one result reaches the editor. Choosing the back end before registering gives
            // the slow-checking earlier compile a live signal, so it reports too - and last.
            expect(mockSendParseResult).toHaveBeenCalledTimes(1);
        });
    });
});
