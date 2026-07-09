import { beforeAll, describe, expect, it } from "vitest";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD, type DialogModel, type DialogState } from "../../shared/dialog-model";
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
});
