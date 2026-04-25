/**
 * Unit tests for weidu-d/definition.ts - go to definition for state labels.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDefinition } from "../../src/weidu-d/definition";
import { initParser } from "../../../shared/parsers/weidu-d";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/definition", () => {
    describe("getDefinition()", () => {
        it("finds state label definition from goto_next transition", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello!~
    IF ~~ THEN GOTO target_state
END

IF ~~ THEN BEGIN target_state
    SAY ~You found me!~
END
`;
            const uri = "file:///test.d";
            // Cursor on "target_state" in GOTO
            const position: Position = { line: 5, character: 20 };
            const result = getDefinition(text, uri, position);

            expect(result).not.toBeNull();
            expect(result?.uri).toBe(uri);
            // Should point to target_state definition
            expect(result?.range.start.line).toBe(8);
        });

        it("finds state label definition from reply transition", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN state1
    SAY ~First~
    IF ~~ THEN REPLY ~Reply~ GOTO state2
END

IF ~~ THEN BEGIN state2
    SAY ~Second~
END
`;
            const uri = "file:///test.d";
            // Cursor on "state2" in GOTO within REPLY
            const position: Position = { line: 5, character: 38 };
            // This depends on specific grammar support for REPLY transitions
            // Just verify it doesn't crash
            expect(() => getDefinition(text, uri, position)).not.toThrow();
        });

        it("returns null when cursor is not on a state reference", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN state1
    SAY ~Hello!~
END
`;
            const uri = "file:///test.d";
            // Cursor on SAY keyword
            const position: Position = { line: 4, character: 5 };
            const result = getDefinition(text, uri, position);

            expect(result).toBeNull();
        });

        it("returns null for undefined state label", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN state1
    SAY ~Hello!~
    IF ~~ THEN GOTO nonexistent_state
END
`;
            const uri = "file:///test.d";
            // Cursor on "nonexistent_state" which is not defined
            const position: Position = { line: 5, character: 22 };
            const result = getDefinition(text, uri, position);

            expect(result).toBeNull();
        });

        it("handles states with numeric labels", () => {
            const text = `
BEGIN ~DIALOG~

IF ~True()~ THEN BEGIN 0
    SAY ~State zero~
    IF ~~ THEN GOTO 1
END

IF ~~ THEN BEGIN 1
    SAY ~State one~
END
`;
            const uri = "file:///test.d";
            // Cursor on "1" in GOTO - position may vary based on grammar
            const position: Position = { line: 5, character: 22 };
            // The grammar may or may not support numeric labels as references
            // Just verify it doesn't crash and returns a sensible result
            expect(() => getDefinition(text, uri, position)).not.toThrow();
        });

        it("handles CHAIN syntax without crashing", () => {
            // CHAIN syntax has different structure, test that parser handles it
            const chainText = `
BEGIN ~DIALOG~

CHAIN ~DIALOG~ start
    ~Hello~
== ~DIALOG~ next_state
    ~Goodbye~
END
`;
            const chainUri = "file:///chain.d";
            // Even if no state references are found, it should not crash
            expect(() => getDefinition(chainText, chainUri, { line: 0, character: 0 })).not.toThrow();
        });

        it("returns null when parser not initialized with bad text", () => {
            // This tests the early return when parsing fails
            const text = "{{{{invalid d syntax";
            const uri = "file:///test.d";
            const position: Position = { line: 0, character: 0 };
            const result = getDefinition(text, uri, position);

            // Should gracefully handle parse error
            expect(result).toBeNull();
        });
    });
});
