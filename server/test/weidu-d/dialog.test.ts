/**
 * Unit tests for weidu-d/dialog.ts - D dialog parser for tree visualization.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { parseDDialog } from "../../src/weidu-d/dialog";
import { initParser } from "../../src/weidu-d/parser";

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/dialog", () => {
    describe("parseDDialog()", () => {
        it("parses BEGIN block with states and transitions", () => {
            const text = `
BEGIN ~GAELAN~

IF ~True()~ THEN BEGIN start_state
    SAY ~Hello traveler!~
    IF ~~ THEN REPLY ~Goodbye~ EXIT
    IF ~~ THEN REPLY ~Tell me more~ GOTO next_state
END

IF ~~ THEN BEGIN next_state
    SAY ~Here is more info.~
    IF ~~ THEN REPLY ~Thanks~ EXIT
END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("begin");
            expect(result.blocks[0]!.file).toBe("GAELAN");

            expect(result.states).toHaveLength(2);

            const state0 = result.states[0]!;
            expect(state0.label).toBe("start_state");
            expect(state0.sayText).toBe("Hello traveler!");
            expect(state0.transitions).toHaveLength(2);

            // First transition: REPLY + EXIT
            const t0 = state0.transitions[0]!;
            expect(t0.replyText).toBe("Goodbye");
            expect(t0.target).toEqual({ kind: "exit" });

            // Second transition: REPLY + GOTO
            const t1 = state0.transitions[1]!;
            expect(t1.replyText).toBe("Tell me more");
            expect(t1.target).toEqual({ kind: "goto", label: "next_state" });

            const state1 = result.states[1]!;
            expect(state1.label).toBe("next_state");
            expect(state1.sayText).toBe("Here is more info.");
        });

        it("parses APPEND block", () => {
            const text = `
APPEND GAELAN

IF ~~ THEN BEGIN appended_state
    SAY ~Appended text~
    IF ~~ THEN EXIT
END

END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("append");
            expect(result.blocks[0]!.file).toBe("GAELAN");

            expect(result.states).toHaveLength(1);
            expect(result.states[0]!.label).toBe("appended_state");
            expect(result.states[0]!.transitions).toHaveLength(1);
            expect(result.states[0]!.transitions[0]!.target).toEqual({ kind: "exit" });
        });

        it("parses EXTERN transitions", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Going elsewhere~
    IF ~~ THEN REPLY ~To Imoen~ EXTERN IMOEN2 some_state
END
`;
            const result = parseDDialog(text);

            expect(result.states).toHaveLength(1);
            const t = result.states[0]!.transitions[0]!;
            expect(t.replyText).toBe("To Imoen");
            expect(t.target).toEqual({ kind: "extern", file: "IMOEN2", label: "some_state" });
        });

        it("parses silent transitions (no REPLY)", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Auto transition~
    IF ~~ THEN GOTO s2
END

IF ~~ THEN BEGIN s2
    SAY ~Arrived~
END
`;
            const result = parseDDialog(text);

            const t = result.states[0]!.transitions[0]!;
            expect(t.replyText).toBeUndefined();
            expect(t.target).toEqual({ kind: "goto", label: "s2" });
        });

        it("parses transitions with trigger conditions", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Choose~
    IF ~PartyGoldGT(1000)~ THEN REPLY ~Buy~ EXIT
    IF ~~ THEN REPLY ~Leave~ EXIT
END
`;
            const result = parseDDialog(text);

            const t0 = result.states[0]!.transitions[0]!;
            expect(t0.trigger).toBe("PartyGoldGT(1000)");
            expect(t0.replyText).toBe("Buy");

            const t1 = result.states[0]!.transitions[1]!;
            expect(t1.trigger).toBeUndefined();
        });

        it("parses state with trigger condition", () => {
            const text = `
BEGIN ~DIALOG~

IF ~Global("Quest","GLOBAL",1)~ THEN BEGIN s1
    SAY ~You have the quest~
    IF ~~ THEN EXIT
END
`;
            const result = parseDDialog(text);

            expect(result.states[0]!.trigger).toBe('Global("Quest","GLOBAL",1)');
        });

        it("parses tra refs in SAY text", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY @1300
    IF ~~ THEN EXIT
END
`;
            const result = parseDDialog(text);
            expect(result.states[0]!.sayText).toBe("@1300");
        });

        it("parses tlk refs in SAY text", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY #12345
    IF ~~ THEN EXIT
END
`;
            const result = parseDDialog(text);
            expect(result.states[0]!.sayText).toBe("#12345");
        });

        it("parses CHAIN block with multiple speakers", () => {
            const text = `
CHAIN BJKLSY pizzachain
~What do you like on pizza?~
== IMOEN2J
~Oregano.~
== BJKLSY
~Anything else?~
EXIT
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("chain");
            expect(result.blocks[0]!.file).toBe("BJKLSY");
            expect(result.blocks[0]!.label).toBe("pizzachain");

            // CHAIN should produce synthetic states
            expect(result.states.length).toBeGreaterThanOrEqual(1);

            // First state should have the chain label
            expect(result.states[0]!.label).toBe("pizzachain");
            expect(result.states[0]!.speaker).toBe("BJKLSY");
            expect(result.states[0]!.sayText).toBe("What do you like on pizza?");
        });

        it("parses CHAIN with GOTO epilogue", () => {
            const text = `
BEGIN ~GAELAN~

IF ~~ THEN BEGIN a21
    SAY ~some text~
    IF ~~ THEN EXIT
END

CHAIN GAELAN chainlabel
~Chain text~
== KORGANJ
~Korgan says~
END
IF ~~ THEN GOTO a21
`;
            const result = parseDDialog(text);

            // Should have the BEGIN state plus CHAIN states
            const chainStates = result.states.filter((s) => s.blockLabel === "chainlabel");
            expect(chainStates.length).toBeGreaterThanOrEqual(1);

            // Last chain state should have a GOTO transition to a21
            const lastChainState = chainStates[chainStates.length - 1]!;
            const lastTransition = lastChainState.transitions[lastChainState.transitions.length - 1];
            expect(lastTransition).toBeDefined();
            expect(lastTransition!.target).toEqual({ kind: "goto", label: "a21" });
        });

        it("parses EXTEND_BOTTOM block", () => {
            const text = `
EXTEND_BOTTOM DIALOG 5
    IF ~~ THEN REPLY ~New option~ EXIT
END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("extend");
            expect(result.blocks[0]!.file).toBe("DIALOG");
        });

        it("parses COPY_TRANS transitions", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Copy transitions~
    COPY_TRANS IMOEN2 some_state
END
`;
            const result = parseDDialog(text);

            expect(result.states).toHaveLength(1);
            const t = result.states[0]!.transitions[0]!;
            expect(t.target).toEqual({ kind: "copy_trans", file: "IMOEN2", label: "some_state" });
        });

        it("parses short transitions (++ syntax)", () => {
            const text = `
APPEND DIALOG

IF ~~ g_item_type
    SAY @21
    ++ @3 + g_weapon
    ++ @4 + g_armor
END

END
`;
            const result = parseDDialog(text);

            expect(result.states).toHaveLength(1);
            const state = result.states[0]!;
            expect(state.label).toBe("g_item_type");
            expect(state.transitions).toHaveLength(2);

            expect(state.transitions[0]!.replyText).toBe("@3");
            expect(state.transitions[0]!.target).toEqual({ kind: "goto", label: "g_weapon" });

            expect(state.transitions[1]!.replyText).toBe("@4");
            expect(state.transitions[1]!.target).toEqual({ kind: "goto", label: "g_armor" });
        });

        it("parses REPLACE_ACTION_TEXT as modify block", () => {
            const text = `REPLACE_ACTION_TEXT player1 ~ReputationInc(-1)~ ~~`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("REPLACE_ACTION_TEXT");
            expect(result.blocks[0]!.file).toBe("player1");
            expect(result.states).toHaveLength(0);
        });

        it("returns empty data for empty text", () => {
            const result = parseDDialog("");
            expect(result.blocks).toHaveLength(0);
            expect(result.states).toHaveLength(0);
        });

        it("handles INTERJECT_COPY_TRANS blocks", () => {
            const text = `
BEGIN ~DIALOG~

IF ~~ THEN BEGIN s1
    SAY ~Main text~
    IF ~~ THEN EXIT
END

INTERJECT_COPY_TRANS DIALOG s1 myInterject
    DO ~SetGlobal("foo","GLOBAL",1)~ EXIT
`;
            const result = parseDDialog(text);

            const interjectBlocks = result.blocks.filter((b) => b.kind === "interject");
            expect(interjectBlocks.length).toBeGreaterThanOrEqual(1);
        });

        it("handles multiple blocks in one file", () => {
            const text = `
BEGIN ~GAELAN~

IF ~~ THEN BEGIN s1
    SAY ~First state~
    IF ~~ THEN EXIT
END

APPEND GAELAN

IF ~~ THEN BEGIN s2
    SAY ~Second state~
    IF ~~ THEN EXIT
END

END

CHAIN GAELAN chainstate
~Chain text~
EXIT
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(3);
            expect(result.blocks[0]!.kind).toBe("begin");
            expect(result.blocks[1]!.kind).toBe("append");
            expect(result.blocks[2]!.kind).toBe("chain");

            expect(result.states.length).toBeGreaterThanOrEqual(3);
        });

        it("parses ALTER_TRANS as modify block with state refs", () => {
            const text = `
ALTER_TRANS wsmith01
BEGIN 32 END
BEGIN 0 END
BEGIN
  "TRIGGER" ~False()~
END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("ALTER_TRANS");
            expect(result.blocks[0]!.file).toBe("wsmith01");
            expect(result.blocks[0]!.stateRefs).toContain("32");
            expect(result.blocks[0]!.description).toContain("TRIGGER");
        });

        it("parses REPLACE_TRANS_TRIGGER as modify block with state refs", () => {
            const text = `REPLACE_TRANS_TRIGGER wsmith01 BEGIN g_2things END BEGIN END ~PartyGoldGT(7499)~ ~PartyGoldGT(12499)~`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("REPLACE_TRANS_TRIGGER");
            expect(result.blocks[0]!.stateRefs).toContain("g_2things");
            expect(result.blocks[0]!.description).toContain("PartyGoldGT(7499)");
            expect(result.blocks[0]!.description).toContain("PartyGoldGT(12499)");
        });

        it("parses REPLACE_TRANS_ACTION as modify block with state refs", () => {
            const text = `REPLACE_TRANS_ACTION wsmith01 BEGIN g_2things END BEGIN END ~TakePartyGold(7500)~ ~TakePartyGold(12500)~`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("REPLACE_TRANS_ACTION");
            expect(result.blocks[0]!.stateRefs).toContain("g_2things");
        });

        it("parses REPLACE_STATE_TRIGGER as modify block with state ref", () => {
            const text = `REPLACE_STATE_TRIGGER finsol01 4 ~!NumTimesTalkedTo(0)~`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("REPLACE_STATE_TRIGGER");
            expect(result.blocks[0]!.file).toBe("finsol01");
            expect(result.blocks[0]!.stateRefs).toContain("4");
            expect(result.blocks[0]!.description).toContain("!NumTimesTalkedTo(0)");
        });

        it("parses REPLACE as structural block with states", () => {
            const text = `
REPLACE GAELAN

IF ~~ THEN BEGIN replaced_state
    SAY ~Replaced text~
    IF ~~ THEN EXIT
END

END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("replace");
            expect(result.states).toHaveLength(1);
            expect(result.states[0]!.label).toBe("replaced_state");
        });

        it("parses mixed structural and modify blocks grouped by file", () => {
            const text = `
ALTER_TRANS wsmith01
BEGIN 32 END
BEGIN 0 END
BEGIN
  "TRIGGER" ~False()~
END

APPEND wsmith01

IF ~~ g_2things
    SAY @2
    COPY_TRANS wsmith01 54
END

END

REPLACE_TRANS_TRIGGER wsmith01 BEGIN g_2things END BEGIN END ~PartyGoldGT(7499)~ ~PartyGoldGT(12499)~

EXTEND_TOP wsmith01 32
  +~~+ @3 + g_2things
END
`;
            const result = parseDDialog(text);

            // Should have 4 blocks: alter_trans, append, replace_trans_trigger, extend
            expect(result.blocks).toHaveLength(4);

            const structural = result.blocks.filter((b) => b.kind !== "modify");
            const modify = result.blocks.filter((b) => b.kind === "modify");

            expect(structural).toHaveLength(2); // append + extend
            expect(modify).toHaveLength(2); // alter_trans + replace_trans_trigger

            // All blocks target the same file
            for (const b of result.blocks) {
                expect(b.file).toBe("wsmith01");
            }
        });

        it("parses ALTER_TRANS with no change block (empty description)", () => {
            // ALTER_TRANS with only state refs and an empty changes block
            // This exercises the extractAlterTransParts() return "" branch
            const text = `
ALTER_TRANS wsmith01
BEGIN 10 END
BEGIN 0 END
BEGIN
END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("ALTER_TRANS");
            // No AlterTransChange children → description is undefined
            expect(result.blocks[0]!.description).toBeUndefined();
        });

        it("parses ADD_TRANS_ACTION as modify block", () => {
            const text = `
ADD_TRANS_ACTION wsmith01 BEGIN 5 END BEGIN 1 END ~PlaySong(5)~
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("ADD_TRANS_ACTION");
            expect(result.blocks[0]!.file).toBe("wsmith01");
        });

        it("parses ADD_TRANS_TRIGGER as modify block", () => {
            const text = `
ADD_TRANS_TRIGGER wsmith01 5 1 ~PartyGoldGT(100)~
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("ADD_TRANS_TRIGGER");
        });

        it("parses SET_WEIGHT as modify block", () => {
            // SET_WEIGHT filename stateLabel #weight (weight uses # prefix)
            const text = `
SET_WEIGHT wsmith01 5 #100
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("SET_WEIGHT");
        });

        it("parses EXTEND_TOP block with no additional transitions", () => {
            // EXTEND_TOP with only state ref and empty transitions — exercises
            // the false branch of (transitions.length > 0) in parseExtendAction
            const text = `
EXTEND_TOP DIALOG 5
END
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("extend");
            // No transitions means no states added
            expect(result.states).toHaveLength(0);
        });

        it("parses REPLACE_SAY as modify block", () => {
            const text = `
REPLACE_SAY DIALOG 3 ~New text here~
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("REPLACE_SAY");
            expect(result.blocks[0]!.file).toBe("DIALOG");
        });

        it("parses ADD_STATE_TRIGGER as modify block", () => {
            const text = `
ADD_STATE_TRIGGER DIALOG 4 ~Global("Quest","GLOBAL",1)~
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("modify");
            expect(result.blocks[0]!.actionName).toBe("ADD_STATE_TRIGGER");
        });

        it("CHAIN with multiple text segments auto-links states (line 402 branch)", () => {
            // Two chain_text segments with no explicit transitions between them.
            // flattenChain auto-adds a GOTO from the first to the second (line 402).
            const text = `
CHAIN DIALOG chainlabel
~First text~
~Second text~
EXIT
`;
            const result = parseDDialog(text);

            // Both chain text segments should become states
            const chainStates = result.states.filter((s) => s.blockLabel === "chainlabel");
            expect(chainStates.length).toBeGreaterThanOrEqual(2);

            // The first state must have an auto-added GOTO transition to the second
            const firstState = chainStates[0]!;
            expect(firstState.transitions).toHaveLength(1);
            expect(firstState.transitions[0]!.target.kind).toBe("goto");
        });

        it("CHAIN with BRANCH transitions (parseChainBranch branch)", () => {
            // BRANCH inside a CHAIN adds conditional speaker transitions.
            // This exercises parseChainBranch (lines 436-444 in dialog.ts).
            const text = `
CHAIN DIALOG chainbranch
~Intro text~
BRANCH ~Global("x","GLOBAL",1)~ BEGIN END
EXIT
`;
            const result = parseDDialog(text);

            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("chain");
            // States should be produced from the chain text segments
            expect(result.states.length).toBeGreaterThanOrEqual(1);
        });
    });
});
