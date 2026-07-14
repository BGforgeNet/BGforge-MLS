/**
 * Real-parser test for fallout-ssl selection ranges - exercises FalloutSslProvider
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

import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { createSelectionRangesProvider } from "../../src/shared/selection-ranges";
import { expectWellFormedChain } from "../shared/selection-range-assertions";

beforeAll(async () => {
    await initParser();
});

const selectionRanges = createSelectionRangesProvider(isInitialized, parseWithCache);

describe("fallout-ssl selection ranges (real grammar)", () => {
    it("widens from the innermost expression out through if/procedure for a nested position", () => {
        const text = `
procedure main begin
    if (1) then begin
        variable x;
        x := 1;
    end
end
`;
        // Cursor on the "1" literal inside the assignment, nested inside the if's block.
        const position = { line: 4, character: 13 };
        const [result] = selectionRanges(text, [position]);
        const chain = expectWellFormedChain(result as SelectionRange, position);

        // Real nesting: assignment expr -> block -> if_stmt -> procedure body -> procedure -> program.
        expect(chain.length).toBeGreaterThanOrEqual(3);
    });

    it("yields a short chain for a position outside any nested construct", () => {
        const text = `
procedure main begin
end
`;
        // Blank line between procedures - no nested construct contains it.
        const position = { line: 0, character: 0 };
        const [result] = selectionRanges(text, [position]);
        const chain = expectWellFormedChain(result as SelectionRange, position);

        expect(chain.length).toBeGreaterThanOrEqual(1);
    });

    it("returns one chain per requested position, in order", () => {
        const text = `
procedure first begin end
procedure second begin end
`;
        const positions = [
            { line: 1, character: 12 },
            { line: 2, character: 12 },
        ];
        const results = selectionRanges(text, positions);

        expect(results).toHaveLength(2);
        expectWellFormedChain(results[0] as SelectionRange, positions[0]!);
        expectWellFormedChain(results[1] as SelectionRange, positions[1]!);
    });
});
