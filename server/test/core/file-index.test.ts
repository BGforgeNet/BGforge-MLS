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
import { LANG_FALLOUT_SSL, LANG_WEIDU_TP2 } from "../../../shared/languages";

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
        const index = new FileIndex(LANG_FALLOUT_SSL);
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
        const index = new FileIndex(LANG_FALLOUT_SSL);
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
        const index = new FileIndex(LANG_FALLOUT_SSL);
        const symbol = makeSymbol("built_in", "");

        index.loadStatic([symbol]);

        expect(index.symbols.lookup("built_in")).toBeDefined();
    });

    it("folds identifier case in both stores for a case-insensitive language", () => {
        const index = new FileIndex(LANG_FALLOUT_SSL);
        const uri = "file:///a.ssl";

        index.updateFile(normalizeUri(uri), {
            symbols: [makeSymbol("NOde005", uri)],
            refs: new Map([["NOde005", [makeLoc(uri, 1, 0)]]]),
        });

        expect(index.symbols.lookup("Node005")?.name).toBe("NOde005");
        expect(index.refs.lookup("Node005")).toHaveLength(1);
    });

    it("keeps identifier case distinct in both stores for a case-sensitive language", () => {
        const index = new FileIndex(LANG_WEIDU_TP2);
        const uri = "file:///a.tp2";

        index.updateFile(normalizeUri(uri), {
            symbols: [makeSymbol("MY_VAR", uri)],
            refs: new Map([["MY_VAR", [makeLoc(uri, 1, 0)]]]),
        });

        expect(index.symbols.lookup("my_var")).toBeUndefined();
        expect(index.refs.lookup("my_var")).toHaveLength(0);
    });

    describe("refsOf()", () => {
        const uriA = "file:///a.ssl";
        const uriB = "file:///b.ssl";

        /** Index one name per file, spelled as each file spells it. */
        function indexPair(defName: string, defSymbol: IndexedSymbol, otherSpelling: string): FileIndex {
            const index = new FileIndex(LANG_FALLOUT_SSL);
            index.updateFile(normalizeUri(uriA), {
                symbols: [defSymbol],
                refs: new Map([[defName, [makeLoc(uriA, 1, 0)]]]),
            });
            index.updateFile(normalizeUri(uriB), {
                symbols: [],
                refs: new Map([[otherSpelling, [makeLoc(uriB, 2, 0)]]]),
            });
            return index;
        }

        it("follows the language fold for an ordinary symbol", () => {
            const index = indexPair("Helper_Proc", makeSymbol("Helper_Proc", uriA), "HELPER_PROC");

            expect(index.refsOf("Helper_Proc")).toHaveLength(2);
        });

        it("stays exact for a symbol that opted out of the fold", () => {
            const macro = { ...makeSymbol("MY_MACRO", uriA), nameCase: "exact" } as IndexedSymbol;
            const index = indexPair("MY_MACRO", macro, "my_macro");

            expect(index.refsOf("MY_MACRO")).toHaveLength(1);
        });
    });

    it("replaces data on re-update", () => {
        const index = new FileIndex(LANG_FALLOUT_SSL);
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
