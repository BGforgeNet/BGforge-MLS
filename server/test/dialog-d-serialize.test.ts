import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD, type DialogModel, type DialogState } from "../../shared/dialog-model";
import { modelToD } from "../../shared/dialog-d-serialize";

// ---------------------------------------------------------------------------
// Round-trip helpers
// ---------------------------------------------------------------------------

/**
 * Compare two states for semantic equivalence (text, trigger, weight, and
 * choice structure). State id and root membership are intentionally not checked
 * so BEGIN-vs-APPEND file-label differences don't break the round-trip assertion.
 */
function statesEquivalent(a: DialogState, b: DialogState): boolean {
    if (a.text !== b.text) return false;
    if ((a.trigger ?? "") !== (b.trigger ?? "")) return false;
    if ((a.weight ?? null) !== (b.weight ?? null)) return false;
    if (a.choices.length !== b.choices.length) return false;
    for (let i = 0; i < a.choices.length; i++) {
        const ca = a.choices[i]!;
        const cb = b.choices[i]!;
        if ((ca.text ?? null) !== (cb.text ?? null)) return false;
        if ((ca.condition ?? "") !== (cb.condition ?? "")) return false;
        if ((ca.action ?? null) !== (cb.action ?? null)) return false;
        // Compare targets structurally
        const ta = ca.target;
        const tb = cb.target;
        if (ta.kind !== tb.kind) return false;
        if (ta.kind === "state" && tb.kind === "state" && ta.stateId !== tb.stateId) return false;
        if (ta.kind === "external" && tb.kind === "external" && ta.label !== tb.label) return false;
    }
    return true;
}

function allStates(model: DialogModel): DialogState[] {
    return model.roots.filter((r) => r.kind === "dialog").flatMap((r) => r.states);
}

// ---------------------------------------------------------------------------
// The D source used for the round-trip test
// ---------------------------------------------------------------------------

// Covers: trigger, empty trigger, REPLY, DO, GOTO, EXIT, EXTERN.
// WEIGHT is intentionally absent: the parser does not extract the weight field
// into DDialogState, so it never reaches DialogState.weight and cannot round-trip.
// Weight emission is verified separately via a hand-built model (see shape tests).
const SAMPLE_D = `BEGIN ~testdialog~
IF ~SomeTrigger("x")~ THEN BEGIN entry
  SAY ~Hello there.~
  IF ~PlayerClass(0,FIGHTER_CLASS)~ THEN REPLY ~Fight me!~ DO ~SetGlobal("fought","GLOBAL",1)~ GOTO combat
  IF ~~ THEN REPLY ~Bye.~ EXIT
END
IF ~~ THEN BEGIN combat
  SAY ~En garde!~
  IF ~~ THEN EXTERN ~otherdlg~ 0
END
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("modelToD", () => {
    beforeAll(async () => {
        await initParser();
    });

    describe("round-trip", () => {
        it("parse -> serialize -> re-parse yields equivalent states", () => {
            const data1 = parseDDialog(SAMPLE_D);
            const m1 = modelFromD(data1);
            const serialized = modelToD(m1);
            const data2 = parseDDialog(serialized);
            const m2 = modelFromD(data2);

            const states1 = allStates(m1);
            const states2 = allStates(m2);

            expect(states1.length).toBeGreaterThan(0);
            expect(states1.length).toBe(states2.length);

            // Match states by id (round-trip preserves state ids)
            for (const s1 of states1) {
                const s2 = states2.find((s) => s.id === s1.id);
                expect(s2, `state ${s1.id} missing after round-trip`).toBeDefined();
                expect(statesEquivalent(s1, s2!), `state ${s1.id} differs after round-trip`).toBe(true);
            }
        });

        it("round-trips WEIGHT from a parsed `IF WEIGHT #n` state", () => {
            // Confirms the parser populates DialogState.weight (review flagged this as a
            // possible gap; reading parseState it already calls extractWeight). Verify-only.
            const FIX = `APPEND ~W~
IF WEIGHT #-3 ~~ THEN BEGIN heavy
  SAY @1
  ++ @2 EXIT
END
END
`;
            const m = modelFromD(parseDDialog(FIX));
            const s = m.roots.find((r) => r.kind === "dialog")!.states[0]!;
            expect(s.weight).toBe(-3);
            const reparsed = modelFromD(parseDDialog(modelToD(m)));
            expect(reparsed.roots.find((r) => r.kind === "dialog")!.states[0]!.weight).toBe(-3);
        });

        it("emits WEIGHT when DialogState.weight is set on the model", () => {
            // The parser does not populate DialogState.weight (gap in the parser),
            // so weight can only be tested via a hand-built model here.
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:w",
                        label: "w",
                        kind: "dialog",
                        states: [
                            {
                                id: "ws",
                                text: "Heavy.",
                                weight: -2,
                                choices: [{ id: "ws#0", target: { kind: "exit" } }],
                            },
                        ],
                    },
                ],
            };
            const out = modelToD(model);
            expect(out).toContain("WEIGHT #-2");
        });
    });

    describe("shape assertions on a hand-built model", () => {
        it("emits expected keywords and structure", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:hello",
                        label: "hello",
                        kind: "dialog",
                        states: [
                            {
                                id: "start",
                                text: "Greetings.",
                                choices: [
                                    {
                                        id: "start#0",
                                        target: { kind: "state", stateId: "end" },
                                    },
                                ],
                            },
                            {
                                id: "end",
                                text: "Farewell.",
                                choices: [
                                    {
                                        id: "end#0",
                                        target: { kind: "exit" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            const out = modelToD(model);
            expect(out).toContain("APPEND ~hello~");
            expect(out).toContain("IF ~~ THEN BEGIN start");
            expect(out).toContain("SAY ~Greetings.~");
            expect(out).toContain("GOTO end");
            expect(out).toContain("EXIT");
        });

        it("emits a conditional reply in short form (+ ~cond~ + reply), not longhand", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:c",
                        label: "c",
                        kind: "dialog",
                        states: [
                            {
                                id: "s",
                                text: "Hi.",
                                choices: [
                                    {
                                        id: "s#0",
                                        text: "hi",
                                        condition: "Foo()",
                                        target: { kind: "state", stateId: "s" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            const out = modelToD(model);
            expect(out).toContain("+ ~Foo()~ + ~hi~ + s");
            expect(out).not.toContain("THEN REPLY");
        });

        it("omits REPLY when choice has no text", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:x",
                        label: "x",
                        kind: "dialog",
                        states: [
                            {
                                id: "s",
                                text: "Hi.",
                                choices: [
                                    {
                                        id: "s#0",
                                        // no text field -> bare goto, no REPLY
                                        target: { kind: "state", stateId: "s" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            const out = modelToD(model);
            expect(out).not.toContain("REPLY");
        });

        it("emits EXTERN for external targets", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:x",
                        label: "x",
                        kind: "dialog",
                        states: [
                            {
                                id: "s",
                                text: "Hi.",
                                choices: [
                                    {
                                        id: "s#0",
                                        target: { kind: "external", label: "otherfile:5", resolved: true },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            const out = modelToD(model);
            expect(out).toContain("EXTERN ~otherfile~ 5");
        });

        it("emits COPY_TRANS for copy_trans targets", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [
                    {
                        id: "dialog:x",
                        label: "x",
                        kind: "dialog",
                        states: [
                            {
                                id: "s",
                                text: "Hi.",
                                choices: [
                                    {
                                        id: "s#0",
                                        target: { kind: "external", label: "COPY_TRANS sourcefile:3", resolved: false },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            const out = modelToD(model);
            expect(out).toContain("COPY_TRANS ~sourcefile~ 3");
        });
    });

    describe("error cases", () => {
        it("throws for non-weidu-d format", () => {
            const model: DialogModel = {
                sourceLang: "ssl",
                editable: false,
                roots: [],
            };
            expect(() => modelToD(model)).toThrow("modelToD: only weidu-d is serializable");
        });

        it("returns empty string when there are no dialog roots", () => {
            const model: DialogModel = {
                sourceLang: "d",
                editable: true,
                roots: [],
            };
            expect(modelToD(model)).toBe("");
        });
    });
});
