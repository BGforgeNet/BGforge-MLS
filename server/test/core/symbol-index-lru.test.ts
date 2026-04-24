/**
 * LRU eviction tests for Symbols — verifies that the file index is bounded.
 *
 * Without a cap the index grows monotonically for every file opened in a
 * session, which causes unbounded memory growth on large (10k+ file)
 * workspaces.  These tests confirm eviction semantics: oldest-inserted file
 * is dropped when the index is full, and re-inserting an existing URI moves
 * it to "most-recent" position so it is not the next eviction candidate.
 */

import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type Symbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUri(n: number): string {
    return `file:///file${n}.ssl`;
}

function makeSymbol(name: string, uri: string): Symbol {
    return {
        name,
        kind: SymbolKind.Variable,
        location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
        },
        scope: { level: ScopeLevel.File },
        source: { type: SourceType.Document, uri },
        completion: { label: name, kind: CompletionItemKind.Variable },
        hover: { contents: { kind: "markdown", value: name } },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Symbols LRU cap", () => {
    it("evicts oldest file when maxFiles is exceeded", () => {
        // Cap at 3, insert 5 files — files 1 and 2 must be evicted.
        const index = new Symbols({ maxFiles: 3 });

        for (let i = 1; i <= 5; i++) {
            const uri = makeUri(i) as Parameters<typeof index.updateFile>[0];
            index.updateFile(uri, [makeSymbol(`sym${i}`, uri)]);
        }

        // Files 1 and 2 must be gone
        expect(index.getFileSymbols(makeUri(1) as Parameters<typeof index.getFileSymbols>[0])).toHaveLength(0);
        expect(index.getFileSymbols(makeUri(2) as Parameters<typeof index.getFileSymbols>[0])).toHaveLength(0);

        // Files 3, 4, 5 must survive
        expect(index.getFileSymbols(makeUri(3) as Parameters<typeof index.getFileSymbols>[0])).toHaveLength(1);
        expect(index.getFileSymbols(makeUri(4) as Parameters<typeof index.getFileSymbols>[0])).toHaveLength(1);
        expect(index.getFileSymbols(makeUri(5) as Parameters<typeof index.getFileSymbols>[0])).toHaveLength(1);
    });

    it("searchWorkspaceSymbols does not return symbols from evicted files", () => {
        const index = new Symbols({ maxFiles: 3 });

        for (let i = 1; i <= 5; i++) {
            const uri = makeUri(i) as Parameters<typeof index.updateFile>[0];
            index.updateFile(uri, [makeSymbol(`sym${i}`, uri)]);
        }

        const results = index.searchWorkspaceSymbols("");
        const names = results.map((r) => r.name);

        // Evicted symbols must not appear
        expect(names).not.toContain("sym1");
        expect(names).not.toContain("sym2");

        // Surviving symbols must appear
        expect(names).toContain("sym3");
        expect(names).toContain("sym4");
        expect(names).toContain("sym5");
    });

    it("re-inserting an existing URI refreshes its LRU position", () => {
        // With cap=3 and files 1,2,3 inserted, re-touch file 1, then insert
        // file 4.  File 2 (now oldest) must be evicted, not file 1.
        const index = new Symbols({ maxFiles: 3 });

        const uri1 = makeUri(1) as Parameters<typeof index.updateFile>[0];
        const uri2 = makeUri(2) as Parameters<typeof index.updateFile>[0];
        const uri3 = makeUri(3) as Parameters<typeof index.updateFile>[0];
        const uri4 = makeUri(4) as Parameters<typeof index.updateFile>[0];

        index.updateFile(uri1, [makeSymbol("sym1", makeUri(1))]);
        index.updateFile(uri2, [makeSymbol("sym2", makeUri(2))]);
        index.updateFile(uri3, [makeSymbol("sym3", makeUri(3))]);
        // Re-touch uri1 — it should move to "most recent"
        index.updateFile(uri1, [makeSymbol("sym1_updated", makeUri(1))]);
        // Insert a 4th distinct file — uri2 is now oldest
        index.updateFile(uri4, [makeSymbol("sym4", makeUri(4))]);

        // uri2 (oldest) must have been evicted
        expect(index.getFileSymbols(uri2)).toHaveLength(0);

        // uri1 was re-touched and must survive
        expect(index.getFileSymbols(uri1)).toHaveLength(1);
        expect(index.getFileSymbols(uri1)[0]?.name).toBe("sym1_updated");

        // uri3 and uri4 must survive
        expect(index.getFileSymbols(uri3)).toHaveLength(1);
        expect(index.getFileSymbols(uri4)).toHaveLength(1);
    });

    it("byName index does not include symbols from evicted files", () => {
        const index = new Symbols({ maxFiles: 2 });

        const uri1 = makeUri(1) as Parameters<typeof index.updateFile>[0];
        const uri2 = makeUri(2) as Parameters<typeof index.updateFile>[0];
        const uri3 = makeUri(3) as Parameters<typeof index.updateFile>[0];

        // All three files define the same symbol name "shared"
        index.updateFile(uri1, [makeSymbol("shared", makeUri(1))]);
        index.updateFile(uri2, [makeSymbol("shared", makeUri(2))]);
        index.updateFile(uri3, [makeSymbol("shared", makeUri(3))]);

        // uri1 must have been evicted; lookup must not return its entry
        const found = index.lookup("shared");
        expect(found?.source.uri).not.toBe(makeUri(1));
    });

    it("default maxFiles is 2000 (constructor with no options stores at least 2000 distinct URIs)", () => {
        // Smoke-test only: insert 2000 files; all must survive (no eviction yet).
        const index = new Symbols();

        for (let i = 1; i <= 2000; i++) {
            const uri = makeUri(i) as Parameters<typeof index.updateFile>[0];
            index.updateFile(uri, [makeSymbol(`sym${i}`, makeUri(i))]);
        }

        // Every one of those files should still be present
        const first = makeUri(1) as Parameters<typeof index.getFileSymbols>[0];
        const last = makeUri(2000) as Parameters<typeof index.getFileSymbols>[0];
        expect(index.getFileSymbols(first)).toHaveLength(1);
        expect(index.getFileSymbols(last)).toHaveLength(1);
    });
});
