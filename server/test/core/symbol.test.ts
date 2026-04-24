/**
 * Tests for core/symbol.ts - IndexedSymbol type definitions and utilities.
 *
 * These tests validate the IndexedSymbol interface structure and any helper functions
 * for working with symbols.
 */

import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import {
    type IndexedSymbol,
    type SymbolLocation,
    type SymbolScope,
    type SymbolSource,
    SymbolKind,
    ScopeLevel,
    SourceType,
    CallableContext,
    symbolKindToCompletionKind,
    symbolKindToVscodeKind,
} from "../../src/core/symbol";

describe("core/symbol", () => {
    // =========================================================================
    // SymbolKind enum
    // =========================================================================
    describe("SymbolKind", () => {
        it("should have all expected callable kinds", () => {
            expect(SymbolKind.Function).toBe("function");
            expect(SymbolKind.Procedure).toBe("procedure");
            expect(SymbolKind.Macro).toBe("macro");
            expect(SymbolKind.Action).toBe("action");
            expect(SymbolKind.Trigger).toBe("trigger");
        });

        it("should have all expected data kinds", () => {
            expect(SymbolKind.Variable).toBe("variable");
            expect(SymbolKind.Constant).toBe("constant");
            expect(SymbolKind.Parameter).toBe("parameter");
            expect(SymbolKind.LoopVariable).toBe("loop_variable");
        });

        it("should have all expected structure kinds", () => {
            expect(SymbolKind.State).toBe("state");
            expect(SymbolKind.Component).toBe("component");
        });
    });

    // =========================================================================
    // CallableContext enum
    // =========================================================================
    describe("CallableContext", () => {
        it("should have action, patch, and dimorphic values", () => {
            expect(CallableContext.Action).toBe("action");
            expect(CallableContext.Patch).toBe("patch");
            expect(CallableContext.Dimorphic).toBe("dimorphic");
        });
    });

    // =========================================================================
    // ScopeLevel enum
    // =========================================================================
    describe("ScopeLevel", () => {
        it("should have all expected levels", () => {
            expect(ScopeLevel.Global).toBe("global");
            expect(ScopeLevel.Workspace).toBe("workspace");
            expect(ScopeLevel.File).toBe("file");
            expect(ScopeLevel.Function).toBe("function");
            expect(ScopeLevel.Loop).toBe("loop");
        });
    });

    // =========================================================================
    // SourceType enum
    // =========================================================================
    describe("SourceType", () => {
        it("should have all expected types", () => {
            expect(SourceType.Static).toBe("static");
            expect(SourceType.Workspace).toBe("workspace");
            expect(SourceType.External).toBe("external");
            expect(SourceType.Document).toBe("document");
        });
    });

    // =========================================================================
    // symbolKindToCompletionKind helper
    // =========================================================================
    describe("symbolKindToCompletionKind()", () => {
        it("should map callable kinds to Function", () => {
            expect(symbolKindToCompletionKind(SymbolKind.Function)).toBe(CompletionItemKind.Function);
            expect(symbolKindToCompletionKind(SymbolKind.Procedure)).toBe(CompletionItemKind.Function);
            expect(symbolKindToCompletionKind(SymbolKind.Action)).toBe(CompletionItemKind.Function);
            expect(symbolKindToCompletionKind(SymbolKind.Trigger)).toBe(CompletionItemKind.Function);
        });

        it("should map Macro to Snippet", () => {
            expect(symbolKindToCompletionKind(SymbolKind.Macro)).toBe(CompletionItemKind.Snippet);
        });

        it("should map Variable kinds to Variable", () => {
            expect(symbolKindToCompletionKind(SymbolKind.Variable)).toBe(CompletionItemKind.Variable);
            expect(symbolKindToCompletionKind(SymbolKind.Parameter)).toBe(CompletionItemKind.Variable);
            expect(symbolKindToCompletionKind(SymbolKind.LoopVariable)).toBe(CompletionItemKind.Variable);
        });

        it("should map Constant to Constant", () => {
            expect(symbolKindToCompletionKind(SymbolKind.Constant)).toBe(CompletionItemKind.Constant);
        });

        it("should map structure kinds to Class", () => {
            expect(symbolKindToCompletionKind(SymbolKind.State)).toBe(CompletionItemKind.Class);
            expect(symbolKindToCompletionKind(SymbolKind.Component)).toBe(CompletionItemKind.Class);
        });
    });

    // =========================================================================
    // symbolKindToVscodeKind helper (for DocumentSymbol)
    // =========================================================================
    describe("symbolKindToVscodeKind()", () => {
        it("should map callable kinds to Function", () => {
            // Using numeric values since SymbolKind from vscode-languageserver
            expect(symbolKindToVscodeKind(SymbolKind.Function)).toBe(12); // Function
            expect(symbolKindToVscodeKind(SymbolKind.Procedure)).toBe(12);
            expect(symbolKindToVscodeKind(SymbolKind.Macro)).toBe(12);
        });

        it("should map Variable kinds to Variable", () => {
            expect(symbolKindToVscodeKind(SymbolKind.Variable)).toBe(13); // Variable
            expect(symbolKindToVscodeKind(SymbolKind.LoopVariable)).toBe(13);
        });

        it("should map Constant to Constant", () => {
            expect(symbolKindToVscodeKind(SymbolKind.Constant)).toBe(14); // Constant
        });
    });

    // =========================================================================
    // IndexedSymbol interface structure (compile-time checks, runtime validation)
    // =========================================================================
    describe("IndexedSymbol interface", () => {
        it("should accept a valid symbol with all required fields", () => {
            const location: SymbolLocation = {
                uri: "file:///test.ssl",
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 10 },
                },
            };

            const scope: SymbolScope = {
                level: ScopeLevel.File,
            };

            const source: SymbolSource = {
                type: SourceType.Document,
                uri: "file:///test.ssl",
            };

            const symbol: IndexedSymbol = {
                name: "test_proc",
                kind: SymbolKind.Procedure,
                callable: {},
                location,
                scope,
                source,
                completion: {
                    label: "test_proc",
                    kind: CompletionItemKind.Function,
                },
                hover: {
                    contents: {
                        kind: "markdown",
                        value: "procedure test_proc()",
                    },
                },
            };

            expect(symbol.name).toBe("test_proc");
            expect(symbol.kind).toBe(SymbolKind.Procedure);
            expect(symbol.location!.uri).toBe("file:///test.ssl");
            expect(symbol.scope.level).toBe(ScopeLevel.File);
            expect(symbol.source.type).toBe(SourceType.Document);
            expect(symbol.completion.label).toBe("test_proc");
            expect(symbol.hover.contents).toBeDefined();
        });

        it("should accept a symbol with optional signature for callables", () => {
            const symbol: IndexedSymbol = {
                name: "my_func",
                kind: SymbolKind.Function,
                callable: {},
                location: {
                    uri: "file:///test.tp2",
                    range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
                },
                scope: { level: ScopeLevel.File },
                source: { type: SourceType.Document, uri: "file:///test.tp2" },
                completion: { label: "my_func", kind: CompletionItemKind.Function },
                hover: { contents: { kind: "markdown", value: "function my_func()" } },
                signature: {
                    label: "my_func(INT_VAR x, STR_VAR s)",
                    parameters: [{ label: "x" }, { label: "s" }],
                },
            };

            expect(symbol.signature).toBeDefined();
            expect(symbol.signature?.label).toBe("my_func(INT_VAR x, STR_VAR s)");
            expect(symbol.signature?.parameters).toHaveLength(2);
        });

        it("should accept a symbol with scope container for function-local symbols", () => {
            const symbol: IndexedSymbol = {
                name: "i",
                kind: SymbolKind.LoopVariable,
                variable: {},
                location: {
                    uri: "file:///test.ssl",
                    range: { start: { line: 10, character: 4 }, end: { line: 10, character: 5 } },
                },
                scope: {
                    level: ScopeLevel.Loop,
                    containerId: "file:///test.ssl#process_items",
                },
                source: { type: SourceType.Document, uri: "file:///test.ssl" },
                completion: { label: "i", kind: CompletionItemKind.Variable },
                hover: { contents: { kind: "markdown", value: "loop variable i" } },
            };

            expect(symbol.scope.containerId).toBe("file:///test.ssl#process_items");
        });

        it("should accept a symbol with displayPath in source", () => {
            const symbol: IndexedSymbol = {
                name: "header_func",
                kind: SymbolKind.Function,
                callable: {},
                location: {
                    uri: "file:///project/lib/utils.tph",
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 15 } },
                },
                scope: { level: ScopeLevel.Workspace },
                source: {
                    type: SourceType.Workspace,
                    uri: "file:///project/lib/utils.tph",
                    displayPath: "lib/utils.tph",
                },
                completion: {
                    label: "header_func",
                    kind: CompletionItemKind.Function,
                    labelDetails: { description: "lib/utils.tph" },
                },
                hover: { contents: { kind: "markdown", value: "function header_func()" } },
            };

            expect(symbol.source.displayPath).toBe("lib/utils.tph");
        });
    });
});
