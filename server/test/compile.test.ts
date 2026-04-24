/**
 * Unit tests for compile.ts - compilation dispatcher.
 * Tests routing of compile requests to appropriate providers/transpilers.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockShowInfo = vi.fn();
const mockShowError = vi.fn();
const mockShowWarning = vi.fn();
const mockSendDiagnostics = vi.fn();

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn() },
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

const mockTbafCompile = vi.fn();
vi.mock("../../transpilers/tbaf/src/index", () => ({
    compile: (...args: unknown[]) => mockTbafCompile(...args),
}));

const mockTdCompile = vi.fn();
vi.mock("../../transpilers/td/src/index", () => ({
    compile: (...args: unknown[]) => mockTdCompile(...args),
}));

const mockTsslCompile = vi.fn();
vi.mock("../../transpilers/tssl/src/index", () => ({
    compile: (...args: unknown[]) => mockTsslCompile(...args),
}));

vi.mock("fs", () => ({
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue("file content"),
}));

vi.mock("../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    isDirectory: vi.fn().mockReturnValue(true),
    pathToUri: vi.fn((p: string) => `file://${p}`),
    tmpDir: "/tmp/bgforge-mls",
}));

import { conlog } from "../src/common";
import { compile, clearDiagnostics } from "../src/compile";

describe("compile dispatcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRegistryHas.mockReturnValue(false);
        mockRegistryCompile.mockResolvedValue(false);
    });

    describe("clearDiagnostics", () => {
        it("sends empty diagnostics for the given URI", () => {
            clearDiagnostics("file:///test.tp2");

            expect(mockSendDiagnostics).toHaveBeenCalledWith({
                uri: "file:///test.tp2",
                diagnostics: [],
            });
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
        it("routes .td files to TD transpiler", async () => {
            mockTdCompile.mockResolvedValue({
                dPath: "/output/test.d",
                warnings: [],
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.d",
                        outPath: "/output/test.d",
                    },
                ],
            });

            await compile("file:///test.td", "typescript", false, "td content");

            expect(mockTdCompile).toHaveBeenCalledWith("file:///test.td", "td content");
        });

        it("shows success message after TD transpile", async () => {
            mockTdCompile.mockResolvedValue({
                dPath: "/output/test.d",
                warnings: [],
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.d",
                        outPath: "/output/test.d",
                    },
                ],
            });

            await compile("file:///test.td", "typescript", true, "td content");

            expect(mockShowInfo).toHaveBeenCalledWith("Transpiled to test.d");
        });

        it("shows combined warning message with orphan names on TD warnings", async () => {
            mockTdCompile.mockResolvedValue({
                dPath: "/output/test.d",
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
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.d",
                        outPath: "/output/test.d",
                    },
                ],
            });

            await compile("file:///test.td", "typescript", true, "td content");

            expect(mockShowWarning).toHaveBeenCalledWith(
                expect.stringContaining("Transpiled to test.d. Orphan states: orphan1, orphan2"),
            );
            // Should NOT show a separate info message
            expect(mockShowInfo).not.toHaveBeenCalled();
        });

        it("shows error message on TD transpile failure", async () => {
            mockTdCompile.mockRejectedValue(new Error("Parse error in TD"));

            await compile("file:///test.td", "typescript", true, "bad td");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TD: Parse error in TD"));
        });

        it("routes .tbaf files to TBAF transpiler", async () => {
            mockTbafCompile.mockResolvedValue({
                bafPath: "/output/test.baf",
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.baf",
                        outPath: "/output/test.baf",
                    },
                ],
            });

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            expect(mockTbafCompile).toHaveBeenCalledWith("file:///test.tbaf", "tbaf content");
        });

        it("clears diagnostics before TBAF transpile", async () => {
            mockTbafCompile.mockResolvedValue({
                bafPath: "/output/test.baf",
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.baf",
                        outPath: "/output/test.baf",
                    },
                ],
            });

            await compile("file:///test.tbaf", "typescript", false, "tbaf content");

            // clearDiagnostics sends empty diagnostics array
            expect(mockSendDiagnostics).toHaveBeenCalledWith({
                uri: "file:///test.tbaf",
                diagnostics: [],
            });
            // And it should happen before the transpile
            const clearCallOrder = mockSendDiagnostics.mock.invocationCallOrder[0];
            const tbafCallOrder = mockTbafCompile.mock.invocationCallOrder[0];
            expect(clearCallOrder).toBeLessThan(tbafCallOrder!);
        });

        it("does not fall through to unknown-language after successful TBAF transpile", async () => {
            mockTbafCompile.mockResolvedValue({
                bafPath: "/output/test.baf",
                events: [
                    {
                        level: "info",
                        code: "output_written",
                        message: "Transpiled to test.baf",
                        outPath: "/output/test.baf",
                    },
                ],
            });

            await compile("file:///test.tbaf", "typescript", true, "tbaf content");

            expect(conlog).not.toHaveBeenCalledWith(expect.stringContaining("Don't know how to compile"));
            expect(mockShowInfo).toHaveBeenCalledWith("Transpiled to test.baf");
        });

        it("shows error message on TBAF transpile failure", async () => {
            mockTbafCompile.mockRejectedValue(new Error("TBAF syntax error"));

            await compile("file:///test.tbaf", "typescript", true, "bad tbaf");

            expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("TBAF: TBAF syntax error"));
        });

        it("routes .tssl files to TSSL transpiler", async () => {
            mockTsslCompile.mockResolvedValue("/output/test.ssl");

            // The registry needs to handle the chained SSL compilation
            mockRegistryCompile.mockResolvedValue(true);

            await compile("file:///test.tssl", "typescript", false, "tssl content");

            expect(mockTsslCompile).toHaveBeenCalledWith("file:///test.tssl", "tssl content");
        });

        it("shows error message on TSSL transpile failure", async () => {
            mockTsslCompile.mockRejectedValue(new Error("TSSL error"));

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
