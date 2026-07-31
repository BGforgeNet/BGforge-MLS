import { beforeAll, describe, expect, it } from "vitest";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { parseDialog } from "../src/dialog";
import { modelFromD, modelFromSSL, type DialogModel, type DialogState } from "../../shared/dialog-model";
import { classifyReachability } from "../../shared/dialog-reachability";

// 1C reachability lens: honest three-way split (reachable / external-entry / orphan).
// A no-inbound state is entered from OUTSIDE the file (EXTERN), so it is external-entry,
// never a false "dead" - the fix for the 86% false-orphan rate the closed-graph-only
// version produced on real banter dialogs.
describe("dialog reachability (1C)", () => {
    beforeAll(async () => {
        await initWeiduD();
    });

    it("classifies a no-inbound non-entry state as external-entry, not orphan", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN banter_entry
  SAY ~entered via EXTERN from elsewhere~
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable"); // the root's canonical entry
        expect(r.get("banter_entry")).toBe("external-entry"); // nothing in-file points at it
    });

    it("follows GOTO from the entry to mark inbound-reached states reachable", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~go~ GOTO second
END
IF ~~ THEN BEGIN second
  SAY ~second~
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
        expect(r.get("second")).toBe("reachable");
    });

    it("flags a disconnected island (mutual inbound, no path from an entry) as orphan", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN island_a
  SAY ~island a~
  IF ~~ THEN REPLY ~go~ GOTO island_b
END
IF ~~ THEN BEGIN island_b
  SAY ~island b~
  IF ~~ THEN REPLY ~back~ GOTO island_a
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
        // Each island state's only inbound is the other - so neither is an external entry,
        // and neither is reachable from `main`: a genuine dead island.
        expect(r.get("island_a")).toBe("orphan");
        expect(r.get("island_b")).toBe("orphan");
    });

    it("keeps a self-looping entry reachable (root entry wins over its own inbound edge)", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~loop~
  IF ~~ THEN REPLY ~again~ GOTO main
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
    });

    it("flags a self-looping non-entry island as orphan (only inbound is itself)", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN loner
  SAY ~island~
  IF ~~ THEN REPLY ~self~ GOTO loner
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
        expect(r.get("loner")).toBe("orphan");
    });

    it("classifies a single-state graph (no edges) as reachable", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~only~
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.size).toBe(1);
        expect(r.get("main")).toBe("reachable");
    });

    it("returns an empty classification for a root with no states", () => {
        const model: DialogModel = {
            sourceLang: "d",
            editable: true,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [] }],
        };
        expect(classifyReachability(model).size).toBe(0);
    });

    // A state label is unique only WITHIN its own dialogue (root), so a `.d` file with several BEGIN/APPEND
    // dialogues can define the same label in two roots. Flattening every root into one id-keyed map lets one
    // root's state overwrite the other's, so a BFS walk that reaches the shared label then explores the WRONG
    // root's edges - mis-classifying states reachable only through the local copy.
    it("classifies per-root so a label shared by two dialogues does not corrupt the walk", () => {
        const stateOf = (id: string, targets: string[]): DialogState => ({
            id,
            text: `@${id}`,
            choices: targets.map((t, i) => ({ id: `${id}#${i}`, target: { kind: "state", stateId: t } })),
        });
        const model: DialogModel = {
            sourceLang: "d",
            editable: true,
            roots: [
                // Root A: a_main (entry) -> shared -> a_only. All three are reachable WITHIN root A.
                {
                    id: "dlgA",
                    label: "a",
                    kind: "dialog",
                    states: [stateOf("a_main", ["shared"]), stateOf("shared", ["a_only"]), stateOf("a_only", [])],
                },
                // Root B: b_main (entry), plus its OWN `shared` with no outgoing edge.
                {
                    id: "dlgB",
                    label: "b",
                    kind: "dialog",
                    states: [stateOf("b_main", []), stateOf("shared", [])],
                },
            ],
        };
        const r = classifyReachability(model);
        // a_only is reached only through root A's `shared` (a_main -> shared -> a_only). If the two `shared`
        // states collide, root A's walk explores root B's edgeless `shared` and never reaches a_only.
        expect(r.get("a_only")).toBe("reachable");
        expect(r.get("shared")).toBe("reachable"); // reachable in root A -> best verdict for the shared label
        expect(r.get("a_main")).toBe("reachable");
        expect(r.get("b_main")).toBe("reachable");
    });

    // SSL does not enter at its textually-first state - talk_p_proc calls an entry proc, and dialog nodes
    // routinely loop back to that entry ("go back" options), so the entry itself carries an inbound edge and is
    // NOT a no-inbound seed. A classifier that seeds only from states[0] + no-inbound (ignoring the model's
    // entryCalls/entryIds) never reaches the entry's subtree and mass-flags it "orphan" - the real Fallout bug.
    it("seeds the walk from SSL entry procs so a talk_p_proc-entered, back-looping chain is reachable, not orphan", () => {
        const stateOf = (id: string, targets: string[]): DialogState => ({
            id,
            text: `@${id}`,
            choices: targets.map((t, i) => ({ id: `${id}#${i}`, target: { kind: "state", stateId: t } })),
        });
        const model: DialogModel = {
            sourceLang: "ssl",
            editable: false,
            entryIds: ["greeting"],
            entryCalls: [
                {
                    name: "greeting",
                    stmtRange: { start: 0, end: 0 },
                    targetRange: { start: 0, end: 0 },
                    topLevel: true,
                },
            ],
            roots: [
                {
                    id: "dialog",
                    label: "dialog",
                    kind: "dialog",
                    states: [
                        stateOf("intro_unrelated", []), // textually first, but not the engine entry
                        stateOf("greeting", ["reply_yes"]), // the talk_p_proc entry
                        stateOf("reply_yes", ["greeting"]), // loops back -> greeting carries an inbound edge
                    ],
                },
            ],
        };
        const r = classifyReachability(model);
        expect(r.get("greeting")).toBe("reachable"); // talk_p_proc entry, seeded even though it has an inbound edge
        expect(r.get("reply_yes")).toBe("reachable"); // reached only through the entry chain
    });

    // A force_dialog_start / start_dialog_at_node target lands in entryIds but has NO entryCalls entry (nothing
    // in talk_p_proc calls it). It is entered from outside the dialog flow -> external-entry, never orphan - and
    // it still seeds the walk so its own chain is reachable.
    it("treats a force_dialog_start entry (entryIds without entryCalls) as external-entry, its chain reachable", () => {
        const stateOf = (id: string, targets: string[]): DialogState => ({
            id,
            text: `@${id}`,
            choices: targets.map((t, i) => ({ id: `${id}#${i}`, target: { kind: "state", stateId: t } })),
        });
        const model: DialogModel = {
            sourceLang: "ssl",
            editable: false,
            entryIds: ["oob_entry"], // no entryCalls: reached only via force_dialog_start
            roots: [
                {
                    id: "dialog",
                    label: "dialog",
                    kind: "dialog",
                    states: [
                        stateOf("intro_unrelated", []),
                        stateOf("oob_entry", ["oob_reply"]),
                        stateOf("oob_reply", ["oob_entry"]), // loops back -> oob_entry has an inbound edge
                    ],
                },
            ],
        };
        const r = classifyReachability(model);
        expect(r.get("oob_entry")).toBe("external-entry");
        expect(r.get("oob_reply")).toBe("reachable");
    });

    // Driven through the real SSL parser, because the defect this guards lives in the step BEFORE the walk: SSL
    // binds a procedure reference case-insensitively, so `NOption(101, Node005, 4)` reaches `procedure NOde005`
    // and the parser must resolve the two to one id. Left divergent, the state has no in-file inbound edge and
    // the walk honestly reports what it sees - external-entry, an entered-from-elsewhere state - for a node the
    // file plainly points at. Shape taken from abtom.ssl, one of 72 such pairs in the Fallout corpus.
    it("reaches a state whose definition and references disagree on casing (real SSL parse)", async () => {
        const data = await parseDialog(`
procedure Node005;

procedure Node001 begin
    Reply(100);
    NOption(101, Node005, 4);
end

procedure NOde005 begin
    Reply(200);
    NMessage(201);
end

procedure talk_p_proc begin
    call Node001;
end
`);
        const r = classifyReachability(modelFromSSL(data));
        expect(r.get("Node001")).toBe("reachable"); // the talk_p_proc entry
        expect(r.get("NOde005")).toBe("reachable"); // reached only through the case-divergent option edge
    });
});
