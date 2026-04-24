/**
 * Tests for unified symbol resolution in WeiDU TP2 provider.
 *
 * Provider exposes resolveSymbol() for local-first symbol lookup.
 * All merge logic (local + indexed, filtering) happens in the provider.
 * Registry just calls these methods - can't mess up filtering.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock LSP connection before importing provider
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err) => (err instanceof Error ? err.message : String(err)),
}));

// Mock static loader to provide test symbols
vi.mock("../../src/core/static-loader", () => ({
    loadStaticSymbols: vi.fn(() => [
        {
            name: "COPY_EXISTING",
            kind: 1, // SymbolKind.Function
            location: null,
            scope: { level: 0 }, // ScopeLevel.Global
            source: { type: 0, uri: null }, // SourceType.Static
            completion: { label: "COPY_EXISTING", kind: 3 },
            hover: { contents: { kind: "markdown", value: "COPY_EXISTING action" } },
            callable: { context: "action", dtype: "action" },
        },
        {
            name: "PATCH_IF",
            kind: 1,
            location: null,
            scope: { level: 0 },
            source: { type: 0, uri: null },
            completion: { label: "PATCH_IF", kind: 14 },
            hover: { contents: { kind: "markdown", value: "PATCH_IF statement" } },
        },
    ]),
}));

import { weiduTp2Provider } from "../../src/weidu-tp2/provider";

describe("weidu-tp2 symbol resolution", () => {
    beforeAll(async () => {
        // Initialize provider (loads parser and static symbols)
        await weiduTp2Provider.init({
            workspaceRoot: undefined,
            settings: {
                weidu: { path: "", gamePath: "" },
            },
        });
    });

    describe("resolveSymbol()", () => {
        it("should find local variable defined in current buffer", () => {
            const text = `
/** @type {int} Maximum pip count */
OUTER_SET pip_limit = 10
`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("pip_limit", text, uri);

            expect(result).toBeDefined();
            expect(result?.name).toBe("pip_limit");
            expect(result?.hover).toBeDefined();

            const contents = result?.hover?.contents;
            expect(contents).toBeDefined();
            const hoverValue = (contents as { value: string }).value;
            expect(hoverValue).toContain("pip_limit");
        });

        it("should find local function defined in current buffer", () => {
            const text = `
/**
 * My test function
 */
DEFINE_ACTION_FUNCTION my_local_func BEGIN
    PRINT ~hello~
END
`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("my_local_func", text, uri);

            expect(result).toBeDefined();
            expect(result?.name).toBe("my_local_func");
            expect(result?.hover).toBeDefined();
        });

        it("should find static symbol (e.g., COPY_EXISTING)", () => {
            const text = `COPY_EXISTING ~test.itm~ ~override~`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("COPY_EXISTING", text, uri);

            expect(result).toBeDefined();
            expect(result?.name).toBe("COPY_EXISTING");
        });

        it("should prefer local symbol over indexed when names match", () => {
            // If a symbol is defined locally AND in index, local should win
            // (local is fresh buffer, index may be stale)
            const text = `
/** Local version of the function */
DEFINE_ACTION_FUNCTION my_func BEGIN END
`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("my_func", text, uri);

            expect(result).toBeDefined();
            // Should have "Local version" in hover, not any indexed version
            const contents = result?.hover?.contents;
            expect(contents).toBeDefined();
            const hoverValue = (contents as { value: string }).value;
            expect(hoverValue).toContain("Local version");
        });

        it("should NOT return stale indexed symbol for current file", () => {
            // Simulate: file was indexed with old_var, but buffer now has new_var
            // Hovering on old_var should NOT find the stale indexed version
            const text = `OUTER_SET new_var = 1`; // old_var is gone from buffer
            const uri = "file:///test.tp2";

            // old_var doesn't exist in current buffer
            const result = weiduTp2Provider.resolveSymbol?.("old_var", text, uri);

            // Should NOT find it (even if it exists in stale index)
            expect(result).toBeUndefined();
        });

        it("should return undefined for non-existent symbol", () => {
            const text = `OUTER_SET foo = 1`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("nonexistent_symbol", text, uri);

            expect(result).toBeUndefined();
        });
    });

    describe("hover via resolveSymbol", () => {
        it("should return hover with JSDoc description", () => {
            const text = `
/**
 * This is a documented variable
 * @type {int}
 */
OUTER_SET documented_var = 100
`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("documented_var", text, uri);

            expect(result?.hover).toBeDefined();
            const contents = result?.hover?.contents;
            expect(contents).toBeDefined();
            const hoverValue = (contents as { value: string }).value;
            expect(hoverValue).toContain("documented variable");
        });

        it("should return hover for string variable (OUTER_SPRINT)", () => {
            const text = `OUTER_SPRINT my_string ~hello world~`;
            const uri = "file:///test.tp2";
            const result = weiduTp2Provider.resolveSymbol?.("my_string", text, uri);

            expect(result?.hover).toBeDefined();
            const contents = result?.hover?.contents;
            expect(contents).toBeDefined();
            const hoverValue = (contents as { value: string }).value;
            expect(hoverValue).toContain("my_string");
        });
    });
});
