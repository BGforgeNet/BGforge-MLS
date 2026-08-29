/**
 * Unit tests for compile.ts - compilation dispatcher.
 * Tests routing of compile requests to providers/transpilers, and that the
 * handler owns writing transpiled output (via the public @bgforge/transpile
 * surface) and reporting the result.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

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
const mockTsslCompile = vi.fn();
const mockTbaf = vi.fn();
const mockTd = vi.fn();
const mockOutputPathFor = vi.fn();
// The real TranspileError, not a stand-in: compile.ts narrows on `instanceof` to read the location,
// so a mock class would silently take the no-location path and the position assertions would pass
// against a fallback rather than against the error's own line.
const { TranspileError } = await vi.hoisted(async () => await import("../../transpilers/common/transpile-error"));
// The transpile itself runs on a worker now, so the seam the dispatcher is tested against is the worker
// client rather than the transpiler barrel. One entry point covers both languages; `kind` selects which,
// which is why the stand-in dispatches on it instead of there being two mocked functions.
vi.mock("../src/transpile/transpile-worker-client", () => ({
    transpileOnWorker: (request: { kind: string; filepath: string; text: string }) =>
        request.kind === "td" ? mockTd(request.filepath, request.text) : mockTbaf(request.filepath, request.text),
    prewarmTranspileWorker: () => undefined,
    stopTranspileWorker: () => Promise.resolve(),
}));
vi.mock("../../transpilers/common/output-path", () => ({
    outputPathFor: (...args: unknown[]) => mockOutputPathFor(...args),
}));
// TSSL is a compiler, not one of the transpilers above: it produces the bytecode itself, so the
// dispatcher has no generated file to write and no second compiler to chain.
vi.mock("../src/tssl/compile-int", () => ({
    compileTsslToInt: (...args: unknown[]) => mockTsslCompile(...args),
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

const mockSendParseResult = vi.fn();
vi.mock("../src/diagnostics", () => ({
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    sendParseResult: (...args: unknown[]) => mockSendParseResult(...args),
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
import { setDiagnostics } from "../src/diagnostic-store";
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

            await compile("bgforge-script:/mods/a.int.ssl", "fallout-ssl", false, "procedure start begin end");

            expect(mockRegistryCompile).not.toHaveBeenCalled();
        });

        it("stays silent about it on the automatic path, which runs on every save and keystroke", async () => {
            mockRegistryHas.mockReturnValue(true);

            await compile("bgforge-script:/mods/a.int.ssl", "fallout-ssl", false, "procedure start begin end");

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
            mockTbaf.mockResolvedValue({ output: "baf output", sourceMap: [] });
            mockOutputPathFor.mockReturnValue("/output/test.baf");

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            expect(mockTbaf).toHaveBeenCalledWith("/test.tbaf", "tbaf content");
            expect(mockWriteFile).toHaveBeenCalledWith("/output/test.baf", "baf output", "utf-8");
        });

        it("clears diagnostics before TBAF transpile", async () => {
            mockTbaf.mockResolvedValue({ output: "baf output", sourceMap: [] });
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
            mockTbaf.mockResolvedValue({ output: "baf output", sourceMap: [] });
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

        // The point of the direct route: nothing here writes SSL text or hands anything to the SSL
        // compiler, so a regression that quietly restored the old chain fails on the two negatives
        // rather than on the message.
        it("compiles .tssl straight to bytecode, with no SSL step in between", async () => {
            mockTsslCompile.mockResolvedValue({ intPath: "/output/test.int" });

            await compile("file:///test.tssl", "typescript", false, "tssl content");

            expect(mockTsslCompile).toHaveBeenCalledWith(
                "file:///test.tssl",
                "/test.tssl",
                "tssl content",
                expect.anything(),
                false,
            );
            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(mockRegistryCompile).not.toHaveBeenCalledWith(
                LANG_FALLOUT_SSL,
                expect.anything(),
                expect.anything(),
                expect.anything(),
            );
        });

        it("names the .ssl too when the setting asked for one", async () => {
            mockTsslCompile.mockResolvedValue({ intPath: "/output/test.int", sslPath: "/test.ssl" });

            await compile("file:///test.tssl", "typescript", true, "tssl content");

            expect(mockShowInfo).toHaveBeenCalledWith("Compiled test.int and test.ssl");
        });

        it("shows error message on TSSL compile failure", async () => {
            mockTsslCompile.mockRejectedValue(new Error("TSSL error"));

            await compile("file:///test.tssl", "typescript", true, "bad tssl");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TSSL: TSSL error"));
        });
    });

    /**
     * Only the second step of a transpiled build reports compiler errors, and it reports them against the
     * generated file. The author edits the source, so an error left on the generated line is one they
     * cannot act on - in a file they may not even have open.
     */
    describe("compiler errors from the generated file", () => {
        /** What the chained compiler would have published for the generated file. */
        function errorOnGeneratedLine(line: number, message: string): Diagnostic {
            return {
                severity: DiagnosticSeverity.Error,
                range: { start: { line, character: 0 }, end: { line, character: 6 } },
                message,
                source: "BGforge MLS",
            };
        }

        /** The diagnostics most recently published for `uri`, which is what the editor is showing. */
        function showingOn(uri: string) {
            const calls = mockSendDiagnostics.mock.calls.filter((call) => call[0].uri === uri);
            return calls.at(-1)?.[0].diagnostics ?? [];
        }

        it("moves a chained BAF error onto the TBAF line it came from", async () => {
            mockTbaf.mockResolvedValue({
                output: "baf output",
                sourceMap: [{ file: "/test.tbaf", line: 7 }],
            });
            mockOutputPathFor.mockReturnValue("/output/test.baf");
            mockWeiduCompile.mockImplementation((bafUri: string) => {
                setDiagnostics(bafUri, "compiler", [errorOnGeneratedLine(0, "unknown action")]);
            });

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            expect(showingOn("file:///test.tbaf")).toEqual([
                expect.objectContaining({
                    message: "unknown action",
                    range: { start: { line: 7, character: 0 }, end: { line: 7, character: 0 } },
                }),
            ]);
        });

        it("moves a chained D error onto the TD line it came from", async () => {
            mockTd.mockResolvedValue({
                output: "d output",
                warnings: [],
                sourceMap: [{ file: "/test.td", line: 2 }],
            });
            mockOutputPathFor.mockReturnValue("/output/test.d");
            mockWeiduCompile.mockImplementation((dUri: string) => {
                setDiagnostics(dUri, "compiler", [errorOnGeneratedLine(0, "unknown trigger")]);
            });

            await compile("file:///test.td", "typescript", false, "td content");

            expect(showingOn("file:///test.td")).toEqual([
                expect.objectContaining({
                    message: "unknown trigger",
                    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
                }),
            ]);
        });
    });

    // A failing transpile used to reach the user only as a popup, and only when they had asked for the
    // compile - so saving a file with an unsupported construct in it reported nothing at all. These go to
    // the Problems panel instead, on the source the author is editing rather than the generated output.
    describe("transpile failures reach the editor", () => {
        it("reports a TSSL failure on the save path, which showed nothing before", async () => {
            mockTsslCompile.mockRejectedValue(new TranspileError("try/catch is not supported in SSL", { line: 12 }));

            await compile("file:///test.tssl", "typescript", false, "bad tssl");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                {
                    errors: [
                        {
                            uri: "file:///test.tssl",
                            line: 12,
                            columnStart: 0,
                            columnEnd: 0,
                            message: "try/catch is not supported in SSL",
                        },
                    ],
                    warnings: [],
                },
                "file:///test.tssl",
                "file:///test.tssl",
            );
        });

        it.each([
            ["tbaf", () => mockTbaf],
            ["td", () => mockTd],
        ])("reports a %s failure the same way - one error type, three languages", async (ext, transpiler) => {
            transpiler().mockRejectedValue(new TranspileError("bad", { line: 7, column: 3 }));

            await compile(`file:///test.${ext}`, "typescript", false, "bad source");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                {
                    errors: [{ uri: `file:///test.${ext}`, line: 7, columnStart: 3, columnEnd: 3, message: "bad" }],
                    warnings: [],
                },
                `file:///test.${ext}`,
                `file:///test.${ext}`,
            );
        });

        it("anchors an error carrying no location at line 1 rather than guessing one", async () => {
            mockTsslCompile.mockRejectedValue(new Error("no location on this one"));

            await compile("file:///test.tssl", "typescript", false, "bad tssl");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({
                    errors: [
                        {
                            uri: "file:///test.tssl",
                            line: 1,
                            columnStart: 0,
                            columnEnd: 0,
                            message: "no location on this one",
                        },
                    ],
                }),
                "file:///test.tssl",
                "file:///test.tssl",
            );
        });

        it("keeps the line when the failure is in the file being edited", async () => {
            mockTsslCompile.mockRejectedValue(new TranspileError("bad construct", { file: "/test.tssl", line: 12 }));

            await compile("file:///test.tssl", "typescript", false, "bad tssl");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({
                    errors: [
                        {
                            uri: "file:///test.tssl",
                            line: 12,
                            columnStart: 0,
                            columnEnd: 0,
                            message: "bad construct",
                        },
                    ],
                }),
                "file:///test.tssl",
                "file:///test.tssl",
            );
        });

        // A transpiler bundles the file's imports, so a failure can belong to a file the author never
        // opened. Its line means nothing against the one on screen, so the diagnostic says where instead.
        it("names the other file rather than putting its line on the one being edited", async () => {
            mockTsslCompile.mockRejectedValue(new TranspileError("bad construct", { file: "/lib/folib.ts", line: 42 }));

            await compile("file:///test.tssl", "typescript", false, "bad tssl");

            expect(mockSendParseResult).toHaveBeenCalledWith(
                expect.objectContaining({
                    errors: [
                        {
                            uri: "file:///test.tssl",
                            line: 1,
                            columnStart: 0,
                            columnEnd: 0,
                            message: "/lib/folib.ts:42: bad construct",
                        },
                    ],
                }),
                "file:///test.tssl",
                "file:///test.tssl",
            );
        });

        it("clears the source's own diagnostics before transpiling, so a fixed error goes away", async () => {
            mockTsslCompile.mockResolvedValue({ intPath: "/output/test.int" });

            await compile("file:///test.tssl", "typescript", false, "tssl content");

            expect(mockSendDiagnostics).toHaveBeenCalledWith({ uri: "file:///test.tssl", diagnostics: [] });
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
