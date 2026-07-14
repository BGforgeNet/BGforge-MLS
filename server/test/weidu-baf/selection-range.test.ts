/**
 * Real-parser test for weidu-baf selection ranges - exercises WeiduBafProvider
 * against the actual tree-sitter grammar rather than only the shared factory's
 * mock nodes (server/test/shared/selection-ranges.test.ts).
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import type { SelectionRange } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/weidu-baf";
import { createSelectionRangesProvider } from "../../src/shared/selection-ranges";
import { expectWellFormedChain } from "../shared/selection-range-assertions";

beforeAll(async () => {
    await initParser();
});

const selectionRanges = createSelectionRangesProvider(isInitialized, parseWithCache);

describe("weidu-baf selection ranges (real grammar)", () => {
    it("widens from the innermost call out through the response block for a nested position", () => {
        const text = `IF
  See(Player1)
THEN
  RESPONSE #100
    Attack(Player1)
END
`;
        // Cursor on "Player1" inside the RESPONSE action's call expression.
        const position = { line: 4, character: 12 };
        const [result] = selectionRanges(text, [position]);
        const chain = expectWellFormedChain(result as SelectionRange, position);

        // Real nesting: object_ref -> call_expr -> action -> response -> then_clause -> ...
        expect(chain.length).toBeGreaterThanOrEqual(3);
    });

    it("yields a short chain for a position outside any nested construct", () => {
        const text = `IF
  See(Player1)
THEN
  RESPONSE #100
    Attack(Player1)
END
`;
        const position = { line: 5, character: 0 };
        const [result] = selectionRanges(text, [position]);
        expectWellFormedChain(result as SelectionRange, position);
    });
});
