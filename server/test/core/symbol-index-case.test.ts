/**
 * Tests for the per-language name-case policy on the shared symbol index.
 *
 * The index class serves languages that disagree about identifier case, so the fold is a per-instance
 * policy rather than a fold at the call site: Fallout SSL binds names case-insensitively, while WeiDU D
 * state labels and tp2 variables are case-sensitive.
 */

import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";
import { normalizeUri } from "../../src/core/normalized-uri";

const URI = "file:///node.ssl";

/**
 * Minimal procedure symbol. Mirrors the fixture in symbol-index.test.ts: `Symbols` never inspects the
 * variant field, so the cast is test-only scaffolding.
 */
function procedure(name: string): IndexedSymbol {
    return {
        name,
        kind: SymbolKind.Procedure,
        location: {
            uri: URI,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
        scope: { level: ScopeLevel.File },
        source: { type: SourceType.Workspace, uri: URI },
        completion: { label: name, kind: CompletionItemKind.Function },
        hover: { contents: { kind: "markdown", value: `procedure ${name}` } },
    } as IndexedSymbol;
}

/** A symbol that opts out of its instance's fold, as an SSL `#define` name does. */
function exactSymbol(name: string): IndexedSymbol {
    return { ...procedure(name), kind: SymbolKind.Macro, nameCase: "exact" } as IndexedSymbol;
}

describe("Symbols name-case policy", () => {
    it("resolves a case-divergent name when the language folds", () => {
        const index = new Symbols({ nameCase: "fold" });
        index.updateFile(normalizeUri(URI), [procedure("NOde005")]);

        expect(index.lookup("Node005")?.name).toBe("NOde005");
    });

    it("returns every case-divergent definition of one name when the language folds", () => {
        const index = new Symbols({ nameCase: "fold" });
        index.updateFile(normalizeUri(URI), [procedure("NOde005"), procedure("node005")]);

        expect(index.lookupAll("Node005").map((s) => s.name)).toEqual(["NOde005", "node005"]);
    });

    // SSL folds its own constructs but not preprocessor ones - sslc rejects `my_macro` against
    // `#define MY_MACRO` - so a symbol may opt out of a folding instance.
    it("keeps a symbol marked exact distinct even where the language folds", () => {
        const index = new Symbols({ nameCase: "fold" });
        index.updateFile(normalizeUri(URI), [exactSymbol("MY_MACRO")]);

        expect(index.lookup("my_macro")).toBeUndefined();
        expect(index.lookup("MY_MACRO")?.name).toBe("MY_MACRO");
    });

    it("folds around a symbol marked exact that shares its name key", () => {
        const index = new Symbols({ nameCase: "fold" });
        index.updateFile(normalizeUri(URI), [exactSymbol("NODE005"), procedure("NOde005")]);

        expect(index.lookupAll("node005").map((s) => s.name)).toEqual(["NOde005"]);
        expect(index.lookupAll("NODE005").map((s) => s.name)).toEqual(["NODE005", "NOde005"]);
    });

    // Counter-case: passes before the fold exists too, and is what goes red if the fold is ever made
    // unconditional. tp2 variables and D labels are genuinely case-sensitive.
    it("keeps case-divergent names distinct when the language compares exactly", () => {
        const index = new Symbols();
        index.updateFile(normalizeUri(URI), [procedure("NOde005")]);

        expect(index.lookup("Node005")).toBeUndefined();
        expect(index.lookup("NOde005")?.name).toBe("NOde005");
    });
});
