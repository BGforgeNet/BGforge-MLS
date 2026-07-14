/**
 * Real-parser test for weidu-d selection ranges - exercises WeiduDProvider
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

import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/weidu-d";
import { createSelectionRangesProvider } from "../../src/shared/selection-ranges";
import { expectWellFormedChain } from "../shared/selection-range-assertions";

beforeAll(async () => {
    await initParser();
});

const selectionRanges = createSelectionRangesProvider(isInitialized, parseWithCache);

describe("weidu-d selection ranges (real grammar)", () => {
    it("widens from the innermost SAY string out through the state's begin-action for a nested position", () => {
        const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello!~
END
`;
        // Cursor inside the "Hello!" string of the SAY action.
        const position = { line: 4, character: 10 };
        const [result] = selectionRanges(text, [position]);
        const chain = expectWellFormedChain(result as SelectionRange, position);

        // Real nesting: string -> say_action -> begin_action (state body) -> ... -> source_file.
        expect(chain.length).toBeGreaterThanOrEqual(3);
    });

    it("yields a short chain for a position outside any nested construct", () => {
        const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello!~
END
`;
        const position = { line: 2, character: 0 };
        const [result] = selectionRanges(text, [position]);
        expectWellFormedChain(result as SelectionRange, position);
    });
});
