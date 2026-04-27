/**
 * Branch-coverage tests for weidu-tp2/local-symbols.ts.
 *
 * Covers the cache lifecycle paths (per-URI clear, clear-all, version
 * bypass) that the higher-level hover/completion tests don't reach.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../../shared/parsers/weidu-tp2";
import {
    clearAllLocalSymbolsCache,
    clearLocalSymbolsCache,
    getLocalSymbols,
    lookupLocalSymbol,
} from "../../src/weidu-tp2/local-symbols";

beforeAll(async () => {
    await initParser();
});

const URI_A = "file:///test-a.tp2";
const URI_B = "file:///test-b.tp2";

const SAMPLE = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
DEFINE_PATCH_MACRO my_macro BEGIN END
OUTER_SET my_var = 5
`;

describe("weidu-tp2 local-symbols cache lifecycle", () => {
    it("getLocalSymbols returns symbols for a parsed document", () => {
        const symbols = getLocalSymbols(SAMPLE, 1, URI_A);
        expect(symbols.length).toBeGreaterThan(0);
        expect(symbols.some((s) => s.name === "my_func")).toBe(true);
    });

    it("lookupLocalSymbol finds a symbol by exact name", () => {
        const sym = lookupLocalSymbol("my_func", SAMPLE, 1, URI_A);
        expect(sym).toBeDefined();
        expect(sym!.name).toBe("my_func");
    });

    it("lookupLocalSymbol returns undefined for an unknown name", () => {
        const sym = lookupLocalSymbol("does_not_exist", SAMPLE, 1, URI_A);
        expect(sym).toBeUndefined();
    });

    it("getLocalSymbols with version=undefined bypasses cache and re-parses", () => {
        // Two calls with version=undefined exercise the cache-bypass path.
        const first = getLocalSymbols(SAMPLE, undefined, URI_A);
        const second = getLocalSymbols(SAMPLE, undefined, URI_A);
        expect(first.length).toBe(second.length);
    });

    it("clearLocalSymbolsCache(uri) removes only the named entry", () => {
        getLocalSymbols(SAMPLE, 1, URI_A);
        getLocalSymbols(SAMPLE, 1, URI_B);
        clearLocalSymbolsCache(URI_A);
        // Both URIs still return correct results — re-parse on miss
        expect(getLocalSymbols(SAMPLE, 2, URI_A).length).toBeGreaterThan(0);
        expect(getLocalSymbols(SAMPLE, 1, URI_B).length).toBeGreaterThan(0);
    });

    it("clearAllLocalSymbolsCache wipes every entry", () => {
        getLocalSymbols(SAMPLE, 1, URI_A);
        getLocalSymbols(SAMPLE, 1, URI_B);
        clearAllLocalSymbolsCache();
        expect(getLocalSymbols(SAMPLE, 2, URI_A).length).toBeGreaterThan(0);
        expect(getLocalSymbols(SAMPLE, 2, URI_B).length).toBeGreaterThan(0);
    });

    it("getLocalSymbols returns an empty array for empty input", () => {
        const symbols = getLocalSymbols("", 1, URI_A);
        expect(symbols).toEqual([]);
    });
});
