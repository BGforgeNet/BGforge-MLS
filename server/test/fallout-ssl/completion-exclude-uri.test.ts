/**
 * Tests that SSL getCompletions excludes symbols from the current URI.
 * Verifies consistency with TP2's excludeUri pattern (issue #5 from report.md).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { CompletionItem } from "vscode-languageserver/node";
import { type IndexedSymbol, SourceType } from "../../src/core/symbol";
import { FileIndex } from "../../src/core/file-index";
import { LANG_FALLOUT_SSL } from "../../../shared/languages";
import { normalizeUri } from "../../src/core/normalized-uri";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

vi.mock("../../src/cursor-utils", () => ({
    getLinePrefix: vi.fn(),
}));

vi.mock("../../src/diagnostics", () => ({
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

vi.mock("../../src/path-utils", () => ({
    findFiles: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/uri-utils", () => ({
    pathToUri: vi.fn(),
}));

function createSymbol(name: string, uri: string | null): IndexedSymbol {
    return {
        name,
        source: { type: uri ? SourceType.Workspace : SourceType.Static, uri },
        completion: { label: name },
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
        const fileIndex = new FileIndex(LANG_FALLOUT_SSL);
        const headerA = "file:///headers/a.h";
        const headerB = "file:///headers/b.h";

        fileIndex.symbols.updateFile(normalizeUri(headerA), [createSymbol("func_a", headerA)]);
        fileIndex.symbols.updateFile(normalizeUri(headerB), [createSymbol("func_b", headerB)]);

        // No public seam for fileIndex injection: the provider exposes no init/setter that
        // accepts a pre-populated FileIndex, so private access is required here.
        (provider as any).fileIndex = fileIndex;

        const completions = provider.getCompletions(headerA);
        const labels = completions.map((c) => c.label);

        expect(labels).toContain("func_b");
        expect(labels).not.toContain("func_a");
    });

    it("should include static symbols regardless of URI", () => {
        const fileIndex = new FileIndex(LANG_FALLOUT_SSL);
        const headerA = "file:///headers/a.h";

        fileIndex.loadStatic([createSymbol("builtin_func", null)]);
        fileIndex.symbols.updateFile(normalizeUri(headerA), [createSymbol("func_a", headerA)]);

        // No public seam for fileIndex injection: the provider exposes no init/setter that
        // accepts a pre-populated FileIndex, so private access is required here.
        (provider as any).fileIndex = fileIndex;

        const completions = provider.getCompletions(headerA);
        const labels = completions.map((c) => c.label);

        expect(labels).toContain("builtin_func");
        expect(labels).not.toContain("func_a");
    });
});
