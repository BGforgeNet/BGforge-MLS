/**
 * Tests for duplicate symbol handling in Symbols class.
 * Verifies deterministic ordering when the same symbol is defined in multiple files.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { Symbols } from "../../src/core/symbol-index";
import { type ConstantSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver/node";
import { normalizeUri } from "../../src/core/normalized-uri";

describe("symbol-index duplicate handling", () => {
    let symbols: Symbols;

    function makeConstantSymbol(name: string, uri: string, value: string): ConstantSymbol {
        return {
            name,
            kind: SymbolKind.Constant,
            location: {
                uri,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
            },
            scope: { level: ScopeLevel.Workspace },
            source: { type: SourceType.Workspace, uri, displayPath: uri.split("/").pop()! },
            completion: {
                label: name,
                kind: CompletionItemKind.Constant,
            },
            hover: {
                contents: { kind: MarkupKind.Markdown, value: `${name} from ${uri}` },
            },
            constant: { value },
        };
    }

    beforeEach(() => {
        symbols = new Symbols();
    });

    it("should return deterministic result for duplicate symbols", () => {
        const uriA = "file:///headers/a.h";
        const uriB = "file:///headers/b.h";

        // Add symbols in order A, B
        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("PIPBOY", uriA, "(0x400)")]);
        symbols.updateFile(normalizeUri(uriB), [makeConstantSymbol("PIPBOY", uriB, "(0x400)")]);

        // First lookup should return first file (alphabetically by URI)
        const result1 = symbols.lookup("PIPBOY");
        expect(result1).toBeDefined();
        const firstUri = result1!.source.uri;

        // Reload file A (simulating file watcher event after switching tabs)
        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("PIPBOY", uriA, "(0x400)")]);

        // After reload, result should be the SAME as before (deterministic)
        const result2 = symbols.lookup("PIPBOY");
        expect(result2).toBeDefined();
        expect(result2!.source.uri).toBe(firstUri);
    });

    it("should return deterministic result regardless of load order", () => {
        const uriA = "file:///headers/a.h";
        const uriB = "file:///headers/b.h";
        const uriC = "file:///headers/c.h";

        // Add in order B, C, A
        symbols.updateFile(normalizeUri(uriB), [makeConstantSymbol("TEST", uriB, "1")]);
        symbols.updateFile(normalizeUri(uriC), [makeConstantSymbol("TEST", uriC, "2")]);
        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("TEST", uriA, "3")]);

        // Create another instance, add in order A, C, B
        const symbols2 = new Symbols();
        symbols2.updateFile(normalizeUri(uriA), [makeConstantSymbol("TEST", uriA, "3")]);
        symbols2.updateFile(normalizeUri(uriC), [makeConstantSymbol("TEST", uriC, "2")]);
        symbols2.updateFile(normalizeUri(uriB), [makeConstantSymbol("TEST", uriB, "1")]);

        // Both should return same result (alphabetically first URI)
        const result1 = symbols.lookup("TEST");
        const result2 = symbols2.lookup("TEST");

        expect(result1!.source.uri).toBe(result2!.source.uri);
        // Should be alphabetically first (a.h)
        expect(result1!.source.uri).toBe(uriA);
    });

    it("should return all duplicates from lookupAll", () => {
        const uriA = "file:///headers/a.h";
        const uriB = "file:///headers/b.h";

        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("CONST", uriA, "1")]);
        symbols.updateFile(normalizeUri(uriB), [makeConstantSymbol("CONST", uriB, "2")]);

        const all = symbols.lookupAll("CONST");
        expect(all).toHaveLength(2);
        // Both URIs should be present
        const uris = all.map((s) => s.source.uri);
        expect(uris).toContain(uriA);
        expect(uris).toContain(uriB);
    });

    it("should prioritize context uri when provided", () => {
        const uriA = "file:///headers/a.h";
        const uriB = "file:///headers/b.h";

        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("CONST", uriA, "1")]);
        symbols.updateFile(normalizeUri(uriB), [makeConstantSymbol("CONST", uriB, "2")]);

        // With context pointing to a different file, same-file bonus doesn't apply
        // but scope precedence sorting should still be deterministic
        const resultWithContext = symbols.lookup("CONST", { uri: "file:///scripts/test.ssl" });
        expect(resultWithContext).toBeDefined();

        // Result should be deterministic (alphabetically first uri since both are workspace scope)
        expect(resultWithContext!.source.uri).toBe(uriA);
    });

    it("should return all duplicates from query() for completion", () => {
        const uriA = "file:///headers/a.h";
        const uriB = "file:///headers/b.h";

        symbols.updateFile(normalizeUri(uriA), [makeConstantSymbol("PIPBOY", uriA, "(0x400)")]);
        symbols.updateFile(normalizeUri(uriB), [makeConstantSymbol("PIPBOY", uriB, "(0x400)")]);

        // query() should return ALL symbols including duplicates
        const allSymbols = symbols.query({});
        const pipboySymbols = allSymbols.filter((s) => s.name === "PIPBOY");

        expect(pipboySymbols).toHaveLength(2);
        // Each should have different displayPath for distinguishing in completion
        const paths = pipboySymbols.map((s) => s.source.displayPath);
        expect(paths).toContain("a.h");
        expect(paths).toContain("b.h");
    });

    it("should prioritize static (built-in) over workspace (headers)", () => {
        const headerUri = "file:///headers/lib.h";

        // Add header symbol (Workspace)
        symbols.updateFile(normalizeUri(headerUri), [
            makeConstantSymbol("get_proto_data", headerUri, "header_version"),
        ]);

        // Add static symbol (built-in)
        const staticSymbol: ConstantSymbol = {
            name: "get_proto_data",
            kind: SymbolKind.Constant,
            location: null,
            scope: { level: ScopeLevel.Global },
            source: { type: SourceType.Static, uri: null, displayPath: undefined },
            completion: {
                label: "get_proto_data",
                kind: CompletionItemKind.Function,
            },
            hover: {
                contents: { kind: MarkupKind.Markdown, value: "Built-in function" },
            },
            constant: { value: "builtin" },
        };
        symbols.loadStatic([staticSymbol]);

        // lookup should return static (built-in) over workspace (header)
        const result = symbols.lookup("get_proto_data");
        expect(result).toBeDefined();
        expect(result!.source.type).toBe(SourceType.Static);
    });
});
