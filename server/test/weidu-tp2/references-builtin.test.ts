/**
 * Tests for findReferences behavior with built-in/static TP2 symbols.
 * Built-in keywords like DECOMPILE_AND_PATCH should return empty results
 * since they are not user-defined symbols.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser, parseWithCache } from "../../../shared/parsers/weidu-tp2";
import { findReferences } from "../../src/weidu-tp2/references";
import { getSymbolAtPosition } from "../../src/weidu-tp2/symbol-discovery";

const TEST_URI = "file:///test.tp2";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/references with built-in symbols", () => {
    const text = `
COPY_EXISTING ~foo.itm~ ~override~
  DECOMPILE_AND_PATCH
    BEGIN
    END
`;

    it("getSymbolAtPosition should return null for DECOMPILE_AND_PATCH keyword", () => {
        const tree = parseWithCache(text)!;
        // cursor on DECOMPILE_AND_PATCH, line 2
        const symbolInfo = getSymbolAtPosition(tree!.rootNode, { line: 2, character: 5 });
        expect(symbolInfo).toBeNull();
    });

    it("findReferences returns empty for DECOMPILE_AND_PATCH keyword", () => {
        const refs = findReferences(text, { line: 2, character: 5 }, TEST_URI, true);
        expect(refs).toHaveLength(0);
    });

    it("getSymbolAtPosition should return null for COPY_EXISTING keyword", () => {
        const tree = parseWithCache(text)!;
        const symbolInfo = getSymbolAtPosition(tree!.rootNode, { line: 1, character: 5 });
        expect(symbolInfo).toBeNull();
    });

    it("findReferences returns empty for COPY_EXISTING keyword", () => {
        const refs = findReferences(text, { line: 1, character: 5 }, TEST_URI, true);
        expect(refs).toHaveLength(0);
    });
});
