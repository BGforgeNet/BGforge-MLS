/**
 * Integration tests for Symbols - verifies new implementation matches existing.
 *
 * These tests load actual static data and compare outputs between:
 * - Old approach: Language class with separate completion/hover data
 * - New approach: Symbols with unified IndexedSymbol storage
 */

import { describe, expect, it, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { type CompletionItem, CompletionItemKind, type Hover, type MarkupContent } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { type IndexedSymbol, SymbolKind, ScopeLevel, SourceType } from "../../src/core/symbol";

// Path to generated JSON files (server/out/)
const OUT_DIR = path.join(__dirname, "../../out");

/**
 * Category to SymbolKind mapping (same as in static-loader.ts)
 */
const CATEGORY_TO_KIND: Record<string, SymbolKind> = {
    actions: SymbolKind.Action,
    triggers: SymbolKind.Trigger,
    keywords: SymbolKind.Constant,
    functions: SymbolKind.Function,
    procedures: SymbolKind.Procedure,
    macros: SymbolKind.Macro,
    variables: SymbolKind.Variable,
    constants: SymbolKind.Constant,
};

/**
 * Convert completion item to IndexedSymbol (for testing)
 */
function completionToSymbol(item: CompletionItem & { category?: string }): IndexedSymbol {
    const name = item.label;

    // Determine SymbolKind from category
    let kind = SymbolKind.Variable;
    if (item.category && CATEGORY_TO_KIND[item.category]) {
        kind = CATEGORY_TO_KIND[item.category];
    } else if (item.kind === CompletionItemKind.Function) {
        kind = SymbolKind.Function;
    } else if (item.kind === CompletionItemKind.Keyword) {
        kind = SymbolKind.Constant;
    }

    // Extract hover from documentation
    let hoverContents: MarkupContent;
    if (item.documentation) {
        if (typeof item.documentation === "string") {
            hoverContents = { kind: "markdown", value: item.documentation };
        } else {
            hoverContents = item.documentation as MarkupContent;
        }
    } else {
        hoverContents = { kind: "markdown", value: name };
    }

    // Dynamic `kind` means no single literal can satisfy the IndexedSymbol
    // discriminated union, so cast. `Symbols` does not inspect the variant
    // field at runtime, and this helper is test-only scaffolding.
    return {
        name,
        kind,
        location: null, // Static symbols have no source file
        scope: { level: ScopeLevel.Global },
        source: { type: SourceType.Static, uri: null },
        completion: {
            label: name,
            // Preserve original completion kind from JSON (for compatibility testing)
            kind: item.kind,
            documentation: item.documentation,
            detail: item.detail,
            tags: item.tags,
        },
        hover: { contents: hoverContents },
    } as IndexedSymbol;
}

describe("Symbols integration", () => {
    // Skip if data files don't exist (not built)
    const completionFile = path.join(OUT_DIR, "completion.weidu-baf.json");
    const hoverFile = path.join(OUT_DIR, "hover.weidu-baf.json");

    const dataFilesExist = fs.existsSync(completionFile) && fs.existsSync(hoverFile);

    describe.skipIf(!dataFilesExist)("weidu-baf static data", () => {
        let oldCompletions: (CompletionItem & { category?: string })[];
        let oldHover: Map<string, Hover>;
        let symbols: Symbols;

        beforeAll(() => {
            // Load old-style data
            oldCompletions = JSON.parse(fs.readFileSync(completionFile, "utf-8"));
            const hoverData = JSON.parse(fs.readFileSync(hoverFile, "utf-8")) as Record<string, Hover>;
            oldHover = new Map(Object.entries(hoverData));

            // Convert old completion items to symbols and load into index
            symbols = new Symbols();
            const convertedSymbols = oldCompletions.map((item) => completionToSymbol(item));
            symbols.loadStatic(convertedSymbols);
        });

        it("should have the same number of completion items", () => {
            const newCompletions = symbols.query({});
            expect(newCompletions.length).toBe(oldCompletions.length);
        });

        it("should have matching completion labels", () => {
            const newCompletions = symbols.query({});
            const oldLabels = new Set(oldCompletions.map((c) => c.label));
            const newLabels = new Set(newCompletions.map((s) => s.name));

            // Check that all old labels exist in new
            for (const label of oldLabels) {
                expect(newLabels.has(label), `Missing label: ${label}`).toBe(true);
            }

            // Check that all new labels exist in old
            for (const label of newLabels) {
                expect(oldLabels.has(label), `Extra label: ${label}`).toBe(true);
            }
        });

        it("should have matching completion kinds", () => {
            const newCompletions = symbols.query({});
            const newByLabel = new Map(newCompletions.map((s) => [s.name, s]));

            for (const oldItem of oldCompletions) {
                const newSymbol = newByLabel.get(oldItem.label);
                expect(newSymbol, `Missing symbol: ${oldItem.label}`).toBeDefined();

                // Compare completion kind
                expect(newSymbol!.completion.kind).toBe(oldItem.kind);
            }
        });

        it("should have matching hover content for symbols with documentation", () => {
            // Names that appear in multiple stanzas (e.g., Help as action + trigger)
            // have merged hover content in hover.json. Collect overloaded names.
            const nameCounts = new Map<string, number>();
            for (const item of oldCompletions) {
                nameCounts.set(item.label, (nameCounts.get(item.label) ?? 0) + 1);
            }

            for (const [name, oldHoverItem] of oldHover) {
                const symbol = symbols.lookup(name);
                expect(symbol, `Missing symbol for hover: ${name}`).toBeDefined();

                const oldContent = oldHoverItem.contents as MarkupContent;
                const newContent = symbol!.hover.contents as MarkupContent;

                // Both should be markdown
                expect(newContent.kind).toBe(oldContent.kind);

                if ((nameCounts.get(name) ?? 0) > 1) {
                    // Overloaded: hover.json has merged content from all stanzas.
                    // The symbol's hover (from first completion entry) should be
                    // contained within the merged hover. We only check merged ⊃ single
                    // (not exact equality) because the symbol system returns the first
                    // stanza's hover, while merged hover combines all stanzas.
                    expect(oldContent.value).toContain(newContent.value);
                } else {
                    // Unique name: exact match
                    expect(newContent.value).toBe(oldContent.value);
                }
            }
        });

        it("should lookup symbol by exact name", () => {
            // Test a few known symbols
            const knownSymbols = ["IF", "THEN", "ActionOverride", "Activate"];

            for (const name of knownSymbols) {
                const symbol = symbols.lookup(name);
                expect(symbol, `Should find symbol: ${name}`).toBeDefined();
                expect(symbol!.name).toBe(name);
            }
        });

        it("should query symbols by prefix", () => {
            // Query all symbols starting with "Action"
            const results = symbols.query({ prefix: "Action" });

            expect(results.length).toBeGreaterThan(0);
            for (const symbol of results) {
                expect(symbol.name.toLowerCase().startsWith("action")).toBe(true);
            }
        });

        it("should return completion items with preserved documentation", () => {
            // Find an action with documentation
            const actionSymbol = symbols.lookup("ActionOverride");
            expect(actionSymbol).toBeDefined();

            const completion = actionSymbol!.completion;
            expect(completion.documentation).toBeDefined();

            const doc = completion.documentation as MarkupContent;
            expect(doc.kind).toBe("markdown");
            expect(doc.value).toContain("ActionOverride");
        });
    });

    describe("query operations", () => {
        let symbols: Symbols;

        beforeAll(() => {
            symbols = new Symbols();

            // Load actual data if available, otherwise skip
            if (dataFilesExist) {
                const completions = JSON.parse(fs.readFileSync(completionFile, "utf-8")) as (CompletionItem & {
                    category?: string;
                })[];
                const convertedSymbols = completions.map((item) => completionToSymbol(item));
                symbols.loadStatic(convertedSymbols);
            }
        });

        it.skipIf(!dataFilesExist)("should support prefix filtering", () => {
            const withPrefix = symbols.query({ prefix: "Add" });
            const withoutPrefix = symbols.query({});

            expect(withPrefix.length).toBeLessThan(withoutPrefix.length);
            for (const symbol of withPrefix) {
                expect(symbol.name.toLowerCase().startsWith("add")).toBe(true);
            }
        });

        it.skipIf(!dataFilesExist)("should support limit", () => {
            const limited = symbols.query({ limit: 10 });
            expect(limited.length).toBe(10);
        });

        it.skipIf(!dataFilesExist)("should support kind filtering", () => {
            // weidu-baf only has actions and keywords (no triggers category)
            const actions = symbols.query({ kinds: [SymbolKind.Action] });
            const constants = symbols.query({ kinds: [SymbolKind.Constant] });

            expect(actions.length).toBeGreaterThan(0);
            expect(constants.length).toBeGreaterThan(0);

            for (const symbol of actions) {
                expect(symbol.kind).toBe(SymbolKind.Action);
            }

            for (const symbol of constants) {
                expect(symbol.kind).toBe(SymbolKind.Constant);
            }
        });
    });
});
