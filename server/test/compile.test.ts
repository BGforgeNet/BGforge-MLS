/**
 * Unit tests for compile.ts - compilation dispatcher.
 * Tests routing of compile requests to providers/transpilers, and that the
 * handler owns writing transpiled output (via the public @bgforge/transpile
 * surface) and reporting the result.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShowInfo = vi.fn();
const mockShowError = vi.fn();
const mockShowWarning = vi.fn();
const mockSendDiagnostics = vi.fn();

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: mockSendDiagnostics,
        window: {
            showInformationMessage: mockShowInfo,
            showWarningMessage: mockShowWarning,
            showErrorMessage: mockShowError,
        },
    }),
}));

const mockRegistryCompile = vi.fn();
const mockRegistryHas = vi.fn();

vi.mock("../src/provider-registry", () => ({
    registry: {
        has: (...args: unknown[]) => mockRegistryHas(...args),
        compile: (...args: unknown[]) => mockRegistryCompile(...args),
    },
}));

vi.mock("../src/settings-service", () => ({
    getDocumentSettings: vi.fn().mockResolvedValue({
        falloutSSL: {
            compilePath: "",
            compileOptions: "",
            outputDirectory: "",
            headersDirectory: "",
        },
        weidu: {
            path: "weidu",
            gamePath: "/games/bg2",
        },
        validate: "saveAndType",
    }),
}));

const mockWeiduCompile = vi.fn();
vi.mock("../src/weidu-compile", () => ({
    compile: (...args: unknown[]) => mockWeiduCompile(...args),
}));

// The transpilers are consumed through the public @bgforge/transpile barrel:
// the no-write transpile functions plus outputPathFor. compile.ts owns the file
// write and the user-facing message.
const mockTssl = vi.fn();
const mockTbaf = vi.fn();
const mockTd = vi.fn();
const mockOutputPathFor = vi.fn();
vi.mock("../../transpilers/src/index", () => ({
    tssl: (...args: unknown[]) => mockTssl(...args),
    tbaf: (...args: unknown[]) => mockTbaf(...args),
    td: (...args: unknown[]) => mockTd(...args),
    outputPathFor: (...args: unknown[]) => mockOutputPathFor(...args),
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock("fs", () => ({
    mkdirSync: vi.fn(),
    promises: {
        writeFile: (...args: unknown[]) => mockWriteFile(...args),
    },
}));

vi.mock("../src/logger", () => ({
    conlog: vi.fn(),
}));

vi.mock("../src/diagnostics", () => ({
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("../src/path-utils", () => ({
    isDirectory: vi.fn().mockReturnValue(true),
    tmpDir: "/tmp/bgforge-mls",
}));

vi.mock("../src/uri-utils", () => ({
    pathToUri: vi.fn((p: string) => `file://${p}`),
    uriToPath: vi.fn((u: string) => u.replace(/^file:\/\//, "")),
}));

import { conlog } from "../src/logger";
import { LANG_FALLOUT_SSL } from "../src/core/languages";
import { compile } from "../src/compile";

describe("compile dispatcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRegistryHas.mockReturnValue(false);
        mockRegistryCompile.mockResolvedValue(false);
        mockWriteFile.mockResolvedValue(undefined);
    });

    // A decompiled script is served on its own scheme so it can be edited as source, and the language
    // client attaches to it for completion and hover. Compiling one has nowhere to put the output - the
    // URI names no file - and the editor writes it back through its own save instead.
    describe("documents that are not files on disk", () => {
        it("does not compile them, whatever language they claim", async () => {
            mockRegistryHas.mockReturnValue(true);
            mockRegistryCompile.mockResolvedValue(true);

            await compile("bgforge-int:/mods/a.int.ssl", "fallout-ssl", false, "procedure start begin end");

            expect(mockRegistryCompile).not.toHaveBeenCalled();
        });

        it("stays silent about it on the automatic path, which runs on every save and keystroke", async () => {
            mockRegistryHas.mockReturnValue(true);

            await compile("bgforge-int:/mods/a.int.ssl", "fallout-ssl", false, "procedure start begin end");

            expect(mockShowInfo).not.toHaveBeenCalled();
        });
    });

    describe("provider routing", () => {
        it("routes to registry provider when available and it handles it", async () => {
            mockRegistryHas.mockReturnValue(true);
            mockRegistryCompile.mockResolvedValue(true);

            await compile("file:///test.tp2", "weidu-tp2", false, "content");

            expect(mockRegistryCompile).toHaveBeenCalledWith("weidu-tp2", "file:///test.tp2", "content", false);
        });

        it("clears diagnostics before provider compile", async () => {
            mockRegistryHas.mockReturnValue(true);
            mockRegistryCompile.mockResolvedValue(true);

            await compile("file:///test.tp2", "weidu-tp2", false, "content");

            expect(mockSendDiagnostics).toHaveBeenCalledWith({
                uri: "file:///test.tp2",
                diagnostics: [],
            });
        });
    });

    describe("typescript transpiler routing", () => {
        it("routes .td files to the TD transpiler with the resolved file path", async () => {
            mockTd.mockResolvedValue({ output: "d output", warnings: [] });
            mockOutputPathFor.mockReturnValue("/output/test.d");

            await compile("file:///test.td", "typescript", false, "td content");

            expect(mockTd).toHaveBeenCalledWith("/test.td", "td content");
        });

        it("writes the transpiled D output to the computed output path", async () => {
            mockTd.mockResolvedValue({ output: "d output", warnings: [] });
            mockOutputPathFor.mockReturnValue("/output/test.d");

            await compile("file:///test.td", "typescript", false, "td content");

            expect(mockOutputPathFor).toHaveBeenCalledWith("/test.td");
            expect(mockWriteFile).toHaveBeenCalledWith("/output/test.d", "d output", "utf-8");
        });

        it("shows success message after TD transpile", async () => {
            mockTd.mockResolvedValue({ output: "d output", warnings: [] });
            mockOutputPathFor.mockReturnValue("/output/test.d");

            await compile("file:///test.td", "typescript", true, "td content");

            expect(mockShowInfo).toHaveBeenCalledWith("Transpiled to test.d");
        });

        it("shows combined warning message with orphan names on TD warnings", async () => {
            mockTd.mockResolvedValue({
                output: "d output",
                warnings: [
                    {
                        message: 'Function "orphan1" looks like an orphan state',
                        line: 5,
                        columnStart: 9,
                        columnEnd: 16,
                    },
                    {
                        message: 'Function "orphan2" looks like an orphan state',
                        line: 8,
                        columnStart: 9,
                        columnEnd: 16,
                    },
                ],
            });
            mockOutputPathFor.mockReturnValue("/output/test.d");

            await compile("file:///test.td", "typescript", true, "td content");

            expect(mockShowWarning).toHaveBeenCalledWith(
                expect.stringContaining("Transpiled to test.d. Orphan states: orphan1, orphan2"),
            );
            // Should NOT show a separate info message
            expect(mockShowInfo).not.toHaveBeenCalled();
        });

        it("shows error message on TD transpile failure", async () => {
            mockTd.mockRejectedValue(new Error("Parse error in TD"));

            await compile("file:///test.td", "typescript", true, "bad td");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TD: Parse error in TD"));
        });

        it("routes .tbaf files to the TBAF transpiler and writes the output", async () => {
            mockTbaf.mockResolvedValue("baf output");
            mockOutputPathFor.mockReturnValue("/output/test.baf");

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            expect(mockTbaf).toHaveBeenCalledWith("/test.tbaf", "tbaf content");
            expect(mockWriteFile).toHaveBeenCalledWith("/output/test.baf", "baf output", "utf-8");
        });

        it("clears diagnostics before TBAF transpile", async () => {
            mockTbaf.mockResolvedValue("baf output");
            mockOutputPathFor.mockReturnValue("/output/test.baf");

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            // clearDiagnostics sends empty diagnostics array
            expect(mockSendDiagnostics).toHaveBeenCalledWith({
                uri: "file:///test.tbaf",
                diagnostics: [],
            });
            // And it should happen before the transpile
            const clearCallOrder = mockSendDiagnostics.mock.invocationCallOrder[0];
            const tbafCallOrder = mockTbaf.mock.invocationCallOrder[0];
            expect(clearCallOrder).toBeLessThan(tbafCallOrder!);
        });

        it("does not fall through to unknown-language after successful TBAF transpile", async () => {
            mockTbaf.mockResolvedValue("baf output");
            mockOutputPathFor.mockReturnValue("/output/test.baf");

            await compile("file:///test.tbaf", "typescript", true, "tbaf content");

            expect(conlog).not.toHaveBeenCalledWith(expect.stringContaining("Don't know how to compile"));
            expect(mockShowInfo).toHaveBeenCalledWith("Transpiled to test.baf");
        });

        it("shows error message on TBAF transpile failure", async () => {
            mockTbaf.mockRejectedValue(new Error("TBAF syntax error"));

            await compile("file:///test.tbaf", "typescript", true, "bad tbaf");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TBAF: TBAF syntax error"));
        });

        it("routes .tssl files to the TSSL transpiler and chains SSL compilation", async () => {
            mockTssl.mockResolvedValue("ssl output");
            mockOutputPathFor.mockReturnValue("/output/test.ssl");
            // The registry handles the chained SSL compilation
            mockRegistryCompile.mockResolvedValue(true);

            await compile("file:///test.tssl", "typescript", false, "tssl content");

            expect(mockTssl).toHaveBeenCalledWith("/test.tssl", "tssl content");
            expect(mockWriteFile).toHaveBeenCalledWith("/output/test.ssl", "ssl output", "utf-8");
            expect(mockRegistryCompile).toHaveBeenCalledWith(
                LANG_FALLOUT_SSL,
                "file:///output/test.ssl",
                "ssl output",
                false,
            );
        });

        it("shows error message on TSSL transpile failure", async () => {
            mockTssl.mockRejectedValue(new Error("TSSL error"));

            await compile("file:///test.tssl", "typescript", true, "bad tssl");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TSSL: TSSL error"));
        });
    });

    describe("unknown language", () => {
        it("logs message for unknown language", async () => {
            await compile("file:///test.xyz", "unknown-lang", true, "content");

            expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining("Don't know how to compile"));
        });

        it("does not show message when not interactive", async () => {
            await compile("file:///test.xyz", "unknown-lang", false, "content");

            expect(mockShowInfo).not.toHaveBeenCalled();
        });
    });
});
