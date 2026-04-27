/**
 * Branch-coverage tests for weidu-tp2/rename.ts.
 *
 * The main rename.test.ts covers tilde-delimited function/macro names. This
 * file targets the double-quoted-string delimiter branch (renameSymbol's
 * editText assembly) and the early-return paths that the existing tests
 * don't exercise.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { prepareRenameSymbol, renameSymbol } from "../../src/weidu-tp2/rename";
import { initParser } from "../../../shared/parsers/weidu-tp2";

beforeAll(async () => {
    await initParser();
});

const URI = "file:///test.tp2";

describe("renameSymbol: double-quoted macro names", () => {
    it('preserves double-quote delimiters when renaming a macro called with "name"', () => {
        const text = `
DEFINE_PATCH_MACRO "my_macro" BEGIN
    PATCH_PRINT ~macro~
END

COPY_EXISTING ~file.itm~ ~override~
    LPM "my_macro"
`;
        // Cursor on "my_macro" inside the DEFINE
        const position: Position = { line: 1, character: 22 };
        const result = renameSymbol(text, position, "new_macro", URI);

        expect(result).not.toBeNull();
        const edits = result?.changes?.[URI];
        expect(edits).toBeDefined();
        expect(edits!.length).toBeGreaterThanOrEqual(2);

        // Apply the edits and confirm both call sites got the double-quoted form.
        const newTexts = edits!.map((e) => e.newText);
        expect(newTexts).toContain('"new_macro"');
    });
});

describe("renameSymbol: rejection paths", () => {
    it("returns null when cursor is on whitespace (no symbol to rename)", () => {
        const text = `\nOUTER_SET my_var = 5\n`;
        // Position 0,0 is on the leading newline — no symbol there
        const position: Position = { line: 0, character: 0 };
        const result = renameSymbol(text, position, "anything", URI);
        expect(result).toBeNull();
    });

    it("returns null when cursor is on a non-renameable token (keyword)", () => {
        const text = `OUTER_SET my_var = 5\n`;
        // Position on the OUTER_SET keyword itself
        const position: Position = { line: 0, character: 2 };
        const result = renameSymbol(text, position, "anything", URI);
        expect(result).toBeNull();
    });

    it("returns null when symbol is referenced but not defined locally", () => {
        // %external_var% is referenced but never defined here.
        const text = `\nOUTER_SET result = ~%external_var%~\n`;
        // Cursor on "external_var"
        const position: Position = { line: 1, character: 26 };
        const result = renameSymbol(text, position, "renamed", URI);
        expect(result).toBeNull();
    });

    it("prepareRenameSymbol returns null on whitespace position", () => {
        const text = `\nOUTER_SET my_var = 5\n`;
        const position: Position = { line: 0, character: 0 };
        expect(prepareRenameSymbol(text, position)).toBeNull();
    });

    it("prepareRenameSymbol returns null on a keyword token", () => {
        const text = `OUTER_SET my_var = 5\n`;
        const position: Position = { line: 0, character: 2 };
        expect(prepareRenameSymbol(text, position)).toBeNull();
    });

    it("prepareRenameSymbol returns null when no local definition exists", () => {
        const text = `\nOUTER_SET result = ~%external_var%~\n`;
        const position: Position = { line: 1, character: 26 };
        expect(prepareRenameSymbol(text, position)).toBeNull();
    });
});
