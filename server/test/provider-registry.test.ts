/**
 * Tests for provider-registry.ts - the central hub for language providers.
 *
 * Tests provider registration, alias resolution, and feature routing.
 * Uses mock providers to test routing logic without initializing real parsers.
 */

import { describe, expect, it, vi } from "vitest";
import {
    CancellationToken,
    CompletionItem,
    CompletionItemKind,
    DocumentSymbol,
    Hover,
    Location,
    Position,
    Range,
    SymbolKind,
    InlayHint,
    InlayHintKind,
    SemanticTokenTypes,
    type SignatureHelp,
    SemanticTokens,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver/node";
import type { LanguageProvider, ProviderContext, FormatResult } from "../src/language-provider";
import { encodeWorkspaceSymbolQuery } from "../../shared/protocol";

// Mock the common module to suppress logs and control file finding during tests
vi.mock("../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    findFiles: vi.fn().mockReturnValue([]),
    pathToUri: vi.fn((p: string) => `file://${p}`),
}));

// Mock fs.readFileSync for file watching tests
vi.mock("node:fs", () => ({
    readFileSync: vi.fn(() => "mock file content"),
}));

// Mock fs/promises.readFile for startup indexing tests
vi.mock("node:fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue("mock file content"),
}));

// Re-import registry after mocks are set up
// We need to create a fresh instance for each test
function createRegistry() {
    // Clear module cache and re-import
    vi.resetModules();
    // Note: We're testing the class behavior, not the singleton instance
    // For isolation, we'll create mock providers and test routing
    return import("../src/provider-registry").then((m) => m.registry);
}

describe("ProviderRegistry", () => {
    const mockContext: ProviderContext = {
        workspaceRoot: "/test/workspace",
        settings: {
            falloutSSL: {
                compilePath: "",
                compileOptions: "",
                outputDirectory: "",
                headersDirectory: "",
                compileOnValidate: true,
            },
            weidu: {
                path: "weidu",
                gamePath: "",
            },
            validate: "saveAndType",
            debug: false,
        },
    };

    function createMockProvider(id: string, features: Partial<LanguageProvider> = {}): LanguageProvider {
        return {
            id,
            init: vi.fn().mockResolvedValue(undefined),
            ...features,
        };
    }

    describe("register() and get()", () => {
        it("should register a provider and retrieve it by id", async () => {
            const registry = await createRegistry();
            const provider = createMockProvider("test-lang");

            registry.register(provider);

            expect(registry.get("test-lang")).toBe(provider);
        });

        it("should return undefined for unregistered language", async () => {
            const registry = await createRegistry();

            expect(registry.get("nonexistent")).toBeUndefined();
        });
    });

    describe("registerAlias()", () => {
        it("should resolve alias to parent provider", async () => {
            const registry = await createRegistry();
            const provider = createMockProvider("parent-lang");

            registry.register(provider);
            registry.registerAlias("alias-lang", "parent-lang");

            expect(registry.get("alias-lang")).toBe(provider);
        });

        it("should return undefined for alias pointing to nonexistent provider", async () => {
            const registry = await createRegistry();

            registry.registerAlias("orphan-alias", "nonexistent");

            expect(registry.get("orphan-alias")).toBeUndefined();
        });
    });

    describe("has()", () => {
        it("should return true for registered provider", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test-lang"));

            expect(registry.has("test-lang")).toBe(true);
        });

        it("should return true for alias", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("parent"));
            registry.registerAlias("child", "parent");

            expect(registry.has("child")).toBe(true);
        });

        it("should return false for unregistered language", async () => {
            const registry = await createRegistry();

            expect(registry.has("nonexistent")).toBe(false);
        });
    });

    describe("init()", () => {
        it("should initialize all registered providers", async () => {
            const registry = await createRegistry();
            const provider1 = createMockProvider("lang1");
            const provider2 = createMockProvider("lang2");

            registry.register(provider1);
            registry.register(provider2);
            await registry.init(mockContext);

            expect(provider1.init).toHaveBeenCalledWith(mockContext);
            expect(provider2.init).toHaveBeenCalledWith(mockContext);
        });

        it("should continue initializing other providers if one fails", async () => {
            const registry = await createRegistry();
            const failingProvider = createMockProvider("failing", {
                init: vi.fn().mockRejectedValue(new Error("Init failed")),
            });
            const successProvider = createMockProvider("success");

            registry.register(failingProvider);
            registry.register(successProvider);
            await registry.init(mockContext);

            expect(successProvider.init).toHaveBeenCalled();
        });

        it("provider that throws during init still exists in registry", async () => {
            const registry = await createRegistry();
            const failingProvider = createMockProvider("failing", {
                init: vi.fn().mockRejectedValue(new Error("Init failed")),
            });

            registry.register(failingProvider);
            await registry.init(mockContext);

            // Provider is still registered (not removed)
            expect(registry.has("failing")).toBe(true);
            expect(registry.get("failing")).toBe(failingProvider);
        });

        it("feature requests to failed provider return empty results", async () => {
            const registry = await createRegistry();
            // Provider has init that fails, but also has format/symbols
            // In practice, a failed provider likely hasn't set up its parser,
            // so features would return empty/null even if called.
            const failingProvider = createMockProvider("failing", {
                init: vi.fn().mockRejectedValue(new Error("Parser WASM load failed")),
                format: vi.fn().mockReturnValue({ edits: [] }),
                symbols: vi.fn().mockReturnValue([]),
            });

            registry.register(failingProvider);
            await registry.init(mockContext);

            // These still route to the provider since it's registered
            const formatResult = registry.format("failing", "text", "file:///test.txt");
            const symbolResult = registry.symbols("failing", "text");

            expect(formatResult).toEqual({ edits: [] });
            expect(symbolResult).toEqual([]);
        });

        it("compile on failed provider returns false when compile is not implemented", async () => {
            const registry = await createRegistry();
            const failingProvider = createMockProvider("failing", {
                init: vi.fn().mockRejectedValue(new Error("Init failed")),
                // No compile method
            });

            registry.register(failingProvider);
            await registry.init(mockContext);

            const result = await registry.compile("failing", "file:///test.txt", "content", false);
            expect(result).toBe(false);
        });
    });

    describe("getContext()", () => {
        it("should return context after initialization", async () => {
            const registry = await createRegistry();
            await registry.init(mockContext);

            expect(registry.getContext()).toBe(mockContext);
        });

        it("should throw if not initialized", async () => {
            const registry = await createRegistry();

            expect(() => registry.getContext()).toThrow("ProviderRegistry not initialized");
        });
    });

    describe("shouldProvideFeatures()", () => {
        it("should return true if provider not found", async () => {
            const registry = await createRegistry();

            expect(registry.shouldProvideFeatures("nonexistent", "text", { line: 0, character: 0 })).toBe(true);
        });

        it("should return true if provider does not implement shouldProvideFeatures", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            expect(registry.shouldProvideFeatures("test", "text", { line: 0, character: 0 })).toBe(true);
        });

        it("should delegate to provider's shouldProvideFeatures", async () => {
            const registry = await createRegistry();
            const mockShouldProvide = vi.fn().mockReturnValue(false);
            registry.register(createMockProvider("test", { shouldProvideFeatures: mockShouldProvide }));

            const result = registry.shouldProvideFeatures("test", "some text", { line: 1, character: 5 });

            expect(mockShouldProvide).toHaveBeenCalledWith("some text", { line: 1, character: 5 });
            expect(result).toBe(false);
        });
    });

    describe("format()", () => {
        it("should return empty edits if no provider found", async () => {
            const registry = await createRegistry();

            const result = registry.format("nonexistent", "text", "file:///test.txt");

            expect(result).toEqual({ edits: [] });
        });

        it("should return empty edits if provider does not implement format", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            const result = registry.format("test", "text", "file:///test.txt");

            expect(result).toEqual({ edits: [] });
        });

        it("should delegate to provider's format", async () => {
            const registry = await createRegistry();
            const formatResult: FormatResult = {
                edits: [
                    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: "hello" },
                ],
            };
            const mockFormat = vi.fn().mockReturnValue(formatResult);
            registry.register(createMockProvider("test", { format: mockFormat }));

            const result = registry.format("test", "input", "file:///test.txt");

            expect(mockFormat).toHaveBeenCalledWith("input", "file:///test.txt");
            expect(result).toBe(formatResult);
        });
    });

    describe("semanticTokens()", () => {
        it("returns empty semantic tokens for unknown provider", async () => {
            const registry = await createRegistry();

            expect(registry.semanticTokens("nonexistent", "text", "file:///test.txt")).toEqual({ data: [] });
        });

        it("routes semantic token spans through the shared encoder", async () => {
            const registry = await createRegistry();
            registry.register(
                createMockProvider("test", {
                    semanticTokens: vi.fn().mockReturnValue([
                        {
                            line: 1,
                            startChar: 4,
                            length: 5,
                            tokenType: SemanticTokenTypes.parameter,
                            tokenModifiers: 0,
                        },
                    ]),
                }),
            );

            const result = registry.semanticTokens("test", "text", "file:///test.txt");

            expect(result).toEqual<SemanticTokens>({
                data: [1, 4, 5, 0, 0],
            });
        });
    });

    describe("symbols()", () => {
        it("should return empty array if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.symbols("nonexistent", "text")).toEqual([]);
        });

        it("should return empty array if provider does not implement symbols", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            expect(registry.symbols("test", "text")).toEqual([]);
        });

        it("should delegate to provider's symbols", async () => {
            const registry = await createRegistry();
            const mockSymbols: DocumentSymbol[] = [
                {
                    name: "myFunc",
                    kind: SymbolKind.Function,
                    range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
                    selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
                },
            ];
            registry.register(createMockProvider("test", { symbols: vi.fn().mockReturnValue(mockSymbols) }));

            const result = registry.symbols("test", "function myFunc() {}");

            expect(result).toBe(mockSymbols);
        });
    });

    describe("definition()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            expect(
                registry.definition("nonexistent", "text", { line: 0, character: 0 }, "file:///test.txt"),
            ).toBeNull();
        });

        it("should delegate to provider's definition", async () => {
            const registry = await createRegistry();
            const mockLocation: Location = {
                uri: "file:///test.txt",
                range: { start: { line: 10, character: 0 }, end: { line: 10, character: 10 } },
            };
            registry.register(createMockProvider("test", { definition: vi.fn().mockReturnValue(mockLocation) }));

            const result = registry.definition("test", "text", { line: 0, character: 5 }, "file:///test.txt");

            expect(result).toBe(mockLocation);
        });
    });

    describe("inlayHints()", () => {
        it("should return empty array if no provider found", async () => {
            const registry = await createRegistry();
            const range: Range = { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } };

            expect(registry.inlayHints("nonexistent", "text", "file:///test.txt", range)).toEqual([]);
        });

        it("should delegate to provider's inlayHints", async () => {
            const registry = await createRegistry();
            const mockHints: InlayHint[] = [
                { position: { line: 1, character: 5 }, label: "test hint", kind: InlayHintKind.Type },
            ];
            registry.register(createMockProvider("test", { inlayHints: vi.fn().mockReturnValue(mockHints) }));

            const range: Range = { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } };
            const result = registry.inlayHints("test", "text", "file:///test.txt", range);

            expect(result).toBe(mockHints);
        });
    });

    describe("prepareRename()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.prepareRename("nonexistent", "text", { line: 0, character: 0 })).toBeNull();
        });

        it("should delegate to provider's prepareRename", async () => {
            const registry = await createRegistry();
            const mockResult = {
                range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } },
                placeholder: "myVar",
            };
            registry.register(createMockProvider("test", { prepareRename: vi.fn().mockReturnValue(mockResult) }));

            const result = registry.prepareRename("test", "const myVar = 1;", { line: 0, character: 7 });

            expect(result).toBe(mockResult);
        });
    });

    describe("rename()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            await expect(
                registry.rename("nonexistent", "text", { line: 0, character: 0 }, "newName", "file:///test.txt"),
            ).resolves.toBeNull();
        });

        it("should delegate to provider's rename", async () => {
            const registry = await createRegistry();
            const mockEdit: WorkspaceEdit = {
                changes: {
                    "file:///test.txt": [
                        {
                            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
                            newText: "newVar",
                        },
                    ],
                },
            };
            registry.register(createMockProvider("test", { rename: vi.fn().mockReturnValue(mockEdit) }));

            const result = await registry.rename(
                "test",
                "const myVar = 1;",
                { line: 0, character: 7 },
                "newVar",
                "file:///test.txt",
            );

            expect(result).toBe(mockEdit);
        });
    });

    describe("completion()", () => {
        it("should return empty array if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.completion("nonexistent", "text", "file:///test.txt")).toEqual([]);
        });

        it("should return header completions from getCompletions", async () => {
            const registry = await createRegistry();
            const headerItems: CompletionItem[] = [{ label: "headerFunc", kind: CompletionItemKind.Function }];
            registry.register(
                createMockProvider("test", {
                    getCompletions: vi.fn().mockReturnValue(headerItems),
                }),
            );

            const result = registry.completion("test", "text", "file:///test.txt");

            expect(result).toHaveLength(1);
            expect(result[0].label).toBe("headerFunc");
        });

        it("should apply filterCompletions if provider implements it", async () => {
            const registry = await createRegistry();
            const items: CompletionItem[] = [
                { label: "func1", kind: CompletionItemKind.Function },
                { label: "func2", kind: CompletionItemKind.Function },
            ];
            const filteredItems: CompletionItem[] = [items[0]];
            const mockFilter = vi.fn().mockReturnValue(filteredItems);
            registry.register(
                createMockProvider("test", {
                    getCompletions: vi.fn().mockReturnValue(items),
                    filterCompletions: mockFilter,
                }),
            );

            const position: Position = { line: 0, character: 5 };
            const result = registry.completion("test", "text", "file:///test.txt", position);

            expect(mockFilter).toHaveBeenCalled();
            expect(result).toBe(filteredItems);
        });
    });

    describe("localHover()", () => {
        it("should return not-handled if no provider found", async () => {
            const registry = await createRegistry();

            const result = registry.localHover("nonexistent", "text", "sym", "file:///test.txt", {
                line: 0,
                character: 0,
            });
            expect(result).toEqual({ handled: false });
        });

        it("should delegate to provider's hover", async () => {
            const registry = await createRegistry();
            const mockHover: Hover = { contents: { kind: "markdown", value: "**myFunc**" } };
            registry.register(
                createMockProvider("test", { hover: vi.fn().mockReturnValue({ handled: true, hover: mockHover }) }),
            );

            const result = registry.localHover("test", "text", "myFunc", "file:///test.txt", { line: 0, character: 5 });

            expect(result).toEqual({ handled: true, hover: mockHover });
        });
    });

    describe("hover()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.hover("nonexistent", "file:///test.txt", "symbol")).toBeNull();
        });

        it("should delegate to provider's resolveSymbol for hover", async () => {
            const registry = await createRegistry();
            const mockHover: Hover = { contents: "hover content" };
            const mockSymbol = { hover: mockHover };
            registry.register(
                createMockProvider("test", {
                    resolveSymbol: vi.fn().mockReturnValue(mockSymbol),
                }),
            );

            const result = registry.hover("test", "file:///test.txt", "symbol", "text");

            expect(result).toBe(mockHover);
        });
    });

    describe("signature()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.signature("nonexistent", "text", "file:///test.txt", "func", 0)).toBeNull();
        });

        it("should prefer local signature over headers", async () => {
            const registry = await createRegistry();
            const localSig: SignatureHelp = {
                signatures: [{ label: "local(a, b)" }],
                activeSignature: 0,
                activeParameter: 0,
            };
            const headerSig: SignatureHelp = {
                signatures: [{ label: "header(a, b)" }],
                activeSignature: 0,
                activeParameter: 0,
            };
            registry.register(
                createMockProvider("test", {
                    localSignature: vi.fn().mockReturnValue(localSig),
                    getSignature: vi.fn().mockReturnValue(headerSig),
                }),
            );

            const result = registry.signature("test", "text", "file:///test.txt", "func", 0);

            expect(result).toBe(localSig);
        });

        it("should fall back to headers if local returns null", async () => {
            const registry = await createRegistry();
            const headerSig: SignatureHelp = {
                signatures: [{ label: "header(a, b)" }],
                activeSignature: 0,
                activeParameter: 0,
            };
            registry.register(
                createMockProvider("test", {
                    localSignature: vi.fn().mockReturnValue(null),
                    getSignature: vi.fn().mockReturnValue(headerSig),
                }),
            );

            const result = registry.signature("test", "text", "file:///test.txt", "func", 0);

            expect(result).toBe(headerSig);
        });
    });

    describe("symbolDefinition()", () => {
        it("should return null if no provider found", async () => {
            const registry = await createRegistry();

            expect(registry.symbolDefinition("nonexistent", "symbol")).toBeNull();
        });

        it("should delegate to provider's getSymbolDefinition", async () => {
            const registry = await createRegistry();
            const mockLocation: Location = {
                uri: "file:///header.h",
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
            };
            registry.register(
                createMockProvider("test", {
                    getSymbolDefinition: vi.fn().mockReturnValue(mockLocation),
                }),
            );

            const result = registry.symbolDefinition("test", "symbol");

            expect(result).toBe(mockLocation);
        });

        it("should return null for location with empty URI", async () => {
            // This prevents VSCode from trying to open workspace root as a directory
            const registry = await createRegistry();
            const invalidLocation: Location = {
                uri: "", // Empty URI - invalid for navigation
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            };
            registry.register(
                createMockProvider("test", {
                    getSymbolDefinition: vi.fn().mockReturnValue(invalidLocation),
                }),
            );

            const result = registry.symbolDefinition("test", "symbol");

            expect(result).toBeNull(); // Should filter out invalid location
        });

        it("should return null when provider returns null", async () => {
            const registry = await createRegistry();
            registry.register(
                createMockProvider("test", {
                    getSymbolDefinition: vi.fn().mockReturnValue(null),
                }),
            );

            const result = registry.symbolDefinition("test", "symbol");

            expect(result).toBeNull();
        });
    });

    describe("reloadFileData()", () => {
        it("should do nothing if no provider found", async () => {
            const registry = await createRegistry();
            // Should not throw
            registry.reloadFileData("nonexistent", "file:///test.txt", "content");
        });

        it("should delegate to provider's reloadFileData", async () => {
            const registry = await createRegistry();
            const mockReload = vi.fn();
            registry.register(createMockProvider("test", { reloadFileData: mockReload }));

            registry.reloadFileData("test", "file:///test.txt", "content");

            expect(mockReload).toHaveBeenCalledWith("file:///test.txt", "content");
        });
    });

    describe("compile()", () => {
        it("should return false if no provider found", async () => {
            const registry = await createRegistry();

            const result = await registry.compile("nonexistent", "file:///test.txt", "content", false);

            expect(result).toBe(false);
        });

        it("should return false if provider does not implement compile", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            const result = await registry.compile("test", "file:///test.txt", "content", false);

            expect(result).toBe(false);
        });

        it("should delegate to provider's compile and return true", async () => {
            const registry = await createRegistry();
            const mockCompile = vi.fn().mockResolvedValue(undefined);
            registry.register(createMockProvider("test", { compile: mockCompile }));

            const result = await registry.compile("test", "file:///test.txt", "content", true);

            expect(mockCompile).toHaveBeenCalledWith("file:///test.txt", "content", true);
            expect(result).toBe(true);
        });
    });

    describe("getWatchPatterns()", () => {
        it("should return empty array if no providers have index extensions", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            expect(registry.getWatchPatterns()).toEqual([]);
        });

        it("should collect watch patterns from all providers", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("lang1", { indexExtensions: [".h", ".inc"] }));
            registry.register(createMockProvider("lang2", { indexExtensions: [".tph"] }));

            const patterns = registry.getWatchPatterns();

            expect(patterns).toHaveLength(3);
            expect(patterns.map((p) => p.globPattern)).toContain("**/*.h");
            expect(patterns.map((p) => p.globPattern)).toContain("**/*.inc");
            expect(patterns.map((p) => p.globPattern)).toContain("**/*.tph");
        });
    });

    describe("handleDocumentClosed()", () => {
        it("should do nothing if no provider found", async () => {
            const registry = await createRegistry();
            // Should not throw
            registry.handleDocumentClosed("nonexistent", "file:///test.txt");
        });

        it("should delegate to provider's onDocumentClosed", async () => {
            const registry = await createRegistry();
            const mockClosed = vi.fn();
            registry.register(createMockProvider("test", { onDocumentClosed: mockClosed }));

            registry.handleDocumentClosed("test", "file:///test.txt");

            expect(mockClosed).toHaveBeenCalledWith("file:///test.txt");
        });
    });

    describe("scanWorkspaceFiles()", () => {
        it("should call reloadFileData for each matching file in workspace", async () => {
            const registry = await createRegistry();
            const mockReload = vi.fn();
            registry.register(
                createMockProvider("test", {
                    indexExtensions: [".tph"],
                    reloadFileData: mockReload,
                }),
            );

            // Mock findFiles to return test files
            const { findFiles } = await import("../src/common");
            vi.mocked(findFiles).mockReturnValue(["lib/utils.tph", "lib/other.tph"]);

            await registry.scanWorkspaceFiles("/test/workspace");

            expect(findFiles).toHaveBeenCalledWith("/test/workspace", "tph");
            expect(mockReload).toHaveBeenCalledTimes(2);
        });

        it("should do nothing if no workspace root provided", async () => {
            const registry = await createRegistry();
            const mockReload = vi.fn();
            registry.register(
                createMockProvider("test", {
                    indexExtensions: [".tph"],
                    reloadFileData: mockReload,
                }),
            );

            await registry.scanWorkspaceFiles(undefined);

            expect(mockReload).not.toHaveBeenCalled();
        });

        it("should skip providers without indexExtensions", async () => {
            const registry = await createRegistry();
            const mockReload = vi.fn();
            registry.register(
                createMockProvider("test", {
                    reloadFileData: mockReload,
                    // No indexExtensions
                }),
            );

            const { findFiles } = await import("../src/common");
            vi.mocked(findFiles).mockClear(); // Clear any previous calls
            vi.mocked(findFiles).mockReturnValue([]);

            await registry.scanWorkspaceFiles("/test/workspace");

            expect(findFiles).not.toHaveBeenCalled();
            expect(mockReload).not.toHaveBeenCalled();
        });

        it("should skip providers without reloadFileData", async () => {
            const registry = await createRegistry();
            registry.register(
                createMockProvider("test", {
                    indexExtensions: [".tph"],
                    // No reloadFileData
                }),
            );

            const { findFiles } = await import("../src/common");
            vi.mocked(findFiles).mockReturnValue(["file.tph"]);

            // Should not throw
            await registry.scanWorkspaceFiles("/test/workspace");
        });

        it("should handle multiple providers with different extensions", async () => {
            const registry = await createRegistry();
            const mockReload1 = vi.fn();
            const mockReload2 = vi.fn();
            registry.register(
                createMockProvider("weidu-tp2", {
                    indexExtensions: [".tph"],
                    reloadFileData: mockReload1,
                }),
            );
            registry.register(
                createMockProvider("fallout-ssl", {
                    indexExtensions: [".h"],
                    reloadFileData: mockReload2,
                }),
            );

            const { findFiles } = await import("../src/common");
            vi.mocked(findFiles)
                .mockReturnValueOnce(["lib/a.tph"]) // First call for .tph
                .mockReturnValueOnce(["lib/b.h"]); // Second call for .h

            await registry.scanWorkspaceFiles("/test/workspace");

            expect(mockReload1).toHaveBeenCalledTimes(1);
            expect(mockReload2).toHaveBeenCalledTimes(1);
        });
    });

    describe("handleWatchedFileChange()", () => {
        it("should route created files using indexExtensions", async () => {
            const registry = await createRegistry();
            const mockReload = vi.fn();
            registry.register(
                createMockProvider("weidu-d", {
                    indexExtensions: [".d"],
                    reloadFileData: mockReload,
                }),
            );
            await registry.init(mockContext);

            registry.handleWatchedFileChange("file:///test/workspace/dialogs/a.d", 1);

            expect(mockReload).toHaveBeenCalledWith("file:///test/workspace/dialogs/a.d", "mock file content");
        });

        it("should route deleted files using indexExtensions", async () => {
            const registry = await createRegistry();
            const mockDeleted = vi.fn();
            registry.register(
                createMockProvider("weidu-d", {
                    indexExtensions: [".d"],
                    onWatchedFileDeleted: mockDeleted,
                }),
            );
            await registry.init(mockContext);

            registry.handleWatchedFileChange("file:///test/workspace/dialogs/a.d", 3);

            expect(mockDeleted).toHaveBeenCalledWith("file:///test/workspace/dialogs/a.d");
        });
    });

    describe("workspaceSymbols()", () => {
        it("should return empty array when no providers implement it", async () => {
            const registry = await createRegistry();
            registry.register(createMockProvider("test"));

            expect(registry.workspaceSymbols("query", CancellationToken.None)).toEqual([]);
        });

        it("should aggregate results from multiple providers", async () => {
            const registry = await createRegistry();
            const symbolA: SymbolInformation = {
                name: "proc_a",
                kind: SymbolKind.Function,
                location: {
                    uri: "file:///a.ssl",
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                },
            };
            const symbolB: SymbolInformation = {
                name: "func_b",
                kind: SymbolKind.Function,
                location: {
                    uri: "file:///b.tph",
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                },
            };
            registry.register(
                createMockProvider("lang-a", {
                    workspaceSymbols: vi.fn().mockReturnValue([symbolA]),
                }),
            );
            registry.register(
                createMockProvider("lang-b", {
                    workspaceSymbols: vi.fn().mockReturnValue([symbolB]),
                }),
            );

            const results = registry.workspaceSymbols("func", CancellationToken.None);
            expect(results).toHaveLength(2);
            expect(results).toContain(symbolA);
            expect(results).toContain(symbolB);
        });

        it("should pass query string to each provider", async () => {
            const registry = await createRegistry();
            const mockWsSymbols = vi.fn().mockReturnValue([]);
            registry.register(createMockProvider("test", { workspaceSymbols: mockWsSymbols }));

            registry.workspaceSymbols("my_query", CancellationToken.None);

            expect(mockWsSymbols).toHaveBeenCalledWith("my_query", CancellationToken.None);
        });

        it("should skip providers that do not implement workspaceSymbols", async () => {
            const registry = await createRegistry();
            const symbol: SymbolInformation = {
                name: "proc",
                kind: SymbolKind.Function,
                location: {
                    uri: "file:///a.ssl",
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                },
            };
            registry.register(createMockProvider("no-ws-symbols"));
            registry.register(
                createMockProvider("has-ws-symbols", {
                    workspaceSymbols: vi.fn().mockReturnValue([symbol]),
                }),
            );

            const results = registry.workspaceSymbols("", CancellationToken.None);
            expect(results).toHaveLength(1);
            expect(results[0]).toBe(symbol);
        });

        it("should filter workspace symbols to the scoped language when query is encoded", async () => {
            const registry = await createRegistry();
            const scoped = vi.fn().mockReturnValue([]);
            const other = vi.fn().mockReturnValue([]);

            registry.register(createMockProvider("weidu-d", { workspaceSymbols: scoped }));
            registry.register(createMockProvider("weidu-tp2", { workspaceSymbols: other }));

            registry.workspaceSymbols(encodeWorkspaceSymbolQuery("label", "weidu-d"), CancellationToken.None);

            expect(scoped).toHaveBeenCalledWith("label", CancellationToken.None);
            expect(other).not.toHaveBeenCalled();
        });

        it("should fall back to global aggregation for unscoped workspace symbol queries", async () => {
            const registry = await createRegistry();
            const scoped = vi.fn().mockReturnValue([]);
            const other = vi.fn().mockReturnValue([]);

            registry.register(createMockProvider("weidu-d", { workspaceSymbols: scoped }));
            registry.register(createMockProvider("weidu-tp2", { workspaceSymbols: other }));

            registry.workspaceSymbols("label", CancellationToken.None);

            expect(scoped).toHaveBeenCalledWith("label", CancellationToken.None);
            expect(other).toHaveBeenCalledWith("label", CancellationToken.None);
        });
    });
});
