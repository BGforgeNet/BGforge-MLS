/**
 * Branch-coverage tests for weidu-d/dialog-utils.ts.
 *
 * Covers transition-target variants beyond plain GOTO/EXIT — EXTERN, COPY_TRANS,
 * and the SHORT_GOTO single-token form — plus chain text, double-quoted
 * SAY content, and empty/whitespace trigger handling.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { parseDDialog } from "../../src/weidu-d/dialog";
import { initParser } from "../../../shared/parsers/weidu-d";

beforeAll(async () => {
    await initParser();
});

describe("transition target variants", () => {
    it("parses EXTERN target", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN start
    SAY ~start~
    IF ~~ THEN REPLY ~go~ EXTERN ~D2~ remote_state
END
`;
        const result = parseDDialog(text);
        const states = result.states;
        expect(states.length).toBeGreaterThan(0);
        const target = states[0]!.transitions[0]!.target;
        expect(target).toBeDefined();
        expect(target!.kind).toBe("extern");
        if (target!.kind === "extern") {
            expect(target.file).toBe("~D2~");
            expect(target.label).toBe("remote_state");
        }
    });

    it("parses COPY_TRANS target", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY ~original~
    IF ~~ THEN REPLY ~choice~ EXIT
END

IF ~~ THEN BEGIN s2
    SAY ~clone~
    COPY_TRANS ~D1~ s1
END
`;
        const result = parseDDialog(text);
        const states = result.states;
        // s2 should produce a transition with COPY_TRANS as target
        const s2 = states.find((s) => s.label === "s2");
        expect(s2).toBeDefined();
        const trans = s2!.transitions.find((t) => t.target?.kind === "copy_trans");
        expect(trans).toBeDefined();
        if (trans!.target?.kind === "copy_trans") {
            expect(trans!.target.file).toBe("D1");
            expect(trans!.target.label).toBe("s1");
        }
    });

    it("parses SHORT_GOTO target (label only)", () => {
        // SHORT_GOTO is `+ label` — a label-only target with no GOTO/EXIT keyword.
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY ~start~
    IF ~~ + s2
END

IF ~~ THEN BEGIN s2
    SAY ~next~
    IF ~~ THEN EXIT
END
`;
        const result = parseDDialog(text);
        const states = result.states;
        const s1 = states.find((s) => s.label === "s1");
        expect(s1).toBeDefined();
        const target = s1!.transitions[0]!.target;
        expect(target).toBeDefined();
        expect(target!.kind).toBe("goto");
    });
});

describe("text-content extraction edge cases", () => {
    it("extracts double-quoted SAY content", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY "double-quoted text"
    IF ~~ THEN EXIT
END
`;
        const result = parseDDialog(text);
        const state = result.states[0]!;
        expect(state.sayText).toBe("double-quoted text");
    });

    it("extracts TRA-reference SAY (@123)", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY @42
    IF ~~ THEN EXIT
END
`;
        const result = parseDDialog(text);
        expect(result.states[0]!.sayText).toBe("@42");
    });

    it("filters out empty trigger ~~ (string with no content)", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY ~hello~
    IF ~~ THEN EXIT
END
`;
        const result = parseDDialog(text);
        // The empty `IF ~~` trigger should not produce a meaningful trigger field.
        const trans = result.states[0]!.transitions[0]!;
        expect(trans.trigger).toBeUndefined();
    });

    it("preserves non-empty trigger text", () => {
        const text = `
BEGIN ~D1~

IF ~Global("x","GLOBAL",1)~ THEN BEGIN s1
    SAY ~hello~
    IF ~~ THEN EXIT
END
`;
        const result = parseDDialog(text);
        const state = result.states[0]!;
        expect(state.trigger).toBeDefined();
        expect(state.trigger).toContain("Global");
    });
});

describe("CHAIN block text extraction", () => {
    it("parses CHAIN with tilde text", () => {
        const text = `
CHAIN ~D1~ chainstate
~chain text content~
EXIT
`;
        const result = parseDDialog(text);
        const chainBlock = result.blocks.find((b) => b.kind === "chain");
        expect(chainBlock).toBeDefined();
    });
});

describe("transition do-action extraction", () => {
    it("captures DO action on a transition", () => {
        const text = `
BEGIN ~D1~

IF ~~ THEN BEGIN s1
    SAY ~hello~
    IF ~~ THEN DO ~SetGlobal("foo","GLOBAL",1)~ EXIT
END
`;
        const result = parseDDialog(text);
        const trans = result.states[0]!.transitions[0]!;
        expect(trans.action).toBeDefined();
        expect(trans.action).toContain("SetGlobal");
    });
});
