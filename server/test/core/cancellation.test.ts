/**
 * Tests for CancellationToken plumbing in hot-loop paths.
 *
 * Verifies that:
 * - searchWorkspaceSymbols returns early when token is pre-cancelled.
 * - ProviderRegistry.workspaceSymbols returns empty without calling providers when cancelled.
 * - ProviderRegistry.references returns empty when token is pre-cancelled.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { CancellationTokenSource, CompletionItemKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import {
    type IndexedSymbol,
    SymbolKind,
    ScopeLevel,
    SourceType,
} from "../../src/core/symbol";
import { normalizeUri } from "../../src/core/normalized-uri";
import type { LanguageProvider } from "../../src/language-provider";

// =============================================================================
// Mocks (required for provider-registry which uses conlog / file I/O)
// =============================================================================

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    findFiles: vi.fn().mockReturnValue([]),
    pathToUri: vi.fn((p: string) => `file://${p}`),
}));

vi.mock("node:fs", () => ({
    readFileSync: vi.fn(() => ""),
}));

vi.mock("node:fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue(""),
}));

// =============================================================================
// Helpers
// =============================================================================

function makeSymbol(name: string): IndexedSymbol {
    const uri = "file:///workspace/a.ssl";
    return {
        name,
        kind: SymbolKind.Procedure,
        location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
        },
        scope: { level: ScopeLevel.Workspace },
        source: { type: SourceType.Navigation, uri, displayPath: "a.ssl" },
        completion: { label: name, kind: CompletionItemKind.Function },
        hover: { contents: { kind: "markdown", value: name } },
    } as IndexedSymbol;
}

function cancelledToken() {
    const src = new CancellationTokenSource();
    src.cancel();
    return src.token;
}

// =============================================================================
// Test: Symbols.searchWorkspaceSymbols with pre-cancelled token
// =============================================================================

describe("Symbols.searchWorkspaceSymbols — cancellation", () => {
    let index: Symbols;

    beforeEach(() => {
        index = new Symbols();
        // Populate with enough symbols to exercise the loop
        for (let i = 0; i < 10; i++) {
            const sym = makeSymbol(`proc_${i}`);
            index.updateFile(normalizeUri("file:///workspace/a.ssl"), [sym]);
        }
    });

    it("returns empty array when token is pre-cancelled", () => {
        const token = cancelledToken();
        const results = index.searchWorkspaceSymbols("", 500, token);
        expect(results).toEqual([]);
    });

    it("returns results when token is not cancelled", () => {
        const src = new CancellationTokenSource();
        const results = index.searchWorkspaceSymbols("proc_", 500, src.token);
        expect(results.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Test: ProviderRegistry.workspaceSymbols with pre-cancelled token
// =============================================================================

describe("ProviderRegistry.workspaceSymbols — cancellation", () => {
    async function createRegistry() {
        vi.resetModules();
        return import("../../src/provider-registry").then((m) => m.registry);
    }

    function createMockProvider(id: string, features: Partial<LanguageProvider> = {}): LanguageProvider {
        return {
            id,
            init: vi.fn().mockResolvedValue(undefined),
            ...features,
        };
    }

    it("returns empty without calling provider.workspaceSymbols when token is pre-cancelled", async () => {
        const registry = await createRegistry();
        const workspaceSymbolsFn = vi.fn().mockReturnValue([{ name: "sym" }]);
        const provider = createMockProvider("test-lang", {
            workspaceSymbols: workspaceSymbolsFn,
        });
        registry.register(provider);

        const token = cancelledToken();
        const results = registry.workspaceSymbols("", token);

        expect(results).toEqual([]);
        expect(workspaceSymbolsFn).not.toHaveBeenCalled();
    });
});

// =============================================================================
// Test: ProviderRegistry.references with pre-cancelled token
// =============================================================================

describe("ProviderRegistry.references — cancellation", () => {
    async function createRegistry() {
        vi.resetModules();
        return import("../../src/provider-registry").then((m) => m.registry);
    }

    function createMockProvider(id: string, features: Partial<LanguageProvider> = {}): LanguageProvider {
        return {
            id,
            init: vi.fn().mockResolvedValue(undefined),
            ...features,
        };
    }

    it("returns empty without calling provider.references when token is pre-cancelled", async () => {
        const registry = await createRegistry();
        const referencesFn = vi.fn().mockReturnValue([{ uri: "file:///a.ssl", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }]);
        const provider = createMockProvider("test-lang", {
            references: referencesFn,
        });
        registry.register(provider);

        const token = cancelledToken();
        const results = registry.references(
            "test-lang",
            "text content",
            { line: 0, character: 0 },
            "file:///a.ssl",
            true,
            token,
        );

        expect(results).toEqual([]);
        expect(referencesFn).not.toHaveBeenCalled();
    });
});
