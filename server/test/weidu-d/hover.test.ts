/**
 * Unit tests for weidu-d/hover.ts - JSDoc hover for state labels.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getStateLabelHover } from "../../src/weidu-d/hover";
import { initParser } from "../../../shared/parsers/weidu-d";

beforeAll(async () => {
    await initParser();
});

const URI = "file:///test.d";

describe("weidu-d/hover", () => {
    it("shows JSDoc description when hovering on a state definition label", () => {
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "/** Greeting state */",
            "IF ~True()~ THEN BEGIN greeting",
            "    SAY ~Hello!~",
            "END",
        ].join("\n");

        // Cursor on "greeting" label (line 3, char 25 — inside "greeting" at col 23-30)
        const result = getStateLabelHover(text, "greeting", URI, { line: 3, character: 25 });

        expect(result.handled).toBe(true);
        if (result.handled) {
            expect(result.hover).not.toBeNull();
            const contents = result.hover?.contents;
            expect(contents).toBeDefined();
            const value = (contents as { value: string }).value;
            expect(value).toContain("greeting");
            expect(value).toContain("Greeting state");
        }
    });

    it("shows JSDoc description when hovering on a GOTO target", () => {
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hi~",
            "    IF ~~ THEN GOTO greeting",
            "END",
            "",
            "/** Greeting state */",
            "IF ~True()~ THEN BEGIN greeting",
            "    SAY ~Hello!~",
            "END",
        ].join("\n");

        // Cursor on "greeting" in GOTO (line 4): "    IF ~~ THEN GOTO greeting"
        // "greeting" starts at char 20
        const result = getStateLabelHover(text, "greeting", URI, { line: 4, character: 22 });

        expect(result.handled).toBe(true);
        if (result.handled) {
            expect(result.hover).not.toBeNull();
            const contents = result.hover?.contents;
            expect(contents).toBeDefined();
            const value = (contents as { value: string }).value;
            expect(value).toContain("Greeting state");
        }
    });

    it("returns notHandled when no JSDoc exists", () => {
        const text = ["BEGIN ~DIALOG~", "", "IF ~~ THEN BEGIN bare_state", "    SAY ~Hello~", "END"].join("\n");

        // Cursor on "bare_state" (line 2, char 20)
        const result = getStateLabelHover(text, "bare_state", URI, { line: 2, character: 20 });

        expect(result.handled).toBe(false);
    });

    it("returns notHandled for non-state symbols", () => {
        const text = ["BEGIN ~DIALOG~", "", "IF ~~ THEN BEGIN s1", "    SAY ~Hello~", "END"].join("\n");

        // Cursor on SAY keyword — not a state label
        const result = getStateLabelHover(text, "SAY", URI, { line: 3, character: 5 });

        expect(result.handled).toBe(false);
    });

    it("resolves JSDoc from the correct dialog when multiple BEGIN blocks exist", () => {
        const text = [
            "BEGIN ~DIALOG_A~",
            "",
            "/** State in dialog A */",
            "IF ~~ THEN BEGIN shared",
            "    SAY ~From A~",
            "END",
            "",
            "BEGIN ~DIALOG_B~",
            "",
            "/** State in dialog B */",
            "IF ~~ THEN BEGIN shared",
            "    SAY ~From B~",
            "END",
        ].join("\n");

        // Hover on "shared" in DIALOG_A (line 3, char 20)
        const resultA = getStateLabelHover(text, "shared", URI, { line: 3, character: 20 });
        expect(resultA.handled).toBe(true);
        if (resultA.handled) {
            const contents = resultA.hover?.contents;
            expect(contents).toBeDefined();
            const value = (contents as { value: string }).value;
            expect(value).toContain("State in dialog A");
        }

        // Hover on "shared" in DIALOG_B (line 10, char 20)
        const resultB = getStateLabelHover(text, "shared", URI, { line: 10, character: 20 });
        expect(resultB.handled).toBe(true);
        if (resultB.handled) {
            const contents = resultB.hover?.contents;
            expect(contents).toBeDefined();
            const value = (contents as { value: string }).value;
            expect(value).toContain("State in dialog B");
        }
    });

    it("returns notHandled when JSDoc comment does not start with /**", () => {
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "/* Regular comment, not JSDoc */",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hello~",
            "END",
        ].join("\n");

        const result = getStateLabelHover(text, "s1", URI, { line: 3, character: 17 });
        expect(result.handled).toBe(false);
    });

    it("returns notHandled when label is a GOTO to an undefined state (no definition found)", () => {
        // The cursor is on "missing_state" in GOTO, but there is no state definition for it.
        // findStateInDialog returns null → line 48 return HR.notHandled()
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hello~",
            "    IF ~~ THEN GOTO missing_state",
            "END",
        ].join("\n");

        // "missing_state" at line 4, starts at char 20
        const result = getStateLabelHover(text, "missing_state", URI, { line: 4, character: 22 });
        expect(result.handled).toBe(false);
    });

    it("returns notHandled when JSDoc comment has no description body", () => {
        // A JSDoc with only the delimiters and no text — jsdoc.desc is falsy → line 60
        const text = ["BEGIN ~DIALOG~", "", "/***/", "IF ~~ THEN BEGIN empty_jsdoc", "    SAY ~Hello~", "END"].join(
            "\n",
        );

        const result = getStateLabelHover(text, "empty_jsdoc", URI, { line: 3, character: 22 });
        expect(result.handled).toBe(false);
    });
});
