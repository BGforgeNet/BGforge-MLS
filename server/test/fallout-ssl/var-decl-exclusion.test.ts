/**
 * Unit tests for SSL declaration-site completion suppression.
 * Verifies that completions are suppressed when the cursor is on a new symbol name
 * being declared (procedure, variable, export variable, #define).
 */

import { describe, expect, it } from "vitest";
import { isSslDeclarationSite } from "../../src/fallout-ssl/completion-context";

/** Helper: builds single-line text and tests at end of line. */
function expectDeclaration(line: string, expected: boolean) {
    const position = { line: 0, character: line.length };
    expect(isSslDeclarationSite(line, position)).toBe(expected);
}

describe("SSL declaration-site detection", () => {
    describe("procedure declarations", () => {
        it("detects procedure with partial name", () => {
            expectDeclaration("procedure my_pr", true);
        });

        it("detects procedure with no name yet", () => {
            expectDeclaration("procedure ", true);
        });

        it("is case-insensitive", () => {
            expectDeclaration("Procedure MyProc", true);
            expectDeclaration("PROCEDURE P", true);
        });
    });

    describe("variable declarations", () => {
        it("detects variable with partial name", () => {
            expectDeclaration("variable my_var", true);
        });

        it("detects variable with no name yet", () => {
            expectDeclaration("variable ", true);
        });

        it("detects export variable", () => {
            expectDeclaration("export variable ev", true);
        });

        it("detects export variable with no name yet", () => {
            expectDeclaration("export variable ", true);
        });

        it("is case-insensitive for variable", () => {
            expectDeclaration("Variable x", true);
            expectDeclaration("EXPORT VARIABLE x", true);
        });
    });

    describe("#define declarations", () => {
        it("detects #define with partial name", () => {
            expectDeclaration("#define MY_CONST", true);
        });

        it("detects #define with no name yet", () => {
            expectDeclaration("#define ", true);
        });
    });

    describe("non-declaration positions (should NOT suppress)", () => {
        it("does not match inside procedure body", () => {
            expectDeclaration("  x := 5;", false);
        });

        it("does not match after := assignment", () => {
            expectDeclaration("variable x := val", false);
        });

        it("does not match function calls", () => {
            expectDeclaration("call my_func", false);
        });

        it("does not match empty line", () => {
            expectDeclaration("", false);
        });

        it("does not match comment lines", () => {
            expectDeclaration("// procedure foo", false);
        });

        it("does not match #define with value (past the name)", () => {
            // "#define NAME value" - cursor at end, NAME already has a space after it
            expectDeclaration("#define NAME 42", false);
        });
    });

    describe("multiline text with line/character positioning", () => {
        it("detects declaration on second line", () => {
            const text = "begin\nprocedure my_pr";
            const position = { line: 1, character: 16 };
            expect(isSslDeclarationSite(text, position)).toBe(true);
        });

        it("does not match first line when declaration is on second", () => {
            const text = "x := 5;\nprocedure my_pr";
            const position = { line: 0, character: 7 };
            expect(isSslDeclarationSite(text, position)).toBe(false);
        });

        it("returns false for out-of-range line", () => {
            const text = "procedure foo";
            const position = { line: 5, character: 0 };
            expect(isSslDeclarationSite(text, position)).toBe(false);
        });

        it("uses character offset to trim line", () => {
            // Full line: "variable x := 5" but cursor at position 10 => "variable x"
            const text = "variable x := 5";
            expect(isSslDeclarationSite(text, { line: 0, character: 10 })).toBe(true);
            // Full line considered - past the := sign
            expect(isSslDeclarationSite(text, { line: 0, character: 16 })).toBe(false);
        });
    });
});
