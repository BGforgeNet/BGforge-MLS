/**
 * Unit tests for weidu-d parseFile() - reference extraction.
 * Tests that state label references are collected with composite keys.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../../shared/parsers/weidu-d";
import { parseFile } from "../../src/weidu-d/file-parser";

const TEST_URI = "file:///test.d";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/parseFile refs", () => {
    it("collects state definitions and GOTO references", () => {
        const text = `
BEGIN ~MYMOD~
IF ~~ THEN BEGIN state1
  SAY ~Hello~
  IF ~~ THEN GOTO state1
END
`;
        const { refs } = parseFile(TEST_URI, text);
        // composite key: "mymod:state1"
        const stateRefs = refs.get("mymod:state1");
        expect(stateRefs).toBeDefined();
        // definition + GOTO = 2
        expect(stateRefs!.length).toBe(2);
    });

    it("collects EXTERN references with correct dialog file", () => {
        const text = `
BEGIN ~MYMOD~
IF ~~ THEN BEGIN state1
  SAY ~Hello~
  IF ~~ THEN EXTERN ~OTHER~ other_state
END
`;
        const { refs } = parseFile(TEST_URI, text);
        const externRef = refs.get("other:other_state");
        expect(externRef).toBeDefined();
        expect(externRef!.length).toBe(1);
    });

    it("collects EXTEND_TOP state references", () => {
        const text = `
EXTEND_TOP ~MYMOD~ state1
  IF ~~ THEN GOTO state2
END
`;
        const { refs } = parseFile(TEST_URI, text);
        const stateRef = refs.get("mymod:state1");
        expect(stateRef).toBeDefined();
        expect(stateRef!.length).toBe(1);
    });

    it("collects APPEND state definitions", () => {
        const text = `
APPEND ~MYMOD~
IF ~~ THEN BEGIN new_state
  SAY ~Appended~
  IF ~~ THEN GOTO new_state
END
END
`;
        const { refs } = parseFile(TEST_URI, text);
        const stateRefs = refs.get("mymod:new_state");
        expect(stateRefs).toBeDefined();
        // definition + GOTO = 2
        expect(stateRefs!.length).toBe(2);
    });

    it("returns correct URIs", () => {
        const text = `
BEGIN ~MYMOD~
IF ~~ THEN BEGIN state1
  SAY ~Hello~
END
`;
        const { refs } = parseFile(TEST_URI, text);
        const stateRefs = refs.get("mymod:state1");
        expect(stateRefs).toBeDefined();
        for (const loc of stateRefs!) {
            expect(loc.uri).toBe(TEST_URI);
        }
    });

    it("returns empty refs for empty text", () => {
        const { refs } = parseFile(TEST_URI, "");
        expect(refs.size).toBe(0);
    });

    it("returns state symbols for workspace navigation", () => {
        const text = `
BEGIN ~MYMOD~
IF ~~ THEN BEGIN state1
  SAY ~Hello~
END
`;
        const { symbols } = parseFile(TEST_URI, text);
        expect(symbols).toHaveLength(1);
        expect(symbols[0]?.name).toBe("mymod:state1");
    });

    it("preserves dialog scope in indexed state symbol names", () => {
        const text = `
BEGIN ~DIALOG_A~
IF ~~ THEN BEGIN 0
  SAY ~A~
END

BEGIN ~DIALOG_B~
IF ~~ THEN BEGIN 0
  SAY ~B~
END
`;
        const { symbols } = parseFile(TEST_URI, text);

        expect(symbols).toHaveLength(2);
        expect(symbols.map((symbol) => symbol.name)).toEqual(["dialog_a:0", "dialog_b:0"]);
    });
});
