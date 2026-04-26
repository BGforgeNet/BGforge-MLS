/**
 * Unit tests for common.ts utility functions.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSendDiagnostics = vi.fn();
const mockExecFile = vi.fn();

vi.mock("child_process", () => ({
    execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock lsp-connection to provide a controllable connection
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: mockSendDiagnostics,
    }),
}));

import {
    symbolAtPosition,
    sendParseResult,
    isSubpath,
    isSubpathFullyResolved,
    tryRealpathSync,
    expandHome,
    parseCommandPath,
    needsShell,
    errorMessage,
    addFallbackDiagnostic,
    runProcess,
    type ParseResult,
} from "../src/common";

describe("symbolAtPosition", () => {
    it("returns word under cursor", () => {
        const text = "hello world";
        const result = symbolAtPosition(text, { line: 0, character: 6 });
        expect(result).toBe("world");
    });

    it("returns word at start of line", () => {
        const text = "hello world";
        const result = symbolAtPosition(text, { line: 0, character: 0 });
        expect(result).toBe("hello");
    });

    it("returns word at end of line", () => {
        const text = "hello world";
        const result = symbolAtPosition(text, { line: 0, character: 10 });
        expect(result).toBe("world");
    });

    it("handles multiline text", () => {
        const text = "first line\nsecond line";
        const result = symbolAtPosition(text, { line: 1, character: 7 });
        expect(result).toBe("line");
    });

    it("returns empty string for empty line", () => {
        const text = "";
        const result = symbolAtPosition(text, { line: 0, character: 0 });
        expect(result).toBe("");
    });

    it("returns empty string for out of bounds line", () => {
        const text = "hello";
        const result = symbolAtPosition(text, { line: 5, character: 0 });
        expect(result).toBe("");
    });

    it("handles function call syntax", () => {
        const text = "NOption(154,Node003,004";
        const result = symbolAtPosition(text, { line: 0, character: 3 });
        expect(result).toBe("NOption");
    });

    it("returns tra reference for pure numeric in context", () => {
        const text = "NOption(154,Node003,004";
        const result = symbolAtPosition(text, { line: 0, character: 9 });
        expect(result).toBe("NOption(154");
    });

    it("returns tra(100) when cursor on tra part of $tra(100)", () => {
        const text = "const x = $tra(100);";
        // Position 12 is on 'r' in 'tra' — \b matches between $ and t
        const result = symbolAtPosition(text, { line: 0, character: 12 });
        expect(result).toBe("tra(100)");
    });

    it("returns msg reference for number inside nested call", () => {
        const text = "display_msg(mstr(101));";
        // Position 17-19 is on the digits of 101
        const result = symbolAtPosition(text, { line: 0, character: 18 });
        expect(result).toBe("mstr(101");
    });

    it("returns msg reference for first floater_rand() argument", () => {
        const text = "floater_rand(300, 307);";
        const result = symbolAtPosition(text, { line: 0, character: 14 });
        expect(result).toBe("floater_rand(300");
    });

    it("returns msg reference for second floater_rand() argument", () => {
        const text = "floater_rand(300, 307);";
        const result = symbolAtPosition(text, { line: 0, character: 19 });
        expect(result).toBe("floater_rand(307");
    });

    it("returns tra(100) when cursor on digits of $tra(100)", () => {
        const text = "const x = $tra(100);";
        // Position 15-17 is on the digits
        const result = symbolAtPosition(text, { line: 0, character: 16 });
        expect(result).toBe("tra(100)");
    });

    it("returns full tra(123) when cursor on number (TD)", () => {
        const text = "say(tra(405));";
        // tra(405) starts at index 4, digits at index 8
        const result = symbolAtPosition(text, { line: 0, character: 9 });
        expect(result).toBe("tra(405)");
    });

    it("returns full tra(123) when cursor on 'tra' (TD)", () => {
        const text = "say(tra(405));";
        // cursor on 'r' in 'tra', index 5
        const result = symbolAtPosition(text, { line: 0, character: 5 });
        expect(result).toBe("tra(405)");
    });

    it("returns full tra(123) when cursor on opening paren (TD)", () => {
        const text = "say(tra(405));";
        // cursor on '(' after tra, index 7
        const result = symbolAtPosition(text, { line: 0, character: 7 });
        expect(result).toBe("tra(405)");
    });

    it("returns full tra(123) when cursor on closing paren (TD)", () => {
        const text = "say(tra(405));";
        // cursor on ')' of tra(405), index 11
        const result = symbolAtPosition(text, { line: 0, character: 11 });
        expect(result).toBe("tra(405)");
    });

    it("does not match tra inside other words like extra(100)", () => {
        const text = "extra(100);";
        // cursor on digits
        const result = symbolAtPosition(text, { line: 0, character: 6 });
        expect(result).toBe("extra(100");
    });

    it("returns tra(123) at start of line (TD)", () => {
        const text = "tra(50)";
        const result = symbolAtPosition(text, { line: 0, character: 0 });
        expect(result).toBe("tra(50)");
    });
});

describe("sendParseResult", () => {
    beforeEach(() => {
        mockSendDiagnostics.mockClear();
    });

    it("sends multiple errors for the same URI", () => {
        const parseResult: ParseResult = {
            errors: [
                { uri: "file:///a.tp2", line: 1, columnStart: 0, columnEnd: 10, message: "error 1" },
                { uri: "file:///a.tp2", line: 5, columnStart: 0, columnEnd: 20, message: "error 2" },
            ],
            warnings: [],
        };
        sendParseResult(parseResult, "file:///a.tp2", "file:///tmp.tp2");

        expect(mockSendDiagnostics).toHaveBeenCalledTimes(1);
        const call = mockSendDiagnostics.mock.calls[0]![0];
        expect(call.uri).toBe("file:///a.tp2");
        expect(call.diagnostics).toHaveLength(2);
    });

    it("replaces tmpUri with mainUri for errors", () => {
        const parseResult: ParseResult = {
            errors: [{ uri: "file:///tmp.tp2", line: 3, columnStart: 0, columnEnd: 5, message: "err" }],
            warnings: [],
        };
        sendParseResult(parseResult, "file:///main.tp2", "file:///tmp.tp2");

        const call = mockSendDiagnostics.mock.calls[0]![0];
        expect(call.uri).toBe("file:///main.tp2");
    });

    it("replaces tmpUri with mainUri for warnings", () => {
        const parseResult: ParseResult = {
            errors: [],
            warnings: [{ uri: "file:///tmp.tp2", line: 3, columnStart: 0, columnEnd: 5, message: "warn" }],
        };
        sendParseResult(parseResult, "file:///main.tp2", "file:///tmp.tp2");

        const call = mockSendDiagnostics.mock.calls[0]![0];
        expect(call.uri).toBe("file:///main.tp2");
    });

    it("accumulates errors and warnings for the same URI", () => {
        const parseResult: ParseResult = {
            errors: [{ uri: "file:///a.tp2", line: 1, columnStart: 0, columnEnd: 10, message: "error" }],
            warnings: [{ uri: "file:///a.tp2", line: 2, columnStart: 0, columnEnd: 10, message: "warning" }],
        };
        sendParseResult(parseResult, "file:///a.tp2", "file:///tmp.tp2");

        expect(mockSendDiagnostics).toHaveBeenCalledTimes(1);
        const call = mockSendDiagnostics.mock.calls[0]![0];
        expect(call.diagnostics).toHaveLength(2);
    });

    it("groups diagnostics by URI across multiple files", () => {
        const parseResult: ParseResult = {
            errors: [
                { uri: "file:///a.tp2", line: 1, columnStart: 0, columnEnd: 10, message: "err a" },
                { uri: "file:///b.h", line: 2, columnStart: 0, columnEnd: 5, message: "err b" },
            ],
            warnings: [],
        };
        sendParseResult(parseResult, "file:///a.tp2", "file:///tmp.tp2");

        expect(mockSendDiagnostics).toHaveBeenCalledTimes(2);
    });

    it("accumulates many diagnostics for one URI in a single call", () => {
        const errors = Array.from({ length: 200 }, (_, i) => ({
            uri: "file:///big.tp2",
            line: i + 1,
            columnStart: 0,
            columnEnd: 5,
            message: `err ${i}`,
        }));
        sendParseResult({ errors, warnings: [] }, "file:///big.tp2", "file:///tmp.tp2");

        expect(mockSendDiagnostics).toHaveBeenCalledTimes(1);
        const call = mockSendDiagnostics.mock.calls[0]![0];
        expect(call.diagnostics).toHaveLength(200);
    });
});

describe("isSubpath", () => {
    it("returns false for undefined outerPath", () => {
        expect(isSubpath(undefined, "/some/path")).toBe(false);
    });

    it("returns false for non-existent paths", () => {
        expect(isSubpath("/nonexistent/path", "/also/nonexistent")).toBe(false);
    });
});

describe("isSubpathFullyResolved", () => {
    it("returns true when inner is under outer (both absolute, both already resolved)", () => {
        expect(isSubpathFullyResolved("/a/b", "/a/b/c.txt")).toBe(true);
    });

    it("returns false when inner is outside outer", () => {
        expect(isSubpathFullyResolved("/a/b", "/a/c/d.txt")).toBe(false);
    });

    it("returns true regardless of whether the inner exists on disk", () => {
        // The whole point of this helper: pure string check, no syscall.
        // A non-existent path that is lexically inside the outer must answer
        // true so the LSP hot path does not have to realpathSync per request.
        expect(isSubpathFullyResolved("/a/b", "/a/b/no-such-file-on-disk.tra")).toBe(true);
    });

    it("returns false for the outer being a string-prefix but not a directory parent", () => {
        // /a/bcd is not under /a/b — naive string-prefix would say yes
        expect(isSubpathFullyResolved("/a/b", "/a/bcd/x.txt")).toBe(false);
    });
});

describe("tryRealpathSync", () => {
    it("returns the resolved path for an existing path", () => {
        const result = tryRealpathSync(__dirname);
        expect(result).toBe(__dirname);
    });

    it("returns undefined for a non-existent path", () => {
        expect(tryRealpathSync("/nonexistent/path/here")).toBeUndefined();
    });
});

describe("expandHome", () => {
    it("expands ~/path to home directory", () => {
        const result = expandHome("~/bin/sslc");
        expect(result).not.toContain("~");
        expect(result).toMatch(/\/bin\/sslc$/);
    });

    it("expands bare ~ to home directory", () => {
        const result = expandHome("~");
        expect(result).not.toBe("~");
        expect(result.length).toBeGreaterThan(1);
    });

    it("does not expand ~user syntax", () => {
        expect(expandHome("~otheruser/bin")).toBe("~otheruser/bin");
    });

    it("returns absolute paths unchanged", () => {
        expect(expandHome("/usr/bin/sslc")).toBe("/usr/bin/sslc");
    });

    it("returns relative paths unchanged", () => {
        expect(expandHome("bin/sslc")).toBe("bin/sslc");
    });
});

describe("errorMessage", () => {
    it("extracts message from Error instances", () => {
        expect(errorMessage(new Error("something broke"))).toBe("something broke");
    });

    it("converts string to string", () => {
        expect(errorMessage("raw string")).toBe("raw string");
    });

    it("converts number to string", () => {
        expect(errorMessage(42)).toBe("42");
    });

    it("converts undefined to string", () => {
        expect(errorMessage(undefined)).toBe("undefined");
    });

    it("converts null to string", () => {
        expect(errorMessage(null)).toBe("null");
    });
});

describe("parseCommandPath", () => {
    it("handles a simple command name", () => {
        const result = parseCommandPath("compile");
        expect(result.executable).toBe("compile");
        expect(result.prefixArgs).toEqual([]);
    });

    it("expands tilde in a plain path", () => {
        const result = parseCommandPath("~/bin/compile");
        expect(result.executable).toMatch(/\/bin\/compile$/);
        expect(result.executable).not.toContain("~");
        expect(result.prefixArgs).toEqual([]);
    });

    it("splits known wrapper (wine) and expands tilde in argument", () => {
        const result = parseCommandPath("wine ~/bin/compile");
        expect(result.executable).toBe("wine");
        expect(result.prefixArgs).toHaveLength(1);
        expect(result.prefixArgs[0]).toMatch(/\/bin\/compile$/);
        expect(result.prefixArgs[0]).not.toContain("~");
    });

    it("handles wine64 wrapper", () => {
        const result = parseCommandPath("wine64 ~/bin/compile.exe");
        expect(result.executable).toBe("wine64");
        expect(result.prefixArgs[0]).toMatch(/\/bin\/compile\.exe$/);
    });

    it("handles mono wrapper", () => {
        const result = parseCommandPath("mono /opt/tools/weidu.exe");
        expect(result.executable).toBe("mono");
        expect(result.prefixArgs).toEqual(["/opt/tools/weidu.exe"]);
    });

    it("does not split unknown prefixes (preserves paths with spaces)", () => {
        const result = parseCommandPath("/opt/my tools/compile");
        expect(result.executable).toBe("/opt/my tools/compile");
        expect(result.prefixArgs).toEqual([]);
    });

    it("returns absolute path unchanged when no wrapper", () => {
        const result = parseCommandPath("/usr/bin/compile");
        expect(result.executable).toBe("/usr/bin/compile");
        expect(result.prefixArgs).toEqual([]);
    });

    it("handles empty string", () => {
        const result = parseCommandPath("");
        expect(result.executable).toBe("");
        expect(result.prefixArgs).toEqual([]);
    });

    it("handles whitespace-only string", () => {
        const result = parseCommandPath("   ");
        expect(result.executable).toBe("   ");
        expect(result.prefixArgs).toEqual([]);
    });
});

describe("needsShell", () => {
    it("returns true for .cmd files", () => {
        expect(needsShell("C:\\tools\\compile.cmd")).toBe(true);
    });

    it("returns true for .bat files", () => {
        expect(needsShell("C:\\tools\\compile.bat")).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(needsShell("compile.CMD")).toBe(true);
        expect(needsShell("compile.Bat")).toBe(true);
    });

    it("returns false for .exe files", () => {
        expect(needsShell("compile.exe")).toBe(false);
    });

    it("returns false for extensionless paths", () => {
        expect(needsShell("/usr/bin/compile")).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(needsShell("")).toBe(false);
    });
});

describe("addFallbackDiagnostic", () => {
    it("returns a new ParseResult with the fallback error appended", () => {
        const original: ParseResult = { errors: [], warnings: [] };
        const err = { message: "Command failed" } as import("child_process").ExecFileException;

        const result = addFallbackDiagnostic(original, err, "file:///test.tp2", "");

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.message).toBe("Command failed");
        expect(result.errors[0]!.uri).toBe("file:///test.tp2");
        expect(result.errors[0]!.line).toBe(1);
    });

    it("does not mutate the original ParseResult", () => {
        const original: ParseResult = {
            errors: [{ uri: "file:///a.tp2", line: 5, columnStart: 0, columnEnd: 10, message: "existing" }],
            warnings: [],
        };
        const err = { message: "new error" } as import("child_process").ExecFileException;

        const result = addFallbackDiagnostic(original, err, "file:///b.tp2", "");

        expect(original.errors).toHaveLength(1);
        expect(result.errors).toHaveLength(2);
        expect(result).not.toBe(original);
    });

    it("uses stdout as message when stdout is non-empty", () => {
        const err = { message: "exit code 1" } as import("child_process").ExecFileException;

        const result = addFallbackDiagnostic(
            { errors: [], warnings: [] },
            err,
            "file:///test.tp2",
            "Some unexpected output",
        );

        expect(result.errors[0]!.message).toBe("Some unexpected output");
    });

    it("uses err.message as message when stdout is empty", () => {
        const err = { message: "Command failed" } as import("child_process").ExecFileException;

        const result = addFallbackDiagnostic({ errors: [], warnings: [] }, err, "file:///test.tp2", "");

        expect(result.errors[0]!.message).toBe("Command failed");
    });

    it("preserves existing errors and warnings from input", () => {
        const original: ParseResult = {
            errors: [{ uri: "file:///a.tp2", line: 1, columnStart: 0, columnEnd: 5, message: "err1" }],
            warnings: [{ uri: "file:///a.tp2", line: 2, columnStart: 0, columnEnd: 5, message: "warn1" }],
        };
        const err = { message: "fallback" } as import("child_process").ExecFileException;

        const result = addFallbackDiagnostic(original, err, "file:///b.tp2", "");

        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]!.message).toBe("err1");
        expect(result.errors[1]!.message).toBe("fallback");
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]!.message).toBe("warn1");
    });
});

describe("runProcess", () => {
    beforeEach(() => {
        mockExecFile.mockReset();
    });

    it("passes signal option to execFile when provided", async () => {
        const controller = new AbortController();
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "ok", "");
            }
        });

        await runProcess("echo", ["hello"], ".", controller.signal);

        const options = mockExecFile.mock.calls[0]![2] as { signal?: AbortSignal };
        expect(options.signal).toBe(controller.signal);
    });

    it("does not include signal when not provided", async () => {
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "ok", "");
            }
        });

        await runProcess("echo", ["hello"], ".");

        const options = mockExecFile.mock.calls[0]![2] as { signal?: AbortSignal };
        expect(options.signal).toBeUndefined();
    });

    it("resolves with abort error when signal is aborted", async () => {
        const controller = new AbortController();
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                const abortError = Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
                (lastArg as (err: Error, stdout: string, stderr: string) => void)(abortError, "", "");
            }
        });

        controller.abort();
        const { err } = await runProcess("echo", ["hello"], ".", controller.signal);

        expect(err).toBeTruthy();
        expect((err as NodeJS.ErrnoException).code).toBe("ABORT_ERR");
    });

    it("passes timeout option to execFile when provided", async () => {
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "ok", "");
            }
        });

        await runProcess("echo", ["hello"], ".", undefined, 5000);

        const options = mockExecFile.mock.calls[0]![2] as { timeout?: number };
        expect(options.timeout).toBe(5000);
    });

    it("uses default timeout of 60000ms when no timeout provided", async () => {
        mockExecFile.mockImplementation((...args: unknown[]) => {
            const lastArg = args[args.length - 1];
            if (typeof lastArg === "function") {
                (lastArg as (err: null, stdout: string, stderr: string) => void)(null, "ok", "");
            }
        });

        await runProcess("echo", ["hello"], ".");

        const options = mockExecFile.mock.calls[0]![2] as { timeout?: number };
        expect(options.timeout).toBe(60_000);
    });
});
