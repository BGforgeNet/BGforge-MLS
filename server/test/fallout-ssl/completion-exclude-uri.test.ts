/**
 * Tests that SSL getCompletions excludes symbols from the current URI.
 * Verifies consistency with TP2's excludeUri pattern (issue #5 from report.md).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { CompletionItem } from "vscode-languageserver/node";
import { type IndexedSymbol, SourceType } from "../../src/core/symbol";
import { FileIndex } from "../../src/core/file-index";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err) => (err instanceof Error ? err.message : String(err)),
    findFiles: vi.fn().mockReturnValue([]),
    getLinePrefix: vi.fn(),
    pathToUri: vi.fn(),
}));

function createSymbol(name: string, uri: string | null): IndexedSymbol {
    return {
        name,
        source: { type: uri ? SourceType.Workspace : SourceType.Static, uri },
        completion: { label: name } as CompletionItem,
        hover: { contents: "" },
        location: null,
    } as IndexedSymbol;
}

describe("SSL getCompletions excludeUri", () => {
    let provider: { getCompletions(uri: string): CompletionItem[] };

    beforeAll(async () => {
        const mod = await import("../../src/fallout-ssl/provider");
        provider = mod.falloutSslProvider as unknown as typeof provider;
    });

    it("should exclude symbols from the given URI", () => {
        const fileIndex = new FileIndex();
        const headerA = "file:///headers/a.h";
        const headerB = "file:///headers/b.h";

        fileIndex.symbols.updateFile(headerA, [createSymbol("func_a", headerA)]);
        fileIndex.symbols.updateFile(headerB, [createSymbol("func_b", headerB)]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only: inject mock fileIndex
        (provider as any).fileIndex = fileIndex;

        const completions = provider.getCompletions(headerA);
        const labels = completions.map((c) => c.label);

        expect(labels).toContain("func_b");
        expect(labels).not.toContain("func_a");
    });

    it("should include static symbols regardless of URI", () => {
        const fileIndex = new FileIndex();
        const headerA = "file:///headers/a.h";

        fileIndex.loadStatic([createSymbol("builtin_func", null)]);
        fileIndex.symbols.updateFile(headerA, [createSymbol("func_a", headerA)]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only: inject mock fileIndex
        (provider as any).fileIndex = fileIndex;

        const completions = provider.getCompletions(headerA);
        const labels = completions.map((c) => c.label);

        expect(labels).toContain("builtin_func");
        expect(labels).not.toContain("func_a");
    });
});
