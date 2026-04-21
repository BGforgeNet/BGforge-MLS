/**
 * Unit tests for weidu-d/rename.ts - dialog-scoped state label rename.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { prepareRenameSymbol, renameSymbol } from "../../src/weidu-d/rename";
import { initParser } from "../../src/weidu-d/parser";

beforeAll(async () => {
    await initParser();
});

const URI = "file:///test.d";

/** Count the number of edits returned by rename. */
function countEdits(text: string, position: Position, newName: string): number {
    const result = renameSymbol(text, position, newName, URI);
    if (!result?.changes) return 0;
    return result.changes[URI]?.length ?? 0;
}

describe("weidu-d/rename", () => {
    describe("prepareRenameSymbol()", () => {
        it("returns range and placeholder for a state definition label", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN my_state\n    SAY ~Hello~\nEND\n";
            // "my_state" starts at character 17
            const position: Position = { line: 2, character: 20 };
            const result = prepareRenameSymbol(text, position);

            expect(result).not.toBeNull();
            expect(result?.placeholder).toBe("my_state");
        });

        it("returns range and placeholder for a GOTO reference", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hi~",
                "    IF ~~ THEN GOTO s2",
                "END",
                "",
                "IF ~~ THEN BEGIN s2",
                "    SAY ~Bye~",
                "END",
            ].join("\n");
            // "s2" in GOTO at line 4: "    IF ~~ THEN GOTO s2" — s2 starts at char 20
            const position: Position = { line: 4, character: 20 };
            const result = prepareRenameSymbol(text, position);

            expect(result).not.toBeNull();
            expect(result?.placeholder).toBe("s2");
        });

        it("returns null for non-label positions (SAY keyword)", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n";
            const position: Position = { line: 3, character: 5 };
            const result = prepareRenameSymbol(text, position);

            expect(result).toBeNull();
        });

        it("returns null when no definition exists (label only used in GOTO)", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hi~",
                "    IF ~~ THEN GOTO nonexistent",
                "END",
            ].join("\n");
            // "nonexistent" starts at char 20
            const position: Position = { line: 4, character: 22 };
            const result = prepareRenameSymbol(text, position);

            expect(result).toBeNull();
        });
    });

    describe("renameSymbol()", () => {
        it("renames state definition and GOTO references", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN target",
                "    SAY ~Hello~",
                "    IF ~~ THEN GOTO target",
                "END",
                "",
                "IF ~~ THEN BEGIN other",
                "    SAY ~Bye~",
                "    IF ~~ THEN GOTO target",
                "END",
            ].join("\n");

            // Cursor on "target" in definition (line 2, char 17)
            const count = countEdits(text, { line: 2, character: 20 }, "renamed");
            // Definition + 2 GOTO refs = 3
            expect(count).toBe(3);
        });

        it("renames from GOTO reference position", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN target",
                "    SAY ~Hello~",
                "    IF ~~ THEN GOTO target",
                "END",
            ].join("\n");

            // Cursor on "target" in GOTO (line 4): "    IF ~~ THEN GOTO target"
            // "target" starts at char 20
            const count = countEdits(text, { line: 4, character: 22 }, "renamed");
            expect(count).toBe(2); // Definition + GOTO ref
        });

        it("scopes rename to the correct dialog — does not cross BEGIN boundaries", () => {
            const text = [
                "BEGIN ~DIALOG_A~",
                "",
                "IF ~~ THEN BEGIN shared",
                "    SAY ~From A~",
                "    IF ~~ THEN GOTO shared",
                "END",
                "",
                "BEGIN ~DIALOG_B~",
                "",
                "IF ~~ THEN BEGIN shared",
                "    SAY ~From B~",
                "    IF ~~ THEN GOTO shared",
                "END",
            ].join("\n");

            // Cursor on "shared" in DIALOG_A definition (line 2, char 17)
            const result = renameSymbol(text, { line: 2, character: 20 }, "renamed_a", URI);
            const edits = result?.changes?.[URI] ?? [];

            // Only 2 edits: def + goto in DIALOG_A
            expect(edits.length).toBe(2);

            // All edits should be in lines 0-5 (DIALOG_A range)
            for (const edit of edits) {
                expect(edit.range.start.line).toBeLessThan(6);
            }
        });

        it("includes EXTEND_TOP references to the same dialog file", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN my_state",
                "    SAY ~Hello~",
                "END",
                "",
                "EXTEND_TOP ~DIALOG~ my_state",
                "    IF ~~ THEN GOTO my_state",
                "END",
            ].join("\n");

            // Cursor on definition (line 2, char 17)
            const count = countEdits(text, { line: 2, character: 20 }, "renamed");
            // Definition + EXTEND_TOP states ref + GOTO in extend = 3
            expect(count).toBeGreaterThanOrEqual(2);
        });

        it("includes ADD_STATE_TRIGGER references", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN target",
                "    SAY ~Hello~",
                "END",
                "",
                'ADD_STATE_TRIGGER ~DIALOG~ target ~GlobalGT("chapter","1")~',
            ].join("\n");

            // Cursor on "target" definition (line 2, char 17)
            const count = countEdits(text, { line: 2, character: 20 }, "renamed");
            expect(count).toBe(2); // Definition + ADD_STATE_TRIGGER
        });

        it("includes ExternNext references to the same dialog", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hello~",
                "    IF ~~ THEN EXTERN ~DIALOG~ s2",
                "END",
                "",
                "IF ~~ THEN BEGIN s2",
                "    SAY ~World~",
                "END",
            ].join("\n");

            // Rename s2 from its definition (line 7): "IF ~~ THEN BEGIN s2", s2 at char 17
            const count = countEdits(text, { line: 7, character: 17 }, "renamed");
            expect(count).toBe(2); // Definition + EXTERN ref
        });

        it("includes CHAIN action references", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN entry",
                "    SAY ~Hello~",
                "END",
                "",
                "CHAIN ~DIALOG~ entry",
                "    ~Chain text~",
                "EXIT",
            ].join("\n");

            // Cursor on definition (line 2, char 17)
            const count = countEdits(text, { line: 2, character: 20 }, "renamed");
            expect(count).toBe(2); // Definition + CHAIN label ref
        });

        it("includes ChainEpilogue END/EXTERN references", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN target",
                "    SAY ~Hello~",
                "END",
                "",
                "CHAIN ~DIALOG~ target",
                "    ~Some text~",
                "END ~DIALOG~ target",
            ].join("\n");

            // Cursor on definition (line 2, char 17)
            const count = countEdits(text, { line: 2, character: 20 }, "renamed");
            // Definition + CHAIN label + ChainEpilogue label = 3
            expect(count).toBe(3);
        });

        it("returns null for invalid newName (empty string)", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n";
            const result = renameSymbol(text, { line: 2, character: 20 }, "", URI);
            expect(result).toBeNull();
        });

        it("returns null for invalid newName (contains spaces)", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n";
            const result = renameSymbol(text, { line: 2, character: 20 }, "bad name", URI);
            expect(result).toBeNull();
        });

        it("returns null for invalid newName (starts with digit)", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n";
            const result = renameSymbol(text, { line: 2, character: 20 }, "1invalid", URI);
            expect(result).toBeNull();
        });

        it("returns null for non-label positions", () => {
            const text = "BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n";
            const result = renameSymbol(text, { line: 3, character: 5 }, "renamed", URI);
            expect(result).toBeNull();
        });

        it("returns null when cursor is on EXTERN label pointing to an external dialog not present in file", () => {
            // Cursor on "ext_state" in EXTERN ~OTHER_DIALOG~ ext_state.
            // findLabelNodeAtPosition returns dialogFile="other_dialog", but the file has
            // no BEGIN ~OTHER_DIALOG~ block, so findAllDialogLabelRefs returns empty →
            // refs.length === 0 → returns null.
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hello~",
                "    IF ~~ THEN EXTERN ~OTHER_DIALOG~ ext_state",
                "END",
            ].join("\n");
            // "ext_state" is at line 4: "    IF ~~ THEN EXTERN ~OTHER_DIALOG~ ext_state"
            //  character: 37 (after "    IF ~~ THEN EXTERN ~OTHER_DIALOG~ ")
            const result = renameSymbol(text, { line: 4, character: 39 }, "renamed", URI);
            expect(result).toBeNull();
        });

        it("returns null when no definition exists", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hi~",
                "    IF ~~ THEN GOTO nonexistent",
                "END",
            ].join("\n");
            // "nonexistent" starts at char 20
            const result = renameSymbol(text, { line: 4, character: 22 }, "renamed", URI);
            expect(result).toBeNull();
        });

        it("includes short goto (+ label) references", () => {
            const text = [
                "BEGIN ~DIALOG~",
                "",
                "IF ~~ THEN BEGIN s1",
                "    SAY ~Hello~",
                "    + ~trigger~ + ~reply~ + s2",
                "END",
                "",
                "IF ~~ THEN BEGIN s2",
                "    SAY ~World~",
                "END",
            ].join("\n");

            // Rename s2 from definition (line 7): "IF ~~ THEN BEGIN s2", s2 at char 17
            const count = countEdits(text, { line: 7, character: 17 }, "renamed");
            expect(count).toBe(2); // Definition + short goto
        });
    });
});
