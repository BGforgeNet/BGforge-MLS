/**
 * Real-parser test for weidu-tp2 selection ranges - exercises WeiduTp2Provider
 * against the actual tree-sitter grammar rather than only the shared factory's
 * mock nodes (server/test/shared/selection-ranges.test.ts).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { SelectionRange } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/weidu-tp2";
import { createSelectionRangesProvider } from "../../src/shared/selection-ranges";
import { expectWellFormedChain } from "../shared/selection-range-assertions";

beforeAll(async () => {
    await initParser();
});

const selectionRanges = createSelectionRangesProvider(isInitialized, parseWithCache);

describe("weidu-tp2 selection ranges (real grammar)", () => {
    it("widens from the innermost statement out through the function body for a nested position", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func BEGIN
    INT_VAR x = 1
END
`;
        // Cursor on the "1" literal in the INT_VAR declaration, inside the function body.
        const position = { line: 1, character: 16 };
        const [result] = selectionRanges(text, [position]);
        const chain = expectWellFormedChain(result as SelectionRange, position);

        // Real nesting: literal -> variable declaration -> function body -> function definition -> source_file.
        expect(chain.length).toBeGreaterThanOrEqual(3);
    });

    it("yields a short chain for a position outside any nested construct", () => {
        const text = `DEFINE_ACTION_FUNCTION my_func BEGIN
    INT_VAR x = 1
END
`;
        const position = { line: 2, character: 3 };
        const [result] = selectionRanges(text, [position]);
        expectWellFormedChain(result as SelectionRange, position);
    });
});
