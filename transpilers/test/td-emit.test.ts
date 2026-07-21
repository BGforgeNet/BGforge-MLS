/**
 * TD emitter tests: hand-built TDScript IR fed directly into emitD (td/src/emit.ts),
 * not through the full parse pipeline. Covers construct/text/transition/patch
 * variants that a fixture-driven transpile() rarely exercises together.
 */
import { describe, expect, it } from "vitest";
import { emitD } from "../td/src/emit";
import {
    TDConstructType,
    TDEpilogueType,
    TDPatchOp,
    TDTextType,
    TDTransitionType,
    type TDConstruct,
    type TDState,
} from "../td/src/types";

const HEADER = "/* Generated from test.td - do not edit */\n\n";

function emit(constructs: TDConstruct[]): string {
    return emitD({ sourceFile: "/virtual/test.td", constructs });
}

const literal = (value: string) => ({ type: TDTextType.Literal, value });

describe("BEGIN / states", () => {
    it("emits a triggered state with a single SAY and a no-trigger EXIT transition", () => {
        const state: TDState = {
            label: "start",
            trigger: "",
            say: [{ text: literal("Hello") }],
            transitions: [{ next: { type: TDTransitionType.Exit } }],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "MYDLG", states: [state] }]);
        expect(out).toBe(HEADER + "BEGIN MYDLG\n\nIF ~~ start\n    SAY ~Hello~\n    IF ~~ EXIT\nEND\n");
    });

    it("emits WEIGHT on the state header and SAY ~~ for a say-less state with transitions", () => {
        const state: TDState = {
            label: "s2",
            trigger: 'Dead("foo")',
            weight: 5,
            say: [],
            transitions: [{ next: { type: TDTransitionType.Exit } }],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain('IF WEIGHT #5 ~Dead("foo")~ s2\n    SAY ~~\n');
    });

    it("joins multisay texts with ' = '", () => {
        const state: TDState = {
            label: "s3",
            say: [{ text: literal("a") }, { text: { type: TDTextType.Tra, value: 7 } }],
            transitions: [],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain("    SAY ~a~ = @7\n");
    });

    it("BEGIN with nonPausing appends the 1 flag to the header", () => {
        const out = emit([{ type: TDConstructType.Begin, filename: "D", nonPausing: true, states: [] }]);
        expect(out).toContain("BEGIN D 1\n");
    });
});

describe("APPEND / EXTEND", () => {
    it("APPEND_EARLY with IF_FILE_EXISTS indents each state and closes with END", () => {
        const state: TDState = { label: "s", say: [{ text: literal("hi") }], transitions: [] };
        const out = emit([
            { type: TDConstructType.Append, filename: "D", ifFileExists: true, early: true, states: [state] },
        ]);
        expect(out).toBe(HEADER + "APPEND_EARLY IF_FILE_EXISTS D\n    IF ~~ s\n        SAY ~hi~\n    END\nEND\n");
    });

    it("EXTEND_TOP appends a #position and its transitions", () => {
        const out = emit([
            {
                type: TDConstructType.ExtendTop,
                filename: "D",
                stateLabel: "s",
                position: 2,
                transitions: [{ next: { type: TDTransitionType.Goto, target: "t" } }],
            },
        ]);
        expect(out).toContain("EXTEND_TOP D s #2\n    IF ~~ GOTO t\nEND");
    });
});

describe("transitions", () => {
    it("longform: no reply, trigger + action + GOTO", () => {
        const state: TDState = {
            label: "s",
            say: [],
            transitions: [
                {
                    trigger: 'Global("x","GLOBAL",1)',
                    action: "SetGlobal()",
                    next: { type: TDTransitionType.Goto, target: "next_state" },
                },
            ],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain('    IF ~Global("x","GLOBAL",1)~ DO ~SetGlobal()~ GOTO next_state\n');
    });

    it("shorthand: reply + action + journals + flags renders the full +~trigger~+ line", () => {
        const state: TDState = {
            label: "s",
            say: [],
            transitions: [
                {
                    trigger: 'Dead("foo")',
                    reply: { type: TDTextType.Tra, value: 5 },
                    action: "SetGlobal()",
                    journal: literal("j1"),
                    solvedJournal: literal("j2"),
                    unsolvedJournal: literal("j3"),
                    flags: 3,
                    next: { type: TDTransitionType.Goto, target: "next_state" },
                },
            ],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain(
            '    +~Dead("foo")~+ @5 DO ~SetGlobal()~ JOURNAL ~j1~ SOLVED_JOURNAL ~j2~ UNSOLVED_JOURNAL ~j3~ FLAGS 3 + next_state\n',
        );
    });

    it("shorthand with no trigger uses ++ ", () => {
        const state: TDState = {
            label: "s",
            say: [],
            transitions: [{ reply: literal("hi"), next: { type: TDTransitionType.Exit } }],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain("    ++ ~hi~ EXIT\n");
    });

    it("EXTERN and COPY_TRANS/COPY_TRANS_LATE next-targets render their keyword forms", () => {
        const state: TDState = {
            label: "s",
            say: [],
            transitions: [
                { next: { type: TDTransitionType.Extern, filename: "OTHER", target: "t1", ifFileExists: true } },
                { next: { type: TDTransitionType.CopyTrans, filename: "OTHER", target: "t2", safe: true, late: true } },
            ],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain("EXTERN IF_FILE_EXISTS OTHER t1\n");
        // COPY_TRANS as a next-target is a state-level terminal, emitted bare (not wrapped in IF ~~).
        expect(out).toContain("    COPY_TRANS_LATE SAFE OTHER t2\n");
    });
});

describe("text variants", () => {
    it("tlk, forced, and sound-suffixed text render their sigils", () => {
        const state: TDState = {
            label: "s",
            say: [
                { text: { type: TDTextType.Tlk, value: 100 } },
                { text: { type: TDTextType.Forced, value: "shout" } },
                { text: { ...literal("with sound"), sound: "snd1" } },
            ],
            transitions: [],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain("    SAY #100 = !shout = ~with sound~ [snd1]\n");
    });

    it("male/female variants concatenate both renderings", () => {
        const state: TDState = {
            label: "s",
            say: [{ text: { type: TDTextType.Literal, value: "", male: literal("he"), female: literal("she") } }],
            transitions: [],
        };
        const out = emit([{ type: TDConstructType.Begin, filename: "D", states: [state] }]);
        expect(out).toContain("    SAY ~he~ ~she~\n");
    });
});

describe("CHAIN", () => {
    it("emits trigger/weight header, a speaker switch, multisay, and an action", () => {
        const out = emit([
            {
                type: TDConstructType.Chain,
                filename: "D",
                label: "c1",
                trigger: 'Dead("foo")',
                weight: 2,
                entries: [
                    { speaker: "D", texts: [literal("first")] },
                    { speaker: "NPC2", texts: [literal("second"), literal("second-b")], action: "DoThing()" },
                ],
                epilogue: { type: TDEpilogueType.Exit },
            },
        ]);
        expect(out).toContain(
            'CHAIN\nIF WEIGHT #2 ~Dead("foo")~ THEN D c1\n~first~\n== NPC2\n~second~\n= ~second-b~\n',
        );
        expect(out).toContain("DO ~DoThing()~\nEXIT");
    });

    it("chain epilogue variants: end / copy_trans / trailing transitions", () => {
        const base = {
            type: TDConstructType.Chain as const,
            filename: "D",
            label: "c",
            entries: [{ texts: [literal("x")] }],
        };
        expect(emit([{ ...base, epilogue: { type: TDEpilogueType.End, filename: "D", target: "t" } }])).toContain(
            "END D t",
        );
        expect(
            emit([{ ...base, epilogue: { type: TDEpilogueType.CopyTrans, filename: "D", target: "t", safe: true } }]),
        ).toContain("COPY_TRANS SAFE D t");
        expect(
            emit([
                {
                    ...base,
                    epilogue: {
                        type: TDEpilogueType.Transitions,
                        transitions: [{ next: { type: TDTransitionType.Exit } }],
                    },
                },
            ]),
        ).toContain("END\n    IF ~~ EXIT");
    });
});

describe("INTERJECT", () => {
    it("INTERJECT_COPY_TRANS2 with SAFE renders the header and always-== speaker entries", () => {
        const out = emit([
            {
                type: TDConstructType.InterjectCopyTrans2,
                filename: "D",
                stateLabel: "s",
                globalVariable: "gvar",
                safe: true,
                entries: [{ speaker: "NPC", texts: [literal("a"), literal("b")], action: "Foo()" }],
            },
        ]);
        expect(out).toContain("INTERJECT_COPY_TRANS2 SAFE D s gvar\n  == NPC\n    ~a~\n  = ~b~\n  DO ~Foo()~");
    });
});

describe("patch operations", () => {
    it("ALTER_TRANS: trigger=false clears it, action/reply render their own lines", () => {
        const out = emit([
            {
                type: TDConstructType.Patch,
                operation: {
                    op: TDPatchOp.AlterTrans,
                    filename: "D",
                    states: ["s1", 2],
                    transitions: [0],
                    changes: { trigger: false, action: "Foo()", reply: literal("r") },
                },
            },
        ]);
        expect(out).toBe(
            HEADER +
                'ALTER_TRANS D\nBEGIN s1 2 END\nBEGIN 0 END\nBEGIN\n  "TRIGGER" ~~\n  "ACTION" ~Foo()~\n  "REPLY" ~r~\nEND\n',
        );
    });

    it("ADD_STATE_TRIGGER / ADD_TRANS_TRIGGER / ADD_TRANS_ACTION append UNLESS when present", () => {
        const out1 = emit([
            {
                type: TDConstructType.Patch,
                operation: {
                    op: TDPatchOp.AddStateTrigger,
                    filename: "D",
                    states: ["s"],
                    trigger: "Foo()",
                    unless: "Bar()",
                },
            },
        ]);
        expect(out1).toContain("ADD_STATE_TRIGGER D s ~Foo()~ UNLESS ~Bar()~");

        const out2 = emit([
            {
                type: TDConstructType.Patch,
                operation: {
                    op: TDPatchOp.AddTransTrigger,
                    filename: "D",
                    states: ["s"],
                    transitions: [0, 1],
                    trigger: "Foo()",
                },
            },
        ]);
        expect(out2).toContain("ADD_TRANS_TRIGGER D s ~Foo()~ DO 0 1");
    });

    it("REPLACE_TRANS_TRIGGER/ACTION and REPLACE_TRIGGER/ACTION_TEXT swap old/new text", () => {
        const trans = emit([
            {
                type: TDConstructType.Patch,
                operation: {
                    op: TDPatchOp.ReplaceTransAction,
                    filename: "D",
                    states: ["s"],
                    transitions: [0],
                    oldText: "old",
                    newText: "new",
                },
            },
        ]);
        expect(trans).toContain("REPLACE_TRANS_ACTION D BEGIN s END BEGIN 0 END ~old~ ~new~");

        const text = emit([
            {
                type: TDConstructType.Patch,
                operation: {
                    op: TDPatchOp.ReplaceTriggerText,
                    filenames: ["D1", "D2"],
                    oldText: "old",
                    newText: "new",
                },
            },
        ]);
        expect(text).toContain("REPLACE_TRIGGER_TEXT D1 D2 ~old~ ~new~");
    });

    it("SET_WEIGHT, REPLACE_SAY, and REPLACE_STATE_TRIGGER (multi-state) render", () => {
        expect(
            emit([
                {
                    type: TDConstructType.Patch,
                    operation: { op: TDPatchOp.SetWeight, filename: "D", state: "s", weight: 9 },
                },
            ]),
        ).toContain("SET_WEIGHT D s #9");

        expect(
            emit([
                {
                    type: TDConstructType.Patch,
                    operation: { op: TDPatchOp.ReplaceSay, filename: "D", state: "s", text: literal("x") },
                },
            ]),
        ).toContain("REPLACE_SAY D s ~x~");

        expect(
            emit([
                {
                    type: TDConstructType.Patch,
                    operation: {
                        op: TDPatchOp.ReplaceStateTrigger,
                        filename: "D",
                        states: ["s1", "s2", "s3"],
                        trigger: "Foo()",
                    },
                },
            ]),
        ).toContain("REPLACE_STATE_TRIGGER D s1 ~Foo()~ s2 s3");
    });

    it("REPLACE_STATES emits replacements sorted by numeric key, each state indented", () => {
        const stateA: TDState = { label: "a", say: [{ text: literal("A") }], transitions: [] };
        const stateB: TDState = { label: "b", say: [{ text: literal("B") }], transitions: [] };
        const replacements = new Map([
            [5, stateB],
            [1, stateA],
        ]);
        const out = emit([
            {
                type: TDConstructType.Patch,
                operation: { op: TDPatchOp.ReplaceStates, filename: "D", replacements },
            },
        ]);
        // Sorted by key (1 before 5): state "a" appears before state "b" despite insertion order.
        const idxA = out.indexOf("IF ~~ a");
        const idxB = out.indexOf("IF ~~ b");
        expect(idxA).toBeGreaterThan(-1);
        expect(idxB).toBeGreaterThan(idxA);
        expect(out).toContain(
            "APPEND D\n    IF ~~ a\n        SAY ~A~\n    END\n    IF ~~ b\n        SAY ~B~\n    END\nEND",
        );
    });
});
