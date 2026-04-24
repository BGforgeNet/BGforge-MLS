/**
 * Unit tests for core/file-index.ts - FileIndex coordinator.
 * Tests that Symbols and ReferencesIndex are updated in lockstep.
 */

import { describe, expect, it } from "vitest";
import { Location, Range, Position } from "vscode-languageserver/node";
import { FileIndex } from "../../src/core/file-index";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";
import type { ParseResult } from "../../src/core/parse-result";
import { normalizeUri } from "../../src/core/normalized-uri";

function makeLoc(uri: string, line: number, char: number): Location {
    return Location.create(uri, Range.create(Position.create(line, char), Position.create(line, char + 5)));
}

function makeSymbol(name: string, uri: string, line = 0): IndexedSymbol {
    return {
        name,
        kind: SymbolKind.State,
        location: makeLoc(uri, line, 0),
        scope: { level: ScopeLevel.Workspace },
        source: { type: SourceType.Workspace, uri, displayPath: "test.h" },
        completion: { label: name },
        hover: { contents: "" },
    };
}

describe("FileIndex", () => {
    it("updates both stores from a single ParseResult", () => {
        const index = new FileIndex();
        const uri = "file:///a.ssl";
        const result: ParseResult = {
            symbols: [makeSymbol("my_proc", uri)],
            refs: new Map([["my_proc", [makeLoc(uri, 1, 0), makeLoc(uri, 5, 0)]]]),
        };

        index.updateFile(normalizeUri(uri), result);

        // Symbols store was updated
        expect(index.symbols.getFileSymbols(normalizeUri(uri))).toHaveLength(1);
        expect(index.symbols.lookup("my_proc")).toBeDefined();

        // References store was updated
        expect(index.refs.lookup("my_proc")).toHaveLength(2);
    });

    it("removes from both stores", () => {
        const index = new FileIndex();
        const uri = "file:///a.ssl";
        const result: ParseResult = {
            symbols: [makeSymbol("my_proc", uri)],
            refs: new Map([["my_proc", [makeLoc(uri, 1, 0)]]]),
        };

        index.updateFile(normalizeUri(uri), result);
        index.removeFile(normalizeUri(uri));

        expect(index.symbols.getFileSymbols(normalizeUri(uri))).toHaveLength(0);
        expect(index.refs.lookup("my_proc")).toHaveLength(0);
    });

    it("delegates loadStatic to symbols store", () => {
        const index = new FileIndex();
        const symbol = makeSymbol("built_in", "");

        index.loadStatic([symbol]);

        expect(index.symbols.lookup("built_in")).toBeDefined();
    });

    it("replaces data on re-update", () => {
        const index = new FileIndex();
        const uri = "file:///a.ssl";

        index.updateFile(normalizeUri(uri), {
            symbols: [makeSymbol("old_func", uri)],
            refs: new Map([["old_func", [makeLoc(uri, 1, 0)]]]),
        });

        index.updateFile(normalizeUri(uri), {
            symbols: [makeSymbol("new_func", uri)],
            refs: new Map([["new_func", [makeLoc(uri, 2, 0)]]]),
        });

        expect(index.symbols.lookup("old_func")).toBeUndefined();
        expect(index.symbols.lookup("new_func")).toBeDefined();
        expect(index.refs.lookup("old_func")).toHaveLength(0);
        expect(index.refs.lookup("new_func")).toHaveLength(1);
    });
});
