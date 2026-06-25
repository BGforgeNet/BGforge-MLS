import { beforeAll, describe, expect, it } from "vitest";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { parseDialog as parseSSL } from "../src/dialog";
import {
    choiceBadges,
    isFlaggedNode,
    modelFromD,
    modelFromSSL,
    stateBadges,
    type DialogChoice,
    type DialogState,
} from "../../shared/dialog-model";
import type { SSLDialogData } from "../../shared/dialog-types";

// 1B honest-projection badge layer: a single badge vocabulary derived from the IR.
// This slice covers only the signals the IR already carries (derived, conditional,
// unresolved-external); computed/random/side-effect/virtual-sink need parser work and
// land in later slices.
describe("dialog honest-projection badges (1B): available signals", () => {
    it("badges a derived (CHAIN/INTERJECT/EXTEND) state as read-only derived", () => {
        const s: DialogState = { id: "x", text: "@1", choices: [], derivedFrom: "CHAIN" };
        expect(stateBadges(s)).toEqual(["derived"]);
    });

    it("badges a triggered state conditional", () => {
        const s: DialogState = { id: "x", text: "@1", choices: [], trigger: 'Global("g","GLOBAL",1)' };
        expect(stateBadges(s)).toEqual(["conditional"]);
    });

    it("orders derived before conditional when both apply", () => {
        const s: DialogState = { id: "x", text: "@1", choices: [], derivedFrom: "INTERJECT", trigger: "x" };
        expect(stateBadges(s)).toEqual(["derived", "conditional"]);
    });

    it("returns no badges for a plain authored state", () => {
        const s: DialogState = { id: "x", text: "@1", choices: [] };
        expect(stateBadges(s)).toEqual([]);
    });

    it("badges an unresolved external choice target", () => {
        const c: DialogChoice = { id: "c", target: { kind: "external", label: "%v%:s", resolved: false } };
        expect(choiceBadges(c)).toEqual(["unresolved-external"]);
    });

    it("does not badge a resolved external choice target", () => {
        const c: DialogChoice = { id: "c", target: { kind: "external", label: "f:s", resolved: true } };
        expect(choiceBadges(c)).toEqual([]);
    });

    it("badges a conditional choice", () => {
        const c: DialogChoice = { id: "c", target: { kind: "exit" }, condition: "x" };
        expect(choiceBadges(c)).toEqual(["conditional"]);
    });
});

describe("dialog badges from the real D producer", () => {
    beforeAll(async () => {
        await initWeiduD();
    });

    it("derives conditional (state) and unresolved-external (choice) badges from a parsed model", () => {
        const d = `BEGIN ~test~
IF ~Global("g","GLOBAL",1)~ THEN BEGIN s
  SAY ~Hi.~
  IF ~~ THEN REPLY ~go~ EXTERN ~%VAR%~ other
END
END
`;
        const model = modelFromD(parseDDialog(d));
        const st = model.roots.find((r) => r.kind === "dialog")!.states.find((x) => x.id === "s")!;
        expect(stateBadges(st)).toEqual(["conditional"]);
        expect(choiceBadges(st.choices[0]!)).toEqual(["unresolved-external"]);
    });
});

describe("dialog badges (1B): computed/random message ids (SSL)", () => {
    it("badges computed and random msgIds from the real SSL producer", async () => {
        const ssl = `
procedure Node001 begin
    Reply(some_var);
    NOption(another_var, Node002, 4);
end
procedure Node002 begin
    Reply(random(100, 105));
    NMessage(200);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const model = modelFromSSL(await parseSSL(ssl));
        const root = model.roots[0]!;
        const n1 = root.states.find((s) => s.id === "Node001")!;
        const n2 = root.states.find((s) => s.id === "Node002")!;
        // Reply(some_var) -> the line is a runtime-built id, not a fixed string.
        expect(stateBadges(n1)).toContain("computed");
        // NOption(another_var, ...) -> the option text is computed too.
        expect(choiceBadges(n1.choices[0]!)).toContain("computed");
        // Reply(random(100, 105)) -> one of several lines shown at runtime.
        expect(stateBadges(n2)).toContain("random");
    });

    it("does not badge a literal numeric msgId", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    NMessage(101);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const model = modelFromSSL(await parseSSL(ssl));
        const n1 = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(stateBadges(n1)).toEqual([]);
        expect(choiceBadges(n1.choices[0]!)).toEqual([]);
    });
});

describe("dialog badges (1B): side-effect (D action) and virtual-sink", () => {
    beforeAll(async () => {
        await initWeiduD();
    });

    it("badges a D transition carrying a DO action as side-effect", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN s
  SAY ~Hi.~
  IF ~~ THEN DO ~SetGlobal("x","GLOBAL",1)~ EXIT
END
END
`;
        const model = modelFromD(parseDDialog(d));
        const st = model.roots.find((r) => r.kind === "dialog")!.states.find((x) => x.id === "s")!;
        expect(choiceBadges(st.choices[0]!)).toContain("side-effect");
    });

    it("badges a choice targeting an engine sink node (Node999/Node998) as virtual-sink", async () => {
        const ssl = `
procedure Node001 begin
    NOption(100, Node999, 4);
end
procedure talk_p_proc begin
    call Node001;
end
`;
        const model = modelFromSSL(await parseSSL(ssl));
        const n1 = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(choiceBadges(n1.choices[0]!)).toContain("virtual-sink");
    });
});

// SSL node-level side-effects: a Node procedure that calls a state-mutating void builtin
// (set_global_var, give_xp, ...) does something the dialog text does not show. The parser
// records the offending function names on the node; the badge layer flags the state. This
// covers the IR-field -> badge projection and the adapter copy; the parser's own detection
// (which void calls count) is covered in ssl-dialog.test.ts against the real producer.
describe("dialog badges (1B): SSL node-level side-effect", () => {
    it("badges a state whose node carries side-effect calls", () => {
        const s: DialogState = { id: "x", text: "@1", choices: [], sideEffects: ["set_global_var"] };
        expect(stateBadges(s)).toEqual(["side-effect"]);
    });

    it("orders side-effect after the state's own derived/conditional badges", () => {
        const s: DialogState = {
            id: "x",
            text: "@1",
            choices: [],
            trigger: 'Global("g","GLOBAL",1)',
            sideEffects: ["give_xp"],
        };
        expect(stateBadges(s)).toEqual(["conditional", "side-effect"]);
    });

    it("does not badge a state with an empty or absent side-effect list", () => {
        expect(stateBadges({ id: "x", text: "@1", choices: [], sideEffects: [] })).toEqual([]);
        expect(stateBadges({ id: "x", text: "@1", choices: [] })).toEqual([]);
    });

    it("flags a node with side-effects for the spotlight overlay", () => {
        expect(isFlaggedNode({ id: "x", text: "@1", choices: [], sideEffects: ["give_xp"] })).toBe(true);
    });

    it("carries node sideEffects through the real SSL adapter into the state and its badge", () => {
        const data: SSLDialogData = {
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    replies: [],
                    options: [],
                    callTargets: [],
                    sideEffects: ["set_global_var"],
                },
            ],
            entryPoints: [],
        };
        const model = modelFromSSL(data);
        const st = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(st.sideEffects).toEqual(["set_global_var"]);
        expect(stateBadges(st)).toContain("side-effect");
    });
});

// The spotlight overlay (1B) dims fully-authored nodes and highlights the uncertain ones.
// `isFlaggedNode` is its pure projection: a node is flagged iff it - or any of its choices -
// carries a badge.
describe("dialog spotlight projection (1B): isFlaggedNode", () => {
    const plainChoice: DialogChoice = { id: "c0", text: "ok", target: { kind: "exit" } };

    it("a fully-authored state with only plain choices is not flagged", () => {
        const s: DialogState = { id: "s", text: "@1", choices: [plainChoice] };
        expect(isFlaggedNode(s)).toBe(false);
    });

    it("flags a state that itself carries a badge (derived / triggered)", () => {
        expect(isFlaggedNode({ id: "s", text: "@1", choices: [], derivedFrom: "CHAIN" })).toBe(true);
        expect(isFlaggedNode({ id: "s", text: "@1", choices: [], trigger: "x" })).toBe(true);
    });

    it("flags a plain state when one of its choices carries a badge", () => {
        const conditional: DialogChoice = {
            id: "c1",
            text: "maybe",
            condition: "Reputation<5",
            target: { kind: "exit" },
        };
        const unresolved: DialogChoice = { id: "c2", target: { kind: "external", label: "%v%:0", resolved: false } };
        expect(isFlaggedNode({ id: "s", text: "@1", choices: [plainChoice, conditional] })).toBe(true);
        expect(isFlaggedNode({ id: "s", text: "@1", choices: [unresolved] })).toBe(true);
    });
});
