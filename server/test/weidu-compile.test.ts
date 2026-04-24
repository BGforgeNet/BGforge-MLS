/**
 * Unit tests for weidu-compile.ts - WeiDU output parsing and compile dispatch.
 * Tests async behavior, tmp file cleanup, diagnostics, and compilation workflow.
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
const mockShowWarning = vi.fn();
const mockShowError = vi.fn();

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
        window: {
            showInformationMessage: mockShowInfo,
            showWarningMessage: mockShowWarning,
            showErrorMessage: mockShowError,
        },
    }),
}));

const mockSendParseResult = vi.fn();
vi.mock("../src/common", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/common")>();
    return {
        ...actual,
        sendParseResult: (...args: unknown[]) => mockSendParseResult(...args),
    };
});

vi.mock("../src/user-messages", () => ({
    showInfo: (...args: unknown[]) => mockShowInfo(...args),
    showWarning: (...args: unknown[]) => mockShowWarning(...args),
    showError: (...args: unknown[]) => mockShowError(...args),
}));

import { compile } from "../src/weidu-compile";
import type { WeiDUsettings } from "../src/settings";
import { normalizeUri } from "../src/core/normalized-uri";

describe("weidu-compile", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockWriteFile.mockResolvedValue(undefined);
        mockUnlink.mockResolvedValue(undefined);
    });

    const baseSettings: WeiDUsettings = {
        path: "/usr/bin/weidu",
        gamePath: "/games/bg2",
    };

    /** Helper: set up mockExecFile to invoke the callback with given results. */
    function setupExecFile(err: unknown, stdout: string, stderr = "") {
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                (lastArg as (err: unknown, stdout: string, stderr: string) => void)(err, stdout, stderr);
            }
        });
    }

    describe("compile() - extension validation", () => {
        it("rejects unsupported file extensions", async () => {
            await compile(normalizeUri("file:///test.txt"), baseSettings, true, "content");

            expect(mockExecFile).not.toHaveBeenCalled();
            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Focus a WeiDU file to parse!"));
        });

        it("rejects .d without game path", async () => {
            const noGameSettings: WeiDUsettings = { path: "/usr/bin/weidu", gamePath: "" };
            await compile(normalizeUri("file:///test.d"), noGameSettings, true, "content");

            expect(mockExecFile).not.toHaveBeenCalled();
            expect(mockShowWarning).toHaveBeenCalledWith(expect.stringContaining("can't parse D or BAF"));
        });

        it("rejects .baf without game path", async () => {
            const noGameSettings: WeiDUsettings = { path: "/usr/bin/weidu", gamePath: "" };
            await compile(normalizeUri("file:///test.baf"), noGameSettings, true, "content");

            expect(mockExecFile).not.toHaveBeenCalled();
            expect(mockShowWarning).toHaveBeenCalled();
        });

        it("allows .tp2 without game path (uses --nogame)", async () => {
            const noGameSettings: WeiDUsettings = { path: "/usr/bin/weidu", gamePath: "" };
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.tp2"), noGameSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("--nogame");
        });

        it("dispatches valid .tp2 extension", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("tp2");
        });

        it("dispatches valid .d extension with game path", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.d"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("d");
        });

        it("dispatches valid .baf extension with game path", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.baf"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("baf");
        });

        it("dispatches .tpa as tpa type", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.tpa"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("tpa");
        });

        it("dispatches .tph as tpa type", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.tph"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("tpa");
        });

        it("dispatches .tpp as tpp type", async () => {
            setupExecFile(null, "OK");
            await compile(normalizeUri("file:///test.tpp"), baseSettings, false, "content");

            expect(mockExecFile).toHaveBeenCalled();
            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("tpp");
        });
    });

    describe("compile() - command construction", () => {
        beforeEach(() => {
            setupExecFile(null, "OK");
        });

        it("includes --game flag when gamePath is set", async () => {
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("--game");
            expect(args).toContain("/games/bg2");
        });

        it("includes standard weidu flags", async () => {
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            const args = mockExecFile.mock.calls[0][1] as string[];
            expect(args).toContain("--no-exit-pause");
            expect(args).toContain("--noautoupdate");
            expect(args).toContain("--debug-assign");
            expect(args).toContain("--parse-check");
        });

        it("writes text to temp file before executing", async () => {
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "my content");

            expect(mockWriteFile).toHaveBeenCalledWith(expect.stringMatching(/\.tp2$/), "my content");
        });
    });

    describe("compile() - unique tmp filenames", () => {
        beforeEach(() => {
            setupExecFile(null, "OK");
        });

        it("uses different tmp filenames for different URIs", async () => {
            await compile(normalizeUri("file:///project/a.tp2"), baseSettings, false, "content a");
            await compile(normalizeUri("file:///project/b.tp2"), baseSettings, false, "content b");

            const pathA = mockWriteFile.mock.calls[0][0] as string;
            const pathB = mockWriteFile.mock.calls[1][0] as string;
            expect(pathA).not.toBe(pathB);
        });

        it("preserves the original file extension in tmp filename", async () => {
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            const tmpPath = mockWriteFile.mock.calls[0][0] as string;
            expect(tmpPath).toMatch(/\.tp2$/);
        });

        it("uses the same tmp filename for the same URI", async () => {
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content 1");
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content 2");

            const path1 = mockWriteFile.mock.calls[0][0] as string;
            const path2 = mockWriteFile.mock.calls[1][0] as string;
            expect(path1).toBe(path2);
        });
    });

    describe("compile() - async behavior", () => {
        it("returns a Promise that resolves after execFile callback fires", async () => {
            let capturedCallback: ((err: null, stdout: string, stderr: string) => void) | undefined;

            mockExecFile.mockImplementation((...args: unknown[]) => {
                const lastArg = args[args.length - 1];
                if (typeof lastArg === "function") {
                    capturedCallback = lastArg as (err: null, stdout: string, stderr: string) => void;
                }
            });

            let resolved = false;
            const promise = compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content").then(() => {
                resolved = true;
            });

            // Let microtasks run
            await new Promise((r) => {
                setTimeout(r, 0);
            });
            expect(resolved).toBe(false);
            expect(capturedCallback).toBeDefined();

            // Fire the callback
            capturedCallback!(null, "", "");
            await promise;
            expect(resolved).toBe(true);
        });
    });

    describe("compile() - tmp file cleanup", () => {
        it("cleans up tmp file after successful compilation", async () => {
            setupExecFile(null, "Parsing complete");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/\.tp2$/));
        });

        it("cleans up tmp file even when compilation fails", async () => {
            setupExecFile({ code: 1 }, "[test.tp2]  ERROR at line 1 column 1-10");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/\.tp2$/));
        });

        it("ignores ENOENT when cleaning up (already deleted)", async () => {
            setupExecFile(null, "OK");
            const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
            mockUnlink.mockRejectedValue(enoent);

            // Should not throw
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");
        });

        it("cleans up tmp file when writeFile fails (partial write)", async () => {
            mockWriteFile.mockRejectedValue(new Error("ENOSPC"));

            await expect(compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content")).rejects.toThrow("ENOSPC");

            expect(mockExecFile).not.toHaveBeenCalled();
            expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/\.tp2$/));
        });

        it("logs and swallows non-ENOENT cleanup errors", async () => {
            setupExecFile(null, "OK");
            const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
            mockUnlink.mockRejectedValue(eperm);

            // Should not throw — cleanup errors must not mask compiler results
            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            // Diagnostics should still have been sent despite cleanup failure
            expect(mockSendParseResult).toHaveBeenCalled();
        });
    });

    describe("compile() - diagnostics", () => {
        it("sends diagnostics on success (to clear stale errors)", async () => {
            setupExecFile(null, "Parsing complete. No errors.");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
        });

        it("sends diagnostics on error", async () => {
            setupExecFile({ code: 1 }, "[ua.tp2]  ERROR at line 30 column 1-63");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
        });

        it("parses standard error format from stdout", async () => {
            setupExecFile({ code: 1 }, "[ua.tp2]  ERROR at line 30 column 1-63");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].line).toBe(30);
        });

        it("parses PARSE ERROR variant from stdout", async () => {
            setupExecFile({ code: 1 }, "[ua.tp2]  PARSE ERROR at line 15 column 5-20");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].line).toBe(15);
        });

        it("handles multiple errors at different lines", async () => {
            const multiError = "[ua.tp2]  ERROR at line 30 column 1-63\n[ua.tp2]  ERROR at line 45 column 10-25\n";

            setupExecFile({ code: 1 }, multiError);

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(2);
        });

        it("deduplicates PARSE ERROR and ERROR at the same location", async () => {
            // WeiDU outputs both "PARSE ERROR" and "ERROR" for the same location
            const dupeOutput =
                "[tmp.tpa] PARSE ERROR at line 87 column 1-7\n" +
                "Near Text: INCLUDE\n" +
                "\tGLR parse error\n\n" +
                "[tmp.tpa]  ERROR at line 87 column 1-7\n" +
                "Near Text: INCLUDE\n";

            setupExecFile({ code: 1 }, dupeOutput);

            await compile(normalizeUri("file:///test.tpa"), baseSettings, true, "content");

            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].line).toBe(87);
        });

        it("includes detail lines from WeiDU output verbatim", async () => {
            const output =
                "[tmp.tp2]  ERROR at line 5 column 1-4\n" +
                "Near Text: something\n" +
                "\tinvalid character\n" +
                " HINT: Don't use MS Word.\n";

            setupExecFile({ code: 1 }, output);

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            const msg = mockSendParseResult.mock.calls[0][0].errors[0].message;
            // WeiDU output preserved verbatim
            expect(msg).toContain("Near Text: something");
            expect(msg).toContain("HINT: Don't use MS Word.");
        });

        it("truncates detail lines to 4 + '...'", async () => {
            const output =
                "[tmp.tpa]  ERROR at line 87 column 1-7\n" +
                "Near Text: INCLUDE\n" +
                "\tGLR parse error\n" +
                "detail line 3\n" +
                "detail line 4\n" +
                "detail line 5\n" +
                "detail line 6\n";

            setupExecFile({ code: 1 }, output);

            await compile(normalizeUri("file:///test.tpa"), baseSettings, true, "content");

            const msg = mockSendParseResult.mock.calls[0][0].errors[0].message;
            expect(msg).toContain("Near Text: INCLUDE");
            expect(msg).toContain("GLR parse error");
            expect(msg).toContain("detail line 4");
            expect(msg).not.toContain("detail line 5");
            expect(msg).toContain("...");
        });

        it("parses LEXER ERROR with degenerate column range (1-0)", async () => {
            const output =
                "[tmp.tp2] LEXER ERROR at line 66 column 1-0\n" +
                "Near Text: \uFFFD\n" +
                "\tinvalid character\n\n" +
                "[tmp.tp2]  ERROR at line 66 column 1-0\n" +
                "Near Text: \uFFFD\n";

            setupExecFile({ code: 1 }, output);

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].line).toBe(66);
            // WeiDU's verbatim output preserved, including replacement characters
            expect(parseResult.errors[0].message).toContain("Near Text: \uFFFD");
        });

        it("clamps column 0 to avoid negative LSP character offset", async () => {
            // WeiDU sometimes emits 0-based columns for tokens at line start (column 0-5).
            // The -1 adjustment must not produce negative columnStart.
            const output =
                "[tmp.tpa] PARSE ERROR at line 1 column 0-5\n" +
                "Near Text: qqqqqq\n" +
                "\tGLR parse error\n\n" +
                "[tmp.tpa]  ERROR at line 1 column 0-5\n" +
                "Near Text: qqqqqq\n" +
                "\tParsing.Parse_error\n";

            setupExecFile({ code: 1 }, output);

            await compile(normalizeUri("file:///test.tpa"), baseSettings, true, "content");

            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].columnStart).toBe(0);
            expect(parseResult.errors[0].columnEnd).toBe(5);
        });

        it("detects errors with zero exit code when parse errors exist in stdout", async () => {
            setupExecFile(null, "[test.tp2]  ERROR at line 5 column 1-10");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
            expect(mockShowError).toHaveBeenCalled();
        });
    });

    describe("compile() - fallback when output is unparseable", () => {
        it("creates fallback diagnostic with stdout when WeiDU fails but output has no error pattern", async () => {
            setupExecFile({ code: 1 }, "Some unexpected WeiDU output");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockSendParseResult).toHaveBeenCalled();
            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].message).toContain("Some unexpected WeiDU output");
        });

        it("creates fallback diagnostic with err.message when stdout is empty", async () => {
            setupExecFile({ code: 1, message: "Command failed" }, "");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            const parseResult = mockSendParseResult.mock.calls[0][0];
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].message).toContain("Command failed");
        });

        it("shows actionable message when WeiDU binary not found", async () => {
            // Node sets .code on ErrnoException (string) separately from ExecFileException .code (number)
            setupExecFile(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("WeiDU not found"));
            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("bgforge.mls.weidu.path"));
            // Only the specific ENOENT message, not the generic "Failed to parse" on top
            expect(mockShowError).toHaveBeenCalledTimes(1);
        });

        it("does not create fallback when errors were successfully parsed", async () => {
            setupExecFile({ code: 1 }, "[test.tp2]  ERROR at line 5 column 1-10");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            const parseResult = mockSendParseResult.mock.calls[0][0];
            // Only the parsed error, no fallback
            expect(parseResult.errors).toHaveLength(1);
            expect(parseResult.errors[0].line).toBe(5);
        });
    });

    describe("compile() - interactive messages", () => {
        it("shows success message in interactive mode", async () => {
            setupExecFile(null, "Parsing complete");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Successfully parsed"));
        });

        it("shows error message on failure in interactive mode", async () => {
            setupExecFile({ code: 1 }, "[ua.tp2]  ERROR at line 30 column 1-63");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, true, "content");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
        });

        it("does not show messages when not interactive", async () => {
            setupExecFile(null, "Parsing complete");

            await compile(normalizeUri("file:///test.tp2"), baseSettings, false, "content");

            expect(mockShowInfo).not.toHaveBeenCalled();
            expect(mockShowError).not.toHaveBeenCalled();
        });
    });
});
