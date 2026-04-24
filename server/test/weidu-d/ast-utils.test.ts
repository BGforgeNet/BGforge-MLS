/**
 * Unit tests for weidu-d/ast-utils.ts - comment detection for shouldProvideFeatures.
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

import { isInsideComment } from "../../src/weidu-d/ast-utils";
import { initParser } from "../../src/weidu-d/parser";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/ast-utils", () => {
    describe("isInsideComment()", () => {
        const text = `
BEGIN ~DIALOG~
/* block comment */
// line comment
IF ~True()~ THEN BEGIN start_state
    SAY ~Hello world~
    IF ~~ THEN GOTO next_state
END
`;

        it("returns true for position inside a block comment", () => {
            // line 2: "/* block comment */" - position on "block"
            expect(isInsideComment(text, Position.create(2, 5))).toBe(true);
        });

        it("returns true for position inside a line comment", () => {
            // line 3: "// line comment" - position on "line"
            expect(isInsideComment(text, Position.create(3, 5))).toBe(true);
        });

        it("returns false for position on a keyword", () => {
            // line 4: "IF ~True()~ THEN BEGIN start_state" - position on "IF"
            expect(isInsideComment(text, Position.create(4, 0))).toBe(false);
        });

        it("returns false for position on a state label", () => {
            // line 4: "IF ~True()~ THEN BEGIN start_state" - position on "start_state"
            expect(isInsideComment(text, Position.create(4, 25))).toBe(false);
        });

        it("returns false for position inside a string literal", () => {
            // line 5: "    SAY ~Hello world~" - position on "Hello"
            expect(isInsideComment(text, Position.create(5, 10))).toBe(false);
        });

        it("returns false for position on SAY keyword", () => {
            // line 5: "    SAY ~Hello world~"
            expect(isInsideComment(text, Position.create(5, 4))).toBe(false);
        });

        it("returns true inside block comment near start", () => {
            // line 2: "/* block comment */" - position after "/*"
            expect(isInsideComment(text, Position.create(2, 3))).toBe(true);
        });

        it("returns true inside block comment near end", () => {
            // line 2: "/* block comment */" - position on the closing "*/"
            expect(isInsideComment(text, Position.create(2, 17))).toBe(true);
        });
    });
});
