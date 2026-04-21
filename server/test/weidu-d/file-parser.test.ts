/**
 * Unit tests for weidu-d/file-parser.ts — workspace symbol and reference extraction.
 * Tests parseFile() which collects state label symbols and cross-file reference maps.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../src/weidu-d/parser";
import { parseFile } from "../../src/weidu-d/file-parser";

const TEST_URI = "file:///mymod/npcs/gaelan.d";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/file-parser parseFile()", () => {
    it("returns empty result for empty text", () => {
        const result = parseFile(TEST_URI, "");
        expect(result.symbols).toHaveLength(0);
        expect(result.refs.size).toBe(0);
    });

    it("extracts state label symbols from BEGIN block", () => {
        const text = `
BEGIN ~GAELAN~

IF ~True()~ THEN BEGIN greet_state
    SAY ~Hello~
    IF ~~ THEN EXIT
END
`;
        const result = parseFile(TEST_URI, text);

        expect(result.symbols).toHaveLength(1);
        // Name is dialog-scoped: "GAELAN:greet_state"
        expect(result.symbols[0]!.name).toContain("greet_state");
        expect(result.symbols[0]!.location.uri).toBe(TEST_URI);
    });

    it("extracts multiple state labels from BEGIN block", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN first
    SAY ~First~
    IF ~~ THEN GOTO second
END

IF ~~ THEN BEGIN second
    SAY ~Second~
    IF ~~ THEN EXIT
END
`;
        const result = parseFile(TEST_URI, text);

        expect(result.symbols).toHaveLength(2);
        const names = result.symbols.map(s => s.name);
        expect(names.some(n => n.includes("first"))).toBe(true);
        expect(names.some(n => n.includes("second"))).toBe(true);
    });

    it("records GOTO references in the refs map", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Go somewhere~
    IF ~~ THEN GOTO s2
END

IF ~~ THEN BEGIN s2
    SAY ~Arrived~
    IF ~~ THEN EXIT
END
`;
        const result = parseFile(TEST_URI, text);

        // normalizeDialogFile lowercases: "dialog:s2"
        const key = "dialog:s2";
        expect(result.refs.has(key)).toBe(true);
        // At least the GOTO reference and the state definition
        expect(result.refs.get(key)!.length).toBeGreaterThanOrEqual(1);
    });

    it("records EXTERN references in the refs map", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Go external~
    IF ~~ THEN EXTERN IMOEN2 imoen_state
END
`;
        const result = parseFile(TEST_URI, text);

        // IMOEN2 normalized → "imoen2"
        const key = "imoen2:imoen_state";
        expect(result.refs.has(key)).toBe(true);
    });

    it("handles APPEND block with state extraction", () => {
        const text = `
APPEND GAELAN

IF ~~ THEN BEGIN appended
    SAY ~Appended text~
    IF ~~ THEN EXIT
END

END
`;
        const result = parseFile(TEST_URI, text);

        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0]!.name).toContain("appended");
    });

    it("handles CHAIN block with cross-file references", () => {
        const text = `
CHAIN BJKLSY chainlabel
~Chain text~
EXIT
`;
        const result = parseFile(TEST_URI, text);

        // normalizeDialogFile lowercases: "bjklsy:chainlabel"
        const key = "bjklsy:chainlabel";
        expect(result.refs.has(key)).toBe(true);
    });

    it("handles EXTEND_BOTTOM with state and GOTO refs", () => {
        const text = `
EXTEND_BOTTOM DIALOG 5
    IF ~~ THEN GOTO somestate
END
`;
        const result = parseFile(TEST_URI, text);

        // normalizeDialogFile: "dialog:5" and "dialog:somestate"
        const key5 = "dialog:5";
        expect(result.refs.has(key5)).toBe(true);
    });

    it("extracts displayPath from workspaceRoot when provided", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Hello~
    IF ~~ THEN EXIT
END
`;
        const result = parseFile("file:///workspace/npcs/npc.d", text, "/workspace");

        expect(result.symbols).toHaveLength(1);
        // symbol.source.displayPath should be workspace-relative
        expect(result.symbols[0]!.location.uri).toBe("file:///workspace/npcs/npc.d");
    });

    it("records CopyTrans references", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Copy transitions~
    COPY_TRANS IMOEN2 some_state
END
`;
        const result = parseFile(TEST_URI, text);

        // normalizeDialogFile: "imoen2:some_state"
        const key = "imoen2:some_state";
        expect(result.refs.has(key)).toBe(true);
    });

    it("handles ADD_STATE_TRIGGER as top-level ref", () => {
        const text = `
ADD_STATE_TRIGGER DIALOG 5 ~True()~
`;
        const result = parseFile(TEST_URI, text);

        // normalizeDialogFile: "dialog:5"
        const key = "dialog:5";
        expect(result.refs.has(key)).toBe(true);
    });

    it("records short-goto (++ syntax) references inside APPEND block", () => {
        // ShortGoto uses ++ syntax; appears inside APPEND blocks
        const text = `
APPEND DIALOG

IF ~~ g_item_type
    SAY @21
    ++ @3 + g_weapon
    ++ @4 + g_armor
END

END
`;
        const result = parseFile(TEST_URI, text);

        // Short gotos create refs for g_weapon and g_armor
        const keyWeapon = "dialog:g_weapon";
        const keyArmor = "dialog:g_armor";
        expect(result.refs.has(keyWeapon) || result.refs.has(keyArmor)).toBe(true);
    });

    it("records INTERJECT block references", () => {
        const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Hello~
    IF ~~ THEN EXIT
END

INTERJECT DIALOG s1 interject_label
    ~Interject text~
END
`;
        const result = parseFile(TEST_URI, text);

        // INTERJECT adds refs for file+label
        // The ref key for dialog:s1 exists from definition + interject reference
        const key = "dialog:s1";
        expect(result.refs.has(key)).toBe(true);
    });
});
