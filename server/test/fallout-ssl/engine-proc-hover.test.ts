/**
 * Tests for engine procedure hover enrichment in Fallout SSL.
 * Engine procedures (map_enter_p_proc, etc.) should have built-in engine doc
 * appended to the hover, after any user JSDoc.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { lookupLocalSymbol, clearAllLocalSymbolsCache } from "../../src/fallout-ssl/local-symbols";
import { initParser } from "../../src/fallout-ssl/parser";

const TEST_URI = "file:///mymod/scripts/test.ssl";

describe("fallout-ssl engine procedure hover enrichment", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("appends engine doc to hover when user has no JSDoc", () => {
        const text = `
procedure map_enter_p_proc begin
end
`;
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("map_enter_p_proc", text, 1, TEST_URI);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { value: string }).value;

        // Engine doc must be present
        expect(value).toContain("Called once by the engine");
        // No separator when there's no user JSDoc
        expect(value).not.toContain("---");
    });

    it("appends engine doc after separator when user has JSDoc", () => {
        const text = `
/**
 * My custom description.
 */
procedure map_enter_p_proc begin
end
`;
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("map_enter_p_proc", text, 1, TEST_URI);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { value: string }).value;

        // User JSDoc must be present
        expect(value).toContain("My custom description.");
        // Engine doc must follow
        expect(value).toContain("Called once by the engine");
        // Engine doc must appear after user doc
        const userDocPos = value.indexOf("My custom description.");
        const engineDocPos = value.indexOf("Called once by the engine");
        expect(engineDocPos).toBeGreaterThan(userDocPos);
        // There must be a separator (my \n\n---\n\n) between them — check the specific form
        const between = value.slice(userDocPos, engineDocPos);
        expect(between).toContain("---");
    });

    it("does not append engine doc for non-engine procedures", () => {
        const text = `
procedure my_custom_proc begin
end
`;
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("my_custom_proc", text, 1, TEST_URI);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { value: string }).value;

        // No engine doc, no separator
        expect(value).not.toContain("Called once by the engine");
        expect(value).not.toContain("---");
    });

    it("appends engine doc for map_exit_p_proc", () => {
        const text = `
procedure map_exit_p_proc begin
end
`;
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("map_exit_p_proc", text, 1, TEST_URI);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { value: string }).value;

        expect(value).toContain("Called when the player leaves the map");
    });

    it("appends engine doc for start procedure", () => {
        const text = `
procedure start begin
end
`;
        clearAllLocalSymbolsCache();
        const symbol = lookupLocalSymbol("start", text, 1, TEST_URI);

        expect(symbol).toBeDefined();
        const contents = symbol?.hover?.contents;
        expect(contents).toBeDefined();
        const value = (contents as { value: string }).value;

        expect(value).toContain("Called by the engine when the script is first run");
    });
});
